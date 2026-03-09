import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { instanceTokenMiddleware } from "./middleware/instanceToken.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import auth from "./routes/auth.js";
import sessions from "./routes/sessions.js";
import vault from "./routes/vault.js";
import activationCodes from "./routes/activationCodes.js";
import webauthn from "./routes/webauthn.js";
import security from "./routes/security.js";
import type { AppContext, AppEnv } from "./types.js";
import { ErrorCode } from "./types.js";
import { ensureInitialized } from "./utils/init.js";
import prisma from "./prisma.js";

const app = new Hono<AppEnv>();

app.use("/*", async (c, next) => {
  const origin = process.env.CORS_ORIGIN ?? "*";
  const middleware = cors({
    origin: origin === "*" ? "*" : origin.split(","),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Instance-Token"],
    maxAge: 86400,
  });
  return middleware(c, next);
});

app.use("/api/*", async (c, next) => {
  const { jwtSecret, instanceSalt, instanceToken } = await ensureInitialized(process.env.JWT_SECRET);
  c.set("jwtSecret", jwtSecret);
  c.set("instanceSalt", instanceSalt);
  c.set("instanceToken", instanceToken);
  await next();
});

app.use("/api/*", instanceTokenMiddleware);
app.use("/api/*", rateLimitMiddleware);

async function healthHandler(c: AppContext) {
  return c.json({
    status: "ok" as const,
    initialized: true,
    version: "0.4.0", // upgraded to multi-tenant
    instanceSalt: c.get("instanceSalt"),
    membership: {
      active: false,
      expiresAt: null,
    },
  });
}

app.get("/", async (c) => {
  try {
    const { instanceSalt } = await ensureInitialized(process.env.JWT_SECRET);
    return c.json({
      status: "ok" as const,
      initialized: true,
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
  const revealed = await prisma.config.findUnique({ where: { key: "token_revealed" } });

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

  await prisma.config.upsert({
    where: { key: "token_revealed" },
    update: {},
    create: { key: "token_revealed", value: "1" },
  });

  return c.json({ instanceToken: c.get("instanceToken") });
});

app.route("/api/v1/auth", auth);
app.route("/api/v1/auth/devices", sessions);
app.route("/api/v1/vault", vault);
app.route("/api/v1/activation-codes", activationCodes);
app.route("/api/v1/webauthn", webauthn);
app.route("/api/v1/security", security);

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

// ─── 启动服务 ───

const port = Number(process.env.PORT) || 3000;

serve({
  fetch: app.fetch,
  port,
}, (info) => {
  console.log(`Phase server running on http://localhost:${info.port}`);
});
