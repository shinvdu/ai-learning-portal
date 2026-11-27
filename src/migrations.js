/**
 * Versioned, additive SQLite migrations.
 *
 * The base schema is created by db.js for backwards compatibility; version 1
 * marks that baseline. New columns/tables are added here in ascending order.
 */

export const MIGRATIONS = [
  {
    version: 2,
    name: 'auth-hardening',
    up(db, ensureColumn) {
      ensureColumn(db, 'users', 'email_verified', 'INTEGER NOT NULL DEFAULT 1');
      ensureColumn(db, 'users', 'failed_attempts', 'INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db, 'users', 'locked_until', 'INTEGER');
      ensureColumn(db, 'users', 'mfa_secret', 'TEXT');
      ensureColumn(db, 'users', 'mfa_enabled', 'INTEGER NOT NULL DEFAULT 0');

      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_tokens (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          type TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, type);
        CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens(expires_at);

        CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          code_hash TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_recovery_user ON mfa_recovery_codes(user_id);

        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          actor_user_id INTEGER,
          actor_email TEXT,
          action TEXT NOT NULL,
          target_type TEXT,
          target_id TEXT,
          ip TEXT,
          details_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id);
      `);
    }
  }
];

export function runMigrations(db, ensureColumn) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  if (!applied.has(1)) {
    // The base schema is created before this runner; treat it as baseline 1.
    db.prepare("INSERT OR IGNORE INTO schema_migrations(version, name) VALUES(1, 'baseline')").run();
    applied.add(1);
  }
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN');
    try {
      migration.up(db, ensureColumn);
      db.prepare('INSERT INTO schema_migrations(version, name) VALUES(?, ?)').run(
        migration.version,
        migration.name ?? null
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}