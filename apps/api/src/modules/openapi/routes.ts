/**
 * OpenAPI spec + interactive documentation router (F036).
 *
 * Exports `createOpenApiRouter(env)`; the Integrate agent mounts it in
 * `app.ts`. Mounting it under the canonical router (`app.use('/api/v1', ...)`)
 * yields `GET /api/v1/openapi.json` and `GET /api/v1/docs`. Mounting it at the
 * root yields `GET /openapi.json` and `GET /docs`. Both are spec-relative: the
 * Scalar URL is derived from `req.baseUrl`, so no absolute paths are baked in.
 *
 * - `GET /openapi.json` — 200 JSON OpenAPI 3.1 document, `Cache-Control: no-store`.
 * - `GET /docs` — Scalar UI when docs are enabled, otherwise 404.
 */
import express, { type Request, type RequestHandler, type Response, type Router } from 'express';
import { Scalar } from '@scalar/express-api-reference';
import { apiDocsEnabled, getOpenApiJson, type OpenApiEnv } from '../../lib/openapi.js';

/**
 * Scalar loads its UI bundle from jsDelivr, which the global API CSP
 * (`script-src 'self'`) would block. Relax the policy only for the docs page
 * and keep everything else strict.
 */
const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function createOpenApiRouter(env: OpenApiEnv): Router {
  const router = express.Router();
  // Serialize eagerly so the first request cannot fail on document generation.
  const specJson = getOpenApiJson(env);

  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/json');
    res.status(200).send(specJson);
  });

  router.get('/docs', (req: Request, res: Response, next) => {
    if (!apiDocsEnabled(env)) {
      res.status(404).json({ error: '接口不存在' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', DOCS_CSP);
    const specUrl = `${req.baseUrl || ''}/openapi.json`;
    const handler = Scalar({
      url: specUrl,
      pageTitle: 'AI Learning Portal API',
    }) as unknown as RequestHandler;
    handler(req, res, next);
  });

  return router;
}