// Shared helpers: ids, time, WebCrypto password hashing, session tokens,
// and cookie parsing/serialisation. Zero deps — Workers-native only.

export const now = () => Date.now();
export const newId = () => crypto.randomUUID();

// --- byte / hex helpers -----------------------------------------------------
function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// --- password hashing: PBKDF2-HMAC-SHA256 (Workers-native) ------------------
// bcrypt/argon2 are unavailable in Workers; PBKDF2 via WebCrypto is the
// supported path. Per-user 16-byte salt; SESSION_SECRET acts as a pepper.
const PBKDF2_ITERATIONS = 150000;
const PBKDF2_KEYLEN_BITS = 256;

async function pbkdf2(password, saltBytes, pepper) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password + (pepper || '')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_KEYLEN_BITS
  );
  return new Uint8Array(bits);
}

// Returns { hash, salt } as hex strings to store in the users table.
export async function hashPassword(password, pepper) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, pepper);
  return { hash: toHex(hash), salt: toHex(salt) };
}

// Constant-time verify against stored hex hash + salt.
export async function verifyPassword(password, storedHashHex, storedSaltHex, pepper) {
  const computed = await pbkdf2(password, fromHex(storedSaltHex), pepper);
  const stored = fromHex(storedHashHex);
  if (computed.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed[i] ^ stored[i];
  return diff === 0;
}

// --- session tokens ---------------------------------------------------------
// Opaque 32-byte token goes to the client cookie; only its SHA-256 hash is
// stored server-side, so a DB leak can't be replayed as a live session.
export function newSessionToken() {
  return toHex(randomBytes(32));
}
export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

// --- cookies ----------------------------------------------------------------
export const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // ~30 days
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SEC * 1000;

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}`;
}
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// --- session lookup ---------------------------------------------------------
// Resolve the current user from the session cookie (single indexed D1 lookup).
// Returns { id, username, email } or null. Lazily prunes expired sessions.
export async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.username AS username, u.email AS email, s.expires_at AS expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  ).bind(tokenHash).first();

  if (!row) return null;
  if (row.expires_at <= now()) {
    // Expired: clean it up, treat as logged out.
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return { id: row.id, username: row.username, email: row.email };
}
