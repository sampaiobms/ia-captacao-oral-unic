# HANDOFF5 — Solução Definitiva: Dois Caminhos por Tipo de Dispositivo
## Sessão 3 — conclusão — Abril 2026

---

## 1. DESCOBERTA FINAL

### Dados do dump completo do webhook (Francisco, iPhone)
```
source:    "unknown"         ← iPhone
remoteJid: "145874302849194@lid"
pushName:  "Francisco Sampaio"
```
Resultado: **ZERO campos com número real no payload do iPhone**. O `@lid` é o único identificador disponível. Não há como resolver via webhook ou findContacts para esse caso.

### Dado crítico do findContacts (todos os contatos)
```json
{
  "pushName": "Fabiano Luiz",
  "id": "5513988552395@s.whatsapp.net"   ← número real, Android!
}
```
**Fabiano (Android) tem `@s.whatsapp.net`** — o número real está disponível.

---

## 2. REGRA DEFINITIVA POR TIPO DE DISPOSITIVO

| Dispositivo | source | remoteJid | Número real | Solução |
|------------|--------|-----------|-------------|---------|
| Android (sem privacidade) | `android` | `5511968404390@s.whatsapp.net` | ✅ No próprio webhook | Extrair do remoteJid |
| Android + privacidade WA | `android` | `66735705198620@lid` | ⚠️ Via findContacts se salvo | findContacts por pushName |
| iPhone | `unknown` | `145874302849194@lid` | ❌ Não disponível via API | Não resolvível |

### Para leads reais (não testes)
A **grande maioria dos leads** que chegam via WhatsApp são Android sem configurações de privacidade especiais. Para eles, o `remoteJid` virá como `@s.whatsapp.net` diretamente no webhook e o fluxo vai funcionar.

---

## 3. SOLUÇÃO FINAL — DOIS CAMINHOS NO CÓDIGO

### Atualizar o código do nó "Extrair Número Real"

Substituir TODO o código atual por:

```javascript
// === FONTE 1: remoteJid do webhook ===
// Android sem privacidade → vem direto como @s.whatsapp.net
const dadosWebhook = $('Normalizar Dados').item.json;
const remoteJid = dadosWebhook.remoteJid || '';

let numeroReal = '';
let fonte = '';

if (remoteJid.includes('@s.whatsapp.net')) {
  numeroReal = remoteJid.replace('@s.whatsapp.net', '');
  fonte = 'remoteJid_direto';
}

// === FONTE 2: findContacts por pushName ===
// Fallback para @lid — funciona se o contato estiver salvo com número real
if (!numeroReal) {
  const contactData = $('Buscar Contato Real').item.json;
  const contactList = Array.isArray(contactData) ? contactData : [contactData];
  const contact = contactList[0] || {};

  if (contact.id && contact.id.includes('@s.whatsapp.net')) {
    numeroReal = contact.id.replace('@s.whatsapp.net', '');
    fonte = 'findContacts_pushName';
  }
}

// === NÃO RESOLVIDO: iPhone com privacidade ===
if (!numeroReal) {
  console.log('[AVISO] Número não resolvido — @lid de iPhone ou privacidade ativa');
  console.log('remoteJid:', remoteJid, '| pushName:', dadosWebhook.nome);
}

return [{
  json: {
    ...dadosWebhook,
    numeroReal,
    telefone: numeroReal,
    fonteNumero: fonte,
    lidNaoResolvido: !numeroReal
  }
}];
```

---

## 4. GARANTIR QUE "Normalizar Dados" PASSA O remoteJid

O código acima acessa `$('Normalizar Dados').item.json.remoteJid`. Abrir o nó "Normalizar Dados" e confirmar que o JSON de saída inclui o campo `remoteJid`.

**Se não incluir, adicionar ao return do Normalizar Dados:**
```javascript
return [{
  json: {
    remoteJid: $json.body.data.key.remoteJid,   // ← adicionar se faltar
    nome: $json.body.data.pushName,
    mensagem: $json.body.data.message?.conversation || '',
    source: $json.body.data.source,
    // ... outros campos existentes
  }
}];
```

---

## 5. FLUXO COMPLETO ATUALIZADO

```
Webhook WhatsApp
  ↓
Filtrar Mensagens (fromMe=false, event=messages.upsert)
  ↓
Normalizar Dados
  Saída obrigatória: { remoteJid, nome, mensagem, source }
  ↓
Buscar Contato Real
  POST /chat/findContacts/oral-unic
  Body: { "where": { "pushName": "{{ nome }}" } }
  ↓
Extrair Número Real  ← NOVO CÓDIGO (seção 3)
  Fonte 1: remoteJid do webhook (Android ✅)
  Fonte 2: findContacts (Android @lid fallback ⚠️)
  Sem número: iPhone @lid ❌ (lidNaoResolvido=true)
  ↓ (condicional — ver seção 6)
Upsert Lead (Supabase)
  telefone = {{ numeroReal }}
  ↓
Chamar Sofia (Flowise)
  ↓
Parsear Resposta Sofia
  ↓
Salvar Conversa (Supabase)
  ↓
Enviar Mensagem WA (Evolution API)
  number = {{ numeroReal }}
```

---

## 6. ADICIONAR IF PARA CASO @lid IRESOLVÍVEL (RECOMENDADO)

Para evitar que o fluxo quebre quando `numeroReal` for vazio, adicionar um nó **IF** após "Extrair Número Real":

**Condição:**  
`{{ $json.lidNaoResolvido }}` é `false` (tem número)

- **true branch** → continua o fluxo normalmente (tem número)
- **false branch** → nó Code que salva no Supabase como "lead_sem_numero" para acompanhamento manual

**Nó IF — configuração:**
- Condição: `{{ $('Extrair Número Real').item.json.lidNaoResolvido }}` igual a `false`

---

## 7. TESTE DE VALIDAÇÃO

### Para Android (deve funcionar agora)
1. Usar um celular Android para enviar mensagem ao WhatsApp da clínica
2. No n8n, verificar o output do nó "Extrair Número Real":
   - `numeroReal` deve ser o número real (ex: `5511968404390`)
   - `fonteNumero` deve ser `remoteJid_direto`
3. Verificar que "Enviar Mensagem WA" envia com sucesso

### Para iPhone (limitação conhecida)
1. iPhone envia mensagem
2. `lidNaoResolvido: true` em "Extrair Número Real"
3. Se houver IF node → vai para branch "sem número"
4. Não envia mensagem (limitação do protocolo WhatsApp/iPhone)

---

## 8. SOBRE O PROBLEMA DO IPHONE — OPÇÕES FUTURAS

### Opção 1: Evolution API versão mais recente (melhor a longo prazo)
Verificar se existe versão do `atendai/evolution-api` posterior ao v1.8.2 com suporte a resolução de `@lid`:
```
docker pull atendai/evolution-api --list-tags
# ou verificar: https://hub.docker.com/r/atendai/evolution-api/tags
```

### Opção 2: Sofia coleta o número no início da conversa
Para leads iPhone sem número resolvido, Sofia pode perguntar o número como parte do fluxo de qualificação:

```
System Prompt adicional:
"Se não tiver o número do lead disponível no contexto, pergunte educadamente:
'Para continuar nossa conversa e enviar informações, pode me confirmar 
seu número de WhatsApp? (ex: 11 98765-4321)'"
```

### Opção 3: Aceitar a limitação para MVP
Para o MVP, iPhone representa uma minoria. Se `lidNaoResolvido=true`, registrar como lead e fazer acompanhamento manual via painel.

---

## 9. STATUS FINAL DO PROJETO

| Componente | Status |
|-----------|--------|
| Webhook WhatsApp | ✅ |
| Filtrar Mensagens | ✅ |
| Normalizar Dados | ✅ (verificar se passa remoteJid) |
| Buscar Contato Real | ✅ (findContacts funciona) |
| Extrair Número Real | ✅ após novo código desta seção |
| Upsert Lead | ✅ |
| Chamar Sofia | ✅ |
| Parsear Resposta Sofia | ✅ |
| Salvar Conversa | ✅ |
| Enviar Mensagem WA (Android) | ✅ com novo código |
| Enviar Mensagem WA (iPhone) | ❌ limitação do protocolo @lid |

**O sistema está operacional para leads Android. iPhone é limitação de protocolo do WhatsApp.**

---

*HANDOFF5.md — Oral Unic Chapadão do Sul — Abril 2026*
