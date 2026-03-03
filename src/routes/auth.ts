import { Hono } from "hono";
import type { AppEnv, SetupRequest, OpenRequest } from "../types";
import { ErrorCode } from "../types";
import { createToken } from "../utils/crypto";
import { success, error } from "../utils/response";
import { authMiddleware } from "../middleware/auth";

const auth = new Hono<AppEnv>();

// ─── POST /setup ───
// 首次初始化：存储加密 vault，创建第一个 session
// 若 vault 已存在则返回 409（已初始化）

auth.post("/setup", async (c) => {
  const body = await c.req.json<SetupRequest>().catch(() => null);
  if (!body?.encryptedVault) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required field: encryptedVault", 400);
  }

  // 检查是否已初始化
  const existing = await c.env.DB.prepare("SELECT id FROM vault WHERE id = 'default'").first();
  if (existing) {
    return error(c, ErrorCode.ALREADY_INITIALIZED, "This instance is already initialized", 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const ip = c.req.header("cf-connecting-ip") ?? null;

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO vault (id, encrypted_data, version, updated_at) VALUES ('default', ?, 1, ?)",
    ).bind(body.encryptedVault, now),
    c.env.DB.prepare(
      "INSERT INTO sessions (id, device_name, ip_address, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(sessionId, body.deviceName ?? "", ip, now, now, now + 7 * 24 * 3600),
  ]);

  const token = await createToken(sessionId, c.get("jwtSecret"));
  return success(c, { token }, 201);
});

// ─── POST /open ───
// 后续解锁：验证 Instance Token（已在中间件完成），创建新 session

auth.post("/open", async (c) => {
  const body = await c.req.json<OpenRequest>().catch(() => null);

  // 检查是否已初始化
  const existing = await c.env.DB.prepare("SELECT id FROM vault WHERE id = 'default'").first();
  if (!existing) {
    return error(c, ErrorCode.NOT_FOUND, "This instance has not been initialized yet", 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const ip = c.req.header("cf-connecting-ip") ?? null;

  await c.env.DB.prepare(
    "INSERT INTO sessions (id, device_name, ip_address, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(sessionId, body?.deviceName ?? "", ip, now, now, now + 7 * 24 * 3600)
    .run();

  const token = await createToken(sessionId, c.get("jwtSecret"));
  return success(c, { token });
});

// ─── POST /logout ───

auth.post("/logout", authMiddleware, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(c.get("sessionId"))
    .run();
  return success(c, { success: true });
});

export default auth;
