import { json, jsonError } from "../http-helpers.js";
import { ApiError, invalidRequest } from "../api-error.js";
import { computeQualitySummary } from "../quality-summary.js";
import type { RouteHandler } from "./context.js";

/** Lê uma data do filtro, recusando o que não é data em vez de ignorar. */
function readInstant(raw: string | null, field: string): string | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw invalidRequest(`O parâmetro ${field} precisa ser uma data ISO 8601.`);
  return parsed.toISOString();
}

/**
 * O resumo de qualidade da conta: as mesmas três origens de Relatórios, somadas
 * em vez de listadas — ver `src/quality-summary.ts`.
 */
export const tryHandleQuality: RouteHandler = async (context, request, response, url) => {
  if (url.pathname !== "/api/quality/summary") return false;
  if (request.method !== "GET") {
    jsonError(response, "method_not_allowed", "Método não suportado para o resumo de qualidade.");
    return true;
  }

  const viewer = await context.currentUser(request);
  if (!viewer) throw new ApiError("unauthorized", "Entre com sua conta para ver a Central de qualidade.");

  const applicationId = url.searchParams.get("aplicacao")?.trim() ?? "";
  if (applicationId && context.applications) {
    if (!(await context.applications.get(viewer.id, applicationId))) throw new ApiError("not_found", "Aplicação não encontrada.");
  }

  const since = readInstant(url.searchParams.get("de"), "de");

  const summary = await computeQualitySummary(
    { scanJobs: context.scanJobs, codeExecutions: context.codeExecutions, apiCollections: context.apiCollections, applications: context.applications },
    viewer.id,
    { ...(applicationId ? { applicationId } : {}), ...(since ? { since } : {}) },
  );

  json(response, 200, summary);
  return true;
};
