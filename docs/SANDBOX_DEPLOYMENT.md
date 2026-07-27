# Implantação do sandbox externo

O runner deve ficar em uma VM Linux dedicada, sem outros workloads. O processo público é o Caddy; o runner permanece na rede interna e acessa o Docker socket somente para criar jobs descartáveis.

## Subir uma VM nova

1. Instale Docker Engine e Docker Compose plugin.
2. Aponte o DNS do domínio para a VM e mantenha somente 80/443 abertos no firewall.
3. Gere a configuração:

```sh
cp .env.runner.example .env.runner
chmod 600 .env.runner
sed -i "s/^DOCKER_GID=.*/DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)/" .env.runner
```

Preencha `SANDBOX_RUNNER_DOMAIN` e troque `SANDBOX_SIGNING_SECRET` por um segredo aleatório com pelo menos 32 bytes. Nunca versionar `.env.runner`.

## Primeiro deploy e atualização

```sh
docker build -f Dockerfile.sandbox-job -t qa-radar-sandbox-job:3.1.0 .
docker compose --env-file .env.runner -f docker-compose.sandbox.yml build sandbox-runner
docker compose --env-file .env.runner -f docker-compose.sandbox.yml up -d
curl -fsS "https://${SANDBOX_RUNNER_DOMAIN}/health"
curl -fsS "https://${SANDBOX_RUNNER_DOMAIN}/ready"
```

`/ready` só responde pronto quando o daemon Docker está acessível e a imagem do job existe. A imagem do job deve ser imutável e atualizada com uma nova tag; o compose nunca deve apontar para `latest`.

## Rotação e rollback

Para rotacionar a chave, altere `.env.runner` e recrie apenas `sandbox-runner`; nonces antigos deixam de ser aceitos após o restart. Para rollback, volte a tag anterior da imagem do runner/job, execute `docker compose up -d --force-recreate` e confirme `/ready` antes de liberar tráfego. Não remova volumes do Caddy durante rollback sem uma cópia dos certificados.

## Evidências por passo

Jornadas declarativas geram `before` e `after` em PNG para cada passo e um `journey.webm` por execução. O relatório HTML exibe o vídeo com um fragmento temporal (`#t=início,fim`) para cada passo. Campos preenchidos a partir de secrets recebem máscara persistente no vídeo; o valor bruto nunca entra no JSON, HTML ou nome de arquivo. O arquivo de vídeo só é finalizado quando o contexto Playwright fecha, por isso o relatório é publicado depois do encerramento do navegador.

## Operação segura

- Não exponha a porta 4180 nem o Docker socket na internet.
- Monitore `/health`, `/ready`, falhas de criação de container, timeout e volume residual.
- Rode `npm run sandbox:homologate` em cada atualização de imagem e antes de homologação comercial.
- Beta, staging e pilotos permanecem gratuitos; billing e captura de pagamento continuam desabilitados até a checklist comercial estar completa.
