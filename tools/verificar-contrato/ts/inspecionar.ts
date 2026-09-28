// Inspeccao automatica dos schemas — SC-001: ZERO campos da boleta em unidade de corretora.
//
//   bun run ../tools/verificar-contrato/ts/inspecionar.ts
//
// Percorre TODOS os schemas e procura, em qualquer objecto, um campo cujo nome esteja na lista
// de campos proibidos que o vocabulario declara. Nao e revisao de olho: e a lista contra o
// ficheiro. Sai com 1 se encontrar um.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CONTRATOS = join(import.meta.dir, "..", "..", "..", "contracts");
const vocabulario = JSON.parse(readFileSync(join(CONTRATOS, "vocabulario.json"), "utf8"));
const proibidos: string[] = vocabulario.campos_em_unidade_de_corretora;
// O ambito vem do vocabulario: a proibicao e das mensagens que a MESA envia. A resolucao e o
// manifesto declaram unidades DE PROPOSITO — seria um erro procura-las la.
const alvos: string[] = vocabulario.unidades_neutras_em;

function schemas(): string[] {
  return alvos.map((nome) => join(CONTRATOS, nome));
}

let encontrados = 0;
let inspeccionados = 0;

function percorrer(no: unknown, ficheiro: string, caminho: string): void {
  if (Array.isArray(no)) {
    no.forEach((item, i) => percorrer(item, ficheiro, `${caminho}/${i}`));
    return;
  }
  if (no === null || typeof no !== "object") return;

  for (const [chave, valor] of Object.entries(no as Record<string, unknown>)) {
    if (chave === "properties" && valor !== null && typeof valor === "object") {
      for (const campo of Object.keys(valor as Record<string, unknown>)) {
        inspeccionados += 1;
        if (proibidos.includes(campo)) {
          encontrados += 1;
          console.log(`PROIBIDO ${campo} em ${ficheiro}${caminho}/properties`);
        }
      }
    }
    percorrer(valor, ficheiro, `${caminho}/${chave}`);
  }
}

for (const ficheiro of schemas()) {
  percorrer(JSON.parse(readFileSync(ficheiro, "utf8")), ficheiro.replace(`${CONTRATOS}/`, ""), "");
}

console.log(`inspeccao: ${inspeccionados} campos declarados, ${encontrados} em unidade de corretora (proibidos: ${proibidos.join(", ")})`);
process.exit(encontrados === 0 ? 0 : 1);
