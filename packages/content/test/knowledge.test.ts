import { describe, expect, it } from 'vitest';
import { COURSES, KNOWLEDGE } from '@portal/content';

describe('KNOWLEDGE', () => {
  it('has a payload for every course', () => {
    expect(Object.keys(KNOWLEDGE).sort()).toEqual(COURSES.map((course) => course.id).sort());
  });

  for (const course of COURSES) {
    describe(course.id, () => {
      const payload = KNOWLEDGE[course.id];

      it('exists and points at the course lecture file', () => {
        expect(payload).toBeDefined();
        expect(payload?.source).toBe(course.lectureFile);
        expect(payload?.title).toContain(course.name);
      });

      it('keeps the summary within 200 characters', () => {
        const length = [...(payload?.summary ?? '')].length;
        expect(length).toBeGreaterThan(0);
        expect(length).toBeLessThanOrEqual(200);
      });

      it('has 4 objectives, 5 knowledge points and 5 terms', () => {
        expect(payload?.objectives).toHaveLength(4);
        expect(payload?.points).toHaveLength(5);
        expect(payload?.terms).toHaveLength(5);
        for (const point of payload?.points ?? []) expect(point.length).toBeGreaterThan(0);
        for (const entry of payload?.terms ?? []) {
          expect(entry.term.length).toBeGreaterThan(0);
          expect(entry.definition.length).toBeGreaterThan(0);
        }
      });

      it('has 3 FAQ entries with question and answer', () => {
        expect(payload?.faq).toHaveLength(3);
        for (const entry of payload?.faq ?? []) {
          expect(entry.q.length).toBeGreaterThan(0);
          expect(entry.a.length).toBeGreaterThan(0);
        }
      });

      it('has 3 quizzes with 4 options, a valid answer, explanation and source', () => {
        expect(payload?.quiz).toHaveLength(3);
        for (const quiz of payload?.quiz ?? []) {
          expect(quiz.q.length).toBeGreaterThan(0);
          expect(quiz.options).toHaveLength(4);
          expect(new Set(quiz.options).size).toBe(4);
          expect(Number.isInteger(quiz.answer)).toBe(true);
          expect(quiz.answer).toBeGreaterThanOrEqual(0);
          expect(quiz.answer).toBeLessThan(quiz.options.length);
          expect(quiz.explanation.length).toBeGreaterThan(0);
          expect(quiz.source).toMatch(/^第\s*\d+\s*章\s*.+$/);
        }
      });

      it('has a review with before, after and note', () => {
        expect(payload?.review.before.length).toBeGreaterThan(0);
        expect(payload?.review.after.length).toBeGreaterThan(0);
        expect(payload?.review.note.length).toBeGreaterThan(0);
        expect(payload?.review.before).not.toBe(payload?.review.after);
      });

      it('quotes at least 3 original excerpts', () => {
        expect(payload?.original.length).toBeGreaterThanOrEqual(3);
        for (const excerpt of payload?.original ?? []) {
          expect(excerpt.chapter).toMatch(/^第\s*\d+\s*章\s*.+$/);
          expect(excerpt.text.length).toBeGreaterThan(0);
        }
      });
    });
  }
});
