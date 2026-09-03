import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCli } from "../cli.js";
import { assertPublicUrl } from "../security.js";
import { listProjectHistory } from "../history.js";
import type { ScanOptions, ScanReport } from "../types.js";
import type { ScanJob } from "../job-queue.js";
import { ACCESS_HASH_FILE, accessCookie, json, jsonError, numberField, readJson, requireAccess, storedAccessHash, textField, tokenHash } from "../http-helpers.js";
import { codeArtifactPrefix } from "../code-execution-job-store.js";
import { ApiError, invalidRequest, validating } from "../api-error.js";
import { isTerminalJobStatus } from "../job-state.js";
import { MAX_IDEMPOTENCY_KEY_LENGTH, idempotencyScope, requestFingerprint } from "../idempotency-store.js";
import type { PersistedScanJob } from "../scan-job-repository.js";

/** Teto do histórico devolvido de uma vez. */
const MAX_HISTORY_ITEMS = 50;
import type { IncomingMessage } from "node:http";
import { MAX_JSON_BODY_BYTES } from "../code-limits.js";
import type { ServerOptions } from "../server.js";
import type { RouteHandler } from "./context.js";

export function scanOptions(body: Record<string, unknown>, outputDir: string, config: ServerOptions): ScanOptions {
  const url = textField(body, "url");
  if (!url) throw invalidRequest("Informe a URL da aplicação.");
  const args = [url, "--output", outputDir, "--format", "all"];
  const project = textField(body, "project");
  const fields: Array<[string, string | undefined]> = [
    ["--browser", textField(body, "browser")],
    ["--fail-on", textField(body, "failOn")],
    ["--timeout", numberField(body, "timeoutMs")],
    ["--settle", numberField(body, "settleMs")],
    ["--screenshot", textField(body, "screenshot")],
    ["--ignore-status", textField(body, "ignoredStatuses")],
    ["--ignore-url", textField(body, "ignoredUrl")],
    ["--project", project],
    // Ambiente e baseline só existem dentro de um projeto: é o par
    // projeto+ambiente que endereça o histórico. Sem projeto eles são
    // descartados em vez de reprovarem a análise — a barra de contexto do
    // dashboard preenche o ambiente sozinha, então exigir os dois aqui fazia a
    // primeira execução de quem nunca digitou um projeto falhar sempre.
    ["--environment", project ? textField(body, "environment") : undefined],
    ["--max-pages", numberField(body, "maxPages")],
  ];
  for (const [name, value] of fields) {
    if (value) args.push(name, value);
  }
  if (body.sitemap === true) args.push("--sitemap");
  if (body.accessibility === true) args.push("--accessibility");
  if (body.regressionsOnly === true) args.push("--regressions-only");
  if (body.acceptBaseline === true && project) args.push("--accept-baseline");
  if (project) args.push("--history-dir", config.historyDir);
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
  return { scope: idempotencyScope(clientAddress, key), fingerprint: requestFingerprint(body) };
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
export function publicPersistedJob(job: PersistedScanJob): Record<string, unknown> {
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
    // Quem está logado vira dono da análise; anônimo segue sem dono e o token
    // dela é o único caminho para o resultado.
    const owner = await context.currentUser(request);
    // Com a instalação exigindo conta, executar é o ponto onde se pede para
    // entrar — navegar e ler continuam livres. O caminho anônimo não sai do
    // código: é esta chave que decide, e ela vem desligada.
    if (config.requireAccount && !owner) {
      throw new ApiError("unauthorized", "Entre ou crie uma conta para executar uma análise.");
    }
    // A aplicação é conferida contra o dono, e não apenas lida do corpo: sem
    // isso qualquer conta apontaria a própria análise para a aplicação de outra
    // e o histórico alheio passaria a receber execuções de fora.
    const applicationId = textField(body, "applicationId");
    if (applicationId) {
      if (!owner) throw new ApiError("unauthorized", "Entre com sua conta para vincular a análise a uma aplicação.");
      if (!context.applications) throw new ApiError("feature_disabled", "Aplicações não estão disponíveis neste servidor.");
      if (!(await context.applications.get(owner.id, applicationId))) throw new ApiError("not_found", "Aplicação não encontrada.");
    }
    const idempotency = idempotencyRequest(request, context.clientAddress(request), body);
    if (idempotency) {
      const existing = await context.idempotencyKeys.get(idempotency.scope);
      if (existing) {
        if (existing.fingerprint !== idempotency.fingerprint) {
          jsonError(response, "conflict", "Esta Idempotency-Key já foi usada com outro corpo de requisição.");
          return true;
        }
        // O job pode não estar mais em memória: depois de um reinício, ele
        // vive só no banco. Devolve o estado atual, e não uma cópia congelada
        // da resposta original — quem repete quer saber em que pé a análise
        // está.
        const previousId = existing.jobId;
        const inMemory = previousId ? jobQueue.get(previousId) : undefined;
        const stored = previousId && !inMemory ? await context.scanJobs.load(previousId) : undefined;
        if (previousId && (inMemory || stored)) {
          // O token só é reemitido quando derivado do id; com token aleatório
          // ele existiu uma vez só e não há como recriá-lo sem guardá-lo em
          // texto claro, o que seria pior do que não devolver.
          const reissued = context.accessTokens.reissuable ? context.accessTokens.issue(previousId) : existing.accessToken;
          if (reissued) {
            response.setHeader("set-cookie", accessCookie(request, `${context.apiPrefix}/scans/${previousId}`, reissued, config.retentionMs, config.trustProxy));
          }
          json(response, 200, {
            ...(inMemory ? publicJob(inMemory, jobQueue.position(previousId)) : publicPersistedJob(stored as PersistedScanJob)),
            ...(reissued ? { accessToken: reissued } : {}),
          });
          return true;
        }
        if (!existing.jobId) {
          jsonError(response, "conflict", "A requisição original com esta Idempotency-Key ainda está em processamento.");
          return true;
        }
        // O job original já expirou: a chave é liberada para uma análise nova.
        await context.idempotencyKeys.release(idempotency.scope);
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
    if (idempotency) await context.idempotencyKeys.reserve(idempotency.scope, idempotency.fingerprint);
    try {
      const options = scanOptions(body, join(config.resultsDir, id), config);
      if (!config.allowPrivateTargets) {
        await assertPublicUrl(options.url);
        options.publicNetworkOnly = true;
      }
      const accessToken = context.accessTokens.issue(id);
      const accessTokenHash = tokenHash(accessToken);
      await mkdir(options.outputDir, { recursive: true });
      await writeFile(join(options.outputDir, ACCESS_HASH_FILE), `${accessTokenHash}\n`, { encoding: "utf8", mode: 0o600 });
      const job: ScanJob = {
        id,
        ownerId: owner?.id,
        applicationId,
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
      if (idempotency) await context.idempotencyKeys.complete(idempotency.scope, job.id, accessToken);
      context.schedule();
      response.setHeader("set-cookie", accessCookie(request, `${context.apiPrefix}/scans/${id}`, accessToken, config.retentionMs, config.trustProxy));
      json(response, 202, { ...publicJob(job, jobQueue.position(job.id)), accessToken });
    } catch (error) {
      // Uma criação que falhou não pode deixar a chave presa numa reserva que
      // nunca vira job: o cliente ficaria em 409 até a retenção expirar.
      if (idempotency) await context.idempotencyKeys.release(idempotency.scope);
      throw error;
    }
    return true;
  }

  // Histórico da própria conta. Só existe logado, e devolve exclusivamente o
  // que pertence a quem pediu — a listagem é o lugar onde um vazamento entre
  // contas seria mais fácil de acontecer e mais difícil de notar.
  if (request.method === "GET" && url.pathname === "/api/scans") {
    const viewer = await context.currentUser(request);
    if (!viewer) {
      jsonError(response, "unauthorized", "Entre com sua conta para ver seu histórico de análises.");
      return true;
    }
    const scans = await context.scanJobs.listHistory(viewer.id, { limit: MAX_HISTORY_ITEMS });
    json(response, 200, { scans: scans.map((scan) => publicPersistedJob(scan)) });
    return true;
  }

  // Limpar o histórico precisa alcançar esta cópia também. Sem ela, apagar no
  // dashboard só durava até a próxima recarga: a lista da conta voltava inteira,
  // e com ela o índice de qualidade e os sinais.
  if (request.method === "DELETE" && url.pathname === "/api/scans") {
    const viewer = await context.currentUser(request);
    if (!viewer) {
      jsonError(response, "unauthorized", "Entre com sua conta para apagar seu histórico de análises.");
      return true;
    }
    const scans = await context.scanJobs.listHistory(viewer.id, { limit: MAX_HISTORY_ITEMS });
    const removed = await context.scanJobs.removeForOwner(viewer.id);
    // Apagar a linha e deixar o relatório no disco não é apagar: o HTML
    // continuaria acessível por link. Só entram os que já terminaram — mexer no
    // diretório de uma análise em curso quebraria a execução que está rodando.
    await Promise.all(
      scans
        .filter((scan) => removed.includes(scan.id) && isTerminalJobStatus(scan.status))
        .map(async (scan) => {
          // Mesmo motivo do bloco das Jornadas logo abaixo: o job concluído
          // segue em memória até a retenção vencer, e `GET /api/scans/:id` olha
          // para lá antes do banco.
          jobQueue.delete(scan.id);
          await context.artifacts.remove(scan.id).catch(() => {});
          await rm(scan.options.outputDir, { recursive: true, force: true }).catch(() => {});
        }),
    );
    // As execuções da Jornada entram no mesmo "apagar": elas passaram a ter
    // dono, então deixá-las de fora faria o botão apagar metade do histórico e
    // manter a outra metade acessível por link — pior do que não apagar nada,
    // porque a pessoa acreditaria que apagou.
    const journeys = (await context.codeExecutions?.deleteByOwner(viewer.id)) ?? [];
    await Promise.all(
      journeys.map(async (id) => {
        // Tirar do cache do processo também. Sem isto o registro sai do banco e
        // do disco, mas `loadCodeExecutionJob` consulta a memória primeiro e o
        // link continuaria abrindo a execução que a pessoa acabou de apagar.
        context.codeExecutionJobs.delete(id);
        await context.artifacts.remove(codeArtifactPrefix(id)).catch(() => {});
        await rm(join(config.resultsDir, codeArtifactPrefix(id)), { recursive: true, force: true }).catch(() => {});
      }),
    );
    // O histórico dos Testes de API entra pela mesma razão das Jornadas: o botão
    // promete apagar o histórico da conta, e apagar dois terços dele é pior do
    // que não apagar nada. As collections **não** saem — são configuração da
    // aplicação, não histórico, e o botão não promete apagar o trabalho salvo.
    const apiRuns = (await context.apiCollections?.removeRunsForOwner(viewer.id)) ?? 0;
    json(response, 200, { removed: removed.length, journeys: journeys.length, apiRuns });
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
    // O dono entra sem apresentar o token: a análise é dele. Uma análise
    // anônima (sem dono) não pertence a ninguém, então continua exigindo o
    // token mesmo de quem está logado — é o que impede uma conta de alcançar o
    // que não é dela.
    const ownerId = job?.ownerId ?? persisted?.ownerId;
    const viewer = ownerId ? await context.currentUser(request) : undefined;
    if (!(ownerId && viewer?.id === ownerId) && !requireAccess(request, response, expectedHash)) return true;
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
    // O disco vem primeiro: é mais rápido e é onde o artefato acabou de ser
    // escrito. O armazenamento durável cobre o caso que hoje quebra — o
    // contêiner foi recriado e levou o disco junto, deixando morto o link que a
    // pessoa guardou.
    const content = (await readFile(join(outputDir, artifact)).catch(() => undefined)) ?? (await context.artifacts.read(id, artifact));
    if (!content) {
      jsonError(response, "not_found", "Artefato não encontrado ou já expirado.");
      return true;
    }
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
