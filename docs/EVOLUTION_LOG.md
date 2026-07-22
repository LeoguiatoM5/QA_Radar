# QA Radar — Plano e registro de evolução

Este documento é o registro versionado das etapas de evolução do QA Radar. Ele
deve ser atualizado em toda mudança funcional relevante para preservar contexto,
decisões, compatibilidade e evidências de teste.

## Regras obrigatórias de evolução

1. Preservar CLI, dashboard, API, relatórios e GitHub Action já utilizáveis.
2. Não alterar silenciosamente schema JSON, fingerprints, exit codes ou quality gate.
3. Integrar motores externos por adaptadores, normalizando os resultados no modelo
   atual de `Issue`.
4. Evitar diagnósticos duplicados entre heurísticas próprias e motores externos.
5. Manter integrações novas opcionais quando exigirem serviços pesados, credenciais
   ou dependências externas.
6. Nunca enviar segredos, cookies, tokens, páginas privadas ou dados pessoais para
   serviços de IA sem configuração e consentimento explícitos.
7. Cada etapa deve incluir testes unitários, integração proporcional ao risco,
   typecheck, build e registro dos resultados neste documento.
8. Mudanças de contrato exigem versão, migração documentada e teste de consumidor.

## Gate mínimo antes de concluir uma etapa

```text
npm run check
npm run test:integration
git diff --check
```

Quando aplicável, também são obrigatórios benchmark, Docker build, teste do pacote,
validação da GitHub Action e homologação controlada. Uma falha encontrada em teste
real deve gerar teste de regressão antes da correção ser considerada concluída.

## Estado preservado

- Scanner Playwright em Chromium, Firefox e WebKit.
- CLI e dashboard web.
- Observação de JavaScript, console, HTTP, rede e navegação.
- Inspeções DOM complementares e evidências anotadas.
- Performance de laboratório em modo rápido.
- Relatórios HTML, JSON, JUnit e SARIF.
- Schema JSON `1.0`, fingerprints, baselines e regressões.
- Histórico local por projeto e ambiente.
- Sitemap, fila, progresso, cancelamento e rate limit.
- GitHub Action e execução em CI/CD.

## Ordem de evolução

### E1 — axe-core

Objetivo: substituir heurísticas de acessibilidade sobrepostas por auditoria WCAG
automatizada, preservando verificações complementares do QA Radar.

Estado: implementado localmente, aguardando revisão/commit.

Decisões:

- `axe-core` é dependência de produção e roda dentro da página controlada pelo
  Playwright.
- A execução respeita a CSP da aplicação; a injeção do motor não depende de
  `script-src` permissivo.
- Regras `critical` e `serious` são erros; demais impactos são avisos.
- Elementos da mesma regra são agrupados e contabilizados para evitar repetição.
- Imagens quebradas e IDs duplicados permanecem como regras complementares.

Validações executadas em 2026-07-22:

- `npm run check`: aprovado — 50 testes, typecheck e build.
- suíte completa de integração: aprovada — 8 testes, incluindo CSP restritiva.
- teste real em `https://www.cantinhodasqas.com.br`: axe executado e achados
  repetidos agrupados; relatório reprovado corretamente pelo quality gate.

Antes de concluir E1: revisar o diff e decidir commit/release com o usuário.

### E2 — jornadas Playwright e autenticação

Objetivo: executar jornadas completas e ambientes autenticados.

Escopo planejado:

- schema versionado de jornada;
- navegação, clique, preenchimento, seleção, espera e assert;
- autenticação por `storageState` e secrets protegidos;
- allowlist de ações e bloqueio de operações destrutivas;
- evidência antes/depois de cada etapa;
- timeout, cancelamento e relatório por passo.

Compatibilidade: a análise segura atual por URL continuará sendo o modo padrão.

#### 2026-07-22 — contrato seguro de jornada 1.0

- Objetivo: criar a fundação versionada antes de executar ações reais.
- Contrato isolado do scanner e ainda não exposto na CLI ou dashboard.
- Ações declarativas permitidas; execução arbitrária de JavaScript é rejeitada.
- Máximo de 50 passos e campos desconhecidos rejeitados.
- Secrets referenciados somente por variáveis `QA_RADAR_SECRET_*`.
- Cliques com indicadores destrutivos exigem `allowDestructive: true` explícito.
- Validação: `npm run check` aprovado com 54 testes, typecheck e build;
  `npm run test:integration` aprovado com 8 testes; `git diff --check` aprovado.
- Próximo passo: implementar o executor Playwright com origem, timeout,
  cancelamento e evidência por passo, mantendo o scanner atual como padrão.

#### 2026-07-22 — executor Playwright isolado

- Executa o contrato validado sem alterar scanner, CLI, API ou `ScanReport`.
- Suporta navegação, clique, preenchimento, seleção, espera e asserts.
- Restringe navegação a uma lista explícita de origens autorizadas.
- Resolve secrets por mapa externo e não inclui seus valores no resultado.
- Aplica timeout por ação, para no primeiro erro e observa `AbortSignal`.
- Resultado de jornada possui contrato próprio `1.0` e duração por passo.
- Validação: `npm run check` aprovado com 54 testes, typecheck e build;
  `npm run test:integration` aprovado com 11 testes; `git diff --check` aprovado.
- Próximo passo: evidências seguras por passo, com proteção para campos secretos,
  antes de expor jornadas na CLI.

#### 2026-07-22 — evidências seguras por passo

- Diretório de evidências é opcional e não altera execuções existentes.
- Cada passo gera screenshot anterior e posterior com nome determinístico.
- Campos preenchidos por secret são desfocados nas capturas posteriores.
- A máscara é temporária e o estilo original do elemento é restaurado.
- Paths das evidências entram apenas no contrato próprio da jornada.
- Validação: 54 testes, 11 integrações Playwright, typecheck, build e diff aprovados.
- Próximo passo: carregar jornada JSON pela CLI em modo explicitamente opt-in.

#### 2026-07-22 — jornadas disponíveis na CLI

- Nova opção opt-in `--journey <arquivo.json>`; execução padrão permanece igual.
- Browser e modo headed reutilizam as opções existentes.
- Secrets são lidos somente de `QA_RADAR_SECRET_*`.
- Relatório `journey-report.json` e `journey-evidence/` permanecem separados do
  schema do scanner.
- Combinações com sitemap, baseline, regressões e histórico são rejeitadas nesta fase.
- Exemplo público não destrutivo disponível em `examples/journey-smoke.json`.
- Validação: 55 testes, 12 integrações Playwright, typecheck, build e diff aprovados.
- Teste manual público: jornada `examples/journey-smoke.json` aprovada em
  `https://www.cantinhodasqas.com.br`, com 2 passos, relatório JSON e 4 evidências.
- Próximo passo: teste manual em ambiente controlado e, depois, desenho seguro da interface.

#### 2026-07-22 — dashboard experimental de jornadas

- Ativação exclusiva por `QA_RADAR_ENABLE_JOURNEYS=true`; padrão permanece desligado.
- API separada `/api/journeys`, com rate limit e apenas uma jornada simultânea.
- Proteção de destinos públicos aplicada a todas as requisições quando destinos
  privados não estiverem explicitamente habilitados.
- Secrets permanecem apenas nas variáveis do processo do servidor e não são
  recebidos pelo navegador.
- Resultado por passo e links para evidências são exibidos em painel separado.
- Paths internos são removidos da resposta pública.
- Validação: 56 testes, 13 integrações Playwright, typecheck, build e diff aprovados.
- Próximo passo: validação manual local do dashboard antes de qualquer expansão.

### E3 — Lighthouse

Objetivo: adicionar auditoria completa de performance e boas práticas sem remover o
modo rápido atual antes de comparação de custo, precisão e estabilidade.

Escopo planejado:

- adaptador Lighthouse opcional;
- normalização sem duplicar Web Vitals já capturados;
- artefato bruto preservado e resumo no relatório atual;
- limites de tempo, memória e concorrência;
- testes comparando modo rápido e auditoria completa.

### E4 — OWASP ZAP

Objetivo: adicionar análise de segurança dinâmica controlada.

Escopo planejado:

- baseline/passive scan primeiro;
- execução isolada e opcional, preferencialmente em container;
- limites de alvo, duração e recursos;
- proibição inicial de ataques ativos em produção;
- normalização por risco, evidência e referência CWE/OWASP;
- testes com aplicação vulnerável local e fixture previsível.

### E5 — IA para apoio ao diagnóstico

Objetivo: resumir achados determinísticos, correlacionar sintomas e sugerir caminhos
de investigação. A IA não será a fonte primária de detecção nem decidirá sozinha o
quality gate.

Escopo planejado:

- provedor configurável e recurso desabilitado por padrão;
- redação/remoção de segredos e dados pessoais;
- resposta estruturada e rastreável aos achados de origem;
- cache, limites de custo, timeout e fallback sem IA;
- avaliação contra corpus fixo para medir alucinações e utilidade.

### E6 — plataforma e colaboração

- PostgreSQL para projetos, ambientes, execuções, issues e baselines.
- Armazenamento compatível com S3 para artefatos.
- Redis para fila e agendamentos distribuídos quando necessário.
- Projetos, equipes, organizações, papéis e isolamento por tenant.
- Testes agendados, alertas e webhooks.
- GitHub, Jira, Slack e integrações CI/CD.
- Tendências, regressões após deploy e ciclo de vida dos defeitos.

Dependência obrigatória: autenticação, autorização, auditoria, backup e restauração
devem existir antes de habilitar dados compartilhados em produção.

## Regra permanente de CI/CD

Toda evolução deve verificar antes da entrega:

- GitHub Actions: `npm ci`, `npm run check`, integração Playwright, composite
  action, relatórios JUnit/SARIF e empacotamento da release;
- GitLab CI/CD: instalação reproduzível, testes, integração Playwright,
  publicação de JUnit/SARIF e preservação dos códigos de saída do quality gate;
- compatibilidade dos nomes e caminhos de artefatos públicos.

O repositório possui workflows completos para GitHub Actions e uma configuração
equivalente em `.gitlab-ci.yml`. A declaração de suporte oficial ao GitLab fica
condicionada à homologação do primeiro pipeline em uma instância GitLab real.

### 2026-07-22 — Hardening de acessibilidade e jornadas

- Objetivo: preservar compatibilidade do scanner e fechar riscos encontrados na
  inspeção geral antes de avançar para Lighthouse e OWASP ZAP.
- Arquivos/contratos afetados: opções do scanner, CLI/dashboard, executor de
  jornadas, retenção do servidor, pacote npm e documentação.
- Decisões e compatibilidade: `axe-core` tornou-se opt-in por
  `--accessibility`; jornadas continuam experimentais e desabilitadas por padrão.
- Segurança: navegações e redirects para origens não autorizadas são abortados
  antes do destino; controles são inspecionados antes de cliques destrutivos;
  nomes e valores de secrets são removidos de erros.
- Recursos: scans e jornadas não disputam simultaneamente a capacidade local e
  evidências de jornada seguem o mesmo prazo de retenção dos scans.
- Testes adicionados: compatibilidade do axe, redirect entre origens, inspeção
  destrutiva, redação de secret e expiração de evidências.
- Validação: `npm test`, integração Playwright, typecheck, build e pacote npm.
- Próximo passo: homologação local pela interface antes da etapa Lighthouse.

### 2026-07-22 — E3.1 Lighthouse local pela CLI

- `lighthouse@12.6.1` foi fixado por ser compatível com Node 20 e não apresentar
  vulnerabilidades no `npm audit`; 12.8.2 carregava uma cadeia moderada de
  Sentry/OpenTelemetry e a versão 13 exige Node 22.19.
- Execução opt-in por `--lighthouse`, somente Chromium e incompatível com jornadas.
- Web Vitals rápidos continuam sendo a fonte das regras específicas; Lighthouse
  adiciona apenas alertas de categoria para evitar duplicidade.
- Resultado bruto preservado em `report.lighthouse.json` e resumo incorporado ao
  JSON, HTML e console do QA Radar.
- Servidor público permanece bloqueado nesta fase; liberar exige isolamento de
  rede, timeout, memória e concorrência homologados.
- Testes: adaptador determinístico, contrato CLI, integração local real e execução
  manual contra `example.com`; workflow GitHub Actions preparado com job isolado.
- Próximo passo: executar a integração no GitHub Actions e, depois, desenhar o
  isolamento necessário para oferecer Lighthouse na interface local.

### 2026-07-22 — E3.2 Diagnósticos Lighthouse acionáveis

- Alertas agregados como `SEO: 82/100` deixaram de ser ocorrências; a pontuação
  continua disponível apenas como resumo.
- Cada ocorrência agora representa uma auditoria concreta, com causa, valor
  observado, recurso ou seletor quando disponível e link oficial clicável.
- Diagnósticos frequentes ganharam orientação em português; auditorias sem
  tradução preservam o texto original do Lighthouse sem inventar conclusões.
- Métricas rápidas e erros de console já capturados pelo scanner são excluídos
  da normalização Lighthouse para evitar duplicidade.
- Homologação real em `https://www.cantinhodasqas.com.br/`: nota SEO 82 gerou
  causas específicas para meta description e imagens sem `alt`, sem alerta
  genérico de categoria.

### 2026-07-22 — Diagnóstico específico de CORS

- Mensagens de console CORS agora informam destino, origem solicitante,
  cabeçalho recebido, impacto e responsabilidade pela correção.
- Telemetria conhecida do Google Play é classificada como aviso, sem afirmar que
  a funcionalidade principal está quebrada.
- A falha de rede equivalente é correlacionada e removida para não duplicar a
  ocorrência CORS mais informativa.
- Referência MDN incluída no JSON, console, HTML e SARIF.

### 2026-07-22 — Preparação da versão 3.1.0 e GitLab CI/CD

- Objetivo: consolidar acessibilidade, jornadas e Lighthouse em uma versão
  identificável, preservando os contratos existentes e a integração contínua.
- Arquivos/contratos afetados: versão do pacote, CLI/relatórios, documentação,
  smoke da composite action e novo `.gitlab-ci.yml`.
- Decisões e compatibilidade: o consumer smoke de `@v3` continua validando
  `3.0.1` até a publicação efetiva de `v3.1.0`; schema JSON permanece em `1.0`.
- GitLab: jobs separados para validação, Playwright, Lighthouse, smoke com
  JUnit/SARIF e empacotamento npm; artefatos são preservados por sete dias.
- Segurança: ambientes e credenciais reais devem usar variáveis protegidas e
  mascaradas; o smoke padrão acessa apenas `https://example.com`.
- Comandos executados e resultados: `npm run check` (61 testes),
  `npm run test:integration` (16 testes), `npm run test:lighthouse` (1 teste),
  `npm audit --omit=dev` (0 vulnerabilidades), `npm pack --dry-run` e build da
  imagem `qa-radar:3.1.0-test`; o container confirmou a versão e UID `1001`.
- Homologação pendente: executar o primeiro pipeline em um projeto GitLab antes
  de declarar suporte oficial e atualizar exemplos de consumidores.

### 2026-07-22 — Promoção do canal estável v3 para 3.1.0

- Objetivo: atualizar o alias consumido pela composite action sem alterar a
  referência principal `v3` usada pelos projetos integrados.
- Pré-condições: release `v3.1.0` publicada, pacote anexado e CI da tag aprovado.
- Compatibilidade: schema JSON permanece em `1.0`; o smoke consumidor passa a
  exigir a versão `3.1.0`, regressões vazias e todos os formatos de relatório.
- Rollback: restaurar o alias anotado `v3` para o commit da release `v3.0.1` se
  o smoke da action publicada falhar.

### 2026-07-22 — Hardening do servidor público antes do Render

- Objetivo: reduzir exposição de relatórios e abuso de recursos sem habilitar
  funcionalidades experimentais no serviço público.
- Decisão: Turnstile foi adiado explicitamente e não faz parte desta entrega.
- Controle de acesso: token aleatório de 256 bits por scan, hash SHA-256 no disco,
  cookie `HttpOnly`/`SameSite=Strict` na UI e suporte a Bearer para clientes API.
- Recursos: timeout global configurável, com três minutos no Blueprint Render;
  expiração e limite de concorrência existentes foram preservados.
- Rede: faixas reservadas adicionais são bloqueadas e mudanças de resolução do
  mesmo hostname durante o scan encerram a requisição como possível rebinding.
- Artefatos: respostas privadas sem cache/referrer; HTML recebe CSP sandbox.
- Compatibilidade: criação continua pública e retorna `accessToken`; leitura,
  cancelamento e artefatos agora exigem o token. Schema dos relatórios permanece
  em `1.0`; jornadas e histórico seguem desabilitados no Render.
- Validação: `npm run check` (64 testes), `npm run test:integration` (16 testes),
  `npm run test:lighthouse` (1 teste real), `npm audit --omit=dev` (0
  vulnerabilidades) e imagem Docker executada com UID `1001`.
- Deploy: nenhuma publicação no Render foi realizada nesta etapa.

### 2026-07-22 — Hardening de Jornadas para futura homologação

- Objetivo: remover o bloqueio técnico para testar Jornadas no Render sem
  transformar a ferramenta em uma plataforma paralela ao scanner.
- Contrato: `POST /api/journeys` cria job assíncrono; `GET /api/journeys/:id`
  acompanha; `POST /api/journeys/:id/cancel` interrompe com `AbortSignal`.
- Segurança: token de 256 bits por jornada, hash no disco, Bearer no polling e
  cookie `HttpOnly` para evidências; respostas removem paths internos.
- Limites preparados no Blueprint: 10 passos, payload de 16 KiB e timeout global
  de 120 segundos. Apenas uma jornada ou scan usa o navegador por vez.
- Secrets: continuam apenas em `QA_RADAR_SECRET_*`, são desfocados nas capturas e
  removidos de erros; valores não entram em logs operacionais.
- Validação: `npm run check` (66 testes), `npm run test:integration` (17 testes),
  Lighthouse real, `npm audit` sem vulnerabilidades e imagem Docker com UID 1001.
- Decisão operacional: `QA_RADAR_ENABLE_JOURNEYS` continua ausente do Render;
  Turnstile permanece adiado e nenhum deploy é autorizado por esta etapa.

### 2026-07-22 — Preparação da homologação de Jornadas no Render

- Objetivo: disponibilizar a aba Jornadas no próximo deploy manual para executar
  o roteiro de homologação do recurso assíncrono.
- Configuração: o Blueprint passa a definir `QA_RADAR_ENABLE_JOURNEYS=true` e
  preserva os limites de 10 passos, 16 KiB e 120 segundos.
- Segurança: tokens, bloqueio de rede privada, redaction de secrets, fila única
  e proteção de artefatos permanecem obrigatórios; Turnstile continua adiado.
- Risco operacional: uma jornada abre Chromium no plano Free e deve ser
  acompanhada por logs, memória, fila e possíveis reinícios/OOM.
- Deploy: a mudança somente prepara o Blueprint. O deploy permanece manual e
  deve ser executado pelo usuário após integração do PR.
- Homologação pendente: desktop/mobile, ações permitidas, polling, conclusão,
  cancelamento, timeout, tokens, evidências, expiração e SSRF/redirect privado.

### 2026-07-22 — Correção do início de Jornadas no Render

- Problema observado: o primeiro login real no SauceDemo foi rejeitado antes da
  execução porque Jornadas sem `maxPages` herdavam o padrão de 20 páginas, acima
  do limite 5 configurado no Render.
- Causa: a validação de `maxSitemapPages` era aplicada mesmo sem `sitemap`.
- Correção: o teto de páginas agora é validado somente em scans com cobertura
  por sitemap; o contrato HTTP do dashboard permanece inalterado.
- Teste de regressão: o servidor de Jornadas usa limite de sitemap 5 e aceita a
  criação sem enviar `maxPages`.
- Evidência: com o contorno temporário `maxPages: 5`, o login público no
  SauceDemo concluiu cinco passos e foi aprovado; o dashboard requer novo deploy
  para receber a correção definitiva.

## Modelo para registrar próximas etapas

```markdown
### AAAA-MM-DD — Ex

- Objetivo:
- Arquivos/contratos afetados:
- Decisões e compatibilidade:
- Riscos:
- Testes adicionados:
- Comandos executados e resultados:
- Teste manual/homologação:
- Pendências e próximo passo:
```
