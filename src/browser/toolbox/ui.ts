/**
 * O que toda tela do QA Toolbox faz com o DOM.
 *
 * A divisão do Toolbox continua a mesma: o que decide (diff, limites, geração,
 * decodificação) vive em `src/toolbox/` e roda igual no Node dos testes; o que
 * está aqui e nos módulos vizinhos só lê campo, chama a função e desenha o
 * resultado. O que mudou é que este lado deixou de ser texto dentro de
 * `String.raw` e virou TypeScript de verdade, visto pelo `tsc` e pelo `eslint`.
 */
export { esc } from "../shared.js";

/**
 * Elemento que a página tem de ter.
 *
 * Falha alto de propósito: um id que não existe é erro de programação, e a
 * alternativa — seguir com `null` — é exatamente o defeito silencioso que
 * escrever o cliente em texto produzia. O `String.raw` deixava passar; aqui a
 * primeira execução avisa.
 */
export function need<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento ausente na página: #${id}`);
  return element as T;
}

/** Elemento que a página pode não ter. */
export function maybe<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Liga um ouvinte a um elemento opcional.
 *
 * O manipulador recebe o próprio elemento porque quase todo botão do Toolbox
 * precisa dele — é nele que o "Copiar" escreve o retorno visual.
 */
export function on<K extends keyof HTMLElementEventMap, T extends HTMLElement = HTMLElement>(id: string, type: K, handler: (element: T, event: HTMLElementEventMap[K]) => void): void {
  const element = maybe<T>(id);
  element?.addEventListener(type, (event) => handler(element, event as HTMLElementEventMap[K]));
}

/** Mensagem do erro, ou o texto de reserva quando não for um `Error`. */
export function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function showError(box: HTMLElement, text: string): void {
  box.textContent = text;
  box.style.display = "block";
}

export function clearError(box: HTMLElement): void {
  box.textContent = "";
  box.style.display = "none";
}

export function show(panel: HTMLElement | null, visible: boolean): void {
  if (panel) panel.hidden = !visible;
}

/**
 * Copia e diz que copiou.
 *
 * O retorno visual vive no próprio botão: um aviso flutuante exigiria
 * posicionamento e ainda sumiria fora do campo de visão em telas altas.
 */
export async function copyText(button: HTMLElement, text: string): Promise<void> {
  const original = button.dataset.label ?? button.textContent ?? "Copiar";
  button.dataset.label = original;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copiado";
  } catch {
    button.textContent = "Não foi possível copiar";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1800);
}

export function downloadFile(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Carimbo de data e hora para nome de arquivo baixado. */
export function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/**
 * Marca a aba escolhida num grupo de abas.
 *
 * Cinco ferramentas repetiam este laço palavra por palavra: percorrer os irmãos
 * pelo mesmo atributo, alternar a classe e acertar o `aria-selected`.
 */
export function selectTab(attribute: string, chosen: Element): void {
  for (const tab of document.querySelectorAll(`[${attribute}]`)) {
    const active = tab === chosen;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
}

/**
 * Manda a tecla "/" para um campo de busca.
 *
 * Atalho já esperado por quem usa ferramenta de desenvolvimento; só não vale
 * enquanto se digita em outro campo.
 */
export function focusOnSlash(field: HTMLElement | null): void {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    event.preventDefault();
    field?.focus();
  });
}

/** Ctrl/Cmd + Enter executa sem tirar a mão do teclado, como no cliente de API. */
export function runOnCtrlEnter(fields: ReadonlyArray<HTMLElement | null>, run: () => void): void {
  for (const field of fields) {
    field?.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        run();
      }
    });
  }
}
