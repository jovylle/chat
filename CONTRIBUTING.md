# Contributing to Chat Assistant Box

Thanks for helping out! This project is deliberately simple: **vanilla JS, no build
step, no bundler.** What's in `public/` is what ships. Please keep it that way.

## Local development

```bash
npm install
npx netlify dev        # serves public/ + functions at http://localhost:8888
```

Create a `.env` at the repo root with any provider keys you want enabled (see
`.env.example`). `netlify dev` runs the streaming function locally against real
provider APIs.

Frontend-only preview (functions won't work without keys): `npx serve public`.

There is **no test harness** — `npm test` exits 1 by design. Verify changes manually in
`netlify dev`: send a message on each model, confirm tokens stream in, Stop cancels
mid-stream, and markdown/code render on completion.

## Code conventions

- **Everything frontend lives inline in `public/index.html`** (one big `<script>` and
  `<style>`). `public/script.js` is a legacy stub — don't add logic there.
- Match the surrounding style: same naming, comment density, and idioms.
- No TypeScript, no frameworks, no npm build. Edits to `public/` go live as-is.
- The backend function `netlify/functions/chat.mjs` is **ESM** (Netlify v2). The demo
  functions (`pokedex.js`, `hello-world.js`) are CommonJS — **do not** add
  `"type": "module"` to `package.json`, it would break them.
- When you change `public/index.html`, bump `CACHE_NAME` in `public/sw.js` so the PWA
  shell updates.

## Adding or changing a model

Every provider is OpenAI-compatible, so a model is just a registry line in two places.

1. **Frontend** — `public/index.html`, the `MODELS` array (near the storage-key
   constants):

   ```js
   { slug: 'provider-model-slug', label: 'Nice Label', provider: 'openai' },
   ```

2. **Backend** — `netlify/functions/chat.mjs`, the `MODELS` map (slug → provider):

   ```js
   'provider-model-slug': 'openai',
   ```

Keep the two in sync. `slug` must be the exact model id the provider expects.

> ⚠️ Verify the slug against the provider's live model list first — provider model
> names drift over time.

## Adding a new provider

All five current providers are OpenAI-compatible, so adding another is small:

1. **Backend** (`chat.mjs`) — add to the `PROVIDERS` map:

   ```js
   myprovider: { baseURL: 'https://api.example.com/v1', apiKeyEnv: 'MY_PROVIDER_API' },
   ```

2. **Frontend** (`index.html`) — add matching entries to `PROVIDER_LABELS` and
   `PROVIDER_BASE_URLS` (the latter powers the browser-direct custom-key path), then add
   the provider's models to both `MODELS` registries.

3. Document the new env var in `.env.example` and `AGENTS.md`.

The client factory (`getClient`) and the SSE parser are provider-agnostic — no other
code changes needed.

## Environment / secrets

- Never commit real keys. `.env` is git-ignored; `.env.example` documents the names.
- **Spend safety is the provider dashboard's job.** Set a cap on each key there. We
  intentionally don't add an aggressive server-side rate limiter — only a generous
  input-size guard.

## Deploy flow

Push to `master` → Netlify auto-deploys (no build command; publish dir `public`,
functions dir `netlify/functions`). The Android TWA loads the live site, so a code
change ships to mobile users automatically — a new AAB in `releases/` is only needed
for manifest/package changes.

## Commit & PR

- Keep commits focused; describe the "why".
- If you touched models/providers, note the verified slugs in the PR description.
- Update `CHANGELOG.md` under an "Unreleased" heading for user-visible changes.
