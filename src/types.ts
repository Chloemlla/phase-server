import type { Context } from "hono";

// ─── Cloudflare Bindings ───

export type Bindings = {
  DB: D1Database;
  JWT_SECRET?: string;      // 可选：未设置时自动生成并存储在 D1 中
  INSTANCE_TOKEN?: string;  // 必填（生产环境）：访问令牌，保护所有端点
  CORS_ORIGIN: string;
};

export type Variables = {
  jwtSecret: string;      // 由 init 中间件注入
  instanceSalt: string;   // 由 init 中间件注入，用于客户端 PBKDF2
  sessionId: string;      // 由 authMiddleware 注入
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
export type AppContext = Context<AppEnv>;

// ─── API 请求 ───

export interface SetupRequest {
  encryptedVault: string;  // 客户端用主密码加密的空 vault
  deviceName?: string;
}

export interface OpenRequest {
  deviceName?: string;
}

export interface VaultUpdateRequest {
  encryptedVault: string;
  expectedVersion: number;
}

// ─── API 响应 ───

export interface HealthResponse {
  status: "ok";
  initialized: boolean;
  version: string;
  instanceSalt: string;    // 用于客户端 PBKDF2 密钥派生，稳定不变
}

export interface AuthResponse {
  token: string;
}

export interface VaultResponse {
  encryptedVault: string;
  version: number;
  updatedAt: string;
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

export interface VaultRow {
  id: string;
  encrypted_data: string;
  version: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
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
  ALREADY_INITIALIZED: "ALREADY_INITIALIZED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
