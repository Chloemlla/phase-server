import { Hono } from "hono";
import type { AppContext, AppEnv, OpenRequest, SetupRequest } from "../types";
import { ErrorCode } from "../types";
import { authMiddleware } from "../middleware/auth";
import { createToken } from "../utils/crypto";
import { error, success } from "../utils/response";

const auth = new Hono<AppEnv>();

async function initHandler(c: AppContext) {
  const body = await c.req.json<SetupRequest>().catch(() => null);
  if (!body?.encryptedVault) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required field: encryptedVault", 400);
  }

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
}

async function unlockHandler(c: AppContext) {
  const body = await c.req.json<OpenRequest>().catch(() => null);

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
}

auth.post("/init", initHandler);
auth.post("/unlock", unlockHandler);

auth.post("/logout", authMiddleware, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(c.get("sessionId"))
    .run();
  return success(c, { success: true });
});

export default auth;
