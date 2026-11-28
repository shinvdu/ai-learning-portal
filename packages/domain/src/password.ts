/**
 * Password hashing: Argon2id for new hashes, transparent upgrade for legacy
 * v1 `scrypt$salt$hash` values.
 *
 * Verification always returns `{valid, needsRehash}` so the API layer can
 * re-hash a user's password after a successful login with an old scheme.
 */

import { scryptSync, timingSafeEqual } from 'node:crypto';
import { hash as argon2Hash, parseOptions, verify as argon2Verify } from '@node-rs/argon2';
import type { PasswordVerifyResult } from './types.js';

const SCRYPT_KEYLEN = 64;
/** Numeric value of `Algorithm.Argon2id` in the PHC/NAPI representation. */
const ARGON2ID = 2;

/**
 * OWASP-aligned Argon2id parameters (19 MiB, 2 passes, 1 lane).
 * `@node-rs/argon2` defaults to Argon2id when no algorithm is given.
 */
export const ARGON2_POLICY = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/** Hash a password with Argon2id. */
export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(String(password), ARGON2_POLICY);
}

/**
 * Verify a password against an Argon2id or legacy scrypt hash.
 *
 * Legacy scrypt hashes always report `needsRehash: true`; Argon2id hashes
 * report it only when their parameters differ from the current policy.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<PasswordVerifyResult> {
  const value = String(stored ?? '');
  if (!value) return { valid: false, needsRehash: false };

  if (value.startsWith('$argon2')) {
    let valid = false;
    try {
      valid = await argon2Verify(value, String(password));
    } catch {
      return { valid: false, needsRehash: false };
    }
    if (!valid) return { valid: false, needsRehash: false };
    return { valid: true, needsRehash: argon2NeedsRehash(value) };
  }

  if (value.startsWith('scrypt$')) {
    return { valid: verifyScrypt(String(password), value), needsRehash: true };
  }

  return { valid: false, needsRehash: false };
}

function argon2NeedsRehash(value: string): boolean {
  try {
    const params = parseOptions(value);
    return (
      params.algorithm !== ARGON2ID ||
      params.memoryCost !== ARGON2_POLICY.memoryCost ||
      params.timeCost !== ARGON2_POLICY.timeCost ||
      params.parallelism !== ARGON2_POLICY.parallelism ||
      params.outputLen !== ARGON2_POLICY.outputLen
    );
  } catch {
    return true;
  }
}

/** Timing-safe verification of the legacy `scrypt$salt$hash` format. */
function verifyScrypt(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1]!, 'base64url');
    const expected = Buffer.from(parts[2]!, 'base64url');
    if (expected.length !== SCRYPT_KEYLEN) return false;
    const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}