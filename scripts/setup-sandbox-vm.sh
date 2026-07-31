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
etapa "1/8  Docker"
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
etapa "2/8  Chromium na arquitetura desta VM ($(uname -m))"
docker pull -q "$IMAGEM_BASE" >/dev/null || morrer "não consegui baixar $IMAGEM_BASE."
if docker run --rm "$IMAGEM_BASE" ls /ms-playwright 2>/dev/null | grep -q '^chromium'; then
  verde "Chromium presente na imagem para $(uname -m)"
else
  vermelho "A imagem $IMAGEM_BASE não traz Chromium para $(uname -m)."
  vermelho "Esta VM não serve para o runner. Use uma VM x86_64."
  exit 1
fi

# ---------------------------------------------------------------------------
etapa "3/8  Portas 80 e 443 no firewall local"
# Imagens de nuvem (sobretudo Oracle) vêm com iptables restritivo pré-instalado:
# abrir só o security group do provedor não basta.
if command -v iptables >/dev/null 2>&1; then
  for porta in 80 443; do
    if ! iptables -C INPUT -p tcp --dport "$porta" -j ACCEPT 2>/dev/null; then
      iptables -I INPUT -m state --state NEW -p tcp --dport "$porta" -j ACCEPT || true
    fi
  done
  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true
  verde "Regras locais para 80/443 aplicadas"
fi
echo "    Lembre: libere 80 e 443 também no security group do provedor."

# ---------------------------------------------------------------------------
etapa "4/8  DNS de $DOMINIO"
ip_publico="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || echo '')"
ip_dominio="$(getent hosts "$DOMINIO" | awk '{print $1}' | head -1 || echo '')"
[ -n "$ip_dominio" ] || morrer "$DOMINIO não resolve. Crie o registro A antes de continuar."
if [ -n "$ip_publico" ] && [ "$ip_publico" != "$ip_dominio" ]; then
  vermelho "$DOMINIO aponta para $ip_dominio, mas o IP público desta VM é $ip_publico."
  morrer "corrija o DNS — o certificado não sai apontando para outra máquina."
fi
verde "$DOMINIO -> $ip_dominio"

# ---------------------------------------------------------------------------
etapa "5/8  Dependências e imagem do job"
command -v node >/dev/null 2>&1 || morrer "Node 20+ não encontrado. Instale antes (nodesource)."
versao_node="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
[ "$versao_node" -ge 20 ] || morrer "Node $versao_node é antigo demais; precisa de 20+."
[ -d node_modules ] || npm ci
npm run sandbox:image
verde "Imagem $IMAGEM_JOB construída"

# ---------------------------------------------------------------------------
etapa "6/8  Homologação do isolamento"
# É o teste que prova que os limites e o egress se comportam nesta VM.
npm run sandbox:homologate || morrer "a homologação falhou. Não suba o runner assim."
verde "Isolamento, limites e egress homologados"

# ---------------------------------------------------------------------------
etapa "7/8  Segredo e subida do runner"
if [ -f .env.runner ] && grep -q '^QA_RADAR_SANDBOX_SIGNING_SECRET=.\{32,\}' .env.runner; then
  verde "Reaproveitando o segredo já existente em .env.runner"
else
  umask 077
  {
    printf 'QA_RADAR_SANDBOX_SIGNING_SECRET=%s\n' "$(openssl rand -base64 48)"
    echo 'QA_RADAR_SANDBOX_NETWORK_POLICY=public-egress'
  } >.env.runner
  verde "Segredo novo gerado em .env.runner (permissão 600)"
fi
segredo="$(grep '^QA_RADAR_SANDBOX_SIGNING_SECRET=' .env.runner | cut -d= -f2-)"

DOCKER_GID="$(getent group docker | cut -d: -f3)" \
  SANDBOX_RUNNER_DOMAIN="$DOMINIO" \
  docker compose -f "$COMPOSE" up -d --build

# ---------------------------------------------------------------------------
etapa "8/8  Certificado TLS"
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
