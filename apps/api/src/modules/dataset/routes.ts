/**
 * `/api/v1/admin/reset` (F063).
 *
 * Restores `packages/db/fixtures/learning_records.csv` as the whole dataset.
 * Production requires `ALLOW_DEMO_RESET=1` (default false there); the 403
 * message matches v1 exactly. Every reset is audited as `data.reset` with the
 * inserted/skipped counts (no secrets).
 */
import { Router } from 'express';
import { AUDIT_ACTION } from '@portal/contracts';
import { AppError } from '../../lib/errors.js';
import { appDeps } from '../../lib/types.js';
import { isProduction } from '../../config.js';
import { auditRequest } from '../audit/service.js';
import { readDatasetMeta } from '../../db/repositories/catalog.js';
import { resetDataset } from '../../db/repositories/dataset.js';

export const datasetRouter = Router();

datasetRouter.post('/reset', async (req, res) => {
  const { db, env } = appDeps(req);

  if (isProduction(env) && !env.ALLOW_DEMO_RESET) {
    throw new AppError(
      403,
      '生产环境已禁用“恢复示例数据”；如需演示请显式设置 ALLOW_DEMO_RESET=1',
    );
  }

  const result = await resetDataset(db);
  const dataset = await readDatasetMeta(db);

  await auditRequest(req, db, AUDIT_ACTION.DATA_RESET, {
    targetType: 'dataset',
    details: { inserted: result.inserted, skipped: result.skipped },
  });

  res.status(result.ok ? 200 : 500).json({ ...result, dataset });
});