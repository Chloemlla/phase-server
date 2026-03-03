# Phase - 技术设计文档

## 1. 系统架构

### 1.1 架构概览

Phase 采用**极简同步服务器**架构。后端是纯粹的"加密数据存储+认证"服务，所有业务逻辑（TOTP 生成、加解密、分组搜索）均在客户端完成。

```
┌─────────────────────────────────────────────┐
│              Phase Client (Tauri 2.0)        │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  React   │ │  Crypto  │ │  TOTP Engine │  │
│  │   UI     │ │  Module  │ │  (RFC 6238)  │  │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       │            │               │          │
│  ┌────┴────────────┴───────────────┴───────┐  │
│  │           Vault Manager                 │  │
│  │  (本地存储 + 同步 + 加解密编排)           │  │
│  └────────────────┬────────────────────────┘  │
│                   │                           │
│  ┌────────────────┴────────────────────────┐  │
│  │      Tauri Native Bridge                │  │
│  │  (系统密钥链 / 生物识别 / 文件系统)       │  │
│  └────────────────┬────────────────────────┘  │
└───────────────────┼───────────────────────────┘
                    │ HTTPS (REST API)
┌───────────────────┼───────────────────────────┐
│    Cloudflare Edge Network                    │
│  ┌────────────────┴────────────────────────┐  │
│  │        Workers (API Layer)              │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐  │  │
│  │  │   Auth   │ │  Vault   │ │  Rate  │  │  │
│  │  │  Routes  │ │  Routes  │ │ Limiter│  │  │
│  │  └────┬─────┘ └────┬─────┘ └────────┘  │  │
│  └───────┼─────────────┼───────────────────┘  │
│          │             │                      │
│  ┌───────┴─────────────┴───────────────────┐  │
│  │              D1 (SQLite)                │  │
│  │  ┌────────┐ ┌────────┐ ┌────────────┐  │  │
│  │  │ users  │ │ vaults │ │  sessions  │  │  │
│  │  └────────┘ └────────┘ └────────────┘  │  │
│  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
```

### 1.2 设计原则

1. **零信任服务端**: 服务端永远不接触明文数据，即使数据库泄露也无法获取令牌 secret
2. **客户端优先**: 所有业务逻辑在客户端执行，服务端只做存储和认证
3. **离线优先**: 客户端维护完整的本地 vault，网络不可用时所有功能正常
4. **极简 API**: 后端 API 端点 < 10 个，代码量 < 1000 行

---

## 2. 安全模型与加密方案

### 2.1 密钥派生体系

Phase 的安全模型基于 BitWarden 的设计思路，但更精简。从用户的主密码派生出两个独立密钥：

```
Master Password (用户输入)
        │
        ▼
   PBKDF2-SHA256 (600,000 iterations)
   salt = email (UTF-8 编码)
        │
        ▼
   Master Key (256-bit)
        │
        ├──► HKDF-SHA256(info="enc") ──► Encryption Key (256-bit)
        │                                 用于 AES-256-GCM 加密 vault
        │
        └──► HKDF-SHA256(info="auth") ──► Auth Key (256-bit)
                                           │
                                           ▼
                                      PBKDF2-SHA256 (1 iteration)
                                      salt = Master Password
                                           │
                                           ▼
                                      Auth Hash (发送给服务端)
                                           │
                                           ▼
                                      bcrypt(Auth Hash) ──► 存储在 D1
```

**关键设计决策**:

- **PBKDF2 而非 Argon2**: WebCrypto API 原生支持 PBKDF2，无需额外 WASM 依赖，Tauri WebView 和 Workers 环境均可用
- **600,000 轮迭代**: OWASP 2023 推荐值，在现代设备上约 300-500ms
- **Email 作为 salt**: 确保不同用户相同密码产生不同密钥（自托管场景下只有一个用户，但保留此设计以符合安全标准）
- **Auth Hash 双重哈希**: 客户端先做 PBKDF2，服务端再做 bcrypt，即使 Auth Hash 被截获也无法反推 Master Key

### 2.2 Vault 加密

Vault 是所有令牌数据的集合，作为一个整体进行加密：

```
Vault 明文 (JSON)
{
  "tokens": [
    {
      "id": "uuid",
      "issuer": "GitHub",
      "account": "user@example.com",
      "secret": "JBSWY3DPEHPK3PXP",
      "algorithm": "SHA1",
      "digits": 6,
      "period": 30,
      "type": "totp",
      "icon": "github",
      "group": "工作",
      "order": 0,
      "createdAt": 1709337600,
      "updatedAt": 1709337600
    }
  ],
  "groups": ["工作", "个人", "金融"],
  "settings": {
    "defaultGroup": "个人",
    "sortBy": "custom"
  },
  "version": 42,
  "updatedAt": 1709337600
}
        │
        ▼
  JSON.stringify()
        │
        ▼
  UTF-8 encode → plaintext bytes
        │
        ▼
  AES-256-GCM encrypt
    key = Encryption Key
    iv  = random 12 bytes (每次加密生成新 IV)
        │
        ▼
  Base64(IV + Ciphertext + Auth Tag)
        │
        ▼
  存储到服务端 D1 数据库
```

### 2.3 安全边界

```
┌─────────────────────────────────────────────────────────┐
│                    客户端（可信域）                        │
│                                                         │
│  ✅ 明文 Master Password（仅存在于内存中）                 │
│  ✅ Master Key / Encryption Key（内存中或系统密钥链）       │
│  ✅ 解密后的 Vault 明文                                   │
│  ✅ TOTP Secret 明文                                     │
│  ✅ 生成的 OTP 代码                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    服务端（不可信域）                       │
│                                                         │
│  ✅ Auth Hash 的 bcrypt 哈希（无法反推 Master Key）        │
│  ✅ 加密后的 Vault 密文（无法解密）                         │
│  ✅ Vault 版本号（用于同步）                               │
│  ✅ JWT Session Token                                    │
│                                                         │
│  ❌ 永远不接触: Master Password, Master Key,              │
│     Encryption Key, Vault 明文, TOTP Secret              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.4 威胁模型

| 威胁 | 缓解措施 |
|------|---------|
| 服务端数据库泄露 | Vault 是 AES-256-GCM 加密的，没有 Master Key 无法解密 |
| 网络中间人攻击 | Cloudflare 强制 HTTPS + Auth Hash 传输（非明文密码） |
| 暴力破解主密码 | PBKDF2 600K 轮（每次尝试约 300ms）+ 服务端登录限速 |
| 客户端内存读取 | 敏感数据使用后尽快清零，生物识别解锁使用系统密钥链 |
| 重放攻击 | JWT 包含过期时间 + 服务端校验 session 有效性 |
| CSRF | API 使用 Bearer Token 认证，不使用 Cookie |

---

## 3. 后端 API 设计

### 3.1 技术栈

- **运行时**: Cloudflare Workers
- **数据库**: Cloudflare D1 (SQLite)
- **开发工具**: Bun + Wrangler
- **语言**: TypeScript
- **框架**: Hono（轻量级 Web 框架，对 CF Workers 原生支持）

### 3.2 API 端点

基础路径: `/api/v1`

#### 认证相关

```
POST   /api/v1/auth/register
  描述: 注册新用户（自托管场景下只允许注册一个用户）
  请求: { email: string, authHash: string, encryptedVault: string, vaultVersion: 1 }
  响应: { token: string, userId: string }
  说明: 初始加密 vault 在注册时一并上传

POST   /api/v1/auth/login
  描述: 用户登录
  请求: { email: string, authHash: string }
  响应: { token: string, userId: string }

POST   /api/v1/auth/logout
  描述: 登出当前会话
  请求: (无 body，使用 Bearer Token)
  响应: { success: true }

POST   /api/v1/auth/change-password
  描述: 修改主密码（需要同时重新加密 vault）
  请求: { currentAuthHash: string, newAuthHash: string, encryptedVault: string, vaultVersion: number }
  响应: { success: true }
  认证: 需要 Bearer Token
```

#### Vault 相关

```
GET    /api/v1/vault
  描述: 获取加密 vault
  响应: { encryptedVault: string, version: number, updatedAt: string }
  认证: 需要 Bearer Token

PUT    /api/v1/vault
  描述: 更新加密 vault（乐观锁）
  请求: { encryptedVault: string, expectedVersion: number }
  响应: { version: number, updatedAt: string }
  认证: 需要 Bearer Token
  冲突: 如果 expectedVersion != 当前版本，返回 409 Conflict

DELETE /api/v1/vault
  描述: 删除账户和所有数据
  请求: { authHash: string }  (需要再次验证密码)
  响应: { success: true }
  认证: 需要 Bearer Token
```

#### 会话管理

```
GET    /api/v1/sessions
  描述: 列出所有活跃会话
  响应: { sessions: [{ id, deviceName, createdAt, lastUsedAt, isCurrent }] }
  认证: 需要 Bearer Token

DELETE /api/v1/sessions/:id
  描述: 撤销指定会话
  响应: { success: true }
  认证: 需要 Bearer Token
```

#### 系统

```
GET    /api/v1/health
  描述: 健康检查 + 实例状态
  响应: { status: "ok", initialized: boolean, version: string }
  说明: initialized 表示是否已有用户注册，客户端据此决定显示注册还是登录页面
```

### 3.3 认证机制

```
┌──────────┐                          ┌──────────┐
│  Client  │                          │  Server  │
└────┬─────┘                          └────┬─────┘
     │                                     │
     │  POST /auth/login                   │
     │  { email, authHash }                │
     │ ──────────────────────────────────►  │
     │                                     │  bcrypt.verify(authHash, storedHash)
     │                                     │  生成 JWT { sub: userId, sid: sessionId }
     │  { token }                          │
     │  ◄──────────────────────────────── │
     │                                     │
     │  GET /vault                         │
     │  Authorization: Bearer <token>      │
     │ ──────────────────────────────────►  │
     │                                     │  验证 JWT + 检查 session 有效性
     │  { encryptedVault, version }        │
     │  ◄──────────────────────────────── │
     │                                     │
```

**JWT 结构**:

```json
{
  "sub": "user_id",
  "sid": "session_id",
  "iat": 1709337600,
  "exp": 1709942400
}
```

- Token 有效期: 7 天
- 每次请求检查 session 是否仍在 sessions 表中（支持主动撤销）
- JWT Secret 在部署时自动生成，存储在 Worker 环境变量中

### 3.4 限速策略

基于 IP 地址的限速（使用 CF-Connecting-IP header）：

| 端点 | 限制 | 窗口 |
|------|------|------|
| `/auth/login` | 5 次 | 15 分钟 |
| `/auth/register` | 3 次 | 1 小时 |
| 其他认证端点 | 10 次 | 1 分钟 |
| Vault 操作 | 60 次 | 1 分钟 |
| Health check | 不限制 | - |

实现方式: D1 中维护一个 `rate_limits` 表，记录 IP + 端点 + 窗口内请求次数。定期清理过期记录。

### 3.5 错误响应格式

所有错误统一使用以下格式：

```json
{
  "error": {
    "code": "VAULT_VERSION_CONFLICT",
    "message": "Vault version conflict. Expected 42 but current is 43.",
    "status": 409
  }
}
```

错误码列表：

| 错误码 | HTTP 状态 | 描述 |
|--------|----------|------|
| `INVALID_REQUEST` | 400 | 请求参数校验失败 |
| `UNAUTHORIZED` | 401 | 未提供或无效的认证 Token |
| `FORBIDDEN` | 403 | 无权执行此操作 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `VAULT_VERSION_CONFLICT` | 409 | Vault 版本冲突 |
| `ALREADY_REGISTERED` | 409 | 已有用户注册（自托管场景） |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `INTERNAL_ERROR` | 500 | 服务端内部错误 |

---

## 4. 数据库设计 (D1 SQLite)

### 4.1 表结构

```sql
-- 用户表（自托管场景下通常只有一行）
CREATE TABLE users (
  id           TEXT PRIMARY KEY,          -- UUID v4
  email        TEXT NOT NULL UNIQUE,      -- 用户邮箱（也用作 PBKDF2 salt）
  auth_hash    TEXT NOT NULL,             -- bcrypt(Auth Hash)
  created_at   INTEGER NOT NULL,          -- Unix timestamp (秒)
  updated_at   INTEGER NOT NULL           -- Unix timestamp (秒)
);

-- Vault 表（加密数据存储）
CREATE TABLE vaults (
  id           TEXT PRIMARY KEY,          -- 等于 user_id（一对一关系）
  user_id      TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  encrypted_data TEXT NOT NULL,           -- Base64 编码的加密 vault
  version      INTEGER NOT NULL DEFAULT 1, -- 乐观锁版本号
  updated_at   INTEGER NOT NULL           -- Unix timestamp (秒)
);

-- 会话表
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,          -- UUID v4
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name  TEXT NOT NULL DEFAULT '',  -- 设备名称（如 "iPhone 15", "Windows Desktop"）
  ip_address   TEXT,                      -- 登录 IP
  created_at   INTEGER NOT NULL,          -- Unix timestamp (秒)
  last_used_at INTEGER NOT NULL,          -- 最后使用时间
  expires_at   INTEGER NOT NULL           -- 过期时间
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- 限速表
CREATE TABLE rate_limits (
  key          TEXT NOT NULL,             -- "IP:endpoint" 组合
  count        INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,          -- 窗口开始时间 (Unix timestamp)
  PRIMARY KEY (key, window_start)
);

CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
```

### 4.2 数据量估算

| 表 | 预估行数 | 单行大小 | 总大小 |
|---|---------|---------|-------|
| users | 1 | ~200 bytes | ~200 B |
| vaults | 1 | ~50KB (200个令牌加密后) | ~50 KB |
| sessions | ~5 (多设备) | ~300 bytes | ~1.5 KB |
| rate_limits | ~100 (动态) | ~100 bytes | ~10 KB |
| **总计** | | | **~60 KB** |

D1 免费计划提供 5GB 存储，完全足够。

### 4.3 数据迁移

使用 Wrangler 的 D1 migration 功能管理 schema 变更：

```
migrations/
  0001_initial.sql      -- 创建所有初始表
```

---

## 5. 同步协议

### 5.1 同步模型

采用**全量同步 + 乐观锁**模型。整个 vault 作为一个原子单元同步，不做增量 diff。

```
客户端 A              服务端              客户端 B
   │                    │                    │
   │  PUT /vault        │                    │
   │  version: 42→43    │                    │
   │ ──────────────►    │                    │
   │  ✅ OK v43         │                    │
   │  ◄────────────    │                    │
   │                    │    GET /vault       │
   │                    │  ◄────────────    │
   │                    │    v43 + data       │
   │                    │  ──────────────►    │
   │                    │                    │  解密，合并到本地
```

### 5.2 冲突处理

当两个客户端同时修改 vault 时：

```
客户端 A (v42)         服务端 (v42)         客户端 B (v42)
   │                    │                    │
   │  PUT v42→43        │                    │
   │ ──────────────►    │                    │
   │  ✅ OK v43         │                    │
   │  ◄────────────    │                    │
   │                    │   PUT v42→43       │
   │                    │  ◄────────────    │
   │                    │   ❌ 409 Conflict   │
   │                    │   current: v43     │
   │                    │  ──────────────►    │
   │                    │                    │
   │                    │   GET /vault       │  拉取最新
   │                    │  ◄────────────    │
   │                    │   v43 + data       │
   │                    │  ──────────────►    │
   │                    │                    │  客户端 B 合并:
   │                    │                    │  - 解密 v43
   │                    │                    │  - 与本地未推送修改合并
   │                    │   PUT v43→44       │  - 重新加密推送
   │                    │  ◄────────────    │
   │                    │   ✅ OK v44         │
   │                    │  ──────────────►    │
```

### 5.3 客户端合并策略

冲突合并在客户端进行（因为只有客户端能解密）：

1. **添加令牌**: 两端都添加的令牌全保留（按 ID 去重）
2. **删除令牌**: 删除操作优先（一端删了，另一端即使修改了也删除）
3. **修改令牌**: 以 `updatedAt` 更新的为准（last-write-wins per token）
4. **分组/设置**: last-write-wins

### 5.4 客户端同步时机

- 应用启动时
- 添加/编辑/删除令牌后
- 应用从后台恢复到前台时
- 手动触发（下拉刷新）

---

## 6. 客户端架构

### 6.1 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 框架 | Tauri 2.0 | 跨平台原生应用 |
| 前端 | React 18+ | UI 框架 |
| 语言 | TypeScript | 前端 + Tauri 命令类型 |
| 构建 | Vite + Bun | 快速构建 |
| 状态管理 | Zustand | 轻量级状态管理 |
| 样式 | Tailwind CSS | 实用类优先 |
| 本地存储 | Tauri Store plugin | 本地 vault 缓存 |
| 密码学 | WebCrypto API | 原生加密 |
| QR 扫描 | Tauri Camera plugin + jsQR | 移动端摄像头扫码 |

### 6.2 项目结构

```
phase-client/
├── src/                        # React 前端
│   ├── components/             # UI 组件
│   │   ├── auth/               #   登录/注册
│   │   ├── tokens/             #   令牌列表/卡片/倒计时
│   │   ├── settings/           #   设置页面
│   │   └── common/             #   通用组件
│   ├── hooks/                  # React Hooks
│   ├── lib/                    # 核心库
│   │   ├── crypto.ts           #   加解密 (WebCrypto)
│   │   ├── totp.ts             #   TOTP 生成 (RFC 6238)
│   │   ├── sync.ts             #   同步引擎
│   │   ├── vault.ts            #   Vault 管理
│   │   └── api.ts              #   API 客户端
│   ├── store/                  # Zustand 状态
│   ├── types/                  # TypeScript 类型
│   └── App.tsx
├── src-tauri/                  # Tauri 后端 (Rust)
│   ├── src/
│   │   ├── lib.rs              #   入口
│   │   └── keychain.rs         #   系统密钥链操作
│   ├── capabilities/           #   权限声明
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── vite.config.ts
└── tailwind.config.ts
```

### 6.3 核心流程

#### 首次使用流程

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ 输入服务端URL │────►│ GET /health   │────►│ initialized? │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                │
                                    ┌───────────┴──────────┐
                                    ▼                      ▼
                            ┌──────────────┐      ┌──────────────┐
                            │ 显示注册页面    │      │ 显示登录页面    │
                            │ 设置主密码      │      │ 输入主密码      │
                            └──────┬───────┘      └──────┬───────┘
                                   │                      │
                                   ▼                      ▼
                            ┌──────────────────────────────────┐
                            │ 从主密码派生 Master Key            │
                            │ → 派生 Encryption Key + Auth Key  │
                            │ → 计算 Auth Hash                 │
                            └──────────────┬───────────────────┘
                                           │
                              ┌─────────────┴──────────────┐
                              ▼                            ▼
                       ┌─────────────┐             ┌─────────────┐
                       │ POST /register│             │ POST /login  │
                       │ 上传空 vault   │             │ 验证身份      │
                       └──────┬──────┘             └──────┬──────┘
                              │                           │
                              ▼                           ▼
                       ┌──────────────────────────────────────┐
                       │ 存储 Encryption Key 到系统密钥链       │
                       │ 存储 JWT Token                       │
                       │ 进入主界面                             │
                       └──────────────────────────────────────┘
```

#### 生物识别解锁流程

```
应用启动
    │
    ▼
本地有缓存的 vault? ──否──► 显示登录页面（输入主密码）
    │是
    ▼
请求生物识别认证
    │
    ├──成功──► 从系统密钥链读取 Encryption Key
    │          解密本地 vault
    │          显示令牌列表
    │          后台同步
    │
    └──失败──► 回退到主密码输入
```

---

## 7. TOTP 实现

### 7.1 算法 (RFC 6238)

```
TOTP(K, T) = Truncate(HMAC-SHA1(K, T))

其中:
  K = Base32 解码后的 secret
  T = floor((当前 Unix 时间 - T0) / 时间步长)
  T0 = 0 (Unix epoch)
  时间步长 = 30 秒（默认）

Truncate:
  1. 取 HMAC 结果最后一个字节的低 4 位作为 offset
  2. 从 offset 开始取 4 字节
  3. 取低 31 位得到整数
  4. 对 10^digits 取模得到 OTP
```

### 7.2 支持的参数

| 参数 | 默认值 | 可选值 |
|------|--------|--------|
| algorithm | SHA-1 | SHA-1, SHA-256, SHA-512 |
| digits | 6 | 6, 7, 8 |
| period | 30 | 任意正整数（秒） |

### 7.3 otpauth:// URI 解析

标准格式：
```
otpauth://totp/Issuer:Account?secret=BASE32SECRET&issuer=Issuer&algorithm=SHA1&digits=6&period=30
```

解析后映射到 vault 中的令牌对象。

---

## 8. 部署方案

### 8.1 后端部署 (CF Deploy Button)

#### wrangler.toml 配置

```toml
name = "phase-server"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "phase-db"
database_id = "" # 部署时自动生成

[vars]
CORS_ORIGIN = "*" # 用户可配置为具体域名
```

#### 一键部署流程

1. 用户点击 "Deploy to Cloudflare" 按钮
2. Fork 仓库到用户 GitHub
3. Cloudflare 自动创建 Worker + D1 数据库
4. 运行数据库迁移
5. 生成 JWT Secret 并设置为环境变量
6. 部署完成，返回 Worker URL

#### Deploy Button

```markdown
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/USER/phase-server)
```

### 8.2 客户端分发

| 平台 | 分发方式 |
|------|---------|
| Windows | GitHub Releases (.msi / .exe) |
| macOS | GitHub Releases (.dmg) |
| Linux | GitHub Releases (.AppImage / .deb) |
| iOS | TestFlight（或自签名） |
| Android | GitHub Releases (.apk) / F-Droid |

客户端构建通过 GitHub Actions 自动化，tag 推送触发多平台构建。

### 8.3 后端项目结构

```
phase-server/
├── src/
│   ├── index.ts                # 入口，Hono app 定义
│   ├── routes/
│   │   ├── auth.ts             # 认证路由
│   │   ├── vault.ts            # Vault 路由
│   │   └── sessions.ts         # 会话路由
│   ├── middleware/
│   │   ├── auth.ts             # JWT 认证中间件
│   │   ├── rateLimit.ts        # 限速中间件
│   │   └── cors.ts             # CORS 中间件
│   ├── services/
│   │   ├── user.ts             # 用户服务
│   │   ├── vault.ts            # Vault 服务
│   │   └── session.ts          # 会话服务
│   ├── utils/
│   │   ├── crypto.ts           # bcrypt / JWT 工具
│   │   └── response.ts         # 统一响应工具
│   └── types.ts                # 类型定义
├── migrations/
│   └── 0001_initial.sql        # 初始数据库 schema
├── wrangler.toml               # Workers 配置
├── package.json
├── tsconfig.json
└── bun.lockb
```

---

## 9. 数据导入导出

### 9.1 支持的导入格式

| 来源 | 格式 | 解析方式 |
|------|------|---------|
| Google Authenticator | otpauth-migration:// URI (protobuf) | 解码 protobuf payload，提取 otpauth:// URI 列表 |
| Aegis | JSON (明文或加密) | 解析 JSON，映射 `db.entries[]` |
| andOTP | JSON (明文或加密) | 解析 JSON，映射令牌数组 |
| 2FAS | JSON | 解析 JSON，映射 `services[]` |
| 通用 | otpauth:// URI | 直接解析单条 URI |

所有导入解析在客户端完成（因为可能涉及加密文件的解密），解析后合并到本地 vault，再同步到服务端。

### 9.2 备份导出格式 (.phase)

```json
{
  "format": "phase-backup",
  "version": 1,
  "createdAt": "2024-03-02T00:00:00Z",
  "encrypted": true,
  "salt": "<base64>",           // PBKDF2 salt (随机生成)
  "iv": "<base64>",             // AES-256-GCM IV
  "data": "<base64>"            // AES-256-GCM 加密的 vault JSON
}
```

备份密码独立于主密码，用户导出时单独设置。加密方式同 vault 加密（PBKDF2 派生密钥 + AES-256-GCM），但使用独立的 salt 和 IV。

### 9.3 导入去重

导入时根据 `issuer + account + secret` 三元组判断重复。如果已存在相同令牌，跳过并提示用户。

---

## 10. 共享类型定义

后端和客户端需要共享的 TypeScript 类型。可以发布为独立 npm 包或在两个仓库中各维护一份。

```typescript
// === API 请求/响应类型 ===

interface RegisterRequest {
  email: string;
  authHash: string;           // Base64 编码的 Auth Hash
  encryptedVault: string;     // Base64 编码的加密 vault
  vaultVersion: number;       // 初始为 1
}

interface LoginRequest {
  email: string;
  authHash: string;
}

interface AuthResponse {
  token: string;              // JWT
  userId: string;
}

interface VaultResponse {
  encryptedVault: string;
  version: number;
  updatedAt: string;          // ISO 8601
}

interface VaultUpdateRequest {
  encryptedVault: string;
  expectedVersion: number;    // 乐观锁
}

interface HealthResponse {
  status: "ok";
  initialized: boolean;       // 是否已有注册用户
  version: string;            // API 版本
}

// === Vault 内部结构（仅客户端使用，加密前的明文） ===

interface Vault {
  tokens: Token[];
  groups: string[];
  settings: VaultSettings;
  version: number;
  updatedAt: number;          // Unix timestamp
}

interface Token {
  id: string;                 // UUID v4
  type: "totp";               // 未来: "hotp" | "steam"
  issuer: string;             // 服务名称 (e.g. "GitHub")
  account: string;            // 账户名 (e.g. "user@example.com")
  secret: string;             // Base32 编码的密钥
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 7 | 8;
  period: number;             // 秒（TOTP 步长）
  icon: string;               // 图标标识符
  group: string;              // 分组名称
  order: number;              // 排序序号
  favorite: boolean;          // 是否收藏
  createdAt: number;          // Unix timestamp
  updatedAt: number;          // Unix timestamp
}

interface VaultSettings {
  defaultGroup: string;
  sortBy: "custom" | "name" | "recent";
  autoLockMinutes: number;    // 自动锁定时间（分钟），0 = 不锁定
}

// === 错误响应 ===

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    status: number;
  };
}
```
