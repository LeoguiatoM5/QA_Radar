import type { ConsoleMessage, Page, Request, Response } from "playwright";
import type { IssueInput, ScanOptions } from "./types.js";

function isIgnored(url: string, options: ScanOptions): boolean {
  return options.ignoredUrlPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(url);
  });
}

function sourceFromConsole(message: ConsoleMessage): string | undefined {
  const location = message.location();
  if (!location.url) return undefined;
  return `${location.url}:${location.lineNumber}:${location.columnNumber}`;
}

export function cleanMessage(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").trim();
}

function requestIssue(request: Request): IssueInput {
  const resourceType = request.resourceType();
  const technicalMessage = request.failure()?.errorText ?? "Falha de rede desconhecida";
  const corruptedContent = /CORRUPTED_CONTENT|CONTENT_DECODING_FAILED/i.test(technicalMessage);
  return {
    ruleId: "network.request.failed",
    category: "network",
    severity: "error",
    title: corruptedContent
      ? "Conteúdo recebido em formato inválido"
      : resourceType === "image" ? "Imagem não pôde ser carregada" : "Recurso não pôde ser carregado",
    impact: corruptedContent
      ? "O navegador bloqueou o arquivo porque o conteúdo recebido não corresponde ao formato esperado."
      : resourceType === "image"
      ? "Uma imagem pode aparecer vazia ou quebrada para o usuário."
      : "Parte da página pode não funcionar ou aparecer incompleta.",
    recommendation: corruptedContent
      ? "Verifique redirecionamentos, Content-Type, compressão e se a URL devolve o arquivo correto."
      : "Verifique a URL, disponibilidade do serviço, DNS, TLS e bloqueios de rede.",
    message: technicalMessage,
    method: request.method(),
    status: undefined,
    url: request.url(),
    resourceType,
    source: undefined,
    occurrences: 1,
  };
}

function responseIssue(response: Response): IssueInput {
  const request = response.request();
  const status = response.status();
  const resourceType = request.resourceType();
  const isServerError = status >= 500;
  const breaksPage = ["document", "image", "stylesheet", "script"].includes(resourceType);
  const title = resourceType === "image"
    ? status === 404 ? "Imagem não encontrada" : "Imagem falhou no servidor"
    : resourceType === "stylesheet"
      ? "Estilo da página não foi carregado"
      : resourceType === "script"
        ? "Script não foi carregado"
        : resourceType === "fetch" || resourceType === "xhr"
          ? "Serviço da aplicação respondeu com erro"
          : status === 404 ? "Recurso não encontrado" : "Servidor respondeu com erro";
  return {
    ruleId: "http.response.error",
    category: "http",
    severity: isServerError || breaksPage ? "error" : "warning",
    title,
    impact: resourceType === "image"
      ? "O usuário pode ver uma imagem quebrada ou conteúdo visual ausente."
      : resourceType === "stylesheet"
        ? "A página pode aparecer sem estilos ou com layout incorreto."
        : resourceType === "script"
          ? "Uma funcionalidade dependente desse script pode não funcionar."
          : isServerError
            ? "A funcionalidade dependente desse recurso pode estar indisponível."
            : "O conteúdo solicitado não foi encontrado.",
    recommendation: status === 404
      ? "Corrija ou remova a referência para esse endereço."
      : "Verifique os logs e a disponibilidade do serviço responsável.",
    message: `${status} ${response.statusText()}`.trim(),
    method: request.method(),
    status,
    url: response.url(),
    resourceType,
    source: undefined,
    occurrences: 1,
  };
}

export function attachListeners(page: Page, issues: IssueInput[], options: ScanOptions): void {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    if (location.url && isIgnored(location.url, options)) return;
    const technicalMessage = message.text();
    const cookieBlocked = /Cookie .+ rejected.+cross-site context.+SameSite/is.test(technicalMessage);
    const mimeBlocked = /blocked due to MIME type|MIME type.+mismatch/is.test(technicalMessage);
    issues.push({
      ruleId: cookieBlocked
        ? "console.cookie.blocked"
        : mimeBlocked ? "console.resource.mime-mismatch" : "console.error",
      category: "console",
      severity: cookieBlocked ? "warning" : "error",
      title: cookieBlocked
        ? "Cookie de terceiro bloqueado pelo navegador"
        : mimeBlocked
          ? "Recurso bloqueado por formato incorreto"
          : "Erro registrado pelo navegador",
      impact: cookieBlocked
        ? "Uma integração externa pode perder sessão ou preferências, mas a página pode continuar funcionando."
        : mimeBlocked
          ? "Um estilo ou script não foi carregado, podendo quebrar o visual ou uma funcionalidade."
          : "Pode existir uma funcionalidade quebrada ou recurso ausente na página.",
      recommendation: cookieBlocked
        ? "Confirme se a integração realmente depende do cookie. O fornecedor deve usar SameSite=None; Secure quando apropriado."
        : mimeBlocked
          ? "Garanta que a URL retorne o arquivo esperado e o Content-Type correto, sem redirecionar para uma página HTML."
          : "Abra a ocorrência técnica, identifique o componente relacionado e reproduza a ação afetada.",
      message: technicalMessage,
      method: undefined,
      status: undefined,
      url: location.url || undefined,
      resourceType: undefined,
      source: sourceFromConsole(message),
      occurrences: 1,
    });
  });

  page.on("pageerror", (error) => {
    const invalidSyntax = /unexpected (?:token|identifier)|syntaxerror/i.test(error.message);
    issues.push({
      ruleId: invalidSyntax ? "javascript.syntax-error" : "javascript.uncaught-error",
      category: "javascript",
      severity: "error",
      title: invalidSyntax ? "Script retornou conteúdo que não pode ser executado" : "Falha na execução do JavaScript",
      impact: invalidSyntax
        ? "A funcionalidade carregada por esse script não foi iniciada."
        : "Uma ação ou componente da página pode ter parado de funcionar.",
      recommendation: invalidSyntax
        ? "Inspecione a resposta do script: ela pode conter HTML, mensagem de conta suspensa ou outro conteúdo no lugar de JavaScript."
        : "Localize o script e a linha indicados, corrija a exceção e teste novamente o fluxo afetado.",
      message: error.message,
      method: undefined,
      status: undefined,
      url: page.url() || options.url,
      resourceType: "document",
      source: error.stack,
      occurrences: 1,
    });
  });

  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (options.ignoredStatuses.has(response.status()) || isIgnored(response.url(), options)) return;
    issues.push(responseIssue(response));
  });

  page.on("requestfailed", (request) => {
    if (!isIgnored(request.url(), options)) issues.push(requestIssue(request));
  });
}
