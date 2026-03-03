# Phase Server

Self-hosted, end-to-end encrypted 2FA token manager backend. Built on Cloudflare Workers + D1 (free plan).

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/5uki/phase-server)

> **Phase Client** (Tauri 2.0 + React) → [phase-client](https://github.com/5uki/phase-client)

## Features

- **Zero-knowledge server** — All encryption/decryption happens on the client. The server only stores ciphertext.
- **Zero cost** — Runs entirely on Cloudflare's free tier (Workers + D1).
- **One-click deploy** — Click the Deploy button above, done. No manual setup needed.
- **Multi-device sync** — Optimistic locking with version-based conflict detection.
- **Rate limiting** — IP-based rate limiting to prevent brute-force attacks.
- **Session management** — JWT auth with revocable sessions across devices.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Framework | Hono |
| Language | TypeScript |
| Package Manager | Bun |

## Quick Start

### One-Click Deploy

Click the **Deploy to Cloudflare Workers** button at the top. Follow the prompts to connect your GitHub and Cloudflare account. That's it.

The server automatically initializes the database schema and generates a JWT secret on first request. No manual configuration needed.

### Manual Deploy (Alternative)

```bash
git clone https://github.com/5uki/phase-server.git
cd phase-server
bun install
bunx wrangler d1 create phase-db   # Copy database_id into wrangler.toml
bun run deploy
```

### Local Development

```bash
bun install
cp .dev.vars.example .dev.vars     # Optional: set a custom JWT_SECRET
bun run dev                        # http://localhost:8787
```

## API Overview

Base path: `/api/v1`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | No | Instance status & initialization check |
| `POST` | `/auth/register` | No | Create account (single user only) |
| `POST` | `/auth/login` | No | Login & get JWT token |
| `POST` | `/auth/logout` | Yes | Revoke current session |
| `POST` | `/auth/change-password` | Yes | Change master password & re-encrypt vault |
| `GET` | `/vault` | Yes | Get encrypted vault |
| `PUT` | `/vault` | Yes | Update encrypted vault (optimistic lock) |
| `DELETE` | `/vault` | Yes | Delete account and all data |
| `GET` | `/sessions` | Yes | List active sessions |
| `DELETE` | `/sessions/:id` | Yes | Revoke a session |

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

## Project Structure

```
phase-server/
├── src/
│   ├── index.ts              # Entry point, Hono app
│   ├── types.ts              # All type definitions
│   ├── routes/
│   │   ├── auth.ts           # Register, login, logout, change-password
│   │   ├── vault.ts          # Vault CRUD with optimistic locking
│   │   └── sessions.ts       # Session list & revoke
│   ├── middleware/
│   │   ├── auth.ts           # JWT verification + session check
│   │   └── rateLimit.ts      # IP-based rate limiting
│   └── utils/
│       ├── crypto.ts         # Password hashing, JWT helpers
│       └── response.ts       # Unified response helpers
├── migrations/
│   └── 0001_initial.sql      # Initial D1 schema
├── docs/
│   ├── CLIENT_GUIDE.md       # Client integration guide
│   └── plans/
│       ├── requirements.md   # Requirements document
│       └── design.md         # Technical design document
├── wrangler.toml             # Workers configuration
├── package.json
└── tsconfig.json
```

## Cloudflare Free Plan Limits

| Resource | Free Tier | Typical Personal Usage |
|----------|-----------|----------------------|
| Workers requests | 100K/day | < 100/day |
| D1 rows read | 5M/day | < 1K/day |
| D1 rows written | 100K/day | < 100/day |
| D1 storage | 5 GB | < 1 MB |

## License

MIT
