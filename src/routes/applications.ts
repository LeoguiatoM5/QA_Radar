import { json, jsonError, readJson, textField } from "../http-helpers.js";
import { ApiError, invalidRequest } from "../api-error.js";
import { assertPublicUrlShape } from "../security.js";
import { ApplicationNameTakenError, type Application, type ApplicationRepository } from "../application-repository.js";
import type { RequestContext, RouteHandler } from "./context.js";
import type { IncomingMessage } from "node:http";
import type { User } from "../identity.js";
import { publicPersistedJob } from "./scans.js";
import { publicCodeExecution } from "./code-execution.js";

/** Teto do corpo: nome, URL e alguns rótulos não passam disso. */
const MAX_APPLICATION_BODY_BYTES = 8 * 1024;

const MAX_NAME_LENGTH = 60;
const MAX_ENVIRONMENTS = 10;
const MAX_ENVIRONMENT_LENGTH = 40;

/** Teto do histórico devolvido de uma vez, igual ao da conta. */
const MAX_APPLICATION_HISTORY = 50;

function publicApplication(application: Application): Record<string, unknown> {
  return {
    id: application.id,
    name: application.name,
    baseUrl: application.baseUrl,
    environments: application.environments,
    createdAt: application.createdAt,
    archived: application.archivedAt !== undefined,
  };
}

function requireRepository(context: RequestContext): ApplicationRepository {
  if (!context.applications) {
    throw new ApiError("feature_disabled", "Aplicações exigem banco de dados e não estão disponíveis neste servidor.");
  }
  return context.applications;
}

async function requireAccount(context: RequestContext, request: IncomingMessage): Promise<User> {
  const user = await context.currentUser(request);
  if (!user) throw new ApiError("unauthorized", "Entre com sua conta para gerenciar suas aplicações.");
  return user;
}

function readName(body: Record<string, unknown>, required: boolean): string | undefined {
  const name = textField(body, "name");
  if (name === undefined) {
    if (required) throw invalidRequest("Dê um nome para a aplicação.");
    return undefined;
  }
  if (name.length > MAX_NAME_LENGTH) throw invalidRequest(`O nome pode ter no máximo ${MAX_NAME_LENGTH} caracteres.`);
  return name;
}

function readBaseUrl(body: Record<string, unknown>, required: boolean): string | undefined {
  const baseUrl = textField(body, "baseUrl");
  if (baseUrl === undefined) {
    if (required) throw invalidRequest("Informe a URL base da aplicação.");
    return undefined;
  }
  // Só a forma: resolver DNS no cadastro transformaria esta rota numa sonda de
  // rede a pedido de qualquer conta, e recusaria a URL de uma aplicação que
  // ainda não subiu. A política completa vale na hora de analisar.
  return assertPublicUrlShape(baseUrl).toString();
}

function readEnvironments(body: Record<string, unknown>): string[] | undefined {
  if (body.environments === undefined) return undefined;
  if (!Array.isArray(body.environments)) throw invalidRequest("Os ambientes devem vir numa lista.");
  if (body.environments.length > MAX_ENVIRONMENTS) throw invalidRequest(`São permitidos no máximo ${MAX_ENVIRONMENTS} ambientes.`);
  const environments: string[] = [];
  for (const entry of body.environments) {
    if (typeof entry !== "string") throw invalidRequest("Cada ambiente deve ser um texto.");
    const label = entry.trim();
    if (!label) continue;
    if (label.length > MAX_ENVIRONMENT_LENGTH) throw invalidRequest(`Cada ambiente pode ter no máximo ${MAX_ENVIRONMENT_LENGTH} caracteres.`);
    // Repetido não é erro do usuário, é só ruído: some sem reclamar.
    if (!environments.some((existing) => existing.toLowerCase() === label.toLowerCase())) environments.push(label);
  }
  return environments;
}

/** Conflito de nome é do usuário e precisa dizer o que houve. */
function asApiError(error: unknown): never {
  if (error instanceof ApplicationNameTakenError) throw new ApiError("conflict", error.message);
  throw error;
}

export const tryHandleApplications: RouteHandler = async (context, request, response, url) => {
  if (!url.pathname.startsWith("/api/applications")) return false;

  const rest = url.pathname.slice("/api/applications".length);

  /**
   * Histórico da aplicação.
   *
   * A Inspeção grava `application_id` desde que Aplicações existe, mas nada
   * lia essa coluna: o vínculo era gravado e nunca mostrado. É aqui que ele
   * vira algo que a pessoa vê.
   */
  const historyMatch = /^\/([^/]+)\/scans$/.exec(rest);
  if (historyMatch?.[1]) {
    if (request.method !== "GET") {
      jsonError(response, "method_not_allowed", "Método não suportado para o histórico da aplicação.");
      return true;
    }
    const repository = requireRepository(context);
    const user = await requireAccount(context, request);
    // 404 e não 403 pelo mesmo motivo do GET de uma aplicação: responder
    // "proibido" confirmaria que aquele id existe na conta de outra pessoa.
    if (!(await repository.get(user.id, historyMatch[1]))) throw new ApiError("not_found", "Aplicação não encontrada.");
    const scans = await context.scanJobs.listForApplication(user.id, historyMatch[1], MAX_APPLICATION_HISTORY);
    // A Jornada entra na mesma resposta, e não num endpoint próprio: o histórico
    // de uma aplicação é uma pergunta só — "o que rodou aqui" — e dividi-la em
    // duas chamadas obrigaria a tela a costurar duas linhas do tempo. Vazio
    // quando não há banco, que é quando a Jornada não deixa registro.
    const journeys = (await context.codeExecutions?.listByApplication(user.id, historyMatch[1], MAX_APPLICATION_HISTORY)) ?? [];
    json(response, 200, { scans: scans.map((scan) => publicPersistedJob(scan)), journeys: journeys.map((journey) => publicCodeExecution(journey)) });
    return true;
  }

  const id = rest.startsWith("/") ? rest.slice(1) : "";
  if (id.includes("/")) return false;

  if (!id) {
    if (request.method === "GET") {
      const repository = requireRepository(context);
      const user = await requireAccount(context, request);
      const includeArchived = url.searchParams.get("arquivadas") === "1";
      const applications = await repository.listByOwner(user.id, { includeArchived });
      json(response, 200, { applications: applications.map(publicApplication) });
      return true;
    }

    if (request.method === "POST") {
      const repository = requireRepository(context);
      const user = await requireAccount(context, request);
      const body = await readJson(request, MAX_APPLICATION_BODY_BYTES);
      const name = readName(body, true) as string;
      const baseUrl = readBaseUrl(body, true) as string;
      const environments = readEnvironments(body) ?? [];
      try {
        const created = await repository.create({ ownerId: user.id, name, baseUrl, environments });
        json(response, 201, { application: publicApplication(created) });
      } catch (error) {
        asApiError(error);
      }
      return true;
    }

    jsonError(response, "method_not_allowed", "Método não suportado para aplicações.");
    return true;
  }

  const repository = requireRepository(context);
  const user = await requireAccount(context, request);

  if (request.method === "GET") {
    const application = await repository.get(user.id, id);
    // 404 e não 403 de propósito: responder "proibido" confirmaria que aquele
    // id existe na conta de outra pessoa.
    if (!application) throw new ApiError("not_found", "Aplicação não encontrada.");
    json(response, 200, { application: publicApplication(application) });
    return true;
  }

  if (request.method === "PATCH") {
    const body = await readJson(request, MAX_APPLICATION_BODY_BYTES);
    const changes = { name: readName(body, false), baseUrl: readBaseUrl(body, false), environments: readEnvironments(body) };
    if (changes.name === undefined && changes.baseUrl === undefined && changes.environments === undefined) {
      throw invalidRequest("Nada para alterar.");
    }
    try {
      const updated = await repository.update(user.id, id, changes);
      if (!updated) throw new ApiError("not_found", "Aplicação não encontrada.");
      json(response, 200, { application: publicApplication(updated) });
    } catch (error) {
      asApiError(error);
    }
    return true;
  }

  if (request.method === "DELETE") {
    // Arquiva em vez de apagar: as análises já feitas apontam para cá, e sumir
    // com o registro deixaria o histórico sem nome.
    if (!(await repository.archive(user.id, id))) throw new ApiError("not_found", "Aplicação não encontrada.");
    json(response, 200, { archived: true });
    return true;
  }

  jsonError(response, "method_not_allowed", "Método não suportado para aplicações.");
  return true;
};
