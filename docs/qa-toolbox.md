# QA Toolbox

**Daily tools for Software Quality.**

O QA Toolbox é a área de ferramentas rápidas do QA Radar: coisas que um QA faz
todo dia, precisa em segundos e hoje resolve com seis abas abertas em sites de
terceiros — comparar dois JSON, ler um token, gerar massa, converter um cURL em
teste, verificar se o ambiente está de pé, derivar os casos de fronteira de um
campo.

Ele não substitui nada do QA Radar. A Inspeção, a Jornada, os Testes de API, o
histórico e os relatórios continuam onde estavam; o Toolbox é o complemento que
resolve o pequeno sem exigir configuração, projeto ou execução de job.

Rota: [`/toolbox`](http://localhost:4173/toolbox) — entrada **QA Toolbox** na
navegação lateral.

## Princípios

1. **Privacidade primeiro.** Toda ferramenta que consegue rodar no navegador
   roda no navegador. O selo 🔒 **Roda local** só aparece quando nada digitado
   sai da máquina — é promessa, não enfeite, e o catálogo é testado para não
   deixar essa promessa mentir.
2. **Nada de segredo guardado.** JWT, `Authorization`, chave de API e cookie
   não são persistidos, não vão para log, não vão para o histórico e não vão
   para telemetria. No cURL Converter eles são mascarados na tela e substituídos
   por variável de ambiente no código gerado.
3. **Fluxo curto.** Entrada → ação → resultado → copiar/exportar. Nenhuma
   ferramenta pede mais de uma tela.
4. **Sem login obrigatório.** Navegar e usar as ferramentas locais não exige
   conta. Só o API Health, que sai para a rede pelo servidor, respeita
   `QA_RADAR_REQUIRE_ACCOUNT` como o resto do produto.

## Ferramentas do MVP

| Ferramenta                   | Categoria   | Onde roda | O que faz                                                             |
| ---------------------------- | ----------- | --------- | --------------------------------------------------------------------- |
| **JSON Diff**                | API & JSON  | Navegador | Compara dois JSON ignorando campos dinâmicos                          |
| **JWT Inspector**            | API & JSON  | Navegador | Decodifica header/payload e interpreta `iat`, `exp` e `nbf`           |
| **API Health**               | API & JSON  | Servidor  | Mede status e tempo de vários endpoints e resume o ambiente           |
| **Test Data Generator**      | Test Data   | Navegador | Gera massa sintética válida ou propositalmente inválida               |
| **cURL Converter**           | Automation  | Navegador | Converte um cURL em Playwright, Cypress, Fetch, Axios, Python ou Java |
| **Boundary Value Generator** | Test Design | Navegador | Deriva os casos de fronteira de um campo                              |

### JSON Diff

Aceita JSON formatado ou minificado, objetos e arrays aninhados. Reporta
`ADDED`, `REMOVED`, `CHANGED` e `TYPE_CHANGED` — `"5000"` virar `5000` é uma
quebra de contrato diferente de `5000` virar `3000`, e as duas não se misturam.

Campos ignorados aceitam três formas:

| Forma                | Alcance                                               |
| -------------------- | ----------------------------------------------------- |
| `requestId`          | a propriedade com esse nome, em qualquer profundidade |
| `metadata.timestamp` | esse caminho, na raiz ou aninhado em qualquer objeto  |
| `data[*].requestId`  | o mesmo, com `[*]` cobrindo qualquer índice de array  |

Chave cujo nome não é um identificador simples aparece entre colchetes e aspas
(`$["content-type"]`, `$["a.b"]`), para não se confundir com um caminho aninhado
nem com um índice de array. A regra por nome continua valendo para elas.

### JWT Inspector

Decodifica e **só** decodifica. O status é `VALID STRUCTURE`, `EXPIRED` ou
`NOT ACTIVE YET` — nunca "válido" sozinho, porque sem a chave do emissor não há
como afirmar que a assinatura confere. A interface diz isso explicitamente:
`signatureVerified` é sempre `false`.

Token colado com quebra de linha (terminal, log, header quebrado por wrap) é
aceito. Desvios do RFC 7519 que o token foi lido apesar de ter — `exp` como
texto, `exp` em milissegundos, claim de data que não é número — aparecem como
aviso em vez de sumirem: é o que explica uma expiração que parece errada.

### API Health

A única ferramenta que usa o servidor, porque o navegador não consegue medir um
endpoint de terceiro (CORS). A chamada sai do QA Radar com as travas:

- apenas `GET` e `HEAD` — um health check não escreve nada;
- sem cabeçalhos vindos do cliente, para não virar proxy de autenticação;
- até 10 endpoints por verificação;
- mesma política de rede da Inspeção (`PublicNetworkGuard`): endereços locais,
  redes privadas e endpoints de metadados de nuvem são recusados, com
  revalidação a cada redirecionamento.

Classificação: status diferente do esperado é `FAILED`; status certo acima do
tempo combinado é `DEGRADED`; o resto é `HEALTHY`. O ambiente vale o pior dos
seus serviços. **Copiar relatório do ambiente** gera texto puro — o único
formato que sobrevive igual no Slack, Teams, Jira, Azure DevOps e GitHub.

### Test Data Generator

Gera nome, CPF, CNPJ, e-mail, telefone, UUID, data, data de nascimento,
inteiro, decimal, boolean, texto e CEP; exporta em JSON, CSV e SQL.

Cada campo tem duas variações: **válido** (CPF e CNPJ com dígitos verificadores
corretos) e **inválido** de propósito (verificador quebrado, e-mail sem `@`,
`31/02`, nascimento no futuro, texto acima do tamanho aceito). Toda a massa é
sintética e a interface avisa: _Synthetic Test Data — Do not use as real
identity data._

O nome do campo precisa ser um identificador (`[A-Za-z_][A-Za-z0-9_]*`): ele
vira propriedade no JSON, coluna no CSV e **identificador no `INSERT`**, e um
nome livre sairia cru num SQL feito para ser colado num banco.

### cURL Converter

Interpreta método, URL, query, headers, corpo e `-u`, inclusive com a
continuação de linha do "Copy as cURL" do DevTools. Converte para Playwright,
Cypress, JavaScript Fetch, Axios, Python Requests e Rest Assured.

Segredo nenhum entra no código: `Authorization`, `x-api-key`, `Cookie` e
similares viram `process.env.API_TOKEN` (ou o equivalente da linguagem), e na
tela aparecem mascarados.

### Boundary Value Generator

Gera os seis casos clássicos — abaixo do mínimo, mínimo, acima do mínimo,
abaixo do máximo, máximo, acima do máximo — para inteiro, decimal, tamanho de
texto e data. Faixas curtas colapsam pontos repetidos em vez de inflar a suíte.
Exporta como plano de teste (`TC001 - ...`) ou CSV.

## Arquitetura

O Toolbox segue a arquitetura do QA Radar, sem framework e sem bundler. O que
ele acrescenta é uma separação explícita entre **regra** e **interface**:

```
src/toolbox/            regra de negócio, TypeScript puro, sem DOM e sem Node
  catalog.ts            definição de todas as ferramentas e a busca
  json-value.ts         tipos JSON e leitura da entrada do usuário
  json-diff.ts          motor do diff
  boundary-values.ts    análise de valor limite
  test-data.ts          geração de massa
  jwt.ts                decodificação de JWT
  curl.ts               leitura do cURL e geradores de código
  health.ts             classificação e relatório do ambiente

src/web-toolbox.ts      HTML das páginas (só marcação)
src/toolbox-client.ts   scripts de navegador (só DOM: lê campo, chama, desenha)
src/routes/toolbox.ts   páginas, assets e POST /api/v1/toolbox/health-checks
```

Os módulos de `src/toolbox/` são a **única** implementação de cada regra:

- os testes do Node os importam direto, com tipo e cobertura;
- o navegador recebe os **mesmos** módulos, servidos como ES modules em
  `/assets/toolbox/<módulo>.js` e importados por um `<script type="module">` na
  página.

Em produção o servidor entrega o `.js` já compilado em `dist/toolbox/`. Em
desenvolvimento (`npm run web`, via `tsx`) esse `.js` não existe, e a rota
remove os tipos na hora com o mesmo compilador do build. Nos dois casos o
navegador executa exatamente o código que os testes exercitam — não há uma
segunda cópia da regra escrita em JavaScript solto.

Por isso as páginas do Toolbox — e só elas — usam `script-src 'self'` na CSP.

### Restrições dos módulos de `src/toolbox/`

Como o mesmo arquivo roda no Node e no navegador:

- nada de `import` de módulo do Node (`node:fs`, `Buffer`, `process`);
- nada de DOM (`document`, `window`, `localStorage`);
- só APIs presentes nos dois: `JSON`, `Intl`, `atob`, `TextDecoder`, `URL`,
  `Math`, `Date`.

A camada de DOM fica em `src/toolbox-client.ts`. Como nos demais clientes do
produto, esses scripts vivem dentro de um `String.raw` do servidor e por isso
**não podem usar crase nem interpolação `${...}`** — concatene com `+`.

## Adicionar uma nova ferramenta

Cinco passos. Nenhum deles mexe em navegação, busca ou roteamento: tudo isso sai
do catálogo.

**1. Escreva a regra** em `src/toolbox/<sua-ferramenta>.ts`, respeitando as
restrições acima. Funções pequenas, tipadas, sem DOM.

**2. Escreva o teste** em `tests/toolbox-<sua-ferramenta>.test.ts` e registre o
arquivo nos scripts `test` e `test:coverage` do `package.json` (a suíte lista os
arquivos explicitamente).

**3. Registre no catálogo** (`src/toolbox/catalog.ts`):

```ts
{
  id: "regex-tester",
  name: "Regex Tester",
  description: "Teste expressões regulares contra várias entradas de uma vez.",
  category: "utilities",
  tags: ["regex", "expressão regular", "match"],
  route: "/toolbox/regex-tester",
  status: "new",
  runsLocally: true,
  icon: "inspection",
}
```

`runsLocally: true` é uma afirmação verificável: só use se nenhum dado digitado
sair do navegador. `status: "soon"` publica o card como anúncio, sem página.

**4. Monte a página** em `src/web-toolbox.ts`: uma função `render<Ferramenta>`
usando `renderToolShell`, `renderToolActions` e as classes `tool-*` já
existentes; registre-a em `RENDERERS`.

**5. Ligue a interface** em `src/toolbox-client.ts`: exporte
`<FERRAMENTA>_SCRIPT` importando de `/assets/toolbox/<sua-ferramenta>.js` e
registre em `TOOLBOX_SCRIPTS`. Se o módulo for novo, acrescente o nome dele em
`BROWSER_MODULES`, em `src/routes/toolbox.ts` — a lista é explícita de
propósito, para que a rota nunca sirva um arquivo por acaso.

Feito isso, a ferramenta aparece sozinha na home, na busca e na categoria. Os
testes de `tests/toolbox-catalog.test.ts` cobrem o resto: id único, rota no
padrão, categoria conhecida, página existente e selo de privacidade coerente.

### Componentes reutilizáveis

| Componente                              | Onde                | Para quê                                    |
| --------------------------------------- | ------------------- | ------------------------------------------- |
| `renderToolShell`                       | `web-toolbox.ts`    | shell, trilha, cabeçalho e selo             |
| `renderToolActions`                     | `web-toolbox.ts`    | linha de botões (primário + secundários)    |
| `renderPrivacyBadge`                    | `web-toolbox.ts`    | selo "Roda local" / "Usa o servidor"        |
| `.tool-panel` `.tool-io` `.tool-field`  | CSS                 | painel, dois textareas lado a lado, campo   |
| `.tool-result-head` `.tool-summary`     | CSS                 | cabeçalho e resumo do resultado             |
| `.tool-status-{ok,warning,fail}`        | CSS                 | estado do resultado                         |
| `.tool-code` `.tool-tabs` `.tool-table` | CSS                 | bloco de código, abas e tabela              |
| `.tool-facts`                           | CSS                 | lista de fatos (termo/valor)                |
| `copyText` `downloadFile` `showError`   | `toolbox-client.ts` | copiar, baixar e erro, iguais em todo lugar |

## Testes

```bash
npm test                  # unitários, inclui os sete arquivos toolbox-*
npm run test:integration  # inclui tests/toolbox.integration.test.ts
```

`tests/toolbox.integration.test.ts` cobre as rotas (páginas, assets, health
check com SSRF e limites) e roda as seis ferramentas em um Chromium de verdade,
verificando também:

- que a comparação de JSON não faz nenhum `POST` — a promessa do selo;
- que o token não aparece na tela nem no código gerado;
- que nenhum erro de console ou violação de CSP acontece;
- axe-core sem violação de nível erro em `/toolbox` e nas páginas;
- ausência de rolagem horizontal em 390 px.

## Roadmap

| Versão  | Ferramentas                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **1.0** | JSON Diff, Test Data, JWT Inspector, cURL Converter, API Health, Boundary Values                                             |
| 1.1     | Pairwise Generator, HTTP Status Explorer, Timestamp Converter, Regex Tester                                                  |
| 1.2     | OpenAPI Diff, Webhook Inspector, JSON Schema Validator                                                                       |
| Futuro  | Flaky Test Analyzer, SQL Test Data Builder, GraphQL Tester, Test Case Generator, API Contract Analyzer, Release Quality Gate |

As três anunciadas no catálogo (`status: "soon"`) já aparecem na home como card
sem link — o compromisso é público, a página é que ainda não existe.
