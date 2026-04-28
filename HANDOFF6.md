# HANDOFF6 — Migração para Evolution API v2.3.6 + Solução @lid
## Sessão 3 — solução definitiva — Abril 2026

---

## 1. A SOLUÇÃO

A Evolution API **v2.3.6** adiciona o campo `remoteJidAlt` no webhook quando o contato usa `@lid`. Esse campo contém o número real no formato `@s.whatsapp.net`:

```json
{
  "remoteJid":    "28952559136882@lid",
  "remoteJidAlt": "5519989881838@s.whatsapp.net"  ← número real do lead
}
```

Com isso, o nó "Extrair Número Real" passa a ter uma terceira fonte confiável e a solução fica completa para iPhone e Android.

---

## 2. ATENÇÃO ANTES DE MIGRAR

### v2.3.6 NÃO estava nas tags do Docker Hub listadas anteriormente
As tags listadas iam até `v2.2.3`. Verificar disponibilidade antes de migrar:

```bash
curl -s "https://hub.docker.com/v2/repositories/atendai/evolution-api/tags/?page_size=50" \
  | python3 -c "import sys,json; [print(t['name']) for t in json.load(sys.stdin)['results']]"
```

Confirmar que `v2.3.6` aparece na lista antes de prosseguir.

### Risco do crash loop do Baileys (histórico)
- v2.1.x e v2.2.x tiveram crash loop do Baileys (rejeitado pelo WhatsApp)
- v2.3.6 pode ter corrigido — **testar em ambiente de homologação antes da produção**
- Se der crash loop: reverter para v1.8.2 (manter o MongoDB ativo como backup)

---

## 3. MUDANÇAS DE INFRAESTRUTURA — v1.8.2 → v2.3.6

| Item | v1.8.2 (atual) | v2.3.6 (alvo) |
|------|----------------|---------------|
| Banco de dados | MongoDB | PostgreSQL |
| Formato envio | `textMessage: {text: "..."}` | `text: "..."` (verificar) |
| remoteJidAlt | ❌ não existe | ✅ presente quando @lid |
| Baileys | estável | testar |

### PostgreSQL para a Evolution API
Usar o projeto Supabase já existente para Evolution API:

```
Project ID: ciwtrrsqqhryuujjihxp
URL: https://ciwtrrsqqhryuujjihxp.supabase.co
Senha: OralUnic2026db
```

**Connection URI (pooler — plano FREE):**
```
postgresql://postgres.ciwtrrsqqhryuujjihxp:OralUnic2026db@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

**Connection URI (direta — se Supabase Pro):**
```
postgresql://postgres:OralUnic2026db@db.ciwtrrsqqhryuujjihxp.supabase.co:5432/postgres
```

---

## 4. PASSO A PASSO DA MIGRAÇÃO NO RAILWAY

### Passo 1 — Backup (opcional mas recomendado)
Anotar: instância `oral-unic`, apikey `A433F7FD-5F57-4C9B-9FED-8910E0401744`.
O WhatsApp precisará ser reconectado via QR Code após a migração.

### Passo 2 — Trocar a imagem
```
Railway → evolution-api → Settings → Source Image
De: atendai/evolution-api:v1.8.2
Para: atendai/evolution-api:v2.3.6
```

### Passo 3 — Atualizar variáveis de ambiente
Remover as variáveis do MongoDB e adicionar as do PostgreSQL:

**REMOVER:**
```
DATABASE_PROVIDER=mongodb
DATABASE_CONNECTION_URI=mongodb://...
DATABASE_CONNECTION_CLIENT_NAME=evolution_api
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
```

**ADICIONAR / ATUALIZAR:**
```
SERVER_PORT=8080
SERVER_URL=https://evolution-api-production-cedd.up.railway.app
AUTHENTICATION_TYPE=apikey
AUTHENTICATION_API_KEY=oralunic2026
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
QRCODE_LIMIT=30
DEL_INSTANCE=false

DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres.ciwtrrsqqhryuujjihxp:OralUnic2026db@aws-0-us-east-1.pooler.supabase.com:6543/postgres

CACHE_REDIS_ENABLED=false
```

> **Nota:** Remover as variáveis de Redis/Cache se não forem necessárias no v2.x. Testar sem Redis primeiro.

### Passo 4 — Deploy e reconexão
1. Salvar variáveis → Railway faz o deploy automaticamente
2. Aguardar serviço inicializar (verificar logs para erros de DB)
3. Criar nova instância:

```bash
curl -X POST \
  "https://evolution-api-production-cedd.up.railway.app/instance/create" \
  -H "Content-Type: application/json" \
  -H "apikey: oralunic2026" \
  -d '{"instanceName": "oral-unic", "qrcode": true}'
```

4. Conectar WhatsApp:

```bash
curl "https://evolution-api-production-cedd.up.railway.app/instance/connect/oral-unic" \
  -H "apikey: oralunic2026"
# Retorna QR Code base64 — escanear com WhatsApp do chip 2
```

5. Atualizar a Instance API Key no n8n (será diferente da anterior)

---

## 5. ATUALIZAÇÃO DO N8N — APÓS MIGRAÇÃO

### Passo 1 — Atualizar "Normalizar Dados"
Adicionar extração do campo `remoteJidAlt` ao JSON de saída do nó:

```javascript
// Adicionar ao return do Normalizar Dados:
return [{
  json: {
    remoteJid:    $json.body.data.key.remoteJid,
    remoteJidAlt: $json.body.data.key.remoteJidAlt || '',  // ← NOVO campo v2.3.6
    nome:         $json.body.data.pushName,
    mensagem:     $json.body.data.message?.conversation || '',
    source:       $json.body.data.source,
    messageId:    $json.body.data.key.id,
    // ... outros campos existentes
  }
}];
```

### Passo 2 — Substituir código do "Extrair Número Real"

```javascript
// === FONTE 0: remoteJidAlt (Evolution API v2.3.6 — SOLUÇÃO @lid) ===
// Quando remoteJid é @lid, v2.3.6 preenche remoteJidAlt com o número real
const dadosWebhook = $('Normalizar Dados').item.json;
const remoteJidAlt = dadosWebhook.remoteJidAlt || '';
const remoteJid    = dadosWebhook.remoteJid    || '';

let numeroReal = '';
let fonte = '';

if (remoteJidAlt && remoteJidAlt.includes('@s.whatsapp.net')) {
  numeroReal = remoteJidAlt.replace('@s.whatsapp.net', '');
  fonte = 'remoteJidAlt_v2';
}

// === FONTE 1: remoteJid direto (Android @s.whatsapp.net — sem @lid) ===
if (!numeroReal && remoteJid.includes('@s.whatsapp.net')) {
  numeroReal = remoteJid.replace('@s.whatsapp.net', '');
  fonte = 'remoteJid_direto';
}

// === FONTE 2: findContacts por pushName (fallback legacy) ===
if (!numeroReal) {
  const contactData = $('Buscar Contato Real').item.json;
  const contactList = Array.isArray(contactData) ? contactData : [contactData];
  const contact = contactList[0] || {};
  if (contact.id && contact.id.includes('@s.whatsapp.net')) {
    numeroReal = contact.id.replace('@s.whatsapp.net', '');
    fonte = 'findContacts_pushName';
  }
}

// === FALLBACK: @lid como identificador (evita quebrar Upsert Lead) ===
const identificador = numeroReal || remoteJid.replace('@lid', '_lid');

if (!numeroReal) {
  console.log('[AVISO] Número não resolvido | remoteJid:', remoteJid, '| remoteJidAlt:', remoteJidAlt);
}

console.log('numeroReal:', numeroReal, '| fonte:', fonte);

return [{
  json: {
    ...dadosWebhook,
    numeroReal,
    telefone: identificador,
    fonteNumero: fonte || 'lid_fallback',
    lidNaoResolvido: !numeroReal
  }
}];
```

### Passo 3 — Verificar formato de envio do v2.x
O formato do body do "Enviar Mensagem WA" pode ter mudado no v2.x. Testar ambos:

**Formato v1.x (atual):**
```json
{
  "number": "{{ $('Extrair Número Real').item.json.numeroReal }}",
  "textMessage": {
    "text": "{{ $('Parsear Resposta Sofia').item.json.mensagem }}"
  }
}
```

**Formato v2.x (pode ser necessário):**
```json
{
  "number": "{{ $('Extrair Número Real').item.json.numeroReal }}",
  "text": "{{ $('Parsear Resposta Sofia').item.json.mensagem }}"
}
```

Verificar a documentação da Evolution API v2.3.6 ou testar qual formato retorna 200.

---

## 6. PLANO DE CONTINGÊNCIA

### Se v2.3.6 não existir no Docker Hub
Testar `v2.2.3` (última listada) e verificar se `remoteJidAlt` existe nessa versão:
```bash
# Testar manualmente: enviar mensagem com @lid e checar o payload do webhook
# Se remoteJidAlt aparecer → versão serve
# Se não aparecer → aguardar v2.3.6 ou buscar outra solução
```

### Se v2.3.6 tiver crash loop do Baileys
1. Monitorar logs por 10 minutos após reconectar
2. Se o processo reiniciar em loop → reverter para `v1.8.2`
3. O MongoDB não será apagado — basta trocar a imagem de volta

### Se o PostgreSQL do Supabase der problema de conexão (plano FREE)
Usar PostgreSQL direto no Railway:
```
Railway → New Service → Database → PostgreSQL
# Copiar a URI interna gerada e usar como DATABASE_CONNECTION_URI
```

---

## 7. FLUXO COMPLETO PÓS-MIGRAÇÃO

```
Webhook WhatsApp (v2.3.6)
  ↓
  data.key.remoteJid    = "28952559136882@lid"
  data.key.remoteJidAlt = "5519989881838@s.whatsapp.net"  ← NOVO
  ↓
Filtrar Mensagens
  ↓
Normalizar Dados
  Extrai: remoteJid, remoteJidAlt, nome, mensagem, source
  ↓
Buscar Contato Real (findContacts — fallback)
  ↓
Extrair Número Real
  Fonte 0: remoteJidAlt → "5519989881838" ✅ RESOLVE @lid
  Fonte 1: remoteJid @s.whatsapp.net (Android sem @lid) ✅
  Fonte 2: findContacts (legacy) ✅
  ↓
Upsert Lead (Supabase — telefone = "5519989881838")
  ↓
Chamar Sofia (Flowise)
  ↓
Parsear Resposta Sofia
  ↓
Salvar Conversa (Supabase)
  ↓
Enviar Mensagem WA (Evolution API v2.3.6)
  number = "5519989881838" ✅ FUNCIONA
```

---

## 8. RESUMO DO STATUS APÓS MIGRAÇÃO

| Componente | Status esperado |
|-----------|----------------|
| @lid iPhone | ✅ Resolvido via remoteJidAlt |
| @lid Android | ✅ Resolvido via remoteJidAlt |
| Android @s.whatsapp.net | ✅ Fonte 1 (sem mudança) |
| Upsert Lead | ✅ telefone nunca vazio |
| Enviar Mensagem WA | ✅ número real disponível |
| **Sistema completo** | ✅ **OPERACIONAL** |

---

*HANDOFF6.md — Oral Unic Chapadão do Sul — Abril 2026*
