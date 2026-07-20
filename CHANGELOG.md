# Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo.

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
