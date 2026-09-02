# Oráculo

Assistente de IA interno unificado: chat da empresa onde cada colaborador conversa dentro de um **cargo** (persona com prompt e bases de conhecimento próprias), com governança de modelos, controle de uso por créditos e uma área admin completa.

Stack: Turborepo, Bun, Vite, React 19, TanStack Router/Query, Hono, Drizzle, PostgreSQL (pgvector), pi SDK (headless) + OpenRouter.

## Funcionalidades

- **Chat por cargos** — cada cargo tem prompt de sistema, mensagem de boas-vindas e prompts iniciais. O histórico fica salvo por usuário (`/app`).
- **Bases de conhecimento (RAG)** — coleções de documentos com visibilidade `all` ou `by_role`; ingestão com embeddings (halfvec 2560) + rerank; busca híbrida no chat com citação de fontes.
- **Governança de modelos** — admin define modelo padrão, fallback e a lista de modelos permitidos via OpenRouter.
- **Créditos e uso** — cada mensagem debita créditos (convertidos do custo USD do modelo); ledger por usuário e dashboard de consumo por cargo/usuário/modelo.
- **Memórias do usuário** — o assistente guarda preferências e fatos por usuário (visível/editável em Perfil).
- **Feedback** — 👍/👎 por resposta, alimentando casos de avaliação RAG.
- **Convites e usuários** — admin cria convites (`/invite/:token`), define cargo e reseta acesso.
- **Auditoria** — log de ações administrativas.

## Setup

Requisitos: **Bun 1.4+** e **Docker**.

```bash
cp .env.example .env
bun install
bun run db:start    # Postgres (pgvector) no Docker
bun run db:push     # cria o schema
bun run db:seed     # cargos, prompt global, RAG de exemplo, admin bootstrap
bun run dev         # web :5173 + server :3001
```

Acesse **http://localhost:5173**.

- **API**: http://localhost:3001/api/health
- **Postgres**: `localhost:5434` (db `nexo`)
- **RustFS (storage S3)**: `localhost:9000` — `docker compose up rustfs` se for usar uploads

O `.env` vive **só na raiz**. Apps não têm `.env`.

### Primeiro acesso

Com o login desligado (padrão em dev), o app entra direto como o admin bootstrap. Com o login ligado, use `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` do `.env` em `/login`.

## Como usar

1. **Escolha um cargo** na home do app. Cada cargo mostra boas-vindas e prompts iniciais — clique num starter ou escreva direto.
2. **Converse** — as respostas citam as bases de conhecimento quando relevantes. Abra novas conversas pela sidebar; o histórico persiste.
3. **Perfil** (`/app/settings`) — memórias do assistente, aparência.
4. **Admin** (`/app/admin`) — visível só para admins:
   - **Cargos**: crie/edite prompts de sistema, starters e boas-vindas.
   - **Conhecimento**: crie coleções, defina visibilidade por cargo e envie documentos (PDF, DOCX, PPTX, XLSX, HTML, Markdown, texto). A ingestão extrai → divide em chunks → gera embeddings. Sem `OPENROUTER_API_KEY` a ingestão falha na etapa de embedding.
   - **Documentos**: status das ingestões (fila, erro, revisão manual para PDFs escaneados).
   - **Modelos**: modelo padrão, fallback e permitidos.
   - **Usuários**: convites, cargo, saldo de créditos.
   - **Uso**: consumo agregado (tokens, custo, créditos).
   - **Configurações**: prompt global da organização.
5. **Reranking opcional**: com `RERANKER_ENABLED=true`, respostas reranqueiam os chunks recuperados (Voyage via OpenRouter ou `VOYAGE_API_KEY` direto).

### Worker Docling (opcional)

Extração de melhor qualidade para documentos complexos:

```bash
docker compose --profile docling up docling-worker   # :8001
# ou local: cd workers/docling && pip install -r requirements.txt && python app.py
```

Sem o worker, o server usa fallback local (`pdf-parse`/`mammoth`). OCR opcional (`OCR_ENABLED=true`) para PDFs escaneados; se a qualidade mínima não for atingida, a ingestão falha e exige revisão manual.

## Auth

JWT: `Authorization: Bearer <access_token>` (15m) + refresh (7d). Sem cookie de sessão.

| var                                              | efeito                                         |
| ------------------------------------------------ | ---------------------------------------------- |
| `AUTH_DISABLED=true` + `VITE_AUTH_DISABLED=true` | entra direto como admin bootstrap (padrão dev) |
| ambas `false`                                    | login obrigatório em `/login`                  |

## Configuração principal (.env)

| bloco   | vars                                                                                   |
| ------- | -------------------------------------------------------------------------------------- |
| Base    | `PORT`, `CORS_ORIGIN`, `DATABASE_URL`, `VITE_SERVER_URL`                               |
| Auth    | `JWT_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `BOOTSTRAP_ADMIN_*`                 |
| LLM     | `OPENROUTER_API_KEY` (obrigatória para gerar e para embeddings), `OPENROUTER_BASE_URL` |
| RAG     | `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `RERANKER_*`                                |
| Storage | `S3_*` (RustFS, padrão), `R2_*` + `STORAGE_DRIVER` (R2 opcional), `MAX_UPLOAD_BYTES`   |
| Docling | `DOCLING_WORKER_URL`, `OCR_ENABLED`                                                    |

## Scripts

| comando                              | o que faz                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `bun run dev`                        | web :5173 + server :3001                                                   |
| `bun run dev:web` / `dev:server`     | um processo só                                                             |
| `bun run check-types`                | TypeScript em todos os workspaces                                          |
| `bun run check`                      | Oxlint + Oxfmt (`--write`)                                                 |
| `bun run test`                       | testes do server (bun test: auth, chat, knowledge, governance, pi-harness) |
| `bun run db:start/stop/down`         | Postgres no Docker                                                         |
| `bun run db:generate` / `db:migrate` | migration Drizzle (após mudar o schema)                                    |
| `bun run db:push` / `db:seed`        | dev: sync do schema / cargos, prompt global, admin                         |
| `bun run docker:up`                  | stack completa (web + server + postgres)                                   |

⚠️ Não rode `bun run dev` e `bun run docker:up` juntos: as portas 5173 e 3001 colidem.

## Estrutura

```
├── apps/
│   ├── web/         # Vite + React + TanStack Router (routes em src/routes)
│   └── server/      # Hono (src/routes, src/middleware, testes *.test.ts)
├── packages/
│   ├── contracts/   # Zod compartilhado (API contracts)
│   ├── db/          # Drizzle: schema, migrations, seed
│   ├── config/      # tsconfig base
│   └── ui/          # componentes visuais
├── workers/
│   └── docling/     # extração de documentos (Python, opcional)
├── AGENTS.md        # diretrizes para agentes de código
└── docker-compose.yml
```

## Solução de problemas

- **Chat responde erro de upstream** → falta `OPENROUTER_API_KEY`.
- **Upload falha ao ingerir** → confira o RustFS (`docker compose up rustfs`) e a chave OpenRouter; PDF escaneado precisa de OCR (`OCR_ENABLED=true` + Docling).
- **Porta em uso** → algo já roda em 5173/3001 (dev vs docker).
- **Reset total do banco** → `bun run db:down -v` e rode o setup de novo.
