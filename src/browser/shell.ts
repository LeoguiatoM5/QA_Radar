/**
 * Comportamento compartilhado por todas as páginas do produto.
 *
 * Relógio da barra de contexto, seletor de ambiente, menu no celular e o
 * controle de conta. Ele vive aqui, e não junto do cliente das ferramentas,
 * porque a Visão geral e a Ajuda não carregam aquele — com a lógica lá, o
 * controle de conta nascia oculto e nunca aparecia justamente na primeira
 * página que se abre.
 */
const appSidebar = document.querySelector<HTMLElement>(".app-sidebar");
const mobileNavToggle = document.querySelector<HTMLButtonElement>(".mobile-nav-toggle");
const contextClock = document.querySelector<HTMLTimeElement>("#context-clock");

function updateContextClock(): void {
  if (!contextClock) return;
  const now = new Date();
  contextClock.dateTime = now.toISOString();
  contextClock.textContent = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(now).replace(",", "");
}

updateContextClock();
if (contextClock) setInterval(updateContextClock, 30_000);

// O ambiente escolhido na barra de contexto vale para todas as páginas: fica no
// navegador e alimenta o campo "Ambiente" da Inspeção.
const environmentKey = "qa-radar-environment";
const environmentSelect = document.querySelector<HTMLSelectElement>("#context-environment");
const environmentLabel = document.querySelector<HTMLElement>("#context-environment-label");

function applyEnvironment(slug: string, persist: boolean): void {
  if (!environmentSelect) return;
  const option = [...environmentSelect.options].find((item) => item.value === slug) ?? environmentSelect.options[0];
  if (!option) return;
  environmentSelect.value = option.value;
  if (environmentLabel) environmentLabel.textContent = option.textContent;
  environmentSelect.closest(".context-item")?.setAttribute("data-environment", option.value);
  if (persist) {
    try {
      localStorage.setItem(environmentKey, option.value);
    } catch {
      // Armazenamento indisponível: a escolha vale só nesta aba.
    }
  }
  const scanEnvironment = document.querySelector<HTMLInputElement>("#environment");
  if (scanEnvironment && !scanEnvironment.disabled) scanEnvironment.value = option.value;
}

if (environmentSelect) {
  let storedEnvironment = "";
  try {
    storedEnvironment = localStorage.getItem(environmentKey) ?? "";
  } catch {
    // Sem armazenamento, começa pelo primeiro ambiente da lista.
  }
  applyEnvironment(storedEnvironment || environmentSelect.value, false);
  environmentSelect.addEventListener("change", () => applyEnvironment(environmentSelect.value, true));
}

function setMobileNavigation(open: boolean): void {
  if (!appSidebar || !mobileNavToggle) return;
  appSidebar.classList.toggle("nav-open", open);
  mobileNavToggle.setAttribute("aria-expanded", String(open));
  mobileNavToggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
}

mobileNavToggle?.addEventListener("click", () => setMobileNavigation(!appSidebar?.classList.contains("nav-open")));
for (const link of appSidebar?.querySelectorAll<HTMLAnchorElement>(".nav-link") ?? []) link.addEventListener("click", () => setMobileNavigation(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMobileNavigation(false);
});
window.matchMedia("(min-width: 861px)").addEventListener("change", (event) => {
  if (event.matches) setMobileNavigation(false);
});

interface CurrentSession {
  authenticated?: boolean;
  loginAvailable?: boolean;
  user?: { name?: string; login?: string; avatarUrl?: string; email?: string; emailVerified?: boolean };
}

const accountControl = document.querySelector<HTMLElement>("#account-control");
const verifyBanner = document.querySelector<HTMLElement>("#verify-banner");

async function refreshAccount(): Promise<void> {
  if (!accountControl) return;
  try {
    const me = (await (await fetch("/api/v1/auth/me")).json()) as CurrentSession;
    // Servidor sem provedor não anuncia recurso que não tem.
    if (!me.loginAvailable) {
      accountControl.hidden = true;
      return;
    }
    accountControl.hidden = false;
    const signin = document.querySelector<HTMLElement>("#account-signin");
    const user = document.querySelector<HTMLElement>("#account-user");
    if (me.authenticated && me.user) {
      if (signin) signin.hidden = true;
      if (user) user.hidden = false;
      const avatar = document.querySelector<HTMLImageElement>("#account-avatar");
      const login = document.querySelector<HTMLElement>("#account-login");
      if (login) login.textContent = me.user.name || (me.user.login ?? "");
      if (avatar) {
        if (me.user.avatarUrl) {
          avatar.src = me.user.avatarUrl;
          avatar.hidden = false;
        } else {
          avatar.hidden = true;
        }
      }
      // Quem entrou não precisa mais do aviso de login na Jornada.
      const signinNotice = document.querySelector<HTMLElement>("#journey-signin");
      if (signinNotice) signinNotice.hidden = true;
      // Só avisa quem tem e-mail e ainda não confirmou; conta vinda só do
      // provedor externo pode não ter endereço nenhum para confirmar.
      if (verifyBanner) verifyBanner.hidden = !(me.user.email && !me.user.emailVerified);
    } else {
      if (signin) signin.hidden = false;
      if (user) user.hidden = true;
      if (verifyBanner) verifyBanner.hidden = true;
    }
  } catch {
    accountControl.hidden = true;
  }
}

document.querySelector<HTMLButtonElement>("#account-signout")?.addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  void (async () => {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
      location.reload();
    } catch {
      button.disabled = false;
    }
  })();
});

document.querySelector<HTMLButtonElement>("#verify-resend")?.addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const state = document.querySelector<HTMLElement>("#verify-state");
  button.disabled = true;
  const say = (text: string): void => {
    if (!state) return;
    state.textContent = text;
    state.hidden = false;
  };
  void (async () => {
    try {
      const response = await fetch("/api/v1/auth/verify/request", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; verified?: boolean; sent?: boolean };
      if (!response.ok) {
        say(body.error ?? "Não foi possível reenviar agora.");
        button.disabled = false;
        return;
      }
      if (body.verified) {
        if (verifyBanner) verifyBanner.hidden = true;
        return;
      }
      say(body.sent ? "Enviado. Confira sua caixa de entrada." : "Este servidor não envia e-mail.");
    } catch {
      say("Não foi possível reenviar agora.");
      button.disabled = false;
    }
  })();
});

void refreshAccount();

// O navegador carrega este arquivo como módulo ES, com escopo próprio. O
// `export {}` diz o mesmo ao compilador: sem ele os nomes do topo entrariam no
// escopo global e colidiriam com os de outro módulo.
export {};
