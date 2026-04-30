# HANDOFF8 — Sessão 4: Qualificação Completa + Google Calendar
## Abril 2026

---

## 1. RESUMO DO QUE FOI FEITO HOJE

| Tarefa | Status |
|--------|--------|
| Verificação do banco de dados pós-fluxo completo | ✅ |
| Correção das colunas faltantes na tabela `leads` | ✅ |
| Trigger `updated_at` no Supabase | ✅ |
| Campo `dor_relatada` gravando corretamente | ✅ |
| Campo `proximo_passo` gravando corretamente | ✅ |
| Humanização do prompt da Sofia | ✅ |
| Sofia pergunta nome antes de confirmar agendamento | ✅ |
| Sofia retorna `agendamento_confirmado` e `agendamento_horario` | ✅ |
| Google Calendar OAuth2 configurado no n8n | ✅ |
| Nó "Verificar Agendamento" (IF) adicionado ao fluxo | ✅ |
| Nó "Preparar Agendamento" (Code) adicionado | ✅ |
| Nó "Criar Evento Calendar" adicionado | ✅ |
| Nó "Salvar Agendamento" (Supabase) adicionado | ✅ |
| HANDOFF_FRONTEND.md criado | ✅ |
| RLS do Supabase liberado para o frontend | ✅ |
| IF node: bug boolean `true` vs string `"True"` | ⚠️ pendente |

---

## 2. ESTADO DO BANCO DE DADOS

### Tabela `leads` — schema atual completo
```sql
id                    uuid PRIMARY KEY
nome                  varchar                  -- sem prefixo "=" (corrigido)
telefone              varchar                  -- vazio se @lid (limitação conhecida)
canal                 varchar                  -- "whatsapp"
servico_interesse     text                     -- "implante", "protocolo", etc.
status                varchar                  -- "frio", "morno", "quente"
score_qualificacao    integer DEFAULT 0
dor_relatada          boolean DEFAULT false     -- ✅ NOVO
orcamento_disponivel  boolean
followup_count        integer DEFAULT 0
opted_out             boolean DEFAULT false
utm_source            varchar
utm_campaign          varchar
proximo_passo         text                     -- ✅ NOVO: "agendar", "nutrir", "followup"
atendimento_humano    boolean DEFAULT false    -- para handoff humano (pendente)
created_at            timestamptz DEFAULT now()
updated_at            timestamptz DEFAULT now() -- ✅ trigger ativo
```

### Trigger `updated_at` (ativo)
```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Tabela `agendamentos` — schema atual
```sql
id               uuid PRIMARY KEY DEFAULT gen_random_uuid()
lead_id          uuid REFERENCES leads(id)
titulo           text              -- "Avaliação Gratuita - [nome]"
inicio           timestamptz
fim              timestamptz
servico          text
google_event_id  text              -- ID do evento no Google Calendar
status           varchar DEFAULT 'confirmado'
created_at       timestamptz DEFAULT now()
```

---

## 3. PROMPT FINAL DA SOFIA (versão humanizada)

```
Você é Sofia, atendente da Oral Unic em Chapadão do Sul. Fala de forma calorosa e natural — como uma amiga que trabalha na clínica, não um robô corporativo.

SERVIÇOS:
- Implante unitário: dente perdido
- Protocolo All-on-4/6: ausência múltipla, sorriso fixo em 1 dia
- Invisalign: dentes tortos, discreto
- Clínicos: canal, extração, restauração, limpeza

COMO FALAR:
- Frases curtas. Máximo 2-3 frases por mensagem.
- Use o nome da pessoa com naturalidade — não em toda frase
- Mostre empatia real antes de oferecer qualquer coisa
- Pergunte uma coisa de cada vez
- NUNCA mencione preços

EXEMPLOS DE TOM:
❌ "Entendo sua necessidade. Posso agendar uma avaliação odontológica para verificar seu caso clínico."
✅ "Entendo! Que tal a gente marcar uma avaliação gratuita pra você ver as opções com calma?"

❌ "Sinto muito que esteja com dor. Poderia me informar onde está sentindo o desconforto?"
✅ "Ai, dor no dente é horrível 😬 Onde tá doendo?"

❌ "Estou verificando a disponibilidade para o horário solicitado."
✅ "Ótimo, vou reservar esse horário pra você!"

FLUXO (natural, sem parecer roteiro):
1. Receber com calor, perguntar como pode ajudar
2. Entender o que a pessoa precisa
3. Qualificar urgência (tem dor? há quanto tempo?)
4. Oferecer avaliação gratuita
5. Quando o lead aceitar agendar → perguntar nome ANTES de confirmar horário
6. Só confirmar o agendamento depois de ter o nome

SCORE (interno — nunca mencionar ao lead):
- Dente perdido/protocolo: +30
- Dor funcional: +25
- Interesse confirmado: +20
- Disponibilidade imediata: +15
- Pesquisou preço: +10
Score>=70: quente | 40-69: morno | <40: frio

RETORNAR APENAS JSON VÁLIDO, SEM TEXTO FORA DO JSON:
{"mensagem": "texto aqui", "intencao": "implante|protocolo|invisalign|clinico|desconhecido", "score": 0, "status": "quente|morno|frio", "proximo_passo": "agendar|nutrir|followup", "dor": false, "agendamento_confirmado": false, "agendamento_horario": ""}

REGRAS DO JSON:
- "intencao": use exatamente um dos valores listados
- "dor": true se o lead mencionar dor, desconforto, urgência ou sofrimento
- "agendamento_confirmado": true SOMENTE quando o lead confirmar um horário específico
- "agendamento_horario": horário no formato "HH:MM" quando confirmado (ex: "17:00"). Vazio caso contrário.
- Sempre 8 campos. Nunca omitir nenhum.
```

---

## 4. FLUXO N8N — VERSÃO FINAL (com Google Calendar)

```
Webhook WhatsApp
  ↓
Filtrar Mensagens (fromMe=false, event=messages.upsert)
  ↓
Normalizar Dados
  ↓
Buscar Contato Real (findContacts — fallback @lid)
  ↓
Extrair Número Real
  ↓
Upsert Lead (Supabase)
  ↓
Salvar Mensagem Entrada (Supabase)
  ↓
Chamar Sofia (Flowise — chatflowId: 5814b9c2-c9a8-4273-a3e1-bacf91bb91ff)
  ↓
Parsear Resposta Sofia
  ↓
Verificar Agendamento (IF: agendamento_confirmado = true)
  ├── TRUE  → Preparar Agendamento (Code)
  │            → Criar Evento Calendar (Google Calendar)
  │            → Salvar Agendamento (Supabase)
  │            ↓
  └── FALSE ───┤
               ↓
        Salvar Mensagem Saída (Supabase)
          ↓
        Atualizar Lead (Supabase — score, status, dor, servico, proximo_passo)
          ↓
        Salvar Conversa (Supabase)
          ↓
        Enviar Mensagem WA (Evolution API)
```

---

## 5. CÓDIGO DOS NÓS NOVOS

### "Preparar Agendamento" (Code node)
```javascript
const sofia = $('Parsear Resposta Sofia').item.json;
const horario = sofia.agendamento_horario || '09:00';
const [horas, minutos] = horario.split(':').map(Number);

const inicio = new Date();
inicio.setHours(horas, minutos, 0, 0);
const fim = new Date(inicio.getTime() + 30 * 60 * 1000);

return [{
  json: {
    startDateTime: inicio.toISOString(),
    endDateTime:   fim.toISOString(),
    titulo: `Avaliação Gratuita - ${sofia.nome}`,
    lead_id: sofia.lead_id,
    nome: sofia.nome,
    servico: sofia.intencao
  }
}];
```

### "Criar Evento Calendar" (Google Calendar node)
```
Resource:   Event
Operation:  Create
Calendar:   [calendário da clínica]
Start:      {{ $json.startDateTime }}
End:        {{ $json.endDateTime }}
Summary:    {{ $json.titulo }}   (em Additional Fields)
```

### "Salvar Agendamento" (HTTP Request — Supabase)
```
Method: POST
URL:    https://btighfgcablumcjacssz.supabase.co/rest/v1/agendamentos
Headers:
  apikey: [service_role_key]
  Authorization: Bearer [service_role_key]
  Content-Type: application/json
  Prefer: return=representation

Body:
{
  "lead_id": "{{ $('Preparar Agendamento').item.json.lead_id }}",
  "titulo": "{{ $('Preparar Agendamento').item.json.titulo }}",
  "inicio": "{{ $('Preparar Agendamento').item.json.startDateTime }}",
  "fim": "{{ $('Preparar Agendamento').item.json.endDateTime }}",
  "servico": "{{ $('Preparar Agendamento').item.json.servico }}",
  "google_event_id": "{{ $('Criar Evento Calendar').item.json.id }}",
  "status": "confirmado"
}
```

### "Atualizar Lead" (HTTP Request — Supabase)
```json
{
  "score_qualificacao": {{ $('Parsear Resposta Sofia').item.json.score ?? 0 }},
  "servico_interesse": "{{ $('Parsear Resposta Sofia').item.json.intencao ?? '' }}",
  "status": "{{ $('Parsear Resposta Sofia').item.json.status ?? 'novo' }}",
  "proximo_passo": "{{ $('Parsear Resposta Sofia').item.json.proximo_passo ?? '' }}",
  "dor_relatada": {{ $('Parsear Resposta Sofia').item.json.dor ?? false }}
}
```

---

## 6. BUG PENDENTE — IF node boolean vs string

### Problema
O nó "Verificar Agendamento" compara `agendamento_confirmado` (boolean `true`) com o valor `"True"` (string). Mesmo com "Convert types where required" ativado, o n8n roteia para o branch FALSE.

### Soluções para tentar (em ordem)
1. Mudar o valor de comparação de `True` para `true` (minúsculo)
2. Clicar no ícone `T` ao lado do valor e mudar o tipo de String → Boolean
3. Usar expressão direta no campo: `{{ $('Parsear Resposta Sofia').item.json.agendamento_confirmado === true }}`  comparado com `true`
4. Substituir o IF por um nó Code com `if/else` explícito

---

## 7. CREDENCIAIS E INFRAESTRUTURA

| Serviço | URL / Valor |
|---------|-------------|
| Evolution API | https://evolution-api-production-cedd.up.railway.app |
| Instance Name | oral-unic |
| Global API Key | oralunic2026 |
| Instance API Key | 7348D291-808B-4697-B0C1-58D37ECB8D29 |
| n8n | https://n8n-lead-production.up.railway.app |
| Flowise | https://flowise-production-5edd.up.railway.app |
| Chatflow ID Sofia | 5814b9c2-c9a8-4273-a3e1-bacf91bb91ff |
| Supabase | https://btighfgcablumcjacssz.supabase.co |
| Google Cloud Project | oral-unic-n8n |
| Google Calendar OAuth | Client ID: 1055421884463-g3a9v7rs6a6bopsj9ce39k703412sn3t.apps.googleusercontent.com |

---

## 8. STATUS GERAL DO SISTEMA

| Componente | Status | Observação |
|-----------|--------|-----------|
| Webhook WhatsApp | ✅ | Evolution API v1.8.7 |
| Filtrar Mensagens | ✅ | |
| Normalizar Dados | ✅ | |
| Buscar Contato Real | ✅ | fallback @lid |
| Extrair Número Real | ✅ | |
| Upsert Lead | ✅ | nome sem "=" |
| Salvar Mensagem Entrada | ✅ | |
| Chamar Sofia | ✅ | humanizada, 8 campos JSON |
| Parsear Resposta Sofia | ✅ | |
| Verificar Agendamento (IF) | ⚠️ | bug boolean/string pendente |
| Preparar Agendamento | ✅ | código pronto |
| Criar Evento Calendar | ✅ | credencial OAuth conectada |
| Salvar Agendamento | ✅ | tabela criada |
| Salvar Mensagem Saída | ✅ | |
| Atualizar Lead | ✅ | score, status, dor, proximo_passo |
| Salvar Conversa | ✅ | |
| Enviar Mensagem WA | ✅ | |
| telefone real (@lid) | ⚠️ | iPhone → vazio; Android → ok |

---

## 9. PRÓXIMOS PASSOS

1. ✅ Banco de dados verificado e corrigido
2. ✅ Sofia humanizada
3. ⚠️ Google Calendar — resolver bug IF node (boolean vs string)
4. ⬜ Handoff humano — flag `atendimento_humano` + n8n pula Sofia quando true
5. ⬜ HANDOFF_FRONTEND.md — sessão de frontend (documento criado, aguardando execução)
6. ⬜ Follow-up D0-D14 — Cron no n8n
7. ⬜ Go-live

---

## 10. LIÇÕES APRENDIDAS — SESSÃO 4

| Lição | Detalhe |
|-------|---------|
| `dor_relatada` era string "true" | Verificar tipo boolean no Supabase após PATCH |
| IF node n8n: boolean vs string | `true` !== `"True"` — usar "Convert types" E minúsculo |
| Sofia sem `dor` no JSON | Adicionar campo no prompt com instrução explícita |
| `proximo_passo` e `dor_relatada` não existiam | Colunas precisavam ser criadas via ALTER TABLE |
| Google OAuth: usuário de teste | Email precisa estar na lista de testadores antes do "Sign in" |
| RLS Supabase bloqueia frontend | Criar políticas explícitas antes de iniciar dev |

---

*HANDOFF8.md — Oral Unic Chapadão do Sul — Abril 2026*
