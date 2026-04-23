# Integração n8n → Flowise (Agente Sofia)

## Como funciona

Quando o WhatsApp recebe uma mensagem:

```
Evolution API → webhook POST → n8n → HTTP Request → Flowise (Sofia) → resposta JSON
```

O n8n é o orquestrador: recebe o evento do WhatsApp, enriquece com dados do lead
no Supabase, chama a Sofia no Flowise, interpreta o JSON de volta e devolve a
mensagem ao WhatsApp via Evolution API.

---

## Nó HTTP Request no n8n — Chamar a Sofia

### Configuração do nó

| Campo          | Valor                                                          |
|----------------|----------------------------------------------------------------|
| Method         | POST                                                           |
| URL            | `https://flowise-production-5edd.up.railway.app/api/v1/prediction/{{CHATFLOW_ID}}` |
| Authentication | Header Auth                                                    |
| Header Name    | `Authorization`                                                |
| Header Value   | `Bearer {{FLOWISE_API_KEY}}`                                   |
| Content-Type   | `application/json`                                             |

> Substitua `{{CHATFLOW_ID}}` pelo ID real após criar o chatflow (ver `flowise-sofia-setup.md`).
> Substitua `{{FLOWISE_API_KEY}}` pela chave criada em Configuration → API Access.

### Body (JSON)

```json
{
  "question": "={{ $json.mensagem_lead }}",
  "overrideConfig": {
    "sessionId": "={{ $json.telefone }}"
  }
}
```

O `sessionId` usa o telefone do lead — garante memória de conversa separada por lead.

---

## Fluxo completo do n8n (tarefas 1 a 5 do roadmap)

```
[Webhook — Evolution API]
        │
        ▼
[Set — normalizar dados]
  telefone = body.data.key.remoteJid (remover @s.whatsapp.net)
  mensagem_lead = body.data.message.conversation
  nome = body.data.pushName
        │
        ▼
[Supabase — buscar lead]
  SELECT * FROM leads WHERE telefone = '{{ telefone }}'
        │
        ├── Encontrou → usar lead existente
        └── Não encontrou →
              [Supabase — criar lead]
              INSERT INTO leads (nome, telefone, canal, status)
              VALUES ('{{ nome }}', '{{ telefone }}', 'whatsapp', 'novo')
        │
        ▼
[HTTP Request — Flowise Sofia]
  POST /api/v1/prediction/{{CHATFLOW_ID}}
  { "question": "{{mensagem_lead}}", "overrideConfig": { "sessionId": "{{telefone}}" } }
        │
        ▼
[Code — parsear JSON da Sofia]
  const raw = $input.first().json.text;
  const sofia = JSON.parse(raw);
  return [{ json: sofia }];
        │
        ▼
[Supabase — salvar conversa]
  INSERT INTO conversas (lead_id, canal, mensagem_usuario, resposta_ia, intencao_detectada)
  VALUES (lead_id, 'whatsapp', mensagem_lead, sofia.mensagem, sofia.intencao)

[Supabase — atualizar lead]
  UPDATE leads
  SET score_qualificacao = sofia.score,
      status = sofia.status,
      servico_interesse = sofia.intencao
  WHERE telefone = telefone
        │
        ▼
[Switch — rotear por proximo_passo]
  ├── "agendar"  → [Google Calendar] → agendar avaliação
  ├── "nutrir"   → enviar mensagem + agendar follow-up D1
  ├── "followup" → salvar em followup_log, cron tratará
  └── "humano"   → [Supabase] status = 'relacionamento' + notificar recepção
        │
        ▼
[HTTP Request — Evolution API — enviar resposta]
  POST https://evolution-api-production-cedd.up.railway.app/message/sendText/oral-unic
  Headers: { apikey: oralunic2026 }
  Body: { "number": "{{telefone}}", "text": "{{sofia.mensagem}}", "delay": 5000 }
```

---

## Nó Code — Parsear resposta da Sofia

A Sofia retorna um JSON dentro do campo `text` da resposta do Flowise.
Este nó extrai os campos:

```javascript
// Nó: Code (JavaScript)
const raw = $input.first().json.text || '';

let sofia;
try {
  // Remove possíveis marcadores de markdown caso existam
  const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  sofia = JSON.parse(clean);
} catch (e) {
  // Fallback: Sofia retornou texto livre (não JSON)
  sofia = {
    mensagem: raw,
    intencao: 'desconhecido',
    score: 0,
    status: 'frio',
    proximo_passo: 'followup'
  };
}

return [{ json: sofia }];
```

---

## Nó HTTP Request — Evolution API — Enviar mensagem

| Campo   | Valor                                                                            |
|---------|----------------------------------------------------------------------------------|
| Method  | POST                                                                             |
| URL     | `https://evolution-api-production-cedd.up.railway.app/message/sendText/oral-unic` |
| Headers | `apikey: oralunic2026` / `Content-Type: application/json`                        |

**Body:**
```json
{
  "number": "={{ $json.telefone }}",
  "text": "={{ $json.mensagem }}",
  "delay": 5000
}
```

O `delay: 5000` simula o tempo de digitação humano (5 segundos).
Ajustar entre 3000 e 8000ms conforme comprimento da mensagem.

---

## Variáveis do n8n — usar Credentials em vez de hardcode

No n8n, vá em **Settings → Credentials** e crie:

| Nome da Credential       | Tipo         | Campos                          |
|--------------------------|--------------|---------------------------------|
| `Flowise Oral Unic`      | Header Auth  | Name: Authorization, Value: Bearer `<chave>` |
| `Evolution API`          | Header Auth  | Name: apikey, Value: oralunic2026 |
| `Supabase Oral Unic`     | Supabase API | URL + Service Role Key          |

Nunca cole valores diretamente nos nós — use sempre as credentials do n8n.

---

## Webhook da Evolution API no n8n

Após criar o webhook no n8n, configure a URL no Evolution API:

```bash
curl -X POST https://evolution-api-production-cedd.up.railway.app/webhook/set/oral-unic \
  -H "apikey: oralunic2026" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://n8n-lead-production.up.railway.app/webhook/whatsapp-oral-unic",
    "webhook_by_events": false,
    "webhook_base64": false,
    "events": ["MESSAGES_UPSERT"]
  }'
```

Substitua `/webhook/whatsapp-oral-unic` pelo path real gerado pelo nó Webhook do n8n.
O evento `MESSAGES_UPSERT` é disparado em toda mensagem recebida.

---

## Filtros importantes no webhook (evitar loops)

Adicione um nó **IF** logo após o Webhook para descartar:

```javascript
// Ignorar se:
// 1. Mensagem enviada pela própria clínica (fromMe = true)
// 2. Mensagem de grupo
// 3. Lead optou por sair (opted_out = true)

const msg = $json.body.data;
const isFromMe = msg?.key?.fromMe === true;
const isGroup = msg?.key?.remoteJid?.includes('@g.us');

return !isFromMe && !isGroup;
```
