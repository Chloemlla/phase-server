import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { ErrorCode } from "../types";
import { verifyToken } from "../utils/crypto";
import prisma from "../prisma";

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json(
      { error: { code: ErrorCode.UNAUTHORIZED, message: "Missing or invalid Authorization header", status: 401 } },
      401,
    );
  }

  const token = header.slice(7);
  let payload: { sid: string };
  try {
    payload = verifyToken(token, c.get("jwtSecret"));
  } catch {
    return c.json(
      { error: { code: ErrorCode.UNAUTHORIZED, message: "Invalid or expired token", status: 401 } },
      401,
    );
  }

  // 检查 session 是否仍有效（支持主动撤销）
  const now = Math.floor(Date.now() / 1000);
  const session = await prisma.session.findFirst({
    where: {
      id: payload.sid,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });

  if (!session) {
    return c.json(
      { error: { code: ErrorCode.UNAUTHORIZED, message: "Session expired or revoked", status: 401 } },
      401,
    );
  }

  // 更新 last_used_at
  await prisma.session.update({
    where: { id: payload.sid },
    data: { lastUsedAt: now },
  });

  c.set("sessionId", payload.sid);
  await next();
});
