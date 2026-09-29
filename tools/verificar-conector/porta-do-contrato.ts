#!/usr/bin/env bun
// A PORTA DO CONTRATO, do lado do conector: as emendas ATRAVESSAM os dois motores, e provam-se.
//
//   bun tools/verificar-conector/porta-do-contrato.ts [--prova-negativa]
//
// Porque existe: a emenda 1.4.0 mudou o nome de uma grandeza, a forma de um escalao, e acrescentou duas
// declaracoes por instrumento (a cadencia do funding e o deslistado); a emenda 1.5.0 alargou a forma da
// moeda, tornou dois campos do historico OPCIONAIS (o resultado por instrumento e a referencia de cliente
// por execucao), admitiu as DUAS formas da marca de posse que o manifesto pode declarar e declarou a
// ausencia do funding por execucao — as cinco razoes pelas quais o historico da Hyperliquid era RECUSADO
// pelo contrato. Uma emenda dessas pode ficar a meio caminho de tres maneiras, e nenhuma delas se ve a olho:
//
//   1. o vocabulario do contrato e um CONJUNTO FECHADO, e um motivo novo que entre num lado e nao no outro
//      deixa as duas linguagens a recusar com nomes diferentes (ou uma delas a aceitar um nome que a outra
//      nao conhece);
//   2. os dois motores do contrato — o TypeScript (`contracts/esqueleto/casos.ts`) e o Python
//      (`contracts/esqueleto/casos.py`) — tem de decidir IGUAL em TODOS os casos declarados, um a um;
//   3. e, sobretudo, o que a emenda RETIROU tem de REPROVAR: um manifesto que ainda traga o nome velho
//      (`teto_de_valor_por_ordem`), um escalao com `ate`, um campo a mais, um motivo fora do vocabulario.
//      Isto e' medido nos DOIS motores, porque uma prova negativa que so corre num lado nao prova nada
//      sobre o outro.
//
// Nao escreve no repositorio: os relatorios dos motores vao para o directorio temporario. Nao fala com o
// venue: nada aqui precisa de rede nem de chave.
//
// Saida 0 = as quatro provas passam. Saida 1 = ha falhas, listadas.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// O motor do contrato e o comparador de decimais: o MESMO modulo que a bateria de conformidade usa.
import { compararDecimais, conferir } from "../../contracts/esqueleto/conferir.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const CONTRATOS = join(RAIZ, "contracts");
const FORMA = join(CONTRATOS, "_defs", "forma.schema.json");

const provaNegativa = process.argv.includes("--prova-negativa");
let falhas = 0;
/** Durante as vacinas as falhas sao as ESPERADAS: imprimi-las so sujaria a leitura da porta. */
let silencioso = false;

function lerJson(caminho: string): any {
  return JSON.parse(readFileSync(caminho, "utf8"));
}
function exigir(condicao: boolean, porque: string): boolean {
  if (!condicao) {
    falhas += 1;
    if (!silencioso) console.log(`FALHOU  ${porque}`);
  }
  return condicao;
}
function declarar(prova: string): void {
  console.log(`\nPORTA — ${prova}`);
}

const versao = lerJson(join(CONTRATOS, "versao.json")).contrato as string;
const vocabulario = lerJson(join(CONTRATOS, "vocabulario.json"));
const forma = lerJson(FORMA);

// O duble do conector guarda o estado do venue num ficheiro ignorado no git. Uma PORTA LE — nao deixa
// ordens atras de si: o estado e' guardado aqui, antes da primeira sonda, e reposto no fim, byte a byte.
const estadoDoVenue = join(CONTRATOS, "mocks", "conector", ".estado-do-venue.json");
const estadoGuardado = existsSync(estadoDoVenue) ? readFileSync(estadoDoVenue) : null;

// ---------------------------------------------------------------------------------------------------
// PROVA 1 — a versao: uma so casa, e os dois motores dizem a mesma
// ---------------------------------------------------------------------------------------------------

declarar(`versao do contrato: ${versao}, declarada numa so casa`);

exigir(vocabulario.contrato === versao, `vocabulario.json declara ${vocabulario.contrato} e versao.json declara ${versao}`);
exigir(
  (forma.$defs?.motivo?.enum as string[])?.includes("instrumento_deslistado_no_venue") === true,
  "o espelho do vocabulario (_defs/forma.schema.json) nao conhece os motivos da emenda 1.4.0",
);

// ---------------------------------------------------------------------------------------------------
// PROVA 2 — o vocabulario fechado: fecha nas DUAS direcoes
// ---------------------------------------------------------------------------------------------------

const motivos = Object.keys(vocabulario.motivos ?? {});
const prioridade: string[] = vocabulario.prioridade_dos_motivos ?? [];
const noEspelho = new Set<string>((forma.$defs?.motivo?.enum as string[]) ?? []);

function conferirVocabulario(voc: { motivos: Record<string, unknown> }, espelho: Set<string>, ordem: string[]): number {
  const antes = falhas;
  for (const nome of Object.keys(voc.motivos)) {
    exigir(espelho.has(nome), `o motivo '${nome}' existe no vocabulario e nao no espelho do esquema`);
  }
  for (const nome of espelho) {
    exigir(nome in voc.motivos, `o motivo '${nome}' existe no espelho do esquema e nao no vocabulario`);
  }
  for (const nome of ordem) {
    exigir(nome in voc.motivos, `a prioridade nomeia '${nome}', que nao existe no vocabulario`);
  }
  return falhas - antes;
}

declarar(`motivos: o conjunto fechado fecha nas duas direcoes (${motivos.length} motivos, ${prioridade.length} na prioridade)`);
conferirVocabulario(vocabulario, noEspelho, prioridade);

// ---------------------------------------------------------------------------------------------------
// PROVA 3 — a paridade: os dois motores, caso a caso, sobre TODOS os casos do contrato
// ---------------------------------------------------------------------------------------------------

type Leitura = { caso: string; mensagem: string; veredicto: string; motivo: string | null; esperado_ok: boolean };

function correrMotor(implementacao: "ts" | "py", relatorio: string): { leituras: Leitura[]; resumo: string } {
  const comando =
    implementacao === "ts"
      ? ["bun", "run", "esqueleto/casos.ts", "--relatorio", relatorio]
      : ["uv", "run", "python", "esqueleto/casos.py", "--relatorio", relatorio];
  const saida = spawnSync(comando[0], comando.slice(1), { cwd: CONTRATOS, encoding: "utf8" });
  if (saida.status !== 0) {
    console.log(`  (o motor ${implementacao} saiu com ${saida.status})`);
    console.log(`${saida.stdout ?? ""}${saida.stderr ?? ""}`.split("\n").slice(-8).join("\n"));
  }
  const leituras: Leitura[] = (saida.stdout ?? "")
    .split("\n")
    .filter((l) => l.trim().startsWith("{"))
    .map((l) => JSON.parse(l));
  const resumo = `${saida.stderr ?? ""}`.trim().split("\n").filter((l) => l.includes("casos")).slice(-1)[0] ?? "";
  return { leituras, resumo, };
}

/** Compara as duas leituras caso a caso. Devolve quantas divergencias encontrou (e conta-as nas falhas). */
function comparar(ts: Leitura[], py: Leitura[]): number {
  const antes = falhas;
  const chave = (l: Leitura) => `${l.mensagem}::${l.caso}`;
  const doTs = new Map(ts.map((l) => [chave(l), l]));
  const doPy = new Map(py.map((l) => [chave(l), l]));
  for (const [k, a] of doTs) {
    const b = doPy.get(k);
    if (b === undefined) {
      exigir(false, `${k}: o motor Python nao leu este caso`);
      continue;
    }
    exigir(
      a.veredicto === b.veredicto && a.motivo === b.motivo,
      `${k}: TS decide ${a.veredicto}/${a.motivo} e Python decide ${b.veredicto}/${b.motivo}`,
    );
    exigir(a.esperado_ok === true, `${k}: o caso nao tem o veredicto que declara (${a.veredicto}/${a.motivo})`);
  }
  for (const k of doPy.keys()) exigir(doTs.has(k), `${k}: o motor TypeScript nao leu este caso`);
  return falhas - antes;
}

const relatorioTs = join(tmpdir(), "porta-do-contrato-ts.jsonl");
const relatorioPy = join(tmpdir(), "porta-do-contrato-py.jsonl");
const esquerda = correrMotor("ts", relatorioTs);
const direita = correrMotor("py", relatorioPy);

declarar("paridade: os dois motores, caso a caso");
for (const [motor, leitura] of [["ts", esquerda], ["py", direita]] as const) {
  exigir(leitura.resumo.includes(`contrato ${versao}`), `o resumo do motor ${motor} nao nomeia a versao ${versao}: "${leitura.resumo}"`);
}
console.log(`  ${esquerda.resumo}`);
console.log(`  ${direita.resumo}`);
comparar(esquerda.leituras, direita.leituras);

// ---------------------------------------------------------------------------------------------------
// PROVA 4 — a emenda: o que ela RETIROU tem de REPROVAR, nos dois motores
// ---------------------------------------------------------------------------------------------------

const boleta: any = (() => {
  const casos = lerJson(join(CONTRATOS, "casos", "boleta.casos.json"));
  const caso = casos.casos.find((c: any) => c.veredicto_esperado === "aceite");
  return caso.entrada;
})();
const manifesto: any = (() => {
  const casos = lerJson(join(CONTRATOS, "casos", "manifesto.casos.json"));
  const caso = casos.casos.find((c: any) => (c.nome ?? c.caso) === "manifesto/completo");
  return caso.entrada;
})();
const desfecho: any = (() => {
  const casos = lerJson(join(CONTRATOS, "casos", "desfecho.casos.json"));
  const caso = casos.casos.find((c: any) => c.veredicto_esperado === "aceite" && c.entrada?.carga?.classificacao === "recusado");
  return caso.entrada;
})();

function clonar<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const sondaDeMao = [
  { nome: "manifesto com o nome VELHO do campo do piso (`teto_de_valor_por_ordem`)",
    mensagem: (() => { const m = clonar(manifesto); const carga = m.carga;
      carga.teto_de_valor_por_ordem = carga.minimo_de_valor_por_ordem; delete carga.minimo_de_valor_por_ordem; return m; })(),
    motivo: "campo_desconhecido" },
  { nome: "manifesto com o escalao no limite SUPERIOR (`ate`), que a 1.4.0 retirou",
    mensagem: (() => { const m = clonar(manifesto);
      m.carga.instrumentos[0].alavancagem_por_escalao = [{ ate: "50000", maxima: "30" }]; return m; })(),
    motivo: "campo_desconhecido" },
  { nome: "manifesto com a cadencia do funding fora da banda (`funding_intervalo_horas: 0`)",
    mensagem: (() => { const m = clonar(manifesto); m.carga.instrumentos[0].funding_intervalo_horas = 0; return m; })(),
    motivo: "valor_fora_da_banda" },
  { nome: "manifesto com o deslistado a mentir (`deslistado: \"sim\"`)",
    mensagem: (() => { const m = clonar(manifesto); m.carga.instrumentos[0].deslistado = "sim"; return m; })(),
    motivo: "tipo_invalido" },
  { nome: "boleta com um campo a mais (campo a mais RECUSA a mensagem inteira)",
    mensagem: (() => { const b = clonar(boleta); b.carga.taxa_de_corretagem = "0.0002"; return b; })(),
    motivo: "campo_desconhecido" },
  { nome: "desfecho com um motivo FORA do vocabulario",
    mensagem: (() => { const d = clonar(desfecho); d.carga.motivo = "motivo_que_nao_existe_em_livro_nenhum"; return d; })(),
    motivo: "valor_fora_do_conjunto" },
];

/** Valida uma mensagem nos DOIS motores (TS importado, Python por subprocesso) e devolve os dois veredictos. */
function nosDoisMotores(mensagem: unknown): { ts: { veredicto: string; motivo: string | null }; py: { veredicto: string; motivo: string | null } } {
  const texto = JSON.stringify(mensagem);

  // TS: importado directamente — o mesmo modulo que a bateria do contrato usa.
  const programa = `import { validar } from ${JSON.stringify(join(CONTRATOS, "esqueleto", "framing.ts"))};
const texto = require("node:fs").readFileSync(0, "utf8");
const d = validar(texto);
console.log(JSON.stringify({ veredicto: d.veredicto, motivo: d.motivo ?? null }));`;
  const ts = spawnSync("bun", ["-e", programa], { input: texto, encoding: "utf8" });

  // PY: o motor Python, pelo seu proprio modulo de enquadramento.
  const py = spawnSync(
    "uv",
    ["run", "python", "-c",
      `import json, sys
sys.path.insert(0, "esqueleto")
from framing import validar
d = validar(sys.stdin.read())
print(json.dumps({"veredicto": d["veredicto"], "motivo": d.get("motivo")}))`],
    { cwd: CONTRATOS, input: texto, encoding: "utf8" },
  );

  const ler = (saida: string) => {
    const linha = saida.split("\n").find((l) => l.trim().startsWith("{"));
    return linha ? JSON.parse(linha) : { veredicto: "(sem saida)", motivo: null };
  };
  return { ts: ler(ts.stdout ?? ""), py: ler(py.stdout ?? "") };
}

declarar(`emenda 1.4.0: ${sondaDeMao.length} mensagens que a emenda tem de REPROVAR, nos dois motores`);
for (const sonda of sondaDeMao) {
  const { ts, py } = nosDoisMotores(sonda.mensagem);
  exigir(
    ts.veredicto === "recusado" && ts.motivo === sonda.motivo,
    `TS: ${sonda.nome} deu ${ts.veredicto}/${ts.motivo}, esperado recusado/${sonda.motivo}`,
  );
  exigir(
    py.veredicto === "recusado" && py.motivo === sonda.motivo,
    `PY: ${sonda.nome} deu ${py.veredicto}/${py.motivo}, esperado recusado/${sonda.motivo}`,
  );
  console.log(`  recusado ${sonda.motivo} nos dois motores — ${sonda.nome}`);
}

// ---------------------------------------------------------------------------------------------------
// PROVA 5 — o MESMO caso, nos DOIS lados: o motor do contrato (TypeScript) e o duble do conector (Python)
// ---------------------------------------------------------------------------------------------------
//
// Uma emenda que so' entra num lado nao esta' feita: os casos de conformidade declaram o que tem de
// acontecer, e os DOIS lados tem de o decidir igual — o motor do contrato, que confere a boleta contra o
// manifesto, e o duble do conector, que responde como o venue responde. Aqui correm-se os MESMOS casos
// (o mesmo manifesto-fixture, a mesma boleta) nos dois, e comparam-se os dois veredictos.

type RespostaDoDuble = { veredicto: string; motivo: string | null; nocional: string | null; minimo: string | null };

/** Duas divergencias ANTERIORES a 1.4.0 (o duble nao modela estas duas regras): medidas, nomeadas, e da
 *  frente da mesa. Qualquer divergencia que nao esteja nesta lista REPROVA a porta. */
const DIVERGENCIAS_ANTERIORES = new Map<string, string>([
  ["conferencia/reduce-only-sem-declaracao", "o duble nao modela reduce_only_suportado (anterior a 1.4.0)"],
  ["conferencia/desvio-acima-do-que-o-venue-aceita", "o duble nao modela desvio_maximo (anterior a 1.4.0)"],
]);
const vistas = new Set<string>();

function falarComODuble(manifesto: any, alvo: any): RespostaDoDuble | null {
  if (alvo.tipo !== "boleta") return null;
  const caminho = join(tmpdir(), "porta-manifesto-em-vigor.json");
  writeFileSync(caminho, JSON.stringify(manifesto));
  const boleta = { contrato: manifesto.versao, tipo: "boleta", id: "porta-do-contrato", carga: alvo.carga };
  const saida = spawnSync("uv", ["run", "python", "mocks/conector/main.py", "--manifesto", caminho], {
    cwd: CONTRATOS,
    input: JSON.stringify(boleta),
    encoding: "utf8",
  });
  // O duble fala duas vezes: primeiro a `resolucao` que enviaria ao venue, depois o `desfecho`. O que se
  // compara aqui e o DESFECHO — a resposta final, que e o que a mesa recebe.
  const linhas = (saida.stdout ?? "").split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l));
  const desfecho = linhas.filter((l) => l.tipo === "desfecho").slice(-1)[0];
  if (desfecho === undefined) return null;
  const carga = desfecho.carga;
  return {
    veredicto: carga.classificacao,
    motivo: carga.motivo ?? null,
    nocional: carga.resolucao?.nocional ?? null,
    minimo: carga.resposta_do_venue?.minimo ?? manifesto.minimo_de_valor_por_ordem ?? null,
  };
}

function compararOsDoisLados(casos: any[], declarados: any, falar = falarComODuble): number {
  const antes = falhas;
  for (const caso of casos) {
    const manifesto = declarados[caso.manifesto];
    const doMotor = conferir(manifesto, caso.alvo);
    const doDuble = falar(manifesto, caso.alvo);
    if (doDuble === null) continue;
    exigir(
      doMotor.veredicto === caso.veredicto_esperado && doMotor.motivo === (caso.motivo_esperado ?? null),
      `${caso.nome}: o motor do contrato deu ${doMotor.veredicto}/${doMotor.motivo}, e o caso declara ${caso.veredicto_esperado}/${caso.motivo_esperado ?? null}`,
    );
    if (doDuble.veredicto !== doMotor.veredicto || doDuble.motivo !== doMotor.motivo) {
      const anterior = DIVERGENCIAS_ANTERIORES.get(caso.nome);
      if (anterior === undefined) {
        exigir(false, `${caso.nome}: o motor diz ${doMotor.veredicto}/${doMotor.motivo} e o duble (Python) diz ${doDuble.veredicto}/${doDuble.motivo}`);
      }
      vistas.add(caso.nome);
      continue;
    }
    vistas.add(caso.nome);
  }
  return falhas - antes;
}

const conformidade = lerJson(join(CONTRATOS, "casos", "conferencia.conformidade.json"));
const casosDeBoleta = conformidade.casos.filter((c: any) => c.alvo.tipo === "boleta");

declarar(`os dois lados, sobre as MESMAS boletas (${casosDeBoleta.length} casos de conformidade)`);
compararOsDoisLados(casosDeBoleta, conformidade.manifestos);
console.log(
  `  ${casosDeBoleta.length} casos nas duas linguagens · ` +
    `${vistas.size - DIVERGENCIAS_ANTERIORES.size} concordam · ` +
    `${[...DIVERGENCIAS_ANTERIORES.keys()].filter((k) => vistas.has(k)).length} divergencias anteriores a 1.4.0 (nomeadas)`,
);

// ---------------------------------------------------------------------------------------------------
// PROVA 6 — as BANDAS que a 1.4.0 passou a distinguir, medidas no duble (o lado Python)
// ---------------------------------------------------------------------------------------------------
//
// O piso e o escalao nao se alcancam por uma boleta declarada: dependem do nocional, que e' o duble quem
// calcula. Mede-se entao com percentagens, e confere-se o NOCIONAL que o proprio duble reporta — porque
// uma recusa pelo motivo certo com o nocional do lado errado da banda nao provava nada.

const boletaModelo = (() => {
  const caso = conformidade.casos.find((c: any) => c.nome === "conferencia/boleta-valida-no-manifesto-completo");
  return caso.alvo.carga;
})();

/** A sonda troca o piso pela percentagem: e' o duble que calcula o nocional, e o que se confere e' o
 *  NOCIONAL que ele mesmo reporta, contra o minimo — uma recusa pelo motivo certo com o nocional do lado
 *  errado da banda nao provava nada. Cada sonda traz uma referencia propria: a mesma referencia faria o
 *  duble responder do historico (idempotencia), e mediria a sonda anterior. */
const bandas = [
  { nome: "abaixo do PISO", fixture: "completo", pct: "0.9", esperado: "recusado", motivo: "valor_abaixo_do_minimo_do_venue", lado: "abaixo" },
  { nome: "no LIMITE do piso (igual PASSA)", fixture: "completo", pct: "1", esperado: "aceite", motivo: null, lado: "no-limite" },
  { nome: "acima do piso, dentro do primeiro escalao", fixture: "completo", pct: "2", esperado: "aceite", motivo: null, lado: "acima" },
  { nome: "fora de TODOS os escaloes (o primeiro `de` e' 501)", fixture: "escaloes_a_partir_de_501", pct: "10", esperado: "recusado", motivo: "valor_fora_da_banda", lado: "acima" },
];

// O estado do venue, guardado no inicio da porta (ver o topo do ficheiro): reposto no fim, byte a byte,
// porque uma PORTA LE — as sondas do duble nao podem deixar ordens atras de si.
declarar(`as bandas da emenda, medidas no duble (${bandas.length} sondas de nocional)`);
for (const banda of bandas) {
  const manifesto = conformidade.manifestos[banda.fixture];
  const referencia = `porta-do-contrato-${banda.pct}`;
  const resposta = falarComODuble(manifesto, {
    tipo: "boleta",
    carga: { ...boletaModelo, saldo_pct: banda.pct, alavancagem: "1", referencia_do_cliente: referencia },
  });
  if (resposta === null) {
    exigir(false, `${banda.nome}: o duble nao respondeu`);
    continue;
  }
  exigir(
    resposta.veredicto === banda.esperado && resposta.motivo === banda.motivo,
    `${banda.nome}: o duble deu ${resposta.veredicto}/${resposta.motivo}, esperado ${banda.esperado}/${banda.motivo}`,
  );
  const minimo = resposta.minimo ?? manifesto.minimo_de_valor_por_ordem;
  const lado =
    resposta.nocional === null || minimo === undefined
      ? "?"
      : { "-1": "abaixo", "0": "no-limite", "1": "acima" }[String(compararDecimais(resposta.nocional, minimo))];
  exigir(
    lado === banda.lado,
    `${banda.nome}: o nocional ${resposta.nocional} contra o minimo ${minimo} ficou ${lado}, e a sonda queria ${banda.lado}`,
  );
  console.log(`  ${banda.nome}: nocional ${resposta.nocional} vs minimo ${minimo} — ${resposta.veredicto}/${resposta.motivo} no duble`);
}

// ---------------------------------------------------------------------------------------------------
// PROVA 7 — as emendas 1.5.0 e 1.6.0: as razoes MEDIDAS contra o venue REAL, cada uma com a sua prova negativa
// ---------------------------------------------------------------------------------------------------
//
// Porque existe: o HISTORICO da Hyperliquid era RECUSADO pelo contrato por cinco razoes medidas contra o
// venue a serio (specs/004-conector-hyperliquid/relatorios/emenda-1.5.0.txt). A 1.5.0 alargou a forma da
// moeda (o venue escreve `USDC`), tornou o resultado por instrumento opcional (a fonte e' POR EXECUCAO), 
// admitiu as DUAS formas da marca de posse do venue (o inteiro de 31 bits e o `cloid`), tornou a referencia
// de cliente opcional e declarou a ausencia do funding por execucao. Uma emenda dessas fica a meio caminho
// se o alargamento passar do que foi medido — por isso cada alargamento traz, AQUI e nos DOIS motores, a
// prova do que PASSA e a prova do que continua a REPROVAR. E o que NAO podia ser tocado fica medido tambem:
// a marca que a MESA compoe (a boleta) continua a recusar o `cloid`.
//
// A 1.6.0 alargou a MESMA banda outra vez, e por medicao (emenda-1.6.0.txt): a forma de TRES a CINCO letras
// maiusculas que a 1.5.0 tinha era a medicao de UMA moeda, e nao a banda do venue — o universo real tem 1863
// simbolos distintos, de 1 a 11 caracteres, com digitos e minusculas. Um alargamento destes APAGA as provas
// negativas antigas de proposito, e por isso as (a) aqui de baixo sao as da banda NOVA: as duas que a 1.5.0
// tinha (seis letras, minusculas) mudaram de veredicto, e o negativo passou a ser o que a medicao diz ser
// lixo — o ESPACO (`JPL `, o unico dos 1863 que nao cabe), o HIFEN (0 de 1863) e as DOZE letras.

const historicoSchema = lerJson(join(CONTRATOS, "historico.schema.json"));
const casoBaseDoHistorico: any = (() => {
  const casos = lerJson(join(CONTRATOS, "casos", "historico.casos.json"));
  return casos.casos.find((c: any) => c.nome === "historico/com-taxas-e-funding-em-campos-proprios").entrada;
})();

/** Uma execucao da base, clonada, sem os campos que o alargamento tornou opcionais. */
function execucaoSem(...campos: string[]): any {
  const execucao = clonar(casoBaseDoHistorico.carga.execucoes[0]);
  for (const campo of campos) delete execucao[campo];
  return execucao;
}
/** A carga do historico com a PRIMEIRA execucao trocada pela que a sonda construir. */
function historicoComExecucao(execucao: any): any {
  const mensagem = clonar(casoBaseDoHistorico);
  mensagem.carga.execucoes = [execucao, ...mensagem.carga.execucoes.slice(1)];
  return mensagem;
}
const CLOID_DO_VENUE = "0x00000000000000000000000000000001"; // a forma do venue: 0x + 32 hexadecimais minusculos

const provasDaEmenda: { nome: string; mensagem: unknown; veredicto: string; motivo: string | null }[] = [
  // (a) A MOEDA DA TAXA — a banda e a MEDIDA (1863 simbolos do venue, de 1 a 11 caracteres) -----------------
  { nome: "(a) a moeda do venue (`USDC`, QUATRO letras) CABE na banda medida",
    mensagem: (() => { const m = clonar(casoBaseDoHistorico); m.carga.moeda = "USDC"; return m; })(),
    veredicto: "aceite", motivo: null },
  { nome: "(a) a moeda antiga (`USD`, TRES letras) NAO deixou de caber",
    mensagem: clonar(casoBaseDoHistorico), veredicto: "aceite", motivo: null },
  { nome: "(a) MEDIDO: a moeda de UMA letra (`W`) CABE — o venue tem 11 simbolos de uma letra",
    mensagem: (() => { const m = clonar(casoBaseDoHistorico); m.carga.moeda = "W"; return m; })(),
    veredicto: "aceite", motivo: null },
  { nome: "(a) MEDIDO: a moeda com DIGITO (`TEST1`) CABE — 72 dos 1863 simbolos trazem digito (o `1400` que aqui esteve contava tambem nomes de PARES de spot, que nao sao moedas)",
    mensagem: (() => { const m = clonar(casoBaseDoHistorico); m.carga.moeda = "TEST1"; return m; })(),
    veredicto: "aceite", motivo: null },
  { nome: "(a) MEDIDO: a moeda com MINUSCULAS (`TestPascal1`, ONZE letras) CABE — 15 dos 1863 trazem minuscula",
    mensagem: (() => { const m = clonar(casoBaseDoHistorico); m.carga.moeda = "TestPascal1"; return m; })(),
    veredicto: "aceite", motivo: null },
  { nome: "(a) PROVA NEGATIVA: a moeda com DOZE letras (`TSRSFGQQQQQQ`) RECUSA — o medido fecha em ONZE",
    mensagem: (() => { const m = clonar(casoBaseDoHistorico); m.carga.moeda = "TSRSFGQQQQQQ"; return m; })(),
    veredicto: "recusado", motivo: "formato_invalido" },
  { nome: "(a) PROVA NEGATIVA: a moeda com HIFEN (`EUR-USD`) RECUSA — 0 de 1863 simbolos medidos tem hifen",
    mensagem: (() => { const m = clonar(casoBaseDoHistorico); m.carga.moeda = "EUR-USD"; return m; })(),
    veredicto: "recusado", motivo: "formato_invalido" },
  { nome: "(a) PROVA NEGATIVA, e MEDIDA: a moeda `JPL ` (ESPACO no fim) RECUSA — e' o unico dos 1863 que nao cabe",
    mensagem: (() => { const m = clonar(casoBaseDoHistorico); m.carga.moeda = "JPL "; return m; })(),
    veredicto: "recusado", motivo: "formato_invalido" },

  // (b) O RESULTADO REALIZADO -------------------------------------------------------------------------
  { nome: "(b) o historico SEM o resultado por instrumento PASSA — a fonte e' POR EXECUCAO, e o campo e' opcional",
    mensagem: (() => { const m = clonar(casoBaseDoHistorico); delete m.carga.resultado_realizado; return m; })(),
    veredicto: "aceite", motivo: null },
  { nome: "(b) o resultado por instrumento, QUANDO o venue o da, continua a caber",
    mensagem: clonar(casoBaseDoHistorico), veredicto: "aceite", motivo: null },
  { nome: "(b) PROVA NEGATIVA (FR-018): um resultado POR EXECUCAO na carga RECUSA — somar as parcelas e' a reconstrucao proibida",
    mensagem: (() => { const m = clonar(casoBaseDoHistorico); m.carga.execucoes[0].resultado_liquido = "0.11"; return m; })(),
    veredicto: "recusado", motivo: "campo_desconhecido" },

  // (c) A MARCA DE POSSE ------------------------------------------------------------------------------
  { nome: "(c) a marca do VENUE na forma `cloid` (0x + 32 hexadecimais) CABE na 1.5.0",
    mensagem: historicoComExecucao({ ...execucaoSem(), marca_de_posse: CLOID_DO_VENUE }),
    veredicto: "aceite", motivo: null },
  { nome: "(c) a marca no INTEIRO de 31 bits que a mesa compoe continua a caber",
    mensagem: clonar(casoBaseDoHistorico), veredicto: "aceite", motivo: null },
  { nome: "(c) PROVA NEGATIVA: uma marca com forma de TERCEIRO tipo (`nao-e-marca`) RECUSA",
    mensagem: historicoComExecucao({ ...execucaoSem(), marca_de_posse: "nao-e-marca" }),
    veredicto: "recusado", motivo: "formato_invalido" },
  { nome: "(c) PROVA NEGATIVA: um inteiro acima dos 31 bits (2147483648) RECUSA",
    mensagem: historicoComExecucao({ ...execucaoSem(), marca_de_posse: 2147483648 }),
    veredicto: "recusado", motivo: "valor_fora_da_banda" },
  { nome: "(c) PROVA NEGATIVA: um `cloid` com hexadecimais MAIUSCULOS RECUSA — a forma e' a do venue, nao uma parecida",
    mensagem: historicoComExecucao({ ...execucaoSem(), marca_de_posse: "0X00000000000000000000000000000001" }),
    veredicto: "recusado", motivo: "formato_invalido" },
  { nome: "(c) PROVA CRUZADA: a marca que a MESA compoe (na boleta) continua a RECUSAR o `cloid` — o alargamento nao chegou la'",
    mensagem: (() => { const b = clonar(boleta); b.carga.marca_de_posse = CLOID_DO_VENUE; return b; })(),
    veredicto: "recusado", motivo: "tipo_invalido" },

  // (d) A REFERENCIA DE CLIENTE ------------------------------------------------------------------------
  { nome: "(d) a execucao SEM a referencia de cliente PASSA — o venue nao a guardou em 415 de 415 ordens",
    mensagem: historicoComExecucao(execucaoSem("referencia_do_cliente")),
    veredicto: "aceite", motivo: null },
  { nome: "(d) PROVA NEGATIVA: a referencia de cliente a `null` RECUSA — ausencia nao se escreve com null (D4)",
    mensagem: historicoComExecucao({ ...execucaoSem(), referencia_do_cliente: null }),
    veredicto: "recusado", motivo: "valor_nulo_nao_permitido" },
  { nome: "(d) PROVA NEGATIVA: a referencia de cliente VAZIA (`\"\"`) RECUSA — ausencia nao se escreve com vazio",
    mensagem: historicoComExecucao({ ...execucaoSem(), referencia_do_cliente: "" }),
    veredicto: "recusado", motivo: "formato_invalido" },

  // (e) O FUNDING POR EXECUCAO -------------------------------------------------------------------------
  { nome: "(e) o funding por execucao declarado pelo venue continua a caber",
    mensagem: clonar(casoBaseDoHistorico), veredicto: "aceite", motivo: null },
  { nome: "(e) o funding AUSENTE numa execucao PASSA — ausente nunca vira zero",
    mensagem: historicoComExecucao(execucaoSem("funding")),
    veredicto: "aceite", motivo: null },
  { nome: "(e) PROVA NEGATIVA: o funding como NUMERO do JSON RECUSA — o contrato escreve decimal textual",
    mensagem: historicoComExecucao({ ...execucaoSem(), funding: 0.01 }),
    veredicto: "recusado", motivo: "tipo_invalido" },
];

declarar(`emenda 1.5.0: ${provasDaEmenda.length} sondas do historico REAL (o que passa e o que reprova), nos dois motores`);
for (const prova of provasDaEmenda) {
  const { ts, py } = nosDoisMotores(prova.mensagem);
  exigir(
    ts.veredicto === prova.veredicto && ts.motivo === prova.motivo,
    `TS: ${prova.nome} deu ${ts.veredicto}/${ts.motivo}, esperado ${prova.veredicto}/${prova.motivo}`,
  );
  exigir(
    py.veredicto === prova.veredicto && py.motivo === prova.motivo,
    `PY: ${prova.nome} deu ${py.veredicto}/${py.motivo}, esperado ${prova.veredicto}/${prova.motivo}`,
  );
  exigir(
    ts.veredicto === py.veredicto && ts.motivo === py.motivo,
    `${prova.nome}: TS decide ${ts.veredicto}/${ts.motivo} e Python decide ${py.veredicto}/${py.motivo}`,
  );
  console.log(`  ${prova.veredicto}/${prova.motivo ?? "-"} nos dois motores — ${prova.nome}`);
}

// A emenda no ESQUEMA: a forma num SO sitio, a fonte declarada, e a marca da mesa intacta. Uma sonda de
// comportamento nao ve um campo que ficou declarado duas vezes — esta conferencia ve'.
declarar("a emenda 1.5.0, no ESQUEMA: a forma da moeda num so sitio, a fonte por execucao declarada, a marca da mesa intacta");
const formaMoeda = forma.$defs?.moeda ?? {};
exigir(
  String(historicoSchema.properties?.moeda?.$ref ?? "").endsWith("_defs/forma.schema.json#/$defs/moeda"),
  "historico.moeda NAO aponta para _defs/forma.schema.json#/$defs/moeda: a forma da moeda teria duas casas",
);
exigir(formaMoeda.pattern === "^[A-Za-z0-9]{1,11}$", `a forma da moeda em _defs e' ${formaMoeda.pattern}, e a 1.6.0 MEDIU-a contra o venue (1863 simbolos, de 1 a 11 caracteres, com digitos e minusculas)`);
exigir(
  String(formaMoeda.description ?? "").includes("1863") && String(formaMoeda.description ?? "").includes("JPL"),
  "a descricao da moeda em _defs NAO carrega a medicao (o numero de simbolos medidos e o unico que nao cabe): uma banda sem a medicao escrita ao lado e' uma banda inventada",
);
exigir(
  (historicoSchema.required as string[]).includes("resultado_realizado") === false,
  "historico.resultado_realizado continua OBRIGATORIO: o venue so o publica POR EXECUCAO, e exigi-lo obrigaria a somar",
);
exigir(
  String(historicoSchema.properties?.resultado_realizado?.description ?? "").includes("closedPnl"),
  "a descricao de historico.resultado_realizado nao declara a fonte POR EXECUCAO (`closedPnl`)",
);
const exigidasDaExecucao: string[] = historicoSchema.properties?.execucoes?.items?.required ?? [];
for (const campo of ["referencia_do_cliente", "marca_de_posse"]) {
  exigir(
    exigidasDaExecucao.includes(campo) === false,
    `historico.execucoes[].${campo} continua OBRIGATORIO, e o venue nao o publica nesta conta (415 de 415 com \`cloid\` nulo)`,
  );
}
exigir(
  String(historicoSchema.properties?.execucoes?.items?.properties?.marca_de_posse?.$ref ?? "").endsWith("marca_de_posse_do_venue"),
  "a marca de posse do historico NAO aponta para a forma do VENUE (`marca_de_posse_do_venue`)",
);
exigir(
  forma.$defs?.marca_de_posse?.type === "integer" && forma.$defs?.marca_de_posse?.maximum === 2147483647,
  "a marca que a MESA compoe (`$defs/marca_de_posse`) deixou de ser o inteiro de 31 bits: isso mudaria o que a boleta significa",
);
const formasDeclaradas: string[] = vocabulario.formas_da_marca_do_venue ?? [];
exigir(
  formasDeclaradas.length === 2 && formasDeclaradas.includes("inteiro_31_bits") && formasDeclaradas.includes("cloid"),
  `o vocabulario declara ${JSON.stringify(formasDeclaradas)} como formas da marca do venue, e sao DUAS (a do contrato e a do cloid)`,
);

// ---------------------------------------------------------------------------------------------------
// A VACINA: as provas desta porta tem de saber REPROVAR (--prova-negativa)
// ---------------------------------------------------------------------------------------------------

if (provaNegativa) {
  declarar("vacina: cada prova tem de saber reprovar");
  silencioso = true;

  // (a) um motivo inventado no vocabulario -> o conjunto fechado deixa de fechar
  const vocFurado = { motivos: { ...vocabulario.motivos, motivo_da_emenda_que_nao_existe_no_espelho: {} } };
  const ordenarAntes = falhas;
  falhas = 0;
  const apanhado = conferirVocabulario(vocFurado, noEspelho, prioridade) > 0;
  falhas = ordenarAntes;
  silencioso = false;
  exigir(apanhado, "vacina: um motivo no vocabulario sem espelho no esquema PASSOU como bom");

  // (b) uma divergencia introduzida a mao -> a comparacao caso a caso tem de a apanhar
  const antes = falhas;
  silencioso = true;
  falhas = 0;
  const mutado = esquerda.leituras.map((l, i) => (i === 0 ? { ...l, motivo: "um_motivo_que_o_outro_lado_nao_da" } : l));
  const detectada = comparar(mutado, direita.leituras) > 0;
  falhas = antes;
  silencioso = false;
  exigir(detectada, "vacina: uma divergencia entre os dois motores PASSOU como paridade");

  // (c) um campo a mais que o esquema aceitasse -> a prova 4 nao estaria a medir nada
  const semProva = clonar(boleta);
  const { ts: tsSemProva } = nosDoisMotores(semProva);
  exigir(tsSemProva.veredicto === "aceite", "vacina: a mensagem de referencia da prova 4 nao e' aceite — a prova nao mede a mutacao");

  // (d) o duble a MENTIR (o veredicto trocado) -> a comparacao entre os dois lados tem de o apanhar
  const antesDe5 = falhas;
  silencioso = true;
  falhas = 0;
  const mentiroso = (manifesto: any, alvo: any) => {
    const resposta = falarComODuble(manifesto, alvo);
    return resposta === null ? null : { ...resposta, veredicto: resposta.veredicto === "aceite" ? "recusado" : "aceite", motivo: null };
  };
  const detectada5 = compararOsDoisLados(casosDeBoleta, conformidade.manifestos, mentiroso) > 0;
  falhas = antesDe5;
  silencioso = false;
  exigir(detectada5, "vacina: um duble com o veredicto trocado PASSOU como paridade entre os dois lados");

  // (e) a mensagem de referencia da prova 7 tem de ser ACEITE nos dois motores — senao a prova nao mede a mutacao
  const sondaDaEmenda = provasDaEmenda.find((p) => p.veredicto === "aceite" && p.nome.includes("cloid"));
  const { ts: tsDaEmenda, py: pyDaEmenda } = nosDoisMotores(sondaDaEmenda?.mensagem);
  exigir(
    tsDaEmenda.veredicto === "aceite" && pyDaEmenda.veredicto === "aceite",
    "vacina: a mensagem de referencia da prova 7 (a marca do venue na forma `cloid`) nao e' aceite nos dois motores — a prova nao mede a mutacao",
  );

  if (falhas === 0) {
    console.log(
      "  (a) vocabulario furado REPROVA · (b) divergencia entre motores REPROVA · " +
        "(c) a mensagem de referencia e' aceite · (d) duble a mentir REPROVA · " +
        "(e) a carga com a marca do venue e' aceite nos dois motores",
    );
  }
}

// ---------------------------------------------------------------------------------------------------

// O estado do venue volta ao que era antes da primeira sonda, byte a byte.
if (estadoGuardado !== null) writeFileSync(estadoDoVenue, estadoGuardado);
else rmSync(estadoDoVenue, { force: true });

console.log(
  `\nporta-do-contrato: ${falhas === 0 ? "0 falhas" : `${falhas} FALHAS`} — ` +
    `contrato ${versao} · ${motivos.length} motivos fechados nas duas direcoes · ` +
    `${esquerda.leituras.length} casos lidos nos dois motores` +
    ` · ${casosDeBoleta.length} casos de conformidade nas duas linguagens` +
    ` · ${bandas.length} bandas no duble` +
    ` · ${provasDaEmenda.length} sondas da emenda 1.5.0 no historico` +
    (provaNegativa ? " · 5 vacinas" : ""),
);
process.exit(falhas === 0 ? 0 : 1);
