import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const ACCESS_HASH_FILE = ".access-token.sha256";

export function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(JSON.stringify(body));
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() || undefined : undefined;
}

export function requestToken(request: IncomingMessage): string | undefined {
  const authorization = bearerToken(request);
  if (authorization) return authorization;
  const cookie = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("qa_radar_access="));
  return cookie ? decodeURIComponent(cookie.slice("qa_radar_access=".length)) : undefined;
}

export function requireAccess(request: IncomingMessage, response: ServerResponse, expectedHash: string): boolean {
  const token = requestToken(request);
  if (token && tokenMatches(token, expectedHash)) return true;
  response.setHeader("www-authenticate", 'Bearer realm="QA Radar report"');
  json(response, token ? 403 : 401, { error: "Token de acesso da análise ausente ou inválido." });
  return false;
}

export function accessCookie(request: IncomingMessage, path: string, token: string, retentionMs: number, trustProxy: boolean): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const secure = Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted) || (trustProxy && forwardedProto === "https");
  return `qa_radar_access=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=${path}; Max-Age=${Math.ceil(retentionMs / 1000)}${secure ? "; Secure" : ""}`;
}

export async function storedAccessHash(resultsDir: string, id: string): Promise<string | undefined> {
  try {
    const value = (await readFile(join(resultsDir, id, ACCESS_HASH_FILE), "utf8")).trim();
    return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function readJson(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Requisição muito grande.");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("O corpo deve ser um objeto JSON.");
    return value as Record<string, unknown>;
  } catch {
    throw new Error("Corpo JSON inválido.");
  }
}

export function textField(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function numberField(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}
