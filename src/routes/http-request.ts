import { json, readJson, textField } from "../http-helpers.js";
import { redactUrl } from "../api-collection.js";
import { ApiError, invalidRequest } from "../api-error.js";
import { MAX_JSON_BODY_BYTES } from "../code-limits.js";
import { PublicNetworkGuard, type PublicUrlResolver } from "../security.js";
import type { RouteHandler } from "./context.js";

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BODY_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

interface HttpRequestResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  durationMs: number;
}

function parseHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest("headers deve ser um objeto de texto para texto.");
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") throw invalidRequest(`headers.${key} deve ser texto.`);
    if (/^(host|content-length)$/i.test(key)) continue;
    headers[key] = raw;
  }
  return headers;
}

async function readTruncatedBody(response: Response): Promise<{ body: string; bodyTruncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { body: "", bodyTruncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total >= MAX_RESPONSE_BODY_BYTES) {
      truncated = true;
      continue;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const body = buffer.subarray(0, MAX_RESPONSE_BODY_BYTES).toString("utf8");
  return { body, bodyTruncated: truncated || buffer.byteLength > MAX_RESPONSE_BODY_BYTES };
}

export async function guardedFetch(
  initialUrl: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  allowPrivateTargets: boolean,
  resolver?: PublicUrlResolver,
): Promise<HttpRequestResult> {
  const guard = new PublicNetworkGuard(resolver);
  let currentUrl = initialUrl;
  const startedAt = Date.now();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!allowPrivateTargets) await guard.assert(currentUrl);
    const outgoingBody = method === "GET" || method === "HEAD" ? undefined : body;
    const response = await fetch(currentUrl, {
      method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(outgoingBody !== undefined ? { body: outgoingBody } : {}),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (location) {
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
    }
    const { body: responseBody, bodyTruncated } = await readTruncatedBody(response);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      bodyTruncated,
      durationMs: Date.now() - startedAt,
    };
  }
  throw invalidRequest("Excesso de redirecionamentos.");
}

export const tryHandleHttpRequest: RouteHandler = async (context, request, response, url) => {
  const { config } = context;

  if (request.method === "POST" && url.pathname === "/api/http-request") {
    // Mesma regra da análise: com a instalação exigindo conta, disparar uma
    // requisição a partir do servidor é execução e pede sessão.
    if (config.requireAccount && !(await context.currentUser(request))) {
      throw new ApiError("unauthorized", "Entre ou crie uma conta para executar testes de API.");
    }
    if (!context.consumeRateLimit(request, response)) return true;
    const requestBody = await readJson(request, MAX_JSON_BODY_BYTES);
    const targetUrl = textField(requestBody, "url");
    if (!targetUrl) throw invalidRequest("Informe a URL da requisição.");
    const method = textField(requestBody, "method")?.toUpperCase() ?? "GET";
    if (!ALLOWED_METHODS.has(method)) throw invalidRequest(`Método não suportado: ${method}.`);
    const headers = parseHeaders(requestBody.headers);
    const body = typeof requestBody.body === "string" ? requestBody.body : undefined;

    const result = await guardedFetch(targetUrl, method, headers, body, config.allowPrivateTargets);
    // Registro da execução na aplicação escolhida: metadado apenas — método,
    // URL já sem credencial, status e duração. Corpo de requisição e de resposta
    // ficam fora de propósito: é neles que moram token, dado pessoal e payload
    // de cliente, e guardar isso seria assumir a guarda de dado de terceiro.
    const applicationId = textField(requestBody, "applicationId");
    if (applicationId && context.apiCollections) {
      const owner = await context.currentUser(request);
      // Aplicação conferida contra o dono, como na Inspeção e na Jornada. Aqui
      // não derruba a requisição: ela já saiu para a rede e a resposta é o que a
      // pessoa pediu; o registro é melhor esforço.
      if (owner && (await context.applications?.get(owner.id, applicationId))) {
        await context.apiCollections
          .recordRun({
            ownerId: owner.id,
            applicationId,
            method,
            url: redactUrl(targetUrl),
            status: result.status,
            statusText: result.statusText,
            durationMs: result.durationMs,
          })
          .catch((error: unknown) => {
            console.error(
              JSON.stringify({
                source: "qa-radar",
                event: "api_run.persistence_failed",
                timestamp: new Date().toISOString(),
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          });
      }
    }
    json(response, 200, result);
    return true;
  }

  return false;
};
