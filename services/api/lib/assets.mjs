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
 * so account scoping is inherited from loadSite(). One exception by design:
 * a Batch Building draft row stages its photos under the ROW id before any
 * site exists (scoped by the account's draft) and `adopt()` moves them onto
 * the real site id at creation.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ASSET_EXTS } from '../../../packages/template-kit/index.mjs';

export const MAX_ASSET_BYTES = 8_000_000;

export const STANDARD_SLOTS = [
  { id: 'logo', label: 'Logo', description: 'Primary logo. SVG or transparent PNG works best.', accept: ['svg', 'png', 'webp'], max: 1, target: 'public/assets/brand/' },
  { id: 'favicon', label: 'Favicon', description: 'Browser-tab icon. Square; ICO, PNG, or SVG.', accept: ['ico', 'png', 'svg'], max: 1, target: 'src/app/' },
  { id: 'hero', label: 'Home hero background', description: 'One image that sits behind your home page hero text. Leave blank to keep the designed hero.', accept: ['jpg', 'jpeg', 'png', 'webp'], max: 1, target: 'public/assets/hero/' },
  { id: 'about', label: 'About / story photos', description: 'Photos for the about page.', accept: ['jpg', 'jpeg', 'png', 'webp'], max: 6, target: 'public/assets/about/' },
  { id: 'gallery', label: 'Gallery', description: 'Portfolio or product shots.', accept: ['jpg', 'jpeg', 'png', 'webp', 'gif'], max: 24, target: 'public/assets/gallery/' },
  { id: 'team', label: 'Team photos', description: 'Headshots and team imagery.', accept: ['jpg', 'jpeg', 'png', 'webp'], max: 12, target: 'public/assets/team/' },
  { id: 'misc', label: 'Everything else', description: 'Any other imagery the site should have on hand.', accept: [...ASSET_EXTS], max: 12, target: 'public/assets/misc/' },
];

// Optional per-page hero backgrounds (one image behind each page's header),
// offered only for the pages a site has. `module: null` means the page always
// exists (about/contact); otherwise the page comes from that feature module.
const PAGE_HEROES = [
  { id: 'hero-about', label: 'About hero background', module: null },
  { id: 'hero-contact', label: 'Contact hero background', module: null },
  { id: 'hero-gallery', label: 'Gallery hero background', module: 'd4-gallery-editor' },
  { id: 'hero-careers', label: 'Careers hero background', module: 'd4-careers-portal' },
  { id: 'hero-catalog', label: 'Catalog hero background', module: 'd4-catalog' },
  { id: 'hero-insights', label: 'Insights hero background', module: 'd4-insights-blog' },
];

function pageHeroSlots(modules = []) {
  const set = new Set(modules || []);
  return PAGE_HEROES.filter((h) => !h.module || set.has(h.module)).map((h) => ({
    id: h.id,
    label: h.label,
    description: "Optional image behind this page's header. Leave blank to keep the designed header.",
    accept: ['jpg', 'jpeg', 'png', 'webp'],
    max: 1,
    target: `public/assets/${h.id}/`,
  }));
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  svg: 'image/svg+xml', gif: 'image/gif', ico: 'image/x-icon',
};

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

export function createAssets(store) {
  const indexRel = (siteId) => `assets/${siteId}/index.json`;
  const fileAbs = (siteId, slot, stored) => store.path('assets', siteId, slot, stored);

  /**
   * Standard slots + per-page hero backgrounds (for the pages this site has) +
   * the template's declared extras. Every page can take one optional background
   * image behind its designed header; pages with none keep the designed header.
   */
  function slotsFor(manifest, modules = []) {
    const extras = (manifest?.assetSlots ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description ?? 'Declared by this template.',
      accept: s.accept ?? [...ASSET_EXTS],
      max: s.max ?? 12,
      target: `public/assets/${s.id}/`,
      declaredBy: manifest.name,
    }));
    // Per-page hero backgrounds, inserted right after the home hero slot so all
    // heroes read together. Offered for the pages the site actually has.
    const heroIdx = STANDARD_SLOTS.findIndex((s) => s.id === 'hero');
    const heroes = pageHeroSlots(modules);
    const standard = [
      ...STANDARD_SLOTS.slice(0, heroIdx + 1),
      ...heroes,
      ...STANDARD_SLOTS.slice(heroIdx + 1),
    ];
    return [...standard, ...extras];
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

  /**
   * Move one bucket's uploads onto another id, merging into whatever is
   * already there. Batch Building stages a draft row's photos under the ROW's
   * id (the site does not exist until the provider returns), then adopts them
   * onto the real site id the moment it is created, so an overnight build
   * ships the client's real images on its very first assembly.
   */
  function adopt(fromId, toId) {
    const staged = state(fromId);
    if (!Object.keys(staged).length) return 0;
    const target = state(toId);
    let moved = 0;
    for (const [slotId, items] of Object.entries(staged)) {
      const kept = [];
      for (const a of items) {
        const src = fileAbs(fromId, slotId, a.stored);
        if (!fs.existsSync(src)) continue;
        const dest = fileAbs(toId, slotId, a.stored);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(src, dest);
        kept.push(a);
        moved += 1;
      }
      if (kept.length) target[slotId] = [...(target[slotId] ?? []), ...kept];
    }
    store.writeJson(indexRel(toId), target);
    discard(fromId);
    return moved;
  }

  /** Drop a whole bucket (a staging row was removed, or a draft was submitted). */
  function discard(id) {
    fs.rmSync(store.path('assets', id), { recursive: true, force: true });
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

  return { slotsFor, state, add, find, remove, adopt, discard, slotting, materialize };
}
