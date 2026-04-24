# Arquitetura — IA Captação Oral Unic

## Visão Geral

```
CANAIS DE ENTRADA
├── WhatsApp         (Evolution API v1.8.2)
├── META Leads API   (Facebook / Instagram Ads)
├── QR Code Offline  → Formulário Web
└── Formulário Web   direto

        │  webhooks
        ▼

┌─────────────────────────────────────────────┐
│              n8n  (Railway)                 │
│  ┌──────────────────────────────────────┐   │
│  │  Router — classifica canal e tipo    │   │
│  └──────────────┬───────────────────────┘   │
│                 │                           │
│    ┌────────────┼─────────────┐             │
│    ▼            ▼             ▼             │
│  WA Hook   META Hook   Form Hook            │
└────────────────┬────────────────────────────┘
                 │  HTTP POST
                 ▼

┌─────────────────────────────────────────────┐
│        Flowise  (Railway)                   │
│        Agente Sofia — GPT-4o-mini           │
│                                             │
│  1. Classificador de Intenção               │
│  2. Qualificador (Score 0-100)              │
│     ├── Score >= 70 → QUENTE                │
│     │     └── Esquenta → Agenda             │
│     └── Score  < 70 → MORNO/FRIO           │
│           └── Follow-up D0-D14             │
│  3. Esquentador (conteúdo personalizado)    │
│  4. Agendador  (Google Calendar API)        │
│  5. Escalador  (recepcão humana)            │
└────────────────┬────────────────────────────┘
                 │  SQL / REST
                 ▼

┌─────────────────────────────────────────────┐
│         Supabase PostgreSQL                 │
│  leads · mensagens · conversas              │
│  agendamentos · eventos_status              │
│  followup_log · kpi_diario                  │
└────────────────┬────────────────────────────┘
                 │  SQL
                 ▼

┌─────────────────────────────────────────────┐
│         Metabase  (Railway)  [PENDENTE]     │
│  Dashboard KPIs:                            │
│  Funil · Mix Serviços · KPIs Hoje           │
│  Tendência · Taxa Conversão                 │
└─────────────────────────────────────────────┘
```

## Protocolo de Follow-up (D0–D14)

| Dia    | Ação                                    | Canal  |
|--------|-----------------------------------------|--------|
| D0     | Primeira resposta humanizada (Sofia)    | WA     |
| D1     | Segunda tentativa — mensagem de valor   | WA     |
| D3     | Terceira tentativa — vídeo ou áudio     | WA     |
| D7     | Última tentativa — vídeo "Medo Dentista"| WA     |
| D8–D13 | Nutrição passiva → Kanban: NUTRIÇÃO     | WA     |
| D14    | Mensagem de escassez                    | WA     |
| D15+   | Arquivado                               | —      |

## Kanban de Leads (Fase 2 — pós-MVP)

| Coluna         | Gatilho                                    |
|----------------|--------------------------------------------|
| LEADS NOVOS    | Qualquer lead novo                         |
| TRAT. CANAL 1  | WhatsApp em atendimento ativo              |
| TRAT. CANAL 2  | META Ads em atendimento ativo              |
| AGENDADO       | Avaliação confirmada no Calendar           |
| FALTOU         | No-show na avaliação                       |
| REAGENDADO     | Recontato após falta                       |
| RELACIONAMENTO | Escalado para atendimento humano           |

## Infraestrutura Railway

| Serviço       | URL                                              | Porta | Status       |
|---------------|--------------------------------------------------|-------|--------------|
| Flowise       | flowise-production-5edd.up.railway.app           | 8080  | ✅ Online    |
| n8n           | n8n-lead-production.up.railway.app               | 8080  | ✅ Online    |
| Evolution API | evolution-api-production-cedd.up.railway.app     | 8080  | ✅ Conectado |
| MongoDB       | mongodb.railway.internal:27017 (interno)         | 27017 | ✅ Online    |
| Metabase      | (pendente deploy)                                | 8080  | ⏳ Pendente  |

> **Regra Railway**: toda aplicação deve escutar na porta **8080**.
> Nunca usar 5678 (n8n default) ou 3000.
>
> MySQL e Redis foram removidos — não são necessários para a v1.8.2 com MongoDB.

## Chaves da Evolution API

| Chave              | Valor                                  | Uso                              |
|--------------------|----------------------------------------|----------------------------------|
| Global API Key     | `oralunic2026`                         | Criar instâncias, configurar webhook |
| Instance Key (oral-unic) | `A433F7FD-5F57-4C9B-9FED-8910E0401744` | **Enviar mensagens** via n8n |

A instance key é diferente da global — usar a instance key no n8n para envio de mensagens.

## Decisões Técnicas

| Decisão                      | Motivo                                               |
|------------------------------|------------------------------------------------------|
| Evolution API v1.8.2         | v2.x tem bug crítico no Baileys (crash loop)         |
| MongoDB para Evolution API   | MySQL não funciona com v1.8.2; MongoDB é nativo      |
| Supabase Pro recomendado     | FREE bloqueia porta 5432; pooler 6543 tem delay      |
| Gemini Flash para follow-up  | Custo menor em mensagens de alto volume              |
| No-code primeiro             | n8n e Flowise reduzem tempo de entrega e manutenção  |
| Senhas sem # @ !             | Railway quebra variáveis ENV com esses caracteres     |
| SERVER_URL obrigatório       | Deve apontar para URL pública Railway, não localhost  |
