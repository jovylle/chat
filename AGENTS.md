# Chat Assistant Box — Agent Guide

> AI-readable codebase guide for any agent (Claude, GPT, Gemini, Copilot, etc.).
> Keep this file up to date when adding features or changing conventions.

## What this project is

**Chat Assistant Box** is a multi-turn AI chat web app hosted at [https://chat.uft1.com](https://chat.uft1.com).

- Static frontend (vanilla JS/HTML/CSS) served from `public/`
- One serverless Netlify function (`netlify/functions/chat.mjs`) that proxies to any
  OpenAI-compatible provider with **streaming** responses
- PWA-ready (manifest + service worker) with a Google Play Android TWA (AAB in `releases/`)

No framework. No build step. No bundler. What's in `public/` is what ships. All app
logic is inlined in `public/index.html` (~3,400 lines).

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML5, CSS (no framework, all inline in `index.html`) |
| Markdown rendering | `marked.js` (lazy-loaded from CDN on first message) |
| Syntax highlighting | `prism.js` (local, `public/prism.js` + `public/prism.css`) |
| Icons | Font Awesome 6.5 (CDN, loaded non-blocking) |
| Backend | Netlify Functions **v2** (ESM, streaming, Node 18) |
| AI providers | OpenAI SDK `^4` (one client factory, every provider is OpenAI-compatible) |
| Hosting | Netlify (static + functions) |
| Mobile | PWA → Android TWA via PWA Builder / Bubblewrap |

---

## Project structure

```
chat/
├── AGENTS.md                  # this file
├── README.md                  # user-facing overview
├── CONTRIBUTING.md            # local dev + how to add a model/provider
├── CHANGELOG.md               # release history
├── .env.example               # required env vars
├── package.json               # Node deps (openai, express, uuid)
├── netlify.toml               # Netlify build, redirects, cache headers, function config
├── twa-manifest.json          # Trusted Web Activity manifest for Android build
├── public/                    # Static frontend (publish dir)
│   ├── index.html             # Single-page app shell + all inline CSS/JS + MODELS registry
│   ├── styles.css             # Additional styles (referenced by index.html)
│   ├── script.js              # Minimal legacy stub (not the main app logic)
│   ├── sw.js                  # Service worker for PWA offline support
│   ├── manifest.webmanifest   # PWA manifest
│   ├── prism.js / prism.css   # Local syntax highlighting (long-cached)
│   ├── .well-known/assetlinks.json  # Android app-links verification
│   └── privacy-policy/        # Static privacy policy page
├── netlify/
│   └── functions/
│       ├── chat.mjs           # Main AI proxy (v2 streaming, PROVIDERS + MODELS registry)
│       ├── hello-world.js     # Health-check / smoke test endpoint (CommonJS)
│       └── pokedex.js         # Example/demo function, not used by chat UI (CommonJS)
└── releases/                  # Signed Android AAB files for Google Play
```

> Note: `chat.mjs` is ESM (Netlify v2). The other functions stay CommonJS. Do **not**
> add `"type": "module"` to `package.json` — that would break the CJS functions.

---

## Providers & models

Every supported provider exposes an **OpenAI-compatible** `/chat/completions` endpoint
with SSE streaming, so the backend is one OpenAI-SDK client factory parameterized by
`baseURL` + `apiKey`. No provider is special-cased; Anthropic/Claude is **not** used.

`PROVIDERS` map (in `netlify/functions/chat.mjs`):

| Provider | Base URL | Key env |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | `MY_OPENAI_API` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `MY_GEMINI_API` |
| `deepseek` | `https://api.deepseek.com` | `MY_DEEPSEEK_API` |
| `qwen` | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` | `MY_QWEN_API` |
| `glm` | `https://api.z.ai/api/paas/v4/` | `MY_GLM_API` |

`MODELS` registry — defined **twice** and kept in sync:
- Frontend: array `MODELS` in `public/index.html` (`{ slug, label, provider }`) drives the dropdowns.
- Backend: `MODELS` map in `chat.mjs` (`slug → provider`) drives proxy routing.

Default lineup (all "Flash-tier"): `gpt-4o-mini`, `gemini-2.5-flash`,
`deepseek-v4-flash`, `qwen-flash`, `glm-4.6`. Default model is `gpt-4o-mini`.

> ⚠️ Verify slugs against each provider's live model list before shipping — provider
> model names drift. Adding/updating a model = one line in each registry (see
> `CONTRIBUTING.md`).

---

## Environment variables

Set in Netlify dashboard under **Site settings → Environment variables** (and in a
local `.env` for `netlify dev`). See `.env.example`.

| Variable | Description |
|---|---|
| `MY_OPENAI_API` | OpenAI API key (`sk-...`) |
| `MY_GEMINI_API` | Google Gemini (Generative Language) API key |
| `MY_DEEPSEEK_API` | DeepSeek API key |
| `MY_QWEN_API` | Qwen / Alibaba DashScope API key |
| `MY_GLM_API` | GLM / Z.ai API key |

A model whose key env is **unset** is disabled in the dropdown rather than erroring
(the frontend probes `GET /.netlify/functions/chat` for availability on load).

---

## Running locally

```bash
npm install
npx netlify dev        # serves public/ + functions at localhost:8888
```

Or serve only the frontend (functions won't work without a key): `npx serve public`.

---

## The chat function — `netlify/functions/chat.mjs`

Single Netlify **v2** function (`export default async (req) => Response`). Handles all
AI requests and streams tokens back.

### `GET /.netlify/functions/chat` — availability probe

Returns which providers have a server-side key configured:

```json
{ "providers": { "openai": true, "gemini": false, "deepseek": true, "qwen": false, "glm": true } }
```

### `POST /.netlify/functions/chat` — chat request

```json
{
  "message": "string (required)",
  "history": [{ "role": "user|assistant", "content": "string" }],
  "model": "gpt-4o-mini | gemini-2.5-flash | deepseek-v4-flash | qwen-flash | glm-4.6",
  "provider": "openai | gemini | deepseek | qwen | glm  (only used with customApiKey)",
  "customApiKey": "optional — user key; call goes direct from the browser instead",
  "systemPrompt": "optional override for system instructions"
}
```

### Streaming response (SSE)

`Content-Type: text/event-stream`. The function re-emits a simple protocol so the
parser is provider-agnostic (the SDK already parses each provider's SSE):

```
data: {"delta":"Hel"}

data: {"delta":"lo"}

data: [DONE]
```

Mid-stream failures emit `data: {"error":"..."}` then close. Pre-stream failures
(bad key, bad model, validation) return a normal JSON error body with a 4xx/5xx status.

### Routing logic

1. Custom-key requests: the browser calls the provider **directly** (never this
   function); provider comes from the client selection.
2. Proxy requests: `provider = MODELS[model]`, then `getClient(provider)` builds
   `new OpenAI({ baseURL, apiKey: process.env[apiKeyEnv] })`.
3. All providers use `chat.completions.create({ stream: true })` — no special-casing.
4. `max_tokens: 4096`, `temperature: 0.7`.

### Guards & CORS

- Generous input guard: rejects payloads (message + history) over ~50K chars. No
  per-request rate limiter — **spend caps live in each provider's dashboard** (the
  user's keys, the user's limits).
- CORS is wide open (`*`) intentionally: a public proxy called by the site's own
  origin (incl. the Android TWA and legacy redirect hosts). Tighten to an allowlist
  later if desired (low risk, reversible).

### Timeout

Default Netlify function timeout (~10s) is fine — Flash models emit their first byte
quickly. Raise via `[functions."chat"]` in `netlify.toml` (up to 26s on paid plans)
if longer completions are ever needed.

---

## Frontend architecture

All meaningful frontend logic lives inside `public/index.html` (inline `<script>` and
`<style>`). `public/script.js` is a legacy stub.

### Key frontend behaviors

- **Instant write**: the textarea is `autofocus` + explicitly `.focus()`ed on load
  with no auth/loading gate. Preserve this — no network/JS-heavy work may block first
  paint or input interactivity.
- **MODELS registry** drives all three model dropdowns (`#model-select`,
  `#header-model-selector`, `#custom-model-select`) — no hardcoded `<option>`s.
- **Streaming render**: `streamAssistantResponse()` reads the SSE stream, appends
  deltas into the loading bubble (throttled `marked.parse`), then finalizes markdown +
  Prism highlight + footer/quick-replies on completion. `parseProxyStreamEvent` (our
  function) and `parseOpenAIStreamEvent` (custom-key direct) share the same consumer.
- **Custom API key** toggle: browser calls the provider directly with the user's key
  (stays in `localStorage`, never sent to Netlify).
- **Stop**: reuses the shared `AbortController`; partial streamed text is kept.
- **Conversations / drafts / theme** stored in `localStorage`.
- **PWA**: `sw.js` precaches the app shell; bump `CACHE_NAME` when `index.html` changes.

---

## Deployment

Push to `master` → Netlify auto-deploys.

- Build command: *(none)* · Publish dir: `public` · Functions dir: `netlify/functions`
- Node version: 18 (set in `netlify.toml`)

Legacy subdomains (`quickchatgpt.uft1.com`, `gptfree.uft1.com`, `chatgpt.uft1.com`,
`quickchatgpt.netlify.app`) 301-redirect to `chat.uft1.com` via `netlify.toml`.

---

## Android / Google Play

The PWA is packaged as an Android **TWA** (AAB) using PWA Builder or Bubblewrap.

- Live URL: `https://chat.uft1.com`
- **Package ID: `com.uft1.chat.twa`** (matches `public/.well-known/assetlinks.json`
  and `twa-manifest.json`)
- Signed AABs stored in `releases/` (manual step, not CI)
- The TWA just loads the live site — a new AAB is only needed for manifest/package
  changes, not for frontend/backend updates.

---

## Conventions & gotchas

- No TypeScript, no build step — edits to `public/` go live as-is.
- Main app logic is **inside `index.html`**, not `script.js`.
- Keep the frontend and backend `MODELS` registries in sync.
- `chat.mjs` is ESM; keep the demo functions CommonJS (don't set `type: module`).
- `pokedex.js` and `hello-world.js` are demo/test functions, not wired to the UI.
- No tests configured (`npm test` exits 1 by design). Verify manually via `netlify dev`.

---

## Areas to improve

- Token usage tracking / cost visibility.
- Server-side conversation persistence (currently all in-browser `localStorage`).
- Self-host the Font Awesome icons actually used to drop the CDN dependency entirely.
- Replace wide-open CORS with an allowlist once the domain set stabilizes.
- Add a real test harness.
