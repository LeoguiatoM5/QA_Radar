export const MAX_CODE_FILE_BYTES = 256 * 1024;
// Reserva espaço para o envelope JSON que transporta um arquivo no limite.
export const MAX_JSON_BODY_BYTES = MAX_CODE_FILE_BYTES + 64 * 1024;
