/**
 * Comparação de dois contratos OpenAPI.
 *
 * A pergunta que este módulo responde é uma só: **isso quebra quem já
 * consome?** Por isso a classificação não é simétrica — o que quebra depende do
 * lado em que a mudança acontece.
 *
 * Exigir um campo novo **na requisição** quebra o cliente, que não o envia.
 * Deixar de garantir um campo **na resposta** quebra o cliente, que já o lê.
 * São a mesma edição de schema com veredictos opostos, e é justamente aí que um
 * diff textual — ou um comparador ingênuo — erra.
 */

import { isJsonObject, type JsonValue } from "./json-value.js";

export type ApiChangeImpact = "breaking" | "addition" | "note";

export interface ApiChange {
  impact: ApiChangeImpact;
  /** Onde a mudança acontece, em linguagem de API: `GET /pedidos`. */
  location: string;
  /** Caminho dentro do documento, para achar o trecho. */
  pointer: string;
  message: string;
}

export interface OpenApiDiffResult {
  changes: ApiChange[];
  counts: Record<ApiChangeImpact, number>;
  breaking: boolean;
  from: string;
  to: string;
}

export const API_CHANGE_LABELS: Record<ApiChangeImpact, string> = {
  breaking: "BREAKING",
  addition: "ADDITION",
  note: "NOTE",
};

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** De que lado do contrato a mudança está: inverte quase toda a classificação. */
type Direction = "request" | "response";

interface DiffState {
  changes: ApiChange[];
  left: JsonValue;
  right: JsonValue;
  /** Pares de `$ref` já comparados, para não girar em schema recursivo. */
  seen: Set<string>;
}

const MAX_SCHEMA_DEPTH = 24;

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== undefined && isJsonObject(value) ? value : {};
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function add(state: DiffState, impact: ApiChangeImpact, location: string, pointer: string, message: string): void {
  state.changes.push({ impact, location, pointer, message });
}

/** Resolve `$ref` local dentro do documento a que o schema pertence. */
function resolve(schema: JsonValue, document: JsonValue, depth = 0): JsonValue {
  if (depth > 8 || !isJsonObject(schema)) return schema;
  const reference = text(schema["$ref"]);
  if (reference === undefined || !reference.startsWith("#")) return schema;
  const segments = reference
    .slice(1)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current: JsonValue = document;
  for (const segment of segments) {
    if (!isJsonObject(current)) return schema;
    const next = current[segment];
    if (next === undefined) return schema;
    current = next;
  }
  return resolve(current, document, depth + 1);
}

function requiredNames(schema: Record<string, JsonValue>): Set<string> {
  const declared = schema["required"];
  return new Set(Array.isArray(declared) ? declared.filter((entry): entry is string => typeof entry === "string") : []);
}

function typeOf(schema: Record<string, JsonValue>): string | undefined {
  const declared = schema["type"];
  if (typeof declared === "string") return declared;
  if (Array.isArray(declared)) return declared.filter((entry) => typeof entry === "string").join("|");
  return undefined;
}

function enumOf(schema: Record<string, JsonValue>): string[] | undefined {
  const declared = schema["enum"];
  return Array.isArray(declared) ? declared.map((entry) => JSON.stringify(entry)) : undefined;
}

/**
 * Compara dois schemas equivalentes dos dois documentos.
 *
 * `direction` decide o veredicto: obrigatoriedade nova quebra na requisição,
 * garantia perdida quebra na resposta.
 */
function diffSchema(state: DiffState, before: JsonValue, after: JsonValue, direction: Direction, location: string, pointer: string, field: string, depth = 0): void {
  if (depth > MAX_SCHEMA_DEPTH) return;
  const chave = `${direction}|${pointer}|${field}`;
  if (state.seen.has(chave)) return;
  state.seen.add(chave);

  const left = object(resolve(before, state.left));
  const right = object(resolve(after, state.right));

  const tipoAntes = typeOf(left);
  const tipoDepois = typeOf(right);
  if (tipoAntes !== undefined && tipoDepois !== undefined && tipoAntes !== tipoDepois) {
    add(state, "breaking", location, pointer, `${field}: o tipo mudou de ${tipoAntes} para ${tipoDepois}.`);
  }

  const formatoAntes = text(left["format"]);
  const formatoDepois = text(right["format"]);
  if (formatoAntes !== formatoDepois && (formatoAntes ?? formatoDepois) !== undefined) {
    add(state, "note", location, pointer, `${field}: o format mudou de ${formatoAntes ?? "nenhum"} para ${formatoDepois ?? "nenhum"}.`);
  }

  const enumAntes = enumOf(left);
  const enumDepois = enumOf(right);
  if (enumAntes && enumDepois) {
    const removidos = enumAntes.filter((entry) => !enumDepois.includes(entry));
    const novos = enumDepois.filter((entry) => !enumAntes.includes(entry));
    // Na requisição, tirar um valor recusa o que o cliente já manda. Na
    // resposta, é acrescentar um valor que surpreende quem trata a lista
    // inteira num switch.
    if (removidos.length > 0) {
      add(state, direction === "request" ? "breaking" : "note", location, pointer, `${field}: valor(es) removido(s) do enum: ${removidos.join(", ")}.`);
    }
    if (novos.length > 0) {
      add(state, direction === "response" ? "breaking" : "addition", location, pointer, `${field}: valor(es) novo(s) no enum: ${novos.join(", ")}.`);
    }
  }

  const propriedadesAntes = object(left["properties"]);
  const propriedadesDepois = object(right["properties"]);
  const obrigatoriosAntes = requiredNames(left);
  const obrigatoriosDepois = requiredNames(right);

  for (const nome of Object.keys(propriedadesAntes)) {
    const campo = field === "" ? nome : `${field}.${nome}`;
    if (!Object.hasOwn(propriedadesDepois, nome)) {
      // Some da resposta: o cliente que lê esse campo quebra. Some da
      // requisição: quem ainda envia passa a mandar algo ignorado.
      add(state, direction === "response" ? "breaking" : "note", location, pointer, `${campo}: propriedade removida.`);
      continue;
    }
    diffSchema(state, propriedadesAntes[nome] as JsonValue, propriedadesDepois[nome] as JsonValue, direction, location, pointer, campo, depth + 1);
  }

  for (const nome of Object.keys(propriedadesDepois)) {
    if (Object.hasOwn(propriedadesAntes, nome)) continue;
    const campo = field === "" ? nome : `${field}.${nome}`;
    const novoObrigatorio = obrigatoriosDepois.has(nome);
    if (direction === "request" && novoObrigatorio) {
      add(state, "breaking", location, pointer, `${campo}: propriedade obrigatória nova na requisição.`);
    } else {
      add(state, "addition", location, pointer, `${campo}: propriedade nova${novoObrigatorio ? " e obrigatória" : ""}.`);
    }
  }

  for (const nome of obrigatoriosDepois) {
    if (obrigatoriosAntes.has(nome) || !Object.hasOwn(propriedadesAntes, nome)) continue;
    const campo = field === "" ? nome : `${field}.${nome}`;
    if (direction === "request") add(state, "breaking", location, pointer, `${campo}: passou a ser obrigatório na requisição.`);
    else add(state, "addition", location, pointer, `${campo}: passou a ser sempre devolvido.`);
  }

  for (const nome of obrigatoriosAntes) {
    if (obrigatoriosDepois.has(nome) || !Object.hasOwn(propriedadesDepois, nome)) continue;
    const campo = field === "" ? nome : `${field}.${nome}`;
    if (direction === "response") add(state, "breaking", location, pointer, `${campo}: deixou de ser garantido na resposta.`);
    else add(state, "note", location, pointer, `${campo}: deixou de ser obrigatório na requisição.`);
  }

  const itensAntes = left["items"];
  const itensDepois = right["items"];
  if (itensAntes !== undefined && itensDepois !== undefined) {
    diffSchema(state, itensAntes, itensDepois, direction, location, pointer, `${field}[]`, depth + 1);
  }
}

interface ParameterEntry {
  name: string;
  location: string;
  required: boolean;
  schema: JsonValue;
}

function parametersOf(operation: Record<string, JsonValue>, document: JsonValue): Map<string, ParameterEntry> {
  const entries = new Map<string, ParameterEntry>();
  const declared = operation["parameters"];
  if (!Array.isArray(declared)) return entries;
  for (const raw of declared) {
    const parameter = object(resolve(raw, document));
    const name = text(parameter["name"]);
    const where = text(parameter["in"]) ?? "query";
    if (name === undefined) continue;
    entries.set(`${where}:${name}`, { name, location: where, required: parameter["required"] === true, schema: parameter["schema"] ?? {} });
  }
  return entries;
}

function firstSchema(body: Record<string, JsonValue>): JsonValue | undefined {
  const content = object(body["content"]);
  // `application/json` primeiro; qualquer outro tipo serve como aproximação.
  const preferred = content["application/json"] ?? Object.values(content)[0];
  return preferred === undefined ? undefined : object(preferred)["schema"];
}

function diffOperation(state: DiffState, method: string, route: string, before: Record<string, JsonValue>, after: Record<string, JsonValue>): void {
  const location = `${method.toUpperCase()} ${route}`;
  const pointer = `#/paths/${route}/${method}`;

  const antes = parametersOf(before, state.left);
  const depois = parametersOf(after, state.right);

  for (const [chave, parametro] of depois) {
    const anterior = antes.get(chave);
    if (!anterior) {
      if (parametro.required) add(state, "breaking", location, pointer, `Parâmetro obrigatório novo: ${parametro.name} (${parametro.location}).`);
      else add(state, "addition", location, pointer, `Parâmetro novo: ${parametro.name} (${parametro.location}).`);
      continue;
    }
    if (!anterior.required && parametro.required) {
      add(state, "breaking", location, pointer, `Parâmetro ${parametro.name} passou a ser obrigatório.`);
    }
    if (anterior.required && !parametro.required) {
      add(state, "note", location, pointer, `Parâmetro ${parametro.name} deixou de ser obrigatório.`);
    }
    diffSchema(state, anterior.schema, parametro.schema, "request", location, pointer, `parâmetro ${parametro.name}`);
  }

  for (const [chave, parametro] of antes) {
    if (depois.has(chave)) continue;
    add(state, parametro.required ? "breaking" : "note", location, pointer, `Parâmetro removido: ${parametro.name} (${parametro.location}).`);
  }

  const corpoAntes = object(before["requestBody"] === undefined ? undefined : resolve(before["requestBody"], state.left));
  const corpoDepois = object(after["requestBody"] === undefined ? undefined : resolve(after["requestBody"], state.right));
  const tinhaCorpo = before["requestBody"] !== undefined;
  const temCorpo = after["requestBody"] !== undefined;
  if (!tinhaCorpo && temCorpo && corpoDepois["required"] === true) {
    add(state, "breaking", location, pointer, "A operação passou a exigir corpo na requisição.");
  }
  if (tinhaCorpo && !temCorpo) {
    add(state, "note", location, pointer, "A operação deixou de declarar corpo na requisição.");
  }
  if (tinhaCorpo && temCorpo) {
    if (corpoAntes["required"] !== true && corpoDepois["required"] === true) {
      add(state, "breaking", location, pointer, "O corpo da requisição passou a ser obrigatório.");
    }
    const schemaAntes = firstSchema(corpoAntes);
    const schemaDepois = firstSchema(corpoDepois);
    if (schemaAntes !== undefined && schemaDepois !== undefined) {
      diffSchema(state, schemaAntes, schemaDepois, "request", location, `${pointer}/requestBody`, "");
    }
  }

  const respostasAntes = object(before["responses"]);
  const respostasDepois = object(after["responses"]);
  for (const status of Object.keys(respostasAntes)) {
    if (!Object.hasOwn(respostasDepois, status)) {
      // Só um status de sucesso removido quebra o cliente; um 4xx a menos é
      // informação, não regressão de contrato.
      const sucesso = /^2\d\d$/.test(status) || status === "default";
      add(state, sucesso ? "breaking" : "note", location, `${pointer}/responses/${status}`, `Resposta ${status} removida.`);
      continue;
    }
    const schemaAntes = firstSchema(object(resolve(respostasAntes[status] as JsonValue, state.left)));
    const schemaDepois = firstSchema(object(resolve(respostasDepois[status] as JsonValue, state.right)));
    if (schemaAntes !== undefined && schemaDepois !== undefined) {
      diffSchema(state, schemaAntes, schemaDepois, "response", location, `${pointer}/responses/${status}`, "");
    }
  }
  for (const status of Object.keys(respostasDepois)) {
    if (!Object.hasOwn(respostasAntes, status)) add(state, "addition", location, `${pointer}/responses/${status}`, `Resposta ${status} adicionada.`);
  }

  const segurancaAntes = Array.isArray(before["security"]) ? before["security"].length : undefined;
  const segurancaDepois = Array.isArray(after["security"]) ? after["security"].length : undefined;
  if (segurancaAntes === 0 && segurancaDepois !== undefined && segurancaDepois > 0) {
    add(state, "breaking", location, pointer, "A operação passou a exigir autenticação.");
  }
  if (segurancaAntes === undefined && segurancaDepois !== undefined && segurancaDepois > 0) {
    add(state, "breaking", location, pointer, "A operação passou a declarar exigência de autenticação.");
  }

  if (before["deprecated"] !== true && after["deprecated"] === true) {
    add(state, "note", location, pointer, "A operação foi marcada como deprecated.");
  }
}

export function diffOpenApi(left: JsonValue, right: JsonValue): OpenApiDiffResult {
  if (!isJsonObject(left) || !isJsonObject(right)) throw new Error("Os dois documentos precisam ser objetos OpenAPI.");
  const antesPaths = object(left["paths"]);
  const depoisPaths = object(right["paths"]);
  if (Object.keys(antesPaths).length === 0 && Object.keys(depoisPaths).length === 0) {
    throw new Error("Nenhum dos documentos declara `paths`: confira se é mesmo um contrato OpenAPI.");
  }

  const state: DiffState = { changes: [], left, right, seen: new Set() };

  for (const route of Object.keys(antesPaths)) {
    if (!Object.hasOwn(depoisPaths, route)) {
      add(state, "breaking", route, `#/paths/${route}`, "Caminho removido.");
      continue;
    }
    const antes = object(resolve(antesPaths[route] as JsonValue, left));
    const depois = object(resolve(depoisPaths[route] as JsonValue, right));
    for (const method of METHODS) {
      const tinha = Object.hasOwn(antes, method);
      const tem = Object.hasOwn(depois, method);
      if (tinha && !tem) {
        add(state, "breaking", `${method.toUpperCase()} ${route}`, `#/paths/${route}/${method}`, "Operação removida.");
        continue;
      }
      if (!tinha && tem) {
        add(state, "addition", `${method.toUpperCase()} ${route}`, `#/paths/${route}/${method}`, "Operação adicionada.");
        continue;
      }
      if (tinha && tem) diffOperation(state, method, route, object(antes[method]), object(depois[method]));
    }
  }

  for (const route of Object.keys(depoisPaths)) {
    if (!Object.hasOwn(antesPaths, route)) add(state, "addition", route, `#/paths/${route}`, "Caminho adicionado.");
  }

  const counts: Record<ApiChangeImpact, number> = { breaking: 0, addition: 0, note: 0 };
  for (const change of state.changes) counts[change.impact] += 1;
  // Quebra primeiro: é a informação que decide se a versão sobe ou não.
  const ordem: Record<ApiChangeImpact, number> = { breaking: 0, note: 1, addition: 2 };
  const changes = [...state.changes].sort((a, b) => ordem[a.impact] - ordem[b.impact] || a.location.localeCompare(b.location));

  return {
    changes,
    counts,
    breaking: counts.breaking > 0,
    from: text(object(left["info"])["version"]) ?? "sem versão",
    to: text(object(right["info"])["version"]) ?? "sem versão",
  };
}

/** Relatório em texto puro, para colar numa revisão de PR ou num chamado. */
export function formatOpenApiDiff(result: OpenApiDiffResult): string {
  const cabecalho = [
    `OpenAPI ${result.from} -> ${result.to}`,
    result.breaking ? "RESULTADO: HÁ QUEBRA DE COMPATIBILIDADE" : "RESULTADO: COMPATÍVEL",
    `${result.counts.breaking} breaking · ${result.counts.note} note · ${result.counts.addition} addition`,
    "",
  ];
  if (result.changes.length === 0) return [...cabecalho, "Nenhuma diferença encontrada."].join("\n");
  return [...cabecalho, ...result.changes.map((change) => `[${API_CHANGE_LABELS[change.impact]}] ${change.location}\n  ${change.message}`)].join("\n");
}
