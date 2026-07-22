import type { Page } from "playwright";
import { cleanMessage } from "./scanner-events.js";
import type { IssueInput } from "./types.js";

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
    }

    // O axe-core não reporta IDs duplicados que não participam de relações ARIA.
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

export async function inspectStablePage(
  page: Page,
  targetUrl: string,
): Promise<{ issues: IssueInput[]; partial: boolean }> {
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
