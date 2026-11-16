// Regras compartilhadas da importação de Boletos Abertos/Pagos.
// Usado pela edge function sync-cobranca-robo E pelo botão manual (src/cobranca/import.ts),
// para que os dois sigam exatamente a mesma regra. Sem dependências de runtime.

/** Data de hoje (YYYY-MM-DD) no fuso America/Campo_Grande. */
export function hojeCampoGrande(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Campo_Grande',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

/**
 * Critério de interação ("qualquer observação registrada no boleto protege"):
 * qualquer acordo em cobranca_acordos (qualquer status — sempre tem 'condicoes' escritas),
 * OU qualquer registro em cobranca_contatos (anotações/contatos),
 * OU texto em parcelas.protesto_motivo / parcelas.nao_contatar_motivo (ver temObservacaoNaParcela).
 */
export function temInteracao(parcelaId: string, acordosAtivos: Set<string>, contatos: Set<string>): boolean {
  return acordosAtivos.has(parcelaId) || contatos.has(parcelaId);
}

/** Observações gravadas na própria linha de parcelas. */
export const COLUNAS_OBSERVACAO_PARCELA = 'protesto_motivo, nao_contatar_motivo';
export function temObservacaoNaParcela(p: { protesto_motivo?: string | null; nao_contatar_motivo?: string | null }): boolean {
  return !!(p.protesto_motivo ?? '').trim() || !!(p.nao_contatar_motivo ?? '').trim();
}

export const LIMITE_SUMIDOS_FUTUROS = 0.2;
export const MOTIVO_PENDENTE_SUMIU = 'sumiu_erp_com_interacao';

export interface AbertaExistente {
  id: string;
  chave: string;
  clinicaId: string | null;
  dataVencimento: string | null;
  pendenteConferencia: boolean;
}

/** Abertas com vencimento estritamente futuro (> hoje). Vencidas/sem data nunca entram (regra 3). */
export function ehFutura(dataVencimento: string | null, hoje: string): boolean {
  return !!dataVencimento && dataVencimento.slice(0, 10) > hoje;
}

/** Abertas futuras do escopo que não vieram em Abertos nem em Pagos. */
export function sumidasFuturas(
  abertas: AbertaExistente[],
  chavesNoArquivo: Set<string>,
  hoje: string,
  clinicasEscopo: Set<string> | null,
): AbertaExistente[] {
  return abertas.filter(
    (a) =>
      ehFutura(a.dataVencimento, hoje) &&
      (clinicasEscopo === null || (a.clinicaId !== null && clinicasEscopo.has(a.clinicaId))) &&
      !chavesNoArquivo.has(a.chave),
  );
}

export interface PlanoSumidos {
  bloqueado: boolean;
  motivoBloqueio: string | null;
  cancelar: AbertaExistente[];
  pendentes: AbertaExistente[];
}

/**
 * Regra 2 + trava de 20%: calcula o que fazer com as abertas futuras que sumiram.
 * A trava é por clínica: se em qualquer clínica do escopo as sumidas passarem de 20% das abertas
 * futuras daquela clínica, nada da regra 2 é aplicado.
 */
export function planejarSumidos(input: {
  abertas: AbertaExistente[];
  chavesNoArquivo: Set<string>;
  hoje: string;
  clinicasEscopo: Set<string> | null;
  interacao: Set<string>;
  limite?: number;
}): PlanoSumidos {
  const limite = input.limite ?? LIMITE_SUMIDOS_FUTUROS;
  const sumidas = sumidasFuturas(input.abertas, input.chavesNoArquivo, input.hoje, input.clinicasEscopo);
  const futurasPorClinica = new Map<string, number>();
  for (const a of input.abertas) {
    if (!ehFutura(a.dataVencimento, input.hoje)) continue;
    const k = a.clinicaId ?? '';
    futurasPorClinica.set(k, (futurasPorClinica.get(k) ?? 0) + 1);
  }
  const sumidasPorClinica = new Map<string, number>();
  for (const s of sumidas) sumidasPorClinica.set(s.clinicaId ?? '', (sumidasPorClinica.get(s.clinicaId ?? '') ?? 0) + 1);
  for (const [clinica, n] of sumidasPorClinica) {
    const total = futurasPorClinica.get(clinica) ?? 0;
    if (total > 0 && n / total > limite) {
      return {
        bloqueado: true,
        motivoBloqueio: `Regra de boletos futuros não aplicada: ${n} de ${total} boletos abertos futuros (${Math.round((n / total) * 100)}%) sumiriam de uma vez, acima do limite de ${Math.round(limite * 100)}%. O restante da importação foi gravado; confira se o arquivo de Boletos Abertos está completo.`,
        cancelar: [],
        pendentes: [],
      };
    }
  }
  return {
    bloqueado: false,
    motivoBloqueio: null,
    cancelar: sumidas.filter((s) => !input.interacao.has(s.id)),
    pendentes: sumidas.filter((s) => input.interacao.has(s.id)),
  };
}
