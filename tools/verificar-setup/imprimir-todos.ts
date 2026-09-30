#!/usr/bin/env bun
// Imprime o que o MOTOR calcula, barra a barra, para VÁRIAS combinações de `input` de uma vez — é o que a
// varredura (`varredura-pine.py`) usa para confrontar o motor com a transcrição do Pine sem arrancar um
// processo por combinação.
//   bun run tools/verificar-setup/imprimir-todos.ts <velas.jsonl> <combos.json> <saida.json>
import { readFileSync, writeFileSync } from "node:fs";
import { calcular, type Vela, type Constantes } from "../../setups/sigma/sinal.ts";

const [velas_, combos_, saida_] = process.argv.slice(2);
const velas = readFileSync(velas_!, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Vela);
const combos = JSON.parse(readFileSync(combos_!, "utf8")) as Constantes[];
const tudo = combos.map((k) =>
  calcular(velas, k).map((p) => ({ t: p.t, ma: p.ma, atr: p.atr, mid: p.mid, banda: p.banda, sig: p.sig, extremo: p.extremo, virada: p.virada })),
);
writeFileSync(saida_!, JSON.stringify(tudo));
console.log(`motor: ${velas.length} barras × ${combos.length} combinacoes`);
