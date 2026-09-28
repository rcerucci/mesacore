// O porteiro do estado: as fronteiras que este recorte introduz, guardadas por programa.
//
// Duas fronteiras, e as duas sao a diferenca entre uma mesa que se reinstala e uma que se engana:
//
//   1. O /core importa `contracts` e NADA MAIS do projecto (RN-E2): nem setups, nem brokers, nem
//      web, nem mocks, nem tools. Um core que importa um mock passa a depender do que devia estar a
//      substituir.
//   2. O ficheiro de marcas NAO TEM POSICAO (R2, FR-022). Guarda o que ACONTECEU (sessao, inibicao,
//      desconhecido, pedidos) e nunca o que a mesa ACHA QUE TEM. A posse le-se da corretora, pela
//      marca que a ordem levou.
//
// `--prova-negativa` quebra cada fronteira de proposito, numa copia temporaria, e exige a
// reprovacao. Um porteiro que passa sempre nao fecha porta nenhuma.

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RAIZ_DO_REPO } from "../../core/livro-de-motivos.ts";

const CORE = join(RAIZ_DO_REPO, "core");
const DIR_DAS_MARCAS = join(CORE, "estado");

/** Nomes de campo que NAO podem aparecer na forma das marcas: sao a posicao que a mesa nao guarda. */
const CAMPOS_PROIBIDOS = [
  "posicao",
  "posicoes",
  "unidades",
  "quantidade",
  "lote",
  "preco_absoluto",
  "saldo",
  "equity_guardado",
];

const IMPORTACOES_PROIBIDAS = ["setups", "brokers", "web", "mocks", "specs", "tools"];

let falhas = 0;
let verificacoes = 0;

function exigir(condicao: boolean, texto: string): void {
  verificacoes += 1;
  if (condicao) {
    console.log(`ok    ${texto}`);
  } else {
    falhas += 1;
    console.log(`FALHA ${texto}`);
  }
}

/**
 * Uma verificacao sem efeito global: usada nas provas negativas, onde o vermelho e o RESULTADO
 * esperado. Sem isto, o vermelho que prova o instrumento sujaria o resultado do proprio instrumento.
 */
function exigirQuieto(condicao: boolean, texto: string, falhasDaProva: { n: number }): void {
  console.log(condicao ? `  ok    ${texto}` : `  FALHA ${texto}`);
  if (!condicao) falhasDaProva.n += 1;
}

function ficheirosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules") continue;
      saida.push(...ficheirosTs(caminho));
    } else if (entrada.name.endsWith(".ts")) {
      saida.push(caminho);
    }
  }
  return saida;
}

/** Só as linhas de `import` contam: num comentario, as palavras proibidas explicam-se. */
function importacoesProibidas(conteudo: string): string[] {
  const achadas: string[] = [];
  for (const linha of conteudo.split("\n")) {
    const limpa = linha.trim();
    if (!limpa.startsWith("import ") && !limpa.startsWith("} from ")) continue;
    for (const proibida of IMPORTACOES_PROIBIDAS) {
      if (new RegExp(`["'\`][^"'\`]*/${proibida}/|["'\`]\\.\\.?/${proibida}/`).test(limpa)) {
        achadas.push(`${proibida} -> ${limpa}`);
      }
    }
  }
  return achadas;
}

/** Percorre a forma das marcas e devolve os nomes de campo proibidos que encontrar. */
function camposDePosicao(ficheiro: string, conteudo: string): string[] {
  const achados: string[] = [];
  // Olha para a FORMA declarada (interfaces e o objecto vazio), nao para a prosa.
  const linhasDeForma = conteudo
    .split("\n")
    .filter((l) => /^\s{2,}(readonly\s+)?[a-z_]+\s*[?:]/.test(l) || /^\s{4,}[a-z_]+\s*:/.test(l));
  for (const linha of linhasDeForma) {
    for (const campo of CAMPOS_PROIBIDOS) {
      if (new RegExp(`^\\s*(readonly\\s+)?${campo}\\s*[?:]`).test(linha)) {
        achados.push(`${campo} (${ficheiro.split("/").slice(-2).join("/")}: ${linha.trim()})`);
      }
    }
  }
  return achados;
}

/**
 * Confere as fronteiras num directoria de core. Devolve quantas violacoes encontrou.
 * Quando `silencioso` e verdadeiro (prova negativa), nao toca nos contadores globais.
 */
function verificarCore(
  dirDoCore: string,
  dirDasMarcas: string,
  silencioso = false,
): number {
  const reportar = (texto: string) => {
    if (!silencioso) console.log(texto);
  };
  let violacoes = 0;
  let importacoes = 0;

  for (const ficheiro of ficheirosTs(dirDoCore)) {
    const conteudo = readFileSync(ficheiro, "utf8");
    const proibidas = importacoesProibidas(conteudo);
    for (const p of proibidas) {
      importacoes += 1;
      reportar(`FALHA importacao proibida em ${ficheiro.replace(RAIZ_DO_REPO + "/", "")}: ${p}`);
    }
  }
  violacoes += importacoes;
  if (silencioso) {
    if (importacoes > 0) reportar("      (importacao proibida detectada)");
  } else {
    exigir(importacoes === 0, "o /core importa `contracts` e nada mais do projecto (RN-E2)");
  }

  let campos = 0;
  for (const ficheiro of ficheirosTs(dirDasMarcas).filter((f) => f.endsWith("marcas.ts") || f.endsWith("registo.ts"))) {
    const conteudo = readFileSync(ficheiro, "utf8");
    for (const a of camposDePosicao(ficheiro, conteudo)) {
      campos += 1;
      reportar(`FALHA campo de posicao na forma das marcas: ${a}`);
    }
  }
  violacoes += campos;
  if (!silencioso) {
    exigir(campos === 0, "a forma das marcas nao tem nenhum campo de posicao (R2, FR-022)");
  }

  return violacoes;
}

console.log(`porteiro do estado · core: ${CORE.replace(RAIZ_DO_REPO + "/", "")}`);
verificarCore(CORE, DIR_DAS_MARCAS);

if (process.argv.includes("--prova-negativa")) {
  console.log("\nprova negativa (copias temporarias; o repositorio nao e tocado):");
  const dir = mkdtempSync(join(tmpdir(), "mesacore-porteiro-"));
  const coreFalso = join(dir, "core");
  mkdirSync(join(coreFalso, "estado"), { recursive: true });

  // (a) um core que importa um mock
  writeFileSync(
    join(coreFalso, "ciclo.ts"),
    'import { venue } from "../mocks/conector/venue.ts";\nexport const x = venue;\n',
  );
  const prova: { n: number } = { n: 0 };
  const violacoesImport = verificarCore(coreFalso, join(coreFalso, "estado"), true);
  exigirQuieto(violacoesImport > 0, "prova negativa (a) importacao de mock: reprovada.", prova);

  // (b) marcas que ganharam posicoes
  rmSync(join(coreFalso, "ciclo.ts"));
  writeFileSync(
    join(coreFalso, "estado", "marcas.ts"),
    "export interface Marcas {\n  sessao: null;\n  posicoes: { instrumento: string; unidades: string }[];\n}\n",
  );
  const violacoesCampos = verificarCore(coreFalso, join(coreFalso, "estado"), true);
  exigirQuieto(violacoesCampos > 0, "prova negativa (b) marcas com posicoes: reprovada.", prova);

  rmSync(dir, { recursive: true, force: true });
  if (prova.n > 0) {
    console.log("\n  as provas negativas falharam: o porteiro nao esta a fechar porta nenhuma.");
    falhas += prova.n;
    verificacoes += 1;
  }
}

console.log(`\nresumo: ${verificacoes} verificacoes · ${falhas} falhas`);
process.exit(falhas === 0 ? 0 : 1);
