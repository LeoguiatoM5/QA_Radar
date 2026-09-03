import { DEFAULT_ALERT_THRESHOLDS, type AlertThresholds } from "./alerts.js";
import type { ScreenshotMode } from "./types.js";

/**
 * Preferências da conta: os limiares de Alertas e os padrões de execução da
 * Inspeção, os dois ajustáveis em `/configuracoes`.
 *
 * Uma linha por conta, todo campo opcional (`StoredAccountSettings`) — linha
 * ausente ou campo ausente significa "use o padrão do produto". A resolução
 * com os padrões acontece aqui, fora do repositório, na mesma separação que já
 * existe entre `quality-summary.ts` (puro) e `routes/quality.ts` (valida e
 * lança): o repositório só guarda o que foi ajustado, nunca os defaults.
 */
export interface ScanDefaults {
  timeoutMs: number;
  settleMs: number;
  ignoredStatuses: string;
  screenshot: ScreenshotMode;
}

export interface AccountSettings {
  alerts: AlertThresholds;
  scanDefaults: ScanDefaults;
}

/** O que o repositório grava — cada campo, independente dos outros, pode estar ausente. */
export interface StoredAccountSettings {
  alertWindowDays?: number | undefined;
  alertThresholdPoints?: number | undefined;
  alertMinSample?: number | undefined;
  scanTimeoutMs?: number | undefined;
  scanSettleMs?: number | undefined;
  scanIgnoredStatuses?: string | undefined;
  scanScreenshot?: ScreenshotMode | undefined;
}

export const DEFAULT_SCAN_DEFAULTS: ScanDefaults = { timeoutMs: 30_000, settleMs: 2_000, ignoredStatuses: "", screenshot: "on-failure" };

export function resolveAccountSettings(stored: StoredAccountSettings | undefined): AccountSettings {
  return {
    alerts: {
      windowDays: stored?.alertWindowDays ?? DEFAULT_ALERT_THRESHOLDS.windowDays,
      thresholdPoints: stored?.alertThresholdPoints ?? DEFAULT_ALERT_THRESHOLDS.thresholdPoints,
      minSample: stored?.alertMinSample ?? DEFAULT_ALERT_THRESHOLDS.minSample,
    },
    scanDefaults: {
      timeoutMs: stored?.scanTimeoutMs ?? DEFAULT_SCAN_DEFAULTS.timeoutMs,
      settleMs: stored?.scanSettleMs ?? DEFAULT_SCAN_DEFAULTS.settleMs,
      ignoredStatuses: stored?.scanIgnoredStatuses ?? DEFAULT_SCAN_DEFAULTS.ignoredStatuses,
      screenshot: stored?.scanScreenshot ?? DEFAULT_SCAN_DEFAULTS.screenshot,
    },
  };
}
