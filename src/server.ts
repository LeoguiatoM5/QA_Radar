import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCli } from "./cli.js";
import { writeReports } from "./reporters.js";
import { scan } from "./scanner.js";
import type { ScanOptions, ScanReport } from "./types.js";
import { createWebPage } from "./web-page.js";
import { assertPublicUrl } from "./security.js";

type JobStatus = "queued" | "running" | "completed" | "failed";

interface ScanJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  options: ScanOptions;
  report: ScanReport | undefined;
  error: string | undefined;
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

function scanOptions(body: Record<string, unknown>, outputDir: string): ScanOptions {
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
  ];
  for (const [name, value] of fields) {
    if (value) args.push(name, value);
  }
  const parsed = parseCli(args);
  if (!parsed.options) throw new Error("Não foi possível preparar a análise.");
  const options = parsed.options;
  if (options.timeoutMs > 120_000) throw new Error("O timeout máximo é 120000 ms.");
  if (options.settleMs > 30_000) throw new Error("O tempo de observação máximo é 30000 ms.");
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

export function createQaRadarServer(overrides: Partial<ServerOptions> = {}): Server {
  const config = { ...DEFAULT_OPTIONS, ...overrides };
  if (Boolean(config.turnstileSiteKey) !== Boolean(config.turnstileSecretKey)) {
    throw new Error("Configure TURNSTILE_SITE_KEY e TURNSTILE_SECRET_KEY em conjunto.");
  }
  const jobs = new Map<string, ScanJob>();
  const rateLimits = new Map<string, RateEntry>();
  const queue: string[] = [];
  let active = 0;

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
      void rm(job.options.outputDir, { recursive: true, force: true });
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
      void (async () => {
        try {
          job.report = await scan(job.options);
          await writeReports(job.report, job.options);
          job.status = "completed";
        } catch (error) {
          job.status = "failed";
          job.error = error instanceof Error ? error.message : String(error);
        } finally {
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
      if (request.method === "GET" && url.pathname === "/") {
        const turnstileSources = config.turnstileSiteKey ? " https://challenges.cloudflare.com" : "";
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": `default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'${turnstileSources}; frame-src 'self'${turnstileSources}; img-src 'self' data:; connect-src 'self'${turnstileSources}`,
        });
        response.end(createWebPage(config.turnstileSiteKey));
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
        const options = scanOptions(body, join(config.resultsDir, id));
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

      const match = /^\/api\/scans\/([0-9a-f-]+)(?:\/(report\.html|report\.json|screenshot\.png))?$/.exec(url.pathname);
      if (request.method === "GET" && match) {
        const id = match[1];
        const artifact = match[2];
        if (!id) {
          json(response, 404, { error: "Análise não encontrada." });
          return;
        }
        const job = jobs.get(id);
        if (!job) {
          json(response, 404, { error: "Análise não encontrada." });
          return;
        }
        if (!artifact) {
          json(response, 200, publicJob(job));
          return;
        }
        if (job.status !== "completed") {
          json(response, 409, { error: "A análise ainda não foi concluída." });
          return;
        }
        const content = await readFile(join(job.options.outputDir, artifact));
        const contentType = artifact.endsWith(".html")
          ? "text/html; charset=utf-8"
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
