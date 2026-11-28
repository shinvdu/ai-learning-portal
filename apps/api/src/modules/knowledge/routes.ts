/**
 * Public knowledge-center endpoint (F032).
 *
 * `GET /knowledge/:id` returns the course summary plus the knowledge payload
 * stored verbatim from the content package (`knowledge: null` when the document
 * is missing). Unknown course ids return 404 `课程不存在`, matching v1.
 */
import { Router } from 'express';
import { notFound } from '../../lib/errors.js';
import { appDeps } from '../../lib/types.js';
import { getKnowledgePayload, listCourses } from '../../db/repositories/catalog.js';

export const knowledgeRouter = Router();

knowledgeRouter.get('/knowledge/:id', async (req, res) => {
  const { db } = appDeps(req);
  const courses = await listCourses(db);
  const course = courses.find((entry) => entry.id === req.params.id);
  if (!course) throw notFound('课程不存在');

  const knowledge = await getKnowledgePayload(db, course.id);

  res.json({
    course: {
      id: course.id,
      name: course.name,
      chapters: course.chapters,
      color: course.color,
      badge: course.badge,
    },
    knowledge,
  });
});