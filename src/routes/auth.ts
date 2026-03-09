import crypto from "node:crypto";
import { Hono } from "hono";
import type { AppContext, AppEnv, LoginRequest, RegisterRequest } from "../types.js";
import { ErrorCode } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { createToken } from "../utils/crypto.js";
import { error, success } from "../utils/response.js";
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
  return success(c, { token }, 201);
}

async function loginHandler(c: AppContext) {
  const body = await c.req.json<LoginRequest>().catch(() => null);

  if (!body?.email || !body?.authHash) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields", 400);
  }

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || user.authHash !== body.authHash) {
    return error(c, ErrorCode.UNAUTHORIZED, "Invalid email or master password", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const rawIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "";
  const ip = rawIp.slice(0, 45) || null;
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
  await prisma.session.deleteMany({ where: { id: c.get("sessionId") } });
  return success(c, { success: true });
});

export default auth;
