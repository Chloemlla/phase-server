import type { Context } from "hono";

// ─── App Context ───

export type Variables = {
  jwtSecret: string;      // 由 init 中间件注入
  instanceSalt: string;   // 由 init 中间件注入，用于客户端 PBKDF2
  instanceToken: string;  // 由 init 中间件注入，用于校验客户端请求
  sessionId: string;      // 由 authMiddleware 注入
};

export type AppEnv = { Variables: Variables };
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

export interface CreateActivationCodeRequest {
  membershipDays: number;   // 激活后赋予的会员天数
  count?: number;           // 批量创建数量（默认 1，最大 50）
  note?: string;            // 备注
}

export interface RedeemActivationCodeRequest {
  code: string;
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

export interface MembershipStatusResponse {
  active: boolean;
  expiresAt: number | null;
  expiresAtISO: string | null;
  remainingDays: number;
}

// ─── 错误码 ───

export const ErrorCode = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  ACTIVATION_CODE_USED: "ACTIVATION_CODE_USED",
  ACTIVATION_CODE_NOT_FOUND: "ACTIVATION_CODE_NOT_FOUND",
  VAULT_VERSION_CONFLICT: "VAULT_VERSION_CONFLICT",
  ALREADY_INITIALIZED: "ALREADY_INITIALIZED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;
