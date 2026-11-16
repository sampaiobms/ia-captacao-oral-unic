// Robô de importação diária de Cobrança (Boletos Abertos + Boletos Pagos) do
// ERP Oral Unic -> Supabase. Roda via GitHub Actions (ver
// .github/workflows/sync-cobranca.yml), 1x por dia, seg-sex.
//
// IMPORTANTE (leia o README.md antes de rodar pela primeira vez):
// As telas de Faturamento/BoletosAbertos e Faturamento/BoletosPagos são
// diferentes da tela de Cadastros de Pacientes já calibrada no robô irmão
// (scripts/sync-pacientes.js), mas aparentam usar o mesmo framework de
// relatório do ERP (mesmos ids/classes: #dateBegin/#dateEnd, botão de
// exportar via DataTables, popups SweetAlert2). Por isso os SELECTORS abaixo
// reaproveitam, como ponto de partida de "melhor esforço", os mesmos
// seletores já confirmados no robô de pacientes — mas é bem provável que
// precisem de 1-2 rodadas de calibração aqui também. Mesmo processo: rode
// manualmente (workflow_dispatch), se falhar baixe o artifact de erro
// (erro.png/erro.html) e me envie.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { parseBoletosAbertos, parseBoletosPagos } = require('./parse-cobranca');

// ========= CONFIG — AJUSTE CONFORME O HTML REAL DO ERP =========
const ERP_BASE_URL = 'https://oralunicoffice.com.br';
const LOGIN_URL = ERP_BASE_URL + '/';
const BOLETOS_ABERTOS_URL = ERP_BASE_URL + '/Faturamento/BoletosAbertos';
const BOLETOS_PAGOS_URL = ERP_BASE_URL + '/Faturamento/BoletosPagos';

// Só Chapadão do Sul está em operação (mesmo escopo do robô de pacientes).
// O filtro de clínica do ERP (se existir nesta tela) é tentado como reforço,
// mas quem de fato garante o escopo é o filtro por linha em parse-cobranca.js
// (campo "Clínica" de cada boleto, já que o export pode trazer outras
// clínicas misturadas).
const TARGET_OFFICE_VALUE = '392'; // Chapadao do Sul

const SELECTORS = {
  // Reaproveitados do robô de pacientes (mesmo framework de login/relatório) —
  // ver aviso no topo do arquivo.
  loginUser: 'input[name="usuario"], input#usuario, input[type="text"]',
  loginPass: 'input[name="senha"], input#senha, input[type="password"]',
  loginSubmit: 'button[type="submit"], input[type="submit"]',
  popupCloseCandidates: [
    'button:has-text("Fechar")',
    'button:has-text("OK")',
    'button:has-text("Entendi")',
    'button:has-text("Não mostrar")',
    '.swal2-confirm',
    '.swal2-close',
    '[aria-label="Close"]',
    '.modal.show .btn-close',
    '.modal.show button.close',
    '.modal.in .close',
  ],
  officeSelect: '#idOffice', // pode não existir nesta tela — tentado com try/catch
  dateStart: '#dateBegin',
  dateEnd: '#dateEnd',
  searchButton: 'button[onclick*="pesquisarTela"], button:has-text("Pesquisar")',
  exportMenuButton: '.dropdown-dataTables .dropdown-btn',
  exportButton: 'button.buttons-excel, button:has-text("Exportar Excel")',
};
// =================================================================

function pad(n) {
  return String(n).padStart(2, '0');
}

function toBr(d) {
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

function addMonths(d, months) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

/**
 * Fatia [start, end] em janelas de até maxMonths meses cada (última janela
 * fecha exatamente em `end`). Usado porque não sabemos ainda (sem calibrar)
 * se estas telas de Faturamento aceitam mais de 1 ano por consulta como a de
 * Cadastros de Pacientes aceita — fatiar em janelas de 12 meses é o reforço
 * seguro independente do limite real do ERP.
 */
function chunkWindows(start, end, maxMonths) {
  const windows = [];
  let winStart = new Date(start);
  while (winStart <= end) {
    const boundary = addMonths(winStart, maxMonths);
    if (boundary >= end) {
      windows.push({ start: new Date(winStart), end: new Date(end) });
      break;
    }
    const winEnd = new Date(boundary);
    winEnd.setDate(winEnd.getDate() - 1);
    windows.push({ start: new Date(winStart), end: winEnd });
    winStart = new Date(winEnd);
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

async function exportWindow(page, reportUrl, win, downloadDir, filePrefix) {
  await page.goto(reportUrl, { waitUntil: 'networkidle' });
  await dismissPopupIfAny(page);

  try {
    await page.selectOption(SELECTORS.officeSelect, TARGET_OFFICE_VALUE, { timeout: 3000 });
  } catch (e) {
    console.log('Filtro de clínica não encontrado/aplicável nesta tela (ok — o escopo é garantido no parsing): ' + e.message);
  }

  await setDateField(page, SELECTORS.dateStart, toBr(win.start));
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await setDateField(page, SELECTORS.dateEnd, toBr(win.end));
  await page.locator('body').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(300);

  await page.click(SELECTORS.searchButton);
  await page.waitForLoadState('networkidle');
  await dismissPopupIfAny(page);
  await page.waitForTimeout(1500);

  await page.click(SELECTORS.exportMenuButton);
  await page.waitForTimeout(300);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click(SELECTORS.exportButton),
  ]);

  const fileName =
    filePrefix + '_' + win.start.toISOString().slice(0, 10) + '_' + win.end.toISOString().slice(0, 10) + '.xlsx';
  const filePath = path.join(downloadDir, fileName);
  await download.saveAs(filePath);
  console.log('Exportado: ' + fileName);
  return filePath;
}

/** Roda um relatório (Abertos OU Pagos) em todas as suas janelas, parseia cada
 * arquivo com o `parseFn` dado, e devolve as linhas únicas (por nossoNumero)
 * + o título lido (pra validação da Edge Function) + contagens agregadas. */
async function exportEParsear(page, reportUrl, windows, downloadDir, filePrefix, parseFn) {
  const porNossoNumero = new Map();
  let titulo = '';
  let totalIgnoradasOutraClinica = 0;

  for (const win of windows) {
    const filePath = await exportWindow(page, reportUrl, win, downloadDir, filePrefix);
    const buffer = fs.readFileSync(filePath);
    const { titulo: tituloArquivo, validas, ignoradasOutraClinica } = parseFn(buffer);
    totalIgnoradasOutraClinica += ignoradasOutraClinica;
    if (!titulo) titulo = tituloArquivo;
    else if (tituloArquivo && tituloArquivo !== titulo) {
      console.log(
        'Aviso: título mudou entre janelas de ' + filePrefix + ' ("' + titulo + '" vs "' + tituloArquivo + '")'
      );
    }
    for (const row of validas) {
      // Janela mais recente processada por último vence em caso de
      // nossoNumero repetido entre janelas (não deveria acontecer já que as
      // janelas não se sobrepõem, mas é uma salvaguarda).
      porNossoNumero.set(row.nossoNumero, row);
    }
  }

  return { titulo, linhas: [...porNossoNumero.values()], totalIgnoradasOutraClinica };
}

async function main() {
  const required = ['ORAL_UNIC_USER', 'ORAL_UNIC_PASS', 'SYNC_COBRANCA_FUNCTION_URL', 'ROBO_COBRANCA_SECRET'];
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

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // Boletos Pagos: últimos 12 meses (mesmo dia do ano anterior até hoje).
    const inicioPagos = addMonths(hoje, -12);
    const janelasPagos = chunkWindows(inicioPagos, hoje, 12);

    // Boletos Abertos: de hoje até daqui 36 meses (mesmo dia), em janelas de
    // até 12 meses cada.
    const fimAbertos = addMonths(hoje, 36);
    const janelasAbertos = chunkWindows(hoje, fimAbertos, 12);

    console.log('Janelas Boletos Pagos: ' + janelasPagos.length + ' | Janelas Boletos Abertos: ' + janelasAbertos.length);

    const resultPagos = await exportEParsear(
      page,
      BOLETOS_PAGOS_URL,
      janelasPagos,
      downloadDir,
      'boletos_pagos',
      parseBoletosPagos
    );
    console.log(
      'Boletos Pagos: ' + resultPagos.linhas.length + ' linhas (Chapadão do Sul) — ' +
        resultPagos.totalIgnoradasOutraClinica + ' ignoradas de outra clínica'
    );

    const resultAbertos = await exportEParsear(
      page,
      BOLETOS_ABERTOS_URL,
      janelasAbertos,
      downloadDir,
      'boletos_abertos',
      parseBoletosAbertos
    );
    console.log(
      'Boletos Abertos: ' + resultAbertos.linhas.length + ' linhas (Chapadão do Sul) — ' +
        resultAbertos.totalIgnoradasOutraClinica + ' ignoradas de outra clínica'
    );

    const payload = {
      // O robô sempre exporta Boletos Abertos nesta rotina diária (equivalente
      // a sempre marcar o campo "Boletos Abertos" no formulário manual), então
      // a varredura de "pendente_conferencia" sempre roda — igual ao app.
      abertosEnviado: true,
      tituloAbertos: resultAbertos.titulo,
      tituloPagos: resultPagos.titulo,
      abertos: resultAbertos.linhas,
      pagos: resultPagos.linhas,
    };

    const res = await fetch(process.env.SYNC_COBRANCA_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Robo-Secret': process.env.ROBO_COBRANCA_SECRET,
      },
      body: JSON.stringify(payload),
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
  console.error('Falha na sincronização de Cobrança:', err);
  process.exit(1);
});
