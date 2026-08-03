/**
 * Contrato de erros da API.
 *
 * O código é a parte estável e legível por máquina; a mensagem é texto de
 * interface em português e pode mudar sem quebrar integrações. O status HTTP é
 * derivado do código, e não passado à parte, justamente para que os dois não
 * possam divergir entre as ~40 respostas de erro espalhadas pelas rotas.
 */
export const STATUS_BY_ERROR_CODE = {
  /** Corpo, parâmetro ou combinação de opções inválida. */
  invalid_request: 400,
  /** URL de destino recusada pela política de rede (protocolo, credenciais, endereço privado). */
  invalid_target: 400,
  /** Falta credencial. */
  unauthorized: 401,
  /** Credencial apresentada, mas insuficiente. */
  forbidden: 403,
  /** O recurso existe no produto, mas está desligado nesta instalação. */
  feature_disabled: 403,
  /** Recurso inexistente, ou já expirado pela política de retenção. */
  not_found: 404,
  /** Caminho existe, método não. */
  method_not_allowed: 405,
  /** O recurso existe, mas não está no estado exigido pela operação. */
  conflict: 409,
  /** Corpo acima do limite aceito. */
  payload_too_large: 413,
  /** Limite de requisições por cliente estourado. */
  rate_limited: 429,
  /** Fila cheia; a instalação inteira está saturada. */
  server_busy: 429,
  /** Recurso exclusivo (navegador, gravação) já em uso por outra execução. */
  resource_in_use: 429,
  /** Falha não prevista. A mensagem real nunca vai para o cliente. */
  internal_error: 500,
  /** Dependência externa exigida não está configurada ou não respondeu. */
  service_unavailable: 503,
} as const satisfies Record<string, number>;

export type ApiErrorCode = keyof typeof STATUS_BY_ERROR_CODE;

/** Mensagem enviada no lugar da real quando a falha não foi prevista. */
export const INTERNAL_ERROR_MESSAGE = "Erro interno do servidor.";

export interface ApiErrorBody {
  /** Texto de interface. O cliente web e os testes leem este campo. */
  error: string;
  /** Código estável do contrato. */
  code: ApiErrorCode;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Cabeçalhos exigidos pela semântica do status (ex.: `www-authenticate`, `retry-after`). */
  readonly headers: Readonly<Record<string, string | number>>;

  constructor(code: ApiErrorCode, message: string, headers: Record<string, string | number> = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_ERROR_CODE[code];
    this.headers = headers;
  }

  body(): ApiErrorBody {
    return { error: this.message, code: this.code };
  }
}

/** Atalho para o caso mais comum: entrada inválida do cliente. */
export function invalidRequest(message: string): ApiError {
  return new ApiError("invalid_request", message);
}

/**
 * Executa um validador que não conhece HTTP (parser da CLI, política de código,
 * schema de jornada) e reclassifica a falha dele como erro do cliente.
 *
 * Esses módulos são compartilhados com a CLI e não devem carregar status HTTP,
 * mas suas mensagens são exatamente o que o cliente da API precisa ler. Sem
 * isto, o catch-all trataria uma URL malformada como falha interna.
 */
export function validating<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalidRequest(error instanceof Error ? error.message : "Entrada inválida.");
  }
}

/**
 * Normaliza qualquer coisa lançada no ciclo de requisição.
 *
 * Só `ApiError` atravessa com a mensagem intacta. Qualquer outra exceção vira
 * `internal_error` com mensagem genérica: antes disto, o catch-all do servidor
 * respondia 400 com a mensagem crua, o que classificava bugs internos como erro
 * do cliente e ainda expunha detalhe de implementação.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    return new ApiError("not_found", "Recurso não encontrado ou já expirado.");
  }
  return new ApiError("internal_error", INTERNAL_ERROR_MESSAGE);
}
