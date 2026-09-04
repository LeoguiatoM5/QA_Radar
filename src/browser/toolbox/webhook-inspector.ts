import { bodyPreview, formatWebhookRequest, type WebhookRequestRecord } from "../../toolbox/webhook.js";
import { clearError, copyText, esc, maybe, need, on, show, showError } from "./ui.js";

const errorBox = need("webhook-error");
const bloco = need("webhook-bin");
const urlBox = need<HTMLInputElement>("webhook-url");
const expiry = need("webhook-expiry");
const panel = need("webhook-result-panel");
const listaBox = need("webhook-list");
const summary = need("webhook-summary");
const vazio = need("webhook-empty");

let binId: string | null = null;
let chamadas: WebhookRequestRecord[] = [];
let timer: number | null = null;

function pintar(): void {
  summary.innerHTML =
    `<span class="tool-status ${chamadas.length ? "tool-status-ok" : "tool-status-warning"}">${chamadas.length} CHAMADA(S)</span>` +
    '<span class="tool-summary-text">As mais recentes primeiro.</span>';
  listaBox.innerHTML = chamadas
    .map((chamada, indice) => {
      const cabecalhos = chamada.headers.map((header) => `<div><dt>${esc(header.name)}</dt><dd${header.redacted ? ' class="tool-secret"' : ""}>${esc(header.value)}</dd></div>`).join("");
      const query = chamada.query.length
        ? `<h4 class="tool-subtitle">Query</h4><dl class="tool-facts">${chamada.query.map((param) => `<div><dt>${esc(param.name)}</dt><dd>${esc(param.value)}</dd></div>`).join("")}</dl>`
        : "";
      let corpo = '<p class="hint">Sem corpo.</p>';
      if (chamada.body) {
        const previa = bodyPreview(chamada.body);
        const avisos: string[] = [];
        if (previa.clipped) {
          avisos.push(
            `Exibindo os primeiros ${previa.text.length.toLocaleString("pt-BR")} de ${previa.storedLength.toLocaleString("pt-BR")} caracteres. Use "Copiar a última" para levar o corpo guardado inteiro.`,
          );
        }
        if (chamada.bodyTruncated) avisos.push("O corpo chegou acima do limite da caixa e foi cortado na gravação.");
        corpo = `<h4 class="tool-subtitle">Corpo</h4><pre class="tool-code webhook-body" tabindex="0">${esc(previa.text)}</pre>${avisos.map((aviso) => `<p class="hint">${esc(aviso)}</p>`).join("")}`;
      }
      return (
        `<details class="webhook-item"${indice === 0 ? " open" : ""}><summary><b>${esc(chamada.method)}</b><code>${esc(chamada.path || "/")}</code><span>${new Date(chamada.receivedAt).toLocaleTimeString("pt-BR")}</span><em>${esc(chamada.origin)}</em></summary>` +
        `<h4 class="tool-subtitle">Cabeçalhos</h4><dl class="tool-facts">${cabecalhos}</dl>${query}${corpo}</details>`
      );
    })
    .join("");
  show(vazio, chamadas.length === 0);
  show(panel, true);
}

function pararAuto(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  const botao = maybe("webhook-auto");
  if (botao) {
    botao.setAttribute("aria-pressed", "false");
    botao.classList.remove("active");
    botao.textContent = "Atualizar sozinho";
  }
}

async function atualizar(): Promise<void> {
  if (!binId) return;
  try {
    const resposta = await fetch(`/api/v1/toolbox/webhooks/${binId}`);
    if (resposta.status === 404) {
      pararAuto();
      showError(errorBox, "A caixa expirou. Abra uma nova.");
      return;
    }
    const corpo = (await resposta.json()) as { requests?: WebhookRequestRecord[] };
    chamadas = corpo.requests ?? [];
    pintar();
  } catch {
    showError(errorBox, "Não foi possível falar com o servidor do QA Radar.");
  }
}

on("webhook-create", "click", (botao: HTMLButtonElement) => {
  void (async () => {
    botao.disabled = true;
    clearError(errorBox);
    try {
      const resposta = await fetch("/api/v1/toolbox/webhooks", { method: "POST" });
      const corpo = (await resposta.json().catch(() => ({}))) as { error?: string; id?: string; expiresAt?: number; maxRequests?: number };
      if (!resposta.ok || !corpo.id) {
        showError(errorBox, corpo.error ?? "Não foi possível abrir a caixa.");
        return;
      }
      binId = corpo.id;
      chamadas = [];
      urlBox.value = `${location.origin}/api/v1/toolbox/webhooks/${binId}`;
      expiry.textContent = `Esta caixa expira em ${new Date(corpo.expiresAt ?? Date.now()).toLocaleTimeString("pt-BR")}. Guarda as ${corpo.maxRequests ?? 0} últimas chamadas.`;
      bloco.hidden = false;
      // O rótulo muda para deixar claro que clicar de novo abandona esta caixa —
      // a anterior não é recuperável, o id era a única forma de chegar nela.
      botao.textContent = "Abrir outra caixa";
      pararAuto();
      pintar();
    } catch {
      showError(errorBox, "Não foi possível falar com o servidor do QA Radar.");
    } finally {
      botao.disabled = false;
    }
  })();
});
on("webhook-copy-url", "click", (botao) => void copyText(botao, urlBox.value));
on("webhook-refresh", "click", () => void atualizar());
on("webhook-auto", "click", (botao) => {
  if (timer !== null) {
    pararAuto();
    return;
  }
  timer = window.setInterval(() => void atualizar(), 3000);
  botao.setAttribute("aria-pressed", "true");
  botao.classList.add("active");
  botao.textContent = "Parar de atualizar";
  void atualizar();
});
on("webhook-clear", "click", () => {
  void (async () => {
    if (!binId) return;
    // A caixa não grava em banco (ver webhook-bin-store.ts): uma vez limpas,
    // as chamadas não voltam nem com um reinício. Confirmar aqui é a única
    // rede de segurança contra o clique ao lado de "Atualizar".
    if (chamadas.length && !confirm(`Apagar ${chamadas.length} chamada(s) capturada(s) nesta caixa? A ação não tem volta.`)) return;
    await fetch(`/api/v1/toolbox/webhooks/${binId}/clear`, { method: "POST" }).catch(() => {});
    await atualizar();
  })();
});
on("webhook-copy", "click", (botao) => {
  const ultima = chamadas[0];
  if (ultima) void copyText(botao, formatWebhookRequest(ultima));
});
// Sair da página com um intervalo rodando deixaria a aba consultando o servidor
// para sempre em segundo plano.
window.addEventListener("pagehide", pararAuto);
