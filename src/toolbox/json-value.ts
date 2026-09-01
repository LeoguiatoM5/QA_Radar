/** Valor JSON, do jeito que ele chega de um `JSON.parse`. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonKind = "string" | "number" | "boolean" | "null" | "array" | "object";

export function jsonKindOf(value: JsonValue): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return type;
  return "object";
}

export function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return jsonKindOf(value) === "object";
}

/**
 * Interpreta a entrada do usuário e devolve uma mensagem de erro em português.
 *
 * `JSON.parse` lança um `SyntaxError` cuja mensagem varia entre navegadores e
 * versões do Node; a interface precisa de um texto estável e legível.
 */
export function parseJsonInput(text: string, label: string): JsonValue {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${label}: informe um JSON.`);
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: JSON inválido. ${detail}`);
  }
}
