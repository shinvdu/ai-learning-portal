import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  constantTimeEqual,
  generateRecoveryCodes,
  generateTotp,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  otpauthUri,
  verifyRecoveryCode,
  verifyTotp,
} from '../src/index.js';

// RFC 4226 / RFC 6238 shared secret: ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
// RFC 4226 Appendix D, 6-digit HOTP values for counters 0..9.
const RFC_HOTP_6 = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

describe('base32', () => {
  it('matches the RFC 4648 encoding of the RFC secret', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString('ascii')).toBe('12345678901234567890');
  });

  it('round-trips random secrets and ignores spacing/padding/case', () => {
    const secret = generateTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    const spaced = `${secret.slice(0, 4).toLowerCase()} ${secret.slice(4)}=`;
    expect(base32Decode(spaced).equals(base32Decode(secret))).toBe(true);
  });

  it('throws on invalid base32 characters', () => {
    expect(() => base32Decode('NOT!BASE32')).toThrow('Invalid base32 secret');
  });
});

describe('TOTP', () => {
  it('matches RFC 4226 6-digit HOTP vectors at each 30s step', () => {
    RFC_HOTP_6.forEach((expected, counter) => {
      expect(generateTotp(RFC_SECRET, counter * 30_000 + 5_000)).toBe(expected);
    });
  });

  it('verifies the current code and both adjacent windows, not +-2', () => {
    const at = 95_000; // counter 3
    const code = generateTotp(RFC_SECRET, at);
    expect(code).toBe('969429');
    expect(verifyTotp(RFC_SECRET, code, at)).toBe(true);
    // Codes one step before/after are accepted at a fixed clock.
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, at - 30_000), at)).toBe(true);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, at + 30_000), at)).toBe(true);
    // Codes two steps away are rejected.
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, at + 60_000), at)).toBe(false);
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, at - 60_000), at)).toBe(false);
  });

  it('rejects malformed codes', () => {
    const at = 59_000;
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5', null, undefined]) {
      expect(verifyTotp(RFC_SECRET, bad as string | null | undefined, at)).toBe(false);
    }
  });
});

describe('otpauth URI', () => {
  it('encodes issuer, label and parameters', () => {
    const uri = otpauthUri('student@example.com', 'ABCDEF234567');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    const url = new URL(uri);
    expect(decodeURIComponent(url.pathname)).toBe('/AI Learning Portal:student@example.com');
    expect(url.searchParams.get('secret')).toBe('ABCDEF234567');
    expect(url.searchParams.get('issuer')).toBe('AI Learning Portal');
    expect(url.searchParams.get('algorithm')).toBe('SHA1');
    expect(url.searchParams.get('digits')).toBe('6');
    expect(url.searchParams.get('period')).toBe('30');
  });
});

describe('recovery codes', () => {
  it('generates 8 well-formed codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(new Set(codes).size).toBe(8);
  });

  it('normalizes case, spaces and hyphens before hashing', () => {
    const code = 'ABCD-EFGH';
    const hash = hashRecoveryCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashRecoveryCode('abcd efgh'));
    expect(hash).toBe(hashRecoveryCode(' abcd-efgh '));
    expect(normalizeRecoveryCode('ab-cd efgh')).toBe('ABCDEFGH');
  });

  it('verifies in constant time and rejects wrong codes', () => {
    const hash = hashRecoveryCode('WXYZ-2345');
    expect(verifyRecoveryCode('wxyz-2345', hash)).toBe(true);
    expect(verifyRecoveryCode('WXYZ-2346', hash)).toBe(false);
    expect(verifyRecoveryCode(null, hash)).toBe(false);
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});