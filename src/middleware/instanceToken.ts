import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { ErrorCode } from "../types";

// Instance Token 中间件：验证 X-Phase-Instance-Token header
// 保护所有 /api/* 路由，防止未授权访问（端口扫描、暴力破解等）
// 若 INSTANCE_TOKEN 环境变量未设置（本地开发），则放行所有请求

export const instanceTokenMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const expected = c.env.INSTANCE_TOKEN;

  // 未设置 INSTANCE_TOKEN → 开发模式，直接放行
  if (!expected) return next();

  const provided = c.req.header("X-Phase-Instance-Token");
  if (!provided || provided !== expected) {
    return c.json(
      { error: { code: ErrorCode.FORBIDDEN, message: "Invalid or missing instance token", status: 403 } },
      403,
    );
  }

  return next();
});
