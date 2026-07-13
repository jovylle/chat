# Chat Assistant Box — Agent Guide

> AI-readable codebase guide for any agent (Claude, GPT, Gemini, Copilot, etc.).
> Keep this file up to date when adding features or changing conventions.

## What this project is

**Chat Assistant Box** is a multi-turn AI chat web app hosted at [https://chat.uft1.com](https://chat.uft1.com).

- Static frontend (vanilla JS/HTML/CSS) served from `public/`
- One **Cloudflare Worker** (`worker/`) that serves the static app *and* the `/api/*`
  backend, proxying any OpenAI-compatible provider with **streaming** responses
- Optional **username/password accounts** with cross-device conversation sync (D1);
  **guest mode** (no login, all state in `localStorage`) is always preserved
- PWA-ready (manifest + service worker) with a Google Play Android TWA (AAB in `releases/`)

No frontend framework. No frontend build step. What's in `public/` is what ships. All app
logic is inlined in `public/index.html` (~3,500 lines). Only the **Worker** is bundled
(by wrangler/esbuild).

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML5, CSS (no framework, all inline in `index.html`) |
| Markdown rendering | `marked.js` (lazy-loaded from CDN on first message) |
| Syntax highlighting | `prism.js` (local, `public/prism.js` + `public/prism.css`) |
| Icons | Font Awesome 6.5 (CDN, loaded non-blocking) |
| Backend | Cloudflare Worker (ES modules, `worker/`), **zero runtime deps** |
| AI providers | Plain `fetch` to each provider's OpenAI-compatible `/chat/completions` |
| Database | Cloudflare **D1** (SQLite) — binding `DB` (accounts, conversations, messages) |
| Object storage | Cloudflare **R2** — binding `ATTACHMENTS` (image/file attachments, Phase 4) |
| Hosting | Cloudflare Workers + **Static Assets** (one Worker serves app + API) |
| Mobile | PWA → Android TWA via PWA Builder / Bubblewrap |

---

## Project structure

```
chat/
├── AGENTS.md                  # this file
├── README.md                  # user-facing overview
├── CONTRIBUTING.md            # local dev + how to add a model/provider
├── CHANGELOG.md               # release history
├── .env.example               # documents required secrets (see also .dev.vars)
├── .dev.vars                  # LOCAL secrets for `wrangler dev` (gitignored)
├── package.json               # scripts (wrangler dev/deploy) + devDeps (wrangler)
├── wrangler.jsonc             # Worker config: assets, bindings (DB/R2), migrations
├── twa-manifest.json          # Trusted Web Activity manifest for Android build
├── worker/                    # Cloudflare Worker (bundled by wrangler, zero deps)
│   ├── index.js               # Entrypoint + /api/* router; ASSETS.fetch fallback
│   ├── chat.js                # AI proxy: PROVIDERS + MODELS registry, fetch + tee()
│   ├── auth.js                # /api/auth/* register/login/logout/me
│   ├── conversations.js       # /api/conversations/* CRUD + /api/sync/import + persist
│   ├── db.js                  # ids, PBKDF2 hashing, session tokens, cookies, lookup
│   └── crypto.test.js         # vitest units for hashing / tokens
├── migrations/                # D1 SQL migrations (0001_init.sql, 0002_conversations.sql)
├── public/                    # Static frontend (served by Static Assets, verbatim)
│   ├── index.html             # Single-page app shell + all inline CSS/JS + MODELS registry
│   ├── styles.css             # Additional styles (referenced by index.html)
│   ├── script.js              # Minimal legacy stub (not the main app logic)
│   ├── sw.js                  # Service worker (app-shell precache; never caches /api/*)
│   ├── manifest.webmanifest   # PWA manifest
│   ├── prism.js / prism.css   # Local syntax highlighting (long-cached)
│   ├── _headers               # Security + cache headers (ported from netlify.toml)
│   ├── _redirects             # SPA/redirect notes (host redirects → CF Redirect Rules)
│   ├── .well-known/assetlinks.json  # Android app-links verification (served as JSON)
│   └── privacy-policy/        # Static privacy policy page
└── releases/                  # Signed Android AAB files for Google Play
```

---

## Request flow

```
Request → Worker (worker/index.js)
  /api/*   → handled by the Worker (wrangler `run_worker_first: ["/api/*"]`)
  else     → env.ASSETS.fetch(request)  (serves public/ verbatim; SPA fallback)
```

`run_worker_first` is scoped to `/api/*` only, so static-asset hits never invoke the
Worker (keeps invocation counts low). Non-asset unknown paths fall back to `index.html`
via `not_found_handling: "single-page-application"`.

---

## Providers & models

Every supported provider exposes an **OpenAI-compatible** `/chat/completions` endpoint
with SSE streaming, so the backend calls each with plain `fetch` and **passes the
upstream OpenAI-format SSE through unchanged**. No SDK, no provider special-casing;
Anthropic/Claude is **not** used.

`PROVIDERS` map (in `worker/chat.js`):

| Provider | Base URL | Key secret |
|---|---|---|
| `openai` | `https://api.openai.com/v1` | `MY_OPENAI_API` |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | `MY_GEMINI_API` |
| `deepseek` | `https://api.deepseek.com` | `MY_DEEPSEEK_API` |
| `qwen` | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` | `MY_QWEN_API` |
| `glm` | `https://api.z.ai/api/paas/v4` | `MY_GLM_API` |

`MODELS` registry — defined **twice** and kept in sync:
- Frontend: array `MODELS` in `public/index.html` (`{ slug, label, provider }`) drives the dropdowns.
- Backend: `MODELS` map in `worker/chat.js` (`slug → { provider, vision }`) drives proxy routing.

Default lineup (all "Flash-tier"): `gpt-4o-mini`, `gemini-2.5-flash`,
`deepseek-v4-flash`, `qwen-flash`, `glm-4.6`. Default model is `gpt-4o-mini`.

> ⚠️ Verify slugs against each provider's live model list before shipping — provider
> model names drift. Adding/updating a model = one line in each registry (see
> `CONTRIBUTING.md`).

---

## Secrets & bindings

**Secrets** (local: `.dev.vars`; prod: `wrangler secret put <NAME>`):

| Secret | Description |
|---|---|
| `MY_OPENAI_API` | OpenAI API key (`sk-...`) |
| `MY_GEMINI_API` | Google Gemini (Generative Language) API key |
| `MY_DEEPSEEK_API` | DeepSeek API key |
| `MY_QWEN_API` | Qwen / Alibaba DashScope API key |
| `MY_GLM_API` | GLM / Z.ai API key |
| `SESSION_SECRET` | HMAC pepper for password hashing / sessions (Phase 2+) |

A model whose key secret is **unset** is disabled in the dropdown rather than erroring
(the frontend probes `GET /api/models` for availability on load).

**Bindings** (in `wrangler.jsonc`): `ASSETS` (static), `DB` (D1), `ATTACHMENTS` (R2, Phase 4).

---

## Running locally

```bash
npm install
npm run dev            # wrangler dev — serves app + API at localhost:8787
```

`wrangler dev` reads secrets from `.dev.vars` and uses a **local** D1 SQLite. Apply
migrations locally before testing DB features:

```bash
npm run db:migrate:local     # wrangler d1 migrations apply chat-assistant-box --local
```

---

## The Worker — `worker/`

### `worker/index.js` — entrypoint + router

- Non-`/api/*` → `env.ASSETS.fetch(request)`.
- `OPTIONS /api/*` → CORS preflight.
- `GET /api/models` → availability probe.
- `POST /api/chat` → streaming proxy.
- (Phase 2+) `/api/auth/*`, `/api/conversations/*`, `/api/attachments/*`.

### `worker/chat.js` — AI proxy

**`GET /api/models`** — which providers have a server-side key configured:

```json
{ "providers": { "openai": true, "gemini": false, "deepseek": true, "qwen": true, "glm": true } }
```

**`POST /api/chat`** — chat request:

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

**Streaming response (SSE)** — `Content-Type: text/event-stream`. The Worker passes the
**raw upstream OpenAI-format SSE through unchanged** (`data: {chat.completion.chunk}` …
`data: [DONE]`). The frontend's single `parseOpenAIStreamEvent` reads
`choices[0].delta.content`. Pre-stream failures (bad key/model/validation) return a JSON
error body with a 4xx/5xx status.

**`tee()` for persistence:** the upstream body is split with `ReadableStream.tee()` —
one branch streams to the client, the other is accumulated (via `ctx.waitUntil`) so a
`persist` hook can save the assistant message to D1 for logged-in users. In Phase 1 the
hook is `null` and the second branch is cancelled. **Never let the accumulate branch
block or delay the client stream.**

**Routing:** custom-key requests trust the client-selected provider (browser calls the
provider directly, never the Worker); proxy requests resolve `provider` from `MODELS`.
`max_tokens: 4096`, `temperature: 0.7`. Client aborts (Stop) forward to the upstream
`fetch` via `AbortController`.

**Guards & CORS:** generous input guard (message + history) over ~50K chars is rejected;
no per-request rate limiter — **spend caps live in each provider's dashboard**. CORS is
wide open (`*`) intentionally (public proxy called by the site's own origin, incl. TWA).

---

## Frontend architecture

All meaningful frontend logic lives inside `public/index.html` (inline `<script>` and
`<style>`). `public/script.js` is a legacy stub.

### Key frontend behaviors

- **Instant write (hard constraint):** the textarea is `autofocus` + explicitly
  `.focus()`ed on load with **zero blocking network/auth work**. `GET /api/models` and
  (Phase 2+) `GET /api/auth/me` are fired **async, after** focus. Never gate first paint
  or input interactivity on a request.
- **MODELS registry** drives all three model dropdowns (`#model-select`,
  `#header-model-selector`, `#custom-model-select`) — no hardcoded `<option>`s.
- **Streaming render:** `streamAssistantResponse()` reads the SSE stream, appends deltas
  into the loading bubble (throttled `marked.parse`), then finalizes markdown + Prism
  highlight + footer/quick-replies on completion. **Both** the proxy path and the
  custom-key path use the single `parseOpenAIStreamEvent` consumer (the old `{delta}`
  re-emit protocol and `parseProxyStreamEvent` were removed in the CF migration).
- **Custom API key** toggle: browser calls the provider directly with the user's key
  (stays in `localStorage`, never sent to the Worker).
- **Stop:** reuses the shared `AbortController`; partial streamed text is kept.
- **Conversations / drafts / theme** stored in `localStorage` (guest). Logged-in users
  (Phase 3) sync via `/api/conversations/*`; local stays the offline cache.
- **PWA:** `sw.js` precaches the app shell and **never** caches `/api/*`; bump
  `CACHE_NAME` when app-shell files change.

---

## Deployment

Deploy the Worker (static assets upload automatically):

```bash
npm run deploy            # wrangler deploy
# first time only:
wrangler d1 create chat-assistant-box   # paste database_id into wrangler.jsonc
wrangler secret put MY_OPENAI_API       # repeat for each secret above
npm run db:migrate:remote               # apply migrations to prod D1
```

**Custom domain / DNS cutover:** add `chat.uft1.com` as a Worker Custom Domain (or a
route `chat.uft1.com/*`). Stage on `*.workers.dev` first; cut `chat.uft1.com` only after
a smoke test. Keep `assetlinks.json` byte-identical so the TWA stays verified.

**Legacy host redirects** (`quickchatgpt.uft1.com`, `gptfree.uft1.com`,
`chatgpt.uft1.com` → `chat.uft1.com`) are configured as Cloudflare **Redirect Rules** in
the dashboard (see `public/_redirects` for the exact rules). The old
`quickchatgpt.netlify.app` host is retired.

---

## Android / Google Play

The PWA is packaged as an Android **TWA** (AAB) using PWA Builder or Bubblewrap.

- Live URL: `https://chat.uft1.com`
- **Package ID: `com.uft1.chat.twa`** (matches `public/.well-known/assetlinks.json`
  and `twa-manifest.json`) — fingerprint unchanged across the CF migration.
- Signed AABs stored in `releases/` (manual step, not CI).
- The TWA just loads the live site — a new AAB is only needed for manifest/package
  changes, **not** for the Netlify→Cloudflare migration (site-only change). Verify the
  TWA still opens fullscreen post-cutover.

---

## Conventions & gotchas

- No frontend TypeScript, no frontend build step — edits to `public/` go live as-is.
- Only the **Worker** is bundled (wrangler/esbuild). Keep it dependency-free.
- Main app logic is **inside `index.html`**, not `script.js`.
- Keep the frontend and backend `MODELS` registries in sync.
- **D1:** prepared statements only; INTEGER for bool/time; add indexes; `ON DELETE
  CASCADE`; binary → R2 never D1 (1 MB row limit); apply migrations `--remote` for prod.
- **Passwords:** PBKDF2-HMAC-SHA256 via WebCrypto only (no bcrypt/argon2 in Workers).
- **Cookies:** session cookie is HttpOnly + Secure + SameSite=Lax; store the token
  **hash**, not the token.
- `sw.js` must never cache `/api/*` (breaks streaming + session cookies).

---

## Roadmap (phased)

1. ✅ **Phase 1** — Migrate Netlify → Cloudflare (byte-for-byte same app).
2. **Phase 2** — Username/password accounts (D1 + PBKDF2 + session cookies).
3. **Phase 3** — Server-side conversation sync (guest→account import).
4. **Phase 4** — Image/file attachments for vision (R2).
5. **Phase 5** — ChatGPT-quality polish (LLM titles, search, share links).

## Areas to improve

- Token usage tracking / cost visibility.
- Self-host the Font Awesome icons actually used to drop the CDN dependency entirely.
- Replace wide-open CORS with an allowlist once the domain set stabilizes.
- Expand the test harness (vitest + @cloudflare/vitest-pool-workers) beyond auth/DB units.
