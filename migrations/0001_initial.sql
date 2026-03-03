-- Phase Server Schema（开源自托管版）
-- 无用户账号系统：Instance Token 是身份凭证，主密码纯客户端加密

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- vault 表：单实例单 vault，id 固定为 'default'
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
