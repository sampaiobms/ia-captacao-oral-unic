// Robô de sincronização do cadastro de pacientes do ERP Oral Unic -> Supabase.
// Roda via GitHub Actions (ver .github/workflows/sync-pacientes.yml), 2x ao dia.
//
// IMPORTANTE (leia o README.md antes de rodar pela primeira vez):
// Os seletores em SELECTORS abaixo são uma estimativa de "melhor esforço" --
// ninguém com acesso a este robô pôde logar no ERP real para conferir o HTML
// exato da tela de login, dos filtros de data e do botão de exportar. É
// bem provável que seja preciso ajustar esses seletores depois da primeira
// rodada real (manual, via workflow_dispatch) e de olhar o erro/screenshot
// salvo como artifact do GitHub Actions.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { parseCadastroPacientes } = require('./parse-cadastro');

// ========= CONFIG — AJUSTE CONFORME O HTML REAL DO ERP =========
const ERP_BASE_URL = 'https://oralunicoffice.com.br';
const LOGIN_URL = ERP_BASE_URL + '/'; // TODO: confirmar a URL exata da tela de login
const REPORT_URL = ERP_BASE_URL + '/Report/CadastrosPacientes';

// Dia de abertura da clínica = início da série histórica a buscar.
const CLINIC_OPENING_DATE = '2024-08-01';

const SELECTORS = {
  // Tela de login
  loginUser: 'input[name="usuario"], input#usuario, input[type="text"]',
  loginPass: 'input[name="senha"], input#senha, input[type="password"]',
  loginSubmit: 'button[type="submit"], input[type="submit"]',

  // Popup que às vezes aparece logo após logar (aviso/mensagem) — tenta
  // vários seletores comuns, em ordem, e segue em frente se não achar nenhum.
  popupCloseCandidates: [
    'button:has-text("Fechar")',
    'button:has-text("OK")',
    'button:has-text("Entendi")',
    'button:has-text("Não mostrar")',
    '[aria-label="Close"]',
    '.modal.show .btn-close',
    '.modal.show button.close',
    '.modal.in .close',
  ],

  // Filtro de datas do relatório (confirmado no HTML real em 15/11/2026)
  dateStart: '#dateBegin',
  dateEnd: '#dateEnd',

  // Botão que roda a pesquisa com os filtros preenchidos (confirmado:
  // <button class="btn large primary" onclick="return pesquisarTela(this)">Pesquisar</button>)
  searchButton: 'button[onclick*="pesquisarTela"], button:has-text("Pesquisar")',

  // Botão de exportar o relatório (gera o download do xlsx) — AINDA É UM CHUTE:
  // não apareceu na tela inicial (só os campos de filtro + "Pesquisar"), então
  // deve surgir junto com a tabela de resultados, depois de pesquisar. Se esse
  // seletor não achar nada, o erro.html da próxima rodada mostra o botão real.
  exportButton: '[onclick*="xportar" i], button:has-text("Exportar"), a:has-text("Exportar"), [title*="xportar" i]',
};
// =================================================================

function pad(n) {
  return String(n).padStart(2, '0');
}

function toBr(d) {
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

/**
 * Gera as janelas de até 1 ano (limite do ERP), alinhadas ao aniversário da
 * data de abertura da clínica, cobrindo de CLINIC_OPENING_DATE até hoje.
 * Ex.: 01/08/2024–31/07/2025, 01/08/2025–31/07/2026, 01/08/2026–hoje.
 * Cresce em 1 janela a cada aniversário, sem precisar editar nada.
 */
function computeWindows() {
  const start = new Date(CLINIC_OPENING_DATE + 'T00:00:00');
  const today = new Date();
  const windows = [];
  let winStart = new Date(start);
  while (winStart <= today) {
    const winEnd = new Date(winStart);
    winEnd.setFullYear(winEnd.getFullYear() + 1);
    winEnd.setDate(winEnd.getDate() - 1);
    const cappedEnd = winEnd > today ? new Date(today) : winEnd;
    windows.push({ start: new Date(winStart), end: cappedEnd });
    winStart = new Date(cappedEnd);
    winStart.setDate(winStart.getDate() + 1);
  }
  return windows;
}

async function dismissPopupIfAny(page) {
  for (const sel of SELECTORS.popupCloseCandidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click({ timeout: 1500 });
        console.log('Popup fechado com selector: ' + sel);
        await page.waitForTimeout(500);
      }
    } catch (e) {
      // selector não encontrado ou não clicável nesse momento — tenta o próximo
    }
  }
}

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  await page.fill(SELECTORS.loginUser, process.env.ORAL_UNIC_USER);
  await page.fill(SELECTORS.loginPass, process.env.ORAL_UNIC_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click(SELECTORS.loginSubmit),
  ]);
  await page.waitForTimeout(1500);
  await dismissPopupIfAny(page);
}
async function setDateField(page, selector, text) {
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('Campo de data não encontrado: ' + sel);
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    },
    { sel: selector, val: text }
  );
}

async function exportWindow(page, win, downloadDir) {
  await page.goto(REPORT_URL, { waitUntil: 'networkidle' });
  await dismissPopupIfAny(page);

  // Escreve a data direto no campo (sem clicar nele), para o calendário
  // visual nunca abrir e atrapalhar.
  await setDateField(page, SELECTORS.dateStart, toBr(win.start));
  await setDateField(page, SELECTORS.dateEnd, toBr(win.end));

  // Roda a pesquisa primeiro — o botão de exportar só deve aparecer junto
  // com a tabela de resultados.
  await page.click(SELECTORS.searchButton);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500); // dá tempo da tabela de resultados renderizar

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click(SELECTORS.exportButton),
  ]);

  const fileName =
    'cadastro_' +
    win.start.toISOString().slice(0, 10) +
    '_' +
    win.end.toISOString().slice(0, 10) +
    '.xlsx';
  const filePath = path.join(downloadDir, fileName);
  await download.saveAs(filePath);
  console.log('Exportado: ' + fileName);
  return filePath;
}

async function main() {
  const required = ['ORAL_UNIC_USER', 'ORAL_UNIC_PASS', 'SYNC_FUNCTION_URL', 'ROBO_SYNC_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error('Variáveis de ambiente faltando: ' + missing.join(', '));
  }

  const downloadDir = path.join(__dirname, '..', 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await login(page);

    const windows = computeWindows();
    console.log('Janelas a exportar: ' + windows.length);

    const porFicha = new Map();
    let totalIgnorados = 0;

    for (const win of windows) {
      const filePath = await exportWindow(page, win, downloadDir);
      const buffer = fs.readFileSync(filePath);
      const { validos, ignorados } = parseCadastroPacientes(buffer);
      totalIgnorados += ignorados;
      for (const row of validos) {
        // Janela mais recente processada por último vence em caso de
        // ficha repetida entre janelas (normalmente não deveria acontecer,
        // já que as janelas não se sobrepõem, mas é uma salvaguarda).
        porFicha.set(row.ficha, row);
      }
    }

    const rows = [...porFicha.values()];
    console.log(
      'Total de pacientes únicos: ' + rows.length + ' (ignorados ao longo das janelas: ' + totalIgnorados + ')'
    );

    const res = await fetch(process.env.SYNC_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Robo-Secret': process.env.ROBO_SYNC_SECRET,
      },
      body: JSON.stringify({ rows }),
    });

    const text = await res.text();
    console.log('Resposta da function (status ' + res.status + '): ' + text);

    if (!res.ok) {
      throw new Error('Function retornou status ' + res.status);
    }
  } catch (err) {
    try {
      await page.screenshot({ path: path.join(downloadDir, 'erro.png'), fullPage: true });
      fs.writeFileSync(path.join(downloadDir, 'erro.html'), await page.content());
      console.log('Screenshot e HTML da página salvos em downloads/ para diagnóstico.');
    } catch (e2) {
      console.log('Não foi possível salvar screenshot/HTML de diagnóstico: ' + e2.message);
    }
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Falha na sincronização:', err);
  process.exit(1);
});
