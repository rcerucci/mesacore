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
function naoProponho(porque: string): never {
  queixa(porque);
  process.exit(0);
}
const dizer: (lado: string, porque: string) => never = (lado, porque) => {
  const linha = JSON.stringify({
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
  process.exit(0);
};

const entrada = await new Promise<string>((resolve) => {
  let dados = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (b) => (dados += b));
  process.stdin.on("end", () => resolve(dados));
});
let leitura: any = null;
let linhaIlegivel = false;
for (const linha of entrada.split("\n")) {
  if (linha.trim() === "") continue;
  try {
    const o = JSON.parse(linha);
    if (o?.tipo === "mercado") leitura = o.carga;
  } catch {
    linhaIlegivel = true;
  }
}
if (linhaIlegivel) naoProponho("linha_ilegivel: uma linha do stdin nao e' JSON, e nao se decide sobre uma leitura partida");
if (leitura === null) naoProponho("sem leitura do mercado: nao se decide sobre o que nao se leu");
if (leitura.estado !== "aberto") naoProponho(`o mercado esta' ${leitura.estado}`);

if (pastaDoMercado === "") naoProponho("nao me deram a pasta das velas: sem barras nao ha media nem ATR");
const caminho = join(isAbsolute(pastaDoMercado) ? pastaDoMercado : join(RAIZ, pastaDoMercado), `velas-${instrumento}-${relogio}.jsonl`);
if (!existsSync(caminho)) naoProponho(`nao existe o ficheiro de velas do par (${instrumento}-${relogio})`);

const todas: Vela[] = readFileSync(caminho, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Vela);

const msDoRelogio: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000 };
const passo = msDoRelogio[relogio];
if (passo === undefined) naoProponho(`o relogio ${relogio} nao me e' conhecido`);
const agoraMs = Number(leitura.tempo_do_venue_ms ?? Date.now());
const velas = todas.filter((v) => v.t + passo <= agoraMs);
const ultima = velas[velas.length - 1];
if (ultima === undefined) naoProponho("nao ha nenhuma barra FECHADA: a primeira ainda esta' a formar");
queixa(`barras: ${todas.length} no ficheiro · ${velas.length} fechadas · ultima ${new Date(ultima.t).toISOString()}`);

const pontos = calcular(velas, constantes);
const ponto = pontos[pontos.length - 1]!;
for (const p of pontos.slice(-3)) {
  queixa(`diagnostico ${new Date(p.t).toISOString()} · ma=${p.ma?.toFixed(4)} · atr=${p.atr?.toFixed(4)} · mid=${p.mid.toFixed(4)} · mid-ma=${p.ma === null ? "na" : (p.mid - p.ma).toFixed(4)} · sig=${p.sig} · virada=${p.virada}`);
}
if (ponto.ma === null || ponto.atr === null) dizer("hold", `a serie traz so' ${velas.length} barras fechadas e o ATR do indicador precisa de ${constantes.atr_len}: uma leitura assim curta e' anomalia, nao um sinal`);
if (ponto.sig === 0) dizer("hold", "o indicador ainda nao tem lado: o preco nao saiu da zona morta em volta da media");

const ladoDoIndicador = ponto.sig === 1 ? "buy" : "sell";
const ladoDoFlip: "buy" | "sell" | null = ponto.virada === 1 ? "buy" : ponto.virada === -1 ? "sell" : null;
const posicao = leitura.posicao;
const tFechada = ultima.t;

const PASTA_DE_ESTADO = exigido("PASTA_DE_ESTADO");
const ficheiroDeEstado = join(PASTA_DE_ESTADO, `sigma-${instrumento}.json`);

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

if (posicao !== undefined && posicao !== null) {
  if (String(posicao.lado) === ladoDoIndicador) {
    dizer("hold", `ja' estou ${ladoDoIndicador}: o indicador concorda com a posicao, nao ha nada a fazer`);
  }
  dizer(ladoDoIndicador, `viragem: o indicador esta' ${ladoDoIndicador} e a posicao e' ${posicao.lado}`);
}

if (ladoDoFlip === null) {
  queixa(
    `plano, e a barra ${new Date(tFechada).toISOString()} nao virou (virada=0): nao abro no meio da perna — ` +
      `a entrada so' acontece na barra do flip (o indicador esta' ${ladoDoIndicador} desde uma viragem anterior)`,
  );
  process.exit(0);
}
if (barraJaAberta()) {
  queixa(`barra ${new Date(tFechada).toISOString()} ja' deu a sua entrada: nao proponho nada (o relogio da ficha e' que manda)`);
  process.exit(0);
}
registarBarra();
dizer(
  ladoDoFlip,
  `plano, e a barra ${new Date(tFechada).toISOString()} VIROU para ${ladoDoFlip}: entrada ` +
    `(o indicador so' autoriza uma entrada por flip — a posicao ausente e' "sem posicao", nao e' duvida)`,
);
