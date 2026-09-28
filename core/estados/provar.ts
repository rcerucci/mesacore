// O runner das baterias em dado.
//
// Mesma gramatica do recorte 001: uma linha por caso, `ok` ou `FALHA`, resumo no fim, saida 1 se
// houver divergencia. Um relatorio que nao existe e uma historia que nao esta feita - e um runner
// que so diz "passou" nao deixa rastro de QUANTOS casos passaram.
//
// A comparacao cobre o que interessa medir: resultado, estado novo, motivo, motivo da porta (quando
// a recusa vem de uma porta do arranque) e a lista do que o reset NAO tocou. Comparar so o
// `resultado` deixaria passar uma recusa pelo motivo errado - que e a diferenca entre uma mesa que
// recusa por saber e uma que recusa por acaso.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aplicar, type Contexto, type Estado, type Resposta } from "./maquina.ts";
import { RAIZ_DO_REPO } from "../livro-de-motivos.ts";

interface Caso {
  nome: string;
  de: Estado;
  verbo: string;
  contexto: Contexto;
  marcas_presentes?: string[];
  resultado_esperado: string;
  estado_esperado: Estado;
  motivo_esperado: string | null;
  porta_da_recusa_esperada?: { porta: string; motivo: string };
  nao_tocado_esperado?: string[];
  historico?: string;
}

function comparar(caso: Caso, r: Resposta): string[] {
  const diferencas: string[] = [];
  if (r.resultado !== caso.resultado_esperado) {
    diferencas.push(`resultado: esperado '${caso.resultado_esperado}', obtido '${r.resultado}'`);
  }
  if (r.estado_novo !== caso.estado_esperado) {
    diferencas.push(`estado: esperado '${caso.estado_esperado}', obtido '${r.estado_novo}'`);
  }
  if ((r.motivo ?? null) !== caso.motivo_esperado) {
    diferencas.push(`motivo: esperado '${caso.motivo_esperado}', obtido '${r.motivo}'`);
  }
  if (caso.porta_da_recusa_esperada) {
    const esperado = caso.porta_da_recusa_esperada;
    if (r.motivo_da_porta?.porta !== esperado.porta) {
      diferencas.push(`porta: esperada '${esperado.porta}', obtida '${r.motivo_da_porta?.porta}'`);
    }
    if (r.motivo_da_porta?.motivo !== esperado.motivo) {
      diferencas.push(
        `motivo da porta: esperado '${esperado.motivo}', obtido '${r.motivo_da_porta?.motivo}'`,
      );
    }
  }
  if (caso.nao_tocado_esperado) {
    const obtido = (r.nao_tocado ?? []).join(",");
    if (obtido !== caso.nao_tocado_esperado.join(",")) {
      diferencas.push(
        `nao_tocado: esperado [${caso.nao_tocado_esperado.join(", ")}], obtido [${obtido}]`,
      );
    }
  }
  return diferencas;
}

const args = process.argv.slice(2);
const caminho = args.includes("--casos")
  ? (args[args.indexOf("--casos") + 1] as string)
  : join(RAIZ_DO_REPO, "core", "estados", "transicoes.casos.json");

const bateria = JSON.parse(readFileSync(caminho, "utf8")) as { casos: Caso[] };
const linhasDoRelatorio: string[] = [];
let divergentes = 0;
let recusasSemMotivo = 0;

console.log(`bateria: ${caminho}`);
console.log(`casos: ${bateria.casos.length}\n`);

for (const caso of bateria.casos) {
  const r = aplicar(caso.de, caso.verbo, caso.contexto, caso.marcas_presentes ?? []);
  const diferencas = comparar(caso, r);

  // Uma recusa sem motivo e defeito de desenho, nao diferenca de expectativa: conta a parte.
  if (r.resultado === "recusado" && (r.motivo === null || r.motivo === "")) {
    recusasSemMotivo += 1;
    diferencas.push("recusa SEM MOTIVO (FR-004)");
  }

  const registo = {
    caso: caso.nome,
    historia: caso.historico ?? null,
    de: caso.de,
    verbo: caso.verbo,
    contexto: caso.contexto,
    resultado: r.resultado,
    estado_novo: r.estado_novo,
    motivo: r.motivo,
    motivo_da_porta: r.motivo_da_porta,
    nao_tocado: r.nao_tocado,
    ok: diferencas.length === 0,
  };
  linhasDoRelatorio.push(JSON.stringify(registo));

  if (diferencas.length === 0) {
    console.log(`ok    ${caso.nome}`);
  } else {
    divergentes += 1;
    console.log(`FALHA ${caso.nome}`);
    for (const d of diferencas) console.log(`        ${d}`);
  }
}

const aceites = linhasDoRelatorio.filter((l) => JSON.parse(l).resultado === "aceite").length;
const recusados = linhasDoRelatorio.length - aceites;

console.log("");
console.log(
  `resumo: ${linhasDoRelatorio.length} casos · ${aceites} aceites · ${recusados} recusados · ` +
    `${divergentes} divergentes · ${recusasSemMotivo} recusas sem motivo`,
);

if (args.includes("--jsonl")) {
  const saida = args[args.indexOf("--jsonl") + 1] as string;
  writeFileSync(saida, linhasDoRelatorio.join("\n") + "\n");
  console.log(`relatorio: ${saida}`);
}

process.exit(divergentes === 0 && recusasSemMotivo === 0 ? 0 : 1);
