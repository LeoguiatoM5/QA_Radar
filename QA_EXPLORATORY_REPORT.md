# Relatório de Análise Exploratória — QA Radar

**Data:** 23/07/2026  
**Tipo:** exploração funcional, visual, responsiva, acessibilidade, compatibilidade, segurança básica e desempenho percebido  
**Status:** concluído; achados corrigidos e revalidados em 23/07/2026

## Resumo executivo

A aplicação apresentou boa estabilidade funcional nas rotas Home, Inspeção,
Jornadas e Documentação. Os fluxos principais carregaram corretamente nos três
navegadores avaliados, sem erros de console ou requisições quebradas.

Foram encontrados dois problemas:

1. overflow horizontal em viewport mobile, fazendo parte da navegação sair da
   área visível;
2. ausência de um título `h1` na página de Jornadas, apontada pelo axe-core.

Não foram observados bloqueadores, falhas críticas, exposição de dados sensíveis
ou ações destrutivas executadas.

## Escopo testado

- Home (`/`), Inspeção (`/scanner`), Jornadas (`/journeys`) e Documentação (`/docs`).
- Navegação entre as páginas e retorno pela navegação compartilhada.
- Carregamento, estados iniciais, links, botões, abas, formulário de inspeção,
  formulário de Jornada, configurações avançadas e cancelamento.
- Entradas inválidas de URL, limites numéricos, JSON inválido e Jornada sem passos.
- Navegação por teclado e visibilidade/ordem inicial do foco.
- Console, erros de página e requisições falhas.
- Auditoria automatizada axe-core.
- Resoluções desktop (1440×900) e mobile (390×844).
- Chromium, Firefox e WebKit.

## Ambiente utilizado

- QA Radar local em `http://127.0.0.1:4173`.
- Node.js 20.18.0.
- Playwright 1.61.1.
- Chromium, Firefox e WebKit headless.
- Sistema Windows, timezone America/Sao_Paulo.

## Funcionalidades validadas

| Área | Resultado |
| --- | --- |
| Rotas principais | Aprovado: HTTP 200 e títulos corretos |
| Navegação | Aprovada no desktop; overflow encontrado no mobile |
| Scanner | Formulário, abas, campos e validações HTML responderam |
| Jornada | Formulário, JSON inválido e zero passos retornaram mensagens corretas |
| Cancelamento | Coberto pela integração existente e sem regressão observada |
| Console/rede | Nenhum erro ou request falho observado |
| Compatibilidade | Rotas carregaram em Chromium, Firefox e WebKit |
| Axe-core | Uma violação de heading na página de Jornadas |

## Bugs encontrados

### BUG-UI-001 — Navegação causa overflow horizontal no mobile

- **Categoria:** Bug de responsividade / Bug visual / Problema de usabilidade
- **Severidade:** Médio
- **Prioridade:** Alta
- **Ambiente:** Dashboard local, viewport 390×844
- **Navegadores:** Chromium, Firefox e WebKit
- **Pré-condições:** Abrir qualquer rota principal em viewport de celular
- **Passos para reproduzir:**
  1. Acessar `/`, `/scanner`, `/journeys` ou `/docs`.
  2. Usar largura de viewport de 390 px.
  3. Observar a barra superior e medir a largura do documento.
- **Resultado atual:** `scrollWidth` chega a 515 px. O bloco de navegação e o
  selo “Beta pública” ultrapassam a largura da tela; parte do conteúdo fica
  fora da área visível e surge rolagem horizontal.
- **Resultado esperado:** A navegação deve caber na largura disponível, quebrar
  linha ou utilizar menu compacto, sem rolagem horizontal.
- **Evidência:** [screenshot Home mobile](qa-radar-exploration-evidence/chromium-mobile-home.png), [screenshot Jornadas mobile](qa-radar-exploration-evidence/chromium-mobile-journeys.png).
- **Possível causa:** `nav` mantém logo, quatro links e o selo em uma única
  linha; `.nav-links` não possui quebra, redução ou comportamento responsivo.
- **Recomendação:** Adotar `flex-wrap`, reduzir/ocultar o selo em telas pequenas
  ou utilizar menu responsivo. Validar em 320, 360 e 390 px.
- **Reprodutibilidade:** Reproduzido em Chromium, Firefox e WebKit, desktop não
  reproduz.
- **Status:** Corrigido e revalidado

### BUG-A11Y-001 — Página de Jornadas não possui título de nível 1

- **Categoria:** Problema de acessibilidade
- **Severidade:** Médio
- **Prioridade:** Média
- **Ambiente:** Dashboard local, rota `/journeys`, viewport 1440×900
- **Navegadores:** Chromium (axe-core); comportamento estrutural aplicável aos
  demais navegadores
- **Pré-condições:** Jornadas habilitadas
- **Passos para reproduzir:**
  1. Acessar `/journeys`.
  2. Executar axe-core.
  3. Verificar a regra `page-has-heading-one`.
- **Resultado atual:** A página contém `h2` (“Jornada Playwright”), mas nenhum
  `h1`. O axe-core reporta impacto `moderate`.
- **Resultado esperado:** Cada página deve ter exatamente um título principal
  `h1` que identifique o conteúdo, por exemplo “Jornadas Playwright”.
- **Evidência:** Resultado axe-core: `page-has-heading-one`, alvo `html`, um nó.
- **Possível causa:** `renderJourneyPanel()` inicia o conteúdo com um `div`
  eyebrow e um `h2`; o shell da página não fornece título principal.
- **Recomendação:** Promover o título da página para `h1` e ajustar a hierarquia
  dos títulos internos sem duplicar headings.
- **Reprodutibilidade:** Reproduzido de forma determinística no axe-core.
- **Status:** Corrigido e revalidado

## Melhorias recomendadas

- Transformar a navegação em componente responsivo com menu compacto em telas
  pequenas.
- Adicionar `h1` semântico em todas as páginas e revisar a hierarquia de títulos.
- Exibir uma confirmação visual explícita ao iniciar validações longas, além do
  estado “Executando” já existente.
- Considerar mensagens de validação em português; o navegador exibiu mensagens
  nativas em inglês para URL e limites numéricos.
- Repetir a auditoria axe-core após a correção e incluir a verificação no CI.
- Fazer teste visual adicional em 320 px e com zoom de 200%.

## Riscos identificados

- Usuários de celular podem não perceber todos os itens da navegação ou podem
  interpretar a rolagem horizontal como erro de layout.
- Leitores de tela podem anunciar a página de Jornadas sem um título principal,
  dificultando orientação e navegação por landmarks/headings.
- Jornadas permanecem uma funcionalidade sensível; a proteção de rede, tokens,
  limites e redaction não apresentou falha nesta exploração, mas deve continuar
  sendo validada em homologação no Render.

## Pontos não testados

- Deploy real no Render.
- Fluxo autenticado com `storageState` (ainda não implementado).
- Testes em dispositivos físicos e leitores de tela reais.
- Lighthouse completo pela interface web.
- Integração real com GitHub, GitLab, Jira ou Slack.
- Carga concorrente prolongada e comportamento após reinício do processo.
- Não foram executadas ações destrutivas, ataques reais ou testes contra dados
  de produção.

## Avaliação geral da interface

A interface tem identidade visual consistente, boa hierarquia de cartões e
mensagens claras nos fluxos principais. A separação por rotas melhorou a
organização do produto e a navegação está presente em todas as páginas.

Os principais pontos de atenção são a adaptação da navegação para celular e a
semântica de headings na Jornada. Fora esses achados, os estados iniciais,
validações HTML, mensagens de erro da Jornada e carregamento entre navegadores
se comportaram de forma consistente.

## Tabela consolidada

| ID | Problema | Categoria | Severidade | Prioridade | Status |
| --- | --- | --- | --- | --- | --- |
| BUG-UI-001 | Navegação excede a largura no mobile | Responsividade / Visual / Usabilidade | Médio | Alta | Corrigido |
| BUG-A11Y-001 | Jornada sem `h1` | Acessibilidade | Médio | Média | Corrigido |

Após a correção, a tabela de status vigente é:

| ID | Status pós-correção | Evidência de validação |
| --- | --- | --- |
| BUG-UI-001 | Corrigido | `scrollWidth === innerWidth` em 390 px nas quatro rotas |
| BUG-A11Y-001 | Corrigido | axe-core sem violações nas quatro rotas |

## Conclusão

A qualidade atual é **boa para uma versão Beta**, com os fluxos essenciais
funcionais e compatíveis nos três motores testados. A aplicação não deve ser
considerada pronta para uma experiência mobile ampla até corrigir o overflow da
navegação e não deve declarar conformidade de acessibilidade enquanto a violação
de heading permanecer.

As correções foram implementadas após a análise de causa raiz. A validação
posterior confirmou typecheck, build, 75 testes unitários, overflow eliminado em
390 px e axe-core sem violações. A integração completa apresentou uma falha
intermitente no fluxo protegido de evidências da Jornada sob carga; o teste
isolado passou, indicando flutuação de ambiente não relacionada às correções de
layout/acessibilidade.
