import { randomBytes, scryptSync } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/index.js';

const legacyScrypt = (password: string, keylen = 64): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, keylen);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
};

describe('hashPassword / verifyPassword', () => {
  it('hashes with Argon2id and verifies without rehash', async () => {
    const stored = await hashPassword('correct horse 电池 123');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword('correct horse 电池 123', stored)).resolves.toEqual({ valid: true, needsRehash: false });
    await expect(verifyPassword('wrong', stored)).resolves.toEqual({ valid: false, needsRehash: false });
  });

  it('flags Argon2id hashes made with outdated parameters', async () => {
    const old = await argon2Hash('legacy-argon', { timeCost: 1 });
    await expect(verifyPassword('legacy-argon', old)).resolves.toEqual({ valid: true, needsRehash: true });
  });

  it('verifies legacy scrypt hashes and asks for a rehash', async () => {
    const stored = legacyScrypt('old-password');
    await expect(verifyPassword('old-password', stored)).resolves.toEqual({ valid: true, needsRehash: true });
    await expect(verifyPassword('other', stored)).resolves.toEqual({ valid: false, needsRehash: true });
  });

  it('rejects malformed or unknown stored values without throwing', async () => {
    await expect(verifyPassword('x', null)).resolves.toEqual({ valid: false, needsRehash: false });
    await expect(verifyPassword('x', '')).resolves.toEqual({ valid: false, needsRehash: false });
    await expect(verifyPassword('x', 'plain-text')).resolves.toEqual({ valid: false, needsRehash: false });
    await expect(verifyPassword('x', 'scrypt$only')).resolves.toEqual({ valid: false, needsRehash: true });
    await expect(verifyPassword('x', 'scrypt$AAAA$AAAA')).resolves.toEqual({ valid: false, needsRehash: true });
  });

  it('keeps scrypt verification timing-safe (wrong-length digests fail cleanly)', async () => {
    const stored = legacyScrypt('pw', 32);
    await expect(verifyPassword('pw', stored)).resolves.toEqual({ valid: false, needsRehash: true });
  });
});