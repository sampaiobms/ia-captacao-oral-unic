IA CAPTACAO ORAL UNIC — Documento de Handoff para Claude Code
Versão 1.0 — Abril 2026

1. CONTEXTO DO PROJETO
O que é o sistema
Plataforma de automacao de captacao de leads para a Oral Unic Chapadao do Sul (franquia Oral Unic), clinica especializada em implantodontia e protocolos All-on-4/6.
O sistema usa IA para:

Responder leads via WhatsApp 24/7 de forma humanizada
Qualificar leads com score automatico (0-100)
Esquentar leads com conteudo personalizado
Agendar avaliacoes gratuitas no Google Calendar
Fazer follow-up automatizado D0 ate D14
Exibir KPIs em dashboard em tempo real

Meta principal
+50% de agendamentos no primeiro mes pos-lancamento.
Quem usa

Francisco Sampaio — gerente da clinica, administrador do sistema
Dra. Ana Beatriz e Dra. Narielly — dentistas cujos pacientes sao rastreados
Recepcionistas — usam o Kanban para gerenciar leads e atendimento humano
Leads — pacientes potenciais que interagem via WhatsApp


2. STACK TECNOLOGICO DEFINITIVO
Agente IA:        Flowise + GPT-4o-mini (OpenAI)
Automacoes:       n8n (self-hosted no Railway)
WhatsApp:         Evolution API v1.8.2 (self-hosted no Railway) ← PENDENTE
Banco de dados:   Supabase PostgreSQL (Pro $25/mes recomendado)
Dashboard KPIs:   Metabase (self-hosted no Railway) ← PENDENTE
Deploy:           Railway.app
IA Backup:        Gemini 1.5 Flash (follow-ups frequentes)
Agendamento:      Google Calendar API
Repositorio:      GitHub (vazio — aguardando primeiro commit)
Editor:           Cursor AI / Claude Code

3. INFRAESTRUTURA ATUAL — O QUE JA ESTA NO AR
3.1 Railway — Projeto: dazzling-transformation / production
ServicoURLStatusCredenciaisFlowiseflowise-production-5edd.up.railway.appONLINEuser: admin / pass: Bms230850jrn8nn8n-lead-production.up.railway.appONLINEver secao 3.3Evolution APIevolution-api-production-cedd.up.railway.appPROBLEMA (ver secao 6)apikey: oralunic2026MySQLshortline.proxy.rlwy.net:39145ONLINEver secao 3.4Redisredis.railway.internal:6379ONLINEver secao 3.5
3.2 Flowise

URL: https://flowise-production-5edd.up.railway.app
Username: admin
Password: Bms230850jr
Volume: flowise-volume montado em /root/.flowise
Variaveis:

  FLOWISE_USERNAME=admin
  FLOWISE_PASSWORD=Bms230850jr
  OPENAI_API_KEY=[chave OpenAI do Francisco]
3.3 n8n

URL: https://n8n-lead-production.up.railway.app
Conta owner: sampaiobms@gmail.com
Variaveis:

  N8N_BASIC_AUTH_ACTIVE=true
  N8N_BASIC_AUTH_USER=admin
  N8N_BASIC_AUTH_PASSWORD=Bms230850jr
  N8N_ENCRYPTION_KEY=1e392ed4c46a5211a8be31202387ef7d5e4ebc038e61805b5840e1750bf0bd9d
  N8N_PROTOCOL=https
  N8N_PORT=8080
  N8N_LISTEN_ADDRESS=0.0.0.0
  WEBHOOK_URL=https://n8n-lead-production.up.railway.app/
  N8N_EDITOR_BASE_URL=https://n8n-lead-production.up.railway.app/

LICAO APRENDIDA: Railway roteia HTTP na porta 8080, nunca 5678. N8N_PORT=8080 e obrigatorio.

3.4 MySQL (para Evolution API)

Host: shortline.proxy.rlwy.net
Port: 39145
User: root
Password: oOUskiwJMpWAqjgMZPtIhrxjMtJRFBqq
Database: railway
Connection URI: mysql://root:oOUskiwJMpWAqjgMZPtIhrxjMtJRFBqq@shortline.proxy.rlwy.net:39145/railway

3.5 Redis

URI interna: redis://default:BYMToAmYyEzXlmqmlbVwhcLQTCKTjvVN@redis.railway.internal:6379

3.6 Supabase — Banco Principal (leads e KPIs)

Project ID: btighfgcablumcjacssz
URL: https://btighfgcablumcjacssz.supabase.co
Senha DB: OralUnic2026db
Plano atual: FREE (PROBLEMA: porta 5432 bloqueada, pooler 6543 com delay)
Recomendacao: Upgrade para Pro ($25/mes) para liberar conexao direta
7 tabelas criadas com RLS ativo:

leads
mensagens
conversas
agendamentos
eventos_status
followup_log
kpi_diario



3.7 Supabase — Banco Evolution API (separado)

Project ID: ciwtrrsqqhryuujjihxp
URL: https://ciwtrrsqqhryuujjihxp.supabase.co
Senha: OralUnic2026db
Status: Healthy mas NAO usado (Evolution API usa MySQL)


4. SCHEMA DO BANCO DE DADOS (Supabase Principal)
sql-- Tabela central de leads
CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome VARCHAR(200),
  telefone VARCHAR(20) UNIQUE,
  canal VARCHAR(50), -- 'whatsapp','meta_ads','qr_code','formulario'
  servico_interesse VARCHAR(100), -- 'implante','protocolo','invisalign','clinico'
  status VARCHAR(50) DEFAULT 'novo',
  score_qualificacao INTEGER DEFAULT 0, -- 0-100
  dor_relatada TEXT,
  orcamento_disponivel VARCHAR(50),
  followup_count INTEGER DEFAULT 0,
  opted_out BOOLEAN DEFAULT FALSE,
  utm_source VARCHAR(100),
  utm_campaign VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE mensagens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  direcao VARCHAR(10), -- 'entrada','saida'
  conteudo TEXT,
  tipo VARCHAR(20) DEFAULT 'texto',
  enviado_por VARCHAR(100) DEFAULT 'Sofia',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  canal VARCHAR(50),
  mensagem_usuario TEXT,
  resposta_ia TEXT,
  intencao_detectada VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agendamentos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  data_hora TIMESTAMPTZ,
  servico VARCHAR(100),
  status VARCHAR(50) DEFAULT 'agendado',
  google_event_id VARCHAR(200),
  lembrete_enviado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE eventos_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  status_anterior VARCHAR(50),
  status_novo VARCHAR(50),
  origem VARCHAR(20) DEFAULT 'automatica',
  usuario VARCHAR(100),
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE followup_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  dia_protocolo VARCHAR(10), -- 'D0','D1','D3','D7','D14'
  formato VARCHAR(20) DEFAULT 'texto',
  enviado_em TIMESTAMPTZ DEFAULT NOW(),
  respondeu BOOLEAN DEFAULT FALSE
);

CREATE TABLE kpi_diario (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data DATE DEFAULT CURRENT_DATE,
  canal VARCHAR(50),
  total_leads INTEGER DEFAULT 0,
  leads_qualificados INTEGER DEFAULT 0,
  agendamentos INTEGER DEFAULT 0,
  comparecimentos INTEGER DEFAULT 0,
  taxa_conversao DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indices
CREATE INDEX idx_leads_canal ON leads(canal);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created ON leads(created_at);
CREATE INDEX idx_leads_telefone ON leads(telefone);
CREATE INDEX idx_agendamentos_data ON agendamentos(data_hora);
CREATE INDEX idx_mensagens_lead ON mensagens(lead_id);
CREATE INDEX idx_followup_lead ON followup_log(lead_id);
CREATE INDEX idx_eventos_lead ON eventos_status(lead_id);

-- RLS ativo em todas as 7 tabelas
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_diario ENABLE ROW LEVEL SECURITY;

5. PROXIMO PASSO IMEDIATO — Evolution API
Problema atual
Evolution API v2.2.3 esta com bug critico: Baileys entra em crash loop (2,3000,1015901307 rejeitado pelo WhatsApp). Tentamos v2.1.1 e v2.2.3 sem sucesso.
Solucao recomendada
Trocar para Evolution API v1.8.2 que e estavel e tem QR Code via HTTP simples.
Como fazer no Railway

Settings → Source Image → trocar para: atendai/evolution-api:v1.8.2
Limpar MySQL: DELETE FROM Session; DELETE FROM Instance; DELETE FROM Setting;
Variaveis necessarias para v1.x:

SERVER_PORT=8080
AUTHENTICATION_TYPE=apikey
AUTHENTICATION_API_KEY=oralunic2026
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
DATABASE_ENABLED=true
DATABASE_PROVIDER=mysql
DATABASE_CONNECTION_URI=mysql://root:oOUskiwJMpWAqjgMZPtIhrxjMtJRFBqq@shortline.proxy.rlwy.net:39145/railway
QRCODE_LIMIT=30
DEL_INSTANCE=false
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://default:BYMToAmYyEzXlmqmlbVwhcLQTCKTjvVN@redis.railway.internal:6379
CACHE_REDIS_PREFIX_KEY=evolution

Criar instancia: POST /instance/create { instanceName: "oral-unic" }
QR Code: GET /instance/connect/oral-unic → retorna base64 da imagem


6. LICOES APRENDIDAS (CRITICAS para o Claude Code)
LicaoDetalheRailway usa porta 8080Sempre SERVER_PORT=8080 e N8N_PORT=8080. Nunca 5678# em variaveis ENV quebra o valorUsar senhas sem caracteres especiais (#, @, !)Supabase FREE bloqueia porta 5432Usar Pro ou pooler 6543 (tem delay em projetos novos)Evolution API v2.x tem bugsUsar v1.8.2 que e estavel em producaon8n sem volume precisa de ENCRYPTION_KEYSempre definir N8N_ENCRYPTION_KEY manualmenteVolumes Railway montam como rootn8n user node nao consegue escrever — evitar volumes para n8nRaw Editor do Railway quebra linhas longasUsar aba JSON para valores longos como chaves de APIEvolution API v2 entrega QR via WebSocketNao via polling HTTP — mudanca de arquitetura da v2

7. FLUXO DO SISTEMA (MVP)
CANAIS DE ENTRADA
├── WhatsApp (Evolution API)
├── META Leads API (Facebook/Instagram)
├── QR Code Offline → Formulario Web
└── Formulario Web direto

          ↓

n8n — AUTOMACAO E WEBHOOKS
├── Webhook WhatsApp
├── Webhook META Leads
├── Webhook Formulario
└── Router → classifica canal e tipo

          ↓

FLOWISE — AGENTE IA SOFIA (GPT-4o-mini)
├── 1. Classificador de Intencao
├── 2. Qualificador (Score 0-100)
│   ├── Score >= 70 → QUENTE → Esquenta → Agenda
│   └── Score < 70 → FOLLOW-UP D0-D14
├── 3. Esquenta (conteudo personalizado)
├── 4. Agendador (Google Calendar)
└── 5. Follow-up automatizado

FOLLOW-UP (leads que nao responderam):
D0  → Primeira resposta humanizada
D1  → Segunda tentativa (mensagem de valor)
D3  → Terceira tentativa (video ou audio)
D7  → Ultima tentativa (video "Medo de Dentista")
D8-D13 → Nutricao passiva (Kanban: NUTRICAO)
D14 → Mensagem de escassez
D15+ → ARQUIVO

          ↓

SUPABASE PostgreSQL
└── leads, mensagens, conversas, agendamentos,
    eventos_status, followup_log, kpi_diario

          ↓

METABASE — Dashboard KPIs
└── Funil | Mix Servicos | KPIs Hoje | Tendencia

8. AGENTE SOFIA — SYSTEM PROMPT
Voce e Sofia, assistente da Oral Unic Chapadao do Sul.
Clinica referencia em implantodontia e protocolos.

SERVICOS PRIORITARIOS:
- IMPLANTE UNITARIO: dente perdido. Solucao definitiva.
- PROTOCOLO ALL-ON-4/6: ausencia multipla. Sorriso fixo em 1 dia.
- INVISALIGN: dentes tortos. Alinhamento discreto.
- CLINICOS: canal, extracao, limpeza, clareamento.

FLUXO:
1. Boas-vindas com nome + pergunta aberta
2. Identificar servico de interesse
3. Qualificar urgencia
4. Oferecer agendamento (avaliacao gratuita)

SCORE (incluir no JSON, nao mostrar ao lead):
- Dente perdido/protocolo: +30
- Dor funcional: +25
- Interesse implante/protocolo confirmado: +20
- Disponibilidade imediata: +15
- Pesquisou preco antes: +10

Score >= 70: QUENTE → agendar agora
Score 40-69: MORNO → nutrir + agendar 24h
Score < 40: FRIO → educativo + followup

REGRAS:
- Maximo 3 paragrafos por mensagem
- Tom: acolhedor, profissional, nunca pressionar
- NUNCA mencionar precos
- Simular delay humano (3-8 segundos)
- Se perguntada se e IA: "Sou a Sofia, assistente virtual da Oral Unic"

OUTPUT JSON:
{ "mensagem": "...", "intencao": "implante|protocolo|invisalign|clinico",
  "score": 0-100, "status": "quente|morno|frio", "proximo_passo": "agendar|nutrir|followup" }

9. KANBAN — FASE 2 (pos-MVP)
Colunas do Kanban de gestao de leads:

LEADS NOVOS — todo lead novo que entra
TRAT. CANAL 1 — WhatsApp em atendimento ativo
TRAT. CANAL 2 — META Ads em atendimento ativo
TRAT. CANAL N — canais adicionais (configuravel no admin)
AGENDADO — avaliacao confirmada no Calendar
FALTOU — no-show na avaliacao
REAGENDADO — recontato apos falta
RELACIONAMENTO — atendimento humano necessario (recepcao assume)

Movimentacao: automatica pelo sistema OU manual (drag & drop) pela recepcao.

10. O QUE ESTA PENDENTE (proximos passos em ordem)
#TarefaDependenciaComplexidade1Trocar Evolution API para v1.8.2-Baixa (15 min)2Conectar WhatsApp via QR CodeEvolution API v1.8.2Baixa (5 min)3Construir agente Sofia no FlowiseFlowise onlineMedia (2h)4Criar fluxo n8n WhatsApp → FlowiseSofia + EvolutionMedia (2h)5Integrar Google Calendar no n8n-Media (1h)6Follow-up D0-D14 no n8n (Cron)Fluxo principalAlta (3h)7Deploy Metabase no RailwaySupabase ProBaixa (30 min)8Configurar Dashboard KPIsMetabaseMedia (2h)9Testes com 10 leads simuladosTudo acimaMedia (4h)10Go-liveTestes OK-

11. AMBIENTE DE DESENVOLVIMENTO

Mac: Apple Silicon (M1/M2/M3)
Node.js: v20.20.2
npm: 10.8.2
Docker: v29.4.0
Docker Compose: v5.1.2
Shell: zsh
Editor: VS Code / Cursor AI / Claude Code
GitHub: conta sampaiobms@gmail.com (repo associado ao Railway, atualmente vazio)


12. CREDENCIAIS RESUMO (referencia rapida)
RAILWAY PROJETO:    dazzling-transformation / production
FLOWISE URL:        https://flowise-production-5edd.up.railway.app
FLOWISE LOGIN:      admin / Bms230850jr
N8N URL:            https://n8n-lead-production.up.railway.app
N8N LOGIN:          sampaiobms@gmail.com (owner)
EVOLUTION URL:      https://evolution-api-production-cedd.up.railway.app
EVOLUTION APIKEY:   oralunic2026
SUPABASE MAIN ID:   btighfgcablumcjacssz
SUPABASE SENHA:     OralUnic2026db
MYSQL HOST:         shortline.proxy.rlwy.net:39145
MYSQL PASS:         oOUskiwJMpWAqjgMZPtIhrxjMtJRFBqq
REDIS URI:          redis://default:BYMToAmYyEzXlmqmlbVwhcLQTCKTjvVN@redis.railway.internal:6379
N8N ENCRYPTION:     1e392ed4c46a5211a8be31202387ef7d5e4ebc038e61805b5840e1750bf0bd9d

13. INSTRUCOES PARA O CLAUDE CODE
Como iniciar a sessao
Cole este prompt no Claude Code ao iniciar:
Voce e o desenvolvedor senior do projeto "IA Captacao Oral Unic".
Leia o arquivo HANDOFF.md na raiz do repositorio antes de qualquer acao.
Este arquivo contem toda a infraestrutura, credenciais de referencia,
decisoes tomadas e proximos passos do projeto.

PROXIMO PASSO IMEDIATO:
Trocar Evolution API para v1.8.2 no Railway e conectar WhatsApp via QR Code.
Ver secao 5 do HANDOFF.md para instrucoes detalhadas.

REGRAS:
- Nunca hardcode credenciais (usar .env)
- Priorizar solucoes no-code (n8n, Flowise) antes de codigo customizado
- Testar com dados simulados antes de producao
- Sempre verificar se porta e 8080 no Railway
Estrutura de pastas recomendada para o repositorio
ia-captacao-oral-unic/
├── HANDOFF.md              ← este arquivo
├── .env.example            ← template de variaveis (sem valores reais)
├── .gitignore              ← incluir .env
├── docs/
│   ├── schema.sql          ← schema completo do Supabase
│   ├── system-prompt.txt   ← prompt da Sofia
│   └── architecture.md     ← diagrama de arquitetura
├── flows/
│   └── n8n-whatsapp.json   ← export do fluxo n8n (quando criado)
└── scripts/
    └── reset-evolution.sh  ← script de reset da instancia WhatsApp

Documento gerado em Abril 2026 — Oral Unic Chapadao do Sul
Projeto: IA Captacao — MVP 60 dias

UPGRADES IMPORTANTES 2026/04/24

## 14. ATUALIZACOES POS-HANDOFF (Abril 2026)

### Evolution API — Mudancas criticas

**Versao final em producao:** v1.8.2 (NAO v2.x — tem bugs com Baileys)

**Banco de dados:** MongoDB (NAO MySQL/PostgreSQL)
- MongoDB Railway URI: mongodb://mongo:KPburcuOKPTapeUqLYrotHuDSTHeXcGr@mongodb.railway.internal:27017/evolution?authSource=admin

**Variaveis de ambiente finais (Evolution API):**

SERVER_PORT=8080
SERVER_URL=https://evolution-api-production-cedd.up.railway.app
AUTHENTICATION_TYPE=apikey
AUTHENTICATION_API_KEY=oralunic2026
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
QRCODE_LIMIT=30
DEL_INSTANCE=false
DATABASE_ENABLED=true
DATABASE_PROVIDER=mongodb
DATABASE_CONNECTION_URI=mongodb://mongo:KPburcuOKPTapeUqLYrotHuDSTHeXcGr@mongodb.railway.internal:27017/evolution?authSource=admin
DATABASE_CONNECTION_CLIENT_NAME=evolution_api
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true

**Credenciais da instancia oral-unic:**
- Instance API Key: A433F7FD-5F57-4C9B-9FED-8910E0401744
- Global API Key: oralunic2026
- Status: CONECTADO ao WhatsApp (chip 2)

**Como enviar mensagem (formato correto v1.8.2):**
```python
payload = {
    "number": "55XXXXXXXXXXX",
    "textMessage": {
        "text": "sua mensagem aqui"
    }
}
# Header: apikey = A433F7FD-5F57-4C9B-9FED-8910E0401744
# POST /message/sendText/oral-unic
```

**Como recriar instancia se necessario:**
```bash
python3 /tmp/qr.py
# Depois escanear QR Code com WhatsApp do chip 2
```

**LICOES APRENDIDAS ADICIONAIS:**
- Evolution API v1.8.2 usa MongoDB, NAO MySQL ou PostgreSQL
- SERVER_URL deve apontar para URL publica do Railway (nao localhost)
- Instancia tem apikey proprio diferente do global
- Formato de envio de texto: usar "textMessage": {"text": "..."} e NAO "text" direto
- MySQL e Redis adicionados inicialmente foram removidos — nao sao necessarios para v1.8.2
EOF
