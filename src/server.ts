import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { parseCli } from "./cli.js";
import { writeReports } from "./reporters.js";
import { scan } from "./scanner.js";
import type { ScanOptions, ScanProgress, ScanReport } from "./types.js";
import { createDocsPage, createHomePage, createJourneyPage, createWebPage } from "./web-page.js";
import { assertPublicUrl } from "./security.js";
import { findHistoryBaseline, listProjectHistory, storeRun } from "./history.js";
import { scanSitemap } from "./suite.js";
import { JobQueue, type ScanJob } from "./job-queue.js";
import { RateLimiter } from "./rate-limit.js";
import { runJourneyDefinition } from "./journey-cli.js";
import type { JourneyRunResult } from "./journey-runner.js";
import { parseJourney } from "./journey.js";
import { applyStepDescriptionOverrides, createJourneyEvidenceHtml, parseJourneyEvidenceMetadata, parseStepDescriptionOverrides } from "./journey-evidence-report.js";
import { terminateProcessTree, type SpawnProcess } from "./code-execution.js";
import { runPlaywrightCodeWorker } from "./code-worker-client.js";
import { assertHostedPlaywrightCode } from "./code-policy.js";
import type { HostedCodeRunner } from "./sandbox-client.js";

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

interface CodegenSession {
  id: string;
  outputDir: string;
  outputPath: string;
  process: ChildProcess;
  active: boolean;
  accessTokenHash: string;
}
interface CodeExecutionJob {
  id: string;
  outputDir: string;
  status: "passed" | "failed";
  report: unknown;
  accessTokenHash: string;
  failureDetails?: string;
}

const MAX_CODE_FILE_BYTES = 256 * 1024;
// Reserva espaço para o envelope JSON que transporta um arquivo no limite.
const MAX_JSON_BODY_BYTES = MAX_CODE_FILE_BYTES + 64 * 1024;
function explainCodeFailure(details: string | undefined): string | undefined {
  if (!details) return undefined;
  if (/security verification|verify you are not a bot|cloudflare|captcha|challenge/i.test(details)) {
    return `${details}\n\nDiagnóstico QA Radar: o site exibiu uma verificação anti-bot antes do fluxo. O teste não alcançou o elemento solicitado. Execute novamente com o navegador visível, conclua a verificação manualmente e repita o teste.`;
  }
  return details;
}

async function readCodeFailureDetails(outputDir: string): Promise<string | undefined> {
  try {
    const resultsDir = join(outputDir, "test-results");
    const entries = await readdir(resultsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        return explainCodeFailure((await readFile(join(resultsDir, entry.name, "error-context.md"), "utf8")).slice(-20_000));
      } catch { /* Try the next test result directory. */ }
    }
  } catch { /* JSON report remains available. */ }
  return undefined;
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
  // ainda exercitam essa rota; ver docs/EVOLUTION_LOG.md.
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
  allowCodeMode: false,
  codeModeAdminToken: undefined,
  historyDir: join(process.cwd(), ".qa-radar-history"),
  maxSitemapPages: 20,
  maxJourneySteps: 20,
  maxJourneyPayloadBytes: 32 * 1024,
  maxJourneyDurationMs: 3 * 60_000,
  maxCodeExecutionDurationMs: 5 * 60_000,
  maxCodeOutputBytes: 1024 * 1024,
  maxCodeMemoryMiB: 512,
  maxCodegenDurationMs: 10 * 60_000,
  scanRunner: scan,
  journeyRunner: runJourneyDefinition,
  codegenSpawner: spawn,
  codeRunner: runPlaywrightCodeWorker,
  hostedCodeRunner: undefined,
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

function bearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim() || undefined
    : undefined;
}

function requestToken(request: IncomingMessage): string | undefined {
  const authorization = bearerToken(request);
  if (authorization) return authorization;
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
    if (size > MAX_JSON_BODY_BYTES) throw new Error("Requisição muito grande.");
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

function journeyInputSecrets(body: Record<string, unknown>, definition: ReturnType<typeof parseJourney>): Record<string, string> {
  const raw = body.inputSecrets;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("As credenciais da jornada devem ser um objeto.");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 10) throw new Error("A jornada pode receber no máximo 10 credenciais.");
  const expected = new Set(definition.steps.flatMap((step) => step.action === "fill" && step.valueFromInput ? [step.valueFromInput] : []));
  const secrets: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!/^QA_RADAR_INPUT_[A-Z0-9_]+$/.test(name)) throw new Error("As credenciais devem usar referências QA_RADAR_INPUT_*.");
    if (!expected.has(name)) throw new Error(`A credencial ${name} não é usada pela jornada.`);
    if (typeof value !== "string" || value.length > 2_000) throw new Error(`A credencial ${name} deve ser um texto com até 2000 caracteres.`);
    secrets[name] = value;
  }
  return secrets;
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
  if (
    config.codeModeAdminToken !== undefined
    && (Buffer.byteLength(config.codeModeAdminToken, "utf8") < 32
      || Buffer.byteLength(config.codeModeAdminToken, "utf8") > 512)
  ) {
    throw new Error("codeModeAdminToken deve ter entre 32 e 512 bytes.");
  }
  const codeModeAdminTokenHash = config.codeModeAdminToken
    ? tokenHash(config.codeModeAdminToken)
    : undefined;
  const jobQueue = new JobQueue();
  const rateLimiter = new RateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
  let journeyActive = false;
  const journeyJobs = new Map<string, JourneyJob>();
  const codegenSessions = new Map<string, CodegenSession>();
  const codeExecutionJobs = new Map<string, CodeExecutionJob>();
  let codeExecutionActive = false;
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
      ...(step.evidence ? {
        evidence: { before: basename(step.evidence.before), after: basename(step.evidence.after) },
      } : {}),
    })),
  });

  const codeReportAsJourney = async (job: CodeExecutionJob): Promise<JourneyRunResult> => {
    const record = job.report && typeof job.report === "object" && !Array.isArray(job.report) ? job.report as Record<string, unknown> : {};
    const stats = record.stats && typeof record.stats === "object" && !Array.isArray(record.stats) ? record.stats as Record<string, unknown> : {};
    const durationMs = typeof stats.duration === "number" ? stats.duration : 0;
    const expected = typeof stats.expected === "number" ? stats.expected : 0;
    let source = "";
    try { source = await readFile(join(job.outputDir, "qa-radar.spec.ts"), "utf8"); } catch { /* The report can still be generated from the JSON result. */ }
    const sourceSteps: Array<{ action: "goto" | "click" | "fill" | "select" | "waitFor" | "assertVisible" | "assertText"; description: string }> = [];
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//")) continue;
      const goto = /\.goto\((['"`])(.+?)\1/.exec(line);
      const click = /(?:page|locator|[\w.]+)\.locator\((['"`])(.+?)\1\)\.click\(/.exec(line);
      const genericClick = /(.+)\.click\(/.exec(line);
      const fill = /\.locator\((['"`])(.+?)\1\)\.fill\(/.exec(line);
      const select = /\.locator\((['"`])(.+?)\1\)\.selectOption\(/.exec(line);
      const visible = /expect\((.+?)\)\.toBeVisible\(/.exec(line);
      const text = /expect\((.+?)\)\.toHaveText\(/.exec(line);
      const wait = /\.waitFor\(/.exec(line);
      if (goto) sourceSteps.push({ action: "goto", description: `Abrir página ${goto[2]}` });
      else if (click) sourceSteps.push({ action: "click", description: `Clicar em ${click[2]}` });
      else if (genericClick) sourceSteps.push({ action: "click", description: `Clicar em ${(genericClick[1] ?? line).trim()}` });
      else if (fill) sourceSteps.push({ action: "fill", description: `Preencher ${fill[2]}` });
      else if (select) sourceSteps.push({ action: "select", description: `Selecionar opção em ${select[2]}` });
      else if (visible) sourceSteps.push({ action: "assertVisible", description: `Confirmar elemento visível: ${visible[1]}` });
      else if (text) sourceSteps.push({ action: "assertText", description: `Confirmar texto em ${text[1]}` });
      else if (wait) sourceSteps.push({ action: "waitFor", description: "Aguardar elemento" });
    }
    const stepDefinitions = sourceSteps.length > 0 ? sourceSteps : [{ action: "assertVisible" as const, description: `${expected} teste(s) executado(s)` }];
    const stepDuration = durationMs / stepDefinitions.length;
    let screenshotPath: string | undefined;
    let videoPath: string | undefined;
    try {
      const mediaFiles = await readdir(join(job.outputDir, "test-results"), { recursive: true });
      for (const relative of mediaFiles) {
        if (typeof relative !== "string") continue;
        const normalized = `test-results/${relative.replaceAll("\\", "/")}`;
        if (!screenshotPath && normalized.endsWith(".png")) screenshotPath = normalized;
        if (!videoPath && normalized.endsWith(".webm")) videoPath = normalized;
      }
    } catch { /* A failed run may not produce media. */ }
    const steps = stepDefinitions.map((step, index) => ({
      index,
      action: step.action,
      description: step.description,
      status: job.status === "passed" || index < stepDefinitions.length - 1 ? "passed" as const : "failed" as const,
      durationMs: stepDuration,
      ...(job.status === "failed" && index === stepDefinitions.length - 1 && job.failureDetails ? { error: job.failureDetails } : {}),
      ...((screenshotPath || videoPath) ? { evidence: {
        before: screenshotPath ?? videoPath ?? "",
        after: screenshotPath ?? videoPath ?? "",
        ...(videoPath ? { video: { path: videoPath, startMs: index * stepDuration, endMs: (index + 1) * stepDuration } } : {}),
      } } : {}),
    }));
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
      json(response, 403, { error: "Modo Jornada de Playwright está desabilitado neste ambiente." });
      return false;
    }
    return true;
  };
  const requireCodeModeCreation = (
    request: IncomingMessage,
    response: ServerResponse,
    allowRemoteAdmin: boolean,
  ): boolean => {
    if (!requireCodeModeEnabled(response)) return false;
    if (isLocalRequest(request)) return true;
    if (!allowRemoteAdmin || !codeModeAdminTokenHash) {
      json(response, 403, { error: "A execução hospedada do Modo Jornada de Playwright ainda não está habilitada neste servidor." });
      return false;
    }
    const token = bearerToken(request);
    if (token && tokenMatches(token, codeModeAdminTokenHash)) return true;
    response.setHeader("www-authenticate", 'Bearer realm="QA Radar code mode"');
    json(response, token ? 403 : 401, { error: "Token administrativo do Modo Jornada ausente ou inválido." });
    return false;
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
      if (request.method === "POST" && url.pathname === "/api/codegen") {
        if (!requireCodeModeCreation(request, response, false)) return;
        if (!consumeRateLimit(request, response)) return;
        if ([...codegenSessions.values()].some((session) => session.active)) {
          json(response, 429, { error: "Já existe uma gravação do Playwright Codegen em andamento." });
          return;
        }
        const body = await readJson(request);
        const target = textField(body, "url");
        if (!target) throw new Error("Informe a URL para iniciar o Codegen.");
        const parsed = new URL(target);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("A URL deve usar http ou https.");
        const id = randomUUID();
        const dir = join(config.resultsDir, `codegen-${id}`);
        await mkdir(dir, { recursive: true });
        const accessToken = randomBytes(32).toString("base64url");
        const accessTokenHash = tokenHash(accessToken);
        await writeFile(join(dir, ACCESS_HASH_FILE), `${accessTokenHash}\n`, { encoding: "utf8", mode: 0o600 });
        const outputPath = join(dir, "recorded.spec.ts");
        const child = config.codegenSpawner(process.execPath, [join(process.cwd(), "node_modules", "playwright", "cli.js"), "codegen", "--target=playwright-test", `--output=${outputPath}`, target], {
          stdio: "ignore",
          windowsHide: true,
          detached: process.platform !== "win32",
        });
        const session: CodegenSession = { id, outputDir: dir, outputPath, process: child, active: true, accessTokenHash };
        codegenSessions.set(id, session);
        let finished = false;
        const deadline = setTimeout(() => {
          void terminateProcessTree(child);
        }, config.maxCodegenDurationMs);
        deadline.unref();
        const finish = (): void => {
          if (finished) return;
          finished = true;
          session.active = false;
          clearTimeout(deadline);
          expireCodegen(session);
        };
        child.once("error", finish);
        child.once("exit", finish);
        response.setHeader("set-cookie", accessCookie(request, `/api/codegen/${id}`, accessToken, config.retentionMs, config.trustProxy));
        json(response, 201, { id, accessToken });
        return;
      }
      const codegenMatch = /^\/api\/codegen\/([0-9a-f-]+)$/.exec(url.pathname);
      if (request.method === "GET" && codegenMatch) {
        if (!requireCodeModeEnabled(response)) return;
        const session = codegenSessions.get(codegenMatch[1] ?? "");
        if (!session) { json(response, 404, { error: "Sessão de Codegen não encontrada." }); return; }
        if (!requireAccess(request, response, session.accessTokenHash)) return;
        try { json(response, 200, { status: "completed", code: await readFile(session.outputPath, "utf8") }); }
        catch { json(response, 200, { status: "recording" }); }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/code-execution") {
        if (!requireCodeModeCreation(request, response, true)) return;
        if (!consumeRateLimit(request, response)) return;
        if (codeExecutionActive) {
          json(response, 429, { error: "Já existe uma execução do Modo Jornada de Playwright em andamento." });
          return;
        }
        const body = await readJson(request);
        const code = body.code;
        const hostedExecution = !isLocalRequest(request);
        const headed = hostedExecution ? false : body.headed !== false;
        if (typeof code !== "string" || !code.trim()) throw new Error("Informe o conteúdo do arquivo .spec.ts.");
        if (Buffer.byteLength(code, "utf8") > MAX_CODE_FILE_BYTES) throw new Error("O arquivo .spec.ts deve ter no máximo 256 KB.");
        if (hostedExecution) {
          assertHostedPlaywrightCode(code);
          if (!config.hostedCodeRunner) {
            json(response, 503, { error: "Runner sandbox hospedado não está configurado neste servidor." });
            return;
          }
        }
        const runner = hostedExecution ? config.hostedCodeRunner : config.codeRunner;
        if (!runner) throw new Error("Runner Playwright indisponível.");
        const id = randomUUID();
        const outputDir = join(config.resultsDir, `code-${id}`);
        const accessToken = randomBytes(32).toString("base64url");
        const accessTokenHash = tokenHash(accessToken);
        codeExecutionActive = true;
        let retained = false;
        try {
          await mkdir(outputDir, { recursive: true });
          await writeFile(join(outputDir, ACCESS_HASH_FILE), `${accessTokenHash}\n`, { encoding: "utf8", mode: 0o600 });
          const specPath = join(outputDir, "qa-radar.spec.ts");
          const runtimeCode = code.replaceAll("@playwright/test", "playwright/test");
          await writeFile(specPath, runtimeCode, { encoding: "utf8", mode: 0o600 });
          await writeFile(join(outputDir, "playwright.config.ts"), `import { defineConfig } from "playwright/test";\nexport default defineConfig({ use: { screenshot: "on", video: "on" } });\n`, { encoding: "utf8", mode: 0o600 });
          const execution = await runner({
            outputDir,
            code: runtimeCode,
            headed,
            timeoutMs: config.maxCodeExecutionDurationMs,
            maxOutputBytes: config.maxCodeOutputBytes,
            maxMemoryMiB: config.maxCodeMemoryMiB,
          });
          let report: unknown;
          try { report = JSON.parse(execution.stdout); } catch { report = { output: execution.stdout.slice(-20_000), errorOutput: execution.stderr.slice(-20_000) }; }
          let failureDetails: string | undefined;
          if (execution.exitCode !== 0) {
            failureDetails = await readCodeFailureDetails(outputDir);
          }
          const executionStatus = execution.exitCode === 0 ? "passed" : "failed";
          const job: CodeExecutionJob = { id, outputDir, status: executionStatus, report, accessTokenHash, ...(failureDetails ? { failureDetails } : {}) };
          codeExecutionJobs.set(id, job);
          await writeFile(join(outputDir, "code-report.json"), JSON.stringify({ status: executionStatus, report, ...(failureDetails ? { failureDetails } : {}) }), { encoding: "utf8", mode: 0o600 });
          retained = true;
          expireCodeExecution(job);
          response.setHeader("set-cookie", accessCookie(request, `/api/code-executions/${id}`, accessToken, config.retentionMs, config.trustProxy));
          json(response, execution.exitCode === 0 ? 200 : 422, { id, status: executionStatus, report, accessToken, ...(failureDetails ? { failureDetails } : {}) });
        } finally {
          codeExecutionActive = false;
          if (!retained) await rm(outputDir, { recursive: true, force: true });
        }
        return;
      }
      const codeSteps = /^\/api\/code-executions\/([0-9a-f-]+)\/steps$/.exec(url.pathname);
      if (request.method === "GET" && codeSteps) {
        if (!requireCodeModeEnabled(response)) return;
        const job = await loadCodeExecutionJob(codeSteps[1] ?? "");
        if (!job) { json(response, 404, { error: "Execução de código não encontrada ou já expirada." }); return; }
        if (!requireAccess(request, response, job.accessTokenHash)) return;
        const journey = await codeReportAsJourney(job);
        json(response, 200, { steps: journey.steps.map((step) => ({ index: step.index, action: step.action, description: step.description ?? step.action })) });
        return;
      }
      const codeEvidence = /^\/api\/code-executions\/([0-9a-f-]+)\/evidence-report$/.exec(url.pathname);
      if (request.method === "POST" && codeEvidence) {
        if (!requireCodeModeEnabled(response)) return;
        const job = await loadCodeExecutionJob(codeEvidence[1] ?? "");
        if (!job) { json(response, 404, { error: "Execução de código não encontrada ou já expirada." }); return; }
        if (!requireAccess(request, response, job.accessTokenHash)) return;
        const body = await readJson(request);
        const metadata = parseJourneyEvidenceMetadata({ testerName: body.testerName, testType: body.testType });
        const overrides = parseStepDescriptionOverrides(body.stepDescriptions);
        const journey = applyStepDescriptionOverrides(await codeReportAsJourney(job), overrides);
        const html = await createJourneyEvidenceHtml(journey, metadata, (relative) => readFile(join(job.outputDir, relative)));
        await writeFile(join(job.outputDir, "code-evidence.html"), html, "utf8");
        json(response, 201, { url: `/api/code-executions/${job.id}/code-evidence.html` });
        return;
      }
      const codeArtifact = /^\/api\/code-executions\/([0-9a-f-]+)\/(code-evidence\.html|test-results\/.+\.(?:png|webm))$/.exec(url.pathname);
      if (request.method === "GET" && codeArtifact) {
        if (!requireCodeModeEnabled(response)) return;
        const job = await loadCodeExecutionJob(codeArtifact[1] ?? "");
        if (!job) { json(response, 404, { error: "Execução de código não encontrada ou já expirada." }); return; }
        if (!requireAccess(request, response, job.accessTokenHash)) return;
        try {
          const name = decodeURIComponent(codeArtifact[2] ?? "");
          if (name !== "code-evidence.html" && (!name.startsWith("test-results/") || name.includes(".."))) { json(response, 404, { error: "Artefato inválido" }); return; }
          const artifactPath = name === "code-evidence.html" ? join(job.outputDir, name) : join(job.outputDir, ...name.split("/"));
          const content = await readFile(artifactPath);
          const isHtml = name === "code-evidence.html";
          response.writeHead(200, {
            "content-type": isHtml ? "text/html; charset=utf-8" : name.endsWith(".webm") ? "video/webm" : "image/png",
            "content-length": content.length,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            ...(isHtml ? { "content-security-policy": "sandbox allow-popups allow-same-origin allow-downloads; default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'" } : {}),
          });
          response.end(content);
        } catch { json(response, 404, { error: "O relatório HTML ainda não foi gerado." }); }
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "permissions-policy": "camera=(), microphone=(), geolocation=()",
          "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
        });
        response.end(createHomePage());
        return;
      }
      if (request.method === "GET" && url.pathname === "/docs") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "permissions-policy": "camera=(), microphone=(), geolocation=()",
          "content-security-policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
        });
        response.end(createDocsPage());
        return;
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
        return;
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
        const inputSecrets = journeyInputSecrets(body, parsedDefinition);
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
            const result = await config.journeyRunner(options, parsedDefinition, { ...process.env, ...inputSecrets }, job.controller.signal);
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
        const accessToken = requestToken(request);
        if (job.status !== "completed" || !job.report) {
          json(response, 409, { error: "A jornada precisa estar concluída para gerar evidências." });
          return;
        }
        const metadata = parseJourneyEvidenceMetadata(await readJson(request));
        const html = await createJourneyEvidenceHtml(job.report, metadata, (relative) => readFile(join(job.outputDir, "journey-evidence", relative)));
        await writeFile(join(job.outputDir, "journey-evidence.html"), html, "utf8");
        if (accessToken) {
          response.setHeader("set-cookie", accessCookie(request, "/api/journeys", accessToken, config.retentionMs, config.trustProxy));
        }
        json(response, 201, { url: `/api/journeys/${id}/journey-evidence.html` });
        return;
      }

      const journeyArtifact = /^\/api\/journeys\/([0-9a-f-]+)\/(journey-report\.json|journey-evidence\.html|journey\.webm|[0-9]{3}-[a-zA-Z]+-(?:before|after)\.png)$/.exec(url.pathname);
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
            : name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".webm") ? "video/webm" : "image/png",
          "content-length": content.length,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
          ...(name.endsWith(".html") ? {
            "content-security-policy": "sandbox allow-popups allow-same-origin allow-downloads; default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'",
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
