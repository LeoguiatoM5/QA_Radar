/**
 * Cliente da página de entrada e cadastro.
 *
 * Os quatro formulários compartilham a mesma caixa de erro e o mesmo bloqueio
 * de botão porque são o mesmo fluxo visto de ângulos diferentes: entrar,
 * cadastrar, pedir link de redefinição e escolher a senha nova.
 */
const tabSignin = document.querySelector<HTMLButtonElement>("#auth-tab-signin");
const tabSignup = document.querySelector<HTMLButtonElement>("#auth-tab-signup");
const formSignin = document.querySelector<HTMLFormElement>("#auth-signin-form");
const formSignup = document.querySelector<HTMLFormElement>("#auth-signup-form");
const formForgot = document.querySelector<HTMLFormElement>("#auth-forgot-form");
const formReset = document.querySelector<HTMLFormElement>("#auth-reset-form");
const authError = document.querySelector<HTMLElement>("#auth-error");
const authNotice = document.querySelector<HTMLElement>("#auth-notice");
const authTabs = document.querySelector<HTMLElement>("#auth-tabs");
const githubBlock = document.querySelector<HTMLElement>("#auth-github-block");
const forgotOpen = document.querySelector<HTMLButtonElement>("#auth-forgot-open");
const params = new URLSearchParams(location.search);
const resetToken = params.get("redefinir") ?? "";

/** Painéis do cartão. `indisponivel` não é um painel: esconde todos de uma vez. */
type Panel = "signin" | "signup" | "forgot" | "reset" | "indisponivel";

function valueOf(selector: string): string {
  return document.querySelector<HTMLInputElement>(selector)?.value ?? "";
}

function clearMessages(): void {
  if (authError) {
    authError.hidden = true;
    authError.textContent = "";
  }
  if (authNotice) {
    authNotice.hidden = true;
    authNotice.textContent = "";
  }
}

function fail(message: string): void {
  if (!authError) return;
  authError.textContent = message;
  authError.hidden = false;
}

function tell(message: string): void {
  if (!authNotice) return;
  authNotice.textContent = message;
  authNotice.hidden = false;
}

function show(which: Panel): void {
  clearMessages();
  const panels: Record<string, HTMLFormElement | null> = { signin: formSignin, signup: formSignup, forgot: formForgot, reset: formReset };
  for (const [name, form] of Object.entries(panels)) if (form) form.hidden = name !== which;
  // As abas só fazem sentido entre entrar e cadastrar; recuperação e
  // redefinição são desvios do fluxo, não um terceiro caminho de entrada.
  const paired = which === "signin" || which === "signup";
  if (authTabs) authTabs.hidden = !paired;
  if (githubBlock) githubBlock.hidden = !paired || githubBlock.dataset.available !== "true";
  if (tabSignin) {
    tabSignin.classList.toggle("active", which === "signin");
    tabSignin.setAttribute("aria-selected", String(which === "signin"));
  }
  if (tabSignup) {
    tabSignup.classList.toggle("active", which === "signup");
    tabSignup.setAttribute("aria-selected", String(which === "signup"));
  }
  panels[which]?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus();
}

tabSignin?.addEventListener("click", () => show("signin"));
tabSignup?.addEventListener("click", () => show("signup"));
forgotOpen?.addEventListener("click", () => show("forgot"));
document.querySelector<HTMLButtonElement>("#auth-forgot-cancel")?.addEventListener("click", () => show("signin"));

async function submit(selector: string, label: string, run: () => Promise<void>): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) return;
  clearMessages();
  button.disabled = true;
  const original = button.textContent;
  button.textContent = label;
  try {
    await run();
  } catch (error) {
    fail(error instanceof Error && error.message ? error.message : "Não foi possível concluir agora.");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function send(path: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir agora.");
}

formSignin?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit("#signin-submit", "Entrando...", async () => {
    await send("/api/v1/auth/login", { email: valueOf("#signin-email"), password: valueOf("#signin-password") });
    location.href = "/";
  });
});

formSignup?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit("#signup-submit", "Criando...", async () => {
    await send("/api/v1/auth/register", { email: valueOf("#signup-email"), password: valueOf("#signup-password"), name: valueOf("#signup-name") || undefined });
    location.href = "/";
  });
});

formForgot?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit("#forgot-submit", "Enviando...", async () => {
    await send("/api/v1/auth/password/forgot", { email: valueOf("#forgot-email") });
    // Mensagem igual exista ou não a conta: o contrário publicaria quem tem
    // cadastro para qualquer um que digitasse um endereço.
    show("signin");
    tell("Se existir uma conta com esse e-mail, o link de redefinição já está a caminho.");
  });
});

formReset?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit("#reset-submit", "Salvando...", async () => {
    await send("/api/v1/auth/password/reset", { token: resetToken, password: valueOf("#reset-password") });
    location.href = "/";
  });
});

interface CurrentSession {
  authenticated?: boolean;
  loginAvailable?: boolean;
  githubAvailable?: boolean;
  passwordResetAvailable?: boolean;
}

async function start(): Promise<void> {
  try {
    const me = (await (await fetch("/api/v1/auth/me")).json()) as CurrentSession;
    // Quem já está dentro não tem o que fazer aqui.
    if (me.authenticated) {
      location.replace("/");
      return;
    }
    if (!me.loginAvailable) {
      // Deixar o formulário de pé aqui só levava a um 403 depois de digitar a
      // senha. Some tudo e sobra a saída que de fato existe: usar sem conta.
      show("indisponivel");
      const fallback = document.querySelector<HTMLElement>("#auth-unavailable");
      if (fallback) fallback.hidden = false;
      return;
    }
    if (githubBlock) githubBlock.dataset.available = me.githubAvailable ? "true" : "false";
    // Sem provedor de e-mail não há caminho de volta, então o link não aparece.
    if (forgotOpen) forgotOpen.hidden = !me.passwordResetAvailable;
  } catch {
    // Sem resposta do servidor a página cai no formulário de entrada padrão.
  }
  if (resetToken) {
    show("reset");
    return;
  }
  show(params.get("cadastro") === "1" ? "signup" : "signin");
  if (params.get("erro") === "confirmacao") fail("Esse link de confirmação expirou ou já foi usado. Entre e peça outro.");
  if (params.get("proximo")) tell("Entre ou crie uma conta para continuar.");
}

void start();

// O navegador carrega este arquivo como módulo ES, com escopo próprio. O
// `export {}` diz o mesmo ao compilador: sem ele os nomes do topo entrariam no
// escopo global e colidiriam com os de outro módulo.
export {};
