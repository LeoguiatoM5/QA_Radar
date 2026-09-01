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
  // 2026-02-30 não dá NaN: o Date rola para 2026-03-02 em silêncio, e os casos
  // sairiam para uma faixa que ninguém pediu. Comparar a volta com o que foi
  // digitado é o que pega o dia que não existe naquele mês.
  if (isoDate(parsed) !== trimmed) throw new Error(`${label} não é uma data existente.`);
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
  /**
   * O valor comparável com a faixa: o número, o comprimento do texto ou o
   * timestamp. É por ele — e não pela posição de origem — que a validade é
   * decidida.
   */
  measure: number;
}

interface BoundaryRange {
  minimum: number;
  maximum: number;
  points: BoundaryPoint[];
}

function numericPoints(minimum: number, maximum: number, step: number, format: (value: number) => string): BoundaryPoint[] {
  const at = (value: number, position: BoundaryPosition): BoundaryPoint => {
    const text = format(value);
    return { position, input: text, display: text, measure: value };
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
    return { position, input: "a".repeat(length), display: `${length} caractere(s)`, measure: length };
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
    return { position, input: text, display: text, measure: timestamp };
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

function rangeFor(spec: BoundarySpec): BoundaryRange {
  if (spec.type === "integer") {
    const minimum = requireInteger(spec.minimum, "Mínimo");
    const maximum = requireInteger(spec.maximum, "Máximo");
    if (minimum > maximum) throw new Error("O mínimo não pode ser maior que o máximo.");
    return { minimum, maximum, points: numericPoints(minimum, maximum, 1, (value) => String(value)) };
  }
  if (spec.type === "decimal") {
    const minimum = requireFiniteNumber(spec.minimum, "Mínimo");
    const maximum = requireFiniteNumber(spec.maximum, "Máximo");
    if (minimum > maximum) throw new Error("O mínimo não pode ser maior que o máximo.");
    const step = spec.step ?? 0.01;
    if (!Number.isFinite(step) || step <= 0) throw new Error("O passo deve ser um número maior que zero.");
    return { minimum, maximum, points: numericPoints(minimum, maximum, step, (value) => String(roundToStep(value, step))) };
  }
  if (spec.type === "string-length") {
    const minimum = requireInteger(spec.minimum, "Tamanho mínimo");
    const maximum = requireInteger(spec.maximum, "Tamanho máximo");
    if (minimum < 0) throw new Error("O tamanho mínimo não pode ser negativo.");
    if (minimum > maximum) throw new Error("O tamanho mínimo não pode ser maior que o máximo.");
    return { minimum, maximum, points: stringLengthPoints(minimum, maximum) };
  }
  const minimum = requireDate(spec.minimum, "Data mínima");
  const maximum = requireDate(spec.maximum, "Data máxima");
  if (minimum > maximum) throw new Error("A data mínima não pode ser posterior à máxima.");
  return { minimum, maximum, points: datePoints(minimum, maximum) };
}

/**
 * Onde o valor realmente cai, ignorando de qual dos seis pontos ele veio.
 *
 * Numa faixa curta os pontos colidem: com 5..5, o "primeiro valor acima do
 * mínimo" é 6, que está **fora** da faixa. Confiar na posição de origem
 * marcaria esse 6 como válido e ensinaria o time a esperar que um campo 5..5
 * aceite 6 — exatamente o contrário do que a técnica existe para descobrir.
 */
function positionOf(measure: number, { minimum, maximum }: BoundaryRange, fallback: BoundaryPosition): BoundaryPosition {
  if (measure < minimum) return "below-minimum";
  if (measure > maximum) return "above-maximum";
  if (measure === minimum) return "minimum";
  if (measure === maximum) return "maximum";
  return fallback;
}

/**
 * Gera os casos clássicos, sem repetir valor.
 *
 * A ordem de apresentação continua sendo a da técnica (do abaixo do mínimo ao
 * acima do máximo), mas cada caso é rotulado e classificado pelo valor que
 * realmente carrega.
 */
export function generateBoundaryCases(spec: BoundarySpec): BoundaryCase[] {
  const field = spec.field.trim() || "campo";
  const range = rangeFor(spec);
  const byPosition = new Map<BoundaryPosition, BoundaryPoint>();
  const seen = new Set<string>();
  for (const point of range.points) {
    if (seen.has(point.input)) continue;
    const position = positionOf(point.measure, range, point.position);
    // Um valor só ocupa a posição que ainda estiver livre: com 1..2, o 2 chega
    // como "acima do mínimo" e é reclassificado para "máximo", que é o rótulo
    // correto e ainda não foi preenchido.
    if (byPosition.has(position)) continue;
    byPosition.set(position, point);
    seen.add(point.input);
  }
  const cases: BoundaryCase[] = [];
  for (const position of POSITION_ORDER) {
    const point = byPosition.get(position);
    if (!point) continue;
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
