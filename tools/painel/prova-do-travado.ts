#!/usr/bin/env bun
// A PROVA DO «TRAVADO» — o que trava um par, e o que NÃO trava.
//
// O QUE ISTO MEDE: a regra de `tools/painel/travado.ts` — há DUAS razões para um par não fazer nada, e elas não valem
// o mesmo. ESPERA é uma abstenção (o setup não tem nada a dizer; é o estado NORMAL de um sistema em observação);
// ATENÇÃO é a mesa não ter conseguido fazer o que queria (sem leitura, sem margem, desfecho recusado, posição
// desconhecida…), e é do dono. `travado` é só a ATENÇÃO — a espera é DITA, com o tempo, mas não usa essa palavra.
//
// PORQUE EXISTE, medido a 04/10/2026 no painel vivo: o ETH (1m, com 273 preenchimentos e uma ordem preenchida 10
// minutos antes) aparecia `travado` com `1 ciclo`, e o contador oscilava entre 2 e 3 a cada leitura — o dono lia
// «3 pares travados» com o par a operar. A correcção seguinte (o TEMPO: «mais de uma barra do par») ainda oscilava
// num par de 1m, onde «mais de uma barra» são DOIS MINUTOS — e ainda calava um defeito de uma só volta, o que é
// pior. A régua certa é a NATUREZA do motivo; o tempo continua a ser dito, mas não escolhe a palavra.
//
// A PROVOCAÇÃO: as DUAS réguas antigas são aplicadas aos mesmos casos e têm de dar o resultado errado — a do tempo
// cala um defeito de uma volta, e a do `quantos > 0` chama «travado» à espera de um ciclo.
//
// Uso:  bun run tools/painel/prova-do-travado.ts

import { oQueTrava, classeDoMotivo } from "./travado.ts";

const problemas: string[] = [];
const certeza = (condicao: boolean, texto: string) => {
  if (!condicao) problemas.push(texto);
  console.log(`   ${condicao ? "ok   " : "FALHA"} ${texto}`);
};

/** Uma corrente de `n` ciclos `nada` seguidos (o registo, do mais antigo para o mais novo). */
const corrente = (n: number, motivo: string | null = "proposta_ausente_tratada_como_hold", inicio = 1_700_000_000_000) =>
  Array.from({ length: n }, (_, k) => ({ acao: "nada", motivo, instante_ms: inicio + k * 60_000 }));

console.log("== a NATUREZA de um motivo ==");
certeza(classeDoMotivo("proposta_ausente_tratada_como_hold") === "espera", "«o setup não propôs nada» é ESPERA (abstenção)");
certeza(classeDoMotivo("proposta_sem_lado_a_executar") === "espera", "«propôs sem lado» é ESPERA");
certeza(classeDoMotivo("proposta_de_barra_antiga") === "espera", "«proposta de barra antiga» é ESPERA");
certeza(classeDoMotivo("leitura_ausente_no_ciclo") === "atencao", "«sem leitura do venue» é ATENÇÃO");
certeza(classeDoMotivo("sem_margem_no_ciclo") === "atencao", "«sem margem» é ATENÇÃO");
certeza(classeDoMotivo("desfecho_recusado_pelo_venue") === "atencao", "«desfecho recusado» é ATENÇÃO");
certeza(classeDoMotivo("posicao_desconhecida") === "atencao", "«posição desconhecida» é ATENÇÃO");

console.log("\n== travado só quando é ATENÇÃO (a espera é dita como espera) ==");
const eth = oQueTrava(corrente(1, "proposta_sem_lado_a_executar"));
certeza(eth.travado === false && eth.classe === "espera", `ETH 1m com 1 ciclo sem lado NÃO está travado — é espera (classe=${eth.classe})`);
certeza(eth.ciclos === 1 && eth.porque === "proposta_sem_lado_a_executar", "e o motivo cru e a contagem continuam a viajar (a espera não se esconde)");
const btc = oQueTrava(corrente(436));
certeza(btc.travado === false && btc.classe === "espera", "BTC com 436 ciclos de «sem proposta» é ESPERA — um sistema à espera de uma viragem, não um sistema avariado");
const defeito = oQueTrava(corrente(1, "leitura_ausente_no_ciclo"));
certeza(defeito.travado === true && defeito.classe === "atencao", "UMA volta sem leitura já é ATENÇÃO — um defeito não se cala por ser curto");
const defeitoLongo = oQueTrava(corrente(50, "sem_margem_no_ciclo"));
certeza(defeitoLongo.travado === true, "e um defeito longo também (o tempo não é a régua, mas é dito)");
const misto = oQueTrava([...corrente(10, "leitura_ausente_no_ciclo"), ...corrente(3, "proposta_ausente_tratada_como_hold")]);
certeza(misto.classe === "espera" && misto.porque === "proposta_ausente_tratada_como_hold", "a corrente é a do motivo VIGENTE: um defeito que já passou não mantém o par em atenção");
certeza(misto.ciclos === 3, `e a contagem é a DESTE motivo, não de todos os ciclos sem ação (medido ${misto.ciclos}, e não 13)`);
certeza(misto.desde_ms === corrente(3)[0]!.instante_ms, "e o «há quanto tempo» conta desde que ESTE motivo começou");

console.log("\n== o que a corrente carrega ==");
certeza(btc.porque === "proposta_ausente_tratada_como_hold", `o motivo dominante é dito (${btc.porque})`);
certeza(btc.ciclos === 436, `e os ciclos da corrente também (${btc.ciclos})`);
certeza(btc.desde_ms === corrente(436)[0]!.instante_ms, "e o instante em que a corrente COMEÇOU (o «há quanto tempo» sai daqui)");
const depoisDeAgir = oQueTrava([...corrente(50, "leitura_ausente_no_ciclo"), { acao: "abrir", motivo: null, instante_ms: 1_700_000_500_000 }]);
certeza(depoisDeAgir.travado === false && depoisDeAgir.ciclos === 0, "um ciclo com ação no fim zera a corrente (não arrasta defeitos antigos)");
certeza(oQueTrava([]).travado === false, "sem ciclos nenhuns não há corrente (e não se inventa um travamento)");

console.log("\n== na dúvida, é ATENÇÃO (nunca se esconde o que não se conhece) ==");
certeza(classeDoMotivo("motivo_que_nunca_se_viiu") === "atencao", "um motivo fora da lista conta como ATENÇÃO");
certeza(classeDoMotivo(null) === "atencao", "e um motivo ausente também — o que não se sabe não é uma espera");

console.log("\n== A PROVOCAÇÃO: as duas réguas antigas davam o resultado errado ==");
const reguaDoTempo = (meusCiclos: any[], porBarra: number) => meusCiclos.length > porBarra; // «mais de uma barra do par»
const reguaDaVolta = (meusCiclos: any[]) => meusCiclos.length > 0;                          // `quantos > 0`
certeza(reguaDaVolta(corrente(1, "proposta_sem_lado_a_executar")) === true,
  "a régua «quantos > 0» chamaria «travado» à espera de UM ciclo (o defeito medido no painel vivo)");
certeza(oQueTrava(corrente(1, "proposta_sem_lado_a_executar")).travado === false, "e a régua nova não o chama");
certeza(reguaDoTempo(corrente(1, "leitura_ausente_no_ciclo"), 1) === false && oQueTrava(corrente(1, "leitura_ausente_no_ciclo")).travado === true,
  "a régua do TEMPO calaria um DEFEITO de uma volta — e a régua nova não o cala");
certeza(reguaDoTempo(corrente(2, "proposta_sem_lado_a_executar"), 1) === true && oQueTrava(corrente(2, "proposta_sem_lado_a_executar")).travado === false,
  "e a régua do tempo chamaria «travado» a 2 minutos de espera num par de 1m — a régua nova diz espera");

console.log("");
if (problemas.length === 0) {
  console.log("prova do travado: travado é ATENÇÃO (a mesa não conseguiu) · espera é abstenção (o setup não tem nada a dizer) · o desconhecido é atenção");
  process.exit(0);
}
console.log(`prova do travado: FALHOU — ${problemas.length} verificacao(oes)`);
for (const p of problemas) console.log(`   · ${p}`);
process.exit(1);
