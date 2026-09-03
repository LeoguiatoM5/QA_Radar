/**
 * O recorte comum a toda consulta de histórico.
 *
 * Inspeção, Jornada e Testes de API guardam em tabelas diferentes, mas a
 * pergunta que a página de Relatórios faz é a mesma para as três: "o que esta
 * conta rodou, opcionalmente nesta aplicação, neste período". Um tipo só evita
 * três assinaturas quase iguais divergindo com o tempo.
 *
 * Os quatro campos são empurrados para o SQL de propósito. Filtrar depois de
 * ler seria correto só enquanto o volume fosse pequeno — e o produto existe
 * justamente para quem roda muito teste.
 */
export interface HistoryQuery {
  /** Só desta aplicação. Ausente = todas, inclusive execuções avulsas. */
  applicationId?: string | undefined;
  /** Início do período, inclusivo, em ISO 8601. */
  since?: string | undefined;
  /**
   * Cursor da paginação: só o que vem **depois** desta linha na ordenação.
   *
   * Por posição na lista, e não por deslocamento num `offset`, porque uma
   * execução nova chegando entre duas páginas empurraria tudo e faria a segunda
   * repetir o que a primeira mostrou.
   *
   * Traz **data e id**, e não só a data, porque duas execuções podem cair no
   * mesmo milissegundo — uma rajada de testes de API faz isso o tempo todo. Com
   * cursor só de data, as empatadas com a última linha da página eram puladas de
   * vez: não cabiam na página e não passavam pelo `<` da seguinte.
   */
  before?: HistoryCursor | undefined;
  limit: number;
}

/** Onde a página anterior parou: a ordenação é `(created_at, id)` decrescente. */
export interface HistoryCursor {
  createdAt: string;
  id: string;
}

/** Ordem canônica da linha do tempo: mais recente primeiro, id desempata. */
export function compareHistory(a: HistoryCursor, b: HistoryCursor): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/**
 * Constrói o pedaço de `where` e os parâmetros de uma consulta de histórico.
 *
 * As três tabelas têm as mesmas colunas relevantes (`owner_id`,
 * `application_id`, `created_at`), então a montagem é a mesma. `$1` é sempre o
 * dono: ele nunca é opcional, porque isolamento conferido fora da consulta é
 * isolamento que a próxima consulta esquece.
 */
export function historyClauses(ownerId: string, query: HistoryQuery): { where: string; values: unknown[]; limitPlaceholder: string } {
  const values: unknown[] = [ownerId];
  let where = "owner_id = $1";
  if (query.applicationId) {
    values.push(query.applicationId);
    where += ` and application_id = $${values.length}`;
  }
  if (query.since) {
    values.push(query.since);
    where += ` and created_at >= $${values.length}`;
  }
  if (query.before) {
    // Comparação de tupla: o Postgres avalia `(a, b) < (x, y)` na ordem
    // lexicográfica das colunas, que é exatamente a ordenação da lista.
    values.push(query.before.createdAt, query.before.id);
    // Casts explícitos: numa comparação de tupla o Postgres não infere o tipo
    // dos parâmetros pelo lado esquerdo, e um deles é `uuid`.
    where += ` and (created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`;
  }
  values.push(query.limit);
  return { where, values, limitPlaceholder: `$${values.length}` };
}

/** O mesmo recorte aplicado a uma lista em memória, para o repositório inerte. */
export function matchesHistory(row: { ownerId?: string | undefined; applicationId?: string | undefined; createdAt: string; id: string }, ownerId: string, query: HistoryQuery): boolean {
  if (row.ownerId !== ownerId) return false;
  if (query.applicationId && row.applicationId !== query.applicationId) return false;
  if (query.since && row.createdAt < query.since) return false;
  // `> 0` significa "vem depois do cursor na ordenação", que é o mesmo que o
  // `(created_at, id) < (...)` do SQL: a lista desce da mais recente.
  if (query.before && compareHistory(query.before, row) >= 0) return false;
  return true;
}
