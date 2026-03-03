import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { ErrorCode } from "../types";

export const instanceTokenMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.path === "/api/v1/setup-token" || c.req.path === "/api/v1/health") {
    return next();
  }

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
