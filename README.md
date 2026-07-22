# QA Radar

> **Beta · versão 3.1.0**
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

Abra [http://127.0.0.1:4173](http://127.0.0.1:4173), informe a URL e execute o scanner.

No dashboard é possível:

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

### Jornadas Playwright experimentais

Crie `journey.json`:

```json
{
  "schemaVersion": "1.0",
  "name": "Login",
  "steps": [
    { "action": "goto", "url": "https://staging.example.com/login" },
    { "action": "fill", "selector": "#email", "value": "qa@example.com" },
    { "action": "fill", "selector": "#password", "valueFromEnv": "QA_RADAR_SECRET_PASSWORD" },
    { "action": "click", "selector": "button[type=submit]" },
    { "action": "assertVisible", "selector": "[data-testid=dashboard]" }
  ]
}
```

No PowerShell, configure o secret apenas no ambiente e execute:

```powershell
$env:QA_RADAR_SECRET_PASSWORD="valor-protegido"
npm run dev -- https://staging.example.com --journey journey.json --output qa-radar-journey
```

O modo é opt-in, aceita somente a origem informada e gera `journey-report.json`
e screenshots em `journey-evidence/`.

Para testar jornadas no dashboard local:

```powershell
$env:QA_RADAR_ENABLE_JOURNEYS="true"
$env:QA_RADAR_ALLOW_PRIVATE_TARGETS="true" # somente se o alvo for localhost/rede privada
npm run web
```

O painel **Jornada Playwright** aparecerá abaixo do scanner. O recurso permanece
desabilitado por padrão no servidor; o Blueprint do Render o habilita somente
para a etapa controlada de homologação descrita abaixo.

No dashboard, jornadas são executadas como jobs assíncronos. A criação retorna
um token usado no acompanhamento, cancelamento, relatório JSON e evidências. O
servidor limita passos, payload e duração total; no Blueprint Render os limites
preparados são 10 passos, 16 KiB e 120 segundos. O Blueprint habilita Jornadas
para homologação controlada; qualquer aplicação dessa configuração continua
dependendo de deploy manual e validação operacional no Render.

## Como interpretar os resultados

| Categoria | Nível comum | Exemplo |
| --- | --- | --- |
| Navegador | erro ou aviso | recurso bloqueado ou cookie de terceiro rejeitado |
| JavaScript | erro | exceção ou conteúdo inválido executado como script |
| Carregamento | erro ou aviso | imagem `404`, API `401` ou servidor `500` |
| Rede | erro | DNS, TLS, conexão ou conteúdo incompatível |
| Navegação | erro | timeout ou página inacessível |
| Performance | aviso | TTFB, LCP ou CLS fora do recomendado |
| Elemento da página | erro ou aviso | imagem quebrada ou ID duplicado |
| Acessibilidade | aviso | botão sem nome, campo sem label ou iframe sem título |

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

## Roadmap da versão Beta

As funcionalidades abaixo são direções planejadas, sem prazo fechado e sujeitas a mudanças conforme o uso e o feedback recebido.

O plano incremental, as regras de compatibilidade e as evidências de validação de
cada etapa são mantidos em [`docs/EVOLUTION_LOG.md`](docs/EVOLUTION_LOG.md).

### Exploração configurável

- Permitir que o QA descreva jornadas com cliques e preenchimento de campos.
- Criar uma lista explícita de ações permitidas e bloquear ações destrutivas.
- Capturar evidências antes e depois de cada etapa.
- Suportar login por cookies ou storage state do Playwright.

### Cobertura

- Percorrer links internos com limite de profundidade.
- Executar a mesma análise em diferentes viewports.
- Comparar resultados entre Chromium, Firefox e WebKit.

### Qualidade e acessibilidade

- Ampliar a auditoria de acessibilidade e a interpretação das regras WCAG.
- Detectar problemas de layout, conteúdo cortado e overflow.
- Evoluir o agrupamento de sintomas em causas-raiz.
- Permitir configurar severidade, regras e falsos positivos por projeto.

### Colaboração e histórico

- Evoluir o histórico local para PostgreSQL e armazenamento de artefatos compatível com S3.
- Adicionar autenticação, organizações e permissões por projeto.
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

Cada análise criada pela API recebe um token aleatório. O dashboard preserva esse
token em cookie `HttpOnly`, restrito às rotas da própria análise. Clientes da API
devem enviar o valor retornado em `accessToken` pelo cabeçalho
`Authorization: Bearer <token>` para consultar o estado, cancelar ou baixar
artefatos. O servidor guarda somente o hash do token durante a retenção.

O servidor limita por padrão cada endereço a 10 novas análises por minuto,
retorna os cabeçalhos `X-RateLimit-Limit`, `X-RateLimit-Remaining` e
`X-RateLimit-Reset`, mantém resultados por uma hora e expõe `GET /health` para
monitoramento. Quando o limite é excedido, a resposta `429` também informa
`Retry-After`. Em uma hospedagem com proxy reverso conhecido, configure
`QA_RADAR_TRUST_PROXY=true` para considerar `X-Forwarded-For`. Não habilite essa
opção ao expor o processo Node diretamente.

O limite global padrão de uma análise é cinco minutos. No Blueprint do Render ele
é reduzido para três minutos por `QA_RADAR_MAX_JOB_DURATION_MS=180000`. Esse
limite inclui inicialização do navegador, navegação, inspeção e relatórios.

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
npm test
npm run test:integration
npm run build
npm run benchmark:sitemap

# ou typecheck, testes unitários e build
npm run check
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
git tag -a v3.1.0 -m "QA Radar 3.1.0"
git push origin v3.1.0
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

[MIT](LICENSE)
