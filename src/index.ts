import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./types";
import { ErrorCode } from "./types";
import { instanceTokenMiddleware } from "./middleware/instanceToken";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { ensureInitialized } from "./utils/init";
import auth from "./routes/auth";
import vault from "./routes/vault";
import sessions from "./routes/sessions";

const app = new Hono<AppEnv>();

// ─── 全局中间件 ───

app.use("/*", async (c, next) => {
  const origin = c.env.CORS_ORIGIN ?? "*";
  const middleware = cors({
    origin: origin === "*" ? "*" : origin.split(","),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Phase-Instance-Token"],
    maxAge: 86400,
  });
  return middleware(c, next);
});

// Instance Token 保护所有 /api/* 路由（包括 /health）
app.use("/api/*", instanceTokenMiddleware);

// 自动初始化：建表 + 注入 JWT Secret + instanceSalt
app.use("/api/*", async (c, next) => {
  const { jwtSecret, instanceSalt } = await ensureInitialized(c.env.DB, c.env.JWT_SECRET);
  c.set("jwtSecret", jwtSecret);
  c.set("instanceSalt", instanceSalt);
  await next();
});

app.use("/api/*", rateLimitMiddleware);

// ─── 路由挂载 ───

app.route("/api/v1/auth", auth);
app.route("/api/v1/vault", vault);
app.route("/api/v1/sessions", sessions);

// ─── Health check ───

app.get("/api/v1/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT id FROM vault WHERE id = 'default'").first();
  return c.json({
    status: "ok" as const,
    initialized: !!row,
    version: "0.1.0",
    instanceSalt: c.get("instanceSalt"),
  });
});

// ─── 错误处理 ───

app.notFound((c) =>
  c.json({ error: { code: ErrorCode.NOT_FOUND, message: "Not found", status: 404 } }, 404),
);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    { error: { code: ErrorCode.INTERNAL_ERROR, message: "Internal server error", status: 500 } },
    500,
  );
});

export default app;
