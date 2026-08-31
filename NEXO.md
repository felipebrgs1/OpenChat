# Nexo — Spec de produto e implementação

Nome de trabalho: **Nexo** (assistente interno unificado). Trocar o nome não muda o contrato.

Documento-fonte para desenvolvimento spec-driven. Cada lote fecha um incremento utilizável. Não implementar lote N+1 sem o critério de aceite do lote N.

Idioma da UI e dos textos de produto: pt-BR.
Timezone: America/Sao_Paulo.
Moeda de custo interno: USD (OpenRouter) com exibição opcional em BRL.

---

## 1. Problema

Cada pessoa da empresa usa conta pessoal de LLM. Conhecimento some no histórico individual, custo é invisível, dado interno vaza, novato não sabe o que perguntar nem para quem.

## 2. Promessa

Um chat interno, com login da empresa, onde o cargo do usuário define:

- o que ele vê ao entrar (onboarding + perguntas-guia)
- qual system prompt entra no modelo
- quais bases de conhecimento são injetadas
- quais modelos e ferramentas ele pode usar (lotes posteriores)
- o que o admin consegue auditar

O cargo não é só RBAC de tela. É **contexto operacional**.

## 3. Não-objetivos (v1)

- Clonar ChatGPT feature-complete (plugins store, voice, canvas, memory pessoal infinita)
- Fine-tune
- Agente autônomo escrevendo no Wix / WhatsApp / boleto
- Multi-tenant SaaS
- App mobile nativo
- SSO SAML no lote 1 (reservado; desenhar o modelo para caber depois)
- UI white-label para cliente final da Voz Educa

## 4. Princípios

1. Convite, não signup aberto.
2. Cargo é a unidade de experiência. Usuário sem cargo não entra no chat.
3. Modelo barato é o default. Frontier é explícito.
4. Knowledge curada > dump de PDF.
5. Toda resposta que use base interna deve poder citar a fonte (a partir do lote de RAG).
6. Prompt e documento de cobrança/aluno nunca vão para log de terceiro além do necessário para inferência.
7. Spec manda. Se o código divergir, atualiza a spec no mesmo PR.

## 5. Personas e cargos seed

Cargos iniciais da Voz Educa. Admin pode criar outros depois.

| slug      | nome                  | para quem            | o que o assistente prioriza                       |
| --------- | --------------------- | -------------------- | ------------------------------------------------- |
| admin     | Administrador         | dono da instância    | tudo; gestão de usuários, cargos, docs, uso       |
| diretoria | Diretoria             | gestão               | visão, métricas, posicionamento, decisões         |
| comercial | Comercial / CS        | vendas e sucesso     | argumentário, objeções, onboarding de escola      |
| cobranca  | Cobrança / Financeiro | time financeiro      | regras de inadimplência, cálculo, tom de cobrança |
| suporte   | Suporte               | atendimento          | FAQ, Wix, WhatsApp, tickets recorrentes           |
| produto   | Produto / Dev         | engenharia e produto | stack, decisões técnicas, runbooks                |
| novato    | Novo colaborador      | primeiros 30 dias    | mapa da empresa + “por onde começar”              |

Regras:

- Um usuário tem **um cargo primário** (`role_id`).
- Pode ter cargos secundários depois (lote futuro). v1 = um cargo.
- `admin` é cargo + flag `is_admin` no usuário. Admin sempre acessa o painel.
- Usuário recém-convidado cai em `novato` se o admin não escolher outro.

Cada cargo tem:

- `description` curta (1–2 frases, aparece no onboarding)
- `starter_prompts[]` (6–12 perguntas prontas)
- `system_prompt` (overlay específico; concatena com o prompt global)
- `welcome_md` (markdown da tela “seu cargo”)
- `knowledge_ids[]` (bases vinculadas)
- `allowed_model_ids[]` (vazio = herda default da org)
- `monthly_budget_usd` opcional (lote de governança)

---

## 6. Stack travado

| camada      | escolha                       | nota                                       |
| ----------- | ----------------------------- | ------------------------------------------ |
| monorepo    | Turborepo + bun               | `apps/*` + `packages/*`                    |
| web         | Vite + React 19 + TypeScript  | SPA :5173                                  |
| rotas       | TanStack Router file-based    | `src/routes`                               |
| data client | TanStack Query                | sem Redux                                  |
| estilo      | Tailwind CSS v4               | `@tailwindcss/vite`, tokens em `@theme`    |
| componentes | Base UI + CVA (`packages/ui`) | primitives shadcn ok; sem lock-in de bloco |
| API         | Hono no Bun                   | `apps/server` :3001                        |
| validação   | Zod                           | compartilhada em `packages/contracts`      |
| ORM         | Drizzle                       | `drizzle-orm/node-postgres`                |
| DB          | PostgreSQL 16+                | imagem de dev: 18                          |
| auth        | JWT HS256 (Bearer)            | email/senha + convite; sem Better Auth     |
| LLM         | OpenRouter via pi SDK         | harness headless no server; UI não vê pi   |
| streaming   | SSE                           | `text/event-stream` (contrato do web)      |
| files       | disco local v1                | path configurável; S3 depois               |
| testes      | bun:test                      | unit + request na API                      |
| lint        | Oxlint + Oxfmt                |                                            |
| env         | `.env` único na raiz          | Bun/Vite/Drizzle leem da raiz              |

Runtime Bun. TypeScript strict. Sem `.env` dentro de `apps/*`.

---

## 7. Monorepo

```
nexo/
  apps/
    web/                 # Vite SPA :5173
    server/              # Hono :3001
  packages/
    contracts/           # Zod schemas + types compartilhados
    db/                  # drizzle schema, migrations, client
    config/              # tsconfig base
    ui/                  # componentes visuais sem regra de negócio
  NEXO.md
  LOTES.md
  turbo.json
  docker-compose.yml     # postgres (+ web/server para deploy)
  .env.example
```

Workspaces Bun: `apps/*` + `packages/*`.

`turbo.json` tasks: `dev`, `build`, `check-types`, `db:generate`, `db:migrate`.

Apps não importam umas às outras. Contratos de API só via `@nexo/contracts`.
Schema só via `@nexo/db`.

---

## 8. Modelo de dados (Drizzle)

IDs: UUID v7 (ou uuid v4 se v7 não estiver estável no driver). Timestamps `timestamptz`. Soft delete só em knowledge e conversations.

### 8.1 Auth (JWT)

Tabelas próprias. Sem Better Auth (`session` / `account` / `verification` não existem).

```
user
  id
  name
  email
  email_verified
  image
  password_hash        text null  -- null enquanto invited
  role_id              uuid null references role(id)
  is_admin             boolean default false
  status               'invited' | 'active' | 'disabled'
  onboarded_at         timestamptz null
  created_at
  updated_at

refresh_token
  id
  user_id              references user(id)
  token_hash           text      -- SHA-256 do refresh
  expires_at
  revoked_at           timestamptz null
  created_at
```

### 8.2 Domínio

```
role
  id
  slug                 unique  -- comercial, cobranca...
  name
  description
  system_prompt        text
  welcome_md           text
  monthly_budget_usd   numeric(12,4) null
  is_system            boolean default false  -- não apagar seed
  created_at
  updated_at

role_starter_prompt
  id
  role_id
  title
  prompt
  sort_order

organization_settings  -- singleton row
  id
  name
  global_system_prompt
  default_model          -- openrouter model id
  fallback_model
  allowed_models         jsonb  -- string[]
  monthly_budget_usd
  openrouter_base_url    default https://openrouter.ai/api/v1
  created_at
  updated_at

invite
  id
  email
  role_id
  invited_by
  token_hash
  expires_at
  accepted_at
  created_at

knowledge_collection
  id
  slug
  name
  description
  visibility           'all' | 'by_role'
  created_by
  created_at
  updated_at
  deleted_at

knowledge_role
  collection_id
  role_id
  primary key (collection_id, role_id)

knowledge_document
  id
  collection_id
  title
  source_type          'markdown' | 'upload'
  filename             null
  mime
  body_md              text      -- conteúdo canônico v1
  checksum
  created_by
  created_at
  updated_at
  deleted_at

conversation
  id
  user_id
  role_id_snapshot     -- cargo no momento da criação
  title
  model
  archived_at
  created_at
  updated_at

message
  id
  conversation_id
  role                 'user' | 'assistant' | 'system'
  content              text
  model
  prompt_tokens        int
  completion_tokens    int
  cost_usd             numeric(12,6)
  finish_reason
  error                text null
  created_at

usage_event
  id
  user_id
  conversation_id
  model
  prompt_tokens
  completion_tokens
  cost_usd
  created_at

audit_log
  id
  actor_id
  action               -- user.invite, role.update, knowledge.publish...
  entity_type
  entity_id
  meta                 jsonb
  created_at
```

Índices:

- `user.email` unique
- `user.role_id`
- `conversation(user_id, updated_at desc)`
- `message(conversation_id, created_at)`
- `usage_event(user_id, created_at)`
- `knowledge_document(collection_id)`

Seed obrigatório no lote 1: 7 cargos da tabela da seção 5 + settings da org + 1 admin bootstrap via env (`BOOTSTRAP_ADMIN_EMAIL`).

---

## 9. Prompt assembly

Ordem fixa, concatenada com separadores claros:

```
[GLOBAL SYSTEM]
organization_settings.global_system_prompt

[CARGO]
role.system_prompt

[REGRAS DE SEGURANÇA]
- Não inventar regra financeira, jurídica ou de cobrança.
- Se a informação não estiver no contexto, dizer que não sabe e sugerir quem perguntar.
- Não pedir nem repetir CPF, senha, token, chave de API.
- Responder em pt-BR, direto, operacional.

[CONHECIMENTO]
documentos recuperados (lote RAG) ou docs curtos injetados (lote 3: welcome + top docs)

[HISTÓRICO]
últimas N mensagens da conversation
```

Budget de contexto v1:

- system + cargo + regras: até ~2k tokens
- knowledge: até ~4k tokens
- histórico: o restante até o limite do modelo, cortando as mais antigas

---

## 10. API (Hono)

Base: `/api`.
Auth: header `Authorization: Bearer <access_token>`. CORS só para origin do web (`CORS_ORIGIN`). Sem cookie de sessão.

Formato de erro:

```json
{ "error": { "code": "ROLE_REQUIRED", "message": "Usuário sem cargo." } }
```

Códigos: `UNAUTHORIZED`, `FORBIDDEN`, `ROLE_REQUIRED`, `VALIDATION`, `NOT_FOUND`, `BUDGET_EXCEEDED`, `LLM_UPSTREAM`, `CONFLICT`.

### Auth

| método | path                         | quem                          |
| ------ | ---------------------------- | ----------------------------- |
| POST   | `/api/auth/login`            | público                       |
| POST   | `/api/auth/refresh`          | público (refresh válido)      |
| POST   | `/api/auth/logout`           | logado (revoga refresh)       |
| POST   | `/api/invites`               | admin                         |
| GET    | `/api/invites`               | admin                         |
| POST   | `/api/invites/:id/revoke`    | admin                         |
| POST   | `/api/invites/:token/accept` | público (cria senha + tokens) |
| GET    | `/api/me`                    | logado                        |
| PATCH  | `/api/me`                    | logado (nome, onboarded_at)   |

Login / accept / refresh devolvem:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": 900,
  "user": {
    "id": "...",
    "name": "...",
    "email": "...",
    "isAdmin": false,
    "roleId": "...",
    "status": "active"
  }
}
```

Access JWT HS256, 15 min. Claims: `sub`, `email`, `is_admin`, `role_id`, `typ: "access"`.
Refresh 7 dias, `typ: "refresh"`, `jti` = `refresh_token.id`. Hash SHA-256 persistido para revogação.
Web manda `Authorization: Bearer` em toda request autenticada.

### Cargos

| método | path                      | quem                                          |
| ------ | ------------------------- | --------------------------------------------- |
| GET    | `/api/roles`              | logado (lista pública resumida)               |
| GET    | `/api/roles/:slug`        | logado (o próprio por padrão; admin vê todos) |
| POST   | `/api/roles`              | admin                                         |
| PATCH  | `/api/roles/:id`          | admin                                         |
| PUT    | `/api/roles/:id/starters` | admin                                         |

### Chat

| método | path                              | quem                  |
| ------ | --------------------------------- | --------------------- |
| GET    | `/api/conversations`              | dono                  |
| POST   | `/api/conversations`              | logado com cargo      |
| GET    | `/api/conversations/:id`          | dono                  |
| PATCH  | `/api/conversations/:id`          | dono (title, archive) |
| GET    | `/api/conversations/:id/messages` | dono                  |
| POST   | `/api/conversations/:id/messages` | dono — **SSE**        |

Body de envio:

```json
{
  "content": "Como calcular multa de atraso?",
  "model": "google/gemini-2.5-flash",
  "starterId": null
}
```

SSE events:

```
event: meta
data: {"messageId":"...","model":"..."}

event: delta
data: {"text":"pedaço"}

event: done
data: {"messageId":"...","promptTokens":123,"completionTokens":80,"costUsd":0.0012}

event: error
data: {"code":"LLM_UPSTREAM","message":"..."}
```

### Knowledge

| método | path                           | quem                          |
| ------ | ------------------------------ | ----------------------------- |
| GET    | `/api/knowledge`               | admin; user vê só as do cargo |
| POST   | `/api/knowledge`               | admin                         |
| POST   | `/api/knowledge/:id/documents` | admin (markdown)              |
| PATCH  | `/api/knowledge/documents/:id` | admin                         |
| DELETE | `/api/knowledge/documents/:id` | admin soft                    |

### Admin

| método | path                   | quem                           |
| ------ | ---------------------- | ------------------------------ |
| GET    | `/api/admin/users`     | admin                          |
| PATCH  | `/api/admin/users/:id` | admin (role, status, is_admin) |
| GET    | `/api/admin/usage`     | admin                          |
| GET    | `/api/admin/settings`  | admin                          |
| PATCH  | `/api/admin/settings`  | admin                          |

Contratos Zod vivem em `packages/contracts` e são a fonte de tipos do web e da api.

---

## 11. Web — rotas TanStack Router

```
apps/web/src/routes/
  __root.tsx
  index.tsx                      # redirect /app ou /login
  login.tsx
  invite.$token.tsx
  _app/
    route.tsx                    # shell autenticado
    index.tsx                    # home do cargo
    chat.index.tsx
    chat.$conversationId.tsx
    knowledge.index.tsx          # leitura das bases do cargo
    knowledge.$collectionId.tsx
    settings.tsx                 # perfil
    admin/
      route.tsx                  # beforeLoad is_admin
      users.tsx
      roles.tsx
      roles.$slug.tsx
      knowledge.tsx
      usage.tsx
      settings.tsx
```

Shell `_app`:

- sidebar: logo, cargo atual, lista de conversas, botão nova conversa, link bases, admin se `is_admin`
- topbar: seletor de modelo (allowlist), nome do user
- conteúdo

Home do cargo (`_app/index`):

- `welcome_md`
- grid de `starter_prompts` (clicar cria conversation e já envia)
- “bases que você pode consultar”
- 3 conversas recentes

Chat:

- layout tipo ChatGPT: lista à esquerda, thread à direita
- markdown no assistant
- stop generation
- copiar mensagem
- indicador de modelo + custo da virada (se admin ou flag)

Onboarding: se `onboarded_at` null, a home é obrigatória antes do chat livre. Checkbox “entendi meu cargo” grava `onboarded_at`.

---

## 12. OpenRouter

A partir do lote 3 o server não chama OpenRouter direto. `apps/server` usa o SDK do `pi` (`createAgentSession`, `noTools: "all"`) e o `pi` fala com OpenRouter. O web continua vendo só SSE. A chave nunca sai do processo do server.

Env da API:

```
OPENROUTER_API_KEY
OPENROUTER_HTTP_REFERER   # url da instância
OPENROUTER_APP_TITLE      # Nexo
```

Request:

- `Authorization: Bearer`
- `HTTP-Referer`, `X-Title`
- `user`: `user.id` (tracking)
- `models` fallback: `[requested, fallback_model]`
- stream: true

Persistir usage do payload de resposta OpenRouter em `message` + `usage_event`.
Se o provider não mandar custo, estimar pela tabela local `model_price` (lote governança). v1: gravar tokens e `cost_usd` quando vier.

Default seed de modelos:

- `z-ai/glm-5.3-flash` (default se a org não escolher outro)
- allowlist configurável pelo admin em `/app/admin/models`

Allowlist na org. Dropdown não lista 400 modelos.

---

## 13. Segurança

- Convite com token de 32 bytes, hash SHA-256 no banco, expiração 72h
- Senha com `Bun.password` (argon2id)
- JWT HS256 assinado com `JWT_SECRET` (32+ bytes no `.env` da raiz)
- Header `Authorization: Bearer`; CORS libera esse header
- Rate limit: 30 mensagens / 10 min / user (memory store v1)
- Admin routes checam `is_admin` no JWT + banco
- Knowledge `by_role`: API filtra por `user.role_id`
- Não logar content completo em stdout. Logar ids, modelo, tokens, latency
- `.env` único na raiz, nunca commitado, nunca copiado para `apps/*`
- Uploads v1 só markdown/txt/pdf no lote RAG; lote 4 só markdown colado no admin

---

## 14. Lotes

Cada lote tem: objetivo, entregáveis, fora, critério de aceite.

### Lote 0 — Fundação

Objetivo: repo sobe.

Entregáveis:

- Turborepo + bun + tsconfig base
- `apps/web` Vite React Tailwind v4 hello
- `apps/server` Hono `GET /api/health`
- `packages/contracts`, `packages/db` vazio com drizzle config
- `docker-compose.yml` postgres 18
- `.env` único na raiz
- README com `bun install`, `bun run dev`, `bun run db:start`

Fora: auth, chat.

Aceite: `bun run dev` sobe web :5173 e server :3001. Health 200.

### Lote 1 — Identidade e cargos

Objetivo: pessoa entra com cargo.

Entregáveis:

- JWT email/senha (`login` / `refresh` / `logout`) + aceite de convite
- schema user (`password_hash`) + refresh_token + role + starter + settings + invite + audit
- seed dos 7 cargos com welcome_md e 8 starters cada (textos reais da Voz Educa — placeholder honesto se o time ainda não escreveu)
- bootstrap admin
- telas: login, aceite de convite (cria senha), home do cargo, admin usuários/cargos (CRUD básico)
- `GET /api/me` devolve user + role + starters

Fora: chat, OpenRouter.

Aceite:

- admin convida `dev@empresa.com` com cargo suporte
- convidado define senha e vê a home daquele cargo
- usuário sem cargo recebe `ROLE_REQUIRED` e tela “aguarde o admin”
- cargo system não pode ser deletado

### Lote 2 — Chat

Objetivo: conversar de verdade.

Entregáveis:

- conversations + messages
- POST SSE para OpenRouter
- UI chat (nova conversa, histórico, stream, markdown)
- seletor de modelo allowlist
- título automático: primeiras 60 chars da 1ª mensagem
- persistência de tokens/custo se o provider enviar

Fora: RAG, anexos, tools.

Aceite:

- mensagem aparece em stream
- refresh mantém o histórico
- user A não vê conversa de user B
- modelo fora da allowlist → 400
- queda do OpenRouter → event error, mensagem marcada com error, UI mostra retry

### Lote 3 — Harness pi headless

Objetivo: o chat usa `pi` como engine server-side, sem o usuário perceber. UI ChatGPT intacta.

Entregáveis:

- `apps/server` depende de `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`
- `createAgentSession` in-process (não RPC, não TUI)
- `POST /api/conversations/:id/messages` mantém SSE `meta/delta/done/error`
- `OPENROUTER_API_KEY` só no env do server; `ModelRuntime.setRuntimeApiKey`
- `noTools: "all"` — sem bash/read/edit/write para o usuário
- troca de modelo continua via allowlist da org + `body.model`
- prompt assembly atual (`assemblePrompt`) entra como system prompt do `pi`

Fora: knowledge, RAG, tools reais, TUI, `/compact` na UI.

Aceite:

- UI (`thread.tsx` / `sse.ts` / `model-provider.tsx`) não muda
- inspeção de rede não mostra apikey, `pi`, `toolCallId` ou `sessionFile`
- modelo fora da allowlist → 400
- sem `OPENROUTER_API_KEY` → `event: error LLM_UPSTREAM`

### Lote 4 — Conhecimento por cargo (sem vetor)

Objetivo: o cargo passa a ter “onde perguntar” e base escrita.

Entregáveis:

- collections + documents markdown
- vínculo collection↔role
- injeção dos documentos do cargo no system (cap 4k tokens, docs inteiros na ordem `updated_at desc` até caber)
- tela “Bases do seu cargo” (leitura)
- admin cria/edita collection, cola markdown, vincula cargos
- home lista as bases

Fora: embedding, upload PDF, busca semântica.

Aceite:

- doc vinculado só a `cobranca` não aparece para `comercial`
- pergunta no chat usa o texto do doc (admin consegue verificar no log de prompt em dev flag `DEBUG_PROMPT=1`)
- novato vê mapa + starters mesmo com pouca base

Textos seed mínimos (podem ser stub):

- Como a Voz Educa cobra (cobrança)
- Script de WhatsApp responsável (suporte + cobrança)
- O que o comercial pode prometer (comercial)
- Stack e como subir o ambiente (produto)
- Organograma e quem perguntar o quê (novato, todos)

### Lote 5 — Admin de verdade + uso

Objetivo: operar o sistema.

Entregáveis:

- listagem de uso por user / cargo / modelo / dia
- desativar usuário
- trocar cargo
- settings: prompt global, default model, allowlist, budget org
- audit_log nas mutações admin
- badge de custo na conversa para admin

Aceite:

- admin vê ranking de gasto da semana
- user disabled não autentica
- mudança de cargo altera starters e knowledge na próxima request (não nas conversas antigas; snapshot já gravado)

### Lote 6 — RAG

Objetivo: bases maiores sem estourar contexto.

Entregáveis:

- chunking markdown (~500–800 tokens, overlap 80)
- embeddings via OpenRouter ou modelo barato dedicado
- pgvector
- retrieval top-k 6 com filtro de collections do cargo
- citação no fim da resposta: título do doc
- upload txt/md/pdf (pdf → texto)

Aceite:

- collection com 30 páginas ainda responde com citação
- cargo sem acesso à collection não recupera o chunk

### Lote 7 — Ferramentas / MCP

Objetivo: o assistente consulta sistema vivo, read-only.

Entregáveis:

- registry interno de tools (não precisa MCP real no primeiro tool)
- tool 1: `search_knowledge` explícito (além do RAG automático)
- tool 2 stub: `get_internal_who_to_ask` (devolve dono do assunto a partir de tabela `topic_owner`)
- desenho de adapter MCP para o lote seguinte (Wix/Postgres read-only)

Aceite:

- modelo chama tool e a UI mostra “consultando base”
- nenhum tool de escrita existe

### Lote 8 — Governança fina

- budget por user e por cargo
- rate limit persistido
- export CSV de usage
- retenção de conversas (job apaga > N dias se flag)
- política OpenRouter ZDR se a org ligar

---

## 15. Conteúdo seed — starters (v1)

Usar estes textos. Ajustar depois com o time.

### novato

- O que a Voz Educa faz, em 10 linhas?
- Quem eu procuro para dúvida de cobrança, produto e comercial?
- Qual o fluxo de um lead até a escola ativa?
- O que eu não posso falar para escola/responsável?
- Como é o horário, ferramentas e acessos do time?
- Por onde eu começo na primeira semana?

### cobranca

- Como calculamos multa e juros de atraso?
- Qual o tom padrão no primeiro, segundo e terceiro contato?
- Quando podemos ameaçar negativa / jurídico — e quando não?
- Como explico boleto, PIX e renegociação?
- O que fazer se a escola pede para “não cobrar o responsável X”?
- Quais dados eu nunca colo no chat?

### comercial

- Qual o pitch de 30 segundos?
- Objeções comuns e respostas oficiais
- O que está incluso no plano e o que é extra?
- Como funciona o onboarding depois da venda?
- Como passo um lead para cobrança ou suporte sem perder contexto?
- O que eu não prometo nunca?

### suporte

- Escola não recebe o WhatsApp. Checklist.
- Responsável diz que já pagou. O que verificar?
- Como explico a plataforma sem jargão interno?
- Problema no Wix: o que eu tento antes de chamar o dev?
- Modelo de resposta educada quando a regra não pode ser furada.

### produto

- Qual o stack atual e onde está cada pedaço?
- Como subir o ambiente local?
- Onde vive regra de cálculo de cobrança?
- Como registrar uma decisão técnica?
- Runbook: integração Twilio / WhatsApp caiu.

### diretoria

- Resumo do produto para reunião
- Riscos de usar LLM com dado de aluno
- O que este assistente interno ainda não faz
- Como ler o relatório de uso de IA da semana

### admin

- Como convidar alguém e escolher cargo
- Como editar o prompt do cargo sem quebrar o global
- Como ver quem está estourando custo
- Como desligar um modelo da allowlist

---

## 16. Prompt global seed

```
Você é o Nexo, assistente interno da Voz Educa.
Responda em português brasileiro, curto e operacional.
Priorize procedimento da empresa sobre conhecimento genérico.
Se a pergunta for sobre valor, multa, contrato, inadimplência ou dado de aluno e isso não estiver no contexto, diga que não sabe e indique o cargo dono do assunto.
Nunca invente número.
Nunca peça senha, token ou chave.
Quando listar passos, use lista numerada.
```

---

## 17. UX — estados obrigatórios

- vazio chat: starters do cargo + input
- streaming: cursor + botão parar
- erro de rede: toast + retry
- modelo lento: “ainda gerando…”
- user disabled: tela seca
- sem cargo: tela “peça ao admin um cargo”
- knowledge vazia do cargo: aviso “seu cargo ainda não tem base; as respostas serão genéricas”

Visual: interface clara, densa, estilo produto interno — não marketing. Sidebar ~260px. Fundo claro default, dark mode no lote 4 se sobrar tempo (não bloquear).

---

## 18. Observabilidade mínima

API loga JSON:

`ts, level, requestId, userId, path, status, ms, model?, tokens?, costUsd?`

Web: error boundary + toast.

Sem Datadog no v1.

---

## 19. Como trabalhar spec-driven

1. Abrir o lote N. Não misturar.
2. Implementar só o que está em Entregáveis.
3. Fechar pelo Aceite (manual + 1–2 testes automatizados por lote a partir do lote 1).
4. Se surgir requisito novo, entra no lote futuro ou atualiza esta spec no mesmo PR.
5. Commits: `lote-N: …`

Testes mínimos por lote:

- Lote 1: invite + login + me.role (`bun --cwd apps/server test`)
- Lote 2: isolation de conversation + reject model
- Lote 3: harness mockado + SSE sem apikey sem vazar pi
- Lote 4: knowledge isolada por cargo
- Lote 5: disabled user 401

---

## 20. Decisões abertas (não bloquear lote 0–2)

- Nome final do produto
- SSO Google Workspace (OIDC depois; não via Better Auth)
- pgvector self-host vs embedding API
- Se o cálculo oficial de cobrança entra como doc ou como tool read-only no Postgres
- Hospedagem: VPS única com Docker Compose é o default

Decisões fechadas:

- 2026-08-31: runtime e package manager = Bun (não pnpm/Node).
- 2026-08-31: auth = JWT HS256 Bearer; Better Auth fora.
- 2026-08-31: `.env` único na raiz; sem `packages/env`.
- 2026-08-31: API em `apps/server` (não `apps/api`).
- 2026-08-31: Postgres 18 no compose de dev.
- 2026-08-31: chat engine = pi SDK in-process (não RPC/TUI); OpenRouter continua o provider; UI não expõe harness.

Quando uma decisão fechar, gravar aqui em uma linha e a data.
