import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DashboardActivity, DashboardActivityStatus, DashboardActivityType } from "../dashboard-activity-store.js";
import { json, readJson } from "../http-helpers.js";
import type { RouteHandler } from "./context.js";

const COOKIE_NAME = "qa_radar_dashboard";
const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set<DashboardActivityType>(["scan", "journey", "api"]);
const ALLOWED_STATUSES = new Set<DashboardActivityStatus>(["success", "error"]);
const ALLOWED_PATHS = new Set(["/scanner", "/journeys", "/api-tests"]);
const SCORE_NAMES = ["http", "performance", "accessibility", "dom", "javascript"] as const;

function requestIsSecure(request: IncomingMessage, trustProxy: boolean): boolean {
  const forwardedProto = request.headers["x-forwarded-proto"];
  return Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted) || (trustProxy && forwardedProto === "https");
}

function dashboardSession(request: IncomingMessage, response: ServerResponse, trustProxy: boolean): string {
  const cookie = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const current = cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : undefined;
  if (current && SESSION_PATTERN.test(current)) return current;
  const sessionId = randomUUID();
  response.setHeader("set-cookie", `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${requestIsSecure(request, trustProxy) ? "; Secure" : ""}`);
  return sessionId;
}

function limitedText(value: unknown, name: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new Error(`${name} inválido.`);
  const normalized = value.trim();
  if ((!normalized && !allowEmpty) || normalized.length > maxLength) throw new Error(`${name} inválido.`);
  return normalized;
}

function limitedNumber(value: unknown, name: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`${name} inválido.`);
  return Math.round(value);
}

function safeHref(value: unknown): string {
  const href = limitedText(value, "Destino", 200);
  const parsed = new URL(href, "http://localhost");
  if (parsed.origin !== "http://localhost" || !ALLOWED_PATHS.has(parsed.pathname)) throw new Error("Destino inválido.");
  if (parsed.pathname !== "/api-tests") return parsed.pathname;
  const activity = parsed.searchParams.get("activity");
  return activity && /^\d{10,16}$/.test(activity) ? `/api-tests?activity=${activity}` : "/api-tests";
}

function activityFromBody(body: Record<string, unknown>): DashboardActivity {
  const type = body.type;
  const status = body.status;
  if (typeof type !== "string" || !ALLOWED_TYPES.has(type as DashboardActivityType)) throw new Error("Tipo de atividade inválido.");
  if (typeof status !== "string" || !ALLOWED_STATUSES.has(status as DashboardActivityStatus)) throw new Error("Status de atividade inválido.");
  const rawScores = body.scores && typeof body.scores === "object" && !Array.isArray(body.scores) ? (body.scores as Record<string, unknown>) : {};
  const scores: DashboardActivity["scores"] = {};
  for (const name of SCORE_NAMES) {
    const value = rawScores[name];
    if (value !== undefined) scores[name] = limitedNumber(value, `Score ${name}`, 100);
  }
  return {
    id: limitedText(body.id, "ID", 120),
    type: type as DashboardActivityType,
    title: limitedText(body.title, "Título", 200),
    detail: limitedText(body.detail, "Detalhe", 250, true),
    status: status as DashboardActivityStatus,
    errors: limitedNumber(body.errors, "Erros", 100_000),
    warnings: limitedNumber(body.warnings, "Avisos", 100_000),
    durationMs: limitedNumber(body.durationMs, "Duração", 24 * 60 * 60 * 1000),
    createdAt: Date.now(),
    href: safeHref(body.href),
    scores,
  };
}

export const tryHandleDashboardActivity: RouteHandler = async (context, request, response, url) => {
  const isActivity = url.pathname === "/api/dashboard/activity";
  const isEventStream = url.pathname === "/api/dashboard/activity/events";
  if (!isActivity && !isEventStream) return false;
  const sessionId = dashboardSession(request, response, context.config.trustProxy);

  if (isEventStream) {
    if (request.method !== "GET") {
      response.setHeader("allow", "GET");
      json(response, 405, { error: "Método não permitido." });
      return true;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.write("retry: 3000\n\n");
    const unsubscribe = context.dashboardActivity.subscribe(sessionId, (activity) => {
      if (!response.destroyed) response.write(`data: ${JSON.stringify(activity)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!response.destroyed) response.write(": heartbeat\n\n");
    }, 20_000);
    heartbeat.unref();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (!response.writableEnded) response.end();
    };
    request.once("aborted", close);
    response.once("close", close);
    return true;
  }

  if (request.method === "GET") {
    json(response, 200, { activities: await context.dashboardActivity.list(sessionId) });
    return true;
  }

  if (request.method === "POST") {
    const activity = activityFromBody(await readJson(request, 16 * 1024));
    await context.dashboardActivity.append(sessionId, activity);
    json(response, 201, { activity });
    return true;
  }

  response.setHeader("allow", "GET, POST");
  json(response, 405, { error: "Método não permitido." });
  return true;
};
