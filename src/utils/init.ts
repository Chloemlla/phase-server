// 自动初始化：自动生成 JWT Secret + instanceSalt + instanceToken
// 用户部署后无需任何手动操作

import prisma from "../prisma";

// 同一进程内缓存，避免每次请求都查数据库
let cachedJwtSecret: string | null = null;
let cachedInstanceSalt: string | null = null;
let cachedInstanceToken: string | null = null;

export interface InitResult {
  jwtSecret: string;
  instanceSalt: string;
  instanceToken: string;
}

export async function ensureInitialized(envSecret?: string): Promise<InitResult> {
  // 返回缓存（同一进程内有效）
  if (cachedJwtSecret && cachedInstanceSalt && cachedInstanceToken) {
    return { jwtSecret: cachedJwtSecret, instanceSalt: cachedInstanceSalt, instanceToken: cachedInstanceToken };
  }

  // ── JWT Secret ── (可由环境变量覆盖，否则自动生成存数据库)
  let jwtSecret: string;
  if (envSecret) {
    jwtSecret = envSecret;
  } else {
    const row = await prisma.config.findUnique({ where: { key: "jwt_secret" } });
    if (row) {
      jwtSecret = row.value;
    } else {
      const secret = generateRandom(32);
      await prisma.config.upsert({
        where: { key: "jwt_secret" },
        update: {},
        create: { key: "jwt_secret", value: secret },
      });
      const created = await prisma.config.findUnique({ where: { key: "jwt_secret" } });
      jwtSecret = created!.value;
    }
  }

  // ── Instance Salt ── (首次生成后永久固定，用于客户端 PBKDF2)
  let instanceSalt: string;
  const saltRow = await prisma.config.findUnique({ where: { key: "instance_salt" } });
  if (saltRow) {
    instanceSalt = saltRow.value;
  } else {
    const newSalt = generateRandom(32);
    await prisma.config.upsert({
      where: { key: "instance_salt" },
      update: {},
      create: { key: "instance_salt", value: newSalt },
    });
    const created = await prisma.config.findUnique({ where: { key: "instance_salt" } });
    instanceSalt = created!.value;
  }

  // ── Instance Token ── (自动生成，永久固定，通过 /api/v1/setup-token 一次性取回)
  let instanceToken: string;
  const tokenRow = await prisma.config.findUnique({ where: { key: "instance_token" } });
  if (tokenRow) {
    instanceToken = tokenRow.value;
  } else {
    const newToken = generateRandom(32);
    await prisma.config.upsert({
      where: { key: "instance_token" },
      update: {},
      create: { key: "instance_token", value: newToken },
    });
    const created = await prisma.config.findUnique({ where: { key: "instance_token" } });
    instanceToken = created!.value;
  }

  cachedJwtSecret = jwtSecret;
  cachedInstanceSalt = instanceSalt;
  cachedInstanceToken = instanceToken;
  return { jwtSecret, instanceSalt, instanceToken };
}

function generateRandom(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}
