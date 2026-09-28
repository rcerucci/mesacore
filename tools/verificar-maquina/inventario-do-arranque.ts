// A porta do inventario, na versao a serio: liga-se ao conferidor que JA EXISTE.
//
// Existe para nao haver uma segunda implementacao da mesma regra. O conferidor
// (`tools/verificar-contrato/py/inventario.py`) ja prova, com prova negativa guardada, que cada grandeza
// tem origem declarada e cada declaracao tem grandeza. Reimplementa-lo aqui seria a segunda verdade sobre
// as chaves - e a segunda envelhece sempre primeiro.
//
// Detalhe que importa: se o conferidor nao der veredicto (nao correu, rebentou, saida estranha), o
// resultado NAO e "ok". Uma porta que passa quando nao conseguiu medir e pior do que nao ter porta.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const RAIZ_DO_REPO = join(import.meta.dir, "..", "..");

export function inventarioASerio(): { ok: boolean; problemas: string[] } {
  const ferramenta = join(RAIZ_DO_REPO, "tools", "verificar-contrato", "py", "inventario.py");
  const r = spawnSync("python3", [ferramenta], { encoding: "utf8", timeout: 120_000 });

  const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const problemas = saida
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("FALHA"));

  const veredicto = saida.match(/inventario:\s*(\d+)\s*falhas/);
  if (veredicto === null) {
    return {
      ok: false,
      problemas: [
        "o conferidor do inventario nao deu veredicto (exit " +
          `${r.status ?? "?"}) - uma porta que nao conseguiu medir nao passa`,
        ...problemas,
      ],
    };
  }

  return { ok: Number(veredicto[1]) === 0 && problemas.length === 0, problemas };
}
