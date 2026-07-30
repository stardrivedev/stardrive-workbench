/**
 * Per-site environment: the settings a built site needs on whatever host it
 * lands on, and who is responsible for each one.
 *
 * This exists because a site that assembles perfectly can still arrive dead.
 * The CMS fails closed without ADMIN_PASSWORD, the contact form saves silently
 * without RESEND_API_KEY, and until now nothing set either: the Vercel path
 * wired a database and a canonical URL and left the rest, and every other host
 * got nothing at all. A licensee discovering that on their client's launch day
 * is the worst possible moment.
 *
 * Every variable falls into exactly one of three buckets, and the difference
 * is the whole point:
 *
 *   managed   Stardrive knows the value and fills it. The database, the site
 *             URL, the admin password. The licensee never types these.
 *   supplied  Only the licensee has it: their Resend key, the inbox that
 *             should receive enquiries. Asked for once, stored encrypted,
 *             reused on every deploy of that site.
 *   optional  Genuinely fine to leave empty. The feature stays dormant and
 *             says so, rather than half working.
 *
 * Secrets are AES-256-GCM at rest under the same STARDRIVE_SECRET as hosting
 * tokens, and are revealed only server-side at deploy time or in an explicit,
 * authenticated download the licensee asked for.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Same secret source as connections.mjs, so one backup covers both. */
function loadSecret(varDir) {
  if (process.env.STARDRIVE_SECRET) return process.env.STARDRIVE_SECRET;
  const file = path.join(varDir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(varDir, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf-8').trim();
}

/**
 * Variables Stardrive fills itself, and where the value comes from. Listed
 * here so the UI can show the licensee what is already handled rather than
 * leaving them to wonder which of a dozen names they still owe.
 */
export const MANAGED = {
  ADMIN_PASSWORD: 'Generated per site. This is what your client signs in with.',
  TURSO_DATABASE_URL: 'From the database you connected in Hosting.',
  TURSO_AUTH_TOKEN: 'From the database you connected in Hosting.',
  NEXT_PUBLIC_SITE_URL: 'From the custom domain attached to this site.',
};

/**
 * Variables only the licensee can provide, with copy written for a person
 * rather than a manifest. `why` says what breaks without it, because "optional"
 * with no consequence attached is how a client ends up never receiving their
 * enquiries.
 */
export const SUPPLIED = {
  RESEND_API_KEY: {
    label: 'Resend API key',
    where: 'resend.com/api-keys',
    why: 'Without it the contact form, job applications, booking confirmations and newsletter notifications are all still SAVED, but no email is ever sent.',
    secret: true,
  },
  CONTACT_TO_EMAIL: {
    label: 'Where enquiries should go',
    where: 'Any inbox your client actually reads',
    why: 'The address that receives contact form messages, applications and booking alerts. Needed alongside the Resend key.',
    secret: false,
  },
  BLOB_READ_WRITE_TOKEN: {
    label: 'Vercel Blob token',
    where: 'Vercel dashboard, Storage, Blob',
    why: 'Somewhere permanent to keep images uploaded in /admin. One of two options, and the easy one if this site is on Vercel.',
    secret: true,
    group: 'imageStorage',
  },
  S3_BUCKET: {
    label: 'Storage bucket name',
    where: 'Cloudflare R2, Backblaze B2, Wasabi, MinIO or AWS S3',
    why: 'Somewhere permanent to keep images uploaded in /admin, on any host. The other option, and the one to use anywhere but Vercel.',
    secret: false,
    group: 'imageStorage',
  },
  S3_ACCESS_KEY_ID: {
    label: 'Storage access key ID',
    where: 'Alongside the bucket, wherever it lives',
    why: 'Identifies the account writing to the bucket.',
    secret: false,
    group: 'imageStorage',
  },
  S3_SECRET_ACCESS_KEY: {
    label: 'Storage secret access key',
    where: 'Shown once when the key pair is created',
    why: 'The other half of the storage key pair.',
    secret: true,
    group: 'imageStorage',
  },
  S3_ENDPOINT: {
    label: 'Storage endpoint',
    where: 'e.g. https://<account>.r2.cloudflarestorage.com',
    why: 'Needed for anything other than AWS itself. Leave blank for AWS S3.',
    secret: false,
    group: 'imageStorage',
    optionalWithin: true,
  },
  S3_REGION: {
    label: 'Storage region',
    where: 'e.g. auto for R2, us-east-1 for AWS',
    why: 'Defaults to us-east-1 when blank.',
    secret: false,
    group: 'imageStorage',
    optionalWithin: true,
  },
  S3_PUBLIC_BASE_URL: {
    label: 'Public URL for the bucket',
    where: 'Your CDN or public bucket address, if it differs from the endpoint',
    why: 'Where visitors read the images back from. Leave blank to use the endpoint.',
    secret: false,
    group: 'imageStorage',
    optionalWithin: true,
  },
};

/**
 * Groups where any ONE complete option satisfies the requirement.
 *
 * Image storage has two perfectly good answers and the right one depends on
 * where the site is hosted. Listing six variables as individually outstanding
 * would tell a licensee on Netlify to go and fetch a Vercel credential, and
 * make a finished site look like it was missing five things.
 */
export const SUPPLIED_GROUPS = {
  imageStorage: {
    label: 'Somewhere to keep uploaded images',
    why: 'Without one of these, images your client uploads in /admin have nowhere permanent to go, and the site refuses the upload rather than losing it on the next deploy.',
    options: [
      { id: 'vercelBlob', label: 'Vercel Blob', vars: ['BLOB_READ_WRITE_TOKEN'], suitsHost: 'vercel' },
      {
        id: 's3',
        label: 'S3-compatible (Cloudflare R2, Backblaze B2, Wasabi, MinIO, AWS)',
        vars: ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
        suitsHost: 'any',
      },
    ],
  },
};

/** Is one option of a group fully answered? */
export function groupSatisfied(groupKey, env) {
  const group = SUPPLIED_GROUPS[groupKey];
  if (!group) return false;
  return group.options.some((opt) => opt.vars.every((name) => String(env?.[name] ?? '').trim()));
}

const ADMIN_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A password a human will retype off a printed handoff sheet. Ambiguous
 * characters (l/1/I, O/0) are excluded on purpose: this gets copied by hand
 * more often than anyone admits.
 */
export function generateAdminPassword(length = 20) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ADMIN_ALPHABET[bytes[i] % ADMIN_ALPHABET.length];
  return out;
}

/**
 * Which variables this site's modules actually declare, merged with what
 * Stardrive knows how to fill. Driven by the manifests, so a module added
 * later brings its own settings along with no change here.
 */
export function specFor(modules = [], resolveManifest = () => null) {
  const declared = new Map();
  for (const name of modules) {
    const manifest = resolveManifest(name);
    for (const v of manifest?.env ?? []) {
      const existing = declared.get(v.name);
      declared.set(v.name, {
        name: v.name,
        // Required anywhere means required: one module needing it is enough.
        required: Boolean(existing?.required || v.required),
        description: existing?.description || v.description || '',
      });
    }
  }
  // The base template and cms-core need these whether or not a manifest says
  // so: the admin shell is unusable without a password, and the canonical URL
  // is what robots.ts and sitemap.ts resolve against.
  for (const name of ['ADMIN_PASSWORD', 'NEXT_PUBLIC_SITE_URL']) {
    if (!declared.has(name)) declared.set(name, { name, required: name === 'ADMIN_PASSWORD', description: '' });
  }

  return [...declared.values()].map((v) => {
    const supplied = SUPPLIED[v.name];
    return {
      ...v,
      source: MANAGED[v.name] ? 'managed' : supplied ? 'supplied' : 'optional',
      ...(MANAGED[v.name] ? { managedBy: MANAGED[v.name] } : {}),
      ...(supplied
        ? {
          label: supplied.label,
          where: supplied.where,
          why: supplied.why,
          secret: supplied.secret,
          // Carried through so missingFrom and the console can treat an
          // either/or as one requirement rather than several.
          ...(supplied.group ? { group: supplied.group } : {}),
          ...(supplied.optionalWithin ? { optionalWithin: true } : {}),
        }
        : {}),
    };
  }).sort((a, b) => {
    const order = { supplied: 0, managed: 1, optional: 2 };
    return order[a.source] - order[b.source] || a.name.localeCompare(b.name);
  });
}

export function createSiteEnv(store, varDir) {
  const key = crypto.scryptSync(loadSecret(varDir), 'stardrive-connections-v1', 32);
  const rel = (siteId) => `site-env/${siteId}.json`;

  const encrypt = (plain) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf-8'), cipher.final()]);
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') };
  };

  const decrypt = (enc) => {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'hex'));
    d.setAuthTag(Buffer.from(enc.tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(enc.data, 'hex')), d.final()]).toString('utf-8');
  };

  const read = (siteId) => store.readJson(rel(siteId), {});
  const write = (siteId, record) => store.writeJson(rel(siteId), record);

  /**
   * The site's admin password, generated on first use and stable afterwards.
   * Stable matters: rotating it on every deploy would silently lock out a
   * client who wrote it down.
   */
  function adminPassword(siteId) {
    const record = read(siteId);
    if (record.ADMIN_PASSWORD) return decrypt(record.ADMIN_PASSWORD.enc);
    const password = generateAdminPassword();
    record.ADMIN_PASSWORD = { enc: encrypt(password), updatedAt: new Date().toISOString() };
    write(siteId, record);
    return password;
  }

  /** A new password, for handing the site over or after a leak. */
  function rotateAdminPassword(siteId) {
    const record = read(siteId);
    const password = generateAdminPassword();
    record.ADMIN_PASSWORD = { enc: encrypt(password), updatedAt: new Date().toISOString() };
    write(siteId, record);
    return password;
  }

  /** Store one licensee-supplied value. An empty value clears it. */
  function setVar(siteId, name, value) {
    const record = read(siteId);
    const clean = String(value ?? '').trim();
    if (!clean) delete record[name];
    else record[name] = { enc: encrypt(clean), updatedAt: new Date().toISOString() };
    write(siteId, record);
    return true;
  }

  /** Everything stored for this site, decrypted. Server-side only. */
  function values(siteId) {
    const out = {};
    for (const [name, entry] of Object.entries(read(siteId))) {
      try { out[name] = decrypt(entry.enc); } catch { /* unreadable under a different secret */ }
    }
    return out;
  }

  /**
   * What the UI may see: whether a value is set and when, never the value.
   * The one exception is CONTACT_TO_EMAIL, which is an address the licensee
   * typed and needs to be able to check, not a credential.
   */
  function masked(siteId) {
    const record = read(siteId);
    const out = {};
    for (const [name, entry] of Object.entries(record)) {
      const isSecret = SUPPLIED[name]?.secret !== false || name === 'ADMIN_PASSWORD';
      let preview = null;
      if (!isSecret) {
        try { preview = decrypt(entry.enc); } catch { preview = null; }
      }
      out[name] = { set: true, updatedAt: entry.updatedAt, ...(preview ? { value: preview } : {}) };
    }
    return out;
  }

  function clear(siteId) {
    return store.deleteJson(rel(siteId));
  }

  return { adminPassword, rotateAdminPassword, setVar, values, masked, clear };
}

/**
 * The full environment for one deploy: what the licensee supplied, plus
 * everything Stardrive manages. Managed values win, because they are derived
 * from live connections and a stale hand-typed copy would be worse than none.
 */
export function deployEnv({ supplied = {}, adminPassword, databaseUrl, databaseToken, siteUrl }) {
  return {
    ...supplied,
    ...(adminPassword ? { ADMIN_PASSWORD: adminPassword } : {}),
    ...(databaseUrl ? { TURSO_DATABASE_URL: databaseUrl } : {}),
    ...(databaseToken ? { TURSO_AUTH_TOKEN: databaseToken } : {}),
    ...(siteUrl ? { NEXT_PUBLIC_SITE_URL: siteUrl } : {}),
  };
}

/** A .env file body, for a host Stardrive cannot write to directly. */
export function renderEnvFile(env, siteName = 'this site') {
  const lines = [
    `# Environment for ${siteName}`,
    '#',
    '# Paste these into your host\'s environment variables screen. On most',
    '# platforms that is Settings, then Environment Variables. Every one of',
    '# them is a secret: this file should never be committed to a repository.',
    '',
  ];
  for (const [name, value] of Object.entries(env)) {
    if (MANAGED[name]) lines.push(`# ${MANAGED[name]}`);
    else if (SUPPLIED[name]) lines.push(`# ${SUPPLIED[name].why}`);
    lines.push(`${name}=${value}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** What is still missing before this site works properly once published. */
export function missingFrom(spec, env) {
  const out = [];
  const groupsSeen = new Set();
  for (const v of spec) {
    if (v.source !== 'supplied') continue;

    // A grouped variable is never reported on its own: the group is one
    // requirement with two answers, and reporting six boxes would both
    // overstate the work and point a Netlify licensee at a Vercel credential.
    if (v.group) {
      if (groupsSeen.has(v.group)) continue;
      groupsSeen.add(v.group);
      if (groupSatisfied(v.group, env)) continue;
      const group = SUPPLIED_GROUPS[v.group];
      out.push({
        name: v.group,
        group: v.group,
        label: group.label,
        why: group.why,
        where: group.options.map((o) => o.label).join(', or '),
        options: group.options,
      });
      continue;
    }

    if (!String(env?.[v.name] ?? '').trim()) {
      out.push({ name: v.name, label: v.label ?? v.name, why: v.why ?? '', where: v.where ?? '' });
    }
  }
  return out;
}
