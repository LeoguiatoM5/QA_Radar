/**
 * O que as ferramentas do produto compartilham no navegador.
 *
 * Inspeção, Jornada e Testes de API são três páginas independentes, mas as três
 * registram execução no dashboard, escapam texto para HTML e precisam mandar
 * quem não tem sessão para a entrada. Antes isso vinha de graça porque as três
 * carregavam o mesmo script embutido; como módulos, o que é comum vira import.
 */

/** Execução registrada na Visão geral. */
export interface Activity {
  id: string;
  type: "scan" | "journey" | "api";
  title: string;
  detail?: string;
  status: "success" | "error";
  errors?: number;
  warnings?: number;
  durationMs?: number;
  createdAt?: number;
  href?: string;
  scores?: Partial<Record<"http" | "performance" | "accessibility" | "dom" | "javascript", number | undefined>>;
}

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };

/** Escapa texto que vai para dentro de HTML montado por concatenação. */
export const esc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (char) => escapes[char] ?? char);

/**
 * Numa instalação que exige conta, o 401 de uma execução não é erro para ler na
 * tela: é o momento de pedir para entrar. Leva a pessoa ao cadastro guardando de
 * onde ela veio, para voltar ao mesmo lugar depois.
 */
export function signInAndReturn(): void {
  location.href = `/entrar?proximo=${encodeURIComponent(location.pathname + location.search)}`;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ACTIVITY_KEY = "qa-radar-activity";
const ACTIVITY_LIMIT = 40;

/**
 * Registra a execução nas duas cópias que a Visão geral lê.
 *
 * O `localStorage` é o que a lista mostra de imediato; o servidor guarda a mesma
 * coisa por navegador e é quem sobrevive a outra aba. A escrita no servidor é
 * best-effort: perder o registro não pode derrubar a execução que acabou de dar
 * certo.
 */
export function recordActivity(activity: Activity): void {
  try {
    const current: unknown = JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? "[]");
    const items = Array.isArray(current) ? (current as Activity[]) : [];
    items.unshift({ ...activity, createdAt: activity.createdAt ?? Date.now() });
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(items.slice(0, ACTIVITY_LIMIT)));
  } catch {
    // Armazenamento indisponível: a cópia do servidor ainda registra.
  }
  void fetch("/api/dashboard/activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(activity) }).catch(() => {});
}

/** Host e caminho, para o título da execução não virar uma URL inteira. */
export function activityTarget(value: unknown): string {
  try {
    const url = new URL(String(value));
    return url.host + url.pathname;
  } catch {
    return String(value ?? "Execução");
  }
}
