import { sign, verify } from "hono/jwt";

// ─── 密码哈希（SHA-256 + salt） ───
// 客户端已通过 PBKDF2 600K 轮派生 authHash（256-bit 高熵值），
// 服务端 SHA-256 足以保护，且符合 CF Workers 10ms CPU 时间限制

export async function hashPassword(authHash: string): Promise<string> {
  const salt = crypto.randomUUID();
  const hash = await sha256(authHash + ":" + salt);
  return salt + "$" + hash;
}

export async function verifyPassword(
  authHash: string,
  stored: string,
): Promise<boolean> {
  const idx = stored.indexOf("$");
  if (idx === -1) return false;
  const salt = stored.slice(0, idx);
  const expectedHash = stored.slice(idx + 1);
  const hash = await sha256(authHash + ":" + salt);
  return timingSafeEqual(hash, expectedHash);
}

// ─── JWT ───

const TOKEN_TTL = 7 * 24 * 60 * 60; // 7 天

export async function createToken(
  userId: string,
  sessionId: string,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, sid: sessionId, iat: now, exp: now + TOKEN_TTL }, secret);
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<{ sub: string; sid: string }> {
  const payload = await verify(token, secret, "HS256");
  return { sub: payload.sub as string, sid: payload.sid as string };
}

// ─── 内部工具 ───

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return arrayBufferToBase64(buf);
}

function timingSafeEqual(a: string, b: string): boolean {
  const encA = new TextEncoder().encode(a);
  const encB = new TextEncoder().encode(b);
  if (encA.length !== encB.length) return false;
  let result = 0;
  for (let i = 0; i < encA.length; i++) {
    result |= encA[i] ^ encB[i];
  }
  return result === 0;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
