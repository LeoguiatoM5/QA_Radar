import { HTTP_STATUSES, searchHttpStatuses } from "../../toolbox/http-status.js";
import { esc, focusOnSlash, need, selectTab, show } from "./ui.js";

const busca = need<HTMLInputElement>("status-search");
const lista = need("status-list");
const vazio = need("status-empty");
const contador = need("status-count");

let classe = "todas";

function render(): void {
  const encontrados = searchHttpStatuses(busca.value).filter((status) => classe === "todas" || status.group === classe);
  lista.innerHTML = encontrados
    .map(
      (status) =>
        `<article class="status-item status-${status.group}">` +
        `<header><b>${status.code}</b><strong>${esc(status.name)}</strong><span>${esc(status.group)}</span></header>` +
        `<p>${esc(status.summary)}</p>` +
        `<p class="status-testing"><b>O que checar:</b> ${esc(status.testing)}</p>` +
        `</article>`,
    )
    .join("");
  show(vazio, encontrados.length === 0);
  contador.textContent = `${encontrados.length} de ${HTTP_STATUSES.length} códigos.`;
}

busca.addEventListener("input", render);
for (const aba of document.querySelectorAll<HTMLElement>("[data-status-class]")) {
  aba.addEventListener("click", () => {
    classe = aba.dataset.statusClass ?? "todas";
    selectTab("data-status-class", aba);
    render();
  });
}
focusOnSlash(busca);
render();
