// Edge Function sync-cobranca-robo — porta fiel de src/cobranca/import.ts
// (reconciliar) + src/cobranca/excel.ts (parseBoletosAbertos/parseBoletosPagos),
// com uma camada extra de segurança: valida que o título de cada arquivo (A1)
// bate com o tipo declarado, antes de gravar qualquer coisa.
//
// Este arquivo é só a FONTE da function — ainda precisa ser criado/implantado
// no projeto Supabase/Lovable do CRM (ver instruções de entrega).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROBO_SECRET = Deno.env.get("ROBO_COBRANCA_SECRET")!;

const TITULO_ABERTOS_RE = /boletos\s*abertos/i;
const TITULO_PAGOS_RE = /boletos\s*pagos/i;
const TAMANHO_LOTE = 200;

interface LinhaAberto {
  clinica: string;
  numeroAvaliacao: string;
  paciente: string;
  protesto: boolean;
  qtdBoletosVencidos: number;
  valorLiquido: number;
  valorBruto: number;
  numeroParcela: number;
  totalParcelas: number;
  nossoNumero: number;
  origem: "parcela" | "renegociacao" | "entrada";
  dataVencimento: string | null;
  dataVenda: string | null;
  boletoEmNomeDe: "paciente" | "responsavel";
  whatsapp: string;
}

interface LinhaPago {
  clinica: string;
  numeroAvaliacao: string;
  paciente: string;
  valorLiquido: number;
  valorBruto: number;
  numeroParcela: number;
  totalParcelas: number;
  nossoNumero: number;
  dataVencimento: string | null;
  dataRecebimento: string | null;
  dataVenda: string | null;
  dataLancamentoPagamento: string | null;
  baixadoPor: string;
}

interface ParcelaExistente {
  id: string;
  nosso_numero: number;
  status_parcela: string;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", Connection: "keep-alive" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ erro: "Método não permitido, use POST" }, 405);
  }

  const secretHeader = req.headers.get("X-Robo-Secret");
  if (!secretHeader || secretHeader !== ROBO_SECRET) {
    return json({ erro: "Não autorizado" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ erro: "Corpo da requisição inválido (esperado JSON)" }, 400);
  }

  const abertos: LinhaAberto[] = Array.isArray(body?.abertos) ? (body.abertos as LinhaAberto[]) : [];
  const pagos: LinhaPago[] = Array.isArray(body?.pagos) ? (body.pagos as LinhaPago[]) : [];
  const abertosEnviado = body?.abertosEnviado === true;
  const tituloAbertos = typeof body?.tituloAbertos === "string" ? (body.tituloAbertos as string) : "";
  const tituloPagos = typeof body?.tituloPagos === "string" ? (body.tituloPagos as string) : "";

  if (!abertos.length && !pagos.length) {
    return json({ erro: "Nenhuma linha recebida (abertos e pagos vazios)" }, 400);
  }

  // Trava de título — mesma proteção desenhada (mas nunca publicada) no app,
  // pra impedir gravar um arquivo como se fosse do outro tipo (ver incidente
  // de 05/10/2026 no histórico do projeto).
  if (abertos.length > 0 && !TITULO_ABERTOS_RE.test(tituloAbertos)) {
    return json(
      {
        erro: `Título do arquivo de Boletos Abertos não confere (esperado conter "Boletos Abertos", recebido "${tituloAbertos}"). Importação cancelada, nada foi gravado.`,
      },
      400,
    );
  }
  if (pagos.length > 0 && !TITULO_PAGOS_RE.test(tituloPagos)) {
    return json(
      {
        erro: `Título do arquivo de Boletos Pagos não confere (esperado conter "Boletos Pagos", recebido "${tituloPagos}"). Importação cancelada, nada foi gravado.`,
      },
      400,
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const resumo = {
    totalAbertos: abertos.length,
    totalPagos: pagos.length,
    novas: 0,
    atualizadas: 0,
    baixadas: 0,
    pendentesConferencia: 0,
    ignoradasPagas: 0,
    gravadasAbertos: 0,
    gravadasPagos: 0,
    erros: [] as string[],
  };

  const { data: existentesData, error: errListar } = await supabase
    .from("parcelas")
    .select("id, nosso_numero, status_parcela");
  if (errListar) {
    return json({ erro: `Erro ao listar parcelas existentes: ${errListar.message}` }, 500);
  }
  const existentes = (existentesData ?? []) as ParcelaExistente[];
  const porNosso = new Map<number, ParcelaExistente>(existentes.map((p) => [p.nosso_numero, p]));

  const agora = new Date().toISOString();

  async function enviarLotes(linhas: Record<string, unknown>[], rotulo: string): Promise<number> {
    let gravadas = 0;
    for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
      const lote = linhas.slice(i, i + TAMANHO_LOTE);
      const nLote = Math.floor(i / TAMANHO_LOTE) + 1;
      const { error } = await supabase.from("parcelas").upsert(lote as never, { onConflict: "nosso_numero" });
      if (error) {
        resumo.erros.push(`${rotulo} lote ${nLote} (${lote.length} linhas): ${error.message}`);
      } else {
        gravadas += lote.length;
      }
    }
    return gravadas;
  }

  // a) Boletos Abertos -> cria ou atualiza
  const linhasAbertos = abertos.map((l) => {
    const existente = porNosso.get(l.nossoNumero);
    if (existente) resumo.atualizadas++;
    else resumo.novas++;
    return {
      nosso_numero: l.nossoNumero,
      numero_avaliacao: l.numeroAvaliacao,
      paciente_nome: l.paciente,
      paciente_telefone: l.whatsapp,
      boleto_em_nome_de: l.boletoEmNomeDe,
      numero_parcela: l.numeroParcela,
      total_parcelas: l.totalParcelas,
      valor_bruto: l.valorBruto,
      valor_liquido: l.valorLiquido,
      data_vencimento: l.dataVencimento,
      data_venda: l.dataVenda,
      origem: l.origem,
      protesto: l.protesto,
      qtd_boletos_vencidos_erp: l.qtdBoletosVencidos,
      unidade: l.clinica,
      pendente_conferencia: false,
      origem_importacao: { arquivo: "boletos_abertos", importado_em: agora, fonte: "robo" },
      status_parcela: existente?.status_parcela ?? "aberta",
    };
  });
  if (linhasAbertos.length) {
    resumo.gravadasAbertos = await enviarLotes(linhasAbertos, "Boletos Abertos");
  }

  // b) Boletos Pagos -> baixa automática
  const linhasPagos: Record<string, unknown>[] = [];
  for (const p of pagos) {
    const existente = porNosso.get(p.nossoNumero);
    if (existente && existente.status_parcela === "paga") {
      resumo.ignoradasPagas++;
      continue;
    }
    let pagoComJuros = false;
    let valorJuros: number | null = null;
    if (p.valorLiquido > p.valorBruto + 0.01) {
      pagoComJuros = true;
      valorJuros = Math.round((p.valorLiquido - p.valorBruto) * 100) / 100;
    }
    linhasPagos.push({
      nosso_numero: p.nossoNumero,
      numero_avaliacao: p.numeroAvaliacao,
      paciente_nome: p.paciente,
      numero_parcela: p.numeroParcela,
      total_parcelas: p.totalParcelas,
      valor_bruto: p.valorBruto,
      valor_liquido: p.valorLiquido,
      data_vencimento: p.dataVencimento,
      data_venda: p.dataVenda,
      data_pagamento: p.dataRecebimento,
      data_lancamento_pagamento: p.dataLancamentoPagamento,
      baixado_por: p.baixadoPor,
      canal_baixa: "banco",
      pago_com_juros: pagoComJuros,
      valor_juros: valorJuros,
      status_parcela: "paga",
      unidade: p.clinica,
      pendente_conferencia: false,
      origem_importacao: { arquivo: "boletos_pagos", importado_em: agora, fonte: "robo" },
    });
    resumo.baixadas++;
  }
  if (linhasPagos.length) {
    resumo.gravadasPagos = await enviarLotes(linhasPagos, "Boletos Pagos");
  }

  // c) Abertas no banco que não vieram em nenhum arquivo -> pendente_conferencia
  // (só quando um arquivo de Boletos Abertos foi efetivamente enviado)
  if (abertosEnviado) {
    const noArquivo = new Set<number>([...abertos.map((a) => a.nossoNumero), ...pagos.map((p) => p.nossoNumero)]);
    const sumidas = existentes.filter((e) => e.status_parcela === "aberta" && !noArquivo.has(e.nosso_numero));
    for (let i = 0; i < sumidas.length; i += TAMANHO_LOTE) {
      const lote = sumidas.slice(i, i + TAMANHO_LOTE);
      const nLote = Math.floor(i / TAMANHO_LOTE) + 1;
      const { error } = await supabase
        .from("parcelas")
        .update({ pendente_conferencia: true })
        .in("id", lote.map((s) => s.id));
      if (error) {
        resumo.erros.push(`Pendentes lote ${nLote} (${lote.length} ids): ${error.message}`);
      } else {
        resumo.pendentesConferencia += lote.length;
      }
    }
  }

  return json(resumo, 200);
});
