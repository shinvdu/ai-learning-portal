/**
 * `/api/v1/admin/courses` (F061).
 *
 * - `GET`    lists courses in catalogue order with stats + chapter bodies.
 * - `POST`   creates a course; ids come from `course_seq` (`C6` after seed),
 *            names are unique and `sort_order` appends when omitted.
 * - `PATCH`  updates metadata and the three-state video configuration.
 * - `DELETE` returns 409 `{conflict,records}` when learning records exist, or
 *            deletes records → chapters → knowledge → course in one transaction
 *            with `?force=1`.
 *
 * Renames never rewrite `records` (the FK is `course_id`); the joined view
 * keeps `course_name` current for API/CSV consumers.
 */
import { Router } from 'express';
import { AUDIT_ACTION } from '@portal/contracts';
import { appDeps } from '../../lib/types.js';
import { auditRequest } from '../audit/service.js';
import {
  createCourse,
  deleteCourse,
  listAdminCourses,
  updateCourse,
} from '../../db/repositories/courses-admin.js';

export const adminCoursesRouter = Router();

function bodyOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

adminCoursesRouter.get('/', async (req, res) => {
  const { db } = appDeps(req);
  res.json({ courses: await listAdminCourses(db) });
});

adminCoursesRouter.post('/', async (req, res) => {
  const { db } = appDeps(req);
  const result = await createCourse(db, bodyOf(req.body));
  if (!result.ok) {
    res.status(400).json({ error: result.errors[0], errors: result.errors });
    return;
  }

  await auditRequest(req, db, AUDIT_ACTION.ADMIN_COURSE_CREATED, {
    targetType: 'course',
    targetId: result.course.id,
    details: { name: result.course.name },
  });
  res.status(201).json(result);
});

adminCoursesRouter.patch('/:id', async (req, res) => {
  const { db } = appDeps(req);
  const body = bodyOf(req.body);
  const result = await updateCourse(db, req.params.id, body);
  if (!result.ok) {
    res.status(result.notFound ? 404 : 400).json(result);
    return;
  }

  await auditRequest(req, db, AUDIT_ACTION.ADMIN_COURSE_UPDATED, {
    targetType: 'course',
    targetId: result.course.id,
    details: { fields: Object.keys(body) },
  });
  res.json(result);
});

adminCoursesRouter.delete('/:id', async (req, res) => {
  const { db } = appDeps(req);
  const force = String(req.query.force ?? '') === '1';
  const result = await deleteCourse(db, req.params.id, { force });
  if (!result.ok) {
    res.status(result.notFound ? 404 : 409).json(result);
    return;
  }

  await auditRequest(req, db, AUDIT_ACTION.ADMIN_COURSE_DELETED, {
    targetType: 'course',
    targetId: req.params.id,
    details: { force, deletedRecords: result.deletedRecords },
  });
  res.json(result);
});