export const GLOBAL_SYSTEM_PROMPT = `Você é o Oráculo, assistente interno da organização.
Responda em português brasileiro, curto e operacional.
Priorize procedimento da empresa sobre conhecimento genérico.
Se a pergunta for sobre valor, multa, contrato, inadimplência ou dado de aluno e isso não estiver no contexto, diga que não sabe e indique o cargo dono do assunto.
Nunca invente número.
Nunca peça senha, token ou chave.
Quando listar passos, use lista numerada.`;

type StarterSeed = { title: string; prompt: string };

export type RoleSeed = {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  welcomeMd: string;
  starters: StarterSeed[];
};

function starters(prompts: string[]): StarterSeed[] {
  return prompts.map((prompt) => ({
    title: prompt.length > 72 ? `${prompt.slice(0, 69)}…` : prompt,
    prompt,
  }));
}

function pad(prompts: string[], extras: string[]): string[] {
  const next = [...prompts];
  for (const extra of extras) {
    if (next.length >= 8) {
      break;
    }
    next.push(extra);
  }
  return next;
}

const PLACEHOLDER = "Ainda não documentado pelo time. O que eu deveria saber neste cargo?";

export const ROLE_SEEDS: RoleSeed[] = [
  {
    slug: "admin",
    name: "Administrador",
    description: "Dono da instância. Gestão de pessoas, cargos, bases e custo do assistente.",
    systemPrompt:
      "Você apoia quem opera o Oráculo. Priorize convites, cargos, prompts, allowlist de modelos e leitura de uso. Não invente configuração que não esteja no contexto.",
    welcomeMd: `## Seu cargo: Administrador

Você opera a instância. Convida gente, escolhe cargo, edita o overlay do cargo sem quebrar o prompt global e acompanha custo.

Checklist da primeira semana:

1. Confira o prompt global
2. Convide o time com o cargo certo
3. Não ligue modelo frontier como default
`,
    starters: starters(
      pad(
        [
          "Como convidar alguém e escolher cargo",
          "Como editar o prompt do cargo sem quebrar o global",
          "Como ver quem está estourando custo",
          "Como desligar um modelo da allowlist",
        ],
        [
          "O que acontece se eu desativar um usuário?",
          "Como trocar o cargo de alguém já ativo?",
          "Qual o default de modelo e por que ele é o barato?",
          PLACEHOLDER,
        ],
      ),
    ),
  },
  {
    slug: "diretoria",
    name: "Diretoria",
    description: "Visão, métricas, posicionamento e decisões. Pouco operacional de ticket.",
    systemPrompt:
      "Você fala com gestão. Seja direto, traga risco e trade-off. Não entre em detalhe de ticket ou script de cobrança a menos que peçam.",
    welcomeMd: `## Seu cargo: Diretoria

O assistente prioriza visão de produto, risco de dado e leitura de uso — não o passo a passo de atendimento.

Se a pergunta for operacional de cobrança ou suporte, ele deve apontar o cargo dono.
`,
    starters: starters(
      pad(
        [
          "Resumo do produto para reunião",
          "Riscos de usar LLM com dado de aluno",
          "O que este assistente interno ainda não faz",
          "Como ler o relatório de uso de IA da semana",
        ],
        [
          "O que a diretoria não deve pedir para o modelo inventar?",
          "Qual o posicionamento em uma frase?",
          "Quando vale a pena um modelo mais caro?",
          PLACEHOLDER,
        ],
      ),
    ),
  },
  {
    slug: "comercial",
    name: "Comercial / CS",
    description: "Vendas e sucesso. Argumentário, objeções e onboarding de escola.",
    systemPrompt:
      "Você apoia comercial e CS. Use argumentário oficial. Nunca prometa o que não está no plano. Se não souber o preço ou a regra, diga que não sabe.",
    welcomeMd: `## Seu cargo: Comercial / CS

Aqui vale pitch, objeção e o que está incluso. O que você não promete nunca também entra nesta base.

Não use o chat para inventar desconto, prazo ou feature.
`,
    starters: starters(
      pad(
        [
          "Qual o pitch de 30 segundos?",
          "Objeções comuns e respostas oficiais",
          "O que está incluso no plano e o que é extra?",
          "Como funciona o onboarding depois da venda?",
          "Como passo um lead para cobrança ou suporte sem perder contexto?",
          "O que eu não prometo nunca?",
        ],
        ["Como descrevo o diferencial sem jargão interno?", PLACEHOLDER],
      ),
    ),
  },
  {
    slug: "cobranca",
    name: "Cobrança / Financeiro",
    description: "Regras de inadimplência, cálculo e tom de cobrança. Sem improvisar número.",
    systemPrompt:
      "Você apoia cobrança. Não invente multa, juros, prazo ou ameaça jurídica. Se a regra não estiver no contexto, diga que não sabe e indique quem decide. Nunca peça CPF, senha ou dado de cartão.",
    welcomeMd: `## Seu cargo: Cobrança / Financeiro

Multa, juros, tom de contato e o que não pode ser ameaçado. Se a regra não estiver na base, o assistente deve recusar inventar.

Não cole dado de aluno ou responsável no chat.
`,
    starters: starters(
      pad(
        [
          "Como calculamos multa e juros de atraso?",
          "Qual o tom padrão no primeiro, segundo e terceiro contato?",
          "Quando podemos ameaçar negativa / jurídico — e quando não?",
          "Como explico boleto, PIX e renegociação?",
          "O que fazer se a escola pede para “não cobrar o responsável X”?",
          "Quais dados eu nunca colo no chat?",
        ],
        ["Como registro uma renegociação?", PLACEHOLDER],
      ),
    ),
  },
  {
    slug: "suporte",
    name: "Suporte",
    description: "Atendimento. FAQ, Wix, WhatsApp e tickets recorrentes.",
    systemPrompt:
      "Você apoia suporte. Checklist antes de escalar. Linguagem simples para escola e responsável. Não fure regra de cobrança ou contrato.",
    welcomeMd: `## Seu cargo: Suporte

FAQ, WhatsApp, Wix e o que tentar antes de chamar o dev. Tom educado quando a regra não pode ser furada.

Se o caso for financeiro, encaminhe para cobrança em vez de improvisar.
`,
    starters: starters(
      pad(
        [
          "Escola não recebe o WhatsApp. Checklist.",
          "Responsável diz que já pagou. O que verificar?",
          "Como explico a plataforma sem jargão interno?",
          "Problema no Wix: o que eu tento antes de chamar o dev?",
          "Modelo de resposta educada quando a regra não pode ser furada.",
        ],
        [
          "Como abro um ticket para produto sem perder contexto?",
          "O que eu não prometo em nome do time de engenharia?",
          PLACEHOLDER,
        ],
      ),
    ),
  },
  {
    slug: "produto",
    name: "Produto / Dev",
    description: "Engenharia e produto. Stack, decisões técnicas e runbooks.",
    systemPrompt:
      "Você apoia produto e engenharia. Seja específico de stack e runbook. Não invente o lugar de uma regra se não estiver no contexto.",
    welcomeMd: `## Seu cargo: Produto / Dev

Stack, como subir o ambiente, onde vive regra de cobrança e runbook de integração. Decisão técnica se registra — não some no chat pessoal.
`,
    starters: starters(
      pad(
        [
          "Qual o stack atual e onde está cada pedaço?",
          "Como subir o ambiente local?",
          "Onde vive regra de cálculo de cobrança?",
          "Como registrar uma decisão técnica?",
          "Runbook: integração Twilio / WhatsApp caiu.",
        ],
        [
          "Qual o fluxo de um bug até o deploy?",
          "O que não deve ir para o prompt de um cargo de atendimento?",
          PLACEHOLDER,
        ],
      ),
    ),
  },
  {
    slug: "novato",
    name: "Novo colaborador",
    description: "Primeiros 30 dias. Mapa da empresa e por onde começar.",
    systemPrompt:
      "Você onboa gente nova. Explique o mapa da empresa, quem perguntar o quê e o que não pode ser dito para escola ou responsável. Seja concreto e curto.",
    welcomeMd: `## Seu cargo: Novo colaborador

Os primeiros 30 dias. Mapa da empresa, quem perguntar e o que você ainda não deve falar para fora.

Marque “entendi meu cargo” quando o texto abaixo fizer sentido. Chat livre vem depois.
`,
    starters: starters(
      pad(
        [
          "O que a empresa faz, em 10 linhas?",
          "Quem eu procuro para dúvida de cobrança, produto e comercial?",
          "Qual o fluxo de um lead até a escola ativa?",
          "O que eu não posso falar para escola/responsável?",
          "Como é o horário, ferramentas e acessos do time?",
          "Por onde eu começo na primeira semana?",
        ],
        ["O que este assistente ainda não faz?", PLACEHOLDER],
      ),
    ),
  },
];

export type KnowledgeDocSeed = { title: string; bodyMd: string };

export type KnowledgeCollectionSeed = {
  slug: string;
  name: string;
  description: string;
  visibility: "all" | "by_role";
  roleSlugs: string[];
  documents: KnowledgeDocSeed[];
};

export const KNOWLEDGE_SEEDS: KnowledgeCollectionSeed[] = [
  {
    slug: "como-cobramos",
    name: "Como cobramos",
    description: "Regras de cobrança, multa, juros e renegociação.",
    visibility: "by_role",
    roleSlugs: ["cobranca", "suporte", "diretoria"],
    documents: [
      {
        title: "Regras de cobrança (stub)",
        bodyMd: `# Como cobramos

> Documento stub. O time de cobrança deve revisar com os valores oficiais antes de usar em produção.

1. Mensalidade vence todo dia 10.
2. Após o vencimento, multa de 2% e juros proporcional de 1% ao mês (STUB — confirmar valor oficial).
3. Renegociação só em até 2 parcelas.
4. Nunca prometer desconto fora da política oficial.`,
      },
    ],
  },
  {
    slug: "whatsapp-responsavel",
    name: "Script de WhatsApp responsável",
    description: "Tom e limites no contato com responsáveis.",
    visibility: "by_role",
    roleSlugs: ["suporte", "cobranca"],
    documents: [
      {
        title: "Script de WhatsApp (stub)",
        bodyMd: `# Script de WhatsApp responsável

> Documento stub. Revisar com o time de suporte.

- Cumprimentar, identificar-se e confirmar com quem fala.
- Nunca discutir nem elevar o tom.
- Se o responsável pedir dado de terceiro, não compartilhar.
- Encerrar com próximo passo claro.`,
      },
    ],
  },
  {
    slug: "o-que-comercial-promete",
    name: "O que o comercial pode prometer",
    description: "Limites de argumentação e promessa comercial.",
    visibility: "by_role",
    roleSlugs: ["comercial"],
    documents: [
      {
        title: "Limites do comercial (stub)",
        bodyMd: `# O que o comercial pode prometer

> Documento stub. Revisar com o time comercial.

- Pode prometer: onboarding assistido, suporte em horário comercial.
- Não pode prometer: resultado de aprovação, desconto fora da tabela, prazo de integração específico.`,
      },
    ],
  },
  {
    slug: "stack-ambiente",
    name: "Stack e como subir o ambiente",
    description: "Visão técnica e setup local.",
    visibility: "by_role",
    roleSlugs: ["produto", "admin"],
    documents: [
      {
        title: "Stack e ambiente local (stub)",
        bodyMd: `# Stack e como subir o ambiente

> Documento stub. Revisar com o time de produto.

- Monorepo: Turborepo + Bun. Web em Vite/React, API em Hono.
- Postgres via docker compose.
- Comandos: \`bun install\`, \`bun run db:start\`, \`bun run dev\`.`,
      },
    ],
  },
  {
    slug: "organograma",
    name: "Organograma e quem perguntar o quê",
    description: "Mapa da empresa para todos os cargos.",
    visibility: "all",
    roleSlugs: [],
    documents: [
      {
        title: "Organograma (stub)",
        bodyMd: `# Organograma e quem perguntar o quê

> Documento stub. Preencher com nomes reais.

- Cobrança: regras financeiras, inadimplência, renegociação.
- Comercial: preços, planos, promessas permitidas.
- Suporte: problemas de uso, WhatsApp, Wix.
- Produto/Dev: bugs, ambiente, decisões técnicas.`,
      },
    ],
  },
];
