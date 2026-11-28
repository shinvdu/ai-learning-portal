/**
 * Static asset and SPA serving (F034).
 *
 * - `apps/web/public/assets` is always served at `/assets` (dev-friendly media
 *   such as the placeholder course video), with Range support from
 *   `express.static` (single-range 206/416).
 * - `apps/web/dist` is served only when `SERVE_WEB=1` (single-process mode;
 *   production normally uses Nginx).
 * - SPA fallback applies only to GET/HEAD extensionless non-`/api` paths; a
 *   missing path with an extension is a plain 404. Serving `index.html` issues
 *   the readable `aip_csrf` cookie when absent (v1 behaviour).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type RequestHandler } from 'express';
import type { Env } from '@portal/config';
import { ensureCsrfCookie } from './csrf.js';

const ASSETS_DIR = fileURLToPath(new URL('../../../web/public/assets', import.meta.url));
const WEB_DIST_DIR = fileURLToPath(new URL('../../../web/dist', import.meta.url));

const noCache = (res: { setHeader(name: string, value: string): unknown }): void => {
  res.setHeader('Cache-Control', 'no-cache');
};

/** Extensionless GET/HEAD paths fall back to the built SPA shell. */
function spaFallback(env: Env): RequestHandler {
  const indexFile = path.join(WEB_DIST_DIR, 'index.html');
  return (req, res, next) => {
    if (!env.SERVE_WEB) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    if (path.extname(req.path)) return next();
    if (!fs.existsSync(indexFile)) return next();

    ensureCsrfCookie(req, res);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile, (error?: Error) => {
      if (error) next(error);
    });
    return undefined;
  };
}

export function mountStatic(app: Express, env: Env): void {
  if (fs.existsSync(ASSETS_DIR)) {
    app.use('/assets', express.static(ASSETS_DIR, { index: false, setHeaders: noCache }));
  }
  if (env.SERVE_WEB && fs.existsSync(WEB_DIST_DIR)) {
    app.use(express.static(WEB_DIST_DIR, { index: false, setHeaders: noCache }));
  }
  app.use(spaFallback(env));

  // Final non-API fallback: 405 for non-GET/HEAD, plain-text 404 otherwise.
  app.use((req, res, next) => {
    if (res.headersSent) {
      next();
      return;
    }
    res.type('text/plain; charset=utf-8');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method not allowed');
      return;
    }
    res.status(404).send('Not found');
  });
}

export { ASSETS_DIR, WEB_DIST_DIR };