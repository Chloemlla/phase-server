import { Hono } from "hono";
import type { AppEnv, SessionInfo } from "../types.js";
import { ErrorCode } from "../types.js";
import { success, error } from "../utils/response.js";
import { authMiddleware } from "../middleware/auth.js";
import prisma from "../prisma.js";

const sessions = new Hono<AppEnv>();

sessions.use("/*", authMiddleware);

// ─── GET / ───

sessions.get("/", async (c) => {
  const currentSessionId = c.get("sessionId");
  const userId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);

  const rows = await prisma.session.findMany({
    where: {
      userId,
      expiresAt: { gt: now }
    },
    orderBy: { lastUsedAt: "desc" },
  });

  const list: SessionInfo[] = rows.map((s) => ({
    id: s.id,
    deviceName: s.deviceName,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    isCurrent: s.id === currentSessionId,
  }));

  return success(c, { sessions: list });
});

// ─── DELETE /:id ───

sessions.delete("/:id", async (c) => {
  const sessionId = c.req.param("id");
  const userId = c.get("userId");

  // 不允许撤销当前会话（用 logout 代替）
  if (sessionId === c.get("sessionId")) {
    return error(c, ErrorCode.INVALID_REQUEST, "Cannot revoke current session. Use logout instead.", 400);
  }

  try {
    const result = await prisma.session.deleteMany({
      where: {
        id: sessionId,
        userId: userId
      }
    });

    if (result.count === 0) {
      return error(c, ErrorCode.NOT_FOUND, "Session not found", 404);
    }
  } catch {
    return error(c, ErrorCode.NOT_FOUND, "Session not found", 404);
  }

  return success(c, { success: true });
});

export default sessions;
