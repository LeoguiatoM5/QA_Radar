import axe from "axe-core";
import type { Page } from "playwright";
import { cleanMessage } from "./scanner-events.js";
import type { IssueInput, Severity } from "./types.js";

interface AxeNodeFinding {
  html: string;
  target: string;
  failureSummary?: string;
  box?: { x: number; y: number; width: number; height: number };
}

export interface AxeViolationFinding {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical" | null;
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNodeFinding[];
}

function severityFor(impact: AxeViolationFinding["impact"]): Severity {
  return impact === "critical" || impact === "serious" ? "error" : "warning";
}

export function axeViolationsToIssues(violations: AxeViolationFinding[], url: string): IssueInput[] {
  return violations.flatMap((violation) => {
    const first = violation.nodes[0];
    if (!first) return [];
    return [{
      ruleId: `axe.${violation.id}`,
      category: "accessibility" as const,
      severity: severityFor(violation.impact),
      title: violation.help,
      impact: violation.description,
      recommendation: `Corrija os elementos conforme a regra ${violation.id}. Referência: ${violation.helpUrl}`,
      message: first.failureSummary ?? violation.description,
      method: undefined,
      status: undefined,
      url,
      resourceType: "document",
      source: "axe-core",
      occurrences: violation.nodes.length,
      evidence: {
        selector: first.target,
        element: first.html,
        label: violation.help,
        boundingBox: first.box,
      },
    }];
  });
}

export async function auditAccessibility(page: Page, targetUrl: string): Promise<IssueInput[]> {
  try {
    // Executa pelo contexto controlado do Playwright para não depender da política
    // script-src da aplicação. A CSP da página permanece ativa para seus próprios scripts.
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
      type AxeWindow = typeof globalThis & {
        axe: {
          run: (context: Document, options: { resultTypes: string[] }) => Promise<{
            violations: Array<{
              id: string;
              impact: "minor" | "moderate" | "serious" | "critical" | null;
              description: string;
              help: string;
              helpUrl: string;
              nodes: Array<{ html: string; target: unknown[]; failureSummary?: string }>;
            }>;
          }>;
        };
      };
      const results = await (globalThis as AxeWindow).axe.run(document, { resultTypes: ["violations"] });
      return results.violations.map((violation) => ({
        ...violation,
        nodes: violation.nodes.map((node) => {
          const target = node.target.map(String).join(" ");
          let box: { x: number; y: number; width: number; height: number } | undefined;
          try {
            const element = document.querySelector(target);
            const rect = element?.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
              box = { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
            }
          } catch {
            // Seletores de shadow DOM e frames continuam úteis no relatório, mesmo sem bounding box.
          }
          return { ...node, target, ...(box ? { box } : {}) };
        }),
      }));
    });
    return axeViolationsToIssues(violations, page.url() || targetUrl);
  } catch (error) {
    return [{
      ruleId: "accessibility.audit-failed",
      category: "accessibility",
      severity: "warning",
      title: "Auditoria automática de acessibilidade indisponível",
      impact: "A página foi analisada, mas algumas barreiras de acessibilidade podem não ter sido identificadas.",
      recommendation: "Verifique scripts bloqueados pela página e repita a análise; complemente com avaliação manual.",
      message: cleanMessage(error instanceof Error ? error.message : String(error)),
      method: undefined,
      status: undefined,
      url: page.url() || targetUrl,
      resourceType: "document",
      source: "axe-core",
      occurrences: 1,
    }];
  }
}
