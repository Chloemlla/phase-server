import { Hono } from "hono";
import type { AppEnv, VaultRow, UserRow, VaultUpdateRequest, DeleteAccountRequest } from "../types";
import { ErrorCode } from "../types";
import { verifyPassword } from "../utils/crypto";
import { success, error } from "../utils/response";
import { authMiddleware } from "../middleware/auth";

const vault = new Hono<AppEnv>();

vault.use("/*", authMiddleware);

// ─── GET / ───

vault.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM vaults WHERE user_id = ?")
    .bind(c.get("userId"))
    .first<VaultRow>();

  if (!row) {
    return error(c, ErrorCode.NOT_FOUND, "Vault not found", 404);
  }

  return success(c, {
    encryptedVault: row.encrypted_data,
    version: row.version,
    updatedAt: new Date(row.updated_at * 1000).toISOString(),
  });
});

// ─── PUT / ───

vault.put("/", async (c) => {
  const body = await c.req.json<VaultUpdateRequest>().catch(() => null);
  if (!body?.encryptedVault || typeof body?.expectedVersion !== "number") {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields: encryptedVault, expectedVersion", 400);
  }

  const userId = c.get("userId");
  const now = Math.floor(Date.now() / 1000);
  const newVersion = body.expectedVersion + 1;

  // 乐观锁：只有 version 匹配时才更新
  const result = await c.env.DB.prepare(
    "UPDATE vaults SET encrypted_data = ?, version = ?, updated_at = ? WHERE user_id = ? AND version = ?",
  )
    .bind(body.encryptedVault, newVersion, now, userId, body.expectedVersion)
    .run();

  if (!result.meta.changes) {
    // 版本冲突：返回当前版本让客户端合并
    const current = await c.env.DB.prepare("SELECT version FROM vaults WHERE user_id = ?")
      .bind(userId)
      .first<{ version: number }>();

    return error(
      c,
      ErrorCode.VAULT_VERSION_CONFLICT,
      `Version conflict. Expected ${body.expectedVersion} but current is ${current?.version ?? "unknown"}`,
      409,
    );
  }

  return success(c, {
    version: newVersion,
    updatedAt: new Date(now * 1000).toISOString(),
  });
});

// ─── DELETE / ───

vault.delete("/", async (c) => {
  const body = await c.req.json<DeleteAccountRequest>().catch(() => null);
  if (!body?.authHash) {
    return error(c, ErrorCode.INVALID_REQUEST, "Password confirmation required", 400);
  }

  const userId = c.get("userId");
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(userId)
    .first<UserRow>();

  if (!user || !(await verifyPassword(body.authHash, user.auth_hash))) {
    return error(c, ErrorCode.UNAUTHORIZED, "Password is incorrect", 401);
  }

  // 删除所有关联数据
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM vaults WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);

  return success(c, { success: true });
});

export default vault;
