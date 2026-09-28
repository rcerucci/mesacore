// O runner do ciclo: corre as quatro baterias e conta o que a spec manda contar.
//
// Conta o que o codigo NAO pode afirmar sozinho:
//   SC-002 - decisoes de ABRIR fora de `normal` (tem de ser zero)
//   SC-003 - com dado velho: pedidos legitimos de fechar permitidos (100%) e aberturas (zero)
//   SC-004 - desfechos sem confirmacao que aparecem como `aceite` ou `recusado` (tem de ser zero)
//   SC-005 - ordens novas com a marca `desconhecido` presente (tem de ser zero)
//
// A comparacao da boleta e por SUBCONJUNTO: o caso declara os campos que lhe interessam e os outros
// nao sao ignorados por conveniencia - sao conferidos pelo contrato, que valida a boleta inteira antes
// de ela sair (decisao.ts). Um campo a mais inventado pela mesa reprova la.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deveAvisar, type ConfiguracaoDaConta } from "../config/configuracao.ts";
import { lerParaOCiclo } from "../leitura/fixtures.ts";
import { decidirInstrumento } from "./ciclo.ts";
import { accaoPara, conferirAccoes, tabelaDeAccoes } from "./acoes.ts";
import { conferirLivro, livroDeCondicoes, situacaoDoInstrumento } from "./condicoes.ts";
import { classificarDesfecho, type Envio } from "./desfecho.ts";
import { reconciliar, type Veredicto } from "./reconciliacao.ts";
import { marcarDesconhecido, marcasVazias, reset, type Marcas } from "../estado/marcas.ts";
import { motivoConhecido, RAIZ_DO_REPO } from "../livro-de-motivos.ts";

const args = process.argv.slice(2);
const ler = (nome: string) =>
  JSON.parse(readFileSync(join(RAIZ_DO_REPO, "core", "ciclo", nome), "utf8")) as any;
const config = (declarada: any): ConfiguracaoDaConta => declarada as ConfiguracaoDaConta;

let divergentes = 0;
let verificacoes = 0;
const linhas: string[] = [];

function exigir(condicao: boolean, texto: string, contexto: string[] = []): void {
  verificacoes += 1;
  if (condicao) {
    console.log(`ok    ${texto}`);
  } else {
    divergentes += 1;
    console.log(`FALHA ${texto}`);
    for (const c of contexto) console.log(`        ${c}`);
  }
}

/** Devolve o desencontro, ou `null` quando bate certo. Mantem as mensagens legiveis sem `if`s longos. */
function desencontro(igual: boolean, texto: string): string | null {
  return igual ? null : texto;
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
livroQuebrado.condicoes.divergente.evento = "congelado_da_vida";
const problemasDoQuebrado = conferirLivro(livroQuebrado);
exigir(
  problemasDoQuebrado.length >= 3,
  `prova negativa: livro sem 'sem_leitura', com a precedencia repetida e um evento inventado e REPROVADO (${problemasDoQuebrado.length} problemas apanhados)`,
  problemasDoQuebrado,
);

// A config do dono: as duas coisas que tem de fazer GRITAR.
for (const [rotulo, configMau] of [
  ["sem lista declarada", {}],
  ["com um evento que nao existe no conjunto fechado", { eventos_que_avisam: ["congelado"] }],
] as [string, any][]) {
  let gritou = false;
  let mensagem = "";
  try {
    deveAvisar(configMau, "congelamento");
  } catch (e) {
    gritou = true;
    mensagem = (e as Error).message.slice(0, 100);
  }
  exigir(gritou, `a config ${rotulo} faz GRITAR (nao ha aviso por omissao)`, [mensagem]);
}

// ---------------------------------------------------------------- condicoes

console.log("\n=== bateria das condicoes (o que se leu -> o que se pode fazer) ===\n");
const bateriaCondicoes = ler("condicoes.casos.json");
const configDasCondicoes = config(bateriaCondicoes.config_da_bateria);

for (const caso of bateriaCondicoes.casos) {
  const s = situacaoDoInstrumento(
    { idade_do_dado_ms: caso.leitura.idade_do_dado_ms, estado_do_mercado: caso.leitura.estado_do_mercado },
    caso.ligacao ?? "ligada",
    caso.falhas ?? {},
    caso.divergente === true ||
      (caso.leitura.posicao !== undefined &&
        !(caso.marcas_nossas_conhecidas ?? []).includes(caso.leitura.posicao.marca_de_posse)),
    config(caso.config ?? configDasCondicoes),
  );
  const contexto = [
    desencontro(s.condicao === caso.condicao_esperada, `condicao: esperada '${caso.condicao_esperada}', obtida '${s.condicao}'`),
    desencontro(
      s.impedimentos.join(",") === caso.impedimentos_esperados.join(","),
      `impedimentos: esperados [${caso.impedimentos_esperados.join(", ")}], obtidos [${s.impedimentos.join(", ")}]`,
    ),
    desencontro(s.abre === caso.abre_esperado, `abre: esperado ${caso.abre_esperado}, obtido ${s.abre}`),
    desencontro(s.fecha === caso.fecha_esperado, `fecha: esperado ${caso.fecha_esperado}, obtido ${s.fecha}`),
    desencontro(s.alarma === caso.alarma_esperado, `alarma: esperado ${caso.alarma_esperado}, obtido ${s.alarma}`),
  ].filter((x): x is string => x !== null);
  exigir(contexto.length === 0, `condicao/${caso.nome}`, contexto);
  linhas.push(
    JSON.stringify({
      bateria: "condicoes",
      caso: caso.nome,
      condicao: s.condicao,
      impedimentos: s.impedimentos,
      abre: s.abre,
      fecha: s.fecha,
      alarma: s.alarma,
      eventos: s.eventos,
      ok: contexto.length === 0,
    }),
  );
}

// ---------------------------------------------------------------- ciclo

console.log("\n=== bateria do ciclo (a mesma proposta em cada condicao) ===\n");
const bateriaCiclo = ler("ciclo.casos.json");
const padrao = bateriaCiclo.padrao;
const configDoCiclo = config(padrao.config);

let aberturasForaDeNormal = 0;
let comDadoVelhoFechou = 0;
let comDadoVelhoPediuFechar = 0;
let comDadoVelhoAbriu = 0;
let aberturasComDesconhecido = 0;
let tentativasComDesconhecido = 0;

for (const caso of bateriaCiclo.casos) {
  const ciclo = caso.ciclo ?? padrao.ciclo;
  // A assinatura do setup e OBRIGATORIA no contrato (RN-S7). Quando o caso nao a declara, usa-se a que
  // esta no `padrao` DESTE ficheiro de casos - a mesa nunca inventa a assinatura de ninguem.
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
    ligacao: caso.ligacao ?? padrao.ligacao ?? "ligada",
    mandato: caso.mandato ?? padrao.mandato,
    template: caso.template ?? padrao.template,
    marcas_nossas_conhecidas: caso.marcas_nossas_conhecidas ?? padrao.marcas_nossas_conhecidas,
    config: config(caso.config ?? configDoCiclo),
    desconhecido: caso.desconhecido ?? null,
    falhas: caso.falhas ?? {},
    divergente: caso.divergente === true,
    restricoes: caso.restricoes,
  });

  const d = caso.decisao_esperada;
  const contexto = [
    desencontro(decisao.acao === d.acao, `acao: esperada '${d.acao}', obtida '${decisao.acao}'`),
    desencontro((decisao.motivo ?? null) === (d.motivo ?? null), `motivo: esperado '${d.motivo}', obtido '${decisao.motivo}'`),
    desencontro(decisao.condicao === d.condicao, `condicao: esperada '${d.condicao}', obtida '${decisao.condicao}'`),
    desencontro(decisao.avisa === d.avisa, `avisa: esperado ${d.avisa}, obtido ${decisao.avisa}`),
    desencontro(
      d.motivo_do_contrato === undefined || decisao.motivo_do_contrato === d.motivo_do_contrato,
      `motivo_do_contrato: esperado '${d.motivo_do_contrato}', obtido '${decisao.motivo_do_contrato}'`,
    ),
  ].filter((x): x is string => x !== null);

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
  } else if (decisao.boleta !== null) {
    contexto.push(`boleta: nao esperada, e houve uma (${JSON.stringify(decisao.boleta)})`);
  }

  exigir(contexto.length === 0, `ciclo/${caso.nome}`, contexto);

  // As contagens dos criterios, medidas e nao afirmadas.
  if (decisao.acao === "abrir" && decisao.condicao !== "normal") aberturasForaDeNormal += 1;
  const pediuFechar = (caso.proposta?.lado ?? null) === "caixa";
  const temPosicaoNossa =
    caso.leitura.posicao !== undefined &&
    (caso.marcas_nossas_conhecidas ?? []).includes(caso.leitura.posicao.marca_de_posse);
  // SC-003 (emenda de 28 set 2026): o que trava a abertura deixou de ser a idade e passou a ser o ESTADO
  // DA LIGACAO. O criterio e o mesmo; a fonte do facto e que mudou.
  const semLigacao = (caso.ligacao ?? padrao.ligacao ?? "ligada") === "sem_ligacao";
  if (semLigacao && pediuFechar && temPosicaoNossa) {
    comDadoVelhoPediuFechar += 1;
    if (decisao.acao === "fechar") comDadoVelhoFechou += 1;
  }
  if (semLigacao && decisao.acao === "abrir") comDadoVelhoAbriu += 1;

  // SC-005: so contam as tentativas em que se PEDIU abrir com a marca presente.
  const querAbrir = ["buy", "sell"].includes(caso.proposta?.lado ?? "");
  if (querAbrir && caso.desconhecido != null) {
    tentativasComDesconhecido += 1;
    if (decisao.acao === "abrir") aberturasComDesconhecido += 1;
  }

  linhas.push(
    JSON.stringify({
      bateria: "ciclo",
      caso: caso.nome,
      acao: decisao.acao,
      motivo: decisao.motivo,
      condicao: decisao.condicao,
      impedimentos: decisao.impedimentos,
      avisa: decisao.avisa,
      ligacao: caso.ligacao ?? padrao.ligacao ?? "ligada",
      motivo_do_contrato: decisao.motivo_do_contrato,
      desconhecido: decisao.desconhecido,
      boleta: decisao.boleta,
      ok: contexto.length === 0,
    }),
  );
}

// ---------------------------------------------------------------- desfecho

console.log("\n=== bateria do desfecho (o silencio nao vira sucesso nem falha) ===\n");
const bateriaDesfecho = ler("desfecho.casos.json");
let silenciosos = 0;
let silenciososPromovidos = 0;
let ilegiveis = 0;
let ilegiveisPromovidos = 0;

for (const caso of bateriaDesfecho.casos) {
  const envio = { ...bateriaDesfecho.padrao.envio, ...(caso.envio ?? {}) } as Envio;
  const r = classificarDesfecho(
    envio,
    caso.chegada ?? null,
    caso.agora_ms,
    config(caso.config ?? bateriaDesfecho.padrao.config),
  );

  const contexto = [
    desencontro(r.classificacao === caso.classificacao_esperada, `classificacao: esperada ${caso.classificacao_esperada}, obtida ${r.classificacao}`),
    desencontro((r.motivo ?? null) === caso.motivo_esperado, `motivo: esperado '${caso.motivo_esperado}', obtido '${r.motivo}'`),
    desencontro(
      caso.motivo_do_contrato_esperado === undefined || r.motivo_do_contrato === caso.motivo_do_contrato_esperado,
      `motivo_do_contrato: esperado '${caso.motivo_do_contrato_esperado}', obtido '${r.motivo_do_contrato}'`,
    ),
    desencontro(r.estado_da_posicao === caso.estado_da_posicao_esperado, `estado_da_posicao: esperado '${caso.estado_da_posicao_esperado}', obtido '${r.estado_da_posicao}'`),
    desencontro((r.marca_a_gravar !== null) === caso.marca_esperada, `marca: esperada ${caso.marca_esperada}, obtida ${r.marca_a_gravar !== null}`),
    desencontro(r.avisa === caso.avisa_esperado, `avisa: esperado ${caso.avisa_esperado}, obtido ${r.avisa}`),
  ].filter((x): x is string => x !== null);
  exigir(contexto.length === 0, `desfecho/${caso.nome}`, contexto);

  // SC-004, medido: o silencio e a confirmacao ilegivel nunca viram sucesso nem falha.
  if (caso.chegada === null) {
    silenciosos += 1;
    if (r.classificacao === "aceite" || r.classificacao === "recusado") silenciososPromovidos += 1;
  } else if (r.motivo === "desfecho_ilegivel") {
    ilegiveis += 1;
    if (r.classificacao === "aceite" || r.classificacao === "recusado") ilegiveisPromovidos += 1;
  }

  linhas.push(
    JSON.stringify({
      bateria: "desfecho",
      caso: caso.nome,
      classificacao: r.classificacao,
      motivo: r.motivo,
      motivo_do_contrato: r.motivo_do_contrato,
      estado_da_posicao: r.estado_da_posicao,
      marca: r.marca_a_gravar,
      avisa: r.avisa,
      ok: contexto.length === 0,
    }),
  );
}

// ---------------------------------------------------------------- reconciliacao

console.log("\n=== bateria da reconciliacao (a unica saida do desconhecido) ===\n");
const bateriaReconciliacao = ler("reconciliacao.casos.json");

for (const caso of bateriaReconciliacao.casos) {
  const instrumento: string = caso.instrumento ?? bateriaReconciliacao.padrao.instrumento;
  const cfg = config(caso.config ?? bateriaReconciliacao.padrao.config);
  let marcas: Marcas = marcarDesconhecido(marcasVazias(), bateriaReconciliacao.padrao.marca_inicial);

  let resultado: any;
  if (caso.operacao === "reset") {
    // O reset reinicia sem mexer em nada (FR-005): a marca tem de continuar la. Se este caso passasse
    // com a marca limpa, o reset seria a porta por onde uma posicao orfa entra sem ninguem dar por ela.
    marcas = reset(marcas);
    resultado = {
      estado_da_posicao: "desconhecida",
      marca_permanece: marcas.desconhecido.length > 0,
      motivo: "reset_nao_toca_em_nada",
      avisa: false,
    };
  } else {
    const r = reconciliar(marcas, instrumento, caso.veredicto as Veredicto, caso.evidencia, cfg);
    marcas = r.marcas;
    resultado = r.resultado;
  }

  const contexto = [
    desencontro(resultado.estado_da_posicao === caso.estado_da_posicao_esperado, `estado_da_posicao: esperado '${caso.estado_da_posicao_esperado}', obtido '${resultado.estado_da_posicao}'`),
    desencontro(resultado.marca_permanece === caso.marca_permanece_esperado, `marca_permanece: esperado ${caso.marca_permanece_esperado}, obtido ${resultado.marca_permanece}`),
    desencontro(resultado.motivo === caso.motivo_esperado, `motivo: esperado '${caso.motivo_esperado}', obtido '${resultado.motivo}'`),
    desencontro(resultado.avisa === caso.avisa_esperado, `avisa: esperado ${caso.avisa_esperado}, obtido ${resultado.avisa}`),
    desencontro(marcas.desconhecido.length === caso.marcas_restantes_esperadas, `marcas restantes: esperadas ${caso.marcas_restantes_esperadas}, obtidas ${marcas.desconhecido.length}`),
  ].filter((x): x is string => x !== null);
  exigir(contexto.length === 0, `reconciliacao/${caso.nome}`, contexto);

  linhas.push(
    JSON.stringify({
      bateria: "reconciliacao",
      caso: caso.nome,
      veredicto: caso.operacao === "reset" ? "reset" : caso.veredicto,
      estado_da_posicao: resultado.estado_da_posicao,
      marca_permanece: resultado.marca_permanece,
      motivo: resultado.motivo,
      avisa: resultado.avisa,
      marcas_restantes: marcas.desconhecido.map((d) => d.instrumento),
      ok: contexto.length === 0,
    }),
  );
}

// ---------------------------------------------------------------- criterios

console.log("\n=== criterios de sucesso ===\n");
exigir(aberturasForaDeNormal === 0, `SC-002: ${aberturasForaDeNormal} decisoes de abrir fora de 'normal' (tem de ser 0)`);
exigir(comDadoVelhoAbriu === 0, `SC-003 (lado A): ${comDadoVelhoAbriu} aberturas com dado velho (tem de ser 0)`);
exigir(
  comDadoVelhoPediuFechar > 0 && comDadoVelhoFechou === comDadoVelhoPediuFechar,
  `SC-003 (lado B): ${comDadoVelhoFechou} de ${comDadoVelhoPediuFechar} pedidos legitimos de fechar com dado velho foram permitidos`,
);
exigir(
  silenciososPromovidos === 0 && ilegiveisPromovidos === 0,
  `SC-004: 0 de ${silenciosos} silencios e 0 de ${ilegiveis} confirmacoes ilegiveis viraram aceite/recusado`,
);
exigir(
  aberturasComDesconhecido === 0 && tentativasComDesconhecido > 0,
  `SC-005: 0 de ${tentativasComDesconhecido} tentativas de abrir com a marca desconhecido passaram`,
);

// Os dois vocabularios, conferidos um contra o outro. Sem isto, um motivo inventado no codigo (foi o
// caso de `reset_nao_toca_em_nada`, que nao existia no livro) passaria como se fosse do vocabulario.
const resultados = linhas.map((l) => JSON.parse(l));
const motivosDaMesa = [...new Set(resultados.map((r: any) => r.motivo).filter(Boolean))] as string[];
const desconhecidos = motivosDaMesa.filter((m) => !motivoConhecido(m));
exigir(
  desconhecidos.length === 0,
  `os ${motivosDaMesa.length} motivos da mesa que a bateria produziu constam todos do livro (core/estados/motivos.json)`,
  desconhecidos.map((m) => `motivo inventado: '${m}'`),
);

const vocabularioDoContrato = JSON.parse(
  readFileSync(join(RAIZ_DO_REPO, "contracts", "vocabulario.json"), "utf8"),
).motivos as Record<string, unknown>;
const motivosDoContrato = [
  ...new Set(resultados.map((r: any) => r.motivo_do_contrato).filter(Boolean)),
] as string[];
const foraDoContrato = motivosDoContrato.filter((m) => !(m in vocabularioDoContrato));
exigir(
  foraDoContrato.length === 0,
  `os ${motivosDoContrato.length} motivos do CONTRATO citados pela bateria constam do vocabulario (contracts/vocabulario.json)`,
  foraDoContrato.map((m) => `motivo inventado: '${m}'`),
);

// ------------------------------------------------------- accoes por motivo (T065, fase 10)
//
// A tabela substituiu o contador de invalidos seguidos: o que decide a mesa quando algo corre mal e o
// MOTIVO, nao quantas vezes. Aqui conferem-se as duas direcoes, o par de controle e a regra estrutural
// com prova negativa.

const livroDaMesa = JSON.parse(
  readFileSync(join(RAIZ_DO_REPO, "core", "estados", "motivos.json"), "utf8"),
).motivos as Record<string, unknown>;
const defeitosDaTabela = conferirAccoes(
  tabelaDeAccoes,
  Object.keys(vocabularioDoContrato),
  Object.keys(livroDaMesa),
);
exigir(
  defeitosDaTabela.length === 0,
  `a tabela cobre os ${Object.keys(vocabularioDoContrato).length} motivos do contrato e os ` +
    `${tabelaDeAccoes.motivos_de_falha.length} motivos de falha declarados, sem nome inventado`,
  defeitosDaTabela,
);

// O par de controle: dois erros que o CONTADOR nao distinguia, e a tabela distingue.
const semResposta = accaoPara("sem_confirmacao_dentro_do_prazo");
const confirmadoInexistente = accaoPara("reconciliacao_decidiu_inexistente");
exigir(
  semResposta.accao === "parar_e_reconciliar" && confirmadoInexistente.accao === "repetir_com_atraso",
  "o par que o contador nao distinguia: prazo em silencio NAO se repete (pode ter entrado); " +
    "inexistente confirmado pela reconciliacao PODE (sabe-se que nada saiu)",
);

// A prova negativa: autorizar repeticao onde nao se sabe que nada saiu tem de ser apanhado. Sem esta
// prova, a conferencia podia estar a dizer "confere" sem olhar para a regra que evita a segunda posicao.
const tabelaTorta = {
  ...tabelaDeAccoes,
  por_motivo: {
    ...tabelaDeAccoes.por_motivo,
    sem_confirmacao_dentro_do_prazo: { ...semResposta, accao: "repetir_com_atraso" as const },
  },
};
exigir(
  conferirAccoes(tabelaTorta, Object.keys(vocabularioDoContrato), Object.keys(livroDaMesa)).some((d) =>
    d.includes("repeticao autorizada"),
  ),
  "a prova negativa: repetir sem se saber que nada saiu e recusado pela conferencia da tabela",
);

console.log("");
console.log(
  `resumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ` +
    `${bateriaCondicoes.casos.length} casos de condicao · ${bateriaCiclo.casos.length} de ciclo · ` +
    `${bateriaDesfecho.casos.length} de desfecho · ${bateriaReconciliacao.casos.length} de reconciliacao`,
);

if (args.includes("--jsonl")) {
  const saida = args[args.indexOf("--jsonl") + 1] as string;
  writeFileSync(saida, linhas.join("\n") + "\n");
  console.log(`relatorio: ${saida}`);
}

process.exit(divergentes === 0 ? 0 : 1);
