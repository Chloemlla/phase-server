import type { Context } from "hono";

// ─── Cloudflare Bindings ───

export type Bindings = {
  DB: D1Database;
  JWT_SECRET?: string; // 可选：未设置时自动生成并存储在 D1 中
  CORS_ORIGIN: string;
};

export type Variables = {
  userId: string;
  sessionId: string;
  jwtSecret: string; // 由 init 中间件注入（来自环境变量或 D1）
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
export type AppContext = Context<AppEnv>;

// ─── API 请求 ───

export interface RegisterRequest {
  email: string;
  authHash: string;
  encryptedVault: string;
  deviceName?: string;
}

export interface LoginRequest {
  email: string;
  authHash: string;
  deviceName?: string;
}

export interface ChangePasswordRequest {
  currentAuthHash: string;
  newAuthHash: string;
  encryptedVault: string;
  vaultVersion: number;
}

export interface VaultUpdateRequest {
  encryptedVault: string;
  expectedVersion: number;
}

export interface DeleteAccountRequest {
  authHash: string;
}

// ─── API 响应 ───

export interface AuthResponse {
  token: string;
  userId: string;
}

export interface VaultResponse {
  encryptedVault: string;
  version: number;
  updatedAt: string;
}

export interface HealthResponse {
  status: "ok";
  initialized: boolean;
  version: string;
}

export interface SessionInfo {
  id: string;
  deviceName: string;
  ipAddress: string | null;
  createdAt: number;
  lastUsedAt: number;
  isCurrent: boolean;
}

// ─── DB 行类型 ───

export interface UserRow {
  id: string;
  email: string;
  auth_hash: string;
  created_at: number;
  updated_at: number;
}

export interface VaultRow {
  id: string;
  user_id: string;
  encrypted_data: string;
  version: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  device_name: string;
  ip_address: string | null;
  created_at: number;
  last_used_at: number;
  expires_at: number;
}

// ─── 错误码 ───

export const ErrorCode = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VAULT_VERSION_CONFLICT: "VAULT_VERSION_CONFLICT",
  ALREADY_REGISTERED: "ALREADY_REGISTERED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
