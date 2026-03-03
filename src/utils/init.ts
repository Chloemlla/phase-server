// 自动初始化：首次请求自动建表 + 自动生成 JWT Secret
// 用户点击 Deploy Button 后无需任何手动操作

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  auth_hash  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vaults (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL UNIQUE,
  encrypted_data TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  device_name  TEXT NOT NULL DEFAULT '',
  ip_address   TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
`;

// 同一个 Worker isolate 内缓存，避免每次请求都跑 CREATE TABLE
let schemaReady = false;
let cachedJwtSecret: string | null = null;

export async function ensureInitialized(db: D1Database, envSecret?: string): Promise<string> {
  // 优先使用环境变量中的 JWT Secret（手动设置的优先级最高）
  if (envSecret) {
    if (!schemaReady) {
      await db.exec(SCHEMA_SQL);
      schemaReady = true;
    }
    return envSecret;
  }

  // 返回缓存（同一 isolate 内有效）
  if (schemaReady && cachedJwtSecret) return cachedJwtSecret;

  // 建表（IF NOT EXISTS 保证幂等）
  await db.exec(SCHEMA_SQL);
  schemaReady = true;

  // 读取已有 secret
  const row = await db.prepare("SELECT value FROM config WHERE key = 'jwt_secret'")
    .first<{ value: string }>();
  if (row) {
    cachedJwtSecret = row.value;
    return row.value;
  }

  // 首次运行：生成随机 secret 并存储
  const secret = generateSecret();
  await db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('jwt_secret', ?)")
    .bind(secret).run();

  // 防竞态：重新读取（INSERT OR IGNORE 保证只有一个值）
  const created = await db.prepare("SELECT value FROM config WHERE key = 'jwt_secret'")
    .first<{ value: string }>();
  cachedJwtSecret = created!.value;
  return cachedJwtSecret;
}

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
