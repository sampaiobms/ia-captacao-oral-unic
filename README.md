# Robô de sincronização — Cadastros de Pacientes (Oral Unic → CRM)

Busca o relatório "Cadastros de Pacientes" do ERP da Oral Unic
(`https://oralunicoffice.com.br/Report/CadastrosPacientes`) duas vezes ao
dia e grava os dados na tabela `pacientes_clinica` do Supabase do CRM,
através da Edge Function `sync-pacientes-robo`.

## Como funciona

1. Roda no GitHub Actions (grátis, cron 2x/dia + execução manual).
2. Faz login no ERP com usuário/senha (sem 2FA) usando Playwright (navegador
   automatizado), e fecha o popup de aviso que às vezes aparece após o login.
3. Como o ERP só permite consultar no máximo ~1 ano por vez, o robô calcula
   sozinho todas as janelas de até 1 ano desde a abertura da clínica
   (01/08/2024) até hoje, e exporta uma planilha por janela.
4. Cada planilha é lida com a mesma lógica de `src/clinico/excel.ts` do app
   (filtro de Ficha = 0, dedupe por ficha, conversão de telefone para
   E.164, etc.), já incluindo o nome da clínica de cada linha.
5. Os dados de todas as janelas são unificados (por ficha) e enviados em um
   único POST para a Edge Function `sync-pacientes-robo`, que grava no
   banco.

## Passo a passo para colocar no ar

### 1. Colocar este código no repositório do robô

Copie as pastas `.github/`, `scripts/`, `package.json` e este `README.md`
para a raiz do repositório GitHub onde o robô vai rodar (pode ser um repo
novo, só para isso, ou uma pasta dentro do repo existente — se for dentro
de um repo existente, ajuste o caminho do workflow conforme a estrutura).

### 2. Configurar os Secrets no GitHub

No repositório: **Settings → Secrets and variables → Actions → New
repository secret**. Criar estes 4 secrets:

| Secret | Valor |
|---|---|
| `ORAL_UNIC_USER` | Seu usuário de login no ERP da Oral Unic |
| `ORAL_UNIC_PASS` | Sua senha de login no ERP da Oral Unic |
| `SYNC_FUNCTION_URL` | URL pública da function `sync-pacientes-robo` (ver abaixo) |
| `ROBO_SYNC_SECRET` | O valor do secret gerado no Lovable/Supabase (ver abaixo) |

**Onde pegar `SYNC_FUNCTION_URL`**: no Lovable, abra o projeto → **More →
Database → Manage → Edge functions**, clique em `sync-pacientes-robo` e
copie a URL pública dela.

**Onde pegar `ROBO_SYNC_SECRET`**: é o mesmo valor configurado como secret
`ROBO_SYNC_SECRET` no projeto Supabase/Lovable. Ele só pode ser visto no
momento em que é gerado (depois de salvo, nem o Lovable consegue mostrar de
novo) — se você perdeu o valor, é só pedir para o Lovable gerar um novo
(isso substitui o antigo dos dois lados, então seria preciso atualizar o
GitHub Secret também).

### 3. Calibrar os seletores (passo manual, só da primeira vez)

Ninguém com acesso a este robô pôde logar no ERP real para conferir o HTML
exato das telas — por segurança, entrar com login/senha reais no sistema de
vocês é algo que só você deve fazer. Por isso os seletores em
`scripts/sync-pacientes.js` (bloco `SELECTORS` no topo do arquivo) são uma
estimativa de melhor esforço, baseada em padrões comuns desse tipo de
sistema, e **provavelmente vão precisar de ajuste**.

Para calibrar:

1. Rode o workflow manualmente (aba **Actions** do repositório → `Sync
   Cadastros Pacientes (Oral Unic)` → **Run workflow**).
2. Se falhar, o workflow salva automaticamente um "artifact" chamado
   `robo-debug-<id>` com um screenshot (`erro.png`) e o HTML da página
   (`erro.html`) no momento da falha. Baixe esse artifact.
3. Me envie o screenshot (ou abra o `erro.html` e me diga os `name`/`id`
   dos campos de usuário, senha, botão de login, campos de data e botão de
   exportar) — eu ajusto os seletores em `SELECTORS` com base nisso.
4. Repita até o robô rodar do início ao fim sem erro.

Esse ciclo de calibração costuma levar 1-3 rodadas até acertar todos os
seletores (login, popup, filtro de data, exportar).

### 4. Testar com uma rodada manual antes de confiar no cron

Depois de calibrar, rode manualmente (`workflow_dispatch`) mais uma vez e
confira:
- O log mostra quantas janelas foram exportadas e quantos pacientes únicos
  foram enviados.
- A resposta da function (impressa no log) mostra os contadores
  (recebidas/gravadas/ignoradas/semClinicaResolvida) — confira se batem
  com o que você esperava.
- Confira no Supabase (tabela `pacientes_clinica`) se os dados batem.

Só depois disso considere o cron automático (2x/dia) como confiável.

## Limitações conhecidas desta primeira versão

- **CAPTCHA/bloqueio automático**: se o ERP detectar e bloquear acessos
  automatizados, o robô vai falhar — não há tratamento para isso nesta
  versão.
- **Seletores "melhor esforço"**: como descrito acima, precisam de
  calibração manual na primeira rodada real.
- **Recalcula o histórico inteiro a cada execução**: o robô busca todas as
  janelas (não só a mais recente) em toda execução, para garantir que
  edições em cadastros antigos (ex. correção de telefone) também sejam
  capturadas. Isso deixa a rodada mais lenta conforme o histórico cresce,
  mas é a opção mais simples e confiável para uma primeira versão.
- **Sem alerta automático de falha**: se o robô falhar, isso fica visível
  na aba Actions do GitHub (e-mail de falha do GitHub, se notificações
  estiverem ligadas), mas não há alerta configurado em outro canal (ex.
  WhatsApp/Slack). Pode ser adicionado depois, se fizer sentido.
