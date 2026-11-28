/**
 * Security headers via helmet, preserving the v1 CSP and adding the
 * cross-origin / permissions headers v1 set manually. API responses are
 * `Cache-Control: no-store`; HSTS is only emitted in production.
 */
import helmet from 'helmet';
import type { RequestHandler } from 'express';
import type { Env } from '@portal/config';
import { isProduction } from '../config.js';

export const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';

export function securityHeaders(env: Env): RequestHandler {
  const helmetMiddleware = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        workerSrc: ["'none'"],
        manifestSrc: ["'self'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    xFrameOptions: { action: 'deny' },
    strictTransportSecurity: isProduction(env)
      ? { maxAge: 15_552_000, includeSubDomains: true }
      : false,
  });

  return (req, res, next) => {
    helmetMiddleware(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
      if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
      next();
    });
  };
}