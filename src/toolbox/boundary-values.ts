/**
 * Análise de valor limite (Boundary Value Analysis).
 *
 * A técnica é sempre a mesma — mínimo e máximo, e o vizinho de cada lado — mas o
 * que é "o vizinho" muda com o tipo: 1 para inteiro, o passo para decimal, um
 * caractere para texto e um dia para data. É essa a única diferença entre os
 * tipos, e por isso ela vive num único lugar (`pointsFor`).
 */

export type BoundaryFieldType = "integer" | "decimal" | "string-length" | "date";

export interface BoundarySpec {
  /** Nome do campo, usado no título dos casos gerados. */
  field: string;
  type: BoundaryFieldType;
  minimum: string;
  maximum: string;
  /** Só para `decimal`: menor incremento aceito pelo campo. Padrão 0.01. */
  step?: number;
}

/** Posição do valor em relação à faixa aceita. */
export type BoundaryPosition = "below-minimum" | "minimum" | "above-minimum" | "below-maximum" | "maximum" | "above-maximum";

export interface BoundaryCase {
  /** Identificador sequencial estável: TC001, TC002... */
  id: string;
  title: string;
  /** Valor exatamente como deve ser digitado no campo. */
  input: string;
  /** Como o valor é mostrado na tabela (texto longo vira "21 caracteres"). */
  display: string;
  valid: boolean;
  position: BoundaryPosition;
}

export const BOUNDARY_FIELD_LABELS: Record<BoundaryFieldType, string> = {
  integer: "Número inteiro",
  decimal: "Número decimal",
  "string-length": "Tamanho de texto",
  date: "Data",
};

const POSITION_TITLES: Record<BoundaryPosition, string> = {
  "below-minimum": "Validar valor abaixo do mínimo",
  minimum: "Validar o limite mínimo",
  "above-minimum": "Validar o primeiro valor acima do mínimo",
  "below-maximum": "Validar o último valor antes do máximo",
  maximum: "Validar o limite máximo",
  "above-maximum": "Validar valor acima do máximo",
};

const POSITION_ORDER: readonly BoundaryPosition[] = ["below-minimum", "minimum", "above-minimum", "below-maximum", "maximum", "above-maximum"];

const VALID_POSITIONS = new Set<BoundaryPosition>(["minimum", "above-minimum", "below-maximum", "maximum"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function requireFiniteNumber(value: string, label: string): number {
  const parsed = Number(value.trim().replace(",", "."));
  if (value.trim() === "" || !Number.isFinite(parsed)) throw new Error(`${label} deve ser um número.`);
  return parsed;
}

function requireInteger(value: string, label: string): number {
  const parsed = requireFiniteNumber(value, label);
  if (!Number.isInteger(parsed)) throw new Error(`${label} deve ser um número inteiro.`);
  return parsed;
}

function requireDate(value: string, label: string): number {
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) throw new Error(`${label} deve estar no formato AAAA-MM-DD.`);
  const parsed = Date.parse(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed)) throw new Error(`${label} não é uma data existente.`);
  return parsed;
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Arredonda o resultado do passo decimal para não vazar 0.30000000000000004. */
function roundToStep(value: number, step: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(value.toFixed(Math.min(decimals, 12)));
}

interface BoundaryPoint {
  position: BoundaryPosition;
  input: string;
  display: string;
}

function numericPoints(minimum: number, maximum: number, step: number, format: (value: number) => string): BoundaryPoint[] {
  const at = (value: number, position: BoundaryPosition): BoundaryPoint => {
    const text = format(value);
    return { position, input: text, display: text };
  };
  return [
    at(roundToStep(minimum - step, step), "below-minimum"),
    at(minimum, "minimum"),
    at(roundToStep(minimum + step, step), "above-minimum"),
    at(roundToStep(maximum - step, step), "below-maximum"),
    at(maximum, "maximum"),
    at(roundToStep(maximum + step, step), "above-maximum"),
  ];
}

function stringLengthPoints(minimum: number, maximum: number): BoundaryPoint[] {
  const at = (length: number, position: BoundaryPosition): BoundaryPoint | undefined => {
    // Texto com tamanho negativo não existe: quando o mínimo é 0, o caso
    // "abaixo do mínimo" não é gerado em vez de virar um valor impossível.
    if (length < 0) return undefined;
    return { position, input: "a".repeat(length), display: `${length} caractere(s)` };
  };
  return [
    at(minimum - 1, "below-minimum"),
    at(minimum, "minimum"),
    at(minimum + 1, "above-minimum"),
    at(maximum - 1, "below-maximum"),
    at(maximum, "maximum"),
    at(maximum + 1, "above-maximum"),
  ].filter((point): point is BoundaryPoint => point !== undefined);
}

function datePoints(minimum: number, maximum: number): BoundaryPoint[] {
  const at = (timestamp: number, position: BoundaryPosition): BoundaryPoint => {
    const text = isoDate(timestamp);
    return { position, input: text, display: text };
  };
  return [
    at(minimum - DAY_MS, "below-minimum"),
    at(minimum, "minimum"),
    at(minimum + DAY_MS, "above-minimum"),
    at(maximum - DAY_MS, "below-maximum"),
    at(maximum, "maximum"),
    at(maximum + DAY_MS, "above-maximum"),
  ];
}

function pointsFor(spec: BoundarySpec): BoundaryPoint[] {
  if (spec.type === "integer") {
    const minimum = requireInteger(spec.minimum, "Mínimo");
    const maximum = requireInteger(spec.maximum, "Máximo");
    if (minimum > maximum) throw new Error("O mínimo não pode ser maior que o máximo.");
    return numericPoints(minimum, maximum, 1, (value) => String(value));
  }
  if (spec.type === "decimal") {
    const minimum = requireFiniteNumber(spec.minimum, "Mínimo");
    const maximum = requireFiniteNumber(spec.maximum, "Máximo");
    if (minimum > maximum) throw new Error("O mínimo não pode ser maior que o máximo.");
    const step = spec.step ?? 0.01;
    if (!Number.isFinite(step) || step <= 0) throw new Error("O passo deve ser um número maior que zero.");
    return numericPoints(minimum, maximum, step, (value) => String(roundToStep(value, step)));
  }
  if (spec.type === "string-length") {
    const minimum = requireInteger(spec.minimum, "Tamanho mínimo");
    const maximum = requireInteger(spec.maximum, "Tamanho máximo");
    if (minimum < 0) throw new Error("O tamanho mínimo não pode ser negativo.");
    if (minimum > maximum) throw new Error("O tamanho mínimo não pode ser maior que o máximo.");
    return stringLengthPoints(minimum, maximum);
  }
  const minimum = requireDate(spec.minimum, "Data mínima");
  const maximum = requireDate(spec.maximum, "Data máxima");
  if (minimum > maximum) throw new Error("A data mínima não pode ser posterior à máxima.");
  return datePoints(minimum, maximum);
}

/**
 * Gera os seis casos clássicos, sem repetição.
 *
 * Faixas curtas fazem os pontos colidirem (com 18..19, "acima do mínimo" e "o
 * máximo" são o mesmo valor). Repetir o caso só inflaria a suíte, então o
 * primeiro a aparecer — o mais próximo do mínimo — é o que fica.
 */
export function generateBoundaryCases(spec: BoundarySpec): BoundaryCase[] {
  const field = spec.field.trim() || "campo";
  const points = pointsFor(spec);
  const seen = new Set<string>();
  const cases: BoundaryCase[] = [];
  for (const position of POSITION_ORDER) {
    const point = points.find((candidate) => candidate.position === position);
    if (!point || seen.has(point.input)) continue;
    seen.add(point.input);
    cases.push({
      id: `TC${String(cases.length + 1).padStart(3, "0")}`,
      title: `${POSITION_TITLES[position]} de ${field}`,
      input: point.input,
      display: point.display,
      valid: VALID_POSITIONS.has(position),
      position,
    });
  }
  return cases;
}

/** Casos em texto, no formato que se cola direto num plano de teste. */
export function formatBoundaryCases(cases: readonly BoundaryCase[]): string {
  return cases.map((testCase) => `${testCase.id} - ${testCase.title}\nInput: ${testCase.display}\nExpected: ${testCase.valid ? "accepted" : "rejected"}`).join("\n\n");
}

/** Mesmos casos em CSV, para importar em planilha ou ferramenta de teste. */
export function boundaryCasesToCsv(cases: readonly BoundaryCase[]): string {
  const rows = cases.map((testCase) => [testCase.id, testCase.title, testCase.display, testCase.valid ? "accepted" : "rejected"].map(csvCell).join(","));
  return ["id,title,input,expected", ...rows].join("\n");
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
