/**
 * Geração de casos por combinação de pares (all-pairs).
 *
 * A premissa da técnica: a maioria esmagadora dos defeitos de combinação
 * aparece na interação de **dois** parâmetros, não de cinco. Cobrir todos os
 * pares custa uma fração do produto cartesiano e ainda pega essa classe de
 * defeito — 4 parâmetros de 3 valores são 81 combinações completas e ~9 casos
 * em all-pairs.
 *
 * O algoritmo é o IPOG para força 2: cresce na horizontal (escolhe, para cada
 * linha existente, o valor do novo parâmetro que cobre mais pares novos) e
 * depois na vertical (cria linhas para os pares que sobraram). É determinístico
 * de propósito: a mesma entrada precisa dar a mesma suíte, senão o QA não
 * consegue versionar o resultado.
 */

export interface PairwiseParameter {
  name: string;
  values: string[];
}

export type PairwiseRow = Record<string, string>;

export interface PairwiseResult {
  rows: PairwiseRow[];
  /** Quantas linhas o produto cartesiano teria. */
  exhaustive: number;
  /** Pares distintos que precisavam ser cobertos. */
  pairs: number;
  /** Percentual de redução em relação ao produto cartesiano. */
  reduction: number;
}

export const MAX_PAIRWISE_PARAMETERS = 12;
export const MAX_PAIRWISE_VALUES = 25;

/** Chave de um par: parâmetro i com o valor a, parâmetro j com o valor b. */
function pairKey(i: number, a: number, j: number, b: number): string {
  return `${i}:${a}|${j}:${b}`;
}

interface NormalizedParameter {
  name: string;
  values: string[];
}

function normalize(parameters: readonly PairwiseParameter[]): NormalizedParameter[] {
  const usable = parameters
    .map((parameter) => ({
      name: parameter.name.trim(),
      values: [...new Set(parameter.values.map((value) => value.trim()).filter((value) => value !== ""))],
    }))
    .filter((parameter) => parameter.name !== "" && parameter.values.length > 0);

  if (usable.length < 2) throw new Error("Informe ao menos dois parâmetros com valores.");
  if (usable.length > MAX_PAIRWISE_PARAMETERS) throw new Error(`No máximo ${MAX_PAIRWISE_PARAMETERS} parâmetros.`);
  const names = new Set<string>();
  for (const parameter of usable) {
    if (names.has(parameter.name)) throw new Error(`Parâmetro repetido: ${parameter.name}.`);
    names.add(parameter.name);
    if (parameter.values.length > MAX_PAIRWISE_VALUES) throw new Error(`O parâmetro ${parameter.name} tem mais de ${MAX_PAIRWISE_VALUES} valores.`);
  }
  return usable;
}

/** Todos os pares que precisam aparecer em alguma linha. */
function requiredPairs(parameters: readonly NormalizedParameter[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < parameters.length; i += 1) {
    for (let j = i + 1; j < parameters.length; j += 1) {
      const left = parameters[i] as NormalizedParameter;
      const right = parameters[j] as NormalizedParameter;
      for (let a = 0; a < left.values.length; a += 1) {
        for (let b = 0; b < right.values.length; b += 1) pairs.add(pairKey(i, a, j, b));
      }
    }
  }
  return pairs;
}

/** Quantos pares ainda descobertos a linha passa a cobrir com este valor. */
function gain(row: number[], column: number, candidate: number, uncovered: Set<string>): number {
  let total = 0;
  for (let other = 0; other < column; other += 1) {
    const value = row[other];
    if (value === undefined) continue;
    if (uncovered.has(pairKey(other, value, column, candidate))) total += 1;
  }
  return total;
}

function markCovered(row: readonly number[], uncovered: Set<string>): void {
  for (let i = 0; i < row.length; i += 1) {
    for (let j = i + 1; j < row.length; j += 1) {
      const a = row[i];
      const b = row[j];
      if (a === undefined || b === undefined) continue;
      uncovered.delete(pairKey(i, a, j, b));
    }
  }
}

export function generatePairwise(parameters: readonly PairwiseParameter[]): PairwiseResult {
  const normalized = normalize(parameters);
  const uncovered = requiredPairs(normalized);
  const totalPairs = uncovered.size;

  // Semente: o produto cartesiano dos dois primeiros parâmetros, que é o
  // conjunto mínimo capaz de cobrir os pares entre eles.
  const first = normalized[0] as NormalizedParameter;
  const second = normalized[1] as NormalizedParameter;
  let matrix: number[][] = [];
  for (let a = 0; a < first.values.length; a += 1) {
    for (let b = 0; b < second.values.length; b += 1) matrix.push([a, b]);
  }
  for (const row of matrix) markCovered(row, uncovered);

  for (let column = 2; column < normalized.length; column += 1) {
    const parameter = normalized[column] as NormalizedParameter;

    // Crescimento horizontal: cada linha existente recebe o valor que cobre
    // mais pares novos. Empate fica com o menor índice, para o resultado ser
    // reproduzível.
    for (const row of matrix) {
      let best = 0;
      let bestGain = -1;
      for (let candidate = 0; candidate < parameter.values.length; candidate += 1) {
        const score = gain(row, column, candidate, uncovered);
        if (score > bestGain) {
          bestGain = score;
          best = candidate;
        }
      }
      row.push(best);
      markCovered(row, uncovered);
    }

    // Crescimento vertical: o que sobrou vira linha nova, e cada linha nova é
    // completada com os valores que cobrem mais pares ainda abertos.
    for (const pair of [...uncovered]) {
      if (!uncovered.has(pair)) continue;
      const [left = "", right = ""] = pair.split("|");
      const [leftColumn, leftValue] = left.split(":").map(Number);
      const [rightColumn, rightValue] = right.split(":").map(Number);
      if (leftColumn === undefined || rightColumn === undefined || rightColumn !== column) continue;

      const row: number[] = new Array(column + 1).fill(-1);
      row[leftColumn] = leftValue as number;
      row[column] = rightValue as number;
      for (let other = 0; other <= column; other += 1) {
        if (row[other] !== -1) continue;
        const values = (normalized[other] as NormalizedParameter).values;
        let best = 0;
        let bestGain = -1;
        for (let candidate = 0; candidate < values.length; candidate += 1) {
          row[other] = candidate;
          const score = gain(row, other, candidate, uncovered);
          if (score > bestGain) {
            bestGain = score;
            best = candidate;
          }
        }
        row[other] = best;
      }
      markCovered(row, uncovered);
      matrix.push(row);
    }
  }

  // Uma linha que não cobre par nenhum sozinha é redundante: acontece quando o
  // crescimento horizontal já resolveu tudo que a semente prometia.
  matrix = removeRedundantRows(matrix, normalized.length);

  const exhaustive = normalized.reduce((total, parameter) => total * parameter.values.length, 1);
  const rows = matrix.map((row) => Object.fromEntries(normalized.map((parameter, index) => [parameter.name, parameter.values[row[index] as number] as string])));
  return {
    rows,
    exhaustive,
    pairs: totalPairs,
    reduction: exhaustive === 0 ? 0 : Math.round((1 - rows.length / exhaustive) * 100),
  };
}

/**
 * Tira as linhas cuja remoção não descobre nenhum par.
 *
 * O IPOG pode deixar sobra quando a semente é grande e os parâmetros seguintes
 * têm poucos valores; entregar caso de teste que não cobre nada é justamente o
 * que a técnica promete evitar.
 */
function removeRedundantRows(matrix: readonly number[][], columns: number): number[][] {
  const kept: number[][] = [];
  for (let index = matrix.length - 1; index >= 0; index -= 1) {
    const candidate = matrix[index] as number[];
    const others = [...matrix.slice(0, index), ...kept];
    const covered = new Set<string>();
    for (const row of others) {
      for (let i = 0; i < columns; i += 1) {
        for (let j = i + 1; j < columns; j += 1) covered.add(pairKey(i, row[i] as number, j, row[j] as number));
      }
    }
    let unique = false;
    for (let i = 0; i < columns && !unique; i += 1) {
      for (let j = i + 1; j < columns; j += 1) {
        if (!covered.has(pairKey(i, candidate[i] as number, j, candidate[j] as number))) {
          unique = true;
          break;
        }
      }
    }
    if (unique) kept.unshift(candidate);
  }
  return kept;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function pairwiseToCsv(rows: readonly PairwiseRow[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0] as PairwiseRow);
  return [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column] ?? "")).join(","))].join("\n");
}

/** Casos numerados, no formato que se cola num plano de teste. */
export function formatPairwiseCases(rows: readonly PairwiseRow[]): string {
  return rows
    .map((row, index) => {
      const campos = Object.entries(row)
        .map(([name, value]) => `  ${name}: ${value}`)
        .join("\n");
      return `TC${String(index + 1).padStart(3, "0")}\n${campos}`;
    })
    .join("\n\n");
}
