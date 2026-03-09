import crypto from "node:crypto";
import { Hono } from "hono";
import type { AppContext, AppEnv, OpenRequest, SetupRequest } from "../types";
import { ErrorCode } from "../types";
import { authMiddleware } from "../middleware/auth";
import { createToken } from "../utils/crypto";
import { error, success } from "../utils/response";
import prisma from "../prisma";

const auth = new Hono<AppEnv>();

async function initHandler(c: AppContext) {
  const body = await c.req.json<SetupRequest>().catch(() => null);

  if (!body?.encryptedVault || typeof body.encryptedVault !== "string") {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing or invalid required field: encryptedVault", 400);
  }

  const existing = await prisma.vault.findUnique({ where: { id: "default" }, select: { id: true } });
  if (existing) {
    return error(c, ErrorCode.ALREADY_INITIALIZED, "This instance is already initialized", 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const rawIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "";
  const ip = rawIp.slice(0, 45) || null; // 防护由于过大IP引起的崩溃
  const deviceName = typeof body.deviceName === "string" ? body.deviceName.slice(0, 100) : "";

  try {
    // 使用 Prisma 事务替代 D1 batch
    await prisma.$transaction([
      prisma.vault.create({
        data: {
          id: "default",
          encryptedData: body.encryptedVault,
          version: 1,
          updatedAt: now,
        },
      }),
      prisma.session.create({
        data: {
          id: sessionId,
          deviceName,
          ipAddress: ip,
          createdAt: now,
          lastUsedAt: now,
          expiresAt: now + 7 * 24 * 3600,
        },
      }),
    ]);
  } catch (err: any) {
    // 捕获在高并发情况下极小概率绕过 findUnique 的独特约束插入报错
    if (err.code === "P2002") {
      return error(c, ErrorCode.ALREADY_INITIALIZED, "This instance is already initialized", 409);
    }
    throw err;
  }

  const token = createToken(sessionId, c.get("jwtSecret"));
  return success(c, { token }, 201);
}

async function unlockHandler(c: AppContext) {
  const body = await c.req.json<OpenRequest>().catch(() => null);

  const existing = await prisma.vault.findUnique({ where: { id: "default" }, select: { id: true } });
  if (!existing) {
    return error(c, ErrorCode.NOT_FOUND, "This instance has not been initialized yet", 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const rawIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "";
  const ip = rawIp.slice(0, 45) || null;
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.slice(0, 100) : "";

  await prisma.session.create({
    data: {
      id: sessionId,
      deviceName,
      ipAddress: ip,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + 7 * 24 * 3600,
    },
  });

  const token = createToken(sessionId, c.get("jwtSecret"));
  return success(c, { token });
}

auth.post("/init", initHandler);
auth.post("/unlock", unlockHandler);

auth.post("/logout", authMiddleware, async (c) => {
  // 使用 deleteMany 防止记录不存在时引发 Prisma P2025 的 500 崩溃
  await prisma.session.deleteMany({ where: { id: c.get("sessionId") } });
  return success(c, { success: true });
});

export default auth;
