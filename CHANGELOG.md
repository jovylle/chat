# Changelog

All notable changes to Chat Assistant Box are documented here. This project loosely
follows [Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Streaming responses.** Tokens now render progressively as the model generates
  them (Netlify Functions v2 SSE streaming). Big perceived-speed win.
- **New model lineup** — fast "Flash-tier" models across providers: GPT-4o Mini
  (default), Gemini 2.5 Flash, DeepSeek V4 Flash, Qwen Flash, GLM 4.6.
- **Config-driven `MODELS` registry** (frontend + backend) — dropdowns and routing are
  generated from one list; adding a model is a one-line change.
- **Provider availability probe** (`GET /.netlify/functions/chat`) — models whose
  server-side key isn't configured are disabled in the dropdown instead of erroring.
- **Generous input guard** on the function (rejects absurdly large payloads).
- New docs: `AGENTS.md` (renamed from `agents.md`, refreshed), `README.md` refresh,
  `CONTRIBUTING.md`, and this `CHANGELOG.md`.

### Changed
- Backend collapsed to **one OpenAI-SDK client factory** parameterized by `baseURL` +
  `apiKey`; every provider is OpenAI-compatible, so there's no per-provider special-casing.
- Custom-key path simplified to OpenAI-compatible providers and now also streams.
- `max_tokens` raised from 1024 to 4096.
- Font Awesome now loads non-blocking so it no longer delays first paint.
- Service worker cache bumped to `chat-assistant-box-shell-v2`.

### Removed
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
