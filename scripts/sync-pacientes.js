// Robô de sincronização do cadastro de pacientes do ERP Oral Unic -> Supabase.
// Roda via GitHub Actions (ver .github/workflows/sync-pacientes.yml), 2x ao dia.
//
// IMPORTANTE (leia o README.md antes de rodar pela primeira vez):
// Os seletores em SELECTORS abaixo são uma estimativa de "melhor esforço" --
// ninguém com acesso a este robô pôde logar no ERP real para conferir o HTML
// exato da tela de login. Foram sendo calibrados rodada a rodada a partir dos
// erros reais (ver histórico de ajustes no final deste arquivo).

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

// Clínicas a buscar no filtro "Clínica" do relatório (value = id da opção
// no <select id="idOffice">). Só Chapadão do Sul está em operação hoje —
// "Sao Bernardo do Campo" (value 305) é uma clínica de teste, fora de
// operação, e não deve ser buscada. Para incluir uma nova clínica real no
// futuro, basta adicionar outro { value, label } aqui.
const TARGET_OFFICES = [{ value: '392', label: 'Chapadao do Sul' }];

const SELECTORS = {
  // Tela de login
  loginUser: 'input[name="usuario"], input#usuario, input[type="text"]',
  loginPass: 'input[name="senha"], input#senha, input[type="password"]',
  loginSubmit: 'button[type="submit"], input[type="submit"]',

  // Popups que podem aparecer (aviso pós-login, ou validação do próprio
  // relatório, que usa SweetAlert2 — classe .swal2-*)
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

  // Confirmado no HTML real em 15/11/2026
  officeSelect: '#idOffice', // "Clínica" — NUNCA deixar em "Todas" (limita a janela a 1 mês)
  dateStart: '#dateBegin',
  dateEnd: '#dateEnd',
  searchButton: 'button[onclick*="pesquisarTela"], button:has-text("Pesquisar")',

  // Confirmado no HTML real em 15/11/2026: a tabela de resultados usa a
  // extensão "Buttons" do DataTables. O ícone de download (canto superior
  // direito do grid) abre um menu com "Exportar PDF" / "Exportar Excel".
  exportMenuButton: '.dropdown-btn',
  exportButton: 'button.buttons-excel, button:has-text("Exportar Excel")',
};
// =================================================================

function pad(n) {
  return String(n).padStart(2, '0');
}

function toBr(d) {
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}

/**
 * Gera as janelas de até 1 ano (limite do ERP quando uma clínica específica
 * está selecionada), alinhadas ao aniversário da data de abertura da clínica,
 * cobrindo de CLINIC_OPENING_DATE até hoje.
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

async function exportOfficeWindow(page, office, win, downloadDir) {
  await page.goto(REPORT_URL, { waitUntil: 'networkidle' });
  await dismissPopupIfAny(page);

  // Nunca deixar em "Todas" — limita a janela de datas a 1 mês.
  await page.selectOption(SELECTORS.officeSelect, office.value);

  // Escreve a data direto no campo (sem clicar nele), mas essa biblioteca de
  // calendário reabre o popup visual sozinha sempre que o valor muda — então,
  // depois de cada campo, clica num ponto neutro da página (fora do
  //
