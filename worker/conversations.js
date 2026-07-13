// Phase 3 — server-side conversation sync (logged-in users).
// CRUD over conversations/messages, guest→account import, and the persistence
// hook invoked from POST /api/chat. All rows are scoped to the session user.

import { corsHeaders, generateTitle } from './chat.js';
import { now, newId, getSessionUser } from './db.js';

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const estimateTokens = (text) => Math.ceil((typeof text === 'string' ? text.length : 0) / 4);

// Shape a conversations row like the client's localStorage object.
function rowToConversation(row, messages) {
  const convo = {
    id: row.id,
    title: row.title || 'New Chat',
    model: row.model || null,
    pinned: !!row.pinned,
    tokenCount: row.token_count || 0,
    created: row.created_at,
    updated: row.updated_at,
  };
  if (messages) convo.messages = messages;
  return convo;
}

async function listConversations(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, model, pinned, token_count, created_at, updated_at
       FROM conversations WHERE user_id = ?
      ORDER BY pinned DESC, updated_at DESC`
  ).bind(userId).all();
  return json(200, { conversations: (results || []).map((r) => rowToConversation(r)) });
}

async function getConversation(env, userId, id) {
  const row = await env.DB.prepare(
    `SELECT id, title, model, pinned, token_count, created_at, updated_at
       FROM conversations WHERE id = ? AND user_id = ?`
  ).bind(id, userId).first();
  if (!row) return json(404, { error: 'Not found' });

  const { results } = await env.DB.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at, id'
  ).bind(id).all();
  const messages = (results || []).map((m) => ({ role: m.role, content: m.content }));
  return json(200, { conversation: rowToConversation(row, messages) });
}

async function createConversation(env, userId, body) {
  const id = body.id || newId();
  const ts = now();
  // Idempotent by id: the client may create locally then mirror while a chat
  // request for the same id is already in flight (which upserts server-side).
  await env.DB.prepare(
    `INSERT INTO conversations (id, user_id, title, model, pinned, token_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).bind(id, userId, body.title || 'New Chat', body.model || null, ts, ts).run();
  const row = await env.DB.prepare(
    'SELECT id, title, model, pinned, token_count, created_at, updated_at FROM conversations WHERE id = ?'
  ).bind(id).first();
  return json(201, { conversation: rowToConversation(row, []) });
}

async function patchConversation(env, userId, id, body) {
  const owned = await env.DB.prepare(
    'SELECT id FROM conversations WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!owned) return json(404, { error: 'Not found' });

  const sets = [];
  const vals = [];
  if (typeof body.title === 'string') { sets.push('title = ?'); vals.push(body.title.slice(0, 200)); }
  if (typeof body.pinned === 'boolean') { sets.push('pinned = ?'); vals.push(body.pinned ? 1 : 0); }
  if (typeof body.model === 'string') { sets.push('model = ?'); vals.push(body.model); }
  if (!sets.length) return json(400, { error: 'Nothing to update.' });
  sets.push('updated_at = ?'); vals.push(now());
  vals.push(id, userId);

  await env.DB.prepare(
    `UPDATE conversations SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`
  ).bind(...vals).run();
  return json(200, { ok: true });
}

async function deleteConversation(env, userId, id) {
  const res = await env.DB.prepare(
    'DELETE FROM conversations WHERE id = ? AND user_id = ?'
  ).bind(id, userId).run();
  if (!res.meta.changes) return json(404, { error: 'Not found' });
  return json(200, { ok: true });
}

// Recompute token_count from all rows (matches client's ceil(len/4) per msg).
async function recomputeTokens(env, conversationId) {
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM((length(content) + 3) / 4), 0) AS tokens FROM messages WHERE conversation_id = ?'
  ).bind(conversationId).first();
  return row?.tokens || 0;
}

// Persistence hook for POST /api/chat (logged-in users). Writes the user turn
// and the streamed assistant reply, sets the title on the first message, bumps
// updated_at, and recomputes token_count. Verifies conversation ownership.
export async function persistChatTurn(env, userId, { conversationId, userMessage, assistantText, model }) {
  if (!conversationId) return; // guest-style request from a logged-in tab: skip.
  let convo = await env.DB.prepare(
    'SELECT id, title FROM conversations WHERE id = ? AND user_id = ?'
  ).bind(conversationId, userId).first();
  if (!convo) {
    // Race: chat arrived before the client mirrored the new conversation.
    // Upsert it now (owned by the authenticated user) rather than dropping the turn.
    const ts = now();
    await env.DB.prepare(
      `INSERT INTO conversations (id, user_id, title, model, pinned, token_count, created_at, updated_at)
       VALUES (?, ?, 'New Chat', ?, 0, 0, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).bind(conversationId, userId, model || null, ts, ts).run();
    convo = await env.DB.prepare(
      'SELECT id, title FROM conversations WHERE id = ? AND user_id = ?'
    ).bind(conversationId, userId).first();
    if (!convo) return; // id exists but owned by someone else → refuse
  }

  const existing = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?'
  ).bind(conversationId).first();
  const isFirst = (existing?.n || 0) === 0;

  const ts = now();
  const stmts = [
    env.DB.prepare(
      'INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(newId(), conversationId, 'user', userMessage, model || null, ts),
  ];
  if (assistantText) {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(newId(), conversationId, 'assistant', assistantText, model || null, ts + 1)
    );
  }
  await env.DB.batch(stmts);

  const tokens = await recomputeTokens(env, conversationId);
  const title = isFirst ? generateTitle(userMessage) : convo.title;
  await env.DB.prepare(
    'UPDATE conversations SET title = ?, token_count = ?, updated_at = ? WHERE id = ?'
  ).bind(title, tokens, now(), conversationId).run();
}

// POST /api/sync/import — bulk import the client export bundle (exportAllData).
// De-dupe by id: imported wins (delete then re-insert). Chunks D1 batch() ≤ 1000.
async function importBundle(env, userId, body) {
  const convos = body?.conversations;
  if (!convos || typeof convos !== 'object') return json(400, { error: 'No conversations to import.' });

  const entries = Object.values(convos).filter((c) => c && c.id);
  if (!entries.length) return json(200, { imported: 0 });

  const stmts = [];
  const push = (s) => stmts.push(s);
  const ids = entries.map((c) => c.id);

  // Imported wins: wipe any existing rows for these ids (messages cascade).
  for (const id of ids) {
    push(env.DB.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(id, userId));
  }

  for (const c of entries) {
    const created = c.created || now();
    const updated = c.updated || created;
    const messages = Array.isArray(c.messages) ? c.messages : [];
    const tokenCount = typeof c.tokenCount === 'number'
      ? c.tokenCount
      : messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    push(env.DB.prepare(
      `INSERT INTO conversations (id, user_id, title, model, pinned, token_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(c.id, userId, c.title || 'New Chat', c.model || null, c.pinned ? 1 : 0, tokenCount, created, updated));

    messages.forEach((m, i) => {
      if (!m || typeof m.content !== 'string') return;
      push(env.DB.prepare(
        'INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(newId(), c.id, m.role === 'assistant' ? 'assistant' : 'user', m.content, c.model || null, created + i));
    });
  }

  // Flush in chunks of ≤1000 statements (D1 batch limit).
  for (let i = 0; i < stmts.length; i += 1000) {
    await env.DB.batch(stmts.slice(i, i + 1000));
  }
  return json(200, { imported: entries.length });
}

// Router for /api/conversations/* and /api/sync/import (all auth-required).
export async function handleConversations(request, env, pathname) {
  const user = await getSessionUser(request, env);
  if (!user) return json(401, { error: 'Not authenticated.' });
  const method = request.method;

  if (pathname === '/api/sync/import' && method === 'POST') {
    let body; try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }
    return importBundle(env, user.id, body);
  }

  if (pathname === '/api/conversations') {
    if (method === 'GET') return listConversations(env, user.id);
    if (method === 'POST') {
      let body = {}; try { body = await request.json(); } catch {}
      return createConversation(env, user.id, body || {});
    }
    return json(405, { error: 'Method Not Allowed' });
  }

  const m = pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') return getConversation(env, user.id, id);
    if (method === 'PATCH') {
      let body = {}; try { body = await request.json(); } catch {}
      return patchConversation(env, user.id, id, body || {});
    }
    if (method === 'DELETE') return deleteConversation(env, user.id, id);
    return json(405, { error: 'Method Not Allowed' });
  }

  return json(404, { error: 'Not found' });
}
