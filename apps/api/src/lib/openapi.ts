/**
 * API documentation helpers (F036).
 *
 * `buildDocument(env)` wraps the pure `@portal/contracts` builder with the
 * deployment's public origin. The document is generated once per environment
 * and cached, because it only depends on static route metadata.
 *
 * Docs exposure follows F036: enabled when `ENABLE_API_DOCS=1` or when
 * `APP_ENV !== 'production'`; production deployments can opt in explicitly.
 */
import type { Env } from '@portal/config';
import { buildOpenApiDocument, type OpenApiDocument } from '@portal/contracts';

export type OpenApiEnv = Pick<Env, 'APP_ENV' | 'ENABLE_API_DOCS' | 'PUBLIC_BASE_URL'>;

/** True when the interactive docs page may be served. */
export function apiDocsEnabled(env: Pick<Env, 'APP_ENV' | 'ENABLE_API_DOCS'>): boolean {
  return env.ENABLE_API_DOCS || env.APP_ENV !== 'production';
}

const documents = new WeakMap<object, OpenApiDocument>();

/**
 * Build (and memoize) the OpenAPI document for an env object. The env object is
 * stable for the process lifetime, so the document is serialized once.
 */
export function getOpenApiDocument(env: OpenApiEnv): OpenApiDocument {
  const cached = documents.get(env);
  if (cached) return cached;
  const document = buildOpenApiDocument({ serverUrl: env.PUBLIC_BASE_URL });
  documents.set(env, document);
  return document;
}

/** Serialized spec body, suitable for `GET /openapi.json`. */
export function getOpenApiJson(env: OpenApiEnv): string {
  return JSON.stringify(getOpenApiDocument(env));
}