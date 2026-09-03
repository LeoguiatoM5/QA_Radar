import { json, jsonError } from "../http-helpers.js";
import { ApiError, invalidRequest } from "../api-error.js";
import { MAX_HISTORY_PAGE, readExecutionHistory, type ExecutionKind } from "../execution-history.js";
import type { HistoryCursor } from "../history-query.js";
import type { RouteHandler } from "./context.js";

const KINDS: readonly ExecutionKind[] = ["scan", "journey", "api"];

const DEFAULT_PAGE = 50;

/** Lê `tipo=scan,api` como lista de origens, recusando o que não existe. */
function readKinds(raw: string | null): ExecutionKind[] {
  if (!raw) return [];
  const asked = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const kind of asked) {
    if (!KINDS.includes(kind as ExecutionKind)) throw invalidRequest(`Tipo de execução desconhecido: ${kind}.`);
  }
  return asked as ExecutionKind[];
}

/** Lê uma data do filtro, recusando o que não é data em vez de ignorar. */
function readInstant(raw: string | null, field: string): string | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw invalidRequest(`O parâmetro ${field} precisa ser uma data ISO 8601.`);
  return parsed.toISOString();
}

/**
 * Lê o cursor no formato `<data ISO>|<id>`.
 *
 * O id vai junto porque duas execuções cabem no mesmo milissegundo: sem ele, as
 * empatadas com a última linha da página eram puladas de vez. O valor é sempre
 * um que a resposta anterior devolveu — quem inventar um mal formado recebe 400
 * em vez de uma lista silenciosamente errada.
 */
function readCursor(raw: string | null): HistoryCursor | undefined {
  if (!raw) return undefined;
  const marker = raw.lastIndexOf("|");
  const createdAt = marker < 0 ? "" : raw.slice(0, marker);
  const id = marker < 0 ? "" : raw.slice(marker + 1);
  if (!createdAt || !id || Number.isNaN(new Date(createdAt).getTime())) {
    throw invalidRequest("O parâmetro cursor precisa ser o valor devolvido em nextCursor.");
  }
  return { createdAt: new Date(createdAt).toISOString(), id };
}

/**
 * A linha do tempo consultável da conta.
 *
 * Existe porque o histórico estava espalhado: cada origem mostrava o seu, e a
 * pergunta "o que aconteceu na semana passada" não tinha onde ser feita. O
 * filtro vai para o SQL de cada repositório; o cursor é a posição da última
 * linha, não um deslocamento — ver `src/execution-history.ts`.
 */
export const tryHandleExecutions: RouteHandler = async (context, request, response, url) => {
  if (url.pathname !== "/api/executions") return false;
  if (request.method !== "GET") {
    jsonError(response, "method_not_allowed", "Método não suportado para o histórico de execuções.");
    return true;
  }

  const viewer = await context.currentUser(request);
  if (!viewer) throw new ApiError("unauthorized", "Entre com sua conta para consultar o histórico de execuções.");

  const applicationId = url.searchParams.get("aplicacao")?.trim() ?? "";
  if (applicationId && context.applications) {
    // Conferido contra o dono, como em toda leitura por aplicação: sem isso um
    // id vazado devolveria a linha do tempo de outra conta.
    if (!(await context.applications.get(viewer.id, applicationId))) throw new ApiError("not_found", "Aplicação não encontrada.");
  }

  const rawLimit = url.searchParams.get("limite");
  const limit = rawLimit ? Number(rawLimit) : DEFAULT_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_PAGE) {
    throw invalidRequest(`O parâmetro limite precisa ser um inteiro entre 1 e ${MAX_HISTORY_PAGE}.`);
  }

  const cursor = readCursor(url.searchParams.get("cursor"));
  const since = readInstant(url.searchParams.get("de"), "de");

  const page = await readExecutionHistory(
    { scanJobs: context.scanJobs, codeExecutions: context.codeExecutions, apiCollections: context.apiCollections, applications: context.applications },
    viewer.id,
    {
      ...(applicationId ? { applicationId } : {}),
      ...(since ? { since } : {}),
      ...(cursor ? { before: cursor } : {}),
      kinds: readKinds(url.searchParams.get("tipo")),
      limit,
    },
  );

  // O cursor viaja como texto: a página o devolve tal e qual no `cursor` da
  // próxima chamada, sem precisar remontar a tupla.
  json(response, 200, { executions: page.entries, nextCursor: page.nextCursor ? `${page.nextCursor.createdAt}|${page.nextCursor.id}` : undefined });
  return true;
};
