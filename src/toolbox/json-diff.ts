import { isJsonObject, jsonKindOf, type JsonKind, type JsonValue } from "./json-value.js";

/**
 * Natureza da diferença.
 *
 * `type_changed` é separado de `changed` de propósito: `"5000"` virar `5000` não
 * é a mesma classe de problema que `5000` virar `3000`, e quem lê um diff de
 * contrato precisa distinguir as duas de relance.
 */
export type JsonDiffKind = "added" | "removed" | "changed" | "type_changed";

export interface JsonDiffEntry {
  /** Caminho canônico, no formato `$.data[0].limit`. */
  path: string;
  kind: JsonDiffKind;
  before: JsonValue | undefined;
  after: JsonValue | undefined;
  beforeKind: JsonKind | "absent";
  afterKind: JsonKind | "absent";
}

export interface JsonDiffResult {
  entries: JsonDiffEntry[];
  equal: boolean;
  /** Caminhos que existiam em algum dos lados e foram descartados pelas regras. */
  ignored: string[];
  counts: Record<JsonDiffKind, number>;
}

export interface JsonDiffOptions {
  /**
   * Regras de campos dinâmicos.
   *
   * Três formas, da mais frouxa para a mais precisa:
   * - `requestId` — qualquer propriedade com esse nome, em qualquer profundidade;
   * - `metadata.timestamp` — esse caminho, na raiz ou aninhado em qualquer lugar;
   * - `data[*].requestId` — o mesmo, com `[*]` cobrindo qualquer índice.
   */
  ignore?: readonly string[];
}

const ROOT_PATH = "$";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Traduz uma regra de ignorar em um teste sobre o caminho canônico.
 *
 * Regra sem ponto e sem colchete casa pelo nome da última propriedade — é o que
 * a pessoa quer dizer ao escrever `id`. As demais viram uma expressão ancorada
 * no fim do caminho, para que `metadata.timestamp` funcione tanto na raiz quanto
 * dentro de qualquer objeto.
 */
function ruleMatcher(rule: string): (path: string, key: string | undefined) => boolean {
  const trimmed = rule.trim();
  if (!trimmed) return () => false;
  const withoutRoot = trimmed.replace(/^\$\.?/, "");
  if (!withoutRoot) return () => false;
  if (!/[.[]/.test(withoutRoot)) {
    const target = withoutRoot;
    return (_path, key) => key === target;
  }
  const pattern = withoutRoot
    .split(/(\[\*\]|\[\d+\])/)
    .map((part) => (part === "[*]" ? "\\[\\d+\\]" : escapeRegExp(part)))
    .join("");
  const expression = new RegExp(`(^|\\.)${pattern}$`);
  return (path) => expression.test(path.replace(/^\$\./, ""));
}

function createIgnoreMatcher(rules: readonly string[]): (path: string, key: string | undefined) => boolean {
  const matchers = rules.map(ruleMatcher);
  if (matchers.length === 0) return () => false;
  return (path, key) => matchers.some((matches) => matches(path, key));
}

/** Chave que pode ser escrita depois de um ponto sem virar outra coisa. */
const SIMPLE_KEY = /^[A-Za-z_$][\w$]*$/;

/**
 * Caminho da propriedade.
 *
 * Chave com ponto ou colchete no nome sai entre aspas: `{"a.b": 1}` e
 * `{"a": {"b": 1}}` produziriam o mesmo `$.a.b`, e quem lê o diff não teria
 * como saber qual dos dois mudou.
 */
function childPath(parent: string, key: string): string {
  return SIMPLE_KEY.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function indexPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

/** Igualdade estrutural, usada só para folhas. */
function sameValue(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface DiffState {
  entries: JsonDiffEntry[];
  ignored: string[];
  isIgnored: (path: string, key: string | undefined) => boolean;
}

function walk(state: DiffState, path: string, left: JsonValue, right: JsonValue): void {
  const leftKind = jsonKindOf(left);
  const rightKind = jsonKindOf(right);

  if (leftKind !== rightKind) {
    state.entries.push({ path, kind: "type_changed", before: left, after: right, beforeKind: leftKind, afterKind: rightKind });
    return;
  }

  if (isJsonObject(left) && isJsonObject(right)) {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])]) {
      const target = childPath(path, key);
      if (state.isIgnored(target, key)) {
        state.ignored.push(target);
        continue;
      }
      const inLeft = Object.hasOwn(left, key);
      const inRight = Object.hasOwn(right, key);
      const before = left[key];
      const after = right[key];
      if (inLeft && !inRight && before !== undefined) {
        state.entries.push({ path: target, kind: "removed", before, after: undefined, beforeKind: jsonKindOf(before), afterKind: "absent" });
        continue;
      }
      if (!inLeft && inRight && after !== undefined) {
        state.entries.push({ path: target, kind: "added", before: undefined, after, beforeKind: "absent", afterKind: jsonKindOf(after) });
        continue;
      }
      if (before !== undefined && after !== undefined) walk(state, target, before, after);
    }
    return;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const target = indexPath(path, index);
      if (state.isIgnored(target, undefined)) {
        state.ignored.push(target);
        continue;
      }
      const before = left[index];
      const after = right[index];
      if (before !== undefined && after === undefined) {
        state.entries.push({ path: target, kind: "removed", before, after: undefined, beforeKind: jsonKindOf(before), afterKind: "absent" });
        continue;
      }
      if (before === undefined && after !== undefined) {
        state.entries.push({ path: target, kind: "added", before: undefined, after, beforeKind: "absent", afterKind: jsonKindOf(after) });
        continue;
      }
      if (before !== undefined && after !== undefined) walk(state, target, before, after);
    }
    return;
  }

  if (!sameValue(left, right)) {
    state.entries.push({ path, kind: "changed", before: left, after: right, beforeKind: leftKind, afterKind: rightKind });
  }
}

export function diffJson(left: JsonValue, right: JsonValue, options: JsonDiffOptions = {}): JsonDiffResult {
  const isIgnored = createIgnoreMatcher(options.ignore ?? []);
  const state: DiffState = { entries: [], ignored: [], isIgnored };
  walk(state, ROOT_PATH, left, right);
  const counts: Record<JsonDiffKind, number> = { added: 0, removed: 0, changed: 0, type_changed: 0 };
  for (const entry of state.entries) counts[entry.kind] += 1;
  return { entries: state.entries, equal: state.entries.length === 0, ignored: [...new Set(state.ignored)], counts };
}

/** Rótulo curto e estável de cada tipo de diferença, usado na interface e no export. */
export const JSON_DIFF_LABELS: Record<JsonDiffKind, string> = {
  added: "ADDED",
  removed: "REMOVED",
  changed: "CHANGED",
  type_changed: "TYPE_CHANGED",
};

function preview(value: JsonValue | undefined): string {
  return value === undefined ? "—" : JSON.stringify(value);
}

/** Texto do resultado, pronto para colar em um chamado ou numa conversa. */
export function formatJsonDiff(result: JsonDiffResult): string {
  if (result.equal) return "Os dois JSON são equivalentes.";
  const lines = result.entries.map((entry) => {
    if (entry.kind === "added") return `${JSON_DIFF_LABELS[entry.kind]} ${entry.path}\n  + ${preview(entry.after)}`;
    if (entry.kind === "removed") return `${JSON_DIFF_LABELS[entry.kind]} ${entry.path}\n  - ${preview(entry.before)}`;
    return `${JSON_DIFF_LABELS[entry.kind]} ${entry.path}\n  ${preview(entry.before)}\n  -> ${preview(entry.after)}`;
  });
  const summary = `${result.entries.length} diferença(s): ${result.counts.added} adicionada(s), ${result.counts.removed} removida(s), ${result.counts.changed} alterada(s), ${result.counts.type_changed} com mudança de tipo.`;
  return `${summary}\n\n${lines.join("\n\n")}`;
}

/** Reindenta a entrada mantendo o conteúdo; usado pelo botão "Formatar". */
export function formatJsonText(text: string, label: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(JSON.parse(trimmed) as JsonValue, null, 2);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: JSON inválido. ${detail}`);
  }
}
