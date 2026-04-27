# HANDOFF3 — Resolução do Problema @lid
## Sessão 3 — Abril 2026

---

## 1. PROBLEMA E CAUSA RAIZ

O campo `remoteJid` que chega no webhook retorna um ID interno do WhatsApp (`66735705198620@lid`), não o número real do lead. A Evolution API v1.8.2 recusa envios para esse formato.

**Causa raiz:** O `@lid` é um identificador interno do protocolo Baileys. A Evolution API salva os contatos reais no MongoDB com o campo `id` no formato `5511968404390@s.whatsapp.net`. Para encontrar o número real, precisamos buscar o contato pelo `pushName` (nome exibido no WhatsApp).

**Confirmação do diagnóstico (já testado):**
- Enviar para `@lid` → erro: `{"exists": false}`
- Enviar com número hardcoded → funciona perfeitamente

---

## 2. SOLUÇÃO — ADICIONAR 1 NÓ NO FLUXO N8N

### Fluxo antes (com problema)
```
... → Normalizar Dados → Extrair Número Real → Upsert Lead → ...
```

### Fluxo depois (corrigido)
```
... → Normalizar Dados → [NOVO] Buscar Contato Real → Extrair Número Real → Upsert Lead → ...
```

O novo nó faz um `POST /chat/findContacts/oral-unic` passando o `pushName` do lead e recupera o número real no campo `id`.

---

## 3. PASSO A PASSO NO N8N

### PASSO 1 — Inserir nó "Buscar Contato Real" entre "Normalizar Dados" e "Extrair Número Real"

1. No canvas do n8n, clique no **fio** que liga "Normalizar Dados" ao "Extrair Número Real"
2. Clique no **"+"** que aparece no meio do fio
3. Selecione **HTTP Request**
4. Renomeie o nó para: **`Buscar Contato Real`**

**Configuração do nó:**

| Campo | Valor |
|-------|-------|
| Method | `POST` |
| URL | `https://evolution-api-production-cedd.up.railway.app/chat/findContacts/oral-unic` |
| Authentication | None |

**Headers** (clicar em "Add Header" para cada um):

| Name | Value |
|------|-------|
| `apikey` | `A433F7FD-5F57-4C9B-9FED-8910E0401744` |
| `Content-Type` | `application/json` |

**Body:**
- Body Content Type: **JSON**
- Clicar no ícone de expressão (`{}` ou botão "Expression") e colar:

```
={{ JSON.stringify({ "where": { "pushName": $('Normalizar Dados').item.json.nome } }) }}
```

> **Alternativa se o campo Body aceitar JSON direto (modo "Specify Body"):**
> Ativar "Specify Body → Using JSON" e colar:
> ```json
> {
>   "where": {
>     "pushName": "={{ $('Normalizar Dados').item.json.nome }}"
>   }
> }
> ```

---

### PASSO 2 — Atualizar nó "Extrair Número Real"

Abrir o nó "Extrair Número Real" (Code node) e **substituir todo o código** pelo seguinte:

```javascript
// Pega resultado do findContacts da Evolution API (retorna array)
const responseData = $('Buscar Contato Real').item.json;

// API pode retornar array ou objeto — normaliza para array
const contactList = Array.isArray(responseData) ? responseData : [responseData];
const contact = contactList[0];

let numeroReal = '';

if (contact && contact.id && contact.id.includes('@s.whatsapp.net')) {
  // Extrai apenas o número: "5511968404390@s.whatsapp.net" → "5511968404390"
  numeroReal = contact.id.replace('@s.whatsapp.net', '');
}

// Debug: se não encontrou, loga para análise
if (!numeroReal) {
  console.log('AVISO: Contato não encontrado para pushName:', $('Normalizar Dados').item.json.nome);
  console.log('Resposta da API:', JSON.stringify(responseData));
}

// Herda todos os dados de Normalizar Dados e acrescenta o número real
const dadosAnteriores = $('Normalizar Dados').item.json;

return [{
  json: {
    ...dadosAnteriores,
    numeroReal: numeroReal,
    telefone: numeroReal
  }
}];
```

---

### PASSO 3 — Verificar nó "Upsert Lead"

No nó "Upsert Lead", o campo **telefone** deve referenciar o número resolvido:

```
={{ $('Extrair Número Real').item.json.telefone }}
```

> Se já estava apontando para `$('Normalizar Dados')`, apenas troque para `$('Extrair Número Real')`.

---

### PASSO 4 — Verificar nó "Enviar Mensagem WA"

No nó "Enviar Mensagem WA", o body deve ser:

```json
{
  "number": "={{ $('Extrair Número Real').item.json.numeroReal }}",
  "textMessage": {
    "text": "={{ $('Parsear Resposta Sofia').item.json.mensagem }}"
  }
}
```

**URL:** `POST https://evolution-api-production-cedd.up.railway.app/message/sendText/oral-unic`  
**Header:** `apikey: A433F7FD-5F57-4C9B-9FED-8910E0401744`

---

## 4. DIAGRAMA COMPLETO DO FLUXO ATUALIZADO

```
Webhook WhatsApp (POST)
  ↓
Filtrar Mensagens
  ├── false → (ignora: fromMe=true ou event != messages.upsert)
  └── true ↓
Normalizar Dados
  Extrai: remoteJid, nome (pushName), mensagem, source
  ↓
[NOVO] Buscar Contato Real
  POST /chat/findContacts/oral-unic
  Body: { "where": { "pushName": "<nome do lead>" } }
  Retorna: [{ "id": "5511968404390@s.whatsapp.net", "pushName": "...", ... }]
  ↓
Extrair Número Real
  Remove @s.whatsapp.net do id
  Saída: { ...dadosAnteriores, numeroReal: "5511968404390", telefone: "5511968404390" }
  ↓
Upsert Lead (Supabase REST API)
  telefone = numeroReal
  Header: Prefer: resolution=merge-duplicates,return=representation
  ↓
Chamar Sofia (Flowise)
  chatflowId: 5814b9c2-c9a8-4273-a3e1-bacf91bb91ff
  ↓
Parsear Resposta Sofia
  Extrai campo "mensagem" do JSON retornado
  ↓ (dois ramos em paralelo)
  ├── Salvar Conversa (Supabase)
  │     Header: Prefer: return=representation
  └── Enviar Mensagem WA (Evolution API)
        POST /message/sendText/oral-unic
        number = numeroReal
        textMessage.text = mensagem da Sofia
```

---

## 5. TESTE DO ENDPOINT (ANTES DE TESTAR NO N8N)

Substitua `SEU_NOME` pelo nome exibido no WhatsApp do lead de teste:

```bash
curl -s -X POST \
  "https://evolution-api-production-cedd.up.railway.app/chat/findContacts/oral-unic" \
  -H "Content-Type: application/json" \
  -H "apikey: A433F7FD-5F57-4C9B-9FED-8910E0401744" \
  -d '{"where": {"pushName": "SEU_NOME"}}'
```

**Resposta esperada (sucesso):**
```json
[{
  "_id": "69eb6c9ed66d64e7b5047cbc",
  "pushName": "SEU_NOME",
  "id": "5511968404390@s.whatsapp.net",
  "owner": "oral-unic"
}]
```

Se o array vier vazio `[]`, o contato ainda não foi salvo no MongoDB da Evolution API — envie uma mensagem do número de teste primeiro para registrar o contato.

---

## 6. BUSCAR TODOS OS CONTATOS SALVOS (para verificar)

```bash
curl -s -X POST \
  "https://evolution-api-production-cedd.up.railway.app/chat/findContacts/oral-unic" \
  -H "Content-Type: application/json" \
  -H "apikey: A433F7FD-5F57-4C9B-9FED-8910E0401744" \
  -d '{"where": {}}'
```

Lista todos os contatos salvos. Confirme que o número do lead de teste aparece com `id` no formato `55XXXXXXXXXXX@s.whatsapp.net`.

---

## 7. TRATAMENTO DE EDGE CASES

### E se o findContacts retornar array vazio?
O nó "Extrair Número Real" retornará `numeroReal: ""`. O nó "Enviar Mensagem WA" falhará com erro da Evolution API. Isso é aceitável para MVP — quando o contato não está no MongoDB, significa que a Evolution API ainda não recebeu mensagem desse número.

**Solução futura:** Adicionar nó "IF" após "Extrair Número Real" para tratar o caso `numeroReal == ""` e registrar o lead como "pendente" no Supabase.

### E se dois leads tiverem o mesmo pushName?
O `findContacts` retornará múltiplos resultados e o código pega o primeiro (`contactList[0]`). Para MVP isso é aceitável. Se for um problema real, implementar lookup por `remoteJid` diretamente no MongoDB.

### E se o pushName vier vazio no webhook?
O `findContacts` com `pushName: ""` pode retornar todos os contatos ou nenhum. Adicionar validação no "Normalizar Dados" para garantir que `nome` nunca seja vazio.

---

## 8. POR QUE ESTA SOLUÇÃO FUNCIONA

A Evolution API v1.8.2 salva automaticamente todos os contatos que interagem com a instância no MongoDB, na collection `Contact`. Cada documento tem:
- `id`: número real no formato `55XXXXXXXXXXX@s.whatsapp.net`
- `pushName`: nome exibido no WhatsApp do contato
- `owner`: nome da instância (`oral-unic`)

Quando chega um `@lid` no webhook, o contato JÁ ESTÁ salvo no MongoDB (a mensagem foi recebida, afinal). Só precisamos buscá-lo pelo `pushName` para recuperar o `id` com o número real.

---

## 9. PRÓXIMOS PASSOS APÓS RESOLVER O @lid

1. ✅ Implementar busca de número real via findContacts (este documento)
2. Testar fluxo completo com Android (número real retornado pelo findContacts)
3. Verificar se iPhone funciona com a mesma solução
4. Reconectar e corrigir nó "Atualizar Lead" se necessário
5. Configurar follow-up D0-D14 com Cron no n8n
6. Deploy Metabase para dashboard KPIs
7. Testes com 10 leads simulados
8. Go-live

---

*HANDOFF3.md — Oral Unic Chapadão do Sul — Abril 2026*
