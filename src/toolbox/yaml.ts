/**
 * Leitor de um subconjunto de YAML.
 *
 * Existe por um motivo só: contrato OpenAPI quase nunca vem em JSON. Um
 * comparador que só aceitasse JSON obrigaria a pessoa a converter o arquivo
 * antes — o que ela faria em outro site, justamente o hábito que o Toolbox
 * quer evitar.
 *
 * Cobre o que um OpenAPI usa: mapeamentos e sequências por indentação, coleções
 * em linha (`{}` e `[]`), escalares simples e entre aspas, blocos `|` e `>`,
 * comentários e os tipos escalares do YAML 1.2 core. O que **não** cobre —
 * âncoras, aliases, tags, múltiplos documentos, chaves complexas — falha com
 * mensagem explícita, em vez de devolver um documento pela metade.
 */

import type { JsonValue } from "./json-value.js";

export const YAML_UNSUPPORTED = "Este leitor cobre o YAML usado em contratos OpenAPI. Âncoras, aliases, tags e múltiplos documentos não são suportados.";

interface Line {
  indent: number;
  content: string;
  number: number;
}

function fail(message: string, line?: number): never {
  throw new Error(line === undefined ? message : `Linha ${line}: ${message}`);
}

/** Remove comentário fora de aspas. */
function stripComment(raw: string): string {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (char === "\\" && quote === '"') index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    // Só é comentário quando o `#` começa a linha ou vem depois de espaço.
    if (char === "#" && (index === 0 || /\s/.test(raw[index - 1] as string))) return raw.slice(0, index);
  }
  return raw;
}

function scalar(raw: string, lineNumber: number): JsonValue {
  const text = raw.trim();
  if (text === "" || text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
  if (text === "true" || text === "True" || text === "TRUE") return true;
  if (text === "false" || text === "False" || text === "FALSE") return false;
  if (text.startsWith("&") || text.startsWith("*") || text.startsWith("!")) fail(YAML_UNSUPPORTED, lineNumber);
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) fail("aspas duplas não fechadas.", lineNumber);
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      fail("texto entre aspas duplas inválido.", lineNumber);
    }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) fail("aspas simples não fechadas.", lineNumber);
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return Number(text);
  if (/^0[xX][0-9a-fA-F]+$/.test(text)) return Number.parseInt(text, 16);
  return text;
}

/** Divide uma coleção em linha respeitando aspas e aninhamento. */
function splitFlow(body: string, lineNumber: number): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] as string;
    if (quote) {
      current += char;
      if (char === "\\" && quote === '"') {
        current += body[index + 1] ?? "";
        index += 1;
      } else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) fail("aspas não fechadas numa coleção em linha.", lineNumber);
  if (current.trim() !== "") parts.push(current);
  return parts;
}

/** Separa `chave: valor` no primeiro `:` que não está entre aspas nem dentro de `{}`/`[]`. */
function splitKey(content: string): { key: string; rest: string } | undefined {
  let depth = 0;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index] as string;
    if (quote) {
      if (char === "\\" && quote === '"') index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth -= 1;
    if (char === ":" && depth === 0) {
      const next = content[index + 1];
      if (next === undefined || /\s/.test(next)) return { key: content.slice(0, index), rest: content.slice(index + 1) };
    }
  }
  return undefined;
}

function parseFlow(text: string, lineNumber: number): JsonValue {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    if (!trimmed.endsWith("]")) fail("sequência em linha não fechada.", lineNumber);
    const body = trimmed.slice(1, -1).trim();
    return body === "" ? [] : splitFlow(body, lineNumber).map((entry) => parseValue(entry, lineNumber));
  }
  if (!trimmed.endsWith("}")) fail("mapeamento em linha não fechado.", lineNumber);
  const body = trimmed.slice(1, -1).trim();
  const result: Record<string, JsonValue> = {};
  if (body === "") return result;
  for (const entry of splitFlow(body, lineNumber)) {
    const split = splitKey(entry.trim());
    if (!split) fail("entrada sem `chave: valor` num mapeamento em linha.", lineNumber);
    result[String(scalar(split.key, lineNumber))] = parseValue(split.rest, lineNumber);
  }
  return result;
}

function parseValue(text: string, lineNumber: number): JsonValue {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return parseFlow(trimmed, lineNumber);
  return scalar(trimmed, lineNumber);
}

interface Cursor {
  index: number;
}

/** Lê um bloco `|` ou `>` a partir da indentação do pai. */
function readBlockScalar(marker: string, lines: Line[], cursor: Cursor, parentIndent: number): string {
  const fold = marker.startsWith(">");
  const chomp = marker.includes("-") ? "strip" : marker.includes("+") ? "keep" : "clip";
  const collected: string[] = [];
  let blockIndent: number | undefined;
  while (cursor.index < lines.length) {
    const line = lines[cursor.index] as Line;
    if (line.content !== "" && line.indent <= parentIndent) break;
    if (blockIndent === undefined && line.content !== "") blockIndent = line.indent;
    collected.push(line.content === "" ? "" : " ".repeat(Math.max(0, line.indent - (blockIndent ?? line.indent))) + line.content);
    cursor.index += 1;
  }
  let text = fold ? collected.reduce((acc, entry, index) => (index === 0 ? entry : entry === "" || acc.endsWith("\n") ? `${acc}\n${entry}` : `${acc} ${entry}`), "") : collected.join("\n");
  if (chomp === "strip") text = text.replace(/\n+$/, "");
  else if (chomp === "clip") text = `${text.replace(/\n+$/, "")}\n`;
  return text;
}

function parseBlock(lines: Line[], cursor: Cursor, indent: number): JsonValue {
  const first = lines[cursor.index];
  if (first === undefined) return null;

  if (first.content.startsWith("- ") || first.content === "-") {
    const sequence: JsonValue[] = [];
    while (cursor.index < lines.length) {
      const line = lines[cursor.index] as Line;
      if (line.indent !== indent || (!line.content.startsWith("- ") && line.content !== "-")) break;
      const inline = line.content === "-" ? "" : line.content.slice(2).trim();
      cursor.index += 1;
      if (inline === "") {
        sequence.push(parseChildren(lines, cursor, indent));
        continue;
      }
      const split = splitKey(inline);
      if (split) {
        // `- chave: valor` abre um mapeamento cujo conteúdo se alinha logo
        // depois do traço.
        const innerIndent = indent + 2;
        const injected: Line = { indent: innerIndent, content: inline, number: line.number };
        lines.splice(cursor.index, 0, injected);
        sequence.push(parseBlock(lines, cursor, innerIndent));
        continue;
      }
      const marker = /^[|>][+-]?$/.exec(inline);
      sequence.push(marker ? readBlockScalar(inline, lines, cursor, indent) : parseValue(inline, line.number));
    }
    return sequence;
  }

  const mapping: Record<string, JsonValue> = {};
  while (cursor.index < lines.length) {
    const line = lines[cursor.index] as Line;
    if (line.indent !== indent) break;
    const split = splitKey(line.content);
    if (!split) {
      if (line.content.startsWith("- ")) break;
      fail("esperava `chave: valor`.", line.number);
    }
    const key = String(scalar(split.key, line.number));
    const rest = split.rest.trim();
    cursor.index += 1;
    if (rest === "") {
      mapping[key] = parseChildren(lines, cursor, indent);
      continue;
    }
    if (/^[|>][+-]?$/.test(rest)) {
      mapping[key] = readBlockScalar(rest, lines, cursor, indent);
      continue;
    }
    mapping[key] = parseValue(rest, line.number);
  }
  return mapping;
}

/** Conteúdo indentado abaixo da linha atual; `null` quando não há nenhum. */
function parseChildren(lines: Line[], cursor: Cursor, parentIndent: number): JsonValue {
  const next = lines[cursor.index];
  if (next === undefined) return null;
  // Uma sequência pode ficar na mesma coluna da chave que a contém — é como o
  // OpenAPI escreve `tags:` seguido de `- nome`.
  if (next.indent === parentIndent && (next.content.startsWith("- ") || next.content === "-")) return parseBlock(lines, cursor, parentIndent);
  if (next.indent <= parentIndent) return null;
  return parseBlock(lines, cursor, next.indent);
}

/** Interpreta YAML ou JSON e devolve o documento. */
export function parseYaml(source: string): JsonValue {
  const trimmed = source.trim();
  if (trimmed === "") throw new Error("O documento está vazio.");
  // JSON é YAML válido, e reconhecê-lo primeiro evita passar por este leitor.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as JsonValue;
    } catch (error) {
      throw new Error(`JSON inválido. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const lines: Line[] = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    if (raw.includes("\t")) fail("YAML não aceita tabulação na indentação.", index + 1);
    const withoutComment = stripComment(raw);
    const content = withoutComment.trim();
    if (content === "---") return;
    if (content === "...") return;
    lines.push({ indent: withoutComment.length - withoutComment.trimStart().length, content, number: index + 1 });
  });

  // Linhas vazias no fim atrapalham a leitura de blocos; no meio, elas são
  // significativas e ficam.
  while (lines.length > 0 && (lines[lines.length - 1] as Line).content === "") lines.pop();
  const meaningful = lines.filter((line) => line.content !== "");
  if (meaningful.length === 0) throw new Error("O documento está vazio.");

  const cursor: Cursor = { index: 0 };
  const useful = lines.filter((line) => line.content !== "" || false);
  const document = parseBlock(useful, cursor, (useful[0] as Line).indent);
  if (cursor.index < useful.length) {
    const line = useful[cursor.index] as Line;
    fail("indentação inesperada.", line.number);
  }
  return document;
}
