import { Hono } from "hono";
import type { AppEnv, UserRow, RegisterRequest, LoginRequest, ChangePasswordRequest } from "../types";
import { ErrorCode } from "../types";
import { hashPassword, verifyPassword, createToken } from "../utils/crypto";
import { success, error } from "../utils/response";
import { authMiddleware } from "../middleware/auth";

const auth = new Hono<AppEnv>();

// ─── POST /register ───

auth.post("/register", async (c) => {
  const body = await c.req.json<RegisterRequest>().catch(() => null);
  if (!body?.email || !body?.authHash || !body?.encryptedVault) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields: email, authHash, encryptedVault", 400);
  }

  // 自托管：只允许注册一个用户
  const existing = await c.env.DB.prepare("SELECT id FROM users LIMIT 1").first();
  if (existing) {
    return error(c, ErrorCode.ALREADY_REGISTERED, "An account already exists on this instance", 409);
  }

  const now = Math.floor(Date.now() / 1000);
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const hashedAuth = await hashPassword(body.authHash);
  const ip = c.req.header("cf-connecting-ip") ?? null;

  // 事务：创建用户 + vault + session
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, email, auth_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(userId, body.email, hashedAuth, now, now),
    c.env.DB.prepare(
      "INSERT INTO vaults (id, user_id, encrypted_data, version, updated_at) VALUES (?, ?, ?, 1, ?)",
    ).bind(userId, userId, body.encryptedVault, now),
    c.env.DB.prepare(
      "INSERT INTO sessions (id, user_id, device_name, ip_address, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(sessionId, userId, body.deviceName ?? "", ip, now, now, now + 7 * 24 * 3600),
  ]);

  const token = await createToken(userId, sessionId, c.get("jwtSecret"));
  return success(c, { token, userId } as const, 201);
});

// ─── POST /login ───

auth.post("/login", async (c) => {
  const body = await c.req.json<LoginRequest>().catch(() => null);
  if (!body?.email || !body?.authHash) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields: email, authHash", 400);
  }

  const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(body.email)
    .first<UserRow>();

  if (!user || !(await verifyPassword(body.authHash, user.auth_hash))) {
    return error(c, ErrorCode.UNAUTHORIZED, "Invalid email or password", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const ip = c.req.header("cf-connecting-ip") ?? null;

  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, device_name, ip_address, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(sessionId, user.id, body.deviceName ?? "", ip, now, now, now + 7 * 24 * 3600)
    .run();

  const token = await createToken(user.id, sessionId, c.get("jwtSecret"));
  return success(c, { token, userId: user.id });
});

// ─── POST /logout ───

auth.post("/logout", authMiddleware, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(c.get("sessionId"))
    .run();
  return success(c, { success: true });
});

// ─── POST /change-password ───

auth.post("/change-password", authMiddleware, async (c) => {
  const body = await c.req.json<ChangePasswordRequest>().catch(() => null);
  if (!body?.currentAuthHash || !body?.newAuthHash || !body?.encryptedVault || !body?.vaultVersion) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields", 400);
  }

  const userId = c.get("userId");
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();

  if (!user || !(await verifyPassword(body.currentAuthHash, user.auth_hash))) {
    return error(c, ErrorCode.UNAUTHORIZED, "Current password is incorrect", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const newHash = await hashPassword(body.newAuthHash);

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET auth_hash = ?, updated_at = ? WHERE id = ?")
      .bind(newHash, now, userId),
    c.env.DB.prepare("UPDATE vaults SET encrypted_data = ?, version = ?, updated_at = ? WHERE user_id = ?")
      .bind(body.encryptedVault, body.vaultVersion, now, userId),
    // 撤销除当前外的所有会话（密码变更后其他设备需重新登录）
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
      .bind(userId, c.get("sessionId")),
  ]);

  return success(c, { success: true });
});

export default auth;
