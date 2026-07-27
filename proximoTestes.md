1. Sandbox externo — concluído e homologado

- [x] Container descartável por execução.
- [x] Limites reais de CPU, memória, PIDs e tempo.
- [x] Filesystem isolado e somente leitura.
- [x] Egress público controlado, bloqueando metadata, localhost e redes privadas.
- [x] Destruição total de job, sidecar e volume após o teste.
- [x] Homologação contra escapes e abuso.

• Concluído: egress público controlado sem rede direta no job.

- Job continua em --network none.
- Proxy sidecar libera HTTP/HTTPS público.
- Metadata, localhost, redes privadas, IPs reservados, portas não autorizadas e DNS rebinding são bloqueados.
- Job, sidecar e volume Unix são destruídos após execução.
  Validações:

- npm run check: 107 testes aprovados.
- Integração: 18 aprovados.
- Homologação Docker: HTTP/HTTPS público aprovado; metadata, host, rede privada e porta 444 bloqueados.
- Nenhum container ou volume residual.

Ativação no runner:

QA_RADAR_SANDBOX_NETWORK_POLICY=public-egress

O desenho segue o isolamento none do Docker (https://docs.docker.com/engine/network/drivers/none/) e a configuração global
de proxy do Playwright (https://playwright.dev/docs/network). O próximo passo operacional é implantar esse runner dedicado
atrás de HTTPS.

2. Codegen hospedado

- Navegador remoto interativo para gravação.
- Sessão autenticada por usuário.
- Streaming seguro da janela do navegador.
- Preenchimento automático do editor ao finalizar.
- Timeout e encerramento de sessões abandonadas.

3. Evidências completas

- Screenshots, traces e vídeos.
- Download protegido por URL assinada.
- Relatório HTML consolidado.
- Remoção de secrets dos artefatos.
- Storage S3 compatível com retenção configurável.

4. Persistência e fila

- PostgreSQL e migrations.
- Fila persistente para execuções.
- Retry apenas para falhas transitórias.
- Heartbeat e detecção de worker perdido.
- Garantia contra execução duplicada.

5. Contas e isolamento comercial

- Login e recuperação de senha.
- Organizações, equipes e projetos.
- Papéis e permissões.
- Isolamento por tenant.
- Auditoria, revogação e rotação de tokens.

6. Experiência comercial

- Onboarding guiado.
- Dashboard por projeto e ambiente.
- Histórico e comparação com baseline.
- Regressões destacadas.
- Testes agendados e alertas.
- Integrações GitHub, GitLab, Slack e webhooks.

7. Planos e cobrança

- Regra atual: Beta, homologação e pilotos não serão cobrados; billing só começa após o produto estar completo e aprovado para lançamento.
- Quotas por execução, duração e armazenamento.
- Medição de consumo.
- Stripe, faturas e bloqueio seguro por limite.

8. Operação e lançamento

- Logs, métricas e alertas.
- Backup e restauração.
- Política de privacidade e termos.
- Pentest e resposta a incidentes.
- Piloto com três clientes antes do lançamento público.
