/**
 * Unknown API route: fixed v1 body and 404 status. Mounted for both
 * `/api/v1/*` and `/api/*` after all routers.
 */
import type { RequestHandler } from 'express';

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: '接口不存在' });
};