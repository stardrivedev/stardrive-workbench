/**
 * BYO-key chat relay for the Workbench's Template Studio.
 *
 * The licensee brings their OWN model-provider API key (OpenAI-compatible or
 * Anthropic); this endpoint relays one chat turn server-side so the browser
 * never fights CORS and the provider key never needs to be stored anywhere —
 * it lives in the caller's browser and travels only inside each request.
 * Stardrive never logs it, never persists it, and never bills for it: model
 * usage is between the licensee and their provider.
 */

const TIMEOUT_MS = 300_000; // template generations are long

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

export async function relayChat(body) {
  const { provider, apiKey, model, system, messages, baseUrl, maxTokens } = body ?? {};
  if (provider !== 'openai' && provider !== 'anthropic') {
    throw httpError(400, 'bad_request', 'provider must be "openai" (any OpenAI-compatible endpoint) or "anthropic".');
  }
  if (typeof apiKey !== 'string' || apiKey.length < 8) {
    throw httpError(400, 'bad_request', 'apiKey is required (your own provider key; it is relayed, never stored).');
  }
  if (!Array.isArray(messages) || messages.length === 0 ||
      !messages.every((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')) {
    throw httpError(400, 'bad_request', 'messages must be a non-empty array of { role: "user"|"assistant", content }.');
  }
  if (baseUrl !== undefined && !/^https?:\/\//.test(String(baseUrl))) {
    throw httpError(400, 'bad_request', 'baseUrl must be an http(s) URL when provided.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (provider === 'openai') {
      const url = `${String(baseUrl || 'https://api.openai.com').replace(/\/$/, '')}/v1/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || 'gpt-4o',
          messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
          ...(maxTokens ? { max_tokens: Number(maxTokens) } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw httpError(502, 'provider_error', data?.error?.message || `Provider returned ${res.status}.`);
      }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw httpError(502, 'provider_error', 'Provider response had no message content.');
      return { content, model: data.model ?? model ?? 'gpt-4o', usage: data.usage ?? null };
    }

    // Anthropic.
    const url = `${String(baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-5',
        max_tokens: Number(maxTokens) || 16000,
        ...(system ? { system } : {}),
        messages,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw httpError(502, 'provider_error', data?.error?.message || `Provider returned ${res.status}.`);
    }
    const content = (data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!content) throw httpError(502, 'provider_error', 'Provider response had no text content.');
    return { content, model: data.model ?? model ?? 'claude-sonnet-5', usage: data.usage ?? null };
  } catch (err) {
    if (err.name === 'AbortError') throw httpError(504, 'provider_timeout', 'The provider took longer than 5 minutes.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
