import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from "playwright";
import { deduplicateIssues, passesQualityGate, summarizeIssues } from "./quality.js";
import { identifyIssue } from "./fingerprint.js";
import type { Issue, IssueEvidence, IssueInput, PerformanceMetrics, ScanOptions, ScanReport } from "./types.js";
import { VERSION } from "./version.js";
import { assertPublicUrl } from "./security.js";
import { compareWithBaseline, emptyBaseline, loadBaseline } from "./baseline.js";
import { performanceIssues } from "./performance.js";

function browserType(name: ScanOptions["browser"]): BrowserType {
  return { chromium, firefox, webkit }[name];
}

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

function cleanMessage(value: string): string {
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

function attachListeners(page: Page, issues: IssueInput[], options: ScanOptions): void {
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

async function safeTitle(page: Page): Promise<string> {
  try {
    return await page.title();
  } catch {
    return "";
  }
}

async function installPerformanceObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type VitalsState = {
      lcp: number | undefined;
      cls: number;
      clsWindow: number;
      clsWindowStart: number;
      clsWindowLast: number;
    };
    const state: VitalsState = { lcp: undefined, cls: 0, clsWindow: 0, clsWindowStart: 0, clsWindowLast: 0 };
    (globalThis as typeof globalThis & { __qaRadarVitals?: VitalsState }).__qaRadarVitals = state;
    try {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) state.lcp = last.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Métrica indisponível neste navegador.
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (shift.hadRecentInput) continue;
          const continuesWindow = state.clsWindowLast > 0 &&
            shift.startTime - state.clsWindowLast < 1_000 &&
            shift.startTime - state.clsWindowStart < 5_000;
          if (continuesWindow) state.clsWindow += shift.value;
          else {
            state.clsWindow = shift.value;
            state.clsWindowStart = shift.startTime;
          }
          state.clsWindowLast = shift.startTime;
          state.cls = Math.max(state.cls, state.clsWindow);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Métrica indisponível neste navegador.
    }
  });
}

function rounded(value: number | undefined, digits = 0): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function collectPerformanceMetrics(page: Page): Promise<PerformanceMetrics | undefined> {
  try {
    const raw = await page.evaluate(() => {
      type VitalsState = { lcp?: number; cls?: number };
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!navigation) return undefined;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const vitals = (globalThis as typeof globalThis & { __qaRadarVitals?: VitalsState }).__qaRadarVitals;
      return {
        ttfbMs: navigation.responseStart - navigation.startTime,
        fcpMs: fcp?.startTime,
        lcpMs: vitals?.lcp,
        cls: vitals?.cls,
        domContentLoadedMs: navigation.domContentLoadedEventEnd - navigation.startTime,
        loadMs: navigation.loadEventEnd > 0 ? navigation.loadEventEnd - navigation.startTime : undefined,
      };
    });
    if (!raw) return undefined;
    return {
      ttfbMs: rounded(raw.ttfbMs),
      fcpMs: rounded(raw.fcpMs),
      lcpMs: rounded(raw.lcpMs),
      cls: rounded(raw.cls, 3),
      domContentLoadedMs: rounded(raw.domContentLoadedMs),
      loadMs: rounded(raw.loadMs),
    };
  } catch {
    return undefined;
  }
}

async function inspectPageElements(page: Page, targetUrl: string): Promise<IssueInput[]> {
  // O transpiler nomeia funções internas; disponibilizamos o helper no contexto isolado da página.
  await page.evaluate("globalThis.__name ??= (target) => target");
  const findings = await page.evaluate(() => {
    type Finding = {
      ruleId: string;
      category: "element" | "accessibility";
      severity: "warning" | "error";
      title: string;
      impact: string;
      recommendation: string;
      message: string;
      url: string | undefined;
      selector: string;
      element: string;
      occurrences: number;
      box: { x: number; y: number; width: number; height: number } | undefined;
    };
    const result: Finding[] = [];

    const visible = (element: HTMLElement): boolean => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const selectorFor = (element: HTMLElement): string => {
      const tag = element.tagName.toLowerCase();
      if (element.id) return `${tag}#${CSS.escape(element.id)}`;
      for (const attr of ["name", "src", "href", "type"]) {
        const value = element.getAttribute(attr);
        if (value) return `${tag}[${attr}="${CSS.escape(value)}"]`;
      }
      const siblings = element.parentElement
        ? [...element.parentElement.children].filter((sibling) => sibling.tagName === element.tagName)
        : [];
      return `${tag}:nth-of-type(${Math.max(siblings.indexOf(element), 0) + 1})`;
    };
    const boxFor = (element: HTMLElement): Finding["box"] => {
      if (!visible(element)) return undefined;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + scrollX,
        y: rect.top + scrollY,
        width: rect.width,
        height: rect.height,
      };
    };
    const describe = (element: HTMLElement): string => {
      const detail =
        element.getAttribute("alt") ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.textContent?.trim().slice(0, 60) ||
        element.tagName.toLowerCase();
      return `${element.tagName.toLowerCase()} · ${detail}`;
    };
    const accessibleName = (element: HTMLElement): string => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      const explicitLabel = element.id
        ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim()
        : "";
      const nestedLabel = element.closest("label")?.textContent?.trim();
      const imageAlt = element.querySelector("img")?.getAttribute("alt")?.trim();
      return (
        element.getAttribute("aria-label")?.trim() ||
        labelledText ||
        explicitLabel ||
        nestedLabel ||
        element.getAttribute("title")?.trim() ||
        imageAlt ||
        element.textContent?.trim() ||
        (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)
          ? element.value.trim()
          : "")
      );
    };
    const add = (finding: Omit<Finding, "selector" | "element" | "box">, element: HTMLElement): void => {
      result.push({
        ...finding,
        selector: selectorFor(element),
        element: describe(element),
        box: boxFor(element),
      });
    };

    for (const image of document.querySelectorAll<HTMLImageElement>("img")) {
      if (image.complete && image.naturalWidth === 0) {
        add({
          ruleId: "element.image.broken",
          category: "element",
          severity: "error",
          title: "Imagem quebrada na página",
          impact: "O usuário verá um espaço vazio ou o ícone de imagem quebrada.",
          recommendation: "Corrija o endereço da imagem ou publique o arquivo ausente.",
          message: "A imagem terminou de carregar, mas o navegador não conseguiu decodificar conteúdo visual.",
          url: image.currentSrc || image.src || undefined,
          occurrences: 1,
        }, image);
      }
      if (!image.hasAttribute("alt") && visible(image)) {
        add({
          ruleId: "accessibility.image.alt-missing",
          category: "accessibility",
          severity: "warning",
          title: "Imagem sem descrição alternativa",
          impact: "Pessoas que usam leitores de tela podem não compreender o conteúdo da imagem.",
          recommendation: "Adicione um atributo alt descritivo; use alt vazio apenas quando a imagem for decorativa.",
          message: "Elemento img visível sem atributo alt.",
          url: image.currentSrc || image.src || undefined,
          occurrences: 1,
        }, image);
      }
    }

    for (const element of document.querySelectorAll<HTMLElement>("button,a[href]")) {
      if (visible(element) && !accessibleName(element)) {
        const isButton = element.tagName === "BUTTON";
        add({
          ruleId: isButton ? "accessibility.button.name-missing" : "accessibility.link.name-missing",
          category: "accessibility",
          severity: "warning",
          title: isButton ? "Botão sem identificação" : "Link sem identificação",
          impact: "O controle não comunica sua finalidade para leitores de tela e pode confundir usuários.",
          recommendation: `Adicione texto visível ou aria-label ao ${isButton ? "botão" : "link"}.`,
          message: "Elemento interativo visível sem nome acessível.",
          url: element instanceof HTMLAnchorElement ? element.href : undefined,
          occurrences: 1,
        }, element);
      }
    }

    for (const control of document.querySelectorAll<HTMLElement>("input:not([type=hidden]),select,textarea")) {
      if (visible(control) && !accessibleName(control)) {
        add({
          ruleId: "accessibility.form-control.name-missing",
          category: "accessibility",
          severity: "warning",
          title: "Campo sem identificação",
          impact: "O usuário pode não saber qual informação deve preencher, especialmente com leitor de tela.",
          recommendation: "Associe um label ao campo usando for/id ou adicione aria-label.",
          message: "Controle de formulário visível sem label ou nome acessível.",
          url: undefined,
          occurrences: 1,
        }, control);
      }
    }

    for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe")) {
      if (visible(frame) && !frame.title.trim()) {
        add({
          ruleId: "accessibility.iframe.title-missing",
          category: "accessibility",
          severity: "warning",
          title: "Conteúdo incorporado sem título",
          impact: "Usuários de leitores de tela não conseguem identificar a finalidade do conteúdo incorporado.",
          recommendation: "Adicione um atributo title que descreva o conteúdo do iframe.",
          message: "Iframe visível sem atributo title.",
          url: frame.src || undefined,
          occurrences: 1,
        }, frame);
      }
    }

    const ids = new Map<string, HTMLElement[]>();
    for (const element of document.querySelectorAll<HTMLElement>("[id]")) {
      if (!element.id) continue;
      const group = ids.get(element.id) ?? [];
      group.push(element);
      ids.set(element.id, group);
    }
    for (const [id, elements] of ids) {
      if (elements.length < 2) continue;
      const first = elements[0];
      if (!first) continue;
      add({
        ruleId: "element.id.duplicate",
        category: "element",
        severity: "warning",
        title: "Identificador duplicado no HTML",
        impact: "Labels, automações e JavaScript podem encontrar o elemento errado.",
        recommendation: `Mantenha o id "${id}" em apenas um elemento e use classes nos demais.`,
        message: `${elements.length} elementos utilizam o mesmo id "${id}".`,
        url: undefined,
        occurrences: elements.length,
      }, first);
    }
    return result;
  });

  return findings.map((finding) => ({
    ruleId: finding.ruleId,
    category: finding.category,
    severity: finding.severity,
    title: finding.title,
    impact: finding.impact,
    recommendation: finding.recommendation,
    message: finding.message,
    method: undefined,
    status: undefined,
    url: finding.url ?? targetUrl,
    resourceType: "document",
    source: undefined,
    occurrences: finding.occurrences,
    evidence: {
      selector: finding.selector,
      element: finding.element,
      label: finding.title,
      boundingBox: finding.box,
    },
  }));
}

function domInspectionIssue(page: Page, targetUrl: string, error: unknown): IssueInput {
  return {
    ruleId: "navigation.dom-inspection-failed",
    category: "navigation",
    severity: "error",
    title: "A página não ficou estável para inspeção",
    impact: "O scanner observou a navegação, mas não conseguiu validar os elementos da página com segurança.",
    recommendation: "Verifique redirecionamentos contínuos, recarregamentos automáticos e falhas durante a inicialização.",
    message: cleanMessage(error instanceof Error ? error.message : String(error)),
    method: "GET",
    status: undefined,
    url: page.url() || targetUrl,
    resourceType: "document",
    source: undefined,
    occurrences: 1,
  };
}

async function inspectStablePage(page: Page, targetUrl: string): Promise<{ issues: IssueInput[]; partial: boolean }> {
  try {
    return { issues: await inspectPageElements(page, targetUrl), partial: false };
  } catch (firstError) {
    const contextChanged = /execution context was destroyed|cannot find context|most likely because of a navigation/i
      .test(firstError instanceof Error ? firstError.message : String(firstError));
    if (contextChanged && !page.isClosed()) {
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 2_000 });
        return { issues: await inspectPageElements(page, targetUrl), partial: false };
      } catch (retryError) {
        return { issues: [domInspectionIssue(page, targetUrl, retryError)], partial: true };
      }
    }
    return { issues: [domInspectionIssue(page, targetUrl, firstError)], partial: true };
  }
}

function correlateIssues(issues: IssueInput[]): IssueInput[] {
  const correlated = issues.filter((issue) => {
    if (!issue.url) return true;
    const transportIssue = issues.some(
      (candidate) =>
        candidate !== issue &&
        candidate.url === issue.url &&
        (candidate.category === "http" || candidate.category === "network"),
    );
    if (!transportIssue) return true;
    if (issue.category === "console" && /Failed to load resource/i.test(issue.message)) return false;
    if (issue.category === "element" && issue.title === "Imagem quebrada na página") return false;
    return true;
  });

  const grouped: IssueInput[] = [];
  const cookieGroups = new Map<string, IssueInput>();
  for (const issue of correlated) {
    if (issue.title === "Cookie de terceiro bloqueado pelo navegador") {
      const cookieName = /Cookie [“"]([^”"]+)[”"]/i.exec(issue.message)?.[1] ?? "terceiro";
      const existing = cookieGroups.get(cookieName);
      if (existing) {
        existing.occurrences += issue.occurrences;
        if (issue.url && !existing.message.includes(issue.url)) {
          existing.message += `\nTambém observado em: ${issue.url}`;
        }
        continue;
      }
      issue.title = `Cookie “${cookieName}” bloqueado na integração externa`;
      cookieGroups.set(cookieName, issue);
    }
    grouped.push(issue);
  }
  return grouped;
}

async function annotateEvidence(page: Page, issues: Issue[]): Promise<void> {
  const input = issues.map((issue, index) => ({
    number: index + 1,
    category: issue.category,
    severity: issue.severity,
    title: issue.title ?? issue.message,
    impact: issue.impact,
    message: issue.message,
    status: issue.status,
    url: issue.url,
    selector: issue.evidence?.selector,
  }));

  const evidence = await page.evaluate((items) => {
    document.querySelector("[data-qa-radar-evidence]")?.remove();
    const layer = document.createElement("div");
    layer.dataset.qaRadarEvidence = "true";
    layer.style.cssText = "position:absolute;inset:0;z-index:2147483647;pointer-events:none;font-family:Arial,sans-serif;color:#fff";
    document.documentElement.appendChild(layer);

    const panel = document.createElement("section");
    panel.style.cssText = `position:absolute;top:${window.scrollY + 16}px;right:16px;width:390px;max-width:calc(100vw - 32px);background:#07111ff2;border:2px solid #22d3ee;border-radius:14px;padding:16px;box-shadow:0 16px 48px #000a;text-align:left`;
    const heading = document.createElement("div");
    heading.textContent = "QA RADAR · EVIDÊNCIA VISUAL";
    heading.style.cssText = "color:#67e8f9;font-size:12px;font-weight:900;letter-spacing:1.5px;margin-bottom:8px";
    const target = document.createElement("div");
    target.textContent = `${location.hostname} · ${new Date().toLocaleString("pt-BR")}`;
    target.style.cssText = "color:#a8bad1;font-size:11px;margin-bottom:12px";
    panel.append(heading, target);

    for (const item of items.slice(0, 8)) {
      const row = document.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:28px 1fr;gap:9px;border-top:1px solid #ffffff22;padding:8px 0;align-items:start";
      const number = document.createElement("b");
      number.textContent = String(item.number);
      number.style.cssText = `display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:${item.severity === "error" ? "#dc2626" : "#d97706"};font-size:12px`;
      const detail = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = item.title.slice(0, 95);
      title.style.cssText = "display:block;font-size:11px;line-height:1.35";
      const url = document.createElement("span");
      url.textContent = item.impact ?? item.url ?? "Ocorrência global da página";
      url.style.cssText = "display:block;color:#93c5fd;font-size:9px;line-height:1.3;margin-top:3px;word-break:break-all";
      detail.append(title, url);
      row.append(number, detail);
      panel.appendChild(row);
    }
    if (items.length > 8) {
      const more = document.createElement("div");
      more.textContent = `+ ${items.length - 8} ocorrência(s) no relatório completo`;
      more.style.cssText = "color:#a8bad1;font-size:10px;margin-top:7px";
      panel.appendChild(more);
    }
    layer.appendChild(panel);

    const candidates = [...document.querySelectorAll<HTMLElement>(
      "img[src],script[src],link[href],iframe[src],source[src],video[src],audio[src],input[src],object[data]",
    )];
    const located: Array<{ number: number; selector: string; element: string; label: string; boundingBox: { x: number; y: number; width: number; height: number } | undefined }> = [];
    const marked = new Map<Element, HTMLElement>();

    for (const item of items) {
      let element: HTMLElement | undefined;
      if (item.selector) {
        try {
          element = document.querySelector<HTMLElement>(item.selector) ?? undefined;
        } catch {
          element = undefined;
        }
      }
      if (!element && item.url) {
        element = candidates.find((candidate) => {
          const attr = candidate.hasAttribute("src") ? "src" : candidate.hasAttribute("href") ? "href" : "data";
          const raw = candidate.getAttribute(attr);
          if (!raw) return false;
          try {
            const resolved = candidate instanceof HTMLImageElement && candidate.currentSrc
              ? candidate.currentSrc
              : new URL(raw, document.baseURI).toString();
            return resolved === item.url;
          } catch {
            return false;
          }
        });
      }
      if (!element) continue;

      const attr = element.hasAttribute("src") ? "src" : element.hasAttribute("href") ? "href" : "data";
      const raw = element.getAttribute(attr) ?? "";
      const selector = element.id
        ? `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`
        : `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(raw)}"]`;
      const description =
        element.getAttribute("alt") ||
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.tagName.toLowerCase();
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      const box = visible
        ? { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height }
        : undefined;
      const label = `#${item.number} ${item.title.toUpperCase().slice(0, 34)}`;
      const markerLabel = `#${item.number}`;
      located.push({ number: item.number, selector, element: `${element.tagName.toLowerCase()} · ${description}`, label, boundingBox: box });

      if (visible) {
        const existingBadge = marked.get(element);
        if (existingBadge) {
          existingBadge.textContent = `${existingBadge.textContent} ${markerLabel}`;
          continue;
        }
        const marker = document.createElement("div");
        marker.style.cssText = `position:absolute;left:${box?.x ?? 0}px;top:${box?.y ?? 0}px;width:${Math.max(box?.width ?? 0, 28)}px;height:${Math.max(box?.height ?? 0, 28)}px;border:4px solid #ef4444;background:#ef444425;box-shadow:0 0 0 3px #fff,0 8px 25px #0009;border-radius:4px`;
        const badge = document.createElement("b");
        badge.textContent = markerLabel;
        badge.title = item.title;
        badge.style.cssText = "position:absolute;left:-13px;top:-13px;display:grid;place-items:center;min-width:28px;height:28px;white-space:nowrap;background:#dc2626;color:white;border:2px solid white;border-radius:999px;padding:0 5px;font-size:10px;line-height:1;font-weight:900;box-shadow:0 4px 12px #0009";
        marker.appendChild(badge);
        layer.appendChild(marker);
        marked.set(element, badge);
      }
    }
    return located;
  }, input);

  for (const item of evidence) {
    const issue = issues[item.number - 1];
    if (!issue) continue;
    const value: IssueEvidence = {
      selector: item.selector,
      element: item.element,
      label: item.label,
      boundingBox: item.boundingBox,
    };
    issue.evidence = value;
  }
}

export async function scan(options: ScanOptions): Promise<ScanReport> {
  const startedAt = new Date();
  const issues: IssueInput[] = [];
  let browser: Browser | undefined;
  let page: Page | undefined;
  let mainStatus: number | undefined;
  let screenshotPath: string | undefined;
  let performance: PerformanceMetrics | undefined;
  let scanStatus: ScanReport["scanStatus"] = "completed";

  try {
    browser = await browserType(options.browser).launch({ headless: !options.headed });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: false,
    });
    page = await context.newPage();
    await installPerformanceObservers(page);
    if (options.publicNetworkOnly) {
      await page.route("**/*", async (route) => {
        try {
          await assertPublicUrl(route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
    }
    attachListeners(page, issues, options);

    try {
      const response = await page.goto(options.url, {
        waitUntil: "domcontentloaded",
        timeout: options.timeoutMs,
      });
      mainStatus = response?.status();
      if (options.settleMs > 0) await page.waitForTimeout(options.settleMs);
    } catch (error) {
      scanStatus = "partial";
      issues.push({
        ruleId: "navigation.failed",
        category: "navigation",
        severity: "error",
        title: "A página não pôde ser aberta",
        impact: "Nenhum conteúdo confiável pôde ser analisado pelo scanner.",
        recommendation: "Confirme a URL, disponibilidade, certificado e tempo de resposta da aplicação.",
        message: cleanMessage(error instanceof Error ? error.message : String(error)),
        method: "GET",
        status: undefined,
        url: options.url,
        resourceType: "document",
        source: undefined,
        occurrences: 1,
      });
    }

    const inspection = await inspectStablePage(page, options.url);
    issues.push(...inspection.issues);
    if (inspection.partial) scanStatus = "partial";
    if (scanStatus === "completed") {
      performance = await collectPerformanceMetrics(page);
      if (performance) issues.push(...performanceIssues(performance, page.url() || options.url));
    }

    const uniqueIssues = deduplicateIssues(correlateIssues(issues).map(identifyIssue));
    const summary = summarizeIssues(uniqueIssues);
    const comparison = options.baselinePath
      ? compareWithBaseline(uniqueIssues, await loadBaseline(options.baselinePath))
      : options.regressionsOnly ? compareWithBaseline(uniqueIssues, emptyBaseline()) : undefined;
    const gateSummary = options.regressionsOnly && comparison ? comparison.newSummary : summary;
    const passed = passesQualityGate(gateSummary, options.failOn);
    const shouldCapture = scanStatus === "completed" &&
      (options.screenshot === "always" || (options.screenshot === "on-failure" && !passed));

    if (shouldCapture) {
      await mkdir(options.outputDir, { recursive: true });
      screenshotPath = join(options.outputDir, "screenshot.png");
      try {
        await annotateEvidence(page, uniqueIssues);
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {
        screenshotPath = undefined;
      }
    } else {
      await rm(join(options.outputDir, "screenshot.png"), { force: true });
    }

    return {
      tool: "QA Radar",
      schemaVersion: "1.0",
      version: VERSION,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      scanStatus,
      targetUrl: options.url,
      finalUrl: page.url() || options.url,
      title: await safeTitle(page),
      mainStatus,
      browser: options.browser,
      ...(options.project ? { project: options.project } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
      passed,
      failOn: options.failOn,
      gateScope: options.regressionsOnly ? "regressions" : "all",
      summary,
      ...(performance ? { performance } : {}),
      ...(comparison ? { comparison } : {}),
      issues: uniqueIssues,
      screenshotPath,
    };
  } finally {
    await browser?.close();
  }
}
