/**
 * Hero image generation. When a site has no uploaded hero image, we generate
 * one from the business facts using the operator's image model, so the home
 * page still opens on real, on-brand imagery instead of only the template's
 * designed fallback.
 *
 * Uses the operator's OpenAI key (STARDRIVE_LLM_KEY) via the Images API.
 * Degrades to null on any failure (missing key, wrong provider, API error) so
 * the build always continues and the template's designed hero shows instead.
 *
 * Env: STARDRIVE_IMAGE_MODEL (default gpt-image-1), STARDRIVE_LLM_KEY,
 *      STARDRIVE_LLM_PROVIDER (must be openai for image generation).
 */

const TIMEOUT_MS = 90_000;

function heroPrompt({ siteName, facts = {}, vibe = '' }) {
  const what = String(facts.whatYouDo || facts.aboutFacts || '').trim();
  const services = Array.isArray(facts.services) ? facts.services.slice(0, 3).join(', ') : '';
  const bits = [
    `A wide, high-quality photographic hero banner for the website of ${siteName || 'a small business'}.`,
    what && `The business: ${what}`,
    services && `Featured offerings: ${services}.`,
    vibe && `Overall mood: ${vibe}.`,
    'Cinematic, professional, warm natural light, real-world scene, tasteful depth of field.',
    'Absolutely no text, no words, no letters, no logos, no watermarks, no UI.',
    'Balanced composition that leaves clean, uncluttered space for a headline to be overlaid.',
  ].filter(Boolean);
  return bits.join(' ');
}

/**
 * Generate a hero image. Returns { buffer, ext, model, prompt } or null.
 */
export async function generateHeroImage({ siteName, facts, vibe } = {}) {
  const key = process.env.STARDRIVE_LLM_KEY;
  const provider = process.env.STARDRIVE_LLM_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
  if (!key || provider !== 'openai') return null; // image gen is OpenAI-only

  const model = process.env.STARDRIVE_IMAGE_MODEL || 'gpt-image-1';
  const base = String(process.env.STARDRIVE_LLM_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
  const prompt = heroPrompt({ siteName, facts, vibe });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/v1/images/generations`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1536x1024', n: 1 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return null;
    return { buffer: Buffer.from(b64, 'base64'), ext: 'png', model, prompt };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
