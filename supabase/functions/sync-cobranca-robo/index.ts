// Edge Function sync-cobranca-robo — porta fiel de src/cobranca/import.ts
// (reconciliar) + src/cobranca/excel.ts (parseBoletosAbertos/parseBoletosPagos),
// com uma camada extra de segurança: valida que o título de cada arquivo (A1)
// bate com o tipo declarado, antes de gravar qualquer coisa.
//
// Este arquivo é só a FONTE da function — ainda precisa ser criado/implantado
// no projeto Supabase/Lovable do CRM (ver instruções de entrega).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  hojeCampoGrande,
  planejarSumidos,
  temInteracao,
  temObservacaoNaParcela,
  MOTIVO_PENDENTE_SUMIU,
  type AbertaExistente,
} from "../_shared/regrasImportCobranca.ts";

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
  clinica_id: string | null;
  data_vencimento: string | null;
  pendente_conferencia: boolean;
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
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
  const importacaoId = `robo:${crypto.randomUUID()}`;
  const hoje = hojeCampoGrande();

  const resumo = {
    importacaoId,
    totalAbertos: abertos.length,
    totalPagos: pagos.length,
    novas: 0,
    atualizadas: 0,
    baixadas: 0,
    ignoradasPagas: 0,
    gravadasAbertos: 0,
    gravadasPagos: 0,
    semClinicaResolvida: 0,
    protegidas: 0,
    canceladas_erp: 0,
    reabertas: 0,
    pendentes_conferencia: 0,
    regra2Aplicada: false,
    erros: [] as string[],
  };

  const { data: clinicasData, error: errClinicas } = await supabase.from("clinicas").select("id, cidade");
  if (errClinicas) return json({ erro: `Erro ao listar clínicas: ${errClinicas.message}` }, 500);
  const clinicaPorCidade = new Map<string, string>();
  for (const c of clinicasData ?? []) {
    const cidade = normalizar(c.cidade ?? "");
    if (cidade && !clinicaPorCidade.has(cidade)) clinicaPorCidade.set(cidade, c.id as string);
  }
  const resolverClinicaId = (nome: string): string | null => clinicaPorCidade.get(normalizar(nome ?? "")) ?? null;

  // Leitura paginada (o banco devolve no máximo 1000 linhas por chamada)
  async function lerTudo<T>(tabela: string, colunas: string, filtro?: (q: any) => any): Promise<T[]> {
    const out: T[] = [];
    for (let pag = 0; ; pag++) {
      let q = supabase.from(tabela).select(colunas).order("id").range(pag * 1000, pag * 1000 + 999);
      if (filtro) q = filtro(q);
      const { data, error } = await q;
      if (error) throw new Error(`${tabela}: ${error.message}`);
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  let existentes: ParcelaExistente[];
  const acordosAtivos = new Set<string>();
  const contatos = new Set<string>();
  try {
    existentes = await lerTudo<ParcelaExistente>(
      "parcelas",
      "id, nosso_numero, status_parcela, clinica_id, data_vencimento, pendente_conferencia, protesto_motivo, nao_contatar_motivo",
    );
    (await lerTudo<{ parcela_id: string }>("cobranca_acordos", "id, parcela_id"))
      .forEach((a) => a.parcela_id && acordosAtivos.add(a.parcela_id));
    (await lerTudo<{ parcela_id: string }>("cobranca_contatos", "id, parcela_id"))
      .forEach((c) => c.parcela_id && contatos.add(c.parcela_id));
    existentes.forEach((p: any) => temObservacaoNaParcela(p) && contatos.add(p.id));
  } catch (e) {
    return json({ erro: `Erro ao ler dados existentes: ${(e as Error).message}` }, 500);
  }
  const chave = (clinicaId: string | null, nossoNumero: number) => `${clinicaId ?? ""}:${nossoNumero}`;
  const porNosso = new Map<string, ParcelaExistente>(existentes.map((p) => [chave(p.clinica_id, p.nosso_numero), p]));
  const protegida = (id: string) => temInteracao(id, acordosAtivos, contatos);

  const agora = new Date().toISOString();
  const limparCancelamento = { cancelada_erp_em: null, cancelada_erp_importacao: null, pendente_conferencia: false, pendente_conferencia_motivo: null, pendente_conferencia_em: null };
  const eventos: Record<string, unknown>[] = [];
  const evento = (p: { id: string; clinica_id: string | null }, acao: string, motivo: string | null) =>
    eventos.push({ parcela_id: p.id, clinica_id: p.clinica_id, acao, motivo, importacao_id: importacaoId, ator_email: "robo" });

  async function enviarLotes(linhas: Record<string, unknown>[], rotulo: string): Promise<number> {
    let gravadas = 0;
    for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
      const lote = linhas.slice(i, i + TAMANHO_LOTE);
      const { error } = await supabase.from("parcelas").upsert(lote as never, { onConflict: "clinica_id,nosso_numero" });
      if (error) resumo.erros.push(`${rotulo} lote ${Math.floor(i / TAMANHO_LOTE) + 1} (${lote.length} linhas): ${error.message}`);
      else gravadas += lote.length;
    }
    return gravadas;
  }
  async function atualizarIds(ids: string[], campos: Record<string, unknown>, rotulo: string): Promise<number> {
    let ok = 0;
    for (let i = 0; i < ids.length; i += TAMANHO_LOTE) {
      const lote = ids.slice(i, i + TAMANHO_LOTE);
      const { error } = await supabase.from("parcelas").update(campos).in("id", lote);
      if (error) resumo.erros.push(`${rotulo} lote ${Math.floor(i / TAMANHO_LOTE) + 1}: ${error.message}`);
      else ok += lote.length;
    }
    return ok;
  }

  // a) Boletos Abertos -> cria/atualiza; boletos com interação não são sobrescritos (protegidas)
  const linhasAbertos: Record<string, unknown>[] = [];
  const reabrirProtegidas: ParcelaExistente[] = [];
  for (const l of abertos) {
    const clinicaId = resolverClinicaId(l.clinica);
    if (!clinicaId) { resumo.semClinicaResolvida++; continue; }
    const existente = porNosso.get(chave(clinicaId, l.nossoNumero));
    if (existente && protegida(existente.id)) {
      if (existente.status_parcela === "cancelada_erp") reabrirProtegidas.push(existente);
      else resumo.protegidas++;
      continue;
    }
    const reabre = existente?.status_parcela === "cancelada_erp";
    if (reabre) { resumo.reabertas++; evento(existente!, "reaberta_auto", "voltou no arquivo de Boletos Abertos"); }
    if (existente) resumo.atualizadas++;
    else resumo.novas++;
    linhasAbertos.push({
      clinica_id: clinicaId,
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
      ...limparCancelamento,
      origem_importacao: { arquivo: "boletos_abertos", importado_em: agora, fonte: "robo", importacao_id: importacaoId },
      status_parcela: reabre ? "aberta" : existente?.status_parcela ?? "aberta",
    });
  }
  if (linhasAbertos.length) resumo.gravadasAbertos = await enviarLotes(linhasAbertos, "Boletos Abertos");
  if (reabrirProtegidas.length) {
    const n = await atualizarIds(reabrirProtegidas.map((p) => p.id), { status_parcela: "aberta", ...limparCancelamento }, "Reabrir");
    resumo.reabertas += n;
    reabrirProtegidas.forEach((p) => evento(p, "reaberta_auto", "voltou no arquivo de Boletos Abertos"));
  }

  // b) Boletos Pagos -> baixa automática (vale mesmo com interação)
  const linhasPagos: Record<string, unknown>[] = [];
  for (const p of pagos) {
    const clinicaId = resolverClinicaId(p.clinica);
    if (!clinicaId) { resumo.semClinicaResolvida++; continue; }
    const existente = porNosso.get(chave(clinicaId, p.nossoNumero));
    if (existente && existente.status_parcela === "paga") { resumo.ignoradasPagas++; continue; }
    let pagoComJuros = false;
    let valorJuros: number | null = null;
    if (p.valorLiquido > p.valorBruto + 0.01) {
      pagoComJuros = true;
      valorJuros = Math.round((p.valorLiquido - p.valorBruto) * 100) / 100;
    }
    linhasPagos.push({
      clinica_id: clinicaId,
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
      ...limparCancelamento,
      origem_importacao: { arquivo: "boletos_pagos", importado_em: agora, fonte: "robo", importacao_id: importacaoId },
    });
    resumo.baixadas++;
  }
  if (linhasPagos.length) resumo.gravadasPagos = await enviarLotes(linhasPagos, "Boletos Pagos");

  // c) Regra 2 — só com arquivo de Abertos enviado (título já conferido acima).
  //    Vencidos (<= hoje) que não vieram NÃO são alterados (regra 3).
  let erroRegra2: string | null = null;
  if (abertosEnviado && abertos.length > 0) {
    const noArquivo = new Set<string>();
    const clinicasEscopo = new Set<string>();
    for (const l of [...abertos, ...pagos]) {
      const cid = resolverClinicaId(l.clinica);
      if (cid) noArquivo.add(chave(cid, l.nossoNumero));
    }
    for (const l of abertos) { const cid = resolverClinicaId(l.clinica); if (cid) clinicasEscopo.add(cid); }
    const abertasExistentes: AbertaExistente[] = existentes
      .filter((e) => e.status_parcela === "aberta")
      .map((e) => ({ id: e.id, chave: chave(e.clinica_id, e.nosso_numero), clinicaId: e.clinica_id, dataVencimento: e.data_vencimento, pendenteConferencia: e.pendente_conferencia }));
    const interacao = new Set<string>([...acordosAtivos, ...contatos]);
    const plano = planejarSumidos({ abertas: abertasExistentes, chavesNoArquivo: noArquivo, hoje, clinicasEscopo, interacao });
    if (plano.bloqueado) {
      erroRegra2 = plano.motivoBloqueio;
      resumo.erros.push(plano.motivoBloqueio!);
    } else {
      resumo.regra2Aplicada = true;
      const porId = new Map(existentes.map((e) => [e.id, e]));
      resumo.canceladas_erp = await atualizarIds(
        plano.cancelar.map((c) => c.id),
        { status_parcela: "cancelada_erp", cancelada_erp_em: agora, cancelada_erp_importacao: importacaoId, pendente_conferencia: false, pendente_conferencia_motivo: null },
        "Cancelar ERP",
      );
      plano.cancelar.forEach((c) => evento(porId.get(c.id)!, "cancelada_erp_auto", "boleto futuro sumiu do ERP, sem interação"));
      const novasPendentes = plano.pendentes.filter((p) => !p.pendenteConferencia);
      await atualizarIds(
        novasPendentes.map((p) => p.id),
        { pendente_conferencia: true, pendente_conferencia_motivo: MOTIVO_PENDENTE_SUMIU, pendente_conferencia_em: agora },
        "Pendentes",
      );
      resumo.pendentes_conferencia = plano.pendentes.length;
      novasPendentes.forEach((p) => evento(porId.get(p.id)!, "pendente_auto", "boleto futuro sumiu do ERP, com interação"));
    }
  }

  for (let i = 0; i < eventos.length; i += TAMANHO_LOTE) {
    const { error } = await supabase.from("cobranca_conferencia_eventos").insert(eventos.slice(i, i + TAMANHO_LOTE));
    if (error) resumo.erros.push(`Registro de eventos: ${error.message}`);
  }

  if (erroRegra2) return json({ erro: erroRegra2, ...resumo }, 422);
  return json(resumo, 200);
});
