import { createHmac, randomBytes } from "node:crypto";

/**
 * Emissão do token de acesso de uma análise.
 *
 * O token é entregue uma única vez, na criação. Isso conflita com idempotência:
 * repetir a criação depois de um reinício precisa devolver o MESMO token, e a
 * saída óbvia — guardar o token junto da chave de idempotência — significaria
 * gravar um bearer token em texto claro, o que é pior do que a situação atual,
 * em que ele só existe em memória.
 *
 * A saída usada aqui é derivar o token do id da análise com HMAC de um segredo
 * do servidor. Assim ele é recomputável a qualquer momento sem nunca ser
 * gravado: o que fica em repouso continua sendo apenas o SHA-256 dele, como já
 * era. O id é UUIDv4, então conhecer o algoritmo não ajuda quem não tem o
 * segredo.
 *
 * Sem segredo configurado, cada token volta a ser aleatório e some no reinício
 * — exatamente o comportamento anterior. É degradação consciente, não falha.
 */
export interface AccessTokenIssuer {
  /** Token para esta análise. Determinístico quando há segredo. */
  issue(jobId: string): string;
  /** Se a repetição de uma criação consegue reemitir o mesmo token. */
  readonly reissuable: boolean;
}

export const MIN_ACCESS_TOKEN_SECRET_BYTES = 32;

export function createRandomAccessTokenIssuer(): AccessTokenIssuer {
  return {
    issue: () => randomBytes(32).toString("base64url"),
    reissuable: false,
  };
}

export function createDerivedAccessTokenIssuer(secret: string): AccessTokenIssuer {
  if (Buffer.byteLength(secret, "utf8") < MIN_ACCESS_TOKEN_SECRET_BYTES) {
    throw new Error(`QA_RADAR_ACCESS_TOKEN_SECRET deve ter ao menos ${MIN_ACCESS_TOKEN_SECRET_BYTES} bytes.`);
  }
  return {
    // O rótulo separa este uso de qualquer outro que venha a usar o mesmo
    // segredo, para que dois propósitos nunca produzam o mesmo valor.
    issue: (jobId) => createHmac("sha256", secret).update(`scan-access:${jobId}`).digest("base64url"),
    reissuable: true,
  };
}
