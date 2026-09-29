// A prova da mesa: comando -> resposta -> marcas em disco -> registo.
//
// Esta prova NAO confia na memoria do processo: depois de escrever marcas, APAGA o ficheiro e volta a
// ler, exigindo encontrar o que estava la. Sem essa passagem, um teste de persistencia mede apenas a
// variavel que tem na mao - foi o defeito que o recorte 001 apanhou na prova de ponta-a-ponta (o verde
// era do estado arrastado, nao do codigo).
//
// Cobre, de uma vez: a validacao do comando (campo a mais recusado), a tabela a decidir, o efeito
// persistente (sessao nova), o reset a nao apagar marcas, e o registo com motivo em todas as linhas.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mesa, type ContextoDaMesa } from "./mesa.ts";
import type { Desconhecido, Inibicao, Marcas, Sessao } from "./estado/marcas.ts";
import { reconstruir, type LinhaDoRegisto } from "./estado/registo.ts";

const dir = mkdtempSync(join(tmpdir(), "mesacore-mesa-"));
const CAMINHO_MARCAS = join(dir, ".marcas.json");
const CAMINHO_REGISTO = join(dir, ".registo.jsonl");

const T0 = 1_790_628_000_000;
const t = (n: number) => T0 + n * 1000;

let falhas = 0;
let verificacoes = 0;

function exigir(condicao: boolean, texto: string): void {
  verificacoes += 1;
  if (condicao) {
    console.log(`ok    ${texto}`);
  } else {
    falhas += 1;
    console.log(`FALHA ${texto}`);
  }
}

function lerMarcasDoDisco(): Marcas {
  return JSON.parse(readFileSync(CAMINHO_MARCAS, "utf8")) as Marcas;
}

const mesa = new Mesa({ caminhoDasMarcas: CAMINHO_MARCAS, caminhoDoRegisto: CAMINHO_REGISTO });
const ctx = (extra: Partial<ContextoDaMesa> = {}): ContextoDaMesa => ({
  instante_ms: t(0),
  posicao_viva: false,
  portas_do_arranque: { passam: true },
  // O PONTO DE PARTIDA da sessao nova (T042): as duas leituras sao da PORTA, e as guardas de recusa sao
  // fail-closed - um contexto que nao as declare RECUSA. Esta bancada declara-as lidas, como o portao faz:
  // um `start`/`pause` nao as le, e so o `nova_sessao` chega a linha que as julga.
  equity_de_partida_nao_lido: false,
  unidade_de_comparacao_nao_declarada: false,
  ...extra,
});

console.log("--- comandos: validacao ---");

const comCampoAMais = mesa.receber(
  { verbo: "start", autor: "dono", pedido_id: "p1", lado: "buy" },
  ctx({ instante_ms: t(1) }),
);
exigir(
  comCampoAMais.resultado === "recusado" && comCampoAMais.motivo === "comando_com_campo_a_mais",
  "comando com 'lado' e recusado (a porta dos verbos nao aceita ordens)",
);
exigir(mesa.estado === "parada", "a recusa do comando nao muda o estado");

const verboInventado = mesa.receber(
  { verbo: "arrancar", autor: "dono", pedido_id: "p2" },
  ctx({ instante_ms: t(2) }),
);
exigir(verboInventado.motivo === "verbo_desconhecido", "verbo fora do conjunto fechado e recusado");

console.log("\n--- o caminho normal ---");

const arranca = mesa.receber({ verbo: "start", autor: "dono", pedido_id: "p3" }, ctx({ instante_ms: t(3) }));
exigir(
  arranca.resultado === "aceite" && arranca.estado_novo === "em_operacao",
  "start em parada leva a em_operacao",
);

const arrancaOutraVez = mesa.receber(
  { verbo: "start", autor: "dono", pedido_id: "p4" },
  ctx({ instante_ms: t(4) }),
);
exigir(
  arrancaOutraVez.resultado === "recusado" && arrancaOutraVez.motivo === "mesa_ja_em_operacao",
  "start repetido e recusado com motivo",
);

const pausa = mesa.receber({ verbo: "pause", autor: "dono", pedido_id: "p5" }, ctx({ instante_ms: t(5) }));
exigir(pausa.resultado === "aceite" && pausa.estado_novo === "pausada", "pause leva a pausada");

const sessaoNaPausa = mesa.receber(
  { verbo: "nova_sessao", autor: "dono", pedido_id: "p6", motivo: "trocar de ficha" },
  ctx({ instante_ms: t(6) }),
);
exigir(
  sessaoNaPausa.motivo === "mesa_precisa_parar_para_sessao_nova",
  "nova_sessao com a mesa pausada e recusada (a mesa tem de parar primeiro)",
);

const para = mesa.receber({ verbo: "stop", autor: "dono", pedido_id: "p7" }, ctx({ instante_ms: t(7) }));
exigir(para.resultado === "aceite" && para.estado_novo === "parada", "stop sem posicao vai a parada");

console.log("\n--- nova_sessao grava a configuracao em vigor ---");

const sessaoNova = mesa.receber(
  { verbo: "nova_sessao", autor: "dono", pedido_id: "p8", motivo: "primeira sessao do dia" },
  ctx({
    instante_ms: t(8),
    sessao_nova: {
      equity_de_partida: "1000.00",
      configuracao_em_vigor: { ficha: "1", versao_do_setup: "1.0.0", versao_do_mandato: "1.0.0" },
    },
  }),
);
exigir(sessaoNova.resultado === "aceite", "nova_sessao em parada e aceita");

// A prova de persistencia: apagar o ficheiro e voltar a ler.
const sessaoGravada = lerMarcasDoDisco().sessao as Sessao;
const copia = JSON.parse(JSON.stringify(lerMarcasDoDisco())) as Marcas;
rmSync(CAMINHO_MARCAS);
exigir(!existsSync(CAMINHO_MARCAS), "o ficheiro de marcas foi apagado de proposito (a prova nao confia na memoria)");
const depoisDeApagar = new Mesa({ caminhoDasMarcas: CAMINHO_MARCAS, caminhoDoRegisto: CAMINHO_REGISTO }).marcas();
exigir(depoisDeApagar.sessao === null, "sem ficheiro, nao ha marca nenhuma (o teste lia mesmo o disco)");
writeFileSync(CAMINHO_MARCAS, JSON.stringify(copia, null, 2));
const relido = new Mesa({ caminhoDasMarcas: CAMINHO_MARCAS, caminhoDoRegisto: CAMINHO_REGISTO }).marcas();
exigir(
  relido.sessao?.autor === "dono" &&
    relido.sessao?.motivo === "primeira sessao do dia" &&
    relido.sessao?.equity_de_partida === "1000.00" &&
    relido.sessao?.configuracao_em_vigor.ficha === "1",
  "as marcas voltam do disco com autor, motivo, equity e configuracao em vigor",
);
exigir(
  sessaoGravada.instante_ms === t(8),
  "o instante da sessao e o do venue que quem chamou trouxe (nao um relogio interno)",
);

console.log("\n--- inibicao: start recusa, reset nao apaga ---");

const comInibicao: Marcas = {
  ...lerMarcasDoDisco(),
  inibicao_cb: { motivo: "perda de 5% na sessao", instante_ms: t(9), perda_medida: "50.00" } as Inibicao,
};
writeFileSync(CAMINHO_MARCAS, JSON.stringify(comInibicao, null, 2));

const arrancaInibida = mesa.receber(
  { verbo: "start", autor: "dono", pedido_id: "p9" },
  ctx({ instante_ms: t(10) }),
);
exigir(
  arrancaInibida.resultado === "recusado" && arrancaInibida.motivo === "sessao_inibida",
  "start com a inibicao marcada recusa (e so nova_sessao sai daqui)",
);

// O invariante: mesmo com as portas a passar, a inibicao le-se ANTES.
const arrancaInibidaPortas = mesa.receber(
  { verbo: "start", autor: "dono", pedido_id: "p10" },
  ctx({ instante_ms: t(11), portas_do_arranque: { passam: false, porta: "versao", motivo: "divergente" } }),
);
exigir(
  arrancaInibidaPortas.motivo === "sessao_inibida",
  "com inibicao E porta falhada, o motivo e a inibicao (o mais especifico primeiro)",
);

const comDesconhecido: Marcas = {
  ...lerMarcasDoDisco(),
  desconhecido: [
    {
      instrumento: "EURUSD",
      motivo: "sem confirmacao dentro do prazo",
      instante_ms: t(12),
      referencia_do_cliente: "mesa-1-0007",
    } as Desconhecido,
  ],
};
writeFileSync(CAMINHO_MARCAS, JSON.stringify(comDesconhecido, null, 2));

const reinicio = mesa.receber({ verbo: "reset", autor: "dono", pedido_id: "p11" }, ctx({ instante_ms: t(13) }));
exigir(reinicio.resultado === "aceite", "reset e aceite");
exigir(
  (reinicio.nao_tocado ?? []).sort().join(",") === "desconhecido,inibicao_cb,sessao",
  "reset declara o que NAO tocou (sessao, inibicao_cb, desconhecido)",
);
const depoisDoReset = lerMarcasDoDisco();
exigir(
  depoisDoReset.inibicao_cb !== null && depoisDoReset.desconhecido.length === 1 && depoisDoReset.sessao !== null,
  "depois do reset, as tres marcas continuam no disco",
);

console.log("\n--- o registo ---");

const linhas = readFileSync(CAMINHO_REGISTO, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as LinhaDoRegisto);

exigir(linhas.length > 0, `o registo tem ${linhas.length} linhas`);
const recusas = linhas.filter((l) => l.tipo === "recusa");
exigir(recusas.length > 0, `ha ${recusas.length} recusas registradas`);
exigir(
  recusas.every((l) => typeof l.motivo === "string" && l.motivo.length > 0),
  "100% das recusas no registo trazem motivo (SC-011)",
);
exigir(
  linhas.every((l) => typeof l.instante_ms === "number"),
  "100% das linhas trazem instante",
);
exigir(
  reconstruir(linhas) === "parada",
  `o estado final e reconstruivel a partir do registo sem ler codigo (deu '${reconstruir(linhas)}')`,
);
exigir(
  linhas.some((l) => l.tipo === "transicao" && l.verbo === "nova_sessao" && l.autor === "dono"),
  "a transicao de nova_sessao ficou com o autor",
);

console.log(`\nresumo: ${verificacoes} verificacoes · ${falhas} falhas`);
rmSync(dir, { recursive: true, force: true });
process.exit(falhas === 0 ? 0 : 1);
