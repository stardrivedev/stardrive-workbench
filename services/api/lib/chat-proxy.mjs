/**
 * The Template Studio's model relay — server-side key.
 *
 * Stardrive (the operator) supplies ONE model-provider key via env; it lives
 * only on the server, is never sent to the browser, never logged, and never
 * returned in a response. Customers just describe the template they want —
 * template generation is an INCLUDED feature, metered per account so it can
 * be priced. (Customers bring their own HOSTING keys — Turso/Vercel/GitHub —
 * through Connections; they never bring a model key.)
 *
 * Configuration (all optional except the key, which gates the feature):
 *   STARDRIVE_LLM_KEY        the provider secret (unset → Studio is dormant)
 *   STARDRIVE_LLM_PROVIDER   "anthropic" (default) | "openai"
 *   STARDRIVE_LLM_MODEL      model id (defaults per provider)
 *   STARDRIVE_LLM_BASE_URL   override host (OpenAI-compatible endpoints)
 *   STARDRIVE_LLM_MAX_TOKENS integer cap (default 16000)
 */

const TIMEOUT_MS = 300_000; // template generations are long
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

const DEFAULT_MODEL = { anthropic: 'claude-sonnet-5', openai: 'gpt-4o' };

/** Public, secret-free view of how the Studio is configured (for the UI). */
export function studioConfig() {
  const provider = process.env.STARDRIVE_LLM_PROVIDER === 'openai' ? 'openai' : 'anthropic';
  return {
    configured: Boolean(process.env.STARDRIVE_LLM_KEY),
    provider,
    model: process.env.STARDRIVE_LLM_MODEL || DEFAULT_MODEL[provider],
  };
}

function tokensOf(usage) {
  if (!usage) return 0;
  if (typeof usage.total_tokens === 'number') return usage.total_tokens; // OpenAI
  return (usage.input_tokens || 0) + (usage.output_tokens || 0); // Anthropic
}

/**
 * Run one chat turn against the OPERATOR's configured model.
 * Input is only { system, messages } — no key ever comes from the caller.
 */
export async function relayChat({ system, messages } = {}) {
  const key = process.env.STARDRIVE_LLM_KEY;
  if (!key) {
    throw httpError(501, 'studio_unconfigured',
      'The Template Studio is not enabled yet — its model is not configured. It turns on the moment the operator sets STARDRIVE_LLM_KEY; no key of yours is ever required.');
  }
  if (!Array.isArray(messages) || messages.length === 0 ||
      !messages.every((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')) {
    throw httpError(400, 'bad_request', 'messages must be a non-empty array of { role: "user"|"assistant", content }.');
  }

  const { provider, model } = studioConfig();
  const maxTokens = Number(process.env.STARDRIVE_LLM_MAX_TOKENS) || 16000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (provider === 'openai') {
      const base = String(process.env.STARDRIVE_LLM_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(502, 'provider_error', data?.error?.message || `Model provider returned ${res.status}.`);
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw httpError(502, 'provider_error', 'Model response had no message content.');
      return { content, model: data.model ?? model, tokens: tokensOf(data.usage) };
    }

    // Anthropic.
    const base = String(process.env.STARDRIVE_LLM_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, ...(system ? { system } : {}), messages }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(502, 'provider_error', data?.error?.message || `Model provider returned ${res.status}.`);
    const content = (data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!content) throw httpError(502, 'provider_error', 'Model response had no text content.');
    return { content, model: data.model ?? model, tokens: tokensOf(data.usage) };
  } catch (err) {
    if (err.name === 'AbortError') throw httpError(504, 'provider_timeout', 'The model took longer than 5 minutes.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
