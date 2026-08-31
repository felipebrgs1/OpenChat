# Nexo — fila de lotes

Fonte: `NEXO.md`. Este arquivo é o checklist de execução.

Status: **lote 1 feito**. Testes de convite/login/me.role passam.

---

## Lote 0 — Fundação

Status: feito

- [x] bun workspace + Turborepo
- [x] `apps/web` Vite + React + TanStack Router + Tailwind v4
- [x] `apps/server` Hono `GET /api/health`
- [x] `packages/contracts` `packages/db` `packages/config` `packages/ui`
- [x] `docker-compose` Postgres 18
- [x] `.env` único na raiz
- [x] README

Aceite: `bun run dev` sobe web :5173 e server :3001. Health 200.

## Lote 1 — Identidade e cargos

Status: feito

- [x] JWT HS256 (`login` / `refresh` / `logout`) + Drizzle
- [x] schema user / refresh_token / role / invite / settings / audit
- [x] seed 7 cargos + starters + prompt global
- [x] login, convite, home do cargo
- [x] admin: usuários e cargos
- [x] `GET /api/me`

Aceite: convite → senha → home do cargo certo. Requests autenticadas com `Authorization: Bearer`.

## Lote 2 — Chat

Status: bloqueado por 1

- [ ] conversations / messages
- [ ] SSE OpenRouter
- [ ] UI stream + markdown + histórico
- [ ] allowlist de modelos
- [ ] isolamento por user

Aceite: chat real, persistido, isolado.

## Lote 3 — Knowledge por cargo (sem vetor)

Status: bloqueado por 2

- [ ] collections + documents + vínculo cargo
- [ ] injeção no prompt com teto de tokens
- [ ] leitura para o user, CRUD admin
- [ ] seed de 5 docs mínimos

Aceite: doc de cobrança invisível para comercial.

## Lote 4 — Admin e uso

Status: bloqueado por 3

- [ ] usage por user/cargo/modelo
- [ ] disable user, troca de cargo
- [ ] settings da org
- [ ] audit_log

## Lote 5 — RAG

Status: bloqueado por 4

- [ ] chunk + embedding + pgvector
- [ ] top-k filtrado por cargo
- [ ] citação
- [ ] upload md/txt/pdf

## Lote 6 — Tools / MCP

Status: bloqueado por 5

- [ ] tool search_knowledge
- [ ] tool who_to_ask
- [ ] adapter MCP desenhado, escrita proibida

## Lote 7 — Governança

Status: bloqueado por 6

- [ ] budget user/cargo
- [ ] export CSV
- [ ] retenção
