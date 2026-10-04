#!/usr/bin/env bun
// A PROVA DA LIGAÇÃO POSIÇÃO → ORDEM — a marca de posse ligada ao desfecho que a enviou.
//
// O QUE ISTO MEDE: `tools/painel/desfechos.ts` — a posição traz a MARCA com que a mesa a tomou por sua
// (`marca_de_posse`) e o desfecho traz a REFERÊNCIA, o `oid` do venue, o `cloid` e o preço médio dessa ordem. Ligar
// as duas é o que deixa comparar a tela com o UI da Hyperliquid linha a linha.
//
// O CASO REAL QUE A OBRIGOU (04/10/2026): o dono comparou o painel com o UI do venue, viu a posição ETH e as ordens
// dela, e não conseguiu casar as duas pontas — a ligação já era requisito e ficou por fazer.
//
// A PROVOCAÇÃO: uma marca que só existe nos desfechos de OUTRA corrida (ficheiro não passado) tem de dar
// `encontrada: false` com o porquê — nunca um `oid` a fingir. E uma marca com recusa e reenvio tem de escolher a
// linha que VALeu, não a primeira.
//
// Uso:  bun run tools/painel/prova-da-ordem.ts

import { marcadorDosDesfechos, ordemDaPosicao } from "./desfechos.ts";

const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
};

/** Uma linha de desfecho, como o sistema a escreve (só os campos que a ligação lê). */
const desfecho = (marca: number, extras: any = {}) => ({
  quando: "2026-10-04T16:30:15.836Z", marca, referencia: `mesa-sigma_v0-${String(marca).padStart(6, "0")}`,
  instrumento: "ETH", recusado: false,
  desfecho: {
    classificacao: "aceite",
    resposta_do_venue: { estado: "filled", order_id: `oid-${marca}`, preenchido: "0.004", preco_medio: "2692.9", bruto: { oid: 61832568782 + marca, cloid: `0xcloid${marca}`, avgPx: "2692.9" } },
  },
  ...extras,
});

const recusa = (marca: number) => ({
  quando: "2026-10-04T09:15:05.000Z", marca, referencia: `mesa-sigma_v0-${String(marca).padStart(6, "0")}`,
  instrumento: "ETH", recusado: true,
  desfecho: { classificacao: "recusado", motivo: "referencia_ja_enviada_ao_venue", resposta_do_venue: { estado: "ja_existia_no_venue" } },
});

console.log("== a posição liga-se à ordem que a abriu ==");
const mapa = marcadorDosDesfechos([[desfecho(442)]]);
const lig = ordemDaPosicao(mapa, { lado: "buy", unidades: "0.004", preco_medio: "2692.9", marca_de_posse: 442 });
certeza(lig.encontrada === true, `a marca 442 tem desfecho — a ligação encontrou-se (medido ${lig.encontrada})`);
certeza(lig.oid === 61832568782 + 442, `e traz o oid do VENUE, que é o que se compara com o UI (medido ${lig.oid})`);
certeza(lig.referencia === "mesa-sigma_v0-000442", `e a nossa referência (${lig.referencia})`);
certeza(lig.preco_medio === "2692.9" && lig.classificacao === "aceite", "e o preço médio e a classificação da ordem");

console.log("\n== uma marca com RECUSA e REENVIO: vale a ÚLTIMA linha, não a primeira ==");
const mapa2 = marcadorDosDesfechos([[recusa(443), desfecho(443)]]);
const lig2 = ordemDaPosicao(mapa2, { marca_de_posse: 443 });
certeza(lig2.encontrada === true && lig2.recusado === false && lig2.classificacao === "aceite", "a marca recusada e reenviada fica com a linha ACEITE (a que valeu)");

console.log("\n== sem marca, ou sem desfecho: DIZ-SE o que falta (nunca um oid a fingir) ==");
const semMarca = ordemDaPosicao(mapa, { lado: "buy", unidades: "0.004" });
certeza(semMarca.encontrada === false && /não traz marca/.test(semMarca.porque), `posição sem marca de posse: diz-se porquê — ${semMarca.porque}`);
const semDesfecho = ordemDaPosicao(mapa, { marca_de_posse: 999 });
certeza(semDesfecho.encontrada === false && /não há desfecho/.test(semDesfecho.porque), `marca sem desfecho nesta corrida: diz-se porquê — ${semDesfecho.porque}`);
certeza(semDesfecho.oid === undefined, "e NÃO se inventa um oid para o que não se encontrou");
certeza(ordemDaPosicao(mapa, null) === null, "sem posição não há ligação nenhuma (null, não um objeto vazio)");

console.log("\n== A PROVOCAÇÃO: uma marca de OUTRA corrida não se liga ==");
const doutraCorrida = marcadorDosDesfechos([[desfecho(7)]]);
certeza(doutraCorrida.has(442) === false, "o mapa de outra corrida NÃO tem a marca 442");
const ligProv = ordemDaPosicao(doutraCorrida, { marca_de_posse: 442 });
certeza(ligProv.encontrada === false && ligProv.marca === 442, "e a ligação dá `encontrada: false` (não casa marcas entre corridas)");
certeza(doutraCorrida.size === 1, `o mapa não cresce com o que não existe (medido ${doutraCorrida.size})`);

console.log("");
if (problemas.length === 0) {
  console.log("prova da ordem: a posição liga-se ao desfecho pela marca de posse · vale a última linha · sem desfecho diz-se o que falta");
  process.exit(0);
}
console.log(`prova da ordem: FALHOU — ${problemas.length} verificacao(oes)`);
for (const p of problemas) console.log(`   · ${p}`);
process.exit(1);
