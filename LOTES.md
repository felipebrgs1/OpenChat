# Nexo — fila de lotes

Fonte: `NEXO.md`. Este arquivo é o checklist de execução.

Status: **lote 5 feito**. Uso agregado, governança e controle fino de gastos (saldo + orçamento mensal user/cargo/org).

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

Status: feito

- [x] `knowledge_collection` / `knowledge_document` / `knowledge_role` no schema (soft delete em collection e document, migration `0000_petite_risque`)
- [x] contratos Zod (`KnowledgeCollectionSummary/Detail`, `KnowledgeDocument`, bodies de create/patch)
- [x] `apps/server/src/lib/knowledge.ts` — `loadCollectionsForRole` (visibilidade `all` ou vínculo por cargo) + `buildKnowledgeBlock` (docs inteiros, ordem `updated_at desc`, cap 4k tokens)
- [x] `assemblePrompt` recebe `knowledgeBlock` → bloco `[CONHECIMENTO]` depois das regras de segurança; `DEBUG_PROMPT=1` loga o prompt montado
- [x] rotas: `GET /api/knowledge`, `GET /api/knowledge/:id` (logado, filtra por cargo); admin: `POST /api/knowledge`, `PATCH /api/knowledge/:id` (roleIds), `POST /:id/documents`, `PATCH/DELETE /documents/:id` (soft) + audit_log
- [x] web: `/app/knowledge` (leitura), `/app/knowledge/$collectionId`, `/app/admin/knowledge` (CRUD), link "Bases" na sidebar e no menu admin, home lista as bases
- [x] seed de 5 docs mínimos (cobrança, whatsapp, comercial, stack, organograma)

Aceite:

- [x] doc de cobrança invisível para comercial (`knowledge.test.ts`, 5 testes)
- [x] base `visibility: all` aparece para qualquer cargo
- [x] `[CONHECIMENTO]` montado com cap de tokens
- [x] `bun test` server: 28 pass

Fora: embedding, pgvector, upload PDF, busca semântica (lote 6).

## Lote 5 — Admin de verdade + uso

Status: feito

- [x] `GET /api/admin/usage?days=N` — agregação por usuário / cargo / modelo / dia (`admin-usage.ts`, SQL `group by` + fuso `America/Sao_Paulo` por dia)
- [x] disable user e troca de cargo (já existia no PATCH admin; agora com teste: disabled → 401)
- [x] settings da org: prompt global + orçamento mensal da org + modelos (`/app/admin/settings` nova página)
- [x] audit_log nas mutações admin (role.update com meta, settings.update com meta)
- [x] badge de custo na conversa visível só para admin (`thread.tsx`)

Controle fino de gastos (pedido do dono — antecipado do lote 8):

- [x] `user.monthly_budget_usd` (coluna nova; push aplicado)
- [x] `role.monthly_budget_usd` (coluna já existia, agora usada)
- [x] `organization_settings.monthly_budget_usd`
- [x] `lib/budget.ts` — `assertBudgets`: saldo de créditos → orçamento do usuário → do cargo → da org; soma `usage_event.cost_usd` do mês corrente (America/Sao_Paulo); lança `BUDGET_EXCEEDED` antes de chamar o modelo
- [x] UI: coluna "Orçamento mês" editável em Usuários, campo em edição de cargo, campo em Configurações

Aceite:

- [x] admin vê ranking de gasto (`/app/admin/usage`, com totais e por cargo vs orçamento)
- [x] user disabled não autentica (`governance.test.ts`)
- [x] mudança de cargo altera starters/knowledge na próxima request (snapshot já gravado no lote 2)
- [x] orçamento do cargo estourado → SSE `event: error BUDGET_EXCEEDED` sem chamar o modelo (5 testes novos; server 33 pass)

Correções de typecheck pré-existentes aproveitadas:

- [x] `clsx` + `tailwind-merge` nas deps do web
- [x] `Select` Base UI usado como select nativo em `admin/users.tsx` e `admin/models.tsx`

Fora: export CSV, retenção de conversas, rate limit persistido (lote 8).

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
