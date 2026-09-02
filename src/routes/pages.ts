import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { createApiTestsPage, createApplicationsPage, createAuthPage, createConstructionPage, createDocsPage, createHomePage, createJourneyPage, createWebPage } from "../web-page.js";
import { json } from "../http-helpers.js";
import { createOpenApiDocument } from "../openapi.js";
import type { RouteHandler } from "./context.js";

async function resultsDirWritable(resultsDir: string): Promise<boolean> {
  try {
    await mkdir(resultsDir, { recursive: true });
    await access(resultsDir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export const tryHandlePages: RouteHandler = async (context, request, response, url) => {
  const { config } = context;

  // O prefixo de versão já foi retirado no despacho, então este caminho cobre
  // /api/v1/openapi.json e o alias /api/openapi.json.
  if (request.method === "GET" && url.pathname === "/api/openapi.json") {
    json(response, 200, createOpenApiDocument());
    return true;
  }

  // Vivacidade: o processo está de pé e responde. Não consulta dependência
  // nenhuma de propósito — quem consome isto (HEALTHCHECK do Docker) reinicia o
  // contêiner quando falha, e reiniciar não conserta disco cheio nem sandbox
  // fora do ar. Só um processo travado justifica o reinício.
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, { status: "ok", ...context.queueStats() });
    return true;
  }

  // Prontidão: esta instância consegue atender agora? É o alvo do
  // healthCheckPath do Render, que decide se a instância recebe tráfego.
  if (request.method === "GET" && url.pathname === "/ready") {
    const stats = context.queueStats();
    const [resultsDir, database, artifacts] = await Promise.all([resultsDirWritable(config.resultsDir), context.scanJobs.status(), context.artifacts.status()]);
    // Banco configurado e fora do ar reprova: a criação de uma análise aguarda
    // a gravação e falha sem ele, então a instância realmente não atende.
    // Storage fora do ar não reprova: o envio é best-effort e a análise inteira
    // continua funcionando, servindo do disco local.
    const ready = resultsDir && database !== "unreachable";
    const checks = {
      database,
      artifacts,
      // Sem diretório gravável nenhuma análise produz relatório.
      resultsDir: resultsDir ? "ok" : "unwritable",
      // Informativo, nunca reprova. Fila cheia é carga normal e passa sozinha;
      // reprovar por isso faria a hospedagem reiniciar a instância justamente
      // quando ela está ocupada trabalhando.
      queue: stats.queued + stats.active >= config.maxQueueSize ? "saturated" : "ok",
      // Também informativo: expõe se o Modo Jornada está anunciado sem runner
      // hospedado por trás, combinação que já deixou a Jornada respondendo 503
      // em produção sem sinal nenhum.
      codeMode: !config.allowCodeMode ? "disabled" : config.hostedCodeRunner ? "hosted" : "local",
      ...stats,
    };
    json(response, ready ? 200 : 503, { status: ready ? "ready" : "not_ready", checks });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
    });
    response.end(createHomePage());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/docs") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
    });
    response.end(createDocsPage());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/aplicacoes") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy":
        "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
    });
    response.end(createApplicationsPage());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/entrar") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      // `form-action 'self'` importa aqui mais do que nas outras: esta é a única
      // página onde alguém digita uma senha, e é o que impede um script injetado
      // de reapontar o envio para fora. E como o cliente virou módulo servido de
      // `/assets/js/`, não há mais script embutido: `'unsafe-inline'` saiu do
      // `script-src`, então um `<script>` injetado no HTML não executa.
      "content-security-policy":
        "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'",
    });
    response.end(createAuthPage());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/em-construcao") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
    });
    response.end(createConstructionPage(url.searchParams.get("area") ?? ""));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/journeys") {
    const turnstileSources = config.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${turnstileSources}; frame-src 'self'${turnstileSources}; img-src 'self' data: blob:; connect-src 'self'${turnstileSources}`,
    });
    response.end(createJourneyPage(config.allowCodeMode));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api-tests") {
    const turnstileSources = config.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${turnstileSources}; frame-src 'self'${turnstileSources}; img-src 'self' data: blob:; connect-src 'self'${turnstileSources}`,
    });
    response.end(createApiTestsPage());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/scanner") {
    const turnstileSources = config.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${turnstileSources}; frame-src 'self'${turnstileSources}; img-src 'self' data: blob:; connect-src 'self'${turnstileSources}`,
    });
    response.end(createWebPage(config.turnstileSiteKey, config.allowHistory, config.maxSitemapPages));
    return true;
  }

  return false;
};
