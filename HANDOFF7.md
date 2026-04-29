# IA CAPTACAO ORAL UNIC — HANDOFF7.md
## Sessao 5 — Proximos Passos: Google Calendar + Telas de Gestao

---

## 1. STATUS ATUAL DO SISTEMA — O QUE FUNCIONA

### Fluxo principal OPERACIONAL
```
Lead envia mensagem WhatsApp
→ Evolution API v1.8.7 recebe e dispara webhook
→ n8n processa o fluxo
→ Sofia (Flowise + GPT-4o-mini) responde com contexto
→ Lead recebe resposta humanizada no WhatsApp
→ Conversa salva no Supabase
```

### Conversa de teste confirmando funcionamento
```
Francisco: Boa tarde, tudo bem?
Sofia: Boa tarde! Tudo ótimo. Sou a Sofia da Oral Unic...

Francisco: Gostaria de fazer uma avaliacao, estou precisando de implantes
Sofia: Que otimo! Para ajudar melhor, voce sente alguma dor?...

Francisco: Me chamo Francisco e nao sinto dor, gostaria de agenda
Sofia: Perfeito, Francisco! Vou ajudar a agendar sua avaliacao...

Francisco: Eu posso amanha as 18:00
Sofia: Otimo! Ja reservei sua avaliacao para amanha as 18:00!
```

### Infraestrutura no ar
| Servico | URL | Versao | Status |
|---------|-----|--------|--------|
| Evolution API | evolution-api-production-cedd.up.railway.app | v1.8.7 | ONLINE |
| n8n | n8n-lead-production.up.railway.app | 2.17.3 | ONLINE |
| Flowise | flowise-production-5edd.up.railway.app | latest | ONLINE |
| MongoDB | mongodb.railway.internal:27017 | Railway | ONLINE |
| Supabase | btighfgcablumcjacssz.supabase.co | FREE | ONLINE |

### Credenciais Evolution API (ATUALIZADAS)
```
Global API Key:   oralunic2026
Instance API Key: 7348D291-808B-4697-B0C1-58D37ECB8D29
Instancia:        oral-unic
Webhook URL:      https://n8n-lead-production.up.railway.app/webhook/whatsapp-oral-unic
```

ATENCAO: O Instance API Key muda toda vez que a instancia eh recriada via /tmp/qr.py
Apos recriar instancia, buscar novo key com:
```bash
curl -s "https://evolution-api-production-cedd.up.railway.app/instance/fetchInstances" \
  -H "apikey: oralunic2026"
```
E reconfigurar webhook:
```bash
python3 /tmp/set_webhook2.py
```

### Flowise — Agente Sofia
```
URL:          https://flowise-production-5edd.up.railway.app
Login:        admin / Bms230850jr
Chatflow ID:  5814b9c2-c9a8-4273-a3e1-bacf91bb91ff
Credencial:   API_LEADS_ORAL (OpenAI)
```

### Supabase — Banco de leads
```
Project ID:   btighfgcablumcjacssz
URL:          https://btighfgcablumcjacssz.supabase.co
Senha:        OralUnic2026db
Tabelas:      leads, mensagens, conversas, agendamentos,
              eventos_status, followup_log, kpi_diario
```

---

## 2. FLUXO N8N ATUAL

```
Webhook WhatsApp
→ Filtrar Mensagens (fromMe=false)
→ Normalizar Dados (extrai telefone, nome, mensagem)
→ Buscar Contato Real (findContacts Evolution API)
→ Extrair Numero Real (resolve @lid se possivel)
→ Upsert Lead (Supabase REST API)
→ Chamar Sofia (Flowise com sessionId=telefone)
→ Parsear Resposta Sofia
→ Salvar Conversa (Supabase REST API)
→ Enviar Mensagem WA (Evolution API)
```

### Configuracoes criticas dos nos Supabase
Todos os nos Supabase precisam do header:
```
Prefer: return=representation
```
No Upsert Lead usar:
```
Prefer: resolution=merge-duplicates,return=representation
URL: https://btighfgcablumcjacssz.supabase.co/rest/v1/leads?on_conflict=telefone
```

### SessionId no Chamar Sofia
O body do no "Chamar Sofia" deve incluir sessionId para manter contexto:
```json
{
  "question": "{{ $('Normalizar Dados').item.json.mensagem }}",
  "overrideConfig": {
    "sessionId": "{{ $('Normalizar Dados').item.json.telefone }}"
  }
}
```

---

## 3. PROBLEMA PENDENTE — @lid (NAO BLOQUEANTE)

O campo remoteJid chega como @lid para iPhone e alguns Android.
O numero real do lead nao esta disponivel nesses casos.

Solucao temporaria: numero fixo para testes
Solucao definitiva planejada: migrar para Evolution API v2.x
que inclui campo remoteJidAlt com numero real.

Para o MVP, leads Android sem privacidade funcionam perfeitamente.

---

## 4. PROXIMA TAREFA — INTEGRACAO GOOGLE CALENDAR

### O que a Sofia ja faz
Sofia detecta intencao de agendamento e confirma data/hora na conversa.
Exemplo: "Posso amanha as 18:00" → Sofia confirma o agendamento.

### O que precisa ser implementado
Quando Sofia confirmar agendamento, o n8n deve:
1. Detectar que o JSON da Sofia tem `proximo_passo: "agendar"`
2. Extrair data/hora da conversa
3. Criar evento no Google Calendar
4. Salvar o google_event_id na tabela agendamentos do Supabase
5. Enviar confirmacao com data/hora para o lead

### Estrutura da tabela agendamentos (ja existe no Supabase)
```sql
CREATE TABLE agendamentos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  data_hora TIMESTAMPTZ,
  servico VARCHAR(100),
  status VARCHAR(50) DEFAULT 'agendado',
  google_event_id VARCHAR(200),
  lembrete_enviado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Como integrar Google Calendar no n8n
1. No n8n → Credentials → Add credential → Google Calendar OAuth2
2. Adicionar no fluxo um no condicional apos "Parsear Resposta Sofia":
   - SE proximo_passo == "agendar" → criar evento no Calendar
   - SE nao → apenas salvar conversa e responder

### No de criacao de evento (Google Calendar)
```
Titulo: Avaliacao Gratuita - Oral Unic - [nome do lead]
Data/hora: extraida da conversa
Duracao: 60 minutos
Descricao: Lead: [nome] | Telefone: [telefone] | Servico: [intencao]
Calendario: calendario da clinica
```

### Extrair data/hora da conversa
A Sofia confirma o agendamento em linguagem natural.
Adicionar ao System Prompt da Sofia instrucao para retornar
data/hora no JSON em formato ISO:
```json
{
  "mensagem": "...",
  "intencao": "implante",
  "score": 75,
  "status": "quente",
  "proximo_passo": "agendar",
  "data_agendamento": "2026-04-29T18:00:00-03:00"
}
```

---

## 5. PROXIMA TAREFA — TELAS DE GESTAO DE LEADS

### O que precisa ser desenvolvido
Interface web para Francisco e equipe gerenciarem os leads captados.

### Funcionalidades prioritarias
1. **Kanban de leads** — colunas por status:
   - Leads Novos
   - Em Atendimento
   - Agendado
   - Compareceu
   - Fechado
   - Arquivo

2. **Lista de leads** com:
   - Nome, telefone, servico de interesse
   - Score de qualificacao (0-100)
   - Status atual
   - Data de entrada
   - Ultimo contato

3. **Detalhe do lead** com:
   - Historico completo da conversa com Sofia
   - Agendamentos
   - Acoes manuais (ligar, remarcar, arquivar)

4. **Dashboard KPIs**:
   - Total de leads hoje/semana/mes
   - Taxa de conversao por canal
   - Leads por servico de interesse
   - No-shows e reagendamentos

### Stack recomendada para as telas
- **Frontend:** React (hospedado no Railway ou Vercel)
- **Backend:** Supabase REST API direto (ja configurado)
- **Autenticacao:** Supabase Auth
- **Estilo:** Tailwind CSS

### Alternativa mais rapida — Metabase (ja planejado)
Deploy do Metabase no Railway conectado ao Supabase para
dashboard de KPIs sem desenvolvimento frontend.

---

## 6. SYSTEM PROMPT ATUALIZADO DA SOFIA

Adicionar ao System Prompt atual no Flowise estas instrucoes:

```
AGENDAMENTO:
Quando o lead confirmar data e hora para avaliacao:
1. Confirme o agendamento de forma entusiasmada
2. Informe que a avaliacao e GRATUITA
3. Retorne no JSON o campo data_agendamento no formato ISO 8601
   Exemplo: "data_agendamento": "2026-04-29T18:00:00-03:00"
4. Mude o proximo_passo para "agendar"

COLETA DE DADOS:
Sempre que possivel, tente coletar:
- Nome completo do lead
- Servico de interesse especifico
- Urgencia (dor? dificuldade para mastigar?)
- Disponibilidade de horario

FORMATO JSON COMPLETO:
{
  "mensagem": "texto para o lead",
  "intencao": "implante|protocolo|invisalign|clinico|indefinido",
  "score": 0,
  "status": "quente|morno|frio",
  "proximo_passo": "agendar|nutrir|followup",
  "data_agendamento": "ISO8601 ou null",
  "nome_coletado": "nome informado pelo lead ou null"
}
```

---

## 7. ORDEM DE DESENVOLVIMENTO RECOMENDADA

### Fase 1 — Google Calendar (esta sessao)
- [ ] Configurar credencial Google Calendar no n8n
- [ ] Atualizar System Prompt da Sofia para retornar data_agendamento
- [ ] Adicionar no condicional no fluxo para detectar agendamento
- [ ] Criar evento no Google Calendar via n8n
- [ ] Salvar agendamento no Supabase
- [ ] Enviar confirmacao por WhatsApp com data/hora

### Fase 2 — Lembretes automaticos
- [ ] Cron job no n8n: verificar agendamentos do dia seguinte
- [ ] Enviar lembrete 24h antes via WhatsApp
- [ ] Marcar lembrete_enviado=true no Supabase

### Fase 3 — Follow-up D0-D14
- [ ] Cron job para leads que nao agendaram
- [ ] Sequencia de mensagens D1, D3, D7, D14
- [ ] Detectar resposta e reativar fluxo principal

### Fase 4 — Telas de gestao
- [ ] Deploy Metabase no Railway (rapido, sem codigo)
- [ ] Dashboard KPIs basico
- [ ] Kanban de leads (desenvolvimento React)

---

## 8. SCRIPTS DE MANUTENCAO

### Recriar instancia WhatsApp (se desconectar)
```bash
cat > /tmp/qr.py << 'EOF'
import subprocess, json, base64, tempfile, time
url = "https://evolution-api-production-cedd.up.railway.app"
key = "oralunic2026"
subprocess.run(["curl","-s","-X","DELETE",f"{url}/instance/delete/oral-unic","-H",f"apikey: {key}"])
print("Deletado! Aguardando 5s...")
time.sleep(5)
subprocess.run(["curl","-s","-X","POST",f"{url}/instance/create","-H","Content-Type: application/json","-H",f"apikey: {key}","-d",'{"instanceName":"oral-unic","qrcode":true}'])
print("Criado! Aguardando 20s para QR...")
time.sleep(20)
result = subprocess.run(["curl","-s",f"{url}/instance/connect/oral-unic","-H",f"apikey: {key}"],capture_output=True,text=True)
data = json.loads(result.stdout)
qr = data.get("base64","")
if qr:
    img = base64.b64decode(qr.split(",")[-1])
    tmp = tempfile.mktemp(suffix=".png")
    open(tmp,"wb").write(img)
    subprocess.run(["open",tmp])
    print("QR Code aberto!")
else:
    print("Sem QR:", json.dumps(data)[:300])
EOF
python3 /tmp/qr.py
```

### Reconfigurar webhook apos recriar instancia
```bash
cat > /tmp/set_webhook2.py << 'EOF'
import subprocess, json
url = "https://evolution-api-production-cedd.up.railway.app"
result = subprocess.run(["curl","-s",f"{url}/instance/fetchInstances","-H","apikey: oralunic2026"],capture_output=True,text=True)
data = json.loads(result.stdout)
instance_key = data[0]["instance"]["apikey"]
print(f"Instance API Key: {instance_key}")
payload = json.dumps({"url":"https://n8n-lead-production.up.railway.app/webhook/whatsapp-oral-unic","enabled":True,"webhook_by_events":False,"webhook_base64":False,"events":["MESSAGES_UPSERT"]})
result2 = subprocess.run(["curl","-s","-X","POST",f"{url}/webhook/set/oral-unic","-H","Content-Type: application/json","-H",f"apikey: {instance_key}","-d",payload],capture_output=True,text=True)
print("Webhook:", result2.stdout)
EOF
python3 /tmp/set_webhook2.py
```

### Testar envio de mensagem
```bash
cat > /tmp/send.py << 'EOF'
import subprocess, json
url = "https://evolution-api-production-cedd.up.railway.app"
key = "7348D291-808B-4697-B0C1-58D37ECB8D29"
payload = json.dumps({"number":"5511968404390","textMessage":{"text":"Teste Oral Unic"}})
result = subprocess.run(["curl","-s","-X","POST",f"{url}/message/sendText/oral-unic","-H","Content-Type: application/json","-H",f"apikey: {key}","-d",payload],capture_output=True,text=True)
print(result.stdout)
EOF
python3 /tmp/send.py
```

---

## 9. INSTRUCAO PARA O CLAUDE CODE

Cole este prompt ao iniciar nova sessao:

```
Leia o HANDOFF7.md do repositorio ia-captacao-oral-unic.

STATUS: MVP funcionando para leads Android.
Sofia conversa naturalmente e confirma agendamentos.

PROXIMA TAREFA: Integracao Google Calendar (secao 4 do HANDOFF7)

PASSOS:
1. Atualizar System Prompt da Sofia no Flowise para retornar
   campo data_agendamento no JSON quando lead confirmar horario
2. Configurar credencial Google Calendar no n8n
3. Adicionar no condicional no fluxo n8n:
   SE proximo_passo == "agendar" → criar evento Google Calendar
4. Salvar agendamento na tabela agendamentos do Supabase
5. Enviar mensagem de confirmacao com data/hora para o lead

NAO altere a infraestrutura existente.
NAO mude a versao da Evolution API.
FOQUE apenas na integracao com Google Calendar.
```

---

*HANDOFF7.md — Oral Unic Chapadao do Sul — Abril 2026*
