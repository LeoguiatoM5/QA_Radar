import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { parseCli } from "./cli.js";
import { writeReports } from "./reporters.js";
import { scan } from "./scanner.js";
import type { ScanOptions, ScanProgress, ScanReport } from "./types.js";
import { createWebPage } from "./web-page.js";
import { assertPublicUrl } from "./security.js";
import { findHistoryBaseline, listProjectHistory, storeRun } from "./history.js";
import { scanSitemap } from "./suite.js";
import { JobQueue, type ScanJob } from "./job-queue.js";
import { RateLimiter } from "./rate-limit.js";
import { runJourneyDefinition } from "./journey-cli.js";
import type { JourneyRunResult } from "./journey-runner.js";
import { parseJourney } from "./journey.js";
import { createJourneyEvidenceHtml, parseJourneyEvidenceMetadata } from "./journey-evidence-report.js";

type JourneyJobStatus = "running" | "completed" | "failed" | "cancelled";

interface JourneyJob {
  id: string;
  status: JourneyJobStatus;
  createdAt: string;
  outputDir: string;
  accessTokenHash: string;
  controller: AbortController;
  cancelRequested: boolean;
  report?: JourneyRunResult;
  error?: string;
}

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
  allowCustomIgnorePatterns: boolean;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  retentionMs: number;
  maxJobDurationMs: number;
  trustProxy: boolean;
  turnstileSiteKey: string | undefined;
  turnstileSecretKey: string | undefined;
  allowHistory: boolean;
  allowJourneys: boolean;
  historyDir: string;
  maxSitemapPages: number;
  maxJourneySteps: number;
  maxJourneyPayloadBytes: number;
  maxJourneyDurationMs: number;
  scanRunner: typeof scan;
  journeyRunner: typeof runJourneyDefinition;
  operationalLogger: (event: OperationalEvent) => void;
}

function defaultOperationalLogger(event: OperationalEvent): void {
  console.log(JSON.stringify({ source: "qa-radar", ...event }));
}

const DEFAULT_OPTIONS: ServerOptions = {
  resultsDir: join(process.cwd(), "qa-radar-results"),
  concurrency: 2,
  maxQueueSize: 20,
  allowPrivateTargets: false,
  allowCustomIgnorePatterns: false,
  rateLimitMax: 10,
  rateLimitWindowMs: 60_000,
  retentionMs: 60 * 60_000,
  maxJobDurationMs: 5 * 60_000,
  trustProxy: false,
  turnstileSiteKey: undefined,
  turnstileSecretKey: undefined,
  allowHistory: false,
  allowJourneys: false,
  historyDir: join(process.cwd(), ".qa-radar-history"),
  maxSitemapPages: 20,
  maxJourneySteps: 20,
  maxJourneyPayloadBytes: 32 * 1024,
  maxJourneyDurationMs: 3 * 60_000,
  scanRunner: scan,
  journeyRunner: runJourneyDefinition,
  operationalLogger: defaultOperationalLogger,
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(JSON.stringify(body));
}

const ACCESS_HASH_FILE = ".access-token.sha256";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function requestToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim() || undefined;
  const cookie = request.headers.cookie?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("qa_radar_access="));
  return cookie ? decodeURIComponent(cookie.slice("qa_radar_access=".length)) : undefined;
}

function requireAccess(request: IncomingMessage, response: ServerResponse, expectedHash: string): boolean {
  const token = requestToken(request);
  if (token && tokenMatches(token, expectedHash)) return true;
  response.setHeader("www-authenticate", 'Bearer realm="QA Radar report"');
  json(response, token ? 403 : 401, { error: "Token de acesso da análise ausente ou inválido." });
  return false;
}

function accessCookie(request: IncomingMessage, path: string, token: string, retentionMs: number, trustProxy: boolean): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const secure = Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted) ||
    (trustProxy && forwardedProto === "https");
  return `qa_radar_access=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=${path}; Max-Age=${Math.ceil(retentionMs / 1000)}${secure ? "; Secure" : ""}`;
}

async function storedAccessHash(resultsDir: string, id: string): Promise<string | undefined> {
  try {
    const value = (await readFile(join(resultsDir, id, ACCESS_HASH_FILE), "utf8")).trim();
    return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("Requisição muito grande.");
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("Corpo JSON inválido.");
  }
}

function textField(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function scanOptions(body: Record<string, unknown>, outputDir: string, config: ServerOptions): ScanOptions {
  const url = textField(body, "url");
  if (!url) throw new Error("Informe a URL da aplicação.");
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
  const parsed = parseCli(args);
  if (!parsed.options) throw new Error("Não foi possível preparar a análise.");
  const options = parsed.options;
  if (options.timeoutMs > 120_000) throw new Error("O timeout máximo é 120000 ms.");
  if (options.settleMs > 30_000) throw new Error("O tempo de observação máximo é 30000 ms.");
  if (options.sitemap && (options.maxPages ?? 20) > config.maxSitemapPages) {
    throw new Error(`O limite de páginas neste servidor é ${config.maxSitemapPages}.`);
  }
  if (options.project && !config.allowHistory) {
    throw new Error("Histórico por projeto está desabilitado neste servidor.");
  }
  return options;
}

function publicJob(job: ScanJob, queuePosition?: number): Record<string, unknown> {
  const report = job.report
    ? { ...job.report, screenshotPath: job.report.screenshotPath ? "screenshot.png" : undefined }
    : undefined;
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
  const jobQueue = new JobQueue();
  const rateLimiter = new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
  let journeyActive = false;
  const journeyJobs = new Map<string, JourneyJob>();

  const publicJourney = (report: JourneyRunResult): JourneyRunResult => ({
    ...report,
    steps: report.steps.map((step) => ({
      ...step,
      ...(step.evidence ? {
        evidence: { before: basename(step.evidence.before), after: basename(step.evidence.after) },
      } : {}),
    })),
  });

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

  const consumeRateLimit = (request: IncomingMessage, response: ServerResponse): boolean => {
    const decision = rateLimiter.consume(clientAddress(request));
    response.setHeader("x-ratelimit-limit", decision.limit);
    response.setHeader("x-ratelimit-remaining", decision.remaining);
    response.setHeader("x-ratelimit-reset", Math.ceil(decision.resetAt / 1000));
    if (decision.allowed) return true;
    response.setHeader("retry-after", decision.retryAfterSeconds ?? 1);
    json(response, 429, { error: "Muitas análises solicitadas. Aguarde antes de tentar novamente." });
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
      journeyJobs.delete(job.id);
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
        ...(job.options.sitemap && job.options.maxPages !== undefined
          ? { maxPages: job.options.maxPages }
          : {}),
        screenshot: job.options.screenshot,
        failOn: job.options.failOn,
        timeoutMs: job.options.timeoutMs,
        settleMs: job.options.settleMs,
      });
      void (async () => {
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
          job.report = effectiveOptions.sitemap
            ? await scanSitemap(effectiveOptions, control)
            : await config.scanRunner(effectiveOptions, control);
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
          job.status = "completed";
        } catch (error) {
          if (job.cancelRequested) {
            job.status = "cancelled";
            job.error = undefined;
            job.progress = { ...job.progress, currentUrl: undefined, stage: "cancelled" };
          } else {
            job.status = "failed";
            const failure = job.controller.signal.aborted ? job.controller.signal.reason : error;
            job.error = failure instanceof Error ? failure.message : String(failure);
          }
        } finally {
          clearTimeout(deadline);
          const usage = resourceUsage(startedAt, cpuStart);
          logOperational({
            event: job.status === "completed"
              ? "scan.completed"
              : job.status === "cancelled" ? "scan.cancelled" : "scan.failed",
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

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, {
          status: "ok",
          ...queueStats(),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/history") {
        if (!config.allowHistory) {
          json(response, 403, { error: "Histórico está desabilitado neste servidor." });
          return;
        }
        const project = url.searchParams.get("project")?.trim();
        const environment = url.searchParams.get("environment")?.trim();
        if (!project || !environment) {
          json(response, 400, { error: "Informe projeto e ambiente para consultar o histórico." });
          return;
        }
        json(response, 200, await listProjectHistory(config.historyDir, project, environment));
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        const turnstileSources = config.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "permissions-policy": "camera=(), microphone=(), geolocation=()",
          "content-security-policy": `default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${turnstileSources}; frame-src 'self'${turnstileSources}; img-src 'self' data: blob:; connect-src 'self'${turnstileSources}`,
        });
        response.end(createWebPage(config.turnstileSiteKey, config.allowHistory, config.maxSitemapPages, config.allowJourneys));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/journeys") {
        if (!config.allowJourneys) {
          json(response, 403, { error: "Jornadas estão desabilitadas neste servidor." });
          return;
        }
        if (!consumeRateLimit(request, response)) return;
        const stats = queueStats();
        if (journeyActive || stats.active > 0 || stats.queued > 0) {
          json(response, 429, { error: "Já existe uma execução usando o navegador neste servidor." });
          return;
        }
        const body = await readJson(request);
        const definition = body.journey;
        if (!definition) throw new Error("Informe a definição da jornada.");
        const payloadBytes = Buffer.byteLength(JSON.stringify(definition), "utf8");
        if (payloadBytes > config.maxJourneyPayloadBytes) {
          throw new Error(`A definição da jornada deve ter no máximo ${config.maxJourneyPayloadBytes} bytes.`);
        }
        const parsedDefinition = parseJourney(definition);
        if (parsedDefinition.steps.length > config.maxJourneySteps) {
          throw new Error(`A jornada deve ter no máximo ${config.maxJourneySteps} passos neste servidor.`);
        }
        const id = randomUUID();
        const outputDir = join(config.resultsDir, `journey-${id}`);
        const options = scanOptions(body, outputDir, config);
        if (!config.allowPrivateTargets) {
          await assertPublicUrl(options.url);
          options.publicNetworkOnly = true;
        }
        const accessToken = randomBytes(32).toString("base64url");
        const accessTokenHash = tokenHash(accessToken);
        await mkdir(outputDir, { recursive: true });
        await writeFile(join(outputDir, ACCESS_HASH_FILE), `${accessTokenHash}\n`, { encoding: "utf8", mode: 0o600 });
        const job: JourneyJob = {
          id,
          status: "running",
          createdAt: new Date().toISOString(),
          outputDir,
          accessTokenHash,
          controller: new AbortController(),
          cancelRequested: false,
        };
        journeyJobs.set(id, job);
        journeyActive = true;
        const deadline = setTimeout(() => {
          job.controller.abort(new Error(`A jornada excedeu o limite global de ${config.maxJourneyDurationMs} ms.`));
        }, config.maxJourneyDurationMs);
        deadline.unref();
        void (async () => {
          try {
            const result = await config.journeyRunner(options, parsedDefinition, process.env, job.controller.signal);
            job.controller.signal.throwIfAborted();
            job.report = publicJourney(result.report);
            await writeFile(join(outputDir, "journey-report.json"), `${JSON.stringify(job.report, null, 2)}\n`, "utf8");
            job.controller.signal.throwIfAborted();
            job.status = "completed";
          } catch (error) {
            if (job.cancelRequested) {
              job.status = "cancelled";
              delete job.error;
            } else {
              job.status = "failed";
              const failure = job.controller.signal.aborted ? job.controller.signal.reason : error;
              job.error = failure instanceof Error ? failure.message : String(failure);
            }
          } finally {
            clearTimeout(deadline);
            journeyActive = false;
            expireJourney(job);
          }
        })();
        response.setHeader("set-cookie", accessCookie(request, "/api/journeys", accessToken, config.retentionMs, config.trustProxy));
        json(response, 202, { id, status: job.status, createdAt: job.createdAt, accessToken });
        return;
      }

      const journeyCancel = /^\/api\/journeys\/([0-9a-f-]+)\/cancel$/.exec(url.pathname);
      if (request.method === "POST" && journeyCancel) {
        const id = journeyCancel[1];
        const job = id ? journeyJobs.get(id) : undefined;
        if (!job) {
          json(response, 404, { error: "Jornada não encontrada ou já expirada." });
          return;
        }
        if (!requireAccess(request, response, job.accessTokenHash)) return;
        if (job.status !== "running") {
          json(response, 409, { error: "A jornada já foi finalizada." });
          return;
        }
        job.cancelRequested = true;
        job.controller.abort(new Error("Jornada cancelada pelo usuário."));
        json(response, 202, { id: job.id, status: "cancelled" });
        return;
      }

      const journeyStatus = /^\/api\/journeys\/([0-9a-f-]+)$/.exec(url.pathname);
      if (request.method === "GET" && journeyStatus) {
        if (!config.allowJourneys) {
          json(response, 403, { error: "Jornadas estão desabilitadas neste servidor." });
          return;
        }
        const id = journeyStatus[1];
        const job = id ? journeyJobs.get(id) : undefined;
        if (!job) {
          json(response, 404, { error: "Jornada não encontrada ou já expirada." });
          return;
        }
        if (!requireAccess(request, response, job.accessTokenHash)) return;
        json(response, 200, {
          id: job.id,
          status: job.status,
          createdAt: job.createdAt,
          ...(job.report ? { report: job.report } : {}),
          ...(job.error ? { error: job.error } : {}),
        });
        return;
      }

      const journeyEvidenceReport = /^\/api\/journeys\/([0-9a-f-]+)\/evidence-report$/.exec(url.pathname);
      if (request.method === "POST" && journeyEvidenceReport) {
        if (!config.allowJourneys) {
          json(response, 403, { error: "Jornadas estão desabilitadas neste servidor." });
          return;
        }
        const id = journeyEvidenceReport[1];
        const job = id ? journeyJobs.get(id) : undefined;
        if (!job) {
          json(response, 404, { error: "Jornada não encontrada ou já expirada." });
          return;
        }
        if (!requireAccess(request, response, job.accessTokenHash)) return;
        if (job.status !== "completed" || !job.report) {
          json(response, 409, { error: "A jornada precisa estar concluída para gerar evidências." });
          return;
        }
        const metadata = parseJourneyEvidenceMetadata(await readJson(request));
        const html = createJourneyEvidenceHtml(job.report, metadata);
        await writeFile(join(job.outputDir, "journey-evidence.html"), html, "utf8");
        json(response, 201, { url: `/api/journeys/${id}/journey-evidence.html` });
        return;
      }

      const journeyArtifact = /^\/api\/journeys\/([0-9a-f-]+)\/(journey-report\.json|journey-evidence\.html|[0-9]{3}-[a-zA-Z]+-(?:before|after)\.png)$/.exec(url.pathname);
      if (request.method === "GET" && journeyArtifact) {
        if (!config.allowJourneys) {
          json(response, 403, { error: "Jornadas estão desabilitadas neste servidor." });
          return;
        }
        const id = journeyArtifact[1];
        const name = journeyArtifact[2];
        if (!id || !name) throw new Error("Evidência inválida.");
        const job = journeyJobs.get(id);
        const expectedHash = job?.accessTokenHash ?? await storedAccessHash(config.resultsDir, `journey-${id}`);
        if (!expectedHash) {
          json(response, 404, { error: "Jornada não encontrada ou já expirada." });
          return;
        }
        if (!requireAccess(request, response, expectedHash)) return;
        if (job?.status === "running") {
          json(response, 409, { error: "A jornada ainda não foi concluída." });
          return;
        }
        const path = name === "journey-report.json" || name === "journey-evidence.html"
          ? join(config.resultsDir, `journey-${id}`, name)
          : join(config.resultsDir, `journey-${id}`, "journey-evidence", name);
        const content = await readFile(path);
        response.writeHead(200, {
          "content-type": name.endsWith(".json")
            ? "application/json; charset=utf-8"
            : name.endsWith(".html") ? "text/html; charset=utf-8" : "image/png",
          "content-length": content.length,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
          ...(name.endsWith(".html") ? {
            "content-security-policy": "sandbox allow-popups allow-same-origin; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
          } : {}),
        });
        response.end(content);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/scans") {
        if (journeyActive) {
          json(response, 429, { error: "Já existe uma jornada usando o navegador neste servidor." });
          return;
        }
        if (!consumeRateLimit(request, response)) return;
        const stats = queueStats();
        if (stats.queued + stats.active >= config.maxQueueSize) {
          json(response, 429, { error: "O serviço está ocupado. Tente novamente em alguns instantes." });
          return;
        }
        const body = await readJson(request);
        if (config.turnstileSecretKey) {
          const token = textField(body, "cf-turnstile-response");
          if (!token || token.length > 2048) throw new Error("Conclua a verificação de segurança.");
          const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              secret: config.turnstileSecretKey,
              response: token,
              remoteip: clientAddress(request),
              idempotency_key: randomUUID(),
            }),
          });
          const result = await verification.json() as { success?: boolean };
          if (!verification.ok || !result.success) throw new Error("A verificação de segurança expirou ou é inválida. Tente novamente.");
        }
        if (!config.allowCustomIgnorePatterns && textField(body, "ignoredUrl")) {
          throw new Error("Filtros regex personalizados estão desabilitados neste servidor.");
        }
        const id = randomUUID();
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
        jobQueue.enqueue(job);
        schedule();
        response.setHeader("set-cookie", accessCookie(request, `/api/scans/${id}`, accessToken, config.retentionMs, config.trustProxy));
        json(response, 202, { ...publicJob(job, jobQueue.position(job.id)), accessToken });
        return;
      }

      const cancelMatch = /^\/api\/scans\/([0-9a-f-]+)\/cancel$/.exec(url.pathname);
      if (request.method === "POST" && cancelMatch) {
        const id = cancelMatch[1];
        const job = id ? jobQueue.get(id) : undefined;
        if (!job) {
          json(response, 404, { error: "Análise não encontrada ou já expirada." });
          return;
        }
        if (!requireAccess(request, response, job.accessTokenHash)) return;
        if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
          json(response, 409, { error: "A análise já foi finalizada." });
          return;
        }
        job.cancelRequested = true;
        job.controller.abort(new Error("Análise cancelada pelo usuário."));
        if (jobQueue.cancelQueued(job.id)) {
          job.progress = { ...job.progress, stage: "cancelled" };
          expireJob(job);
          logOperational({
            event: "scan.cancelled",
            timestamp: new Date().toISOString(),
            jobId: job.id,
            targetOrigin: targetOrigin(job),
            ...queueStats(),
          });
        }
        json(response, 202, publicJob(job, jobQueue.position(job.id)));
        return;
      }

      const match = /^\/api\/scans\/([0-9a-f-]+)(?:\/((?:pages\/[a-z0-9-]+\/)?(?:report\.html|report\.json|report\.junit\.xml|report\.sarif\.json|screenshot\.png)))?$/.exec(url.pathname);
      if (request.method === "GET" && match) {
        const id = match[1];
        const artifact = match[2];
        if (!id) {
          json(response, 404, { error: "Análise não encontrada." });
          return;
        }
        const job = jobQueue.get(id);
        const expectedHash = job?.accessTokenHash ?? await storedAccessHash(config.resultsDir, id);
        if (!expectedHash) {
          json(response, 404, { error: "Análise não encontrada ou já expirada." });
          return;
        }
        if (!requireAccess(request, response, expectedHash)) return;
        if (!artifact) {
          if (job) {
            json(response, 200, publicJob(job, jobQueue.position(job.id)));
            return;
          }
          const recovered = await recoveredJob(config.resultsDir, id);
          if (recovered) {
            json(response, 200, recovered);
            return;
          }
          json(response, 404, { error: "Análise não encontrada ou já expirada." });
          return;
        }
        if (job && job.status !== "completed") {
          json(response, 409, { error: "A análise ainda não foi concluída." });
          return;
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
          ...(artifact.endsWith(".html") ? {
            "content-security-policy": "default-src 'none'; base-uri 'none'; img-src data: blob: 'self'; style-src 'unsafe-inline'; sandbox allow-same-origin",
          } : {}),
        });
        response.end(content);
        return;
      }

      json(response, 404, { error: "Rota não encontrada." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      json(response, status, { error: message });
    }
  });
}
