/**
 * F036 unit tests: OpenAPI document shape and docs gating.
 *
 * No database or Redis is touched — the router only serializes the static
 * document and renders the Scalar shell.
 */
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, OPENAPI_TAGS, buildOpenApiDocument } from '@portal/contracts';
import { apiDocsEnabled, getOpenApiDocument } from '../../src/lib/openapi.js';
import { createOpenApiRouter } from '../../src/modules/openapi/routes.js';
import type { OpenApiEnv } from '../../src/lib/openapi.js';

const DEV_ENV: OpenApiEnv = {
  APP_ENV: 'development',
  ENABLE_API_DOCS: false,
  PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
};

const PROD_ENV: OpenApiEnv = {
  APP_ENV: 'production',
  ENABLE_API_DOCS: false,
  PUBLIC_BASE_URL: 'https://portal.example.com',
};

const PROD_DOCS_ENV: OpenApiEnv = { ...PROD_ENV, ENABLE_API_DOCS: true };

function appFor(env: OpenApiEnv): Express {
  const app = express();
  // Mirror the canonical mount point without pulling in DB/session middleware.
  app.use('/api/v1', createOpenApiRouter(env));
  return app;
}

type Json = Record<string, unknown>;

const KEY_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/csrf',
  '/api/v1/courses',
  '/api/v1/dashboard',
  '/api/v1/records',
  '/api/v1/admin/users',
  '/api/v1/admin/courses',
  '/api/v1/admin/audit',
  '/api/v1/admin/dataset/snapshots',
  '/api/v1/media/{key}',
  '/healthz',
] as const;

function collectRefs(node: unknown, refs: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, refs);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Json)) {
      if (key === '$ref' && typeof value === 'string') refs.push(value);
      else collectRefs(value, refs);
    }
  }
  return refs;
}

function resolvePointer(root: Json, pointer: string): unknown {
  if (!pointer.startsWith('#/')) return undefined;
  let current: unknown = root;
  for (const rawPart of pointer.slice(2).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Json)[part];
  }
  return current;
}

describe('OpenAPI document', () => {
  const document = buildOpenApiDocument({ serverUrl: 'https://portal.example.com' }) as Json;

  it('is OpenAPI 3.1 with the published info block', () => {
    expect(document.openapi).toBe('3.1.0');
    const info = document.info as Json;
    expect(info.title).toBe('AI Learning Portal API');
    expect(info.version).toBe('2.0.0');
    expect(typeof info.description).toBe('string');
    expect(document.servers).toEqual([
      { url: 'https://portal.example.com', description: '当前部署' },
    ]);
  });

  it('covers every route group at the canonical /api/v1 prefix', () => {
    const paths = document.paths as Json;
    for (const path of KEY_PATHS) {
      expect(paths[path], `missing path ${path}`).toBeTypeOf('object');
    }
    expect(paths['/readyz']).toBeTypeOf('object');
    expect(paths['/api/v1/knowledge/{id}']).toBeTypeOf('object');
    expect(paths['/api/v1/chapters/{courseId}/{idx}']).toBeTypeOf('object');
    expect(paths['/api/v1/insights']).toBeTypeOf('object');
    expect(paths['/api/v1/export.csv']).toBeTypeOf('object');
    expect(paths['/api/v1/admin/dataset/restore/{id}']).toBeTypeOf('object');
    expect(paths['/api/v1/admin/media/presign']).toBeTypeOf('object');
    expect(paths['/api/v1/admin/media/upload']).toBeTypeOf('object');
    expect(paths['/assets/{path}']).toBeTypeOf('object');
  });

  it('documents records CRUD + pagination and the CSV import media types', () => {
    const records = (document.paths as Json)['/api/v1/records'] as Json;
    expect(Object.keys(records).sort()).toEqual(['get', 'post']);

    const get = records.get as Json;
    const paramNames = (get.parameters as Json[]).map((param) => param.name);
    expect(paramNames).toEqual(expect.arrayContaining(['limit', 'offset', 'course', 'student', 'q']));
    expect(get.security).toEqual([{ sessionCookie: [] }]);

    const importOp = ((document.paths as Json)['/api/v1/records/import'] as Json).post as Json;
    const body = importOp.requestBody as Json;
    const content = body.content as Json;
    expect(Object.keys(content).sort()).toEqual(['application/json', 'text/csv']);
  });

  it('publishes cookie + CSRF security schemes', () => {
    const components = document.components as Json;
    const schemes = components.securitySchemes as Json;
    expect(schemes.sessionCookie).toMatchObject({ type: 'apiKey', in: 'cookie', name: 'aip_session' });
    expect(schemes.csrfCookie).toMatchObject({ type: 'apiKey', in: 'cookie', name: 'aip_csrf' });
    expect(schemes.csrfToken).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' });

    const login = ((document.paths as Json)['/api/v1/auth/login'] as Json).post as Json;
    expect(login.security).toEqual([{ csrfToken: [] }]);
    const createRecord = ((document.paths as Json)['/api/v1/records'] as Json).post as Json;
    expect(createRecord.security).toEqual([{ sessionCookie: [], csrfToken: [] }]);
  });

  it('uses the shared audit action constants and stable tags', () => {
    const components = document.components as Json;
    const auditAction = (components.schemas as Json).AuditAction as Json;
    expect(auditAction.enum).toEqual([...AUDIT_ACTIONS]);

    const audit = ((document.paths as Json)['/api/v1/admin/audit'] as Json).get as Json;
    const actionParam = (audit.parameters as Json[]).find((param) => param.name === 'action') as Json;
    expect((actionParam.schema as Json).enum).toEqual([...AUDIT_ACTIONS]);

    expect((document.tags as Json[]).map((tag) => tag.name)).toEqual(
      OPENAPI_TAGS.map((tag) => tag.name),
    );
  });

  it('has no unresolved $ref pointers', () => {
    const refs = collectRefs(document);
    expect(refs.length).toBeGreaterThan(0);
    for (const pointer of refs) {
      expect(pointer.startsWith('#/components/'), `non-component ref ${pointer}`).toBe(true);
      expect(resolvePointer(document, pointer), `unresolved ${pointer}`).toBeDefined();
    }
  });

  it('memoizes the document per env object', () => {
    expect(getOpenApiDocument(DEV_ENV)).toBe(getOpenApiDocument(DEV_ENV));
    expect(getOpenApiDocument(DEV_ENV)).not.toBe(getOpenApiDocument(PROD_ENV));
  });
});

describe('docs gating', () => {
  it('enables docs outside production', () => {
    expect(apiDocsEnabled(DEV_ENV)).toBe(true);
  });

  it('disables docs in production unless ENABLE_API_DOCS=1', () => {
    expect(apiDocsEnabled(PROD_ENV)).toBe(false);
    expect(apiDocsEnabled(PROD_DOCS_ENV)).toBe(true);
  });
});

describe('createOpenApiRouter', () => {
  it('serves the spec as no-store JSON', async () => {
    const response = await request(appFor(DEV_ENV)).get('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.info.title).toBe('AI Learning Portal API');
    expect(response.body.paths['/api/v1/auth/login']).toBeTypeOf('object');
  });

  it('serves the Scalar UI when enabled', async () => {
    const response = await request(appFor(DEV_ENV)).get('/api/v1/docs');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('/api/v1/openapi.json');
    expect(response.headers['content-security-policy']).toContain('https://cdn.jsdelivr.net');
  });

  it('returns 404 for docs in production without the flag', async () => {
    const response = await request(appFor(PROD_ENV)).get('/api/v1/docs');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '接口不存在' });
  });

  it('allows docs in production when explicitly enabled', async () => {
    const response = await request(appFor(PROD_DOCS_ENV)).get('/api/v1/docs');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });
});