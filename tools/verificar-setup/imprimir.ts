#!/usr/bin/env bun
// Imprime o que o MOTOR calcula, barra a barra, para o confronto com o espelho em Python.
//   bun run tools/verificar-setup/imprimir.ts <velas.jsonl> <constantes.json> <saida.json> [semente]
import { readFileSync, writeFileSync } from "node:fs";
import { calcular, type Vela, type Constantes } from "../../setups/sigma/sinal.ts";
const [velas_, consts_, saida_, semente_] = process.argv.slice(2);
const velas = readFileSync(velas_!, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Vela);
const k = JSON.parse(readFileSync(consts_!, "utf8")) as Constantes;
const pontos = calcular(velas, k, (semente_ as "recursiva" | "sma") ?? "recursiva").map((p) => ({ t: p.t, ma: p.ma, atr: p.atr, mid: p.mid, sig: p.sig, virada: p.virada }));
writeFileSync(saida_!, JSON.stringify(pontos));
console.log(`motor: ${pontos.length} barras`);
