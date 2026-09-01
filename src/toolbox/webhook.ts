/**
 * Regras da caixa de webhook.
 *
 * Uma caixa é uma URL pública e descartável que guarda o que chega nela, para o
 * QA ver o que o sistema de terceiro realmente mandou — corpo, cabeçalhos,
 * método — em vez de deduzir pelo log.
 *
 * Só a política mora aqui; o armazenamento e a rota estão no servidor. O ponto
 * central é que **isto é uma superfície pública**: qualquer um que descubra a
 * URL escreve nela. Por isso os limites são parte da regra de negócio, não
 * detalhe de implementação — e o cabeçalho sensível é redigido antes de virar
 * registro, não na hora de mostrar.
 */

export interface WebhookRequestRecord {
  id: string;
  receivedAt: number;
  method: string;
  /** Caminho depois do id da caixa, quando houver. */
  path: string;
  query: Array<{ name: string; value: string }>;
  headers: Array<{ name: string; value: string; redacted: boolean }>;
  body: string;
  bodyTruncated: boolean;
  contentType: string | undefined;
  /** Origem da chamada, já reduzida — ver `maskAddress`. */
  origin: string;
}

export interface WebhookBin {
  id: string;
  createdAt: number;
  expiresAt: number;
  requests: WebhookRequestRecord[];
  /** Quantas chegaram desde a criação, inclusive as já descartadas. */
  received: number;
}

export const MAX_BINS = 200;
export const MAX_REQUESTS_PER_BIN = 50;
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
export const WEBHOOK_TTL_MS = 60 * 60 * 1000;

/**
 * Cabeçalhos que carregam credencial.
 *
 * Numa caixa pública isso é mais sério do que na tela de uma ferramenta local:
 * o valor seria gravado no servidor e devolvido a quem abrisse a caixa. Ele é
 * substituído no momento em que a requisição é registrada.
 */
const SENSITIVE_HEADERS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token)$/i;

export function isSensitiveWebhookHeader(name: string): boolean {
  return SENSITIVE_HEADERS.test(name.trim());
}

/**
 * Cabeçalhos em que o proxy escreve o endereço de quem chamou.
 *
 * Reduzir só o campo `origin` não bastava: o Cloudflare e o Render injetam o IP
 * real aqui, e numa caixa pública qualquer pessoa com a URL leria o endereço
 * completo de quem disparou o webhook — exatamente o que `maskAddress` existe
 * para impedir.
 */
const ADDRESS_HEADERS = /^(x-forwarded-for|x-real-ip|x-client-ip|cf-connecting-ip|cf-connecting-ipv6|true-client-ip|fastly-client-ip|forwarded)$/i;

export function isAddressWebhookHeader(name: string): boolean {
  return ADDRESS_HEADERS.test(name.trim());
}

/** Aplica `maskAddress` a cada endereço de uma cadeia como a do `x-forwarded-for`. */
export function maskAddressHeader(value: string): string {
  return value
    .split(",")
    .map((entry) => maskAddress(entry.trim()))
    .join(", ");
}

/**
 * Guarda o IP só até o prefixo da rede.
 *
 * Serve para distinguir uma origem da outra durante um teste, que é o que o QA
 * precisa, sem transformar a caixa num registro de endereço completo de quem
 * chamou.
 */
export function maskAddress(address: string): string {
  const clean = address.replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) {
    const parts = clean.split(".");
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  if (clean.includes(":")) return `${clean.split(":").slice(0, 2).join(":")}::`;
  return "desconhecida";
}

export interface IncomingWebhook {
  method: string;
  path: string;
  query: Array<[string, string]>;
  headers: Array<[string, string]>;
  body: string;
  bodyTruncated: boolean;
  address: string;
}

export function recordFrom(incoming: IncomingWebhook, id: string, receivedAt: number): WebhookRequestRecord {
  const headers = incoming.headers.map(([name, value]) => {
    if (isSensitiveWebhookHeader(name)) return { name, value: "[redigido pelo QA Radar]", redacted: true };
    // Endereço não é segredo, mas também não pode ficar inteiro: vira o mesmo
    // prefixo de rede do campo `origin`, e é marcado como alterado.
    if (isAddressWebhookHeader(name)) return { name, value: maskAddressHeader(value), redacted: true };
    return { name, value, redacted: false };
  });
  return {
    id,
    receivedAt,
    method: incoming.method.toUpperCase(),
    path: incoming.path,
    query: incoming.query.map(([name, value]) => ({ name, value })),
    headers,
    body: incoming.body,
    bodyTruncated: incoming.bodyTruncated,
    contentType: incoming.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1],
    origin: maskAddress(incoming.address),
  };
}

/**
 * Quanto do corpo é desenhado na tela.
 *
 * O teto de gravação é 64 KB, mas 64 mil caracteres numa linha só travam o
 * renderizador — foi o que aconteceu na primeira caixa real, com a aba
 * congelando por dezenas de segundos. Quem precisa do corpo inteiro usa o
 * "Copiar", que leva o que foi guardado.
 */
export const MAX_WEBHOOK_BODY_PREVIEW = 8000;

export interface WebhookBodyPreview {
  text: string;
  /** A exibição foi cortada; o conteúdo guardado é maior. */
  clipped: boolean;
  storedLength: number;
}

export function bodyPreview(body: string): WebhookBodyPreview {
  const pretty = prettyBody(body);
  if (pretty.length <= MAX_WEBHOOK_BODY_PREVIEW) return { text: pretty, clipped: false, storedLength: body.length };
  return { text: pretty.slice(0, MAX_WEBHOOK_BODY_PREVIEW), clipped: true, storedLength: body.length };
}

/** Formata o corpo quando ele é JSON; devolve o original quando não é. */
export function prettyBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return body;
  try {
    return JSON.stringify(JSON.parse(trimmed) as unknown, null, 2);
  } catch {
    return body;
  }
}

/** Resumo de uma requisição, para colar num chamado. */
export function formatWebhookRequest(record: WebhookRequestRecord): string {
  const linhas = [
    `${record.method} ${record.path || "/"}`,
    `Recebida em ${new Date(record.receivedAt).toISOString()} de ${record.origin}`,
    "",
    ...record.headers.map((header) => `${header.name}: ${header.value}`),
  ];
  if (record.query.length > 0) {
    linhas.push("", "Query:", ...record.query.map((param) => `  ${param.name}=${param.value}`));
  }
  if (record.body !== "") {
    linhas.push("", prettyBody(record.body));
    if (record.bodyTruncated) linhas.push(`[corpo truncado em ${MAX_WEBHOOK_BODY_BYTES} bytes]`);
  }
  return linhas.join("\n");
}
