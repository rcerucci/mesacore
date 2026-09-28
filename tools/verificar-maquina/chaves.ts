// SC-012: cada chave de configuracao que o core LE tem de estar declarada no inventario.
//
// O inventario do recorte 001 confere as grandezas do CONTRATO (o que atravessa a fronteira). Este confere
// o outro lado: os campos que o core vai buscar a `/config` - porque uma chave que o codigo le e que
// ninguem declarou e um valor ajustavel que ninguem sabe onde ajustar (RN-A1).
//
// Nao e um grep de nomes iguais: e a conferencia de que o NOME que o codigo usa e o NOME que o documento
// declara. `contencao` no codigo e `contencao` no documento sao duas coisas diferentes, e e
// exactamente o tipo de divergencia que so aparece quando alguem as poe lado a lado.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RAIZ_DO_REPO } from "./inventario-do-arranque.ts";

const args = process.argv.slice(2);
let verificacoes = 0;
let divergentes = 0;

function exigir(condicao: boolean, texto: string, contexto: string[] = []): void {
  verificacoes += 1;
  if (condicao) console.log(`ok    ${texto}`);
  else {
    divergentes += 1;
    console.log(`FALHA ${texto}`);
    for (const c of contexto) console.log(`        ${c}`);
  }
}

function ficheirosTs(raiz: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(raiz)) {
    const caminho = join(raiz, nome);
    if (statSync(caminho).isDirectory()) saida.push(...ficheirosTs(caminho));
    else if (nome.endsWith(".ts")) saida.push(caminho);
  }
  return saida;
}

// Os campos lidos como configuracao da conta. `config.<campo>` e a forma como o core os vai buscar.
const lidos = new Map<string, string[]>();
for (const caminho of ficheirosTs(join(RAIZ_DO_REPO, "core"))) {
  // O node_modules nao e codigo do projeto: `config.json` de tipos do Bun nao e uma chave do dono.
  if (caminho.includes("/node_modules/")) continue;
  const fonte = readFileSync(caminho, "utf8");
  for (const m of fonte.matchAll(/\bconfig\.([a-z][a-z0-9_]{2,})\b/g)) {
    const campo = m[1];
    if (!lidos.has(campo)) lidos.set(campo, []);
    lidos.get(campo)!.push(caminho.replace(`${RAIZ_DO_REPO}/`, ""));
  }
}

const documento = readFileSync(join(RAIZ_DO_REPO, "docs", "inventario-de-chaves.md"), "utf8");

// O nome declarado: o campo, com a familia `conta.` ou `fichas/<i>.` a frente. O documento declara as
// chaves como `` `conta.campo` `` (ou `` `fichas/<instrumento>.risco.campo` ``).
function declarada(campo: string): boolean {
  // `conta.campo`, `conta.campo[]`, `fichas/<instrumento>.risco.campo` - e a familia `fichas/` inteira,
  // que o documento declara por seccao (risco e setup) e nao linha a linha.
  const comoChave = new RegExp("`(?:conta|fichas/<[a-z_]+>\\.[a-z_.]+)\\.?" + campo + "(?:\\[\\])?`");
  if (comoChave.test(documento)) return true;
  if (campo === "fichas") return documento.includes("`fichas/");
  return documento.includes("`" + campo + "`");
}

console.log("=== SC-012: as chaves que o core le, contra o inventario ===\n");

const naoDeclaradas = [...lidos.keys()].filter((c) => !declarada(c));
exigir(
  naoDeclaradas.length === 0,
  `SC-012: as ${lidos.size} chaves lidas pelo core estao declaradas no inventario (0 ausentes)`,
  naoDeclaradas.map((c) => `nao declarada: '${c}' (lida por ${[...new Set(lidos.get(c)!)].join(", ")})`),
);

// A outra direccao do SC-012: uma chave DECLARADA na seccao deste recorte que ninguem le. Uma chave assim
// e uma promessa de ajuste que nao ajusta nada - o dono muda o valor e nada acontece.
const declaradasNoRecorte = [...documento.matchAll(/\| `conta\.([a-z_]+)(?:\[\])?` \|/g)].map((m) => m[1]);
const semQuemALeia = [...new Set(declaradasNoRecorte)].filter((c) => !lidos.has(c));
exigir(
  semQuemALeia.length === 0,
  `SC-012 (inverso): as ${new Set(declaradasNoRecorte).size} chaves declaradas no inventario tem quem as leia`,
  semQuemALeia.map((c) => `declarada e sem quem a leia: '${c}'`),
);

// A prova negativa: uma chave que ninguem declarou tem de ser apanhada pelo mesmo conferidor.
const falsa = "chave_que_ninguem_declarou_nunca";
exigir(!declarada(falsa), "prova negativa: uma chave fora do inventario e reprovada", []);

console.log("");
console.log(`chaves conferidas: ${lidos.size} · nao declaradas: ${naoDeclaradas.length}`);
for (const [campo, onde] of [...lidos.entries()].sort()) {
  console.log(`  conta.${campo.padEnd(28)} <- ${[...new Set(onde)].join(", ")}`);
}
console.log("");
console.log(`resumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ${lidos.size} chaves`);

if (args.includes("--jsonl")) {
  const saida = args[args.indexOf("--jsonl") + 1] as string;
  require("node:fs").writeFileSync(
    saida,
    [...lidos.entries()].map(([campo, onde]) => JSON.stringify({ chave: `conta.${campo}`, lida_por: [...new Set(onde)] })).join("\n") + "\n",
  );
}

process.exit(divergentes === 0 ? 0 : 1);
