/**
 * Cadastro de aplicações da conta.
 *
 * O mesmo formulário cria e edita: o `#application-id` oculto é o que decide
 * entre `POST` e `PATCH`, e é ele que o "Cancelar edição" limpa.
 */
interface Application {
  id: string;
  name: string;
  baseUrl: string;
  environments?: string[];
}

const applicationForm = document.querySelector<HTMLFormElement>("#application-form");
const applicationList = document.querySelector<HTMLElement>("#application-list");
const applicationHint = document.querySelector<HTMLElement>("#application-list-hint");
const applicationError = document.querySelector<HTMLElement>("#application-error");
const applicationTitle = document.querySelector<HTMLElement>("#application-form-title");
const applicationSubmit = document.querySelector<HTMLButtonElement>("#application-submit");
const applicationCancel = document.querySelector<HTMLButtonElement>("#application-cancel");
const fieldId = document.querySelector<HTMLInputElement>("#application-id");
const fieldName = document.querySelector<HTMLInputElement>("#application-name");
const fieldBaseUrl = document.querySelector<HTMLInputElement>("#application-base-url");
const fieldEnvironments = document.querySelector<HTMLInputElement>("#application-environments");

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
const appEsc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (char) => escapes[char] ?? char);

function applicationFail(message: string): void {
  if (!applicationError) return;
  applicationError.textContent = message;
  applicationError.style.display = "block";
}

function applicationClearError(): void {
  if (!applicationError) return;
  applicationError.textContent = "";
  applicationError.style.display = "none";
}

function editApplication(application: Application): void {
  if (fieldId) fieldId.value = application.id;
  if (fieldName) fieldName.value = application.name;
  if (fieldBaseUrl) fieldBaseUrl.value = application.baseUrl;
  if (fieldEnvironments) fieldEnvironments.value = (application.environments ?? []).join(", ");
  if (applicationTitle) applicationTitle.textContent = "Editar aplicação";
  if (applicationSubmit) applicationSubmit.textContent = "Salvar alterações";
  if (applicationCancel) applicationCancel.hidden = false;
  applicationClearError();
  fieldName?.focus();
}

function resetApplicationForm(): void {
  applicationForm?.reset();
  if (fieldId) fieldId.value = "";
  if (applicationTitle) applicationTitle.textContent = "Nova aplicação";
  if (applicationSubmit) applicationSubmit.textContent = "Cadastrar aplicação";
  if (applicationCancel) applicationCancel.hidden = true;
  applicationClearError();
}

applicationCancel?.addEventListener("click", resetApplicationForm);

function renderApplications(applications: Application[]): void {
  if (!applicationList) return;
  if (!applications.length) {
    applicationList.innerHTML = "";
    if (applicationHint) applicationHint.textContent = "Nenhuma aplicação cadastrada ainda. Comece pelo formulário ao lado.";
    return;
  }
  if (applicationHint) applicationHint.textContent = applications.length === 1 ? "1 aplicação cadastrada." : `${applications.length} aplicações cadastradas.`;
  applicationList.innerHTML = applications
    .map((application) => {
      const tags = application.environments?.length ? `<div class="application-tags">${application.environments.map((environment) => `<span>${appEsc(environment)}</span>`).join("")}</div>` : "";
      return (
        `<article class="application-item" data-id="${appEsc(application.id)}">` +
        `<div class="application-info"><strong>${appEsc(application.name)}</strong>` +
        `<a href="${appEsc(application.baseUrl)}" target="_blank" rel="noopener noreferrer">${appEsc(application.baseUrl)}</a>` +
        tags +
        "</div>" +
        '<div class="application-actions">' +
        '<button type="button" data-action="history" aria-expanded="false">Histórico</button>' +
        '<button type="button" data-action="scan">Inspecionar</button>' +
        '<button type="button" data-action="edit">Editar</button>' +
        '<button type="button" data-action="archive">Arquivar</button>' +
        "</div>" +
        '<div class="application-history" hidden></div>' +
        "</article>"
      );
    })
    .join("");
}

/**
 * Desligar é mais honesto que deixar digitar: o campo aberto promete um
 * cadastro que o servidor não tem como aceitar.
 */
function disableApplicationForm(reason: string): void {
  if (applicationHint) applicationHint.textContent = reason;
  for (const field of [fieldName, fieldBaseUrl, fieldEnvironments, applicationSubmit]) if (field) field.disabled = true;
  const notice = document.querySelector<HTMLElement>("#application-unavailable");
  if (notice) {
    notice.textContent = reason;
    notice.hidden = false;
  }
}

interface PersistedScan {
  id: string;
  status?: string;
  createdAt?: string;
  report?: { url?: string; targetUrl?: string; title?: string; passed?: boolean; durationMs?: number; summary?: { errors?: number; warnings?: number } };
}

function scanLine(scan: PersistedScan): string {
  const report = scan.report;
  const done = scan.status === "completed";
  const passed = done && report?.passed !== false;
  const summary = report?.summary;
  const quando = scan.createdAt ? new Date(scan.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
  const resultado = done ? `${summary?.errors ?? 0} erro(s) · ${summary?.warnings ?? 0} aviso(s)` : (scan.status ?? "—");
  return `<div class="application-run"><i class="${passed ? "pass" : ""}"></i><span>${appEsc(quando)} · ${appEsc(resultado)}</span><b>${done && report?.durationMs ? `${(report.durationMs / 1000).toFixed(1)}s` : ""}</b></div>`;
}

/**
 * O histórico da aplicação, aberto sob demanda.
 *
 * A Inspeção grava o vínculo desde que Aplicações existe, mas nada lia a
 * coluna. Nasce fechado porque a lista precisa continuar escaneável: quem abre
 * a página quer ver quais aplicações tem, não a última execução de cada uma.
 */
async function toggleHistory(button: HTMLButtonElement, application: Application): Promise<void> {
  const box = button.closest<HTMLElement>(".application-item")?.querySelector<HTMLElement>(".application-history");
  if (!box) return;
  const abrindo = box.hidden;
  box.hidden = !abrindo;
  button.setAttribute("aria-expanded", String(abrindo));
  if (!abrindo) return;
  box.innerHTML = "<p>Carregando execuções…</p>";
  try {
    const response = await fetch(`/api/v1/applications/${encodeURIComponent(application.id)}/scans`);
    if (!response.ok) {
      box.innerHTML = "<p>Não foi possível carregar o histórico desta aplicação.</p>";
      return;
    }
    const scans = ((await response.json()) as { scans?: PersistedScan[] }).scans ?? [];
    box.innerHTML = scans.length ? scans.map(scanLine).join("") : "<p>Nenhuma análise guardada nesta aplicação ainda. Use <strong>Inspecionar</strong> para começar.</p>";
  } catch {
    box.innerHTML = "<p>Não foi possível carregar o histórico desta aplicação.</p>";
  }
}

function signInAndReturn(): void {
  location.href = `/entrar?proximo=${encodeURIComponent(location.pathname)}`;
}

let applicationsCache: Application[] = [];

async function loadApplications(): Promise<void> {
  try {
    const response = await fetch("/api/v1/applications");
    if (response.status === 401) {
      signInAndReturn();
      return;
    }
    const body = (await response.json()) as { applications?: Application[]; error?: string };
    if (!response.ok) {
      disableApplicationForm(body.error ?? "Não foi possível carregar suas aplicações.");
      return;
    }
    applicationsCache = body.applications ?? [];
    renderApplications(applicationsCache);
  } catch {
    disableApplicationForm("Não foi possível carregar suas aplicações.");
  }
}

applicationList?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  const id = button.closest<HTMLElement>(".application-item")?.dataset.id;
  const application = applicationsCache.find((item) => item.id === id);
  if (!application) return;
  if (button.dataset.action === "edit") {
    editApplication(application);
    return;
  }
  if (button.dataset.action === "history") {
    void toggleHistory(button, application);
    return;
  }
  if (button.dataset.action === "scan") {
    location.href = `/scanner?aplicacao=${encodeURIComponent(application.id)}`;
    return;
  }
  // Arquivar é reversível no banco, mas some da lista: confirmar evita o clique
  // errado numa lista onde os botões ficam lado a lado.
  if (!confirm(`Arquivar "${application.name}"? As análises já feitas continuam no histórico.`)) return;
  button.disabled = true;
  void (async () => {
    try {
      const response = await fetch(`/api/v1/applications/${encodeURIComponent(application.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        applicationFail(body.error ?? "Não foi possível arquivar.");
        button.disabled = false;
        return;
      }
      await loadApplications();
    } catch {
      applicationFail("Não foi possível arquivar.");
      button.disabled = false;
    }
  })();
});

applicationForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  applicationClearError();
  const id = fieldId?.value ?? "";
  const payload = {
    name: fieldName?.value.trim() ?? "",
    baseUrl: fieldBaseUrl?.value.trim() ?? "",
    environments: (fieldEnvironments?.value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  };
  if (applicationSubmit) applicationSubmit.disabled = true;
  void (async () => {
    try {
      const response = await fetch(`/api/v1/applications${id ? `/${encodeURIComponent(id)}` : ""}`, {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        signInAndReturn();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        applicationFail(body.error ?? "Não foi possível salvar.");
        return;
      }
      resetApplicationForm();
      await loadApplications();
    } catch {
      applicationFail("Não foi possível salvar.");
    } finally {
      if (applicationSubmit) applicationSubmit.disabled = false;
    }
  })();
});

void loadApplications();

// O navegador carrega este arquivo como módulo ES, com escopo próprio. O
// `export {}` diz o mesmo ao compilador: sem ele os nomes do topo entrariam no
// escopo global e colidiriam com os de outro módulo.
export {};
