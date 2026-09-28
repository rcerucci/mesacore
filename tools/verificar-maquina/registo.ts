// SC-011: um dia de operacao tem de ser reconstruivel a partir do REGISTO, sem ler codigo.
//
// Tres coisas se medem aqui, e as tres sao sobre o registo e nao sobre o codigo:
//
//   1. nenhuma decisao de NAO-FAZER vem sem motivo - `nada` sem motivo e a linha que torna o dia
//      inexplicavel: quem le nao distingue "nao havia nada a fazer" de "havia e a mesa nao fez";
//   2. a cadeia de transicoes e CONTIGUA - cada transicao diz de onde veio, e tem de vir de onde a
//      anterior deixou. Uma transicao que salta (de `pausada` para `parada` sem passar por `encerrando`)
//      nao e um dia reconstruivel, e um dia com um buraco;
//   3. a reconstrucao FECHA no estado final verdadeiro da mesa.
//
// Cada uma destas verificacoes traz a sua prova negativa: um registo adulterado de proposito tem de ser
// reprovado. Sem isso, "0 de 0" passaria por dia perfeito.

import { readFileSync, rmSync, appendFileSync } from "node:fs";
import { decidirInstrumento } from "../../core/ciclo/ciclo.ts";
import { correrPedidoDeParada } from "../../core/ciclo/encerramento.ts";
import { lerParaOCiclo } from "../../core/leitura/fixtures.ts";
import { marcasVazias } from "../../core/estado/marcas.ts";
import { reconstruir, registarCiclo, type LinhaDoRegisto } from "../../core/estado/registo.ts";
import { Mesa } from "../../core/mesa.ts";
import { motivoConhecido } from "../../core/livro-de-motivos.ts";
import type { ConfiguracaoDaConta } from "../../core/config/configuracao.ts";
import { RAIZ_DO_REPO } from "./inventario-do-arranque.ts";

const args = process.argv.slice(2);
const B = RAIZ_DO_REPO;

let verificacoes = 0;
let divergentes = 0;
const linhasDoRelatorio: string[] = [];

function exigir(condicao: boolean, texto: string, contexto: string[] = []): void {
  verificacoes += 1;
  if (condicao) console.log(`ok    ${texto}`);
  else {
    divergentes += 1;
    console.log(`FALHA ${texto}`);
    for (const c of contexto) console.log(`        ${c}`);
  }
}

function carregar<T>(caminho: string): T {
  return JSON.parse(readFileSync(`${B}/${caminho}`, "utf8")) as T;
}

const pausa = carregar<any>("core/ciclo/pausa.casos.json");
const config = pausa.padrao.config as ConfiguracaoDaConta;
const padrao = pausa.padrao;

const caminhoDoRegisto = `${process.env.TMPDIR ?? "/tmp"}/mesacore-registo-${process.pid}.jsonl`;
rmSync(caminhoDoRegisto, { force: true });

const mesa = new Mesa({ caminhoDasMarcas: `${caminhoDoRegisto}.marcas`, caminhoDoRegisto: caminhoDoRegisto });
const ctx = { instante_ms: 1790628000000, inibicao_cb: false, portas_do_arranque: { passam: true } };

function decidir(leitura: any, proposta: any, ciclo: number, extra: any = {}) {
  const entradas = lerParaOCiclo(leitura, proposta === null ? null : { setup: padrao.proposta_setup, ...proposta }, ciclo);
  return decidirInstrumento({
    mercado: entradas.mercado,
    proposta: entradas.proposta,
    proposta_invalida: entradas.proposta_invalida,
    motivo_do_contrato: entradas.motivo_do_contrato,
    ficha: padrao.ficha,
    ciclo,
    ligacao: "ligada",
    mandato: padrao.mandato,
    template: padrao.template,
    marcas_nossas_conhecidas: padrao.marcas_nossas_conhecidas,
    config,
    desconhecido: null,
    mesa_pausada: extra.mesa_pausada === true,
    falhas: extra.falhas ?? {},
    divergente: extra.divergente === true,

  });
}

console.log("=== SC-011: o dia reconstruido a partir do registo ===\n");

// --- o dia, corrido a serio: a mesa transita, o ciclo decide, e TUDO fica no registo
const posicao = { lado: "buy", unidades: "1000", preco_medio: "1.0850", marca_de_posse: 1694498816 };
const mercadoAberto = { instrumento: "EURUSD", idade_do_dado_ms: 100, estado_do_mercado: "aberto" };

const dia: Array<{ nota: string; d: any }> = [];
const r1 = mesa.receber({ verbo: "start", autor: "dono", pedido_id: "d-1" }, ctx);
dia.push({ nota: "start com proposta de abertura", d: decidir(mercadoAberto, { lado: "buy" }, 60) });
const r2 = mesa.receber({ verbo: "pause", autor: "dono", pedido_id: "d-2" }, ctx);
dia.push({ nota: "em pausa, a mesma proposta", d: decidir(mercadoAberto, { lado: "buy" }, 61, { mesa_pausada: true }) });
dia.push({ nota: "em pausa, caixa com posicao", d: decidir({ ...mercadoAberto, posicao }, { lado: "caixa" }, 62, { mesa_pausada: true }) });
dia.push({ nota: "em pausa, com divergencia", d: decidir({ ...mercadoAberto, posicao }, { lado: "caixa" }, 63, { mesa_pausada: true, divergente: true }) });
dia.push({ nota: "proposta ausente (hold contado)", d: decidir(mercadoAberto, null, 64, { mesa_pausada: true }) });
dia.push({ nota: "condicao sem leitura", d: decidir({ instrumento: "EURUSD", idade_do_dado_ms: 0, estado_do_mercado: "aberto" }, { lado: "buy" }, 65, { mesa_pausada: true, falhas: { leitura: true } }) });

let t = 1790628001000;
for (const { nota, d } of dia) {
  registarCiclo(t, "EURUSD", d.acao, d.motivo, nota, caminhoDoRegisto);
  t += 1000;
  linhasDoRelatorio.push(JSON.stringify({ nota, acao: d.acao, motivo: d.motivo, condicao: d.condicao, avisa: d.avisa }));
}

// O encerramento e o CB tambem deixam linha: o resumo, o pedido pendente e a inibicao.
const parada = correrPedidoDeParada(marcasVazias(), { inicio_ms: 1790628000000, agora_ms: 1790628070000, prazo_de_resposta_ms: 5000, resposta: null }, true, "posicao viva", config);
registarCiclo(t, "EURUSD", "nada", parada.motivo, "o pedido de parada ficou sem resposta e voltou a operar", caminhoDoRegisto);
const r3 = mesa.receber({ verbo: "stop", autor: "dono", pedido_id: "d-3" }, ctx);
const rFinal = mesa.receber({ verbo: "stop", autor: "dono", pedido_id: "d-4" }, ctx);

exigir(
  r1.resultado === "aceite" && r2.resultado === "aceite" && r3.resultado === "aceite" && rFinal.resultado === "recusado" && !!rFinal.motivo,
  "SC-011: o dia tem uma recusa LEGITIMA (o 2.o stop com a mesa ja parada), registrada com o motivo dela",
  [`start=${r1.resultado}/${r1.estado_novo} pause=${r2.resultado}/${r2.estado_novo} stop=${r3.resultado}/${r3.estado_novo} stop=${rFinal.resultado} (${rFinal.motivo})`],
);

// --- a reconstrucao, a partir do FICHEIRO (nunca das variaveis em memoria)
const linhas = readFileSync(caminhoDoRegisto, "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l) as LinhaDoRegisto);

const transicoes = linhas.filter((l) => l.tipo === "transicao");
const decisoes = linhas.filter((l) => l.tipo === "ciclo");
const recusas = linhas.filter((l) => l.tipo === "recusa");
const marcas = linhas.filter((l) => l.tipo === "marca");

console.log(`\nregisto: ${linhas.length} linhas · ${transicoes.length} transicoes · ${decisoes.length} decisoes · ${recusas.length} recusas · ${marcas.length} marcas\n`);

// 1. decisao de nao-fazer sem motivo
const semMotivo = decisoes.filter((l) => l.acao === "nada" && !l.motivo);
exigir(semMotivo.length === 0, `SC-011 (1): ${semMotivo.length} de ${decisoes.filter((l) => l.acao === "nada").length} decisoes de nao-fazer vieram sem motivo (tem de ser 0)`);

// 2. a cadeia contigua
function buracos(ls: LinhaDoRegisto[], inicial = "parada"): string[] {
  let estado = inicial;
  const falhas: string[] = [];
  for (const l of ls) {
    if (l.tipo !== "transicao") continue;
    if ((l.de ?? "") !== estado) falhas.push(`transicao para '${l.para}' diz vir de '${l.de}', mas o estado era '${estado}'`);
    estado = l.para ?? estado;
  }
  return falhas;
}
const furos = buracos(transicoes);
exigir(furos.length === 0, `SC-011 (2): a cadeia das ${transicoes.length} transicoes e contigua (0 buracos)`, furos);

// 3. fecha no estado final verdadeiro
const reconstruido = reconstruir(linhas);
exigir(reconstruido === mesa.estado, `SC-011 (3): a reconstrucao fecha no estado final real ('${reconstruido}' == '${mesa.estado}')`, [`reconstruido ${reconstruido}, real ${mesa.estado}`]);

// 4. os motivos do registo existem no livro
const motivos = [...new Set(linhas.map((l) => l.motivo).filter((m): m is string => typeof m === "string"))];
const inventados = motivos.filter((m) => !motivoConhecido(m));
exigir(inventados.length === 0, `SC-011 (4): os ${motivos.length} motivos do registo constam do livro`, inventados.map((m) => `'${m}'`));

// 5. o registo diz o que aconteceu em linguagem de quem le, incluindo o que a mesa NAO fez
//
// O que se conta sao as SITUACOES distintas explicadas, e nao a unicidade de cada motivo: duas decisoes
// de nao-abrir em pausa em dois ciclos diferentes partilham o motivo `mesa_pausada_nao_abre`, e isso esta
// certo - o motivo e a razao, e a razao era a mesma. Exigir motivos todos diferentes seria exigir codigos
// de erro inventados para parecerem distintos.
const naoFez = decisoes.filter((l) => l.acao === "nada").map((l) => l.motivo as string);
const razoes = new Set(naoFez);
exigir(
  naoFez.length >= 5 && razoes.size >= 4,
  `SC-011 (5): ${naoFez.length} decisoes de nao-fazer, explicadas por ${razoes.size} razoes distintas do livro`,
  [`razoes: ${[...razoes].join(", ")}`],
);

// --- as provas negativas: um registo adulterado tem de ser reprovado
console.log("");
const bom = linhas.filter((l) => l.tipo === "transicao");
const adulterado1 = [...decisoes, { instante_ms: 1, tipo: "ciclo", acao: "nada", motivo: null } as unknown as LinhaDoRegisto];
exigir(
  adulterado1.filter((l) => l.acao === "nada" && !l.motivo).length === 1,
  "prova negativa (1): um 'nada' sem motivo injetado e APANHADO pelo conferidor",
);
const adulterado2 = [...bom.slice(0, 1), { ...bom[1], de: "parada" } as LinhaDoRegisto, ...bom.slice(2)];
exigir(buracos(adulterado2).length >= 1, "prova negativa (2): uma transicao que salta de estado e APANHADA");

console.log("");
console.log(`resumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ${linhas.length} linhas de registo reconstruidas`);

if (args.includes("--jsonl")) {
  const saida = args[args.indexOf("--jsonl") + 1] as string;
  appendFileSync(saida, linhasDoRelatorio.join("\n") + "\n");
  console.log(`relatorio: ${saida}`);
}

rmSync(caminhoDoRegisto, { force: true });
rmSync(`${caminhoDoRegisto}.marcas`, { force: true });
process.exit(divergentes === 0 ? 0 : 1);
