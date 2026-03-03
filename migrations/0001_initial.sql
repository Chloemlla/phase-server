-- Phase Server 初始 Schema

CREATE TABLE IF NOT EXISTS config (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  auth_hash    TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL UNIQUE,
  encrypted_data TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL
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
