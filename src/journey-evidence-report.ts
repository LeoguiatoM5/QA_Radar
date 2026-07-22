import type { JourneyRunResult } from "./journey-runner.js";

export const JOURNEY_TEST_TYPES = ["functional", "smoke", "regression", "acceptance", "exploratory"] as const;
export type JourneyTestType = (typeof JOURNEY_TEST_TYPES)[number];

export interface JourneyEvidenceMetadata {
  testerName: string;
  testType: JourneyTestType;
}

const TEST_TYPE_LABELS: Record<JourneyTestType, string> = {
  functional: "Funcional",
  smoke: "Smoke",
  regression: "Regressão",
  acceptance: "Aceitação",
  exploratory: "Exploratório",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`${field} deve ser preenchido com até ${max} caracteres.`);
  }
  return value.trim();
}

export function parseJourneyEvidenceMetadata(value: unknown): JourneyEvidenceMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Informe os dados do relatório.");
  const record = value as Record<string, unknown>;
  const unexpected = Object.keys(record).find((key) => !["testerName", "testType"].includes(key));
  if (unexpected) throw new Error(`Campo desconhecido no relatório: ${unexpected}.`);
  const testerName = text(record.testerName, "Nome do responsável", 100);
  const testType = text(record.testType, "Tipo de teste", 30);
  if (!JOURNEY_TEST_TYPES.includes(testType as JourneyTestType)) throw new Error("Selecione um tipo de teste válido.");
  return { testerName, testType: testType as JourneyTestType };
}

function evidence(step: JourneyRunResult["steps"][number]): string {
  if (!step.evidence) return '<p class="empty">Nenhuma imagem foi gerada para este passo.</p>';
  const before = encodeURIComponent(step.evidence.before);
  const after = encodeURIComponent(step.evidence.after);
  return `<div class="evidence"><figure><figcaption>Antes</figcaption><a href="./${before}" target="_blank"><img src="./${before}" alt="Evidência antes do passo ${step.index + 1}"></a></figure><figure><figcaption>Depois</figcaption><a href="./${after}" target="_blank"><img src="./${after}" alt="Evidência depois do passo ${step.index + 1}"></a></figure></div>`;
}

export function createJourneyEvidenceHtml(
  report: JourneyRunResult,
  metadata: JourneyEvidenceMetadata,
  generatedAt = new Date(),
): string {
  const steps = report.steps.map((step) => `<article class="step ${step.status}">
    <header><span>Passo ${step.index + 1}</span><strong>${step.status === "passed" ? "Aprovado" : "Falhou"}</strong></header>
    <h2>${escapeHtml(step.description ?? step.action)}</h2>
    <p class="technical">Ação: <code>${escapeHtml(step.action)}</code> · ${step.durationMs} ms</p>
    ${step.error ? `<p class="error">${escapeHtml(step.error)}</p>` : ""}
    ${evidence(step)}
  </article>`).join("\n");
  const passed = report.status === "passed";
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evidências — ${escapeHtml(report.name)}</title><style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#07101d;color:#e7eef8}*{box-sizing:border-box}body{margin:0;padding:32px;background:#07101d}.shell{max-width:1100px;margin:auto}.head,.step{background:#0e1a2b;border:1px solid #263953;border-radius:16px;padding:22px;margin-bottom:18px}.brand{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:.12em;margin-bottom:22px}.radar{width:30px;height:30px;border:2px solid #67e8f9;border-radius:50%;position:relative;box-shadow:0 0 18px #67e8f955}.radar:before{content:"";position:absolute;inset:7px;border:1px solid #67e8f999;border-radius:50%}.radar:after{content:"";position:absolute;width:5px;height:5px;left:11px;top:11px;border-radius:50%;background:#67e8f9}.eyebrow{color:#67e8f9;text-transform:uppercase;letter-spacing:.15em;font-size:12px;font-weight:800}h1{margin:8px 0 18px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.meta div{background:#07101d;border-radius:10px;padding:12px}.meta small{display:block;color:#91a4bd}.status{color:${passed ? "#6ee7b7" : "#fca5a5"};font-weight:900}.step header{display:flex;justify-content:space-between;color:#91a4bd}.step header strong{color:#6ee7b7}.step.failed header strong,.error{color:#fca5a5}.step h2{font-size:20px;margin:14px 0 6px}.technical{color:#91a4bd}.evidence{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}figure{margin:0}figcaption{margin-bottom:7px;color:#67e8f9;font-weight:700}img{width:100%;max-height:620px;object-fit:contain;object-position:top;background:#050b14;border:1px solid #263953;border-radius:10px}.empty{color:#91a4bd}@media(max-width:760px){body{padding:14px}.meta,.evidence{grid-template-columns:1fr}}
</style></head><body><main class="shell"><section class="head"><div class="brand"><i class="radar"></i>QA RADAR</div><div class="eyebrow">Relatório de evidências</div><h1>${escapeHtml(report.name)}</h1><div class="meta"><div><small>Responsável</small>${escapeHtml(metadata.testerName)}</div><div><small>Tipo de teste</small>${TEST_TYPE_LABELS[metadata.testType]}</div><div><small>Resultado</small><span class="status">${passed ? "APROVADA" : "REPROVADA"}</span></div><div><small>Gerado em</small>${escapeHtml(generatedAt.toLocaleString("pt-BR"))}</div></div></section>${steps}</main></body></html>`;
}
