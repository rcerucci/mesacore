// O ARRANQUE DO OPERADOR — os dois casos de regressao que faltavam ao defeito de posse (conta `hl-teste-plugin`).
//
// MOLDE: `posse-do-preenchimento.ts`, que mede a posse JA' com o mapa escrito (o desfecho -> a marca registada ->
// a leitura -> o ciclo). Este corredor mede as duas pecas que ficaram de fora, as duas no ARRANQUE do processo:
//
//   1. O REENVIO. Ao arrancar, o operador rele o registo desde o inicio (`posicaoNoRegisto = 0`) e o carteiro
//      reenviava TODAS as boletas que la' encontrasse — incluindo a abertura que ja' estava preenchida. Nesta
//      conta o registo tem exactamente UMA boleta (a ordem `61581177468`, 0.00117 BTC @ 84367.0), e reiniciar
//      reenviava-a: uma ordem a mais no venue. A PROVA de que uma boleta ja' saiu NAO e' um campo novo no
//      registo (nada la' o diz): e' o DESFECHO GRAVADO em `desfechos-<conta>.jsonl`.
//   2. A RECUPERACAO DO MAPA. O mapa (`marcas-<conta>.jsonl`) so' ganhava linhas em RUNTIME: ao reiniciar, o
//      processo novo nao sabia das marcas que o anterior ja' tinha confirmado, a posicao ABERTA lia-se SEM
//      marca, e a mesa relatava-a como alheia (`posicao_alheia_relatada_nao_gerida`) sem a gerir. O mapa
//      reconstroi-se dos desfechos confirmados, com a MESMA funcao do runtime (`cloidDoPreenchimento`).
//
// O QUE ESTE CORREDOR FAZ, e por que esta' montado assim: corre o ARRANQUE em dado e sem rede, sobre o
// ficheiro de desfechos REAL (a linha medida, transcrita abaixo e nao escrita), e mede as duas pecas pelos
// dois lados — o que ENTRA (a boleta que sai, ou nao) e o que SAI (a marca no mapa, e a decisao do ciclo):
//   (a) registo com uma boleta JA' ENVIADA (com desfecho) -> o arranque NAO a reenvia;
//   (b) registo com uma boleta SEM desfecho           -> REENVIA (o reenvio legitimo nao foi silenciado);
//   (c) o mapa reconstroi-se do desfecho real -> `cloid 0xbf62594c...` + marca 902, e a posicao passa a NOSSA.
//
// Uso:  bun tools/verificar-conector/arranque-do-operador.ts
// Sai 1 se algum passo divergir; a ultima linha diz `arranque do operador: N de M passaram`.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { montarMercado } from "../../brokers/hyperliquid/leitura-do-mercado.ts";
import { decidirInstrumento } from "../../core/ciclo/ciclo.ts";
import { lerParaOCiclo, type LeituraCompacta } from "../../core/leitura/fixtures.ts";
import { enviosJaRegistados, jaSaiu, reconstruirMapaDeMarcas, type EnvioRegistado } from "../../vigia/arranque.ts";

const RAIZ = join(import.meta.dir, "..", "..");

/** A posicao como o caso a mede (a mesma forma do molde): `marca_de_posse` OPCIONAL — sem marca, e' ALHEIA. */
type Posicao = { lado: "buy" | "sell"; unidades: string; preco_medio: string; marca_de_posse?: number };

// ---------------------------------------------------------------------------------------------------------
// OS NUMEROS DO DEFEITO — transcritos do que a corrida deixou em `corrida-de-risco/` (a PROVA, que se le' e
// nao se escreve): o desfecho do venue e a boleta do registo.

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

/** A LINHA REAL de `desfechos-hl-teste-plugin.jsonl`, byte a byte — o que o venue respondeu a' nossa ordem. */
const LINHA_REAL_DE_DESFECHO =
  '{"quando":"2026-10-01T17:01:27.413Z","marca":902,"referencia":"mesa-sigma_v0-000902","instrumento":"BTC",' +
  '"recusado":false,"desfecho":{"classificacao":"aceite","resolucao":{"quantidade":"0.00117","nocional":' +
  '"99.16686","margem_empenhada":"99.16","alavancagem_efectiva":"1","preco_de_liquidacao":"0"},' +
  '"resposta_do_venue":{"estado":"filled","order_id":"61581177468","preenchido":"0.00117","preco_medio":' +
  '"84367.0","origem_dos_numeros":"calculo_antes_do_envio (a posicao do venue nao publica preco de liquidacao)",' +
  '"bruto":{"totalSz":"0.00117","avgPx":"84367.0","oid":61581177468,"cloid":"0xbf62594cce5cacfd083dd6d15cd97aa8"}}}}';

/** A BOLETA REAL do registo (linha 1843): a mesa decidiu `abrir`, com a marca de posse 902. */
const BOLETA_REAL: Record<string, unknown> = {
  instrumento: INSTRUMENTO,
  lado: "buy",
  tipo: "mercado",
  saldo_pct: "10",
  alavancagem: "1",
  parcial: "o_que_der",
  desvio_maximo: "0.5",
  prazo_da_passiva_ms: 3000,
  destino_do_resto: "agressivo",
  reduce_only: false,
  referencia_do_cliente: REFERENCIA,
  marca_de_posse: MARCA,
};

/** O REGISTO com UMA boleta — a linha real, na forma em que o operador a reencontra ao arrancar. */
const REGISTO_COM_A_BOLETA =
  JSON.stringify({
    instante_ms: 1790874079485,
    tipo: "ciclo",
    instrumento: INSTRUMENTO,
    acao: "abrir",
    motivo: null,
    nota: "ciclo 902, condicao normal, com boleta",
    boleta: BOLETA_REAL,
    barra_ms: 1790874000000,
  }) + "\n";

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

/**
 * O CARDEIRO em dado: percorre o registo como `levarBoletas` faz (so' as linhas de `tipo: "ciclo"` com
 * `boleta`) e devolve as REFERENCIAS que ele levaria — aplicando a MESMA regra do arranque (`jaSaiu`).
 * Fica aqui o laco (como no molde fica o `apontarMarca`); a REGRA vem do modulo, e nao e' re-derivada.
 */
function referenciasQueOCarteiroLeva(textoDoRegisto: string, jaEnviados: Map<string, EnvioRegistado>): string[] {
  const leva: string[] = [];
  for (const l of textoDoRegisto.split("\n").filter((l) => l.trim() !== "")) {
    let o: any;
    try {
      o = JSON.parse(l);
    } catch {
      continue;
    }
    if (o?.tipo !== "ciclo" || o?.boleta === null || o?.boleta === undefined) continue;
    const referenciaBruta = (o.boleta as Record<string, unknown>).referencia_do_cliente;
    if (referenciaBruta === undefined || referenciaBruta === null || String(referenciaBruta) === "") continue;
    const referencia = String(referenciaBruta);
    if (jaSaiu(referencia, jaEnviados)) continue;
    leva.push(referencia);
  }
  return leva;
}

/**
 * A LEITURA DE MERCADO, com a posicao viva do defeito e o preenchimento que o venue publica. O que e' MEDIDO
 * aqui e' a POSSE: o `cloid` do preenchimento cruzado com o mapa. A conta com a posicao e' o DUBLE DECLARADO
 * da bateria da leitura (`leitura.casos.json`, base `com_posicao`) — os numeros dela nao vieram deste venue.
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

const dir = mkdtempSync(join(tmpdir(), "mesacore-arranque-"));
const CAMINHO_DOS_DESFECHOS = join(dir, `desfechos-${CONTA_DA_FICHA}.jsonl`);
const CAMINHO_DO_MAPA = join(dir, `marcas-${CONTA_DA_FICHA}.jsonl`);
process.env.MARCAS_DA_CONTA = CAMINHO_DO_MAPA;

console.log("=== o arranque do operador (o reenvio e o mapa, conta hl-teste-plugin) ===\n");

// ---- 1. O REENVIO: o que ja' saiu, e o que ainda tem de sair --------------------------------------------

writeFileSync(CAMINHO_DOS_DESFECHOS, LINHA_REAL_DE_DESFECHO + "\n");
const jaEnviados = enviosJaRegistados(CAMINHO_DOS_DESFECHOS);
exigir(jaEnviados.size === 1 && jaEnviados.has(REFERENCIA), `o desfecho gravado prova UM envio: \`${REFERENCIA}\``);
exigir(
  jaSaiu(REFERENCIA, jaEnviados),
  "caso (a): a boleta JA' enviada e' reconhecida — o arranque NAO a reenvia",
);
const levaComArranque = referenciasQueOCarteiroLeva(REGISTO_COM_A_BOLETA, jaEnviados);
exigir(levaComArranque.length === 0, `e o carteiro do arranque nao leva nada (levava ${JSON.stringify(levaComArranque)})`);

// O CONTROLE do defeito: sem a memoria do arranque — que e' o que estava la' — a MESMA boleta SAI.
const semMemoriaDoArranque = new Map<string, EnvioRegistado>();
const levaSemMemoria = referenciasQueOCarteiroLeva(REGISTO_COM_A_BOLETA, semMemoriaDoArranque);
exigir(
  levaSemMemoria.length === 1 && levaSemMemoria[0] === REFERENCIA,
  `CONTROLE: sem a memoria do arranque, o carteiro leva a boleta JA' preenchida (${JSON.stringify(levaSemMemoria)}) — e' o defeito`,
);

// O GEMEO, que impede o silencio: uma boleta SEM desfecho TEM de sair — foi enviada e o venue nao respondeu.
const CAMINHO_SEM_DESFECHO = join(dir, "desfechos-sem-linhas.jsonl");
writeFileSync(CAMINHO_SEM_DESFECHO, "");
const semDesfecho = enviosJaRegistados(CAMINHO_SEM_DESFECHO);
exigir(semDesfecho.size === 0, "um ficheiro de desfechos sem linhas prova zero envios");
exigir(!jaSaiu(REFERENCIA, semDesfecho), "caso (b): uma boleta SEM desfecho NAO e' dada como enviada");
const levaSemDesfecho = referenciasQueOCarteiroLeva(REGISTO_COM_A_BOLETA, semDesfecho);
exigir(
  levaSemDesfecho.length === 1 && levaSemDesfecho[0] === REFERENCIA,
  `caso (b): o carteiro REENVIA (${JSON.stringify(levaSemDesfecho)}) — o reenvio legitimo nao foi silenciado`,
);

// ---- 2. A RECUPERACAO DO MAPA: o desfecho confirmado -> o mapa -> a posse e' NOSSA ----------------------

// ANTES: o processo novo nao reconstruiu nada e o mapa nao existe -> a posicao vem SEM marca, e e' ALHEIA.
const posicaoSemMapa = lerPosicao();
exigir(
  posicaoSemMapa === undefined || posicaoSemMapa.marca_de_posse === undefined,
  "antes: sem mapa reconstruido, a leitura entrega a posicao SEM marca",
);
const decideAlheia = decidirSobre(posicaoSemMapa, []);
exigir(
  decideAlheia.motivo === "posicao_alheia_relatada_nao_gerida",
  `antes: a mesma posicao le-se como ALHEIA (${decideAlheia.acao}:${String(decideAlheia.motivo)})`,
);

const reconstrucao = reconstruirMapaDeMarcas(CAMINHO_DOS_DESFECHOS, CAMINHO_DO_MAPA);
exigir(
  reconstrucao.desfechos_lidos === 1 && reconstrucao.marcas_reconstruidas === 1,
  `a reconstrucao leu ${reconstrucao.desfechos_lidos} desfecho(s) e acrescentou ${reconstrucao.marcas_reconstruidas} marca(s)`,
);
const linhasDoMapa = existsSync(CAMINHO_DO_MAPA)
  ? readFileSync(CAMINHO_DO_MAPA, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { cloid: string; marca: number; referencia: string; instrumento: string })
  : [];
exigir(linhasDoMapa.length === 1, `o mapa escrito tem UMA linha (tem ${linhasDoMapa.length})`);
exigir(
  linhasDoMapa[0]?.cloid === CLOID_DO_VENUE && linhasDoMapa[0]?.marca === MARCA,
  `o mapa reconstruido tem o cloid do VENUE (${String(linhasDoMapa[0]?.cloid)}) e a marca ${String(linhasDoMapa[0]?.marca)}`,
);

// Reconstruir outra vez (o proximo reinicio) NAO duplica a linha: o mapa e' append-only, e o que ja' la' esta' fica.
const reconstrucao2 = reconstruirMapaDeMarcas(CAMINHO_DOS_DESFECHOS, CAMINHO_DO_MAPA);
exigir(
  reconstrucao2.marcas_reconstruidas === 0 && reconstrucao2.marcas_ja_no_mapa === 1,
  `reconstruir outra vez nao duplica (${reconstrucao2.marcas_reconstruidas} novas, ${reconstrucao2.marcas_ja_no_mapa} ja' no mapa)`,
);

// As marcas que a operacao leva a mesa saem do MAPA (a mesma conta de `marcasConhecidasDaConta`).
const marcas = [...new Set(linhasDoMapa.map((m) => m.marca))];
const posicaoComMapa = lerPosicao();
exigir(
  posicaoComMapa !== undefined && posicaoComMapa.marca_de_posse === MARCA,
  `depois: com o mapa reconstruido, a posse e' NOSSA — posicao.marca_de_posse = ${String(posicaoComMapa?.marca_de_posse)}`,
);
const decideNossa = decidirSobre(posicaoComMapa, marcas);
exigir(
  decideNossa.motivo !== "posicao_alheia_relatada_nao_gerida",
  `depois: a mesma posicao ja' nao e' alheia (${decideNossa.acao}:${String(decideNossa.motivo)})`,
);
exigir(decideNossa.acao === "fechar", `e a mesa GERE-a: com a proposta \`caixa\`, fecha (${decideNossa.acao})`);

// ---- 3. O fail-closed: o que nao confirma nao vira marca, e o que nao se le' RECUSA o arranque ----------

// Uma RESOLUCAO (e nao um desfecho) prova o envio — a boleta saiu — e NAO confirma a posse: nao produz marca.
const cargaRecusada = { ...JSON.parse(LINHA_REAL_DE_DESFECHO).desfecho, classificacao: "recusado", motivo: "minimo_nao_atingido" };
const REFERENCIA_RECUSADA = "mesa-sigma_v0-000903";
const CAMINHO_RECUSADO = join(dir, "desfechos-recusado.jsonl");
writeFileSync(
  CAMINHO_RECUSADO,
  JSON.stringify({
    quando: "2026-10-01T18:00:00.000Z",
    marca: 903,
    referencia: REFERENCIA_RECUSADA,
    instrumento: INSTRUMENTO,
    recusado: false,
    desfecho: cargaRecusada,
  }) + "\n",
);
exigir(jaSaiu(REFERENCIA_RECUSADA, enviosJaRegistados(CAMINHO_RECUSADO)), "uma boleta RECUSADA pelo venue tambem ja' saiu: nao se reenvia");
const CAMINHO_MAPA_RECUSADO = join(dir, "marcas-recusado.jsonl");
const reconstrucaoRecusada = reconstruirMapaDeMarcas(CAMINHO_RECUSADO, CAMINHO_MAPA_RECUSADO);
exigir(
  reconstrucaoRecusada.desfechos_que_nao_confirmam === 1 && reconstrucaoRecusada.marcas_reconstruidas === 0,
  "mas um desfecho que NAO confirma nao vira marca: o mapa nao ganha nada",
);
exigir(!existsSync(CAMINHO_MAPA_RECUSADO), "e o mapa nem chega a ser escrito (nao ha' nada a acrescentar)");

// Uma linha ilegivel RECUSA o arranque inteiro: nao se salta por cima de um buraco no registo das ordens.
const CAMINHO_COM_BURACO = join(dir, "desfechos-com-buraco.jsonl");
writeFileSync(CAMINHO_COM_BURACO, LINHA_REAL_DE_DESFECHO + "\n" + '{"quando":"2026-10-01T18:01:00.000Z","marca":904,"referen');
let recusou = false;
let razao = "";
try {
  enviosJaRegistados(CAMINHO_COM_BURACO);
} catch (e) {
  recusou = true;
  razao = e instanceof Error ? e.message : String(e);
}
exigir(recusou && razao.includes("ilegivel"), `fail-closed: uma linha ilegivel recusa o arranque (${razao.slice(0, 72)}...)`);

rmSync(dir, { recursive: true, force: true });

console.log(`\narranque do operador: ${verificacoes - falhas} de ${verificacoes} passaram`);
process.exit(falhas === 0 ? 0 : 1);
