-- ============================================================
-- SUPABASE SCHEMA — IA Captacao Oral Unic
-- Projeto: btighfgcablumcjacssz
-- Executar no SQL Editor do Supabase (em ordem)
-- ============================================================

-- ------------------------------------------------------------
-- TABELAS
-- ------------------------------------------------------------

CREATE TABLE leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome VARCHAR(200),
  telefone VARCHAR(20) UNIQUE,
  canal VARCHAR(50),           -- 'whatsapp','meta_ads','qr_code','formulario'
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
  direcao VARCHAR(10),         -- 'entrada','saida'
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
  dia_protocolo VARCHAR(10),   -- 'D0','D1','D3','D7','D14'
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

-- ------------------------------------------------------------
-- ÍNDICES
-- ------------------------------------------------------------

CREATE INDEX idx_leads_canal ON leads(canal);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created ON leads(created_at);
CREATE INDEX idx_leads_telefone ON leads(telefone);
CREATE INDEX idx_agendamentos_data ON agendamentos(data_hora);
CREATE INDEX idx_mensagens_lead ON mensagens(lead_id);
CREATE INDEX idx_followup_lead ON followup_log(lead_id);
CREATE INDEX idx_eventos_lead ON eventos_status(lead_id);

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- RLS ativo em todas as tabelas.
-- Políticas reais devem ser configuradas no Supabase Dashboard
-- conforme perfil de acesso (admin, recepcao, sistema).
-- ------------------------------------------------------------

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_diario ENABLE ROW LEVEL SECURITY;

-- Política temporária para service_role (usado pelo n8n e Flowise)
-- Substitua por políticas granulares antes do go-live
CREATE POLICY "service_role_all" ON leads FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON mensagens FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON conversas FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON agendamentos FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON eventos_status FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON followup_log FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON kpi_diario FOR ALL USING (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- FUNÇÃO: atualizar updated_at automaticamente
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
