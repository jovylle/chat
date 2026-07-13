# Contributing to Chat Assistant Box

Thanks for helping out! The frontend is deliberately simple: **vanilla JS, no build
step, no bundler.** What's in `public/` is what ships. Only the **Worker** (`worker/`) is
bundled (by wrangler/esbuild). Please keep it that way.

## Local development

```bash
npm install
npm run dev            # wrangler dev → serves app + API at http://localhost:8787
```

Create a `.dev.vars` at the repo root with any provider keys you want enabled plus
`SESSION_SECRET` (see `.env.example`). `wrangler dev` runs the Worker locally against
real provider APIs and a **local** D1 SQLite. Apply DB migrations locally first:

```bash
npm run db:migrate:local
```

> **Shared D1 database.** Chat co-inhabits one shared D1 instance (`projectmate-issues`,
> binding `DB`) with other projects. Every chat table and index is prefixed `chat_`
> (`chat_users`, `chat_sessions`, `chat_conversations`, `chat_messages`, `idx_chat_*`), and
> chat tracks its own migrations via `migrations_table: d1_migrations_chat` in
> `wrangler.jsonc`. Prefix any new table **and** index; FKs reference only `chat_*` tables.

The test harness uses `vitest` (`npm test`); auth/hashing and D1 CRUD are the units
worth covering since auth is security-sensitive. Also verify changes manually in
`wrangler dev`: send a message on each model, confirm tokens stream in, Stop cancels
mid-stream, and markdown/code render on completion.

## Code conventions

- **Everything frontend lives inline in `public/index.html`** (one big `<script>` and
  `<style>`). `public/script.js` is a legacy stub — don't add logic there.
- Match the surrounding style: same naming, comment density, and idioms.
- No frontend TypeScript, no frameworks, no npm build. Edits to `public/` go live as-is.
- The Worker (`worker/*.js`) is **ESM** with **zero runtime deps** — keep it that way
  (use WebCrypto, plain `fetch`, D1/R2 bindings; don't add SDKs).
- When you change app-shell files in `public/`, bump `CACHE_NAME` in `public/sw.js` so
  the PWA shell updates.

## Adding or changing a model

Every provider is OpenAI-compatible, so a model is just a registry line in two places.

1. **Frontend** — `public/index.html`, the `MODELS` array (near the storage-key
   constants):

   ```js
   { slug: 'provider-model-slug', label: 'Nice Label', provider: 'openai' },
   ```

2. **Backend** — `worker/chat.js`, the `MODELS` map (slug → `{ provider, vision }`):

   ```js
   'provider-model-slug': { provider: 'openai', vision: false },
   ```

Keep the two in sync. `slug` must be the exact model id the provider expects.

> ⚠️ Verify the slug against the provider's live model list first — provider model
> names drift over time.

## Adding a new provider

All five current providers are OpenAI-compatible, so adding another is small:

1. **Backend** (`worker/chat.js`) — add to the `PROVIDERS` map:

   ```js
   myprovider: { baseURL: 'https://api.example.com/v1', apiKeyEnv: 'MY_PROVIDER_API' },
   ```

2. **Frontend** (`index.html`) — add matching entries to `PROVIDER_LABELS` and
   `PROVIDER_BASE_URLS` (the latter powers the browser-direct custom-key path), then add
   the provider's models to both `MODELS` registries.

3. Document the new secret in `.env.example` and `AGENTS.md`, and set it with
   `wrangler secret put MY_PROVIDER_API` (and in `.dev.vars` for local dev).

The `fetch` passthrough and the SSE parser are provider-agnostic — no other code changes
needed.

## Environment / secrets

- Never commit real keys. `.dev.vars` is git-ignored; `.env.example` documents the names.
  Production secrets are set with `wrangler secret put <NAME>`.
- **Spend safety is the provider dashboard's job.** Set a cap on each key there. We
  intentionally don't add an aggressive server-side rate limiter — only a generous
  input-size guard.

## Deploy flow

`npm run deploy` (`wrangler deploy`) uploads the Worker and static assets together. The
Android TWA loads the live site, so a code change ships to mobile users automatically —
a new AAB in `releases/` is only needed for manifest/package changes. When you add a D1
migration, run `npm run db:migrate:remote` after deploying.

## Commit & PR

- Keep commits focused; describe the "why".
- If you touched models/providers, note the verified slugs in the PR description.
- Update `CHANGELOG.md` under an "Unreleased" heading for user-visible changes.
