// Porta fiel da lógica de src/clinico/excel.ts do app (Lovable), para o robô
// que roda fora do app. NÃO reinventa regras — só replica.
const XLSX = require('xlsx');

function clean(v) {
  return String(v ?? '').replace(/\s+/g, ' ').replace(/\.\.\.$/, '').trim();
}

/** Converte o Celular do ERP para E.164 sem '+' (só dígitos, prefixo 55),
 * igual ao toE164 de src/clinico/excel.ts. */
function toE164(v) {
  const digits = String(v ?? '').replace(/\D/g, '');
  return digits ? '55' + digits : '';
}

/**
 * Lê um arquivo de Cadastros de Pacientes exportado do ERP (cabeçalho na 2ª linha).
 * Mesma regra de src/clinico/excel.ts: só entram registros cuja Ficha seja
 * diferente de 0 e que tenham Nome preenchido; dedupe por ficha dentro do arquivo.
 * Além dos campos que o app já usa, também lê a coluna "Clínica" (clinicaNome),
 * usada pela Edge Function para resolver o clinica_id.
 */
function parseCadastroPacientes(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { range: 1 });

  const validos = [];
  let ignorados = 0;
  const vistas = new Set();

  for (const row of rows) {
    const ficha = clean(row['Ficha']);
    const paciente = clean(row['Nome']);
    if (!ficha || ficha === '0' || Number(ficha) === 0 || !paciente) {
      ignorados++;
      continue;
    }
    if (vistas.has(ficha)) {
      ignorados++;
      continue;
    }
    vistas.add(ficha);
    const clinicaNome = clean(row['Clínica']);
    validos.push({
      ficha,
      paciente,
      cpf: clean(row['CPF']),
      tratamento: clean(row['Nome do Tratamento']),
      telefone: toE164(row['Celular']),
      email: clean(row['e-mail']),
      ...(clinicaNome ? { clinicaNome } : {}),
    });
  }

  return { validos, ignorados };
}

module.exports = { parseCadastroPacientes, clean, toE164 };
