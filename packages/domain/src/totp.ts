/**
 * TOTP / recovery-code primitives.
 *
 * Ported 1:1 from v1 `src/totp.js`: RFC 6238 TOTP with SHA-1, 6 digits and a
 * 30 second period, plus a ±1 step verification window. Codes are compared in
 * constant time.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;

export const TOTP_PERIOD_SECONDS = PERIOD_SECONDS;
export const TOTP_DIGITS = DIGITS;

/** Base32-encode raw bytes using the RFC 4648 alphabet (no padding). */
export function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode a base32 secret; whitespace, `=` and `-` are ignored. */
export function base32Decode(input: string): Buffer {
  const clean = String(input)
    .toUpperCase()
    .replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a fresh base32 TOTP secret (20 random bytes by default). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Compute the current 6-digit TOTP for a base32 secret at a given epoch ms. */
export function generateTotp(secret: string, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / PERIOD_SECONDS);
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Constant-time string comparison that is safe for equal-length strings. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Verify a user-supplied TOTP code within a ±1 step (30s) window. */
export function verifyTotp(secret: string, code: string | null | undefined, at: number = Date.now()): boolean {
  const input = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(input)) return false;
  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = generateTotp(secret, at + offset * PERIOD_SECONDS * 1000) as string;
    if (constantTimeEqual(expected, input)) return true;
  }
  return false;
}

/** Build a standard `otpauth://` provisioning URI. */
export function otpauthUri(email: string, secret: string, issuer = 'AI Learning Portal'): string {
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/** Generate `count` recovery codes in `XXXX-XXXX` form. */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

/** Canonical recovery-code form: uppercase, no spaces or hyphens. */
export function normalizeRecoveryCode(code: string | null | undefined): string {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

/** SHA-256 hex digest of the normalized recovery code (what gets stored). */
export function hashRecoveryCode(code: string | null | undefined): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

/** Constant-time check of a user-supplied code against a stored hash. */
export function verifyRecoveryCode(code: string | null | undefined, storedHash: string): boolean {
  return constantTimeEqual(hashRecoveryCode(code), String(storedHash).toLowerCase());
}