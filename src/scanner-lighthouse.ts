import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import type { IssueCategory, IssueInput, LighthouseSummary } from "./types.js";

interface AuditReference { id: string; weight: number }
interface LighthouseCategory { id: string; score: number | null; auditRefs: AuditReference[] }
interface LighthouseAudit {
  id: string;
  title: string;
  description: string;
  score: number | null;
  scoreDisplayMode: string;
  displayValue?: string;
  details?: { items?: Array<Record<string, unknown>> };
}

const FAST_METRIC_AUDITS = new Set([
  "server-response-time", "first-contentful-paint", "largest-contentful-paint",
  "cumulative-layout-shift", "errors-in-console",
]);

const GUIDANCE: Record<string, { title: string; impact: string; recommendation: string }> = {
  "meta-description": {
    title: "Documento não possui meta description",
    impact: "Mecanismos de busca podem exibir um resumo inadequado ou pouco atrativo da página nos resultados.",
    recommendation: "Adicione uma tag <meta name=\"description\"> no <head> com um resumo específico e conciso do conteúdo.",
  },
  "image-alt": {
    title: "Imagens informativas não possuem texto alternativo",
    impact: "Pessoas que usam leitores de tela podem não compreender o conteúdo ou a função dessas imagens.",
    recommendation: "Adicione um atributo alt descritivo às imagens informativas e alt=\"\" às imagens exclusivamente decorativas.",
  },
  "total-blocking-time": {
    title: "A página permaneceu bloqueada por tarefas longas",
    impact: "Durante esse período, cliques, digitação e outras interações podem responder com atraso, fazendo a página parecer travada.",
    recommendation: "Divida tarefas JavaScript longas, reduza scripts de terceiros e carregue código não essencial somente quando necessário.",
  },
  "speed-index": {
    title: "O conteúdo visível demorou para ser apresentado",
    impact: "A página pode parecer vazia ou incompleta por mais tempo, mesmo quando alguns recursos já começaram a carregar.",
    recommendation: "Reduza recursos que bloqueiam a renderização, priorize conteúdo acima da dobra e adie scripts e estilos não essenciais.",
  },
};

function referenceUrl(description: string): string | undefined {
  return /\[[^\]]+\]\((https?:\/\/[^)]+)\)/.exec(description)?.[1] ??
    /(https?:\/\/[^\s)]+)/.exec(description)?.[1];
}

function plainText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryFor(ids: Set<string>): IssueCategory {
  if (ids.has("seo")) return "seo";
  if (ids.has("best-practices")) return "best-practices";
  return "performance";
}

function evidenceFor(audit: LighthouseAudit) {
  const item = audit.details?.items?.[0];
  if (!item) return undefined;
  const nodeValue = item.node;
  if (!nodeValue || typeof nodeValue !== "object") return undefined;
  const node = nodeValue as Record<string, unknown>;
  const selector = typeof node.selector === "string" ? node.selector : undefined;
  if (!selector) return undefined;
  return {
    selector,
    element: typeof node.snippet === "string" ? node.snippet : selector,
    label: typeof node.nodeLabel === "string" ? node.nodeLabel : audit.title,
    boundingBox: undefined,
  };
}

function affectedUrl(audit: LighthouseAudit, fallback: string): string {
  const value = audit.details?.items?.[0]?.url;
  return typeof value === "string" && /^https?:/.test(value) ? value : fallback;
}

export function lighthouseAuditsToIssues(
  categories: LighthouseCategory[],
  audits: Record<string, LighthouseAudit>,
  url: string,
): IssueInput[] {
  const candidates = new Map<string, { audit: LighthouseAudit; weight: number; categories: Set<string> }>();
  for (const category of categories) {
    for (const reference of category.auditRefs) {
      const audit = audits[reference.id];
      if (!audit || FAST_METRIC_AUDITS.has(audit.id) || reference.weight <= 0) continue;
      if (audit.score === null || audit.score >= 0.9 || ["manual", "notApplicable", "informative"].includes(audit.scoreDisplayMode)) continue;
      const current = candidates.get(audit.id);
      if (current) {
        current.weight = Math.max(current.weight, reference.weight);
        current.categories.add(category.id);
      } else {
        candidates.set(audit.id, { audit, weight: reference.weight, categories: new Set([category.id]) });
      }
    }
  }

  return [...candidates.values()]
    .sort((left, right) => right.weight - left.weight || (left.audit.score ?? 1) - (right.audit.score ?? 1))
    .slice(0, 15)
    .map(({ audit, weight, categories: categoryIds }) => {
      const reference = referenceUrl(audit.description);
      const evidence = evidenceFor(audit);
      const guidance = GUIDANCE[audit.id];
      return {
        ruleId: `lighthouse.${audit.id}`,
        category: categoryFor(categoryIds),
        severity: audit.score === 0 && weight >= 7 ? "error" : "warning",
        title: guidance?.title ?? audit.title,
        impact: guidance?.impact ?? plainText(audit.description),
        recommendation: guidance?.recommendation ?? `Corrija a auditoria "${audit.title}" e execute o Lighthouse novamente para confirmar o resultado.`,
        ...(reference ? { referenceUrl: reference } : {}),
        message: audit.displayValue
          ? `${audit.displayValue} (pontuação ${Math.round((audit.score ?? 0) * 100)}/100).`
          : `Auditoria reprovada com pontuação ${Math.round((audit.score ?? 0) * 100)}/100.`,
        method: undefined,
        status: undefined,
        url: affectedUrl(audit, url),
        resourceType: "document",
        source: "lighthouse",
        occurrences: 1,
        ...(evidence ? { evidence } : {}),
      };
    });
}

export async function auditLighthouse(
  url: string,
  outputDir: string,
  timeoutMs: number,
): Promise<{ summary: LighthouseSummary; issues: IssueInput[] }> {
  const [{ default: lighthouse }, { launch }] = await Promise.all([import("lighthouse"), import("chrome-launcher")]);
  await mkdir(outputDir, { recursive: true });
  const chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const result = await lighthouse(url, {
      port: chrome.port, output: "json", logLevel: "error",
      maxWaitForLoad: Math.min(Math.max(timeoutMs, 1_000), 120_000),
      onlyCategories: ["performance", "best-practices", "seo"],
    });
    if (!result) throw new Error("Lighthouse não retornou resultado.");
    const reportPath = join(outputDir, "report.lighthouse.json");
    await writeFile(reportPath, typeof result.report === "string" ? result.report : JSON.stringify(result.lhr), "utf8");
    const categories = Object.values(result.lhr.categories).map((category) => ({
      id: category.id, score: category.score,
      auditRefs: category.auditRefs.map((reference) => ({ id: reference.id, weight: reference.weight })),
    }));
    const score = (id: string) => result.lhr.categories[id]?.score ?? undefined;
    return {
      summary: {
        performance: score("performance"), bestPractices: score("best-practices"),
        seo: score("seo"), reportPath: "report.lighthouse.json",
      },
      issues: lighthouseAuditsToIssues(categories, result.lhr.audits as Record<string, LighthouseAudit>, result.lhr.finalDisplayedUrl || url),
    };
  } finally {
    await chrome.kill();
  }
}
