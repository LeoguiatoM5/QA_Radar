# QA Radar — Protocolo do runner sandbox

## Objetivo

Separar o control plane HTTP do ambiente que executa arquivos `.spec.ts`. Uma
execução hospedada nunca pode usar o worker local como fallback.

## Transporte

- Endpoint: `POST /v1/executions`.
- Transporte obrigatório: HTTPS.
- `Content-Type: application/json`.
- Sem redirects.
- Timeout do cliente: limite do job mais cinco segundos para encerramento.
- Não há retry automático: o mesmo teste não pode ser executado duas vezes por
  falha de transporte.

## Autenticação e replay

Cada requisição envia:

- `X-QA-Radar-Protocol: 1.0`;
- `X-QA-Radar-Request-Id`: UUID aleatório usado como nonce;
- `X-QA-Radar-Timestamp`: instante ISO 8601;
- `X-QA-Radar-Signature`: HMAC-SHA256 em hexadecimal.

O conteúdo assinado é:

```text
<timestamp>\n<request-id>\n<body-json-exato>
```

O runner deve validar a assinatura com comparação constante, aceitar no máximo
cinco minutos de diferença de relógio e consumir cada request ID uma única vez.
O utilitário `SandboxRequestVerifier` implementa assinatura, janela temporal e
proteção em memória contra replay. Em múltiplas réplicas, os nonces consumidos
devem ficar em armazenamento compartilhado com TTL.

## Requisição

```json
{
  "schemaVersion": "1.0",
  "executionId": "uuid",
  "code": "arquivo Playwright TypeScript",
  "headed": false,
  "limits": {
    "timeoutMs": 300000,
    "maxOutputBytes": 1048576,
    "maxMemoryMiB": 512
  }
}
```

O control plane nunca envia paths locais, credenciais administrativas ou o
ambiente do servidor.

## Resposta

```json
{
  "schemaVersion": "1.0",
  "executionId": "mesmo uuid da requisição",
  "exitCode": 0,
  "stdout": "relatório JSON do Playwright",
  "stderr": ""
}
```

O control plane rejeita versão ou ID divergente, JSON inválido e saída acima do
limite contratado.

## Requisitos do ambiente sandbox

O backend que implementar esse endpoint deve criar um ambiente descartável por
job e impor fora do processo Node:

- limite de CPU, memória total, PIDs e tempo;
- filesystem raiz somente leitura e diretório temporário exclusivo;
- usuário sem privilégios, sem capabilities e com `no-new-privileges`;
- bloqueio de acesso ao control plane, metadata cloud, loopback e redes privadas;
- egress permitido somente aos destinos autorizados para o teste;
- nenhum secret do control plane montado no job;
- destruição do ambiente e dos volumes ao finalizar;
- limite independente para logs e artefatos.

Configurar apenas uma URL que execute código no mesmo container não satisfaz
esse contrato. O Blueprint mantém o modo hospedado desabilitado até o backend
cumprir e homologar esses requisitos.

## Implementação de referência

O repositório inclui um runner Docker externo em `src/sandbox-runner.ts` e uma
imagem exclusiva para os jobs em `Dockerfile.sandbox-job`. O processo do runner
é confiável e controla o daemon; o código recebido existe apenas dentro de um
container novo, criado para uma única execução.

Construa a imagem:

```bash
npm run sandbox:image
```

Inicie o runner atrás de um terminador TLS, usando o mesmo secret configurado no
control plane:

```bash
QA_RADAR_SANDBOX_SIGNING_SECRET='secret-aleatorio-com-32-bytes-ou-mais' \
npm run sandbox:start
```

O listener usa `127.0.0.1:4180` por padrão. Não exponha HTTP puro fora do host.
O acesso ao daemon Docker equivale a acesso administrativo ao host; por isso, o
runner deve ocupar um nó dedicado e o socket Docker nunca deve ser montado no
control plane público.

Cada job usa:

- `--read-only`, sem bind mounts ou volumes de dados do host;
- `tmpfs` exclusivos em `/work` e `/tmp`;
- usuário e grupo `10001`, `cap-drop=ALL` e `no-new-privileges`;
- perfil seccomp padrão do Docker solicitado explicitamente;
- IPC privado e rede `none`;
- 0,5 CPU, 512 MiB e 256 PIDs por padrão;
- limite de tempo externo ao processo Node;
- `--rm` e uma remoção forçada adicional por nome ao terminar ou falhar.

As opções podem ser reduzidas por `QA_RADAR_SANDBOX_CPUS`,
`QA_RADAR_SANDBOX_MAX_MEMORY_MIB`, `QA_RADAR_SANDBOX_PIDS` e
`QA_RADAR_SANDBOX_MAX_EXECUTION_MS`. O pedido nunca pode elevar os tetos do
runner.

### Política de rede atual

O job não recebe rede direta em nenhuma política: ele sempre usa
`--network none`, que cria somente loopback. O modo padrão `none` também não
inicia componentes auxiliares e bloqueia toda a internet.

Para jornadas contra sites públicos, configure:

```bash
QA_RADAR_SANDBOX_NETWORK_POLICY=public-egress
```

Nesse modo, o runner cria um proxy sidecar por job. Somente esse sidecar recebe
uma bridge; o navegador comunica-se com ele por um relay em loopback e um socket
Unix guardado em volume Docker efêmero. O job monta esse volume como somente
leitura e continua sem rota, DNS ou interface externa.

O proxy:

- aceita HTTP e HTTPS `CONNECT` somente nas portas 80 e 443;
- rejeita localhost, sufixos locais, credenciais em URL e IPs especiais;
- bloqueia metadata, loopback, link-local, CGNAT, redes privadas, documentação,
  benchmark, multicast e reservadas em IPv4 e IPv6;
- resolve no sidecar, rejeita qualquer resposta que contenha IP bloqueado e
  conecta diretamente ao IP público validado;
- fixa o conjunto de IPs por hostname durante o job, bloqueando DNS rebinding;
- revalida cada recurso e redirect solicitado pelo navegador;
- limita conexões, requisições e bytes transferidos.

Uma bridge comum continua proibida para o job. O sidecar é parte confiável da
fronteira e não recebe código do usuário, secrets, socket Docker ou mounts do
host. Sidecar, socket e volume são destruídos com a execução.

Os tetos padrão de egress são 32 conexões e 64 MiB, configuráveis por
`QA_RADAR_SANDBOX_EGRESS_MAX_CONNECTIONS` e
`QA_RADAR_SANDBOX_EGRESS_MAX_BYTES`.

## Homologação

Com a imagem construída, execute:

```bash
npm run sandbox:homologate
```

O probe executa o protocolo HMAC completo, abre uma página HTTPS pública pelo
sidecar, tenta acessar metadata, host e rede privada, interrompe um loop infinito
por timeout e inspeciona cgroup/proc. Ele exige:

- somente a interface `lo` dentro do job;
- HTTPS público funcional exclusivamente pelo proxy;
- resposta bloqueada ou falha para metadata, host e redes privadas;
- rootfs sem escrita e `tmpfs` temporário gravável;
- UID/GID `10001`;
- CPU, memória e PIDs limitados por cgroup;
- capabilities efetivas zeradas e `NoNewPrivs=1`;
- ausência do job, sidecar e volume depois do sucesso e do timeout.
