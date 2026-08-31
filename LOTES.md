# Nexo — fila de lotes

Fonte: `NEXO.md`. Este arquivo é o checklist de execução.

Status: **lote 3 feito**. Chat usa pi headless; UI ChatGPT intacta.

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

Status: feito

- [x] conversations / messages
- [x] SSE OpenRouter
- [x] UI stream + markdown + histórico
- [x] allowlist de modelos
- [x] isolamento por user

Aceite: chat real, persistido, isolado.

## Lote 3 — Harness pi headless (troca de engine, UI intacta)

Status: feito

Objetivo: trocar `apps/server/src/lib/openrouter.ts` por `pi` como harness server-side, sem que o usuário final perceba. A UI continua idêntica ao ChatGPT (sidebar + thread + input + seletor de modelo). Nenhum conceito de harness vaza para o `web`.

Entregáveis:

- [x] `apps/server` depende de `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai` (Bun workspace)
- [x] `apps/server/src/lib/pi-harness.ts` — `streamNexoTurn` com:
  - `SessionManager.inMemory()` + espelho no Postgres
  - `ModelRuntime` lendo `OPENROUTER_API_KEY` **só do env do server** (`process.env.OPENROUTER_API_KEY`, nunca `VITE_*`)
  - `noTools: "all"` (SEM `bash/read/edit/write/grep/find/ls` para o usuário)
  - `before_agent_start` injeta prompt assembly idêntico ao `assemblePrompt` atual (`globalSystemPrompt + role.system_prompt + regras + histórico`), cap 2k+4k como em `NEXO.md:9`
- [x] `apps/server/src/routes/conversations.ts` `POST /:id/messages` reescrito para usar `session.prompt()` + `session.subscribe()` e **manter o mesmo contrato SSE** (`event: meta/delta/done/error`) que `apps/web/src/lib/sse.ts` já consome
- [x] `GET /api/models` continua filtrando por `organization_settings.allowedModels` / `defaultModel` / `fallbackModel` — `pi` não expõe catálogo cru (400 modelos) nem `/model`/`cycle_model`
- [x] troca de modelo: `body.model` validado por `assertAllowedModel` e passado como `model` do `pi` (`openrouter/<id>`); `PATCH /conversations/:id` atualiza `model` da conversa; `ModelProvider` (`apps/web/src/components/model-provider.tsx`) continua com `localStorage["nexo.model"]` sem saber do `pi`
- [x] `apikey` invisível: `OPENROUTER_API_KEY` só em `apps/server` (`.env` raiz), nunca serializada, nunca em `GET /api/me` ou SSE; `ModelRuntime` usa `env`/`setRuntimeApiKey` server-side
- [x] indicador de tool opcional: `tool_execution_start` disponível no harness (sem tools no lote 3, sem efeito na UI)
- [x] `rate-limit` e `usage_event`/`messages.costUsd` continuam gravados após o turno (mesmo `promptTokens/completionTokens/costUsd` de hoje)
- [x] `extensionFactories` inline `nexo` com hook `tool_call` reservado para `BUDGET_EXCEEDED`

Fora:

- knowledge/RAG (lote 4), `search_knowledge` real (lote 7), pgvector, upload, MCP, TUI do `pi`, comandos `/skill`, `/compact` expostos ao usuário

Critério de aceite:

- [x] `bun run dev` sobe; chat existente continua funcionando sem mudar `thread.tsx`/`sse.ts`/`model-provider.tsx`
- [x] seletor de modelo (allowlist) continua no `ModelProvider`; `message.model` persistido
- [x] inspeção de rede no browser não mostra `OPENROUTER_API_KEY`, `pi`, `toolCallId` ou `sessionFile`
- [x] `POST /api/conversations/:id/messages` com modelo fora da allowlist → `400 VALIDATION` (mesmo de antes)
- [x] `OPENROUTER_API_KEY` ausente → `event: error {code:"LLM_UPSTREAM"}` e `messages.error` preenchido (mesmo de antes)
- [x] `bun run test` (`apps/server/src/chat.test.ts` + `pi-harness.test.ts`) passa

Notas técnicas:

- `pi` roda em `SDK in-process` (`createAgentSession` + `SessionManager`), não `pi --mode rpc` nem TUI. `ctx.mode !== "tui"` no server.
- Manter `streamSSE` do Hono; mapear `message_update.text_delta -> event: delta`, `agent_end -> event: done`, `agent_settled` para `usage`.
- Não habilitar built-ins perigosos: `tools: []` (não `read, bash`).

## Lote 4 — Knowledge por cargo (sem vetor)

Status: bloqueado por 3

- [ ] collections + documents + vínculo cargo
- [ ] injeção no prompt com teto de tokens (reusar `before_agent_start` do harness)
- [ ] leitura para o user, CRUD admin
- [ ] seed de 5 docs mínimos

Aceite: doc de cobrança invisível para comercial.

## Lote 5 — Admin e uso

Status: bloqueado por 4

- [ ] usage por user/cargo/modelo
- [ ] disable user, troca de cargo
- [ ] settings da org
- [ ] audit_log

## Lote 6 — RAG

Status: bloqueado por 5

- [ ] chunk + embedding + pgvector
- [ ] top-k filtrado por cargo
- [ ] citação
- [ ] upload md/txt/pdf

## Lote 7 — Tools / MCP

Status: bloqueado por 6

- [ ] tool search_knowledge (plug real no harness do lote 3)
- [ ] tool who_to_ask
- [ ] adapter MCP desenhado, escrita proibida

## Lote 8 — Governança

Status: bloqueado por 7

- [ ] budget user/cargo (enforce no `tool_call` do harness)
- [ ] export CSV
- [ ] retenção
