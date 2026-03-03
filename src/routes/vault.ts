import { Hono } from "hono";
import type { AppEnv, VaultRow, VaultUpdateRequest } from "../types";
import { ErrorCode } from "../types";
import { success, error } from "../utils/response";
import { authMiddleware } from "../middleware/auth";

const vault = new Hono<AppEnv>();

vault.use("/*", authMiddleware);

// ─── GET / ───

vault.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM vault WHERE id = 'default'")
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

  const now = Math.floor(Date.now() / 1000);
  const newVersion = body.expectedVersion + 1;

  // 乐观锁：只有 version 匹配时才更新
  const result = await c.env.DB.prepare(
    "UPDATE vault SET encrypted_data = ?, version = ?, updated_at = ? WHERE id = 'default' AND version = ?",
  )
    .bind(body.encryptedVault, newVersion, now, body.expectedVersion)
    .run();

  if (!result.meta.changes) {
    const current = await c.env.DB.prepare("SELECT version FROM vault WHERE id = 'default'")
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

export default vault;
