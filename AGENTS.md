# AGENTS.md

Diretrizes para agentes de código trabalhando neste repo.

## Stack

Turborepo + Bun 1.4 monorepo. Web: Vite + React 19 + TanStack Router/Query + Tailwind 4. Server: Hono + Drizzle + PostgreSQL (porta 5434). Chat usa pi SDK headless + OpenRouter.

## Estrutura

- `apps/web` — frontend Vite/React
- `apps/server` — API Hono (routes em `src/routes`, auth via JWT `jose`)
- `packages/db` — schema Drizzle + migrations + seed (`@nexo/db`)
- `packages/contracts` — schemas Zod compartilhados (`@nexo/contracts`)
- `packages/ui` — componentes visuais
- `packages/config` — tsconfig base
- `workers/docling` — worker Python de extração de documentos (PDF/DOCX → Markdown), opcional

## Comandos

```bash
bun install
bun run dev            # web :5173 + server :3001
bun run check-types    # tsc em todos os workspaces
bun run check          # oxlint + oxfmt --write
bun run test           # testes (bun test no server)
bun run db:start       # Postgres via Docker
bun run db:push        # Drizzle push (dev)
bun run db:seed        # seed: cargos, prompt global, admin
```

## Regras

- Bun, não npm/node. Bun typings via `@types/bun`; deps compartilhadas no `catalog:` do `package.json` raiz.
- `.env` vive **só na raiz** — nunca criar `.env` dentro de apps/packages.
- Validação de input com Zod de `@nexo/contracts`; tipos de DB só via `@nexo/db`.
- Auth: JWT `Authorization: Bearer`. Em dev pode estar desligado (`AUTH_DISABLED=true` entra como admin bootstrap) — não remover o suporte a auth.
- Lint/formatação: oxlint + oxfmt (`bun run check` antes de commit). Não adicionar ESLint/Prettier.
- Portas 5173 (web) e 3001 (server): `bun run dev` e `bun run docker:up` não podem rodar juntos.
- Migrations: mudou o schema em `packages/db/src/schema`, rode `bun run db:generate` + `db:migrate` (ou `db:push` em dev).
- Testes do server: `apps/server/src/*.test.ts` (bun test). Manter testes ao tocar em auth, chat, knowledge ou governance.

## Verificação

Antes de finalizar: `bun run check-types && bun run check && bun run test`.
