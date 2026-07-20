import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCli } from "./cli.js";
import { writeReports } from "./reporters.js";
import { scan } from "./scanner.js";
import type { ScanOptions, ScanReport } from "./types.js";
import { createWebPage } from "./web-page.js";
import { assertPublicUrl } from "./security.js";
import { findHistoryBaseline, listProjectHistory, storeRun } from "./history.js";
import { scanSitemap } from "./suite.js";

type JobStatus = "queued" | "running" | "completed" | "failed";

interface ScanJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  options: ScanOptions;
  report: ScanReport | undefined;
  error: string | undefined;
}

export interface OperationalEvent {
  event: "scan.started" | "scan.completed" | "scan.failed" | "scan.expired";
  timestamp: string;
  jobId: string;
  targetOrigin: string;
  active: number;
  queued: number;
  jobs: number;
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
  trustProxy: boolean;
  turnstileSiteKey: string | undefined;
  turnstileSecretKey: string | undefined;
  allowHistory: boolean;
  historyDir: string;
  maxSitemapPages: number;
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
  trustProxy: false,
  turnstileSiteKey: undefined,
  turnstileSecretKey: undefined,
  allowHistory: false,
  historyDir: join(process.cwd(), ".qa-radar-history"),
  maxSitemapPages: 20,
  operationalLogger: defaultOperationalLogger,
};

interface RateEntry {
  count: number;
  resetAt: number;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
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
  if (body.regressionsOnly === true) args.push("--regressions-only");
  if (body.acceptBaseline === true) args.push("--accept-baseline");
  if (textField(body, "project")) args.push("--history-dir", config.historyDir);
  const parsed = parseCli(args);
  if (!parsed.options) throw new Error("Não foi possível preparar a análise.");
  const options = parsed.options;
  if (options.timeoutMs > 120_000) throw new Error("O timeout máximo é 120000 ms.");
  if (options.settleMs > 30_000) throw new Error("O tempo de observação máximo é 30000 ms.");
  if ((options.maxPages ?? 20) > config.maxSitemapPages) {
    throw new Error(`O limite de páginas neste servidor é ${config.maxSitemapPages}.`);
  }
  if (options.project && !config.allowHistory) {
    throw new Error("Histórico por projeto está desabilitado neste servidor.");
  }
  return options;
}

function publicJob(job: ScanJob): Record<string, unknown> {
  const report = job.report
    ? { ...job.report, screenshotPath: job.report.screenshotPath ? "screenshot.png" : undefined }
    : undefined;
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    report,
    error: job.error,
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
  const jobs = new Map<string, ScanJob>();
  const rateLimits = new Map<string, RateEntry>();
  const queue: string[] = [];
  let active = 0;

  const logOperational = (event: OperationalEvent): void => {
    try {
      config.operationalLogger(event);
    } catch {
      // Observability must never interrupt scanning or retention.
    }
  };

  const targetOrigin = (job: ScanJob): string => new URL(job.options.url).origin;

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
    const now = Date.now();
    if (rateLimits.size > 10_000) {
      for (const [address, candidate] of rateLimits) {
        if (candidate.resetAt <= now) rateLimits.delete(address);
      }
    }
    const key = clientAddress(request);
    let entry = rateLimits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + config.rateLimitWindowMs };
      rateLimits.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(config.rateLimitMax - entry.count, 0);
    response.setHeader("x-ratelimit-limit", config.rateLimitMax);
    response.setHeader("x-ratelimit-remaining", remaining);
    response.setHeader("x-ratelimit-reset", Math.ceil(entry.resetAt / 1000));
    if (entry.count <= config.rateLimitMax) return true;
    response.setHeader("retry-after", Math.max(Math.ceil((entry.resetAt - now) / 1000), 1));
    json(response, 429, { error: "Muitas análises solicitadas. Aguarde antes de tentar novamente." });
    return false;
  };

  const expireJob = (job: ScanJob): void => {
    const timer = setTimeout(() => {
      jobs.delete(job.id);
      void rm(job.options.outputDir, { recursive: true, force: true }).finally(() => {
        logOperational({
          event: "scan.expired",
          timestamp: new Date().toISOString(),
          jobId: job.id,
          targetOrigin: targetOrigin(job),
          active,
          queued: queue.length,
          jobs: jobs.size,
        });
      });
    }, config.retentionMs);
    timer.unref();
  };

  const schedule = (): void => {
    while (active < config.concurrency) {
      const id = queue.shift();
      if (!id) return;
      const job = jobs.get(id);
      if (!job) continue;
      active += 1;
      job.status = "running";
      const startedAt = Date.now();
      const cpuStart = process.cpuUsage();
      logOperational({
        event: "scan.started",
        timestamp: new Date(startedAt).toISOString(),
        jobId: job.id,
        targetOrigin: targetOrigin(job),
        active,
        queued: queue.length,
        jobs: jobs.size,
      });
      void (async () => {
        try {
          const automaticBaseline = job.options.baselinePath ? undefined : await findHistoryBaseline(job.options);
          const effectiveOptions = automaticBaseline ? { ...job.options, baselinePath: automaticBaseline } : job.options;
          job.report = effectiveOptions.sitemap ? await scanSitemap(effectiveOptions) : await scan(effectiveOptions);
          await writeReports(job.report, job.options);
          await storeRun(job.report, effectiveOptions);
          job.status = "completed";
        } catch (error) {
          job.status = "failed";
          job.error = error instanceof Error ? error.message : String(error);
        } finally {
          const usage = resourceUsage(startedAt, cpuStart);
          logOperational({
            event: job.status === "completed" ? "scan.completed" : "scan.failed",
            timestamp: new Date().toISOString(),
            jobId: job.id,
            targetOrigin: targetOrigin(job),
            active,
            queued: queue.length,
            jobs: jobs.size,
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
          active -= 1;
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
          active,
          queued: queue.length,
          jobs: jobs.size,
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
          "content-security-policy": `default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${turnstileSources}; frame-src 'self'${turnstileSources}; img-src 'self' data: blob:; connect-src 'self'${turnstileSources}`,
        });
        response.end(createWebPage(config.turnstileSiteKey, config.allowHistory, config.maxSitemapPages));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/scans") {
        if (!consumeRateLimit(request, response)) return;
        if (queue.length + active >= config.maxQueueSize) {
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
        const job: ScanJob = {
          id,
          status: "queued",
          createdAt: new Date().toISOString(),
          options,
          report: undefined,
          error: undefined,
        };
        jobs.set(id, job);
        queue.push(id);
        schedule();
        json(response, 202, publicJob(job));
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
        const job = jobs.get(id);
        if (!artifact) {
          if (job) {
            json(response, 200, publicJob(job));
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
