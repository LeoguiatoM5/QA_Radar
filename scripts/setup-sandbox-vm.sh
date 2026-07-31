#!/usr/bin/env bash
#
# Provisiona o runner sandbox do QA Radar numa VM Linux com Docker e imprime, no
# final, os valores para colar no painel da hospedagem.
#
#   sudo ./scripts/setup-sandbox-vm.sh sandbox.seu-dominio.com
#
# É idempotente: pode rodar de novo depois de corrigir um passo que falhou. Não
# apaga dados nem mexe em firewall — restringir a porta 443 continua sendo uma
# decisão manual (ver README, "Publicar o runner em uma VM").
set -euo pipefail

DOMINIO="${1:-}"
IMAGEM_JOB="qa-radar-sandbox-job:3.1.0"
IMAGEM_BASE="mcr.microsoft.com/playwright:v1.61.1-noble"
COMPOSE="docker-compose.sandbox.yml"

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
etapa() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
morrer() {
  vermelho "FALHOU: $*"
  exit 1
}

[ -n "$DOMINIO" ] || morrer "informe o domínio. Uso: $0 sandbox.seu-dominio.com"
[ -f "$COMPOSE" ] || morrer "rode a partir da raiz do repositório (não encontrei $COMPOSE)."

# ---------------------------------------------------------------------------
etapa "1/9  Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "${SUDO_USER:-$USER}" || true
  verde "Docker instalado. Relogue depois deste script para usar docker sem sudo."
fi
docker info >/dev/null 2>&1 || morrer "o daemon do Docker não está respondendo."
verde "Docker $(docker version --format '{{.Server.Version}}') ok"

# ---------------------------------------------------------------------------
# Feito cedo de propósito: numa VM ARM (Oracle Ampere, AWS Graviton) a imagem do
# Playwright pode não trazer Chromium, e aí nada do resto adianta.
etapa "2/9  Chromium na arquitetura desta VM ($(uname -m))"
docker pull -q "$IMAGEM_BASE" >/dev/null || morrer "não consegui baixar $IMAGEM_BASE."
if docker run --rm "$IMAGEM_BASE" ls /ms-playwright 2>/dev/null | grep -q '^chromium'; then
  verde "Chromium presente na imagem para $(uname -m)"
else
  vermelho "A imagem $IMAGEM_BASE não traz Chromium para $(uname -m)."
  vermelho "Esta VM não serve para o runner. Use uma VM x86_64."
  exit 1
fi

# ---------------------------------------------------------------------------
# Os free tiers que rodam Docker (Oracle E2.1.Micro, GCP e2-micro) dão 1 GB de
# RAM, e o job carrega Chromium. Sem swap o container morre por OOM no meio da
# jornada, com um erro que não parece falta de memória.
etapa "3/9  Swap para caber o Chromium"
memoria_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
echo "    RAM detectada: ${memoria_mb} MB"
if [ "$memoria_mb" -lt 2048 ]; then
  if swapon --show 2>/dev/null | grep -q .; then
    verde "Swap já ativo"
  else
    fallocate -l 4G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
    verde "Swap de 4 GB criado e ativado"
  fi
  # Contraintuitivo: num host pequeno o job precisa de MAIS memória, não menos.
  # O container roda com --memory-swap igual a --memory, ou seja, sem swap: o
  # Chromium tem de caber em RAM real. Medido nesta classe de VM (1 OCPU/1 GB),
  # 384 MiB estoura o timeout de 30s só para iniciar o navegador, e 768 MiB sobe
  # em 15s. O swap acima serve para o resto do sistema sair da frente, não para
  # o job. Com 0,5 CPU a inicialização também não fecha, daí 1 CPU inteira.
  LIMITE_MEMORIA_JOB=768
  LIMITE_CPU_JOB=1.0
  echo "    Job com ${LIMITE_MEMORIA_JOB} MiB e ${LIMITE_CPU_JOB} CPU (mínimo medido para o Chromium subir)"
else
  LIMITE_MEMORIA_JOB=768
  LIMITE_CPU_JOB=1.0
fi

# ---------------------------------------------------------------------------
etapa "4/9  Portas 80 e 443 no firewall local"
# Imagens de nuvem (sobretudo Oracle) vêm com iptables restritivo pré-instalado:
# abrir só o security group do provedor não basta.
if command -v iptables >/dev/null 2>&1; then
  for porta in 80 443; do
    if ! iptables -C INPUT -m state --state NEW -p tcp --dport "$porta" -j ACCEPT 2>/dev/null; then
      # Posição 1, não o fim da cadeia: a imagem da Oracle termina o INPUT com um
      # REJECT geral, e uma regra ACCEPT inserida depois dele nunca é avaliada —
      # a porta continua fechada e o `iptables -C` seguinte diz que está aberta.
      iptables -I INPUT 1 -m state --state NEW -p tcp --dport "$porta" -j ACCEPT || true
    fi
  done
  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true
  verde "Regras locais para 80/443 aplicadas"
fi
echo "    Lembre: libere 80 e 443 também no security group do provedor."

# ---------------------------------------------------------------------------
etapa "5/9  DNS de $DOMINIO"
ip_publico="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || echo '')"
ip_dominio="$(getent hosts "$DOMINIO" | awk '{print $1}' | head -1 || echo '')"
[ -n "$ip_dominio" ] || morrer "$DOMINIO não resolve. Crie o registro A antes de continuar."
if [ -n "$ip_publico" ] && [ "$ip_publico" != "$ip_dominio" ]; then
  vermelho "$DOMINIO aponta para $ip_dominio, mas o IP público desta VM é $ip_publico."
  morrer "corrija o DNS — o certificado não sai apontando para outra máquina."
fi
verde "$DOMINIO -> $ip_dominio"

# ---------------------------------------------------------------------------
etapa "6/9  Dependências e imagem do job"
command -v node >/dev/null 2>&1 || morrer "Node 20+ não encontrado. Instale antes (nodesource)."
versao_node="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
[ "$versao_node" -ge 20 ] || morrer "Node $versao_node é antigo demais; precisa de 20+."
[ -d node_modules ] || npm ci
npm run sandbox:image
verde "Imagem $IMAGEM_JOB construída"

# ---------------------------------------------------------------------------
etapa "7/9  Homologação do isolamento"
# É o teste que prova que os limites e o egress se comportam nesta VM.
npm run sandbox:homologate || morrer "a homologação falhou. Não suba o runner assim."
verde "Isolamento, limites e egress homologados"

# ---------------------------------------------------------------------------
etapa "8/9  Segredo e subida do runner"
if [ -f .env.runner ] && grep -q '^QA_RADAR_SANDBOX_SIGNING_SECRET=.\{32,\}' .env.runner; then
  verde "Reaproveitando o segredo já existente em .env.runner"
else
  umask 077
  {
    printf 'QA_RADAR_SANDBOX_SIGNING_SECRET=%s\n' "$(openssl rand -base64 48)"
    echo 'QA_RADAR_SANDBOX_NETWORK_POLICY=public-egress'
    printf 'QA_RADAR_SANDBOX_MAX_MEMORY_MIB=%s\n' "$LIMITE_MEMORIA_JOB"
    printf 'QA_RADAR_SANDBOX_CPUS=%s\n' "$LIMITE_CPU_JOB"
  } >.env.runner
  verde "Segredo novo gerado em .env.runner (permissão 600)"
fi
# O teto de memória depende da RAM da VM, então é reaplicado mesmo quando o
# .env.runner é reaproveitado de uma execução anterior.
for par in "QA_RADAR_SANDBOX_MAX_MEMORY_MIB=${LIMITE_MEMORIA_JOB}" "QA_RADAR_SANDBOX_CPUS=${LIMITE_CPU_JOB}"; do
  chave="${par%%=*}"
  if grep -q "^${chave}=" .env.runner; then
    sed -i "s|^${chave}=.*|${par}|" .env.runner
  else
    echo "$par" >>.env.runner
  fi
done
segredo="$(grep '^QA_RADAR_SANDBOX_SIGNING_SECRET=' .env.runner | cut -d= -f2-)"

DOCKER_GID="$(getent group docker | cut -d: -f3)" \
  SANDBOX_RUNNER_DOMAIN="$DOMINIO" \
  docker compose -f "$COMPOSE" up -d --build

# ---------------------------------------------------------------------------
etapa "9/9  Certificado TLS"
# A emissão ACME leva alguns segundos; sem ela o QA Radar recusa a URL do sandbox.
for tentativa in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://$DOMINIO/health" >/dev/null 2>&1; then
    verde "HTTPS no ar: $(curl -fsS "https://$DOMINIO/health")"
    break
  fi
  [ "$tentativa" -eq 30 ] && {
    vermelho "o certificado não saiu em ~2min. Veja o log:"
    echo "  docker compose -f $COMPOSE logs caddy | tail -40"
    morrer "HTTPS indisponível em $DOMINIO"
  }
  sleep 4
done

cat <<FIM

$(verde '================  RUNNER NO AR  ================')

Cole no painel da hospedagem (Environment do serviço web):

  QA_RADAR_ENABLE_CODE_MODE        true
  QA_RADAR_SANDBOX_URL             https://$DOMINIO
  QA_RADAR_SANDBOX_SIGNING_SECRET  $segredo

E copie o QA_RADAR_CODE_MODE_ADMIN_TOKEN que a hospedagem já gerou — é ele que
a página /journeys vai pedir na primeira execução.

Falta ainda, e é manual: restringir a porta 443 aos IPs de saída da hospedagem.
Deixe a porta 80 aberta, senão a renovação do certificado falha em ~60 dias.
FIM
