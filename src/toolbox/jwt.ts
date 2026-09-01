/**
 * Inspeção de JWT.
 *
 * Decodificação, e **só** decodificação. Um JWT decodificado não é um JWT
 * verificado: sem a chave do emissor não há como afirmar que a assinatura
 * confere, e uma ferramenta que embaralha as duas coisas ensina o time a
 * confiar num token forjado. Por isso `signatureVerified` é sempre `false` e o
 * status nunca diz "válido" sozinho — diz "estrutura válida".
 *
 * Nada neste módulo escreve o token em log, histórico ou telemetria.
 */

import type { JsonValue } from "./json-value.js";

export type JwtStatus = "invalid" | "valid_structure" | "expired" | "not_active_yet";

export interface JwtTimestamps {
  /** `iat`, em milissegundos. */
  issuedAt: number | undefined;
  /** `exp`, em milissegundos. */
  expiresAt: number | undefined;
  /** `nbf`, em milissegundos. */
  notBefore: number | undefined;
}

export interface JwtInspection {
  /** A estrutura foi decodificada: três partes, header e payload em JSON. */
  decoded: boolean;
  status: JwtStatus;
  error: string | undefined;
  header: JsonValue | undefined;
  payload: JsonValue | undefined;
  timestamps: JwtTimestamps;
  /** Quanto falta para expirar; negativo quando já expirou. */
  timeRemainingMs: number | undefined;
  /**
   * Desvios do RFC 7519 que o token foi lido apesar de ter.
   *
   * Vazio na esmagadora maioria dos tokens. Quando não está, é aqui que mora a
   * explicação de por que a expiração parece estranha.
   */
  warnings: string[];
  algorithm: string | undefined;
  /** A terceira parte existe e não está vazia. */
  signaturePresent: boolean;
  /**
   * Sempre `false`. O campo existe para que a interface possa afirmar, na cara
   * do usuário, que a assinatura **não** foi verificada.
   */
  signatureVerified: false;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Decodifica base64url para texto UTF-8 sem depender de `Buffer`. */
export function decodeBase64Url(segment: string): string {
  if (!BASE64URL.test(segment)) throw new Error("Segmento fora do alfabeto base64url.");
  const padded = segment
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(segment.length + ((4 - (segment.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function parseSegment(segment: string, label: string): JsonValue {
  let text: string;
  try {
    text = decodeBase64Url(segment);
  } catch {
    throw new Error(`O ${label} não está em base64url.`);
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    throw new Error(`O ${label} não contém um JSON válido.`);
  }
}

/**
 * Lê `iat`, `exp` ou `nbf`.
 *
 * O RFC 7519 exige NumericDate — um número. Emissor que serializa como texto
 * existe, e simplesmente ignorar o claim faria a ferramenta anunciar "o token
 * não declara expiração" para um token expirado. Aqui o valor é aproveitado e o
 * desvio é registrado, para que a tela possa dizer as duas coisas.
 */
function numericClaim(payload: JsonValue | undefined, claim: string, warnings: string[]): number | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = payload[claim];
  // As datas do JWT são segundos desde a epoch (RFC 7519), não milissegundos.
  if (typeof value === "number" && Number.isFinite(value)) {
    // Um emissor que confunde segundos com milissegundos joga a expiração para
    // o ano 58000; sem o aviso, a tela mostra a data absurda sem explicação.
    if (Math.abs(value) > 100_000_000_000) warnings.push(`O claim ${claim} parece estar em milissegundos: o RFC 7519 usa segundos desde a epoch.`);
    return value * 1000;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    warnings.push(`O claim ${claim} veio como texto; o RFC 7519 exige um número. O valor foi interpretado mesmo assim.`);
    return Number(value) * 1000;
  }
  if (value !== undefined) warnings.push(`O claim ${claim} não é uma data numérica e foi ignorado.`);
  return undefined;
}

function textClaim(header: JsonValue | undefined, claim: string): string | undefined {
  if (!header || typeof header !== "object" || Array.isArray(header)) return undefined;
  const value = header[claim];
  return typeof value === "string" ? value : undefined;
}

const EMPTY_TIMESTAMPS: JwtTimestamps = { issuedAt: undefined, expiresAt: undefined, notBefore: undefined };

function failure(message: string): JwtInspection {
  return {
    decoded: false,
    status: "invalid",
    error: message,
    header: undefined,
    payload: undefined,
    timestamps: EMPTY_TIMESTAMPS,
    timeRemainingMs: undefined,
    warnings: [],
    algorithm: undefined,
    signaturePresent: false,
    signatureVerified: false,
  };
}

export function inspectJwt(token: string, now: number = Date.now()): JwtInspection {
  // Espaço em branco no meio some antes de qualquer validação: token copiado de
  // terminal, de log ou de um header quebrado por wrap chega com quebras de
  // linha, e recusá-lo por isso é rejeitar o jeito mais comum de colar um JWT.
  const trimmed = token
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/\s+/g, "");
  if (!trimmed) return failure("Cole um JWT para inspecionar.");
  const parts = trimmed.split(".");
  if (parts.length !== 3) return failure("Um JWT tem três partes separadas por ponto: header, payload e assinatura.");
  const [headerSegment = "", payloadSegment = "", signatureSegment = ""] = parts;

  let header: JsonValue;
  let payload: JsonValue;
  try {
    header = parseSegment(headerSegment, "header");
    payload = parseSegment(payloadSegment, "payload");
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Não foi possível decodificar o token.");
  }
  // O RFC 7519 define o payload como um objeto JSON. Um array ou uma string
  // decodificam, mas não são um JWT — e chamar isso de "estrutura válida"
  // esconderia o defeito de quem emitiu.
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return failure("O payload de um JWT precisa ser um objeto JSON.");
  }

  const warnings: string[] = [];
  const timestamps: JwtTimestamps = {
    issuedAt: numericClaim(payload, "iat", warnings),
    expiresAt: numericClaim(payload, "exp", warnings),
    notBefore: numericClaim(payload, "nbf", warnings),
  };
  const timeRemainingMs = timestamps.expiresAt === undefined ? undefined : timestamps.expiresAt - now;

  let status: JwtStatus = "valid_structure";
  if (timestamps.expiresAt !== undefined && timestamps.expiresAt <= now) status = "expired";
  else if (timestamps.notBefore !== undefined && timestamps.notBefore > now) status = "not_active_yet";

  return {
    decoded: true,
    status,
    error: undefined,
    header,
    payload,
    timestamps,
    timeRemainingMs,
    warnings,
    algorithm: textClaim(header, "alg"),
    signaturePresent: signatureSegment.length > 0,
    signatureVerified: false,
  };
}

export const JWT_STATUS_LABELS: Record<JwtStatus, string> = {
  invalid: "INVALID",
  valid_structure: "VALID STRUCTURE",
  expired: "EXPIRED",
  not_active_yet: "NOT ACTIVE YET",
};

/** Duração em texto curto: "2 h 14 min", "expirado há 3 dias". */
export function formatDuration(milliseconds: number): string {
  const total = Math.abs(milliseconds);
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const parts: string[] = [];
  if (days) parts.push(`${days} d`);
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (!parts.length) parts.push(`${seconds} s`);
  return parts.join(" ");
}
