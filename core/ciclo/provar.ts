// O runner do ciclo: corre as duas baterias (condicoes e decisoes) e conta o que a spec manda contar.
//
// Conta tres coisas que o codigo NAO pode afirmar sozinho:
//   SC-002 - quantas decisoes de ABRIR aconteceram fora de `normal` (tem de ser zero)
//   SC-003 - com dado velho: pedidos legitimos de fechar permitidos (100%) e aberturas (zero)
//   o lado dos impedimentos - quantas vezes uma condicao travou, e qual
//
// A comparacao da boleta e por SUBCONJUNTO: o caso declara os campos que lhe interessam e os outros
// nao sao ignorados por conveniencia - sao conferidos pelo contrato, que valida a boleta inteira
// antes de ela sair (decisao.ts). Um campo a mais inventado pela mesa reprova la.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lerParaOCiclo } from "../leitura/fixtures.ts";
import { decidirInstrumento } from "./ciclo.ts";
import { conferirLivro, livroDeCondicoes, situacaoDoInstrumento } from "./condicoes.ts";
import { RAIZ_DO_REPO } from "../livro-de-motivos.ts";

const args = process.argv.slice(2);
const caminhoCondicoes = join(RAIZ_DO_REPO, "core", "ciclo", "condicoes.casos.json");
const caminhoCiclo = join(RAIZ_DO_REPO, "core", "ciclo", "ciclo.casos.json");

let divergentes = 0;
let verificacoes = 0;
const linhas: string[] = [];

function exigir(condicao: boolean, texto: string, contexto: string[]): void {
  verificacoes += 1;
  if (condicao) {
    console.log(`ok    ${texto}`);
  } else {
    divergentes += 1;
    console.log(`FALHA ${texto}`);
    for (const c of contexto) console.log(`        ${c}`);
  }
}

// ---------------------------------------------------------------- o livro das condicoes

console.log("=== invariantes do livro das condicoes ===\n");

const problemasNoLivro = conferirLivro();
exigir(
  problemasNoLivro.length === 0,
  `o livro das condicoes cobre o conjunto fechado e a precedencia e uma ordem total (${problemasNoLivro.length} problemas)`,
  problemasNoLivro,
);

// Prova negativa: um livro quebrado em memoria tem de ser REPROVADO. Sem isto, o conferidor acima
// seria uma promessa com sintaxe - um instrumento que passa sempre nao mede nada.
const livroQuebrado = JSON.parse(JSON.stringify(livroDeCondicoes()));
delete livroQuebrado.condicoes.sem_leitura;
livroQuebrado.precedencia.push("congelada");
const problemasDoQuebrado = conferirLivro(livroQuebrado);
exigir(
  problemasDoQuebrado.length > 0,
  `prova negativa: um livro sem 'sem_leitura' e com a precedencia repetida e REPROVADO (${problemasDoQuebrado.length} problemas apanhados)`,
  problemasDoQuebrado,
);

console.log("\n=== bateria das condicoes (o que se leu -> o que se pode fazer) ===\n");
const bateriaCondicoes = JSON.parse(readFileSync(caminhoCondicoes, "utf8")) as any;
for (const caso of bateriaCondicoes.casos) {
  const s = situacaoDoInstrumento(
    { idade_do_dado_ms: caso.leitura.idade_do_dado_ms, estado_do_mercado: caso.leitura.estado_do_mercado },
    caso.limite_de_idade_ms,
    caso.falhas ?? {},
    caso.divergente === true ||
      (caso.leitura.posicao !== undefined &&
        !(caso.marcas_nossas_conhecidas ?? []).includes(caso.leitura.posicao.marca_de_posse)),
  );
  const contexto = [
    `condicao: esperada '${caso.condicao_esperada}', obtida '${s.condicao}'`,
    `impedimentos: esperados [${caso.impedimentos_esperados.join(", ")}], obtidos [${s.impedimentos.join(", ")}]`,
    `abre: esperado ${caso.abre_esperado}, obtido ${s.abre}`,
    `fecha: esperado ${caso.fecha_esperado}, obtido ${s.fecha}`,
    `alarma: esperado ${caso.alarma_esperado}, obtido ${s.alarma}`,
  ];
  const ok =
    s.condicao === caso.condicao_esperada &&
    s.impedimentos.join(",") === caso.impedimentos_esperados.join(",") &&
    s.abre === caso.abre_esperado &&
    s.fecha === caso.fecha_esperado &&
    s.alarma === caso.alarma_esperado;
  exigir(ok, `condicao/${caso.nome}`, contexto);
  linhas.push(
    JSON.stringify({
      bateria: "condicoes",
      caso: caso.nome,
      condicao: s.condicao,
      impedimentos: s.impedimentos,
      abre: s.abre,
      fecha: s.fecha,
      alarma: s.alarma,
      ok,
    }),
  );
}

// ---------------------------------------------------------------- decisoes

console.log("\n=== bateria do ciclo (a mesma proposta em cada condicao) ===\n");
const bateriaCiclo = JSON.parse(readFileSync(caminhoCiclo, "utf8")) as any;
const padrao = bateriaCiclo.padrao;

let aberturasForaDeNormal = 0;
let comDadoVelhoFechou = 0;
let comDadoVelhoPediuFechar = 0;
let comDadoVelhoAbriu = 0;

for (const caso of bateriaCiclo.casos) {
  const ciclo = caso.ciclo ?? padrao.ciclo;
  // A assinatura do setup e OBRIGATORIA no contrato (RN-S7). Quando o caso nao a declara, usa-se a
  // que esta no `padrao` DESTE ficheiro de casos - a mesa nunca inventa a assinatura de ninguem.
  const propostaDoCaso =
    caso.proposta === null || caso.proposta === undefined
      ? caso.proposta
      : { setup: padrao.proposta_setup, ...caso.proposta };
  const entradas = lerParaOCiclo(caso.leitura, propostaDoCaso, ciclo);
  const decisao = decidirInstrumento({
    mercado: entradas.mercado,
    proposta: entradas.proposta,
    proposta_invalida: entradas.proposta_invalida,
    motivo_do_contrato: entradas.motivo_do_contrato,
    ficha: caso.ficha ?? padrao.ficha,
    ciclo,
    limite_de_idade_ms: caso.limite_de_idade_ms ?? padrao.limite_de_idade_ms,
    mandato: caso.mandato ?? padrao.mandato,
    template: caso.template ?? padrao.template,
    marcas_nossas_conhecidas: caso.marcas_nossas_conhecidas ?? padrao.marcas_nossas_conhecidas,
    falhas: caso.falhas ?? {},
    divergente: caso.divergente === true,
    restricoes: caso.restricoes,
    invalidos_seguidos_antes: caso.invalidos_seguidos_antes ?? padrao.invalidos_seguidos_antes,
  });

  const d = caso.decisao_esperada;
  const contexto: string[] = [];
  if (decisao.acao !== d.acao) contexto.push(`acao: esperada '${d.acao}', obtida '${decisao.acao}'`);
  if ((decisao.motivo ?? null) !== (d.motivo ?? null)) {
    contexto.push(`motivo: esperado '${d.motivo}', obtido '${decisao.motivo}'`);
  }
  if (decisao.condicao !== d.condicao) {
    contexto.push(`condicao: esperada '${d.condicao}', obtida '${decisao.condicao}'`);
  }
  if (decisao.avisa !== d.avisa) {
    contexto.push(`avisa: esperado ${d.avisa}, obtido ${decisao.avisa}`);
  }
  if (d.motivo_do_contrato !== undefined && decisao.motivo_do_contrato !== d.motivo_do_contrato) {
    contexto.push(
      `motivo_do_contrato: esperado '${d.motivo_do_contrato}', obtido '${decisao.motivo_do_contrato}'`,
    );
  }
  if (d.invalidos_seguidos !== undefined && decisao.invalidos_seguidos !== d.invalidos_seguidos) {
    contexto.push(
      `invalidos_seguidos: esperado ${d.invalidos_seguidos}, obtido ${decisao.invalidos_seguidos}`,
    );
  }
  if (d.boleta !== undefined) {
    if (decisao.boleta === null) {
      contexto.push("boleta: esperada, e nao houve nenhuma");
    } else {
      for (const [campo, esperado] of Object.entries(d.boleta)) {
        const obtido = (decisao.boleta as any)[campo];
        if (JSON.stringify(obtido) !== JSON.stringify(esperado)) {
          contexto.push(`boleta.${campo}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
        }
      }
    }
  }
  if (d.boleta === undefined && decisao.boleta !== null) {
    contexto.push(`boleta: nao esperada, e houve uma (${JSON.stringify(decisao.boleta)})`);
  }

  exigir(contexto.length === 0, `ciclo/${caso.nome}`, contexto);

  // As contagens da spec, medidas e nao afirmadas.
  if (decisao.acao === "abrir" && decisao.condicao !== "normal") aberturasForaDeNormal += 1;
  const pediuFechar = (caso.proposta?.lado ?? null) === "caixa";
  const temPosicaoNossa =
    caso.leitura.posicao !== undefined &&
    (caso.marcas_nossas_conhecidas ?? []).includes(caso.leitura.posicao.marca_de_posse);
  const dadoVelho = caso.leitura.idade_do_dado_ms > (caso.limite_de_idade_ms ?? padrao.limite_de_idade_ms);
  if (dadoVelho && pediuFechar && temPosicaoNossa) {
    comDadoVelhoPediuFechar += 1;
    if (decisao.acao === "fechar") comDadoVelhoFechou += 1;
  }
  if (dadoVelho && decisao.acao === "abrir") comDadoVelhoAbriu += 1;

  linhas.push(
    JSON.stringify({
      bateria: "ciclo",
      caso: caso.nome,
      acao: decisao.acao,
      motivo: decisao.motivo,
      condicao: decisao.condicao,
      impedimentos: decisao.impedimentos,
      avisa: decisao.avisa,
      invalidos_seguidos: decisao.invalidos_seguidos,
      motivo_do_contrato: decisao.motivo_do_contrato,
      boleta: decisao.boleta,
      ok: contexto.length === 0,
    }),
  );
}

// ---------------------------------------------------------------- criterios

console.log("\n=== criterios de sucesso ===\n");
exigir(
  aberturasForaDeNormal === 0,
  `SC-002: ${aberturasForaDeNormal} decisoes de abrir fora de 'normal' (tem de ser 0)`,
  [],
);
exigir(
  comDadoVelhoAbriu === 0,
  `SC-003 (lado A): ${comDadoVelhoAbriu} aberturas com dado velho (tem de ser 0)`,
  [],
);
exigir(
  comDadoVelhoPediuFechar > 0 && comDadoVelhoFechou === comDadoVelhoPediuFechar,
  `SC-003 (lado B): ${comDadoVelhoFechou} de ${comDadoVelhoPediuFechar} pedidos legitimos de fechar com dado velho foram permitidos`,
  [],
);

console.log("");
console.log(
  `resumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ` +
    `${bateriaCondicoes.casos.length} casos de condicao · ${bateriaCiclo.casos.length} casos de ciclo`,
);

if (args.includes("--jsonl")) {
  const saida = args[args.indexOf("--jsonl") + 1] as string;
  writeFileSync(saida, linhas.join("\n") + "\n");
  console.log(`relatorio: ${saida}`);
}

process.exit(divergentes === 0 ? 0 : 1);
