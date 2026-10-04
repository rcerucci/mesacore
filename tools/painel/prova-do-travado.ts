#!/usr/bin/env bun
// A PROVA DO «TRAVADO» — o que trava um par, e o que NÃO trava.
//
// O QUE ISTO MEDE: a regra de `tools/painel/travado.ts` — `travado` é uma abstenção que JÁ DUROU MAIS DE UMA BARRA
// do próprio par, e não uma volta sem ação. É a diferença entre um sistema que espera uma viragem (normal) e um par
// que não consegue agir há horas (digno da palavra).
//
// PORQUE EXISTE, medido a 04/10/2026 no painel vivo: o ETH (1m, com 273 preenchimentos na corrida e uma ordem
// preenchida 10 minutos antes) aparecia `travado` com `1 ciclo` — e como o `vivo.json` (2 s) e o `painel.json`
// (60 s) são gerados em instantes diferentes, o contador do painel OSCILAVA entre 2 e 3 travados a cada leitura.
// O dono lia «3 pares travados» com o par a operar.
//
// A PROVOCAÇÃO: o critério ANTIGO (`quantos > 0`) é aplicado aos mesmos casos e tem de dar o resultado errado
// (o ETH de 1 ciclo a «travado») — sem isso, não se prova que foi o critério que mudou.
//
// Uso:  bun run tools/painel/prova-do-travado.ts

import { oQueTrava, ciclosPorBarra } from "./travado.ts";

const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
};

/** Uma corrente de `n` ciclos `nada` seguidos (o registo, do mais antigo para o mais novo). */
const corrente = (n: number, motivo = "proposta_ausente_tratada_como_hold", inicio = 1_700_000_000_000) =>
  Array.from({ length: n }, (_, k) => ({ acao: "nada", motivo, instante_ms: inicio + k * 60_000 }));

console.log("== os minutos de uma barra, lidos do relógio da ficha ==");
for (const [relogio, esperado] of [["1m", 1], ["30m", 30], ["4h", 240], ["1h", 60]] as const) {
  certeza(ciclosPorBarra(relogio) === esperado, `«${relogio}» são ${esperado} minutos (medido ${ciclosPorBarra(relogio)})`);
}
certeza(ciclosPorBarra("") === null, "sem relógio (vazio) devolve null — não se inventa uma barra");
certeza(ciclosPorBarra("meia hora") === null, "um relógio ilegível devolve null — não se inventa uma barra");

console.log("\n== o critério: travado = mais de uma barra do PRÓPRIO par ==");
const eth = oQueTrava(corrente(1, "proposta_sem_lado_a_executar"), "1m");
certeza(eth.travado === false, `ETH 1m com 1 ciclo sem ação NÃO está travado — é o par a esperar (medido travado=${eth.travado})`);
const eth2 = oQueTrava(corrente(2, "proposta_sem_lado_a_executar"), "1m");
certeza(eth2.travado === true, "o MESMO ETH 1m com 2 ciclos sem ação JÁ está travado (durou mais de uma barra)");
const btc = oQueTrava(corrente(436), "30m");
certeza(btc.travado === true, "BTC 30m com 436 ciclos sem ação está travado (14 barras de silêncio)");
const btcCurto = oQueTrava(corrente(30), "30m");
certeza(btcCurto.travado === false, "e o mesmo BTC 30m com 30 ciclos (exactamente uma barra) ainda NÃO está travado");

console.log("\n== o que a corrente carrega (o motivo e o desde-quando não se perdem) ==");
certeza(btc.porque === "proposta_ausente_tratada_como_hold", `o motivo dominante é dito (${btc.porque})`);
certeza(btc.ciclos === 436, `e os ciclos da corrente também (${btc.ciclos})`);
certeza(btc.desde_ms !== null && btc.desde_ms === corrente(436)[0]!.instante_ms, "e o instante em que a corrente COMEÇOU (o «há quanto tempo» sai daqui)");
const depoisDeAgir = oQueTrava([...corrente(50), { acao: "abrir", motivo: null, instante_ms: 1_700_000_500_000 }], "30m");
certeza(depoisDeAgir.travado === false && depoisDeAgir.ciclos === 0, "um ciclo com ação no fim zera a corrente (não arrasta abstensões antigas)");

console.log("\n== na dúvida, diz-se que trava (nunca se esconde uma abstenção) ==");
const semRelogio = oQueTrava(corrente(1), null);
certeza(semRelogio.travado === true, "sem relógio legível, uma volta sem ação CONTINUA a contar como travado");

console.log("\n== A PROVOCAÇÃO: o critério antigo dava o resultado errado ==");
const antigo = (meusCiclos: any[]) => meusCiclos.length > 0;
certeza(antigo(corrente(1)) === true, "com o critério ANTIGO (`quantos > 0`), o ETH de 1 ciclo seria «travado» — é o defeito medido");
certeza(oQueTrava(corrente(1), "1m").travado !== antigo(corrente(1)), "e o critério novo DISCORDA dele exactamente nesse caso — a prova mede a diferença, não a repete");

console.log("");
if (problemas.length === 0) {
  console.log("prova do travado: travado é uma abstensão de mais de uma barra · o par que opera não é pintado de travado · na dúvida diz-se que trava");
  process.exit(0);
}
console.log(`prova do travado: FALHOU — ${problemas.length} verificacao(oes)`);
for (const p of problemas) console.log(`   · ${p}`);
process.exit(1);
