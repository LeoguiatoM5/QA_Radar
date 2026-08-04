/**
 * Envio de e-mail transacional.
 *
 * Atrás de uma interface pelo mesmo motivo do `OAuthProvider`: o fluxo de
 * confirmação e de recuperação de senha precisa ser testável inteiro sem
 * depender de um provedor no ar, e a CLI não pode passar a exigir chave de
 * e-mail para rodar.
 *
 * Ausente = confirmação e recuperação ficam indisponíveis e a interface não as
 * oferece; o cadastro por senha continua funcionando. É a mesma degradação
 * consciente do banco e do armazenamento.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  readonly name: string;
  /** `false` quando o envio não acontece de verdade (implementação inerte). */
  readonly delivers: boolean;
  send(message: EmailMessage): Promise<void>;
}

export interface EmailConfig {
  apiKey: string;
  from: string;
  fromName: string;
}

/**
 * Padrão quando não há provedor: registra e segue.
 *
 * Registrar em vez de lançar porque o chamador já trata falha de envio como não
 * fatal — o que não pode acontecer é o cadastro ser recusado por causa do
 * e-mail. Em desenvolvimento o link sai no terminal, que é o suficiente para
 * exercitar o fluxo sem provedor.
 */
export const NO_EMAIL_SENDER: EmailSender = {
  name: "none",
  delivers: false,
  async send(message) {
    process.stderr.write(`${JSON.stringify({ event: "email.skipped", to: message.to, subject: message.subject, text: message.text })}\n`);
  },
};

/**
 * Brevo, e não Resend, por uma restrição concreta: o Resend só entrega para
 * endereço de terceiros depois de verificar um **domínio**, e o produto está em
 * `qa-radar.onrender.com`, que não é nosso para verificar. O Brevo aceita
 * verificar um **remetente avulso**, então funciona sem domínio próprio.
 */
export function createBrevoEmailSender(config: EmailConfig, fetchImpl: typeof fetch = fetch): EmailSender {
  return {
    name: "brevo",
    delivers: true,

    async send(message) {
      const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: config.fromName, email: config.from },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
      });
      if (!response.ok) {
        // A resposta do provedor pode trazer o endereço de destino; só o código
        // e o motivo curto sobem, para o erro não virar log de e-mail alheio.
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        throw new Error(`O provedor de e-mail recusou o envio (${response.status}): ${detail}`);
      }
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] as string);
}

function layout(title: string, body: string, actionLabel: string, actionUrl: string): string {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#0f172a;padding:32px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">QA Radar</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${escapeHtml(title)}</h1>
${body}
<p style="margin:24px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(actionLabel)}</a></p>
<p style="margin:0;font-size:13px;color:#64748b">Se o botão não funcionar, copie este endereço no navegador:<br><span style="word-break:break-all;color:#334155">${escapeHtml(actionUrl)}</span></p>
</td></tr></table></body></html>`;
}

export function verificationEmail(to: string, url: string, ttlHours: number): EmailMessage {
  return {
    to,
    subject: "Confirme seu e-mail no QA Radar",
    html: layout(
      "Confirme seu e-mail",
      `<p style="margin:0;font-size:15px;line-height:1.6;color:#334155">Falta confirmar este endereço para liberar a recuperação de senha da sua conta. O link vale por ${ttlHours} horas.</p>`,
      "Confirmar e-mail",
      url,
    ),
    text: `Confirme seu e-mail no QA Radar abrindo este endereço (vale por ${ttlHours} horas):\n\n${url}\n\nSe não foi você que criou a conta, ignore esta mensagem.`,
  };
}

export function passwordResetEmail(to: string, url: string, ttlMinutes: number): EmailMessage {
  return {
    to,
    subject: "Redefinir sua senha do QA Radar",
    html: layout(
      "Redefinir sua senha",
      `<p style="margin:0;font-size:15px;line-height:1.6;color:#334155">Recebemos um pedido para redefinir a senha desta conta. O link vale por ${ttlMinutes} minutos e só pode ser usado uma vez.</p>`,
      "Escolher nova senha",
      url,
    ),
    text: `Para redefinir sua senha do QA Radar, abra este endereço (vale por ${ttlMinutes} minutos e só serve uma vez):\n\n${url}\n\nSe não foi você que pediu, ignore esta mensagem: a senha atual continua valendo.`,
  };
}
