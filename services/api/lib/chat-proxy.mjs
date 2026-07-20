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
 *   STARDRIVE_LLM_PROVIDER   "openai" (default; ChatGPT 5.6 Sol) | "anthropic"
 *   STARDRIVE_LLM_MODEL      model id (defaults: gpt-5.6-sol / claude-sonnet-5)
 *   STARDRIVE_LLM_BASE_URL   override host (OpenAI-compatible endpoints)
 *   STARDRIVE_LLM_MAX_TOKENS integer cap (default 16000)
 */

const TIMEOUT_MS = 300_000; // template generations are long
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

const DEFAULT_MODEL = { anthropic: 'claude-sonnet-5', openai: 'gpt-5.6-sol' };

/** Public, secret-free view of how the Studio is configured (for the UI). */
export function studioConfig() {
  // Operator decision (2026-07-20): OpenAI is the default provider; the
  // Studio runs on ChatGPT 5.6 Sol unless env overrides.
  const provider = process.env.STARDRIVE_LLM_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
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
  // Validate input shape + enforce fair-use caps FIRST — an abusive request
  // is rejected before we reveal config state or spend any model budget.
  if (!Array.isArray(messages) || messages.length === 0 ||
      !messages.every((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')) {
    throw httpError(400, 'bad_request', 'messages must be a non-empty array of { role: "user"|"assistant", content }.');
  }
  const maxTurns = Number(process.env.STARDRIVE_LLM_MAX_TURNS) || 40;
  const maxInputChars = Number(process.env.STARDRIVE_LLM_MAX_INPUT_CHARS) || 300_000; // ~75k tokens
  if (messages.length > maxTurns) {
    throw httpError(413, 'conversation_too_long', `This conversation is too long (${messages.length} turns; max ${maxTurns}). Start a fresh chat for a new template.`);
  }
  const inputChars = (system ? system.length : 0) + messages.reduce((n, m) => n + m.content.length, 0);
  if (inputChars > maxInputChars) {
    throw httpError(413, 'input_too_large', `This request is too large (${Math.round(inputChars / 1000)}k chars; max ${Math.round(maxInputChars / 1000)}k). Trim the conversation or start fresh.`);
  }

  const key = process.env.STARDRIVE_LLM_KEY;
  if (!key) {
    throw httpError(501, 'studio_unconfigured',
      'The Template Studio is not enabled yet — its model is not configured. It turns on the moment the operator sets STARDRIVE_LLM_KEY; no key of yours is ever required.');
  }

  const { provider, model } = studioConfig();
  // Templates are long, and reasoning models spend part of the budget
  // thinking before writing — an undersized cap yields "no text" errors.
  const maxTokens = Number(process.env.STARDRIVE_LLM_MAX_TOKENS) || 48000;
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
          // Modern OpenAI models reject the legacy max_tokens parameter.
          max_completion_tokens: maxTokens,
          messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(502, 'provider_error', data?.error?.message || `Model provider returned ${res.status}.`);
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || !content.length) {
        const why = choice?.message?.refusal ? `refusal: ${choice.message.refusal}`
          : choice?.finish_reason ? `finish_reason: ${choice.finish_reason} — if "length", raise STARDRIVE_LLM_MAX_TOKENS`
          : 'no choices returned';
        throw httpError(502, 'provider_error', `Model returned no text (${why}).`);
      }
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
    if (!content) {
      const kinds = (data?.content ?? []).map((b) => b.type).join(',') || 'empty';
      throw httpError(502, 'provider_error', `Model returned no text (stop: ${data?.stop_reason || '?'}; blocks: ${kinds}) — if "max_tokens", raise STARDRIVE_LLM_MAX_TOKENS.`);
    }
    return { content, model: data.model ?? model, tokens: tokensOf(data.usage) };
  } catch (err) {
    if (err.name === 'AbortError') throw httpError(504, 'provider_timeout', 'The model took longer than 5 minutes.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
