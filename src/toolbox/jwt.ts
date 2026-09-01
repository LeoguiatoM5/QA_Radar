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

function numericClaim(payload: JsonValue | undefined, claim: string): number | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = payload[claim];
  // As datas do JWT são segundos desde a epoch (RFC 7519), não milissegundos.
  return typeof value === "number" && Number.isFinite(value) ? value * 1000 : undefined;
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
    algorithm: undefined,
    signaturePresent: false,
    signatureVerified: false,
  };
}

export function inspectJwt(token: string, now: number = Date.now()): JwtInspection {
  const trimmed = token.trim().replace(/^Bearer\s+/i, "");
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

  const timestamps: JwtTimestamps = {
    issuedAt: numericClaim(payload, "iat"),
    expiresAt: numericClaim(payload, "exp"),
    notBefore: numericClaim(payload, "nbf"),
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
