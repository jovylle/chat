// Chat Assistant Box — AI proxy (Netlify Functions v2, streaming)
//
// Every supported provider exposes an OpenAI-compatible /chat/completions
// endpoint with SSE streaming, so the whole backend is one OpenAI-SDK client
// factory parameterized by { baseURL, apiKey }. No provider is special-cased.
import OpenAI from 'openai';

// Provider registry: base URL + which env var holds the server-side key.
const PROVIDERS = {
  openai:   { baseURL: 'https://api.openai.com/v1',                                   apiKeyEnv: 'MY_OPENAI_API' },
  gemini:   { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',    apiKeyEnv: 'MY_GEMINI_API' },
  deepseek: { baseURL: 'https://api.deepseek.com',                                    apiKeyEnv: 'MY_DEEPSEEK_API' },
  qwen:     { baseURL: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',        apiKeyEnv: 'MY_QWEN_API' },
  glm:      { baseURL: 'https://api.z.ai/api/paas/v4/',                               apiKeyEnv: 'MY_GLM_API' },
};

// Model registry (mirrors the frontend MODELS list). Maps slug -> provider so
// routing keys off the model, never off a client-supplied provider string.
const MODELS = {
  'gpt-4o-mini':       'openai',
  'gemini-2.5-flash':  'gemini',
  'deepseek-v4-flash': 'deepseek',
  'qwen-flash':        'qwen',
  'glm-4.6':           'glm',
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
const corsHeaders = {
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

function getClient(provider, customKey) {
  const cfg = PROVIDERS[provider];
  if (!cfg) return null;
  const apiKey = customKey || process.env[cfg.apiKeyEnv];
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: cfg.baseURL });
}

function friendlyError(error) {
  if (error?.code === 'insufficient_quota') return 'API quota exceeded. Please try again later.';
  if (error?.code === 'rate_limit_exceeded' || error?.status === 429) return 'Rate limit exceeded. Please wait a moment and try again.';
  if (error?.status === 401) return 'API key was rejected. Check your key configuration.';
  return "Sorry, I'm having trouble processing your request. Please try again.";
}

function errorStatus(error) {
  if (error?.code === 'insufficient_quota' || error?.code === 'rate_limit_exceeded') return 429;
  if (typeof error?.status === 'number') return error.status;
  return 500;
}

export default async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: corsHeaders });
  }

  // Availability probe: tells the frontend which providers have a server key
  // configured, so it can hide/disable unavailable models in the dropdown.
  if (req.method === 'GET') {
    const providers = {};
    for (const [name, cfg] of Object.entries(PROVIDERS)) {
      providers[name] = !!process.env[cfg.apiKeyEnv];
    }
    return jsonResponse(200, { providers });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method Not Allowed' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { message, history = [], customApiKey, provider: bodyProvider, model, systemPrompt } = body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return jsonResponse(400, { error: 'Message is required and must be a non-empty string' });
  }
  if (!Array.isArray(history)) {
    return jsonResponse(400, { error: 'History must be an array' });
  }

  // Generous input guard (message + history).
  const totalChars = message.length + history.reduce((n, m) => n + ((m && typeof m.content === 'string') ? m.content.length : 0), 0);
  if (totalChars > MAX_INPUT_CHARS) {
    return jsonResponse(413, { error: 'Message is too long. Please shorten it or start a new conversation.' });
  }

  const selectedModel = model || DEFAULT_MODEL;
  // Custom-key requests trust the client-selected provider; proxy requests
  // resolve the provider from the model registry.
  const provider = customApiKey ? (bodyProvider || MODELS[selectedModel]) : (MODELS[selectedModel] || bodyProvider);

  if (!provider || !PROVIDERS[provider]) {
    return jsonResponse(400, { error: `Unsupported model or provider for "${selectedModel}".` });
  }

  const client = getClient(provider, customApiKey);
  if (!client) {
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
    upstream = await client.chat.completions.create(
      {
        model: selectedModel,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        messages,
        stream: true,
      },
      { signal: abortController.signal }
    );
  } catch (error) {
    console.error('Chat upstream error:', error?.message || error);
    return jsonResponse(errorStatus(error), { error: friendlyError(error) });
  }

  const encoder = new TextEncoder();

  // Re-emit a simple SSE protocol: {"delta":"..."} tokens, an optional
  // {"error":"..."}, then [DONE]. The SDK already parses each provider's SSE,
  // so this is provider-agnostic.
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of upstream) {
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (delta) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error('Chat stream error:', error?.message || error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: friendlyError(error) })}\n\n`));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
};
