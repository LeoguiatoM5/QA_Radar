import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Issue, ScanOptions, ScanReport } from "./types.js";

const colors = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  cyan: "\u001b[36m",
};

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function paint(text: string, color: keyof typeof colors): string {
  return supportsColor() ? `${colors[color]}${text}${colors.reset}` : text;
}

function categoryLabel(category: Issue["category"]): string {
  return {
    console: "Navegador",
    javascript: "JavaScript",
    http: "Carregamento",
    network: "Rede",
    navigation: "Navegação",
    performance: "Performance",
    "best-practices": "Boas práticas",
    seo: "SEO",
    element: "Elemento da página",
    accessibility: "Acessibilidade",
  }[category];
}

export function resourceTypeLabel(resourceType: string | undefined): string {
  if (!resourceType) return "Página ou requisição de rede";
  return {
    document: "Página principal",
    fetch: "Chamada da aplicação",
    xhr: "Chamada da aplicação (XHR)",
    script: "JavaScript",
    stylesheet: "Folha de estilos",
    image: "Imagem",
    font: "Fonte",
    media: "Áudio ou vídeo",
    websocket: "WebSocket",
  }[resourceType] ?? resourceType;
}

function issueLine(issue: Issue): string {
  const details = [issue.method, issue.status, issue.resourceType ? resourceTypeLabel(issue.resourceType) : undefined].filter(Boolean).join(" · ");
  const occurrence = issue.occurrences > 1 ? ` (${issue.occurrences}x)` : "";
  return `${issue.title ?? issue.message}${occurrence}${details ? ` [${details}]` : ""}` +
    `${issue.impact ? `\n    Impacto: ${issue.impact}` : ""}` +
    `${issue.recommendation ? `\n    Ação: ${issue.recommendation}` : ""}` +
    `${issue.url ? `\n    URL: ${issue.url}` : ""}` +
    `${issue.referenceUrl ? `\n    Referência: ${issue.referenceUrl}` : ""}` +
    `\n    Técnico: ${issue.message}`;
}

export function printConsoleReport(report: ScanReport): void {
  const status = report.passed ? paint("APROVADO", "green") : paint("REPROVADO", "red");
  console.log(`\n${paint("QA RADAR", "bold")}  ${status}`);
  console.log(`Alvo:       ${report.targetUrl}`);
  if (report.finalUrl !== report.targetUrl) console.log(`URL final:  ${report.finalUrl}`);
  console.log(`Página:     ${report.title || "(sem título)"}`);
  console.log(`HTTP:       ${report.mainStatus ?? "N/A"}`);
  console.log(`Navegador:  ${report.browser}`);
  console.log(`Duração:    ${report.durationMs} ms`);
  if (report.pages) console.log(`Cobertura:  ${report.pages.length} página(s)`);
  if (report.performance) {
    const metric = (value: number | undefined, suffix: string): string => value === undefined ? "N/A" : `${value}${suffix}`;
    console.log(
      `Performance: TTFB ${metric(report.performance.ttfbMs, " ms")} · ` +
        `FCP ${metric(report.performance.fcpMs, " ms")} · ` +
        `LCP ${metric(report.performance.lcpMs, " ms")} · CLS ${metric(report.performance.cls, "")}`,
    );
  }
  if (report.lighthouse) {
    const score = (value: number | undefined) => value === undefined ? "N/A" : Math.round(value * 100);
    console.log(`Lighthouse: Performance ${score(report.lighthouse.performance)} · Boas práticas ${score(report.lighthouse.bestPractices)} · SEO ${score(report.lighthouse.seo)}`);
  }
  if (report.scanStatus === "partial") console.log(`Execução:   ${paint("PARCIAL", "yellow")} · DOM indisponível ou navegação instável`);
  console.log(
    `Resultado:  ${paint(`${report.summary.errors} erro(s)`, report.summary.errors ? "red" : "green")}, ` +
      `${paint(`${report.summary.warnings} aviso(s)`, report.summary.warnings ? "yellow" : "green")}`,
  );
  if (report.comparison) {
    console.log(
      `Comparação: ${paint(`${report.comparison.newIssues} novo(s)`, report.comparison.newIssues ? "yellow" : "green")}, ` +
        `${report.comparison.existingIssues} existente(s), ` +
        `${paint(`${report.comparison.resolvedIssues.length} resolvido(s)`, "green")}`,
    );
    if (report.gateScope === "regressions") console.log("Quality gate: somente problemas novos");
  }

  if (report.issues.length > 0) {
    console.log("");
    report.issues.forEach((issue, index) => {
      const label = issue.severity === "error" ? paint("ERRO", "red") : paint("AVISO", "yellow");
      const baseline = issue.baselineStatus === "new" ? " · NOVO" : issue.baselineStatus === "existing" ? " · EXISTENTE" : "";
      console.log(`${index + 1}. ${label}${baseline} · ${categoryLabel(issue.category)} · ${issueLine(issue)}`);
    });
  }
  if (report.screenshotPath) console.log(`\nScreenshot: ${report.screenshotPath}`);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function issueFailsGate(issue: Issue, report: ScanReport): boolean {
  if (report.failOn === "none") return false;
  if (report.gateScope === "regressions" && issue.baselineStatus !== "new") return false;
  return report.failOn === "warning" || issue.severity === "error";
}

function escapeWorkflowCommand(value: unknown, property = false): string {
  const escaped = String(value ?? "")
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  return property ? escaped.replaceAll(":", "%3A").replaceAll(",", "%2C") : escaped;
}

export function createGitHubAnnotations(report: ScanReport): string[] {
  return report.issues
    .filter((issue) => report.gateScope !== "regressions" || issue.baselineStatus === "new")
    .map((issue) => {
      const level = issue.severity === "error" ? "error" : "warning";
      const title = escapeWorkflowCommand(`QA Radar · ${issue.ruleId}`, true);
      const message = escapeWorkflowCommand([
        issue.title ?? issue.message,
        issue.impact,
        issue.url,
      ].filter(Boolean).join(" — "));
      return `::${level} title=${title}::${message}`;
    });
}

export function createJunitReport(report: ScanReport): string {
  const failures = report.issues.filter((issue) => issueFailsGate(issue, report)).length;
  const testCases = report.issues.length > 0
    ? report.issues.map((issue) => {
      const name = `${issue.ruleId}: ${issue.title ?? issue.message}`;
      const detail = [issue.message, issue.url].filter(Boolean).join("\n");
      const outcome = issueFailsGate(issue, report)
        ? `<failure message="${escapeXml(issue.title ?? issue.message)}" type="${escapeXml(issue.ruleId)}">${escapeXml(detail)}</failure>`
        : `<system-out>${escapeXml(`${issue.baselineStatus ?? "observed"}: ${detail}`)}</system-out>`;
      return `  <testcase classname="qa-radar.${escapeXml(issue.category)}" name="${escapeXml(name)}">${outcome}</testcase>`;
    }).join("\n")
    : "  <testcase classname=\"qa-radar\" name=\"scan completed\"/>";
  const tests = Math.max(report.issues.length, 1);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="QA Radar" tests="${tests}" failures="${failures}" errors="0" time="${(report.durationMs / 1000).toFixed(3)}" timestamp="${escapeXml(report.startedAt)}">\n${testCases}\n</testsuite>\n`;
}

export function createSarifReport(report: ScanReport): string {
  const rules = [...new Map(report.issues.map((issue) => [issue.ruleId, {
    id: issue.ruleId,
    name: issue.ruleId.replaceAll(".", "_"),
    shortDescription: { text: issue.title ?? issue.message },
    help: { text: issue.recommendation ?? "Consulte o relatório do QA Radar para investigar a ocorrência." },
    ...(issue.referenceUrl ? { helpUri: issue.referenceUrl } : {}),
    properties: { category: issue.category },
  }])).values()];
  const results = report.issues.map((issue) => ({
    ruleId: issue.ruleId,
    level: issue.severity === "error" ? "error" : "warning",
    message: { text: [issue.title, issue.impact, issue.message].filter(Boolean).join(" — ") },
    ...(issue.baselineStatus ? { baselineState: issue.baselineStatus === "new" ? "new" : "unchanged" } : {}),
    partialFingerprints: { qaRadarFingerprint: issue.fingerprint },
    ...(issue.url ? { locations: [{ physicalLocation: { artifactLocation: { uri: issue.url } } }] } : {}),
    properties: {
      category: issue.category,
      severity: issue.severity,
      gateFailure: issueFailsGate(issue, report),
      ...(issue.status ? { httpStatus: issue.status } : {}),
    },
  }));
  return `${JSON.stringify({
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: report.tool, version: report.version, informationUri: "https://github.com/", rules } },
      automationDetails: { id: [report.project, report.environment, report.browser].filter(Boolean).join("/") || report.browser },
      results,
      properties: { scanStatus: report.scanStatus, passed: report.passed, targetUrl: report.targetUrl },
    }],
  }, null, 2)}\n`;
}

export function createHtmlReport(report: ScanReport): string {
  const rows = report.issues
    .map(
      (issue) => `<tr>
        <td><span class="badge ${issue.severity}">${issue.severity === "error" ? "Erro" : "Aviso"}</span>${issue.baselineStatus ? `<small>${issue.baselineStatus === "new" ? "Novo" : "Existente"}</small>` : ""}</td>
        <td>${escapeHtml(categoryLabel(issue.category))}</td>
        <td><strong>${escapeHtml(issue.title ?? issue.message)}</strong>${issue.occurrences > 1 ? ` <small>${issue.occurrences}x</small>` : ""}${issue.impact ? `<p>${escapeHtml(issue.impact)}</p>` : ""}${issue.recommendation ? `<p class="action"><b>Como corrigir:</b> ${escapeHtml(issue.recommendation)}</p>` : ""}${issue.referenceUrl ? `<p><a href="${escapeHtml(issue.referenceUrl)}" target="_blank" rel="noreferrer">Referência oficial</a></p>` : ""}<code>${escapeHtml(issue.url)}</code><details><summary>Detalhe técnico</summary><pre>${escapeHtml(issue.message)}</pre></details></td>
        <td>${escapeHtml(issue.status ?? "—")}</td>
        <td>${escapeHtml(resourceTypeLabel(issue.resourceType))}</td>
        <td>${issue.evidence ? `<span class="evidence">${escapeHtml(issue.evidence.label)}</span><code>${escapeHtml(issue.evidence.selector)}</code><small>${escapeHtml(issue.evidence.element)}</small>` : `<span class="muted">${escapeHtml(issue.resourceType === "document" ? "Página principal" : "Sem elemento DOM associado")}</span>`}</td>
      </tr>`,
    )
    .join("\n");
  const screenshot = report.screenshotPath
    ? `<section><h2>Evidência visual anotada</h2><p class="muted">Os marcadores numerados conectam os elementos destacados às ocorrências da tabela.</p><img src="${escapeHtml(basename(report.screenshotPath))}" alt="Screenshot anotado da página analisada"></section>`
    : "";
  const comparison = report.comparison
    ? `<section><h2>Comparação com baseline</h2><div class="grid"><div class="card"><span class="muted">Novos</span><div class="number">${report.comparison.newIssues}</div></div><div class="card"><span class="muted">Existentes</span><div class="number">${report.comparison.existingIssues}</div></div><div class="card"><span class="muted">Resolvidos</span><div class="number">${report.comparison.resolvedIssues.length}</div></div></div><p class="muted">${report.comparison.baselineStartedAt ? `Baseline de ${escapeHtml(report.comparison.baselineStartedAt)}` : "Primeira execução: nenhum baseline anterior"}${report.gateScope === "regressions" ? " · Gate aplicado somente aos problemas novos" : ""}</p></section>`
    : "";
  const performance = report.performance
    ? `<section><h2>Performance de laboratório</h2><div class="grid"><div class="card"><span class="muted">TTFB</span><div class="number">${escapeHtml(report.performance.ttfbMs ?? "N/A")}<small> ms</small></div></div><div class="card"><span class="muted">FCP</span><div class="number">${escapeHtml(report.performance.fcpMs ?? "N/A")}<small> ms</small></div></div><div class="card"><span class="muted">LCP</span><div class="number">${escapeHtml(report.performance.lcpMs ?? "N/A")}<small> ms</small></div></div><div class="card"><span class="muted">CLS</span><div class="number">${escapeHtml(report.performance.cls ?? "N/A")}</div></div></div><p class="muted">DOMContentLoaded: ${escapeHtml(report.performance.domContentLoadedMs ?? "N/A")} ms · Load: ${escapeHtml(report.performance.loadMs ?? "N/A")} ms</p></section>`
    : "";
  const lighthouse = report.lighthouse
    ? `<section><h2>Lighthouse</h2><div class="grid"><div class="card"><span class="muted">Performance</span><div class="number">${escapeHtml(report.lighthouse.performance === undefined ? "N/A" : Math.round(report.lighthouse.performance * 100))}</div></div><div class="card"><span class="muted">Boas práticas</span><div class="number">${escapeHtml(report.lighthouse.bestPractices === undefined ? "N/A" : Math.round(report.lighthouse.bestPractices * 100))}</div></div><div class="card"><span class="muted">SEO</span><div class="number">${escapeHtml(report.lighthouse.seo === undefined ? "N/A" : Math.round(report.lighthouse.seo * 100))}</div></div></div><a href="${escapeHtml(report.lighthouse.reportPath)}">Abrir relatório Lighthouse bruto</a></section>`
    : "";
  const coverage = report.pages
    ? `<section><h2>Cobertura do sitemap</h2><table><thead><tr><th>Página</th><th>HTTP</th><th>Estado</th><th>Erros</th><th>Avisos</th><th>Tempo</th></tr></thead><tbody>${report.pages.map((page) => `<tr><td><a href="pages/${escapeHtml(basename(page.outputDir))}/report.html">${escapeHtml(page.title || page.url)}</a><code>${escapeHtml(page.url)}</code></td><td>${escapeHtml(page.mainStatus ?? "N/A")}</td><td>${page.scanStatus === "completed" ? "Completa" : "Parcial"}</td><td>${page.summary.errors}</td><td>${page.summary.warnings}</td><td>${page.durationMs} ms</td></tr>`).join("")}</tbody></table></section>`
    : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Radar · ${escapeHtml(report.title || report.targetUrl)}</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#08111f;color:#e5edf7}body{max-width:1200px;margin:auto;padding:48px 24px}header{display:flex;justify-content:space-between;gap:24px;align-items:start}.brand{color:#67e8f9;letter-spacing:.16em;font-size:.8rem}.status{padding:10px 16px;border-radius:999px;font-weight:800}.pass{background:#064e3b;color:#6ee7b7}.fail{background:#7f1d1d;color:#fecaca}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin:32px 0}.card,section{background:#111d2e;border:1px solid #26364d;border-radius:16px;padding:20px}.number{font-size:2rem;font-weight:800;margin-top:8px}.muted,small{color:#94a3b8}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:14px 10px;border-bottom:1px solid #26364d;vertical-align:top}td p{color:#c5d2e3;line-height:1.45;margin:7px 0;font-size:.86rem}.action{background:#0c2c38;border-left:3px solid #22d3ee;padding:8px 10px;color:#c5f5fb}code{display:block;color:#93c5fd;word-break:break-all;margin-top:7px;font-size:.75rem}.badge{font-size:.72rem;text-transform:uppercase;font-weight:800;padding:5px 8px;border-radius:6px}.error{background:#7f1d1d;color:#fecaca}.warning{background:#713f12;color:#fde68a}.evidence{display:inline-block;background:#164e63;color:#a5f3fc;border:1px solid #22d3ee66;padding:4px 7px;border-radius:6px;font-size:.7rem;font-weight:800;margin-bottom:3px}details{margin-top:8px}details summary{cursor:pointer;color:#94a3b8;font-size:.75rem}pre{white-space:pre-wrap;word-break:break-word;background:#08111f;padding:8px;border-radius:6px;font-size:.72rem}img{width:100%;border-radius:10px;margin-top:10px;border:1px solid #334155}a{color:#67e8f9}@media(max-width:700px){header{display:block}table{font-size:.85rem}}
</style></head><body>
<header><div><div class="brand">QA RADAR ${escapeHtml(report.version)}</div><h1>${escapeHtml(report.title || "Relatório de qualidade")}</h1><a href="${escapeHtml(report.finalUrl)}">${escapeHtml(report.finalUrl)}</a></div><span class="status ${report.passed ? "pass" : "fail"}">${report.passed ? "APROVADO" : "REPROVADO"}</span></header>
<div class="grid"><div class="card"><span class="muted">Erros</span><div class="number">${report.summary.errors}</div></div><div class="card"><span class="muted">Avisos</span><div class="number">${report.summary.warnings}</div></div><div class="card"><span class="muted">HTTP principal</span><div class="number">${escapeHtml(report.mainStatus ?? "N/A")}</div></div><div class="card"><span class="muted">Duração</span><div class="number">${report.durationMs}<small> ms</small></div></div></div>
${comparison}
${performance}
${lighthouse}
${coverage}
<section><h2>Ocorrências</h2>${rows ? `<table><thead><tr><th>Nível</th><th>Categoria</th><th>Detalhe</th><th>HTTP</th><th>Recurso</th><th>Apontamento</th></tr></thead><tbody>${rows}</tbody></table>` : "<p>Nenhum problema encontrado.</p>"}</section>
${screenshot}<p class="muted">Executado em ${escapeHtml(report.startedAt)} · ${escapeHtml(report.browser)} · Estado: ${report.scanStatus === "partial" ? "parcial" : "completo"} · Quality gate: ${escapeHtml(report.failOn)}</p>
</body></html>`;
}

export async function writeReports(report: ScanReport, options: ScanOptions): Promise<string[]> {
  const paths: string[] = [];
  const needsJson = options.format === "json" || options.format === "all";
  const needsHtml = options.format === "html" || options.format === "all";
  const needsJunit = options.format === "junit" || options.format === "all";
  const needsSarif = options.format === "sarif" || options.format === "all";
  if (!needsJson && !needsHtml && !needsJunit && !needsSarif) return paths;

  await mkdir(options.outputDir, { recursive: true });
  if (needsJson) {
    const path = join(options.outputDir, "report.json");
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    paths.push(path);
  }
  if (needsHtml) {
    const path = join(options.outputDir, "report.html");
    await writeFile(path, createHtmlReport(report), "utf8");
    paths.push(path);
  }
  if (needsJunit) {
    const path = join(options.outputDir, "report.junit.xml");
    await writeFile(path, createJunitReport(report), "utf8");
    paths.push(path);
  }
  if (needsSarif) {
    const path = join(options.outputDir, "report.sarif.json");
    await writeFile(path, createSarifReport(report), "utf8");
    paths.push(path);
  }
  return paths;
}
