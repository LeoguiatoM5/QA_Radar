/**
 * Teste de expressão regular.
 *
 * Além de casar ou não, mostra **onde** casou, o que caiu em cada grupo e quais
 * linhas do texto foram atingidas — que é a pergunta real de quem está montando
 * uma validação de campo ou um filtro de log.
 */

export interface RegexGroup {
  name: string;
  value: string | undefined;
}

export interface RegexMatchResult {
  /** Posição do início do casamento no texto. */
  index: number;
  value: string;
  groups: RegexGroup[];
  /** Linha (1-based) onde o casamento começa. */
  line: number;
}

export interface RegexLineResult {
  number: number;
  text: string;
  matched: boolean;
}

export interface RegexTestResult {
  matches: RegexMatchResult[];
  lines: RegexLineResult[];
  /** Atingiu o teto de casamentos e parou de procurar. */
  truncated: boolean;
  warnings: string[];
}

export const REGEX_FLAGS = "dgimsuvy";
export const MAX_REGEX_SUBJECT_BYTES = 200_000;
export const MAX_REGEX_MATCHES = 500;

/**
 * Compila o padrão traduzindo o erro do motor para uma mensagem utilizável.
 *
 * `g` é acrescentado quando falta: sem ele só o primeiro casamento apareceria, e
 * quem está testando um padrão quer ver todos.
 */
export function compileRegex(pattern: string, flags: string): RegExp {
  if (pattern === "") throw new Error("Informe a expressão regular.");
  const unique = [...new Set(flags.replace(/\s/g, "").split(""))];
  const invalid = unique.filter((flag) => !REGEX_FLAGS.includes(flag));
  if (invalid.length > 0) throw new Error(`Flag não suportada: ${invalid.join(", ")}. Use apenas ${REGEX_FLAGS.split("").join(", ")}.`);
  if (!unique.includes("g")) unique.push("g");
  try {
    return new RegExp(pattern, unique.join(""));
  } catch (error) {
    throw new Error(`Expressão inválida: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function lineOf(subject: string, index: number): number {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (subject[position] === "\n") line += 1;
  }
  return line;
}

function groupsOf(match: RegExpExecArray): RegexGroup[] {
  const numbered: RegexGroup[] = match.slice(1).map((value, position) => ({ name: String(position + 1), value }));
  const named: RegexGroup[] = Object.entries(match.groups ?? {}).map(([name, value]) => ({ name, value }));
  return [...numbered, ...named];
}

export function testRegex(pattern: string, flags: string, subject: string): RegexTestResult {
  if (subject.length > MAX_REGEX_SUBJECT_BYTES) throw new Error(`O texto de teste passa de ${MAX_REGEX_SUBJECT_BYTES.toLocaleString("pt-BR")} caracteres.`);
  const expression = compileRegex(pattern, flags);
  const warnings: string[] = [];
  // Um padrão que casa vazio avança sozinho um caractere por vez; sem o aviso,
  // a pessoa vê centenas de casamentos vazios e acha que o teste está quebrado.
  const matches: RegexMatchResult[] = [];
  let truncated = false;
  let guard = 0;

  for (let found = expression.exec(subject); found !== null; found = expression.exec(subject)) {
    if (matches.length >= MAX_REGEX_MATCHES) {
      truncated = true;
      break;
    }
    matches.push({ index: found.index, value: found[0], groups: groupsOf(found), line: lineOf(subject, found.index) });
    if (found[0] === "") {
      expression.lastIndex += 1;
      guard += 1;
    }
    if (guard > MAX_REGEX_MATCHES) {
      truncated = true;
      break;
    }
  }

  if (matches.some((match) => match.value === "")) warnings.push("A expressão casa com texto vazio: cada posição vira um casamento.");
  if (truncated) warnings.push(`Foram listados os primeiros ${MAX_REGEX_MATCHES} casamentos.`);

  const matchedLines = new Set(matches.map((match) => match.line));
  const lines = subject.split("\n").map((text, position) => ({ number: position + 1, text, matched: matchedLines.has(position + 1) }));

  return { matches, lines, truncated, warnings };
}

/** Resumo de uma linha, para colar num chamado ou numa revisão. */
export function formatRegexResult(result: RegexTestResult): string {
  if (result.matches.length === 0) return "Nenhum casamento.";
  const linhas = result.matches.map((match) => {
    const grupos = match.groups
      .filter((group) => group.value !== undefined)
      .map((group) => `${group.name}=${group.value ?? ""}`)
      .join(", ");
    return `linha ${match.line}, posição ${match.index}: ${match.value}${grupos ? ` [${grupos}]` : ""}`;
  });
  return [`${result.matches.length} casamento(s) em ${new Set(result.matches.map((match) => match.line)).size} linha(s):`, ...linhas].join("\n");
}
