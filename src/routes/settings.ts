import { json, jsonError, readJson } from "../http-helpers.js";
import { ApiError, invalidRequest } from "../api-error.js";
import { resolveAccountSettings } from "../account-settings.js";
import type { StoredAccountSettings } from "../account-settings.js";
import type { ScreenshotMode } from "../types.js";
import type { RouteHandler } from "./context.js";

const MAX_SETTINGS_BODY_BYTES = 4 * 1024;

const SCREENSHOT_MODES = new Set<ScreenshotMode>(["never", "on-failure", "always"]);

/** Lê um inteiro do corpo, dentro do intervalo aceito. Ausente = não mexe no campo. */
function intField(body: Record<string, unknown>, name: string, min: number, max: number): number | undefined {
  const value = (body as Record<string, unknown>)[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw invalidRequest(`O campo ${name} precisa ser um número inteiro entre ${min} e ${max}.`);
  }
  return value;
}

function textFieldOrEmpty(body: Record<string, unknown>, name: string, maxLength: number): string | undefined {
  const value = (body as Record<string, unknown>)[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maxLength) throw invalidRequest(`O campo ${name} precisa ser um texto de até ${maxLength} caracteres.`);
  return value.trim();
}

function screenshotField(body: Record<string, unknown>): ScreenshotMode | undefined {
  const value = (body as Record<string, unknown>).screenshot;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SCREENSHOT_MODES.has(value as ScreenshotMode)) throw invalidRequest("O campo screenshot precisa ser 'never', 'on-failure' ou 'always'.");
  return value as ScreenshotMode;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Só os campos que a requisição realmente enviou — ausência nunca vira alteração. */
function parsePatch(body: Record<string, unknown>): StoredAccountSettings {
  const alerts = record(body.alerts);
  const scanDefaults = record(body.scanDefaults);
  const patch: StoredAccountSettings = {
    alertWindowDays: intField(alerts, "windowDays", 1, 90),
    alertThresholdPoints: intField(alerts, "thresholdPoints", 1, 100),
    alertMinSample: intField(alerts, "minSample", 1, 500),
    scanTimeoutMs: intField(scanDefaults, "timeoutMs", 1_000, 120_000),
    scanSettleMs: intField(scanDefaults, "settleMs", 0, 30_000),
    scanIgnoredStatuses: textFieldOrEmpty(scanDefaults, "ignoredStatuses", 200),
    scanScreenshot: screenshotField(scanDefaults),
  };
  const hasChange = Object.values(patch).some((value) => value !== undefined);
  if (!hasChange) throw invalidRequest("Nada para alterar.");
  return patch;
}

/**
 * Preferências da conta: os limiares de Alertas e os padrões de execução da
 * Inspeção — ver `src/account-settings.ts`. `PATCH` altera só os campos
 * enviados; o resto continua como estava.
 */
export const tryHandleSettings: RouteHandler = async (context, request, response, url) => {
  if (url.pathname !== "/api/account/settings") return false;

  const viewer = await context.currentUser(request);
  if (!viewer) throw new ApiError("unauthorized", "Entre com sua conta para ver as Configurações.");

  if (request.method === "GET") {
    const stored = await context.accountSettings?.get(viewer.id);
    json(response, 200, resolveAccountSettings(stored));
    return true;
  }

  if (request.method === "PATCH") {
    if (!context.accountSettings) throw new ApiError("feature_disabled", "Configurações de conta exigem banco de dados neste servidor.");
    const body = await readJson(request, MAX_SETTINGS_BODY_BYTES);
    const patch = parsePatch(body);
    const stored = await context.accountSettings.update(viewer.id, patch);
    json(response, 200, resolveAccountSettings(stored));
    return true;
  }

  jsonError(response, "method_not_allowed", "Método não suportado para as Configurações.");
  return true;
};
