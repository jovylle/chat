// Chat Assistant Box — AI proxy (Cloudflare Worker, streaming)
//
// Every supported provider exposes an OpenAI-compatible /chat/completions
// endpoint with SSE streaming. Instead of an SDK, the Worker calls each
// provider with plain `fetch` and passes the upstream OpenAI-format SSE
// through to the client *unchanged*. A `ReadableStream.tee()` splits the body:
// one branch streams to the client, the other is accumulated so a persistence
// hook can save the assistant message (used from Phase 3 for logged-in users).
// Net result: zero runtime deps in the Worker.

// Provider registry: base URL + which secret holds the server-side key.
export const PROVIDERS = {
  openai:   { baseURL: 'https://api.openai.com/v1',                                apiKeyEnv: 'MY_OPENAI_API' },
  gemini:   { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'MY_GEMINI_API' },
  deepseek: { baseURL: 'https://api.deepseek.com',                                 apiKeyEnv: 'MY_DEEPSEEK_API' },
  qwen:     { baseURL: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',     apiKeyEnv: 'MY_QWEN_API' },
  glm:      { baseURL: 'https://api.z.ai/api/paas/v4',                             apiKeyEnv: 'MY_GLM_API' },
};

// Model registry (mirrors the frontend MODELS list). Maps slug -> provider so
// routing keys off the model, never off a client-supplied provider string.
// `vision` marks models that accept image_url content parts (Phase 4).
export const MODELS = {
  'gpt-4o-mini':       { provider: 'openai',   vision: true  },
  'gemini-2.5-flash':  { provider: 'gemini',   vision: true  },
  'deepseek-v4-flash': { provider: 'deepseek', vision: false },
  'qwen-flash':        { provider: 'qwen',     vision: false },
  'glm-4.6':           { provider: 'glm',      vision: false },
};

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.7;
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful chat assistant.';
// Generous input guard — blocks obviously abusive payloads, not normal use.
// Real spend safety lives in each provider's dashboard cap (the user's keys).
const MAX_INPUT_CHARS = 50000;

// CORS is intentionally wide open (`*`): this is a public proxy the site calls
// from its own origin (incl. the Android TWA and legacy redirect hosts).
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
};

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Build the OpenAI-compatible completions URL, tolerant of a trailing slash.
function completionsUrl(baseURL) {
  return baseURL.replace(/\/+$/, '') + '/chat/completions';
}

function friendlyError(status, code) {
  if (code === 'insufficient_quota') return 'API quota exceeded. Please try again later.';
  if (code === 'rate_limit_exceeded' || status === 429) return 'Rate limit exceeded. Please wait a moment and try again.';
  if (status === 401) return 'API key was rejected. Check your key configuration.';
  return "Sorry, I'm having trouble processing your request. Please try again.";
}

function providerAvailability(env) {
  const providers = {};
  for (const [name, cfg] of Object.entries(PROVIDERS)) {
    providers[name] = !!env[cfg.apiKeyEnv];
  }
  return providers;
}

// GET /api/models — availability probe: which providers have a server key set.
export function handleModels(env) {
  return jsonResponse(200, { providers: providerAvailability(env) });
}

// POST /api/chat — proxy a streaming completion.
//
// `persist` is an optional async hook: `persist({ userMessage, model, provider,
// getAssistantText })` where `getAssistantText()` resolves to the full
// accumulated assistant reply once the upstream stream ends. It runs via
// ctx.waitUntil so it never blocks the client stream. No-op before Phase 3.
export async function handleChat(req, env, ctx, persist) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { message, history = [], customApiKey, provider: bodyProvider, model, systemPrompt, conversationId } = body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return jsonResponse(400, { error: 'Message is required and must be a non-empty string' });
  }
  if (!Array.isArray(history)) {
    return jsonResponse(400, { error: 'History must be an array' });
  }

  // Generous input guard (message + history). Content may be a string or an
  // array of OpenAI content parts (vision); only count text length.
  const contentLen = (c) => {
    if (typeof c === 'string') return c.length;
    if (Array.isArray(c)) return c.reduce((n, p) => n + (typeof p?.text === 'string' ? p.text.length : 0), 0);
    return 0;
  };
  const totalChars = message.length + history.reduce((n, m) => n + (m ? contentLen(m.content) : 0), 0);
  if (totalChars > MAX_INPUT_CHARS) {
    return jsonResponse(413, { error: 'Message is too long. Please shorten it or start a new conversation.' });
  }

  const selectedModel = model || DEFAULT_MODEL;
  // Custom-key requests trust the client-selected provider; proxy requests
  // resolve the provider from the model registry.
  const provider = customApiKey
    ? (bodyProvider || MODELS[selectedModel]?.provider)
    : (MODELS[selectedModel]?.provider || bodyProvider);

  if (!provider || !PROVIDERS[provider]) {
    return jsonResponse(400, { error: `Unsupported model or provider for "${selectedModel}".` });
  }

  const cfg = PROVIDERS[provider];
  const apiKey = customApiKey || env[cfg.apiKeyEnv];
  if (!apiKey) {
    return jsonResponse(500, { error: `The ${provider} API key is not configured.` });
  }

  const messages = [
    { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message.trim() },
  ];

  // Forward client aborts (Stop button) to the upstream request.
  const abortController = new AbortController();
  if (req.signal) {
    if (req.signal.aborted) abortController.abort();
    else req.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  }

  let upstream;
  try {
    upstream = await fetch(completionsUrl(cfg.baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        messages,
        stream: true,
      }),
      signal: abortController.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') return new Response(null, { status: 499 });
    console.error('Chat upstream error:', error?.message || error);
    return jsonResponse(500, { error: friendlyError(500) });
  }

  if (!upstream.ok || !upstream.body) {
    // Surface the provider error as a friendly message, extracting its code.
    let code = null;
    try {
      const errBody = await upstream.json();
      code = errBody?.error?.code || errBody?.error?.type || null;
    } catch { /* non-JSON error body */ }
    const status = upstream.status === 429 ? 429 : upstream.status;
    return jsonResponse(status, { error: friendlyError(upstream.status, code) });
  }

  // tee() the upstream body: one branch to the client verbatim, one accumulated
  // for the persistence hook. The accumulate branch runs in waitUntil so it
  // never delays or blocks the client stream.
  const [clientBranch, persistBranch] = upstream.body.tee();

  if (persist && ctx) {
    ctx.waitUntil(
      accumulateAssistantText(persistBranch)
        .then((assistantText) =>
          persist({
            userMessage: message.trim(),
            model: selectedModel,
            provider,
            assistantText,
            conversationId,
          })
        )
        .catch((e) => console.error('Persist hook error:', e?.message || e))
    );
  } else {
    // No persistence: drain the second branch so it doesn't apply backpressure.
    persistBranch.cancel().catch(() => {});
  }

  return new Response(clientBranch, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}

// Read an OpenAI-format SSE stream to completion, concatenating delta content
// into the full assistant reply text.
async function accumulateAssistantText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const rawLine of rawEvent.split('\n')) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
            if (delta) full += delta;
          } catch { /* ignore keep-alive / non-JSON lines */ }
        }
      }
    }
  } catch { /* upstream aborted or errored mid-stream; keep partial text */ }
  return full;
}

// Server-side port of the frontend generateTitle (used from Phase 3).
export function generateTitle(firstMessage) {
  const title = String(firstMessage || '').substring(0, 40).trim();
  return title.length < String(firstMessage || '').length ? title + '...' : title;
}
