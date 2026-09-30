// Corre os casos do manifesto (em DADO) contra a sonda — e valida o manifesto contra o esquema do contrato.
// Um caso passa, ou e divergente: nao ha "quase".

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { construirManifesto, type Sonda } from "../manifesto.ts";
import { entradas, itens } from "./blocos.ts";

const RAIZ = join(import.meta.dir, "..", "..", "..");
const ficheiro = process.argv[2] ?? join(import.meta.dir, "manifesto.casos.json");
const casos = JSON.parse(readFileSync(ficheiro, "utf8"));

function lerJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"));
}

// O esquema do contrato e quem decide se o manifesto tem a forma certa — nao e o nosso olho.
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(lerJson(join(RAIZ, "contracts", "_defs", "forma.schema.json")));
const validaManifesto = ajv.compile(lerJson(join(RAIZ, "contracts", "manifesto.schema.json")));

function porCaminho(obj: any, caminho: string): unknown {
  return caminho.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

function fundir(base: any, mudanca: any): any {
  const saida = { ...base };
  for (const [k, v] of entradas(mudanca, "fundir/mudanca")) saida[k] = v;
  return saida;
}

let total = 0, ok = 0, divergentes = 0;
for (const c of casos.casos) {
  total++;
  const sonda: Sonda = fundir(fundir(casos.sonda_base, c.sonda), {}) as Sonda;
  const r = construirManifesto(sonda);
  const problemas: string[] = [];

  if (r.ok !== !!c.esperadoOk) {
    problemas.push(`ok=${r.ok}, esperado=${!!c.esperadoOk}${r.ok ? "" : " (" + r.motivo + ": " + r.porque + ")"}`);
  } else if (!r.ok) {
    if (c.motivo_esperado && r.motivo !== c.motivo_esperado) {
      problemas.push(`motivo=${r.motivo}, esperado=${c.motivo_esperado}`);
    }
    if (r.motivo && !lerJson(join(RAIZ, "contracts", "vocabulario.json")).motivos[r.motivo]) {
      problemas.push(`motivo ${r.motivo} nao existe no conjunto fechado do contrato`);
    }
  } else {
    const esquemaOk = validaManifesto(r.manifesto);
    if (!esquemaOk) {
      problemas.push("manifesto recusado pelo esquema: " + ajv.errorsText(validaManifesto.errors));
    }
    for (const [caminho, esperado] of entradas(c.conferir, "conferir")) {
      const veio = porCaminho(r.manifesto, caminho);
      if (veio !== esperado) problemas.push(`${caminho}=${JSON.stringify(veio)}, esperado=${JSON.stringify(esperado)}`);
    }
    if (c.segunda_sonda) {
      const segunda = construirManifesto(fundir(sonda, c.segunda_sonda));
      if (!segunda.ok) {
        problemas.push("a segunda sonda foi recusada: " + segunda.motivo);
      } else {
        for (const [caminho, esperado] of entradas(c.conferir_na_segunda, "conferir_na_segunda")) {
          const veio = porCaminho(segunda.manifesto, caminho);
          if (veio !== esperado) problemas.push(`2a sonda ${caminho}=${JSON.stringify(veio)}, esperado=${JSON.stringify(esperado)}`);
        }
      }
    }
  }

  const linha = {
    caso: c.caso,
    implementacao: "hyperliquid",
    veredicto: problemas.length === 0 ? "ok" : "divergente",
    esperado_ok: !!c.esperadoOk,
    ...(problemas.length ? { problemas } : {}),
  };
  console.log(JSON.stringify(linha));
  if (problemas.length === 0) ok++; else divergentes++;
}
console.error(`manifesto: ${total} casos · ${ok} ok · ${divergentes} divergentes · ${casos.casos.length} declarados`);
process.exit(divergentes === 0 ? 0 : 1);
