import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { parseCli } from "../cli.js";
import { assertPublicUrl } from "../security.js";
import { listProjectHistory } from "../history.js";
import type { ScanOptions, ScanReport } from "../types.js";
import type { ScanJob } from "../job-queue.js";
import { ACCESS_HASH_FILE, accessCookie, json, jsonError, numberField, readJson, requireAccess, storedAccessHash, textField, tokenHash } from "../http-helpers.js";
import { ApiError, invalidRequest, validating } from "../api-error.js";
import { isTerminalJobStatus } from "../job-state.js";
import { IdempotencyStore, MAX_IDEMPOTENCY_KEY_LENGTH, requestFingerprint } from "../idempotency-store.js";
import type { PersistedScanJob } from "../scan-job-repository.js";
import type { IncomingMessage } from "node:http";
import { MAX_JSON_BODY_BYTES } from "../code-limits.js";
import type { ServerOptions } from "../server.js";
import type { RouteHandler } from "./context.js";

export function scanOptions(body: Record<string, unknown>, outputDir: string, config: ServerOptions): ScanOptions {
  const url = textField(body, "url");
  if (!url) throw invalidRequest("Informe a URL da aplicação.");
  const args = [url, "--output", outputDir, "--format", "all"];
  const fields: Array<[string, string | undefined]> = [
    ["--browser", textField(body, "browser")],
    ["--fail-on", textField(body, "failOn")],
    ["--timeout", numberField(body, "timeoutMs")],
    ["--settle", numberField(body, "settleMs")],
    ["--screenshot", textField(body, "screenshot")],
    ["--ignore-status", textField(body, "ignoredStatuses")],
    ["--ignore-url", textField(body, "ignoredUrl")],
    ["--project", textField(body, "project")],
    ["--environment", textField(body, "environment")],
    ["--max-pages", numberField(body, "maxPages")],
  ];
  for (const [name, value] of fields) {
    if (value) args.push(name, value);
  }
  if (body.sitemap === true) args.push("--sitemap");
  if (body.accessibility === true) args.push("--accessibility");
  if (body.regressionsOnly === true) args.push("--regressions-only");
  if (body.acceptBaseline === true) args.push("--accept-baseline");
  if (textField(body, "project")) args.push("--history-dir", config.historyDir);
  const parsed = validating(() => parseCli(args));
  if (!parsed.options) throw invalidRequest("Não foi possível preparar a análise.");
  const options = parsed.options;
  if (options.timeoutMs > 120_000) throw invalidRequest("O timeout máximo é 120000 ms.");
  if (options.settleMs > 30_000) throw invalidRequest("O tempo de observação máximo é 30000 ms.");
  if (options.sitemap && (options.maxPages ?? 20) > config.maxSitemapPages) {
    throw invalidRequest(`O limite de páginas neste servidor é ${config.maxSitemapPages}.`);
  }
  if (options.project && !config.allowHistory) {
    throw new ApiError("feature_disabled", "Histórico por projeto está desabilitado neste servidor.");
  }
  return options;
}

/**
 * Lê e valida o cabeçalho `Idempotency-Key`. Ausente, a criação segue o
 * comportamento anterior: cada POST cria uma análise.
 */
function idempotencyRequest(request: IncomingMessage, clientAddress: string, body: Record<string, unknown>): { scope: string; fingerprint: string } | undefined {
  const raw = request.headers["idempotency-key"];
  const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!key) return undefined;
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\w.:-]+$/.test(key)) {
    throw invalidRequest(`Idempotency-Key deve ter até ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres entre letras, números, ponto, dois-pontos, hífen e underscore.`);
  }
  return { scope: IdempotencyStore.scope(clientAddress, key), fingerprint: requestFingerprint(body) };
}

function publicJob(job: ScanJob, queuePosition?: number): Record<string, unknown> {
  const report = job.report ? { ...job.report, screenshotPath: job.report.screenshotPath ? "screenshot.png" : undefined } : undefined;
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    report,
    error: job.error,
    progress: job.progress,
    ...(queuePosition !== undefined ? { queuePosition } : {}),
    screenshotAvailable: Boolean(job.report?.screenshotPath),
  };
}

/** Mesma forma de `publicJob`, a partir do registro gravado no banco. */
function publicPersistedJob(job: PersistedScanJob): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    report: job.report ? { ...job.report, screenshotPath: job.report.screenshotPath ? "screenshot.png" : undefined } : undefined,
    error: job.error,
    progress: job.progress,
    screenshotAvailable: Boolean(job.report?.screenshotPath),
  };
}

async function recoveredJob(resultsDir: string, id: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await readFile(join(resultsDir, id, "report.json"), "utf8");
    const report = JSON.parse(content) as ScanReport;
    let screenshotAvailable = false;
    try {
      await access(join(resultsDir, id, "screenshot.png"));
      screenshotAvailable = true;
    } catch {
      screenshotAvailable = false;
    }
    return {
      id,
      status: "completed",
      createdAt: report.startedAt,
      report: { ...report, screenshotPath: screenshotAvailable ? "screenshot.png" : undefined },
      error: undefined,
      screenshotAvailable,
    };
  } catch {
    return undefined;
  }
}

export const tryHandleScans: RouteHandler = async (context, request, response, url) => {
  const { config, jobQueue, legacyJourneys } = context;

  if (request.method === "GET" && url.pathname === "/api/history") {
    if (!config.allowHistory) {
      jsonError(response, "feature_disabled", "Histórico está desabilitado neste servidor.");
      return true;
    }
    const project = url.searchParams.get("project")?.trim();
    const environment = url.searchParams.get("environment")?.trim();
    if (!project || !environment) {
      jsonError(response, "invalid_request", "Informe projeto e ambiente para consultar o histórico.");
      return true;
    }
    json(response, 200, await listProjectHistory(config.historyDir, project, environment));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/scans") {
    if (legacyJourneys.isActive()) {
      jsonError(response, "resource_in_use", "Já existe uma jornada usando o navegador neste servidor.");
      return true;
    }
    if (!context.consumeRateLimit(request, response)) return true;
    // O corpo é lido antes da checagem de fila cheia porque a repetição de uma
    // requisição precisa da impressão digital dele, e é justamente sob carga —
    // quando a fila enche e o cliente sofre timeout — que a repetição acontece.
    const body = await readJson(request, MAX_JSON_BODY_BYTES);
    const idempotency = idempotencyRequest(request, context.clientAddress(request), body);
    if (idempotency) {
      const existing = context.idempotencyKeys.get(idempotency.scope);
      if (existing) {
        if (existing.fingerprint !== idempotency.fingerprint) {
          jsonError(response, "conflict", "Esta Idempotency-Key já foi usada com outro corpo de requisição.");
          return true;
        }
        const previous = existing.jobId ? jobQueue.get(existing.jobId) : undefined;
        if (previous && existing.accessToken) {
          // Devolve o estado atual do job, não uma cópia congelada da resposta
          // original: quem repete quer saber em que pé a análise está.
          response.setHeader("set-cookie", accessCookie(request, `${context.apiPrefix}/scans/${previous.id}`, existing.accessToken, config.retentionMs, config.trustProxy));
          json(response, 200, { ...publicJob(previous, jobQueue.position(previous.id)), accessToken: existing.accessToken });
          return true;
        }
        if (!existing.jobId) {
          jsonError(response, "conflict", "A requisição original com esta Idempotency-Key ainda está em processamento.");
          return true;
        }
        // O job original já expirou: a chave é liberada para uma análise nova.
        context.idempotencyKeys.release(idempotency.scope);
      }
    }
    const stats = context.queueStats();
    if (stats.queued + stats.active >= config.maxQueueSize) {
      jsonError(response, "server_busy", "O serviço está ocupado. Tente novamente em alguns instantes.");
      return true;
    }
    if (config.turnstileSecretKey) {
      const token = textField(body, "cf-turnstile-response");
      if (!token || token.length > 2048) throw invalidRequest("Conclua a verificação de segurança.");
      const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          secret: config.turnstileSecretKey,
          response: token,
          remoteip: context.clientAddress(request),
          idempotency_key: randomUUID(),
        }),
      });
      const result = (await verification.json()) as { success?: boolean };
      if (!verification.ok || !result.success) throw invalidRequest("A verificação de segurança expirou ou é inválida. Tente novamente.");
    }
    if (!config.allowCustomIgnorePatterns && textField(body, "ignoredUrl")) {
      throw new ApiError("feature_disabled", "Filtros regex personalizados estão desabilitados neste servidor.");
    }
    const id = randomUUID();
    // A reserva é feita antes de qualquer await seguinte: sem ela, duas
    // requisições simultâneas com a mesma chave passariam ambas pela consulta
    // acima e enfileirariam dois jobs.
    if (idempotency) context.idempotencyKeys.reserve(idempotency.scope, idempotency.fingerprint);
    try {
      const options = scanOptions(body, join(config.resultsDir, id), config);
      if (!config.allowPrivateTargets) {
        await assertPublicUrl(options.url);
        options.publicNetworkOnly = true;
      }
      const accessToken = randomBytes(32).toString("base64url");
      const accessTokenHash = tokenHash(accessToken);
      await mkdir(options.outputDir, { recursive: true });
      await writeFile(join(options.outputDir, ACCESS_HASH_FILE), `${accessTokenHash}\n`, { encoding: "utf8", mode: 0o600 });
      const job: ScanJob = {
        id,
        status: "queued",
        createdAt: new Date().toISOString(),
        options,
        report: undefined,
        error: undefined,
        progress: {
          discoveredPages: 0,
          completedPages: 0,
          currentUrl: undefined,
          percent: 0,
          stage: "queued",
        },
        controller: new AbortController(),
        cancelRequested: false,
        accessTokenHash,
      };
      // Gravado antes de responder: se o banco recusar, o cliente não pode
      // sair daqui com o id de uma análise que só existe nesta memória.
      await context.scanJobs.created(job);
      jobQueue.enqueue(job);
      if (idempotency) context.idempotencyKeys.complete(idempotency.scope, job.id, accessToken);
      context.schedule();
      response.setHeader("set-cookie", accessCookie(request, `${context.apiPrefix}/scans/${id}`, accessToken, config.retentionMs, config.trustProxy));
      json(response, 202, { ...publicJob(job, jobQueue.position(job.id)), accessToken });
    } catch (error) {
      // Uma criação que falhou não pode deixar a chave presa numa reserva que
      // nunca vira job: o cliente ficaria em 409 até a retenção expirar.
      if (idempotency) context.idempotencyKeys.release(idempotency.scope);
      throw error;
    }
    return true;
  }

  const cancelMatch = /^\/api\/scans\/([0-9a-f-]+)\/cancel$/.exec(url.pathname);
  if (request.method === "POST" && cancelMatch) {
    const id = cancelMatch[1];
    const job = id ? jobQueue.get(id) : undefined;
    if (!job) {
      jsonError(response, "not_found", "Análise não encontrada ou já expirada.");
      return true;
    }
    if (!requireAccess(request, response, job.accessTokenHash)) return true;
    // Cancelar o que já está cancelado é a mesma operação repetida e converge
    // para o mesmo estado, então responde sucesso. Cancelar algo que concluiu
    // ou falhou pede um desfecho diferente do que aconteceu: continua conflito.
    if (job.status === "cancelled") {
      json(response, 202, publicJob(job));
      return true;
    }
    if (isTerminalJobStatus(job.status)) {
      jsonError(response, "conflict", "A análise já foi finalizada.");
      return true;
    }
    job.cancelRequested = true;
    job.controller.abort(new Error("Análise cancelada pelo usuário."));
    if (jobQueue.cancelQueued(job.id)) {
      job.progress = { ...job.progress, stage: "cancelled" };
      void context.scanJobs.updated(job);
      context.expireJob(job);
      context.logOperational({
        event: "scan.cancelled",
        timestamp: new Date().toISOString(),
        jobId: job.id,
        targetOrigin: context.targetOrigin(job),
        ...context.queueStats(),
      });
    }
    json(response, 202, publicJob(job, jobQueue.position(job.id)));
    return true;
  }

  const match = /^\/api\/scans\/([0-9a-f-]+)(?:\/((?:pages\/[a-z0-9-]+\/)?(?:report\.html|report\.json|report\.junit\.xml|report\.sarif\.json|screenshot\.png)))?$/.exec(url.pathname);
  if (request.method === "GET" && match) {
    const id = match[1];
    const artifact = match[2];
    if (!id) {
      jsonError(response, "not_found", "Análise não encontrada.");
      return true;
    }
    const job = jobQueue.get(id);
    // Fora da memória, o banco é a fonte: ele sabe o desfecho real (falhou,
    // cancelou, ficou órfã), enquanto o disco só guarda análises que chegaram
    // a gravar relatório — e ainda por cima num volume efêmero.
    const persisted = job ? undefined : await context.scanJobs.load(id);
    const expectedHash = job?.accessTokenHash ?? persisted?.accessTokenHash ?? (await storedAccessHash(config.resultsDir, id));
    if (!expectedHash) {
      jsonError(response, "not_found", "Análise não encontrada ou já expirada.");
      return true;
    }
    if (!requireAccess(request, response, expectedHash)) return true;
    if (!artifact) {
      if (job) {
        json(response, 200, publicJob(job, jobQueue.position(job.id)));
        return true;
      }
      if (persisted) {
        json(response, 200, publicPersistedJob(persisted));
        return true;
      }
      const recovered = await recoveredJob(config.resultsDir, id);
      if (recovered) {
        json(response, 200, recovered);
        return true;
      }
      jsonError(response, "not_found", "Análise não encontrada ou já expirada.");
      return true;
    }
    if (job && job.status !== "completed") {
      jsonError(response, "conflict", "A análise ainda não foi concluída.");
      return true;
    }
    const outputDir = job?.options.outputDir ?? join(config.resultsDir, id);
    const content = await readFile(join(outputDir, artifact));
    const contentType = artifact.endsWith(".html")
      ? "text/html; charset=utf-8"
      : artifact.endsWith(".xml")
        ? "application/xml; charset=utf-8"
        : artifact.endsWith(".json")
          ? "application/json; charset=utf-8"
          : "image/png";
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": content.length,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      ...(artifact.endsWith(".html")
        ? {
            "content-security-policy": "default-src 'none'; base-uri 'none'; img-src data: blob: 'self'; style-src 'unsafe-inline'; sandbox allow-same-origin",
          }
        : {}),
    });
    response.end(content);
    return true;
  }

  return false;
};
