/**
 * 用 data/learning_records.csv 重置学习记录表。
 * 会清空手工修改与导入内容；课程目录与知识文档保持不变。
 *
 * 用法：npm run seed
 */
import { openDb, resetRecords } from '../src/db.js';
import path from 'node:path';

if ((process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') && process.env.FORCE_SEED !== '1') {
  console.error('生产环境拒绝导入示例学习记录；如确需演示，设置 FORCE_SEED=1。');
  process.exit(1);
}

const db = openDb();
const res = resetRecords(db);
if (res.ok) {
  console.log(`已导入 ${res.inserted} 条学习记录，跳过 ${res.skipped} 条。`);
  console.log(`数据库：${process.env.PORTAL_DB || path.join(process.cwd(), 'data', 'portal.db')}`);
} else {
  console.error('导入失败：', res.errors);
  process.exitCode = 1;
}
db.close();