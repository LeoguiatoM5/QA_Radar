# Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo.

## [Não publicado]

### Adicionado

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

- Eventos do navegador, métricas de performance, inspeção DOM, correlação e
  anotação de evidências extraídos de `scanner.ts` para módulos dedicados,
  sem mudança no comportamento do scanner.
- Estrutura HTML, estilos e comportamento do dashboard extraídos de
  `web-page.ts` para módulos dedicados, com testes próprios dos componentes.
- Estado, ordenação e transições da fila extraídos de `server.ts` para um
  módulo dedicado e testável.

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
