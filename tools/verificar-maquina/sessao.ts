// O runner da US5: a sessao como unidade de comparacao.
//
// Vive em /tools pelo mesmo motivo do runner do arranque: precisa do `arrancar()` do core (para o
// SC-007: depois do CB, o start tem de recusar) e da porta do inventario, que corre um processo.
//
// Mede o SC-007 nas duas metades, e a segunda e a que costuma faltar: nao basta o CB travar o start -
// 100% das sessoes novas tem de GRAVAR a configuracao em vigor antes de a mesa voltar a operar.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arrancar } from "../../core/ciclo/arranque.ts";
import { conferirCB, encadeamentoDoDisparo } from "../../core/ciclo/cb.ts";
import { novaSessao, trocarConfiguracao } from "../../core/estado/sessao.ts";
import { marcarInibicao, type Marcas } from "../../core/estado/marcas.ts";
import type { ConfiguracaoDaConta } from "../../core/config/configuracao.ts";
import { motivoConhecido } from "../../core/livro-de-motivos.ts";
import { inventarioASerio, RAIZ_DO_REPO } from "./inventario-do-arranque.ts";

const args = process.argv.slice(2);
const bateria = JSON.parse(readFileSync(join(RAIZ_DO_REPO, "core", "ciclo", "sessao.casos.json"), "utf8")) as any;
const manifesto = JSON.parse(
  readFileSync(join(RAIZ_DO_REPO, "core", "ciclo", "arranque.casos.json"), "utf8"),
).manifesto_fixture;
const manifestoDoFixture = JSON.parse(readFileSync(join(RAIZ_DO_REPO, manifesto), "utf8")).carga;

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

console.log("=== bateria da sessao: o CB por sessao, a inibicao e a sessao nova ===\n");

let disparos = 0;
let pedidosDeStartAposCB = 0;
let startsAceitesAposCB = 0;
let sessoesNovas = 0;
let sessoesNovasComConfiguracaoEmVigor = 0;
let mesaPausadaDisparou = 0;
let mesaPausadaCasos = 0;

for (const caso of bateria.casos) {
  const config = fundir(bateria.padrao.config, caso.config_mudanca) as ConfiguracaoDaConta;
  let marcas = fundir(bateria.padrao.marcas, caso.marcas_mudanca) as Marcas;
  const sessao = marcas.sessao;

  // --- o CB
  let cb: any = null;
  let gritou = false;
  let mensagemDeGrito = "";
  try {
    cb = conferirCB(
      { equity: caso.equity, ...(caso.equity_de_abertura_do_dia ? { equity_de_abertura_do_dia: caso.equity_de_abertura_do_dia } : {}) },
      sessao,
      config,
    );
  } catch (e) {
    gritou = true;
    mensagemDeGrito = (e as Error).message.slice(0, 120);
  }

  if (sessao === null) {
    // Sem sessao nao ha unidade de comparacao: o CB tem de gritar, e nao de dizer que esta tudo bem.
    exigir(gritou, `sessao/${caso.nome}: sem sessao em curso o CB GRITA em vez de medir`, [mensagemDeGrito]);
  } else if (caso.grita_esperado === true && caso.sessao_nova === undefined) {
    exigir(gritou, `sessao/${caso.nome}: GRITA em vez de medir sem base`, [mensagemDeGrito]);
  } else {
    const contexto = [
      cb.disparou === caso.disparou_esperado ? null : `disparou: esperado ${caso.disparou_esperado}, obtido ${cb.disparou}`,
      cb.deficit === caso.deficit_esperado ? null : `deficit: esperado '${caso.deficit_esperado}', obtido '${cb.deficit}'`,
      cb.avisa === caso.avisa_esperado ? null : `avisa: esperado ${caso.avisa_esperado}, obtido ${cb.avisa}`,
      encadeamentoDoDisparo(cb.disparou).join(",") === caso.encadeamento_esperado.join(",")
        ? null
        : `encadeamento: esperado [${caso.encadeamento_esperado.join(", ")}], obtido [${encadeamentoDoDisparo(cb.disparou).join(", ")}]`,
    ].filter((x): x is string => x !== null);
    exigir(contexto.length === 0, `sessao/${caso.nome}`, contexto);

    if (cb.disparou) {
      disparos += 1;
      if (cb.motivo) motivosUsados.add(cb.motivo);
      // O encadeamento tem de terminar por mostrar a inibicao marcada.
      marcas = marcarInibicao(marcas, {
        motivo: cb.motivo ?? "cb_disparou_no_ciclo",
        instante_ms: 1790628030000,
        perda_medida: cb.deficit,
      });
    }
    if (caso.mesa === "pausada") {
      mesaPausadaCasos += 1;
      if (cb.disparou) mesaPausadaDisparou += 1;
    }
  }

  // --- FR-040, provado na FONTE: o CB nao tem por onde saber o estado da mesa.
  if (caso.mesa === "pausada") {
    // Olha-se para o CODIGO, nao para os comentarios: o cabecalho do cb.ts fala da pausa (explica porque
    // e que o estado nao entra), e um conferidor que lesse comentarios acusaria a propria explicacao.
    const fonte = readFileSync(join(RAIZ_DO_REPO, "core", "ciclo", "cb.ts"), "utf8")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    const olhaParaOEstado = /pausada|em_operacao|encerrando|estado_da_mesa/.test(fonte);
    exigir(
      !olhaParaOEstado,
      `FR-040/${caso.nome}: o CB nao menciona o estado da mesa em sítio nenhum do seu codigo`,
      ["o CB passou a conhecer o estado da mesa: a pausa passou a poder silencia-lo"],
    );
    // Prova negativa do proprio conferidor: a mesma regex, sobre um texto que menciona a pausa, tem de
    // acusar. Sem isto, a verificacao acima podia estar a olhar para o lado errado.
    exigir(
      /pausada|em_operacao|encerrando|estado_da_mesa/.test("if (mesa === 'pausada') return null;"),
      `FR-040/${caso.nome}: prova negativa do conferidor (um texto que olha para a pausa e acusado)`,
    );
  }

  // --- o que vem depois do disparo
  if (caso.depois === "start") {
    pedidosDeStartAposCB += 1;
    const r = arrancar({
      manifesto: manifestoDoFixture,
      config,
      marcas,
      registo_retomavel: true,
      // Os conectores: a configuracao desta bateria declara `mock_conector`, e quem os poe de pe e o vigia.
      // Aqui o que se prova e a sessao, nao a ligacao - por isso o duble de conector entra por DADO.
      conectores_de_pe: ["mock_conector"],
      portaDoInventario: inventarioASerio,
    });
    if (r.arrancou) startsAceitesAposCB += 1;
    const e = caso.start_esperado;
    const contexto = [
      r.arrancou === e.arrancou ? null : `arrancou: esperado ${e.arrancou}, obtido ${r.arrancou}`,
      r.estado === e.estado ? null : `estado: esperado '${e.estado}', obtido '${r.estado}'`,
      r.porta === e.porta ? null : `porta: esperada '${e.porta}', obtida '${r.porta}'`,
      r.motivo === e.motivo ? null : `motivo: esperado '${e.motivo}', obtido '${r.motivo}'`,
    ].filter((x): x is string => x !== null);
    exigir(contexto.length === 0, `SC-007/${caso.nome}: o start recusa com a inibicao marcada`, contexto);
    if (r.motivo) motivosUsados.add(r.motivo);
  }

  if (caso.depois === "nova_sessao" || caso.sessao_nova !== undefined) {
    const pedido: any = caso.depois === "nova_sessao" ? caso.sessao_nova : caso.sessao_nova;
    if (caso.grita_esperado === true) {
      let gritouNaSessao = false;
      let msg = "";
      try {
        novaSessao(marcas, pedido);
      } catch (e) {
        gritouNaSessao = true;
        msg = (e as Error).message.slice(0, 110);
      }
      exigir(gritouNaSessao, `sessao/${caso.nome}: uma sessao sem ficha em vigor GRITA`, [msg]);
    } else {
      const r = novaSessao(marcas, pedido);
      marcas = r.marcas;
      sessoesNovas += 1;
      if (r.motivo) motivosUsados.add(r.motivo);

      const emVigor = marcas.sessao?.configuracao_em_vigor;
      const gravou =
        emVigor !== undefined &&
        emVigor.ficha === pedido.configuracao_em_vigor.ficha &&
        emVigor.versao_do_setup === pedido.configuracao_em_vigor.versao_do_setup &&
        emVigor.versao_do_mandato === pedido.configuracao_em_vigor.versao_do_mandato &&
        marcas.sessao?.equity_de_partida === pedido.equity_de_partida &&
        typeof marcas.sessao?.autor === "string" &&
        typeof marcas.sessao?.motivo === "string" &&
        typeof marcas.sessao?.instante_ms === "number";
      if (gravou) sessoesNovasComConfiguracaoEmVigor += 1;
      exigir(gravou, `SC-007/${caso.nome}: a sessao nova gravou instante, equity, autor, motivo e configuracao em vigor`, []);
      exigir(r.inibicao_levantada === true && marcas.inibicao_cb === null, `SC-007/${caso.nome}: a sessao nova levantou a inibicao`, []);

      // E so depois disto a mesa volta a operar.
      const a = arrancar({
        manifesto: manifestoDoFixture,
        config,
        marcas,
        registo_retomavel: true,
        conectores_de_pe: ["mock_conector"],
        portaDoInventario: inventarioASerio,
      });
      exigir(a.arrancou === true, `SC-007/${caso.nome}: depois da sessao nova a mesa volta a arrancar`, [a.porque]);
    }
  }

  if (caso.troca !== undefined) {
    const antes = JSON.stringify(marcas);
    const r = trocarConfiguracao(marcas, caso.troca);
    if (r.motivo) motivosUsados.add(r.motivo);
    const e = caso.troca_esperada;
    const contexto = [
      r.aceite === e.aceite ? null : `aceite: esperado ${e.aceite}, obtido ${r.aceite}`,
      r.motivo === e.motivo ? null : `motivo: esperado '${e.motivo}', obtido '${r.motivo}'`,
      JSON.stringify(r.marcas) === antes ? null : "a troca mexeu nas marcas (uma recusa nao muda nada)",
    ].filter((x): x is string => x !== null);
    exigir(contexto.length === 0, `sessao/${caso.nome}`, contexto);
    marcas = r.marcas;
  }

  linhas.push(
    JSON.stringify({
      caso: caso.nome,
      disparou: cb?.disparou,
      deficit: cb?.deficit,
      janela: cb?.janela,
      avisa: cb?.avisa,
      encadeamento: cb ? encadeamentoDoDisparo(cb.disparou) : [],
      gritou,
      mesa: caso.mesa ?? "em_operacao",
      ok: true,
    }),
  );
}

// --- os motivos, conferidos contra o livro (a licao da US3: motivo inventado no codigo nao passa)
const inventados = [...motivosUsados].filter((m) => !motivoConhecido(m));
exigir(
  inventados.length === 0,
  `os ${motivosUsados.size} motivos usados pela bateria constam todos do livro (core/estados/motivos.json)`,
  inventados.map((m) => `motivo inventado: '${m}'`),
);

console.log("\n=== criterios de sucesso ===\n");
exigir(startsAceitesAposCB === 0 && pedidosDeStartAposCB > 0, `SC-007 (lado A): ${startsAceitesAposCB} de ${pedidosDeStartAposCB} starts aceites depois do CB (tem de ser 0)`);
exigir(
  sessoesNovasComConfiguracaoEmVigor === sessoesNovas && sessoesNovas > 0,
  `SC-007 (lado B): ${sessoesNovasComConfiguracaoEmVigor} de ${sessoesNovas} sessoes novas gravaram a configuracao em vigor`,
);
exigir(
  mesaPausadaDisparou === mesaPausadaCasos && mesaPausadaCasos > 0,
  `SC-008 (lado do CB): ${mesaPausadaDisparou} de ${mesaPausadaCasos} casos com a mesa pausada dispararam`,
);

console.log("");
console.log(`resumo: ${verificacoes} verificacoes · ${divergentes} divergentes · ${bateria.casos.length} casos · ${disparos} disparos de CB`);

if (args.includes("--jsonl")) {
  const saida = args[args.indexOf("--jsonl") + 1] as string;
  writeFileSync(saida, linhas.join("\n") + "\n");
  console.log(`relatorio: ${saida}`);
}

process.exit(divergentes === 0 ? 0 : 1);
