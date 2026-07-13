// Chat Assistant Box — Cloudflare Worker entrypoint.
//
// One Worker serves both the API and the static PWA:
//   /api/*  → handled here (wrangler `run_worker_first: ["/api/*"]`)
//   else    → env.ASSETS.fetch(request) serves public/ verbatim, with the
//             single-page-application fallback configured in wrangler.jsonc.
//
// Bindings (see wrangler.jsonc): ASSETS (static), DB (D1), ATTACHMENTS (R2,
// Phase 4). Secrets: the 5 provider keys + SESSION_SECRET.

import { handleChat, handleModels, corsHeaders } from './chat.js';
import { handleAuth } from './auth.js';
import { handleConversations, persistChatTurn } from './conversations.js';
import { getSessionUser } from './db.js';

function notFound() {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Everything outside /api/* is a static asset. (With run_worker_first
    // scoped to /api/*, the Worker isn't even invoked for those — this is a
    // belt-and-suspenders fallback.)
    if (!pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // CORS preflight for any API route.
    if (request.method === 'OPTIONS') {
      return new Response('', { status: 200, headers: corsHeaders });
    }

    // --- API routing ---------------------------------------------------------
    if (pathname === '/api/models' && request.method === 'GET') {
      return handleModels(env);
    }

    if (pathname === '/api/chat' && request.method === 'POST') {
      // Logged-in users get their chat turns persisted to D1 (guests don't).
      const user = await getSessionUser(request, env);
      const persist = user
        ? (data) => persistChatTurn(env, user.id, data)
        : null;
      return handleChat(request, env, ctx, persist);
    }

    if (pathname.startsWith('/api/auth/')) {
      return handleAuth(request, env, pathname);
    }

    if (pathname === '/api/conversations' || pathname.startsWith('/api/conversations/') || pathname === '/api/sync/import') {
      return handleConversations(request, env, pathname);
    }

    return notFound();
  },
};
