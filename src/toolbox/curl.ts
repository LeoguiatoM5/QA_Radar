/**
 * Conversão de cURL em código de teste.
 *
 * O caminho real de um QA é: abrir o DevTools, "Copy as cURL", e a partir dali
 * escrever o teste. Este módulo faz o meio: interpreta o comando e o reescreve
 * no cliente HTTP de cada stack.
 *
 * Segredo não vira código. Todo header de autenticação sai do comando e entra
 * como variável lida do ambiente: o código gerado é feito para ser commitado, e
 * um token colado dentro dele já vazou.
 */

export interface ParsedCurlRequest {
  method: string;
  /** URL sem a query string; os parâmetros vêm separados em `query`. */
  url: string;
  headers: Array<{ name: string; value: string }>;
  query: Array<{ name: string; value: string }>;
  body: string | undefined;
  /** `-u usuario:senha`, quando presente. */
  basicAuth: string | undefined;
}

export type CurlTarget = "playwright" | "cypress" | "fetch" | "axios" | "python" | "rest-assured";

export interface CurlTargetDefinition {
  id: CurlTarget;
  label: string;
  /** Linguagem do bloco, usada só como rótulo na interface. */
  language: string;
}

export const CURL_TARGETS: readonly CurlTargetDefinition[] = [
  { id: "playwright", label: "Playwright", language: "TypeScript" },
  { id: "cypress", label: "Cypress", language: "JavaScript" },
  { id: "fetch", label: "JavaScript Fetch", language: "JavaScript" },
  { id: "axios", label: "Axios", language: "JavaScript" },
  { id: "python", label: "Python Requests", language: "Python" },
  { id: "rest-assured", label: "Rest Assured", language: "Java" },
];

const SECRET_HEADERS = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-access-token|x-csrf-token)$/i;

/** Um header cujo valor é credencial e não deve aparecer inteiro em lugar nenhum. */
export function isSecretHeader(name: string): boolean {
  return SECRET_HEADERS.test(name.trim());
}

/**
 * Esconde o miolo do segredo mantendo o começo — o suficiente para a pessoa
 * reconhecer qual token colou, insuficiente para vazar ao compartilhar a tela.
 */
export function maskSecret(value: string): string {
  const bearer = /^(Bearer|Basic|Token)\s+(.*)$/i.exec(value.trim());
  if (bearer) {
    const scheme = bearer[1] ?? "";
    const credential = bearer[2] ?? "";
    return `${scheme} ${maskSecret(credential)}`;
  }
  const clean = value.trim();
  if (clean.length <= 8) return "•".repeat(clean.length);
  return `${clean.slice(0, 4)}${"•".repeat(Math.min(16, clean.length - 8))}${clean.slice(-4)}`;
}

/** Cópia do pedido com todo header sensível mascarado, para exibição. */
export function maskParsedCurl(request: ParsedCurlRequest): ParsedCurlRequest {
  return {
    ...request,
    headers: request.headers.map((header) => (isSecretHeader(header.name) ? { name: header.name, value: maskSecret(header.value) } : header)),
    basicAuth: request.basicAuth === undefined ? undefined : maskSecret(request.basicAuth),
  };
}

/**
 * Quebra o comando em argumentos como um shell faria.
 *
 * Trata aspas simples, aspas duplas, escape com barra invertida e a continuação
 * de linha `\` seguida de quebra — que é exatamente como o "Copy as cURL" do
 * navegador formata comandos longos.
 */
export function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string;

    if (quote === "'") {
      if (char === "'") quote = undefined;
      else current += char;
      continue;
    }

    if (quote === '"') {
      if (char === "\\") {
        const next = command[index + 1];
        if (next === undefined) continue;
        // Dentro de aspas duplas o shell só remove a barra antes destes.
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          current += next;
          index += 1;
          continue;
        }
        if (next === "\n") {
          index += 1;
          continue;
        }
        current += char;
        continue;
      }
      if (char === '"') quote = undefined;
      else current += char;
      continue;
    }

    if (char === "\\") {
      const next = command[index + 1];
      if (next === undefined) continue;
      // Continuação de linha: some, junto com a quebra e o "^" do Windows.
      if (next === "\n" || next === "\r") {
        index += 1;
        if (next === "\r" && command[index + 1] === "\n") index += 1;
        continue;
      }
      current += next;
      started = true;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (started || current) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }

    if (char === "^" && (command[index + 1] === "\n" || command[index + 1] === "\r")) continue;

    current += char;
    started = true;
  }

  if (started || current) tokens.push(current);
  return tokens;
}

const FLAGS_WITH_VALUE = new Set([
  "-X",
  "--request",
  "-H",
  "--header",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-ascii",
  "--data-urlencode",
  "-u",
  "--user",
  "--url",
  "-A",
  "--user-agent",
  "-b",
  "--cookie",
  "-e",
  "--referer",
  "-m",
  "--max-time",
  "--connect-timeout",
  "-o",
  "--output",
]);

const BODY_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode"]);

function looksLikeUrl(token: string): boolean {
  return /^https?:\/\//i.test(token) || /^[\w.-]+\.[a-z]{2,}(\/|$|:)/i.test(token);
}

export function parseCurl(command: string): ParsedCurlRequest {
  const tokens = tokenizeShellCommand(command.trim());
  if (tokens.length === 0) throw new Error("Cole um comando cURL.");
  if ((tokens[0] ?? "").toLowerCase() !== "curl") throw new Error("O comando precisa começar com `curl`.");

  const headers: Array<{ name: string; value: string }> = [];
  const bodyParts: string[] = [];
  let method: string | undefined;
  let rawUrl: string | undefined;
  let basicAuth: string | undefined;
  let forceGet = false;
  let jsonShortcut = false;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] as string;

    if (token === "-G" || token === "--get") {
      forceGet = true;
      continue;
    }
    if (token === "--json") {
      jsonShortcut = true;
      const value = tokens[index + 1];
      if (value !== undefined) {
        bodyParts.push(value);
        index += 1;
      }
      continue;
    }
    if (token === "-I" || token === "--head") {
      method = "HEAD";
      continue;
    }

    const equals = token.indexOf("=");
    const flag = token.startsWith("--") && equals > 0 ? token.slice(0, equals) : token;
    const inlineValue = token.startsWith("--") && equals > 0 ? token.slice(equals + 1) : undefined;

    if (FLAGS_WITH_VALUE.has(flag)) {
      const value = inlineValue ?? tokens[index + 1];
      if (inlineValue === undefined) index += 1;
      if (value === undefined) throw new Error(`A opção ${flag} exige um valor.`);
      if (flag === "-X" || flag === "--request") method = value.toUpperCase();
      else if (flag === "-H" || flag === "--header") {
        const separator = value.indexOf(":");
        if (separator > 0) headers.push({ name: value.slice(0, separator).trim(), value: value.slice(separator + 1).trim() });
      } else if (BODY_FLAGS.has(flag)) bodyParts.push(value);
      else if (flag === "-u" || flag === "--user") basicAuth = value;
      else if (flag === "--url") rawUrl = value;
      else if (flag === "-A" || flag === "--user-agent") headers.push({ name: "User-Agent", value });
      else if (flag === "-b" || flag === "--cookie") headers.push({ name: "Cookie", value });
      else if (flag === "-e" || flag === "--referer") headers.push({ name: "Referer", value });
      continue;
    }

    // Demais opções (-s, -L, -k, --compressed...) não mudam a requisição que
    // interessa ao teste: são descartadas em silêncio.
    if (token.startsWith("-")) continue;
    if (rawUrl === undefined && looksLikeUrl(token)) rawUrl = token;
  }

  if (rawUrl === undefined) throw new Error("Não encontrei a URL no comando.");
  const body = bodyParts.length > 0 ? bodyParts.join("&") : undefined;
  if (jsonShortcut && !headers.some((header) => header.name.toLowerCase() === "content-type")) {
    headers.push({ name: "Content-Type", value: "application/json" });
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new Error(`URL inválida: ${rawUrl}`);
  }

  const query = [...url.searchParams.entries()].map(([name, value]) => ({ name, value }));
  url.search = "";

  // `-G` não descarta os `-d`: o cURL os move para a query string. Descartá-los
  // faria o teste gerado bater num endpoint sem os parâmetros da busca — o
  // mesmo caminho, resultado diferente, e sem nada na tela dizendo por quê.
  if (forceGet && body !== undefined) {
    for (const [name, value] of new URLSearchParams(body).entries()) query.push({ name, value });
  }

  const resolvedMethod = method ?? (body !== undefined && !forceGet ? "POST" : "GET");

  return {
    method: resolvedMethod,
    url: url.toString(),
    headers,
    query,
    body: forceGet ? undefined : body,
    basicAuth,
  };
}

/** Nome da variável de ambiente sugerida para cada header sensível. */
function secretVariable(headerName: string): string {
  const normalized = headerName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return normalized === "AUTHORIZATION" ? "API_TOKEN" : normalized;
}

interface CodeHeader {
  name: string;
  /** Literal já pronto para o alvo, podendo ser a variável em vez do segredo. */
  value: string;
  secret: boolean;
  variable: string | undefined;
}

function codeHeaders(request: ParsedCurlRequest): CodeHeader[] {
  const headers: CodeHeader[] = request.headers.map((header) => {
    if (!isSecretHeader(header.name)) return { name: header.name, value: header.value, secret: false, variable: undefined };
    const variable = secretVariable(header.name);
    const scheme = /^(Bearer|Basic|Token)\s+/i.exec(header.value)?.[1];
    return { name: header.name, value: scheme ? `${scheme} ` : "", secret: true, variable };
  });
  // `-u usuario:senha` é o mesmo `Authorization: Basic`, e é credencial como
  // qualquer outra: vira variável, nunca literal no código.
  if (request.basicAuth !== undefined && !headers.some((header) => header.name.toLowerCase() === "authorization")) {
    headers.push({ name: "Authorization", value: "Basic ", secret: true, variable: "BASIC_AUTH_BASE64" });
  }
  return headers;
}

function secretVariables(headers: readonly CodeHeader[]): string[] {
  return [...new Set(headers.filter((header) => header.secret && header.variable).map((header) => header.variable as string))];
}

function quote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function backtick(value: string): string {
  return `\`${value.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")}\``;
}

function jsHeaderEntry(header: CodeHeader, indent: string): string {
  const key = /^[A-Za-z_$][\w$]*$/.test(header.name) ? header.name : quote(header.name);
  if (!header.secret) return `${indent}  ${key}: ${quote(header.value)},`;
  return `${indent}  ${key}: \`${header.value}\${${header.variable as string}}\`,`;
}

function jsHeadersBlock(headers: readonly CodeHeader[], indent: string): string {
  if (headers.length === 0) return "";
  return `${indent}headers: {\n${headers.map((header) => jsHeaderEntry(header, indent)).join("\n")}\n${indent}},\n`;
}

function jsQueryBlock(request: ParsedCurlRequest, indent: string, key = "params"): string {
  if (request.query.length === 0) return "";
  const entries = request.query.map((param) => `${indent}  ${quote(param.name)}: ${quote(param.value)},`).join("\n");
  return `${indent}${key}: {\n${entries}\n${indent}},\n`;
}

function jsSecretPreamble(headers: readonly CodeHeader[]): string {
  const variables = secretVariables(headers);
  if (variables.length === 0) return "";
  return `${variables.map((variable) => `const ${variable} = process.env.${variable} ?? '';`).join("\n")}\n\n`;
}

function jsonBodyLiteral(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  try {
    return JSON.stringify(JSON.parse(body) as unknown, null, 2)
      .split("\n")
      .map((line, index) => (index === 0 ? line : `  ${line}`))
      .join("\n");
  } catch {
    return undefined;
  }
}

function urlWithQuery(request: ParsedCurlRequest): string {
  if (request.query.length === 0) return request.url;
  const search = request.query.map((param) => `${encodeURIComponent(param.name)}=${encodeURIComponent(param.value)}`).join("&");
  return `${request.url}?${search}`;
}

function playwrightCode(request: ParsedCurlRequest): string {
  const headers = codeHeaders(request);
  const method = request.method.toLowerCase();
  const supported = ["get", "post", "put", "patch", "delete", "head"].includes(method);
  const call = supported ? `request.${method}` : "request.fetch";
  const jsonBody = jsonBodyLiteral(request.body);
  const options = [
    jsHeadersBlock(headers, "    "),
    jsQueryBlock(request, "    "),
    supported ? "" : `    method: ${quote(request.method)},\n`,
    jsonBody !== undefined ? `    data: ${jsonBody},\n` : request.body !== undefined ? `    data: ${quote(request.body)},\n` : "",
  ].join("");
  return `import { test, expect } from '@playwright/test';

${jsSecretPreamble(headers)}test('${request.method} ${new URL(request.url).pathname}', async ({ request }) => {
  const response = await ${call}(${quote(request.url)}${options ? `, {\n${options}  }` : ""});

  expect(response.status()).toBe(200);
});`;
}

function cypressCode(request: ParsedCurlRequest): string {
  const headers = codeHeaders(request);
  const jsonBody = jsonBodyLiteral(request.body);
  const options = [
    `    method: ${quote(request.method)},\n`,
    `    url: ${quote(request.url)},\n`,
    jsQueryBlock(request, "    ", "qs"),
    jsHeadersBlock(headers, "    "),
    jsonBody !== undefined ? `    body: ${jsonBody},\n` : request.body !== undefined ? `    body: ${quote(request.body)},\n` : "",
  ].join("");
  return `${jsSecretPreamble(headers)}describe('${request.method} ${new URL(request.url).pathname}', () => {
  it('responde 200', () => {
    cy.request({
${options}    }).then((response) => {
      expect(response.status).to.eq(200);
    });
  });
});`;
}

function fetchCode(request: ParsedCurlRequest): string {
  const headers = codeHeaders(request);
  const options = [`  method: ${quote(request.method)},\n`, jsHeadersBlock(headers, "  "), request.body !== undefined ? `  body: ${backtick(request.body)},\n` : ""].join("");
  return `${jsSecretPreamble(headers)}const response = await fetch(${quote(urlWithQuery(request))}, {
${options}});

if (!response.ok) throw new Error(\`Esperado 200, recebido \${response.status}\`);
const data = await response.json();`;
}

function axiosCode(request: ParsedCurlRequest): string {
  const headers = codeHeaders(request);
  const jsonBody = jsonBodyLiteral(request.body);
  const options = [
    `  method: ${quote(request.method)},\n`,
    `  url: ${quote(request.url)},\n`,
    jsQueryBlock(request, "  "),
    jsHeadersBlock(headers, "  "),
    jsonBody !== undefined ? `  data: ${jsonBody},\n` : request.body !== undefined ? `  data: ${quote(request.body)},\n` : "",
  ].join("");
  return `import axios from 'axios';

${jsSecretPreamble(headers)}const response = await axios({
${options}});

expect(response.status).toBe(200);`;
}

function pythonCode(request: ParsedCurlRequest): string {
  const headers = codeHeaders(request);
  const variables = secretVariables(headers);
  const preamble = variables.length > 0 ? `${variables.map((variable) => `${variable.toLowerCase()} = os.environ.get(${quote(variable)}, "")`).join("\n")}\n\n` : "";
  const headerLines = headers
    .map((header) => (header.secret ? `    ${quote(header.name)}: f${quote(`${header.value}{${(header.variable as string).toLowerCase()}}`)},` : `    ${quote(header.name)}: ${quote(header.value)},`))
    .join("\n");
  const queryLines = request.query.map((param) => `    ${quote(param.name)}: ${quote(param.value)},`).join("\n");
  const parts = [
    `    ${quote(request.url)},`,
    headers.length > 0 ? `    headers={\n${headerLines}\n    },` : "",
    request.query.length > 0 ? `    params={\n${queryLines}\n    },` : "",
    request.body !== undefined ? `    data=${quote(request.body)},` : "",
  ].filter(Boolean);
  return `import os
import requests

${preamble}response = requests.request(
    ${quote(request.method)},
${parts.join("\n")}
)

assert response.status_code == 200, response.text`;
}

function javaLiteral(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function restAssuredCode(request: ParsedCurlRequest): string {
  const headers = codeHeaders(request);
  const variables = secretVariables(headers);
  const preamble = variables.length > 0 ? `${variables.map((variable) => `String ${variable.toLowerCase()} = System.getenv(${javaLiteral(variable)});`).join("\n")}\n\n` : "";
  const lines = [
    ...headers.map((header) =>
      header.secret
        ? `    .header(${javaLiteral(header.name)}, ${javaLiteral(header.value)} + ${(header.variable as string).toLowerCase()})`
        : `    .header(${javaLiteral(header.name)}, ${javaLiteral(header.value)})`,
    ),
    ...request.query.map((param) => `    .queryParam(${javaLiteral(param.name)}, ${javaLiteral(param.value)})`),
    ...(request.body !== undefined ? [`    .body(${javaLiteral(request.body)})`] : []),
  ];
  return `${preamble}given()
${lines.join("\n")}
.when()
    .request(${javaLiteral(request.method)}, ${javaLiteral(request.url)})
.then()
    .statusCode(200);`;
}

export function convertCurl(request: ParsedCurlRequest, target: CurlTarget): string {
  switch (target) {
    case "playwright":
      return playwrightCode(request);
    case "cypress":
      return cypressCode(request);
    case "fetch":
      return fetchCode(request);
    case "axios":
      return axiosCode(request);
    case "python":
      return pythonCode(request);
    case "rest-assured":
      return restAssuredCode(request);
  }
}

/** Reescreve o comando quebrando cada opção em uma linha; é o botão "Formatar". */
export function formatCurl(command: string): string {
  const request = parseCurl(command);
  const lines = [`curl -X ${request.method} ${quote(urlWithQuery(request))}`];
  for (const header of request.headers) lines.push(`  -H ${quote(`${header.name}: ${header.value}`)}`);
  if (request.basicAuth !== undefined) lines.push(`  -u ${quote(request.basicAuth)}`);
  if (request.body !== undefined) lines.push(`  --data ${quote(request.body)}`);
  return lines.join(" \\\n");
}
