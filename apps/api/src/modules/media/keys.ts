/**
 * Media key rules (F094).
 *
 * Keys are flat object names: `[A-Za-z0-9][A-Za-z0-9._-]{0,128}`. No slashes,
 * no leading dot, which rules out `..` / absolute paths / hidden metadata.
 * New keys are 128-bit random hex plus a short, sanitised extension.
 */
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const MEDIA_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$/;

/** Safe extension characters are limited to short alphanumerics. */
const SAFE_EXTENSION_PATTERN = /^\.[a-z0-9]{1,10}$/;

export function isValidMediaKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '.' &&
    value !== '..' &&
    MEDIA_KEY_PATTERN.test(value)
  );
}

/**
 * Generate a safe, unguessable key from an optional original filename. The
 * filename itself is never used, only a short sanitised extension.
 */
export function generateMediaKey(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  const suffix = SAFE_EXTENSION_PATTERN.test(extension) ? extension : '';
  return `${randomBytes(16).toString('hex')}${suffix}`;
}