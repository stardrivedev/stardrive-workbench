/**
 * Server-only object storage for files uploaded through /admin.
 *
 * Two backends, chosen by which credential the site has:
 *
 *   - **Vercel Blob** (`BLOB_READ_WRITE_TOKEN`) — the easy one when the site
 *     is on Vercel.
 *   - **S3-compatible** (`S3_BUCKET` + `S3_ACCESS_KEY_ID` +
 *     `S3_SECRET_ACCESS_KEY`) — Cloudflare R2, Backblaze B2, Wasabi, MinIO,
 *     AWS itself. This is what makes "host it anywhere" true for images as
 *     well as for pages.
 *
 * There is deliberately no third option that writes to the local filesystem in
 * production. That used to be the fallback, and on every host except Vercel it
 * meant the client's photographs were quietly erased by the next deploy: the
 * upload succeeded, the image appeared, and weeks later it was gone with no
 * error anywhere. Failing loudly at the moment of upload is far kinder.
 *
 * The signing is written out by hand rather than pulling in the AWS SDK. It is
 * one request shape (a single PUT), the SDK is tens of megabytes, and every
 * Stardrive build runs `npm install` — so the dependency would be paid for on
 * every build of every site forever, to save about a hundred lines here.
 */
import { createHash, createHmac } from "crypto";

export type StoredFile = { url: string };

export type S3Config = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Full endpoint, e.g. https://<account>.r2.cloudflarestorage.com. Defaults to AWS. */
  endpoint: string;
  region: string;
  /** Where the public can read these back from, if it is not the endpoint. */
  publicBaseUrl: string | null;
};

/** The S3 settings, or null when this site is not configured for S3. */
export function s3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;

  const region = process.env.S3_REGION?.trim() || "us-east-1";
  const endpoint =
    process.env.S3_ENDPOINT?.trim().replace(/\/+$/, "") ||
    `https://s3.${region}.amazonaws.com`;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") || null,
  };
}

export function hasObjectStore(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()) || s3Config() !== null;
}

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** Every path segment escaped, but the slashes between them kept. */
function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * AWS Signature Version 4 for a single PUT.
 *
 * Deliberately literal, following the published signing steps in order, so it
 * can be read against the AWS documentation rather than trusted. Verified in
 * test/s3-signing.mjs against AWS's own published test vector.
 */
export function signPutRequest(params: {
  cfg: S3Config;
  key: string;
  body: Buffer;
  contentType: string;
  now?: Date;
}): { url: string; headers: Record<string, string> } {
  const { cfg, key, body, contentType } = params;
  const now = params.now ?? new Date();

  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, ""); // 20260730T101530Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  // Path-style addressing (/<bucket>/<key>): virtual-host style needs the
  // bucket in DNS, which MinIO and several R2 setups do not provide.
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`);
  const host = url.host;

  // 1 — the canonical request. Headers must be sorted, lowercased, trimmed.
  const headers: Record<string, string> = {
    "content-length": String(body.length),
    "content-type": contentType,
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((h) => `${h}:${String(headers[h]).trim()}\n`)
    .join("");
  const canonicalRequest = [
    "PUT",
    url.pathname,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // 2 — the string to sign.
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  // 3 — the signing key, derived one step at a time.
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return {
    url: url.toString(),
    headers: {
      ...headers,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/** Where the world reads this object back from. */
function publicUrl(cfg: S3Config, key: string): string {
  const base = cfg.publicBaseUrl ?? `${cfg.endpoint}/${cfg.bucket}`;
  return `${base}/${encodeKey(key)}`;
}

/**
 * Store one file and return the URL it can be read from. Throws with something
 * a person can act on: this surfaces in the client's admin, so "Could not
 * store the file" is the least useful thing it could say.
 */
export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
): Promise<StoredFile> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (blobToken) {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, body, { access: "public", contentType });
    return { url: blob.url };
  }

  const cfg = s3Config();
  if (!cfg) {
    throw new Error(
      "No image storage is configured for this site, so there is nowhere " +
        "permanent to put this file. Set BLOB_READ_WRITE_TOKEN (Vercel Blob) " +
        "or S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY " +
        "(any S3-compatible storage)."
    );
  }

  const signed = signPutRequest({ cfg, key, body, contentType });
  const res = await fetch(signed.url, { method: "PUT", headers: signed.headers, body });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `The storage provider refused the upload (${res.status}). ` +
        `Check the bucket name, keys and endpoint. ${detail}`.trim()
    );
  }
  return { url: publicUrl(cfg, key) };
}
