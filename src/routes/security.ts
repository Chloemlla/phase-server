import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { ErrorCode } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { success, error } from "../utils/response.js";
import { logSecurityEvent, createPasswordCheckEvent } from "../utils/securityEvents.js";

const security = new Hono<AppEnv>();

// 所有安全接口需要认证
security.use("/*", authMiddleware);

// ─── POST /check-password-breach - 检查密码是否泄露 ───

interface CheckPasswordBreachRequest {
  passwordHash: string; // SHA-1 哈希的前5个字符
}

security.post("/check-password-breach", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<CheckPasswordBreachRequest>().catch(() => null);

  if (!body?.passwordHash || typeof body.passwordHash !== "string") {
    return error(c, ErrorCode.INVALID_REQUEST, "Missing required field: passwordHash", 400);
  }

  // 验证哈希前缀格式（应该是5个十六进制字符）
  if (!/^[0-9A-Fa-f]{5}$/.test(body.passwordHash)) {
    return error(c, ErrorCode.INVALID_REQUEST, "Invalid hash format. Expected 5 hex characters", 400);
  }

  try {
    // 调用 Have I Been Pwned API
    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${body.passwordHash.toUpperCase()}`,
      {
        headers: {
          "User-Agent": "Phase-Password-Manager",
        },
      },
    );

    if (!response.ok) {
      return error(c, ErrorCode.INTERNAL_ERROR, "Failed to check password breach", 500);
    }

    const text = await response.text();

    // 解析响应，查找完整哈希匹配
    // 响应格式: SUFFIX:COUNT\nSUFFIX:COUNT\n...
    const lines = text.split("\n");
    let totalCount = 0;
    let breached = false;

    for (const line of lines) {
      const [suffix, countStr] = line.split(":");
      if (suffix && countStr) {
        const count = parseInt(countStr, 10);
        if (!isNaN(count)) {
          totalCount += count;
          breached = true;
        }
      }
    }

    // 记录密码检查事件
    if (breached) {
      await logSecurityEvent(createPasswordCheckEvent(
        "breach_detected",
        userId,
        { breachCount: totalCount }
      ));
    } else {
      await logSecurityEvent(createPasswordCheckEvent(
        "breach_check_passed",
        userId,
        {}
      ));
    }

    return success(c, {
      breached,
      count: totalCount,
    });
  } catch (err) {
    console.error("HIBP API error:", err);
    return error(c, ErrorCode.INTERNAL_ERROR, "Failed to check password breach", 500);
  }
});

export default security;
