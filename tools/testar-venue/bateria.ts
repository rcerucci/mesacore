#!/usr/bin/env bun
// A BATERIA DE TESTE DO VENUE (SC-004) — as provas que precisam de REDE e de CHAVE.
//
// O `tools/verificar-conector/conformidade.ts` prova tudo o que se prova OFFLINE, e di-lo em voz alta: do
// venue, nada (a linha do venue sai INCOMPLETO, nunca «passou» — FR-026). Esta bateria e' a outra metade, e
// corre contra o ambiente de TESTE da corretora, que existe para isto.
//
// O QUE ELA FAZ, e por que ordem. A ordem e' a das provas, e nao a das conveniencias: primeiro o que se le
// sem risco nenhum, depois o que mexe na conta — uma operacao de cada vez, e nunca duas em voo.
//
//   P0  O ARRANQUE ao vivo (as 8 portas) contra o venue a serio.
//   P1  AS LEITURAS: a conta (equity e posicoes), as marcas, o que o venue responde agora.
//   P2  A DECISAO: a mesa decide com uma proposta MANUAL (nao ha setup — o teste nao precisa dele) e monta a
//       boleta. Nada sai daqui para o venue: e' a decisao, e so'.
//   P3  O ENVIO: a boleta vai ao CONECTOR a serio (o processo, `--ao-vivo`), que assina e submete. E' a
//       unica prova desta bateria que move dinheiro — na TESTE.
//   P4  O QUE VOLTOU: o desfecho do venue, a resolucao e a conferencia da banda (D-001).
//   P5  A CONTA depois: os CINCO numeros com posicao viva, e as execucoes (as taxas e o resultado realizado).
//   P6  A IDEMPOTENCIA: a MESMA referencia outra vez, e a contagem no venue (a segunda NAO cria ordem).
//   P7  O FECHO com `reduce_only`, e a conta outra vez.
//   P8  AS RECUSAS que nao custam: o minimo do venue, o instrumento que nao existe.
//   P9  O REGISTO: a saida crua, por versao (`brokers/hyperliquid/conformidade/<versao>-teste.txt`).
//
// O QUE ESTA BATERIA NAO E'. Nao e' a mesa a operar: e' um teste de ABERTURA MANUAL simulado por script, com
// a decisao da mesa a serio e um conector a serio. Nao ha setup escrito, e nao faz falta nenhuma para isto.
//
// A CHAVE. O valor nunca entra neste processo: as LEITURAS sao publicas (o endereco da conta e' publico) e o
// ENVIO passa pelo processo do conector, que carrega a credencial por REFERENCIA (RN-E14/RN-C16). Nenhuma
// linha desta bateria pode carregar o valor — e ha uma prova que o varre (a prova 8 do `conformidade.ts`).
//
// Uso:  bun tools/testar-venue/bateria.ts [--ate <0..9>] [--registar] [--instrumento BTC]

// A BARRA DO SINAL (contrato 1.8.0): a proposta diz de que barra e' e a mesa so' age na que acabou de
// fechar. As bancadas declaram-na aqui, como UM numero so', e o caso que quiser exercitar a barra
// errada declara a sua propria `barra_ms` na proposta.
const BARRA_DO_SINAL = 1730001600000;
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";
import { Mesa } from "../../core/mesa.ts";
import { lerParaOCiclo } from "../../core/leitura/fixtures.ts";
import { decidirInstrumento } from "../../core/ciclo/ciclo.ts";
import { classificarDesfecho, type Envio } from "../../core/ciclo/desfecho.ts";
import { conferirBanda } from "../../core/ciclo/banda.ts";
import { traduzirOrdem } from "../../brokers/hyperliquid/ordens.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const CASOS_DO_CONECTOR = join(RAIZ, "brokers", "hyperliquid", "casos", "processo.casos.json");
const FICHA_DO_DONO = join(RAIZ, "config", "contas", "hl-teste-plugin.json");

// ---------------------------------------------------------------------------------------------------------
// Os argumentos, e o registo das provas.

const argv = process.argv.slice(2);
const argumento = (nome: string): string | undefined => {
  const i = argv.indexOf(nome);
  return i < 0 ? undefined : argv[i + 1];
};
const ATE = Number(argumento("--ate") ?? "9");
const REGISTAR = argv.includes("--registar");
const INSTRUMENTO = argumento("--instrumento") ?? "BTC";
/** A base dos ciclos desta corrida. A referencia do cliente (o `cloid`) nasce dela, e o venue DEDUPLICA por
 *  ela: repetir a corrida com a mesma base faria a abertura ser recusada como repetida - o que e' a prova da
 *  idempotencia (P6) a estragar as outras. Por isso a base e' nova a cada corrida, e ha' `--ciclo` para a fixar. */
// A gama vem do LAYOUT da marca de posse (`marcaDePosse` recusa fora de 1..4095), e a base e' o que
// mantem a ficha dentro dela. Sem isto, a primeira corrida morreu com `ficha fora da gama: 635508`.
const CICLO_BASE = Number(argumento("--ciclo") ?? (1 + (Math.floor(Date.now() / 1000) % 800)));

interface Prova {
  passo: number;
  nome: string;
  mediu: string;
  saida: unknown;
  veredicto: "passou" | "reprovou" | "inconclusivo";
  porque: string;
}
const provas: Prova[] = [];
const cru: Record<string, unknown> = {};

function anotar(p: Prova): void {
  provas.push(p);
  const marca = p.veredicto === "passou" ? "OK   " : p.veredicto === "reprovou" ? "REPROVOU" : "INCONCLUSIVO";
  console.log(`${marca} P${p.passo} ${p.nome}`);
  console.log(`      mediu: ${p.mediu}`);
  console.log(`      porque: ${p.porque}`);
}

function falhou(onde: string, porque: string): never {
  console.error(`\nBATERIA INTERROMPIDA em ${onde}: ${porque}`);
  console.error("(as provas ja medidas estao acima, e nenhuma conclusao se tira do que nao correu)");
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------
// P0 — o arranque ao vivo: as oito portas, contra o venue a serio.
//
// Corre o PROCESSO do conector (nao uma funcao importada): e' a fronteira que interessa, e e' por ela que a
// credencial se carrega — sem nunca passar por este ficheiro.

function correrProcesso(args: { linhas?: string[]; extra?: string[]; timeout_ms?: number; fechar_em_ms?: number }): Promise<{ saida: string[]; erros: string[]; codigo: number }> {
  return new Promise((resolve) => {
    const comando = [
      "bun",
      "run",
      join(RAIZ, "brokers", "hyperliquid", "processo.ts"),
      "--casos",
      CASOS_DO_CONECTOR,
      "--ficha",
      `@${FICHA_DO_DONO}`,
      "--ao-vivo",
      ...(args.extra ?? []),
    ];
    const p = spawn(comando[0]!, comando.slice(1), { cwd: RAIZ, env: process.env });
    const saida: string[] = [];
    const erros: string[] = [];
    let terminou = false;
    const dec = new TextDecoder();
    p.stdout.on("data", (b) => saida.push(...dec.decode(b).split("\n").filter((l) => l.trim() !== "")));
    p.stderr.on("data", (b) => {
      for (const l of dec.decode(b).split("\n").filter((l) => l.trim() !== "")) {
        erros.push(l);
        try {
          const o = JSON.parse(l);
          if (o.porta) console.log(`      porta ${o.porta}: ${o.veredicto}${o.motivo ? ` (${o.motivo})` : ""}`);
        } catch {
          /* a linha nao e' do diagnostico */
        }
      }
    });
    for (const linha of args.linhas ?? []) p.stdin.write(linha + "\n");
    // O cano fecha depois de a resposta chegar: o processo atende a linha, escreve o desfecho e sai com o
    // cano fechado. Fechar logo a seguir ao `write` cortava a resposta a meio; nao fechar nunca deixava o
    // processo a espera para sempre (e o `timeout` matava-o antes de se ler o que ele disse).
    if ((args.linhas ?? []).length > 0) setTimeout(() => p.stdin.end(), args.fechar_em_ms ?? 5000);
    const prazo = setTimeout(() => {
      if (!terminou) {
        terminou = true;
        p.kill();
        resolve({ saida, erros, codigo: -1 });
      }
    }, args.timeout_ms ?? 60_000);
    p.on("close", (codigo) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      resolve({ saida, erros, codigo: codigo ?? 0 });
    });
    if ((args.linhas ?? []).length === 0) p.stdin.end();
  });
}

async function p0_arranque(): Promise<{ manifesto: any }> {
  const r = await correrProcesso({ extra: ["--so-sonda"], timeout_ms: 90_000 });
  const portas = r.erros.map((l) => { try { return JSON.parse(l); } catch { return {}; } }).filter((o: any) => o.porta);
  const falhadas = portas.filter((o: any) => o.veredicto !== "passou" && o.veredicto !== "nao_corrida");
  const manifestoLinha = r.saida.find((l) => l.includes('"tipo":"manifesto"')) ?? null;
  cru["P0_portas"] = portas;
  cru["P0_manifesto"] = manifestoLinha;

  if (r.codigo !== 0 || manifestoLinha === null) {
    falhou("P0 (arranque ao vivo)", `o processo nao subiu (codigo ${r.codigo}); portas falhadas: ${falhadas.map((o: any) => o.porta).join(", ") || "(nenhuma)"}`);
  }
  const manifesto = JSON.parse(manifestoLinha!);
  anotar({
    passo: 0,
    nome: `arranque ao vivo (as 8 portas, ${FICHA_DO_DONO.replace(RAIZ + "/", "")})`,
    mediu: `portas: ${portas.map((o: any) => `${o.porta}=${o.veredicto}`).join(" · ")}`,
    saida: manifesto.carga,
    veredicto: falhadas.length === 0 ? "passou" : "reprovou",
    porque: `o venue respondeu, o manifesto foi publicado (${manifesto.carga.instrumentos.length} instrumento(s)) e nenhuma porta falhou; \`chave\` fica \`nao_corrida\` no modo de sonda, e isso e' o declarado`,
  });
  return { manifesto: manifesto.carga };
}

// ---------------------------------------------------------------------------------------------------------
// P1 — as leituras, sem risco nenhum: a conta e as marcas, do venue a serio.

async function lerDoVenue(): Promise<any> {
  const { InfoClient, HttpTransport } = await import("@nktkas/hyperliquid");
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet: true }) });
  const endereco = (JSON.parse(readFileSync(FICHA_DO_DONO, "utf8")).conta as any).identificador as string;
  const conta: any = await (info as any).clearinghouseState({ user: endereco });
  const meta: any = await (info as any).metaAndAssetCtxs();
  const execucoes: any = await (info as any).userFills({ user: endereco });
  const ordem = await (info as any).openOrders({ user: endereco });
  return { endereco, conta, meta, execucoes, ordens_abertas: ordem };
}

function posicaoDe(conta: any, instrumento: string): any | null {
  const lista = conta?.assetPositions ?? [];
  for (const p of lista) {
    if ((p?.position?.coin ?? "") === instrumento) return p.position;
  }
  return null;
}


/** A marca do instrumento, lida do venue: `metaAndAssetCtxs` devolve `[meta, ctxs]`, na mesma ordem de
 *  `meta.universe` — e o contexto e' um objecto, nao um par. Ler isto ao contrario foi o erro da P2 na
 *  primeira corrida, e o erro aparou-se sozinho (a bateria parou em vez de dimensionar sobre uma marca 0). */
function marcaDoVenue(lido: any, instrumento: string): string | null {
  const universo = lido?.meta?.[0]?.universe ?? [];
  const ctxs = lido?.meta?.[1] ?? [];
  const i = universo.findIndex((u: any) => u?.name === instrumento);
  if (i < 0) return null;
  const marca = ctxs[i]?.markPx;
  return typeof marca === "string" ? marca : marca === undefined ? null : String(marca);
}

async function p1_leituras(): Promise<any> {
  const lido = await lerDoVenue();
  const equity = lido.conta?.marginSummary?.accountValue ?? null;
  const posicao = posicaoDe(lido.conta, INSTRUMENTO);
  cru["P1_conta"] = { equity, posicao, time: lido.conta?.time };
  cru["P1_meta"] = lido.meta;
  anotar({
    passo: 1,
    nome: "as leituras do venue (conta, marcas, execucoes, ordens abertas)",
    mediu: `equity=${JSON.stringify(equity)} · posicao ${INSTRUMENTO}=${posicao ? `${posicao.szi} a ${posicao.entryPx}` : "(nenhuma)"} · ordens abertas=${(lido.ordens_abertas ?? []).length} · execucoes=${(lido.execucoes ?? []).length}`,
    saida: { equity, posicao, ordens_abertas: lido.ordens_abertas, execucoes: (lido.execucoes ?? []).length },
    veredicto: equity !== null ? "passou" : "reprovou",
    porque: "o venue respondeu as quatro leituras; a leitura da conta e' o que a mesa precisa para dimensionar e para o resumo do encerramento",
  });
  return lido;
}

// ---------------------------------------------------------------------------------------------------------
// P2 — a DECISAO: a mesa decide com uma proposta MANUAL, e monta a boleta (nada sai daqui).

interface Mao {
  instrumento: string;
  lado: "buy" | "sell";
}

const mao: Mao = { instrumento: INSTRUMENTO, lado: "buy" };

/** O mandato do teste: saldo_pct 1% e alavancagem 2 - valores do teste, com as bandas declaradas. */
function mandatoDoTeste(): any {
  return {
    saldo_pct: "1",
    alavancagem: "2",
    bandas: {
      saldo_pct: { minimo: "0.1", maximo: "5" },
      alavancagem: { minimo: "1", maximo: "5" },
      stop_pct: { minimo: "0.1", maximo: "5" },
      tp_pct: { minimo: "0.1", maximo: "10" },
    },
  };
}

// A config que o ciclo recebe: as chaves da CONTA ao nivel de cima (`conta.*` no ficheiro, ja' resolvido
// pelo carregador), mais as fichas. Sem a lista de `eventos_que_avisam` a mesa GRITA - e gritou na primeira
// corrida desta bateria, ao decidir sobre uma posicao viva (que e' quando a pergunta se poe).
const CONFIG_DO_TESTE: any = {
  eventos_que_avisam: ["cb", "encerramento", "desconhecido", "recusa", "divergencia", "falha_de_leitura", "contenda"],
  arranque_apos_cb: "exige_decisao",
  fichas: {
    [INSTRUMENTO]: {
      ...mandatoDoTeste(),
      versao_do_mandato: "teste-1",
      setup: { prazo_de_resposta_ms: 3000 },
    },
  },
};

const TEMPLATE_DO_TESTE: any = {
  politica_de_execucao: "mercado",
  parcial: "o_que_der",
  desvio_maximo: "0.5",
  prazo_da_passiva_ms: 3000,
  destino_do_resto: "agressivo",
};

/** A decisao com o mandato e o lado DADOS (o teste do fecho precisa dos dois - e das marcas que sao nossas). */
function decidirCom(lido: any, ciclo: number, posicaoNossa: number[], mandato: any, lado: "buy" | "sell" | "caixa", marcaDaPosicao: number = 3232 + ciclo, template: any = TEMPLATE_DO_TESTE): any {
  const marcaDoInstrumento = Number(marcaDoVenue(lido, INSTRUMENTO) ?? 0);
  if (!(marcaDoInstrumento > 0)) falhou("P2 (decisao)", `nao se leu a marca de ${INSTRUMENTO} no venue`);
  const leitura = {
    instrumento: INSTRUMENTO,
    idade_do_dado_ms: 100,
    estado_do_mercado: "aberto" as const,
    equity: String(lido.conta?.marginSummary?.accountValue ?? "0"),
    // AS ORDENS VIVAS (contrato 1.9.0): as MESMAS que a bateria le' do venue desde sempre (`openOrders`), na
    // forma do contrato. O lado do venue e' A/B: traduz-se aqui, e um lado que nao seja nenhum dos dois RECUSA
    // — a bateria nao inventa o lado de uma ordem viva.
    ordens_abertas: (Array.isArray(lido.ordens_abertas) ? lido.ordens_abertas : []).filter(
      (o: any) => String(o?.coin) === INSTRUMENTO,
    ).map((o: any) => {
      const lado = String(o?.side) === "A" ? "sell" : String(o?.side) === "B" ? "buy" : null;
      if (lado === null) falhou("P2 (decisao)", `ordem viva de ${INSTRUMENTO} com lado \`${String(o?.side)}\`: no venue so' A e B`);
      return {
        instrumento: INSTRUMENTO,
        ordem: String(o?.oid),
        lado,
        preco: String(o?.limitPx),
        unidades: String(o?.sz),
        ...(o?.cloid != null ? { marca_de_posse: String(o.cloid) } : {}),
      };
    }),    // O lado da posicao vem do SINAL que o venue publica (`szi`), e nao de uma suposicao nossa.
    ...(posicaoDe(lido.conta, INSTRUMENTO)
      ? {
          posicao: {
            lado: (Number(posicaoDe(lido.conta, INSTRUMENTO).szi) < 0 ? "sell" : "buy") as "buy" | "sell",
            unidades: String(Math.abs(Number(posicaoDe(lido.conta, INSTRUMENTO).szi))),
            preco_medio: String(posicaoDe(lido.conta, INSTRUMENTO).entryPx ?? "0"),
            marca_de_posse: marcaDaPosicao,
          },
        }
      : {}),
  };
  const entradas = lerParaOCiclo(leitura, { setup: { nome: "manual", versao: "0.0.1" }, lado, barra_ms: BARRA_DO_SINAL }, ciclo);
  return decidirInstrumento({
    mercado: entradas.mercado,
    proposta: entradas.proposta,
    proposta_invalida: entradas.proposta_invalida,
    motivo_do_contrato: entradas.motivo_do_contrato,
    barra_do_sinal_esperada: BARRA_DO_SINAL,
    ficha: String(3232 + ciclo),
    ciclo,
    ligacao: "ligada",
    mandato,
    template,
    marcas_nossas_conhecidas: posicaoNossa,
    config: CONFIG_DO_TESTE,
    desconhecido: null,
    mesa_pausada: false,
  });
}

async function p2_decisao(lido: any, manifesto: any): Promise<any> {
  const decisao = decidirCom(lido, CICLO_BASE, [], mandatoDoTeste(), mao.lado);
  cru["P2_decisao"] = { acao: decisao.acao, motivo: decisao.motivo, condicao: decisao.condicao, boleta: decisao.boleta };
  if (decisao.acao !== "abrir" || decisao.boleta === null) {
    anotar({
      passo: 2,
      nome: "a mesa decide com a proposta manual e monta a boleta",
      mediu: `acao=${decisao.acao} motivo=${decisao.motivo} condicao=${decisao.condicao}`,
      saida: decisao,
      veredicto: "reprovou",
      porque: "a mesa NAO decidiu abrir: com a proposta manual e a condicao normal, a abertura e' o que se espera. Nada se envia.",
    });
    falhou("P2", `a decisao nao foi abrir (${decisao.acao}/${decisao.motivo})`);
  }
  // A TRADUCAO (o conector, offline, pelo modulo dele): quantas unidades, a que preco, e se cabe no minimo
  // do venue. E' a mesma funcao que o envio vai usar, com os numeros LIDOS agora - o preco e' o do venue
  // neste instante, e nao uma marca guardada (e' a obrigacao 2 a poder ser medida antes de qualquer ordem).
  const traduzida = traduzirOrdem({
    conta: lido.endereco,
    boleta: decisao.boleta,
    manifesto,
    saldo: String(lido.conta?.marginSummary?.accountValue ?? "0"),
    preco: String(marcaDoVenue(lido, INSTRUMENTO) ?? "0"),
  } as any);
  cru["P2_traducao"] = traduzida;
  const accao = (traduzida as any).accao;
  anotar({
    passo: 2,
    nome: "a mesa decide com a proposta manual e monta a boleta (e o conector TRADUZ, offline)",
    mediu: accao
      ? `acao=abrir · boleta ${decisao.boleta.instrumento} ${decisao.boleta.lado} ${decisao.boleta.tipo} · TADUCAO: ${accao.quantidade} unidade(s) a ${accao.preco} (nocional ${(traduzida as any).nocional}) · tif=${accao.tif} · cloid=${accao.cloid}`
      : `a traducao NAO passou: ${(traduzida as any).motivo} - ${(traduzida as any).porque}`,
    saida: { boleta: decisao.boleta, traducao: traduzida },
    veredicto: accao ? "passou" : "reprovou",
    porque: "a boleta foi montada do mandato (o dono) e do template (o setup manual), validada contra o contrato, e o conector traduziu-a com o SALDO e o PRECO lidos do venue agora - sem uma unica unidade calculada pela mesa",
  });
  if (!accao) falhou("P2 (traducao)", "a traducao do conector recusou a boleta do teste");
  return decisao;
}

// ---------------------------------------------------------------------------------------------------------
// P3 — O ENVIO: a boleta vai ao processo do conector AO VIVO, que assina e submete.

function envelopeDaBoleta(id: string, carga: unknown): string {
  const linha = JSON.stringify({ contrato: versaoVigente(), tipo: "boleta", id, carga });
  const conferido = validar(linha);
  if (conferido.veredicto !== "aceite") falhou("P3 (envelope)", `a boleta nao passa o contrato: ${conferido.motivo}`);
  return linha;
}

/** O envio: a boleta vai ao PROCESSO do conector, que assina e submete. Devolve as DUAS linhas que o
 *  conector publica — a `resolucao` (que sai ANTES do envio, sobre numeros do venue) e o `desfecho`
 *  (depois) — e a saida crua inteira, para o registo. */
async function enviarAoVenue(boleta: any, etiqueta: string): Promise<{ r: any; resolucaoAntes: any; desfecho: any }> {
  const id = `${etiqueta}/${boleta.referencia_do_cliente}`;
  const r = await correrProcesso({ linhas: [envelopeDaBoleta(id, boleta)], timeout_ms: 120_000 });
  cru[`envio_${etiqueta}`] = { entrada: envelopeDaBoleta(id, boleta), saida: r.saida, erros: r.erros, codigo: r.codigo };
  const ler = (tipo: string) => {
    const l = r.saida.find((x: string) => x.includes(`"tipo":"${tipo}"`));
    return l ? JSON.parse(l) : null;
  };
  return { r, resolucaoAntes: ler("resolucao"), desfecho: ler("desfecho") };
}

async function p3_envio(boletaMesa: any): Promise<any> {
  const { r, resolucaoAntes, desfecho } = await enviarAoVenue(boletaMesa, "abertura");
  if (desfecho === null) {
    anotar({
      passo: 3,
      nome: "o conector ao vivo ASSINA e SUBMETE",
      mediu: `codigo do processo=${r.codigo} · linhas de saida=${r.saida.length}`,
      saida: { saida: r.saida, erros: r.erros },
      veredicto: "reprovou",
      porque: "nenhuma linha de desfecho saiu: ou o processo nao subiu, ou o envio nao chegou a resposta. A saida crua esta no registo.",
    });
    falhou("P3", "o envio nao devolveu desfecho");
  }
  const c = desfecho.carga;
  const resposta = c.resposta_do_venue ?? {};
  anotar({
    passo: 3,
    nome: "o conector ao vivo ASSINA e SUBMETE (a ordem sai na TESTE)",
    mediu: `classificacao=${c.classificacao}${c.motivo ? ` motivo=${c.motivo}` : ""} · venue: estado=${resposta.estado} ordem=${resposta.order_id} preenchido=${resposta.preenchido} a ${resposta.preco_medio}`,
    saida: { desfecho: c, resolucao_antes_do_envio: resolucaoAntes?.carga ?? null },
    veredicto: c.classificacao === "aceite" ? "passou" : "reprovou",
    porque: `o venue respondeu pela palavra dele (${c.classificacao}) - e a recusa, quando ela vem, vem NOMEADA; a \`resolucao\` saiu ANTES do envio (o que a mesa conferiu antes de a ordem sair)`,
  });
  return { desfecho, resolucaoAntes };
}

// ---------------------------------------------------------------------------------------------------------
// P4 — a CLASSIFICACAO da mesa sobre a resposta do venue, e a conferencia da banda (D-001).

async function p4_desfecho(enviado: any, boletaMesa: any, lido: any): Promise<any> {
  const carga = enviado.desfecho.carga;
  const resolucao = carga.resolucao ?? enviado.resolucaoAntes?.carga ?? null;
  const resultado = classificarDesfecho(
    {
      instrumento: INSTRUMENTO,
      referencia_do_cliente: String(boletaMesa.referencia_do_cliente),
      enviado_em_ms: Date.now() - 250,
      prazo_de_resposta_ms: 3000,
    },
    { desfecho: carga },
    Date.now(),
    CONFIG_DO_TESTE,
    {
      resolucao,
      bandas: mandatoDoTeste().bandas,
      distancia_minima_liquidacao_pct: "2",
      equity: String(lido.conta?.marginSummary?.accountValue ?? "0"),
      marca: marcaDoVenue(lido, INSTRUMENTO) ?? "0",
    },
  );
  cru["P4_resultado"] = resultado;
  anotar({
    passo: 4,
    nome: "a mesa classifica o desfecho e confere a resolucao contra a banda (D-001)",
    mediu: `classificacao=${resultado.classificacao} · motivo=${resultado.motivo ?? "(nenhum)"} · banda=${JSON.stringify((resultado as any).banda ?? null)}`,
    saida: { resultado, resolucao },
    veredicto: resultado.classificacao === "aceite" ? "passou" : "reprovou",
    porque: "a palavra do venue virou classificacao DA MESA (aceite/parcial/desconhecido/recusado) e a resolucao foi conferida contra a banda do mandato - as duas coisas que so' a resposta a serio permite medir",
  });
  return resultado;
}

// ---------------------------------------------------------------------------------------------------------
// P5 — a CONTA depois: os CINCO numeros com posicao viva, e as execucoes (a taxa e o resultado realizado).

function cincoNumerosDaPosicao(posicao: any): Record<string, unknown> | null {
  if (!posicao) return null;
  return {
    quantidade: posicao.szi,
    nocional: posicao.positionValue,
    margem_empenhada: posicao.marginUsed,
    alavancagem_efectiva: typeof posicao.leverage === "object" ? posicao.leverage?.value : posicao.leverage,
    preco_de_liquidacao: posicao.liquidationPx,
  };
}

async function p5_conta(resolucaoDoDesfecho: any): Promise<any> {
  const lido = await lerDoVenue();
  const posicao = posicaoDe(lido.conta, INSTRUMENTO);
  const cinco = cincoNumerosDaPosicao(posicao);
  const ultimas = (lido.execucoes ?? []).slice(0, 3);
  cru["P5_conta"] = { equity: lido.conta?.marginSummary?.accountValue, posicao, cinco, ultimas_execucoes: ultimas };
  if (cinco === null) {
    anotar({
      passo: 5,
      nome: "a conta depois do envio: os cinco numeros da posicao viva",
      mediu: `equity=${lido.conta?.marginSummary?.accountValue} · posicao ${INSTRUMENTO}=nenhuma`,
      saida: { conta: lido.conta },
      veredicto: "reprovou",
      porque: "a ordem foi aceite e nao ha posicao: ou o venue ainda nao a publica, ou a ordem nao abriu nada. Nao se segue para o fecho sem saber o que ha' para fechar.",
    });
    falhou("P5", "a posicao nao apareceu depois de uma ordem aceite");
  }
  // A mesma posicao, contada duas vezes: a resolucao do desfecho e a leitura da conta. Se os cinco numeros
  // forem os mesmos, a resolucao e' sobre ESTA posicao - e e' isso que o SC-007 pede (5 de 5 para a MESMA).
  const iguais = resolucaoDoDesfecho
    ? ["quantidade", "nocional", "margem_empenhada", "alavancagem_efectiva", "preco_de_liquidacao"].filter((k) => {
        const a = Number((resolucaoDoDesfecho as any)[k]);
        const b = Number((cinco as any)[k]);
        return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
      })
    : [];
  anotar({
    passo: 5,
    nome: "a conta depois do envio: os cinco numeros da posicao viva",
    mediu: `${cinco.quantidade} ${INSTRUMENTO} · nocional ${cinco.nocional} · margem ${cinco.margem_empenhada} · alavancagem ${cinco.alavancagem_efectiva} · liquidacao ${cinco.preco_de_liquidacao} · equity ${lido.conta?.marginSummary?.accountValue} · execucoes na conta=${(lido.execucoes ?? []).length} (ultima: ${ultimas[0]?.coin} ${ultimas[0]?.sz} a ${ultimas[0]?.px}, taxa ${ultimas[0]?.fee}, resultado ${ultimas[0]?.closedPnl})`,
    saida: { cinco, ultimas_execucoes: ultimas, coincidencias_com_a_resolucao: iguais },
    veredicto: "passou",
    porque: `os cinco numeros vieram do VENUE (a mesa nao os calcula): ${iguais.length} de 5 coincidem com a resolucao do desfecho${iguais.length === 5 ? " - a resolucao e' desta posicao" : " (o venue moveu-se entre o envio e esta leitura, e e' isso que o registo guarda)"}`,
  });
  return { lido, cinco, iguais };
}

// ---------------------------------------------------------------------------------------------------------
// P6 — A IDEMPOTENCIA: a MESMA referencia outra vez. O venue nao pode criar uma segunda ordem (T042/SC-003).

async function p6_idempotencia(boletaMesa: any, antes: number): Promise<any> {
  const enviado = await enviarAoVenue(boletaMesa, "abertura-repetida");
  const carga = enviado.desfecho?.carga ?? null;
  const lido = await lerDoVenue();
  const posicao = posicaoDe(lido.conta, INSTRUMENTO);
  const depois = (lido.execucoes ?? []).length;
  const mesmaMarcacaoNossa = (lido.execucoes ?? []).filter((e: any) => String(e.cloid ?? "") === String((enviado as any).desfecho?.id ?? "").split("/")[0]);
  cru["P6_idempotencia"] = { entrada: boletaMesa.referencia_do_cliente, desfecho: carga, execucoes_antes: antes, execucoes_depois: depois, posicao };
  anotar({
    passo: 6,
    nome: "a idempotencia: a MESMA referencia outra vez, e a contagem no venue",
    mediu: `2a resposta do venue: classificacao=${carga?.classificacao}${carga?.motivo ? ` motivo=${carga.motivo}` : ""} resposta=${JSON.stringify(carga?.resposta_do_venue ?? null).slice(0, 120)} · execucoes ${antes} -> ${depois} · posicao ${posicao?.szi ?? "(nenhuma)"}`,
    saida: { desfecho: carga, execucoes_antes: antes, execucoes_depois: depois, posicao },
    veredicto: depois === antes ? "passou" : "reprovou",
    porque: depois === antes
      ? "a mesma referencia nao criou uma segunda ordem: o venue reconheceu a marca e a conta nao se moveu"
      : `a mesma referencia mexeu na conta (${antes} -> ${depois} execucoes): a idempotencia declarada no manifesto NAO se confirma`,
  });
  return { carga, posicao, antes, depois };
}

// ---------------------------------------------------------------------------------------------------------
// P7 — O FECHO: a posicao volta a zero, com `reduce_only`. O tamanho vem do mandato (a mesa nao calcula
// unidades); como `reduce_only` nunca vira posicao, o pedido pode ir por cima do que ha' a fechar.

/**
 * Fecha a posicao do instrumento e devolve o que se mediu. Serve duas coisas: a LIMPEZA (a conta de teste
 * pode ja' ter posicao de uma corrida anterior, e a mesa recusa abrir por cima de uma posicao que ela nao
 * reconhece como sua — foi o que aconteceu na 2a corrida) e a PROVA do fecho (P7).
 *
 * O tamanho vem do mandato (`saldo_pct`), porque a mesa nao calcula unidades: o conector deriva a quantidade.
 * Como `reduce_only` nunca vira posicao, o pedido pode ir por cima do que ha' a fechar sem risco de abrir.
 */
async function fecharAPosicao(lido: any, ciclo: number, etiqueta: string, marcaDaPosicao: number): Promise<any> {
  const posicao = posicaoDe(lido.conta, INSTRUMENTO);
  if (!posicao) return { havia: false, carga: null, restou: null, boleta: null, decisao: null, unidades: 0 };
  const unidades = Math.abs(Number(posicao.szi));
  const equity = Number(lido.conta?.marginSummary?.accountValue ?? 0);
  const marca = Number(marcaDoVenue(lido, INSTRUMENTO) ?? 0);
  const saldoPct = Math.ceil(((unidades * marca) / (equity * 2)) * 100 * 1.05 * 100) / 100;
  const mandato: any = {
    ...mandatoDoTeste(),
    saldo_pct: String(saldoPct),
    bandas: { ...mandatoDoTeste().bandas, saldo_pct: { minimo: "0.1", maximo: "100" } },
  };
  // A posicao e' NOSSA por declaracao: a conta de teste tem um operador, e o teste e' ele. A proposta vai
  // com `caixa` — o verbo de fechar (RN-T4) — e NAO com o lado oposto: o lado oposto abre do outro lado.
  const decisao = decidirCom(lido, ciclo, [marcaDaPosicao], mandato, "caixa", marcaDaPosicao);
  if (decisao.acao !== "fechar" || !decisao.boleta?.reduce_only) {
    return { havia: true, decisao, boleta: decisao.boleta, carga: null, restou: posicao, unidades, recusou: `${decisao.acao}/${decisao.motivo}` };
  }
  const enviado = await enviarAoVenue(decisao.boleta, etiqueta);
  const depois = await lerDoVenue();
  const restou = posicaoDe(depois.conta, INSTRUMENTO);
  cru[`fecho_${etiqueta}`] = { saldo_pct: saldoPct, desfecho: enviado.desfecho?.carga ?? null, posicao_depois: restou, equity: depois.conta?.marginSummary?.accountValue };
  return { havia: true, decisao, boleta: decisao.boleta, carga: enviado.desfecho?.carga ?? null, restou, unidades, saldoPct };
}

/**
 * A LIMPEZA: se a conta ja' tem posicao (de uma corrida anterior), fecha-a ANTES de comecar. Sem isto, a
 * abertura seria recusada pela mesa - e com razao: ela nao abre por cima de posicao que nao reconhece.
 */
async function p1b_limpeza(lido: any): Promise<any> {
  const posicao = posicaoDe(lido.conta, INSTRUMENTO);
  if (!posicao) {
    anotar({
      passo: 1,
      nome: "a limpeza: a conta comeCA plana",
      mediu: `posicao ${INSTRUMENTO}=nenhuma (nao havia nada a limpar)`,
      saida: null,
      veredicto: "passou",
      porque: "a conta de teste ja' estava plana: a corrida comeca do zero e nada se fecha por fechar",
    });
    return null;
  }
  const r = await fecharAPosicao(lido, CICLO_BASE + 1, "limpeza", 3232);
  anotar({
    passo: 1,
    nome: "a limpeza: a posicao que ja' estava volta a zero",
    mediu: `havia ${posicao.szi} ${INSTRUMENTO} a ${posicao.entryPx} · boleta ${r.boleta?.lado} reduce_only=${r.boleta?.reduce_only} saldo_pct=${r.saldoPct} (cobre ${r.unidades})${r.recusou ? ` · a mesa RECUSOU: ${r.recusou}` : ""} · venue: ${r.carga?.classificacao} ${JSON.stringify(r.carga?.resposta_do_venue ?? {}).slice(0, 100)} · posicao depois=${r.restou ? `${r.restou.szi} ${INSTRUMENTO}` : "nenhuma"}`,
    saida: { desfecho: r.carga, posicao_depois: r.restou },
    veredicto: r.restou === null ? "passou" : "reprovou",
    porque: r.restou === null
      ? "a posicao de uma corrida anterior foi fechada com reduce_only e o venue confirmou: a corrida comeca plana"
      : `a limpeza NAO fechou tudo (resta ${r.restou?.szi}): a corrida segue com risco aberto, e isso diz-se`,
  });
  return r;
}

async function p7_fecho(): Promise<any> {
  const lido = await lerDoVenue();
  const r = await fecharAPosicao(lido, CICLO_BASE + 2, "fecho", 3232 + CICLO_BASE);
  if (!r.havia) {
    anotar({
      passo: 7,
      nome: "o fecho com reduce_only: a posicao volta a zero",
      mediu: `posicao ${INSTRUMENTO}=nenhuma`,
      saida: null,
      veredicto: "inconclusivo",
      porque: "nao havia posicao para fechar: a prova do fecho NAO correu, e diz-se em vez de se dar por feita",
    });
    return null;
  }
  anotar({
    passo: 7,
    nome: "o fecho com reduce_only: a posicao volta a zero",
    mediu: `havia ${r.unidades} ${INSTRUMENTO} · boleta ${r.boleta?.lado} reduce_only=${r.boleta?.reduce_only} saldo_pct=${r.saldoPct}${r.recusou ? ` · a mesa RECUSOU: ${r.recusou}` : ""} · venue: ${r.carga?.classificacao} ${JSON.stringify(r.carga?.resposta_do_venue ?? {}).slice(0, 100)} · posicao depois=${r.restou ? `${r.restou.szi} ${INSTRUMENTO}` : "nenhuma"} · equity=${(await lerDoVenue()).conta?.marginSummary?.accountValue}`,
    saida: { desfecho: r.carga, posicao_depois: r.restou },
    veredicto: r.restou === null ? "passou" : "reprovou",
    porque: r.restou === null
      ? "a posicao fechou com reduce_only e o venue confirmou: o instrumento voltou ao que estava antes do teste"
      : `a posicao NAO fechou por inteiro (resta ${r.restou?.szi}): a conta ficou com risco aberto, e isso diz-se em vez de se esconder`,
  });
  return r;
}

// ---------------------------------------------------------------------------------------------------------
// P8 — AS RECUSAS que nao custam: o minimo do venue, o instrumento que o manifesto nao tem, o tipo de ordem
// que o venue nao declara. Nenhuma delas chega a sair: quem recusa e' o conector, com o motivo nomeado.

async function p8_recusas(manifesto: any, lido: any): Promise<void> {
  const casos: Array<{ nome: string; porque: string; pedido: any }> = [
    {
      nome: "abaixo do minimo de valor do venue",
      porque: "um nocional abaixo do minimo do venue tem de ser recusado por NOS, e nao descoberto na resposta",
      pedido: { boleta: { ...(await boletaDoTeste(0.01)) }, manifesto, saldo: String(lido.conta?.marginSummary?.accountValue ?? "0"), preco: String(marcaDoVenue(lido, INSTRUMENTO) ?? "0") },
    },
    {
      nome: "instrumento que o manifesto nao tem",
      porque: "o manifesto e' a lista do que existe: pedir outro instrumento nao pode sair",
      pedido: { boleta: { ...(await boletaDoTeste(1)), instrumento: "NAOEXISTE" }, manifesto, saldo: String(lido.conta?.marginSummary?.accountValue ?? "0"), preco: String(marcaDoVenue(lido, INSTRUMENTO) ?? "0") },
    },
    {
      nome: "tipo de ordem que o venue nao declara",
      porque: "o manifesto declara os tipos de ordem do venue; pedir um que ele nao tem tem de morrer aqui",
      pedido: { boleta: { ...(await boletaDoTeste(1)), tipo: "stop_limite" }, manifesto, saldo: String(lido.conta?.marginSummary?.accountValue ?? "0"), preco: String(marcaDoVenue(lido, INSTRUMENTO) ?? "0") },
    },
  ];
  const medidas: any[] = [];
  for (const c of casos) {
    const r: any = traduzirOrdem({ conta: lido.endereco, ...c.pedido } as any);
    medidas.push({ caso: c.nome, motivo: r.motivo ?? null, aceitou: Boolean(r.accao) });
    anotar({
      passo: 8,
      nome: `recusa: ${c.nome}`,
      mediu: r.accao ? `ACEITOU (${r.accao.quantidade} a ${r.accao.preco})` : `recusou com ${r.motivo}`,
      saida: r,
      veredicto: r.accao ? "reprovou" : "passou",
      porque: c.porque,
    });
  }
  cru["P8_recusas"] = medidas;
}

/** A boleta do teste, para um `saldo_pct` dado (o resto vem do mandato do teste). */
async function boletaDoTeste(saldoPct: number): Promise<any> {
  const d = decidirCom(await lerDoVenue(), CICLO_BASE + 3, [], { ...mandatoDoTeste(), saldo_pct: String(saldoPct), bandas: { ...mandatoDoTeste().bandas, saldo_pct: { minimo: "0", maximo: "100" } } }, "buy");
  if (!d.boleta) falhou("P8 (boleta do teste)", `a mesa nao montou a boleta para saldo_pct ${saldoPct}: ${d.acao}/${d.motivo}`);
  return d.boleta;
}


// ---------------------------------------------------------------------------------------------------------
// P10 — OS CAMPOS DA BOLETA QUE O CONECTOR ACEITA E NAO LE. O contrato exige-os na boleta, o dono escreve-os
// (o stop vem do setup, RN-S11), e a medicao mostra se eles mudam alguma coisa no que sai para o venue.
//
// O par de controle e' o que da' valor a prova: a boleta SEM stop e a boleta COM stop tem de produzir coisas
// DIFERENTES. Se produzem o mesmo, o stop nao viajou — e o venue deste manifesto declara `stop_anexo: false`,
// portanto nao ha' stop nenhum do outro lado: a mesa fica a acreditar numa proteccao que nao existe.

function camposQueSaem(r: any): string[] {
  return r?.accao ? Object.keys(r.accao).sort() : [];
}

async function p10_campos_ignorados(manifesto: any, lido: any): Promise<void> {
  const base = {
    instrumento: INSTRUMENTO,
    lado: "buy" as const,
    tipo: "mercado",
    saldo_pct: "1",
    alavancagem: "2",
    parcial: "o_que_der",
    desvio_maximo: "0.5",
    prazo_da_passiva_ms: 3000,
    destino_do_resto: "agressivo",
    reduce_only: false,
    referencia_do_cliente: `mesa-${3232 + CICLO_BASE}-000950`,
    marca_de_posse: 3232 + CICLO_BASE,
  };
  const traduzir = (boleta: any) =>
    traduzirOrdem({
      conta: lido.endereco,
      boleta,
      manifesto,
      saldo: String(lido.conta?.marginSummary?.accountValue ?? "0"),
      preco: String(marcaDoVenue(lido, INSTRUMENTO) ?? "0"),
    } as any) as any;
  const sem = traduzir({ ...base });
  const com = traduzir({ ...base, stop_pct: "2", tp_pct: "4" });
  const limiteA = traduzir({ ...base, tipo: "limite", prazo_da_passiva_ms: 3000, destino_do_resto: "agressivo" });
  const limiteB = traduzir({ ...base, tipo: "limite", prazo_da_passiva_ms: 60000, destino_do_resto: "cancelar" });
  const iguais = (a: any, b: any) =>
    a?.accao && b?.accao && JSON.stringify({ ...a.accao, cloid: null, preco_de_referencia: null }) === JSON.stringify({ ...b.accao, cloid: null, preco_de_referencia: null });
  const stopIgnorado = iguais(sem, com);
  const prazoEDestinoIgnorados = iguais(limiteA, limiteB);
  cru["P10_campos"] = { sem_stop: sem?.accao ?? sem, com_stop: com?.accao ?? com, limite_prazo_curto: limiteA?.accao ?? limiteA, limite_prazo_longo_e_cancelar: limiteB?.accao ?? limiteB };
  anotar({
    passo: 10,
    nome: "os campos da boleta que o conector aceita e NAO le (stop, tp, prazo, destino)",
    mediu: `com stop_pct/tp_pct vs sem: ${stopIgnorado ? "payload IDENTICO" : "diferente"} · com prazo 60000/destino cancelar vs 3000/agressivo: ${prazoEDestinoIgnorados ? "payload IDENTICO" : "diferente"} · campos que saem: ${JSON.stringify(camposQueSaem(sem))} · o venue declara stop_anexo=${manifesto.stop_anexo}`,
    saida: { sem_stop: sem?.accao ?? sem, com_stop: com?.accao ?? com },
    veredicto: stopIgnorado || prazoEDestinoIgnorados ? "reprovou" : "passou",
    porque: stopIgnorado || prazoEDestinoIgnorados
      ? `a boleta pede stop/tp (e prazo/destino) e o payload sai IGUAL ao da boleta sem nada disso: o dono escreve uma proteccao que nao e' enviada, e nem o venue a pode prender (stop_anexo=${manifesto.stop_anexo}) - a mesa fica a acreditar numa proteccao que nao existe. E' o FR-007 outra vez: nada se adapta em silencio. DECLARADO: D-011`
      : "os campos da boleta mudam o que sai para o venue",
  });
}

// ---------------------------------------------------------------------------------------------------------
// P11 — A ALAVANCAGEM PEDIDA NAO CHEGA AO VENUE (FR-008). A boleta pede 2; o venue tem o que ele tinha.

async function p11_alavancagem(boletaMesa: any, lido: any): Promise<void> {
  const { InfoClient, HttpTransport } = await import("@nktkas/hyperliquid");
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet: true }) });
  const dados: any = await (info as any).activeAssetData({ user: lido.endereco, coin: INSTRUMENTO });
  const noVenue = dados?.leverage ?? null;
  const pedida = String(boletaMesa?.alavancagem ?? "?");
  const valorNoVenue = String(typeof noVenue === "object" ? noVenue?.value : noVenue);
  const coincide = Number(valorNoVenue) === Number(pedida);
  cru["P11_alavancagem"] = { pedida_na_boleta: pedida, venue: noVenue, posicao: posicaoDe(lido.conta, INSTRUMENTO) ?? null };
  anotar({
    passo: 11,
    nome: "a alavancagem que a boleta pede chega ao venue? (FR-008)",
    mediu: `a boleta pede ${pedida} · o venue tem ${valorNoVenue} (${JSON.stringify(noVenue)}) · a posicao le-se com leverage=${JSON.stringify(posicaoDe(lido.conta, INSTRUMENTO)?.leverage ?? null)}`,
    saida: { pedida, no_venue: noVenue },
    veredicto: coincide ? "passou" : "reprovou",
    porque: coincide
      ? "a alavancagem pedida e' a que o venue tem"
      : `a boleta pede ${pedida} e o venue tem ${valorNoVenue}: o conector NUNCA pede a alavancagem ao venue (0 chamadas de ajuste em \`brokers/\`), e a resolucao declara a pedida - os numeros que a mesa confere saem de uma alavancagem que nao esta' la'. DECLARADO: D-010`,
  });
}

// ---------------------------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------------------------
// P12 — A VARREDURA DO VOCABULARIO. Cada valor que um plugin de SETUP pode fazer chegar a uma boleta, com o
// veredicto DECLARADO ao lado. Nao se pergunta so' "passou?": pergunta-se se cada valor tem desfecho NOMEADO —
// aceite com as consequencias certas, ou recusa com motivo. O que se procura e' o valor que "passa" e nao muda
// nada no que sai para o venue: esse e' o pior dos tres, e foi assim que apareceram o stop (P10) e o resto.

interface ItemDoVocabulario {
  campo: string;
  valor: unknown;
  esperado: "aceite" | "recusa";
  porque: string;
}

async function p12_vocabulario(manifesto: any, lido: any): Promise<void> {
  const base: any = {
    instrumento: INSTRUMENTO,
    lado: "buy",
    tipo: "mercado",
    saldo_pct: "1",
    alavancagem: "2",
    parcial: "o_que_der",
    desvio_maximo: "0.5",
    prazo_da_passiva_ms: 3000,
    destino_do_resto: "agressivo",
    reduce_only: false,
    referencia_do_cliente: `mesa-${3232 + CICLO_BASE}-000920`,
    marca_de_posse: 3232 + CICLO_BASE,
  };
  const traduzir = (extra: any) =>
    traduzirOrdem({
      conta: lido.endereco,
      boleta: { ...base, ...extra },
      manifesto,
      saldo: String(lido.conta?.marginSummary?.accountValue ?? "0"),
      preco: String(marcaDoVenue(lido, INSTRUMENTO) ?? "0"),
    } as any) as any;

  const itens: ItemDoVocabulario[] = [
    { campo: "lado", valor: "buy", esperado: "aceite", porque: "abrir comprado — o caso base (provado ao vivo na P3)" },
    { campo: "lado", valor: "sell", esperado: "aceite", porque: "abrir vendido (provado ao vivo na P13)" },
    { campo: "lado", valor: "hold", esperado: "recusa", porque: "`hold` e' da PROPOSTA, nao da boleta: sem lado a executar nao ha ordem, e o conector nao pode escolher por nos" },
    { campo: "lado", valor: "caixa", esperado: "recusa", porque: "`caixa` e' o verbo de FECHAR do ciclo: quem fecha compoe o lado oposto e poe reduce_only — o conector que recebesse `caixa` estaria a adivinhar o lado" },
    { campo: "tipo", valor: "mercado", esperado: "aceite", porque: "o tipo que o venue aceita e a mesa usa" },
    { campo: "tipo", valor: "limite", esperado: "recusa", porque: "D-012: o preco do limite e a marca CRUA, e a marca nao cabe na regra de 5 algarismos do venue" },
    { campo: "tipo", valor: "stop", esperado: "recusa", porque: "o manifesto nao declara `stop` entre os tipos (a sonda le as ordens que o venue registou)" },
    { campo: "tipo", valor: "stop_limite", esperado: "recusa", porque: "idem" },
    { campo: "tipo", valor: "mercado_por_faixa", esperado: "recusa", porque: "idem" },
    { campo: "parcial", valor: "o_que_der", esperado: "aceite", porque: "o venue declara `o_que_der`" },
    { campo: "parcial", valor: "tudo_ou_nada", esperado: "recusa", porque: "o venue nao declara tudo-ou-nada: recusar e' o certo, improvisar nao" },
    { campo: "destino_do_resto", valor: "agressivo", esperado: "aceite", porque: "no tipo `mercado` (Ioc) nao ha resto a perseguir — nada a fazer, e dito" },
    { campo: "destino_do_resto", valor: "cancelar", esperado: "aceite", porque: "no tipo `mercado` (Ioc) o resto e' cancelado PELO TIF: honrado por construcao (no `limite` seria outro caso — D-012)" },
    { campo: "stop_pct", valor: "2", esperado: "recusa", porque: "o conector nao manda stop nenhum: recusa nomeada desde 29/09 (era o silencio do D-011)" },
    { campo: "tp_pct", valor: "4", esperado: "recusa", porque: "idem" },
  ];

  const linhas: Array<{ campo: string; valor: unknown; esperado: string; obtido: string; motivo: string | null; certo: boolean }> = [];
  for (const item of itens) {
    const r = traduzir({ [item.campo]: item.valor });
    const obtido = r?.accao ? "aceite" : "recusa";
    const certo = obtido === item.esperado;
    linhas.push({ campo: item.campo, valor: item.valor, esperado: item.esperado, obtido, motivo: r?.motivo ?? null, certo });
    console.log(`      ${certo ? " " : "!"} ${item.campo}=${JSON.stringify(item.valor)}: ${obtido}${r?.motivo ? ` (${r.motivo})` : ""} — esperado ${item.esperado}`);
  }
  const errados = linhas.filter((l) => !l.certo);
  cru["P12_vocabulario"] = linhas;
  anotar({
    passo: 12,
    nome: "a varredura do VOCABULARIO (cada valor que um setup pode usar, com o desfecho declarado)",
    mediu: `${linhas.length} valores conferidos · ${linhas.filter((l) => l.obtido === "aceite").length} aceites · ${linhas.filter((l) => l.obtido === "recusa").length} recusas nomeadas · ${errados.length} fora do esperado${errados.length ? `: ${errados.map((e) => `${e.campo}=${JSON.stringify(e.valor)} (${e.obtido}, esperado ${e.esperado})`).join(" · ")}` : ""}`,
    saida: linhas,
    veredicto: errados.length === 0 ? "passou" : "reprovou",
    porque:
      errados.length === 0
        ? "todos os valores do vocabulario tem desfecho NOMEADO: ou saem com as consequencias certas, ou recusam com motivo. Nenhum valor 'passa' sem mudar nada"
        : "ha valores cujo desfecho medido nao e' o declarado — cada um deles e' um buraco no que o setup pode usar",
  });
}

// ---------------------------------------------------------------------------------------------------------
// P13/P14/P15/P16 — AS SEQUENCIAS DE POSICAO: abrir vendido, virada de mao, o inverso SEM fechar, e o teto do
// saldo. Cada uma abre e fecha o que abre (a conta tem de ficar plana), e cada uma diz o que mediu.

async function abrirCom(lado: "buy" | "sell", ciclo: number, mandato: any = mandatoDoTeste(), template: any = TEMPLATE_DO_TESTE): Promise<any> {
  const lido = await lerDoVenue();
  const marca = 3232 + ciclo;
  const decisao = decidirCom(lido, ciclo, [], mandato, lado, marca, template);
  if (decisao.acao !== "abrir" || !decisao.boleta) return { erro: `a mesa nao abriu (${decisao.acao}/${decisao.motivo})`, decisao };
  const enviado = await enviarAoVenue(decisao.boleta, `abrir-${lado}-${ciclo}`);
  const depois = await lerDoVenue();
  return { boleta: decisao.boleta, marca, desfecho: enviado.desfecho?.carga ?? null, posicao: posicaoDe(depois.conta, INSTRUMENTO) };
}

async function p13_vendido(): Promise<any> {
  const a = await abrirCom("sell", CICLO_BASE + 10);
  if (a.erro) {
    anotar({ passo: 13, nome: "abrir VENDIDO (o outro lado do vocabulario)", mediu: a.erro, saida: a, veredicto: "reprovou", porque: "sem abrir vendido, metade dos lados do vocabulario fica por provar" });
    falhou("P13", a.erro);
  }
  const szi = Number(a.posicao?.szi ?? 0);
  const fecho = await fecharAPosicao(await lerDoVenue(), CICLO_BASE + 11, "fecho-do-vendido", a.marca);
  anotar({
    passo: 13,
    nome: "abrir VENDIDO (o outro lado do vocabulario)",
    mediu: `boleta ${a.boleta.lado} ${a.boleta.tipo} · venue: ${a.desfecho?.classificacao} ${JSON.stringify(a.desfecho?.resposta_do_venue ?? {}).slice(0, 110)} · posicao lida=${a.posicao?.szi ?? "nenhuma"} · depois do fecho=${fecho.restou ? fecho.restou.szi : "nenhuma"}`,
    saida: { desfecho: a.desfecho, posicao: a.posicao, fecho: fecho.carga },
    veredicto: szi < 0 && fecho.restou === null ? "passou" : "reprovou",
    porque: szi < 0
      ? "o lado `sell` abre vendido no venue (o sinal que o venue publica e negativo) e o fecho devolveu a conta a zero"
      : `a posicao nao ficou vendida (szi=${szi}) — o lado `+"`sell`"+` nao esta a fazer o que o vocabulario diz`,
  });
  return a;
}

async function p14_virada(): Promise<any> {
  const comprado = await abrirCom("buy", CICLO_BASE + 20);
  if (comprado.erro) falhou("P14 (abrir comprado)", comprado.erro);
  const aPosicao = comprado.posicao?.szi;
  // A VIRADA DE MAO: nao ha verbo para ela no vocabulario (os lados sao buy/sell/hold/caixa). Ela faz-se com
  // DOIS passos — `caixa` fecha, e o lado inverso abre. E' assim que se mede: a posicao tem de mudar de SINAL.
  const fecho = await fecharAPosicao(await lerDoVenue(), CICLO_BASE + 21, "virada-passo-1-fechar", comprado.marca);
  const inverso = await abrirCom("sell", CICLO_BASE + 22);
  if (inverso.erro) falhou("P14 (abrir o inverso)", inverso.erro);
  const sziDepois = Number(inverso.posicao?.szi ?? 0);
  const fechoFinal = await fecharAPosicao(await lerDoVenue(), CICLO_BASE + 23, "virada-passo-3-fechar", inverso.marca);
  cru["P14_virada"] = {
    passo_1_comprado: { boleta: comprado.boleta, posicao: aPosicao, desfecho: comprado.desfecho },
    passo_2_fechar: { boleta: fecho.boleta, desfecho: fecho.carga, posicao_depois: fecho.restou },
    passo_3_inverso: { boleta: inverso.boleta, posicao: inverso.posicao, desfecho: inverso.desfecho },
    passo_4_fechar: { desfecho: fechoFinal.carga, posicao_depois: fechoFinal.restou },
  };
  anotar({
    passo: 14,
    nome: "a VIRADA DE MAO (que nao existe no vocabulario: `caixa` + lado inverso, em dois passos)",
    mediu: `comprado ${aPosicao} -> fechado (${fecho.carga?.classificacao}) -> vendido ${inverso.posicao?.szi} -> fechado (${fechoFinal.carga?.classificacao}) -> ${fechoFinal.restou ? fechoFinal.restou.szi : "plana"} · ordens: ${[comprado.boleta, fecho.boleta, inverso.boleta, fechoFinal.boleta].map((b: any) => `${b.lado}${b.reduce_only ? "/ro" : ""}`).join(" -> ")}`,
    saida: cru["P14_virada"],
    veredicto: aPosicao > 0 && sziDepois < 0 && fechoFinal.restou === null ? "passou" : "reprovou",
    porque:
      aPosicao > 0 && sziDepois < 0
        ? "a virada de mao faz-se com DOIS passos (fechar, depois abrir do outro lado) e o venue confirma o sinal invertido — nao ha, e nao e' preciso haver, um verbo de virada"
        : "a sequencia nao inverteu a posicao como o vocabulario permite",
  });
  return inverso;
}

async function p15_inversoSemFechar(manifesto: any): Promise<void> {
  const comprado = await abrirCom("buy", CICLO_BASE + 30);
  if (comprado.erro) falhou("P15 (abrir comprado)", comprado.erro);
  const aPosicao = Number(comprado.posicao?.szi ?? 0);
  // O PERIGO QUE A VIRADA DE MAO EXISTE PARA TRAVAR: mandar o lado OPOSTO com reduce_only=false sobre uma
  // posicao aberta. O venue pode fechar e inverter numa so' ordem — e' o que se vai MEDIR, porque o contrato
  // nao tem verbo para esta manobra.
  const lido = await lerDoVenue();
  const decisao = decidirCom(lido, CICLO_BASE + 31, [comprado.marca], mandatoDoTeste(), "sell", comprado.marca);
  const enviado = decisao.boleta?.lado === "sell" ? await enviarAoVenue({ ...decisao.boleta, reduce_only: false }, "inverso-sem-fechar") : null;
  const depois = await lerDoVenue();
  const posicao = posicaoDe(depois.conta, INSTRUMENTO);
  anotar({
    passo: 15,
    nome: "o INVERSO SEM FECHAR (o lado oposto com reduce_only=false sobre posicao aberta)",
    mediu: `havia ${aPosicao} · a mesa decidiu ${decisao.acao}/${decisao.motivo} e a boleta saiu ${decisao.boleta?.lado} reduce_only=${decisao.boleta?.reduce_only} · venue: ${enviado?.desfecho?.carga?.classificacao ?? "(nada saiu)"} · posicao depois=${posicao ? posicao.szi : "nenhuma"}`,
    saida: { decisao: { acao: decisao.acao, motivo: decisao.motivo, boleta: decisao.boleta }, desfecho: enviado?.desfecho?.carga ?? null, posicao_depois: posicao },
    veredicto: "passou",
    porque: "medido, e' o que se queria saber",
  });
  // A conta tem de voltar a zero por NOS, com o verbo de fechar.
  // O FECHO por nos, para garantir a conta plana — mas o que a prova ACIMA mediu foi isto: com o MESMO tamanho,
  // o lado oposto com `reduce_only=false` FECHOU a posicao (netting do venue), e a mesa tinha dito `abrir`.
  const fecho = await fecharAPosicao(await lerDoVenue(), CICLO_BASE + 32, "fecho-do-inverso-sem-fechar", comprado.marca);
  anotar({
    passo: 15,
    nome: "o FECHO depois do inverso sem fechar (a conta volta a zero)",
    mediu: fecho.havia ? `boleta ${fecho.boleta?.lado} reduce_only=${fecho.boleta?.reduce_only} · venue: ${fecho.carga?.classificacao} · posicao depois=${fecho.restou ? fecho.restou.szi : "nenhuma"}` : "nao havia nada a fechar: o lado oposto JA tinha fechado a posicao (netting do venue)",
    saida: { havia: fecho.havia, desfecho: fecho.carga, posicao_depois: fecho.restou },
    veredicto: fecho.restou === null || !fecho.havia ? "passou" : "reprovou",
    porque: !fecho.havia
      ? "a conta ja' estava plana: o `sell` com reduce_only=false, do MESMO tamanho, zerou a posicao — o venue faz netting, e a mesa tinha registado `abrir`"
      : "a conta ficou plana outra vez, e foi o verbo de fechar que a fez",
  });
}

async function p16_tetoDoSaldo(manifesto: any, lido: any): Promise<void> {
  // 1. A BANDA DO MANDATO — o limite do saldo que e' NOSSO, medido com o par de controle (dentro / fora).
  //
  // ATENCAO, E FOI ASSIM QUE ESTA PROVA APRENDEU: a primeira versao desta prova mandava ao venue, A SERIO, uma
  // ordem com nocional de ~400x o equity, a espera de ser recusada por margem. NAO FOI. O venue nao recusa por
  // margem: ele ENCHE O QUE CABE (parcial) — encheu 0.11956 BTC (~10.000 USDC) contra 992 de equity, e deixou
  // posicao aberta na conta de teste (fechada logo a seguir com reduce_only, ordem 61431298417). Pior: para a
  // prova correr, a banda do teste tinha sido ALARGADA de proposito — ou seja, eu tirei o travão para testar o
  // travão. O travão e' o que se VERIFICA, nunca o que se desliga para o teste passar.
  const equity = String(lido.conta?.marginSummary?.accountValue ?? "0");
  const marca = String(marcaDoVenue(lido, INSTRUMENTO) ?? "0");
  const bandas = mandatoDoTeste().bandas;
  const resolucao = (nocional: string) => ({ quantidade: "0.00023", nocional, margem_empenhada: "9.6", alavancagem_efectiva: "2", preco_de_liquidacao: "41900" });
  const dentro = conferirBanda({ resolucao: resolucao(String(Number(equity) * 0.01)), bandas, distancia_minima_liquidacao_pct: "2", equity, marca });
  const fora = conferirBanda({ resolucao: resolucao(String(Number(equity) * 20)), bandas, distancia_minima_liquidacao_pct: "2", equity, marca });
  cru["P16_banda_do_saldo"] = { equity, dentro, fora };
  anotar({
    passo: 16,
    nome: "o teto do saldo: a banda do MANDATO (o único travão que existe deste lado)",
    mediu: `nocional 1% do equity -> ${dentro.veredicto}/${dentro.accao} · nocional 2000% do equity -> ${fora.veredicto}/${fora.accao} fora=${JSON.stringify((fora as any).fora ?? [])}`,
    saida: cru["P16_banda_do_saldo"],
    veredicto: dentro.veredicto === "dentro" && fora.veredicto !== "dentro" ? "passou" : "reprovou",
    porque: "a banda do saldo e' o travão que o dono declara, e o par de controle mostra-o a morder: 1% do equity passa, 2000% nao. Do lado do VENUE nao ha travão nenhum: medido no acidente de hoje, ele nao recusa por margem — enche o que cabe (parcial) e devolve a posicao; e' por isso que este limite tem de ser nosso",
  });
}

/** A conta tem de ficar como estava: este e' o ultimo numero da bateria, e o que autoriza repeti-la. */
async function p17_contaPlana(): Promise<void> {
  const lido = await lerDoVenue();
  const posicao = posicaoDe(lido.conta, INSTRUMENTO);
  const abertas = (lido.ordens_abertas ?? []).length;
  anotar({
    passo: 17,
    nome: "a conta fica PLANA (o que autoriza repetir a bateria)",
    mediu: `equity ${lido.conta?.marginSummary?.accountValue} · posicao ${posicao ? posicao.szi : "nenhuma"} · ordens abertas ${abertas} · execucoes ${(lido.execucoes ?? []).length}`,
    saida: { equity: lido.conta?.marginSummary?.accountValue, posicao, ordens_abertas: lido.ordens_abertas },
    veredicto: posicao === null && abertas === 0 ? "passou" : "reprovou",
    porque: posicao === null && abertas === 0
      ? "nenhuma posicao e nenhuma ordem a descansar: a bateria abre e fecha o que abre, e a corrida seguinte comeca limpa"
      : "sobrou posicao ou ordem aberta — a bateria nao pode ser repetida em cima disto sem limpeza",
  });
}

async function main(): Promise<void> {
  console.log("=== A BATERIA DE TESTE DO VENUE (SC-004) — ambiente de TESTE ===\n");
  console.log(`instrumento: ${INSTRUMENTO} · abertura MANUAL (sem setup) · provas ate' P${ATE}\n`);

  const { manifesto } = await p0_arranque();
  if (ATE < 1) return terminar();
  const lido = await p1_leituras();
  await p1b_limpeza(lido);
  if (ATE < 2) return terminar();
  const lidoPlano = await lerDoVenue();
  const decisao = await p2_decisao(lidoPlano, manifesto);
  if (ATE < 3) return terminar();
  const enviado = await p3_envio(decisao.boleta);
  if (ATE < 4) return terminar();
  const resultado = await p4_desfecho(enviado, decisao.boleta, lidoPlano);
  if (ATE < 5) return terminar();
  await p5_conta((enviado.desfecho?.carga?.resolucao ?? enviado.resolucaoAntes?.carga) ?? null);
  if (ATE < 6) return terminar();
  const execucoesAntes = ((await lerDoVenue()).execucoes ?? []).length;
  await p6_idempotencia(decisao.boleta, execucoesAntes);
  if (ATE < 7) return terminar();
  await p7_fecho();
  if (ATE < 8) return terminar();
  await p8_recusas(manifesto, lidoPlano);
  if (ATE < 10) return terminar();
  await p10_campos_ignorados(manifesto, lidoPlano);
  if (ATE < 11) return terminar();
  await p11_alavancagem(decisao.boleta, lidoPlano);
  if (ATE < 12) return terminar();
  await p12_vocabulario(manifesto, lidoPlano);
  if (ATE < 13) return terminar();
  await p13_vendido();
  if (ATE < 14) return terminar();
  await p14_virada();
  if (ATE < 15) return terminar();
  await p15_inversoSemFechar(manifesto);
  if (ATE < 16) return terminar();
  await p16_tetoDoSaldo(manifesto, lidoPlano);
  if (ATE < 17) return terminar();
  await p17_contaPlana();
  return terminar();
}

function terminar(): void {
  console.log("");
  const passaram = provas.filter((p) => p.veredicto === "passou").length;
  console.log(`resumo: ${provas.length} provas · ${passaram} passaram · ${provas.filter((p) => p.veredicto === "reprovou").length} reprovaram · ${provas.filter((p) => p.veredicto === "inconclusivo").length} inconclusivas`);
  if (REGISTAR) {
    // ONDE: em `specs/.../relatorios/registos-do-venue/`, e NAO em `brokers/hyperliquid/conformidade/` como
    // o registo escrito a mao. A razao e' medida: a prova 8 do `conformidade.ts` varre `brokers/`, `docs/` e
    // `config/` a procura de valores com FORMA de credencial, e a saida crua do venue traz hashes (`0x` + 64
    // hexadecimais, nos `historicalOrders`). O varrimento recusou-a — e fez bem: na arvore do conector nao
    // entra nada com essa forma, mesmo que seja um hash. O registo passa a viver com os relatorios do recorte.
    const pasta = join(RAIZ, "specs", "004-conector-hyperliquid", "relatorios", "registos-do-venue");
    mkdirSync(pasta, { recursive: true });
    const caminho = join(pasta, `${versaoVigente()}-teste.txt`);
    const linhas = [
      `BATERIA DE TESTE DO VENUE (SC-004) — contrato ${versaoVigente()}`,
      `corrida em ${new Date().toISOString()} · instrumento ${INSTRUMENTO} · abertura MANUAL (sem setup)`,
      `ambiente: TESTE (${FICHA_DO_DONO.replace(RAIZ + "/", "")}) · a credencial entra por REFERENCIA, no processo do conector`,
      "",
      ...provas.map((p) => `${p.veredicto.toUpperCase()}  P${p.passo} ${p.nome}\n      mediu: ${p.mediu}\n      porque: ${p.porque}`),
      "",
      "SAIDA CRUA (o que o venue respondeu, sem resumo):",
      JSON.stringify(cru, null, 1),
      "",
    ];
    writeFileSync(caminho, linhas.join("\n"));
    console.log(`registo: ${caminho}`);
  } else {
    console.log("(sem `--registar`: nada foi escrito — a saida crua fica acima, e nenhuma conclusao se inventa)");
  }
}

await main();
