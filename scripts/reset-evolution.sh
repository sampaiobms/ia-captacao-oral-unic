#!/usr/bin/env bash
# reset-evolution.sh
# Reseta a instância WhatsApp da Evolution API v1.8.2 no Railway
# e obtém o QR Code para nova conexão.
#
# PRÉ-REQUISITOS:
#   - curl instalado
#   - mysql-client instalado (para o reset do banco)
#   - Variáveis de ambiente definidas (via .env ou export manual)
#
# USO:
#   cp .env.example .env   # preencha os valores reais
#   source .env
#   chmod +x scripts/reset-evolution.sh
#   ./scripts/reset-evolution.sh

set -euo pipefail

# --- Configurações (lidas do ambiente) ---
EVOLUTION_URL="${EVOLUTION_API_URL:-https://evolution-api-production-cedd.up.railway.app}"
EVOLUTION_KEY="${EVOLUTION_API_KEY:-}"
MYSQL_HOST_VAR="${MYSQL_HOST:-shortline.proxy.rlwy.net}"
MYSQL_PORT_VAR="${MYSQL_PORT:-39145}"
MYSQL_USER_VAR="${MYSQL_USER:-root}"
MYSQL_PASS_VAR="${MYSQL_PASSWORD:-}"
MYSQL_DB_VAR="${MYSQL_DATABASE:-railway}"
INSTANCE_NAME="oral-unic"

if [[ -z "$EVOLUTION_KEY" || -z "$MYSQL_PASS_VAR" ]]; then
  echo "ERRO: EVOLUTION_API_KEY e MYSQL_PASSWORD devem estar definidos."
  echo "      Execute: source .env"
  exit 1
fi

echo ""
echo "======================================================"
echo "  Evolution API — Reset e Reconexão WhatsApp"
echo "======================================================"
echo ""

# PASSO 1: Limpar sessões antigas no MySQL
echo "[1/4] Limpando sessões antigas no MySQL..."
mysql \
  -h "$MYSQL_HOST_VAR" \
  -P "$MYSQL_PORT_VAR" \
  -u "$MYSQL_USER_VAR" \
  -p"$MYSQL_PASS_VAR" \
  "$MYSQL_DB_VAR" \
  --ssl-mode=REQUIRED \
  -e "DELETE FROM Session; DELETE FROM Instance; DELETE FROM Setting;" 2>/dev/null \
  && echo "    OK — tabelas limpas." \
  || echo "    AVISO: falha no MySQL. Continue mesmo assim se o serviço acabou de subir."

echo ""

# PASSO 2: Aguardar API inicializar (pode levar alguns segundos após deploy)
echo "[2/4] Verificando disponibilidade da Evolution API..."
MAX_TRIES=10
for i in $(seq 1 $MAX_TRIES); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: $EVOLUTION_KEY" \
    "$EVOLUTION_URL/instance/fetchInstances" || true)
  if [[ "$STATUS" == "200" || "$STATUS" == "404" ]]; then
    echo "    OK — API respondendo (HTTP $STATUS)."
    break
  fi
  echo "    Tentativa $i/$MAX_TRIES — HTTP $STATUS. Aguardando 5s..."
  sleep 5
done

echo ""

# PASSO 3: Criar instância
echo "[3/4] Criando instância '$INSTANCE_NAME'..."
CREATE_RESP=$(curl -s -X POST "$EVOLUTION_URL/instance/create" \
  -H "Content-Type: application/json" \
  -H "apikey: $EVOLUTION_KEY" \
  -d "{
    \"instanceName\": \"$INSTANCE_NAME\",
    \"qrcode\": true,
    \"integration\": \"WHATSAPP-BAILEYS\"
  }")

echo "    Resposta: $CREATE_RESP"
echo ""

# PASSO 4: Obter QR Code
echo "[4/4] Obtendo QR Code para escaneamento..."
QR_RESP=$(curl -s -X GET "$EVOLUTION_URL/instance/connect/$INSTANCE_NAME" \
  -H "apikey: $EVOLUTION_KEY")

# Extrair o base64 do QR Code se disponível
QR_BASE64=$(echo "$QR_RESP" | grep -o '"base64":"[^"]*"' | cut -d'"' -f4 || true)

if [[ -n "$QR_BASE64" ]]; then
  # Salvar imagem do QR Code localmente
  QR_FILE="/tmp/qr-oral-unic-$(date +%s).png"
  echo "$QR_BASE64" | base64 --decode > "$QR_FILE" 2>/dev/null \
    && echo "    QR Code salvo em: $QR_FILE" \
    && echo "    Abra o arquivo e escaneie com o WhatsApp da clínica." \
    || echo "    Resposta completa: $QR_RESP"
else
  echo "    Resposta completa: $QR_RESP"
  echo ""
  echo "    Se não houver QR Code na resposta, acesse diretamente:"
  echo "    GET $EVOLUTION_URL/instance/connect/$INSTANCE_NAME"
  echo "    Header: apikey: $EVOLUTION_KEY"
fi

echo ""
echo "======================================================"
echo "  Próximos passos:"
echo "  1. Escaneie o QR Code com o WhatsApp da Oral Unic"
echo "  2. Verifique status: GET $EVOLUTION_URL/instance/fetchInstances"
echo "  3. Configure o webhook no n8n para receber mensagens"
echo "======================================================"
echo ""
