# Phase Server - 客户端集成指南

## 快速开始

### 部署后端

```bash
# 1. 克隆并安装依赖
git clone https://github.com/YOUR_USER/phase-server.git
cd phase-server
bun install

# 2. 创建 D1 数据库
bunx wrangler d1 create phase-db
# 输出中有 database_id，复制到 wrangler.toml

# 3. 执行数据库迁移
bunx wrangler d1 migrations apply phase-db --local   # 本地
bunx wrangler d1 migrations apply phase-db --remote  # 生产

# 4. 设置 JWT Secret
bunx wrangler secret put JWT_SECRET
# 输入一个随机字符串（推荐: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"）

# 5. 本地开发
cp .dev.vars.example .dev.vars  # 编辑填入 JWT_SECRET
bun run dev                     # http://localhost:8787

# 6. 部署到 Cloudflare
bun run deploy
```

---

## 客户端密钥派生流程

这是客户端最核心的安全逻辑，必须严格实现。

### 注册流程

```typescript
// 1. 从主密码派生 Master Key
const masterKey = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt: new TextEncoder().encode(email), iterations: 600000, hash: "SHA-256" },
  await crypto.subtle.importKey("raw", new TextEncoder().encode(masterPassword), "PBKDF2", false, ["deriveKey", "deriveBits"]),
  { name: "HKDF", length: 256 },
  true,
  ["deriveKey", "deriveBits"]
);

// 实际操作中先 deriveBits 得到 masterKeyBits，再用 HKDF 派生下面两个 key

// 2. 派生 Encryption Key（用于加密 vault）
const masterKeyBits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt: new TextEncoder().encode(email), iterations: 600000, hash: "SHA-256" },
  await crypto.subtle.importKey("raw", new TextEncoder().encode(masterPassword), "PBKDF2", false, ["deriveBits"]),
  256
);

const encryptionKey = await crypto.subtle.deriveKey(
  { name: "HKDF", salt: new Uint8Array(0), info: new TextEncoder().encode("enc"), hash: "SHA-256" },
  await crypto.subtle.importKey("raw", masterKeyBits, "HKDF", false, ["deriveKey"]),
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt", "decrypt"]
);

// 3. 派生 Auth Key → Auth Hash（发送给服务端）
const authKeyBits = await crypto.subtle.deriveBits(
  { name: "HKDF", salt: new Uint8Array(0), info: new TextEncoder().encode("auth"), hash: "SHA-256" },
  await crypto.subtle.importKey("raw", masterKeyBits, "HKDF", false, ["deriveBits"]),
  256
);

const authHash = await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt: new TextEncoder().encode(masterPassword), iterations: 1, hash: "SHA-256" },
  await crypto.subtle.importKey("raw", authKeyBits, "PBKDF2", false, ["deriveBits"]),
  256
);

const authHashBase64 = btoa(String.fromCharCode(...new Uint8Array(authHash)));
```

### Vault 加解密

```typescript
// 加密
async function encryptVault(vault: object, encryptionKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(vault));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    plaintext
  );
  // 拼接: IV (12 bytes) + ciphertext + auth tag
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

// 解密
async function decryptVault(encrypted: string, encryptionKey: CryptoKey): Promise<object> {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
```

---

## API 参考

基础路径: `https://your-worker.workers.dev/api/v1`

所有认证端点需要 `Authorization: Bearer <token>` 头。

### 公共端点

#### `GET /health`

检查实例状态。

```json
// 响应
{ "status": "ok", "initialized": false, "version": "0.1.0" }
```

客户端启动时调用，`initialized: false` 表示需要注册，`true` 表示显示登录页。

---

### 认证

#### `POST /auth/register`

```json
// 请求
{
  "email": "user@example.com",
  "authHash": "base64...",
  "encryptedVault": "base64...",
  "deviceName": "Windows Desktop"
}

// 响应 201
{ "token": "jwt...", "userId": "uuid" }

// 错误 409
{ "error": { "code": "ALREADY_REGISTERED", "message": "...", "status": 409 } }
```

#### `POST /auth/login`

```json
// 请求
{ "email": "user@example.com", "authHash": "base64...", "deviceName": "iPhone 15" }

// 响应 200
{ "token": "jwt...", "userId": "uuid" }
```

#### `POST /auth/logout` (需认证)

```json
// 响应
{ "success": true }
```

#### `POST /auth/change-password` (需认证)

```json
// 请求（客户端需要用新密码重新加密整个 vault）
{
  "currentAuthHash": "base64...",
  "newAuthHash": "base64...",
  "encryptedVault": "base64...(用新密钥加密的 vault)",
  "vaultVersion": 42
}
```

---

### Vault 同步

#### `GET /vault` (需认证)

```json
// 响应
{
  "encryptedVault": "base64...",
  "version": 42,
  "updatedAt": "2024-03-02T00:00:00.000Z"
}
```

#### `PUT /vault` (需认证)

```json
// 请求
{ "encryptedVault": "base64...", "expectedVersion": 42 }

// 成功响应
{ "version": 43, "updatedAt": "2024-03-02T00:00:01.000Z" }

// 版本冲突 409 — 需要拉取最新版本并在客户端合并
{ "error": { "code": "VAULT_VERSION_CONFLICT", "message": "...", "status": 409 } }
```

#### `DELETE /vault` (需认证) — 删除账户

```json
// 请求（需再次确认密码）
{ "authHash": "base64..." }
```

---

### 会话管理

#### `GET /sessions` (需认证)

```json
{
  "sessions": [
    { "id": "uuid", "deviceName": "iPhone 15", "ipAddress": "1.2.3.4",
      "createdAt": 1709337600, "lastUsedAt": 1709337700, "isCurrent": true }
  ]
}
```

#### `DELETE /sessions/:id` (需认证)

撤销指定会话（不能撤销当前会话，用 logout 代替）。

---

## 同步协议

### 正常同步

```
客户端启动 → GET /vault → 对比本地 version
  - 服务端 version > 本地: 下载并解密远端 vault，替换本地
  - 服务端 version = 本地: 无需操作
  - 服务端 version < 本地: 不应发生（数据异常）
```

### 推送变更

```
本地修改 vault → PUT /vault { expectedVersion: 本地version }
  - 200: 成功，更新本地 version
  - 409: 版本冲突 → GET /vault 拉最新 → 客户端合并 → 重新 PUT
```

### 冲突合并规则（客户端实现）

```typescript
function mergeVaults(local: Vault, remote: Vault): Vault {
  const tokenMap = new Map<string, Token>();

  // 先放入远端令牌
  for (const t of remote.tokens) tokenMap.set(t.id, t);

  // 本地令牌：按 updatedAt 决定保留哪个
  for (const t of local.tokens) {
    const existing = tokenMap.get(t.id);
    if (!existing || t.updatedAt > existing.updatedAt) {
      tokenMap.set(t.id, t);
    }
  }

  return {
    tokens: [...tokenMap.values()],
    groups: [...new Set([...remote.groups, ...local.groups])],
    settings: local.updatedAt > remote.updatedAt ? local.settings : remote.settings,
    version: remote.version, // 使用远端版本号
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}
```

---

## Vault 明文结构

加密前的 JSON 结构，定义在客户端：

```typescript
interface Vault {
  tokens: Token[];
  groups: string[];
  settings: { defaultGroup: string; sortBy: "custom" | "name" | "recent"; autoLockMinutes: number };
  version: number;
  updatedAt: number; // Unix timestamp (秒)
}

interface Token {
  id: string;          // crypto.randomUUID()
  type: "totp";
  issuer: string;      // "GitHub"
  account: string;     // "user@example.com"
  secret: string;      // Base32 编码
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 7 | 8;
  period: number;      // 默认 30
  icon: string;
  group: string;
  order: number;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}
```
