// A bancada da PORTA DE PROCESSO da mesa (T016).
//
// O que se prova aqui, e o que NAO se prova:
//
//   - prova-se a PORTA: uma linha entra, uma linha sai; a resposta e sempre uma mensagem VALIDA do
//     contrato (cada resposta volta ao validador, e uma resposta invalida reprova); cada recusa traz o
//     motivo certo, e nao um generico;
//   - prova-se o QUE A PORTA FAZ QUANDO NAO SABE: sem as portas do arranque o `start` recusa, sem a
//     posicao o `stop` recusa. O desconhecido nao vira "sim" por omissao;
//   - NAO se prova o comportamento da mesa: a decisao e da tabela, e tem as bancadas dela (`tabela.ts`,
//     `sessao.ts`, `pausa.ts`). Aqui so se mede a fronteira.
//
// A porta corre como PROCESSO: e isso que esta em causa. Um teste que chamasse a funcao ficaria a testar
// o que a porta faz se ninguem a tivesse sabido ligar.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { RAIZ_DO_REPO } from "../../core/livro-de-motivos.ts";
import { validar } from "../../contracts/esqueleto/framing.ts";
import { TRADUCAO } from "../../core/servidor.ts";

const VERSAO = "1.1.0";
const envelope = (tipo: string, id: string, carga: unknown) =>
  JSON.stringify({ contrato: VERSAO, tipo, id, carga });

const comando = (id: string, carga: Record<string, unknown>) => envelope("comando", id, carga);

interface Caso {
  nome: string;
  linha: string;
  portas?: { passam: boolean; porta?: string; motivo?: string };
  posicaoViva?: boolean;
  aceito: boolean;
  efeito?: string;
  motivo?: string;
  /** O estado em que a mesa fica depois desta linha - a prova de que a recusa NAO mexeu. */
  estado: string;
  /** A SEGUNDA linha identica, no MESMO processo: e a unica prova de estado que existe (R3: a mesa nao
   *  persiste estado - ao arrancar esta sempre `parada`). */
  depois: { de: string; aceito: boolean; motivo: string };
  extra?: string[];
}

const CASOS: Caso[] = [
  {
    nome: "start/com-as-portas-conferidas",
    linha: comando("p-1", { verbo: "start", autor: "dono", pedido_id: "p-1" }),
    portas: { passam: true },
    aceito: true,
    estado: "em_operacao",
    depois: { de: "em_operacao", aceito: false, motivo: "mesa_ja_em_operacao" },
    extra: ["transicao parada->em_operacao"],
  },
  {
    nome: "start/sem-as-portas-recusa",
    linha: comando("p-2", { verbo: "start", autor: "dono", pedido_id: "p-2" }),
    aceito: false,
    motivo: "porta_do_arranque_falhou",
    estado: "parada",
    depois: { de: "parada", aceito: false, motivo: "porta_do_arranque_falhou" },
    extra: ["o que a porta nao sabe nao vira 'sim': a mesa fica parada"],
  },
  {
    nome: "start/campo-a-mais",
    linha: comando("p-3", { verbo: "start", autor: "dono", pedido_id: "p-3", lado: "buy" }),
    portas: { passam: true },
    aceito: false,
    motivo: "comando_com_campo_a_mais",
    estado: "parada",
    depois: { de: "parada", aceito: false, motivo: "comando_com_campo_a_mais" },
  },
  {
    nome: "start/sem-autor",
    linha: comando("p-4", { verbo: "start", pedido_id: "p-4" }),
    portas: { passam: true },
    aceito: false,
    motivo: "comando_incompleto",
    estado: "parada",
    depois: { de: "parada", aceito: false, motivo: "comando_incompleto" },
  },
  {
    nome: "verbo-fora-dos-cinco",
    linha: comando("p-5", { verbo: "cancelar", autor: "dono", pedido_id: "p-5" }),
    portas: { passam: true },
    aceito: false,
    motivo: "verbo_desconhecido",
    estado: "parada",
    depois: { de: "parada", aceito: false, motivo: "verbo_desconhecido" },
    extra: ["o verbo tem nome proprio: nao se afoga num generico"],
  },
  {
    nome: "stop/sem-a-posicao-recusa",
    linha: comando("p-6", { verbo: "stop", autor: "dono", pedido_id: "p-6" }),
    aceito: false,
    motivo: "posicao_desconhecida",
    estado: "parada",
    depois: { de: "parada", aceito: false, motivo: "posicao_desconhecida" },
    extra: ["parar sem saber se ha posicao seria o oposto de perguntar"],
  },
];

const dir = mkdtempSync(join(tmpdir(), "porta-da-mesa-"));
let verificacoes = 0;
let divergentes = 0;
const falhas: string[] = [];

function conferir(nome: string, ok: boolean, detalhe = "") {
  verificacoes++;
  if (!ok) {
    divergentes++;
    falhas.push(`${nome}${detalhe ? " :: " + detalhe : ""}`);
  }
}

function correr(linhas: string[], portas?: Caso["portas"], posicaoViva?: boolean) {
  const caminhoPortas = join(dir, "portas.json");
  const args = [
    "run",
    join(RAIZ_DO_REPO, "core/servidor.ts"),
    "--marcas", join(dir, "marcas.json"),
    "--registo", join(dir, "registo.jsonl"),
  ];
  if (portas !== undefined) {
    writeFileSync(caminhoPortas, JSON.stringify(portas));
    args.push("--portas", caminhoPortas);
  }
  if (posicaoViva !== undefined) args.push("--posicao-viva", String(posicaoViva));
  const r = spawnSync("bun", args, { input: linhas.join("\n") + "\n", encoding: "utf8" });
  return (r.stdout ?? "").split("\n").filter((l) => l.trim() !== "");
}

// Um processo por caso: cada caso comeca com a mesa `parada`, e a memoizacao entre casos esconderia
// justamente o que se quer ver (a recusa nao mexer no estado).
for (const caso of CASOS) {
  rmSync(join(dir, "marcas.json"), { force: true });
  // DUAS linhas identicas no MESMO processo: a primeira diz o que a porta decide, a segunda prova
  // onde a mesa ficou (a mesa nao persiste estado - R3 -, e um processo novo recomecaria sempre `parada`).
  const saida = correr([caso.linha, caso.linha], caso.portas, caso.posicaoViva);

  conferir(`${caso.nome}: duas linhas entram, duas saem`, saida.length === 2, `saidas: ${saida.length}`);
  if (saida.length !== 2) continue;

  const decisao = validar(saida[0]);
  conferir(
    `${caso.nome}: a resposta e mensagem VALIDA do contrato`,
    decisao.veredicto === "aceite",
    `veredicto=${decisao.veredicto} motivo=${decisao.motivo}`,
  );

  let o: any = {};
  try { o = JSON.parse(saida[0]); } catch { /* ja reprovado acima */ }
  const c = o?.carga ?? {};
  conferir(`${caso.nome}: tipo da resposta`, o?.tipo === "resposta_de_comando", `tipo=${o?.tipo}`);
  conferir(`${caso.nome}: aceito`, c.aceito === caso.aceito, `aceito=${c.aceito}`);
  if (caso.aceito) {
    if (caso.efeito !== undefined) {
      conferir(`${caso.nome}: efeito`, c.efeito === caso.efeito, `efeito=${c.efeito}`);
    }
    conferir(`${caso.nome}: recusa nao traz efeito`, c.motivo === undefined, `motivo=${c.motivo}`);
  } else {
    conferir(`${caso.nome}: o motivo e o certo`, c.motivo === caso.motivo, `motivo=${c.motivo} esperado=${caso.motivo}`);
    conferir(`${caso.nome}: a recusa nao traz efeito`, c.efeito === undefined, `efeito=${c.efeito}`);
  }
  conferir(`${caso.nome}: a transicao vem sempre`, c.transicao?.de !== undefined && c.transicao?.para !== undefined);
  conferir(`${caso.nome}: o instante e da mesa`, Number.isInteger(c.instante_ms) && c.instante_ms > 0);
  if (caso.extra?.includes("transicao parada->em_operacao")) {
    conferir(`${caso.nome}: transicao parada->em_operacao`, c.transicao?.de === "parada" && c.transicao?.para === "em_operacao",
      `${c.transicao?.de}->${c.transicao?.para}`);
  }

  // A SEGUNDA linha: a recusa NAO mexe na mesa (FR-004) e o aceite mexe (R3 dentro do processo).
  const segunda = JSON.parse(saida[1] ?? "{}")?.carga ?? {};
  conferir(`${caso.nome}: a mesa fica ${caso.depois.de}`, segunda.transicao?.de === caso.depois.de,
    `de=${segunda.transicao?.de} esperado=${caso.depois.de}`);
  conferir(`${caso.nome}: a segunda linha -> ${caso.depois.motivo}`,
    segunda.aceito === caso.depois.aceito && segunda.motivo === caso.depois.motivo,
    `aceito=${segunda.aceito} motivo=${segunda.motivo}`);
}

// A tabela de traducao tem de cobrir TUDO o que o contrato sabe recusar: um motivo sem traducao cairia
// num generico, e um generico num caso delicado e a forma mais rapida de o vigia olhar para o lado errado.
const livroDoContrato = JSON.parse(
  (await import("node:fs")).readFileSync(join(RAIZ_DO_REPO, "contracts/vocabulario.json"), "utf8"),
).motivos as Record<string, unknown>;
for (const motivo of Object.keys(livroDoContrato)) {
  conferir(`traducao cobre '${motivo}'`, typeof TRADUCAO[motivo] === "string" && TRADUCAO[motivo].length > 0);
}

// A PROVA NEGATIVA: uma versao diferente tem de ser recusada ANTES de tudo (D7), e nao "aceite por engano".
{
  const velha = JSON.stringify({ contrato: "0.9.9", tipo: "comando", id: "p-9", carga: { verbo: "start", autor: "dono", pedido_id: "p-9" } });
  const saida = correr([velha], { passam: true });
  const c = JSON.parse(saida[0] ?? "{}")?.carga ?? {};
  conferir("versao diferente: recusado antes de tudo", c.aceito === false && c.motivo === "versao_do_contrato_divergente",
    `aceito=${c.aceito} motivo=${c.motivo}`);
}

rmSync(dir, { recursive: true, force: true });

for (const f of falhas) console.log("FALHA " + f);
console.log(
  `\nresumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ${CASOS.length} casos · ` +
    `${CASOS.length} processos + 1 prova negativa`,
);
process.exit(divergentes === 0 ? 0 : 1);
