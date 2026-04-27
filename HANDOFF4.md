# HANDOFF4 — @lid: findContacts também retorna @lid
## Sessão 3 — continuação — Abril 2026

---

## 1. NOVO DIAGNÓSTICO

### O que o findContacts retornou
```json
{
  "_id": "69eb6cee5c087192bf7f73a7",
  "id": "145874302849194@lid",      ← ainda @lid, NÃO @s.whatsapp.net
  "owner": "oral-unic",
  "pushName": "Francisco Sampaio",
  "profilePictureUrl": "...",
  "__v": 0
}
```

### Conclusão
A Evolution API v1.8.2 salva o contato com o `@lid` que recebeu do WhatsApp. Não há mapeamento `@lid → @s.whatsapp.net` armazenado. O `@lid` é um identificador opaco do protocolo Baileys/WhatsApp — os dígitos antes do `@` (ex: `145874302849194`) **não são o número de telefone real** e não podem ser revertidos matematicamente.

### Por que o "Enviar Mensagem WA" falhou
O código de "Extrair Número Real" procurava `@s.whatsapp.net` → nunca encontrou → `numeroReal = ""` → Evolution API recebeu `number: ""` → erro `400 Bad Request` com `{"jid":"@s.whatsapp.net","number":""}`.

---

## 2. ONDE ESTÁ O NÚMERO REAL — 3 FONTES POSSÍVEIS

### Fonte A — Payload completo do webhook (MAIS PROVÁVEL)
O HANDOFF2 mostrou apenas parte dos campos do webhook. O payload completo pode ter:
- `data.message.senderKeyDistributionMessage` com o JID resolvido
- `data.participant` (usado em grupos, às vezes presente em direto)
- `data.key.participant`
- Outros campos do protocolo Baileys não exibidos

**Como verificar:** Ver a seção 3 abaixo.

### Fonte B — Collection `Chat` do MongoDB (DIFERENTE de `Contact`)
A Evolution API salva chats separados de contatos. O documento na collection `Chat` para `@lid` pode ter o `@s.whatsapp.net` associado.

**Como verificar:** Ver a seção 4 abaixo.

### Fonte C — Endpoint `/chat/findChats`
Similar ao `findContacts` mas para chats — pode retornar campos diferentes.

**Como verificar:** Ver a seção 5 abaixo.

---

## 3. AÇÃO 1 — DUMP COMPLETO DO WEBHOOK NO N8N (FAZER PRIMEIRO)

### Como fazer no n8n

1. Adicionar um nó **Code** imediatamente após o **Webhook WhatsApp** (antes de "Filtrar Mensagens")
2. Nome: **`DEBUG - Dump Webhook`**
3. Código:

```javascript
// Retorna TODOS os campos do webhook para inspeção
const raw = $json;
console.log('=== WEBHOOK COMPLETO ===');
console.log(JSON.stringify(raw, null, 2));

// Lista todos os campos disponíveis no body.data
const data = raw?.body?.data || raw?.data || {};
console.log('=== CAMPOS EM data ===');
Object.keys(data).forEach(k => console.log(k, ':', JSON.stringify(data[k])));

// Lista campos no body.data.key
const key = data?.key || {};
console.log('=== CAMPOS EM data.key ===');
Object.keys(key).forEach(k => console.log(k, ':', key[k]));

return [{ json: raw }];
```

4. Enviar uma mensagem de teste no WhatsApp
5. Em n8n, clicar no nó DEBUG → ver o output em **"Output Data"**
6. Procurar qualquer campo que contenha um número brasileiro (começa com `55` + DDD + número)

### O que procurar especificamente
```
data.participant           → pode ser "5511968404390@s.whatsapp.net"
data.key.participant       → idem
data.messageContextInfo.*  → contexto do dispositivo
data.verifiedBizName       → nome verificado
data.broadcast             → flag de broadcast
data.message.*             → qualquer subcampo incomum
body.apikey                → não é número mas confirma campos disponíveis
```

---

## 4. AÇÃO 2 — QUERY MONGODB PARA COLLECTION CHAT

O endpoint `findContacts` busca na collection `Contact`. A collection `Chat` pode ter mapeamento diferente.

### No n8n — adicionar nó HTTP Request "Buscar Chat por @lid"

**Method:** POST  
**URL:** `https://evolution-api-production-cedd.up.railway.app/chat/findChats/oral-unic`  
**Header:** `apikey: A433F7FD-5F57-4C9B-9FED-8910E0401744`  
**Body:**
```json
{
  "where": {
    "id": "145874302849194@lid"
  }
}
```

> Substituir `145874302849194@lid` pelo `remoteJid` real que chega no webhook.

**Se retornar um campo `jid`, `phone`, `number` ou `s.whatsapp.net`** → usar esse campo.

### Alternativa: buscar todos os chats e inspecionar
```bash
curl -s -X POST \
  "https://evolution-api-production-cedd.up.railway.app/chat/findChats/oral-unic" \
  -H "Content-Type: application/json" \
  -H "apikey: A433F7FD-5F57-4C9B-9FED-8910E0401744" \
  -d '{"where": {}}' | python3 -m json.tool | head -100
```

---

## 5. AÇÃO 3 — ENDPOINT ALTERNATIVO: fetchInstances / fetchProfileBusiness

### Tentar verificar número via fetchProfile
```bash
# Trocar NUMERO pelo número real que você conhece (5511968404390)
# Para verificar se a Evolution API consegue resolver um @lid via API

curl -s -X GET \
  "https://evolution-api-production-cedd.up.railway.app/instance/fetchInstances" \
  -H "apikey: oralunic2026"
```

### Tentar findContacts sem filtro para ver TODOS os campos
```bash
curl -s -X POST \
  "https://evolution-api-production-cedd.up.railway.app/chat/findContacts/oral-unic" \
  -H "Content-Type: application/json" \
  -H "apikey: A433F7FD-5F57-4C9B-9FED-8910E0401744" \
  -d '{"where": {}}' | python3 -m json.tool
```

Verificar se algum contato tem `@s.whatsapp.net` ou se TODOS estão como `@lid`.

---

## 6. AÇÃO 4 — VARIÁVEL DE AMBIENTE NA EVOLUTION API

A variável `DATABASE_SAVE_DATA_CONTACTS=true` já está ativa, mas o tipo de dado salvo depende do que o Baileys resolve. Adicionar estas variáveis pode mudar o comportamento:

```
STORE_MESSAGES=true
STORE_MESSAGE_UP_TO_DAYS=7
STORE_CONTACTS=true
STORE_CHATS=true
```

Reiniciar o serviço após adicionar. Isso pode fazer a Evolution API salvar dados adicionais que incluam o mapeamento `@lid → @s.whatsapp.net`.

---

## 7. CÓDIGO ATUALIZADO — "Extrair Número Real"

Versão defensiva que tenta múltiplas fontes e loga tudo para debug:

```javascript
// Resultado do findContacts
const contactData = $('Buscar Contato Real').item.json;
const contactList = Array.isArray(contactData) ? contactData : [contactData];
const contact = contactList[0] || {};

// Dados normalizados do webhook
const dadosWebhook = $('Normalizar Dados').item.json;

let numeroReal = '';
let fonte = '';

// Fonte 1: id com @s.whatsapp.net (solução original - pode funcionar no futuro)
if (contact.id && contact.id.includes('@s.whatsapp.net')) {
  numeroReal = contact.id.replace('@s.whatsapp.net', '');
  fonte = 'findContacts.id';
}

// Fonte 2: campo 'phone' ou 'phoneNumber' no contato
if (!numeroReal && contact.phone) {
  numeroReal = String(contact.phone).replace(/\D/g, '');
  fonte = 'findContacts.phone';
}

// Fonte 3: remoteJid do webhook se for @s.whatsapp.net (Android sem @lid)
if (!numeroReal) {
  const remoteJid = dadosWebhook.remoteJid || '';
  if (remoteJid.includes('@s.whatsapp.net')) {
    numeroReal = remoteJid.replace('@s.whatsapp.net', '');
    fonte = 'webhook.remoteJid';
  }
}

// Fonte 4: campo 'participant' do webhook (grupos e alguns diretos)
if (!numeroReal) {
  const participant = dadosWebhook.participant || '';
  if (participant.includes('@s.whatsapp.net')) {
    numeroReal = participant.replace('@s.whatsapp.net', '');
    fonte = 'webhook.participant';
  }
}

// Debug: log completo para análise
if (!numeroReal) {
  console.log('=== @LID NÃO RESOLVIDO ===');
  console.log('remoteJid:', dadosWebhook.remoteJid);
  console.log('pushName:', dadosWebhook.nome);
  console.log('contact completo:', JSON.stringify(contact));
  console.log('dadosWebhook completo:', JSON.stringify(dadosWebhook));
}

console.log('numeroReal:', numeroReal, '| fonte:', fonte);

return [{
  json: {
    ...dadosWebhook,
    numeroReal,
    telefone: numeroReal,
    fonteNumero: fonte,
    contactRaw: contact
  }
}];
```

---

## 8. MAPA DE DECISÃO

```
findContacts retorna @lid?
  ├── SIM (situação atual)
  │     ├── Webhook tem campo participant com @s.whatsapp.net?
  │     │     ├── SIM → usar participant (Fonte 4 do código acima)
  │     │     └── NÃO → ir para próximo
  │     ├── findChats retorna campo com @s.whatsapp.net?
  │     │     ├── SIM → adicionar nó para extrair de lá
  │     │     └── NÃO → ir para próximo
  │     └── Todas as fontes falharam → ver Seção 9 (solução alternativa)
  └── NÃO (id com @s.whatsapp.net) → código original funciona ✓
```

---

## 9. SOLUÇÃO ALTERNATIVA SE TODAS AS FONTES FALHAREM

Se o número real não estiver disponível em nenhuma fonte da Evolution API, a opção viável para produção é:

### Opção: Perguntar o número via conversa (Sofia coleta)

Adicionar ao System Prompt da Sofia:
```
Se você não tiver o número de telefone do lead, pergunte:
"Para continuar, pode me confirmar seu número de WhatsApp? (ex: 11 98765-4321)"
```

E salvar o número informado no Supabase. Funciona como contorno, não é ideal.

### Opção: Atualizar Evolution API para versão que resolve @lid

Versões mais recentes do atendai/evolution-api podem ter o fix do @lid. Verificar:
- `atendai/evolution-api:latest` (com atenção ao crash do Baileys)
- `atendai/evolution-api:v1.8.7` ou similar (se existir versão estável)
- Checar releases em: https://hub.docker.com/r/atendai/evolution-api/tags

---

## 10. RESUMO DO ESTADO ATUAL

| Componente | Status |
|-----------|--------|
| Webhook WhatsApp | ✅ Funcionando |
| Filtrar Mensagens | ✅ Funcionando |
| Normalizar Dados | ✅ Funcionando |
| Buscar Contato Real | ⚠️ Retorna @lid (não @s.whatsapp.net) |
| Extrair Número Real | ❌ Número vazio pois findContacts não tem @s.whatsapp.net |
| Upsert Lead | ✅ Funcionando (quando número disponível) |
| Chamar Sofia | ✅ Funcionando |
| Parsear Resposta Sofia | ✅ Funcionando |
| Salvar Conversa | ✅ Funcionando |
| Enviar Mensagem WA | ❌ Falha por número vazio |

**Próximo passo imediato:** Executar a Ação 1 (dump completo do webhook) para encontrar onde está o número real no payload.

---

*HANDOFF4.md — Oral Unic Chapadão do Sul — Abril 2026*
