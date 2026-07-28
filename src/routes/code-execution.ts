import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { assertHostedPlaywrightCode } from "../code-policy.js";
import { applyStepDescriptionOverrides, createJourneyEvidenceHtml, parseJourneyEvidenceMetadata, parseStepDescriptionOverrides } from "../journey-evidence-report.js";
import { ACCESS_HASH_FILE, accessCookie, json, readJson, requireAccess, tokenHash } from "../http-helpers.js";
import { MAX_CODE_FILE_BYTES, MAX_JSON_BODY_BYTES } from "../code-limits.js";
import { CODE_STEP_FIXTURES_SOURCE } from "../code-step-fixtures.js";
import type { CodeExecutionJob } from "../code-execution-job-store.js";
import type { RouteHandler } from "./context.js";

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

export const tryHandleCodeExecution: RouteHandler = async (context, request, response, url) => {
  const { config, codeExecutionJobs } = context;

  if (request.method === "POST" && url.pathname === "/api/code-execution") {
    if (!context.requireCodeModeCreation(request, response, true)) return true;
    if (!context.consumeRateLimit(request, response)) return true;
    if (codeExecutionJobs.isActive()) {
      json(response, 429, { error: "Já existe uma execução do Modo Jornada de Playwright em andamento." });
      return true;
    }
    const body = await readJson(request, MAX_JSON_BODY_BYTES);
    const code = body.code;
    const hostedExecution = !context.isLocalRequest(request);
    const headed = hostedExecution ? false : body.headed !== false;
    if (typeof code !== "string" || !code.trim()) throw new Error("Informe o conteúdo do arquivo .spec.ts.");
    if (Buffer.byteLength(code, "utf8") > MAX_CODE_FILE_BYTES) throw new Error("O arquivo .spec.ts deve ter no máximo 256 KB.");
    if (hostedExecution) {
      assertHostedPlaywrightCode(code);
      if (!config.hostedCodeRunner) {
        json(response, 503, { error: "Runner sandbox hospedado não está configurado neste servidor." });
        return true;
      }
    }
    const runner = hostedExecution ? config.hostedCodeRunner : config.codeRunner;
    if (!runner) throw new Error("Runner Playwright indisponível.");
    const id = randomUUID();
    const outputDir = join(config.resultsDir, `code-${id}`);
    const accessToken = randomBytes(32).toString("base64url");
    const accessTokenHash = tokenHash(accessToken);
    codeExecutionJobs.start();
    let retained = false;
    try {
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(outputDir, ACCESS_HASH_FILE), `${accessTokenHash}\n`, { encoding: "utf8", mode: 0o600 });
      const specPath = join(outputDir, "qa-radar.spec.ts");
      // A execução hospedada recebe só a string de código e nunca vê os
      // arquivos irmãos gravados neste diretório, então só a execução local
      // pode apontar o import para o fixture que captura screenshot por passo.
      const runtimeCode = hostedExecution
        ? code.replaceAll("@playwright/test", "playwright/test")
        : code.replaceAll("@playwright/test", "./qa-radar-fixtures.js");
      await writeFile(specPath, runtimeCode, { encoding: "utf8", mode: 0o600 });
      if (!hostedExecution) {
        await writeFile(join(outputDir, "qa-radar-fixtures.ts"), CODE_STEP_FIXTURES_SOURCE, { encoding: "utf8", mode: 0o600 });
      }
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
      codeExecutionJobs.set(job);
      await writeFile(join(outputDir, "code-report.json"), JSON.stringify({ status: executionStatus, report, ...(failureDetails ? { failureDetails } : {}) }), { encoding: "utf8", mode: 0o600 });
      retained = true;
      context.expireCodeExecution(job);
      response.setHeader("set-cookie", accessCookie(request, `/api/code-executions/${id}`, accessToken, config.retentionMs, config.trustProxy));
      json(response, execution.exitCode === 0 ? 200 : 422, { id, status: executionStatus, report, accessToken, ...(failureDetails ? { failureDetails } : {}) });
    } finally {
      codeExecutionJobs.finish();
      if (!retained) await rm(outputDir, { recursive: true, force: true });
    }
    return true;
  }

  const codeSteps = /^\/api\/code-executions\/([0-9a-f-]+)\/steps$/.exec(url.pathname);
  if (request.method === "GET" && codeSteps) {
    if (!context.requireCodeModeEnabled(response)) return true;
    const job = await context.loadCodeExecutionJob(codeSteps[1] ?? "");
    if (!job) { json(response, 404, { error: "Execução de código não encontrada ou já expirada." }); return true; }
    if (!requireAccess(request, response, job.accessTokenHash)) return true;
    const journey = await context.codeReportAsJourney(job);
    json(response, 200, { steps: journey.steps.map((step) => ({ index: step.index, action: step.action, description: step.description ?? step.action })) });
    return true;
  }

  const codeEvidence = /^\/api\/code-executions\/([0-9a-f-]+)\/evidence-report$/.exec(url.pathname);
  if (request.method === "POST" && codeEvidence) {
    if (!context.requireCodeModeEnabled(response)) return true;
    const job = await context.loadCodeExecutionJob(codeEvidence[1] ?? "");
    if (!job) { json(response, 404, { error: "Execução de código não encontrada ou já expirada." }); return true; }
    if (!requireAccess(request, response, job.accessTokenHash)) return true;
    const body = await readJson(request, MAX_JSON_BODY_BYTES);
    const metadata = parseJourneyEvidenceMetadata({ testerName: body.testerName, testType: body.testType });
    const overrides = parseStepDescriptionOverrides(body.stepDescriptions);
    const journey = applyStepDescriptionOverrides(await context.codeReportAsJourney(job), overrides);
    const html = await createJourneyEvidenceHtml(journey, metadata, (relative) => readFile(join(job.outputDir, relative)));
    await writeFile(join(job.outputDir, "code-evidence.html"), html, "utf8");
    json(response, 201, { url: `/api/code-executions/${job.id}/code-evidence.html` });
    return true;
  }

  const codeArtifact = /^\/api\/code-executions\/([0-9a-f-]+)\/(code-evidence\.html|test-results\/.+\.(?:png|webm))$/.exec(url.pathname);
  if (request.method === "GET" && codeArtifact) {
    if (!context.requireCodeModeEnabled(response)) return true;
    const job = await context.loadCodeExecutionJob(codeArtifact[1] ?? "");
    if (!job) { json(response, 404, { error: "Execução de código não encontrada ou já expirada." }); return true; }
    if (!requireAccess(request, response, job.accessTokenHash)) return true;
    try {
      const name = decodeURIComponent(codeArtifact[2] ?? "");
      if (name !== "code-evidence.html" && (!name.startsWith("test-results/") || name.includes(".."))) { json(response, 404, { error: "Artefato inválido" }); return true; }
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
    return true;
  }

  return false;
};
