# Phase Server

自托管的端到端加密 2FA 令牌管理器后端。基于 Cloudflare Workers + D1 免费计划。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/5uki/phase-server)

> **Phase 客户端**（Tauri 2.0 + React）→ [phase-client](https://github.com/5uki/phase-client)

## 特性

- **零知识服务端** — 所有加解密在客户端完成，服务端只存储密文，无法解密任何数据。
- **零成本** — 完全运行在 Cloudflare 免费计划上（Workers + D1）。
- **一键部署** — 点击上方按钮即可完成部署，无需任何手动配置。
- **多设备同步** — 基于版本号的乐观锁，自动检测冲突。
- **防暴力破解** — 基于 IP 的请求限速。
- **会话管理** — JWT 认证，支持多设备登录和会话撤销。

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers |
| 数据库 | Cloudflare D1 (SQLite) |
| Web 框架 | Hono |
| 语言 | TypeScript |
| 包管理器 | Bun |

## 快速开始

### 一键部署

点击顶部的 **Deploy to Cloudflare Workers** 按钮，按提示连接你的 GitHub 和 Cloudflare 账号即可。

服务端会在首次请求时自动初始化数据库表结构并生成 JWT Secret，无需任何手动配置。

### 手动部署（可选）

```bash
git clone https://github.com/5uki/phase-server.git
cd phase-server
bun install
bunx wrangler d1 create phase-db   # 将 database_id 填入 wrangler.toml
bun run deploy
```

### 本地开发

```bash
bun install
cp .dev.vars.example .dev.vars     # 可选：设置自定义 JWT_SECRET
bun run dev                        # http://localhost:8787
```

## API 概览

基础路径：`/api/v1`

| 方法 | 端点 | 认证 | 描述 |
|------|------|------|------|
| `GET` | `/health` | 否 | 实例状态和初始化检查 |
| `POST` | `/auth/register` | 否 | 注册账户（仅允许一个用户） |
| `POST` | `/auth/login` | 否 | 登录获取 JWT Token |
| `POST` | `/auth/logout` | 是 | 登出当前会话 |
| `POST` | `/auth/change-password` | 是 | 修改主密码并重新加密 vault |
| `GET` | `/vault` | 是 | 获取加密 vault |
| `PUT` | `/vault` | 是 | 更新加密 vault（乐观锁） |
| `DELETE` | `/vault` | 是 | 删除账户及所有数据 |
| `GET` | `/sessions` | 是 | 列出所有活跃会话 |
| `DELETE` | `/sessions/:id` | 是 | 撤销指定会话 |

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

## 项目结构

```
phase-server/
├── src/
│   ├── index.ts              # 入口，Hono 应用定义
│   ├── types.ts              # 所有类型定义
│   ├── routes/
│   │   ├── auth.ts           # 注册、登录、登出、改密
│   │   ├── vault.ts          # Vault CRUD + 乐观锁
│   │   └── sessions.ts       # 会话列表和撤销
│   ├── middleware/
│   │   ├── auth.ts           # JWT 验证 + 会话有效性检查
│   │   └── rateLimit.ts      # 基于 IP 的限速
│   └── utils/
│       ├── crypto.ts         # 密码哈希、JWT 工具
│       └── response.ts       # 统一响应工具
├── migrations/
│   └── 0001_initial.sql      # D1 初始 Schema
├── docs/
│   ├── CLIENT_GUIDE.md       # 客户端集成指南
│   └── plans/
│       ├── requirements.md   # 需求文档
│       └── design.md         # 技术设计文档
├── wrangler.toml             # Workers 配置
├── package.json
└── tsconfig.json
```

## Cloudflare 免费计划用量

| 资源 | 免费额度 | 个人使用量 |
|------|---------|-----------|
| Workers 请求 | 10 万次/天 | < 100 次/天 |
| D1 读取行数 | 500 万/天 | < 1000/天 |
| D1 写入行数 | 10 万/天 | < 100/天 |
| D1 存储 | 5 GB | < 1 MB |

## 许可证

MIT
