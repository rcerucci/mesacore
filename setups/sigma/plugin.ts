#!/usr/bin/env bun
// O SETUP `sigma` — o `sign(mid - MA) + ZZ` do Pine, automático.
//
// ELE É FINO DE PROPÓSITO. Toda a conta está em `sinal.ts` (função pura, rebobinável, provada contra o
// gráfico). Aqui só se ligam as pontas: ler a leitura e as velas, chamar a conta, dizer o lado.
//
// O QUE ELE RECEBE, e por onde:
//   * a LEITURA no stdin — a mensagem `mercado` do contrato (instrumento, equity, bid, ask, idade do dado,
//     estado, e a POSIÇÃO quando o conector a publica);
//   * as VELAS no ficheiro `velas-<INSTRUMENTO>-<RELOGIO>.jsonl` da pasta que o operador declara (JSONL, D4);
//   * as CONSTANTES da ficha do par e o relógio, pelo ambiente (ao setup vai só isto — nunca o risco, RN-M4.1).
//
// O QUE ELE DEVOLVE: UMA linha `proposta` no stdout, com um dos quatro lados. E, por cima, linhas
// `diagnostico` com a média, o ATR, o `mid`, o `sig` e o extremo das últimas barras — que é o que permite ao
// dono cruzar com a janela de dados do gráfico sem abrir código nenhum.
//
// A DECISÃO, E O QUE ELA SE RECUSA A FAZER. O indicador não tem estado plano: depois do primeiro sinal está
// sempre comprado ou vendido, e é a viragem que o muda. Para propor um lado é preciso saber se JÁ ESTAMOS nesse
// lado — e se a leitura não trouxer a posição, este plugin NÃO ADIVINHA: propõe `hold` e di-lo em voz alta.
// Abrir às cegas por cima de uma posição viva é empilhar, e nenhum indicador pede isso.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { calcular, type Vela, type Constantes } from "./sinal.ts";
import { validar } from "../../contracts/esqueleto/framing.ts";

const NOME = "sigma";
const VERSAO = "0.1.0";
const RAIZ = join(import.meta.dir, "..", "..");

/**
 * O QUE O OPERADOR TEM DE ME DAR — ou nao se calcula nada.
 *
 * Isto era `process.env.X ?? ""`, e um ambiente incompleto dava um instrumento vazio, um relogio vazio e um
 * objecto de constantes vazio: o indicador corria com `undefined` no comprimento da media e no ATR, produzia
 * `NaN`, e o `NaN` nao estoura — decide. Um plugin que corre com o que nao lhe deram e' pior do que um plugin
 * que nao corre: o que nao corre diz-se, o que corre mal esconde-se.
 */
function exigido(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === "") {
    process.stderr.write(
      JSON.stringify({ setup: NOME, veredicto: "recusado", porque: `falta \`${nome}\` no ambiente: sem isso nao se calcula nada` }) + "\n",
    );
    process.exit(2);
  }
  return v;
}
const constantes = JSON.parse(exigido("CONSTANTES")) as Constantes;
const instrumento = exigido("INSTRUMENTO");
const relogio = exigido("RELOGIO");
const pastaDoMercado = exigido("PASTA_DE_MERCADO");
for (const campo of ["ma_len", "ma_tipo", "src_ma", "src_sinal", "banda_atr", "zz_atr", "atr_len"] as const) {
  if ((constantes as unknown as Record<string, unknown>)[campo] === undefined) {
    process.stderr.write(
      JSON.stringify({ setup: NOME, veredicto: "recusado", porque: `a ficha do par nao declara a constante \`${campo}\`: o indicador nao corre com metade das suas regras` }) + "\n",
    );
    process.exit(2);
  }
}

const queixa = (porque: string) => process.stderr.write(JSON.stringify({ setup: NOME, diagnostico: porque }) + "\n");
const dizer: (lado: string, porque: string) => never = (lado, porque) => {
  const linha = JSON.stringify({
    contrato: "1.7.0",
    tipo: "proposta",
    id: `${NOME}-${instrumento}-${Date.now()}`,
    carga: { setup: { nome: NOME, versao: VERSAO }, lado },
  });
  const r = validar(linha);
  if (r.veredicto !== "aceite") {
    queixa(`a minha propria proposta nao passa o contrato (${r.motivo}) — prefiro nao propor a propor mal`);
    process.exit(3);
  }
  queixa(porque);
  console.log(linha);
  // UMA resposta por chamada, e a chamada acaba aqui. E' isto que faz o tipo `never` ser verdade: depois de
  // dizer o lado, o plugin nao tem mais nada para fazer nesta volta.
  process.exit(0);
};

// ---- a leitura, do stdin: uma linha do contrato ---------------------------------------------------------
const entrada = await new Promise<string>((resolve) => {
  let dados = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (b) => (dados += b));
  process.stdin.on("end", () => resolve(dados));
});
let leitura: any = null;
for (const linha of entrada.split("\n")) {
  if (linha.trim() === "") continue;
  try {
    const o = JSON.parse(linha);
    if (o?.tipo === "mercado") leitura = o.carga;
  } catch {
    // linha ilegivel nao vira leitura
  }
}
if (leitura === null) dizer("hold", "sem leitura do mercado: nao se decide sobre o que nao se leu");
if (leitura.estado !== "aberto") dizer("hold", `o mercado esta' ${leitura.estado}`);

// ---- as velas, do ficheiro do relógio da ficha ----------------------------------------------------------
if (pastaDoMercado === "") dizer("hold", "nao me deram a pasta das velas: sem barras nao ha media nem ATR");
// A pasta pode ser absoluta (o operador passa uma pasta de fora do repositorio) ou relativa ao repo — e juntar
// `RAIZ` a um caminho absoluto daria um caminho que nao existe, com o plugin a dizer "nao ha velas" de um
// ficheiro que esta' la'. Medido a 30/09.
const caminho = join(isAbsolute(pastaDoMercado) ? pastaDoMercado : join(RAIZ, pastaDoMercado), `velas-${instrumento}-${relogio}.jsonl`);
if (!existsSync(caminho)) dizer("hold", `nao existe o ficheiro de velas do par (${instrumento}-${relogio})`);

const todas: Vela[] = readFileSync(caminho, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Vela);

// A BARRA QUE AINDA ESTA' A FORMAR NAO CONTA. O venue devolve a vela em curso, e decidir sobre ela e' decidir
// sobre um preco que ainda pode mudar — o Pine faz o mesmo com `barstate.isconfirmed`.
const msDoRelogio: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000 };
const passo = msDoRelogio[relogio];
if (passo === undefined) dizer("hold", `o relogio ${relogio} nao me e' conhecido`);
const agoraMs = Number(leitura.tempo_do_venue_ms ?? Date.now());
const velas = todas.filter((v) => v.t + passo <= agoraMs);
const ultima = velas[velas.length - 1];
if (ultima === undefined) dizer("hold", "nao ha nenhuma barra FECHADA: a primeira ainda esta' a formar");
queixa(`barras: ${todas.length} no ficheiro · ${velas.length} fechadas · ultima ${new Date(ultima.t).toISOString()}`);

// ---- a conta, e o que ela mostra nas últimas barras -----------------------------------------------------
const pontos = calcular(velas, constantes);
const ponto = pontos[pontos.length - 1]!;
for (const p of pontos.slice(-3)) {
  queixa(`diagnostico ${new Date(p.t).toISOString()} · ma=${p.ma?.toFixed(4)} · atr=${p.atr?.toFixed(4)} · mid=${p.mid.toFixed(4)} · mid-ma=${p.ma === null ? "na" : (p.mid - p.ma).toFixed(4)} · sig=${p.sig} · virada=${p.virada}`);
}
if (ponto.ma === null || ponto.atr === null) dizer("hold", `so' ha' ${velas.length} barras e o indicador precisa de mais para a media e o ATR`);
if (ponto.sig === 0) dizer("hold", "o indicador ainda nao tem lado: o preco nao saiu da zona morta em volta da media");

// ---- a posição: o contrato diz o que a ausência significa ------------------------------------------
//
// `mercado.posicao` — "Ausente = sem posicao" (o schema, textual). Nao e' "nao sei": e' PLANO. E se a conta
// tivesse uma posicao que o conector nao conseguiu ler, a mensagem `mercado` nem era produzida (o produtor
// recusa em vez de emitir uma leitura coxa) — por isso a ausencia e' um facto, e nao uma dúvida.
//
// O que o plugin NAO decide e' a POSSE: se a posicao tem marca nossa e' a mesa que o sabe (a marca vive no
// `cloid` da ordem, e o mapa marca -> ficha e' a RN-T16.1). Aqui só se compara o LADO — que e' o que o
// indicador precisa para saber se ja' esta' do lado que ele quer.
const doPedido = ponto.sig === 1 ? "buy" : "sell";
const posicao = leitura.posicao;
const tFechada = ultima.t;

// ---- UMA ENTRADA POR BARRA FECHADA, e o resto do tempo em silencio ------------------------------------
//
// Este é o ponto que a observação de 12 h pôs a nu: a mesa propôs `abrir` 731 vezes num relógio de H1 — 731
// barras que não existem. O indicador decide **no fecho da barra**, logo a entrada é uma por barra; repeti-la
// a cada ciclo é a mesma decisão enviada 60 vezes por hora, e se a mão estivesse fechada seriam 60 posições.
//
// A regra, e porque é esta:
//   * a posição já está do lado que o indicador quer  -> `hold` (não se mexe);
//   * a posição está do lado OPOSTO                     -> propõe-se a viragem em TODOS os ciclos, de propósito:
//     o fecho é `reduce_only` e o sistema fica plano; só então a abertura do lado novo é que é uma entrada nova,
//     e essa conta uma vez. Repetir a viragem até ela se completar é o que a faz completar-se;
//   * sem posição: propõe-se a entrada **uma vez por barra fechada** — a barra fica registada no estado do
//     setup, e nos ciclos seguintes da mesma barra o setup **não propõe nada** (nem `hold`: nada mesmo, que o
//     contrato distingue "não propus" de "tenho opinião"). É isto que faz o relógio da ficha mandar na ordem.
const PASTA_DE_ESTADO = process.env.PASTA_DE_ESTADO ?? "";  // opcional de proposito: sem estado o plugin diz que nao registou a barra (e di-lo)
const ficheiroDeEstado = PASTA_DE_ESTADO === "" ? null : join(PASTA_DE_ESTADO, `sigma-${instrumento}.json`);
function barraJaAberta(): boolean {
  if (ficheiroDeEstado === null || !existsSync(ficheiroDeEstado)) return false;
  try {
    return (JSON.parse(readFileSync(ficheiroDeEstado, "utf8")) as { ultima_barra?: number }).ultima_barra === tFechada;
  } catch {
    return false; // estado ilegivel conta como "nao sei se ja' abri": abre-se, e o defeito fica visivel no erro
  }
}
function registarBarra(): void {
  if (ficheiroDeEstado === null) return;
  try {
    mkdirSync(PASTA_DE_ESTADO, { recursive: true });
    writeFileSync(ficheiroDeEstado, JSON.stringify({ ultima_barra: tFechada, quando: new Date().toISOString() }) + "\n");
  } catch (e) {
    queixa(`nao consegui registar a barra no estado (${e instanceof Error ? e.message : String(e)}) — a entrada pode repetir-se: diz-lo em vez de a esconder`);
  }
}

if (posicao === undefined || posicao === null) {
  // PLANO. Só aqui é que uma entrada nova pode acontecer — e uma vez por barra.
  if (barraJaAberta()) {
    queixa(`barra ${new Date(tFechada).toISOString()} ja' deu a sua entrada: nao proponho nada (o relogio da ficha e' que manda)`);
    process.exit(0); // sem linha nenhuma no stdout: "nao propus" — que NAO e' o mesmo que `hold`
  }
  registarBarra();
  dizer(doPedido, `plano, e o indicador esta' ${doPedido}: entrada da barra ${new Date(tFechada).toISOString()} (a posicao ausente e' "sem posicao", nao e' duvida)`);
}
if (String(posicao.lado) === doPedido) {
  dizer("hold", `ja' estou ${doPedido}: o indicador concorda com a posicao, nao ha nada a fazer`);
}
// O lado OPOSTO a uma posição: a mesa fecha com `reduce_only` (não vira a mão numa ordem). Na volta seguinte
// a posição já não existe, o indicador continua no lado novo, e a mesa abre — a viragem faz-se em dois passos.
dizer(doPedido, `viragem: o indicador esta' ${doPedido} e a posicao e' ${posicao.lado}`);
