/**
 * Copy generator — turns the customer's FACTS into finished website copy.
 *
 * This is the "done-for-you" core: the operator answers short factual
 * questions (see content.mjs), and the AI writes real, polished copy for every
 * page — no placeholders. It runs on the operator's configured model (the same
 * server-side key as the Studio, via relayChat); when the model is not
 * configured it falls back to a deterministic heuristic that still composes
 * real sentences from the facts, so the pipeline is never blocked and never
 * emits filler.
 *
 * Output is a CONTENT PACK: a stable, validated shape the templates render
 * from. Every field is always present (gaps filled from the facts), so a
 * template can trust it.
 */
import { relayChat, studioConfig, copyModel } from './chat-proxy.mjs';

// House style: NO em-dashes or en-dashes anywhere in the copy. The model is
// told this too, but we scrub as a safety net so none ever ship.
const stripDashes = (s) => s
  .replace(/\s+[—–]\s+/g, ', ') // spaced em/en dash used as punctuation
  .replace(/—/g, ', ')          // any remaining em-dash
  .replace(/–/g, '-')           // remaining en-dash (e.g. number ranges)
  .replace(/\s*,\s*,/g, ',')    // tidy doubled commas
  .replace(/[ \t]{2,}/g, ' ')   // tidy doubled spaces
  .trim();
const str = (v) => (typeof v === 'string' ? stripDashes(v.trim()) : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const strList = (v) => arr(v).map(str).filter(Boolean);
const sentences = (v) => str(v).split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/** Normalize any partial pack (AI or heuristic) into the full guaranteed shape,
 *  filling every gap from the raw facts so templates can trust it. */
export function normalizePack(pack = {}, { siteName, facts = {} } = {}) {
  const p = pack || {};
  const services = strList(facts.services);
  const one = str(facts.whatYouDo);
  const whoYouServe = str(facts.whoYouServe);
  const differentiator = str(facts.differentiator);
  const missionFact = str(facts.mission);
  // Compose the About body from every fact the owner gave, not just aboutFacts,
  // so the About page is substantial even from short answers.
  const aboutParas = [
    ...sentences(facts.aboutFacts),
    whoYouServe ? `We proudly serve ${whoYouServe}.` : '',
    differentiator ? `What sets us apart: ${differentiator}.` : '',
  ].filter(Boolean);

  const home = p.home || {};
  const about = p.about || {};
  const contact = p.contact || {};

  const out = {
    tagline: str(p.tagline) || one || `${siteName}`,
    description: str(p.description) || [one, services.length ? `We offer ${services.join(', ')}.` : '', differentiator ? `${differentiator}.` : ''].filter(Boolean).join(' '),
    home: {
      heroHeadline: str(home.heroHeadline) || one || siteName,
      heroSubhead: str(home.heroSubhead) || (services.length ? `${services.slice(0, 3).join(' · ')}` : one),
      ctaLabel: str(home.ctaLabel) || 'Get in touch',
      introHeading: str(home.introHeading) || `About ${siteName}`,
      introBody: str(home.introBody) || aboutParas[0] || one,
    },
    about: {
      heading: str(about.heading) || `About ${siteName}`,
      paragraphs: (arr(about.paragraphs).map(str).filter(Boolean).length ? arr(about.paragraphs).map(str).filter(Boolean) : aboutParas),
      mission: str(about.mission) || missionFact,
    },
    services: (arr(p.services).length ? arr(p.services) : services.map((s) => ({ name: s, description: '' })))
      .map((s) => ({ name: str(s.name) || str(s), description: str(s.description) })).filter((s) => s.name),
    contact: {
      heading: str(contact.heading) || 'Get in touch',
      intro: str(contact.intro) || `Have a question? Reach ${siteName} using the details below.`,
    },
    faq: (arr(p.faq).length ? arr(p.faq) : strList(facts.faqTopics).map((q) => ({ question: q, answer: '' })))
      .map((f) => ({ question: str(f.question) || str(f), answer: str(f.answer) })).filter((f) => f.question),
    team: (arr(p.team).length ? arr(p.team) : arr(facts.team))
      .map((m) => ({ name: str(m.name), role: str(m.role), bio: str(m.bio) })).filter((m) => m.name),
    careers: null,
    store: null,
    blog: null,
  };

  const roles = arr(p.careers?.roles).length ? arr(p.careers.roles) : arr(facts.roles);
  if (roles.length) {
    out.careers = {
      heading: str(p.careers?.heading) || 'Join our team',
      intro: str(p.careers?.intro) || `${siteName} is hiring. Explore our open roles below.`,
      roles: roles.map((r) => ({ title: str(r.title), summary: str(r.summary) })).filter((r) => r.title),
    };
  }
  const products = arr(p.store?.products).length ? arr(p.store.products) : arr(facts.products);
  if (products.length) {
    out.store = {
      heading: str(p.store?.heading) || 'Shop',
      intro: str(p.store?.intro) || `Browse what ${siteName} offers.`,
      products: products.map((x) => ({ name: str(x.name), price: str(x.price), description: str(x.description) || str(x.note) })).filter((x) => x.name),
    };
  }
  const posts = arr(p.blog?.posts).length ? arr(p.blog.posts) : strList(facts.articleTopics).map((t) => ({ title: t, excerpt: '', body: '' }));
  if (posts.length) {
    out.blog = {
      heading: str(p.blog?.heading) || 'Insights',
      intro: str(p.blog?.intro) || `News and ideas from ${siteName}.`,
      posts: posts.map((x) => ({ title: str(x.title), excerpt: str(x.excerpt), body: str(x.body) })).filter((x) => x.title),
    };
  }
  return out;
}

const SCHEMA_HINT = `Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
  "tagline": "short punchy tagline (max ~8 words)",
  "description": "2-3 sentence summary for the home page and meta description",
  "home": { "heroHeadline": "...", "heroSubhead": "...", "ctaLabel": "e.g. Book a table", "introHeading": "...", "introBody": "one short paragraph" },
  "about": { "heading": "...", "paragraphs": ["para 1", "para 2"], "mission": "one sentence mission" },
  "services": [ { "name": "...", "description": "1-2 sentences" } ],
  "contact": { "heading": "...", "intro": "one inviting sentence" },
  "faq": [ { "question": "...", "answer": "clear 1-2 sentence answer" } ],
  "team": [ { "name": "...", "role": "...", "bio": "one warm sentence" } ],
  "careers": { "heading": "...", "intro": "...", "roles": [ { "title": "...", "summary": "2-3 sentences" } ] },
  "store": { "heading": "...", "intro": "...", "products": [ { "name": "...", "price": "...", "description": "1-2 sentences" } ] },
  "blog": { "heading": "...", "intro": "...", "posts": [ { "title": "...", "excerpt": "1 sentence", "body": "2-3 short paragraphs" } ] }
}
Omit careers/store/blog entirely if no facts were given for them. Write real, specific, professional copy grounded ONLY in the facts provided; never invent contact details, prices, or claims. No lorem, no "replace this", no bracketed placeholders. IMPORTANT STYLE RULE: never use em-dashes (—) or en-dashes (–). Use commas, periods, or the word "to" for ranges (e.g. "9 to 5").`;

function extractJson(text) {
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  return JSON.parse(t);
}

/** The exact copywriter prompt for one site — shared by the interactive path
 *  (aiPack below) and Batch Building's batched copy requests. */
export function copyPromptFor({ siteName, facts = {}, modules = [] }) {
  return {
    system: `You are a senior website copywriter. Write finished, ready-to-publish copy for a small business website. ${SCHEMA_HINT}`,
    user: `Business name: ${siteName}\nSelected feature pages: ${(modules || []).join(', ') || 'none beyond home/about/contact'}\n\nFacts provided by the owner:\n${JSON.stringify(facts, null, 2)}`,
  };
}

/** A model's copy response → a complete normalized pack. Malformed output
 *  degrades to the deterministic heuristic pack — copy never fails a build. */
export function packFromText(text, { siteName, facts = {} } = {}) {
  try {
    return normalizePack(extractJson(text), { siteName, facts });
  } catch {
    return normalizePack({}, { siteName, facts });
  }
}

async function aiPack({ siteName, facts, modules }) {
  const { system, user } = copyPromptFor({ siteName, facts, modules });
  // The copywriter runs on a lighter model than the Studio's template generator.
  const { content, model, tokens } = await relayChat({ system, messages: [{ role: 'user', content: user }], model: copyModel() });
  return { raw: extractJson(content), model, tokens };
}

/**
 * Generate the content pack for a site. Always returns a complete pack.
 * @returns {{ pack, source:'ai'|'heuristic', model?, tokens }}
 */
export async function generateCopy({ siteName, facts = {}, modules = [] }) {
  if (studioConfig().configured) {
    try {
      const { raw, model, tokens } = await aiPack({ siteName, facts, modules });
      return { pack: normalizePack(raw, { siteName, facts }), source: 'ai', model, tokens };
    } catch {
      // fall through to the heuristic — never block a build on the model
    }
  }
  return { pack: normalizePack({}, { siteName, facts }), source: 'heuristic', tokens: 0 };
}
