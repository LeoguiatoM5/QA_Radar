# Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo.

## [Não publicado]

### Adicionado

- **Autenticação por GitHub OAuth (opcional).** Entrar passa a dar dono e
  histórico às análises, e libera a execução hospedada do Modo Jornada sem token
  administrativo. Sem `QA_RADAR_GITHUB_CLIENT_ID`/`QA_RADAR_GITHUB_CLIENT_SECRET`
  a entrada não aparece e o produto segue anônimo.
- **Isolamento por conta.** Análise criada por quem está logado pertence à conta;
  o dono a consulta sem apresentar o token. Análise anônima continua acessível
  apenas pelo token, inclusive para quem está logado. Novo `GET /api/v1/scans`
  devolve somente o histórico de quem pediu.
- **Persistência opcional em PostgreSQL** (`QA_RADAR_DATABASE_URL`): o registro
  das análises sobrevive ao reinício, análises interrompidas por uma instância
  encerrada são fechadas como falha com o motivo, e as que ficaram na fila são
  retomadas no boot seguinte. Migrations versionadas aplicadas antes da porta
  abrir.
- **Artefatos duráveis opcionais** em armazenamento compatível com S3
  (`QA_RADAR_STORAGE_*`): relatórios, screenshots e vídeos deixam de morrer com
  o contêiner. O disco continua sendo lido primeiro.
- **`Idempotency-Key` em `POST /api/scans`**: repetir a criação com a mesma
  chave e o mesmo corpo devolve a análise existente em vez de enfileirar outra.
  Com `QA_RADAR_ACCESS_TOKEN_SECRET`, a repetição também reemite o token de
  acesso após um reinício, sem que ele seja gravado em lugar nenhum.
- **`GET /ready`**: prontidão da instância, com detalhe por dependência
  (`database`, `artifacts`, `resultsDir`, `queue`, `codeMode`).
- **Contrato OpenAPI 3.1** publicado pela própria instância em
  `GET /api/v1/openapi.json`, gerado a partir do código.
- **Código estável em toda resposta de erro** (`{ error, code }`), documentado
  no README e no OpenAPI.

- Tokens aleatórios por análise para proteger consulta, cancelamento e download
  de relatórios, com hash persistido durante a retenção e cookie `HttpOnly` na UI.
- Timeout global do servidor e bloqueio de mudanças de resolução DNS durante uma
  análise pública.
- Relatório HTML de evidências do Modo Jornada de Playwright, com identidade do
  QA Radar, responsável, tipo de teste, passos, descrição por passo (editável,
  derivada do `.spec.ts`) e capturas Antes/Depois.
- Runner de sandbox hospedado (Docker) para execução isolada de `.spec.ts`:
  protocolo assinado por HMAC, container descartável por job, rootfs somente
  leitura e proxy de egress público que bloqueia rede privada e metadata.
  Permanece desabilitado por padrão (`QA_RADAR_ENABLE_CODE_MODE=false`) até uma
  instância dedicada ser publicada.
- Captura de screenshot real por passo na execução local do Modo Jornada de
  Playwright, sobrescrevendo o fixture `page` do Playwright Test.
- Nova aba "Testes de API" (`/api-tests`), separada da Jornada: cliente HTTP
  interativo no estilo Postman (método, URL, headers, corpo), com resposta
  exibida imediatamente via um novo endpoint `POST /api/http-request` que
  faz a chamada a partir do servidor (evita CORS) e revalida a proteção
  contra redes privadas a cada redirecionamento seguido, não só na URL
  inicial. Variáveis reutilizáveis (`{{nome}}`) e a collection de
  requisições salvas ficam no `localStorage` do navegador, com
  exportação/importação em JSON.
- Suporte a passos de API (`request.get/post/put/patch/delete/head/fetch`)
  dentro de um `.spec.ts` do Modo Jornada de Playwright: reconhecidos como
  passo nomeado, com método, URL, status e corpo da requisição/resposta
  capturados como evidência (execução local), da mesma forma que a
  screenshot por passo já existente.

### Alterado

- **A API passou a ser servida sob `/api/v1`.** O prefixo antigo `/api/...`
  continua funcionando como alias, e caminhos devolvidos pela API (cookie de
  acesso, URL de relatório) acompanham o prefixo com que a requisição chegou.

- Artefatos agora usam política sem cache, sem referrer e sandbox para HTML.
- Faixas IPv4 reservadas adicionais passaram a ser bloqueadas pela proteção SSRF.
- Inspeção e Jornadas agora compartilham o mesmo padrão de cabeçalho funcional,
  largura e cards; a apresentação do produto permanece concentrada na Home.
- O CI agora valida as páginas principais em um viewport mobile de 390×844,
  incluindo overflow horizontal, hierarquia de títulos e controles fora da tela.
- A única experiência de automação do produto passou a ser o Modo Jornada de
  Playwright baseado em arquivos `.spec.ts` reais (Codegen, editar, importar,
  exportar, executar); o formulário visual e o modelo de jornada declarativa em
  JSON foram removidos da Home, da documentação e de `/journeys`. O executor
  JSON permanece no código como legado desabilitado, sem exposição na interface.
- Jornadas do dashboard agora são jobs assíncronos protegidos por token, com
  consulta, cancelamento, timeout global e limites próprios de passos/payload.
- Evidências do Modo Jornada exigem autorização e não expõem caminhos internos;
  relatórios baixados embutem screenshots e vídeo como base64 (data URI),
  ficando 100% autocontidos offline.
- `server.ts` foi dividido em módulos de rotas (`src/routes/*.ts`), `src/env.ts`,
  `src/http-helpers.ts` e stores dedicados por domínio, sem mudança de contrato
  HTTP: headers, cookies, CSP e mensagens de erro preservados.

### Breaking

Mudanças de contrato nesta versão. Nenhuma afeta a CLI; todas são da API HTTP e
do endpoint de saúde.

- **`GET /health` não reprova mais por diretório de resultados não gravável.**
  Ele passou a ser apenas vivacidade do processo e responde `200` enquanto o
  servidor atender. Quem monitorava disco por esse endpoint deve passar a usar
  `GET /ready`, que reporta cada dependência e é o novo `healthCheckPath` no
  Blueprint do Render.
- **Exceções não previstas respondem `500` em vez de `400`**, com mensagem
  genérica. Antes, qualquer falha interna virava `400` com a mensagem original,
  classificando bug do servidor como erro do cliente e expondo detalhe de
  implementação. A mensagem real agora vai para o log, em `request.failed`.
- **`POST /api/scans/{id}/cancel` responde `202` ao cancelar uma análise já
  cancelada**, em vez de `409`. Cancelar uma que concluiu ou falhou continua
  respondendo `409`.
- **Corpo de requisição acima do limite responde `413`** em vez de `400`.
- **Recurso desabilitado no servidor responde `403`** em vez de `400` nos casos
  de histórico por projeto e de filtros regex personalizados.
- **A execução hospedada do Modo Jornada não pede mais o token administrativo a
  usuários.** Uma sessão autenticada satisfaz o mesmo gate, e a interface passou
  a oferecer entrada em vez de um campo de token. O
  `QA_RADAR_CODE_MODE_ADMIN_TOKEN` continua válido para automação, mas deixou de
  ser armazenado no navegador; a mensagem do `401` mudou.

### Corrigido

- O valor inicial de páginas do sitemap agora respeita o limite configurado no
  servidor, evitando que a validação nativa bloqueie o Scanner no Render.
- A geração do relatório de Jornada renova o cookie protegido antes de abrir o
  HTML, evitando falhas intermitentes de autorização em nova aba.
- Jornadas no dashboard deixam de herdar o limite padrão de páginas do sitemap
  quando a cobertura multipágina não está habilitada.
- O botão de cancelamento substitui temporariamente o botão de execução e deixa
  de permanecer visível junto ao resultado concluído.
- O vídeo de cada passo travava em 0:00 porque a rota de artefato não enviava
  `Content-Length`, forçando `chunked` e quebrando a detecção de duração do
  Chrome.
- O download do relatório de evidências falhava silenciosamente porque a CSP
  `sandbox` não tinha o token `allow-downloads` exigido pelo Chrome moderno.
- A mesma screenshot final aparecia duplicada como Antes/Depois em todos os
  passos; corrigido para capturar uma screenshot real por passo.

## [3.1.0] - 2026-07-22

### Adicionado

- Auditoria de acessibilidade com `axe-core`, normalizada no mesmo modelo de
  issues, evidências, fingerprints e quality gate do QA Radar.
- Jornadas Playwright declarativas e experimentais pela CLI e pelo dashboard
  local, com evidências antes/depois e secrets somente por variáveis de ambiente.
- Adaptador Lighthouse experimental e opt-in pela CLI, com resumo normalizado e
  preservação do relatório bruto.
- Testes de contrato do schema JSON `1.0` e de incompatibilidade de baselines
  antigos.
- Teste do ciclo de retenção, incluindo remoção do job e evento
  `scan.expired`.
- Progresso de páginas na API e no dashboard, com total descoberto, página
  atual, quantidade concluída e percentual monotônico.
- Posição atual na fila para jobs aguardando, exibida também no dashboard.
- Etapa atual da execução na API e no dashboard, da descoberta do sitemap à
  geração dos relatórios.
- Cancelamento de análises em fila ou em execução, com encerramento do
  navegador, liberação da concorrência e telemetria `scan.cancelled`.

### Alterado

- Auditoria `axe-core` passou a ser opt-in para não alterar silenciosamente os
  quality gates existentes (`--accessibility` ou opção equivalente na interface).
- Jornadas agora bloqueiam redirecionamentos para origens não autorizadas antes
  da requisição, inspecionam controles destrutivos e expiram seus artefatos.
- Diagnósticos Lighthouse agora apontam auditorias específicas com orientação,
  evidência e referência, sem alertas genéricos por nota nem duplicação do scanner.

- Eventos do navegador, métricas de performance, inspeção DOM, correlação e
  anotação de evidências extraídos de `scanner.ts` para módulos dedicados,
  sem mudança no comportamento do scanner.
- Estrutura HTML, estilos e comportamento do dashboard extraídos de
  `web-page.ts` para módulos dedicados, com testes próprios dos componentes.
- Estado, ordenação e transições da fila extraídos de `server.ts` para um
  módulo dedicado e testável.
- Política e estado do rate limit extraídos de `server.ts` para um módulo
  dedicado, com testes de isolamento e renovação da janela.

## [3.0.1] - 2026-07-20

### Corrigido

- Remove o cache npm da composite action, pois o `actions/setup-node` não
  resolve o lockfile quando uma action remota é instalada fora do workspace do
  projeto consumidor.

### Adicionado

- Smoke test manual que consome `LeoguiatoM5/QA_Radar@v3`, cria um baseline e
  valida uma segunda execução em modo `regressions-only`.

## [3.0.0] - 2026-07-20

### Adicionado

- Schema JSON `1.0`, IDs de regra e fingerprints estáveis para os achados.
- Baselines, classificação de regressões e quality gate restrito a problemas novos.
- Histórico local por projeto e ambiente, com promoção controlada de baseline.
- Relatórios JUnit XML e SARIF 2.1, annotations e composite action para GitHub Actions.
- Métricas de performance de laboratório para TTFB, FCP, LCP, CLS e eventos de carregamento.
- Cobertura multipágina por `sitemap.xml`, relatórios por página e resultado consolidado.
- Dashboard com métricas, regressões, histórico e downloads dos novos formatos.
- Benchmark reproduzível de sitemap com 20 páginas.
- CI multiplataforma, integração Playwright e smoke test da composite action.
- Workflow de release com validação de tag, pacote npm e GitHub Release.

### Alterado

- Falhas instáveis de navegação agora produzem relatórios parciais e reprovados.
- O relatório JSON passa a exigir `schemaVersion`, `ruleId` e `fingerprint`.
- O dashboard e a CLI exibem status de execução, escopo do gate e comparações de baseline.

### Segurança

- Descoberta de sitemap valida protocolo, origem, redirects, tamanho e destinos públicos.
- Histórico web permanece desabilitado por padrão até existir autenticação e isolamento multiusuário.

### Migração

- Integrações que consomem o relatório JSON devem aceitar o schema `1.0` e os novos campos obrigatórios.
- Workflows publicados devem apontar para a tag major `@v3`.
