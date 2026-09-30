// A bateria do LEITOR da retencao do ledger (RN-L6) - `core/estado/retencao.ts`.
//
// Mesma gramatica das outras baterias do recorte: uma linha por caso, `ok` ou `FALHA`, resumo no fim, saida
// 1 se houver divergencia. Um leitor que so diz "leu" nao deixa rasto de QUANTOS casos leu.
//
// O que se compara: (1) a declaracao foi ACEITE ou RECUSADA - e as duas coisas contam, porque uma
// declaracao ilegivel que passasse era pior do que a chave faltar; (2) com declaracao aceite, de que lado
// da fronteira caiu cada linha. Comparar so as contagens de um lado deixaria passar um leitor que
// classificasse tudo ao contrario (e o par de controle da fronteira existe exactamente para isso).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classificar, lerRetencao, fronteiraDaRetencao, MS_POR_DIA } from "./retencao.ts";
import type { LinhaDoRegisto } from "./registo.ts";

interface Caso {
  nome: string;
  retencao: unknown;
  linhas: { instante_ms: number }[];
  esperado: { integrais: number; passadas: number; recusa: boolean };
  historico?: string;
}

const RAIZ = join(import.meta.dir, "..", "..");
const caminho = process.argv.includes("--casos")
  ? (process.argv[process.argv.indexOf("--casos") + 1] as string)
  : join(RAIZ, "core", "estado", "retencao.casos.json");

const bateria = JSON.parse(readFileSync(caminho, "utf8")) as { agora_ms: number; casos: Caso[] };
console.log(`bateria: ${caminho}`);
console.log(`casos: ${bateria.casos.length} · agora de referencia: ${bateria.agora_ms} (1 dia = ${MS_POR_DIA} ms)\n`);

let divergentes = 0;
let recusas = 0;
let aceites = 0;

for (const caso of bateria.casos) {
  const diferencas: string[] = [];
  const leitura = lerRetencao(caso.retencao);
  const recusou = leitura.retencao === null;
  if (recusou) recusas += 1;
  else aceites += 1;

  if (recusou !== caso.esperado.recusa) {
    diferencas.push(
      `declaracao: esperado ${caso.esperado.recusa ? "RECUSADA" : "aceite"}, obtido ${recusou ? `RECUSADA (${leitura.porque})` : "aceite"}`,
    );
  }

  const linhas: LinhaDoRegisto[] = caso.linhas.map((l) => ({ instante_ms: l.instante_ms, tipo: "ciclo", motivo: null }));
  const c = classificar(linhas, leitura.retencao, bateria.agora_ms);

  if (c.integrais.length !== caso.esperado.integrais) {
    diferencas.push(`integrais: esperado ${caso.esperado.integrais}, obtido ${c.integrais.length}`);
  }
  if (c.passadas.length !== caso.esperado.passadas) {
    diferencas.push(`passadas: esperado ${caso.esperado.passadas}, obtido ${c.passadas.length}`);
  }
  // Sem declaracao NAO pode haver fronteira - senao havia uma janela inventada a governar a classificacao.
  if (leitura.retencao === null && c.fronteira !== null) {
    diferencas.push("fronteira inventada a partir de uma declaracao que nao se leu");
  }
  if (c.porque.trim() === "") diferencas.push("a classificacao nao disse o que fez (FR-004: nada se cala)");

  if (diferencas.length === 0) {
    console.log(`ok    ${caso.nome}`);
  } else {
    divergentes += 1;
    console.log(`FALHA ${caso.nome}`);
    for (const d of diferencas) console.log(`        ${d}`);
  }
}

// A fronteira calculada, mostrada uma vez: e' o numero que a compactacao de fora usaria.
const exemplo = lerRetencao({ dias_integral: 7, depois: "resumo_diario" });
if (exemplo.retencao) {
  const f = fronteiraDaRetencao(exemplo.retencao, bateria.agora_ms);
  console.log(`\nfronteira (7 dias, a titulo de exemplo): ${f.fronteira_ms} - para \`${f.depois}\``);
}

console.log("");
console.log(
  `resumo: ${bateria.casos.length} casos · ${aceites} declaracoes aceites · ${recusas} recusadas · ${divergentes} divergentes`,
);
process.exit(divergentes === 0 ? 0 : 1);
