import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { ErrorCode } from "../types";

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  "/api/v1/auth/login": { limit: 5, windowSeconds: 15 * 60 },
  "/api/v1/auth/register": { limit: 3, windowSeconds: 60 * 60 },
  "/api/v1/auth/change-password": { limit: 10, windowSeconds: 60 },
  "/api/v1/auth/logout": { limit: 10, windowSeconds: 60 },
};

const DEFAULT_LIMIT: RateLimitConfig = { limit: 60, windowSeconds: 60 };

export const rateLimitMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const path = c.req.path;

  // health 不限速
  if (path === "/api/v1/health") return next();

  const config = RATE_LIMITS[path] ?? DEFAULT_LIMIT;
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / config.windowSeconds) * config.windowSeconds;
  const key = `${ip}:${path}`;

  const row = await c.env.DB.prepare(
    "SELECT count FROM rate_limits WHERE key = ? AND window_start = ?",
  )
    .bind(key, windowStart)
    .first<{ count: number }>();

  if (row && row.count >= config.limit) {
    const retryAfter = windowStart + config.windowSeconds - now;
    c.header("Retry-After", String(retryAfter));
    return c.json(
      { error: { code: ErrorCode.RATE_LIMITED, message: "Too many requests", status: 429 } },
      429,
    );
  }

  // 递增计数（upsert）
  await c.env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`,
  )
    .bind(key, windowStart)
    .run();

  // 1% 概率清理过期记录
  if (Math.random() < 0.01) {
    await c.env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
      .bind(now - 3600)
      .run();
  }

  await next();
});
