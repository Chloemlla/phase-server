import crypto from "node:crypto";
import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { ErrorCode } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";
import prisma from "../prisma.js";

const activationCodes = new Hono<AppEnv>();

// ─── 所有激活码管理接口需要认证 ───

activationCodes.use("/*", authMiddleware);

// ─── 生成激活码 ───

function generateCode(length = 16): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 排除易混淆字符 I/1/O/0
    const buf = new Uint8Array(length);
    if (typeof crypto.getRandomValues === "function") {
        crypto.getRandomValues(buf);
    } else if (crypto.webcrypto && typeof crypto.webcrypto.getRandomValues === "function") {
        crypto.webcrypto.getRandomValues(buf);
    } else {
        (crypto as any).randomFillSync(buf); // Fallback for Node 18 or older
    }
    return Array.from(buf)
        .map((b) => chars[b % chars.length])
        .join("")
        .replace(/(.{4})/g, "$1-")
        .slice(0, -1); // 格式: XXXX-XXXX-XXXX-XXXX
}

// ─── POST / — 创建激活码 ───

interface CreateCodeRequest {
    membershipDays: number;   // 激活后赋予的会员天数
    count?: number;           // 批量创建数量（默认 1，最大 50）
    note?: string;            // 备注
}

activationCodes.post("/", async (c) => {
    const body = await c.req.json<CreateCodeRequest>().catch(() => null);

    if (!body?.membershipDays || typeof body.membershipDays !== "number" || !Number.isInteger(body.membershipDays) || body.membershipDays <= 0) {
        return error(c, ErrorCode.INVALID_REQUEST, "membershipDays must be a positive integer", 400);
    }
    if (body.membershipDays > 36500) {
        return error(c, ErrorCode.INVALID_REQUEST, "membershipDays must not exceed 36500", 400);
    }

    const requestedCount = Number(body.count ?? 1);
    if (Number.isNaN(requestedCount)) {
        return error(c, ErrorCode.INVALID_REQUEST, "count must be a valid number", 400);
    }
    const count = Math.min(Math.max(Math.floor(requestedCount), 1), 50);
    const now = Math.floor(Date.now() / 1000);

    const codes = Array.from({ length: count }, () => ({
        id: crypto.randomUUID(),
        code: generateCode(),
        membershipDays: body.membershipDays,
        note: body.note ?? "",
        createdAt: now,
    }));

    await prisma.activationCode.createMany({ data: codes });

    return success(c, {
        codes: codes.map((item) => ({
            id: item.id,
            code: item.code,
            membershipDays: item.membershipDays,
            note: item.note,
            createdAt: item.createdAt,
        })),
    }, 201);
});

// ─── GET / — 列出所有激活码 ───

activationCodes.get("/", async (c) => {
    const status = c.req.query("status"); // "unused" | "used" | undefined (all)
    const limitQuery = Number(c.req.query("limit") ?? 100);
    const offsetQuery = Number(c.req.query("offset") ?? 0);

    const limit = Number.isNaN(limitQuery) ? 100 : Math.min(Math.max(limitQuery, 1), 500);
    const offset = Number.isNaN(offsetQuery) ? 0 : Math.max(offsetQuery, 0);

    const where = status === "unused"
        ? { usedAt: null }
        : status === "used"
            ? { usedAt: { not: null } }
            : undefined;

    const rows = await prisma.activationCode.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
    });

    const total = await prisma.activationCode.count({ where });

    return success(c, {
        codes: rows.map((row) => ({
            id: row.id,
            code: row.code,
            membershipDays: row.membershipDays,
            note: row.note,
            used: row.usedAt !== null,
            usedAt: row.usedAt,
            createdAt: row.createdAt,
        })),
        pagination: { total, limit, offset },
    });
});

// ─── DELETE /:id — 删除未使用的激活码 ───

activationCodes.delete("/:id", async (c) => {
    const id = c.req.param("id");

    const existing = await prisma.activationCode.findUnique({ where: { id } });
    if (!existing) {
        return error(c, ErrorCode.NOT_FOUND, "Activation code not found", 404);
    }
    if (existing.usedAt !== null) {
        return error(c, ErrorCode.INVALID_REQUEST, "Cannot delete an already used activation code", 400);
    }

    await prisma.activationCode.delete({ where: { id } });
    return success(c, { success: true });
});

// ─── POST /redeem — 兑换激活码 ───

interface RedeemRequest {
    code: string;
}

activationCodes.post("/redeem", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<RedeemRequest>().catch(() => null);

    if (!body?.code || typeof body.code !== "string") {
        return error(c, ErrorCode.INVALID_REQUEST, "Missing required field: code", 400);
    }

    // 标准化：去掉空格，统一大写
    const normalizedCode = body.code.replace(/\s/g, "").toUpperCase();

    try {
        const result = await prisma.$transaction(async (tx) => {
            const codeRow = await tx.activationCode.findUnique({
                where: { code: normalizedCode },
            });

            if (!codeRow) {
                throw new Error("NOT_FOUND");
            }

            if (codeRow.usedAt !== null) {
                throw new Error("ALREADY_USED");
            }

            const now = Math.floor(Date.now() / 1000);
            const daysInSeconds = codeRow.membershipDays * 24 * 3600;

            // 查看当前会员状态
            const currentMembership = await tx.membership.findUnique({
                where: { userId },
            });

            // 如果当前会员有效且未过期，在现有到期时间上叠加；否则从现在开始计算
            const baseTime = currentMembership && currentMembership.expiresAt > now
                ? currentMembership.expiresAt
                : now;
            const newExpiresAt = baseTime + daysInSeconds;

            // 标记激活码已使用
            await tx.activationCode.update({
                where: { id: codeRow.id },
                data: { usedAt: now, usedBy: userId },
            });

            // 更新会员到期时间
            if (currentMembership) {
                await tx.membership.update({
                    where: { userId },
                    data: {
                        expiresAt: newExpiresAt,
                        updatedAt: now,
                    },
                });
            } else {
                await tx.membership.create({
                    data: {
                        userId,
                        expiresAt: newExpiresAt,
                        updatedAt: now,
                    },
                });
            }

            return { newExpiresAt, membershipDays: codeRow.membershipDays };
        });

        return success(c, {
            membershipExpiresAt: result.newExpiresAt,
            membershipDaysAdded: result.membershipDays,
            membershipExpiresAtISO: new Date(result.newExpiresAt * 1000).toISOString(),
        });
    } catch (err: any) {
        if (err.message === "NOT_FOUND") {
            return error(c, ErrorCode.NOT_FOUND, "Invalid activation code", 404);
        }
        if (err.message === "ALREADY_USED") {
            return error(c, ErrorCode.INVALID_REQUEST, "This activation code has already been used", 400);
        }
        throw err;
    }
});

// ─── GET /membership — 查询会员状态 ───

activationCodes.get("/membership", async (c) => {
    const userId = c.get("userId");
    const membership = await prisma.membership.findUnique({
        where: { userId },
    });

    if (!membership) {
        return success(c, {
            active: false,
            expiresAt: null,
            expiresAtISO: null,
            remainingDays: 0,
        });
    }

    const now = Math.floor(Date.now() / 1000);
    const active = membership.expiresAt > now;
    const remainingSeconds = Math.max(0, membership.expiresAt - now);
    const remainingDays = Math.ceil(remainingSeconds / (24 * 3600));

    return success(c, {
        active,
        expiresAt: membership.expiresAt,
        expiresAtISO: new Date(membership.expiresAt * 1000).toISOString(),
        remainingDays,
    });
});

export default activationCodes;
