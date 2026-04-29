# HANDOFF_FRONTEND — Dashboard Oral Unic
## Sessão de Frontend — Abril 2026

---

## 1. CONTEXTO DO PROJETO

Sistema de captação de leads via WhatsApp com IA (Sofia). O backend está **100% operacional**:
- Leads entram pelo WhatsApp → Sofia qualifica → dados salvos no Supabase
- Falta: interface para a recepcionista/gerente visualizar e gerenciar os leads

O frontend é um **painel interno** (não público). Usuários: recepcionista e gerente da clínica.

---

## 2. BANCO DE DADOS — SUPABASE

```
URL:        https://btighfgcablumcjacssz.supabase.co
Project ID: btighfgcablumcjacssz
```

### Chaves de acesso
```
ANON KEY (frontend — RLS ativa):
[preencher com a chave anon do projeto Supabase]

SERVICE ROLE KEY (nunca expor no frontend — backend only):
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0aWdoZmdjYWJsdW1jamFjc3N6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTYxMjIxOCwiZXhwIjoyMDkxMTg4MjE4fQ.g0MkJL-RzgGfv26yL0gHJTshy4xqGPh3tuZnJrotvNU
```

> **ATENÇÃO:** O frontend deve usar apenas a ANON KEY. A service role bypassa o RLS e não deve ser exposta no cliente.

---

## 3. SCHEMA DAS TABELAS (estado real — Abril 2026)

### `leads`
```sql
id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
nome              varchar
telefone          varchar          -- pode estar vazio (@lid não resolvido)
canal             varchar          -- "whatsapp"
servico_interesse text             -- "implante", "protocolo", "invisalign", "clinico", "desconhecido"
status            varchar          -- "frio", "morno", "quente"
score_qualificacao integer DEFAULT 0
dor_relatada      boolean DEFAULT false
orcamento_disponivel boolean       -- null = não perguntado
followup_count    integer DEFAULT 0
opted_out         boolean DEFAULT false
utm_source        varchar
utm_campaign      varchar
proximo_passo     text             -- "agendar", "nutrir", "followup"
atendimento_humano boolean DEFAULT false  -- (a implementar)
created_at        timestamptz DEFAULT now()
updated_at        timestamptz DEFAULT now()
```

### `mensagens`
```sql
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
lead_id     uuid REFERENCES leads(id)
direcao     varchar    -- "entrada" (lead → Sofia) | "saida" (Sofia → lead)
conteudo    text
tipo        varchar    -- "texto"
enviado_por varchar    -- "lead" | "Sofia"
created_at  timestamptz DEFAULT now()
```

### `conversas`
```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
lead_id             uuid REFERENCES leads(id)
canal               varchar    -- "whatsapp"
mensagem_usuario    text
resposta_ia         text
intencao_detectada  varchar    -- "implante", "clinico", etc.
created_at          timestamptz DEFAULT now()
```

### `agendamentos`
```sql
-- Tabela existe mas ainda sem integração ativa (Google Calendar pendente)
-- Estrutura a confirmar com: SELECT * FROM agendamentos LIMIT 1
id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
lead_id     uuid REFERENCES leads(id)
created_at  timestamptz DEFAULT now()
-- demais campos: verificar no Supabase
```

### Outras tabelas (existem, ainda não usadas ativamente)
- `eventos_status` — log de eventos do sistema
- `followup_log` — registro de follow-ups D0-D14
- `kpi_diario` — métricas diárias agregadas

---

## 4. STACK RECOMENDADA

```
Framework:    Next.js 14 (App Router) — SSR + API routes
Linguagem:    TypeScript
Estilo:       Tailwind CSS + shadcn/ui
Banco:        @supabase/supabase-js (cliente oficial)
Gráficos:     Recharts
Estado:       React Query (TanStack Query) — cache + real-time
Real-time:    Supabase Realtime (subscribe nas tabelas leads/mensagens)
Deploy:       Vercel (mais simples) ou Railway
```

### Dependências principais
```bash
npm install @supabase/supabase-js @tanstack/react-query recharts
npx shadcn@latest init
```

---

## 5. FUNCIONALIDADES — PRIORIDADES

### P0 — KPIs (tela inicial)
Métricas em cards:
- Total de leads hoje / semana / mês
- Leads por status (frio / morno / quente)
- Taxa de conversão (quente / total)
- Leads com `proximo_passo = "agendar"` aguardando

**Query:**
```sql
SELECT
  status,
  COUNT(*) as total,
  AVG(score_qualificacao) as score_medio
FROM leads
GROUP BY status;
```

### P1 — Kanban de Leads
Colunas: **Frio → Morno → Quente → Agendado**

Cada card exibe:
- Nome do lead
- Serviço de interesse
- Score (badge colorido)
- Ícone de dor se `dor_relatada = true`
- Tempo desde o primeiro contato
- Botão "Ver conversa"

**Drag and drop** atualiza o `status` no Supabase.

### P2 — Detalhe do Lead
Ao clicar num card:
- Dados do lead (nome, telefone, canal, score, serviço)
- Timeline completa da conversa (mensagens ordenadas por `created_at`)
- Badges: dor, serviço, próximo passo

### P3 — Handoff Humano
Botão **"Assumir atendimento"** no detalhe do lead:
- Seta `atendimento_humano = true` no Supabase
- Quando `true`, o n8n pula a Sofia e não responde automaticamente
- Botão **"Devolver para Sofia"** reseta para `false`

> **Atenção:** A coluna `atendimento_humano` precisa ser adicionada à tabela `leads` no Supabase:
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS atendimento_humano BOOLEAN DEFAULT false;
```

### P4 — Agendamentos (após Google Calendar integrado)
Lista de agendamentos com:
- Nome do lead
- Data/hora
- Serviço
- Status (confirmado / pendente / cancelado)

---

## 6. CONFIGURAÇÃO DO SUPABASE CLIENT

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://btighfgcablumcjacssz.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
```

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://btighfgcablumcjacssz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[preencher com anon key]
```

---

## 7. EXEMPLOS DE QUERIES

### Leads recentes com status
```typescript
const { data: leads } = await supabase
  .from('leads')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(50)
```

### Histórico de mensagens de um lead
```typescript
const { data: mensagens } = await supabase
  .from('mensagens')
  .select('*')
  .eq('lead_id', leadId)
  .order('created_at', { ascending: true })
```

### Real-time — novo lead chegou
```typescript
supabase
  .channel('leads-changes')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'leads'
  }, (payload) => {
    console.log('Novo lead:', payload.new)
    // atualizar estado local
  })
  .subscribe()
```

### Atualizar status (drag & drop Kanban)
```typescript
const { error } = await supabase
  .from('leads')
  .update({ status: novoStatus })
  .eq('id', leadId)
```

### Handoff humano
```typescript
const { error } = await supabase
  .from('leads')
  .update({ atendimento_humano: true })
  .eq('id', leadId)
```

---

## 8. RLS — ROW LEVEL SECURITY

RLS está **ativa** em todas as tabelas. O frontend com a anon key vai receber `[]` vazio se não houver políticas liberando leitura.

Antes de começar o desenvolvimento, execute no SQL Editor do Supabase:

```sql
-- Permitir leitura de todas as tabelas para usuários autenticados
-- (ajustar conforme necessário — para painel interno, pode ser mais permissivo)

CREATE POLICY "allow_read_leads" ON leads FOR SELECT USING (true);
CREATE POLICY "allow_update_leads" ON leads FOR UPDATE USING (true);
CREATE POLICY "allow_read_mensagens" ON mensagens FOR SELECT USING (true);
CREATE POLICY "allow_read_conversas" ON conversas FOR SELECT USING (true);
CREATE POLICY "allow_read_agendamentos" ON agendamentos FOR SELECT USING (true);
```

> Para produção, implementar autenticação Supabase Auth e restringir por `auth.uid()`.

---

## 9. ESTADO DO BACKEND (referência para o frontend)

| Componente | Status | Observação |
|-----------|--------|-----------|
| Webhook WhatsApp | ✅ | Evolution API v1.8.7 no Railway |
| Sofia (IA) | ✅ | Flowise + GPT-4o-mini |
| Upsert Lead | ✅ | Supabase via n8n |
| Salvar Mensagens | ✅ | Entrada e saída gravando |
| Salvar Conversas | ✅ | Pares mensagem/resposta |
| Atualizar Lead | ✅ | score, status, dor, servico, proximo_passo |
| Enviar Resposta WA | ✅ | Evolution API |
| Google Calendar | ❌ | Pendente — Sofia diz "vou verificar" mas não agenda |
| Handoff Humano | ❌ | Pendente — coluna existe, lógica no n8n não implementada |
| Follow-up D0-D14 | ❌ | Pendente — Cron no n8n |
| telefone real (@lid) | ⚠️ | iPhone → telefone vazio; Android → ok |

---

## 10. WIREFRAME DAS TELAS

```
┌─────────────────────────────────────────────────────┐
│  Oral Unic — Painel de Leads              [🔔] [👤] │
├──────────┬──────────────────────────────────────────┤
│          │  KPIs                                    │
│  Nav     │  [Leads Hoje: 12] [Quentes: 4] [Taxa: 33%]│
│          │                                          │
│  Dashboard│  Kanban                                 │
│  Leads   │  ┌────────┐ ┌────────┐ ┌────────┐       │
│  Agenda  │  │ FRIO   │ │ MORNO  │ │ QUENTE │       │
│  Config  │  │ 5 leads│ │ 3 leads│ │ 4 leads│       │
│          │  │[card]  │ │[card]  │ │[card]  │       │
│          │  │[card]  │ │[card]  │ │[card]  │       │
│          │  └────────┘ └────────┘ └────────┘       │
└──────────┴──────────────────────────────────────────┘

Card de Lead:
┌─────────────────────────┐
│ Francisco Sampaio   🔥  │
│ Implante · Score: 85    │
│ 🦷 Dor relatada         │
│ ⏰ há 2 horas            │
│ [Ver conversa]          │
└─────────────────────────┘
```

---

## 11. PRÓXIMOS PASSOS PARA O FRONTEND

1. Criar projeto Next.js + Tailwind + shadcn/ui
2. Configurar `@supabase/supabase-js` com anon key
3. Executar políticas RLS (seção 8)
4. Adicionar coluna `atendimento_humano` (seção 5, P3)
5. Implementar KPIs (P0) → Kanban (P1) → Detalhe (P2) → Handoff (P3)
6. Deploy na Vercel conectado ao repositório

---

*HANDOFF_FRONTEND.md — Oral Unic Chapadão do Sul — Abril 2026*
