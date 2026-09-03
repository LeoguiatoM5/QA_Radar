import { esc, recordActivity } from "./shared.js";

/**
 * Cliente do Modo Jornada de Playwright.
 *
 * Três coisas acontecem aqui: gravar com o Codegen (só quando o servidor roda
 * na máquina de quem usa), executar o `.spec.ts` do editor, e transformar a
 * execução concluída num relatório de evidências.
 */
const journeyEvidenceModal = document.querySelector<HTMLDialogElement>("#journey-evidence-modal");
const journeyEvidenceForm = document.querySelector<HTMLFormElement>("#journey-evidence-form");
for (const id of ["journey-evidence-close", "journey-evidence-cancel"]) {
  document.querySelector<HTMLButtonElement>(`#${id}`)?.addEventListener("click", () => journeyEvidenceModal?.close());
}

const codeStart = document.querySelector<HTMLButtonElement>("#codegen-start");
const codeStop = document.querySelector<HTMLButtonElement>("#codegen-stop");
const codeUrl = document.querySelector<HTMLInputElement>("#codegen-url");
const codeEditor = document.querySelector<HTMLTextAreaElement>("#playwright-code");
const codeError = document.querySelector<HTMLElement>("#codegen-error");
const codeResult = document.querySelector<HTMLElement>("#code-result");
let codegenId: string | undefined;
let completedCodeExecutionId: string | undefined;

function showCodeError(message: string): void {
  if (!codeError) return;
  codeError.textContent = message;
  codeError.style.display = "block";
}

function hideCodeError(): void {
  if (codeError) codeError.style.display = "none";
}

const codeEvidenceButton = document.createElement("button");
codeEvidenceButton.id = "code-evidence-button";
codeEvidenceButton.className = "secondary";
codeEvidenceButton.type = "button";
codeEvidenceButton.textContent = "Gerar relatório HTML";
codeEvidenceButton.hidden = true;
codeResult?.parentElement?.insertBefore(codeEvidenceButton, codeResult.nextSibling);

// O botão de evidência só faz sentido depois de existir um resultado, e o id da
// execução vem do próprio texto que o resultado escreve.
if (codeResult) {
  new MutationObserver(() => {
    if (codeResult.hidden) return;
    codeEvidenceButton.hidden = false;
    const match = /Execução ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(codeResult.textContent ?? "");
    if (match?.[1]) codeResult.dataset.executionId = match[1];
  }).observe(codeResult, { attributes: true, childList: true, subtree: true, attributeFilter: ["hidden"] });
}

const evidenceStepsBox = document.querySelector<HTMLElement>("#journey-evidence-steps");

function bindEvidenceStepEditing(): void {
  for (const row of evidenceStepsBox?.querySelectorAll<HTMLElement>(".evidence-step") ?? []) {
    const viewBox = row.querySelector<HTMLElement>(".evidence-step-view");
    const view = row.querySelector<HTMLElement>(".evidence-step-view p");
    const input = row.querySelector<HTMLInputElement>("input");
    const button = row.querySelector<HTMLButtonElement>(".evidence-step-edit");
    if (!input || !button) continue;
    button.addEventListener("click", () => {
      const editing = row.classList.toggle("editing");
      if (viewBox) viewBox.hidden = editing;
      input.hidden = !editing;
      button.textContent = editing ? "Concluir" : "Editar";
      if (editing) input.focus();
      else if (view) view.textContent = input.value.trim() || input.dataset.original || "";
    });
  }
}

codeEvidenceButton.addEventListener("click", () => {
  completedCodeExecutionId = codeResult?.dataset.executionId;
  if (!completedCodeExecutionId) return;
  void (async () => {
    if (evidenceStepsBox) {
      evidenceStepsBox.innerHTML = '<p class="hint">Carregando passos…</p>';
      try {
        const response = await fetch(`/api/code-executions/${completedCodeExecutionId}/steps`);
        const data = (await response.json()) as { steps?: Array<{ action: string; description?: string }> };
        const steps = response.ok && Array.isArray(data.steps) ? data.steps : [];
        evidenceStepsBox.innerHTML = steps.length
          ? steps
              .map(
                (step, index) =>
                  `<div class="evidence-step"><div class="evidence-step-view"><small>Passo ${index + 1} · ${esc(step.action)}</small><p>${esc(step.description ?? step.action)}</p></div>` +
                  `<input type="text" maxlength="200" value="${esc(step.description ?? "")}" data-original="${esc(step.description ?? "")}" hidden>` +
                  `<button type="button" class="secondary evidence-step-edit">Editar</button></div>`,
              )
              .join("")
          : '<p class="hint">Nenhum passo detectado automaticamente.</p>';
        bindEvidenceStepEditing();
      } catch {
        evidenceStepsBox.innerHTML = '<p class="hint">Não foi possível carregar os passos automaticamente.</p>';
      }
    }
    journeyEvidenceModal?.showModal();
  })();
});

journeyEvidenceForm?.addEventListener("submit", (event) => {
  if (!completedCodeExecutionId) return;
  event.preventDefault();
  const submit = journeyEvidenceForm.querySelector<HTMLButtonElement>("button[type=submit]");
  const error = document.querySelector<HTMLElement>("#journey-evidence-error");
  if (!submit) return;
  if (error) error.style.display = "none";
  submit.disabled = true;
  submit.innerHTML = '<i class="loader"></i>Gerando HTML';
  const stepDescriptions = [...(evidenceStepsBox?.querySelectorAll<HTMLInputElement>(".evidence-step input") ?? [])].map((input) => input.value);
  void (async () => {
    try {
      const response = await fetch(`/api/code-executions/${completedCodeExecutionId}/evidence-report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          testerName: document.querySelector<HTMLInputElement>("#journey-tester-name")?.value ?? "",
          testType: document.querySelector<HTMLSelectElement>("#journey-test-type")?.value ?? "",
          ...(stepDescriptions.length ? { stepDescriptions } : {}),
        }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível gerar o relatório.");
      journeyEvidenceModal?.close();
      if (data.url) window.location.href = data.url;
    } catch (reason) {
      if (error) {
        error.textContent = reason instanceof Error ? reason.message : "Não foi possível gerar o relatório.";
        error.style.display = "block";
      }
    } finally {
      submit.disabled = false;
      submit.textContent = "Gerar HTML";
    }
  })();
});

codeStart?.addEventListener("click", () => {
  hideCodeError();
  void (async () => {
    try {
      const response = await fetch("/api/codegen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: codeUrl?.value ?? "" }) });
      const data = (await response.json()) as { id?: string; error?: string };
      // O gravador abre um navegador na máquina que roda o servidor: hospedado
      // ele não faz sentido.
      if (response.status === 401 || response.status === 403)
        throw new Error("O gravador só funciona com o QA Radar rodando na sua máquina. Neste servidor, cole ou importe o arquivo .spec.ts e execute.");
      if (!response.ok) throw new Error(data.error ?? "Não foi possível iniciar o Codegen.");
      codegenId = data.id;
      codeStart.disabled = true;
      if (codeStop) codeStop.disabled = false;
      codeStart.textContent = "Gravando no navegador…";
    } catch (reason) {
      showCodeError(reason instanceof Error ? reason.message : "Não foi possível iniciar o Codegen.");
    }
  })();
});

codeStop?.addEventListener("click", () => {
  if (!codegenId) return;
  codeStop.disabled = true;
  void (async () => {
    try {
      const response = await fetch(`/api/codegen/${codegenId}`);
      const data = (await response.json()) as { status?: string; code?: string };
      if (data.status !== "completed") {
        showCodeError("Feche a janela do navegador para concluir a gravação e tente novamente.");
        return;
      }
      if (codeEditor) codeEditor.value = data.code ?? "";
      if (codeStart) {
        codeStart.disabled = false;
        codeStart.textContent = "Iniciar nova gravação";
      }
      codegenId = undefined;
    } catch (reason) {
      showCodeError(reason instanceof Error ? reason.message : "Não foi possível concluir a gravação.");
    } finally {
      codeStop.disabled = false;
    }
  })();
});

document.querySelector<HTMLButtonElement>("#code-save")?.addEventListener("click", () => {
  const blob = new Blob([codeEditor?.value ?? ""], { type: "text/typescript" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "qa-radar.spec.ts";
  link.click();
  URL.revokeObjectURL(link.href);
});

/**
 * O token administrativo continua valendo na API, para automação, mas não é
 * mais pedido a uma pessoa: no navegador o caminho é entrar com a conta.
 */
const journeySignin = document.querySelector<HTMLElement>("#journey-signin");
const journeySigninError = document.querySelector<HTMLElement>("#journey-signin-error");

function askToSignIn(message: string): void {
  if (!journeySignin) return;
  journeySignin.hidden = false;
  if (journeySigninError) {
    journeySigninError.textContent = message;
    journeySigninError.style.display = "block";
  }
}

/**
 * Seletor de aplicação da Jornada.
 *
 * Mesma regra do da Inspeção: nasce oculto e só aparece para quem tem conta com
 * aplicação cadastrada. Sem conta ou sem banco não há o que escolher, e um campo
 * vazio ali só levantaria a pergunta "o que é isso?".
 */
const journeyApplicationPicker = document.querySelector<HTMLElement>("#journey-application-picker");
const journeyApplicationSelect = document.querySelector<HTMLSelectElement>("#journey-application");

async function loadJourneyApplications(): Promise<void> {
  if (!journeyApplicationPicker || !journeyApplicationSelect) return;
  try {
    const response = await fetch("/api/v1/applications");
    if (!response.ok) return;
    const applications = ((await response.json()) as { applications?: Array<{ id: string; name: string }> }).applications ?? [];
    if (!applications.length) return;
    for (const application of applications) {
      const option = document.createElement("option");
      option.value = application.id;
      option.textContent = application.name;
      journeyApplicationSelect.append(option);
    }
    journeyApplicationPicker.hidden = false;
    // Vindo de "Executar jornada" na lista de aplicações, já chega escolhida.
    const wanted = new URLSearchParams(location.search).get("aplicacao");
    if (wanted && applications.some((application) => application.id === wanted)) journeyApplicationSelect.value = wanted;
  } catch {
    // Sem aplicações disponíveis o seletor simplesmente não aparece.
  }
}

void loadJourneyApplications();

interface ExecutionResult {
  id: string;
  status?: string;
  error?: string;
  failureDetails?: string;
  report?: { stats?: { duration?: number; expected?: number; unexpected?: number; skipped?: number }; errors?: Array<{ message: string }> };
}

const codeExecute = document.querySelector<HTMLButtonElement>("#code-execute");
codeExecute?.addEventListener("click", () => {
  codeExecute.disabled = true;
  codeExecute.innerHTML = '<i class="loader"></i>Executando';
  hideCodeError();
  if (codeResult) codeResult.hidden = true;
  void (async () => {
    try {
      const response = await fetch("/api/code-execution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: codeEditor?.value ?? "", ...(journeyApplicationSelect?.value ? { applicationId: journeyApplicationSelect.value } : {}) }),
      });
      const data = (await response.json()) as ExecutionResult;
      if (response.status === 401 || response.status === 403) {
        askToSignIn(data.error ?? "Entre com sua conta para executar a jornada.");
        return;
      }
      if (!response.ok && data.status !== "failed") throw new Error(data.error ?? "Não foi possível executar a jornada.");
      if (journeySignin) journeySignin.hidden = true;
      const report = data.report ?? {};
      const passed = data.status === "passed";
      const stats = report.stats ?? {};
      const errors = report.errors ?? [];
      const details = data.failureDetails ?? errors.map((error) => error.message).join("\n\n");
      const duration = Number(stats.duration ?? 0);
      if (codeResult) {
        codeResult.className = `code-result ${passed ? "pass" : "fail"}`;
        codeResult.innerHTML =
          `<div class="code-result-head"><div><span>${passed ? "✓ Jornada aprovada" : "✕ Jornada reprovada"}</span><small>Execução ${esc(data.id)}</small></div><strong>${(duration / 1000).toFixed(1)}s</strong></div>` +
          `<div class="code-result-metrics"><span><b>${stats.expected ?? 0}</b> aprovados</span><span><b>${stats.unexpected ?? 0}</b> falhas</span><span><b>${stats.skipped ?? 0}</b> ignorados</span></div>` +
          (details ? `<pre>${esc(details)}</pre>` : "");
      }
      recordActivity({
        id: `journey-${data.id}`,
        type: "journey",
        title: "Jornada Playwright",
        detail: `${stats.expected ?? 0} aprovado(s) · ${stats.unexpected ?? 0} falha(s)`,
        status: passed ? "success" : "error",
        errors: Number(stats.unexpected ?? 0),
        warnings: Number(stats.skipped ?? 0),
        durationMs: duration,
        href: "/journeys",
        scores: { javascript: passed ? 100 : Math.max(10, 100 - Number(stats.unexpected ?? 0) * 25), dom: passed ? 100 : 55 },
      });
      if (codeResult) codeResult.hidden = false;
    } catch (reason) {
      showCodeError(reason instanceof Error ? reason.message : "Não foi possível executar a jornada.");
    } finally {
      codeExecute.disabled = false;
      codeExecute.textContent = "Executar";
    }
  })();
});

document.querySelector<HTMLInputElement>("#code-import")?.addEventListener("change", (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void file.text().then((content) => {
    if (codeEditor) codeEditor.value = content;
  });
});
