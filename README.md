# QA Radar

> **Beta · versão 2.2.0**  
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
- Imagens visíveis sem descrição alternativa.
- Botões e links sem identificação acessível.
- Campos de formulário sem label ou nome acessível.
- Iframes visíveis sem título.
- Identificadores HTML duplicados.
- Relação entre recursos com falha e seus elementos no DOM.

Essa inspeção é considerada segura porque não clica automaticamente em controles, não envia formulários e não executa ações que possam alterar dados.

### Evidências e relatórios

- Screenshot completo da página.
- Contorno visual sobre elementos relacionados aos problemas.
- Marcadores numerados conectando elemento e ocorrência.
- Painel de diagnóstico inserido na evidência visual.
- Selector, descrição e posição do elemento no relatório.
- Relatórios HTML e JSON.
- Agrupamento de mensagens repetidas pela mesma causa.
- Detalhes técnicos recolhidos para priorizar a leitura do QA.

### Execução e automação

- Chromium, Firefox e WebKit.
- Dashboard responsivo para uso manual.
- CLI para automações e pipelines.
- Quality gate configurável.
- Exit codes próprios para aprovação, reprovação e erro de execução.
- Filtros por status HTTP e expressão regular de URL.
- Fila local com até duas análises simultâneas.
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
- acompanhar a execução;
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

Consultar todas as opções:

```bash
npm run dev -- --help
```

## Como interpretar os resultados

| Categoria | Nível comum | Exemplo |
| --- | --- | --- |
| Navegador | erro ou aviso | recurso bloqueado ou cookie de terceiro rejeitado |
| JavaScript | erro | exceção ou conteúdo inválido executado como script |
| Carregamento | erro ou aviso | imagem `404`, API `401` ou servidor `500` |
| Rede | erro | DNS, TLS, conexão ou conteúdo incompatível |
| Navegação | erro | timeout ou página inacessível |
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
  uses: actions/upload-artifact@v4
  with:
    name: qa-radar-report
    path: qa-radar-report/
```

## Roadmap da versão Beta

As funcionalidades abaixo são direções planejadas, sem prazo fechado e sujeitas a mudanças conforme o uso e o feedback recebido.

### Exploração configurável

- Permitir que o QA descreva jornadas com cliques e preenchimento de campos.
- Criar uma lista explícita de ações permitidas e bloquear ações destrutivas.
- Capturar evidências antes e depois de cada etapa.
- Suportar login por cookies ou storage state do Playwright.

### Cobertura

- Analisar múltiplas páginas e `sitemap.xml`.
- Percorrer links internos com limite de profundidade.
- Executar a mesma análise em diferentes viewports.
- Comparar resultados entre Chromium, Firefox e WebKit.

### Qualidade e acessibilidade

- Ampliar a auditoria de acessibilidade com regras WCAG.
- Adicionar Web Vitals e métricas de desempenho.
- Detectar problemas de layout, conteúdo cortado e overflow.
- Evoluir o agrupamento de sintomas em causas-raiz.
- Permitir configurar severidade, regras e falsos positivos por projeto.

### Colaboração e histórico

- Persistir análises e comparar execuções.
- Destacar somente problemas novos após um deploy.
- Criar dashboard com histórico por projeto e ambiente.
- Exportar JUnit e integrar resultados a pull requests.
- Adicionar autenticação e suporte seguro a uso compartilhado.

## Limitações da Beta

- As regras atuais são heurísticas e podem produzir falsos positivos ou deixar problemas passarem.
- A auditoria de acessibilidade não representa uma certificação WCAG completa.
- A ferramenta não entende sozinha a regra de negócio da aplicação.
- Elementos carregados depois da janela de observação podem não ser analisados.
- Erros de serviços externos podem aparecer no relatório da página que os incorporou.
- O scanner não clica, envia formulários ou percorre jornadas automaticamente nesta versão.
- O armazenamento dos resultados é local e não possui banco de dados ou histórico permanente.

## Segurança e publicação

Por padrão, o dashboard escuta somente em `127.0.0.1` e aceita apenas destinos públicos. Endereços locais, redes privadas, credenciais em URLs e recursos privados carregados por redirecionamentos são bloqueados.

Para uma execução local controlada que precise analisar `localhost` ou a rede interna, habilite explicitamente:

```powershell
$env:QA_RADAR_ALLOW_PRIVATE_TARGETS="true"
npm run web
```

Ainda são necessários autenticação, HTTPS e persistência antes de uma implantação aberta ao público. A API já aplica política de destinos públicos, rate limit, limite de fila e tetos de duração como primeiras camadas de proteção.

O servidor limita por padrão cada endereço a 10 novas análises por minuto, mantém resultados por uma hora e expõe `GET /health` para monitoramento. Em uma hospedagem com proxy reverso conhecido, configure `QA_RADAR_TRUST_PROXY=true` para considerar `X-Forwarded-For`. Não habilite essa opção ao expor o processo Node diretamente.

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

O arquivo `render.yaml` prepara um Web Service Docker gratuito com health check, uma análise simultânea e fila máxima de cinco jobs. Depois de publicar o repositório no GitHub:

1. No Render, escolha **New > Blueprint**.
2. Conecte o repositório do QA Radar.
3. Confirme o plano **Free** e aplique o Blueprint.
4. Ao final, use o endereço HTTPS `qa-radar-....onrender.com` fornecido pela plataforma.

O plano gratuito possui recursos limitados, armazenamento efêmero e suspensão por inatividade. Ele é adequado para demonstração e validação da Beta, não para uma operação com garantia de disponibilidade.

## Desenvolvimento

```bash
npm run typecheck
npm test
npm run test:integration
npm run build

# ou typecheck, testes unitários e build
npm run check
```

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
