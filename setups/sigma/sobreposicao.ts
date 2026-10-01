#!/usr/bin/env bun
// A SOBREPOSICAO DO SETUP `sigma` — o que o indicador MOSTRA, barra a barra, para se desenhar.
//
// PORQUE ISTO EXISTE SEPARADO DO `plugin.ts`. O plugin decide (propoe um lado, uma vez por barra fechada) e
// cala-se. Quem desenha precisa do contrario: a SERIE INTEIRA, para o dono ver no grafico exactamente o que o
// motor viu quando decidiu. E ha uma regra da casa que decide ONDE esta serie nasce: a web NAO recalcula o que
// o motor sabe (RN-E9). Se o painel reimplementasse a media, a banda e o zigzag em JavaScript, haveria DUAS
// contas do mesmo indicador no mesmo ecra — e no dia em que divergissem, o dono veria o grafico a contradizer a
// mesa sem saber qual dos dois mente.
//
// Por isso a serie sai DAQUI: deste ficheiro, do lado do setup, a chamar a MESMA funcao pura que o plugin
// chama (`sinal.ts` -> `calcular`). Uma conta, um dono. O painel so desenha o que lhe chega.
//
// O QUE ISTO NAO E', e importa: NAO e' uma mensagem do contrato. Nao leva envelope, nao leva `versao`, nao
// atravessa porta nenhuma — e um retrato datado para desenhar, e por isso se identifica como tal na primeira
// chave. Fazer disto um `tipo` novo do contrato seria uma emenda, e uma emenda nao se improvisa por causa de
// um grafico.
//
// A BARRA QUE AINDA ESTA' A FORMAR NAO ENTRA na serie (o plugin faz o mesmo com `barState.isconfirmed`): o que
// a serie mostra e' a barra que DECIDIU. A barra em curso vai no fim, dita como tal e SEM lado, para o painel a
// poder pintar de outra maneira — e para o dono ver a diferenca entre "o motor decidiu" e "o mercado esta' a
// mexer-se".
//
// Uso (o mesmo ambiente do plugin, para nao haver duas maneiras de dizer a mesma coisa):
//   CONSTANTES=<json> INSTRUMENTO=SOL RELOGIO=1h PASTA_DE_MERCADO=<pasta> bun run setups/sigma/sobreposicao.ts

import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { calcular, type Vela, type Constantes } from "./sinal.ts";

const NOME = "sigma";
const VERSAO = "0.1.0";
const RAIZ = join(import.meta.dir, "..", "..");

/** Falta de ambiente NAO se adivinha: diz-se e nao se desenha nada. */
function exigido(nome: string): string {
  const v = process.env[nome];
  if (v === undefined || v === "") {
    process.stderr.write(JSON.stringify({ setup: NOME, sobreposicao: "recusada", porque: `falta \`${nome}\` no ambiente` }) + "\n");
    process.exit(2);
  }
  return v;
}
const constantes = JSON.parse(exigido("CONSTANTES")) as Constantes;
const instrumento = exigido("INSTRUMENTO");
const relogio = exigido("RELOGIO");
const pastaDoMercado = exigido("PASTA_DE_MERCADO");

const MS_DO_RELOGIO: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000,
};
const passo = MS_DO_RELOGIO[relogio];
if (passo === undefined) {
  process.stderr.write(JSON.stringify({ setup: NOME, sobreposicao: "recusada", porque: `o relogio ${relogio} nao me e' conhecido` }) + "\n");
  process.exit(2);
}

const caminho = join(isAbsolute(pastaDoMercado) ? pastaDoMercado : join(RAIZ, pastaDoMercado), `velas-${instrumento}-${relogio}.jsonl`);
if (!existsSync(caminho)) {
  process.stderr.write(JSON.stringify({ setup: NOME, sobreposicao: "recusada", porque: `nao existe o ficheiro de velas (${instrumento}-${relogio})` }) + "\n");
  process.exit(2);
}
const todas: Vela[] = readFileSync(caminho, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Vela);

// `AGORA` e' o instante do venue quando o operador leu (o painel passa-o); sem ele, o relogio da maquina — e
// diz-se qual dos dois foi, porque uma serie cortada pelo relogio errado e' uma serie com outra ultima barra.
const agoraMs = process.env["AGORA_MS"] !== undefined && process.env["AGORA_MS"] !== ""
  ? Number(process.env["AGORA_MS"])
  : Date.now();
const fechadas = todas.filter((v) => v.t + passo <= agoraMs);
const emCurso = todas.filter((v) => v.t + passo > agoraMs);
const ultima = fechadas[fechadas.length - 1];
if (ultima === undefined) {
  process.stderr.write(JSON.stringify({ setup: NOME, sobreposicao: "recusada", porque: "nao ha nenhuma barra FECHADA nesta janela: uma serie so' com a barra em curso nao se desenha" }) + "\n");
  process.exit(2);
}

const pontos = calcular(fechadas, constantes);

// O QUE VAI NA SERIE: SO' O QUE E' DO INDICADOR. As VELAS nao vem daqui — elas sao do VENUE, e viajam no
// ficheiro do mercado, ao lado. Misturar as duas coisas neste ficheiro faria a serie depender de o setup saber
// ler velas (nao precisa), e faria o grafico ficar sem velas no dia em que um setup nao publicasse nada.
// O que amarra as duas e' o TEMPO (`t`): o leitor cruza por `t`, nunca por indice — cruzar por indice ja'
// pos marcas no lado errado quando os dois ficheiros tinham comprimentos diferentes.
const serie = pontos.map((p) => ({
  t: p.t,
  mid: p.mid,
  ma: p.ma,
  atr: p.atr,
  banda: p.banda,
  sig: p.sig,
  extremo: p.extremo,
  virada: p.virada,
}));

const saida = {
  _o_que_e_isto:
    "SOBREPOSICAO do setup para desenhar. NAO e' mensagem do contrato (sem envelope, sem versao): e' o que o " +
    "indicador mostra barra a barra, calculado pelo dono do indicador. A barra em curso vem separada e SEM lado.",
  contrato_da_ficha: process.env["CONTRATO_DA_FICHA"] ?? null,
  setup: { nome: NOME, versao: VERSAO },
  instrumento,
  relogio,
  agora_ms: agoraMs,
  relogio_da_maquina_ms: Date.now(),
  fontes: { velas: caminho },
  janela: {
    no_ficheiro: todas.length,
    fechadas: fechadas.length,
    primeira_fechada: fechadas[0]!.t,
    ultima_fechada: ultima.t,
  },
  constantes,
  serie,
  em_curso: emCurso.length > 0 ? { t: emCurso[emCurso.length - 1]!.t, o: emCurso[emCurso.length - 1]!.o, h: emCurso[emCurso.length - 1]!.h, l: emCurso[emCurso.length - 1]!.l, c: emCurso[emCurso.length - 1]!.c } : null,
};

process.stdout.write(JSON.stringify(saida) + "\n");
