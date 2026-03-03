import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { ErrorCode } from "../types";

// Instance Token 中间件：验证 X-Phase-Instance-Token header
// instanceToken 由服务端自动生成存入 D1，通过 /api/v1/setup-token 一次性取回
// 保护所有 /api/* 路由（/setup-token 端点除外）

export const instanceTokenMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // /setup-token 端点不校验 token（它本身就是取 token 用的）
  if (c.req.path === "/api/v1/setup-token") return next();

  const expected = c.get("instanceToken");
  const provided = c.req.header("X-Instance-Token");

  if (!provided || provided !== expected) {
    return c.json(
      { error: { code: ErrorCode.FORBIDDEN, message: "Invalid or missing instance token", status: 403 } },
      403,
    );
  }

  return next();
});
