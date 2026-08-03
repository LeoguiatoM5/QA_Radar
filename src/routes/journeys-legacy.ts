import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { assertPublicUrl } from "../security.js";
import { parseJourney } from "../journey.js";
import { createJourneyEvidenceHtml, parseJourneyEvidenceMetadata } from "../journey-evidence-report.js";
import { ACCESS_HASH_FILE, accessCookie, json, jsonError, readJson, requestToken, requireAccess, storedAccessHash, tokenHash } from "../http-helpers.js";
import { ApiError, invalidRequest, validating } from "../api-error.js";
import { MAX_JSON_BODY_BYTES } from "../code-limits.js";
import type { JourneyJob } from "../legacy-journey-registry.js";
import type { RouteHandler } from "./context.js";
import { scanOptions } from "./scans.js";

function journeyInputSecrets(body: Record<string, unknown>, definition: ReturnType<typeof parseJourney>): Record<string, string> {
  const raw = body.inputSecrets;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidRequest("As credenciais da jornada devem ser um objeto.");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 10) throw invalidRequest("A jornada pode receber no máximo 10 credenciais.");
  const expected = new Set(definition.steps.flatMap((step) => (step.action === "fill" && step.valueFromInput ? [step.valueFromInput] : [])));
  const secrets: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!/^QA_RADAR_INPUT_[A-Z0-9_]+$/.test(name)) throw invalidRequest("As credenciais devem usar referências QA_RADAR_INPUT_*.");
    if (!expected.has(name)) throw invalidRequest(`A credencial ${name} não é usada pela jornada.`);
    if (typeof value !== "string" || value.length > 2_000) throw invalidRequest(`A credencial ${name} deve ser um texto com até 2000 caracteres.`);
    secrets[name] = value;
  }
  return secrets;
}

export const tryHandleLegacyJourneys: RouteHandler = async (context, request, response, url) => {
  const { config, legacyJourneys } = context;

  if (request.method === "POST" && url.pathname === "/api/journeys") {
    if (!config.allowJourneys) {
      jsonError(response, "feature_disabled", "Jornadas estão desabilitadas neste servidor.");
      return true;
    }
    if (!context.consumeRateLimit(request, response)) return true;
    const stats = context.queueStats();
    if (legacyJourneys.isActive() || stats.active > 0 || stats.queued > 0) {
      jsonError(response, "resource_in_use", "Já existe uma execução usando o navegador neste servidor.");
      return true;
    }
    const body = await readJson(request, MAX_JSON_BODY_BYTES);
    const definition = body.journey;
    if (!definition) throw invalidRequest("Informe a definição da jornada.");
    const payloadBytes = Buffer.byteLength(JSON.stringify(definition), "utf8");
    if (payloadBytes > config.maxJourneyPayloadBytes) {
      throw new ApiError("payload_too_large", `A definição da jornada deve ter no máximo ${config.maxJourneyPayloadBytes} bytes.`);
    }
    const parsedDefinition = validating(() => parseJourney(definition));
    const inputSecrets = journeyInputSecrets(body, parsedDefinition);
    if (parsedDefinition.steps.length > config.maxJourneySteps) {
      throw invalidRequest(`A jornada deve ter no máximo ${config.maxJourneySteps} passos neste servidor.`);
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
    legacyJourneys.set(job);
    legacyJourneys.start();
    const deadline = setTimeout(() => {
      job.controller.abort(new Error(`A jornada excedeu o limite global de ${config.maxJourneyDurationMs} ms.`));
    }, config.maxJourneyDurationMs);
    deadline.unref();
    void (async () => {
      try {
        const result = await config.journeyRunner(options, parsedDefinition, { ...process.env, ...inputSecrets }, job.controller.signal);
        job.controller.signal.throwIfAborted();
        job.report = context.publicJourney(result.report);
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
        legacyJourneys.finish();
        context.expireJourney(job);
      }
    })();
    response.setHeader("set-cookie", accessCookie(request, "/api/journeys", accessToken, config.retentionMs, config.trustProxy));
    json(response, 202, { id, status: job.status, createdAt: job.createdAt, accessToken });
    return true;
  }

  const journeyCancel = /^\/api\/journeys\/([0-9a-f-]+)\/cancel$/.exec(url.pathname);
  if (request.method === "POST" && journeyCancel) {
    const id = journeyCancel[1];
    const job = id ? legacyJourneys.get(id) : undefined;
    if (!job) {
      jsonError(response, "not_found", "Jornada não encontrada ou já expirada.");
      return true;
    }
    if (!requireAccess(request, response, job.accessTokenHash)) return true;
    if (job.status !== "running") {
      jsonError(response, "conflict", "A jornada já foi finalizada.");
      return true;
    }
    job.cancelRequested = true;
    job.controller.abort(new Error("Jornada cancelada pelo usuário."));
    json(response, 202, { id: job.id, status: "cancelled" });
    return true;
  }

  const journeyStatus = /^\/api\/journeys\/([0-9a-f-]+)$/.exec(url.pathname);
  if (request.method === "GET" && journeyStatus) {
    if (!config.allowJourneys) {
      jsonError(response, "feature_disabled", "Jornadas estão desabilitadas neste servidor.");
      return true;
    }
    const id = journeyStatus[1];
    const job = id ? legacyJourneys.get(id) : undefined;
    if (!job) {
      jsonError(response, "not_found", "Jornada não encontrada ou já expirada.");
      return true;
    }
    if (!requireAccess(request, response, job.accessTokenHash)) return true;
    json(response, 200, {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      ...(job.report ? { report: job.report } : {}),
      ...(job.error ? { error: job.error } : {}),
    });
    return true;
  }

  const journeyEvidenceReport = /^\/api\/journeys\/([0-9a-f-]+)\/evidence-report$/.exec(url.pathname);
  if (request.method === "POST" && journeyEvidenceReport) {
    if (!config.allowJourneys) {
      jsonError(response, "feature_disabled", "Jornadas estão desabilitadas neste servidor.");
      return true;
    }
    const id = journeyEvidenceReport[1];
    const job = id ? legacyJourneys.get(id) : undefined;
    if (!job) {
      jsonError(response, "not_found", "Jornada não encontrada ou já expirada.");
      return true;
    }
    if (!requireAccess(request, response, job.accessTokenHash)) return true;
    const accessToken = requestToken(request);
    if (job.status !== "completed" || !job.report) {
      jsonError(response, "conflict", "A jornada precisa estar concluída para gerar evidências.");
      return true;
    }
    const body = await readJson(request, MAX_JSON_BODY_BYTES);
    const metadata = validating(() => parseJourneyEvidenceMetadata(body));
    const html = await createJourneyEvidenceHtml(job.report, metadata, (relative) => readFile(join(job.outputDir, "journey-evidence", relative)));
    await writeFile(join(job.outputDir, "journey-evidence.html"), html, "utf8");
    if (accessToken) {
      response.setHeader("set-cookie", accessCookie(request, "/api/journeys", accessToken, config.retentionMs, config.trustProxy));
    }
    json(response, 201, { url: `/api/journeys/${id}/journey-evidence.html` });
    return true;
  }

  const journeyArtifact = /^\/api\/journeys\/([0-9a-f-]+)\/(journey-report\.json|journey-evidence\.html|journey\.webm|[0-9]{3}-[a-zA-Z]+-(?:before|after)\.png)$/.exec(url.pathname);
  if (request.method === "GET" && journeyArtifact) {
    if (!config.allowJourneys) {
      jsonError(response, "feature_disabled", "Jornadas estão desabilitadas neste servidor.");
      return true;
    }
    const id = journeyArtifact[1];
    const name = journeyArtifact[2];
    if (!id || !name) throw invalidRequest("Evidência inválida.");
    const job = legacyJourneys.get(id);
    const expectedHash = job?.accessTokenHash ?? (await storedAccessHash(config.resultsDir, `journey-${id}`));
    if (!expectedHash) {
      jsonError(response, "not_found", "Jornada não encontrada ou já expirada.");
      return true;
    }
    if (!requireAccess(request, response, expectedHash)) return true;
    if (job?.status === "running") {
      jsonError(response, "conflict", "A jornada ainda não foi concluída.");
      return true;
    }
    const path =
      name === "journey-report.json" || name === "journey-evidence.html" ? join(config.resultsDir, `journey-${id}`, name) : join(config.resultsDir, `journey-${id}`, "journey-evidence", name);
    const content = await readFile(path);
    response.writeHead(200, {
      "content-type": name.endsWith(".json") ? "application/json; charset=utf-8" : name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".webm") ? "video/webm" : "image/png",
      "content-length": content.length,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      ...(name.endsWith(".html")
        ? {
            "content-security-policy": "sandbox allow-popups allow-same-origin allow-downloads; default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'",
          }
        : {}),
    });
    response.end(content);
    return true;
  }

  return false;
};
