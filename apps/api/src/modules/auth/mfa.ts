/**
 * MFA secret encryption (F043).
 *
 * `users.mfa_secret` never stores a plaintext TOTP secret. Values are encrypted
 * with AES-256-GCM (`@portal/domain` secret box) using a 32-byte key derived by
 * SHA-256 from `MFA_ENC_KEY`.
 *
 * - Production: `MFA_ENC_KEY` is mandatory (the environment schema enforces it
 *   too); a missing key throws instead of falling back.
 * - Development/test: a fixed, well-known key is derived and a warning is
 *   logged once per process, so workshop installs work without extra setup.
 */
import { createHash } from 'node:crypto';
import type { Env } from '@portal/config';
import type { Logger } from 'pino';
import { decryptSecret, encryptSecret } from '@portal/domain';

/** Fixed development key material; never used when MFA_ENC_KEY is set. */
export const DEV_MFA_KEY_SEED = 'ai-learning-portal-dev-mfa-enc-key';

export type MfaCipher = {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
};

let warnedDevKey = false;

function production(env: Pick<Env, 'APP_ENV' | 'NODE_ENV'>): boolean {
  return env.APP_ENV === 'production' || env.NODE_ENV === 'production';
}

/** SHA-256 → 32-byte AES key. Stable for the same configured string. */
export function deriveMfaKey(source: string): Buffer {
  return createHash('sha256').update(source).digest();
}

export function createMfaCipher(
  env: Pick<Env, 'APP_ENV' | 'NODE_ENV' | 'MFA_ENC_KEY'>,
  logger?: Logger,
): MfaCipher {
  let source = String(env.MFA_ENC_KEY ?? '').trim();
  if (!source) {
    if (production(env)) throw new Error('生产环境必须设置 MFA_ENC_KEY');
    if (!warnedDevKey) {
      warnedDevKey = true;
      logger?.warn(
        'MFA_ENC_KEY 未设置，开发环境使用固定派生密钥；生产环境必须配置 MFA_ENC_KEY',
      );
    }
    source = DEV_MFA_KEY_SEED;
  }
  const key = deriveMfaKey(source);
  return {
    encrypt: (plaintext: string) => encryptSecret(plaintext, key),
    decrypt: (payload: string) => decryptSecret(payload, key),
  };
}