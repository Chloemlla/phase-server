import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { ErrorCode } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";
import {
  createRegistrationOptions,
  createAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from "../utils/webauthn.js";
import { logSecurityEvent, createHardwareKeyEvent } from "../utils/securityEvents.js";
import prisma from "../prisma.js";

const webauthn = new Hono<AppEnv>();

// 所有 WebAuthn 接口需要认证
webauthn.use("/*", authMiddleware);

// ─── POST /register/begin - 开始注册硬件密钥 ───

webauthn.post("/register/begin", async (c) => {
  const userId = c.get("userId");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    return error(c, ErrorCode.NOT_FOUND, "User not found", 404);
  }

  // 获取 RP 信息（从环境变量或使用默认值）
  const rpName = process.env.WEBAUTHN_RP_NAME || "Phase";
  const rpId = process.env.WEBAUTHN_RP_ID || "localhost";

  // 创建注册选项
  const options = createRegistrationOptions(userId, user.email, rpName, rpId);

  // 存储挑战到数据库（5分钟过期）
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 5 * 60;

  await prisma.webAuthnChallenge.upsert({
    where: { userId },
    update: {
      challenge: options.challenge,
      createdAt: now,
      expiresAt,
    },
    create: {
      userId,
      challenge: options.challenge,
      createdAt: now,
      expiresAt,
    },
  });

  return success(c, options);
});

// ─── POST /register/finish - 完成注册硬件密钥 ───

interface RegisterFinishRequest {
  credentialId: string;
  attestationObject: string;
  clientDataJSON: string;
  name: string;
}

webauthn.post("/register/finish", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<RegisterFinishRequest>().catch(() => null);

  if (!body?.credentialId || !body?.attestationObject || !body?.clientDataJSON || !body?.name) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields", 400);
  }

  // 获取存储的挑战
  const challengeRow = await prisma.webAuthnChallenge.findUnique({
    where: { userId },
  });

  if (!challengeRow) {
    return error(c, ErrorCode.INVALID_REQUEST, "Challenge not found or expired", 400);
  }

  const now = Math.floor(Date.now() / 1000);
  if (challengeRow.expiresAt < now) {
    await prisma.webAuthnChallenge.delete({ where: { userId } });
    return error(c, ErrorCode.INVALID_REQUEST, "Challenge expired", 400);
  }

  // 验证注册响应
  const isValid = verifyRegistrationResponse(
    challengeRow.challenge,
    body.credentialId,
    body.attestationObject,
    body.clientDataJSON,
  );

  if (!isValid) {
    return error(c, ErrorCode.INVALID_REQUEST, "Invalid attestation", 400);
  }

  // 检查凭证是否已存在
  const existing = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: body.credentialId },
  });

  if (existing) {
    return error(c, ErrorCode.INVALID_REQUEST, "Credential already registered", 409);
  }

  // 存储凭证
  await prisma.webAuthnCredential.create({
    data: {
      userId,
      name: body.name.slice(0, 100),
      credentialId: body.credentialId,
      publicKey: body.attestationObject, // 简化版本，生产环境需要提取实际公钥
      counter: 0,
      createdAt: now,
    },
  });

  // 清理挑战
  await prisma.webAuthnChallenge.delete({ where: { userId } });

  // 记录硬件密钥注册事件
  await logSecurityEvent(createHardwareKeyEvent(
    "key_registered",
    userId,
    { keyName: body.name, credentialId: body.credentialId }
  ));

  return success(c, {
    success: true,
    credentialId: body.credentialId,
  }, 201);
});

// ─── POST /authenticate/begin - 开始认证 ───

webauthn.post("/authenticate/begin", async (c) => {
  const userId = c.get("userId");

  // 获取用户的所有凭证
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true },
  });

  if (credentials.length === 0) {
    return error(c, ErrorCode.NOT_FOUND, "No credentials registered", 404);
  }

  // 获取 RP ID
  const rpId = process.env.WEBAUTHN_RP_ID || "localhost";

  // 创建认证选项
  const options = createAuthenticationOptions(
    rpId,
    credentials.map((cred) => cred.credentialId),
  );

  // 存储挑战
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 5 * 60;

  await prisma.webAuthnChallenge.upsert({
    where: { userId },
    update: {
      challenge: options.challenge,
      createdAt: now,
      expiresAt,
    },
    create: {
      userId,
      challenge: options.challenge,
      createdAt: now,
      expiresAt,
    },
  });

  return success(c, options);
});

// ─── POST /authenticate/finish - 完成认证 ───

interface AuthenticateFinishRequest {
  credentialId: string;
  signature: string;
  authenticatorData: string;
  clientDataJSON: string;
}

webauthn.post("/authenticate/finish", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<AuthenticateFinishRequest>().catch(() => null);

  if (!body?.credentialId || !body?.signature || !body?.authenticatorData || !body?.clientDataJSON) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields", 400);
  }

  // 获取存储的挑战
  const challengeRow = await prisma.webAuthnChallenge.findUnique({
    where: { userId },
  });

  if (!challengeRow) {
    return error(c, ErrorCode.INVALID_REQUEST, "Challenge not found or expired", 400);
  }

  const now = Math.floor(Date.now() / 1000);
  if (challengeRow.expiresAt < now) {
    await prisma.webAuthnChallenge.delete({ where: { userId } });
    return error(c, ErrorCode.INVALID_REQUEST, "Challenge expired", 400);
  }

  // 获取凭证
  const credential = await prisma.webAuthnCredential.findFirst({
    where: {
      userId,
      credentialId: body.credentialId,
    },
  });

  if (!credential) {
    return error(c, ErrorCode.NOT_FOUND, "Credential not found", 404);
  }

  // 验证认证响应
  const isValid = verifyAuthenticationResponse(
    challengeRow.challenge,
    body.credentialId,
    body.authenticatorData,
    body.clientDataJSON,
    body.signature,
    credential.publicKey,
  );

  if (!isValid) {
    return error(c, ErrorCode.INVALID_REQUEST, "Invalid signature", 400);
  }

  // 更新凭证使用时间和计数器
  await prisma.webAuthnCredential.update({
    where: { id: credential.id },
    data: {
      lastUsedAt: now,
      counter: { increment: 1 },
    },
  });

  // 清理挑战
  await prisma.webAuthnChallenge.delete({ where: { userId } });

  // 记录硬件密钥认证事件
  await logSecurityEvent(createHardwareKeyEvent(
    "key_authenticated",
    userId,
    { credentialId: body.credentialId, keyName: credential.name }
  ));

  return success(c, {
    success: true,
    verified: true,
  });
});

// ─── GET /credentials - 列出所有凭证 ───

webauthn.get("/credentials", async (c) => {
  const userId = c.get("userId");

  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return success(c, {
    credentials: credentials.map((cred) => ({
      id: cred.id,
      name: cred.name,
      createdAt: cred.createdAt,
      lastUsedAt: cred.lastUsedAt,
    })),
  });
});

// ─── DELETE /credentials/:id - 删除凭证 ───

webauthn.delete("/credentials/:id", async (c) => {
  const userId = c.get("userId");
  const credentialId = c.req.param("id");

  // 先获取凭证信息用于日志
  const credential = await prisma.webAuthnCredential.findFirst({
    where: { id: credentialId, userId },
    select: { name: true, credentialId: true },
  });

  const result = await prisma.webAuthnCredential.deleteMany({
    where: {
      id: credentialId,
      userId,
    },
  });

  if (result.count === 0) {
    return error(c, ErrorCode.NOT_FOUND, "Credential not found", 404);
  }

  // 记录硬件密钥删除事件
  if (credential) {
    await logSecurityEvent(createHardwareKeyEvent(
      "key_deleted",
      userId,
      { keyName: credential.name, credentialId: credential.credentialId }
    ));
  }

  return success(c, { success: true });
});

export default webauthn;
