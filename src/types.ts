import type { Context } from "hono";

// ─── App Context ───

export type Variables = {
  jwtSecret: string;
  instanceSalt: string;   // Deprecated in multi-user mode, keeping for backward compatibility
  instanceToken: string;  // Deprecated in multi-user mode, keeping for backward compatibility
  sessionId: string;      // 由 authMiddleware 注入
  userId: string;         // 由 authMiddleware 注入
};

export type AppEnv = { Variables: Variables };
export type AppContext = Context<AppEnv>;

// ─── API 请求 ───

export interface RegisterRequest {
  email: string;
  authHash: string;
  salt: string;            // User specific salt for deriving master key
  encryptedVault: string;
  deviceName?: string;
}

export interface LoginRequest {
  email: string;
  authHash: string;
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
