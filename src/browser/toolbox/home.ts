import { QA_TOOLS, searchTools } from "../../toolbox/catalog.js";
import { focusOnSlash, maybe, show } from "./ui.js";

const input = maybe<HTMLInputElement>("toolbox-search-input");
const count = maybe("toolbox-search-count");
const empty = maybe("toolbox-empty");
const favoritesSection = maybe("toolbox-favorites");
const favoritesGrid = maybe("toolbox-favorites-grid");
const sections = [...document.querySelectorAll<HTMLElement>("[data-tool-category-section]:not(.tool-category-favorites)")];

/**
 * As favoritas ficam só neste navegador: são preferência de uso, não dado de
 * conta, e mandá-las para o servidor criaria um histórico de quem usa o quê sem
 * nenhum ganho para quem usa.
 */
const FAVORITES_KEY = "qa-radar-toolbox-favorites";

function readFavorites(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeFavorites(ids: readonly string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // Armazenamento indisponível: a marcação vale só para esta visita.
  }
}

let favorites = readFavorites();

const slots = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-tool-slot]")];
const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-tool-card]")];

function paintFavorites(): void {
  if (!favoritesGrid) return;
  favoritesGrid.innerHTML = "";
  for (const id of favorites) {
    const origem = document.querySelector(`.tool-category:not(.tool-category-favorites) [data-tool-slot="${id}"]`);
    if (!origem) continue;
    const copia = origem.cloneNode(true) as HTMLElement;
    copia.dataset.toolClone = "true";
    favoritesGrid.appendChild(copia);
  }
  for (const botao of document.querySelectorAll<HTMLElement>("[data-tool-favorite]")) {
    const marcada = favorites.includes(botao.dataset.toolFavorite ?? "");
    botao.setAttribute("aria-pressed", String(marcada));
    botao.classList.toggle("active", marcada);
    botao.title = marcada ? "Remover dos favoritos" : "Favoritar";
  }
}

function toggleFavorite(id: string): void {
  favorites = favorites.includes(id) ? favorites.filter((other) => other !== id) : [...favorites, id];
  writeFavorites(favorites);
  paintFavorites();
  apply(input ? input.value : "");
}

document.addEventListener("click", (event) => {
  const alvo = event.target;
  const botao = alvo instanceof Element ? alvo.closest<HTMLElement>("[data-tool-favorite]") : null;
  const id = botao?.dataset.toolFavorite;
  if (!id) return;
  event.preventDefault();
  toggleFavorite(id);
});

function apply(query: string): void {
  const matches = new Set(searchTools(query, QA_TOOLS).map((tool) => tool.id));
  const todos = cards();
  let visible = 0;
  for (const slot of slots()) {
    slot.hidden = !matches.has(slot.dataset.toolSlot ?? "");
  }
  for (const card of todos) {
    const hit = matches.has(card.dataset.toolId ?? "");
    card.hidden = !hit;
    // Um card clonado na faixa de favoritas não conta duas vezes no total.
    if (hit && !card.closest(".tool-category-favorites")) visible += 1;
  }
  for (const section of sections) {
    section.hidden = ![...section.querySelectorAll<HTMLElement>("[data-tool-card]")].some((card) => !card.hidden);
  }
  if (favoritesSection) {
    favoritesSection.hidden = ![...favoritesSection.querySelectorAll<HTMLElement>("[data-tool-card]")].some((card) => !card.hidden);
  }
  show(empty, visible === 0);
  if (count) {
    const total = todos.filter((card) => !card.closest(".tool-category-favorites")).length;
    count.textContent = visible === 0 ? "Nenhuma ferramenta encontrada." : `${visible} de ${total} ferramentas.`;
  }
}

input?.addEventListener("input", () => apply(input.value));
focusOnSlash(input);
paintFavorites();
apply("");
