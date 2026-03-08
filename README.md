# Phase Server

Self-hosted, end-to-end encrypted 2FA token manager backend. Built with TypeScript + Hono + Prisma.

> **Phase Client** (Tauri 2.0 + React) → [phase-client](https://github.com/5uki/phase-client)

## Features

- **Zero-knowledge server** — All encryption/decryption happens on the client. The server only stores ciphertext.
- **Self-hosted** — Runs on any platform that supports Node.js (VPS, Docker, etc.).
- **Multi-device sync** — Optimistic locking with version-based conflict detection.
- **Rate limiting** — IP-based rate limiting to prevent brute-force attacks.
- **Session management** — JWT auth with revocable sessions across devices.
- **Prisma ORM** — Type-safe database access, easily swap between SQLite / PostgreSQL / MySQL.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Database | SQLite (default, via Prisma) |
| ORM | Prisma |
| Framework | Hono |
| Language | TypeScript |
| Package Manager | pnpm |

## Quick Start

### Local Development

```bash
git clone https://github.com/5uki/phase-server.git
cd phase-server
pnpm install
cp .env.example .env          # Edit as needed
pnpm exec prisma db push      # Create SQLite database and tables
pnpm dev                      # http://localhost:3000
```

### Docker Deployment

```bash
docker build -t phase-server .
docker run -d \
  -p 3000:3000 \
  -v phase-data:/app/prisma \
  -e DATABASE_URL="file:./phase.db" \
  -e CORS_ORIGIN="*" \
  phase-server
```

### Production Deployment

```bash
pnpm install
pnpm exec prisma db push
pnpm build
pnpm start
```

## API Overview

Base path: `/api/v1`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | No | Instance status & initialization check |
| `POST` | `/auth/init` | Yes (`X-Instance-Token`) | Initialize the vault and create the first session |
| `POST` | `/auth/unlock` | Yes (`X-Instance-Token`) | Create a new session for an initialized instance |
| `POST` | `/auth/logout` | Yes | Revoke current session |
| `GET` | `/vault` | Yes | Get encrypted vault |
| `PUT` | `/vault` | Yes | Update encrypted vault (optimistic lock) |
| `GET` | `/auth/devices` | Yes | List active sessions |
| `DELETE` | `/auth/devices/:id` | Yes | Revoke a session |

See [Client Integration Guide](docs/CLIENT_GUIDE.md) for full API reference, key derivation code, and sync protocol.

## Security Model

```
Master Password (client-side only)
    │
    ├─ PBKDF2 (600K iterations) → Master Key
    │       │
    │       ├─ HKDF("enc") → Encryption Key (AES-256-GCM)
    │       └─ HKDF("auth") → Auth Key → Auth Hash (sent to server)
    │
    Server stores: SHA-256(Auth Hash + salt)
    Server stores: AES-256-GCM encrypted vault (cannot decrypt)
```

- The server **never** sees the master password, master key, encryption key, or plaintext vault.
- Even if the database is fully compromised, tokens remain encrypted.
- See [Design Document](docs/plans/design.md) for the full threat model.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./phase.db` | Prisma database connection string |
| `JWT_SECRET` | (auto-generated) | JWT signing secret |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (comma-separated) |
| `PORT` | `3000` | Server listening port |

## Project Structure

```
phase-server/
├── src/
│   ├── index.ts              # Entry point, Hono app + server
│   ├── prisma.ts             # PrismaClient singleton
│   ├── types.ts              # All type definitions
│   ├── routes/
│   │   ├── auth.ts           # Register, login, logout
│   │   ├── vault.ts          # Vault CRUD with optimistic locking
│   │   └── sessions.ts       # Session list & revoke
│   ├── middleware/
│   │   ├── auth.ts           # JWT verification + session check
│   │   ├── instanceToken.ts  # Instance token verification
│   │   └── rateLimit.ts      # IP-based rate limiting
│   └── utils/
│       ├── crypto.ts         # JWT helpers
│       ├── init.ts           # Auto-initialization logic
│       └── response.ts       # Unified response helpers
├── prisma/
│   └── schema.prisma         # Database schema
├── .github/
│   └── workflows/
│       └── setup.yml         # CI: install, generate, typecheck
├── Dockerfile
├── .env.example
├── package.json
└── tsconfig.json
```

## License

MIT
