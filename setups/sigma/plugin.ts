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
//
// E A ENTRADA SÓ ACONTECE NA BARRA DO FLIP (regra do dono, 30/09/2026 — «um flip de sinal tem que fechar a ordem
// aberta e inverter», «na inicialização a primeira operação só no primeiro flip», «não pode abrir ordem no meio
// da perna», «se foi fechada à mão só abre no próximo flip»). O que autoriza uma entrada é o TRIÂNGULO do
// gráfico — a `virada` da última barra fechada — e não o lado do indicador: estar do lado certo não é motivo
// para entrar, ter virado é.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { calcular, type Vela, type Constantes } from "./sinal.ts";
import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";

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
/**
 * QUEM NAO CONSEGUE CALCULAR NAO FALA.
 *
 * Era `dizer("hold", ...)` nos casos em que nem chegou a existir uma barra: sem leitura, sem velas, relogio
 * desconhecido. Isso era uma mentira de forma — `hold` e' uma OPINIAO sobre o mercado, e o contrato distingue
 * "nao propus" de "tenho opiniao". Sem barra nao ha proposta possivel (a `barra_ms` e' obrigatoria, contrato
 * 1.8.0), e a resposta honesta e' o SILENCIO, com o diagnostico no `stderr`, onde ele sempre esteve: quem le
 * o registo ve' a queixa, e quem espera uma proposta nao recebe uma inventada.
 */
function naoProponho(porque: string): never {
  queixa(porque);
  process.exit(0);
}
const dizer: (lado: string, porque: string) => never = (lado, porque) => {
  const linha = JSON.stringify({
    // A VERSAO DO CONTRATO LE'-SE, NAO SE ESCREVE AQUI. Era `"1.8.0"` escrito a mao, e quando o contrato
    // passou a 1.9.0 (as ordens vivas da conta) este plugin ficou MUDO em operacao: a proposta era recusada
    // por `versao_do_contrato_divergente` e a auto-conferencia calava-a — o portao fez o que devia, e quem
    // nao soube foi o dono. A versao vive num so' sitio (`contracts/versao.json`) e le-se de la'.
    contrato: versaoVigente(),
    tipo: "proposta",
    id: `${NOME}-${instrumento}-${Date.now()}`,
    carga: { setup: { nome: NOME, versao: VERSAO }, lado, barra_ms: tFechada },
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
if (leitura === null) naoProponho("sem leitura do mercado: nao se decide sobre o que nao se leu");
if (leitura.estado !== "aberto") naoProponho(`o mercado esta' ${leitura.estado}`);

// ---- as velas, do ficheiro do relógio da ficha ----------------------------------------------------------
if (pastaDoMercado === "") naoProponho("nao me deram a pasta das velas: sem barras nao ha media nem ATR");
// A pasta pode ser absoluta (o operador passa uma pasta de fora do repositorio) ou relativa ao repo — e juntar
// `RAIZ` a um caminho absoluto daria um caminho que nao existe, com o plugin a dizer "nao ha velas" de um
// ficheiro que esta' la'. Medido a 30/09.
const caminho = join(isAbsolute(pastaDoMercado) ? pastaDoMercado : join(RAIZ, pastaDoMercado), `velas-${instrumento}-${relogio}.jsonl`);
if (!existsSync(caminho)) naoProponho(`nao existe o ficheiro de velas do par (${instrumento}-${relogio})`);

const todas: Vela[] = readFileSync(caminho, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Vela);

// A BARRA QUE AINDA ESTA' A FORMAR NAO CONTA. O venue devolve a vela em curso, e decidir sobre ela e' decidir
// sobre um preco que ainda pode mudar — o Pine faz o mesmo com `barstate.isconfirmed`.
const msDoRelogio: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000 };
const passo = msDoRelogio[relogio];
if (passo === undefined) naoProponho(`o relogio ${relogio} nao me e' conhecido`);
const agoraMs = Number(leitura.tempo_do_venue_ms ?? Date.now());
const velas = todas.filter((v) => v.t + passo <= agoraMs);
const ultima = velas[velas.length - 1];
if (ultima === undefined) naoProponho("nao ha nenhuma barra FECHADA: a primeira ainda esta' a formar");
queixa(`barras: ${todas.length} no ficheiro · ${velas.length} fechadas · ultima ${new Date(ultima.t).toISOString()}`);

// ---- a conta, e o que ela mostra nas últimas barras -----------------------------------------------------
const pontos = calcular(velas, constantes);
const ponto = pontos[pontos.length - 1]!;
for (const p of pontos.slice(-3)) {
  queixa(`diagnostico ${new Date(p.t).toISOString()} · ma=${p.ma?.toFixed(4)} · atr=${p.atr?.toFixed(4)} · mid=${p.mid.toFixed(4)} · mid-ma=${p.ma === null ? "na" : (p.mid - p.ma).toFixed(4)} · sig=${p.sig} · virada=${p.virada}`);
}
// O PINE NÃO PRECISA DO ATR PARA DECIDIR: a prontidão dele é `mid`, MA e tempo, e sem ATR a banda é 0 (não há
// zona morta). Logo uma série sem ATR **não** é «faltam dados ao indicador» — é uma LEITURA curta (menos de
// `atr_len` barras fechadas), e numa série dessas o motor decide sobre o arranque, que é justamente onde ele e o
// gráfico mais podem discordar. Preferimos recusar e dizer por quem.
if (ponto.ma === null || ponto.atr === null) dizer("hold", `a serie traz so' ${velas.length} barras fechadas e o ATR do indicador precisa de ${constantes.atr_len}: uma leitura assim curta e' anomalia, nao um sinal`);
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
const ladoDoIndicador = ponto.sig === 1 ? "buy" : "sell";
/**
 * O LADO DO FLIP da última barra FECHADA — é o triângulo do gráfico (`marcaLong`/`marcaShort` = `nova and
 * sig != sigAntes`), e é ele que autoriza uma entrada. `null` quando aquela barra não virou.
 */
const ladoDoFlip: "buy" | "sell" | null = ponto.virada === 1 ? "buy" : ponto.virada === -1 ? "sell" : null;
const posicao = leitura.posicao;
const tFechada = ultima.t;

// ---- A ENTRADA SÓ NA BARRA DO FLIP, e o resto do tempo em silêncio --------------------------------------
//
// O primeiro defeito desta família veio da observação de 12 h: a mesa propôs `abrir` 731 vezes num relógio de
// H1 — 731 barras que não existem. O indicador decide **no fecho da barra**, logo a entrada é uma por barra.
//
// O segundo é este, e é a regra do dono: **não há entrada sem flip**. As quatro frases dele, e o que cada uma
// fecha aqui:
//   * «um flip de sinal tem que fechar a ordem aberta e inverter» -> com uma posição VIVA de lado contrário ao
//     do indicador, propõe-se a viragem em TODOS os ciclos, de propósito: o fecho é `reduce_only` e o sistema
//     fica plano; só então a abertura do lado novo é uma entrada nova, e essa conta uma vez (dois passos);
//   * «a posição já está do lado que o indicador quer» -> `hold` (não se mexe);
//   * «na inicialização do setup a primeira operação só no primeiro flip» -> ao ligar, o indicador muitas vezes
//     JÁ TEM lado (o histórico tem viragens); sem flip na última barra fechada não se entra, logo o arranque não
//     abre no meio da perna — fica-se à espera da próxima viragem;
//   * «se uma ordem for fechada à mão só pode ser aberta no próximo flip» -> plano + sem flip na última barra =
//     silêncio; e a barra do flip que já deu a sua entrada fica registada no estado (D-021), o que impede
//     reabrir dentro da mesma barra se a ordem que abrimos for fechada logo a seguir.
//
// O que NÃO muda: sem lado (`sig=0`, a zona morta em volta da média) não há proposta; e uma leitura sem posição
// é "sem posição" (o contrato diz que a ausência é PLANO), não é dúvida.
/**
 * O ESTADO DO SETUP: onde se regista a barra que ja' deu a sua entrada.
 *
 * Era `process.env.PASTA_DE_ESTADO ?? ""`, e uma pasta vazia era o mesmo que "nao ha estado": o plugin
 * registava a falha no diagnostico — e ENTRava na mesma. A regra "UMA entrada por barra fechada" nasceu
 * exactamente deste defeito (a observacao de 12 h mediu 731 propostas de `abrir` num relogio de H1, que sao
 * 731 barras que nao existem). Uma regra que impede 60 posicoes por hora nao pode depender de uma variavel de
 * ambiente que pode faltar em silencio: sem a pasta o plugin NAO PROPOE nada, e a falta e' o que ele diz.
 */
const PASTA_DE_ESTADO = exigido("PASTA_DE_ESTADO");
const ficheiroDeEstado = join(PASTA_DE_ESTADO, `sigma-${instrumento}.json`);

/**
 * A barra DESTA volta ja' deu a sua entrada? Um estado ILEGIVEL nao responde "nao": responde que nao se sabe —
 * e o plugin nao entra sobre uma duvida (a resposta antiga era `false`, ou seja: entra-se outra vez).
 */
function barraJaAberta(): boolean {
  if (!existsSync(ficheiroDeEstado)) return false;
  let lido: unknown;
  try {
    lido = JSON.parse(readFileSync(ficheiroDeEstado, "utf8"));
  } catch (e) {
    naoProponho(
      `o estado do setup (${ficheiroDeEstado}) esta' ilegivel (${e instanceof Error ? e.message : String(e)}): ` +
        "sem saber se esta barra ja' entrou, propor seria repetir a entrada",
    );
  }
  return (lido as { ultima_barra?: unknown }).ultima_barra === tFechada;
}

/**
 * REGISTAR A BARRA, ou nao propor. Se a barra nao se conseguir registar, a entrada REPETE-SE na volta seguinte —
 * e repetir a entrada e' abrir outra posicao. Era uma queixa no `stderr` e a proposta saia na mesma: o defeito
 * (D-021) ficava visivel e ficava a acontecer.
 */
function registarBarra(): void {
  try {
    mkdirSync(PASTA_DE_ESTADO, { recursive: true });
    writeFileSync(ficheiroDeEstado, JSON.stringify({ ultima_barra: tFechada, quando: new Date().toISOString() }) + "\n");
  } catch (e) {
    naoProponho(
      `nao consegui registar a barra no estado do setup (${e instanceof Error ? e.message : String(e)}) — e uma ` +
        "entrada que nao se registra repete-se na volta seguinte: prefiro nao entrar a entrar duas vezes",
    );
  }
}

// ---- A POSIÇÃO VIVA: concorda, ou vira ---------------------------------------------------------------
if (posicao !== undefined && posicao !== null) {
  if (String(posicao.lado) === ladoDoIndicador) {
    dizer("hold", `ja' estou ${ladoDoIndicador}: o indicador concorda com a posicao, nao ha nada a fazer`);
  }
  // O lado OPOSTO: a mesa fecha com `reduce_only` (não vira a mão numa ordem). Fica-se plano, e a abertura do
  // lado novo só acontece se a última barra fechada for a barra do flip (secção `PLANO` abaixo) — que é o
  // caminho normal quando o flip chega com uma posição viva: fecha e inverte DENTRO da mesma barra. Se o flip
  // for antigo (a mesa não estava a correr quando ele aconteceu), fecha-se e espera-se a próxima viragem: fechar
  // uma posição contra o indicador é redução de risco, abrir uma nova sem flip é que está proibido.
  dizer(ladoDoIndicador, `viragem: o indicador esta' ${ladoDoIndicador} e a posicao e' ${posicao.lado}`);
}

// ---- PLANO: e aqui manda a regra do dono — sem flip não há entrada -----------------------------------
if (ladoDoFlip === null) {
  // A última barra fechada não virou. É isto que fecha, de uma vez, os dois buracos que o dono nomeou:
  // (a) a primeira carga com o indicador já de um lado (o histórico tem viragens antigas) — não se abre no meio
  //     da perna, espera-se a próxima; (b) a ordem fechada à mão — só abre no próximo flip.
  queixa(
    `plano, e a barra ${new Date(tFechada).toISOString()} nao virou (virada=0): nao abro no meio da perna — ` +
      `a entrada so' acontece na barra do flip (o indicador esta' ${ladoDoIndicador} desde uma viragem anterior)`,
  );
  process.exit(0); // sem linha nenhuma no stdout: "nao propus" — que NAO e' o mesmo que `hold`
}
if (barraJaAberta()) {
  queixa(`barra ${new Date(tFechada).toISOString()} ja' deu a sua entrada: nao proponho nada (o relogio da ficha e' que manda)`);
  process.exit(0); // idem: silencio, e nao `hold`
}
registarBarra();
dizer(
  ladoDoFlip,
  `plano, e a barra ${new Date(tFechada).toISOString()} VIROU para ${ladoDoFlip}: entrada ` +
    `(o indicador so' autoriza uma entrada por flip — a posicao ausente e' "sem posicao", nao e' duvida)`,
);
