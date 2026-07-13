import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCli } from "./cli.js";
import { writeReports } from "./reporters.js";
import { scan } from "./scanner.js";
import type { ScanOptions, ScanReport } from "./types.js";
import { createWebPage } from "./web-page.js";

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
}

const DEFAULT_OPTIONS: ServerOptions = {
  resultsDir: join(process.cwd(), "qa-radar-results"),
  concurrency: 2,
};

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
  return parsed.options;
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
  const jobs = new Map<string, ScanJob>();
  const queue: string[] = [];
  let active = 0;

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
          schedule();
        }
      })();
    }
  };

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self'; img-src 'self' data:; connect-src 'self'",
        });
        response.end(createWebPage());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/scans") {
        const body = await readJson(request);
        const id = randomUUID();
        const options = scanOptions(body, join(config.resultsDir, id));
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
