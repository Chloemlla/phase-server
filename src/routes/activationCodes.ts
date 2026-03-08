import crypto from "node:crypto";
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { ErrorCode } from "../types";
import { authMiddleware } from "../middleware/auth";
import { success, error } from "../utils/response";
import prisma from "../prisma";

const activationCodes = new Hono<AppEnv>();

// ─── 所有激活码管理接口需要认证 ───

activationCodes.use("/*", authMiddleware);

// ─── 生成激活码 ───

function generateCode(length = 16): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 排除易混淆字符 I/1/O/0
    const buf = new Uint8Array(length);
    crypto.getRandomValues(buf);
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

    if (!body?.membershipDays || typeof body.membershipDays !== "number" || body.membershipDays <= 0) {
        return error(c, ErrorCode.INVALID_REQUEST, "membershipDays must be a positive integer", 400);
    }

    const count = Math.min(Math.max(body.count ?? 1, 1), 50);
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

    const where = status === "unused"
        ? { usedAt: null }
        : status === "used"
            ? { usedAt: { not: null } }
            : undefined;

    const rows = await prisma.activationCode.findMany({
        where,
        orderBy: { createdAt: "desc" },
    });

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
    const body = await c.req.json<RedeemRequest>().catch(() => null);

    if (!body?.code || typeof body.code !== "string") {
        return error(c, ErrorCode.INVALID_REQUEST, "Missing required field: code", 400);
    }

    // 标准化：去掉空格，统一大写
    const normalizedCode = body.code.replace(/\s/g, "").toUpperCase();

    const codeRow = await prisma.activationCode.findUnique({
        where: { code: normalizedCode },
    });

    if (!codeRow) {
        return error(c, ErrorCode.NOT_FOUND, "Invalid activation code", 404);
    }

    if (codeRow.usedAt !== null) {
        return error(c, ErrorCode.INVALID_REQUEST, "This activation code has already been used", 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const daysInSeconds = codeRow.membershipDays * 24 * 3600;

    // 查看当前会员状态
    const currentMembership = await prisma.membership.findUnique({
        where: { id: "default" },
    });

    // 如果当前会员有效且未过期，在现有到期时间上叠加；否则从现在开始计算
    const baseTime = currentMembership && currentMembership.expiresAt > now
        ? currentMembership.expiresAt
        : now;
    const newExpiresAt = baseTime + daysInSeconds;

    // 事务：标记激活码已使用 + 更新会员到期时间
    await prisma.$transaction([
        prisma.activationCode.update({
            where: { id: codeRow.id },
            data: { usedAt: now },
        }),
        prisma.membership.upsert({
            where: { id: "default" },
            update: {
                expiresAt: newExpiresAt,
                updatedAt: now,
            },
            create: {
                id: "default",
                expiresAt: newExpiresAt,
                updatedAt: now,
            },
        }),
    ]);

    return success(c, {
        membershipExpiresAt: newExpiresAt,
        membershipDaysAdded: codeRow.membershipDays,
        membershipExpiresAtISO: new Date(newExpiresAt * 1000).toISOString(),
    });
});

// ─── GET /membership — 查询会员状态 ───

activationCodes.get("/membership", async (c) => {
    const membership = await prisma.membership.findUnique({
        where: { id: "default" },
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
