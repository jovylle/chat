# QuickGPT

A fast, modern AI chat interface with markdown support, dark/light theme, Netlify serverless backend (OpenAI GPT-3.5 & Claude), and progressive web app polish.

![QuickGPT](./public/quickgpt-screenshot.png)

## Features

- **Chat** – Multi-turn conversations with OpenAI Claude and GPT-3.5 models
- **Markdown & code** – AI replies rendered as markdown with Prism.js syntax highlighting and copy buttons
- **Drafts per conversation** – Inputs are auto saved locally per chat
- **Quick replies** – Suggested follow-up prompts (“Explain simpler”, “Give examples”, etc.)
- **Message edit & resend** – Edit any user message and regenerate from that point
- **Regenerate / stop** – Regenerate the last AI response or cancel in-flight requests
- **Read aloud** – Listen to any AI reply with Web Speech API voice controls
- **Conversation management** – Rename, pin, delete, reorder via searchable sidebar
- **Export & copy** – Download chat history (JSON/TXT/MD) and copy individual responses
- **PWA-ready** – Manifest + service worker + install prompt keep the UI installable on mobile
- **Keyboard-aware layout** – Input stays visible above the Android keyboard with soft scrolling tweaks
- **Accessibility** – ARIA labels, roles, keyboard support (Escape clears input)
- **Retry toast** – “Retry” button surfaces automatically on rate limits (429)

## Live preview

- Web app: [https://chat.uft1.com](https://chat.uft1.com)
- Legacy vanity hosts now redirect to the new domain via Netlify config above
- More projects and info: [https://jovylle.com](https://jovylle.com)

## Setup

1. **Clone and install**

   ```bash
   git clone https://github.com/jovylle/chat.git
   cd chat
   npm install
   ```

2. **OpenAI API key**

   - Get an API key from [OpenAI](https://platform.openai.com/api-keys).
   - In Netlify: **Site settings → Environment variables** add:
     - `MY_OPENAI_API` = your OpenAI API key

3. **Run locally (Netlify Dev)**

   ```bash
   npx netlify dev
   ```

   Or serve the `public` folder (e.g. `npx serve public`) and point to the deployed `/.netlify/functions/chat` if already live.

4. **Deploy**

   Connect the repo to Netlify; build command can be empty, publish directory: `public`, functions: `netlify/functions`. Netlify’s redirect rules ensure the SPA works and legacy hosts keep pointing to `chat.uft1.com`.

## Project structure

- `public/` – Static frontend (`index.html`, `prism.js`, `prism.css`)
- `netlify/functions/chat.js` – Serverless function that proxies requests to OpenAI
- `netlify.toml` – Netlify config (build, redirects, headers)

## License

MIT · [jovylle](https://github.com/jovylle)
