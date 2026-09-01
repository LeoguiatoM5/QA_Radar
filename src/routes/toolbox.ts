import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { json, readJson } from "../http-helpers.js";
import { ApiError, invalidRequest } from "../api-error.js";
import { MAX_JSON_BODY_BYTES } from "../code-limits.js";
import { createToolPage, createToolboxHomePage } from "../web-page.js";
import { findTool } from "../toolbox/catalog.js";
import { DEFAULT_EXPECTED_STATUS, DEFAULT_MAX_RESPONSE_TIME_MS, MAX_ALLOWED_RESPONSE_TIME_MS, MAX_HEALTH_CHECKS, evaluateHealth, summarizeHealth, type HealthCheckOutcome } from "../toolbox/health.js";
import { guardedFetch } from "./http-request.js";
import type { RouteHandler } from "./context.js";

/**
 * As páginas do Toolbox carregam módulos ES de `/assets/toolbox/`, então elas —
 * e só elas — precisam de `script-src 'self'`. As demais continuam sem, para
 * que nenhum script externo consiga ser carregado nelas.
 */
const TOOLBOX_CSP =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";

function html(response: Parameters<RouteHandler>[2], body: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": TOOLBOX_CSP,
  });
  response.end(body);
}

const TOOLBOX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "toolbox");

/**
 * Módulos que o navegador tem permissão de baixar.
 *
 * Lista explícita, não varredura de diretório: servir arquivo por nome vindo da
 * URL é como se serve o disco inteiro por engano, e um módulo que só o servidor
 * deveria conhecer não pode virar download por ter caído na pasta certa.
 */
const BROWSER_MODULES = new Set(["catalog", "json-value", "json-diff", "boundary-values", "test-data", "jwt", "curl", "health"]);

const assetCache = new Map<string, string>();

async function toolboxAsset(name: string): Promise<string | undefined> {
  if (!BROWSER_MODULES.has(name)) return undefined;
  const cached = assetCache.get(name);
  if (cached !== undefined) return cached;

  let code: string;
  try {
    code = await readFile(join(TOOLBOX_DIR, `${name}.js`), "utf8");
  } catch {
    // Em desenvolvimento o servidor roda o TypeScript direto (tsx) e o `.js`
    // compilado não existe. O tipo é removido na hora, pelo mesmo compilador do
    // build — em produção, servindo de `dist/`, este caminho nunca é usado.
    let source: string;
    try {
      source = await readFile(join(TOOLBOX_DIR, `${name}.ts`), "utf8");
    } catch {
      return undefined;
    }
    const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
    code = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
    }).outputText;
  }

  // O `.js` do build aponta para um `.map` que esta rota não serve: sem tirar a
  // referência, abrir o DevTools rende um 404 por módulo carregado.
  const served = code.replace(/\n?\/\/# sourceMappingURL=.*$/m, "\n");
  assetCache.set(name, served);
  return served;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

interface RequestedCheck {
  name: string;
  url: string;
  method: "GET" | "HEAD";
}

function parseChecks(value: unknown): RequestedCheck[] {
  if (!Array.isArray(value) || value.length === 0) throw invalidRequest("Informe ao menos um endpoint.");
  if (value.length > MAX_HEALTH_CHECKS) throw invalidRequest(`No máximo ${MAX_HEALTH_CHECKS} endpoints por verificação.`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidRequest(`Endpoint ${index + 1} inválido.`);
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!url) throw invalidRequest(`Informe a URL do endpoint ${index + 1}.`);
    const method = typeof record.method === "string" ? record.method.toUpperCase() : "GET";
    // GET e HEAD só: um health check não escreve nada, e aceitar POST aqui
    // transformaria a ferramenta num disparador de efeito colateral alheio.
    if (method !== "GET" && method !== "HEAD") throw invalidRequest("O health check aceita apenas GET ou HEAD.");
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 60) : url.replace(/^https?:\/\//i, "").split("/")[0] || url;
    return { name, url, method };
  });
}

export const tryHandleToolbox: RouteHandler = async (context, request, response, url) => {
  const { config } = context;

  if (request.method === "GET" && url.pathname === "/toolbox") {
    html(response, createToolboxHomePage());
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/toolbox/")) {
    const tool = findTool(url.pathname.slice("/toolbox/".length));
    const page = tool ? createToolPage(tool) : undefined;
    if (!page) return false;
    html(response, page);
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/assets/toolbox/")) {
    const file = url.pathname.slice("/assets/toolbox/".length);
    const name = /^([a-z0-9-]+)\.js$/.exec(file)?.[1];
    const code = name ? await toolboxAsset(name) : undefined;
    if (code === undefined) return false;
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(code);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/toolbox/health-checks") {
    // Mesma regra do cliente HTTP: quando a instalação exige conta, sair para a
    // rede a partir do servidor pede sessão.
    if (config.requireAccount && !(await context.currentUser(request))) {
      throw new ApiError("unauthorized", "Entre ou crie uma conta para verificar endpoints.");
    }
    if (!context.consumeRateLimit(request, response)) return true;

    const body = await readJson(request, MAX_JSON_BODY_BYTES);
    const checks = parseChecks(body.checks);
    const expectedStatus = positiveInteger(body.expectedStatus, DEFAULT_EXPECTED_STATUS);
    const maxResponseTimeMs = Math.min(positiveInteger(body.maxResponseTimeMs, DEFAULT_MAX_RESPONSE_TIME_MS), MAX_ALLOWED_RESPONSE_TIME_MS);

    const outcomes: HealthCheckOutcome[] = await Promise.all(
      checks.map(async (check): Promise<HealthCheckOutcome> => {
        try {
          // Sem cabeçalhos do cliente de propósito: o Toolbox não repassa
          // credencial nenhuma, então isto não vira um proxy para autenticar
          // em nome de quem chamou.
          const result = await guardedFetch(check.url, check.method, {}, undefined, config.allowPrivateTargets);
          const { state, reason } = evaluateHealth({ status: result.status, durationMs: result.durationMs }, { expectedStatus, maxResponseTimeMs });
          return {
            name: check.name,
            url: check.url,
            status: result.status,
            statusText: result.statusText,
            contentType: result.headers["content-type"],
            durationMs: result.durationMs,
            state,
            reason,
          };
        } catch (error) {
          return {
            name: check.name,
            url: check.url,
            status: undefined,
            statusText: undefined,
            contentType: undefined,
            durationMs: undefined,
            state: "failed",
            reason: error instanceof ApiError ? error.message : "Não foi possível alcançar o endereço.",
          };
        }
      }),
    );

    json(response, 200, { outcomes, summary: summarizeHealth(outcomes), expectedStatus, maxResponseTimeMs });
    return true;
  }

  return false;
};
