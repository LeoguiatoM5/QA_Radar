# QA Radar

> **Beta · versão 3.2.0**
> O projeto está em desenvolvimento ativo. Funcionalidades, formatos de relatório e regras de classificação podem evoluir entre versões.

O QA Radar é uma ferramenta de diagnóstico para aplicações web. A partir de uma URL, ele combina smoke testing, observação do navegador e inspeção segura do DOM para encontrar problemas antes que eles cheguem ao usuário.

Ele pode ser utilizado por meio de um dashboard local ou pela CLI, gera evidências visuais anotadas e produz diagnósticos em linguagem de QA:

- qual é o problema;
- qual pode ser o impacto para o usuário;
- como investigar ou corrigir;
- qual é o detalhe técnico original.

O objetivo da versão Beta é validar a utilidade da ferramenta com QAs, desenvolvedores e times de produto. O QA Radar ainda não pretende substituir testes funcionais, exploração humana ou uma plataforma completa de observabilidade.

## Funcionalidades atuais

### Navegador, JavaScript e rede

- Captura erros registrados no console.
- Detecta exceções JavaScript não tratadas.
- Identifica respostas HTTP `4xx` e `5xx`.
- Detecta falhas de DNS, TLS, conexão e conteúdo corrompido.
- Registra timeout e falhas durante a navegação.
- Informa URL final, redirecionamentos, título, status principal e duração.
- Diferencia erros funcionais de avisos conhecidos, como cookies de terceiros bloqueados.

### Inspeção segura dos elementos

- Imagens quebradas ou que não puderam ser decodificadas.
- Auditoria automática com `axe-core`, cobrindo regras WCAG aplicáveis à página.
- Regra, impacto, elemento e orientação de correção para cada violação encontrada.
- Elementos afetados pela mesma regra são agrupados para evitar diagnósticos repetitivos.
- Verificações complementares, como imagens quebradas e identificadores HTML duplicados.
- Relação entre recursos com falha e seus elementos no DOM.

Essa inspeção é considerada segura porque não clica automaticamente em controles, não envia formulários e não executa ações que possam alterar dados. A auditoria automatizada não substitui uma avaliação manual de acessibilidade.

Para preservar os quality gates existentes, o `axe-core` é opt-in. Ative
**Auditoria de acessibilidade com axe-core** na interface ou use
`--accessibility` pela CLI.

### Evidências e relatórios

- Screenshot completo da página.
- Contorno visual sobre elementos relacionados aos problemas.
- Marcadores numerados conectando elemento e ocorrência.
- Painel de diagnóstico inserido na evidência visual.
- Selector, descrição e posição do elemento no relatório.
- Relatórios HTML e JSON.
- Exportação JUnit XML e SARIF 2.1 para pipelines de CI.
- Agrupamento de mensagens repetidas pela mesma causa.
- Detalhes técnicos recolhidos para priorizar a leitura do QA.
- Schema JSON versionado para permitir evolução compatível das integrações.
- Identificador de regra e fingerprint estável em cada problema detectado.

O relatório JSON declara `schemaVersion`. Desde o schema `1.0`, cada item de
`issues` contém um `ruleId` legível por máquina e um `fingerprint` SHA-256. O
fingerprint identifica a mesma ocorrência entre execuções, normalizando valores
voláteis como timestamps, UUIDs e a ordem dos parâmetros da URL. Esses campos
formam a base para histórico, baselines e detecção de regressões.

### Performance de laboratório

O scanner captura métricas diretamente no navegador durante a análise:

- TTFB, tempo até o primeiro byte da navegação principal;
- FCP, primeira renderização de conteúdo;
- LCP, renderização do maior conteúdo visível;
- CLS, maior janela de mudanças inesperadas de layout;
- DOMContentLoaded e evento completo de load.

São gerados avisos quando TTFB ultrapassa 800 ms, LCP ultrapassa 2.500 ms ou
CLS ultrapassa 0,1. Esses valores seguem as referências atuais do Web Vitals,
mas a execução do QA Radar é uma medição de laboratório e não substitui dados de
usuários reais no percentil 75. Por padrão, os avisos não reprovam
`--fail-on error`; utilize `--fail-on warning` quando quiser aplicar um gate de
performance.

### Execução e automação

- Chromium, Firefox e WebKit.
- Dashboard responsivo para uso manual.
- CLI para automações e pipelines.
- Quality gate configurável.
- Exit codes próprios para aprovação, reprovação e erro de execução.
- Filtros por status HTTP e expressão regular de URL.
- Fila local com até duas análises simultâneas.
- Progresso por página e por etapa, incluindo posição atual na fila.
- Cancelamento de análises em fila, durante sitemap ou com o navegador aberto.
- Diretório isolado para os artefatos de cada análise.

### QA Toolbox

- Ferramentas rápidas de QA no navegador, sem configuração e sem login.
- JSON Diff com campos dinâmicos ignoráveis por nome, caminho ou `[*]`.
- JWT Inspector que decodifica sem jamais dizer que a assinatura foi verificada.
- Gerador de massa sintética válida e propositalmente inválida (JSON, CSV, SQL).
- cURL convertido em Playwright, Cypress, Fetch, Axios, Python ou Rest Assured.
- Verificação de saúde de vários endpoints com relatório do ambiente colável.
- Análise de valor limite para inteiro, decimal, tamanho de texto e data.
- Combinação de pares (all-pairs) para reduzir a matriz de teste.
- Teste de regex com grupos nomeados e linhas atingidas.
- Conversão de timestamp que diz em que unidade leu o número.
- Referência de status HTTP com o que checar em cada código.
- Validação de payload contra JSON Schema, apontando a regra que falhou.
- Comparação de contratos OpenAPI que distingue quebra de adição.
- Caixa de webhook descartável para ver o que o sistema de terceiro mandou.

## Requisitos

- Node.js 20 ou superior.

## Instalação

```bash
npm install
npx playwright install chromium firefox webkit
```

## Dashboard web

Inicie a aplicação:

```bash
npm run web
```

Abra [http://127.0.0.1:4173](http://127.0.0.1:4173) para acessar a Home, o tutorial e os atalhos das funcionalidades.

As funcionalidades ficam separadas por rota:

- `/`: Home e orientação inicial;
- `/scanner`: inspeção segura por URL;
- `/journeys`: Modo Jornada de Playwright;
- `/docs`: documentação resumida e exemplos.

Para executar uma inspeção, acesse `/scanner` e informe a URL.

Na página de inspeção é possível:

- escolher o navegador;
- configurar timeout e janela de observação;
- definir quando o quality gate deve reprovar;
- ignorar status ou serviços conhecidos;
- acompanhar páginas concluídas, etapa atual e posição na fila;
- cancelar uma análise longa sem aguardar o timeout;
- consultar problema, impacto e ação recomendada;
- abrir o relatório HTML completo;
- baixar o relatório JSON;
- visualizar o screenshot anotado.

Cada execução recebe um ID e um diretório em `qa-radar-results/`, evitando que análises simultâneas sobrescrevam seus artefatos.

## CLI

Uso básico:

```bash
npm run dev -- https://example.com
```

Por padrão, a CLI utiliza Chromium headless, gera HTML e JSON em `qa-radar-report/` e captura um screenshot quando o quality gate reprova.

Exit codes:

- `0`: análise aprovada;
- `1`: quality gate reprovado;
- `2`: configuração inválida ou erro de execução.

### Exemplos

Abrir o navegador sem criar arquivos:

```bash
npm run dev -- https://example.com --headed --format console
```

Reprovar também quando existirem avisos:

```bash
npm run dev -- https://example.com --fail-on warning
```

Ignorar respostas esperadas e serviços conhecidos:

```bash
npm run dev -- https://example.com \
  --ignore-status 401,404 \
  --ignore-url "analytics|telemetry"
```

Executar em Firefox e sempre gerar evidência:

```bash
npm run dev -- https://example.com \
  --browser firefox \
  --settle 5000 \
  --screenshot always
```

Comparar com uma execução anterior e reprovar somente por regressões:

```bash
npm run dev -- https://example.com \
  --baseline qa-radar-baseline.json \
  --regressions-only \
  --fail-on error
```

O arquivo indicado por `--baseline` deve ser um `report.json` com schema `1.0`.
Problemas encontrados nas duas execuções são classificados como existentes;
novos fingerprints são regressões e fingerprints que desapareceram são listados
como resolvidos. Sem `--regressions-only`, a comparação é exibida, mas o quality
gate continua considerando todos os problemas.

### Histórico automático por projeto

Para não informar o baseline manualmente, dê um nome ao projeto e ao ambiente:

```bash
npm run dev -- https://staging.example.com \
  --project loja-web \
  --environment staging \
  --regressions-only
```

Cada execução é gravada em
`.qa-radar-history/<projeto>/<ambiente>/runs/`. A execução aprovada é promovida
para `baseline.json` e será carregada automaticamente na próxima análise. Uma
execução reprovada entra no histórico, mas não substitui o último baseline
aprovado.

Na primeira execução, quando ainda não existe baseline, todos os problemas são
considerados novos. Para aceitar conscientemente o estado atual como ponto de
partida, execute uma vez com:

```bash
npm run dev -- https://staging.example.com \
  --project loja-web \
  --environment staging \
  --regressions-only \
  --accept-baseline
```

Use `--accept-baseline` somente depois de revisar o relatório. O comando promove
a execução mesmo quando o quality gate reprova. Para armazenar o histórico fora
do diretório padrão, utilize `--history-dir <diretório>`.

### Cobertura por sitemap

Para analisar mais de uma página no mesmo quality gate:

```bash
npm run dev -- https://example.com \
  --sitemap \
  --max-pages 20 \
  --project loja-web \
  --environment staging \
  --regressions-only
```

O QA Radar busca `/sitemap.xml`, acompanha até dez arquivos quando encontra um
índice de sitemaps e aceita somente URLs HTTP/HTTPS da mesma origem do alvo. O
limite padrão é de 20 páginas e o máximo permitido é 100. As páginas são
executadas sequencialmente para limitar o consumo de memória do Playwright.

O diretório raiz contém o relatório consolidado. Cada página também recebe seus
próprios artefatos:

```text
qa-radar-report/
├── report.html
├── report.json
├── report.junit.xml
├── report.sarif.json
└── pages/
    ├── 001-example-com-produto/
    │   └── report.html
    └── 002-example-com-checkout/
        └── report.html
```

O baseline e o histórico consideram o conjunto completo. Assim, uma falha nova
em qualquer página aparece como regressão do projeto, enquanto páginas externas
publicadas acidentalmente no sitemap são ignoradas.

Consultar todas as opções:

```bash
npm run dev -- --help
```

### Auditoria Lighthouse experimental

O modo rápido permanece padrão. Para executar também a auditoria completa local
com Chromium:

```powershell
npm run dev -- https://example.com --lighthouse --output qa-radar-lighthouse
```

O resumo é incorporado aos relatórios do QA Radar e o resultado bruto fica em
`report.lighthouse.json`. Nesta etapa o recurso é CLI-only, não pode ser combinado
com jornadas e permanece bloqueado no servidor público enquanto o isolamento de
rede e os limites de infraestrutura não forem homologados.

### Modo Jornada de Playwright

```powershell
npm run web
```

A rota `/journeys` apresenta a experiência baseada em arquivos
Playwright TypeScript `.spec.ts`. Nela é possível iniciar o Codegen, importar,
editar, exportar e executar o teste, além de gerar o relatório de evidências.

O Modo Jornada de Playwright está sendo preparado para execução hospedada. A API
e o executor já são processos separados, possuem timeout, limite de saída,
quota, autenticação administrativa e tokens próprios para os artefatos. O
Blueprint de produção mantém a execução desabilitada até o worker receber o
sandbox de CPU, memória total, processos, rede e filesystem exigido para a
oferta comercial.

O executor declarativo baseado em JSON é legado, fica desabilitado por padrão e
não faz parte do produto, da interface ou da direção comercial.

### Testes de API

```powershell
npm run web
```

A rota `/api-tests` é uma aba própria, separada da Jornada: um cliente HTTP
interativo no estilo Postman, para validar uma API diretamente, sem escrever
código nem esperar um job rodar.

- Monte a requisição (método, URL, headers, corpo) e clique em **Enviar** —
  a chamada sai do próprio servidor do QA Radar (evita bloqueio de CORS do
  navegador) e a resposta (status, headers, corpo) aparece na hora.
- **Variáveis** — pares chave/valor substituídos em ocorrências `{{nome}}`
  na URL, nos headers ou no corpo. Serve para guardar um token ou a URL base
  uma vez só e reaproveitar em várias requisições, sem repetir.
- **Collection** — salve requisições com um nome, reabra com um clique,
  exporte/importe como JSON para levar para outra máquina ou compartilhar
  com o time. A collection e as variáveis ficam salvas só no navegador
  (`localStorage`); o QA Radar ainda não tem persistência no servidor.
- A requisição sai do servidor e respeita a mesma proteção contra redes
  privadas (SSRF) usada na Inspeção, inclusive re-validando cada
  redirecionamento antes de segui-lo.

Isso não tem relação com o Modo Jornada de Playwright — as duas ferramentas
são independentes e não compartilham estado.

## QA Toolbox

**Daily tools for Software Quality.**

```powershell
npm run web   # abre em http://localhost:4173/toolbox
```

A rota `/toolbox` reúne ferramentas rápidas para o dia a dia de QA — as coisas
que hoje se resolvem com seis abas abertas em sites de terceiros. Não substitui
nada: a Inspeção, a Jornada, os Testes de API e o histórico continuam onde
estavam. O Toolbox é o complemento que resolve o pequeno em segundos, sem
projeto, sem configuração e sem esperar um job rodar.

![Catálogo do QA Toolbox](docs/screenshots/toolbox-home.png)

| Ferramenta                   | Categoria   | Onde roda | O que faz                                                             |
| ---------------------------- | ----------- | --------- | --------------------------------------------------------------------- |
| **JSON Diff**                | API & JSON  | Navegador | Compara dois JSON ignorando campos dinâmicos                          |
| **JWT Inspector**            | API & JSON  | Navegador | Decodifica header/payload e interpreta `iat`, `exp` e `nbf`           |
| **API Health**               | API & JSON  | Servidor  | Mede status e tempo de vários endpoints e resume o ambiente           |
| **Test Data Generator**      | Test Data   | Navegador | Gera massa sintética válida ou propositalmente inválida               |
| **cURL Converter**           | Automation  | Navegador | Converte um cURL em Playwright, Cypress, Fetch, Axios, Python ou Java |
| **Boundary Value Generator** | Test Design | Navegador | Deriva os casos de fronteira de um campo                              |
| **Pairwise Generator**       | Test Design | Navegador | Reduz a combinação de parâmetros ao mínimo que cobre todos os pares   |
| **Regex Tester**             | Utilities   | Navegador | Mostra onde a expressão casa, os grupos e as linhas atingidas         |
| **Timestamp Converter**      | Utilities   | Navegador | Converte epoch e ISO 8601 dizendo em que unidade leu                  |
| **HTTP Status Explorer**     | Utilities   | Navegador | O que cada código significa e o que checar quando ele aparece         |
| **JSON Schema Validator**    | API & JSON  | Navegador | Aponta qual regra do schema falhou, campo a campo                     |
| **OpenAPI Diff**             | API & JSON  | Navegador | Compara dois contratos (YAML ou JSON) e separa quebra de adição       |
| **Webhook Inspector**        | Utilities   | Servidor  | URL descartável que mostra o que cada webhook mandou                  |

### JSON Diff

Compara ignorando os campos que mudam a cada chamada, e separa mudança de
**tipo** de mudança de valor — `"3000"` no lugar de `3000` quebra cliente
tipado, e `5000` virar `3000` não.

![JSON Diff](docs/screenshots/json-diff.png)

### cURL Converter

Cole o "Copy as cURL" do DevTools e receba o teste pronto. O token aparece
mascarado na tela e vira `process.env.API_TOKEN` no código — que é feito para
ser commitado.

![cURL Converter](docs/screenshots/curl-converter.png)

### API Health

Mede vários endpoints de uma vez e resume o ambiente pelo pior deles.
**Copiar relatório do ambiente** gera texto puro, que sobrevive igual no Slack,
Teams, Jira, Azure DevOps e GitHub.

![API Health](docs/screenshots/api-health.png)

### Pairwise Generator

A maioria dos defeitos de combinação aparece na interação de **dois**
parâmetros. Quatro parâmetros que dariam 36 combinações completas viram 10
casos, com todos os pares cobertos.

![Pairwise Generator](docs/screenshots/pairwise.png)

### OpenAPI Diff

Aceita YAML ou JSON. O veredicto depende do lado do contrato: exigir um campo
novo na **requisição** quebra quem chama; deixar de garantir um campo na
**resposta** quebra quem lê. É a mesma edição de schema com resultados opostos —
e é aí que um diff textual erra.

![OpenAPI Diff](docs/screenshots/openapi-diff.png)

- **Privacidade primeiro.** Toda ferramenta que consegue rodar no navegador
  roda no navegador. O selo 🔒 **Roda local** só aparece quando nada digitado
  sai da sua máquina, e o catálogo é testado para que essa promessa não minta.
- **Nada de segredo guardado.** JWT, `Authorization` e chave de API não são
  persistidos, não vão para log e não vão para telemetria. No cURL Converter
  eles aparecem mascarados na tela e viram variável de ambiente no código
  gerado.
- **Só duas usam o servidor.** O API Health, porque o navegador não consegue
  medir um endpoint de terceiro (CORS) — a chamada sai do QA Radar apenas com
  `GET` ou `HEAD`, sem cabeçalhos vindos do cliente, em até 10 endpoints por vez
  e com a mesma proteção contra redes privadas (SSRF) usada na Inspeção. E o
  Webhook Inspector, que por natureza precisa de uma URL pública: a caixa vive
  60 minutos, guarda as 50 últimas chamadas, redige cabeçalho de credencial
  antes de gravar e não vai para banco nenhum.
- **Busca** por nome, descrição, tag e categoria; `/` leva direto ao campo.
- **Favoritas** ficam no topo do catálogo. A preferência mora só no seu
  navegador (`localStorage`): o servidor não sabe quais ferramentas você usa.

Documentação completa, arquitetura e o passo a passo para adicionar uma
ferramenta: [`docs/qa-toolbox.md`](docs/qa-toolbox.md).

## Como interpretar os resultados

| Categoria          | Nível comum   | Exemplo                                              |
| ------------------ | ------------- | ---------------------------------------------------- |
| Navegador          | erro ou aviso | recurso bloqueado ou cookie de terceiro rejeitado    |
| JavaScript         | erro          | exceção ou conteúdo inválido executado como script   |
| Carregamento       | erro ou aviso | imagem `404`, API `401` ou servidor `500`            |
| Rede               | erro          | DNS, TLS, conexão ou conteúdo incompatível           |
| Navegação          | erro          | timeout ou página inacessível                        |
| Performance        | aviso         | TTFB, LCP ou CLS fora do recomendado                 |
| Elemento da página | erro ou aviso | imagem quebrada ou ID duplicado                      |
| Acessibilidade     | aviso         | botão sem nome, campo sem label ou iframe sem título |

As severidades são heurísticas. Um `404` em uma imagem, CSS, script ou documento tende a ser erro porque afeta diretamente a página; um `404` em uma API pode ser um comportamento esperado e começa como aviso.

Os filtros são aplicados antes da correlação e do agrupamento. Utilize-os somente para ocorrências conhecidas e intencionais, evitando esconder defeitos reais.

## Quality gate em CI

Depois do build, execute a CLI diretamente:

```bash
npm run build
node dist/index.js https://staging.example.com --format all --fail-on error
```

O formato `all` gera quatro artefatos:

```text
report.html
report.json
report.junit.xml
report.sarif.json
```

Para gerar apenas o formato consumido pelo seu pipeline:

```bash
node dist/index.js https://staging.example.com --format junit
node dist/index.js https://staging.example.com --format sarif
```

No JUnit, somente ocorrências que efetivamente reprovam o quality gate são
exportadas como `failure`. Em `--regressions-only`, erros existentes continuam
visíveis como diagnóstico, mas não quebram novamente o pipeline. O SARIF inclui
`ruleId`, fingerprint, severidade e `baselineState` para cada resultado.

Exemplo para GitHub Actions:

```yaml
- name: Instalar dependências
  run: npm ci
- name: Instalar Chromium
  run: npx playwright install --with-deps chromium
- name: Validar projeto
  run: npm run check
- name: Executar QA Radar
  run: node dist/index.js "$STAGING_URL" --format all
- name: Publicar relatório
  if: always()
  uses: actions/upload-artifact@v6
  with:
    name: qa-radar-report
    path: qa-radar-report/
```

O arquivo `report.junit.xml` pode ser publicado pelo leitor de resultados de
teste da sua plataforma. O arquivo `report.sarif.json` pode ser enviado para uma
ferramenta compatível com SARIF ou para a etapa de Code Scanning do provedor do
repositório.

### GitHub Actions

O repositório inclui uma composite action em `action.yml`. Depois de publicar
uma versão do QA Radar, ela pode ser utilizada em outro projeto com:

```yaml
- name: Executar QA Radar
  id: qa-radar
  uses: sua-organizacao/qa-radar@v3
  with:
    url: ${{ secrets.STAGING_URL }}
    project: loja-web
    environment: staging
    fail-on: error

- name: Publicar relatórios
  if: always()
  uses: actions/upload-artifact@v6
  with:
    name: qa-radar-report
    path: qa-radar-report/

- name: Publicar SARIF
  if: always()
  uses: github/codeql-action/upload-sarif@v4
  with:
    sarif_file: ${{ steps.qa-radar.outputs.report-sarif }}
```

A action instala o navegador escolhido, executa o scanner, gera todos os
formatos e publica erros novos como annotations no log do workflow. Para testar
a action dentro deste próprio repositório, copie
`examples/qa-radar-github-actions.yml` para `.github/workflows/` e configure o
secret `STAGING_URL`.

### GitLab CI/CD

O arquivo `.gitlab-ci.yml` valida tipos, testes unitários, integração Playwright,
Lighthouse e o pacote npm. Um smoke test adicional publica os relatórios JSON,
HTML, JUnit e SARIF como artefatos; o JUnit também aparece na interface de testes
do GitLab. O pipeline é executado em merge requests, na branch padrão, em tags e
quando iniciado manualmente.

URLs e credenciais de ambientes reais não ficam no repositório. Cadastre-as como
variáveis protegidas e mascaradas do GitLab antes de adaptar o smoke test para um
ambiente autenticado.

## Política de compatibilidade

O QA Radar ainda está em Beta (`3.2.0`), mas os três contratos abaixo já têm
regras de compatibilidade explícitas para reduzir o risco de quebrar scripts,
pipelines de CI e integrações existentes.

### Schema dos relatórios (JSON, JUnit, SARIF)

- O relatório JSON declara `schemaVersion` (atualmente `"1.0"`) e `version`
  (a versão do pacote que gerou o relatório).
- Mudanças aditivas — novo campo opcional, nova categoria de `issue`, novo
  valor possível para um campo já existente — **não** incrementam
  `schemaVersion`. Um consumidor que ignora campos desconhecidos continua
  funcionando.
- Mudanças que quebram compatibilidade — remover ou renomear um campo, mudar
  o tipo de um campo existente, mudar o significado de um valor já
  documentado — exigem incrementar `schemaVersion` e são anunciadas no
  `CHANGELOG.md` sob um item "Breaking", com orientação de migração.
- `ruleId` e `fingerprint` (SHA-256) são estáveis entre execuções para a
  mesma ocorrência normalizada; mudar o algoritmo de fingerprint é tratado
  como mudança de schema.
- JUnit XML segue o schema padrão do formato; SARIF é fixado em `2.1.0`
  (versão do próprio formato SARIF, não controlada por nós). O conteúdo que
  o QA Radar escreve dentro desses formatos segue a mesma regra acima.

### CLI

- Flags documentadas neste README são estáveis dentro de uma versão maior
  (major) do pacote npm: não têm o comportamento alterado nem são removidas
  sem uma major version.
- Toda flag nova é opcional e tem um valor padrão que preserva o
  comportamento anterior — um comando que funcionava numa versão menor
  continua funcionando após atualizar para outra versão menor ou de patch.
- Se uma flag for descontinuada, ela primeiro passa a emitir aviso (stderr)
  por ao menos um ciclo de versão menor antes de ser considerada para
  remoção numa major version, sempre documentado no `CHANGELOG.md`.
- Exit codes (aprovação, reprovação, erro de execução) são parte do
  contrato e seguem a mesma regra.

### API HTTP do dashboard (`/api/...`)

- **`/api/v1` é o prefixo canônico.** Toda rota da API responde sob ele
  (`/api/v1/scans`, `/api/v1/code-execution`, `/api/v1/history`, etc.) e o
  contrato aí dentro segue a mesma regra do schema JSON: mudanças que quebram
  compatibilidade exigem `/api/v2`, nunca uma alteração silenciosa em
  `/api/v1`. Prefira este caminho em qualquer integração nova.
- **`/api/...` sem versão continua funcionando** como alias do mesmo conjunto
  de rotas, para não quebrar clientes existentes. Ele segue tratado como
  **pré-1.0 em evolução**: mudanças de formato são possíveis entre versões
  menores do pacote, sempre registradas no `CHANGELOG.md` sob "Breaking" antes
  do release. O cliente web embutido ainda usa este alias.
- Caminhos que a API devolve (cookie de acesso, URL de relatório de evidências)
  acompanham o prefixo com que a requisição chegou, então um cliente que fala
  `/api/v1` nunca recebe de volta um caminho `/api`.
- `/health` e `/ready` ficam de fora do versionamento de propósito: são
  endpoints operacionais da instância, não parte do contrato de dados.

#### Contrato OpenAPI

A própria instância publica sua especificação OpenAPI 3.1 em
`GET /api/v1/openapi.json` — use para gerar cliente, importar no Postman/Insomnia
ou validar uma integração:

```bash
curl -sS http://127.0.0.1:4173/api/v1/openapi.json
```

O documento é gerado a partir do código, não mantido à mão: os códigos de erro
saem da mesma tabela que define os status HTTP, e a versão sai do pacote. Há
teste travando as duas invariantes que fazem uma especificação valer alguma
coisa — todo código de erro aparece documentado, e todo caminho documentado é
de fato roteado pelo servidor.

Ficam fora do documento, de propósito, `/api/dashboard/activity` (estado
interno da interface) e `/api/journeys` (jornada declarativa em JSON, legado
desligado que não faz parte do produto).

- A GitHub Action composta já segue este modelo hoje: é publicada com uma
  tag de versão maior (`@v3`) que os consumidores fixam no workflow, e seus
  `inputs`/`outputs` documentados não mudam de formato dentro da mesma
  major version.

#### Erros

Toda resposta de erro da API tem o mesmo formato:

```json
{ "error": "Informe a URL da aplicação.", "code": "invalid_request" }
```

`error` é texto de interface em português e pode mudar sem aviso — não use
para decidir comportamento. `code` é a parte estável do contrato e determina o
status HTTP: `invalid_request` e `invalid_target` (400), `unauthorized` (401),
`forbidden` e `feature_disabled` (403), `not_found` (404),
`method_not_allowed` (405), `conflict` (409), `payload_too_large` (413),
`rate_limited`, `server_busy` e `resource_in_use` (429), `internal_error`
(500), `service_unavailable` (503).

`internal_error` nunca traz detalhe da falha: a mensagem real fica no log do
servidor, numa linha `request.failed`.

#### Repetir a criação de uma análise com segurança

`POST /api/scans` aceita o cabeçalho opcional `Idempotency-Key` (até 255
caracteres entre letras, números, `.`, `:`, `-` e `_`). Repetir a requisição
com a mesma chave e o mesmo corpo devolve `200` com a análise já criada e o
mesmo `accessToken`, em vez de enfileirar uma segunda. Útil quando o cliente
sofre timeout e não sabe se a primeira chamada chegou.

- Mesma chave com corpo diferente responde `409 conflict`.
- Repetir enquanto a criação original ainda está em andamento também responde
  `409` — tente de novo em seguida.
- A chave vale pelo tempo de retenção da análise e é escopada por cliente.
- As chaves ficam em memória e se perdem no reinício do processo, como os
  próprios jobs hoje.

`POST /api/scans/{id}/cancel` é idempotente: cancelar de novo uma análise já
cancelada responde `202` com o mesmo estado. Cancelar uma análise que já
concluiu ou falhou continua respondendo `409`, porque o desfecho pedido não é
o que aconteceu.

## Roadmap da versão Beta

As funcionalidades abaixo são direções planejadas, sem prazo fechado e sujeitas a mudanças conforme o uso e o feedback recebido.

### Modo Jornada de Playwright

A gravação com Playwright Codegen, a conversão automática em `.spec.ts`, o
preenchimento do editor com o código gerado, a execução com logs, screenshots
e vídeo, o relatório de evidências e o salvar/importar/exportar `.spec.ts` já
estão disponíveis (veja a seção [Modo Jornada de Playwright](#modo-jornada-de-playwright)).
Continuam como roadmap:

- Oferecer autocomplete, validação e templates no editor de código.
- Capturar traces do Playwright junto com logs, screenshots e vídeo.
- Habilitar a execução hospedada após concluir sandbox, limites de recursos e
  isolamento de sessões, rede, filesystem e processos.

### Cobertura

- Percorrer links internos com limite de profundidade.
- Executar a mesma análise em diferentes viewports.
- Comparar resultados entre Chromium, Firefox e WebKit.

### Qualidade e acessibilidade

- Ampliar a auditoria de acessibilidade e a interpretação das regras WCAG.
- Detectar problemas de layout, conteúdo cortado e overflow.
- Evoluir o agrupamento de sintomas em causas-raiz.
- Permitir configurar severidade, regras e falsos positivos por projeto.
- Integrar o OWASP ZAP para análises dinâmicas de segurança controladas.
- Usar Inteligência Artificial para apoiar diagnósticos, explicar causas
  prováveis e sugerir correções, sempre mantendo as evidências originais.

### Automação e regressões

- Executar jornadas completas em ambientes autenticados.
- Comparar execuções e identificar regressões após deploys.
- Associar resultados a versões, commits e ambientes.
- Permitir testes agendados e alertas configuráveis (o gatilho, a janela e o
  envio por e-mail hoje são fixos — veja "Alertas (`/alertas`)" mais abaixo,
  em "Contas, aplicações e acesso").
- Integrar o QA Radar com GitHub, Jira, Slack e pipelines CI/CD.

### Colaboração e histórico

- Evoluir o histórico local para PostgreSQL e armazenamento de artefatos compatível com S3.
- Comparar execuções e destacar mudanças de severidade, regras e evidências.
- Adicionar autenticação, organizações e permissões por projeto.
- Gerenciar projetos, equipes e ambientes de teste.
- Criar gráficos de tendência e filtros avançados no histórico.

## Limitações da Beta

- As regras atuais são heurísticas e podem produzir falsos positivos ou deixar problemas passarem.
- A auditoria de acessibilidade não representa uma certificação WCAG completa.
- A ferramenta não entende sozinha a regra de negócio da aplicação.
- Elementos carregados depois da janela de observação podem não ser analisados.
- Erros de serviços externos podem aparecer no relatório da página que os incorporou.
- O scanner padrão não clica nem envia formulários. Jornadas declarativas podem
  fazê-lo somente quando o recurso experimental é habilitado explicitamente.
- O histórico é persistido no filesystem local, sem banco de dados, transações ou armazenamento remoto.

## Segurança e publicação

Por padrão, o dashboard escuta somente em `127.0.0.1` e aceita apenas destinos públicos. Endereços locais, redes privadas, credenciais em URLs e recursos privados carregados por redirecionamentos são bloqueados.

Para uma execução local controlada que precise analisar `localhost` ou a rede interna, habilite explicitamente:

```powershell
$env:QA_RADAR_ALLOW_PRIVATE_TARGETS="true"
npm run web
```

Para habilitar projeto, ambiente, histórico e baseline automático no dashboard local:

```powershell
$env:QA_RADAR_ENABLE_HISTORY="true"
npm run web
```

Não habilite histórico compartilhado em uma implantação pública antes de adicionar autenticação e isolamento por organização. Sitemap e métricas de performance permanecem disponíveis sem essa variável; o servidor web limita a cobertura a 20 páginas por padrão.

Ainda são necessários autenticação, HTTPS e persistência antes de uma implantação aberta ao público. A API já aplica política de destinos públicos, rate limit, limite de fila e tetos de duração como primeiras camadas de proteção.

Cada análise, execução Playwright e sessão Codegen recebe um token aleatório. O
dashboard preserva o token em cookie `HttpOnly`, restrito às rotas do próprio
recurso. Clientes da API devem enviar o valor retornado em `accessToken` pelo
cabeçalho `Authorization: Bearer <token>` para consultar estado, cancelar,
recuperar código ou baixar artefatos. O servidor guarda somente o hash do token
durante a retenção.

Em uma homologação controlada, a criação remota de uma execução Playwright exige
também `QA_RADAR_ENABLE_CODE_MODE=true` e um
`QA_RADAR_CODE_MODE_ADMIN_TOKEN` de 32 a 512 bytes enviado como Bearer token. O
token administrativo não é repassado ao worker. Também são obrigatórios
`QA_RADAR_SANDBOX_URL` em HTTPS e `QA_RADAR_SANDBOX_SIGNING_SECRET`; sem esse
runner externo, a API falha fechado com `503` e nunca usa o worker local como
fallback. Essa autenticação é uma camada de controle de acesso e não substitui
o sandbox; portanto, o Blueprint mantém o recurso desabilitado por padrão.

Nesse caminho hospedado, um preflight aceita imports apenas de
`@playwright/test` ou `playwright/test` e rejeita acesso direto a filesystem,
processos, `process.env`, `require`, `eval`, importação dinâmica e construção
dinâmica de funções. Essa política reduz vetores triviais, mas não é tratada
como fronteira de segurança contra código deliberadamente ofuscado.

O runner aplica contrato versionado, assinatura HMAC, proteção contra replay e
requisitos obrigatórios de ambiente descartável.

O repositório também contém uma implementação de referência do runner Docker.
Ela cria um container por job com CPU, memória, PIDs e tempo limitados, rootfs
somente leitura, `tmpfs` exclusivo, usuário sem privilégios, seccomp,
capabilities zeradas e destruição forçada. O job permanece em `--network none`.
Quando `QA_RADAR_SANDBOX_NETWORK_POLICY=public-egress`, um sidecar confiável
oferece HTTPS público por socket Unix efêmero, bloqueando host, metadata, redes
privadas, faixas reservadas e DNS rebinding. O job nunca recebe bridge ou rota
externa direta.

```bash
npm run sandbox:image
npm run sandbox:homologate
QA_RADAR_SANDBOX_NETWORK_POLICY=public-egress \
QA_RADAR_SANDBOX_SIGNING_SECRET='secret-aleatorio-com-32-bytes-ou-mais' \
npm run sandbox
```

O Blueprint público sai desligado porque ainda precisa apontar para uma instância
dedicada desse runner, protegida por HTTPS. Não monte o socket Docker no processo
HTTP público.

#### Publicar o runner em uma VM e ligar a Jornada no deploy

O runner precisa do socket Docker para criar um container por job, então não roda
em PaaS gerenciada (Render, Heroku, Fly Machines com Docker desabilitado). Use uma
VM Linux com Docker — 2 vCPU e 4 GB dão folga para o Chromium do job.

Com a VM criada e o DNS apontado, `scripts/setup-sandbox-vm.sh` faz os passos 3 a
6 de uma vez e imprime no final os valores para colar no painel:

```bash
sudo ./scripts/setup-sandbox-vm.sh sandbox.seu-dominio.com
```

Ele checa antes se a imagem do Playwright traz Chromium para a arquitetura da VM
— numa VM ARM isso pode não existir, e é melhor descobrir no primeiro minuto. Não
mexe em firewall: restringir a 443 continua manual (passo 7). Os passos abaixo são
o mesmo roteiro, manual, para quando algo falhar no meio.

1. **DNS.** Aponte um subdomínio para a VM (ex.: `sandbox.seu-dominio.com`). O Caddy
   do compose emite o certificado sozinho; sem DNS resolvendo não há HTTPS, e o
   servidor exige `QA_RADAR_SANDBOX_URL` em HTTPS.
2. **Segredo.** Gere o segredo compartilhado entre o QA Radar e o runner:
   `openssl rand -base64 48` (o runner recusa menos de 32 bytes).
3. **Imagem do job e homologação**, na VM, com o repositório clonado:

   ```bash
   npm ci
   npm run sandbox:image        # constrói qa-radar-sandbox-job:3.2.0
   npm run sandbox:homologate   # valida isolamento, limites e egress
   ```

4. **Subir o runner** com o compose. O runner fica numa rede `internal`, sem rota
   externa; só o Caddy também entra numa rede com saída, porque o ACME do Let's
   Encrypt exige que ele alcance a API do CA para emitir o certificado:

   ```bash
   printf 'QA_RADAR_SANDBOX_SIGNING_SECRET=%s\n' "$SEGREDO" > .env.runner
   echo 'QA_RADAR_SANDBOX_NETWORK_POLICY=public-egress' >> .env.runner
   DOCKER_GID=$(getent group docker | cut -d: -f3) \
   SANDBOX_RUNNER_DOMAIN=sandbox.seu-dominio.com \
     docker compose -f docker-compose.sandbox.yml up -d
   ```

   Confirme a emissão do certificado antes de seguir — sem isso o passo 5 falha
   com erro de TLS, não com uma mensagem do QA Radar:

   ```bash
   docker compose -f docker-compose.sandbox.yml logs caddy | grep -i "certificate obtained"
   curl -sS https://sandbox.seu-dominio.com/health
   ```

   Restrinja a porta 443 da VM ao egress do Render (firewall/security group): o
   runner não é um serviço público.

5. **Apontar o QA Radar.** No painel do Render (Environment do serviço web), defina
   `QA_RADAR_ENABLE_CODE_MODE=true`, `QA_RADAR_SANDBOX_URL=https://sandbox.seu-dominio.com`
   e `QA_RADAR_SANDBOX_SIGNING_SECRET` com o mesmo segredo. As três estão no
   Blueprint como `sync: false` justamente para o painel ser a fonte da verdade: um
   valor fixado no `render.yaml` seria reimposto a cada sync e desligaria a Jornada
   de novo. O `QA_RADAR_CODE_MODE_ADMIN_TOKEN` continua gerado pelo Blueprint —
   copie o valor do painel.
6. **Usar.** Em `/journeys`, cole o `.spec.ts` e clique em Executar. Como a
   requisição vem de fora, o servidor pede o token administrativo: cole o valor do
   passo anterior no campo que aparece. Ele fica só na aba do navegador (sessão) e
   segue como `Authorization: Bearer` em cada execução. O gravador Codegen continua
   local, porque abre um navegador na máquina que roda o servidor.

Se a execução responder `503 Runner sandbox hospedado não está configurado`, o par
`QA_RADAR_SANDBOX_URL`/`SIGNING_SECRET` não chegou ao processo; `401`/`403` é o token
administrativo ausente ou divergente. Um `401` vindo do próprio runner (dentro da
mensagem `O sandbox recusou a execução`) é segredo divergente entre os dois lados.

`POST /api/code-execution` responde de forma síncrona: a conexão fica aberta até a
jornada terminar. Jornadas longas podem esbarrar no tempo limite de requisição do
proxy da hospedagem antes do limite do QA Radar, e nesse caso o navegador mostra
erro de rede enquanto a execução seguiu no runner. Ajuste
`QA_RADAR_MAX_CODE_EXECUTION_MS` para caber nessa janela.

O servidor limita por padrão cada endereço a 10 novas análises por minuto,
retorna os cabeçalhos `X-RateLimit-Limit`, `X-RateLimit-Remaining` e
`X-RateLimit-Reset` e mantém resultados por uma hora. Quando o limite é
excedido, a resposta `429` também informa `Retry-After`. Em uma hospedagem com
proxy reverso conhecido, configure `QA_RADAR_TRUST_PROXY=true` para considerar
`X-Forwarded-For`. Não habilite essa opção ao expor o processo Node diretamente.

Para monitoramento há dois endpoints, com propósitos diferentes:

- `GET /health` — **vivacidade**. Responde `200` enquanto o processo estiver de
  pé e atendendo, sem consultar dependência nenhuma. É o que o `HEALTHCHECK` da
  imagem Docker usa: quando ele falha o contêiner é reiniciado, e reiniciar não
  resolve disco cheio nem runner fora do ar — só processo travado.
- `GET /ready` — **prontidão**. Responde `200 {"status":"ready"}` ou
  `503 {"status":"not_ready"}` com um objeto `checks` detalhando cada
  dependência. É o `healthCheckPath` configurado no Render, que decide se a
  instância entra em serviço.

Hoje só `checks.resultsDir` reprova a prontidão, porque um diretório de
resultados não gravável é o único problema que impede a instância de produzir
qualquer relatório. Os demais são informativos: `checks.queue` mostra
`saturated` com a fila cheia (carga normal, que passa sozinha — reprovar por
isso faria a hospedagem reiniciar a instância justamente enquanto ela trabalha)
e `checks.codeMode` mostra `disabled`, `local` ou `hosted`, útil para flagrar o
Modo Jornada anunciado sem runner hospedado por trás.

O limite global padrão de uma análise é cinco minutos. No Blueprint do Render ele
é reduzido para três minutos por `QA_RADAR_MAX_JOB_DURATION_MS=180000`. Esse
limite inclui inicialização do navegador, navegação, inspeção e relatórios.

### Persistência (opcional)

Sem configuração, o QA Radar guarda tudo em memória: reiniciar o processo perde
o registro das análises. Isso é intencional — a CLI e o dashboard local não
exigem banco nenhum para funcionar.

Para preservar as análises entre reinícios, aponte `QA_RADAR_DATABASE_URL` para
um PostgreSQL:

```bash
QA_RADAR_DATABASE_URL="postgresql://usuario:senha@host/banco" npm run web
```

As migrations são aplicadas no boot, antes de a porta abrir. TLS é decidido pela
URL: obrigatório em host remoto, dispensado em `localhost` (onde normalmente não
há certificado), e um `?sslmode=` explícito sempre vence.

Com o banco ligado:

- o registro de cada análise (estado, opções, progresso, relatório, erro)
  sobrevive ao reinício, e `GET /api/v1/scans/{id}` responde por ela mesmo depois
  de o processo ter perdido a memória;
- análises deixadas em execução por uma instância encerrada são fechadas como
  falha no boot seguinte, com o motivo — antes elas ficariam "em execução" para
  sempre;
- o token de acesso continua sendo exigido: persistir não afrouxa o acesso, e o
  banco guarda apenas o hash dele.

Com o banco, as chaves de idempotência também passam a durar: repetir um
`POST /api/scans` depois de um reinício continua devolvendo a mesma análise em
vez de enfileirar outra. Para que a repetição também devolva um **token de
acesso utilizável**, configure um segredo:

```bash
QA_RADAR_ACCESS_TOKEN_SECRET="pelo-menos-32-bytes-de-segredo-aqui"
```

Com ele, o token de acesso passa a ser derivado do id da análise por HMAC, em
vez de sorteado. Isso é o que permite recomputá-lo depois de o processo morrer
**sem nunca gravá-lo**: o que fica em repouso continua sendo apenas o SHA-256
dele, e a tabela de idempotência não tem coluna de token. Sem o segredo, o token
volta a ser aleatório e a repetição após reinício devolve a análise sem token —
degradação consciente, e o comportamento anterior.

Trocar o segredo invalida os tokens em circulação, que é o efeito esperado de
uma rotação. Ele precisa ter ao menos 32 bytes; menos que isso falha no boot.

**Ainda não persistido:** o agendamento continua em processo — o repositório já
suporta claim atômico entre instâncias (`FOR UPDATE SKIP LOCKED`), mas a fila em
si ainda não usa isso.

### Artefatos duráveis (opcional)

Relatórios, screenshots e vídeos são gravados em disco. Em hospedagem com disco
efêmero (o caso do Render), isso significa que **todo relatório morre no próximo
deploy** e o link que alguém guardou para de funcionar.

Para mantê-los, aponte para qualquer armazenamento compatível com S3:

```bash
QA_RADAR_STORAGE_BUCKET=qa-radar-artefatos \
QA_RADAR_STORAGE_ACCESS_KEY_ID=... \
QA_RADAR_STORAGE_SECRET_ACCESS_KEY=... \
QA_RADAR_STORAGE_ENDPOINT=https://<conta>.r2.cloudflarestorage.com \
npm run web
```

- As três primeiras variáveis andam juntas: preencher só parte delas falha no
  boot, em vez de deixar cada análise subir artefato para lugar nenhum.
- `QA_RADAR_STORAGE_ENDPOINT` vazio usa a AWS; preenchido aponta para Cloudflare
  R2, MinIO ou outro compatível.
- `QA_RADAR_STORAGE_REGION` tem padrão `auto`, que é o que o R2 exige. Na AWS,
  informe a região do bucket.

O scanner continua escrevendo em disco (ele precisa de sistema de arquivos, e a
CLI grava exatamente ali). O envio acontece depois que a análise termina, e a
leitura tenta o disco primeiro — o armazenamento cobre justamente o caso em que
o disco não existe mais. Falha no envio é registrada e não altera o resultado da
análise, que já está pronto.

**Duas ressalvas:**

- Servir um artefato depois que o contêiner foi recriado também exige o banco
  (`QA_RADAR_DATABASE_URL`): o hash do token de acesso fica em disco junto com
  os artefatos, e sem o banco não há como validar o acesso. Configure os dois.
- O `@aws-sdk/client-s3` é **dependência opcional** e só é carregado quando o
  armazenamento está configurado — quem usa apenas a CLI nunca o importa. Ele
  emite um aviso de descontinuação em Node 20, que é a versão mínima declarada
  aqui; funciona, mas o aviso aparece. Em Node 22+ não aparece.

Para desenvolver contra um Postgres descartável:

```bash
docker run -d --name qa-radar-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=qaradar -p 55432:5432 postgres:16-alpine
QA_RADAR_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/qaradar" npm run test:persistence
```

Sem `QA_RADAR_TEST_DATABASE_URL`, `npm run test:persistence` exercita apenas a
implementação em memória; o CI roda as duas.

### Contas, aplicações e acesso (opcional)

Tudo aqui depende de `QA_RADAR_DATABASE_URL`: sem banco não há onde guardar
usuário nem sessão, e o produto roda anônimo como sempre — a análise devolve um
token e esse token é o que abre o resultado.

Com banco, a pessoa se cadastra em `/entrar` com e-mail e senha. As senhas usam
`scrypt` da plataforma, com o custo gravado dentro do próprio hash, então subir
o custo depois vale para senhas novas sem invalidar as existentes.

| Variável                                                      | Efeito                                                                                                                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QA_RADAR_EMAIL_API_KEY` + `QA_RADAR_EMAIL_FROM`              | Ligam a confirmação de e-mail e o "esqueci minha senha" (provedor: Brevo). Sem elas o cadastro funciona e quem perder a senha fica sem caminho de volta. O remetente precisa estar verificado no painel do provedor. |
| `QA_RADAR_EMAIL_FROM_NAME`                                    | Nome exibido no remetente. Padrão `QA Radar`.                                                                                                                                                                        |
| `QA_RADAR_GITHUB_CLIENT_ID` + `QA_RADAR_GITHUB_CLIENT_SECRET` | Acrescentam a entrada pelo GitHub. Escopo `read:user user:email` — o e-mail **verificado** é o que faz quem já se cadastrou cair na própria conta em vez de ganhar uma segunda.                                      |
| `QA_RADAR_REQUIRE_ACCOUNT`                                    | `true` exige conta para **executar** análise, jornada ou teste de API. Navegar, ler e abrir relatório continuam livres. **Padrão `false`**, para a CLI e o dashboard local não passarem a exigir cadastro.           |

Cada conta tem suas próprias **aplicações** (nome, URL base e ambientes),
gerenciadas em `/aplicacoes`. Tanto uma análise da Inspeção quanto uma execução
do Modo Jornada podem ser vinculadas a uma aplicação, e
`GET /api/v1/applications/{id}/scans` devolve as duas coisas numa linha do tempo
só. O histórico de `GET /api/v1/scans` devolve exclusivamente o que pertence a
quem pediu. Aplicação de outra conta responde `404`, e não `403`: responder
proibido confirmaria que aquele identificador existe.

**Relatórios (`/relatorios`)** reúne as três origens numa linha do tempo só, com
filtro por aplicação, tipo e período. Depende de conta — sem banco a página diz
isso e o histórico continua na Visão geral, por navegador. A API por trás é
`GET /api/v1/executions`, paginada por cursor (`nextCursor`).

**Central de qualidade (`/central-de-qualidade`)** soma a mesma linha do tempo
em vez de listá-la: total, taxa de sucesso, comparação com o período anterior
de igual duração, tendência diária e a quebra por tipo e por aplicação.
Depende de conta, como Relatórios. A API é `GET /api/v1/quality/summary`.

**Alertas (`/alertas`)** lista o que pede atenção agora, para a conta inteira
(não por aplicação): as execuções com falha dos últimos 7 dias e um alerta
quando a taxa de sucesso caiu 15 pontos percentuais ou mais frente ao período
anterior de igual duração, com pelo menos 5 execuções decididas nesse período
anterior. Só painel nesta primeira entrega — nenhum e-mail sai daqui ainda,
mesmo com Brevo configurado. A API é `GET /api/v1/alerts`, sem tabela nova:
computa sobre a mesma linha do tempo de Relatórios a cada chamada.

**Testes de API: o que sobe e o que não sobe.** Escolhida uma aplicação em
`/api-tests`, a collection passa a viver na conta e cada execução entra no
histórico da aplicação. Sobem nome, método, URL, params, headers e body, mais o
_formato_ da autenticação. **Nunca sobem** bearer token, senha, valor de API key,
valor de header sensível nem valor de query param com cara de segredo — nem
colado dentro da URL. Não são mascarados: não entram na estrutura gravada, e a
limpeza roda no servidor, não no navegador. Guarde credencial em **Variáveis**,
que ficam só no navegador, e referencie com `{{nome}}`. Sem aplicação escolhida,
a página continua inteiramente local, como sempre foi.

O histórico de execuções de API guarda método, URL já limpa, status e duração.
**Corpo de requisição e de resposta não são gravados**: é neles que moram token,
dado pessoal e payload de cliente.

**A Jornada só deixa registro com banco.** Sem `QA_RADAR_DATABASE_URL` a
execução continua vivendo em memória e num `code-report.json` no disco, como
sempre: some no reinicio e não pertence a ninguém. Com banco ela ganha dono,
aplicação e retenção — e, se o armazenamento de artefatos estiver configurado,
o relatório de evidências e as capturas sobrevivem ao contêiner ser recriado.

Brevo em vez de Resend por uma restrição concreta: o Resend só entrega para
endereço de terceiros depois de verificar um **domínio**, e o endereço público
do projeto está em `onrender.com`, que não é nosso para verificar. O Brevo
aceita verificar um remetente avulso.

Para alterar host ou porta conscientemente:

```bash
HOST=0.0.0.0 PORT=8080 npm run web
```

No PowerShell:

```powershell
$env:HOST="0.0.0.0"
$env:PORT="8080"
npm run web
```

## Docker

A imagem inclui o Chromium e as dependências de sistema exigidas pelo Playwright, executa com usuário sem privilégios e utiliza `/health` para verificar a disponibilidade:

```bash
docker build -t qa-radar .
docker run --rm -p 4173:4173 qa-radar
```

Acesse `http://localhost:4173`. O armazenamento dentro do contêiner é temporário; em produção, os resultados expiram automaticamente após uma hora.

Não habilite `QA_RADAR_ALLOW_PRIVATE_TARGETS` em uma implantação pública. Quando a plataforma utilizar um proxy reverso confiável, configure `QA_RADAR_TRUST_PROXY=true` para o rate limit considerar o IP original.

## Deploy gratuito no Render

O arquivo `render.yaml` prepara um Web Service Docker gratuito com health check,
uma análise simultânea, fila máxima de cinco jobs e cobertura limitada a cinco
páginas por sitemap para reduzir picos de memória. Depois de publicar o
repositório no GitHub:

1. No Render, escolha **New > Blueprint**.
2. Conecte o repositório do QA Radar.
3. Confirme o plano **Free** e aplique o Blueprint.
4. Ao final, use o endereço HTTPS `qa-radar-....onrender.com` fornecido pela plataforma.

O plano gratuito possui recursos limitados, armazenamento efêmero e suspensão por inatividade. Ele é adequado para demonstração e validação da Beta, não para uma operação com garantia de disponibilidade.

Decisão de produto: a Beta e os pilotos permanecerão gratuitos. Não haverá
cobrança, assinatura, fatura ou captura de pagamento até que o produto cumpra
integralmente os critérios de pronto para comercialização, incluindo segurança,
persistência, isolamento por organização, operação e suporte.

Como as métricas de CPU e memória do painel podem exigir uma instância paga, o
servidor também registra telemetria operacional em JSON no log padrão. Procure
por `scan.started`, `scan.completed`, `scan.failed` e `scan.expired` nos Logs do
serviço. O evento inicial registra navegador, cobertura, screenshot e limites
da análise. Os eventos de conclusão informam duração, CPU de usuário e sistema,
RSS, heap, memória externa, tamanho da fila e resultado do quality gate. Apenas
a origem do alvo é registrada; caminhos e parâmetros da URL não aparecem no
log.

### Proteção contra automação

O formulário suporta Cloudflare Turnstile com validação obrigatória no servidor. Crie um widget no painel da Cloudflare, autorize o domínio `qa-radar.onrender.com` e configure no Render:

- `TURNSTILE_SITE_KEY`: chave pública do widget.
- `TURNSTILE_SECRET_KEY`: chave secreta, disponível somente no backend.

As duas variáveis devem ser configuradas juntas. Sem elas, o Turnstile permanece desativado para facilitar o desenvolvimento local. Nunca publique a chave secreta no repositório.

O Turnstile permanece adiado no deploy atual por decisão operacional. Antes de
uma divulgação ampla do endereço público, reavalie sua ativação ou adote outra
camada de controle de abuso.

## Desenvolvimento

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:integration
npm run build
npm run benchmark:sitemap

# ou typecheck, lint, formatação, testes unitários e build em um comando só
npm run check

# relatório de cobertura dos testes unitários (informativo, não bloqueia o CI)
npm run test:coverage
```

O benchmark cria localmente um sitemap sintético com 20 páginas, executa a
cobertura sequencial em Chromium e informa duração, média por página e pico de
memória do processo Node. A memória dos subprocessos do navegador não está
incluída nessa métrica. Resultados de referência estão em [BENCHMARKS.md](BENCHMARKS.md).

## Processo de release

O workflow de CI valida typecheck, testes e build em Windows e Linux, executa as
integrações Playwright no Linux e testa a composite action contra uma página
pública estável. Os relatórios desse smoke test ficam disponíveis como
artefatos por sete dias.

Para preparar uma versão, confirme que `package.json`, `package-lock.json`,
`src/version.ts`, README e changelog declaram a mesma versão. Depois de integrar
as mudanças na branch `main`, crie e envie uma tag correspondente:

```bash
git tag -a v3.2.0 -m "QA Radar 3.2.0"
git push origin v3.2.0
```

O workflow de release rejeita tags que não correspondam ao `package.json`,
executa novamente a validação principal, gera o pacote npm e cria um GitHub
Release com notas automáticas. A publicação no registry npm não é automática.

## Feedback

Esta é uma versão Beta. Relatos de falsos positivos, mensagens pouco claras, elementos não identificados e sugestões de novas jornadas são especialmente úteis para orientar as próximas versões.

Ao reportar um problema, inclua quando possível:

- navegador utilizado;
- URL ou cenário reproduzível;
- relatório JSON;
- screenshot anotado;
- resultado esperado e resultado encontrado.

## Licença

O QA Radar é distribuído sob a [Licença de Avaliação e Teste](LICENSE). É
permitido clonar e executar o projeto para avaliação, aprendizado e testes
locais não comerciais. Cópia, redistribuição, revenda, hospedagem para
terceiros e uso comercial exigem autorização prévia e escrita do titular.

As dependências e componentes de terceiros permanecem sujeitos às suas próprias
licenças.
