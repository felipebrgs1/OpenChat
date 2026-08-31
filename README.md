# Nexo

Assistente interno unificado: chat da empresa com cargos, bases de conhecimento e controle de uso.

Stack: Turborepo, Bun, Vite, React 19, TanStack Router, Hono, Drizzle, PostgreSQL.

## Setup

Runtime: Bun 1.4+.

```bash
cp .env.example .env
bun install
bun run db:start
bun run db:push
bun run db:seed
bun run dev
```

- Web: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:3001/api/health](http://localhost:3001/api/health)
- Postgres: `localhost:5434` (user `postgres`, db `nexo`)

O `.env` vive **só na raiz**. Apps não têm `.env`.

## Scripts

| comando               | o que faz                                |
| --------------------- | ---------------------------------------- |
| `bun run dev`         | web :5173 + server :3001                 |
| `bun run dev:web`     | só o Vite                                |
| `bun run dev:server`  | só o Hono                                |
| `bun run check-types` | TypeScript em todos os workspaces        |
| `bun run check`       | Oxlint + Oxfmt                           |
| `bun run db:start`    | Postgres no Docker                       |
| `bun run db:generate` | Drizzle generate                         |
| `bun run db:migrate`  | Drizzle migrate                          |
| `bun run db:push`     | Drizzle push (dev)                       |
| `bun run db:seed`     | cargos, prompt global, admin bootstrap   |
| `bun run test`        | testes do lote                           |
| `bun run docker:up`   | stack completa (web + server + postgres) |

Não suba `bun run dev` e `bun run docker:up` ao mesmo tempo: as portas 5173 e 3001 colidem.

## Auth (lote 1)

Login JWT: `Authorization: Bearer <access_token>`. Sem cookie de sessão.

Por enquanto o login está desligado (`AUTH_DISABLED=true` e `VITE_AUTH_DISABLED=true`). O app entra direto como o admin bootstrap. Para religar, coloque os dois em `false`.

## Estrutura

```
nexo/
├── apps/
│   ├── web/         # Vite + React + TanStack Router
│   └── server/      # Hono
├── packages/
│   ├── contracts/   # Zod compartilhado
│   ├── db/          # Drizzle
│   ├── config/      # tsconfig base
│   └── ui/          # componentes visuais
├── NEXO.md          # spec
└── LOTES.md         # checklist
```
