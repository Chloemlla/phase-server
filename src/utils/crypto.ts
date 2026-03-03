import { sign, verify } from "hono/jwt";

// ─── JWT ───

const TOKEN_TTL = 7 * 24 * 60 * 60; // 7 天

export async function createToken(sessionId: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sid: sessionId, iat: now, exp: now + TOKEN_TTL }, secret);
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<{ sid: string }> {
  const payload = await verify(token, secret, "HS256");
  return { sid: payload.sid as string };
}
