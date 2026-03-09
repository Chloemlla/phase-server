import { Hono } from "hono";
import type { AppEnv, VaultUpdateRequest } from "../types.js";
import { ErrorCode } from "../types.js";
import { success, error } from "../utils/response.js";
import { authMiddleware } from "../middleware/auth.js";
import prisma from "../prisma.js";

const vault = new Hono<AppEnv>();

vault.use("/*", authMiddleware);

// ─── GET / ───

vault.get("/", async (c) => {
  const userId = c.get("userId");
  const row = await prisma.vault.findUnique({ where: { userId } });

  if (!row) {
    return error(c, ErrorCode.NOT_FOUND, "Vault not found", 404);
  }

  return success(c, {
    encryptedVault: row.encryptedData,
    version: row.version,
    updatedAt: new Date(row.updatedAt * 1000).toISOString(),
  });
});

// ─── PUT / ───

vault.put("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<VaultUpdateRequest>().catch(() => null);

  if (!body || typeof body.encryptedVault !== "string" || !Number.isInteger(body.expectedVersion)) {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing or invalid required fields: encryptedVault, expectedVersion", 400);
  }

  // 防御大型载荷引起的内存耗尽/DoS：设置 10MB 上限
  if (body.encryptedVault.length > 10 * 1024 * 1024) {
    return error(c, ErrorCode.INVALID_REQUEST, "Payload too large. Maximum size is 10MB", 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const newVersion = body.expectedVersion + 1;

  // 乐观锁：只有 version 匹配时才更新
  const updateResult = await prisma.vault.updateMany({
    where: { userId, version: body.expectedVersion },
    data: {
      encryptedData: body.encryptedVault,
      version: newVersion,
      updatedAt: now,
    },
  });

  if (updateResult.count === 0) {
    const current = await prisma.vault.findUnique({
      where: { userId },
      select: { version: true },
    }).catch(() => null);

    if (current) {
      return error(
        c,
        ErrorCode.VAULT_VERSION_CONFLICT,
        `Version conflict. Expected ${body.expectedVersion} but current is ${current.version}`,
        409,
      );
    } else {
      return error(c, ErrorCode.NOT_FOUND, "Vault not found", 404);
    }
  }

  return success(c, {
    version: newVersion,
    updatedAt: new Date(now * 1000).toISOString(),
  });
});

export default vault;
