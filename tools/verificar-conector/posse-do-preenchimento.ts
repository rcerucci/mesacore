// A POSSE DO PREENCHIMENTO — o caso de regressao do defeito medido a 01/10/2026 (conta `hl-teste-plugin`).
//
// O DEFEITO, como se mediu no venue real: a mesa abriu posicao em BTC (ordem `61581177468`, preenchida
// 0.00117 @ 84367.0) e o venue devolveu a NOSSA marca no preenchimento
// (`resposta_do_venue.bruto.cloid = 0xbf62594cce5cacfd083dd6d15cd97aa8`), mas o estado que o operador
// escreveu tinha `marcas_nossas_conhecidas: []` e a posicao SEM marca — e todos os 121 ciclos seguintes
// decidiram `nada:posicao_alheia_relatada_nao_gerida`. A mesa nao reconhecia a posicao que ela propria abriu.
//
// AS DUAS CAUSAS, e este caso mede as duas:
//   1. a guarda do operador comparava a classificacao com `aceita`/`preenchida` — palavras que o conjunto
//      FECHADO do contrato (`contracts/vocabulario.json`) NAO tem: o vocabulario e' `aceite`, nunca `aceita`.
//      Nenhum desfecho passava, e o mapa de marcas nunca se escrevia;
//   2. a chave registada era o `cloid` DERIVADO DO NOME da conta (`0x349994e8...`), e o conector deriva-o do
//      ENDERECO (`0xbf62594c...`). A leitura cruza o mapa com o `cloid` que o venue publica em `userFills`:
//      uma chave que o venue nunca viu nao liga posicao nenhuma.
//
// O QUE ESTE CORREDOR FAZ, e por que esta' montado assim: corre a CADEIA INTEIRA, em dado e sem rede —
// (a) o desfecho do venue -> a marca registada no mapa; (b) a leitura de mercado, com o mapa no ambiente,
// a atribuir a posse; (c) o ciclo, com a marca conhecida, a decidir sobre a posicao. Os dois braços sao
// medidos lado a lado: o ANTIGO (a guarda e a chave que estavam la') tem de reproduzir a posicao ALHEIA, e
// o NOVO tem de a reconhecer como NOSSA — e o unico desfecho que gerir uma posicao viva e' geri-la.
//
// Uso:  bun tools/verificar-conector/posse-do-preenchimento.ts
// Sai 1 se algum passo divergir; a ultima linha diz `posse do preenchimento: N de M passaram`.

import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLASSIFICACOES_QUE_CONFIRMAM_A_ORDEM, cloidDoPreenchimento, derivarCloid } from "../../brokers/hyperliquid/cloid.ts";
import { montarMercado } from "../../brokers/hyperliquid/leitura-do-mercado.ts";
import { decidirInstrumento } from "../../core/ciclo/ciclo.ts";
import { lerParaOCiclo, type LeituraCompacta } from "../../core/leitura/fixtures.ts";

const RAIZ = join(import.meta.dir, "..", "..");

/**
 * A posicao como o caso a mede. `marca_de_posse` e' OPCIONAL aqui de proposito: o contrato permite uma
 * posicao SEM marca (o venue entrega-a quando nao a consegue atribuir), e e' exactamente essa a posicao que a
 * mesa trata como ALHEIA. O tipo compacto do core exige a marca (e' o caminho das bancadas de caso), e por
 * isso o cast para ele fica feito num sitio so', dito.
 */
type Posicao = { lado: "buy" | "sell"; unidades: string; preco_medio: string; marca_de_posse?: number };

// ---------------------------------------------------------------------------------------------------------
// OS NUMEROS DO DEFEITO — transcritos do desfecho que a corrida deixou em
// `corrida-de-risco/desfechos-hl-teste-plugin.jsonl` (a PROVA, que se le' e nao se escreve).

const CONTA_DA_FICHA = "hl-teste-plugin";                                   // o NOME da conta (a ficha)
const ENDERECO_DA_CONTA = "0xF87138D298E338962E1a2e0ff23267Dc32c15621";     // o ENDERECO (o que o conector usa)
const INSTRUMENTO = "BTC";
const REFERENCIA = "mesa-sigma_v0-000902";
const MARCA = 902;
const OID = 61581177468;
const UNIDADES = "0.00117";
const PRECO_MEDIO = "84367.0";
const CLOID_DO_VENUE = "0xbf62594cce5cacfd083dd6d15cd97aa8";
const TEMPO_DO_VENUE_MS = 1790703260673;
const BARRA_DO_SINAL = 1730001600000;

/** O desfecho EXACTO que o conector emitiu (a linha medida, campo a campo). */
const DESFECHO_REAL: Record<string, unknown> = {
  classificacao: "aceite",
  resolucao: {
    quantidade: UNIDADES,
    nocional: "99.16686",
    margem_empenhada: "99.16",
    alavancagem_efectiva: "1",
    preco_de_liquidacao: "0",
  },
  resposta_do_venue: {
    estado: "filled",
    order_id: String(OID),
    preenchido: UNIDADES,
    preco_medio: PRECO_MEDIO,
    bruto: { totalSz: UNIDADES, avgPx: PRECO_MEDIO, oid: OID, cloid: CLOID_DO_VENUE },
  },
};

let verificacoes = 0;
let falhas = 0;

function exigir(condicao: boolean, texto: string): void {
  verificacoes += 1;
  if (condicao) console.log(`ok    ${texto}`);
  else {
    falhas += 1;
    console.log(`FALHA ${texto}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "mesacore-posse-"));
const CAMINHO_DO_MAPA = join(dir, `marcas-${CONTA_DA_FICHA}.jsonl`);
process.env.MARCAS_DA_CONTA = CAMINHO_DO_MAPA;

/** Escreve no mapa como o operador escreve (`apontarMarca`, `vigia/operador.ts`): uma linha append-only. */
function apontarMarca(cloid: string): void {
  appendFileSync(CAMINHO_DO_MAPA, JSON.stringify({ cloid, marca: MARCA, referencia: REFERENCIA, instrumento: INSTRUMENTO, quando: new Date(0).toISOString() }) + "\n");
}

/**
 * A LEITURA DE MERCADO, com a posicao viva do defeito e o preenchimento que o venue publica.
 *
 * A conta com a posicao e' o DUBLE DECLARADO da bateria da leitura (`leitura.casos.json`, base
 * `com_posicao`) — numeros que o venue NAO deu nesta leitura, e por isso usados aqui como duble e nao como
 * medicao. O que e' MEDIDO e' o `cloid` do preenchimento: e' ele que decide a posse, e e' essa a grandeza
 * deste caso.
 */
function lerPosicao(): Posicao | undefined {
  const bases = JSON.parse(readFileSync(join(RAIZ, "brokers", "hyperliquid", "casos", "leitura.casos.json"), "utf8")).bases;
  const conta = bases.com_posicao;
  conta.perpetuo.valor.assetPositions[0].position.szi = UNIDADES;
  conta.perpetuo.valor.assetPositions[0].position.entryPx = PRECO_MEDIO;
  const bruto = {
    conta,
    livro: { levels: [[{ px: "84366.0", sz: "1" }], [{ px: "84368.0", sz: "1" }]] },
    estado: { specialStatuses: null },
    velas: [{ c: PRECO_MEDIO }],
    ordens: [],
    execucoes: [{ coin: INSTRUMENTO, cloid: CLOID_DO_VENUE, time: TEMPO_DO_VENUE_MS - 60000 }],
  };
  const pedido = { conta: ENDERECO_DA_CONTA, instrumento: INSTRUMENTO, agora_ms: TEMPO_DO_VENUE_MS };
  const r = montarMercado(bruto, pedido);
  if (!r.ok) {
    exigir(false, `a leitura de mercado recusou o duble do caso (${r.motivo}: ${r.porque})`);
    return undefined;
  }
  // A carga do `mercado` vem do contrato e e' validada; a posicao le-se do que o venue respondeu.
  return r.mercado.carga.posicao as Posicao | undefined;
}

/** O ciclo sobre a posicao lida, com as marcas que a conta conhece: e' aqui que a posse se decide. */
function decidirSobre(posicao: Posicao | undefined, marcas: number[]): { acao: string; motivo: string | null } {
  const leitura = {
    instrumento: INSTRUMENTO,
    tempo_do_venue_ms: TEMPO_DO_VENUE_MS,
    idade_do_dado_ms: 100,
    estado_do_mercado: "aberto" as const,
    equity: "998.46",
    bid: "84366.0",
    ask: "84368.0",
    ultimo: PRECO_MEDIO,
    ordens_abertas: [] as readonly unknown[],
    ...(posicao === undefined ? {} : { posicao: posicao as LeituraCompacta["posicao"] }),
  };
  const proposta = { lado: "caixa", barra_ms: BARRA_DO_SINAL, setup: { nome: "manual", versao: "0.0.1" } };
  const entradas = lerParaOCiclo(leitura, proposta, 1);
  const decisao = decidirInstrumento({
    barra_do_sinal_esperada: BARRA_DO_SINAL,
    mercado: entradas.mercado,
    proposta: entradas.proposta,
    proposta_invalida: entradas.proposta_invalida,
    motivo_do_contrato: entradas.motivo_do_contrato,
    ficha: "3232",
    ciclo: 1,
    ligacao: "ligada",
    falhas: {},
    divergente: false,
    mandato: { saldo_pct: "1", alavancagem: "2" },
    template: {
      politica_de_execucao: "mercado",
      parcial: "o_que_der",
      desvio_maximo: "0.5",
      prazo_da_passiva_ms: 3000,
      destino_do_resto: "cancelar",
      stop_pct: "0.3",
      tp_pct: "0.6",
    },
    marcas_nossas_conhecidas: marcas,
    config: {
      eventos_que_avisam: ["desconhecido", "recusa", "divergencia", "falha_de_leitura", "cb", "encerramento", "contenda"],
    } as any,
    desconhecido: null,
  });
  return { acao: decisao.acao, motivo: decisao.motivo };
}

// ---------------------------------------------------------------------------------------------------------
// A GUARDA E A CHAVE ANTIGAS — o que estava no operador antes desta correccao. Ficam aqui como CONTROLE:
// o defeito so' esta' reproduzido se elas derem mesmo a posicao ALHEIA.

/** A guarda antiga, palavra a palavra: `aceita`/`preenchida` (nenhuma existe no conjunto fechado). */
function guardaAntiga(carga: Record<string, unknown>): boolean {
  return carga.classificacao === "aceita" || carga.classificacao === "preenchida";
}

console.log("=== a posse do preenchimento (o defeito de 01/10/2026, conta hl-teste-plugin) ===\n");

// ---- 1. a classificacao que o contrato tem, contra as palavras que a guarda antiga procurava ---------------

exigir(
  CLASSIFICACOES_QUE_CONFIRMAM_A_ORDEM.includes("aceite"),
  `\`aceite\` confirma a nossa ordem (o conjunto e' ${JSON.stringify(CLASSIFICACOES_QUE_CONFIRMAM_A_ORDEM)})`,
);
exigir(
  !CLASSIFICACOES_QUE_CONFIRMAM_A_ORDEM.includes("aceita") && !CLASSIFICACOES_QUE_CONFIRMAM_A_ORDEM.includes("preenchida"),
  "`aceita` e `preenchida` NAO estao no conjunto: sao palavras que o contrato nao tem",
);
exigir(
  guardaAntiga(DESFECHO_REAL) === false,
  "CONTROLE: a guarda ANTIGA (`aceita`/`preenchida`) nao reconhece o desfecho REAL — por isso o mapa ficou vazio",
);

// ---- 2. a chave: a que o venue guardou, contra a derivada do NOME ------------------------------------------

const doVenue = cloidDoPreenchimento(DESFECHO_REAL);
exigir(doVenue.ok && doVenue.cloid === CLOID_DO_VENUE, `a marca registada leva o \`cloid\` do VENUE (${CLOID_DO_VENUE})`);
const doNome = derivarCloid(CONTA_DA_FICHA, INSTRUMENTO, REFERENCIA);
const doEndereco = derivarCloid(ENDERECO_DA_CONTA, INSTRUMENTO, REFERENCIA);
exigir(doNome.ok && doNome.cloid !== CLOID_DO_VENUE, `CONTROLE: o \`cloid\` derivado do NOME (${doNome.ok ? doNome.cloid : "-"}) NAO e' o do venue`);
exigir(doEndereco.ok && doEndereco.cloid === CLOID_DO_VENUE, "o `cloid` do venue e' o derivado do ENDERECO (o que o conector usa)");

// ---- 3. BRACO ANTIGO: guarda antiga -> mapa vazio -> a posicao e' ALHEIA -----------------------------------

exigir(!guardaAntiga(DESFECHO_REAL), "o braco antigo nao escreve nada no mapa (e' o defeito: mapa VAZIO)");
const posicaoSemMapa = lerPosicao();
exigir(
  posicaoSemMapa === undefined || posicaoSemMapa.marca_de_posse === undefined,
  "sem mapa, a leitura entrega a posicao SEM marca (o venue nao atribui a posse por nos)",
);
const decideAlheia = decidirSobre(posicaoSemMapa, []);
exigir(
  decideAlheia.motivo === "posicao_alheia_relatada_nao_gerida",
  `BRACO ANTIGO reproduz o sintoma: ${decideAlheia.acao}:${String(decideAlheia.motivo)}`,
);

// ---- 4. BRACO NOVO: o venue confirma -> a marca e' registada -> a posicao e' NOSSA e a mesa gere-a -------

const confirmado = cloidDoPreenchimento(DESFECHO_REAL);
exigir(confirmado.ok, "o desfecho REAL confirma a nossa ordem (`aceite` + o `cloid` do preenchimento)");
if (confirmado.ok) apontarMarca(confirmado.cloid);
const mapaEscrito = existsSync(CAMINHO_DO_MAPA) && readFileSync(CAMINHO_DO_MAPA, "utf8").trim() !== "";
exigir(mapaEscrito, "a marca ficou registada no mapa (append-only)");

const posicaoComMapa = lerPosicao();
exigir(
  posicaoComMapa !== undefined && posicaoComMapa.marca_de_posse === MARCA,
  `com o mapa, a leitura atribui a posse: posicao.marca_de_posse = ${String(posicaoComMapa?.marca_de_posse)}`,
);
const decideNossa = decidirSobre(posicaoComMapa, [MARCA]);
exigir(
  decideNossa.motivo !== "posicao_alheia_relatada_nao_gerida",
  `BRACO NOVO: a mesma posicao ja' nao e' alheia (${decideNossa.acao}:${String(decideNossa.motivo)})`,
);
exigir(decideNossa.acao === "fechar", `e a mesa GERE-a: com a proposta ` + "`caixa`" + `, fecha (${decideNossa.acao})`);

// ---- 5. o fail-closed: sem confirmacao, e sem a chave do venue, nada se regista ----------------------------

for (const [nome, carga] of [
  ["recusado pelo venue", { ...DESFECHO_REAL, classificacao: "recusado", motivo: "minimo_nao_atingido" }],
  ["desconhecido (sem confirmacao)", { ...DESFECHO_REAL, classificacao: "desconhecido" }],
  ["confirmado mas sem `cloid` no bruto", { ...DESFECHO_REAL, resposta_do_venue: { estado: "filled", bruto: { totalSz: UNIDADES } } }],
] as [string, Record<string, unknown>][]) {
  const r = cloidDoPreenchimento(carga);
  exigir(r.ok === false, `fail-closed: um desfecho ${nome} nao regista marca nenhuma`);
}

rmSync(dir, { recursive: true, force: true });

console.log(`\nposse do preenchimento: ${verificacoes - falhas} de ${verificacoes} passaram`);
process.exit(falhas === 0 ? 0 : 1);
