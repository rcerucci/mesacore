// Corre a bateria de casos contra o contrato — lado TypeScript.
//
//   bun run esqueleto/casos.ts                       # todos os casos
//   bun run esqueleto/casos.ts --relatorio r.jsonl   # grava o relatorio
//   bun run esqueleto/casos.ts --casos boleta,marca  # so algumas familias
//
// Sai com 1 se algum caso divergir do esperado OU se o instrumento de medida falhar.
// Um caso que nao consegue ser decidido NAO conta como passa: conta como erro.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RAIZ, validar, versaoVigente } from "./framing.ts";

interface Caso {
  nome: string;
  mensagem: string;
  entrada?: unknown;
  entrada_texto?: string;
  veredicto_esperado: "aceite" | "recusado";
  motivo_esperado: string | null;
  /** Opcional: confere o DETALHE da recusa, e nao so o motivo (T047 - as duas versoes na recusa por versao). */
  detalhe_esperado?: string;
}

interface Linha {
  caso: string;
  mensagem: string;
  veredicto: string;
  motivo: string | null;
  implementacao: "ts";
  esperado_ok: boolean;
}

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(nome);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] ?? null) : null;
}

const pasta = join(RAIZ, "casos");
const pedidos = argumento("--casos");
const filtro = pedidos ? new Set(pedidos.split(",").map((s) => s.trim())) : null;

const ficheiros = readdirSync(pasta)
  .filter((n) => n.endsWith(".casos.json"))
  .filter((n) => (filtro ? filtro.has(n.replace(".casos.json", "")) : true))
  .sort();

if (ficheiros.length === 0) {
  console.error("nenhum ficheiro de casos encontrado");
  process.exit(2);
}

const linhas: Linha[] = [];
let divergentes = 0;
let erros = 0;

for (const ficheiro of ficheiros) {
  const conteudo = JSON.parse(readFileSync(join(pasta, ficheiro), "utf8")) as { casos: Caso[] };
  for (const caso of conteudo.casos) {
    const texto = caso.entrada_texto ?? JSON.stringify(caso.entrada ?? {});
    const decisao = validar(texto);
    const esperadoOk =
      decisao.veredicto === caso.veredicto_esperado &&
        decisao.motivo === caso.motivo_esperado &&
        // O detalhe so se confere quando o caso o DECLARA (ver o gemeo em Python).
        (caso.detalhe_esperado === undefined || decisao.detalhe === caso.detalhe_esperado);
    if (!esperadoOk) {
      if (decisao.veredicto === "erro_de_execucao") erros += 1;
      else divergentes += 1;
    }
    const linha: Linha = {
      caso: caso.nome,
      mensagem: caso.mensagem,
      veredicto: decisao.veredicto,
      motivo: decisao.motivo,
      implementacao: "ts",
      esperado_ok: esperadoOk,
    };
    linhas.push(linha);
    console.log(JSON.stringify(linha));
  }
}

const relatorio = argumento("--relatorio");
if (relatorio) {
  mkdirSync(dirname(relatorio), { recursive: true });
  writeFileSync(relatorio, linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const aceites = linhas.filter((l) => l.veredicto === "aceite").length;
const recusados = linhas.filter((l) => l.veredicto === "recusado").length;
console.error(
  `ts · contrato ${versaoVigente()} · ${linhas.length} casos · ${aceites} aceites · ${recusados} recusados · ${divergentes} divergentes · ${erros} erros`,
);
process.exit(divergentes + erros === 0 ? 0 : 1);
