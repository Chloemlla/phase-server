import { Hono } from "hono";
import { cors } from "hono/cors";
import { instanceTokenMiddleware } from "./middleware/instanceToken";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import auth from "./routes/auth";
import sessions from "./routes/sessions";
import vault from "./routes/vault";
import type { AppContext, AppEnv } from "./types";
import { ErrorCode } from "./types";
import { ensureInitialized } from "./utils/init";

const app = new Hono<AppEnv>();

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

app.use("/api/*", async (c, next) => {
  const { jwtSecret, instanceSalt, instanceToken } = await ensureInitialized(c.env.DB, c.env.JWT_SECRET);
  c.set("jwtSecret", jwtSecret);
  c.set("instanceSalt", instanceSalt);
  c.set("instanceToken", instanceToken);
  await next();
});

app.use("/api/*", instanceTokenMiddleware);
app.use("/api/*", rateLimitMiddleware);

async function healthHandler(c: AppContext) {
  const row = await c.env.DB.prepare("SELECT id FROM vault WHERE id = 'default'").first();
  return c.json({
    status: "ok" as const,
    initialized: !!row,
    version: "0.1.0",
    instanceSalt: c.get("instanceSalt"),
  });
}

app.get("/", async (c) => {
  try {
    const { instanceSalt } = await ensureInitialized(c.env.DB, c.env.JWT_SECRET);
    const row = await c.env.DB.prepare("SELECT id FROM vault WHERE id = 'default'").first();

    return c.json({
      status: "ok" as const,
      initialized: !!row,
      apiBase: "/api/v1",
      health: "/api/v1/health",
      instanceSalt,
    });
  } catch (err) {
    console.error("Root readiness check failed:", err);
    return c.json(
      {
        status: "error",
        message: "Phase server is not ready",
        apiBase: "/api/v1",
        health: "/api/v1/health",
      },
      503,
    );
  }
});

app.get("/api/v1/setup-token", async (c) => {
  const revealed = await c.env.DB.prepare(
    "SELECT value FROM config WHERE key = 'token_revealed'",
  ).first<{ value: string }>();

  if (revealed) {
    return c.json(
      {
        error: {
          code: ErrorCode.NOT_FOUND,
          message: "Instance token has already been retrieved. This endpoint is permanently closed.",
          status: 410,
        },
      },
      410,
    );
  }

  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO config (key, value) VALUES ('token_revealed', '1')",
  ).run();

  return c.json({ instanceToken: c.get("instanceToken") });
});

app.route("/api/v1/auth", auth);
app.route("/api/v1/auth/devices", sessions);
app.route("/api/v1/vault", vault);

app.get("/api/v1/health", healthHandler);

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
