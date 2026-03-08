# Phase Server

自托管的端到端加密 2FA 令牌管理器后端。基于 TypeScript + Hono + Prisma。

> **Phase 客户端**（Tauri 2.0 + React）→ [phase-client](https://github.com/5uki/phase-client)

## 特性

- **零知识服务端** — 所有加解密在客户端完成，服务端只存储密文，无法解密任何数据。
- **自托管** — 可运行在任何支持 Node.js 的平台（VPS、Docker 等）。
- **多设备同步** — 基于版本号的乐观锁，自动检测冲突。
- **防暴力破解** — 基于 IP 的请求限速。
- **会话管理** — JWT 认证，支持多设备登录和会话撤销。
- **Prisma ORM** — 类型安全的数据库访问，可轻松切换 SQLite / PostgreSQL / MySQL。

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js |
| 数据库 | SQLite（默认，通过 Prisma） |
| ORM | Prisma |
| Web 框架 | Hono |
| 语言 | TypeScript |
| 包管理器 | pnpm |

## 快速开始

### 本地开发

```bash
git clone https://github.com/5uki/phase-server.git
cd phase-server
pnpm install
cp .env.example .env          # 按需修改
pnpm exec prisma db push      # 创建 SQLite 数据库和表
pnpm dev                      # http://localhost:3000
```

### Docker 部署

```bash
docker build -t phase-server .
docker run -d \
  -p 3000:3000 \
  -v phase-data:/app/prisma \
  -e DATABASE_URL="file:./phase.db" \
  -e CORS_ORIGIN="*" \
  phase-server
```

### 生产部署

```bash
pnpm install
pnpm exec prisma db push
pnpm build
pnpm start
```

## API 概览

基础路径：`/api/v1`

| 方法 | 端点 | 认证 | 描述 |
|------|------|------|------|
| `GET` | `/health` | 否 | 实例状态和初始化检查 |
| `POST` | `/auth/init` | 是（`X-Instance-Token`） | 初始化 vault 并创建第一个会话 |
| `POST` | `/auth/unlock` | 是（`X-Instance-Token`） | 为已初始化实例创建新会话 |
| `POST` | `/auth/logout` | 是 | 登出当前会话 |
| `GET` | `/vault` | 是 | 获取加密 vault |
| `PUT` | `/vault` | 是 | 更新加密 vault（乐观锁） |
| `GET` | `/auth/devices` | 是 | 列出所有活跃会话 |
| `DELETE` | `/auth/devices/:id` | 是 | 撤销指定会话 |

完整 API 文档、密钥派生代码和同步协议请参考 [客户端集成指南](docs/CLIENT_GUIDE.md)。

## 安全模型

```
主密码（仅存在于客户端）
    │
    ├─ PBKDF2（600K 轮迭代）→ Master Key
    │       │
    │       ├─ HKDF("enc") → 加密密钥（AES-256-GCM）
    │       └─ HKDF("auth") → 认证密钥 → Auth Hash（发送给服务端）
    │
    服务端存储：SHA-256(Auth Hash + salt)
    服务端存储：AES-256-GCM 加密后的 vault 密文（无法解密）
```

- 服务端**永远不会**接触主密码、Master Key、加密密钥或 vault 明文。
- 即使数据库被完全泄露，令牌数据仍然是加密的。
- 完整威胁模型请参考 [设计文档](docs/plans/design.md)。

## 环境变量

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `DATABASE_URL` | `file:./phase.db` | Prisma 数据库连接字符串 |
| `JWT_SECRET` | （自动生成） | JWT 签名密钥 |
| `CORS_ORIGIN` | `*` | 允许的 CORS 来源（逗号分隔） |
| `PORT` | `3000` | 服务监听端口 |

## 项目结构

```
phase-server/
├── src/
│   ├── index.ts              # 入口，Hono 应用 + 服务启动
│   ├── prisma.ts             # PrismaClient 单例
│   ├── types.ts              # 所有类型定义
│   ├── routes/
│   │   ├── auth.ts           # 注册、登录、登出
│   │   ├── vault.ts          # Vault CRUD + 乐观锁
│   │   └── sessions.ts       # 会话列表和撤销
│   ├── middleware/
│   │   ├── auth.ts           # JWT 验证 + 会话有效性检查
│   │   ├── instanceToken.ts  # 实例令牌验证
│   │   └── rateLimit.ts      # 基于 IP 的限速
│   └── utils/
│       ├── crypto.ts         # JWT 工具
│       ├── init.ts           # 自动初始化逻辑
│       └── response.ts       # 统一响应工具
├── prisma/
│   └── schema.prisma         # 数据库 Schema
├── .github/
│   └── workflows/
│       └── setup.yml         # CI：安装依赖、生成代码、类型检查
├── Dockerfile
├── .env.example
├── package.json
└── tsconfig.json
```

## 许可证

MIT
