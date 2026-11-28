import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/index.js';

const key = randomBytes(32);

describe('secret box (AES-256-GCM)', () => {
  it('round-trips unicode plaintext with a v1:iv:tag:ciphertext payload', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP 中文 😀';
    const payload = encryptSecret(plaintext, key);
    expect(payload).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*$/);
    expect(decryptSecret(payload, key)).toBe(plaintext);
  });

  it('uses a fresh IV for every encryption', () => {
    const a = encryptSecret('same', key);
    const b = encryptSecret('same', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('same');
    expect(decryptSecret(b, key)).toBe('same');
  });

  it('round-trips the empty string', () => {
    expect(decryptSecret(encryptSecret('', key), key)).toBe('');
  });

  it('throws when the ciphertext or tag is tampered with', () => {
    const parts = encryptSecret('sensitive', key).split(':');
    const ciphertext = Buffer.from(parts[3]!, 'base64url');
    ciphertext[0] = ciphertext[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], ciphertext.toString('base64url')].join(':');
    expect(() => decryptSecret(tampered, key)).toThrow('密文校验失败');

    const tag = Buffer.from(parts[2]!, 'base64url');
    tag[0] = tag[0]! ^ 0xff;
    const badTag = [parts[0], parts[1], tag.toString('base64url'), parts[3]].join(':');
    expect(() => decryptSecret(badTag, key)).toThrow('密文校验失败');
  });

  it('throws on the wrong key and on malformed payloads/keys', () => {
    const payload = encryptSecret('secret', key);
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow('密文校验失败');
    expect(() => decryptSecret('junk', key)).toThrow('密文格式无效');
    expect(() => decryptSecret('v2:a:b:c', key)).toThrow('密文格式无效');
    expect(() => decryptSecret('v1:a:b:c', key)).toThrow('密文格式无效');
    expect(() => encryptSecret('x', randomBytes(16))).toThrow('32 字节');
    expect(() => decryptSecret(payload, randomBytes(16))).toThrow('32 字节');
  });
});