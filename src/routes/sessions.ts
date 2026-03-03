import { Hono } from "hono";
import type { AppEnv, SessionRow, SessionInfo } from "../types";
import { ErrorCode } from "../types";
import { success, error } from "../utils/response";
import { authMiddleware } from "../middleware/auth";

const sessions = new Hono<AppEnv>();

sessions.use("/*", authMiddleware);

// ─── GET / ───

sessions.get("/", async (c) => {
  const userId = c.get("userId");
  const currentSessionId = c.get("sessionId");
  const now = Math.floor(Date.now() / 1000);

  const rows = await c.env.DB.prepare(
    "SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_used_at DESC",
  )
    .bind(userId, now)
    .all<SessionRow>();

  const list: SessionInfo[] = (rows.results ?? []).map((s) => ({
    id: s.id,
    deviceName: s.device_name,
    ipAddress: s.ip_address,
    createdAt: s.created_at,
    lastUsedAt: s.last_used_at,
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

  const result = await c.env.DB.prepare(
    "DELETE FROM sessions WHERE id = ? AND user_id = ?",
  )
    .bind(sessionId, userId)
    .run();

  if (!result.meta.changes) {
    return error(c, ErrorCode.NOT_FOUND, "Session not found", 404);
  }

  return success(c, { success: true });
});

export default sessions;
