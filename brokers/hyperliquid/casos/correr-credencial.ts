// Corre os casos do carregador da credencial. As fixtures criam-se num directorio temporario proprio;
// nenhuma delas tem um segredo a serio — o caso do "valor no repositorio" usa uma palavra que existe
// mesmo num ficheiro versionado, para o portao ter o que apanhar.

import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { carregarCredencial } from "../credencial.ts";

const casos = JSON.parse(readFileSync(join(import.meta.dir, "credencial.casos.json"), "utf8"));
const RAIZ = join(import.meta.dir, "..", "..", "..");
const casa = mkdtempSync(join(tmpdir(), "cred-"));
const VAR = "MESACORE_CREDENCIAL_DE_TESTE";

const NOS_REPO = "hyperliquid";        // existe em brokers/hyperliquid/README.md (versionado)
const SEGREDO_FALSO = "0x" + "a1b2c3d4".repeat(4); // nao existe em ficheiro versionado nenhum

function escrever(nome: string, conteudo: string, modo: number): string {
  const p = join(casa, nome);
  writeFileSync(p, conteudo + "\n");
  chmodSync(p, modo);
  return p;
}

const fixtures: Record<string, () => { referencia: string; valorEm: string }> = {
  env_ok: () => {
    process.env[VAR] = SEGREDO_FALSO;
    return { referencia: "hl_teste", valorEm: `env:${VAR}` };
  },
  env_ausente: () => {
    delete process.env[VAR + "_AUSENTE"];
    return { referencia: "hl_teste", valorEm: `env:${VAR}_AUSENTE` };
  },
  ficheiro_0600: () => ({ referencia: "hl_teste", valorEm: `ficheiro:${escrever("ok.key", SEGREDO_FALSO, 0o600)}` }),
  ficheiro_0644: () => ({ referencia: "hl_teste", valorEm: `ficheiro:${escrever("solto.key", SEGREDO_FALSO, 0o644)}` }),
  ficheiro_inexistente: () => ({ referencia: "hl_teste", valorEm: `ficheiro:${join(casa, "nao-existe.key")}` }),
  vazio: () => ({ referencia: "hl_teste", valorEm: `ficheiro:${escrever("vazio.key", "   ", 0o600)}` }),
  formato_invalido: () => ({ referencia: "hl_teste", valorEm: "no-keyring:hlteste" }),
  sem_referencia: () => ({ referencia: "", valorEm: `ficheiro:${join(casa, "ok.key")}` }),
  valor_no_repo: () => ({ referencia: "hl_teste", valorEm: `ficheiro:${escrever("repetido.key", NOS_REPO, 0o600)}` }),
};

let total = 0, ok = 0, divergentes = 0;
for (const c of casos.casos) {
  total++;
  const problemas: string[] = [];
  const f = fixtures[c.fixture];
  if (!f) {
    problemas.push(`fixture desconhecida: ${c.fixture}`);
  } else {
    const { referencia, valorEm } = f();
    const r = carregarCredencial(referencia, valorEm, RAIZ);
    if (r.ok !== !!c.esperadoOk) {
      problemas.push(`ok=${r.ok}, esperado=${!!c.esperadoOk}${r.ok ? "" : " (" + r.motivo + ")"}`);
    } else if (!r.ok && c.motivo_esperado && r.motivo !== c.motivo_esperado) {
      problemas.push(`motivo=${r.motivo}, esperado=${c.motivo_esperado}`);
    } else if (r.ok && r.valor !== SEGREDO_FALSO && c.esperadoOk && c.fixture !== "valor_no_repo") {
      problemas.push("o valor devolvido nao e o que foi posto la");
    }
  }
  const linha = { caso: c.caso, implementacao: "hyperliquid", veredicto: problemas.length ? "divergente" : "ok", esperado_ok: !!c.esperadoOk, ...(problemas.length ? { problemas } : {}) };
  console.log(JSON.stringify(linha));
  if (problemas.length) divergentes++; else ok++;
}
rmSync(casa, { recursive: true, force: true });
console.error(`credencial: ${total} casos · ${ok} ok · ${divergentes} divergentes`);
process.exit(divergentes === 0 ? 0 : 1);
