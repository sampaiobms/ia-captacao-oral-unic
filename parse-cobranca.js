// Porta fiel da lógica de src/cobranca/excel.ts do app (Lovable), para o robô
// que roda fora do app. NÃO reinventa regras — só replica, linha por linha.
//
// Diferença em relação a excel.ts: aqui também extraímos o TÍTULO da planilha
// (célula A1), que o excel.ts original não usa pra nada — o robô usa esse
// título pra deixar a Edge Function conferir que o arquivo exportado do ERP
// como "Boletos Abertos" realmente tem esse título, e o mesmo pra "Boletos
// Pagos" (ver seção "Trava de título" no README). E filtramos por clínica,
// já que o robô de Cobrança só deve gravar Chapadão do Sul (mesmo escopo do
// robô de pacientes), mesmo que o arquivo do ERP traga outras clínicas.
const XLSX = require('xlsx');

const CLINICA_ALVO = 'chapadao do sul';

function normalizar(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** "-" e vazio viram string vazia — igual ao txt() de excel.ts. */
function txt(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s === '-' ? '' : s;
}

/** Datas sempre texto dd/mm/aaaa — convertidas para ISO date (yyyy-mm-dd). Igual a parseDataBR(). */
function parseDataBR(v) {
  const s = txt(v);
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0');
  }
  return null;
}

/** Números do ERP: pode vir "1.234,56" ou number. Igual a num(). */
function num(v) {
  if (typeof v === 'number') return v;
  const s = txt(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

/** Avaliação é SEMPRE texto (nunca parseInt/Number). Igual a avaliacaoTxt(). */
function avaliacaoTxt(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(Math.trunc(v));
  const s = String(v).trim();
  if (s === '-') return '';
  return s.replace(/\.0+$/, '');
}

/** "3 /23" -> { numeroParcela: 3, totalParcelas: 23 }. Igual a parseParcela(). */
function parseParcela(v) {
  const s = txt(v);
  const m = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { numeroParcela: 0, totalParcelas: 0 };
  return { numeroParcela: Number(m[1]), totalParcelas: Number(m[2]) };
}

/** Mesmo padrão de normalização de telefone usado em src/captacao/db.ts. Igual a normalizarTelefone(). */
function normalizarTelefone(v) {
  return txt(v).replace(/\D/g, '');
}

/**
 * Lê a planilha: 1ª linha = título, 2ª linha = cabeçalho real, última linha =
 * "Total" (descartada). Igual a lerLinhas() de excel.ts, mas também devolve o
 * texto da 1ª linha (título) pra validação da Edge Function.
 */
function lerLinhasComTitulo(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
  if (matriz.length < 2) return { titulo: '', linhas: [] };

  const titulo = txt((matriz[0] || [])[0]);

  let idxHeader = matriz.findIndex((r) =>
    (r || []).some((c) => txt(c).toLowerCase().replace(/\s+/g, ' ').includes('nosso n'))
  );
  if (idxHeader < 0) idxHeader = 1;

  const header = (matriz[idxHeader] || []).map((c) => txt(c));
  const linhas = [];
  for (let i = idxHeader + 1; i < matriz.length; i++) {
    const row = matriz[i] || [];
    const obj = {};
    header.forEach((h, j) => {
      if (h) obj[h] = row[j] ?? null;
    });
    const primeiroValor = row.find((c) => txt(c)) ?? '';
    if (txt(primeiroValor).toLowerCase() === 'total') continue;
    linhas.push(obj);
  }
  return { titulo, linhas };
}

function pega(row, ...nomes) {
  for (const n of nomes) {
    const chave = Object.keys(row).find((k) => normalizar(k) === normalizar(n));
    if (chave) return row[chave];
  }
  return null;
}

/**
 * @returns {{ titulo: string, validas: object[], ignoradasOutraClinica: number }}
 */
function parseBoletosAbertos(buffer) {
  const { titulo, linhas } = lerLinhasComTitulo(buffer);
  const validas = [];
  let ignoradasOutraClinica = 0;
  for (const row of linhas) {
    const nossoNumero = Math.trunc(num(pega(row, 'Nosso Número', 'Nosso Numero')));
    if (!nossoNumero) continue;
    const clinica = txt(pega(row, 'Clínica', 'Clinica'));
    if (normalizar(clinica) !== CLINICA_ALVO) {
      ignoradasOutraClinica++;
      continue;
    }
    const { numeroParcela, totalParcelas } = parseParcela(pega(row, 'Parcela'));
    const origemTxt = txt(pega(row, 'Origem')).toLowerCase();
    const nomeTxt = txt(pega(row, 'Boleto em nome de')).toLowerCase();
    validas.push({
      clinica,
      numeroAvaliacao: avaliacaoTxt(pega(row, 'Avaliação', 'Avaliacao')),
      paciente: txt(pega(row, 'Paciente')),
      protesto: txt(pega(row, 'Protesto')).toLowerCase().startsWith('s'),
      qtdBoletosVencidos: Math.trunc(num(pega(row, 'Qtd. Boletos Vencidos', 'Qtd Boletos Vencidos'))),
      valorLiquido: num(pega(row, 'Valor Líquido', 'Valor Liquido')),
      valorBruto: num(pega(row, 'Valor Bruto')),
      numeroParcela,
      totalParcelas,
      nossoNumero,
      origem: origemTxt.startsWith('reneg') ? 'renegociacao' : origemTxt.startsWith('entrada') ? 'entrada' : 'parcela',
      dataVencimento: parseDataBR(pega(row, 'Data Vencimento')),
      dataVenda: parseDataBR(pega(row, 'Data da Venda')),
      boletoEmNomeDe: nomeTxt.startsWith('respons') ? 'responsavel' : 'paciente',
      ultimoContatoParcela: parseDataBR(pega(row, 'Último Contato Parcela', 'Ultimo Contato Parcela')),
      ultimoContatoPaciente: parseDataBR(pega(row, 'Último Contato Paciente', 'Ultimo Contato Paciente')),
      dataAgendamentoPagamento: parseDataBR(pega(row, 'Data Agendamento Pagamento')),
      whatsapp: normalizarTelefone(pega(row, 'WhatsApp')),
    });
  }
  return { titulo, validas, ignoradasOutraClinica };
}

/**
 * @returns {{ titulo: string, validas: object[], ignoradasOutraClinica: number }}
 */
function parseBoletosPagos(buffer) {
  const { titulo, linhas } = lerLinhasComTitulo(buffer);
  const validas = [];
  let ignoradasOutraClinica = 0;
  for (const row of linhas) {
    const nossoNumero = Math.trunc(num(pega(row, 'Nosso Número', 'Nosso Numero')));
    if (!nossoNumero) continue;
    const clinica = txt(pega(row, 'Clínica', 'Clinica'));
    if (normalizar(clinica) !== CLINICA_ALVO) {
      ignoradasOutraClinica++;
      continue;
    }
    const { numeroParcela, totalParcelas } = parseParcela(pega(row, 'Parcela'));
    validas.push({
      clinica,
      numeroAvaliacao: avaliacaoTxt(pega(row, 'Avaliação', 'Avaliacao')),
      paciente: txt(pega(row, 'Paciente')),
      valorLiquido: num(pega(row, 'Valor Líquido', 'Valor Liquido')),
      valorBruto: num(pega(row, 'Valor Bruto')),
      numeroParcela,
      totalParcelas,
      nossoNumero,
      dataVencimento: parseDataBR(pega(row, 'Data Vencimento')),
      dataRecebimento: parseDataBR(pega(row, 'Data Recebimento')),
      dataVenda: parseDataBR(pega(row, 'Data da Venda')),
      dataLancamentoPagamento: parseDataBR(pega(row, 'Data Lançamento Pagamento', 'Data Lancamento Pagamento')),
      baixadoPor: txt(pega(row, 'Baixado por')),
    });
  }
  return { titulo, validas, ignoradasOutraClinica };
}

module.exports = { parseBoletosAbertos, parseBoletosPagos, CLINICA_ALVO, normalizar };
