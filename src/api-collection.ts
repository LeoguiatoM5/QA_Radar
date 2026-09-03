import { isSecretHeader } from "./toolbox/curl.js";

/**
 * O que uma collection de Testes de API pode levar para o servidor.
 *
 * Até aqui a página guardava tudo em `localStorage` e prometia por escrito que
 * nada saía do navegador. Vinculá-la a uma aplicação exige quebrar metade dessa
 * promessa — e a decisão de onde exatamente quebrar é a parte que importa num
 * produto comercial, porque o que subir aqui passa a ser responsabilidade de
 * quem hospeda.
 *
 * A linha é: **sobe a requisição, não a credencial.**
 *
 * Sobe porque a equipe precisa compartilhar: nome, método, URL, query params,
 * headers (nome **e** valor, quando o valor não é credencial), body e o
 * *formato* da autenticação — o tipo, o nome do campo de API key e onde ele vai.
 *
 * Não sobe, nunca: bearer token, senha, valor de API key, valor de header
 * sensível e valor de query param com cara de segredo. Não são mascarados nem
 * cifrados — simplesmente não entram na estrutura que o repositório grava, e o
 * tipo não tem campo onde eles caibam. Guardar credencial de terceiro em banco
 * é assumir a guarda dela: exige cifra em repouso, rotação de chave e responder
 * por um vazamento que não é do nosso sistema. O caminho oferecido no lugar são
 * as **variáveis**, que continuam só no navegador: o body referencia
 * `{{token}}` e o valor nunca sai da máquina de quem usa.
 */

/** Nome de query param cujo valor é credencial, pela convenção mais comum. */
const SECRET_PARAMS = /^(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd|signature|sig|auth|session)$/i;

/** Um query param cujo valor não pode ser gravado. */
export function isSecretParam(name: string): boolean {
  return SECRET_PARAMS.test(name.trim());
}

export { isSecretHeader };

export interface ApiPair {
  key: string;
  value: string;
}

/**
 * Só o formato da autenticação.
 *
 * Repare no que **não** existe aqui: `bearerToken`, `password`, `apiKeyValue`.
 * A ausência é o mecanismo — não há como um descuido no chamador gravar o
 * segredo se o tipo não tem onde colocá-lo.
 */
export interface ApiAuthShape {
  type: string;
  username: string;
  apiKeyName: string;
  apiKeyLocation: string;
}

export interface ApiRequestDefinition {
  name: string;
  method: string;
  url: string;
  params: ApiPair[];
  headers: ApiPair[];
  body: string;
  auth: ApiAuthShape;
}

export const API_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

export const MAX_COLLECTION_NAME = 60;
export const MAX_REQUEST_NAME = 80;
export const MAX_REQUEST_URL = 2048;
export const MAX_REQUEST_BODY = 64 * 1024;
export const MAX_PAIRS_PER_REQUEST = 50;
export const MAX_REQUESTS_PER_COLLECTION = 100;
export const MAX_COLLECTIONS_PER_APPLICATION = 20;
/**
 * Teto do histórico de execuções por aplicação.
 *
 * Corte por quantidade e não por tempo: uma equipe que testa pouco não perde o
 * histórico por ele ter envelhecido, e uma que testa muito não faz a tabela
 * crescer sem limite. A poda acontece na escrita.
 */
export const MAX_API_RUNS_PER_APPLICATION = 200;

/** Marca deixada no lugar do valor removido, para a tela poder explicar a falta. */
export const REDACTED = "";

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function pairs(value: unknown, redact: (name: string) => boolean): ApiPair[] {
  if (!Array.isArray(value)) return [];
  const result: ApiPair[] = [];
  for (const item of value.slice(0, MAX_PAIRS_PER_REQUEST)) {
    const pair = item as Partial<ApiPair> | null;
    const key = text(pair?.key, 200).trim();
    if (!key) continue;
    result.push({ key, value: redact(key) ? REDACTED : text(pair?.value, 2048) });
  }
  return result;
}

/**
 * Tira da URL o valor de todo query param que parece credencial.
 *
 * Sem isto a regra dos params seria contornada só de colar a chave direto na
 * barra de endereço, que é exatamente como a maioria das APIs documenta o uso
 * de API key. A URL relativa ou com `{{variavel}}` não é URL válida para o
 * parser, e nesse caso volta intacta — não há query param a limpar numa coisa
 * que o navegador ainda vai montar.
 */
export function redactUrl(raw: string): string {
  const url = raw.trim().slice(0, MAX_REQUEST_URL);
  const marker = url.indexOf("?");
  if (marker < 0) return url;
  const base = url.slice(0, marker);
  const query = new URLSearchParams(url.slice(marker + 1));
  let changed = false;
  for (const name of [...query.keys()]) {
    if (!isSecretParam(name)) continue;
    query.set(name, REDACTED);
    changed = true;
  }
  if (!changed) return url;
  const rebuilt = query.toString();
  return rebuilt ? `${base}?${rebuilt}` : base;
}

/**
 * A versão gravável de uma requisição, com toda credencial fora.
 *
 * Roda no **servidor**, sobre o que o cliente mandou, e não no cliente antes de
 * mandar: uma limpeza feita só no navegador é uma limpeza que a próxima versão
 * do cliente — ou um `curl` direto na API — não faz.
 */
export function shareableRequest(input: unknown): ApiRequestDefinition | undefined {
  const value = input as Partial<ApiRequestDefinition> | null;
  if (!value || typeof value !== "object") return undefined;
  const name = text(value.name, MAX_REQUEST_NAME).trim();
  if (!name) return undefined;
  const method = text(value.method, 10).toUpperCase();
  const auth = (value.auth ?? {}) as Partial<ApiAuthShape>;
  return {
    name,
    method: (API_METHODS as readonly string[]).includes(method) ? method : "GET",
    url: redactUrl(text(value.url, MAX_REQUEST_URL)),
    params: pairs(value.params, isSecretParam),
    headers: pairs(value.headers, isSecretHeader),
    body: text(value.body, MAX_REQUEST_BODY),
    auth: {
      type: text(auth.type, 20),
      username: text(auth.username, 200),
      apiKeyName: text(auth.apiKeyName, 200),
      apiKeyLocation: text(auth.apiKeyLocation, 20),
    },
  };
}

/** Todas as requisições graváveis de um corpo, descartando as inválidas. */
export function shareableRequests(input: unknown): ApiRequestDefinition[] {
  if (!Array.isArray(input)) return [];
  const result: ApiRequestDefinition[] = [];
  for (const item of input.slice(0, MAX_REQUESTS_PER_COLLECTION)) {
    const request = shareableRequest(item);
    if (request) result.push(request);
  }
  return result;
}
