// 自动初始化：首次请求自动建表 + 自动生成 JWT Secret + instanceSalt + instanceToken
// 用户点击 Deploy 后无需任何手动操作

// D1 不支持 db.exec() 执行多语句，逐条建表
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vault (
    id             TEXT PRIMARY KEY DEFAULT 'default',
    encrypted_data TEXT NOT NULL,
    version        INTEGER NOT NULL DEFAULT 1,
    updated_at     INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    device_name  TEXT NOT NULL DEFAULT '',
    ip_address   TEXT,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key          TEXT NOT NULL,
    count        INTEGER NOT NULL DEFAULT 1,
    window_start INTEGER NOT NULL,
    PRIMARY KEY (key, window_start)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start)`,
];

// 同一个 Worker isolate 内缓存，避免每次请求都跑 CREATE TABLE
let schemaReady = false;
let cachedJwtSecret: string | null = null;
let cachedInstanceSalt: string | null = null;
let cachedInstanceToken: string | null = null;

export interface InitResult {
  jwtSecret: string;
  instanceSalt: string;
  instanceToken: string;
}

export async function ensureInitialized(db: D1Database, envSecret?: string): Promise<InitResult> {
  // 建表（逐条执行，兼容 D1）
  if (!schemaReady) {
    for (const sql of SCHEMA_STATEMENTS) {
      await db.prepare(sql).run();
    }
    schemaReady = true;
  }

  // 返回缓存（同一 isolate 内有效）
  if (cachedJwtSecret && cachedInstanceSalt && cachedInstanceToken) {
    return { jwtSecret: cachedJwtSecret, instanceSalt: cachedInstanceSalt, instanceToken: cachedInstanceToken };
  }

  // ── JWT Secret ── (可由环境变量覆盖，否则自动生成存 D1)
  let jwtSecret: string;
  if (envSecret) {
    jwtSecret = envSecret;
  } else {
    const row = await db.prepare("SELECT value FROM config WHERE key = 'jwt_secret'").first<{ value: string }>();
    if (row) {
      jwtSecret = row.value;
    } else {
      const secret = generateRandom(32);
      await db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('jwt_secret', ?)").bind(secret).run();
      jwtSecret = (await db.prepare("SELECT value FROM config WHERE key = 'jwt_secret'").first<{ value: string }>())!.value;
    }
  }

  // ── Instance Salt ── (首次生成后永久固定，用于客户端 PBKDF2)
  let instanceSalt: string;
  const saltRow = await db.prepare("SELECT value FROM config WHERE key = 'instance_salt'").first<{ value: string }>();
  if (saltRow) {
    instanceSalt = saltRow.value;
  } else {
    const newSalt = generateRandom(32);
    await db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('instance_salt', ?)").bind(newSalt).run();
    instanceSalt = (await db.prepare("SELECT value FROM config WHERE key = 'instance_salt'").first<{ value: string }>())!.value;
  }

  // ── Instance Token ── (自动生成，永久固定，通过 /api/v1/setup-token 一次性取回)
  let instanceToken: string;
  const tokenRow = await db.prepare("SELECT value FROM config WHERE key = 'instance_token'").first<{ value: string }>();
  if (tokenRow) {
    instanceToken = tokenRow.value;
  } else {
    const newToken = generateRandom(32);
    await db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('instance_token', ?)").bind(newToken).run();
    instanceToken = (await db.prepare("SELECT value FROM config WHERE key = 'instance_token'").first<{ value: string }>())!.value;
  }

  cachedJwtSecret = jwtSecret;
  cachedInstanceSalt = instanceSalt;
  cachedInstanceToken = instanceToken;
  return { jwtSecret, instanceSalt, instanceToken };
}

function generateRandom(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}
