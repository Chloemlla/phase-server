import { createMiddleware } from "hono/factory";
import type { AppEnv, SessionRow } from "../types";
import { ErrorCode } from "../types";
import { verifyToken } from "../utils/crypto";

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json(
      { error: { code: ErrorCode.UNAUTHORIZED, message: "Missing or invalid Authorization header", status: 401 } },
      401,
    );
  }

  const token = header.slice(7);
  let payload: { sub: string; sid: string };
  try {
    payload = await verifyToken(token, c.get("jwtSecret"));
  } catch {
    return c.json(
      { error: { code: ErrorCode.UNAUTHORIZED, message: "Invalid or expired token", status: 401 } },
      401,
    );
  }

  // 检查 session 是否仍有效（支持主动撤销）
  const now = Math.floor(Date.now() / 1000);
  const session = await c.env.DB.prepare(
    "SELECT id FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?",
  )
    .bind(payload.sid, payload.sub, now)
    .first<SessionRow>();

  if (!session) {
    return c.json(
      { error: { code: ErrorCode.UNAUTHORIZED, message: "Session expired or revoked", status: 401 } },
      401,
    );
  }

  // 更新 last_used_at
  await c.env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?")
    .bind(now, payload.sid)
    .run();

  c.set("userId", payload.sub);
  c.set("sessionId", payload.sid);
  await next();
});
