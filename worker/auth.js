// Phase 2 — username/password auth. Register / login / logout / me.
// PBKDF2 hashing + opaque session-token cookies (see worker/db.js).

import { corsHeaders } from './chat.js';
import {
  now, newId, hashPassword, verifyPassword,
  newSessionToken, hashToken,
  sessionCookie, clearSessionCookie, parseCookies, SESSION_COOKIE, SESSION_MAX_AGE_MS,
  getSessionUser,
} from './db.js';

function json(status, obj, extraHeaders) {
  const headers = new Headers({ ...corsHeaders, 'Content-Type': 'application/json' });
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers.append(k, v);
  return new Response(JSON.stringify(obj), { status, headers });
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3–32 chars: letters, numbers, and _ . - only.';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return 'Password must be 8–200 characters.';
  }
  return null;
}

// Create a session row and return the Set-Cookie value.
async function startSession(env, userId) {
  const token = newSessionToken();
  const tokenHash = await hashToken(token);
  const ts = now();
  await env.DB.prepare(
    'INSERT INTO chat_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(tokenHash, userId, ts, ts + SESSION_MAX_AGE_MS).run();
  return sessionCookie(token);
}

async function register(request, env) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const username = (body.username || '').trim();
  const email = body.email ? String(body.email).trim() : null;
  const password = body.password || '';

  const invalid = validateCredentials(username, password);
  if (invalid) return json(400, { error: invalid });

  const existing = await env.DB.prepare(
    'SELECT id FROM chat_users WHERE username = ? COLLATE NOCASE'
  ).bind(username).first();
  if (existing) return json(409, { error: 'That username is already taken.' });

  const { hash, salt } = await hashPassword(password, env.SESSION_SECRET);
  const id = newId();
  try {
    await env.DB.prepare(
      'INSERT INTO chat_users (id, username, password_hash, password_salt, email, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, username, hash, salt, email, now()).run();
  } catch (e) {
    // UNIQUE race → treat as dup.
    if (String(e?.message || '').includes('UNIQUE')) return json(409, { error: 'That username is already taken.' });
    throw e;
  }

  const cookie = await startSession(env, id);
  return json(201, { user: { id, username, email } }, { 'Set-Cookie': cookie });
}

async function login(request, env) {
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!username || !password) return json(400, { error: 'Username and password are required.' });

  const user = await env.DB.prepare(
    'SELECT id, username, password_hash, password_salt, email FROM chat_users WHERE username = ? COLLATE NOCASE'
  ).bind(username).first();

  // Generic message either way (don't reveal whether the username exists).
  const ok = user && await verifyPassword(password, user.password_hash, user.password_salt, env.SESSION_SECRET);
  if (!ok) return json(401, { error: 'Invalid username or password.' });

  const cookie = await startSession(env, user.id);
  return json(200, { user: { id: user.id, username: user.username, email: user.email } }, { 'Set-Cookie': cookie });
}

async function logout(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) {
    const tokenHash = await hashToken(token);
    await env.DB.prepare('DELETE FROM chat_sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
}

async function me(request, env) {
  const user = await getSessionUser(request, env);
  return json(200, { user: user || null });
}

// Router for /api/auth/*
export async function handleAuth(request, env, pathname) {
  const method = request.method;
  if (pathname === '/api/auth/register' && method === 'POST') return register(request, env);
  if (pathname === '/api/auth/login' && method === 'POST') return login(request, env);
  if (pathname === '/api/auth/logout' && method === 'POST') return logout(request, env);
  if (pathname === '/api/auth/me' && method === 'GET') return me(request, env);
  return json(404, { error: 'Not found' });
}
