import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ParsedChapter } from './types.js';

/** 讲义目录名，相对本包根目录。 */
export const LECTURES_DIR = 'lectures';

/** 章节标题行形如“第 3 章 数据清洗”。 */
const CHAPTER_HEADING = /^第\s*(\d+)\s*章\s*(.+)$/;

/**
 * 从讲义原文拆出章节：标题行形如“第 3 章 数据清洗”。
 *
 * 与 v1 `src/db.js` 的 parseLecture 行为一致：去除 BOM、统一换行、
 * 逐行收集正文直到下一个标题，正文 trim 后为空则丢弃，最后按章号排序。
 */
export function parseLecture(text: string): ParsedChapter[] {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const chapters: { idx: number; title: string; body: string[] }[] = [];
  let current: { idx: number; title: string; body: string[] } | null = null;
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const m = line.trim().match(CHAPTER_HEADING);
    if (m) {
      if (current) chapters.push(current);
      current = { idx: Number(m[1]), title: m[2]!.trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) chapters.push(current);
  return chapters
    .map((c) => ({ idx: c.idx, title: c.title, body: c.body.join('\n').trim() }))
    .filter((c) => c.body.length > 0)
    .sort((a, b) => a.idx - b.idx);
}

/** 解析本包内讲义文件的绝对路径。 */
export function lecturePath(fileName: string): string {
  return fileURLToPath(new URL(`../${LECTURES_DIR}/${fileName}`, import.meta.url));
}

/** 读取并解析 `packages/content/lectures` 下的讲义文件。 */
export function readLecture(fileName: string): ParsedChapter[] {
  return parseLecture(readFileSync(lecturePath(fileName), 'utf8'));
}
