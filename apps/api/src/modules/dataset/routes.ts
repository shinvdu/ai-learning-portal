/**
 * Dataset admin routes (F063/F064), mounted at `/api/v1/admin`.
 *
 * - `POST /reset` restores the packaged demo fixture (production gate via
 *   `ALLOW_DEMO_RESET`), snapshotting the current rows first.
 * - `GET /dataset/snapshots` lists immutable snapshots, newest first.
 * - `POST /dataset/restore/:id` restores a snapshot in one transaction. The
 *   current rows are snapshotted as `pre-restore` first, so the restore itself
 *   can be rolled back. Unknown courses → 409, invalid rows → 400.
 *
 * Every destructive operation is audited: `data.reset` / `data.csv_imported`
 * stay unchanged, and F064 adds `data.snapshot_created` (pre-import/pre-reset/
 * pre-restore) and `data.snapshot_restored`.
 */
import { Router, type Request } from 'express';
import { AUDIT_ACTION } from '@portal/contracts';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { appDeps } from '../../lib/types.js';
import { isProduction } from '../../config.js';
import { auditRequest } from '../audit/service.js';
import { readDatasetMeta } from '../../db/repositories/catalog.js';
import { listSnapshots, resetDataset, restoreSnapshot } from '../../db/repositories/dataset.js';

export const datasetRouter = Router();

function actorEmail(req: Request): string | null {
  return req.user?.email ?? null;
}

function parseSnapshotId(raw: string | undefined): number {
  const id = Number(raw);
  if (!/^\d+$/.test(raw ?? '') || !Number.isInteger(id) || id <= 0) throw notFound('快照不存在');
  return id;
}

datasetRouter.post('/reset', async (req, res) => {
  const { db, env } = appDeps(req);

  if (isProduction(env) && !env.ALLOW_DEMO_RESET) {
    throw new AppError(
      403,
      '生产环境已禁用“恢复示例数据”；如需演示请显式设置 ALLOW_DEMO_RESET=1',
    );
  }

  const result = await resetDataset(db, { actorEmail: actorEmail(req) });
  const dataset = await readDatasetMeta(db);

  await auditRequest(req, db, AUDIT_ACTION.DATA_RESET, {
    targetType: 'dataset',
    details: { inserted: result.inserted, skipped: result.skipped },
  });
  if (result.snapshotId) {
    await auditRequest(req, db, AUDIT_ACTION.DATA_SNAPSHOT_CREATED, {
      targetType: 'snapshot',
      targetId: result.snapshotId,
      details: {
        reason: 'seed-reset',
        rowCount: result.snapshotRowCount ?? null,
        importId: result.importId ?? null,
      },
    });
  }

  res.status(result.ok ? 200 : 500).json({ ...result, dataset });
});

/* ------------------------------- snapshots ------------------------------- */

datasetRouter.get('/dataset/snapshots', async (req, res) => {
  const { db } = appDeps(req);
  const snapshots = await listSnapshots(db);
  res.json({ snapshots });
});

datasetRouter.post('/dataset/restore/:id', async (req, res) => {
  const { db } = appDeps(req);
  const id = parseSnapshotId((req.params as Record<string, string | undefined>)['id']);

  const result = await restoreSnapshot(db, id, { actorEmail: actorEmail(req) });
  if (!result.ok) {
    if (result.status === 'not-found') throw notFound('快照不存在');
    if (result.status === 'conflict') throw conflict(result.errors.join('；'));
    throw badRequest('快照数据无效', result.errors);
  }

  const dataset = await readDatasetMeta(db);

  await auditRequest(req, db, AUDIT_ACTION.DATA_SNAPSHOT_RESTORED, {
    targetType: 'snapshot',
    targetId: id,
    details: {
      restored: result.restored,
      preRestoreSnapshotId: result.preRestoreSnapshot.id,
    },
  });
  await auditRequest(req, db, AUDIT_ACTION.DATA_SNAPSHOT_CREATED, {
    targetType: 'snapshot',
    targetId: result.preRestoreSnapshot.id,
    details: {
      reason: 'pre-restore',
      rowCount: result.preRestoreSnapshot.row_count,
      restoredSnapshotId: id,
    },
  });

  res.json({
    ok: true,
    restored: result.restored,
    snapshot: result.snapshot,
    preRestoreSnapshot: result.preRestoreSnapshot,
    dataset,
  });
});
