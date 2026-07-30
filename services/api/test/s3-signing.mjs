/**
 * The S3 request signing, checked against AWS's own published test vector.
 *
 * This code is the one part of this change that fails LATE and quietly: a
 * signing bug compiles, deploys, and only shows itself when a client tries to
 * upload a photograph into their own admin weeks later. Asserting that the
 * signer agrees with itself would prove nothing, so it is checked two ways:
 *
 *   1. The signature is recomputed here from the documented SigV4 steps,
 *      written out separately from the implementation, using AWS's own example
 *      credentials and date. The two can only agree by both being right —
 *      unless I misread the specification the same way twice, which is the
 *      honest limit of this approach.
 *   2. Against a frozen golden value, so a later edit that changes the
 *      signature has to be deliberate rather than accidental.
 *
 * What neither can prove is that a real provider accepts it. That needs one
 * live round trip against R2 or MinIO, and it sits with the other live
 * provider checks on the blocked list in docs/ROADMAP.md.
 *
 * The real .ts file is imported directly: Node strips the types itself, so
 * this exercises exactly the code that ships inside a client's site rather
 * than a copy of it that could drift.
 *
 * Run: node services/api/test/s3-signing.mjs
 */
import assert from 'node:assert';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(
  HERE, '..', '..', '..',
  'vendor', 'd4', 'd4-cms-core', 'files', 'src', 'lib', 'cms', 'object-store.ts',
);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

console.log('s3 signing:');

const { signPutRequest } = await import(pathToFileURL(SRC).href);

const CFG = {
  bucket: 'examplebucket',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  endpoint: 'https://s3.us-east-1.amazonaws.com',
  region: 'us-east-1',
  publicBaseUrl: null,
};
const WHEN = new Date(Date.UTC(2013, 4, 24, 0, 0, 0)); // 20130524T000000Z, AWS's vector date

check('a signature is produced in the documented shape', () => {
  const body = Buffer.from('Welcome to Amazon S3.');
  const signed = signPutRequest({
    cfg: CFG, key: 'test$file.text', body, contentType: 'text/plain', now: WHEN,
  });
  assert.match(
    signed.headers.Authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
    signed.headers.Authorization,
  );
  assert.strictEqual(signed.headers['x-amz-date'], '20130524T000000Z');
  assert.strictEqual(
    signed.headers['x-amz-content-sha256'],
    crypto.createHash('sha256').update(body).digest('hex'),
    'the payload hash is the real hash of the body, not UNSIGNED-PAYLOAD',
  );
});

check('the signature is exactly what the documented steps produce', () => {
  // Recomputed here from first principles, so this test and the implementation
  // can only agree by both being right rather than by sharing a mistake.
  const body = Buffer.from('Welcome to Amazon S3.');
  const key = 'test$file.text';
  const signed = signPutRequest({
    cfg: CFG, key, body, contentType: 'text/plain', now: WHEN,
  });

  const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const payloadHash = sha(body);
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const canonicalHeaders =
    `content-length:${body.length}\n` +
    'content-type:text/plain\n' +
    'host:s3.us-east-1.amazonaws.com\n' +
    `x-amz-content-sha256:${payloadHash}\n` +
    'x-amz-date:20130524T000000Z\n';
  const signedHeaders = 'content-length;content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT', `/examplebucket/${encodedKey}`, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');
  const scope = '20130524/us-east-1/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', '20130524T000000Z', scope, sha(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${CFG.secretAccessKey}`, '20130524'), 'us-east-1'), 's3'), 'aws4_request');
  const expected = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  assert.ok(signed.headers.Authorization.endsWith(`Signature=${expected}`),
    `signature mismatch\n        got:      ${signed.headers.Authorization}\n        expected signature ${expected}`);

  // Frozen, so that changing the signer becomes a deliberate act. If this
  // fails and the recomputation above still passes, both were changed
  // together and somebody should say why.
  assert.strictEqual(expected, 'b68e6c6e6850b192f661b333d15a934779101ab5f0e7be88494868d023fae0cb',
    'the signature for AWS\'s example request changed');
});

check('a path-style URL is built, and every segment is escaped', () => {
  const signed = signPutRequest({
    cfg: CFG, key: 'uploads/202607/a photo & co.png', body: Buffer.from('x'),
    contentType: 'image/png', now: WHEN,
  });
  // Path style, because virtual-host style needs the bucket in DNS and MinIO
  // and several R2 setups do not provide that.
  assert.match(signed.url, /^https:\/\/s3\.us-east-1\.amazonaws\.com\/examplebucket\/uploads\/202607\//);
  assert.strictEqual(signed.url.includes(' '), false, 'a space would make the request unsignable');
  assert.ok(signed.url.includes('%20') || signed.url.includes('%26'), 'the awkward characters are escaped');
  // The slashes between segments survive: they are structure, not content.
  assert.ok(signed.url.includes('/uploads/202607/'), 'path separators are not escaped away');
});

check('a custom endpoint (R2, B2, MinIO) is honoured rather than AWS assumed', () => {
  const signed = signPutRequest({
    cfg: { ...CFG, endpoint: 'https://abc123.r2.cloudflarestorage.com', region: 'auto' },
    key: 'uploads/x.png', body: Buffer.from('x'), contentType: 'image/png', now: WHEN,
  });
  assert.match(signed.url, /^https:\/\/abc123\.r2\.cloudflarestorage\.com\/examplebucket\/uploads\/x\.png$/);
  assert.match(signed.headers.Authorization, /\/20130524\/auto\/s3\/aws4_request/, 'signed for the right region');
  assert.strictEqual(signed.headers.host, 'abc123.r2.cloudflarestorage.com', 'and the right host');
});


if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll s3 signing checks passed.');
