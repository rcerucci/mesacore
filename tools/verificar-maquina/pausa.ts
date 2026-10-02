// O runner da US6 e US7: a pausa que defende, e o pedido ignorado que nao paralisa.
//
// Mede o SC-008 (com a mesa pausada: ZERO aberturas, e o CB a disparar na mesma) e o SC-009 (em
// `encerrando` sem resposta, a mesa volta a operar com o `stop` PENDENTE - zero casos em que fica parada a
// espera).
//
// O caso `retomar` usa a Mesa a serio, com um ficheiro de marcas proprio: retomar nao pode ser comecar de
// novo, e isso ve-se no ficheiro - que tem de sair igual ao que entrou.

// A BARRA DO SINAL (contrato 1.8.0): a proposta diz de que barra e' e a mesa so' age na que acabou de
// fechar. As bancadas declaram-na aqui, como UM numero so', e o caso que quiser exercitar a barra
// errada declara a sua propria `barra_ms` na proposta.
const BARRA_DO_SINAL = 1730001600000;
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { conferirCB } from "../../core/ciclo/cb.ts";
import { decidirInstrumento } from "../../core/ciclo/ciclo.ts";
import { correrPedidoDeParada } from "../../core/ciclo/encerramento.ts";
import { lerParaOCiclo } from "../../core/leitura/fixtures.ts";
import { marcarDesconhecido, marcasVazias, gravarMarcas, lerMarcas } from "../../core/estado/marcas.ts";
import { Mesa } from "../../core/mesa.ts";
import { motivoConhecido } from "../../core/livro-de-motivos.ts";
import type { ConfiguracaoDaConta } from "../../core/config/configuracao.ts";
import { RAIZ_DO_REPO } from "./inventario-do-arranque.ts";

/** Um valor que o caso TEM de declarar. Ausente = recusa: as bancadas declaram o que testam (nao ha omissao). */
function exigirDeclarado<T>(v: T | undefined, oQue: string): T {
  if (v === undefined) {
    throw new Error(`a bancada nao declarou ${oQue}: sem isso o caso nao diz o que esta' a testar`);
  }
  return v;
}


const args = process.argv.slice(2);
const bateria = JSON.parse(readFileSync(join(RAIZ_DO_REPO, "core", "ciclo", "pausa.casos.json"), "utf8")) as any;
const padrao = bateria.padrao;

let verificacoes = 0;
let divergentes = 0;
const linhas: string[] = [];
const motivosUsados = new Set<string>();

function exigir(condicao: boolean, texto: string, contexto: string[] = []): void {
  verificacoes += 1;
  if (condicao) console.log(`ok    ${texto}`);
  else {
    divergentes += 1;
    console.log(`FALHA ${texto}`);
    for (const c of contexto) console.log(`        ${c}`);
  }
}

function fundir(base: any, mudanca: any): any {
  const saida: any = { ...(base ?? {}) };
  if (mudanca === undefined || mudanca === null) return saida;
  for (const [k, v] of Object.entries(mudanca)) {
    saida[k] =
      v !== null && typeof v === "object" && !Array.isArray(v) && typeof saida[k] === "object"
        ? fundir(saida[k] ?? {}, v)
        : v;
  }
  return saida;
}

// ---------------------------------------------------------------- US6

console.log("=== US6: a mesa pausada continua a defender ===\n");

let tentativasDeAbrirEmPausa = 0;
let aberturasEmPausa = 0;
let casosDeCBEmPausa = 0;
let cbsQueDispararamEmPausa = 0;

for (const caso of bateria.casos_us6) {
  const config = fundir(padrao.config, caso.config_mudanca) as ConfiguracaoDaConta;

  if (caso.retomar === true) {
    // A Mesa a serio, com um ficheiro de marcas proprio: retomar nao pode deixar cair nada.
    const caminho = `${process.env.TMPDIR ?? "/tmp"}/mesacore-retomar-${process.pid}.json`;
    let m = marcasVazias();
    m = marcarDesconhecido(m, {
      instrumento: "EURUSD",
      motivo: "sem_confirmacao_dentro_do_prazo",
      instante_ms: 1790628000000,
      referencia_do_cliente: "mesa-3232-000030",
    });
    m = { ...m, sessao: padrao.sessao, pedidos: [{ verbo: "stop", instante_ms: 1790628000000, motivo: "stop_pendente_por_prazo" }] };
    gravarMarcas(m, caminho);
    const antes = readFileSync(caminho, "utf8");

    const mesa = new Mesa({ caminhoDasMarcas: caminho, caminhoDoRegisto: `${caminho}.registo` });
    const ctx = { instante_ms: 1790628000000, inibicao_cb: false, portas_do_arranque: { passam: true } };
    const aLigar = mesa.receber({ verbo: "start", autor: "dono", pedido_id: "p-0" }, ctx);
    const aPausar = mesa.receber({ verbo: "pause", autor: "dono", pedido_id: "p-1" }, ctx);
    const r = mesa.receber({ verbo: "start", autor: "dono", pedido_id: "p-2" }, ctx);
    const depois = readFileSync(caminho, "utf8");
    const relidas = lerMarcas(caminho);

    exigir(
      aLigar.estado_novo === "em_operacao" && aPausar.estado_novo === "pausada" && r.estado_novo === "em_operacao",
      "US6/retomar: operar, pausar e depois retomar volta a em_operacao",
      [`obtido: start→${aLigar.estado_novo}/${aLigar.resultado}, pause→${aPausar.estado_novo}/${aPausar.resultado}, start→${r.estado_novo}/${r.resultado} (${r.motivo})`],
    );
    exigir(
      depois === antes,
      "US6/retomar: as marcas ficaram IGUAIS (retomar nao reinicia contadores nem esquece marcas)",
      [],
    );
    exigir(
      relidas.desconhecido.length === 1 && relidas.pedidos.length === 1 && relidas.sessao !== null,
      "US6/retomar: a marca de desconhecido, o pedido pendente e a sessao continuam la",
      [],
    );
    rmSync(caminho, { force: true });
    linhas.push(JSON.stringify({ caso: caso.nome, estado_apos_retomar: r.estado_novo, marcas_iguais: depois === antes, ok: true }));
    continue;
  }

  const entradas = lerParaOCiclo(caso.leitura, caso.proposta === null ? null : { setup: padrao.proposta_setup, barra_ms: BARRA_DO_SINAL, ...caso.proposta }, caso.ciclo ?? padrao.ciclo);
  const decisao = decidirInstrumento({
    mercado: entradas.mercado,
    proposta: entradas.proposta,
    proposta_invalida: entradas.proposta_invalida,
    motivo_do_contrato: entradas.motivo_do_contrato,
    barra_do_sinal_esperada: caso.barra_do_sinal_esperada ?? BARRA_DO_SINAL,
    ficha: caso.ficha ?? padrao.ficha,
    ciclo: caso.ciclo ?? padrao.ciclo,
    ligacao: caso.ligacao ?? padrao.ligacao ?? "ligada",
    mandato: padrao.mandato,
    template: padrao.template,
    marcas_nossas_conhecidas: caso.marcas_nossas_conhecidas ?? padrao.marcas_nossas_conhecidas,
    config,
    desconhecido: null,
    mesa_pausada: caso.mesa_pausada === true,
    falhas: caso.falhas ?? {},
    divergente: caso.divergente === true,

  });
  const d = caso.decisao_esperada;

  if (["buy", "sell"].includes(caso.proposta?.lado ?? "") && caso.mesa_pausada === true) {
    tentativasDeAbrirEmPausa += 1;
    if (decisao.acao === "abrir") aberturasEmPausa += 1;
  }

  // O CB, com a mesa declarada pausada - e nada disto lhe chega (FR-040).
  let cbTexto = "";
  if (caso.cb !== undefined) {
    const cb = conferirCB({ equity: caso.cb.equity }, padrao.sessao, config);
    casosDeCBEmPausa += 1;
    if (cb.disparou) cbsQueDispararamEmPausa += 1;
    cbTexto = `${cb.disparou}/${cb.deficit}`;
    exigir(
      cb.disparou === caso.cb.disparou_esperado && cb.deficit === caso.cb.deficit_esperado,
      `US6/${caso.nome}: o CB dispara com a mesa pausada (${cbTexto})`,
      [`esperado ${caso.cb.disparou_esperado}/${caso.cb.deficit_esperado}`],
    );
  }

  const contexto = [
    decisao.acao === d.acao ? null : `acao: esperada '${d.acao}', obtida '${decisao.acao}'`,
    (decisao.motivo ?? null) === d.motivo ? null : `motivo: esperado '${d.motivo}', obtido '${decisao.motivo}'`,
    decisao.condicao === d.condicao ? null : `condicao: esperada '${d.condicao}', obtida '${decisao.condicao}'`,
    decisao.avisa === d.avisa ? null : `avisa: esperado ${d.avisa}, obtido ${decisao.avisa}`,
    d.boleta === undefined
      ? decisao.boleta === null ? null : "boleta: nao esperada, e houve uma"
      : decisao.boleta === null
        ? "boleta: esperada, e nao houve nenhuma"
        : Object.entries(d.boleta).every(([c, v]) => JSON.stringify((decisao.boleta as any)[c]) === JSON.stringify(v))
          ? null
          : "boleta: um campo nao bate",
  ].filter((x): x is string => x !== null);
  exigir(contexto.length === 0, `US6/${caso.nome}`, contexto);
  if (decisao.motivo) motivosUsados.add(decisao.motivo);

  linhas.push(
    JSON.stringify({ caso: caso.nome, acao: decisao.acao, motivo: decisao.motivo, condicao: decisao.condicao, avisa: decisao.avisa, cb: cbTexto, ok: contexto.length === 0 }),
  );
}

// Estrutural: nao existe "cancelar" no conjunto de accoes - uma ordem viva desconhecida adopta-se e
// reconcilia-se, nunca se cancela por iniciativa da mesa (FR-021).
//
// A LISTA NAO SE ESCREVE AQUI. Ate' a 1.10.0 esta prova era um regex com a lista literal, e teve de ser editada a
// mao quando a lista mudou — que e' exactamente o que a declaracao evita. Desde a 1.10.0 a lista vive no
// `vocabulario.json` (`acoes_da_mesa`), que e' onde o proprio ficheiro diz que os runners a leem; aqui confere-se
// nas DUAS direccoes: o codigo tem de exprimir a lista declarada (nem de menos, nem de mais), e nenhuma das duas
// pode ter um `cancelar`.
const fonteDecisao = readFileSync(join(RAIZ_DO_REPO, "core", "ciclo", "decisao.ts"), "utf8");
const acoesDeclaradas: string[] = JSON.parse(
  readFileSync(join(RAIZ_DO_REPO, "contracts", "vocabulario.json"), "utf8"),
).acoes_da_mesa;
const noCodigo = (fonteDecisao.match(/export type Acao = ([^;]+);/)?.[1] ?? "")
  .split("|")
  .map((s) => s.trim().replace(/"/g, ""))
  .filter((s) => s.length > 0);
// A procura do `cancelar` e' DENTRO da lista das accoes — e nao no ficheiro: o `Template` deste mesmo ficheiro tem
// `destino_do_resto: \"agressivo\" | \"cancelar\"`, que e' um valor legitimo (o que fazer com o que nao executou) e
// nao uma accao da mesa. Procurar no ficheiro inteiro daria uma falha falsa.
exigir(
  noCodigo.length > 0 && !noCodigo.includes("cancelar") && !acoesDeclaradas.includes("cancelar"),
  "US6/estrutural: o conjunto de accoes nao tem 'cancelar' - a mesa nao cancela o que nao reconhece",
  ["o conjunto de accoes ganhou um 'cancelar': ha agora um caminho para mexer no que a mesa nao reconhece"],
);
exigir(
  noCodigo.length === acoesDeclaradas.length && noCodigo.every((a, i) => a === acoesDeclaradas[i]),
  "US6/estrutural: o tipo `Acao` do codigo e' a lista declarada no vocabulario (`acoes_da_mesa`)",
  [`codigo=[${noCodigo.join(", ")}] vocabulario=[${acoesDeclaradas.join(", ")}]`],
);

// ---------------------------------------------------------------- US7

console.log("\n=== US7: um pedido ignorado nao paralisa a mesa ===\n");

let semResposta = 0;
let voltaramAOperar = 0;

for (const caso of bateria.casos_us7) {
  const config = fundir(padrao.config, caso.config_mudanca) as ConfiguracaoDaConta;

  // O caso `cd` de proposito: a lista do dono com um nome invalido tem de fazer GRITAR, e nao de avisar
  // menos. E a mesma regra do conjunto fechado dos eventos.
  let r: any = null;
  let gritou = false;
  try {
    r = correrPedidoDeParada(marcasVazias(), caso.pedido, caso.posicao_viva, null, config);
  } catch (e) {
    gritou = true;
  }
  if (caso.nome.includes("pedir-o-aviso")) {
    exigir(gritou, `US7/${caso.nome}: a lista com um nome invalido ('cd') GRITA em vez de avisar menos`, []);
    continue;
  }

  const contexto = [
    r.estado === caso.estado_esperado ? null : `estado: esperado '${caso.estado_esperado}', obtido '${r.estado}'`,
    r.motivo === caso.motivo_esperado ? null : `motivo: esperado '${caso.motivo_esperado}', obtido '${r.motivo}'`,
    r.avisa === caso.avisa_esperado ? null : `avisa: esperado ${caso.avisa_esperado}, obtido ${r.avisa}`,
    r.pedido_pendente === caso.pedido_pendente_esperado ? null : `pedido_pendente: esperado ${caso.pedido_pendente_esperado}, obtido ${r.pedido_pendente}`,
    caso.posicao_sem_defesa_esperado === undefined || r.resumo.posicao_sem_defesa === caso.posicao_sem_defesa_esperado
      ? null
      : `posicao_sem_defesa: esperado ${caso.posicao_sem_defesa_esperado}, obtido ${r.resumo.posicao_sem_defesa}`,
    caso.aviso_de_manter_esperado === undefined || (r.resumo.aviso_de_manter !== null) === caso.aviso_de_manter_esperado
      ? null
      : `aviso_de_manter: esperado ${caso.aviso_de_manter_esperado}, obtido ${r.resumo.aviso_de_manter !== null}`,
  ].filter((x): x is string => x !== null);

  // O stop tem de estar ARQUIVADO nas marcas, e nao apenas dito no motivo.
  if (caso.pedido_pendente_esperado === true) {
    if (r.marcas.pedidos.length !== 1 || r.marcas.pedidos[0].motivo !== "stop_pendente_por_prazo") {
      contexto.push(`o pedido pendente nao ficou arquivado nas marcas: ${JSON.stringify(r.marcas.pedidos)}`);
    }
  }

  if (caso.pedido.resposta === null && r.estado === "em_operacao") {
    semResposta += 1;
    if (r.estado === "em_operacao") voltaramAOperar += 1;
  }
  if (r.motivo) motivosUsados.add(r.motivo);

  exigir(contexto.length === 0, `US7/${caso.nome}`, contexto);

  // "Volta ao normal" so conta se a mesma proposta voltar a abrir.
  if (caso.e_continua_a_abrir !== undefined) {
    const entradas = lerParaOCiclo(
      { instrumento: "EURUSD", idade_do_dado_ms: 100, estado_do_mercado: "aberto" , ordens_abertas: [] },
      { setup: padrao.proposta_setup, barra_ms: BARRA_DO_SINAL, lado: caso.e_continua_a_abrir.lado },
      50,
    );
    const decisao = decidirInstrumento({
      mercado: entradas.mercado, proposta: entradas.proposta,
      proposta_invalida: false, motivo_do_contrato: null,
      barra_do_sinal_esperada: BARRA_DO_SINAL,
      ficha: padrao.ficha, ciclo: 50,
      ligacao: "ligada",
      mandato: padrao.mandato, template: padrao.template,
      marcas_nossas_conhecidas: padrao.marcas_nossas_conhecidas,
      config, desconhecido: null,
      mesa_pausada: false,
      falhas: {}, divergente: false,

    });
    exigir(
      decisao.acao === caso.e_continua_a_abrir.acao_esperada,
      `US7/${caso.nome}: depois de voltar, a mesma proposta ABRE (a mesa nao ficou congelada)`,
      [`acao obtida: ${decisao.acao} (motivo ${decisao.motivo})`],
    );
  }

  linhas.push(JSON.stringify({ caso: caso.nome, estado: r.estado, motivo: r.motivo, avisa: r.avisa, pedido_pendente: r.pedido_pendente, posicao_sem_defesa: r.resumo.posicao_sem_defesa, ok: contexto.length === 0 }));
}

const inventados = [...motivosUsados].filter((m) => !motivoConhecido(m));
exigir(
  inventados.length === 0,
  `os ${motivosUsados.size} motivos usados pela bateria constam todos do livro (core/estados/motivos.json)`,
  inventados.map((m) => `motivo inventado: '${m}'`),
);

console.log("\n=== criterios de sucesso ===\n");
exigir(
  aberturasEmPausa === 0 && tentativasDeAbrirEmPausa > 0,
  `SC-008 (lado A): ${aberturasEmPausa} de ${tentativasDeAbrirEmPausa} tentativas de abrir com a mesa pausada passaram (tem de ser 0)`,
);
exigir(
  cbsQueDispararamEmPausa === casosDeCBEmPausa && casosDeCBEmPausa > 0,
  `SC-008 (lado B): ${cbsQueDispararamEmPausa} de ${casosDeCBEmPausa} casos com a mesa pausada dispararam o CB`,
);
exigir(
  voltaramAOperar === semResposta && semResposta > 0,
  `SC-009: ${voltaramAOperar} de ${semResposta} casos em 'encerrando' sem resposta voltaram a operacao com o stop pendente`,
);

console.log("");
console.log(`resumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ${bateria.casos_us6.length} casos US6 · ${bateria.casos_us7.length} casos US7`);

if (args.includes("--jsonl")) {
  const saida = args[args.indexOf("--jsonl") + 1] as string;
  writeFileSync(saida, linhas.join("\n") + "\n");
  console.log(`relatorio: ${saida}`);
}

process.exit(divergentes === 0 ? 0 : 1);
