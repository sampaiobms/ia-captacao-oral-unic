# IA CAPTACAO ORAL UNIC — HANDOFF2.md
## Sessão 2 — Abril 2026

---

## 1. INFRAESTRUTURA ATUAL — TUDO NO AR

| Servico | URL | Status | Versao |
|---------|-----|--------|--------|
| **Flowise** | flowise-production-5edd.up.railway.app | ONLINE | latest |
| **n8n** | n8n-lead-production.up.railway.app | ONLINE | 2.17.3 |
| **Evolution API** | evolution-api-production-cedd.up.railway.app | ONLINE | v1.8.2 |
| **MongoDB** | mongodb.railway.internal:27017 | ONLINE | Railway |
| **Supabase** | btighfgcablumcjacssz.supabase.co | ONLINE | FREE |

### Credenciais Evolution API
```
Global API Key: oralunic2026
Instance API Key (oral-unic): A433F7FD-5F57-4C9B-9FED-8910E0401744
Instancia: oral-unic
MongoDB URI: mongodb://mongo:KPburcuOKPTapeUqLYrotHuDSTHeXcGr@mongodb.railway.internal:27017/evolution?authSource=admin
```

### Agente Sofia
```
Flowise URL: https://flowise-production-5edd.up.railway.app
Chatflow ID: 5814b9c2-c9a8-4273-a3e1-bacf91bb91ff
Credencial OpenAI: API_LEADS_ORAL (configurada no Flowise)
```

### Supabase
```
Project ID: btighfgcablumcjacssz
URL: https://btighfgcablumcjacssz.supabase.co
Senha: OralUnic2026db
7 tabelas: leads, mensagens, conversas, agendamentos, eventos_status, followup_log, kpi_diario
RLS: ativo em todas as tabelas
IMPORTANTE: Plano FREE — usar REST API, NAO conexao direta PostgreSQL
```

---

## 2. FLUXO N8N — STATUS ATUAL

### Estrutura do fluxo (quase completo)
```
Webhook WhatsApp
→ Filtrar Mensagens
→ Normalizar Dados
→ Upsert Lead (Supabase REST API)
→ Chamar Sofia (Flowise)
→ Parsear Resposta Sofia
→ Salvar Conversa (Supabase REST API)
→ Enviar Mensagem WA (Evolution API) ← PROBLEMA AQUI
```

### O que funciona
- Webhook recebe mensagens do WhatsApp
- Filtro de mensagens funcionando
- Normalizacao de dados funcionando
- Upsert Lead no Supabase funcionando
- Sofia responde corretamente via Flowise
- Parsear JSON da Sofia funcionando
- Salvar Conversa no Supabase funcionando
- TESTE CONFIRMADO: quando o numero do lead e "chumbado" no JSON do ultimo no, a mensagem chega perfeitamente

### Configuracao dos nos Supabase (IMPORTANTE)
Todos os nos que fazem POST/PATCH no Supabase precisam deste header:
```
Prefer: return=representation
```
Sem ele o Supabase executa mas retorna vazio, quebrando os nos seguintes.

Para UPSERT usar:
```
Prefer: resolution=merge-duplicates,return=representation
```

---

## 3. PROBLEMA FOCAL — @lid

### Descricao do problema
O campo `remoteJid` que chega no webhook NUNCA contem o numero externo real do celular do lead. Em vez disso, chega um ID interno do WhatsApp no formato `@lid`:

```
Exemplo: 66735705198620@lid
```

Isso acontece tanto para iPhone quanto para Android.

### O que foi testado e confirmado
1. iPhone: remoteJid = `145874302849194@lid` — nao e numero real
2. Android: remoteJid = `66735705198620@lid` — nao e numero real
3. Teste "chumbado": substituir o numero no JSON por `5515988258408` (numero real) → mensagem chega perfeitamente
4. Evolution API v1.8.2 retorna erro ao tentar enviar para `@lid`:
   ```json
   {"exists": false, "jid": "66735705198620@s.whatsapp.net", "number": "66735705198620"}
   ```
5. A Evolution API recebe as mensagens do iPhone (salva no MongoDB) mas NAO dispara o webhook para o n8n quando remoteJid e `@lid`

### O que o webhook recebe
```json
{
  "body": {
    "event": "messages.upsert",
    "instance": "oral-unic",
    "data": {
      "key": {
        "remoteJid": "66735705198620@lid",  ← ID interno, NAO e numero real
        "fromMe": false,
        "id": "A54335FC49873DDCBF1DF97347A12AA7"
      },
      "pushName": "Nome do Lead",
      "message": {
        "conversation": "Mensagem do lead"
      },
      "source": "android"
    },
    "sender": "556796624456@s.whatsapp.net"  ← numero da CLINICA (chip 2)
  }
}
```

### O que NAO funciona
- Usar `remoteJid` diretamente → `@lid` invalido para Evolution API
- Remover sufixo `@lid` → numero `66735705198620` nao existe no WhatsApp
- Buscar numero real no MongoDB → contatos salvos com `@s.whatsapp.net`, nao ha mapeamento de `@lid` para numero real
- Usar `sender` → e o numero da clinica, nao do lead

---

## 4. SOLUCOES POSSIVEIS A INVESTIGAR

### Opcao A — Usar o numero do proprio lead como identificador fixo
Para testes, pre-cadastrar os numeros de teste no sistema e usar lookup por `pushName` para identificar o lead. Nao escalavel mas funciona para MVP.

### Opcao B — Configurar a Evolution API para resolver @lid
A Evolution API v1.8.2 pode ter configuracao para resolver `@lid` para numero real antes de disparar o webhook. Investigar as variaveis de ambiente:
```
CHATWOOT_IMPORT_MESSAGES_SENT_BY_ME=true
```
Ou atualizar para versao mais recente da v1.x que pode ter correcao para isso.

### Opcao C — Usar a API da Evolution para buscar numero real
A Evolution API tem endpoint para verificar se um numero existe:
```
GET /chat/findContacts/oral-unic
```
Ja confirmamos que os contatos ficam salvos com o numero real `@s.whatsapp.net`.
Possivel solucao: quando chegar `@lid`, buscar na collection Contact do MongoDB pelo `pushName` para encontrar o numero real.

Exemplo de consulta:
```javascript
// No no "Normalizar Dados" ou em no separado
// Se remoteJid contem @lid, buscar numero real pelo pushName
const pushName = $json.body.data.pushName;
// Chamar Evolution API: GET /chat/findContacts/oral-unic
// Filtrar por pushName para obter o id com @s.whatsapp.net
```

### Opcao D — Webhook alternativo com numero real
Configurar a Evolution API para incluir o numero resolvido no payload do webhook via variavel:
```
WEBHOOK_BY_EVENTS=true
```

### Opcao E — Usar findContacts da Evolution API no fluxo n8n
Adicionar um no HTTP Request no n8n que:
1. Chama `GET /chat/findContacts/oral-unic` com query `{ "where": { "pushName": "{{ $json.nome }}" } }`
2. Extrai o `id` do contato encontrado (formato `5511968404390@s.whatsapp.net`)
3. Remove o sufixo `@s.whatsapp.net` para obter o numero real
4. Usa esse numero para enviar a mensagem

**Esta e a opcao mais promissora** — ja confirmamos que os contatos estao no MongoDB com o numero real.

---

## 5. ENDPOINT PARA BUSCAR CONTATO POR NOME

```bash
curl -s -X POST \
  "https://evolution-api-production-cedd.up.railway.app/chat/findContacts/oral-unic" \
  -H "Content-Type: application/json" \
  -H "apikey: A433F7FD-5F57-4C9B-9FED-8910E0401744" \
  -d '{"where": {"pushName": "Francisco"}}'
```

Retorno esperado:
```json
[{
  "_id": "69eb6c9ed66d64e7b5047cbc",
  "pushName": "Francisco",
  "id": "5511968404390@s.whatsapp.net",
  "owner": "oral-unic"
}]
```

---

## 6. CONFIGURACAO DO NO "ENVIAR MENSAGEM WA"

### Como deve ser o body (formato correto v1.8.2)
```json
{
  "number": "5515988258408",
  "textMessage": {
    "text": "mensagem da Sofia aqui"
  }
}
```

### Headers obrigatorios
```
apikey: A433F7FD-5F57-4C9B-9FED-8910E0401744
Content-Type: application/json
```

### URL
```
POST https://evolution-api-production-cedd.up.railway.app/message/sendText/oral-unic
```

---

## 7. FLUXO RECOMENDADO COM SOLUCAO @lid

```
Webhook WhatsApp
→ Filtrar Mensagens (fromMe=false, event=messages.upsert)
→ Normalizar Dados (extrair remoteJid, pushName, mensagem)
→ [NOVO] Buscar Contato Real (GET /chat/findContacts por pushName)
→ [NOVO] Extrair Numero Real (remover @s.whatsapp.net do id encontrado)
→ Upsert Lead (Supabase, usar numero real)
→ Chamar Sofia (Flowise, chatflowId: 5814b9c2-c9a8-4273-a3e1-bacf91bb91ff)
→ Parsear Resposta Sofia (extrair campo "mensagem" do JSON)
→ Salvar Conversa (Supabase)
→ Enviar Mensagem WA (Evolution API, usar numero real)
```

---

## 8. SCRIPTS UTEIS

### Recriar instancia WhatsApp (se desconectar)
```bash
python3 /tmp/qr.py
# Depois escanear QR Code com WhatsApp do chip 2
```

### Testar envio de mensagem
```bash
cat > /tmp/send.py << 'EOF'
import subprocess, json
url = "https://evolution-api-production-cedd.up.railway.app"
key = "A433F7FD-5F57-4C9B-9FED-8910E0401744"
payload = json.dumps({"number": "55XXXXXXXXXXX", "textMessage": {"text": "teste"}})
result = subprocess.run(["curl","-s","-X","POST",f"{url}/message/sendText/oral-unic",
  "-H","Content-Type: application/json","-H",f"apikey: {key}","-d",payload],
  capture_output=True,text=True)
print(result.stdout)
EOF
python3 /tmp/send.py
```

### Buscar contatos na Evolution API
```bash
cat > /tmp/find_contact.py << 'EOF'
import subprocess, json
url = "https://evolution-api-production-cedd.up.railway.app"
key = "A433F7FD-5F57-4C9B-9FED-8910E0401744"
result = subprocess.run(["curl","-s","-X","POST",
  f"{url}/chat/findContacts/oral-unic",
  "-H","Content-Type: application/json","-H",f"apikey: {key}",
  "-d",'{"where":{}}'],capture_output=True,text=True)
data = json.loads(result.stdout)
for c in data[:10]:
    print(c.get("id"), "|", c.get("pushName"))
EOF
python3 /tmp/find_contact.py
```

---

## 9. LICOES APRENDIDAS DESTA SESSAO

| Problema | Solucao |
|----------|---------|
| Supabase POST/PATCH retorna vazio | Adicionar header `Prefer: return=representation` |
| Supabase UPSERT retorna vazio | Usar `Prefer: resolution=merge-duplicates,return=representation` |
| JSON.stringify no body do n8n | Usar JSON direto com `{{ }}`, sem JSON.stringify |
| `[0]` no json do n8n | Usar `.item.json.campo` sem `[0]` |
| `={{ expressao }}` dentro de JSON | Usar `{{ expressao }}` sem o `=` dentro de JSON |
| Evolution API v2.x — crash loop Baileys | Usar sempre v1.8.2 com MongoDB |
| Evolution API v1.8.2 NAO aceita @lid | Precisa do numero real com @s.whatsapp.net ou so digitos |
| iPhone nao dispara webhook | v1.8.2 nao envia webhook para mensagens @lid |

---

## 10. PROXIMOS PASSOS EM ORDEM

1. Implementar busca de numero real via findContacts (Opcao E da secao 4)
2. Testar fluxo completo com numero Android real
3. Verificar se iPhone passa a funcionar apos implementar findContants
4. Reconectar e corrigir no "Atualizar Lead"
5. Configurar follow-up D0-D14
6. Deploy Metabase para dashboard KPIs
7. Testes com 10 leads simulados
8. Go-live

---

*HANDOFF2.md — Oral Unic Chapadao do Sul — Abril 2026*
