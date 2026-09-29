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
  /** As linhas, em ordem. As expectativas sao da ULTIMA resposta - ha perguntas que so existem depois
   *  de um estado anterior (`stop` com a mesa parada nao e a mesma pergunta de `stop` em operacao). */
  linhas: string[];
  portas?: { passam: boolean; porta?: string; motivo?: string };
  posicaoViva?: boolean;
  aceito: boolean;
  efeito?: string;
  motivo?: string;
  /** A transicao da ultima resposta. E ela que prova onde a mesa ficou - e onde NAO se mexeu. */
  de: string;
  para: string;
}

const CASOS: Caso[] = [
  {
    nome: "start/portas-conferidas-e-start-repetido",
    linhas: [
      comando("p-1", { verbo: "start", autor: "dono", pedido_id: "p-1" }),
      comando("p-2", { verbo: "start", autor: "dono", pedido_id: "p-2" }),
    ],
    portas: { passam: true },
    aceito: false,
    motivo: "mesa_ja_em_operacao",
    de: "em_operacao",
    para: "em_operacao",
  },
  {
    nome: "start/sem-as-portas-recusa",
    linhas: [comando("p-3", { verbo: "start", autor: "dono", pedido_id: "p-3" })],
    aceito: false,
    motivo: "porta_do_arranque_falhou",
    de: "parada",
    para: "parada",
  },
  {
    nome: "start/portas-com-a-porta-nomeada",
    linhas: [comando("p-4", { verbo: "start", autor: "dono", pedido_id: "p-4" })],
    portas: { passam: false, porta: "inventario", motivo: "porta_do_arranque_falhou" },
    aceito: false,
    motivo: "porta_do_arranque_falhou",
    de: "parada",
    para: "parada",
  },
  {
    nome: "start/campo-a-mais",
    linhas: [comando("p-5", { verbo: "start", autor: "dono", pedido_id: "p-5", lado: "buy" })],
    portas: { passam: true },
    aceito: false,
    motivo: "comando_com_campo_a_mais",
    de: "parada",
    para: "parada",
  },
  {
    nome: "start/sem-autor",
    linhas: [comando("p-6", { verbo: "start", pedido_id: "p-6" })],
    portas: { passam: true },
    aceito: false,
    motivo: "comando_incompleto",
    de: "parada",
    para: "parada",
  },
  {
    nome: "verbo-fora-dos-cinco",
    linhas: [comando("p-7", { verbo: "cancelar", autor: "dono", pedido_id: "p-7" })],
    portas: { passam: true },
    aceito: false,
    motivo: "verbo_desconhecido",
    de: "parada",
    para: "parada",
  },
  {
    nome: "stop/em-parada-a-posicao-nao-muda-a-resposta",
    linhas: [comando("p-8", { verbo: "stop", autor: "dono", pedido_id: "p-8" })],
    aceito: false,
    motivo: "mesa_ja_parada",
    de: "parada",
    para: "parada",
  },
  {
    nome: "stop/em-operacao-e-a-posicao-desconhecida-recusa",
    linhas: [
      comando("p-9", { verbo: "start", autor: "dono", pedido_id: "p-9" }),
      comando("p-10", { verbo: "stop", autor: "dono", pedido_id: "p-10" }),
    ],
    portas: { passam: true },
    aceito: false,
    motivo: "posicao_desconhecida",
    de: "em_operacao",
    para: "em_operacao",
  },
  {
    nome: "stop/em-operacao-com-a-posicao-declarada-para",
    linhas: [
      comando("p-11", { verbo: "start", autor: "dono", pedido_id: "p-11" }),
      comando("p-12", { verbo: "stop", autor: "dono", pedido_id: "p-12" }),
    ],
    portas: { passam: true },
    posicaoViva: false,
    aceito: true,
    de: "em_operacao",
    para: "parada",
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
  // As linhas vao todas no MESMO processo: um processo novo recomecaria sempre `parada` (a mesa nao
  // persiste estado, R3), e a sequencia perderia o sentido.
  const saida = correr(caso.linhas, caso.portas, caso.posicaoViva);

  conferir(`${caso.nome}: uma linha entra, uma linha sai`,
    saida.length === caso.linhas.length, `entradas: ${caso.linhas.length}, saidas: ${saida.length}`);
  if (saida.length !== caso.linhas.length) continue;

  for (const [i, linha] of saida.entries()) {
    const d = validar(linha);
    conferir(`${caso.nome} [linha ${i + 1}]: a resposta e mensagem VALIDA do contrato`,
      d.veredicto === "aceite", `veredicto=${d.veredicto} motivo=${d.motivo}`);
  }

  let o: any = {};
  try { o = JSON.parse(saida[saida.length - 1]); } catch { /* ja reprovado acima */ }
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
  conferir(`${caso.nome}: o instante e da mesa`, Number.isInteger(c.instante_ms) && c.instante_ms > 0);
  conferir(`${caso.nome}: transicao ${caso.de}->${caso.para}`,
    c.transicao?.de === caso.de && c.transicao?.para === caso.para,
    `${c.transicao?.de}->${c.transicao?.para}`);
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
  const velha = JSON.stringify({ contrato: "0.9.9", tipo: "comando", id: "p-99", carga: { verbo: "start", autor: "dono", pedido_id: "p-99" } });
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
