/**
 * Reset (or create) an administrator account. Useful when the only admin is
 * locked out and no one can reach the admin UI.
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='new-password' npm run admin:reset
 */
import { openDb } from '../src/db.js';
import { hashPassword, isEmail, normalizeEmail, passwordProblem } from '../src/auth.js';

const email = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@local.test');
const password = process.env.ADMIN_PASSWORD;

if (!isEmail(email)) {
  console.error('ADMIN_EMAIL 不是合法邮箱');
  process.exit(1);
}
if (!password) {
  console.error('请设置 ADMIN_PASSWORD（至少 8 个字符）');
  process.exit(1);
}
const problem = passwordProblem(password);
if (problem) {
  console.error(`ADMIN_PASSWORD 不合规：${problem}`);
  process.exit(1);
}

const db = openDb();
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
const hash = hashPassword(password);

if (existing) {
  db.prepare("UPDATE users SET role = 'admin', active = 1, password_hash = ? WHERE id = ?").run(hash, existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`已重置管理员密码并撤销其会话：${email}`);
} else {
  const result = db
    .prepare("INSERT INTO users(email, name, password_hash, role, active) VALUES(?, 'Administrator', ?, 'admin', 1)")
    .run(email, hash);
  console.log(`已创建管理员：${email}（id=${Number(result.lastInsertRowid)}）`);
}

db.close();