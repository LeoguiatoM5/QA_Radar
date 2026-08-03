import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { scan } from "./scanner.js";
import type { ScanOptions, ScanProgress } from "./types.js";
import { findHistoryBaseline, storeRun } from "./history.js";
import { scanSitemap } from "./suite.js";
import { JobQueue, type ScanJob } from "./job-queue.js";
import { RateLimiter } from "./rate-limit.js";
import { writeReports } from "./reporters.js";
import { runJourneyDefinition } from "./journey-cli.js";
import type { JourneyRunResult } from "./journey-runner.js";
import { runPlaywrightCodeWorker } from "./code-worker-client.js";
import type { HostedCodeRunner } from "./sandbox-client.js";
import { bearerToken, jsonError, storedAccessHash, tokenHash, tokenMatches } from "./http-helpers.js";
import { toApiError } from "./api-error.js";
import { transitionJob, type TerminalJobStatus } from "./job-state.js";
import { CodegenSessionStore, type CodegenSession } from "./codegen-session-store.js";
import { CodeExecutionJobStore, type CodeExecutionJob } from "./code-execution-job-store.js";
import { LegacyJourneyRegistry, type JourneyJob } from "./legacy-journey-registry.js";
import type { RequestContext, RouteHandler } from "./routes/context.js";
import { tryHandlePages } from "./routes/pages.js";
import { tryHandleCodegen } from "./routes/codegen.js";
import { tryHandleCodeExecution } from "./routes/code-execution.js";
import { tryHandleLegacyJourneys } from "./routes/journeys-legacy.js";
import { tryHandleScans } from "./routes/scans.js";
import { tryHandleHttpRequest } from "./routes/http-request.js";
import { tryHandleDashboardActivity } from "./routes/dashboard-activity.js";
import type { SpawnProcess } from "./code-execution.js";
import { SERVER_OPTION_DEFAULTS } from "./env.js";
import { DashboardActivityStore } from "./dashboard-activity-store.js";
import { IdempotencyStore } from "./idempotency-store.js";

export interface OperationalEvent {
  event: "scan.started" | "scan.completed" | "scan.failed" | "scan.cancelled" | "scan.expired";
  timestamp: string;
  jobId: string;
  targetOrigin: string;
  active: number;
  queued: number;
  jobs: number;
  browser?: ScanOptions["browser"];
  sitemap?: boolean;
  maxPages?: number;
  screenshot?: ScanOptions["screenshot"];
  failOn?: ScanOptions["failOn"];
  timeoutMs?: number;
  settleMs?: number;
  durationMs?: number;
  cpuUserMs?: number;
  cpuSystemMs?: number;
  rssMiB?: number;
  heapUsedMiB?: number;
  heapTotalMiB?: number;
  externalMiB?: number;
  passed?: boolean;
  errors?: number;
  warnings?: number;
  error?: string;
}

export interface ServerOptions {
  resultsDir: string;
  concurrency: number;
  maxQueueSize: number;
  allowPrivateTargets: boolean;
  // Sem variável de ambiente própria em produção; só usado com override em testes.
  allowCustomIgnorePatterns: boolean;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  retentionMs: number;
  maxJobDurationMs: number;
  trustProxy: boolean;
  turnstileSiteKey: string | undefined;
  turnstileSecretKey: string | undefined;
  allowHistory: boolean;
  // allowJourneys e os limites maxJourney* abaixo não são lidos de nenhuma
  // variável de ambiente em produção: a jornada declarativa em JSON é legado
  // e não faz parte do produto. Permanecem aqui apenas para os testes que
  // ainda exercitam essa rota.
  allowJourneys: boolean;
  allowCodeMode: boolean;
  codeModeAdminToken: string | undefined;
  historyDir: string;
  maxSitemapPages: number;
  maxJourneySteps: number;
  maxJourneyPayloadBytes: number;
  maxJourneyDurationMs: number;
  maxCodeExecutionDurationMs: number;
  maxCodeOutputBytes: number;
  maxCodeMemoryMiB: number;
  maxCodegenDurationMs: number;
  scanRunner: typeof scan;
  journeyRunner: typeof runJourneyDefinition;
  codegenSpawner: SpawnProcess;
  codeRunner: HostedCodeRunner;
  hostedCodeRunner: HostedCodeRunner | undefined;
  operationalLogger: (event: OperationalEvent) => void;
}

function defaultOperationalLogger(event: OperationalEvent): void {
  console.log(JSON.stringify({ source: "qa-radar", ...event }));
}

const DEFAULT_OPTIONS: ServerOptions = {
  ...SERVER_OPTION_DEFAULTS,
  resultsDir: join(process.cwd(), "qa-radar-results"),
  allowPrivateTargets: false,
  allowCustomIgnorePatterns: false,
  rateLimitWindowMs: 60_000,
  trustProxy: false,
  turnstileSiteKey: undefined,
  turnstileSecretKey: undefined,
  allowHistory: false,
  allowJourneys: false,
  allowCodeMode: false,
  codeModeAdminToken: undefined,
  historyDir: join(process.cwd(), ".qa-radar-history"),
  maxJourneySteps: 20,
  maxJourneyPayloadBytes: 32 * 1024,
  maxJourneyDurationMs: 3 * 60_000,
  scanRunner: scan,
  journeyRunner: runJourneyDefinition,
  codegenSpawner: spawn,
  codeRunner: runPlaywrightCodeWorker,
  hostedCodeRunner: undefined,
  operationalLogger: defaultOperationalLogger,
};

const ROUTE_HANDLERS: RouteHandler[] = [tryHandlePages, tryHandleDashboardActivity, tryHandleCodegen, tryHandleCodeExecution, tryHandleLegacyJourneys, tryHandleScans, tryHandleHttpRequest];

/** Prefixo canônico da API. Mudanças que quebram clientes exigem `/api/v2`. */
export const API_V1_PREFIX = "/api/v1";
/** Alias pré-1.0 mantido por compatibilidade; ver política no README. */
export const UNVERSIONED_API_PREFIX = "/api";

export function createQaRadarServer(overrides: Partial<ServerOptions> = {}): Server {
  const config = { ...DEFAULT_OPTIONS, ...overrides };
  if (Boolean(config.turnstileSiteKey) !== Boolean(config.turnstileSecretKey)) {
    throw new Error("Configure TURNSTILE_SITE_KEY e TURNSTILE_SECRET_KEY em conjunto.");
  }
  if (!Number.isInteger(config.maxJobDurationMs) || config.maxJobDurationMs <= 0) {
    throw new Error("maxJobDurationMs deve ser um número inteiro positivo.");
  }
  if (!Number.isInteger(config.maxJourneySteps) || config.maxJourneySteps < 1 || config.maxJourneySteps > 50) {
    throw new Error("maxJourneySteps deve estar entre 1 e 50.");
  }
  if (!Number.isInteger(config.maxJourneyPayloadBytes) || config.maxJourneyPayloadBytes < 1) {
    throw new Error("maxJourneyPayloadBytes deve ser um número inteiro positivo.");
  }
  if (!Number.isInteger(config.maxJourneyDurationMs) || config.maxJourneyDurationMs < 1) {
    throw new Error("maxJourneyDurationMs deve ser um número inteiro positivo.");
  }
  if (!Number.isInteger(config.maxCodeExecutionDurationMs) || config.maxCodeExecutionDurationMs < 1) {
    throw new Error("maxCodeExecutionDurationMs deve ser um número inteiro positivo.");
  }
  if (!Number.isInteger(config.maxCodeOutputBytes) || config.maxCodeOutputBytes < 1) {
    throw new Error("maxCodeOutputBytes deve ser um número inteiro positivo.");
  }
  if (!Number.isInteger(config.maxCodeMemoryMiB) || config.maxCodeMemoryMiB < 1) {
    throw new Error("maxCodeMemoryMiB deve ser um número inteiro positivo.");
  }
  if (!Number.isInteger(config.maxCodegenDurationMs) || config.maxCodegenDurationMs < 1) {
    throw new Error("maxCodegenDurationMs deve ser um número inteiro positivo.");
  }
  if (config.codeModeAdminToken !== undefined && (Buffer.byteLength(config.codeModeAdminToken, "utf8") < 32 || Buffer.byteLength(config.codeModeAdminToken, "utf8") > 512)) {
    throw new Error("codeModeAdminToken deve ter entre 32 e 512 bytes.");
  }
  const codeModeAdminTokenHash = config.codeModeAdminToken ? tokenHash(config.codeModeAdminToken) : undefined;
  const jobQueue = new JobQueue();
  const rateLimiter = new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
  const legacyJourneys = new LegacyJourneyRegistry();
  const codegenSessions = new CodegenSessionStore();
  const codeExecutionJobs = new CodeExecutionJobStore();
  const dashboardActivity = new DashboardActivityStore(config.resultsDir);
  // Chaves de idempotência vivem tanto quanto os jobs que representam.
  const idempotencyKeys = new IdempotencyStore(config.retentionMs);

  const loadCodeExecutionJob = async (id: string): Promise<CodeExecutionJob | undefined> => {
    const memoryJob = codeExecutionJobs.get(id);
    if (memoryJob) return memoryJob;
    try {
      const directoryName = `code-${id}`;
      const saved = JSON.parse(await readFile(join(config.resultsDir, directoryName, "code-report.json"), "utf8")) as { status?: unknown; report?: unknown; failureDetails?: unknown };
      const accessTokenHash = await storedAccessHash(config.resultsDir, directoryName);
      if (saved.status !== "passed" && saved.status !== "failed") return undefined;
      if (!accessTokenHash) return undefined;
      return {
        id,
        outputDir: join(config.resultsDir, directoryName),
        status: saved.status,
        report: saved.report,
        accessTokenHash,
        ...(typeof saved.failureDetails === "string" ? { failureDetails: saved.failureDetails } : {}),
      };
    } catch {
      return undefined;
    }
  };

  const publicJourney = (report: JourneyRunResult): JourneyRunResult => ({
    ...report,
    steps: report.steps.map((step) => ({
      ...step,
      ...(step.evidence
        ? {
            evidence: {
              ...(step.evidence.before ? { before: basename(step.evidence.before) } : {}),
              ...(step.evidence.after ? { after: basename(step.evidence.after) } : {}),
            },
          }
        : {}),
    })),
  });

  const codeReportAsJourney = async (job: CodeExecutionJob): Promise<JourneyRunResult> => {
    const record = job.report && typeof job.report === "object" && !Array.isArray(job.report) ? (job.report as Record<string, unknown>) : {};
    const stats = record.stats && typeof record.stats === "object" && !Array.isArray(record.stats) ? (record.stats as Record<string, unknown>) : {};
    const durationMs = typeof stats.duration === "number" ? stats.duration : 0;
    const expected = typeof stats.expected === "number" ? stats.expected : 0;
    let source = "";
    try {
      source = await readFile(join(job.outputDir, "qa-radar.spec.ts"), "utf8");
    } catch {
      /* The report can still be generated from the JSON result. */
    }
    const sourceSteps: Array<{ action: "goto" | "click" | "fill" | "select" | "waitFor" | "assertVisible" | "assertText" | "apiRequest"; description: string }> = [];
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//")) continue;
      const goto = /\.goto\((['"`])(.+?)\1/.exec(line);
      const click = /(?:page|locator|[\w.]+)\.locator\((['"`])(.+?)\1\)\.click\(/.exec(line);
      const genericClick = /(.+)\.click\(/.exec(line);
      const fill = /\.locator\((['"`])(.+?)\1\)\.fill\(/.exec(line);
      const genericFill = /(.+)\.fill\(/.exec(line);
      const select = /\.locator\((['"`])(.+?)\1\)\.selectOption\(/.exec(line);
      const genericSelect = /(.+)\.selectOption\(/.exec(line);
      const visible = /expect\((.+?)\)\.toBeVisible\(/.exec(line);
      const text = /expect\((.+?)\)\.toHaveText\(/.exec(line);
      const wait = /\.waitFor\(/.exec(line);
      const apiRequest = /\brequest\.(get|post|put|patch|delete|head|fetch)\((['"`])(.+?)\2/.exec(line);
      // As variantes "genericas" cobrem localizadores como getByRole/getByLabel,
      // não só page.locator(...) — sem elas, o passo some do relatório mesmo
      // a ação tendo sido executada (e instrumentada) de verdade, e a
      // correlação com a screenshot capturada desalinha.
      if (goto) sourceSteps.push({ action: "goto", description: `Abrir página ${goto[2]}` });
      else if (click) sourceSteps.push({ action: "click", description: `Clicar em ${click[2]}` });
      else if (genericClick) sourceSteps.push({ action: "click", description: `Clicar em ${(genericClick[1] ?? line).trim()}` });
      else if (fill) sourceSteps.push({ action: "fill", description: `Preencher ${fill[2]}` });
      else if (genericFill) sourceSteps.push({ action: "fill", description: `Preencher ${(genericFill[1] ?? line).trim()}` });
      else if (select) sourceSteps.push({ action: "select", description: `Selecionar opção em ${select[2]}` });
      else if (genericSelect) sourceSteps.push({ action: "select", description: `Selecionar opção em ${(genericSelect[1] ?? line).trim()}` });
      else if (visible) sourceSteps.push({ action: "assertVisible", description: `Confirmar elemento visível: ${visible[1]}` });
      else if (text) sourceSteps.push({ action: "assertText", description: `Confirmar texto em ${text[1]}` });
      else if (wait) sourceSteps.push({ action: "waitFor", description: "Aguardar elemento" });
      else if (apiRequest) sourceSteps.push({ action: "apiRequest", description: `Requisição ${(apiRequest[1] ?? "").toUpperCase()} ${apiRequest[3]}` });
    }
    const stepDefinitions = sourceSteps.length > 0 ? sourceSteps : [{ action: "assertVisible" as const, description: `${expected} teste(s) executado(s)` }];
    const stepDuration = durationMs / stepDefinitions.length;
    let screenshotPath: string | undefined;
    let videoPath: string | undefined;
    const stepCaptures: string[] = [];
    try {
      const mediaFiles = await readdir(join(job.outputDir, "test-results"), { recursive: true });
      for (const relative of mediaFiles) {
        if (typeof relative !== "string") continue;
        const normalized = `test-results/${relative.replaceAll("\\", "/")}`;
        // O fixture qa-radar-fixtures.ts (src/code-step-fixtures.ts) grava uma
        // evidência real por ação em test-results/qa-radar-steps/ (screenshot
        // .png para passos de página, requisição/resposta .json para passos de
        // API), numeradas em ordem; tratadas à parte para não confundir com os
        // artefatos padrão do próprio Playwright (ex.: test-finished-1.png).
        if (normalized.startsWith("test-results/qa-radar-steps/")) continue;
        if (!screenshotPath && normalized.endsWith(".png")) screenshotPath = normalized;
        if (!videoPath && normalized.endsWith(".webm")) videoPath = normalized;
      }
      const stepFiles = await readdir(join(job.outputDir, "test-results", "qa-radar-steps"));
      stepCaptures.push(
        ...stepFiles
          .filter((name) => name.endsWith(".png") || name.endsWith(".json"))
          .sort((a, b) => a.localeCompare(b))
          .map((name) => `test-results/qa-radar-steps/${name}`),
      );
    } catch {
      /* A failed run may not produce media. */
    }
    // Só goto/click/fill/select/apiRequest correspondem a ações realmente
    // instrumentadas pelo fixture; waitFor/assertVisible/assertText nunca
    // disparam uma captura, então não avançam o cursor — senão a evidência N
    // ficaria associada ao passo errado sempre que uma asserção aparecesse no
    // meio.
    const CAPTURABLE_ACTIONS = new Set(["goto", "click", "fill", "select", "apiRequest"]);
    let captureCursor = 0;
    const steps = stepDefinitions.map((step, index) => {
      const isLastStep = index === stepDefinitions.length - 1;
      const capturable = CAPTURABLE_ACTIONS.has(step.action);
      const stepCapture = capturable ? stepCaptures[captureCursor] : undefined;
      if (capturable) captureCursor += 1;
      const isApiStep = step.action === "apiRequest";
      const image = isApiStep ? undefined : (stepCapture ?? (isLastStep ? screenshotPath : undefined));
      const api = isApiStep ? stepCapture : undefined;
      return {
        index,
        action: step.action,
        description: step.description,
        status: job.status === "passed" || index < stepDefinitions.length - 1 ? ("passed" as const) : ("failed" as const),
        durationMs: stepDuration,
        ...(job.status === "failed" && isLastStep && job.failureDetails ? { error: job.failureDetails } : {}),
        ...(image || api || (isLastStep && videoPath)
          ? {
              evidence: {
                ...(image ? { after: image } : {}),
                ...(api ? { api } : {}),
                ...(isLastStep && videoPath ? { video: { path: videoPath, startMs: 0, endMs: durationMs } } : {}),
              },
            }
          : {}),
      };
    });
    return {
      schemaVersion: "1.0",
      name: "Teste Playwright (.spec.ts)",
      status: job.status,
      startedAt: new Date(Date.now() - durationMs).toISOString(),
      durationMs,
      steps,
    };
  };

  const logOperational = (event: OperationalEvent): void => {
    try {
      config.operationalLogger(event);
    } catch {
      // Observability must never interrupt scanning or retention.
    }
  };

  const targetOrigin = (job: ScanJob): string => new URL(job.options.url).origin;
  const queueStats = () => jobQueue.stats();

  const resourceUsage = (startedAt: number, cpuStart: NodeJS.CpuUsage) => {
    const cpu = process.cpuUsage(cpuStart);
    const memory = process.memoryUsage();
    const toMiB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
    return {
      durationMs: Date.now() - startedAt,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      rssMiB: toMiB(memory.rss),
      heapUsedMiB: toMiB(memory.heapUsed),
      heapTotalMiB: toMiB(memory.heapTotal),
      externalMiB: toMiB(memory.external),
    };
  };

  const clientAddress = (request: IncomingMessage): string => {
    if (config.trustProxy) {
      const forwarded = request.headers["x-forwarded-for"];
      const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const first = value?.split(",")[0]?.trim();
      if (first) return first;
    }
    return request.socket.remoteAddress ?? "unknown";
  };
  const isLocalRequest = (request: IncomingMessage): boolean => {
    const address = clientAddress(request);
    return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  };
  const requireCodeModeEnabled = (response: ServerResponse): boolean => {
    if (!config.allowCodeMode) {
      jsonError(response, "feature_disabled", "Modo Jornada de Playwright está desabilitado neste ambiente.");
      return false;
    }
    return true;
  };
  const requireCodeModeCreation = (request: IncomingMessage, response: ServerResponse, allowRemoteAdmin: boolean): boolean => {
    if (!requireCodeModeEnabled(response)) return false;
    if (isLocalRequest(request)) return true;
    if (!allowRemoteAdmin || !codeModeAdminTokenHash) {
      jsonError(response, "feature_disabled", "A execução hospedada do Modo Jornada de Playwright ainda não está habilitada neste servidor.");
      return false;
    }
    const token = bearerToken(request);
    if (token && tokenMatches(token, codeModeAdminTokenHash)) return true;
    jsonError(response, token ? "forbidden" : "unauthorized", "Token administrativo do Modo Jornada ausente ou inválido.", {
      "www-authenticate": 'Bearer realm="QA Radar code mode"',
    });
    return false;
  };

  const consumeRateLimit = (request: IncomingMessage, response: ServerResponse): boolean => {
    const decision = rateLimiter.consume(clientAddress(request));
    response.setHeader("x-ratelimit-limit", decision.limit);
    response.setHeader("x-ratelimit-remaining", decision.remaining);
    response.setHeader("x-ratelimit-reset", Math.ceil(decision.resetAt / 1000));
    if (decision.allowed) return true;
    jsonError(response, "rate_limited", "Muitas análises solicitadas. Aguarde antes de tentar novamente.", {
      "retry-after": decision.retryAfterSeconds ?? 1,
    });
    return false;
  };

  const expireJob = (job: ScanJob): void => {
    const timer = setTimeout(() => {
      jobQueue.delete(job.id);
      void rm(job.options.outputDir, { recursive: true, force: true }).finally(() => {
        logOperational({
          event: "scan.expired",
          timestamp: new Date().toISOString(),
          jobId: job.id,
          targetOrigin: targetOrigin(job),
          ...queueStats(),
        });
      });
    }, config.retentionMs);
    timer.unref();
  };

  const expireJourney = (job: JourneyJob): void => {
    const timer = setTimeout(() => {
      legacyJourneys.delete(job.id);
      void rm(job.outputDir, { recursive: true, force: true });
    }, config.retentionMs);
    timer.unref();
  };

  const expireCodegen = (session: CodegenSession): void => {
    const timer = setTimeout(() => {
      codegenSessions.delete(session.id);
      void rm(session.outputDir, { recursive: true, force: true });
    }, config.retentionMs);
    timer.unref();
  };

  const expireCodeExecution = (job: CodeExecutionJob): void => {
    const timer = setTimeout(() => {
      codeExecutionJobs.delete(job.id);
      void rm(job.outputDir, { recursive: true, force: true });
    }, config.retentionMs);
    timer.unref();
  };

  const schedule = (): void => {
    for (;;) {
      const job = jobQueue.takeNext(config.concurrency);
      if (!job) return;
      const startedAt = Date.now();
      const cpuStart = process.cpuUsage();
      const deadline = setTimeout(() => {
        job.controller.abort(new Error(`A análise excedeu o limite global de ${config.maxJobDurationMs} ms.`));
      }, config.maxJobDurationMs);
      deadline.unref();
      logOperational({
        event: "scan.started",
        timestamp: new Date(startedAt).toISOString(),
        jobId: job.id,
        targetOrigin: targetOrigin(job),
        ...queueStats(),
        browser: job.options.browser,
        sitemap: Boolean(job.options.sitemap),
        ...(job.options.sitemap && job.options.maxPages !== undefined ? { maxPages: job.options.maxPages } : {}),
        screenshot: job.options.screenshot,
        failOn: job.options.failOn,
        timeoutMs: job.options.timeoutMs,
        settleMs: job.options.settleMs,
      });
      void (async () => {
        let outcome: TerminalJobStatus = "failed";
        try {
          const automaticBaseline = job.options.baselinePath ? undefined : await findHistoryBaseline(job.options);
          const effectiveOptions = automaticBaseline ? { ...job.options, baselinePath: automaticBaseline } : job.options;
          const control = {
            signal: job.controller.signal,
            onProgress: (progress: ScanProgress): void => {
              job.progress = {
                ...progress,
                ...(job.progress.stage ? { stage: job.progress.stage } : {}),
              };
            },
            onStage: (stage: NonNullable<ScanProgress["stage"]>): void => {
              job.progress = { ...job.progress, stage };
            },
          };
          if (!effectiveOptions.sitemap) {
            job.progress = { discoveredPages: 1, completedPages: 0, currentUrl: effectiveOptions.url, percent: 0 };
          }
          job.report = effectiveOptions.sitemap ? await scanSitemap(effectiveOptions, control) : await config.scanRunner(effectiveOptions, control);
          job.controller.signal.throwIfAborted();
          job.progress = { ...job.progress, stage: "writing-reports" };
          await writeReports(job.report, job.options);
          job.controller.signal.throwIfAborted();
          await storeRun(job.report, effectiveOptions);
          job.controller.signal.throwIfAborted();
          job.progress = {
            discoveredPages: job.progress.discoveredPages || 1,
            completedPages: job.progress.discoveredPages || 1,
            currentUrl: undefined,
            percent: 100,
            stage: "completed",
          };
          outcome = "completed";
        } catch (error) {
          if (job.cancelRequested) {
            outcome = "cancelled";
            job.error = undefined;
            job.progress = { ...job.progress, currentUrl: undefined, stage: "cancelled" };
          } else {
            outcome = "failed";
            const failure = job.controller.signal.aborted ? job.controller.signal.reason : error;
            job.error = failure instanceof Error ? failure.message : String(failure);
          }
        } finally {
          // A transição terminal acontece uma vez só, aqui, e não em dois
          // ramos separados: assim a máquina de estados vê exatamente uma
          // saída de "running" por execução.
          transitionJob(job, outcome);
          clearTimeout(deadline);
          const usage = resourceUsage(startedAt, cpuStart);
          logOperational({
            event: job.status === "completed" ? "scan.completed" : job.status === "cancelled" ? "scan.cancelled" : "scan.failed",
            timestamp: new Date().toISOString(),
            jobId: job.id,
            targetOrigin: targetOrigin(job),
            ...queueStats(),
            ...usage,
            ...(job.report
              ? {
                  passed: job.report.passed,
                  errors: job.report.summary.errors,
                  warnings: job.report.summary.warnings,
                }
              : {}),
            ...(job.error ? { error: job.error } : {}),
          });
          jobQueue.finish();
          expireJob(job);
          schedule();
        }
      })();
    }
  };

  const context: RequestContext = {
    config,
    jobQueue,
    legacyJourneys,
    codegenSessions,
    codeExecutionJobs,
    dashboardActivity,
    idempotencyKeys,
    apiPrefix: UNVERSIONED_API_PREFIX,
    queueStats,
    schedule,
    consumeRateLimit,
    clientAddress,
    isLocalRequest,
    requireCodeModeEnabled,
    requireCodeModeCreation,
    logOperational,
    targetOrigin,
    expireJob,
    expireJourney,
    expireCodegen,
    expireCodeExecution,
    loadCodeExecutionJob,
    codeReportAsJourney,
    publicJourney,
  };

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      // O prefixo versionado é retirado antes do despacho, então cada rota
      // continua casando um caminho só. O que a rota não pode ignorar é qual
      // prefixo o cliente usou: caminho de cookie e URL devolvida precisam
      // acompanhá-lo, senão quem chama /api/v1 recebe um cookie preso em /api
      // e perde o acesso ao próprio resultado.
      let apiPrefix = UNVERSIONED_API_PREFIX;
      if (url.pathname === API_V1_PREFIX || url.pathname.startsWith(`${API_V1_PREFIX}/`)) {
        apiPrefix = API_V1_PREFIX;
        url.pathname = `${UNVERSIONED_API_PREFIX}${url.pathname.slice(API_V1_PREFIX.length)}`;
      }
      const requestContext: RequestContext = apiPrefix === UNVERSIONED_API_PREFIX ? context : { ...context, apiPrefix };
      for (const handler of ROUTE_HANDLERS) {
        if (await handler(requestContext, request, response, url)) return;
      }
      jsonError(response, "not_found", "Rota não encontrada.");
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === "internal_error") {
        // Falha não prevista: o cliente recebe mensagem genérica, mas ela não
        // pode desaparecer. Vai para o stderr em vez do operationalLogger
        // porque OperationalEvent descreve o ciclo de vida de uma análise e
        // exige jobId/targetOrigin, que não existem aqui.
        console.error(
          JSON.stringify({
            source: "qa-radar",
            event: "request.failed",
            timestamp: new Date().toISOString(),
            method: request.method,
            path: request.url,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }),
        );
      }
      // Uma resposta já iniciada (ex.: falha ao ler um artefato em streaming)
      // não pode receber outro writeHead: isso lançaria dentro do catch.
      if (response.headersSent) {
        response.end();
        return;
      }
      jsonError(response, apiError);
    }
  });
}
