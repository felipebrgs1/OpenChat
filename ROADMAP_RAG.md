# Nexo — Roadmap de RAG confiável

Este documento define o próximo escopo do Nexo: transformar as bases internas em uma fonte confiável, rastreável e segura para o chat. Ele substitui os itens futuros de RAG do escopo anterior como guia de implementação.

## 1. Objetivo

Permitir que uma pessoa da empresa faça perguntas em linguagem natural e receba respostas fundamentadas em documentos internos aos quais seu cargo tem acesso.

Uma resposta baseada em conhecimento interno deve:

- recuperar apenas conteúdo autorizado para o usuário;
- apontar as fontes exatas que sustentam a resposta;
- informar claramente quando não houver informação suficiente na base;
- manter o documento original, sua versão e o histórico de processamento;
- ser mensurável por qualidade, custo e latência.

O `pi` permanece como harness do chat. Ele não é responsável por buscar, extrair nem indexar documentos: recebe apenas os trechos recuperados e seus metadados.

```text
Upload → RustFS → fila de ingestão → extração → normalização
       → chunks + metadados → embeddings + índices → retrieval híbrido
       → rerank → fontes estruturadas → pi → resposta citada
```

## 2. Decisões de arquitetura

### 2.1 Arquivo original no RustFS

O RustFS será o armazenamento de objetos compatível com S3. O banco de dados não guarda binários dos documentos; mantém somente a chave do objeto e seus metadados.

Estrutura inicial do bucket privado:

```text
nexo-private/
└── documents/{documentId}/{revisionId}/original.{ext}
```

O nome da chave deve usar UUIDs, e não nome, e-mail ou outro dado fornecido pelo usuário.

O PostgreSQL continua sendo a fonte de verdade para permissões, estado da ingestão, revisões, chunks, embeddings e auditoria.

Regras:

- bucket sem acesso público;
- RustFS em rede privada e com TLS em produção;
- aplicação autenticada por service account com o menor conjunto de permissões possível;
- credenciais root não são usadas pela aplicação;
- download somente após autorização pela API e por URL pré-assinada de vida curta;
- checksum SHA-256 obrigatório no upload;
- backup e restauração testados para RustFS e PostgreSQL.

No primeiro lote, o upload é mediado pela API. URLs pré-assinadas de upload ficam para um lote posterior, quando houver necessidade de arquivos grandes.

### 2.2 Ingestão assíncrona

Upload não pode bloquear a interface enquanto extrai, faz OCR, gera embeddings ou indexa. Cada envio cria um job com os estados:

```text
queued → processing → ready
                  └→ failed
```

Em caso de falha, o admin vê uma causa acionável. Um PDF que não pôde ser lido nunca deve ser convertido silenciosamente de bytes para texto e indexado.

### 2.3 Extração e normalização

Um serviço de ingestão separado extrai o conteúdo do arquivo e o converte para Markdown estruturado. A primeira escolha é Docling em um worker Python, por atender PDFs, DOCX, PPTX, XLSX e HTML no mesmo pipeline.

PDFs escaneados devem passar por OCR opcional. Se a qualidade mínima não for atingida, a ingestão falha ou exige revisão manual.

O texto normalizado preserva, sempre que disponível:

- título e subtítulos;
- página de origem;
- tabelas e listas;
- URL ou referência de origem;
- posição e seção no documento.

### 2.4 Busca híbrida e permissão

O `pgvector` é suficiente para o início. O retrieval combina duas buscas antes de escolher o contexto final:

1. busca vetorial por similaridade semântica;
2. busca textual do PostgreSQL (`tsvector`) para siglas, códigos, nomes e números;
3. combinação por Reciprocal Rank Fusion;
4. remoção de duplicados e de chunks muito semelhantes;
5. rerank dos melhores candidatos;
6. envio dos 4–8 trechos mais relevantes ao `pi`.

Permissões são aplicadas na consulta SQL antes de recuperar os chunks. Nunca se recupera conteúdo sem filtro para então removê-lo na aplicação.

### 2.5 Fontes como dados estruturados

O modelo não deve inventar citações. O backend retorna junto da resposta uma lista estruturada de fontes:

```ts
type RagSource = {
  documentId: string;
  revisionId: string;
  chunkId: string;
  title: string;
  page: number | null;
  heading: string | null;
  excerpt: string;
};
```

A interface mostra título, página/seção, trecho e link autorizado para abrir a fonte. Se a busca não alcançar evidência suficiente, a resposta deixa explícito que não foi encontrada uma fonte interna confiável.

## 3. Modelo de dados

As tabelas existentes de coleção, documento e chunk serão evoluídas com as entidades abaixo.

### `knowledge_document_revision`

- `id`, `document_id`, `revision_number`
- `storage_key`, `filename`, `mime`, `size_bytes`, `checksum`
- `extracted_markdown`, `extraction_metadata`
- `created_by`, `created_at`, `superseded_at`

### `knowledge_ingestion`

- `id`, `document_revision_id`
- `status`: `queued | processing | ready | failed`
- `stage`: upload, validation, extraction, chunking, embedding, indexing
- `attempts`, `error_code`, `error_message`
- `started_at`, `completed_at`, `created_at`

### Evolução de `knowledge_chunk`

- `revision_id`
- `page`, `heading`, `start_offset`, `end_offset`
- `token_count`
- coluna `tsvector` para busca textual;
- embedding e índices vetoriais já existentes.

### `knowledge_feedback`

- `id`, `message_id`, `user_id`
- `rating`: útil, incorreta, desatualizada, sem fonte
- `comment`, `created_at`

### Avaliações

`rag_evaluation_case` guarda perguntas reais, fontes esperadas, cargo permitido e critérios de resposta. `rag_evaluation_run` guarda o resultado de cada versão do pipeline para regressão.

## 4. Lotes de entrega

### R1 — Base de avaliação

**Objetivo:** medir qualidade antes de otimizar o pipeline.

**Entregáveis:**

- 40–80 perguntas reais distribuídas entre cargos;
- fonte esperada ou critérios de resposta para cada pergunta;
- casos de ausência de informação e de acesso negado;
- runner de avaliação que registre recuperação, fontes, custo e latência.

**Critério de aceite:** é possível comparar duas versões do RAG com o mesmo conjunto de perguntas e detectar regressões de qualidade ou isolamento de acesso.

### R2 — Storage e ingestão de documentos

**Objetivo:** receber arquivos originais de forma segura e resiliente.

**Entregáveis:**

- RustFS no ambiente de desenvolvimento e configuração S3 no servidor;
- tabelas de revisão e ingestão;
- upload mediado pela API;
- validação de tamanho, MIME e checksum;
- worker assíncrono, status visível e retry controlado;
- suporte inicial para PDF, DOCX, TXT e Markdown.

**Critério de aceite:** PDF digital, DOCX e TXT chegam a `ready`; arquivos ilegíveis ficam em `failed` com uma explicação clara; o arquivo original é recuperável somente por usuário autorizado.

### R3 — Extração, normalização e chunking

**Objetivo:** gerar conteúdo de qualidade para a busca.

**Entregáveis:**

- worker de extração com Docling;
- OCR opcional para documentos escaneados;
- Markdown normalizado com páginas e headings;
- chunking por estrutura do documento;
- reindexação a cada revisão.

Parâmetros iniciais de chunking:

- alvo de 400–600 tokens;
- máximo de 800 tokens;
- overlap de 60–100 tokens;
- não misturar seções diferentes;
- unir chunks pequenos ao trecho seguinte, quando apropriado.

**Critério de aceite:** cada chunk aponta para documento, revisão, página e seção; atualizar um documento não deixa chunks da versão anterior ativos.

### R4 — Retrieval híbrido com segurança

**Objetivo:** encontrar contexto correto sem vazar informação entre cargos.

**Entregáveis:**

- embeddings de um modelo multilíngue adequado para português;
- índice vetorial e `tsvector`;
- combinação vetorial + textual por Reciprocal Rank Fusion;
- diversidade de resultados e deduplicação;
- filtros de acesso diretamente no SQL;
- telemetria: chunks candidatos, chunks escolhidos, latência e custo.

**Critério de aceite:** perguntas com siglas, números e nomes próprios recuperam a fonte certa; usuários sem autorização nunca recuperam chunks restritos.

### R5 — Rerank, fontes e experiência confiável

**Objetivo:** fazer a resposta ser verificável pelo usuário.

**Entregáveis:**

- reranker aplicado aos candidatos do retrieval;
- fontes estruturadas no contrato SSE/API;
- componente de fontes na resposta;
- abertura autorizada do documento e destaque do trecho;
- estado “não encontrei fonte interna confiável”; 
- feedback de resposta útil, incorreta, desatualizada ou sem fonte.

**Critério de aceite:** toda resposta que afirmar usar a base interna apresenta fontes verificáveis; uma pergunta sem evidência não recebe uma resposta com falsa certeza.

### R6 — Operação contínua da base

**Objetivo:** manter o conhecimento válido depois do lançamento.

**Entregáveis:**

- dono do documento;
- status `draft`, `published` e `obsolete`;
- data de revisão e alerta para conteúdo vencido;
- deduplicação por checksum;
- histórico de versões e rollback;
- painel de documentos mais usados, perguntas sem resposta e feedback negativo;
- política de retenção para arquivos e revisões antigas.

**Critério de aceite:** o admin identifica conteúdo desatualizado, sabe quem é responsável por cada documento e consegue corrigir uma fonte que esteja prejudicando respostas.

## 5. Fora de escopo por enquanto

- ferramentas MCP e integrações com sistemas vivos;
- escrita automática em sistemas externos;
- query rewriting por LLM e múltiplos agentes de busca;
- busca em fontes externas à empresa;
- upload direto com URL pré-assinada;
- multi-tenant SaaS.

Esses itens só entram após o R5 passar na avaliação criada no R1.

## 6. Métricas de sucesso

- taxa de respostas com fonte relevante;
- precisão da recuperação no conjunto de avaliação;
- taxa de respostas que reconhecem ausência de informação;
- tentativas de acesso negadas corretamente;
- p95 de tempo até a primeira resposta;
- custo de embedding por documento e por pergunta;
- quantidade de feedbacks negativos e documentos desatualados;
- proporção de perguntas que exigem escalonamento humano.

## 7. Ordem recomendada

Implementar R1 → R2 → R3 → R4 → R5 → R6. Não antecipar agentes, MCP ou query rewriting: primeiro é necessário provar que o documento certo é extraído, dividido, recuperado, autorizado e citado corretamente.
