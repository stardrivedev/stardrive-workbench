/**
 * Asset compartments — named upload slots per SITE, so a customer's files
 * land in the right place on the site being built without them ever
 * thinking about paths.
 *
 * Every kind:"site" template gets the STANDARD compartments; a template may
 * declare extra ones via manifest assetSlots (validated by template-kit,
 * reserved ids protected). Each slot maps to a deterministic target
 * directory in the assembled site; the assembler copies uploads there.
 * With the dry engine the resolved slotting is recorded in the workspace
 * marker — same contract, no pretend site.
 *
 * Binary files live under var/assets/<siteId>/<slot>/; metadata in
 * var/assets/<siteId>/index.json. Access is always through the site record,
 * so account scoping is inherited from loadSite().
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ASSET_EXTS } from '../../../packages/template-kit/index.mjs';

export const MAX_ASSET_BYTES = 8_000_000;

export const STANDARD_SLOTS = [
  { id: 'logo', label: 'Logo', description: 'Primary logo. SVG or transparent PNG works best.', accept: ['svg', 'png', 'webp'], max: 1, target: 'public/assets/brand/' },
  { id: 'favicon', label: 'Favicon', description: 'Browser-tab icon. Square; ICO, PNG, or SVG.', accept: ['ico', 'png', 'svg'], max: 1, target: 'src/app/' },
  { id: 'hero', label: 'Hero images', description: 'The big opening imagery on the home page.', accept: ['jpg', 'jpeg', 'png', 'webp'], max: 3, target: 'public/assets/hero/' },
  { id: 'about', label: 'About / story photos', description: 'Photos for the about page.', accept: ['jpg', 'jpeg', 'png', 'webp'], max: 6, target: 'public/assets/about/' },
  { id: 'gallery', label: 'Gallery', description: 'Portfolio or product shots.', accept: ['jpg', 'jpeg', 'png', 'webp', 'gif'], max: 24, target: 'public/assets/gallery/' },
  { id: 'team', label: 'Team photos', description: 'Headshots and team imagery.', accept: ['jpg', 'jpeg', 'png', 'webp'], max: 12, target: 'public/assets/team/' },
  { id: 'misc', label: 'Everything else', description: 'Any other imagery the site should have on hand.', accept: [...ASSET_EXTS], max: 12, target: 'public/assets/misc/' },
];

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  svg: 'image/svg+xml', gif: 'image/gif', ico: 'image/x-icon',
};

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

export function createAssets(store) {
  const indexRel = (siteId) => `assets/${siteId}/index.json`;
  const fileAbs = (siteId, slot, stored) => store.path('assets', siteId, slot, stored);

  /** Standard slots + the template's declared extras (targets derived). */
  function slotsFor(manifest) {
    const extras = (manifest?.assetSlots ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description ?? 'Declared by this template.',
      accept: s.accept ?? [...ASSET_EXTS],
      max: s.max ?? 12,
      target: `public/assets/${s.id}/`,
      declaredBy: manifest.name,
    }));
    return [...STANDARD_SLOTS, ...extras];
  }

  function state(siteId) {
    return store.readJson(indexRel(siteId), {});
  }

  function add(siteId, slotDef, filename, buffer) {
    const ext = String(path.extname(filename)).replace('.', '').toLowerCase();
    if (!slotDef.accept.includes(ext)) {
      throw httpError(422, 'wrong_type', `"${slotDef.label}" accepts ${slotDef.accept.join(', ')} — got .${ext || '?'}.`);
    }
    if (buffer.length === 0 || buffer.length > MAX_ASSET_BYTES) {
      throw httpError(422, 'too_large', `Files must be 1 byte – ${Math.round(MAX_ASSET_BYTES / 1e6)} MB.`);
    }
    const index = state(siteId);
    const existing = index[slotDef.id] ?? [];
    if (existing.length >= slotDef.max) {
      throw httpError(422, 'slot_full', `"${slotDef.label}" holds at most ${slotDef.max} file(s) — delete one first.`);
    }
    const id = crypto.randomUUID();
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);
    const stored = `${id}-${safeName}`;
    fs.mkdirSync(path.dirname(fileAbs(siteId, slotDef.id, stored)), { recursive: true });
    fs.writeFileSync(fileAbs(siteId, slotDef.id, stored), buffer);
    const meta = {
      id,
      filename: safeName,
      stored,
      bytes: buffer.length,
      type: MIME[ext] ?? 'application/octet-stream',
      // Favicon must land at Next's icon.<ext> convention to take effect.
      target: slotDef.id === 'favicon' ? `src/app/icon.${ext}` : slotDef.target + safeName,
      uploadedAt: new Date().toISOString(),
    };
    index[slotDef.id] = [...existing, meta];
    store.writeJson(indexRel(siteId), index);
    return meta;
  }

  function find(siteId, slotId, assetId) {
    const meta = (state(siteId)[slotId] ?? []).find((a) => a.id === assetId);
    return meta ? { meta, abs: fileAbs(siteId, slotId, meta.stored) } : null;
  }

  function remove(siteId, slotId, assetId) {
    const hit = find(siteId, slotId, assetId);
    if (!hit) return false;
    const index = state(siteId);
    index[slotId] = index[slotId].filter((a) => a.id !== assetId);
    if (!index[slotId].length) delete index[slotId];
    store.writeJson(indexRel(siteId), index);
    fs.rmSync(hit.abs, { force: true });
    return true;
  }

  /** slot → [{filename, target}] — what the assembler slots where. */
  function slotting(siteId) {
    const out = {};
    for (const [slotId, items] of Object.entries(state(siteId))) {
      out[slotId] = items.map((a) => ({ file: a.filename, target: a.target }));
    }
    return out;
  }

  /** Copy every uploaded asset into its target path inside an assembled site. */
  function materialize(siteId, outDir) {
    let count = 0;
    for (const [slotId, items] of Object.entries(state(siteId))) {
      for (const a of items) {
        const dest = path.resolve(outDir, a.target);
        if (!dest.startsWith(path.resolve(outDir) + path.sep)) continue; // guard
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(fileAbs(siteId, slotId, a.stored), dest);
        count += 1;
      }
    }
    return count;
  }

  return { slotsFor, state, add, find, remove, slotting, materialize };
}
