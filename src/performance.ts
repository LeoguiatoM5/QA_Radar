import type { IssueInput, PerformanceMetrics } from "./types.js";

interface Threshold {
  good: number;
  poor: number;
}

const THRESHOLDS: Record<"ttfbMs" | "lcpMs" | "cls", Threshold> = {
  ttfbMs: { good: 800, poor: 1_800 },
  lcpMs: { good: 2_500, poor: 4_000 },
  cls: { good: 0.1, poor: 0.25 },
};

function rating(value: number, threshold: Threshold): "needs-improvement" | "poor" {
  return value > threshold.poor ? "poor" : "needs-improvement";
}

function metricIssue(
  ruleId: string,
  title: string,
  metric: string,
  value: number,
  threshold: Threshold,
  url: string,
  impact: string,
  recommendation: string,
): IssueInput {
  const unit = metric === "CLS" ? "" : " ms";
  return {
    ruleId,
    category: "performance",
    severity: "warning",
    title,
    impact,
    recommendation,
    message: `${metric} ${value}${unit}; classificação ${rating(value, threshold)}; limite recomendado ${threshold.good}${unit}.`,
    method: "GET",
    status: undefined,
    url,
    resourceType: "document",
    source: undefined,
    occurrences: 1,
  };
}

export function performanceIssues(metrics: PerformanceMetrics, url: string): IssueInput[] {
  const issues: IssueInput[] = [];
  if (metrics.ttfbMs !== undefined && metrics.ttfbMs > THRESHOLDS.ttfbMs.good) {
    issues.push(metricIssue(
      "performance.ttfb.slow",
      "Servidor demorou para iniciar a resposta",
      "TTFB",
      metrics.ttfbMs,
      THRESHOLDS.ttfbMs,
      url,
      "O usuário espera mais antes que o navegador possa começar a montar a página.",
      "Revise redirects, cache, CDN, conexão com dependências e tempo de processamento do backend.",
    ));
  }
  if (metrics.lcpMs !== undefined && metrics.lcpMs > THRESHOLDS.lcpMs.good) {
    issues.push(metricIssue(
      "performance.lcp.slow",
      "Conteúdo principal demorou para aparecer",
      "LCP",
      metrics.lcpMs,
      THRESHOLDS.lcpMs,
      url,
      "A página pode parecer lenta mesmo depois de começar a carregar.",
      "Priorize o recurso principal, reduza bloqueios de renderização e otimize imagens e fontes acima da dobra.",
    ));
  }
  if (metrics.cls !== undefined && metrics.cls > THRESHOLDS.cls.good) {
    issues.push(metricIssue(
      "performance.cls.unstable",
      "Layout mudou de posição durante o carregamento",
      "CLS",
      metrics.cls,
      THRESHOLDS.cls,
      url,
      "Elementos podem se mover quando o usuário tenta ler ou interagir com a página.",
      "Reserve espaço para imagens, anúncios e embeds; evite inserir conteúdo acima do que já foi renderizado.",
    ));
  }
  return issues;
}
