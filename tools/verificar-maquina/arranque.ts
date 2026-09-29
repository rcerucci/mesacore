// O runner da US4: o arranque pelas seis portas.
//
// Vive em `/tools` e nao em `/core` por uma razao de fronteira: a porta do inventario corre um processo
// (o conferidor em python), e o core nao chama processos (RN-E2 - o porteiro do estado reprova quem o
// faca). Quem liga o core ao processo e o arranjo de prova, que e este ficheiro.
//
// Conta o SC-006: falhando uma porta, ZERO arranques acontecem e 100% deles ficam com o motivo daquela
// porta. Conta tambem a FR-032 pelo lado caro: o objecto de configuracao que entra tem de sair igual -
// se a mesa ajustasse um valor para conseguir entrar, o verde de um caso seria o vermelho do outro.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arrancar, type ResultadoDoArranque } from "../../core/ciclo/arranque.ts";
import type { ConfiguracaoDaConta } from "../../core/config/configuracao.ts";
import type { Marcas } from "../../core/estado/marcas.ts";
import { inventarioASerio, RAIZ_DO_REPO } from "./inventario-do-arranque.ts";
import { fundir } from "./fundir.ts";

const args = process.argv.slice(2);
const caminho = join(RAIZ_DO_REPO, "core", "ciclo", "arranque.casos.json");
const bateria = JSON.parse(readFileSync(caminho, "utf8")) as any;

let verificacoes = 0;
let divergentes = 0;
const linhas: string[] = [];

function exigir(condicao: boolean, texto: string, contexto: string[] = []): void {
  verificacoes += 1;
  if (condicao) {
    console.log(`ok    ${texto}`);
  } else {
    divergentes += 1;
    console.log(`FALHA ${texto}`);
    for (const c of contexto) console.log(`        ${c}`);
  }
}

/**
 * Funde a mudanca do caso sobre o padrao, devolvendo SEMPRE um objecto novo.
 *
 * A copia nao e higiene: sem ela, o caso que apaga um campo do manifesto apagava-o para os casos
 * seguintes (os dois apontavam para o mesmo objecto), e a bateria passava a medir outra coisa a partir
 * dali. Foi o proprio FR-032 - "nada e ajustado" - a apanhar o defeito na bancada de prova.
 */
const manifestoDoFixture = JSON.parse(
  readFileSync(join(RAIZ_DO_REPO, bateria.manifesto_fixture), "utf8"),
).carga as any;

console.log("=== bateria do arranque: as seis portas, uma de cada vez ===\n");

let recusas = 0;
let arranquesComPortaFalhada = 0;
let comMotivoDaPorta = 0;

for (const caso of bateria.casos) {
  const config = fundir(bateria.padrao.config, caso.config_mudanca) as ConfiguracaoDaConta;
  const marcas = fundir(bateria.padrao.marcas, caso.marcas_mudanca) as Marcas;
  const manifesto = fundir(manifestoDoFixture, caso.manifesto_mudanca);
  if (caso.manifesto_instrumentos !== undefined) manifesto.instrumentos = caso.manifesto_instrumentos;
  for (const campo of caso.manifesto_remover ?? []) delete manifesto[campo];

  // A porta do inventario: a serio, ou o stub que o caso declara. O stub existe para se poder falhar a
  // porta de proposito - nao para substituir a ligacao real.
  const portaDoInventario =
    caso.inventario_mudanca !== undefined
      ? () => ({
          ok: caso.inventario_mudanca.ok === true,
          problemas: caso.inventario_mudanca.problemas ?? [],
        })
      : inventarioASerio;

  // FR-032 pelo lado caro: tira-se uma fotografia de TUDO o que entra, e compara-se com o que sai.
  const configAntes = JSON.stringify(config);
  const marcasAntes = JSON.stringify(marcas);
  const manifestoAntes = JSON.stringify(manifesto);

  const r: ResultadoDoArranque = arrancar({
    manifesto,
    config,
    marcas,
    registo_retomavel: caso.registo_retomavel ?? bateria.padrao.registo_retomavel,
    portaDoInventario,
  });

  const contexto = [
    r.arrancou === caso.arrancou_esperado ? null : `arrancou: esperado ${caso.arrancou_esperado}, obtido ${r.arrancou}`,
    r.estado === caso.estado_esperado ? null : `estado: esperado '${caso.estado_esperado}', obtido '${r.estado}'`,
    (r.porta ?? null) === (caso.porta_esperada ?? null) ? null : `porta: esperada '${caso.porta_esperada}', obtida '${r.porta}'`,
    (r.motivo ?? null) === (caso.motivo_esperado ?? null) ? null : `motivo: esperado '${caso.motivo_esperado}', obtido '${r.motivo}'`,
    caso.motivo_do_contrato_esperado === undefined || r.motivo_do_contrato === caso.motivo_do_contrato_esperado
      ? null
      : `motivo_do_contrato: esperado '${caso.motivo_do_contrato_esperado}', obtido '${r.motivo_do_contrato}'`,
    caso.portas_conferidas_esperadas === undefined ||
    r.portas_conferidas.join(",") === caso.portas_conferidas_esperadas.join(",")
      ? null
      : `portas_conferidas: esperadas [${caso.portas_conferidas_esperadas.join(", ")}], obtidas [${r.portas_conferidas.join(", ")}]`,
  ].filter((x): x is string => x !== null);

  // `lido` tem de devolver as fichas exactamente como entraram.
  if (JSON.stringify(r.lido.fichas) !== JSON.stringify(config.fichas ?? {})) {
    contexto.push("lido.fichas difere do que entrou: a mesa leu outra coisa alem do que recebeu");
  }

  exigir(contexto.length === 0, `arranque/${caso.nome}`, contexto);

  // FR-032, medido: nada foi ajustado - nem no objecto de configuracao, nem nas marcas.
  exigir(
    JSON.stringify(config) === configAntes &&
      JSON.stringify(marcas) === marcasAntes &&
      JSON.stringify(manifesto) === manifestoAntes,
    `FR-032/${caso.nome}: a configuracao, as marcas e o manifesto sairam iguais ao que entraram`,
  );

  if (caso.arrancou_esperado === false) {
    recusas += 1;
    if (r.arrancou) arranquesComPortaFalhada += 1;
    if (r.motivo !== null && r.porta === caso.porta_esperada) comMotivoDaPorta += 1;
  }

  linhas.push(
    JSON.stringify({
      caso: caso.nome,
      arrancou: r.arrancou,
      estado: r.estado,
      porta: r.porta,
      motivo: r.motivo,
      motivo_do_contrato: r.motivo_do_contrato,
      portas_conferidas: r.portas_conferidas,
      porque: r.porque,
      ok: contexto.length === 0,
    }),
  );
}

console.log("\n=== criterio de sucesso ===\n");
exigir(
  arranquesComPortaFalhada === 0 && comMotivoDaPorta === recusas && recusas > 0,
  `SC-006: ${arranquesComPortaFalhada} arranques com porta falhada (tem de ser 0) e ${comMotivoDaPorta} de ${recusas} recusas com o motivo da porta`,
);

console.log("");
console.log(
  `resumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ${bateria.casos.length} casos · ${recusas} portas falhadas de proposito`,
);

if (args.includes("--jsonl")) {
  const saida = args[args.indexOf("--jsonl") + 1] as string;
  writeFileSync(saida, linhas.join("\n") + "\n");
  console.log(`relatorio: ${saida}`);
}

process.exit(divergentes === 0 ? 0 : 1);
