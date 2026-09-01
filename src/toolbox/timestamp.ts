/**
 * Conversão de timestamp.
 *
 * O problema real não é converter — é descobrir **o que** foi colado. Um número
 * de 10 dígitos é segundo, de 13 é milissegundo, e confundir os dois é a origem
 * de metade dos bugs de data que um QA investiga. Aqui a interpretação escolhida
 * é sempre dita em voz alta.
 */

export type TimestampSource = "epoch-seconds" | "epoch-milliseconds" | "epoch-microseconds" | "iso" | "now";

export interface TimestampReading {
  epochMs: number;
  source: TimestampSource;
  /** Avisos sobre a leitura — ambiguidade, precisão perdida, data implausível. */
  warnings: string[];
}

export const TIMESTAMP_SOURCE_LABELS: Record<TimestampSource, string> = {
  "epoch-seconds": "Epoch em segundos",
  "epoch-milliseconds": "Epoch em milissegundos",
  "epoch-microseconds": "Epoch em microssegundos",
  iso: "Data ISO 8601",
  now: "Agora",
};

/** Fora desta janela a leitura quase certamente está na unidade errada. */
const PLAUSIBLE_FROM = Date.UTC(1990, 0, 1);
const PLAUSIBLE_TO = Date.UTC(2100, 0, 1);

function plausibilityWarning(epochMs: number, source: TimestampSource): string[] {
  if (source === "iso" || source === "now") return [];
  if (epochMs >= PLAUSIBLE_FROM && epochMs <= PLAUSIBLE_TO) return [];
  return [`O resultado cai fora da faixa de 1990 a 2100; confira se a unidade é mesmo ${TIMESTAMP_SOURCE_LABELS[source].toLowerCase()}.`];
}

/**
 * Interpreta o que foi colado.
 *
 * A regra é a quantidade de dígitos, que é o que qualquer pessoa usa de cabeça:
 * até 11 é segundo, 12 a 14 é milissegundo, acima disso é microssegundo.
 */
export function parseTimestampInput(text: string, now: number = Date.now()): TimestampReading {
  const trimmed = text.trim();
  if (!trimmed || trimmed.toLowerCase() === "now" || trimmed.toLowerCase() === "agora") {
    return { epochMs: now, source: "now", warnings: [] };
  }

  const numeric = /^-?\d+(\.\d+)?$/.test(trimmed);
  if (numeric) {
    const digits = trimmed.replace(/^-|\..*$/g, "").length;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) throw new Error("Número fora do alcance suportado.");
    let source: TimestampSource = "epoch-seconds";
    let epochMs = value * 1000;
    if (digits >= 15) {
      source = "epoch-microseconds";
      epochMs = value / 1000;
    } else if (digits >= 12) {
      source = "epoch-milliseconds";
      epochMs = value;
    }
    const warnings = plausibilityWarning(epochMs, source);
    if (trimmed.includes(".") && source === "epoch-seconds") warnings.push("A parte decimal foi mantida como fração de segundo.");
    return { epochMs: Math.round(epochMs), source, warnings };
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) throw new Error("Não reconheci o valor: use epoch (segundos ou milissegundos) ou uma data ISO 8601.");
  // Sem fuso explícito, o JavaScript lê como hora local — e o mesmo texto vira
  // instantes diferentes em máquinas diferentes. É o tipo de detalhe que faz um
  // teste passar na sua máquina e falhar no CI.
  const warnings = /(?:Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? [] : ["A data não declara fuso: foi lida no fuso local desta máquina."];
  return { epochMs: parsed, source: "iso", warnings };
}

export interface TimestampBreakdown {
  epochSeconds: number;
  epochMilliseconds: number;
  iso: string;
  utc: string;
  local: string;
  /** Nome do fuso do navegador/processo, quando disponível. */
  timeZone: string;
  weekday: string;
  relative: string;
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];

function relativeTo(epochMs: number, now: number, locale: string): string {
  const difference = epochMs - now;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(difference) >= size) return formatter.format(Math.round(difference / size), unit);
  }
  return formatter.format(0, "second");
}

export function describeTimestamp(epochMs: number, now: number = Date.now(), locale = "pt-BR"): TimestampBreakdown {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) throw new Error("O valor não corresponde a uma data válida.");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return {
    epochSeconds: Math.floor(epochMs / 1000),
    epochMilliseconds: epochMs,
    iso: date.toISOString(),
    utc: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "medium", timeZone: "UTC" }).format(date),
    local: new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "medium" }).format(date),
    timeZone,
    weekday: new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date),
    relative: relativeTo(epochMs, now, locale),
  };
}
