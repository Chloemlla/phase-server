import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { ErrorCode } from "../types";
import prisma from "../prisma";

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "/api/v1/auth/init": { limit: 3, windowSeconds: 60 * 60 },
  "/api/v1/auth/unlock": { limit: 5, windowSeconds: 15 * 60 },
  "/api/v1/auth/logout": { limit: 10, windowSeconds: 60 },
};

const DEFAULT_LIMIT: RateLimitConfig = { limit: 60, windowSeconds: 60 };

export const rateLimitMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const path = c.req.path;

  // health 不限速
  if (path === "/api/v1/health") return next();

  const config = RATE_LIMITS[path] ?? DEFAULT_LIMIT;
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? c.req.header("x-real-ip")
    ?? "unknown";
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / config.windowSeconds) * config.windowSeconds;
  const key = `${ip}:${path}`;

  const row = await prisma.rateLimit.findUnique({
    where: { key_windowStart: { key, windowStart } },
  });

  if (row && row.count >= config.limit) {
    const retryAfter = windowStart + config.windowSeconds - now;
    c.header("Retry-After", String(retryAfter));
    return c.json(
      { error: { code: ErrorCode.RATE_LIMITED, message: "Too many requests", status: 429 } },
      429,
    );
  }

  // 递增计数（upsert）
  await prisma.rateLimit.upsert({
    where: { key_windowStart: { key, windowStart } },
    update: { count: { increment: 1 } },
    create: { key, count: 1, windowStart },
  });

  // 1% 概率清理过期记录
  if (Math.random() < 0.01) {
    await prisma.rateLimit.deleteMany({
      where: { windowStart: { lt: now - 3600 } },
    });
  }

  await next();
});
