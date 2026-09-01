/**
 * Catálogo do QA Toolbox.
 *
 * Fonte única da verdade das ferramentas: a página inicial, a busca, as
 * categorias e o roteamento das páginas saem todos daqui. Adicionar uma
 * ferramenta é acrescentar uma entrada em `QA_TOOLS` e escrever o painel dela —
 * nada de mexer em navegação, busca ou rota uma por uma.
 */

/** Agrupamento visível na página inicial do Toolbox. */
export type ToolCategory = "api-json" | "test-data" | "automation" | "test-design" | "utilities";

/**
 * Maturidade da ferramenta.
 *
 * `soon` é o único estado sem página: a ferramenta aparece no catálogo como
 * anúncio, sem link, e a rota responde 404 como qualquer caminho inexistente.
 */
export type ToolStatus = "stable" | "beta" | "new" | "soon";

export interface QaToolDefinition {
  /** Identificador estável; vira o último segmento da rota. */
  id: string;
  name: string;
  /** Uma linha: é o que aparece no card e o que a busca lê. */
  description: string;
  category: ToolCategory;
  /** Termos alternativos pelos quais alguém procuraria a ferramenta. */
  tags: string[];
  route: string;
  status: ToolStatus;
  /**
   * `true` só quando nenhum dado digitado sai do navegador.
   *
   * O selo "Roda local" é uma promessa de privacidade, não enfeite: uma
   * ferramenta que consulta o servidor precisa declarar `false` aqui, mesmo que
   * a consulta pareça inofensiva.
   */
  runsLocally: boolean;
  /** Sufixo da classe `tool-icon icon-*` já existente no CSS do produto. */
  icon: string;
}

export interface ToolCategoryDefinition {
  id: ToolCategory;
  label: string;
  description: string;
}

/** Ordem em que as categorias aparecem na página inicial do Toolbox. */
export const TOOL_CATEGORIES: readonly ToolCategoryDefinition[] = [
  { id: "api-json", label: "API & JSON", description: "Inspecionar respostas, payloads e tokens." },
  { id: "test-data", label: "Test Data", description: "Massa de teste sintética, válida e inválida." },
  { id: "automation", label: "Automation", description: "Transformar o que você já tem em código de teste." },
  { id: "test-design", label: "Test Design", description: "Derivar casos de teste a partir das regras." },
  { id: "utilities", label: "Utilities", description: "Apoio do dia a dia de quem testa." },
];

export const QA_TOOLS: readonly QaToolDefinition[] = [
  {
    id: "json-diff",
    name: "JSON Diff",
    description: "Compare respostas, payloads e objetos JSON ignorando campos dinâmicos.",
    category: "api-json",
    tags: ["json", "diff", "comparar", "payload", "response", "api", "contrato"],
    route: "/toolbox/json-diff",
    status: "stable",
    runsLocally: true,
    icon: "api",
  },
  {
    id: "jwt-inspector",
    name: "JWT Inspector",
    description: "Decodifique header e payload e veja expiração e validade estrutural.",
    category: "api-json",
    tags: ["jwt", "token", "auth", "bearer", "exp", "api", "seguranca"],
    route: "/toolbox/jwt-inspector",
    status: "stable",
    runsLocally: true,
    icon: "quality",
  },
  {
    id: "api-health",
    name: "API Health",
    description: "Verifique status, tempo de resposta e saúde de vários endpoints de uma vez.",
    category: "api-json",
    tags: ["api", "health", "healthcheck", "status", "monitor", "ambiente", "smoke"],
    route: "/toolbox/api-health",
    status: "beta",
    runsLocally: false,
    icon: "alerts",
  },
  {
    id: "test-data",
    name: "Test Data Generator",
    description: "Gere massa sintética — CPF, CNPJ, e-mail, datas — válida ou propositalmente inválida.",
    category: "test-data",
    tags: ["dados", "massa", "cpf", "cnpj", "cep", "fake", "csv", "sql", "json"],
    route: "/toolbox/test-data",
    status: "stable",
    runsLocally: true,
    icon: "environments",
  },
  {
    id: "curl-converter",
    name: "cURL Converter",
    description: "Cole um cURL e receba o teste em Playwright, Cypress, Fetch, Axios, Python ou Rest Assured.",
    category: "automation",
    tags: ["curl", "playwright", "cypress", "fetch", "axios", "python", "rest assured", "api", "codigo"],
    route: "/toolbox/curl-converter",
    status: "stable",
    runsLocally: true,
    icon: "journey",
  },
  {
    id: "boundary-values",
    name: "Boundary Value Generator",
    description: "Derive os casos de fronteira de um campo numérico, de texto ou de data.",
    category: "test-design",
    tags: ["boundary", "fronteira", "limite", "bva", "casos de teste", "particao", "design"],
    route: "/toolbox/boundary-values",
    status: "stable",
    runsLocally: true,
    icon: "inspection",
  },
  {
    id: "pairwise",
    name: "Pairwise Generator",
    description: "Reduza a combinação de parâmetros ao conjunto mínimo que cobre todos os pares.",
    category: "test-design",
    tags: ["pairwise", "combinatorio", "all pairs", "design", "casos de teste", "matriz"],
    route: "/toolbox/pairwise",
    status: "new",
    runsLocally: true,
    icon: "quality",
  },
  {
    id: "regex-tester",
    name: "Regex Tester",
    description: "Teste uma expressão regular e veja onde ela casa, o que cai em cada grupo e quais linhas atinge.",
    category: "utilities",
    tags: ["regex", "expressao regular", "match", "grupo", "validacao", "log"],
    route: "/toolbox/regex-tester",
    status: "new",
    runsLocally: true,
    icon: "inspection",
  },
  {
    id: "timestamp",
    name: "Timestamp Converter",
    description: "Converta epoch e ISO 8601 sem confundir segundos com milissegundos.",
    category: "utilities",
    tags: ["timestamp", "epoch", "unix", "data", "hora", "iso", "fuso"],
    route: "/toolbox/timestamp",
    status: "new",
    runsLocally: true,
    icon: "alerts",
  },
  {
    id: "http-status",
    name: "HTTP Status Explorer",
    description: "Consulte o que cada código HTTP significa e o que verificar quando ele aparece.",
    category: "utilities",
    tags: ["http", "status", "codigo", "404", "500", "referencia"],
    route: "/toolbox/http-status",
    status: "new",
    runsLocally: true,
    icon: "docs",
  },
  {
    id: "json-schema",
    name: "JSON Schema Validator",
    description: "Valide um payload contra o schema e veja qual regra falhou, campo a campo.",
    category: "api-json",
    tags: ["json schema", "validacao", "contrato", "payload", "required", "draft"],
    route: "/toolbox/json-schema",
    status: "new",
    runsLocally: true,
    icon: "api",
  },
  {
    id: "openapi-diff",
    name: "OpenAPI Diff",
    description: "Compare duas versões de um contrato e destaque as quebras de compatibilidade.",
    category: "api-json",
    tags: ["openapi", "swagger", "contrato", "breaking change", "api", "yaml", "compatibilidade", "versao"],
    route: "/toolbox/openapi-diff",
    status: "new",
    runsLocally: true,
    icon: "docs",
  },
  {
    id: "webhook-inspector",
    name: "Webhook Inspector",
    description: "Abra uma URL descartável e veja o corpo e os cabeçalhos de cada webhook que chegar.",
    category: "utilities",
    tags: ["webhook", "callback", "http", "integracao", "requestbin", "callback url"],
    route: "/toolbox/webhook-inspector",
    status: "new",
    runsLocally: false,
    icon: "environments",
  },
];

/** Ferramentas com página própria — tudo que não está anunciado como "em breve". */
export const AVAILABLE_TOOLS: readonly QaToolDefinition[] = QA_TOOLS.filter((tool) => tool.status !== "soon");

export function findTool(id: string): QaToolDefinition | undefined {
  return QA_TOOLS.find((tool) => tool.id === id);
}

export function categoryLabel(category: ToolCategory): string {
  return TOOL_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;
}

/**
 * Normaliza para comparação: sem acento, sem caixa, sem espaço nas pontas.
 *
 * Buscar "acessibilidade" e "acessibilidade" tem de dar no mesmo, e quem digita
 * "JSON" espera achar "json".
 */
export function normalizeSearchTerm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Busca por nome, descrição, tags e categoria.
 *
 * Todos os termos precisam casar (E, não OU): quem digita "json diff" está
 * refinando a busca, não pedindo tudo que tem "json" ou "diff".
 */
export function searchTools(query: string, tools: readonly QaToolDefinition[] = QA_TOOLS): QaToolDefinition[] {
  const terms = normalizeSearchTerm(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...tools];
  return tools.filter((tool) => {
    const haystack = normalizeSearchTerm([tool.name, tool.description, tool.tags.join(" "), categoryLabel(tool.category), tool.id].join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}
