import { describe, expect, it } from 'vitest';
import { COURSES, parseLecture, readLecture } from '@portal/content';

describe('parseLecture', () => {
  it('strips the BOM and normalizes CRLF', () => {
    const text = '﻿第 1 章 标题\r\n正文一\r\n\r\n第 2 章 另一章\r正文二\r\n';
    expect(parseLecture(text)).toEqual([
      { idx: 1, title: '标题', body: '正文一' },
      { idx: 2, title: '另一章', body: '正文二' },
    ]);
  });

  it('sorts by chapter number and keeps headings in order', () => {
    const chapters = parseLecture('第 10 章 十\n内容十\n第 2 章 二\n内容二\n');
    expect(chapters.map((chapter) => chapter.idx)).toEqual([2, 10]);
    expect(chapters.map((chapter) => chapter.title)).toEqual(['二', '十']);
  });

  it('drops chapters whose body is empty', () => {
    const chapters = parseLecture('第 1 章 空章节\n\n第 2 章 有正文\n内容\n');
    expect(chapters).toEqual([{ idx: 2, title: '有正文', body: '内容' }]);
  });

  it('ignores text before the first heading', () => {
    const chapters = parseLecture('课程封面\n说明文字\n第 1 章 标题\n正文\n');
    expect(chapters).toEqual([{ idx: 1, title: '标题', body: '正文' }]);
  });

  it('does not treat a heading-like line as a chapter when it is not a heading', () => {
    const chapters = parseLecture('第 1 章 标题\n这是第 2 章的介绍\n');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.body).toBe('这是第 2 章的介绍');
  });
});

describe('readLecture', () => {
  it('parses all 5 lecture files into 30 chapters', () => {
    let total = 0;
    for (const course of COURSES) {
      const chapters = readLecture(course.lectureFile);
      expect(chapters.length).toBeGreaterThan(0);
      total += chapters.length;
    }
    expect(total).toBe(30);
  });

  it('produces titles that match the course catalog', () => {
    for (const course of COURSES) {
      const chapters = readLecture(course.lectureFile);
      expect(chapters.map((chapter) => chapter.title)).toEqual(course.chapters);
      expect(chapters.map((chapter) => chapter.idx)).toEqual(
        COURSES.find((entry) => entry.id === course.id)?.chapters.map((_, index) => index + 1),
      );
    }
  });

  it('never yields an empty body', () => {
    for (const course of COURSES) {
      for (const chapter of readLecture(course.lectureFile)) {
        expect(chapter.body.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
