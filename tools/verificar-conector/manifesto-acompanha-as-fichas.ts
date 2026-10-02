// O MANIFESTO ACOMPANHA AS FICHAS — o instrumento que entra por uma ficha ligada a' QUENTE.
//
// MEDIDO a 02/10/2026, conta de teste, com o ETH: a ficha foi ligada a quente (o conector passou a ler o par, o
// setup propos, a mesa decidiu `abrir`) e a ORDEM FOI RECUSADA — `instrumento_desconhecido_no_manifesto`. As
// unidades publicadas no manifesto sao as dos instrumentos PEDIDOS no arranque, e o ETH nao estava la'. Nada
// saiu (a recusa e' nomeada, nao se envia nada a' toa), mas o par ficava inoperavel ate' reiniciar o conector.
//
// O que esta bancada fixa, com a sonda dos casos (universo BTC+ETH, pedidos = so' BTC):
//
//   1. instrumento JA' nas unidades   -> o manifesto do arranque, o MESMO objecto (identidade: nao se reconstrói
//                                        o que ja' serve, e a mensagem publicada nao muda);
//   2. instrumento SO' no universo    -> manifesto reconstruido com a unidade dele, e a TRADUCAO PASSA (o defeito);
//   3. instrumento que NAO existe     -> o manifesto do arranque, e a traducao RECUSA a NOMEAR (nao se inventa);
//   4. a mensagem do arranque NAO cresce: as unidades pedidas continuam a ser as mesmas.
//
// Uso: bun run tools/verificar-conector/manifesto-acompanha-as-fichas.ts   (sai 1 se algo divergir)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { construirManifesto, manifestoParaInstrumento, type Sonda } from "../../brokers/hyperliquid/manifesto.ts";
import { traduzirOrdem } from "../../brokers/hyperliquid/ordens.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const ler = (caminho: string) => JSON.parse(readFileSync(join(RAIZ, caminho), "utf8"));

let verificacoes = 0;
let divergentes = 0;
function exigir(condicao: boolean, texto: string, contexto: string[] = []): void {
  verificacoes += 1;
  if (condicao) console.log(`ok    ${texto}`);
  else {
    divergentes += 1;
    console.log(`DIVERGE ${texto}`);
    for (const c of contexto) console.log(`        ${c}`);
  }
}

const casos = ler("brokers/hyperliquid/casos/manifesto.casos.json");
const sonda = casos.sonda_base as Sonda;
const dasOrdens = ler("brokers/hyperliquid/casos/ordens.casos.json");

const construido = construirManifesto(sonda);
if (!construido.ok) {
  console.log(`DIVERGE a sonda dos casos nao produz manifesto: ${construido.motivo}`);
  process.exit(1);
}
const manifestoDoArranque = construido.manifesto;
const unidadesDoArranque = (manifestoDoArranque as { instrumentos: { simbolo: string }[] }).instrumentos;

// Uma boleta valida do instrumento que se quer por a operar — a FORMA e' a dos casos das ordens, e so' o
// instrumento muda: e' isso que a ficha nova faz.
const boletaPara = (instrumento: string) => ({
  ...(dasOrdens.boleta_base as Record<string, unknown>),
  instrumento,
});
const traduz = (instrumento: string, manifesto: unknown) =>
  traduzirOrdem({
    conta: dasOrdens.conta_de_teste,
    boleta: boletaPara(instrumento) as never,
    manifesto: manifesto as never,
    saldo: (dasOrdens.pedido_base as { saldo: string }).saldo,
    preco: (dasOrdens.pedido_base as { preco: string }).preco,
  } as never);

// --- 1. O QUE JA' SERVE: o instrumento pedido no arranque nao passa por reconstrucao nenhuma
const paraBtc = manifestoParaInstrumento(sonda, manifestoDoArranque, "BTC");
exigir(paraBtc === manifestoDoArranque, "instrumento pedido no arranque: devolve o MESMO manifesto (identidade, sem reconstrucao)");
exigir(traduz("BTC", paraBtc).ok, "instrumento pedido no arranque: a traducao passa (o caminho de sempre nao muda)");

// --- 2. O DEFEITO: o instrumento que veio de uma ficha ligada a' quente (esta' no universo, nao nas unidades)
const paraEth = manifestoParaInstrumento(sonda, manifestoDoArranque, "ETH");
const simbolosDeEth = (paraEth as { instrumentos: { simbolo: string }[] }).instrumentos.map((i) => i.simbolo);
exigir(simbolosDeEth.includes("ETH"), "instrumento SO' no universo: o manifesto reconstruido traz a unidade dele", [`unidades: ${simbolosDeEth.join(",")}`]);
const accaoEth = traduz("ETH", paraEth);
exigir(accaoEth.ok, "instrumento SO' no universo: a TRADUCAO PASSA — era aqui que a ordem do ETH era recusada", accaoEth.ok ? [] : [`motivo: ${accaoEth.motivo} — ${accaoEth.porque}`]);

// --- 2b. O CONTROLO, e e' ele que prova que a assercao 2 mede o que diz medir: com o manifesto do ARRANQUE —
//         o que o conector usava antes desta correcao — a MESMA boleta e' RECUSADA. E' o defeito de 02/10/2026.
const accaoEthComOManifestoDoArranque = traduz("ETH", manifestoDoArranque);
exigir(
  !accaoEthComOManifestoDoArranque.ok && accaoEthComOManifestoDoArranque.motivo === "instrumento_desconhecido_no_manifesto",
  "CONTROLO: com o manifesto do arranque a boleta do ETH era RECUSADA (o defeito medido a 02/10/2026)",
  accaoEthComOManifestoDoArranque.ok ? ["passou — o controlo nao mede nada"] : [],
);

// --- 3. O QUE NAO EXISTE: nao se inventa unidade — quem recusa e' a traducao, e nomeia
const paraXyz = manifestoParaInstrumento(sonda, manifestoDoArranque, "XYZ");
exigir(paraXyz === manifestoDoArranque, "instrumento que nao existe no venue: devolve o manifesto do arranque (nao se inventa unidade)");
const accaoXyz = traduz("XYZ", paraXyz);
exigir(
  !accaoXyz.ok && accaoXyz.motivo === "instrumento_desconhecido_no_manifesto",
  "instrumento que nao existe no venue: a traducao RECUSA e nomeia `instrumento_desconhecido_no_manifesto`",
  accaoXyz.ok ? ["passou (nao devia)"] : [],
);

// --- 4. A MENSAGEM PUBLICADA NAO CRESCE: a reconstrucao serve a boleta, e nao engorda o manifesto do arranque
const unidadesDepois = (manifestoDoArranque as { instrumentos: { simbolo: string }[] }).instrumentos;
exigir(
  unidadesDepois === unidadesDoArranque && unidadesDepois.length === 1 && unidadesDepois[0]!.simbolo === "BTC",
  "o manifesto do ARRANQUE continua com as unidades pedidas (a reconstrucao nao altera o que foi publicado)",
  [`unidades: ${unidadesDepois.map((u) => u.simbolo).join(",")}`],
);

console.log(`\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · 1 instrumento ligado a quente traduzido`);
process.exit(divergentes === 0 ? 0 : 1);
