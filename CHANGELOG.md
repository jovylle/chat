# Changelog

All notable changes to Chat Assistant Box are documented here. This project loosely
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Migrated to Cloudflare.** One **Cloudflare Worker** now serves both the static PWA
  (Workers Static Assets) and the `/api/*` backend; Netlify is retired. Dev is
  `wrangler dev`; deploy is `wrangler deploy`. New `wrangler.jsonc`, `worker/index.js`
  (router), `worker/chat.js` (proxy). D1 (`DB`) and R2 (`ATTACHMENTS`) bindings wired for
  upcoming accounts/sync/attachments phases.
- **Optional accounts (username + password).** Register / log in / log out from a header
  account button; email optional. Passwords hashed with PBKDF2-HMAC-SHA256 (WebCrypto,
  per-user salt, `SESSION_SECRET` pepper); opaque session token in an HttpOnly + Secure +
  SameSite=Lax cookie (only the token hash is stored). **Guest mode is unchanged** and
  the account check is async — it never blocks instant write. New `worker/auth.js`,
  `worker/db.js`, `migrations/0001_init.sql`.
- **Cross-device conversation sync.** Logged-in users' conversations and chat messages
  persist to D1 and sync across devices (create/rename/pin/delete + streamed replies). A
  `ConversationStore` facade routes writes to the server when logged in and keeps
  localStorage as the per-user offline cache. First login offers to **import your local
  guest chats** (de-duped by id). New `worker/conversations.js`,
  `migrations/0002_conversations.sql`, endpoints `/api/auth/*`, `/api/conversations/*`,
  `/api/sync/import`.
- **Unit tests** (`vitest`) for the security-sensitive auth: PBKDF2 hashing, session
  token hashing, and the title helper (`npm test`).
- **Streaming responses.** Tokens now render progressively as the model generates
  them (SSE streaming). Big perceived-speed win.
- **New model lineup** — fast "Flash-tier" models across providers: GPT-4o Mini
  (default), Gemini 2.5 Flash, DeepSeek V4 Flash, Qwen Flash, GLM 4.6.
- **Config-driven `MODELS` registry** (frontend + backend) — dropdowns and routing are
  generated from one list; adding a model is a one-line change.
- **Provider availability probe** (`GET /api/models`) — models whose server-side key
  isn't configured are disabled in the dropdown instead of erroring.
- **Generous input guard** on the Worker (rejects absurdly large payloads).
- New docs: `AGENTS.md` (renamed from `agents.md`, refreshed), `README.md` refresh,
  `CONTRIBUTING.md`, and this `CHANGELOG.md`.

### Changed
- Backend rewritten as a dependency-free Worker: plain `fetch` to each provider with the
  **upstream OpenAI-format SSE passed through unchanged** (via `ReadableStream.tee()`),
  replacing the `openai` SDK and the old `{delta}` re-emit protocol. The frontend now
  uses a single `parseOpenAIStreamEvent` for both the proxy and custom-key paths.
- API endpoints moved from `/.netlify/functions/chat` to `/api/chat` + `/api/models`.
- Config moved from `netlify.toml` to `wrangler.jsonc` + `public/_headers` /
  `public/_redirects`; SPA fallback via `not_found_handling`; host redirects via
  Cloudflare Redirect Rules.
- `max_tokens` raised from 1024 to 4096.
- Font Awesome now loads non-blocking so it no longer delays first paint.
- Service worker cache bumped to `chat-assistant-box-shell-v3`; `/api/*` is never cached.

### Removed
- **Netlify** entirely — `netlify.toml`, `netlify/functions/` (including the dead
  `pokedex.js` / `hello-world.js`), and `deno.lock`.
- Runtime dependencies `openai`, `express`, and `uuid`.
- **Anthropic / Claude entirely** — the `@anthropic-ai/sdk` dependency, the
  `MY_CLAUDE_API` env var, the Claude models, and the browser `x-api-key` branch.
- Dead `groq` dropdown option and legacy `gpt-3.5-turbo*` models.

### Fixed
- Corrected the Android package ID in docs to `com.uft1.chat.twa`.

## [1.2] — Android release
- Updated launcher name; published signed AAB (`releases/chat-assistant-box-1.2.aab`).
- Ensured Android installs open fullscreen.

## [1.1] — Android release
- First signed AAB for Google Play.
- Ensured `.well-known/assetlinks.json` returns JSON for app-links verification.
