// 自动初始化：首次请求自动建表 + 自动生成 JWT Secret + instanceSalt
// 用户点击 Deploy Button 后无需任何手动操作

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vault (
  id             TEXT PRIMARY KEY DEFAULT 'default',
  encrypted_data TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  device_name  TEXT NOT NULL DEFAULT '',
  ip_address   TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
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
let cachedInstanceSalt: string | null = null;

export interface InitResult {
  jwtSecret: string;
  instanceSalt: string;
}

export async function ensureInitialized(db: D1Database, envSecret?: string): Promise<InitResult> {
  // 建表（IF NOT EXISTS 保证幂等）
  if (!schemaReady) {
    await db.exec(SCHEMA_SQL);
    schemaReady = true;
  }

  // 返回缓存（同一 isolate 内有效）
  if (cachedJwtSecret && cachedInstanceSalt) {
    return { jwtSecret: cachedJwtSecret, instanceSalt: cachedInstanceSalt };
  }

  // ── JWT Secret ──
  let jwtSecret: string;
  if (envSecret) {
    jwtSecret = envSecret;
  } else {
    const row = await db.prepare("SELECT value FROM config WHERE key = 'jwt_secret'")
      .first<{ value: string }>();
    if (row) {
      jwtSecret = row.value;
    } else {
      const secret = generateRandom(32);
      await db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('jwt_secret', ?)")
        .bind(secret).run();
      const created = await db.prepare("SELECT value FROM config WHERE key = 'jwt_secret'")
        .first<{ value: string }>();
      jwtSecret = created!.value;
    }
  }

  // ── Instance Salt ──（首次生成后永久固定，用于客户端 PBKDF2）
  const saltRow = await db.prepare("SELECT value FROM config WHERE key = 'instance_salt'")
    .first<{ value: string }>();
  let instanceSalt: string;
  if (saltRow) {
    instanceSalt = saltRow.value;
  } else {
    const newSalt = generateRandom(32);
    await db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('instance_salt', ?)")
      .bind(newSalt).run();
    const created = await db.prepare("SELECT value FROM config WHERE key = 'instance_salt'")
      .first<{ value: string }>();
    instanceSalt = created!.value;
  }

  cachedJwtSecret = jwtSecret;
  cachedInstanceSalt = instanceSalt;
  return { jwtSecret, instanceSalt };
}

function generateRandom(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}
