/**
 * `/api/v1/auth` router (F040–F045).
 *
 * Rate-limit scopes match v1 exactly:
 *   per IP:   register / login / mfa / verify / resend-verify / forgot / reset (20/10min)
 *   per user: account-password / mfa-enable / mfa-disable (10/10min)
 * Successful register/login/mfa calls clear their bucket.
 *
 * Every response status, error message/code and cookie follows the v1 server so
 * the existing SPA keeps working through the `/api` alias.
 */
import { Router, type Request, type RequestHandler } from 'express';
import type { z } from 'zod';
import {
  ChangePasswordBodySchema,
  ForgotPasswordBodySchema,
  LoginBodySchema,
  MfaBodySchema,
  MfaDisableBodySchema,
  MfaEnableBodySchema,
  RegisterBodySchema,
  ResendVerificationBodySchema,
  ResetPasswordBodySchema,
  VerifyEmailBodySchema,
} from '@portal/contracts';
import type { AuthUser } from '../../lib/types.js';
import { appDeps } from '../../lib/types.js';
import { unauthorized } from '../../lib/errors.js';
import { clientIp, isSecureRequest } from '../../lib/ip.js';
import { ensureCsrfCookie } from '../../lib/csrf.js';
import { clearSessionCookie, serializeSessionCookie } from '../../lib/cookies.js';
import {
  clearRateLimit,
  rateLimitAccount,
  rateLimitPublicAuth,
} from '../../lib/rate-limit.js';
import { validateBody } from '../../middleware/validate.js';
import * as service from './service.js';

export const authRouter = Router();

type AuthBody<T extends z.ZodTypeAny> = z.infer<T>;

const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(unauthorized('请先登录'));
    return;
  }
  next();
};

function deps(req: Request) {
  return appDeps(req);
}

function context(req: Request) {
  return { ip: clientIp(req) };
}

function setSessionCookie(req: Request, res: import('express').Response, token: string): void {
  res.append('Set-Cookie', serializeSessionCookie(token, { secure: isSecureRequest(req) }));
}

function clearSession(req: Request, res: import('express').Response): void {
  res.append('Set-Cookie', clearSessionCookie({ secure: isSecureRequest(req) }));
}

function send(req: Request, res: import('express').Response, outcome: service.AuthOutcome): void {
  if (outcome.session) setSessionCookie(req, res, outcome.session.token);
  res.status(outcome.status).json(outcome.body);
}

/* --------------------------------- session -------------------------------- */

authRouter.get('/me', (req, res) => {
  res.status(200).json({ user: req.user ?? null });
});

authRouter.get('/csrf', (req, res) => {
  const csrfToken = ensureCsrfCookie(req, res);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ csrfToken });
});

/* -------------------------------- register -------------------------------- */

authRouter.post(
  '/register',
  rateLimitPublicAuth('register'),
  validateBody(RegisterBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof RegisterBodySchema>;
    const outcome = await service.register(deps(req), context(req), body);
    await clearRateLimit(req, 'register');
    send(req, res, outcome);
  },
);

/* ---------------------------------- login --------------------------------- */

authRouter.post(
  '/login',
  rateLimitPublicAuth('login'),
  validateBody(LoginBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof LoginBodySchema>;
    const outcome = await service.login(deps(req), context(req), body);
    await clearRateLimit(req, 'login');
    send(req, res, outcome);
  },
);

authRouter.post(
  '/mfa',
  rateLimitPublicAuth('mfa'),
  validateBody(MfaBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof MfaBodySchema>;
    const outcome = await service.verifyMfa(deps(req), context(req), body);
    await clearRateLimit(req, 'mfa');
    send(req, res, outcome);
  },
);

/* ------------------------------ email verify ------------------------------ */

authRouter.post(
  '/verify-email',
  rateLimitPublicAuth('verify'),
  validateBody(VerifyEmailBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof VerifyEmailBodySchema>;
    const outcome = await service.verifyEmail(deps(req), context(req), body);
    send(req, res, outcome);
  },
);

authRouter.post(
  '/resend-verification',
  rateLimitPublicAuth('resend-verify'),
  validateBody(ResendVerificationBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof ResendVerificationBodySchema>;
    const outcome = await service.resendVerification(deps(req), context(req), body);
    res.status(outcome.status).json(outcome.body);
  },
);

/* -------------------------------- password -------------------------------- */

authRouter.post(
  '/forgot-password',
  rateLimitPublicAuth('forgot'),
  validateBody(ForgotPasswordBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof ForgotPasswordBodySchema>;
    const outcome = await service.forgotPassword(deps(req), context(req), body);
    res.status(outcome.status).json(outcome.body);
  },
);

authRouter.post(
  '/reset-password',
  rateLimitPublicAuth('reset'),
  validateBody(ResetPasswordBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof ResetPasswordBodySchema>;
    const outcome = await service.resetPassword(deps(req), context(req), body);
    res.status(outcome.status).json(outcome.body);
  },
);

authRouter.post(
  '/change-password',
  requireAuth,
  rateLimitAccount('account-password'),
  validateBody(ChangePasswordBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof ChangePasswordBodySchema>;
    const outcome = await service.changePassword(
      deps(req),
      context(req),
      req.user as AuthUser,
      req.sessionToken,
      body,
    );
    res.status(outcome.status).json(outcome.body);
  },
);

/* ----------------------------------- MFA ---------------------------------- */

authRouter.post('/mfa/setup', requireAuth, async (req, res) => {
  const outcome = await service.setupMfa(deps(req), context(req), req.user as AuthUser);
  res.status(outcome.status).json(outcome.body);
});

authRouter.post(
  '/mfa/enable',
  requireAuth,
  rateLimitAccount('mfa-enable'),
  validateBody(MfaEnableBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof MfaEnableBodySchema>;
    const outcome = await service.enableMfaForUser(
      deps(req),
      context(req),
      req.user as AuthUser,
      req.sessionToken,
      body,
    );
    res.status(outcome.status).json(outcome.body);
  },
);

authRouter.post(
  '/mfa/disable',
  requireAuth,
  rateLimitAccount('mfa-disable'),
  validateBody(MfaDisableBodySchema),
  async (req, res) => {
    const body = req.body as AuthBody<typeof MfaDisableBodySchema>;
    const outcome = await service.disableMfaForUser(
      deps(req),
      context(req),
      req.user as AuthUser,
      body,
    );
    res.status(outcome.status).json(outcome.body);
  },
);

/* --------------------------------- logout --------------------------------- */

authRouter.post('/logout', async (req, res) => {
  const outcome = await service.logout(
    deps(req),
    context(req),
    req.user ?? null,
    req.sessionToken,
  );
  clearSession(req, res);
  res.status(outcome.status).json(outcome.body);
});