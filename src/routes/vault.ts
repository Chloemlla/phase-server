import { Hono } from "hono";
import type { AppEnv, VaultUpdateRequest } from "../types";
import { ErrorCode } from "../types";
import { success, error } from "../utils/response";
import { authMiddleware } from "../middleware/auth";
import prisma from "../prisma";

const vault = new Hono<AppEnv>();

vault.use("/*", authMiddleware);

// ─── GET / ───

vault.get("/", async (c) => {
  const row = await prisma.vault.findUnique({ where: { id: "default" } });

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
  try {
    await prisma.vault.update({
      where: { id: "default", version: body.expectedVersion },
      data: {
        encryptedData: body.encryptedVault,
        version: newVersion,
        updatedAt: now,
      },
    });
  } catch (err: any) {
    // P2025: 欲更新的记录不存在 (通常是因为 version 不匹配)
    if (err.code === "P2025") {
      const current = await prisma.vault.findUnique({
        where: { id: "default" },
        select: { version: true },
      }).catch(() => null);

      return error(
        c,
        ErrorCode.VAULT_VERSION_CONFLICT,
        `Version conflict. Expected ${body.expectedVersion} but current is ${current?.version ?? "unknown"}`,
        409,
      );
    }

    // 把其余真正的数据库断连/崩溃异常向外抛，避免被错误识别为版本冲突
    throw err;
  }

  return success(c, {
    version: newVersion,
    updatedAt: new Date(now * 1000).toISOString(),
  });
});

export default vault;
