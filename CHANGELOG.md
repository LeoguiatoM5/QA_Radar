# Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo.

## [Não publicado]

### Adicionado

- **A Jornada passou a deixar registro, com dono e aplicação.** Era a única
  coisa do produto que não deixava: a execução vivia num `Map` do processo e num
  `code-report.json` no disco — sem dono, sem aplicação, e na hospedagem, onde o
  disco é efêmero, sumindo no deploy seguinte. Nova tabela `code_executions`
  (migration `0006`) com `owner_id` e `application_id`, os dois com
  `on delete set null`: arquivar a aplicação ou apagar a conta não pode levar
  junto o registro do que aconteceu. O `/journeys` ganhou o seletor de aplicação
  que a Inspeção já tinha, e `/aplicacoes` ganhou o botão **Jornada**.

  A tabela **não** guarda o diretório de saída: ele é sempre
  `<resultsDir>/code-<id>` e o `resultsDir` muda de uma instância para outra —
  gravar o caminho seria guardar uma verdade da máquina que morreu. Os artefatos
  passaram a subir para o armazenamento durável, e a leitura tenta disco
  primeiro, como na Inspeção.

  **Isolamento:** o dono lê a própria execução sem apresentar o token; uma
  execução anônima continua exigindo o token mesmo de quem está logado, senão
  entrar numa conta qualquer viraria caminho para alcançar o que não é seu.
  Apontar a execução para a aplicação de outra conta responde 404.

  Sem `QA_RADAR_DATABASE_URL` nada disso muda: a Jornada volta ao comportamento
  antigo, em memória e disco. O produto não pode passar a exigir banco.

- **`GET /api/v1/applications/{id}/scans` devolve também as Jornadas** e entrou
  no contrato publicado, onde ainda não estava. As duas origens viram uma linha
  do tempo só na tela: separar em duas listas obrigaria quem lê a cruzar
  horários de cabeça para responder "o que aconteceu nesta aplicação".

- **Histórico por aplicação em `/aplicacoes`.** A Inspeção gravava
  `scan_jobs.application_id` desde que Aplicações existe, mas **nenhuma consulta
  lia essa coluna**: o vínculo ia para o banco e não aparecia em lugar nenhum do
  produto. Cada aplicação ganhou um botão **Histórico** que abre as análises
  guardadas nela. Novo `GET /api/v1/applications/:id/scans`, com o dono dentro
  da própria consulta — id de aplicação de outra conta responde 404, não 403.

- **O JavaScript do cliente saiu das strings — primeira etapa.** A interface
  inteira vivia dentro de `String.raw`, então o `tsc` e o `eslint` tratavam o
  código do navegador como texto e não olhavam para ele; foi de lá que saíram os
  bugs de UI mais caros, inclusive um erro de sintaxe que passou pelo build e
  pelos 553 testes e só apareceu abrindo a página. Agora existe `src/browser/`,
  compilado por `tsconfig.browser.json` com a lib do DOM e servido em
  `/assets/js/<módulo>.js` — em produção o `.js` do build, em desenvolvimento
  transpilado na hora, o mesmo caminho que o Toolbox já usava para
  `src/toolbox/`. A lista de módulos permitidos fecha a rota. `/entrar` é a
  primeira página migrada e, sem script embutido, perdeu o `'unsafe-inline'` do
  `script-src`: um `<script>` injetado no HTML dela não executa mais.
- `/aplicacoes` é a segunda página migrada. Ela ainda carrega o script do
  shell embutido, então mantém `'unsafe-inline'` no `script-src` — mas agora
  com `'self'` junto, senão o módulo seria bloqueado sem aviso na página.
- A Visão geral é a terceira. O `HOME_DASHBOARD_SCRIPT` era o maior dos
  clientes embutidos e o mais castigado desta semana.
- O shell — relógio, seletor de ambiente, menu no celular e controle de conta —
  e o script do FAQ também viraram módulos. Com isso **cinco páginas ficaram sem
  nenhum script embutido** e perderam o `'unsafe-inline'` do `script-src`: `/`,
  `/docs`, `/aplicacoes`, `/entrar` e `/em-construcao`. Inspeção, Jornada,
  Testes de API e Toolbox mantêm os dois valores enquanto o cliente das
  ferramentas continuar embutido.
- O último cliente embutido saiu, e no caminho virou três. O
  `WEB_CLIENT_SCRIPT` era um script só, carregado igual em Inspeção, Jornada e
  Testes de API — cada página baixava o código das outras duas e o executava
  inerte. Agora são `scanner`, `journey` e `api-tests`, com o que é comum em
  `shared`. **Com isso nenhuma página do produto tem script embutido**, e o
  `'unsafe-inline'` saiu do `script-src` de todas — só o Toolbox mantém,
  porque os módulos dele ainda são declarados dentro da página.
- **O Toolbox foi o último, e com ele o `'unsafe-inline'` acabou.** As 14 telas
  viviam em `src/toolbox-client.ts`, mil linhas de JavaScript dentro de
  `String.raw` — o maior bloco de código que nenhuma ferramenta do projeto
  conseguia ler. Cada uma virou um módulo em `src/browser/toolbox/`, servido em
  `/assets/js/toolbox/<id da ferramenta>.js`, com o que elas compartilham em
  `ui.ts` em vez de um prefixo colado em cada script. O caminho relativo para a
  regra de negócio é o mesmo no código-fonte e na URL — `../../toolbox/` sai de
  `/assets/js/toolbox/` e chega em `/assets/toolbox/` —, então a divisão entre
  o que decide e o que desenha continua igual, agora com o `tsc` conferindo os
  dois lados. `src/toolbox-client.ts` foi apagado e **nenhuma página do produto
  tem mais `'unsafe-inline'` no `script-src`**.

- **"Limpar histórico" na Visão geral.** As execuções recentes se acumulavam
  sem nenhuma forma de apagar, e a mesma lista tinha **três** cópias: a do
  navegador, uma por sessão no servidor — atrás de um cookie de um ano, com a
  URL de cada ambiente inspecionado — e a da conta, no banco. Apagar qualquer
  subconjunto delas não resolvia: o que sobrasse voltava inteiro no
  carregamento seguinte. O botão apaga as três, com confirmação, e não deixa
  resquício: os relatórios das análises que já terminaram saem do disco e do
  storage junto. Novos `DELETE /api/dashboard/activity` e
  `DELETE /api/v1/scans`; o `GET /api/v1/scans`, que também não estava no
  contrato publicado, entrou junto.

### Corrigido

- **"Limpar histórico" deixava o resultado alcançável por link.** Ele apagava a
  linha do banco e o relatório do disco, mas não o cache do processo — e a
  consulta por id olha para a memória antes do banco. Quem apagasse e abrisse o
  link guardado continuaria vendo o resultado até a retenção vencer, acreditando
  ter apagado. Vale para as duas metades: a Jornada, que agora entra no mesmo
  "apagar", e a Inspeção, onde o furo já existia.

- **A ordem das execuções na Visão geral estava errada sempre que havia
  histórico de conta.** O caminho local grava a data como época em número e o
  histórico da conta devolve ISO 8601; a ordenação usava `Number(...)`, que
  transforma ISO em `NaN`, faz o comparador devolver `NaN` e simplesmente não
  ordena. Dava para ver no Sinal ao vivo, com 18:18 e 19:38 listados embaixo de
  10:17. Os dois formatos agora passam pelo mesmo conversor.

- **A Inspeção falhava na primeira execução em qualquer servidor com histórico
  ligado.** A barra de contexto preenche o campo "Ambiente" sozinha e o campo
  "Projeto" nasce vazio; como a CLI exige os dois juntos, toda análise voltava
  com `--environment exige a opção --project.` — a mensagem de uma opção de
  linha de comando que ninguém tinha digitado. Sem projeto, ambiente e
  `acceptBaseline` agora são descartados em vez de reprovarem a análise.
- **`hidden` deixou de ser silenciosamente ignorado.** Qualquer regra de autor
  que declarasse `display` vencia o atributo, e cada componente precisava
  lembrar de repetir a exceção. As abas de `/entrar` continuavam à vista depois
  de terem sido escondidas. Uma regra global fecha a classe inteira de bug.
- **`/entrar` num servidor sem contas mantinha o formulário utilizável**: dava
  para digitar e-mail e senha e o envio voltava 403. Agora a página mostra o que
  de fato existe — usar o QA Radar sem entrar.
- **`/aplicacoes` num servidor sem banco também mantinha o cadastro aberto.** Os
  campos ficam desligados, com o motivo antes do formulário, e campo desligado
  passou a parecer desligado.
- **Avisos de uma linha na lista de ocorrências quebravam uma palavra por
  linha**: sem selo nem categoria, a mensagem caía na primeira coluna de 85px da
  grade. Atingia "O navegador está carregando e observando a página…" e "Nenhum
  problema encontrado". O texto inicial também citava o Chromium mesmo quando a
  análise roda no Firefox ou no WebKit.
- **Violação crítica de acessibilidade na Visão geral**: a lista de execuções
  declarava `role="rowgroup"` e o cabeçalho `role="row"` sem nenhuma tabela por
  cima (`aria-required-parent`). O cabeçalho, aliás, tinha `display:none` desde
  sempre e nunca chegou a ser renderizado — saiu junto com os papéis órfãos.
- **Contraste abaixo do mínimo** no contador de "Execuções recentes": 8,3px em
  `#60778d` dava 3,97:1.
- Campos de nome e valor dos Testes de API chegavam sem nome acessível ao leitor
  de tela — os títulos "Nome" e "Valor" da grade não são `label`.
- Sombra do botão primário vazava por baixo e pintava o rótulo do campo
  seguinte, visível na Jornada.
- Alinhamento alternado dos números de qualidade quando viram cartões no
  celular, e filtros de execução com 30px de altura.
- **A Visão geral sem execuções ficava com sobras do render anterior.** O ramo
  vazio limpava a lista de execuções e voltava, deixando para trás os sinais já
  desenhados, os valores dos eixos do radar, o índice de qualidade e as
  contagens de erros e avisos. Depois de limpar o histórico a tela dizia
  "nenhuma execução encontrada" ao lado de sete sinais e de um índice 80.

### Mudado

- **Os cinco eixos do radar da Visão geral agora dizem o próprio nome.** O
  polígono era desenhado sem rótulo nenhum — o markup até tinha os cinco spans,
  mas com `display:none` desde que foram escritos — enquanto quatro números
  soltos nos cantos do painel sugeriam ser os vértices ao lado. Os rótulos
  passaram para dentro do SVG, e os cantos ficaram só com o que o radar não
  mostra: a contagem de erros e de avisos. Performance e Acessibilidade
  apareciam duas vezes na mesma moldura, com o mesmo valor.
- Caixas de seleção nativas passaram a seguir o tema (`accent-color`) e
  cresceram de 13px para 18px.

## [3.2.0] - 2026-09-01

Esta versão acrescenta o **QA Toolbox** — uma área de ferramentas rápidas para
o dia a dia de QA, com 13 ferramentas — e fecha o ciclo de contas, aplicações e
persistência que vinha sendo construído desde a 3.1.0. Nada do que existia
antes foi removido: a Inspeção, a Jornada, os Testes de API, o histórico e os
relatórios seguem inalterados.

### Adicionado

- **QA Toolbox** (`/toolbox`): nova área com ferramentas rápidas para o dia a
  dia de QA — JSON Diff, JWT Inspector, API Health, Test Data Generator, cURL
  Converter e Boundary Value Generator — com busca por nome, descrição, tag e
  categoria. Cinco das seis rodam inteiramente no navegador e exibem o selo
  **Roda local**; nenhum JWT, header de autorização ou chave de API é
  persistido, registrado em log ou enviado ao servidor. O catálogo em
  `src/toolbox/catalog.ts` alimenta home, busca, categorias e rotas, de modo que
  uma ferramenta nova aparece sozinha nos quatro lugares — ver
  [`docs/qa-toolbox.md`](docs/qa-toolbox.md).
- **QA Toolbox 1.2: as três últimas promessas do catálogo.** **JSON Schema
  Validator** — cobre o núcleo do draft 2020-12 e o `nullable` do OpenAPI 3.0, e
  aponta caminho do campo, palavra-chave e trecho do schema em cada violação;
  palavra-chave que ele não avalia é listada em vez de passar em silêncio.
  **OpenAPI Diff** — aceita YAML ou JSON e classifica cada mudança pelo lado do
  contrato: exigir campo novo na requisição quebra quem chama, deixar de
  garantir campo na resposta quebra quem lê, e o mesmo vale, invertido, para
  valores de enum. **Webhook Inspector** — abre uma URL descartável e mostra
  corpo, cabeçalhos e query de cada chamada. Com o 1.2 o catálogo não tem mais
  nenhum card "em breve".
- **Leitor de YAML próprio** (`src/toolbox/yaml.ts`) para o subconjunto que
  contrato OpenAPI usa, porque contrato quase nunca vem em JSON e converter em
  outro site é justamente o hábito que o Toolbox existe para evitar. Âncoras,
  aliases, tags e múltiplos documentos falham com mensagem explícita.
- **`POST /api/v1/toolbox/webhooks`** abre uma caixa; qualquer método em
  `/api/v1/toolbox/webhooks/:id` é registrado como chegada. A caixa é uma URL
  pública, então os limites são parte da regra: 60 minutos de vida, 50 chamadas
  guardadas, corpo cortado em 64 KB (mas aceito com 200, porque provedor de
  webhook desativa assinatura que recebe erro), 200 caixas por processo,
  cabeçalho de credencial redigido **no momento de registrar** e origem reduzida
  ao prefixo da rede. Nada vai para banco: um reinício leva tudo junto, que é o
  correto para conteúdo que terceiros mandam.
- **QA Toolbox 1.1: quatro ferramentas novas.** **Pairwise Generator** (IPOG de
  força 2, determinístico, sem caso redundante), **Regex Tester** (posição,
  grupos nomeados e linhas atingidas), **Timestamp Converter** (diz em que
  unidade leu o número e avisa data ISO sem fuso) e **HTTP Status Explorer** (o
  que checar em cada código, busca por prefixo). Todas rodam no navegador.
- **Favoritas no catálogo do Toolbox.** A estrela em cada card sobe a ferramenta
  para uma faixa no topo. A preferência vive em `localStorage`: é uso, não dado
  de conta, e o servidor não precisa saber quais ferramentas alguém abre.
- **`POST /api/v1/toolbox/health-checks`**: verifica até 10 endpoints e devolve
  status, tempo, content-type e a classificação `HEALTHY`/`DEGRADED`/`FAILED` de
  cada um, mais o resumo do ambiente. Aceita apenas `GET` e `HEAD`, não repassa
  cabeçalho nenhum do cliente e usa a mesma proteção contra redes privadas
  (SSRF) da Inspeção. É a única ferramenta do Toolbox que sai para a rede, porque
  o CORS impede o navegador de medir endpoint de terceiro.
- **`GET /assets/toolbox/<módulo>.js`**: serve como módulo ES a mesma regra de
  negócio que os testes exercitam, a partir de uma lista explícita de módulos
  permitidos. Em produção entrega o compilado de `dist/`; em desenvolvimento
  remove os tipos na hora. Não há segunda cópia da regra escrita para o
  navegador.
- **Cadastro com e-mail e senha.** A conta deixou de ser "uma conta do GitHub":
  nasce de um cadastro em `/entrar`, com confirmação de e-mail e recuperação de
  senha. O GitHub passou a ser um dos caminhos de entrada, e quem entra por ele
  com um e-mail **verificado** cai na conta que já existe com esse endereço, em
  vez de ganhar uma segunda. Senhas usam `scrypt` da plataforma, com o custo
  gravado dentro do próprio hash. Sem `QA_RADAR_EMAIL_API_KEY` /
  `QA_RADAR_EMAIL_FROM` o cadastro continua funcionando e o que fica de fora é
  a confirmação e o "esqueci minha senha".
- **Aplicações por conta.** Nova entidade com nome, URL base e ambientes,
  gerenciada em `/aplicacoes` e por `GET/POST /api/v1/applications` e
  `GET/PATCH/DELETE /api/v1/applications/:id`. Uma análise pode ser vinculada a
  uma aplicação (`applicationId` em `POST /api/v1/scans`), e o nome só precisa
  ser único dentro da conta. Aplicação de outra conta responde `404`, não `403`.
- **`QA_RADAR_REQUIRE_ACCOUNT`.** Ligada, executar análise, jornada ou teste de
  API exige estar logado; navegar e ler continuam livres. **Desligada por
  padrão**, para a CLI e o dashboard local não passarem a exigir cadastro.
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

- **`QA_RADAR_REQUIRE_ACCOUNT=true` faz `POST /api/v1/scans`,
  `POST /api/v1/code-execution` e `POST /api/v1/http-request` responderem `401`
  sem sessão.** A chave vem desligada, então nada muda para quem não a ligar; o
  deploy público do QA Radar a liga.
- **A tabela `users` perdeu `provider` e `provider_account_id`**, que foram para
  `user_identities` (migration `0004`, com backfill). Só afeta quem lia o banco
  diretamente; a API não expunha esses campos.
- **`GET /api/v1/auth/me` mudou de significado em `loginAvailable`:** agora quer
  dizer "esta instalação guarda contas", e não mais "GitHub configurado". Para o
  provedor externo existe o campo novo `githubAvailable`.
- **O escopo do OAuth do GitHub passou a incluir `user:email`.** Uma autorização
  concedida antes disso precisa ser refeita — sem o e-mail verificado, entrar
  pelo GitHub cria uma conta nova em vez de cair na já cadastrada.
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

- **O Webhook Inspector expunha o IP completo de quem chamou.** O campo
  `origin` já saía reduzido ao prefixo da rede, mas o Cloudflare e o Render
  escrevem o endereço real em `x-forwarded-for`, `cf-connecting-ip` e
  `true-client-ip` — e numa caixa **pública** qualquer pessoa com a URL lia o
  endereço inteiro. Esses cabeçalhos passam pelo mesmo mascaramento.
- **Corpo grande de webhook congelava a aba.** 64 mil caracteres numa linha só,
  dentro de um `<pre>` com `white-space: pre`, travavam o renderizador por
  dezenas de segundos. A exibição agora quebra linha e é cortada em 8.000
  caracteres, com aviso; o "Copiar" continua levando o corpo guardado.
- **Boundary Value Generator marcava como válido um valor fora da faixa.** A
  validade vinha da posição de origem do ponto, não do valor: numa faixa `5..5`
  o "primeiro valor acima do mínimo" (6) saía como `VALID` e o caso "acima do
  máximo" sumia — a ferramenta ensinava o oposto do que a técnica existe para
  descobrir. Vale para inteiro, decimal, tamanho de texto e data.
- **Boundary Value Generator aceitava dia que não existe no mês.**
  `2026-02-30` não dá `NaN`: rolava para `2026-03-02` em silêncio e os casos
  saíam para uma faixa que ninguém pediu.
- **cURL Converter descartava os dados de `-G`.** O cURL move os `-d` para a
  query string; o conversor os jogava fora, e o teste gerado batia no mesmo
  caminho sem os parâmetros da busca.
- **JWT Inspector ignorava `exp`, `iat` e `nbf` enviados como texto.** Um token
  expirado aparecia como "não declara expiração". Agora o valor é interpretado e
  o desvio do RFC 7519 é mostrado na tela, junto com o aviso de `exp` que parece
  estar em milissegundos.
- **JWT Inspector recusava token colado com quebra de linha**, que é como ele
  sai de um terminal, de um log ou de um header quebrado por wrap. Também passou
  a recusar payload que decodifica mas não é um objeto JSON, em vez de chamá-lo
  de estrutura válida.
- **Test Data Generator não validava o nome do campo**, que vira identificador
  no `INSERT` gerado: `nome'); DROP TABLE users;--` saía como coluna crua num SQL
  feito para ser colado num banco. O nome da tabela já era protegido; agora o do
  campo também.
- **"Limpar" do JSON Diff e do Test Data escondia o painel sem apagar o
  conteúdo.** O payload comparado continuava no DOM, visível no inspetor e em
  qualquer captura de tela — numa área que promete não mandar nada para fora.
- **JSON Diff produzia caminho ambíguo** para chave com `.` ou `[]` no nome:
  `{"a.b":1}` e `{"a":{"b":1}}` davam o mesmo `$.a.b`, e uma regra de ignorar
  escrita para um calava o outro. Essas chaves agora saem como `$["a.b"]`.
- Contraste do nome da página na barra de contexto (4.28:1) e do rodapé
  (4.03:1) — os dois reprovavam no axe-core em **todas** as páginas do
  dashboard. Agora passam no critério AA da WCAG.
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
