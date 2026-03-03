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
    allowHeaders: ["Content-Type", "Authorization", "X-Instance-Token"],
    maxAge: 86400,
  });
  return middleware(c, next);
});

// 初始化：建表 + 注入 jwtSecret / instanceSalt / instanceToken（必须在 instanceToken 中间件之前）
app.use("/api/*", async (c, next) => {
  const { jwtSecret, instanceSalt, instanceToken } = await ensureInitialized(c.env.DB, c.env.JWT_SECRET);
  c.set("jwtSecret", jwtSecret);
  c.set("instanceSalt", instanceSalt);
  c.set("instanceToken", instanceToken);
  await next();
});

// Instance Token 保护所有 /api/* 路由（/setup-token 自身除外）
app.use("/api/*", instanceTokenMiddleware);

app.use("/api/*", rateLimitMiddleware);

// ─── 一次性取回 Instance Token ───
// 部署后用浏览器访问一次，拿到 token 后此端点自动关闭
// 通过 DB 标记 token_revealed = true 实现，之后永远返回 410 Gone

app.get("/api/v1/setup-token", async (c) => {
  const revealed = await c.env.DB.prepare(
    "SELECT value FROM config WHERE key = 'token_revealed'",
  ).first<{ value: string }>();

  if (revealed) {
    return c.json(
      { error: { code: ErrorCode.NOT_FOUND, message: "Instance token has already been retrieved. This endpoint is permanently closed.", status: 410 } },
      410 as any,
    );
  }

  // 标记已取回，永久关闭此端点
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO config (key, value) VALUES ('token_revealed', '1')",
  ).run();

  const instanceToken = c.get("instanceToken");
  return c.json({ instanceToken });
});

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
