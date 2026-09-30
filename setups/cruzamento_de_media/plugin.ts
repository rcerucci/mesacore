#!/usr/bin/env bun
// O SETUP DE REFERENCIA — cruzamento de medias. Fica DESLIGADO (`run: false` na ficha) e serve de MOLDE.
//
// A POLITICA VIVE AQUI, e so aqui: a mesa nao sabe nada dela. O que ele recebe e' a leitura do mercado no
// `stdin` (a mensagem `mercado` do contrato) e as velas num ficheiro JSONL; o que devolve e' UMA linha
// `proposta`, com a barra do sinal.
//
// O QUE ESTE FICHEIRO ENSINA, e que e' o que se copia para o proximo setup:
//   1. NADA E' OPCIONAL. O ambiente que falta nao tem valor por omissao: recusa-se com o nome do que falta.
//      Um `?? "BTC"` fez uma conta que dizia SOL operar BTC uma noite inteira — nao se repete.
//   2. QUEM NAO CONSEGUE CALCULAR NAO FALA. Sem barra nao ha proposta (a `barra_ms` e' obrigatoria):
//      o diagnostico vai para o `stderr` e o `stdout` fica vazio. `hold` e' uma OPINIAO, e nao se inventa.
//   3. A BARRA E' A DA DECISAO: a ultima barra FECHADA do relogio da ficha (a que ainda esta' a formar nao conta,
//      como o `barstate.isconfirmed` do Pine).

import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";

const NOME = "cruzamento_de_media";
const RAIZ = join(import.meta.dir, "..", "..");

/** O ambiente obrigatorio: falta um -> recusa com o nome dele (e nao um valor inventado). */
function exigido(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === "") {
    process.stderr.write(JSON.stringify({ setup: NOME, veredicto: "recusado", porque: `falta \`${nome}\` no ambiente: sem isso nao se calcula nada` }) + "\n");
    process.exit(2);
  }
  return v;
}
const queixa = (porque: string) => process.stderr.write(JSON.stringify({ setup: NOME, diagnostico: porque }) + "\n");
function naoProponho(porque: string): never {
  queixa(porque);
  process.exit(0);
}

const instrumento = exigido("INSTRUMENTO");
const relogio = exigido("RELOGIO");
const pastaDoMercado = exigido("PASTA_DE_MERCADO");
const constantes = JSON.parse(exigido("CONSTANTES")) as { rapida?: number; lenta?: number };
if (constantes.rapida === undefined || constantes.lenta === undefined) {
  process.stderr.write(JSON.stringify({ setup: NOME, veredicto: "recusado", porque: "a ficha do par nao declara `rapida` e `lenta`: o setup nao corre com metade das constantes" }) + "\n");
  process.exit(2);
}
const PASSO: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000 };
const passo = PASSO[relogio];
if (passo === undefined) naoProponho(`o relogio \`${relogio}\` da ficha nao me e' conhecido`);

// ---- a leitura, do stdin ------------------------------------------------------------------------------
const entrada = await new Promise<string>((resolve) => {
  let dados = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (b) => (dados += b));
  process.stdin.on("end", () => resolve(dados));
});
let leitura: Record<string, unknown> | null = null;
for (const linha of entrada.split("\n")) {
  if (linha.trim() === "") continue;
  try {
    const o = JSON.parse(linha);
    if (o?.tipo === "mercado") leitura = o.carga;
  } catch {
    /* linha ilegivel nao vira leitura */
  }
}
if (leitura === null) naoProponho("sem leitura do mercado: nao se decide sobre o que nao se leu");

// ---- as velas, do ficheiro do relogio da ficha --------------------------------------------------------
const caminho = join(isAbsolute(pastaDoMercado) ? pastaDoMercado : join(RAIZ, pastaDoMercado), `velas-${instrumento}-${relogio}.jsonl`);
if (!existsSync(caminho)) naoProponho(`nao existe o ficheiro de velas do par (${instrumento}-${relogio})`);
const todas = readFileSync(caminho, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as { t: number; c: string });
const agora = Number(leitura["tempo_do_venue_ms"]);
if (!Number.isFinite(agora)) naoProponho("a leitura veio sem `tempo_do_venue_ms`: sem o instante do venue nao ha barra");
const velas = todas.filter((v) => v.t + passo <= agora);
const ultima = velas[velas.length - 1];
if (ultima === undefined) naoProponho("nao ha nenhuma barra FECHADA: a primeira ainda esta' a formar");

// ---- a decisao: o cruzamento, e mais nada -------------------------------------------------------------
const fecho = velas.map((v) => Number(v.c));
if (fecho.some((x) => !Number.isFinite(x))) naoProponho("ha' velas sem fecho numerico: recusa-se em vez de calcular com lixo");
const media = (n: number) => fecho.slice(-n).reduce((s, x) => s + x, 0) / n;
const rapida = media(constantes.rapida!);
const lenta = media(constantes.lenta!);
let lado = "hold";
if (rapida > lenta) lado = "buy";
else if (rapida < lenta) lado = "sell";

const linha = JSON.stringify({
  // A VERSAO DO CONTRATO LE-SE, NAO SE ESCREVE AQUI: era `"1.8.0"` a mao, e este exemplo — que e' MOLDE para o
  // proximo setup — passava a emitir propostas que o contrato recusa logo que houvesse uma emenda. A versao
  // vive num so' sitio (`contracts/versao.json`).
  contrato: versaoVigente(),
  tipo: "proposta",
  id: `${NOME}-${instrumento}-${Date.now()}`,
  carga: { setup: { nome: NOME, versao: "1.0.0" }, lado, barra_ms: ultima.t },
});
queixa(`media ${constantes.rapida}=${rapida.toFixed(4)} contra ${constantes.lenta}=${lenta.toFixed(4)} · barra ${new Date(ultima.t).toISOString()}`);
// A AUTO-CONFERENCIA, como no `sigma`: uma proposta que o contrato recusa NAO SAI — e diz-se por que.
const decisao = validar(linha);
if (decisao.veredicto !== "aceite") {
  queixa(`a minha propria proposta nao passa o contrato (${decisao.motivo}) — prefiro nao propor a propor mal`);
  process.exit(3);
}
console.log(linha);
