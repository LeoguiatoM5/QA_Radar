import { json, jsonError } from "../http-helpers.js";
import { ApiError } from "../api-error.js";
import { computeAlerts } from "../alerts.js";
import { resolveAccountSettings } from "../account-settings.js";
import { parseEnvironment } from "../environments.js";
import type { RouteHandler } from "./context.js";

/**
 * O que pede atenção agora, para a conta inteira: falhas recentes e queda na
 * taxa de sucesso — ver `src/alerts.ts`. Sem filtro de aplicação de propósito:
 * a granularidade é a conta, não a aplicação.
 */
export const tryHandleAlerts: RouteHandler = async (context, request, response, url) => {
  if (url.pathname !== "/api/alerts") return false;
  if (request.method !== "GET") {
    jsonError(response, "method_not_allowed", "Método não suportado para os Alertas.");
    return true;
  }

  const viewer = await context.currentUser(request);
  if (!viewer) throw new ApiError("unauthorized", "Entre com sua conta para ver os Alertas.");

  // Os limiares vêm de Configurações quando a conta ajustou algo; sem ajuste,
  // ou sem banco, `resolveAccountSettings` já devolve o padrão do produto.
  const stored = await context.accountSettings?.get(viewer.id);
  const { alerts: thresholds } = resolveAccountSettings(stored);

  const environment = parseEnvironment(url.searchParams.get("ambiente"));

  const summary = await computeAlerts(
    { scanJobs: context.scanJobs, codeExecutions: context.codeExecutions, apiCollections: context.apiCollections, applications: context.applications },
    viewer.id,
    thresholds,
    environment,
  );

  json(response, 200, summary);
  return true;
};
