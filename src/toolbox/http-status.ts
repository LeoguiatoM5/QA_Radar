/**
 * Explorador de status HTTP.
 *
 * Não é uma cópia do RFC: cada entrada traz o que o QA precisa decidir na hora
 * — o que o código significa e **o que checar quando ele aparece** numa análise
 * ou num teste de API.
 */

export type HttpStatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";

export interface HttpStatusDefinition {
  code: number;
  name: string;
  group: HttpStatusClass;
  summary: string;
  /** O que verificar quando este código aparece. */
  testing: string;
}

export interface HttpStatusClassDefinition {
  id: HttpStatusClass;
  label: string;
  description: string;
}

export const HTTP_STATUS_CLASSES: readonly HttpStatusClassDefinition[] = [
  { id: "1xx", label: "1xx · Informativo", description: "A requisição foi recebida e o processo continua." },
  { id: "2xx", label: "2xx · Sucesso", description: "A requisição foi recebida, entendida e aceita." },
  { id: "3xx", label: "3xx · Redirecionamento", description: "É preciso mais uma ação para completar a requisição." },
  { id: "4xx", label: "4xx · Erro do cliente", description: "A requisição tem algo errado ou não pode ser atendida." },
  { id: "5xx", label: "5xx · Erro do servidor", description: "O servidor falhou ao atender uma requisição aparentemente válida." },
];

function group(code: number): HttpStatusClass {
  return `${Math.floor(code / 100)}xx` as HttpStatusClass satisfies HttpStatusClass;
}

const ENTRIES: ReadonlyArray<[number, string, string, string]> = [
  [100, "Continue", "O cliente pode seguir com o corpo da requisição.", "Aparece com `Expect: 100-continue`; confirme se o cliente lida com a resposta intermediária."],
  [101, "Switching Protocols", "O servidor aceitou trocar de protocolo.", "Típico de WebSocket: confirme o handshake e o `Upgrade` na resposta."],
  [103, "Early Hints", "Dicas de recursos antes da resposta final.", "Verifique se os `Link` pré-carregados existem e não atrasam o carregamento."],
  [200, "OK", "A requisição foi bem-sucedida.", "Confira o corpo, não só o status: uma API pode devolver 200 com um erro dentro."],
  [201, "Created", "O recurso foi criado.", "Deve trazer `Location` apontando para o recurso novo; teste a idempotência do reenvio."],
  [202, "Accepted", "Aceita para processamento, ainda não concluída.", "Teste o caminho assíncrono: como se acompanha e o que acontece se o processamento falhar."],
  [204, "No Content", "Sucesso, sem corpo.", "O corpo precisa estar realmente vazio; cliente que faz `response.json()` aqui quebra."],
  [206, "Partial Content", "Parte do recurso, por causa de `Range`.", "Valide `Content-Range` e o comportamento de download interrompido e retomado."],
  [301, "Moved Permanently", "O recurso mudou de endereço definitivamente.", "Navegador e proxy guardam em cache: confirme que o destino está certo antes de publicar."],
  [302, "Found", "Redirecionamento temporário.", "O método pode virar GET no redirecionamento; use 307 se precisar preservar o POST."],
  [303, "See Other", "Veja o resultado em outro endereço, com GET.", "Padrão POST-redirect-GET: confirme que recarregar a página não repete a operação."],
  [304, "Not Modified", "O cache do cliente ainda vale.", "Teste com `If-None-Match`/`If-Modified-Since` e confirme que o conteúdo mudou invalida o cache."],
  [307, "Temporary Redirect", "Redirecionamento temporário preservando o método.", "Diferente do 302: o POST continua POST. Confirme que o corpo é reenviado."],
  [308, "Permanent Redirect", "Redirecionamento permanente preservando o método.", "Como o 301, fica em cache. Verifique HTTPS e barra final antes de fixar."],
  [400, "Bad Request", "A requisição está malformada.", "A mensagem precisa dizer qual campo falhou; 400 genérico esconde bug de contrato."],
  [401, "Unauthorized", "Falta credencial de autenticação ou ela é inválida.", "Deve trazer `WWW-Authenticate`. Confirme que é 401 (falha de autenticação), não 403 (falha de autorização)."],
  [403, "Forbidden", "A credencial existe, mas não dá acesso.", "Teste com usuário de outro perfil e de outra conta; 403 x 404 revela existência de recurso."],
  [404, "Not Found", "O recurso não existe.", "Verifique se é ausência real ou permissão disfarçada; e se o 404 tem corpo tratável."],
  [405, "Method Not Allowed", "O caminho existe, o método não.", "A resposta precisa listar `Allow`. Boa pista de rota implementada pela metade."],
  [406, "Not Acceptable", "Nenhum formato do `Accept` pode ser servido.", "Teste `Accept` incomum e confirme que o padrão da API está documentado."],
  [408, "Request Timeout", "O cliente demorou a enviar a requisição.", "Verifique timeouts de upload e o comportamento em rede lenta."],
  [409, "Conflict", "O estado atual do recurso impede a operação.", "Clássico de concorrência: teste duas escritas simultâneas e a mensagem devolvida."],
  [410, "Gone", "O recurso existia e foi removido de vez.", "Diferente do 404 por ser intencional; confirme que o cliente não tenta de novo."],
  [412, "Precondition Failed", "Uma pré-condição da requisição não foi atendida.", "Teste `If-Match` com ETag desatualizado — é a trava contra sobrescrita cega."],
  [413, "Payload Too Large", "O corpo passa do limite aceito.", "Descubra o limite real e confirme que a mensagem diz qual é, em vez de só recusar."],
  [415, "Unsupported Media Type", "O `Content-Type` enviado não é aceito.", "Erro comum de cliente que esquece `application/json`; confirme a mensagem."],
  [418, "I'm a teapot", "Piada do RFC 2324, às vezes usada como resposta de bloqueio.", "Se aparecer em produção, quase sempre é WAF ou anti-bot no caminho."],
  [422, "Unprocessable Content", "A sintaxe está certa, a semântica não.", "É o status de validação de negócio: confirme que lista todos os campos, não só o primeiro."],
  [425, "Too Early", "O servidor recusa processar dados de replay.", "Aparece com TLS 1.3 early data; verifique se a operação é idempotente."],
  [428, "Precondition Required", "O servidor exige requisição condicional.", "Confirme que o cliente envia ETag; é o que evita atualização perdida."],
  [429, "Too Many Requests", "O cliente estourou o limite de requisições.", "Precisa trazer `Retry-After`. Teste o comportamento do cliente ao receber: espera ou martela?"],
  [431, "Request Header Fields Too Large", "Os cabeçalhos passam do limite.", "Costuma ser cookie acumulado; teste com sessão antiga e muitos cookies."],
  [451, "Unavailable For Legal Reasons", "Bloqueado por exigência legal.", "Verifique se a resposta explica o bloqueio e se varia por região."],
  [500, "Internal Server Error", "Falha não tratada no servidor.", "Nunca deve vazar stack trace. Correlacione com o log pelo id da requisição."],
  [501, "Not Implemented", "O servidor não suporta a funcionalidade.", "Comum em método HTTP não implementado; confirme que não é rota faltando."],
  [502, "Bad Gateway", "Resposta inválida de um servidor upstream.", "Olhe o serviço de trás, não a borda: quase sempre é o upstream que caiu ou estourou timeout."],
  [503, "Service Unavailable", "O serviço está indisponível temporariamente.", "Deve trazer `Retry-After`. Confirme se é manutenção planejada ou saturação."],
  [504, "Gateway Timeout", "O upstream não respondeu a tempo.", "Compare o timeout da borda com o do upstream; desalinhados, produzem 504 intermitente."],
  [507, "Insufficient Storage", "O servidor não tem espaço para concluir.", "Verifique disco e cota antes de tratar como bug de aplicação."],
  [511, "Network Authentication Required", "É preciso autenticar na rede.", "Portal cativo de wi-fi; se aparecer no CI, o agente está atrás de um proxy."],
];

export const HTTP_STATUSES: readonly HttpStatusDefinition[] = ENTRIES.map(([code, name, summary, testing]) => ({ code, name, group: group(code), summary, testing }));

export function findHttpStatus(code: number): HttpStatusDefinition | undefined {
  return HTTP_STATUSES.find((status) => status.code === code);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Busca por código ou por texto.
 *
 * Digitar `40` traz a família 40x, não só o código 40 — que não existe. É o que
 * quem está investigando um erro realmente quer.
 */
export function searchHttpStatuses(query: string): HttpStatusDefinition[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...HTTP_STATUSES];
  return HTTP_STATUSES.filter((status) => {
    const haystack = normalize([status.code, status.name, status.summary, status.testing, status.group].join(" "));
    return terms.every((term) => (/^\d{1,3}$/.test(term) ? String(status.code).startsWith(term) : haystack.includes(term)));
  });
}
