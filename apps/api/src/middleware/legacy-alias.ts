/**
 * Legacy `/api` alias headers (ADR-010). The canonical prefix is `/api/v1`;
 * requests through `/api` get `Deprecation: true` plus a successor `Link`
 * header. The handlers themselves are the same router instance, not a copy.
 */
import type { RequestHandler } from 'express';
import { API_V1_PREFIX } from '@portal/config';

export const legacyAlias: RequestHandler = (req, res, next) => {
  if (req.originalUrl.startsWith(API_V1_PREFIX)) {
    next();
    return;
  }
  const successor = req.originalUrl.replace(/^\/api(?=\/|$)/, API_V1_PREFIX);
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `<${successor}>; rel="successor-version"`);
  next();
};