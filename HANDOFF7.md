# HANDOFF7 — Estado Final do Projeto
## Resolução definitiva do @lid — Abril 2026

---

## 1. DIAGNÓSTICO ENCERRADO

| Versão | @lid resolvido | Banco | Status |
|--------|---------------|-------|--------|
| v1.x (até v1.8.7) | ❌ Não | MongoDB | @lid sem resolução |
| v2.x (latest) | ✅ Sim via `remoteJidAlt` | PostgreSQL | **SOLUÇÃO** |

A partir do v2.x, quando o lead usa `@lid`, o webhook inclui `remoteJidAlt` com o número real:

```json
{
  "key": {
    "remoteJid":    "28952559136882@lid",
    "remoteJidAlt": "5519989881838@s.whatsapp.net"
  }
}
```

---

## 2. INFRAESTRUTURA FINAL

| Serviço | URL | Versão | Banco |
|---------|-----|--------|-------|
| Evolution API | evolution-api-production-cedd.up.railway.app | **latest (v2.x)** | **Supabase PostgreSQL (btighfgcablumcjacssz)** |
| n8n | n8n-lead-production.up.railway.app | 2.17.3 | — |
| Flowise | flowise-production-5edd.up.railway.app | latest | — |
| Supabase | btighfgcablumcjacssz.supabase.co | FREE | leads + evo API |

### Variáveis de ambiente — Evolution API (v2.x final)
```
SERVER_PORT=8080
SERVER_URL=https://evolution-api-production-cedd.up.railway.app
AUTHENTICATION_TYPE=apikey
AUTHENTICATION_API_KEY=oralunic2026
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
QRCODE_LIMIT=30
DEL_INSTANCE=false
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres.btighfgcablumcjacssz:OralUnic2026db@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

### Credenciais da instância (após reconexão)
- Instance Name: `oral-unic`
- Global API Key: `oralunic2026`
- Instance API Key: **atualizar após reconectar** (diferente da v1.x)

---

## 3. FLUXO N8N — VERSÃO FINAL

```
Webhook WhatsApp
  ↓
Filtrar Mensagens (fromMe=false, event=messages.upsert)
  ↓
Normalizar Dados
  Extrai: remoteJid, remoteJidAlt, nome, mensagem, source, messageId
  ↓
Buscar Contato Real
  POST /chat/findContacts/oral-unic (fallback legacy — pode manter)
  ↓
Extrair Número Real
  jid = remoteJidAlt || remoteJid
  telefone = jid.replace('@s.whatsapp.net','').replace('@lid','')
  ↓
Upsert Lead (Supabase — telefone = numeroReal)
  ↓
Chamar Sofia (Flowise — chatflowId: 5814b9c2-c9a8-4273-a3e1-bacf91bb91ff)
  ↓
Parsear Resposta Sofia
  ↓
Salvar Conversa (Supabase)
  ↓
Enviar Mensagem WA (Evolution API latest)
  number = numeroReal ← agora sempre tem o número real
```

---

## 4. CÓDIGO FINAL DOS NÓS N8N

### "Normalizar Dados" (Code node)
```javascript
const keyData = $json.body?.data?.key || {};

return [{
  json: {
    remoteJid:    keyData.remoteJid    || '',
    remoteJidAlt: keyData.remoteJidAlt || '',
    nome:         $json.body?.data?.pushName || '',
    mensagem:     $json.body?.data?.message?.conversation || '',
    source:       $json.body?.data?.source || '',
    messageId:    keyData.id || ''
  }
}];
```

### "Extrair Número Real" (Code node)
```javascript
// v2.x resolve @lid via remoteJidAlt — lógica simplificada
const key = $('Normalizar Dados').item.json;

const jid = key.remoteJidAlt || key.remoteJid || '';
const telefone = jid.replace('@s.whatsapp.net', '').replace('@lid', '');

return [{
  json: {
    ...key,
    numeroReal: telefone,
    telefone:   telefone,
    fonteNumero: key.remoteJidAlt ? 'remoteJidAlt' : 'remoteJid'
  }
}];
```

### "Enviar Mensagem WA" (HTTP Request)
```
URL: POST https://evolution-api-production-cedd.up.railway.app/message/sendText/oral-unic
Header: apikey: <NOVA_INSTANCE_API_KEY>
Body:
{
  "number": "{{ $('Extrair Número Real').item.json.numeroReal }}",
  "textMessage": {
    "text": "{{ $('Parsear Resposta Sofia').item.json.mensagem }}"
  }
}
```

> **Nota:** Verificar se v2.x usa `textMessage.text` ou `text` diretamente. Testar após migração.

---

## 5. CHECKLIST PÓS-MIGRAÇÃO

- [ ] Container sobe sem erros nos logs do Railway
- [ ] `GET /instance/fetchInstances` retorna a instância `oral-unic`
- [ ] QR Code escaneado com WhatsApp do chip 2
- [ ] Instance API Key nova anotada e atualizada no n8n
- [ ] Webhook configurado na instância (apontar para n8n)
- [ ] Teste: enviar mensagem de Android → verificar `remoteJidAlt` no webhook
- [ ] Teste: `fonteNumero = "remoteJidAlt"` no output de "Extrair Número Real"
- [ ] Teste: Sofia responde e mensagem chega no WhatsApp do lead
- [ ] Teste com iPhone: verificar se `remoteJidAlt` também aparece

---

## 6. CONFIGURAR WEBHOOK NA NOVA INSTÂNCIA

Após reconectar, configurar o webhook para o n8n:

```bash
curl -X POST \
  "https://evolution-api-production-cedd.up.railway.app/webhook/set/oral-unic" \
  -H "Content-Type: application/json" \
  -H "apikey: oralunic2026" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://n8n-lead-production.up.railway.app/webhook/whatsapp-oral-unic",
      "webhookByEvents": false,
      "webhookBase64": false,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```

---

## 7. LIÇÕES APRENDIDAS — SESSÕES 1, 2 E 3

| Lição | Detalhe |
|-------|---------|
| Evolution API v1.x → @lid sem saída | Toda a v1.x usa @lid sem remoteJidAlt |
| Evolution API v2.x → remoteJidAlt | A partir do v2.x o @lid é resolvido no webhook |
| v2.x usa PostgreSQL, não MongoDB | DATABASE_PROVIDER=postgresql obrigatório |
| Supabase FREE → usar pooler 6543 | Porta 5432 bloqueada no plano FREE |
| Instance API Key muda a cada reconexão | Sempre atualizar no n8n após reconectar |
| remoteJidAlt fica em key.remoteJidAlt | Caminho: body.data.key.remoteJidAlt |
| Supabase UPSERT precisa de header Prefer | `resolution=merge-duplicates,return=representation` |
| n8n: sem [0] em .item.json | Usar `.item.json.campo` sem índice |
| Railway usa porta 8080 | SERVER_PORT=8080 e N8N_PORT=8080 obrigatório |

---

## 8. PRÓXIMOS PASSOS (pós @lid resolvido)

1. ✅ Resolver @lid — **este documento**
2. Testar fluxo completo com lead real (Android + iPhone)
3. Corrigir nó "Atualizar Lead" (pendente desde sessão 2)
4. Configurar follow-up D0-D14 com Cron no n8n
5. Deploy Metabase para dashboard KPIs
6. Testes com 10 leads simulados
7. Go-live

---

*HANDOFF7.md — FINAL — Oral Unic Chapadão do Sul — Abril 2026*
