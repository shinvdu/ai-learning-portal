/**
 * Learning-record admin API (F062/F063).
 *
 * - `GET/POST /records`, `PATCH/DELETE /records/:id` — admin-only CRUD with
 *   offset pagination (1–200, default 20) and the fixed v1 order
 *   `learning_date DESC, student_id, id`.
 * - `POST /records/import` — accepts JSON `{csv}` or `text/csv` (2MB cap from
 *   the body parser). Whole-table replacement in one transaction; `?dry_run=1`
 *   (or `{dryRun:true}`) parses/validates without writing.
 * - `GET /export.csv` — UTF-8 BOM + CRLF, fixed column order, admin only.
 *
 * Validation/error shapes mirror v1: record failures return
 * `{ok:false,errors}` (400/404), while an empty PATCH is
 * `400 {error:'没有需要更新的字段'}`.
 */
import { Router, type Request } from 'express';
import { requireAdmin } from '../../middleware/require-admin.js';
import { parsePagination, RECORDS_PAGINATION } from '../../lib/pagination.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { appDeps } from '../../lib/types.js';
import { AUDIT_ACTION } from '@portal/contracts';
import { auditRequest } from '../audit/service.js';
import { readDatasetMeta } from '../../db/repositories/catalog.js';
import {
  createRecord,
  deleteRecord,
  listRecordsPage,
  updateRecord,
} from '../../db/repositories/records.js';
import { exportCsv, importCsv } from '../../db/repositories/dataset.js';

export const recordsRouter = Router();

function firstQuery(req: Request, name: string): string {
  const raw = req.query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value : '';
}

/** v1 treats a zero/empty limit as absent (`Number(x) || default`). */
function paginationQuery(req: Request): Record<string, unknown> {
  const query = { ...req.query } as Record<string, unknown>;
  if (Number(firstQuery(req, 'limit')) === 0) delete query.limit;
  return query;
}

function bodyOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseRecordId(raw: string | undefined): number {
  const id = Number(raw);
  if (!/^\d+$/.test(raw ?? '') || !Number.isInteger(id) || id <= 0) throw notFound('接口不存在');
  return id;
}

/* ------------------------------- listing -------------------------------- */

recordsRouter.get('/records', requireAdmin, async (req, res) => {
  const { db } = appDeps(req);
  const pagination = parsePagination(paginationQuery(req), RECORDS_PAGINATION);
  const page = await listRecordsPage(db, {
    course: firstQuery(req, 'course'),
    student: firstQuery(req, 'student'),
    q: firstQuery(req, 'q'),
    limit: pagination.limit,
    offset: pagination.offset,
  });
  res.json(page);
});

/* -------------------------------- create -------------------------------- */

recordsRouter.post('/records', requireAdmin, async (req, res) => {
  const { db } = appDeps(req);
  const result = await createRecord(db, bodyOf(req.body));
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }

  const dataset = await readDatasetMeta(db);
  await auditRequest(req, db, AUDIT_ACTION.DATA_RECORD_CREATED, {
    targetType: 'record',
    targetId: result.record.id,
    details: { studentId: result.record.student_id, course: result.record.course_name },
  });
  res.status(201).json({ ...result, dataset });
});

/* -------------------------------- update -------------------------------- */

recordsRouter.patch('/records/:id', requireAdmin, async (req, res) => {
  const { db } = appDeps(req);
  const id = parseRecordId((req.params as Record<string, string | undefined>)['id']);
  const body = bodyOf(req.body);
  if (Object.keys(body).length === 0) {
    res.status(400).json({ error: '没有需要更新的字段' });
    return;
  }

  const result = await updateRecord(db, id, body);
  if (!result.ok) {
    res.status(result.notFound ? 404 : 400).json(result);
    return;
  }

  const dataset = await readDatasetMeta(db);
  await auditRequest(req, db, AUDIT_ACTION.DATA_RECORD_UPDATED, {
    targetType: 'record',
    targetId: id,
    details: { fields: Object.keys(body) },
  });
  res.json({ ...result, dataset });
});

/* -------------------------------- delete -------------------------------- */

recordsRouter.delete('/records/:id', requireAdmin, async (req, res) => {
  const { db } = appDeps(req);
  const id = parseRecordId((req.params as Record<string, string | undefined>)['id']);
  const result = await deleteRecord(db, id);
  if (!result.ok) {
    res.status(404).json(result);
    return;
  }

  const dataset = await readDatasetMeta(db);
  await auditRequest(req, db, AUDIT_ACTION.DATA_RECORD_DELETED, {
    targetType: 'record',
    targetId: id,
  });
  res.json({ ok: true, dataset });
});

/* ------------------------------- CSV import ------------------------------ */

type ImportPayload = { csv: string; dryRun: boolean };

function readImportPayload(req: Request): ImportPayload {
  const raw = req.body;
  const truthy = (value: string): boolean => value === '1' || value.toLowerCase() === 'true';
  const dryRunQuery = truthy(firstQuery(req, 'dry_run')) || truthy(firstQuery(req, 'dryRun'));
  let csv: unknown = raw;
  let dryRunBody = false;

  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && typeof raw !== 'string') {
    const body = raw as Record<string, unknown>;
    csv = body.csv;
    dryRunBody = body.dryRun === true || body.dry_run === true ||
      body.dryRun === '1' || body.dry_run === '1';
  }

  if (typeof csv !== 'string' || csv.trim() === '') throw badRequest('缺少 CSV 内容');
  return { csv, dryRun: dryRunQuery || dryRunBody };
}

recordsRouter.post('/records/import', requireAdmin, async (req, res) => {
  const { db } = appDeps(req);
  const { csv, dryRun } = readImportPayload(req);

  const result = await importCsv(db, csv, {
    source: 'csv-import',
    dryRun,
    actorEmail: req.user?.email ?? null,
  });
  const dataset = await readDatasetMeta(db);

  if (!dryRun) {
    await auditRequest(req, db, AUDIT_ACTION.DATA_CSV_IMPORTED, {
      targetType: 'dataset',
      details: { inserted: result.inserted, skipped: result.skipped },
    });
    if (result.snapshotId) {
      await auditRequest(req, db, AUDIT_ACTION.DATA_SNAPSHOT_CREATED, {
        targetType: 'snapshot',
        targetId: result.snapshotId,
        details: {
          reason: 'csv-import',
          rowCount: result.snapshotRowCount ?? null,
          importId: result.importId ?? null,
        },
      });
    }
  }

  res.status(result.ok ? 200 : 400).json({ ...result, dataset });
});

/* --------------------------------- export -------------------------------- */

recordsRouter.get('/export.csv', requireAdmin, async (req, res) => {
  const { db } = appDeps(req);
  const { csv, count } = await exportCsv(db);

  await auditRequest(req, db, AUDIT_ACTION.DATA_CSV_EXPORTED, {
    targetType: 'dataset',
    details: { records: count },
  });

  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="learning_records.csv"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});