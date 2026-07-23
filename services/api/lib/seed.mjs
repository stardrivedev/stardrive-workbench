/**
 * Feature-module seeds: turn the AI content pack (copy-gen) into the initial
 * rows for each feature module's CMS collection, so a freshly built site's
 * feature pages (careers, catalog, insights) open with real content instead of
 * an empty state. Each module ships an empty `src/config/<mod>.generated.ts`
 * default (so it compiles standalone) and reads it as the `readCollection`
 * fallback; Stardrive overwrites that file at assembly with these seeds. The
 * DB always wins once the owner edits in /admin — this is only the starting point.
 *
 * Deterministic: the same pack in yields the same rows out (ids are slugs of the
 * title, de-duplicated), so a rebuild never churns the seed.
 */

const today = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function slugify(s, i) {
  const base = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || `item-${i + 1}`;
}

/** Make a list of ids unique (append -2, -3, … on collision). */
function uniqueIds(ids) {
  const seen = new Map();
  return ids.map((id) => {
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}-${n}`;
  });
}

/** pack.careers.roles [{title, summary}] → Job[] */
export function seedJobsFromPack(pack, { date = today() } = {}) {
  const roles = (pack?.careers?.roles || []).filter((r) => r && String(r.title || '').trim());
  const ids = uniqueIds(roles.map((r, i) => slugify(r.title, i)));
  return roles.map((r, i) => ({
    id: ids[i],
    title: String(r.title).trim(),
    type: 'Full-Time',
    location: '',
    description: String(r.summary || '').trim(),
    requirements: [],
    postedAt: date,
  }));
}

/** pack.store.products [{name, price, description}] → { products: Product[], categories: CatalogCategory[] } */
export function seedCatalogFromPack(pack) {
  const items = (pack?.store?.products || []).filter((p) => p && String(p.name || '').trim());
  if (!items.length) return { products: [], categories: [] };
  const categories = [{ id: 'all', label: 'Products', description: '' }];
  const ids = uniqueIds(items.map((p, i) => slugify(p.name, i)));
  const products = items.map((p, i) => ({
    id: ids[i],
    title: String(p.name).trim(),
    category: 'all',
    description: String(p.description || '').trim(),
    specs: String(p.price || '').trim() ? [{ label: 'Price', value: String(p.price).trim() }] : [],
  }));
  return { products, categories };
}

/** pack.blog.posts [{title, excerpt, body}] → Article[] */
export function seedArticlesFromPack(pack, { date = today() } = {}) {
  const posts = (pack?.blog?.posts || []).filter((p) => p && String(p.title || '').trim());
  const ids = uniqueIds(posts.map((p, i) => slugify(p.title, i)));
  return posts.map((p, i) => ({
    id: ids[i],
    title: String(p.title).trim(),
    subtitle: String(p.excerpt || '').trim(),
    date,
    body: String(p.body || '').trim(),
    tags: [],
  }));
}

const banner = `/**
 * GENERATED FILE. Written by Stardrive at assembly from the AI-written content,
 * the initial rows this feature page opens with. Edits in /admin override these
 * (a saved collection wins). Do not edit by hand; overwritten on reassembly.
 */`;

/** The `src/config/careers.generated.ts` source for a site. */
export function renderCareersSeed(pack) {
  const jobs = seedJobsFromPack(pack);
  return `${banner}\nimport type { Job } from "@/modules/careers/types";\n\nexport const seedJobs: Job[] = ${JSON.stringify(jobs, null, 2)};\n`;
}

/** The `src/config/catalog.generated.ts` source for a site. */
export function renderCatalogSeed(pack) {
  const { products, categories } = seedCatalogFromPack(pack);
  return `${banner}\nimport type { Product, CatalogCategory } from "@/modules/catalog/types";\n\nexport const seedCategories: CatalogCategory[] = ${JSON.stringify(categories, null, 2)};\n\nexport const seedProducts: Product[] = ${JSON.stringify(products, null, 2)};\n`;
}

/** The `src/config/insights.generated.ts` source for a site. */
export function renderInsightsSeed(pack) {
  const articles = seedArticlesFromPack(pack);
  return `${banner}\nimport type { Article } from "@/modules/insights/types";\n\nexport const seedArticles: Article[] = ${JSON.stringify(articles, null, 2)};\n`;
}

/** Which module → which generated seed file + renderer. */
export const MODULE_SEEDS = {
  'd4-careers-portal': { file: 'src/config/careers.generated.ts', render: renderCareersSeed },
  'd4-catalog': { file: 'src/config/catalog.generated.ts', render: renderCatalogSeed },
  'd4-insights-blog': { file: 'src/config/insights.generated.ts', render: renderInsightsSeed },
};
