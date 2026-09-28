// O conferidor dos invariantes da tabela de transicoes.
//
// A razao de a tabela ser DADO (R1): so assim esta conferencia existe. Em codigo, a unica
// verificacao possivel seria a leitura humana - e foi a leitura humana que deixou passar, no
// recorte anterior, uma chave que nao existia e uma marca fora da lista da boleta.
//
// Os seis invariantes, todos do data-model.md:
//   1. todo o estado tem pelo menos uma saida (uma linha que muda de estado)
//   2. todo o verbo tem pelo menos uma linha
//   3. nenhum estado e inalcancavel a partir de `parada`
//   4. toda a recusa traz motivo, e o motivo consta de core/estados/motivos.json
//   5. `reset` nunca leva a estado novo (para == de)
//   6. todo o par (estado, verbo) tem uma linha `sempre`, e ela e a ULTIMA daquele par
//   7. nenhum motivo da mesa se chama como um motivo do contrato
//
// O invariante 6 e o mais importante dos seis: garante, por construcao, que nenhum par cai num
// vazio nao declarado. Sem ele, um verbo novo num estado novo passaria a ser um "nada acontece"
// silencioso - o pior defeito possivel numa mesa que opera dinheiro.
//
// `--prova-negativa` quebra CADA invariante de proposito, num ficheiro temporario, e exige que a
// conferencia REPROVE. Um instrumento que passa sempre nao mede nada. As copias quebradas vao para
// um directorio temporario: o ficheiro a serio nunca e tocado, para que uma prova interrompida nao
// deixe a tabela estragada no repositorio.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RAIZ_DO_REPO } from "../../core/livro-de-motivos.ts";

const TABELA_PADRAO = join(RAIZ_DO_REPO, "core", "estados", "transicoes.json");
const MOTIVOS = join(RAIZ_DO_REPO, "core", "estados", "motivos.json");

interface Linha {
  de: string;
  verbo: string;
  guarda: string;
  para?: string;
  recusa?: string;
  nota: string;
}
interface Tabela {
  estados: string[];
  verbos: string[];
  guardas: Record<string, string>;
  linhas: Linha[];
}

interface Falha {
  invariante: number;
  texto: string;
}

function lerTabela(caminho: string): Tabela {
  return JSON.parse(readFileSync(caminho, "utf8")) as Tabela;
}

// Mutavel de proposito: a prova negativa do invariante 7 aponta para uma copia quebrada.
let CAMINHO_MOTIVOS = MOTIVOS;

function motivosDeclarados(): string[] {
  return Object.keys(JSON.parse(readFileSync(CAMINHO_MOTIVOS, "utf8")).motivos);
}

/** Os motivos do CONTRATO (recorte 001) - os que descrevem defeitos de MENSAGEM. */
function motivosDoContrato(): string[] {
  return Object.keys(
    JSON.parse(readFileSync(join(RAIZ_DO_REPO, "contracts", "vocabulario.json"), "utf8")).motivos,
  );
}

/** Os seis invariantes. Devolve a lista de falhas: vazia = tabela coerente. */
export function conferir(t: Tabela): Falha[] {
  const falhas: Falha[] = [];
  const motivos = motivosDeclarados();

  // --- coerencia de forma (o que qualquer tabela tem de respeitar, quebrada ou nao) ---
  for (const [i, l] of t.linhas.entries()) {
    const onde = `linha ${i + 1} (${l.de}, ${l.verbo}, guarda ${l.guarda})`;
    const temPara = typeof l.para === "string";
    const temRecusa = typeof l.recusa === "string";
    if (temPara === temRecusa) {
      falhas.push({
        invariante: 0,
        texto: `${onde}: tem de ter EXACTAMENTE um destino - 'para' ou 'recusa' - e tem ${temPara ? "os dois" : "nenhum"}.`,
      });
    }
    if (!t.estados.includes(l.de)) {
      falhas.push({ invariante: 0, texto: `${onde}: estado de origem desconhecido.` });
    }
    if (!t.verbos.includes(l.verbo)) {
      falhas.push({ invariante: 0, texto: `${onde}: verbo fora do conjunto declarado.` });
    }
    if (!(l.guarda in t.guardas)) {
      falhas.push({ invariante: 0, texto: `${onde}: guarda nao declarada em 'guardas'.` });
    }
    if (temPara && !t.estados.includes(l.para as string)) {
      falhas.push({ invariante: 0, texto: `${onde}: estado de destino desconhecido.` });
    }
  }

  // 1. todo o estado tem pelo menos uma saida
  for (const estado of t.estados) {
    const saidas = t.linhas.filter((l) => l.de === estado && l.para && l.para !== estado);
    if (saidas.length === 0) {
      falhas.push({
        invariante: 1,
        texto: `estado '${estado}' nao tem nenhuma saida declarada: e uma lacuna, nao um estado.`,
      });
    }
  }

  // 2. todo o verbo tem pelo menos uma linha
  for (const verbo of t.verbos) {
    if (!t.linhas.some((l) => l.verbo === verbo)) {
      falhas.push({
        invariante: 2,
        texto: `verbo '${verbo}' nao aparece em nenhuma linha: um verbo sem casa e ruido.`,
      });
    }
  }

  // 3. nenhum estado inalcancavel a partir de `parada`
  const alcancaveis = new Set<string>(["parada"]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const l of t.linhas) {
      if (l.para && alcancaveis.has(l.de) && !alcancaveis.has(l.para)) {
        alcancaveis.add(l.para);
        mudou = true;
      }
    }
  }
  for (const estado of t.estados) {
    if (!alcancaveis.has(estado)) {
      falhas.push({
        invariante: 3,
        texto: `estado '${estado}' e inalcancavel a partir de 'parada'.`,
      });
    }
  }

  // 4. toda a recusa traz motivo do conjunto fechado
  for (const l of t.linhas) {
    if (l.recusa && !motivos.includes(l.recusa)) {
      falhas.push({
        invariante: 4,
        texto: `recusa '${l.recusa}' (${l.de}, ${l.verbo}) nao consta de motivos.json - um motivo inventado nao e um motivo.`,
      });
    }
  }

  // 5. reset nunca leva a estado novo
  for (const l of t.linhas) {
    if (l.verbo === "reset") {
      if (!l.para || l.para !== l.de) {
        falhas.push({
          invariante: 5,
          texto: `reset em '${l.de}' leva a '${l.para ?? "recusa"}' - o reset nao muda de estado nem recusa (FR-005).`,
        });
      }
    }
  }

  // 6. todo o par (estado, verbo) tem uma linha `sempre`, e ela e a ultima daquele par
  for (const estado of t.estados) {
    for (const verbo of t.verbos) {
      const doPar = t.linhas.filter((l) => l.de === estado && l.verbo === verbo);
      if (doPar.length === 0) {
        falhas.push({
          invariante: 6,
          texto: `par (${estado}, ${verbo}) sem nenhuma linha: um evento sem estado onde caiba e uma lacuna.`,
        });
        continue;
      }
      const sempre = doPar.filter((l) => l.guarda === "sempre");
      if (sempre.length === 0) {
        falhas.push({
          invariante: 6,
          texto: `par (${estado}, ${verbo}) sem linha 'sempre': fica um vazio nao declarado por onde um contexto inesperado cai.`,
        });
      } else if (sempre.length > 1) {
        falhas.push({
          invariante: 6,
          texto: `par (${estado}, ${verbo}) com ${sempre.length} linhas 'sempre': a primeira torna as outras inalcancaveis.`,
        });
      } else if (doPar[doPar.length - 1]?.guarda !== "sempre") {
        falhas.push({
          invariante: 6,
          texto: `par (${estado}, ${verbo}): a linha 'sempre' nao e a ultima - ha linhas depois dela que nunca correm.`,
        });
      }
    }
  }

  // 7. nenhum motivo da mesa se chama como um motivo do contrato.
  // Sao vocabularios de coisas diferentes: um fala de defeitos de MENSAGEM (o contrato), o outro de
  // recusas de COMANDO (a mesa). Um nome partilhado por dois conjuntos e um julgamento a espera de
  // ser lido errado - foi um defeito apanhado a escrever o comando.ts, nao um cuidado previo.
  const doContrato = motivosDoContrato();
  for (const motivo of motivos) {
    if (doContrato.includes(motivo)) {
      falhas.push({
        invariante: 7,
        texto: `motivo '${motivo}' existe nos DOIS vocabularios (mesa e contrato): sao conjuntos de coisas diferentes e um nome partilhado le-se mal.`,
      });
    }
  }

  return falhas;
}

function relatar(t: Tabela, origem: string): number {
  const falhas = conferir(t);
  const pares = t.estados.length * t.verbos.length;
  console.log(
    `tabela ${origem}: ${t.linhas.length} linhas, ${t.estados.length} estados, ${t.verbos.length} verbos, ${pares} pares.`,
  );
  if (falhas.length === 0) {
    console.log("conferencia: 0 falhas nos 7 invariantes.");
    return 0;
  }
  for (const f of falhas) {
    console.log(`FALHA [invariante ${f.invariante}] ${f.texto}`);
  }
  console.log(`conferencia: ${falhas.length} falhas.`);
  return 1;
}

function copiaQuebrada(t: Tabela, estragar: (t: Tabela) => void, nome: string, dir: string): string {
  const copia = JSON.parse(JSON.stringify(t)) as Tabela;
  estragar(copia);
  const caminho = join(dir, `${nome}.json`);
  writeFileSync(caminho, JSON.stringify(copia, null, 2));
  return caminho;
}

function provaNegativa(t: Tabela, dir: string): number {
  const casos: { nome: string; invariante: number; estragar: (t: Tabela) => void }[] = [
    {
      nome: "1-estado-sem-saida",
      invariante: 1,
      estragar: (c) => {
        // `encerrando` perde a saida (o start) e fica so com recusas.
        c.linhas = c.linhas.filter((l) => !(l.de === "encerrando" && l.verbo === "start"));
        c.linhas.push({
          de: "encerrando",
          verbo: "start",
          guarda: "sempre",
          recusa: "mesa_em_encerramento",
          nota: "quebrado de proposito",
        });
      },
    },
    {
      nome: "2-verbo-sem-casa",
      invariante: 2,
      estragar: (c) => {
        c.verbos.push("suspender");
      },
    },
    {
      nome: "3-estado-inalcancavel",
      invariante: 3,
      estragar: (c) => {
        c.estados.push("dormente");
      },
    },
    {
      nome: "4-recusa-com-motivo-inventado",
      invariante: 4,
      estragar: (c) => {
        c.linhas.push({
          de: "parada",
          verbo: "pause",
          guarda: "sempre",
          recusa: "porque_sim",
          nota: "quebrado de proposito",
        });
      },
    },
    {
      nome: "5-reset-muda-de-estado",
      invariante: 5,
      estragar: (c) => {
        const linha = c.linhas.find((l) => l.verbo === "reset" && l.de === "pausada");
        if (linha) linha.para = "em_operacao";
      },
    },
    {
      nome: "6-par-sem-linha-sempre",
      invariante: 6,
      estragar: (c) => {
        const idx = c.linhas.findIndex(
          (l) => l.de === "pausada" && l.verbo === "stop" && l.guarda === "sempre",
        );
        if (idx >= 0) c.linhas.splice(idx, 1);
      },
    },
  ];

  let falhasNaProva = 0;
  for (const caso of casos) {
    const caminho = copiaQuebrada(t, caso.estragar, caso.nome, dir);
    const quebrada = lerTabela(caminho);
    const detectadas = conferir(quebrada);
    const apanhou = detectadas.some((f) => f.invariante === caso.invariante);
    if (apanhou) {
      console.log(`  ok    prova negativa ${caso.nome}: reprovada pelo invariante ${caso.invariante}.`);
    } else {
      console.log(
        `  FALHA prova negativa ${caso.nome}: a conferencia NAO reprovou. ` +
          `Um invariante que nao sabe reprovar nao mede nada.`,
      );
      falhasNaProva += 1;
    }
  }
  return falhasNaProva;
}

/**
 * Prova negativa do invariante 7: um motivo da mesa com o MESMO nome de um do contrato.
 * Leva um ficheiro de motivos quebrado (copia temporaria) e exige a reprovacao.
 */
function provaNegativaDosMotivos(dir: string): number {
  const real = JSON.parse(readFileSync(MOTIVOS, "utf8"));
  const quebrado = JSON.parse(JSON.stringify(real));
  const nomeDoContrato = motivosDoContrato()[0] as string;
  quebrado.motivos[nomeDoContrato] = {
    quando: "quebrado de proposito",
    regra: "-",
    porque: "copia temporaria",
  };
  const caminho = join(dir, "motivos-com-nome-do-contrato.json");
  writeFileSync(caminho, JSON.stringify(quebrado, null, 2));

  const guardado = CAMINHO_MOTIVOS;
  CAMINHO_MOTIVOS = caminho;
  const detectadas = conferir(lerTabela(TABELA_PADRAO));
  CAMINHO_MOTIVOS = guardado;

  const apanhou = detectadas.some((f) => f.invariante === 7);
  if (apanhou) {
    console.log(
      `  ok    prova negativa 7-motivo-com-nome-do-contrato: reprovada pelo invariante 7 (nome '${nomeDoContrato}').`,
    );
    return 0;
  }
  console.log(
    "  FALHA prova negativa 7-motivo-com-nome-do-contrato: a conferencia NAO reprovou um nome partilhado.",
  );
  return 1;
}

const args = process.argv.slice(2);
const caminhoTabela = args.includes("--tabela")
  ? (args[args.indexOf("--tabela") + 1] as string)
  : TABELA_PADRAO;

let saida = relatar(lerTabela(caminhoTabela), caminhoTabela);

if (args.includes("--prova-negativa")) {
  const dir = mkdtempSync(join(tmpdir(), "mesacore-tabela-"));
  console.log("prova negativa (ficheiros temporarios, o repositorio nao e tocado):");
  saida += provaNegativa(lerTabela(TABELA_PADRAO), dir);
  saida += provaNegativaDosMotivos(dir);
}

process.exit(saida === 0 ? 0 : 1);
