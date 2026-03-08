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
  if (!body?.encryptedVault || typeof body?.expectedVersion !== "number") {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required fields: encryptedVault, expectedVersion", 400);
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
  } catch {
    // update with where constraint fails → version conflict or not found
    const current = await prisma.vault.findUnique({
      where: { id: "default" },
      select: { version: true },
    });

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
