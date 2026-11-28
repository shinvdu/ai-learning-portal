/**
 * Express application factory (F030).
 *
 * `createApp(deps)` assembles the middleware chain in the documented order and
 * returns an app that can be driven by supertest without listening on a port:
 *
 *   trust proxy → request-id → pino-http → security headers → health →
 *   body parsers → Origin → CSRF → cookies → session → routers →
 *   API 404 → non-API 405/404 → static/SPA → error handler
 *
 * The canonical router is mounted at `/api/v1`; the same instance is mounted at
 * `/api` with `Deprecation`/`Link` headers (ADR-010).
 */
import express, { type Express, type Request, type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import pinoHttpModule, { type Options as PinoHttpOptions } from 'pino-http';
import type { AppDeps } from './lib/types.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { requestSerializer, responseSerializer } from './lib/logger.js';
import { requestId } from './lib/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { bodyParsers } from './middleware/body-parsers.js';
import { originGuard } from './middleware/origin.js';
import { csrfGuard } from './middleware/csrf.js';
import { sessionMiddleware } from './middleware/session.js';
import { requireAdmin } from './middleware/require-admin.js';
import { apiNotFound } from './middleware/api-not-found.js';
import { legacyAlias } from './middleware/legacy-alias.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './modules/health/routes.js';
import { mountStatic } from './lib/static.js';
import { authRouter } from './modules/auth/routes.js';
import { publicCoursesRouter } from './modules/courses/public-routes.js';
import { adminCoursesRouter } from './modules/courses/admin-routes.js';
import { chaptersRouter } from './modules/chapters/routes.js';
import { adminChaptersRouter } from './modules/chapters/admin-routes.js';
import { knowledgeRouter } from './modules/knowledge/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { adminUsersRouter } from './modules/users/routes.js';
import { recordsRouter } from './modules/records/routes.js';
import { datasetRouter } from './modules/dataset/routes.js';
import { auditRouter } from './modules/audit/routes.js';
import { createOpenApiRouter } from './modules/openapi/routes.js';
import { mediaRouter } from './modules/media/routes.js';

export const APP_NAME = 'ai-learning-portal-api';

export function createApp(deps: AppDeps): Express {
  const { db, env, logger, redis } = deps;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  const rateLimiter = createRateLimiter(redis, logger);
  app.locals.deps = deps;
  app.locals.db = db;
  app.locals.env = env;
  app.locals.mailer = deps.mailer;
  app.locals.rateLimiter = rateLimiter;

  // pino-http ships as CommonJS; NodeNext types default-import to the module
  // namespace, so cast the runtime function (module.exports) explicitly.
  const pinoHttp = pinoHttpModule as unknown as (options: PinoHttpOptions) => RequestHandler;

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as unknown as Request).requestId,
      serializers: { req: requestSerializer, res: responseSerializer },
      autoLogging: {
        ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
      },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );
  app.use(securityHeaders(env));

  app.use(createHealthRouter({ db, redis, logger }));

  app.use(...bodyParsers);
  app.use(originGuard);
  app.use(csrfGuard);
  app.use(cookieParser());
  app.use(sessionMiddleware(db));

  const v1 = express.Router();

  // Auth (includes /auth/csrf, login, register, MFA, ...).
  v1.use('/auth', authRouter);

  // OpenAPI spec (GET /openapi.json) + Scalar docs (GET /docs); both prefixes
  // share this router, so /api/openapi.json and /api/docs work through the alias.
  v1.use(createOpenApiRouter(env));

  // Admin gate for every /admin/* path (401/403 exact v1 messages).
  v1.use('/admin', requireAdmin);
  v1.use('/admin/users', adminUsersRouter);
  v1.use('/admin/courses/:courseId/chapters', adminChaptersRouter);
  v1.use('/admin/courses', adminCoursesRouter);
  v1.use('/admin/audit', auditRouter);

  // Media (F094): admin presign/upload (gated by /admin above) + public serve.
  v1.use(mediaRouter);

  v1.use('/admin', datasetRouter);

  // Public catalog, chapters, knowledge, dashboard/insights, records/export.
  v1.use(publicCoursesRouter);
  v1.use(chaptersRouter);
  v1.use(knowledgeRouter);
  v1.use(analyticsRouter);
  v1.use(recordsRouter);

  app.use('/api/v1', v1);
  app.use('/api', legacyAlias, v1);
  app.use('/api', apiNotFound);

  mountStatic(app, env);

  app.use(createErrorHandler(logger));

  return app;
}