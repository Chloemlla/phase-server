import crypto from "node:crypto";
import { Hono } from "hono";
import type { AppContext, AppEnv, LoginRequest, RegisterRequest } from "../types.js";
import { ErrorCode } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { createToken } from "../utils/crypto.js";
import { error, success } from "../utils/response.js";
import { logSecurityEvent, createAuthEvent } from "../utils/securityEvents.js";
import prisma from "../prisma.js";

const auth = new Hono<AppEnv>();

async function registerHandler(c: AppContext) {
  const body = await c.req.json<RegisterRequest>().catch(() => null);

  if (!body?.email || !body?.authHash || !body?.salt || !body?.encryptedVault) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields", 400);
  }

  const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (existing) {
    return error(c, ErrorCode.ALREADY_INITIALIZED, "User already exists", 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const rawIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "";
  const ip = rawIp.slice(0, 45) || null;
  const deviceName = typeof body.deviceName === "string" ? body.deviceName.slice(0, 100) : "";

  try {
    await prisma.$transaction([
      prisma.user.create({
        data: {
          id: userId,
          email: body.email,
          authHash: body.authHash,
          salt: body.salt,
          createdAt: now,
          vault: {
            create: {
              encryptedData: body.encryptedVault,
              version: 1,
              updatedAt: now,
            }
          },
          sessions: {
            create: {
              id: sessionId,
              deviceName,
              ipAddress: ip,
              createdAt: now,
              lastUsedAt: now,
              expiresAt: now + 30 * 24 * 3600, // 30 days
            }
          }
        },
      }),
    ]);
  } catch (err: any) {
    if (err.code === "P2002") {
      return error(c, ErrorCode.ALREADY_INITIALIZED, "User already exists", 409);
    }
    throw err;
  }

  const token = createToken(sessionId, c.get("jwtSecret"));

  // 记录注册成功事件
  await logSecurityEvent(createAuthEvent(
    "register",
    userId,
    ip || "unknown",
    { email: body.email, deviceName }
  ));

  return success(c, { token }, 201);
}

async function loginHandler(c: AppContext) {
  const body = await c.req.json<LoginRequest>().catch(() => null);

  if (!body?.email || !body?.authHash) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields", 400);
  }

  const user = await prisma.user.findUnique({ where: { email: body.email } });

  const rawIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "";
  const ip = rawIp.slice(0, 45) || null;

  if (!user || user.authHash !== body.authHash) {
    // 记录登录失败事件
    await logSecurityEvent(createAuthEvent(
      "login_failed",
      user?.id || "unknown",
      ip || "unknown",
      { email: body.email, reason: "invalid_credentials" }
    ));

    return error(c, ErrorCode.UNAUTHORIZED, "Invalid email or master password", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.slice(0, 100) : "";

  await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      deviceName,
      ipAddress: ip,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + 30 * 24 * 3600,
    },
  });

  const token = createToken(sessionId, c.get("jwtSecret"));

  // 记录登录成功事件
  await logSecurityEvent(createAuthEvent(
    "login_success",
    user.id,
    ip || "unknown",
    { email: user.email, deviceName, sessionId }
  ));

  return success(c, { token, salt: user.salt, deviceId: deviceName });
}

async function saltHandler(c: AppContext) {
  const email = c.req.query("email");
  if (!email) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing email", 400);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return error(c, ErrorCode.NOT_FOUND, "User not found", 404);
  }

  return success(c, { salt: user.salt });
}

auth.post("/register", registerHandler);
auth.post("/login", loginHandler);
auth.get("/salt", saltHandler);

auth.post("/logout", authMiddleware, async (c) => {
  const sessionId = c.get("sessionId");
  const userId = c.get("userId");

  await prisma.session.deleteMany({ where: { id: sessionId } });

  // 记录登出事件
  await logSecurityEvent(createAuthEvent(
    "logout",
    userId,
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown",
    { sessionId }
  ));

  return success(c, { success: true });
});

// ─── POST /biometric/validate - 验证生物识别会话（可选）───

interface BiometricValidateRequest {
  deviceId: string;
  biometricToken: string;
}

auth.post("/biometric/validate", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const sessionId = c.get("sessionId");
  const body = await c.req.json<BiometricValidateRequest>().catch(() => null);

  if (!body?.deviceId || !body?.biometricToken) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields", 400);
  }

  // 验证生物识别令牌（简化实现）
  // 生产环境应该验证令牌的有效性和设备绑定
  const now = Math.floor(Date.now() / 1000);

  // 更新会话最后使用时间
  await prisma.session.update({
    where: { id: sessionId },
    data: { lastUsedAt: now },
  });

  // 记录生物识别验证事件
  await logSecurityEvent({
    event_type: "authentication",
    action: "login_success",
    user_id: userId,
    session_id: sessionId,
    device_id: body.deviceId,
    timestamp: new Date().toISOString(),
    metadata: { authMethod: "biometric" },
  });

  return success(c, {
    valid: true,
    sessionExtended: true,
  });
});

export default auth;
