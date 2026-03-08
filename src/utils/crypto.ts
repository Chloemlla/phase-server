import jwt from "jsonwebtoken";

// ─── JWT ───

const TOKEN_TTL = 7 * 24 * 60 * 60; // 7 天

export function createToken(sessionId: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ sid: sessionId, iat: now, exp: now + TOKEN_TTL }, secret);
}

export function verifyToken(
  token: string,
  secret: string,
): { sid: string } {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
  return { sid: payload.sid as string };
}
