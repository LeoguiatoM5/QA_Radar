import { STATUS_BY_ERROR_CODE, type ApiErrorCode } from "./api-error.js";
import { VERSION } from "./version.js";

/**
 * Contrato OpenAPI da API HTTP.
 *
 * Escrito como código, e não como arquivo estático, para que as partes que
 * também existem em outro lugar sejam derivadas da fonte real: os códigos de
 * erro vêm de STATUS_BY_ERROR_CODE e a versão de version.ts. Um código novo
 * aparece aqui sozinho, e o teste de contrato falha se algum deixar de ser
 * descrito.
 *
 * Fora do escopo de propósito: `/api/dashboard/activity` (estado interno da
 * interface, não contrato para terceiros) e `/api/journeys` (jornada
 * declarativa em JSON, legado desligado que não faz parte do produto).
 */

const ERROR_CODES = Object.keys(STATUS_BY_ERROR_CODE) as ApiErrorCode[];

function errorResponses(statuses: number[]): Record<string, unknown> {
  return Object.fromEntries(
    statuses.map((status) => [
      String(status),
      {
        description: ERROR_STATUS_DESCRIPTIONS[status] ?? "Erro.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
      },
    ]),
  );
}

const ERROR_STATUS_DESCRIPTIONS: Record<number, string> = {
  400: "Entrada inválida (`invalid_request`, `invalid_target`).",
  401: "Credencial ausente (`unauthorized`).",
  403: "Credencial insuficiente ou recurso desligado nesta instalação (`forbidden`, `feature_disabled`).",
  404: "Recurso inexistente ou já expirado pela retenção (`not_found`).",
  405: "Método não suportado neste caminho (`method_not_allowed`).",
  409: "O recurso não está no estado exigido pela operação (`conflict`).",
  413: "Corpo acima do limite aceito (`payload_too_large`).",
  422: "A jornada executou e reprovou. O corpo é o resultado, não um erro.",
  429: "Limite por cliente, fila cheia ou recurso exclusivo em uso (`rate_limited`, `server_busy`, `resource_in_use`).",
  500: "Falha não prevista (`internal_error`). A mensagem real fica no log do servidor.",
  503: "Dependência exigida não configurada ou fora do ar (`service_unavailable`).",
};

const JOB_STATUS = { type: "string", enum: ["queued", "running", "completed", "failed", "cancelled"] };

export function createOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "QA Radar",
      version: VERSION,
      description:
        "API HTTP do QA Radar. Todo caminho abaixo também responde sem o prefixo de versão (`/api/...`), mantido como alias pré-1.0 por compatibilidade; prefira `/api/v1` em integrações novas. Respostas de erro têm sempre o formato `{ error, code }`, onde `code` é a parte estável do contrato e `error` é texto de interface que pode mudar sem aviso.",
      license: { name: "Evaluation and Test License", url: "https://github.com/LeoguiatoM5/qa-radar/blob/main/LICENSE" },
    },
    servers: [{ url: "/", description: "A própria instância que serve este documento." }],
    tags: [
      { name: "Análises", description: "Inspeção de páginas: fila, acompanhamento e artefatos." },
      { name: "Jornada", description: "Execução de arquivos .spec.ts do Playwright e relatório de evidências." },
      { name: "Testes de API", description: "Encaminhamento de uma requisição HTTP a um alvo público." },
      { name: "Operação", description: "Vivacidade e prontidão da instância. Fora do versionamento." },
    ],
    paths: {
      "/health": {
        get: {
          tags: ["Operação"],
          summary: "Vivacidade do processo",
          description: "Responde 200 enquanto o processo atender. Não consulta dependência nenhuma: é o alvo do HEALTHCHECK da imagem Docker, e reiniciar o contêiner não conserta disco nem runner.",
          responses: {
            "200": {
              description: "Processo de pé.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status", "active", "queued", "jobs"],
                    properties: { status: { const: "ok" }, active: { type: "integer" }, queued: { type: "integer" }, jobs: { type: "integer" } },
                  },
                },
              },
            },
          },
        },
      },
      "/ready": {
        get: {
          tags: ["Operação"],
          summary: "Prontidão da instância",
          description: "Decide se a instância deve receber tráfego. Só `checks.resultsDir` reprova; `checks.queue` e `checks.codeMode` são informativos.",
          responses: {
            "200": { description: "Pronta.", content: { "application/json": { schema: { $ref: "#/components/schemas/Readiness" } } } },
            "503": { description: "Não pronta.", content: { "application/json": { schema: { $ref: "#/components/schemas/Readiness" } } } },
          },
        },
      },
      "/api/v1/auth/me": {
        get: {
          tags: ["Conta"],
          summary: "Quem é a requisição, se for alguém",
          description: "Sempre responde 200, autenticado ou não. `loginAvailable` diz se esta instalação guarda contas; `passwordResetAvailable` diz se ela envia e-mail.",
          responses: {
            "200": { description: "Estado da sessão.", content: { "application/json": { schema: { $ref: "#/components/schemas/SessionState" } } } },
            ...errorResponses([500]),
          },
        },
      },
      "/api/v1/applications": {
        get: {
          tags: ["Aplicações"],
          summary: "Listar as aplicações da conta",
          description: "Devolve exclusivamente as aplicações de quem pediu. Use `?arquivadas=1` para incluir as arquivadas.",
          responses: {
            "200": { description: "Aplicações da conta.", content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationList" } } } },
            ...errorResponses([401, 403, 500]),
          },
        },
        post: {
          tags: ["Aplicações"],
          summary: "Cadastrar uma aplicação",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationRequest" } } } },
          responses: {
            "201": { description: "Aplicação cadastrada.", content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationEnvelope" } } } },
            ...errorResponses([400, 401, 403, 409, 413, 500]),
          },
        },
      },
      "/api/v1/applications/{id}": {
        get: {
          tags: ["Aplicações"],
          summary: "Consultar uma aplicação",
          description: "Aplicação de outra conta responde 404, e não 403: responder proibido confirmaria que aquele id existe.",
          parameters: [{ $ref: "#/components/parameters/ApplicationId" }],
          responses: {
            "200": { description: "Aplicação.", content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationEnvelope" } } } },
            ...errorResponses([401, 403, 404, 500]),
          },
        },
        patch: {
          tags: ["Aplicações"],
          summary: "Alterar uma aplicação",
          description: "Campo ausente não é alterado. Corpo vazio responde 400.",
          parameters: [{ $ref: "#/components/parameters/ApplicationId" }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationRequest" } } } },
          responses: {
            "200": { description: "Aplicação alterada.", content: { "application/json": { schema: { $ref: "#/components/schemas/ApplicationEnvelope" } } } },
            ...errorResponses([400, 401, 403, 404, 409, 413, 500]),
          },
        },
        delete: {
          tags: ["Aplicações"],
          summary: "Arquivar uma aplicação",
          description: "Arquiva em vez de apagar: as análises já feitas continuam apontando para ela.",
          parameters: [{ $ref: "#/components/parameters/ApplicationId" }],
          responses: {
            "200": { description: "Aplicação arquivada.", content: { "application/json": { schema: { type: "object", properties: { archived: { type: "boolean" } } } } } },
            ...errorResponses([401, 403, 404, 500]),
          },
        },
      },
      "/api/v1/applications/{id}/scans": {
        get: {
          tags: ["Aplicações"],
          summary: "Histórico de execuções da aplicação",
          description:
            "Inspeções e Jornadas guardadas nesta aplicação, das mais recentes para as mais antigas. `journeys` vem vazio em servidor sem banco, onde a Jornada não deixa registro. Aplicação de outra conta responde 404.",
          parameters: [{ $ref: "#/components/parameters/ApplicationId" }],
          responses: {
            "200": {
              description: "Histórico da aplicação.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["scans", "journeys", "apiRuns"],
                    properties: {
                      scans: { type: "array", items: { type: "object", additionalProperties: true } },
                      journeys: { type: "array", items: { $ref: "#/components/schemas/JourneySummary" } },
                      apiRuns: { type: "array", items: { $ref: "#/components/schemas/ApiRunSummary" } },
                    },
                  },
                },
              },
            },
            ...errorResponses([401, 403, 404, 500]),
          },
        },
      },
      "/api/v1/executions": {
        get: {
          tags: ["Relatórios"],
          summary: "Linha do tempo de execuções da conta",
          description:
            "Inspeções, Jornadas e Testes de API numa lista só, da mais recente para a mais antiga. Os filtros vão para a consulta de cada origem. A paginação usa `nextCursor`, que carrega data **e** id — duas execuções cabem no mesmo milissegundo, e um cursor só de data pularia as empatadas com a última linha da página.",
          parameters: [
            { name: "aplicacao", in: "query", required: false, schema: { type: "string", format: "uuid" }, description: "Só desta aplicação. De outra conta responde 404." },
            {
              name: "tipo",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Origens separadas por vírgula: `scan`, `journey`, `api`. Ausente inclui todas; valor desconhecido responde 400.",
            },
            { name: "de", in: "query", required: false, schema: { type: "string", format: "date-time" }, description: "Início do período, inclusivo." },
            { name: "cursor", in: "query", required: false, schema: { type: "string" }, description: "O `nextCursor` da resposta anterior, tal e qual." },
            { name: "limite", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          ],
          responses: {
            "200": {
              description: "Uma página da linha do tempo.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["executions"],
                    properties: {
                      executions: { type: "array", items: { $ref: "#/components/schemas/ExecutionEntry" } },
                      nextCursor: { type: "string", nullable: true, description: "Ausente quando a lista acabou." },
                    },
                  },
                },
              },
            },
            ...errorResponses([400, 401, 403, 404, 405, 500]),
          },
        },
      },
      "/api/v1/quality/summary": {
        get: {
          tags: ["Relatórios"],
          summary: "Resumo de qualidade da conta",
          description:
            "A mesma linha do tempo de `/api/v1/executions`, somada em vez de listada: total, taxa de sucesso, comparação com o período anterior de igual duração, quebra por tipo e por aplicação, e um ponto por dia para tendência. Acima de `MAX_QUALITY_ENTRIES` execuções no período os números viram aproximados (`truncated`).",
          parameters: [
            { name: "aplicacao", in: "query", required: false, schema: { type: "string", format: "uuid" }, description: "Só desta aplicação. De outra conta responde 404." },
            {
              name: "de",
              in: "query",
              required: false,
              schema: { type: "string", format: "date-time" },
              description: "Início do período. Ausente soma a conta inteira e não há comparação com período anterior.",
            },
          ],
          responses: {
            "200": { description: "O resumo do período.", content: { "application/json": { schema: { $ref: "#/components/schemas/QualitySummary" } } } },
            ...errorResponses([400, 401, 403, 404, 405, 500]),
          },
        },
      },
      "/api/v1/applications/{id}/collections": {
        get: {
          tags: ["Testes de API"],
          summary: "Collections da aplicação",
          parameters: [{ $ref: "#/components/parameters/ApplicationId" }],
          responses: {
            "200": {
              description: "Collections da aplicação, da mais antiga para a mais nova.",
              content: {
                "application/json": {
                  schema: { type: "object", required: ["collections"], properties: { collections: { type: "array", items: { $ref: "#/components/schemas/ApiCollection" } } } },
                },
              },
            },
            ...errorResponses([401, 403, 404, 500, 503]),
          },
        },
        post: {
          tags: ["Testes de API"],
          summary: "Criar uma collection",
          description:
            "**Credenciais nunca são gravadas.** O servidor descarta o valor de header sensível, de query param com cara de segredo (inclusive dentro da URL) e de todo campo de autenticação — bearer token, senha e valor de API key. O que volta na resposta é exatamente o que ficou guardado.",
          parameters: [{ $ref: "#/components/parameters/ApplicationId" }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ApiCollectionRequest" } } } },
          responses: {
            "201": { description: "Collection criada, já sem credencial.", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiCollectionEnvelope" } } } },
            ...errorResponses([400, 401, 403, 404, 409, 413, 500, 503]),
          },
        },
      },
      "/api/v1/applications/{id}/collections/{collectionId}": {
        put: {
          tags: ["Testes de API"],
          summary: "Substituir uma collection",
          description: "Campo ausente não é alterado. A mesma limpeza de credenciais do POST se aplica.",
          parameters: [{ $ref: "#/components/parameters/ApplicationId" }, { $ref: "#/components/parameters/CollectionId" }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ApiCollectionRequest" } } } },
          responses: {
            "200": { description: "Collection alterada.", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiCollectionEnvelope" } } } },
            ...errorResponses([400, 401, 403, 404, 409, 413, 500, 503]),
          },
        },
        delete: {
          tags: ["Testes de API"],
          summary: "Apagar uma collection",
          description: "Apaga de vez, sem arquivar: uma collection é configuração, e não registro do que aconteceu.",
          parameters: [{ $ref: "#/components/parameters/ApplicationId" }, { $ref: "#/components/parameters/CollectionId" }],
          responses: {
            "200": { description: "Collection apagada.", content: { "application/json": { schema: { type: "object", properties: { removed: { type: "boolean" } } } } } },
            ...errorResponses([401, 403, 404, 500, 503]),
          },
        },
      },
      "/api/v1/scans": {
        post: {
          tags: ["Análises"],
          summary: "Enfileirar uma análise",
          parameters: [
            {
              name: "Idempotency-Key",
              in: "header",
              required: false,
              schema: { type: "string", maxLength: 255, pattern: "^[\\w.:-]+$" },
              description: "Repetir com a mesma chave e o mesmo corpo devolve 200 com a análise já criada, em vez de enfileirar outra. Mesma chave com corpo diferente responde 409.",
            },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ScanRequest" } } } },
          responses: {
            "202": {
              description: "Análise enfileirada. `accessToken` é entregue uma única vez e também vai num cookie restrito ao caminho da análise.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreatedScan" } } },
            },
            "200": { description: "Repetição de uma criação já feita com a mesma Idempotency-Key.", content: { "application/json": { schema: { $ref: "#/components/schemas/CreatedScan" } } } },
            ...errorResponses([400, 403, 409, 413, 429, 500]),
          },
        },
        get: {
          tags: ["Análises"],
          summary: "Listar o histórico da conta",
          description: "Análises da conta autenticada, da mais recente para a mais antiga. Exige sessão: análises anônimas não pertencem a ninguém e não aparecem aqui.",
          responses: {
            "200": {
              description: "Histórico da conta.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["scans"],
                    properties: { scans: { type: "array", items: { $ref: "#/components/schemas/Scan" } } },
                  },
                },
              },
            },
            ...errorResponses([401, 500]),
          },
        },
        delete: {
          tags: ["Análises"],
          summary: "Apagar o histórico da conta",
          description:
            "Remove todas as análises da conta autenticada, junto com os relatórios e artefatos das que já terminaram. Não tem volta e não alcança o histórico de outra conta. Repetir devolve 200 com `removed: 0`, porque converge para o mesmo estado.",
          responses: {
            "200": {
              description: "Histórico apagado.",
              content: {
                "application/json": {
                  schema: { type: "object", required: ["removed"], properties: { removed: { type: "integer", minimum: 0, description: "Quantas análises foram removidas." } } },
                },
              },
            },
            ...errorResponses([401, 500]),
          },
        },
      },
      "/api/v1/scans/{id}": {
        get: {
          tags: ["Análises"],
          summary: "Consultar uma análise",
          parameters: [{ $ref: "#/components/parameters/ScanId" }],
          security: [{ accessToken: [] }],
          responses: {
            "200": { description: "Estado atual.", content: { "application/json": { schema: { $ref: "#/components/schemas/Scan" } } } },
            ...errorResponses([401, 403, 404, 500]),
          },
        },
      },
      "/api/v1/scans/{id}/cancel": {
        post: {
          tags: ["Análises"],
          summary: "Cancelar uma análise",
          description: "Idempotente: cancelar de novo uma análise já cancelada responde 202 com o mesmo estado. Cancelar uma que concluiu ou falhou responde 409.",
          parameters: [{ $ref: "#/components/parameters/ScanId" }],
          security: [{ accessToken: [] }],
          responses: {
            "202": { description: "Cancelamento aceito.", content: { "application/json": { schema: { $ref: "#/components/schemas/Scan" } } } },
            ...errorResponses([401, 403, 404, 409, 500]),
          },
        },
      },
      "/api/v1/scans/{id}/{artifact}": {
        get: {
          tags: ["Análises"],
          summary: "Baixar um artefato da análise",
          parameters: [
            { $ref: "#/components/parameters/ScanId" },
            {
              name: "artifact",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["report.html", "report.json", "report.junit.xml", "report.sarif.json", "screenshot.png"] },
            },
          ],
          security: [{ accessToken: [] }],
          responses: {
            "200": {
              description: "Conteúdo do artefato.",
              content: { "text/html": {}, "application/json": {}, "application/xml": {}, "image/png": {} },
            },
            ...errorResponses([401, 403, 404, 409, 500]),
          },
        },
      },
      "/api/v1/history": {
        get: {
          tags: ["Análises"],
          summary: "Histórico de um projeto",
          description: "Exige `QA_RADAR_ENABLE_HISTORY=true`; caso contrário responde 403 `feature_disabled`.",
          parameters: [
            { name: "project", in: "query", required: true, schema: { type: "string" } },
            { name: "environment", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Execuções registradas.", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses([400, 403, 500]),
          },
        },
      },
      "/api/v1/code-execution": {
        post: {
          tags: ["Jornada"],
          summary: "Executar um arquivo .spec.ts",
          description:
            "Exige o Modo Jornada habilitado. Requisição remota exige token administrativo e um runner sandbox configurado — sem ele responde 503, sem cair para execução local. O corpo passa por uma política de código antes de rodar.",
          security: [{ adminToken: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code"],
                  properties: {
                    code: { type: "string", maxLength: 262144, description: "Conteúdo do arquivo .spec.ts." },
                    headed: { type: "boolean", default: true, description: "Ignorado em execução remota, que é sempre headless." },
                    applicationId: {
                      type: "string",
                      format: "uuid",
                      description: "Aplicação da conta onde guardar esta execução. Exige sessão; id de aplicação de outra conta responde 404.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Jornada aprovada.", content: { "application/json": { schema: { $ref: "#/components/schemas/CodeExecution" } } } },
            "422": { description: "Jornada reprovada. O corpo traz o mesmo formato do 200.", content: { "application/json": { schema: { $ref: "#/components/schemas/CodeExecution" } } } },
            ...errorResponses([400, 401, 403, 404, 413, 429, 500, 503]),
          },
        },
      },
      "/api/v1/code-executions/{id}/steps": {
        get: {
          tags: ["Jornada"],
          summary: "Passos derivados do código executado",
          parameters: [{ $ref: "#/components/parameters/ExecutionId" }],
          security: [{ accessToken: [] }],
          responses: {
            "200": {
              description: "Passos reconhecidos, na ordem em que aparecem no arquivo.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["steps"],
                    properties: {
                      steps: {
                        type: "array",
                        items: {
                          type: "object",
                          required: ["index", "action", "description"],
                          properties: { index: { type: "integer" }, action: { type: "string" }, description: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
            ...errorResponses([401, 403, 404, 500]),
          },
        },
      },
      "/api/v1/code-executions/{id}/evidence-report": {
        post: {
          tags: ["Jornada"],
          summary: "Gerar o relatório de evidências em HTML",
          parameters: [{ $ref: "#/components/parameters/ExecutionId" }],
          security: [{ accessToken: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    testerName: { type: "string" },
                    testType: { type: "string" },
                    stepDescriptions: { type: "array", items: { type: "string" }, description: "Sobrescreve a descrição de cada passo, na ordem." },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Relatório gravado. `url` acompanha o prefixo com que a requisição chegou.",
              content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string" } } } } },
            },
            ...errorResponses([400, 401, 403, 404, 413, 500]),
          },
        },
      },
      "/api/v1/codegen": {
        post: {
          tags: ["Jornada"],
          summary: "Iniciar uma gravação do Playwright Codegen",
          description: "Só aceita requisição do host local: o Codegen abre uma janela de navegador na máquina do servidor. Requisição remota responde 403.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" } } } } },
          },
          responses: {
            "201": {
              description: "Gravação iniciada.",
              content: { "application/json": { schema: { type: "object", required: ["id", "accessToken"], properties: { id: { type: "string", format: "uuid" }, accessToken: { type: "string" } } } } },
            },
            ...errorResponses([400, 403, 429, 500]),
          },
        },
      },
      "/api/v1/codegen/{id}": {
        get: {
          tags: ["Jornada"],
          summary: "Recuperar o código gravado",
          parameters: [{ $ref: "#/components/parameters/ExecutionId" }],
          security: [{ accessToken: [] }],
          responses: {
            "200": {
              description: "Estado da gravação. `code` só vem preenchido quando `status` é `completed`.",
              content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, code: { type: "string" } } } } },
            },
            ...errorResponses([401, 403, 404, 500]),
          },
        },
      },
      "/api/v1/http-request": {
        post: {
          tags: ["Testes de API"],
          summary: "Encaminhar uma requisição HTTP",
          description: "O servidor faz a chamada em nome do navegador, contornando CORS. O alvo passa pela mesma política de rede pública das análises, revalidada a cada redirecionamento seguido.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/HttpRequest" } } } },
          responses: {
            "200": { description: "Resposta do alvo, mesmo quando o status dele é de erro.", content: { "application/json": { schema: { $ref: "#/components/schemas/HttpResponse" } } } },
            ...errorResponses([400, 429, 500]),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        accessToken: {
          type: "http",
          scheme: "bearer",
          description: "Token devolvido na criação do recurso. Também aceito no cookie `qa_radar_access`, restrito ao caminho do próprio recurso.",
        },
        adminToken: { type: "http", scheme: "bearer", description: "`QA_RADAR_CODE_MODE_ADMIN_TOKEN`. Exigido apenas em requisição remota ao Modo Jornada." },
      },
      parameters: {
        ScanId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ExecutionId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ApplicationId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        CollectionId: { name: "collectionId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      },
      schemas: {
        SessionState: {
          type: "object",
          required: ["authenticated", "loginAvailable"],
          properties: {
            authenticated: { type: "boolean" },
            loginAvailable: { type: "boolean", description: "Esta instalação guarda contas. Falso sem banco de dados." },
            githubAvailable: { type: "boolean", description: "A entrada pelo GitHub está configurada. O cadastro por senha não depende disto." },
            passwordResetAvailable: { type: "boolean", description: "Há provedor de e-mail, então existe caminho de volta para quem esquecer a senha." },
            user: {
              type: "object",
              properties: {
                login: { type: "string" },
                name: { type: "string", nullable: true },
                avatarUrl: { type: "string", nullable: true },
                email: { type: "string", nullable: true },
                emailVerified: { type: "boolean" },
                hasPassword: { type: "boolean" },
              },
            },
          },
        },
        Application: {
          type: "object",
          required: ["id", "name", "baseUrl", "environments", "createdAt", "archived"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string", maxLength: 60, description: "Único dentro da conta, comparado sem diferenciar maiúsculas." },
            baseUrl: { type: "string", format: "uri" },
            environments: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 10 },
            createdAt: { type: "string", format: "date-time" },
            archived: { type: "boolean" },
          },
        },
        ApplicationEnvelope: { type: "object", required: ["application"], properties: { application: { $ref: "#/components/schemas/Application" } } },
        ApplicationList: { type: "object", required: ["applications"], properties: { applications: { type: "array", items: { $ref: "#/components/schemas/Application" } } } },
        ExecutionEntry: {
          type: "object",
          required: ["id", "kind", "createdAt", "title", "detail", "outcome", "href"],
          description: "Uma linha da linha do tempo, já normalizada: as três origens chegam aqui com a mesma forma.",
          properties: {
            id: { type: "string", format: "uuid" },
            kind: { type: "string", enum: ["scan", "journey", "api"] },
            createdAt: { type: "string", format: "date-time" },
            title: { type: "string", description: "URL analisada, nome do teste, ou método e rota." },
            detail: { type: "string", description: "Contagem de erros, de testes, ou o status HTTP." },
            outcome: { type: "string", enum: ["passed", "failed", "running"] },
            durationMs: { type: "integer", nullable: true },
            applicationId: { type: "string", format: "uuid", nullable: true },
            applicationName: { type: "string", nullable: true },
            href: { type: "string", description: "Para onde a linha leva." },
          },
        },
        QualityCounts: {
          type: "object",
          required: ["total", "passed", "failed", "running", "passRate"],
          properties: {
            total: { type: "integer" },
            passed: { type: "integer" },
            failed: { type: "integer" },
            running: { type: "integer" },
            passRate: { type: "integer", nullable: true, description: "0 a 100. Ausente quando nenhuma execução do grupo terminou." },
          },
        },
        QualitySummary: {
          type: "object",
          required: ["current", "byKind", "byApplication", "daily", "truncated"],
          properties: {
            current: { $ref: "#/components/schemas/QualityCounts" },
            previous: { allOf: [{ $ref: "#/components/schemas/QualityCounts" }], nullable: true, description: 'Ausente sem período: "desde o começo" não tem um anterior para comparar.' },
            byKind: {
              type: "object",
              required: ["scan", "journey", "api"],
              properties: { scan: { $ref: "#/components/schemas/QualityCounts" }, journey: { $ref: "#/components/schemas/QualityCounts" }, api: { $ref: "#/components/schemas/QualityCounts" } },
            },
            byApplication: {
              type: "array",
              description: "Até 10 aplicações, da maior contagem de execuções para a menor.",
              items: {
                allOf: [
                  { $ref: "#/components/schemas/QualityCounts" },
                  {
                    type: "object",
                    required: ["lastRunAt"],
                    properties: {
                      applicationId: { type: "string", format: "uuid", nullable: true },
                      applicationName: { type: "string", nullable: true },
                      lastRunAt: { type: "string", format: "date-time" },
                    },
                  },
                ],
              },
            },
            daily: {
              type: "array",
              description: "Vazio sem período. Com período, um ponto por dia, inclusive os sem execução.",
              items: {
                type: "object",
                required: ["date", "total", "passed", "failed"],
                properties: { date: { type: "string", format: "date" }, total: { type: "integer" }, passed: { type: "integer" }, failed: { type: "integer" } },
              },
            },
            truncated: { type: "boolean", description: "O período tinha mais execuções do que o resumo somou; os números são aproximados." },
          },
        },
        ApiRunSummary: {
          type: "object",
          required: ["id", "method", "url", "createdAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            method: { type: "string" },
            url: { type: "string", description: "Já sem o valor de query param com cara de credencial." },
            status: { type: "integer", nullable: true, description: "Ausente quando a chamada nem chegou a receber resposta." },
            statusText: { type: "string", nullable: true },
            durationMs: { type: "integer", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        ApiPair: {
          type: "object",
          required: ["key", "value"],
          description: "Par nome/valor. O valor volta vazio quando o nome é de credencial.",
          properties: { key: { type: "string" }, value: { type: "string" } },
        },
        ApiRequestDefinition: {
          type: "object",
          required: ["name", "method", "url"],
          description: "Uma requisição salva. Os campos de credencial não existem aqui de propósito.",
          properties: {
            name: { type: "string", maxLength: 80 },
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
            url: { type: "string", maxLength: 2048 },
            params: { type: "array", items: { $ref: "#/components/schemas/ApiPair" } },
            headers: { type: "array", items: { $ref: "#/components/schemas/ApiPair" } },
            body: { type: "string", maxLength: 65536 },
            auth: {
              type: "object",
              description: "Só o formato da autenticação. Bearer token, senha e valor de API key não têm campo aqui.",
              properties: { type: { type: "string" }, username: { type: "string" }, apiKeyName: { type: "string" }, apiKeyLocation: { type: "string" } },
            },
          },
        },
        ApiCollection: {
          type: "object",
          required: ["id", "name", "requests"],
          properties: {
            id: { type: "string", format: "uuid" },
            applicationId: { type: "string", format: "uuid" },
            name: { type: "string", maxLength: 60 },
            requests: { type: "array", items: { $ref: "#/components/schemas/ApiRequestDefinition" } },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        ApiCollectionRequest: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 60 },
            requests: { type: "array", maxItems: 100, items: { $ref: "#/components/schemas/ApiRequestDefinition" } },
          },
        },
        ApiCollectionEnvelope: { type: "object", required: ["collection"], properties: { collection: { $ref: "#/components/schemas/ApiCollection" } } },
        JourneySummary: {
          type: "object",
          required: ["id", "status", "createdAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            status: { type: "string", enum: ["passed", "failed"] },
            createdAt: { type: "string", format: "date-time" },
            title: { type: "string", description: "Título do primeiro teste do arquivo .spec.ts." },
            durationMs: { type: "integer" },
            tests: {
              type: "object",
              properties: {
                expected: { type: "integer" },
                unexpected: { type: "integer" },
                flaky: { type: "integer" },
                skipped: { type: "integer" },
              },
            },
            applicationId: { type: "string", format: "uuid", nullable: true },
          },
        },
        ApplicationRequest: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 60 },
            baseUrl: { type: "string", format: "uri", description: "Endereço público. Local, privado ou com credencial é recusado com `invalid_target`." },
            environments: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 10 },
          },
        },
        ApiError: {
          type: "object",
          required: ["error", "code"],
          properties: {
            error: { type: "string", description: "Texto de interface em português. Pode mudar sem aviso — não use para decidir comportamento." },
            code: { type: "string", enum: ERROR_CODES, description: "Parte estável do contrato. Determina o status HTTP." },
          },
        },
        Readiness: {
          type: "object",
          required: ["status", "checks"],
          properties: {
            status: { type: "string", enum: ["ready", "not_ready"] },
            checks: {
              type: "object",
              properties: {
                resultsDir: { type: "string", enum: ["ok", "unwritable"], description: "Único que reprova a prontidão." },
                queue: { type: "string", enum: ["ok", "saturated"], description: "Informativo: fila cheia é carga normal." },
                codeMode: { type: "string", enum: ["disabled", "local", "hosted"] },
                active: { type: "integer" },
                queued: { type: "integer" },
                jobs: { type: "integer" },
              },
            },
          },
        },
        ScanRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", format: "uri", description: "Alvo HTTP ou HTTPS. Endereços privados são recusados salvo configuração explícita." },
            applicationId: {
              type: "string",
              format: "uuid",
              description: "Aplicação da própria conta a que a análise pertence. Exige sessão; aplicação de outra conta responde 404.",
            },
            browser: { type: "string", enum: ["chromium", "firefox", "webkit"] },
            failOn: { type: "string", enum: ["error", "warning", "never"] },
            timeoutMs: { type: "integer", maximum: 120000 },
            settleMs: { type: "integer", maximum: 30000 },
            screenshot: { type: "string", enum: ["always", "on-failure", "never"] },
            sitemap: { type: "boolean" },
            maxPages: { type: "integer" },
            accessibility: { type: "boolean" },
            regressionsOnly: { type: "boolean" },
            acceptBaseline: { type: "boolean" },
            project: { type: "string", description: "Exige o histórico habilitado." },
            environment: { type: "string" },
            ignoredStatuses: { type: "string" },
            ignoredUrl: { type: "string", description: "Regex. Desabilitado por padrão no servidor." },
          },
        },
        Scan: {
          type: "object",
          required: ["id", "status", "createdAt", "progress"],
          properties: {
            id: { type: "string", format: "uuid" },
            status: JOB_STATUS,
            createdAt: { type: "string", format: "date-time" },
            queuePosition: { type: "integer", description: "Presente só enquanto o job está na fila." },
            progress: {
              type: "object",
              properties: {
                discoveredPages: { type: "integer" },
                completedPages: { type: "integer" },
                currentUrl: { type: "string" },
                percent: { type: "number" },
                stage: { type: "string" },
              },
            },
            report: { type: "object", description: "Relatório completo; presente quando `status` é `completed`." },
            error: { type: "string", description: "Presente quando `status` é `failed`." },
            screenshotAvailable: { type: "boolean" },
          },
        },
        CreatedScan: {
          allOf: [{ $ref: "#/components/schemas/Scan" }, { type: "object", required: ["accessToken"], properties: { accessToken: { type: "string", description: "Entregue uma única vez." } } }],
        },
        CodeExecution: {
          type: "object",
          required: ["id", "status", "accessToken"],
          properties: {
            id: { type: "string", format: "uuid" },
            status: { type: "string", enum: ["passed", "failed"] },
            report: { type: "object", description: "Relatório JSON do Playwright." },
            failureDetails: { type: "string" },
            accessToken: { type: "string" },
          },
        },
        HttpRequest: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", format: "uri" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], default: "GET" },
            headers: { type: "object", additionalProperties: { type: "string" } },
            body: { type: "string" },
            applicationId: {
              type: "string",
              format: "uuid",
              description:
                "Aplicação da conta onde registrar esta execução. Grava apenas metadado — método, URL já sem credencial, status e duração. Corpo de requisição e de resposta não são gravados. Aplicação de outra conta é ignorada em silêncio: a chamada já saiu e a resposta é devolvida do mesmo jeito.",
            },
          },
        },
        HttpResponse: {
          type: "object",
          required: ["status", "headers", "body", "durationMs"],
          properties: {
            status: { type: "integer" },
            statusText: { type: "string" },
            headers: { type: "object", additionalProperties: { type: "string" } },
            body: { type: "string" },
            bodyTruncated: { type: "boolean", description: "Verdadeiro quando o corpo do alvo passou de 512 KB." },
            durationMs: { type: "integer" },
          },
        },
      },
    },
  };
}
