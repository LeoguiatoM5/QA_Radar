# QA Radar — Checklist de evolução comercial

Este documento transforma a análise técnica e de produto em um plano executável.
Os itens devem ser marcados somente depois que o critério de aceite estiver
validado por teste automatizado, homologação ou evidência documentada.

## Objetivo do produto

Posicionar o QA Radar como um radar de qualidade de releases para equipes web:
detectar regressões, validar fluxos críticos e gerar evidências acionáveis antes
do deploy.

## Definição de pronto para comercialização

- [ ] Um usuário consegue criar conta, organização, projeto e ambiente.
- [ ] Uma análise pode ser executada manualmente, por agenda e por CI/CD.
- [ ] Resultados, baselines e artefatos persistem após reinícios.
- [ ] Regressões novas são diferenciadas de problemas já conhecidos.
- [ ] A equipe recebe alertas e consegue compartilhar evidências protegidas.
- [ ] Cada cliente possui dados, permissões e limites de uso isolados.
- [ ] Execuções não possuem acesso indevido ao servidor, secrets ou outros tenants.
- [ ] Existem termos de uso, política de privacidade e processo de exclusão de dados.
- [ ] Custos por execução, disponibilidade e falhas são monitorados.
- [ ] Ao menos três clientes-piloto confirmaram disposição real de pagar.

---

## Fase 0 — Estabilizar a Beta

### P0 — Qualidade e experiência

- [x] Corrigir a duplicação de conteúdo e os dois `<h1>` em `/docs`.
- [x] Atualizar os testes de integração que ainda esperam a Jornada JSON antiga.
- [x] Deixar `npm run test:integration` totalmente verde.
- [x] Incluir testes de integração no gate obrigatório antes de merge/release.
- [x] Alinhar a comunicação da Home, Documentação e página de Jornadas.
- [x] Decidir oficialmente manter somente o Modo Jornada de Playwright na interface.
- [x] Exibir claramente quais recursos são locais e quais estão disponíveis no servidor público.
- [x] Remover código de frontend sem interface ativa.
- [ ] Criar teste end-to-end do fluxo atual do Modo Jornada de Playwright.
- [x] Criar teste de regressão para importação e exportação de `.spec.ts`.
- [ ] Validar downloads no Chromium, Firefox e WebKit.

### P0 — Segurança do Modo Jornada de Playwright

- [x] Criar uma flag exclusiva `QA_RADAR_ENABLE_CODE_MODE`.
- [x] Manter o Modo Jornada habilitado no runtime seguro e bloqueado no host público até existir sandbox.
- [x] Exigir acesso local ou autenticação administrativa explícita.
- [x] Impedir que `QA_RADAR_ALLOW_PRIVATE_TARGETS` libere execução remota de código.
- [x] Não repassar todo o `process.env` para o teste executado.
- [x] Usar uma allowlist mínima de variáveis de ambiente.
- [x] Limitar CPU, memória, processos filhos e duração da execução.
- [x] Manter o job sem rede direta e liberar somente egress público validado por proxy.
- [x] Limitar o tamanho acumulado de `stdout` e `stderr`.
- [x] Encerrar Codegen e processos filhos abandonados após timeout.
- [x] Remover diretórios `code-*` e `codegen-*` ao fim da retenção.
- [x] Aplicar rate limit e quota aos endpoints de Codegen e execução.
- [x] Proteger relatórios e artefatos de código com token.
- [x] Criar testes contra leitura de arquivos, acesso a secrets e abuso de processos.
- [x] Documentar que código Playwright enviado pelo usuário é código confiável somente no modo local.

### P0 — Consistência técnica

- [x] Corrigir o limite divergente entre corpo HTTP de 64 KB e arquivo `.spec.ts` de 256 KB.
- [ ] Definir uma única fonte para as flags e valores padrão do servidor.
- [ ] Corrigir divergências entre README, `render.yaml`, testes e comportamento de runtime.
- [ ] Criar validação centralizada das variáveis de ambiente.
- [ ] Adicionar lint e formatação automática.
- [ ] Adicionar cobertura de testes e meta mínima para módulos críticos.
- [ ] Criar testes específicos para todos os endpoints do Modo Jornada de Playwright.
- [ ] Criar uma política de compatibilidade para schema, CLI e API.

---

## Fase 1 — Fundação da plataforma

### P0 — Arquitetura

- [ ] Dividir `server.ts` em módulos de rotas, aplicação, domínio e infraestrutura.
- [x] Separar o processo HTTP do processo que executa navegadores.
- [ ] Criar uma máquina de estados explícita para jobs.
- [ ] Tornar criação e cancelamento de jobs idempotentes.
- [ ] Versionar a API como `/api/v1`.
- [ ] Publicar contrato OpenAPI.
- [ ] Criar tratamento padronizado de erros e códigos HTTP.
- [ ] Criar health check de prontidão além do health check de processo.

### P0 — Persistência

- [ ] Adicionar PostgreSQL.
- [ ] Criar migrations reproduzíveis.
- [ ] Persistir organizações, usuários, projetos e ambientes.
- [ ] Persistir checks, execuções, issues e baselines.
- [ ] Persistir agenda, configuração e estado dos jobs.
- [ ] Armazenar screenshots, traces e relatórios em storage compatível com S3.
- [ ] Usar URLs assinadas e temporárias para artefatos.
- [ ] Implementar retenção configurável por plano.
- [ ] Implementar exclusão definitiva de projeto e organização.
- [ ] Criar backup e testar restauração.

### P0 — Fila e workers

- [ ] Substituir a fila em memória por uma fila persistente.
- [ ] Implementar retry apenas para falhas transitórias.
- [ ] Implementar heartbeat e detecção de worker perdido.
- [ ] Garantir que jobs não sejam executados duas vezes.
- [ ] Registrar custo, duração, memória e resultado por execução.
- [ ] Criar limite de concorrência por organização e plano.
- [ ] Criar dead-letter queue ou estado equivalente para falhas irrecuperáveis.

### P0 — Autenticação e isolamento

- [ ] Implementar autenticação.
- [ ] Implementar organizações e isolamento por tenant.
- [ ] Implementar papéis: proprietário, administrador, membro e somente leitura.
- [ ] Verificar autorização em todas as rotas e artefatos.
- [ ] Criar convites de equipe com expiração.
- [ ] Implementar rotação e revogação de tokens.
- [ ] Criar trilha de auditoria para ações administrativas.
- [ ] Adicionar proteção contra CSRF e validação de origem quando aplicável.

---

## Fase 2 — MVP comercial

### P0 — Experiência principal

- [ ] Criar onboarding: conta → projeto → ambiente → primeira análise.
- [ ] Permitir cadastrar URL e configurações padrão por ambiente.
- [ ] Criar dashboard do projeto com estado da última execução.
- [ ] Exibir tendência de erros, avisos, duração e performance.
- [ ] Destacar somente regressões por padrão.
- [ ] Criar estados para issues: nova, reconhecida, ignorada e resolvida.
- [ ] Permitir comentário, responsável e justificativa de supressão.
- [ ] Comparar evidências entre baseline e execução atual.
- [ ] Criar score de prontidão da release com regras transparentes.

### P0 — Automação

- [ ] Criar testes agendados.
- [ ] Permitir configurar timezone e frequência.
- [ ] Criar alertas por e-mail.
- [ ] Criar webhooks assinados.
- [ ] Criar integração com Slack.
- [ ] Associar execução a commit, branch, pull request e deploy.
- [ ] Publicar resultado como GitHub Check.
- [ ] Comentar regressões novas no pull request sem gerar spam.
- [ ] Homologar oficialmente GitHub Actions e GitLab CI/CD.

### P0 — Runner privado

- [x] Definir protocolo seguro entre control plane e runner.
- [ ] Criar token de instalação revogável e com escopo.
- [ ] Permitir execução em redes privadas sem abrir portas de entrada.
- [ ] Enviar ao SaaS somente resultados e artefatos autorizados.
- [ ] Implementar atualização e compatibilidade de versões do runner.
- [ ] Publicar Docker Compose ou Helm chart de instalação.
- [ ] Criar diagnóstico de conectividade e saúde do runner.

### P1 — Políticas de qualidade

- [ ] Permitir configurar severidade por regra.
- [ ] Permitir budgets de performance por projeto.
- [ ] Permitir ignorar URL, status, regra e recurso com justificativa.
- [ ] Definir expiração para supressões.
- [ ] Criar perfis desktop, tablet e mobile.
- [ ] Comparar Chromium, Firefox e WebKit.
- [ ] Implementar retries controlados para identificar flakiness.
- [ ] Mostrar confiança e recorrência do achado.

### P1 — Evidências

- [ ] Capturar screenshots automáticos por ação.
- [ ] Gerar trace Playwright em falhas ou primeiro retry.
- [ ] Disponibilizar logs de console e rede de forma pesquisável.
- [ ] Remover secrets, tokens e dados sensíveis dos artefatos.
- [ ] Permitir download de pacote de evidências.
- [ ] Criar links compartilháveis com expiração e revogação.
- [ ] Registrar quem visualizou ou compartilhou evidências sensíveis.

---

## Fase 3 — Operação comercial

### P0 — Planos, quotas e cobrança

- [x] Manter cobrança desabilitada até a conclusão dos critérios de pronto para comercialização.
- [ ] Validar com clientes se a métrica será execução, minuto ou crédito.
- [ ] Evitar cobrança por assento como barreira à colaboração.
- [ ] Criar plano gratuito local.
- [ ] Criar plano Starter.
- [ ] Criar plano Team.
- [ ] Criar plano Agency.
- [ ] Definir oferta Enterprise/self-hosted.
- [ ] Implementar limites e aviso de consumo.
- [ ] Implementar bloqueio seguro ao atingir a quota.
- [ ] Integrar provedor de cobrança e emissão fiscal aplicável.
- [ ] Criar painel de consumo e faturas.

### P0 — Legal e privacidade

- [ ] Definir estratégia de licença: open-core, source-available ou proprietária.
- [ ] Corrigir a incompatibilidade entre a licença de avaliação e uso empresarial da Action/CLI.
- [ ] Confirmar titularidade da marca e propriedade intelectual.
- [ ] Publicar Termos de Uso.
- [ ] Publicar Política de Privacidade.
- [ ] Criar contrato/DPA para tratamento de dados.
- [ ] Documentar subprocessadores.
- [ ] Definir política de retenção e localização dos dados.
- [ ] Implementar exportação e exclusão conforme LGPD.
- [ ] Criar canal de reporte responsável de vulnerabilidades.
- [ ] Gerar SBOM e revisar licenças das dependências.

### P0 — Operação e confiabilidade

- [ ] Definir SLO de disponibilidade e sucesso das execuções.
- [ ] Adicionar métricas, dashboards e alertas operacionais.
- [ ] Implementar tracing distribuído entre API, fila e worker.
- [ ] Criar runbooks de incidentes.
- [ ] Testar recuperação de desastre.
- [ ] Monitorar custo por navegador, página e jornada.
- [ ] Detectar filas congestionadas e execuções presas.
- [ ] Implementar deploy gradual e rollback.
- [ ] Criar página pública de status.
- [ ] Definir SLA e canais de suporte por plano.

---

## Fase 4 — Diferenciação

### P1 — Produto

- [ ] Implementar regressão visual com baseline e diff.
- [ ] Criar visão executiva por release.
- [ ] Criar visão multi-cliente para agências.
- [ ] Criar templates de checks por tipo de aplicação.
- [ ] Criar biblioteca reutilizável de passos e autenticação.
- [ ] Adicionar Jira e Linear.
- [ ] Criar API pública com chaves de escopo limitado.
- [ ] Permitir importação de suítes Playwright existentes.

### P2 — IA

- [ ] Usar IA apenas sobre achados determinísticos existentes.
- [ ] Redigir secrets e dados pessoais antes de enviar contexto.
- [ ] Vincular cada conclusão da IA às evidências de origem.
- [ ] Criar avaliação fixa de utilidade e alucinação.
- [ ] Implementar limite de custo, cache, timeout e fallback.
- [ ] Permitir desativação completa por organização.

### P2 — Segurança dinâmica

- [ ] Definir responsabilidade e escopo legal do scan de segurança.
- [ ] Iniciar somente com OWASP ZAP passivo/baseline.
- [ ] Exigir autorização explícita sobre o domínio.
- [ ] Executar ZAP em ambiente isolado.
- [ ] Bloquear ataques ativos em produção por padrão.
- [ ] Normalizar resultados com CWE/OWASP e evidência.
- [ ] Validar em aplicação vulnerável controlada.

---

## Validação de mercado

- [ ] Entrevistar pelo menos 10 profissionais de QA e líderes técnicos.
- [ ] Entrevistar pelo menos 5 agências ou consultorias.
- [ ] Identificar o fluxo pelo qual clientes já pagam ou gastam horas.
- [ ] Medir tempo atual de diagnóstico e geração de evidências.
- [ ] Testar a mensagem “radar de qualidade de releases”.
- [ ] Validar se diagnóstico em português influencia a compra.
- [ ] Validar preço antes de implementar billing completo.
- [ ] Conseguir entre 5 e 10 design partners.
- [ ] Converter ao menos 3 pilotos em clientes pagos.
- [ ] Registrar motivos de ativação, abandono e cancelamento.

## Métricas do produto

- [ ] Tempo até a primeira análise concluída.
- [ ] Percentual de usuários que concluem o onboarding.
- [ ] Projetos ativos semanalmente.
- [ ] Execuções manuais, agendadas e via CI/CD.
- [ ] Regressões encontradas antes do deploy.
- [ ] Percentual de achados ignorados como falso positivo.
- [ ] Tempo médio entre falha e reconhecimento.
- [ ] Retenção de clientes em 30, 60 e 90 dias.
- [ ] Custo médio por execução.
- [ ] Receita recorrente mensal e margem por plano.

## Itens que não devem ser antecipados

- [ ] Não hospedar execução arbitrária de `.spec.ts` sem sandbox real.
- [ ] Não priorizar IA antes de histórico, alertas e regressões confiáveis.
- [ ] Não adicionar OWASP ZAP ativo antes de isolamento e autorização de domínio.
- [ ] Não criar vários microsserviços antes de separar apenas control plane e worker.
- [ ] Não prometer certificação WCAG baseada somente no axe-core.
- [ ] Não divulgar amplamente o servidor público sem autenticação e controle de abuso.

## Próxima entrega recomendada

- [ ] Fechar todas as pendências da Fase 0.
- [ ] Publicar uma versão Beta estável com experiência e documentação consistentes.
- [ ] Selecionar cinco design partners.
- [ ] Implementar autenticação, PostgreSQL, storage e agendamento como primeiro recorte comercial.
