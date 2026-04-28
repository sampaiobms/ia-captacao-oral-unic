# IA CAPTACAO ORAL UNIC — HANDOFF6.md
## Sessao 4 — Migracao Evolution API v2.x para resolver @lid

---

## 1. CONTEXTO E DECISAO

### Por que migrar para v2.x
A v1.x inteira (testamos ate v1.8.7) NAO resolve o @lid — o numero real do lead
nunca aparece no webhook. A v2.x adicionou o campo `remoteJidAlt` que contem
o numero real quando o lead usa @lid.

### Versoes testadas e descartadas
- v1.8.2 → MongoDB, @lid nao resolvido
- v1.8.6 → MongoDB, @lid nao resolvido
- v1.8.7 → MongoDB, @lid nao resolvido
- v2.2.3 → PostgreSQL, crash loop Baileys (wavoipToken)

### Versao alvo
`atendai/evolution-api:latest` — versao mais recente da linha v2.x
disponivel no Docker Hub. Tags disponiveis confirmadas:
v2.0.9, v2.1.1, v2.1.2, v2.2.0, v2.2.1, v2.2.2, v2.2.3, latest

### Campo que resolve o @lid (confirmado no GitHub issue #2132)
Na v2.x o webhook inclui `remoteJidAlt` com o numero real:
```json
{
  "key": {
    "remoteJid": "28952559136882@lid",
    "remoteJidAlt": "5519989881838@s.whatsapp.net"
  }
}
```

---

## 2. INFRAESTRUTURA ATUAL (NAO ALTERAR)

| Servico | URL | Manter? |
|---------|-----|---------|
| Flowise | flowise-production-5edd.up.railway.app | SIM |
| n8n | n8n-lead-production.up.railway.app | SIM |
| Evolution API | evolution-api-production-cedd.up.railway.app | ATUALIZAR versao |
| MongoDB Railway | mongodb.railway.internal:27017 | SUBSTITUIR por PostgreSQL |
| Supabase (leads) | btighfgcablumcjacssz.supabase.co | SIM |

---

## 3. PLANO DE MIGRACAO — PASSO A PASSO

### FASE 1 — Preparar banco PostgreSQL para Evolution API v2.x

A v2.x usa PostgreSQL. O Supabase ja existe mas esta no plano FREE
que bloqueia a porta 5432. O pooler (porta 6543) funciona mas tem
limitacoes com migrations do Prisma.

**OPCAO A — PostgreSQL nativo do Railway (RECOMENDADO)**
1. No Railway canvas → "+" → "Database" → "Add PostgreSQL"
2. Aguardar provisionar (1-2 min)
3. Clicar no servico PostgreSQL → Variables → copiar DATABASE_URL
   Formato: postgresql://postgres:SENHA@postgres.railway.internal:5432/railway
4. Esta URI funciona internamente sem restricao de porta

**OPCAO B — Supabase Pro ($25/mes)**
Upgrade do Supabase para Pro libera porta 5432 direta.

**Usar OPCAO A** — mais simples e sem custo adicional imediato.

### FASE 2 — Atualizar variaveis da Evolution API

Substituir TODAS as variaveis no Railway → evolution-api → Variables:

```
SERVER_PORT=8080
SERVER_URL=https://evolution-api-production-cedd.up.railway.app
AUTHENTICATION_TYPE=apikey
AUTHENTICATION_API_KEY=oralunic2026
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
QRCODE_LIMIT=30
DEL_INSTANCE=false
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres:SENHA@postgres.railway.internal:5432/railway
DATABASE_CONNECTION_CLIENT_NAME=evolution_api
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
```

NOTA: Substituir DATABASE_CONNECTION_URI pelo valor real copiado do
servico PostgreSQL do Railway.

### FASE 3 — Atualizar imagem Docker

Railway → evolution-api → Settings → Source Image:
```
atendai/evolution-api:latest
```

### FASE 4 — Aguardar deploy e verificar logs

Logs esperados apos deploy bem-sucedido:
```
HTTP - ON: 8080
Migration succeeded
```

Se aparecer crash loop → tentar versao especifica:
- `atendai/evolution-api:v2.2.2` (anterior ao v2.2.3 com bug)
- `atendai/evolution-api:v2.1.2`

### FASE 5 — Reconectar WhatsApp

```bash
python3 /tmp/qr.py
```

### FASE 6 — Verificar campo remoteJidAlt no webhook

Enviar mensagem de teste e verificar no n8n se o campo aparece:
```
body.data.key.remoteJidAlt
```

---

## 4. ATUALIZACAO DO NO "Normalizar Dados" NO N8N

Apos confirmar que remoteJidAlt aparece, atualizar o codigo:

```javascript
const data = $json.body?.data || {};
const key = data.key || {};

// Usar remoteJidAlt se disponivel (v2.x resolve @lid automaticamente)
// Fallback para remoteJid se nao tiver remoteJidAlt
const jidPrimario = key.remoteJidAlt || key.remoteJid || '';

// Extrair numero limpo
let telefone = '';
if (jidPrimario.includes('@s.whatsapp.net')) {
  telefone = jidPrimario.replace('@s.whatsapp.net', '');
} else if (jidPrimario.includes('@lid')) {
  // Fallback: manter @lid como identificador se nao resolvido
  telefone = jidPrimario;
}

const nome = data.pushName || 'Lead';
const mensagem = data.message?.conversation
  || data.message?.extendedTextMessage?.text
  || '';
const remoteJid = key.remoteJid || '';

return [{
  json: {
    telefone,
    nome,
    mensagem,
    remoteJid,
    remoteJidAlt: key.remoteJidAlt || '',
    source: data.source || ''
  }
}];
```

---

## 5. CREDENCIAIS IMPORTANTES (NAO ALTERAR)

```
FLOWISE URL:        https://flowise-production-5edd.up.railway.app
FLOWISE LOGIN:      admin / Bms230850jr
FLOWISE CHATFLOW:   5814b9c2-c9a8-4273-a3e1-bacf91bb91ff

N8N URL:            https://n8n-lead-production.up.railway.app
N8N ENCRYPTION:     1e392ed4c46a5211a8be31202387ef7d5e4ebc038e61805b5840e1750bf0bd9d

EVOLUTION URL:      https://evolution-api-production-cedd.up.railway.app
EVOLUTION GLOBAL:   oralunic2026
EVOLUTION INSTANCE: A433F7FD-5F57-4C9B-9FED-8910E0401744
INSTANCIA:          oral-unic

SUPABASE (leads):   btighfgcablumcjacssz.supabase.co
SUPABASE SENHA:     OralUnic2026db
```

---

## 6. SCRIPTS UTEIS

### Recriar instancia WhatsApp
```bash
python3 /tmp/qr.py
```

### Testar envio de mensagem
```bash
cat > /tmp/send.py << 'EOF'
import subprocess, json
url = "https://evolution-api-production-cedd.up.railway.app"
key = "A433F7FD-5F57-4C9B-9FED-8910E0401744"
payload = json.dumps({"number": "5511968404390",
  "textMessage": {"text": "Teste Oral Unic"}})
result = subprocess.run(["curl","-s","-X","POST",
  f"{url}/message/sendText/oral-unic",
  "-H","Content-Type: application/json",
  "-H",f"apikey: {key}","-d",payload],
  capture_output=True,text=True)
print(result.stdout)
EOF
python3 /tmp/send.py
```

### Verificar status da instancia
```bash
curl -s "https://evolution-api-production-cedd.up.railway.app/instance/fetchInstances" \
  -H "apikey: oralunic2026"
```

---

## 7. FLUXO N8N ATUAL (O QUE JA FUNCIONA)

```
Webhook WhatsApp → Filtrar Mensagens → Normalizar Dados →
Buscar Contato Real → Extrair Numero Real →
Upsert Lead (Supabase) → Chamar Sofia (Flowise) →
Parsear Resposta Sofia → Salvar Conversa (Supabase) →
Enviar Mensagem WA (Evolution API)
```

Todos os nos exceto "Enviar Mensagem WA" estao funcionando.
O ultimo no falha apenas porque o numero chega como @lid.
Apos migracao para v2.x com remoteJidAlt, deve funcionar completamente.

---

## 8. CONFIGURACAO DO NO "Enviar Mensagem WA" (ja correto)

```
Method: POST
URL: https://evolution-api-production-cedd.up.railway.app/message/sendText/oral-unic
Header apikey: A433F7FD-5F57-4C9B-9FED-8910E0401744
Header Content-Type: application/json

Body:
{
  "number": "{{ $('Extrair Numero Real').item.json.telefone }}",
  "textMessage": {
    "text": "{{ $('Parsear Resposta Sofia').item.json.mensagem }}"
  }
}
```

---

## 9. SE A MIGRACAO PARA V2.X FALHAR

### Plano B — Usar numero fixo de fallback no n8n
Se nao conseguir resolver o @lid via API, adicionar logica no no
"Extrair Numero Real" para usar o numero do proprio lead quando
ele responder informando o numero:

A Sofia pode perguntar o numero ao lead:
"Para continuar, pode me confirmar seu numero de WhatsApp?"

E salvar no Supabase para usar nos envios seguintes.

### Plano C — Aceitar limitacao para MVP
Para o MVP, Android sem privacidade ja funciona (remoteJid @s.whatsapp.net).
Usar o sistema assim e tratar @lid manualmente via painel ate ter solucao definitiva.

---

*HANDOFF6.md — Oral Unic Chapadao do Sul — Abril 2026*
