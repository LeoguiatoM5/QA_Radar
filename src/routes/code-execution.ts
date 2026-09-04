import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { assertHostedPlaywrightCode } from "../code-policy.js";
import { applyStepDescriptionOverrides, createJourneyEvidenceHtml, parseJourneyEvidenceMetadata, parseStepDescriptionOverrides } from "../journey-evidence-report.js";
import { ACCESS_HASH_FILE, accessCookie, json, jsonError, readJson, requireAccess, tokenHash } from "../http-helpers.js";
import { ApiError, invalidRequest, validating } from "../api-error.js";
import { MAX_CODE_FILE_BYTES, MAX_JSON_BODY_BYTES } from "../code-limits.js";
import { CODE_STEP_FIXTURES_SOURCE } from "../code-step-fixtures.js";
import { codeArtifactPrefix, type CodeExecutionJob } from "../code-execution-job-store.js";
import type { PersistedCodeExecution } from "../code-execution-repository.js";
import type { RouteHandler } from "./context.js";
import { parseEnvironment } from "../environments.js";

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
      } catch {
        /* Try the next test result directory. */
      }
    }
  } catch {
    /* JSON report remains available. */
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Título do primeiro teste do relatório do Playwright.
 *
 * As suítes aninham, então a busca desce até achar o primeiro `spec`. Sem isto
 * a linha do histórico não teria como se chamar: o nome do arquivo é sempre
 * `qa-radar.spec.ts`, igual em toda execução.
 */
function firstSpecTitle(node: unknown): string | undefined {
  const suite = record(node);
  const specs = Array.isArray(suite.specs) ? suite.specs : [];
  for (const spec of specs) {
    const title = record(spec).title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  const children = Array.isArray(suite.suites) ? suite.suites : [];
  for (const child of children) {
    const found = firstSpecTitle(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * Resumo de uma execução para uma lista de histórico.
 *
 * Deriva só do `stats` do relatório do Playwright, de propósito: montar a
 * jornada passo a passo exige ler o `.spec.ts` do disco, o que custa caro por
 * linha e, depois de um reinício da hospedagem, nem existe mais.
 */
export function publicCodeExecution(execution: PersistedCodeExecution): Record<string, unknown> {
  const report = record(execution.report);
  const stats = record(report.stats);
  const suites = Array.isArray(report.suites) ? report.suites : [];
  const count = (value: unknown): number => (typeof value === "number" ? value : 0);
  return {
    id: execution.id,
    status: execution.status,
    createdAt: execution.createdAt,
    title: firstSpecTitle({ suites }),
    durationMs: typeof stats.duration === "number" ? stats.duration : undefined,
    tests: {
      expected: count(stats.expected),
      unexpected: count(stats.unexpected),
      flaky: count(stats.flaky),
      skipped: count(stats.skipped),
    },
    applicationId: execution.applicationId,
  };
}

/**
 * Lê um artefato da execução: disco primeiro, armazenamento durável depois.
 *
 * Mesma ordem da Inspeção. O disco é o caminho normal e o único que existe sem
 * configuração; o armazenamento é o que ainda responde depois de o contêiner
 * ser recriado, quando a captura e o vídeo já sumiram do volume efêmero.
 */
async function readCodeArtifact(context: Parameters<RouteHandler>[0], job: CodeExecutionJob, name: string): Promise<Buffer | undefined> {
  const onDisk = await readFile(join(job.outputDir, ...name.split("/"))).catch(() => undefined);
  return onDisk ?? (await context.artifacts.read(codeArtifactPrefix(job.id), name).catch(() => undefined));
}

/**
 * Quem pode ver esta execução.
 *
 * O dono entra sem apresentar o token: a execução é dele. Uma execução anônima
 * não pertence a ninguém, então continua exigindo o token mesmo de quem está
 * logado — senão entrar numa conta qualquer viraria um caminho para alcançar o
 * que não é seu. Mesma regra da Inspeção.
 */
async function allowCodeAccess(context: Parameters<RouteHandler>[0], request: Parameters<RouteHandler>[1], response: Parameters<RouteHandler>[2], job: CodeExecutionJob): Promise<boolean> {
  if (job.ownerId) {
    const viewer = await context.currentUser(request);
    if (viewer?.id === job.ownerId) return true;
  }
  return requireAccess(request, response, job.accessTokenHash);
}

export const tryHandleCodeExecution: RouteHandler = async (context, request, response, url) => {
  const { config, codeExecutionJobs } = context;

  if (request.method === "POST" && url.pathname === "/api/code-execution") {
    if (!(await context.requireCodeModeCreation(request, response, true))) return true;
    if (!context.consumeRateLimit(request, response)) return true;
    if (codeExecutionJobs.isActive()) {
      jsonError(response, "resource_in_use", "Já existe uma execução do Modo Jornada de Playwright em andamento.");
      return true;
    }
    const body = await readJson(request, MAX_JSON_BODY_BYTES);
    const code = body.code;
    const hostedExecution = !context.isLocalRequest(request);
    const headed = hostedExecution ? false : body.headed !== false;
    if (typeof code !== "string" || !code.trim()) throw invalidRequest("Informe o conteúdo do arquivo .spec.ts.");
    if (Buffer.byteLength(code, "utf8") > MAX_CODE_FILE_BYTES) throw new ApiError("payload_too_large", "O arquivo .spec.ts deve ter no máximo 256 KB.");
    if (hostedExecution) {
      validating(() => assertHostedPlaywrightCode(code));
      if (!config.hostedCodeRunner) {
        jsonError(response, "service_unavailable", "Runner sandbox hospedado não está configurado neste servidor.");
        return true;
      }
    }
    const runner = hostedExecution ? config.hostedCodeRunner : config.codeRunner;
    if (!runner) throw new ApiError("service_unavailable", "Runner Playwright indisponível.");
    // Dono e aplicação são resolvidos **antes** de executar. A conferência da
    // aplicação vai contra o dono, e não só lida do corpo: sem isso qualquer
    // conta apontaria a própria Jornada para a aplicação de outra, e o
    // histórico alheio passaria a receber execuções de fora. É a mesma regra
    // que a Inspeção já aplicava.
    const owner = await context.currentUser(request);
    const applicationId = typeof body.applicationId === "string" && body.applicationId.trim() ? body.applicationId.trim() : undefined;
    if (applicationId) {
      if (!owner) throw new ApiError("unauthorized", "Entre com sua conta para vincular a execução a uma aplicação.");
      if (!context.applications) throw new ApiError("feature_disabled", "Aplicações não estão disponíveis neste servidor.");
      if (!(await context.applications.get(owner.id, applicationId))) throw new ApiError("not_found", "Aplicação não encontrada.");
    }
    const environment = parseEnvironment(body.environment);
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
      const runtimeCode = hostedExecution ? code.replaceAll("@playwright/test", "playwright/test") : code.replaceAll("@playwright/test", "./qa-radar-fixtures.js");
      await writeFile(specPath, runtimeCode, { encoding: "utf8", mode: 0o600 });
      if (!hostedExecution) {
        await writeFile(join(outputDir, "qa-radar-fixtures.ts"), CODE_STEP_FIXTURES_SOURCE, { encoding: "utf8", mode: 0o600 });
      }
      await writeFile(join(outputDir, "playwright.config.ts"), `import { defineConfig } from "playwright/test";\nexport default defineConfig({ use: { screenshot: "on", video: "on" } });\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      const execution = await runner({
        outputDir,
        code: runtimeCode,
        headed,
        timeoutMs: config.maxCodeExecutionDurationMs,
        maxOutputBytes: config.maxCodeOutputBytes,
        maxMemoryMiB: config.maxCodeMemoryMiB,
      });
      let report: unknown;
      try {
        report = JSON.parse(execution.stdout);
      } catch {
        report = { output: execution.stdout.slice(-20_000), errorOutput: execution.stderr.slice(-20_000) };
      }
      let failureDetails: string | undefined;
      if (execution.exitCode !== 0) {
        failureDetails = await readCodeFailureDetails(outputDir);
      }
      const executionStatus = execution.exitCode === 0 ? "passed" : "failed";
      const createdAt = new Date().toISOString();
      const job: CodeExecutionJob = {
        id,
        outputDir,
        status: executionStatus,
        report,
        accessTokenHash,
        createdAt,
        ownerId: owner?.id,
        applicationId,
        ...(failureDetails ? { failureDetails } : {}),
      };
      codeExecutionJobs.set(job);
      await writeFile(join(outputDir, "code-report.json"), JSON.stringify({ status: executionStatus, report, createdAt, ...(failureDetails ? { failureDetails } : {}) }), {
        encoding: "utf8",
        mode: 0o600,
      });
      retained = true;
      // O registro é gravado como melhor esforço, ao contrário do da Inspeção.
      // Lá a escrita acontece na criação e falhar aborta a requisição; aqui a
      // execução **já rodou**, e derrubar a resposta por causa do banco jogaria
      // fora um teste que passou. A falha é logada e a execução segue viva em
      // memória e no disco, como era antes de existir persistência.
      await context.codeExecutions
        ?.insert({
          id,
          status: executionStatus,
          createdAt,
          expiresAt: new Date(Date.now() + config.retentionMs).toISOString(),
          accessTokenHash,
          report,
          failureDetails,
          ownerId: owner?.id,
          applicationId,
          environment,
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              source: "qa-radar",
              event: "code_execution.persistence_failed",
              timestamp: new Date().toISOString(),
              jobId: id,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      // Os artefatos vão para o armazenamento durável pelo mesmo motivo dos da
      // Inspeção: no disco efêmero da hospedagem, o relatório de evidências e
      // as capturas morrem no deploy seguinte. Inerte sem configuração.
      void context.artifacts.upload(codeArtifactPrefix(id), outputDir).catch(() => {
        /* O disco ainda tem tudo; a evidência só não sobrevive ao contêiner. */
      });
      context.expireCodeExecution(job);
      response.setHeader("set-cookie", accessCookie(request, `${context.apiPrefix}/code-executions/${id}`, accessToken, config.retentionMs, config.trustProxy));
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
    if (!job) {
      jsonError(response, "not_found", "Execução de código não encontrada ou já expirada.");
      return true;
    }
    if (!(await allowCodeAccess(context, request, response, job))) return true;
    const journey = await context.codeReportAsJourney(job);
    json(response, 200, { steps: journey.steps.map((step) => ({ index: step.index, action: step.action, description: step.description ?? step.action })) });
    return true;
  }

  const codeEvidence = /^\/api\/code-executions\/([0-9a-f-]+)\/evidence-report$/.exec(url.pathname);
  if (request.method === "POST" && codeEvidence) {
    if (!context.requireCodeModeEnabled(response)) return true;
    const job = await context.loadCodeExecutionJob(codeEvidence[1] ?? "");
    if (!job) {
      jsonError(response, "not_found", "Execução de código não encontrada ou já expirada.");
      return true;
    }
    if (!(await allowCodeAccess(context, request, response, job))) return true;
    const body = await readJson(request, MAX_JSON_BODY_BYTES);
    const metadata = validating(() => parseJourneyEvidenceMetadata({ testerName: body.testerName, testType: body.testType }));
    const overrides = validating(() => parseStepDescriptionOverrides(body.stepDescriptions));
    const journey = applyStepDescriptionOverrides(await context.codeReportAsJourney(job), overrides);
    const html = await createJourneyEvidenceHtml(journey, metadata, async (relative) => {
      const content = await readCodeArtifact(context, job, relative);
      if (!content) throw new Error(`Evidência ausente: ${relative}`);
      return content;
    });
    await writeFile(join(job.outputDir, "code-evidence.html"), html, "utf8");
    // O relatório é gerado depois da execução, então não estava no diretório
    // quando ele subiu. Sem esta segunda subida o link do relatório quebraria
    // no próximo deploy, que é exatamente o problema que o storage resolve.
    void context.artifacts.upload(codeArtifactPrefix(job.id), job.outputDir).catch(() => {});
    json(response, 201, { url: `${context.apiPrefix}/code-executions/${job.id}/code-evidence.html` });
    return true;
  }

  const codeArtifact = /^\/api\/code-executions\/([0-9a-f-]+)\/(code-evidence\.html|test-results\/.+\.(?:png|webm))$/.exec(url.pathname);
  if (request.method === "GET" && codeArtifact) {
    if (!context.requireCodeModeEnabled(response)) return true;
    const job = await context.loadCodeExecutionJob(codeArtifact[1] ?? "");
    if (!job) {
      jsonError(response, "not_found", "Execução de código não encontrada ou já expirada.");
      return true;
    }
    if (!(await allowCodeAccess(context, request, response, job))) return true;
    try {
      const name = decodeURIComponent(codeArtifact[2] ?? "");
      if (name !== "code-evidence.html" && (!name.startsWith("test-results/") || name.includes(".."))) {
        jsonError(response, "not_found", "Artefato inválido");
        return true;
      }
      const content = await readCodeArtifact(context, job, name);
      if (!content) {
        jsonError(response, "not_found", "O relatório HTML ainda não foi gerado.");
        return true;
      }
      const isHtml = name === "code-evidence.html";
      response.writeHead(200, {
        "content-type": isHtml ? "text/html; charset=utf-8" : name.endsWith(".webm") ? "video/webm" : "image/png",
        "content-length": content.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(isHtml ? { "content-security-policy": "sandbox allow-popups allow-same-origin allow-downloads; default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'" } : {}),
      });
      response.end(content);
    } catch {
      jsonError(response, "not_found", "O relatório HTML ainda não foi gerado.");
    }
    return true;
  }

  return false;
};
