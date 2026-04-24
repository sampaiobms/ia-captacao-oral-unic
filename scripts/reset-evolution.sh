#!/usr/bin/env bash
# reset-evolution.sh
# Reseta a instância WhatsApp da Evolution API v1.8.2 no Railway
# e gera novo QR Code para reconexão.
#
# BANCO: MongoDB (interno Railway) — sem acesso externo necessário.
# A API apaga a instância via HTTP; o MongoDB é limpo automaticamente.
#
# PRÉ-REQUISITOS:
#   - curl instalado
#   - Variáveis de ambiente definidas (via .env ou export manual)
#
# USO:
#   cp .env.example .env   # preencha EVOLUTION_API_KEY
#   source .env
#   chmod +x scripts/reset-evolution.sh
#   ./scripts/reset-evolution.sh

set -euo pipefail

EVOLUTION_URL="${EVOLUTION_API_URL:-https://evolution-api-production-cedd.up.railway.app}"
EVOLUTION_KEY="${EVOLUTION_API_KEY:-}"
INSTANCE_NAME="oral-unic"

if [[ -z "$EVOLUTION_KEY" ]]; then
  echo "ERRO: EVOLUTION_API_KEY não definida. Execute: source .env"
  exit 1
fi

echo ""
echo "======================================================"
echo "  Evolution API v1.8.2 — Reset e Reconexão WhatsApp"
echo "======================================================"
echo ""

# PASSO 1: Verificar disponibilidade da API
echo "[1/4] Verificando disponibilidade da Evolution API..."
for i in $(seq 1 10); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: $EVOLUTION_KEY" \
    "$EVOLUTION_URL/instance/fetchInstances" || true)
  if [[ "$STATUS" == "200" || "$STATUS" == "404" ]]; then
    echo "    OK — API respondendo (HTTP $STATUS)."
    break
  fi
  echo "    Tentativa $i/10 — HTTP $STATUS. Aguardando 5s..."
  sleep 5
done
echo ""

# PASSO 2: Deletar instância existente (limpa MongoDB automaticamente)
echo "[2/4] Deletando instância '$INSTANCE_NAME' existente (se houver)..."
DEL_RESP=$(curl -s -X DELETE "$EVOLUTION_URL/instance/delete/$INSTANCE_NAME" \
  -H "apikey: $EVOLUTION_KEY" || true)
echo "    Resposta: $DEL_RESP"
echo "    Aguardando 3s para o MongoDB finalizar a limpeza..."
sleep 3
echo ""

# PASSO 3: Criar nova instância
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

# Extrair instance key da resposta
INSTANCE_KEY=$(echo "$CREATE_RESP" | grep -o '"apikey":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
if [[ -n "$INSTANCE_KEY" ]]; then
  echo ""
  echo "    *** ANOTE A INSTANCE KEY (usar no n8n para enviar mensagens): ***"
  echo "    $INSTANCE_KEY"
fi
echo ""

# PASSO 4: Obter QR Code
echo "[4/4] Obtendo QR Code para escaneamento..."
QR_RESP=$(curl -s -X GET "$EVOLUTION_URL/instance/connect/$INSTANCE_NAME" \
  -H "apikey: $EVOLUTION_KEY")

QR_BASE64=$(echo "$QR_RESP" | grep -o '"base64":"[^"]*"' | cut -d'"' -f4 || true)

if [[ -n "$QR_BASE64" ]]; then
  QR_FILE="/tmp/qr-oral-unic-$(date +%s).png"
  echo "$QR_BASE64" | base64 --decode > "$QR_FILE" 2>/dev/null \
    && echo "    QR Code salvo em: $QR_FILE" \
    && echo "    Abra o arquivo e escaneie com o WhatsApp do chip 2." \
    || echo "    Falha ao salvar imagem. Resposta completa: $QR_RESP"
else
  echo "    QR Code não retornado na resposta. Acesse diretamente:"
  echo "    GET $EVOLUTION_URL/instance/connect/$INSTANCE_NAME"
  echo "    Header: apikey: $EVOLUTION_KEY"
  echo "    Resposta recebida: $QR_RESP"
fi

echo ""
echo "======================================================"
echo "  Próximos passos:"
echo "  1. Escaneie o QR Code com o WhatsApp (chip 2)"
echo "  2. Verifique status:"
echo "     GET $EVOLUTION_URL/instance/fetchInstances"
echo "     Header: apikey: $EVOLUTION_KEY"
echo "  3. Atualize EVOLUTION_INSTANCE_KEY no .env e nas"
echo "     credentials do n8n com a nova instance key"
echo "  4. Reconfigure o webhook no n8n (se necessário)"
echo "======================================================"
echo ""
