/**
 * Create a consistent SQLite backup using VACUUM INTO.
 *
 * Usage:
 *   npm run backup
 *   BACKUP_DIR=/var/backups/ai-portal npm run backup
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDb, ROOT } from '../src/db.js';

const dir = path.resolve(process.env.BACKUP_DIR || path.join(ROOT, 'backups'));
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(dir, `portal-${stamp}.db`);
const db = openDb();
try {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (!integrity || Object.values(integrity)[0] !== 'ok') {
    throw new Error('数据库完整性检查失败');
  }
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const size = fs.statSync(target).size;
console.log(`备份完成：${target}（${(size / 1024 / 1024).toFixed(2)} MB）`);
console.log('恢复：停止服务 → 用该文件替换 data/portal.db（同时删除 -wal/-shm）→ 启动服务。');