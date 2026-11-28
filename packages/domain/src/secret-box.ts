/**
 * AES-256-GCM secret box for encrypting MFA secrets at rest.
 *
 * Wire format: `v1:<iv>:<tag>:<ciphertext>`, every binary part base64url.
 * Decryption authenticates the payload; tampering or a wrong key throws.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const SECRET_BOX_VERSION = 'v1';
export const SECRET_BOX_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function assertKey(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.length !== SECRET_BOX_KEY_BYTES) {
    throw new Error(`密钥必须为 ${SECRET_BOX_KEY_BYTES} 字节`);
  }
  return Buffer.from(key);
}

/** Encrypt a UTF-8 string; returns `v1:<iv>:<tag>:<ciphertext>` (base64url). */
export function encryptSecret(plaintext: string, key: Uint8Array): string {
  const keyBuffer = assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SECRET_BOX_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
    ':',
  );
}

/** Decrypt a payload produced by `encryptSecret`; throws on tamper/wrong key. */
export function decryptSecret(payload: string, key: Uint8Array): string {
  const keyBuffer = assertKey(key);
  const parts = String(payload).split(':');
  const [version, ivPart, tagPart, dataPart] = parts;
  if (parts.length !== 4 || version !== SECRET_BOX_VERSION || !ivPart || !tagPart || dataPart === undefined) {
    throw new Error('密文格式无效');
  }
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('密文格式无效');
  const decipher = createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('密文校验失败');
  }
}