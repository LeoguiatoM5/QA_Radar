import { signInAndReturn } from "./shared.js";

/**
 * Configurações: conta (senha, e-mail), limiares de Alertas e padrões de
 * execução da Inspeção — três formulários independentes, cada um com o
 * próprio botão salvar. Os dois últimos vêm prontos de
 * `GET /api/v1/account/settings`, que já resolve com o padrão do produto
 * quando a conta nunca ajustou nada.
 */
interface SessionUser {
  email?: string;
  emailVerified?: boolean;
  hasPassword?: boolean;
}

interface AccountSettingsPayload {
  alerts: { windowDays: number; thresholdPoints: number; minSample: number };
  scanDefaults: { timeoutMs: number; settleMs: number; ignoredStatuses: string; screenshot: "never" | "on-failure" | "always" };
}

const unavailable = document.querySelector<HTMLElement>("#settings-unavailable");

const emailLabel = document.querySelector<HTMLElement>("#settings-email");
const verifiedBadge = document.querySelector<HTMLElement>("#settings-verified");
const unverifiedBadge = document.querySelector<HTMLElement>("#settings-unverified");
const resendButton = document.querySelector<HTMLButtonElement>("#settings-resend");

const passwordForm = document.querySelector<HTMLFormElement>("#settings-password-form");
const passwordTitle = document.querySelector<HTMLElement>("#settings-password-title");
const currentPasswordField = document.querySelector<HTMLElement>("#settings-current-password")?.closest(".tool-field");
const currentPasswordInput = document.querySelector<HTMLInputElement>("#settings-current-password");
const newPasswordInput = document.querySelector<HTMLInputElement>("#settings-new-password");
const passwordError = document.querySelector<HTMLElement>("#settings-password-error");

const alertsForm = document.querySelector<HTMLFormElement>("#settings-alerts-form");
const windowDaysInput = document.querySelector<HTMLInputElement>("#settings-window-days");
const thresholdPointsInput = document.querySelector<HTMLInputElement>("#settings-threshold-points");
const minSampleInput = document.querySelector<HTMLInputElement>("#settings-min-sample");
const alertsError = document.querySelector<HTMLElement>("#settings-alerts-error");

const scanForm = document.querySelector<HTMLFormElement>("#settings-scan-form");
const timeoutInput = document.querySelector<HTMLInputElement>("#settings-timeout-ms");
const settleInput = document.querySelector<HTMLInputElement>("#settings-settle-ms");
const ignoredStatusesInput = document.querySelector<HTMLInputElement>("#settings-ignored-statuses");
const screenshotSelect = document.querySelector<HTMLSelectElement>("#settings-screenshot");
const scanError = document.querySelector<HTMLElement>("#settings-scan-error");

function say(box: HTMLElement | null, message: string, ok = false): void {
  if (!box) return;
  box.textContent = message;
  box.className = ok ? "error-box ok" : "error-box";
  box.style.display = "block";
}

function clear(box: HTMLElement | null): void {
  if (!box) return;
  box.textContent = "";
  box.style.display = "none";
}

function offline(reason: string): void {
  if (!unavailable) return;
  unavailable.textContent = reason;
  unavailable.hidden = false;
  for (const form of [passwordForm, alertsForm, scanForm]) form?.querySelectorAll("input, select, button").forEach((field) => ((field as HTMLInputElement).disabled = true));
}

function paintAccount(user: SessionUser): void {
  if (emailLabel) emailLabel.textContent = user.email ?? "Conta sem e-mail (entrada só pelo GitHub)";
  if (verifiedBadge) verifiedBadge.hidden = !user.emailVerified;
  if (unverifiedBadge) unverifiedBadge.hidden = !user.email || Boolean(user.emailVerified);
  if (resendButton) resendButton.hidden = !user.email || Boolean(user.emailVerified);
  if (currentPasswordField) (currentPasswordField as HTMLElement).hidden = !user.hasPassword;
  if (currentPasswordInput) currentPasswordInput.required = Boolean(user.hasPassword);
  if (passwordTitle) passwordTitle.textContent = user.hasPassword ? "Trocar senha" : "Definir uma senha";
  if (!user.email && passwordForm) passwordForm.hidden = true;
}

function paintSettings(settings: AccountSettingsPayload): void {
  if (windowDaysInput) windowDaysInput.value = String(settings.alerts.windowDays);
  if (thresholdPointsInput) thresholdPointsInput.value = String(settings.alerts.thresholdPoints);
  if (minSampleInput) minSampleInput.value = String(settings.alerts.minSample);
  if (timeoutInput) timeoutInput.value = String(settings.scanDefaults.timeoutMs);
  if (settleInput) settleInput.value = String(settings.scanDefaults.settleMs);
  if (ignoredStatusesInput) ignoredStatusesInput.value = settings.scanDefaults.ignoredStatuses;
  if (screenshotSelect) screenshotSelect.value = settings.scanDefaults.screenshot;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

resendButton?.addEventListener("click", () => {
  if (!resendButton) return;
  resendButton.disabled = true;
  void (async () => {
    try {
      const response = await fetch("/api/v1/auth/verify/request", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { sent?: boolean; verified?: boolean };
      if (body.verified) {
        resendButton.hidden = true;
        if (verifiedBadge) verifiedBadge.hidden = false;
        if (unverifiedBadge) unverifiedBadge.hidden = true;
        return;
      }
      resendButton.textContent = body.sent ? "Enviado" : "Sem envio de e-mail";
    } catch {
      resendButton.disabled = false;
    }
  })();
});

passwordForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  clear(passwordError);
  void (async () => {
    try {
      const response = await fetch("/api/v1/auth/password/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPasswordInput?.value || undefined, newPassword: newPasswordInput?.value }),
      });
      // 401 aqui quase sempre é senha atual errada, não sessão ausente — a
      // página já teria mandado para /entrar antes de mostrar o formulário. A
      // mensagem do servidor já diferencia os dois casos.
      if (!response.ok) {
        say(passwordError, await readErrorMessage(response, "Não foi possível trocar a senha agora."));
        return;
      }
      if (currentPasswordInput) currentPasswordInput.value = "";
      if (newPasswordInput) newPasswordInput.value = "";
      say(passwordError, "Senha atualizada.", true);
    } catch {
      say(passwordError, "Não foi possível falar com o servidor do QA Radar.");
    }
  })();
});

alertsForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  clear(alertsError);
  void (async () => {
    try {
      const response = await fetch("/api/v1/account/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alerts: { windowDays: Number(windowDaysInput?.value), thresholdPoints: Number(thresholdPointsInput?.value), minSample: Number(minSampleInput?.value) },
        }),
      });
      if (response.status === 401) {
        signInAndReturn();
        return;
      }
      if (!response.ok) {
        say(alertsError, await readErrorMessage(response, "Não foi possível salvar os limiares agora."));
        return;
      }
      say(alertsError, "Limiares salvos.", true);
    } catch {
      say(alertsError, "Não foi possível falar com o servidor do QA Radar.");
    }
  })();
});

scanForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  clear(scanError);
  void (async () => {
    try {
      const response = await fetch("/api/v1/account/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scanDefaults: {
            timeoutMs: Number(timeoutInput?.value),
            settleMs: Number(settleInput?.value),
            ignoredStatuses: ignoredStatusesInput?.value ?? "",
            screenshot: screenshotSelect?.value,
          },
        }),
      });
      if (response.status === 401) {
        signInAndReturn();
        return;
      }
      if (!response.ok) {
        say(scanError, await readErrorMessage(response, "Não foi possível salvar os padrões agora."));
        return;
      }
      say(scanError, "Padrões salvos.", true);
    } catch {
      say(scanError, "Não foi possível falar com o servidor do QA Radar.");
    }
  })();
});

void (async () => {
  try {
    const session = (await (await fetch("/api/v1/auth/me")).json()) as { authenticated?: boolean; loginAvailable?: boolean; user?: SessionUser };
    if (!session.loginAvailable) {
      offline("Configurações depende de conta, e este servidor está sem banco de dados.");
      return;
    }
    if (!session.authenticated || !session.user) {
      signInAndReturn();
      return;
    }
    paintAccount(session.user);
  } catch {
    offline("Não foi possível confirmar a sessão agora.");
    return;
  }

  try {
    const response = await fetch("/api/v1/account/settings");
    if (response.status === 401) {
      signInAndReturn();
      return;
    }
    if (response.ok) paintSettings((await response.json()) as AccountSettingsPayload);
  } catch {
    // Formulários ficam com o valor em branco do HTML; salvar continua funcionando.
  }
})();
