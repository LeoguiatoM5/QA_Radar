/**
 * Validação de payload contra JSON Schema.
 *
 * O que interessa a um QA não é o "válido/inválido" — é **qual regra falhou e
 * em que campo**. Por isso cada violação carrega o caminho da instância
 * (`$.data[0].email`), a palavra-chave que reprovou (`required`, `pattern`) e o
 * caminho dentro do schema, que é o que permite ir direto ao trecho do contrato.
 *
 * Cobre o núcleo do draft 2020-12 e as formas equivalentes dos drafts 7 e
 * anteriores, que é o que aparece em contrato de API real. O que não é
 * suportado é dito em voz alta, em vez de passar em silêncio.
 */

import { isJsonObject, jsonKindOf, type JsonValue } from "./json-value.js";

export interface SchemaViolation {
  /** Caminho do campo reprovado na instância, no formato `$.data[0].email`. */
  instancePath: string;
  /** A palavra-chave do schema que reprovou. */
  keyword: string;
  message: string;
  /** Caminho da regra dentro do schema, no formato `#/properties/data/items`. */
  schemaPath: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  violations: SchemaViolation[];
  /** Palavras-chave presentes no schema que este validador ignora. */
  unsupported: string[];
}

/** Palavras-chave que o validador entende. */
const SUPPORTED = new Set([
  "$ref",
  "$defs",
  "definitions",
  "$id",
  "$schema",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "type",
  "enum",
  "const",
  "required",
  "properties",
  "patternProperties",
  "additionalProperties",
  "minProperties",
  "maxProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "contains",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "nullable",
]);

const MAX_DEPTH = 64;

const FORMATS: Record<string, RegExp> = {
  email: /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  "date-time": /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/,
  ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
  hostname: /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/,
  uri: /^[A-Za-z][A-Za-z0-9+.-]*:\S*$/,
};

const KIND_LABELS: Record<string, string> = {
  string: "texto",
  number: "número",
  integer: "número inteiro",
  boolean: "booleano",
  object: "objeto",
  array: "array",
  null: "nulo",
};

function label(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

const SIMPLE_KEY = /^[A-Za-z_$][\w$]*$/;

function childPath(parent: string, key: string): string {
  return SIMPLE_KEY.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function preview(value: JsonValue): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

interface Context {
  root: JsonValue;
  violations: SchemaViolation[];
  unsupported: Set<string>;
  /** `$ref` em uso na pilha atual, para não entrar em recursão infinita. */
  resolving: Set<string>;
}

/** Resolve um `$ref` local. Referência externa não é buscada de propósito. */
function resolveRef(reference: string, context: Context): JsonValue | undefined {
  if (!reference.startsWith("#")) {
    context.unsupported.add(`$ref externo (${reference})`);
    return undefined;
  }
  const segments = reference
    .slice(1)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment.replaceAll("~1", "/").replaceAll("~0", "~")));
  let current: JsonValue = context.root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const item = current[Number(segment)];
      if (item === undefined) return undefined;
      current = item;
      continue;
    }
    if (!isJsonObject(current)) return undefined;
    const next = current[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

function numberOf(schema: Record<string, JsonValue>, keyword: string): number | undefined {
  const value = schema[keyword];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function typesOf(schema: Record<string, JsonValue>): string[] | undefined {
  const declared = schema["type"];
  if (typeof declared === "string") return [declared];
  if (Array.isArray(declared)) return declared.filter((entry): entry is string => typeof entry === "string");
  return undefined;
}

function matchesType(value: JsonValue, expected: string): boolean {
  const kind = jsonKindOf(value);
  if (expected === "integer") return kind === "number" && Number.isInteger(value);
  if (expected === "number") return kind === "number";
  return kind === expected;
}

function sameValue(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function record(context: Context, instancePath: string, schemaPath: string, keyword: string, message: string): void {
  context.violations.push({ instancePath, keyword, message, schemaPath });
}

/** Valida um ramo isolado, sem sujar a lista principal — usado por anyOf/oneOf/not. */
function branchViolations(schema: JsonValue, value: JsonValue, instancePath: string, schemaPath: string, context: Context, depth: number): SchemaViolation[] {
  const isolated: Context = { root: context.root, violations: [], unsupported: context.unsupported, resolving: context.resolving };
  validateNode(schema, value, instancePath, schemaPath, isolated, depth);
  return isolated.violations;
}

function validateObject(schema: Record<string, JsonValue>, value: Record<string, JsonValue>, instancePath: string, schemaPath: string, context: Context, depth: number): void {
  const required = schema["required"];
  if (Array.isArray(required)) {
    for (const name of required) {
      if (typeof name === "string" && !Object.hasOwn(value, name)) {
        record(context, childPath(instancePath, name), `${schemaPath}/required`, "required", `Campo obrigatório ausente: ${name}.`);
      }
    }
  }

  const declaredProperties = schema["properties"];
  const declaredPatterns = schema["patternProperties"];
  const properties = declaredProperties !== undefined && isJsonObject(declaredProperties) ? declaredProperties : undefined;
  const patternProperties = declaredPatterns !== undefined && isJsonObject(declaredPatterns) ? declaredPatterns : undefined;
  const additional = schema["additionalProperties"];

  for (const [key, entry] of Object.entries(value)) {
    const target = childPath(instancePath, key);
    let covered = false;
    const declared = properties?.[key];
    if (declared !== undefined) {
      covered = true;
      validateNode(declared, entry, target, `${schemaPath}/properties/${key}`, context, depth + 1);
    }
    if (patternProperties) {
      for (const [pattern, subSchema] of Object.entries(patternProperties)) {
        let expression: RegExp;
        try {
          expression = new RegExp(pattern, "u");
        } catch {
          context.unsupported.add(`patternProperties com expressão inválida (${pattern})`);
          continue;
        }
        if (expression.test(key)) {
          covered = true;
          validateNode(subSchema, entry, target, `${schemaPath}/patternProperties/${pattern}`, context, depth + 1);
        }
      }
    }
    if (!covered && additional !== undefined) {
      if (additional === false) {
        record(context, target, `${schemaPath}/additionalProperties`, "additionalProperties", `Propriedade não prevista no schema: ${key}.`);
      } else if (additional !== true) {
        validateNode(additional, entry, target, `${schemaPath}/additionalProperties`, context, depth + 1);
      }
    }
  }

  const keys = Object.keys(value).length;
  const minProperties = numberOf(schema, "minProperties");
  const maxProperties = numberOf(schema, "maxProperties");
  if (minProperties !== undefined && keys < minProperties) {
    record(context, instancePath, `${schemaPath}/minProperties`, "minProperties", `O objeto tem ${keys} propriedade(s); o mínimo é ${minProperties}.`);
  }
  if (maxProperties !== undefined && keys > maxProperties) {
    record(context, instancePath, `${schemaPath}/maxProperties`, "maxProperties", `O objeto tem ${keys} propriedade(s); o máximo é ${maxProperties}.`);
  }
}

function validateArray(schema: Record<string, JsonValue>, value: JsonValue[], instancePath: string, schemaPath: string, context: Context, depth: number): void {
  const prefixItems = Array.isArray(schema["prefixItems"]) ? schema["prefixItems"] : Array.isArray(schema["items"]) ? schema["items"] : undefined;
  const items = Array.isArray(schema["items"]) ? undefined : schema["items"];

  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index] as JsonValue;
    const target = `${instancePath}[${index}]`;
    const tuple = prefixItems?.[index];
    if (tuple !== undefined) {
      validateNode(tuple, entry, target, `${schemaPath}/prefixItems/${index}`, context, depth + 1);
      continue;
    }
    if (items !== undefined && items !== true) {
      if (items === false) record(context, target, `${schemaPath}/items`, "items", "O schema não permite itens além dos declarados.");
      else validateNode(items, entry, target, `${schemaPath}/items`, context, depth + 1);
    }
  }

  const minItems = numberOf(schema, "minItems");
  const maxItems = numberOf(schema, "maxItems");
  if (minItems !== undefined && value.length < minItems) {
    record(context, instancePath, `${schemaPath}/minItems`, "minItems", `O array tem ${value.length} item(ns); o mínimo é ${minItems}.`);
  }
  if (maxItems !== undefined && value.length > maxItems) {
    record(context, instancePath, `${schemaPath}/maxItems`, "maxItems", `O array tem ${value.length} item(ns); o máximo é ${maxItems}.`);
  }
  if (schema["uniqueItems"] === true) {
    const seen = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
      const key = JSON.stringify(value[index]);
      if (seen.has(key)) record(context, `${instancePath}[${index}]`, `${schemaPath}/uniqueItems`, "uniqueItems", "Item repetido num array que exige valores únicos.");
      seen.add(key);
    }
  }
  const contains = schema["contains"];
  if (contains !== undefined && !value.some((entry, index) => branchViolations(contains, entry, `${instancePath}[${index}]`, `${schemaPath}/contains`, context, depth + 1).length === 0)) {
    record(context, instancePath, `${schemaPath}/contains`, "contains", "Nenhum item do array atende ao schema de `contains`.");
  }
}

function validateString(schema: Record<string, JsonValue>, value: string, instancePath: string, schemaPath: string, context: Context): void {
  // O tamanho conta pontos de código, não unidades UTF-16: emoji e acento
  // decomposto contariam duas vezes com `.length`.
  const length = [...value].length;
  const minLength = numberOf(schema, "minLength");
  const maxLength = numberOf(schema, "maxLength");
  if (minLength !== undefined && length < minLength) {
    record(context, instancePath, `${schemaPath}/minLength`, "minLength", `O texto tem ${length} caractere(s); o mínimo é ${minLength}.`);
  }
  if (maxLength !== undefined && length > maxLength) {
    record(context, instancePath, `${schemaPath}/maxLength`, "maxLength", `O texto tem ${length} caractere(s); o máximo é ${maxLength}.`);
  }
  const pattern = schema["pattern"];
  if (typeof pattern === "string") {
    try {
      if (!new RegExp(pattern, "u").test(value)) record(context, instancePath, `${schemaPath}/pattern`, "pattern", `O texto não casa com o padrão ${pattern}.`);
    } catch {
      context.unsupported.add(`pattern com expressão inválida (${pattern})`);
    }
  }
  const format = schema["format"];
  if (typeof format === "string") {
    const expression = FORMATS[format];
    if (expression === undefined) context.unsupported.add(`format "${format}"`);
    else if (!expression.test(value)) record(context, instancePath, `${schemaPath}/format`, "format", `O texto não está no formato ${format}.`);
  }
}

function validateNumber(schema: Record<string, JsonValue>, value: number, instancePath: string, schemaPath: string, context: Context): void {
  const minimum = numberOf(schema, "minimum");
  const maximum = numberOf(schema, "maximum");
  const exclusiveMinimum = numberOf(schema, "exclusiveMinimum");
  const exclusiveMaximum = numberOf(schema, "exclusiveMaximum");
  const multipleOf = numberOf(schema, "multipleOf");
  if (minimum !== undefined && value < minimum) record(context, instancePath, `${schemaPath}/minimum`, "minimum", `O valor ${value} é menor que o mínimo ${minimum}.`);
  if (maximum !== undefined && value > maximum) record(context, instancePath, `${schemaPath}/maximum`, "maximum", `O valor ${value} é maior que o máximo ${maximum}.`);
  if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
    record(context, instancePath, `${schemaPath}/exclusiveMinimum`, "exclusiveMinimum", `O valor ${value} precisa ser maior que ${exclusiveMinimum}.`);
  }
  if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
    record(context, instancePath, `${schemaPath}/exclusiveMaximum`, "exclusiveMaximum", `O valor ${value} precisa ser menor que ${exclusiveMaximum}.`);
  }
  if (multipleOf !== undefined && multipleOf > 0) {
    const division = value / multipleOf;
    if (Math.abs(division - Math.round(division)) > 1e-9) record(context, instancePath, `${schemaPath}/multipleOf`, "multipleOf", `O valor ${value} não é múltiplo de ${multipleOf}.`);
  }
}

function validateCombinators(schema: Record<string, JsonValue>, value: JsonValue, instancePath: string, schemaPath: string, context: Context, depth: number): void {
  const allOf = schema["allOf"];
  if (Array.isArray(allOf)) {
    allOf.forEach((entry, index) => validateNode(entry, value, instancePath, `${schemaPath}/allOf/${index}`, context, depth + 1));
  }

  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const falhas = anyOf.map((entry, index) => branchViolations(entry, value, instancePath, `${schemaPath}/anyOf/${index}`, context, depth + 1));
    if (falhas.every((entry) => entry.length > 0)) {
      record(context, instancePath, `${schemaPath}/anyOf`, "anyOf", `O valor ${preview(value)} não atende a nenhuma das ${anyOf.length} alternativas de anyOf.`);
    }
  }

  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf) && oneOf.length > 0) {
    const aprovadas = oneOf.filter((entry, index) => branchViolations(entry, value, instancePath, `${schemaPath}/oneOf/${index}`, context, depth + 1).length === 0).length;
    if (aprovadas !== 1) {
      record(context, instancePath, `${schemaPath}/oneOf`, "oneOf", `oneOf exige exatamente uma alternativa válida; ${aprovadas} foram atendidas.`);
    }
  }

  const not = schema["not"];
  if (not !== undefined && branchViolations(not, value, instancePath, `${schemaPath}/not`, context, depth + 1).length === 0) {
    record(context, instancePath, `${schemaPath}/not`, "not", "O valor atende ao schema de `not`, e por isso é recusado.");
  }
}

function validateNode(schema: JsonValue, value: JsonValue, instancePath: string, schemaPath: string, context: Context, depth: number): void {
  if (depth > MAX_DEPTH) {
    context.unsupported.add("schema com profundidade acima do limite suportado");
    return;
  }
  // `true` aceita qualquer coisa e `false` recusa tudo — as duas formas curtas
  // que o draft admite no lugar de um objeto.
  if (schema === true) return;
  if (schema === false) {
    record(context, instancePath, schemaPath, "false", "O schema recusa qualquer valor nesta posição.");
    return;
  }
  if (!isJsonObject(schema)) {
    context.unsupported.add("schema que não é objeto nem booleano");
    return;
  }

  const reference = schema["$ref"];
  if (typeof reference === "string") {
    if (context.resolving.has(reference)) return;
    const resolved = resolveRef(reference, context);
    if (resolved === undefined) {
      context.unsupported.add(`$ref não encontrado (${reference})`);
      return;
    }
    context.resolving.add(reference);
    validateNode(resolved, value, instancePath, `${schemaPath}/$ref`, context, depth + 1);
    context.resolving.delete(reference);
    return;
  }

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED.has(keyword)) context.unsupported.add(keyword);
  }

  // `nullable: true` é do OpenAPI 3.0, não do JSON Schema, mas aparece o tempo
  // todo em contrato real e ignorá-lo produziria falso positivo em massa.
  if (schema["nullable"] === true && value === null) return;

  const types = typesOf(schema);
  if (types !== undefined && !types.some((expected) => matchesType(value, expected))) {
    record(context, instancePath, `${schemaPath}/type`, "type", `Esperado ${types.map(label).join(" ou ")}, recebido ${label(jsonKindOf(value))}.`);
    return;
  }

  const enumeration = schema["enum"];
  if (Array.isArray(enumeration) && !enumeration.some((entry) => sameValue(entry, value))) {
    record(context, instancePath, `${schemaPath}/enum`, "enum", `O valor ${preview(value)} não está entre os aceitos: ${enumeration.map((entry) => preview(entry)).join(", ")}.`);
  }
  if (Object.hasOwn(schema, "const") && !sameValue(schema["const"] as JsonValue, value)) {
    record(context, instancePath, `${schemaPath}/const`, "const", `O valor precisa ser exatamente ${preview(schema["const"] as JsonValue)}.`);
  }

  if (isJsonObject(value)) validateObject(schema, value, instancePath, schemaPath, context, depth);
  else if (Array.isArray(value)) validateArray(schema, value, instancePath, schemaPath, context, depth);
  else if (typeof value === "string") validateString(schema, value, instancePath, schemaPath, context);
  else if (typeof value === "number") validateNumber(schema, value, instancePath, schemaPath, context);

  validateCombinators(schema, value, instancePath, schemaPath, context, depth);
}

export function validateJsonSchema(schema: JsonValue, instance: JsonValue): SchemaValidationResult {
  const context: Context = { root: schema, violations: [], unsupported: new Set(), resolving: new Set() };
  validateNode(schema, instance, "$", "#", context, 0);
  return { valid: context.violations.length === 0, violations: context.violations, unsupported: [...context.unsupported].sort() };
}

/** Texto do resultado, pronto para colar num chamado. */
export function formatSchemaValidation(result: SchemaValidationResult): string {
  if (result.valid) return "O payload atende ao schema.";
  const linhas = result.violations.map((violation) => `${violation.instancePath}\n  ${violation.keyword}: ${violation.message}\n  schema: ${violation.schemaPath}`);
  return [`${result.violations.length} violação(ões):`, "", ...linhas].join("\n");
}
