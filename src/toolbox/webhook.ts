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
    const redacted = isSensitiveWebhookHeader(name);
    return { name, value: redacted ? "[redigido pelo QA Radar]" : value, redacted };
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
