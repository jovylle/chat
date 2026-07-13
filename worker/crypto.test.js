// Unit tests for the security-sensitive bits: PBKDF2 password hashing, session
// token hashing, and the title helper. Run with `npm test` (vitest, node env —
// globalThis.crypto/WebCrypto is available in Node 19+).
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, newSessionToken, hashToken } from './db.js';
import { generateTitle } from './chat.js';

describe('password hashing (PBKDF2)', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const { hash, salt } = await hashPassword('correct horse battery', 'pepper');
    expect(await verifyPassword('correct horse battery', hash, salt, 'pepper')).toBe(true);
    expect(await verifyPassword('wrong password', hash, salt, 'pepper')).toBe(false);
  });

  it('uses a random salt so the same password hashes differently each time', async () => {
    const a = await hashPassword('samePassword', 'pep');
    const b = await hashPassword('samePassword', 'pep');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('binds to the pepper (SESSION_SECRET)', async () => {
    const { hash, salt } = await hashPassword('pw12345678', 'pepper-one');
    expect(await verifyPassword('pw12345678', hash, salt, 'pepper-two')).toBe(false);
  });
});

describe('session tokens', () => {
  it('mints a 32-byte (64 hex) opaque token', () => {
    expect(newSessionToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes tokens deterministically and never stores the raw token', async () => {
    const token = newSessionToken();
    const h1 = await hashToken(token);
    const h2 = await hashToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(token);
  });
});

describe('generateTitle', () => {
  it('keeps short titles verbatim', () => {
    expect(generateTitle('short one')).toBe('short one');
  });
  it('truncates long titles to 40 chars + ellipsis', () => {
    expect(generateTitle('x'.repeat(60))).toBe('x'.repeat(40) + '...');
  });
});
