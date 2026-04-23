# Guia de Configuração — Agente Sofia no Flowise

## Pré-requisitos

- Flowise online: https://flowise-production-5edd.up.railway.app
- Chave OpenAI do Francisco (OPENAI_API_KEY)
- Evolution API v1.8.2 conectada ao WhatsApp (tarefas 1 e 2)

---

## Opção A — Importar o chatflow pronto (recomendado)

1. Acesse o Flowise: https://flowise-production-5edd.up.railway.app
2. Login: `admin` / `Bms230850jr`
3. Menu lateral → **Chatflows** → botão **Import** (ícone de upload no canto superior direito)
4. Selecione o arquivo `flows/flowise-sofia.json` deste repositório
5. O chatflow "Conversation Chain — Sofia" será criado com todos os nós conectados
6. **Configurar credencial OpenAI** (passo obrigatório após import):
   - Clique no nó **ChatOpenAI**
   - Campo "Connect Credential" → **+ Add New**
   - Nome: `OpenAI Oral Unic`
   - API Key: cole a chave do Francisco
   - Salvar
7. Clique em **Save Chatflow** (ícone de disquete, canto superior direito)
8. Copie o **Chatflow ID** da URL — você vai precisar para o n8n
   - Exemplo de URL: `.../chatflows/abc123-def456-...`
   - O ID é a parte após `/chatflows/`

---

## Opção B — Criar manualmente (caso o import falhe)

### Passo 1 — Novo Chatflow

1. Flowise → **+ New Chatflow**
2. Nomeie: `Sofia — Oral Unic`

### Passo 2 — Adicionar nós

**Nó 1: ChatOpenAI**
- Barra lateral → Chat Models → arraste **ChatOpenAI** para a tela
- Credential: criar nova com a chave OpenAI do Francisco
- Model Name: `gpt-4o-mini`
- Temperature: `0.3`
- Max Tokens: `600`
- Streaming: `false`

**Nó 2: Buffer Window Memory**
- Barra lateral → Memory → arraste **Buffer Window Memory**
- Size (k): `10`
- Session Id: deixar **vazio** (o n8n injeta via `overrideConfig.sessionId`)
- Memory Key: `chat_history`

**Nó 3: Conversation Chain**
- Barra lateral → Chains → arraste **Conversation Chain**
- System Message: copie o conteúdo de `docs/system-prompt.txt`
- Conecte a saída do **ChatOpenAI** na entrada **Language Model**
- Conecte a saída do **Buffer Window Memory** na entrada **Memory**

### Passo 3 — Salvar e anotar o ID

- Salvar chatflow
- Anotar o Chatflow ID (na URL)

---

## Testar o agente antes de conectar ao n8n

Use o botão de chat embutido no Flowise (ícone de balão no canto inferior direito do chatflow).

**Teste 1 — Lead frio:**
```
Olá, vi o anúncio de vocês
```
Resposta esperada: JSON com status "frio", score < 40, proximo_passo "followup"

**Teste 2 — Lead quente:**
```
Perdi um dente há 3 meses e sinto dificuldade para mastigar.
Quero fazer um implante com urgência.
```
Resposta esperada: JSON com status "quente", score >= 70, proximo_passo "agendar"

**Teste 3 — Pergunta se é IA:**
```
Você é um robô?
```
Resposta esperada: nega ser IA, se identifica como Sofia da Oral Unic

**O que verificar na resposta:**
- É um JSON válido (sem markdown, sem ```json)
- Campos presentes: `mensagem`, `intencao`, `score`, `status`, `proximo_passo`
- `mensagem` está em português e tem no máximo 3 parágrafos
- `score` é um número entre 0 e 100

---

## Configurações de Segurança do Chatflow

Após criar e testar:

1. Flowise → seu chatflow → **Configuration** (engrenagem)
2. **Rate Limiting**: ativar, máximo 30 requests/minuto por IP
3. **API Key**: gerar uma chave de API específica para o n8n
   - Configuration → **API Access** → Create API Key
   - Nome: `n8n-production`
   - Salvar a chave — usar no n8n como `Authorization: Bearer <chave>`
4. **Allowed Origins**: adicionar a URL do n8n
   - `https://n8n-lead-production.up.railway.app`

---

## Notas sobre Memória por Lead

O `BufferWindowMemory` usa o campo `sessionId` para isolar a memória de cada lead.

O n8n deve enviar o telefone do lead como `sessionId` na chamada à API:

```json
POST /api/v1/prediction/{chatflowId}
{
  "question": "mensagem do lead",
  "overrideConfig": {
    "sessionId": "5567999887766"
  }
}
```

Isso garante que cada lead tem seu próprio histórico de conversa, e a Sofia lembra o contexto sem precisar de banco externo para isso.

---

## Custo estimado (GPT-4o-mini)

| Volume         | Tokens/mês (est.) | Custo/mês (USD) |
|----------------|-------------------|-----------------|
| 100 leads/mês  | ~500.000          | ~$0,30          |
| 500 leads/mês  | ~2.500.000        | ~$1,50          |
| 2.000 leads/mês| ~10.000.000       | ~$6,00          |

GPT-4o-mini: $0,15/1M tokens entrada + $0,60/1M tokens saída (Abril 2026).
Follow-ups de alto volume: considerar Gemini Flash conforme HANDOFF.md seção 2.
