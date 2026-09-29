// Porta das Dependencias: todo import "nu" do conector tem de estar DECLARADO no manifesto da raiz.
//
// O defeito que isto tranca (medido em 29/09/2026): o `ajv` que `brokers/hyperliquid/casos/correr.ts`
// importava NUNCA esteve declarado — era servido pelo auto-install global do bun. Enquanto a raiz nao
// tinha manifesto, o fallback servia-o e a bancada passava POR ACIDENTE. No dia em que a raiz ganhou
// `package.json` + `node_modules` (a instalacao do SDK do venue), o fallback desligou e a bancada caiu
// para 25/26. Uma bancada que passa por acidente nao e uma bancada: e uma coincidencia com prazo.
//
// Uso:  bun tools/verificar-conector/porta-das-dependencias.ts [--manifesto f.json]
// A opcao --manifesto existe para a PROVA NEGATIVA: correr contra um manifesto ao qual falta uma
// dependencia tem de REPROVAR (se nao reprovar, esta porta nao mede nada).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dir, "..", "..");
const argv = process.argv.slice(2);
const i = argv.indexOf("--manifesto");
const caminhoDoManifesto = i >= 0 ? argv[i + 1] : join(RAIZ, "package.json");

function ficheirosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules") continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) saida.push(...ficheirosTs(p));
    else if (nome.endsWith(".ts")) saida.push(p);
  }
  return saida;
}

/** O nome do pacote a partir do especificador: "ajv/dist/2020" -> "ajv"; "@scope/x/y" -> "@scope/x". */
function pacoteDe(especificador: string): string {
  const partes = especificador.split("/");
  return especificador.startsWith("@") ? partes.slice(0, 2).join("/") : partes[0];
}

let manifesto: any;
try {
  manifesto = JSON.parse(readFileSync(caminhoDoManifesto, "utf8"));
} catch (e) {
  console.log(JSON.stringify({ porta: "dependencias", veredicto: "reprovado", porque: `manifesto ilegivel: ${caminhoDoManifesto}` }));
  process.exit(1);
}

const declaradas = new Set([
  ...Object.keys(manifesto.dependencies ?? {}),
  ...Object.keys(manifesto.devDependencies ?? {}),
]);

const faltas: { ficheiro: string; pacote: string }[] = [];
let ficheirosLidos = 0;
let importsVistos = 0;
for (const ficheiro of ficheirosTs(join(RAIZ, "brokers"))) {
  ficheirosLidos++;
  const texto = readFileSync(ficheiro, "utf8");
  const re = /(?:from\s+|import\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
  for (const m of texto.matchAll(re)) {
    const esp = m[1];
    if (esp.startsWith(".") || esp.startsWith("/") || esp.startsWith("node:")) continue;
    importsVistos++;
    const pacote = pacoteDe(esp);
    if (!declaradas.has(pacote)) faltas.push({ ficheiro: ficheiro.slice(RAIZ.length + 1), pacote });
  }
}

const unicas = [...new Map(faltas.map((f) => [`${f.ficheiro}|${f.pacote}`, f])).values()];
console.log(
  JSON.stringify({
    porta: "dependencias",
    manifesto: i >= 0 ? caminhoDoManifesto : caminhoDoManifesto.slice(RAIZ.length + 1),
    ficheiros_lidos: ficheirosLidos,
    imports_nus: importsVistos,
    declaradas: [...declaradas].sort(),
    nao_declaradas: unicas,
    veredicto: unicas.length === 0 ? "aprovado" : "reprovado",
  }),
);
process.exit(unicas.length === 0 ? 0 : 1);
