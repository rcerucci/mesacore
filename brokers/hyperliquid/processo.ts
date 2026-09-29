// A PORTA DE PROCESSO do conector Hyperliquid: o executavel (FR-019).
//
// Este ficheiro tem o `stdio` — e so ele. A maquina (o arranque pelas portas, a traducao, a resolucao, o
// desfecho) vive em `conector.ts`; aqui decide-se de onde vem cada coisa e para onde vai cada linha:
//
//   * STDOUT e a COSTURA: so linhas de envelope (uma mensagem por linha). Nada de banners nem de diagnostico —
//     quem le a costura le mensagens, e uma linha de mais faz o outro lado ler a mensagem errada.
//   * STDERR e o DIAGNOSTICO: uma linha de JSON por etapa (as portas do arranque, a conta lida, o envio, o
//     desfecho). E onde vive o PORQUE, que o contrato nao tem campo para transportar.
//
// Quatro modos, e todos dizem o que fazem:
//
//   1. SERVIR (por omissao): arranca, cumpre as portas, e atende as mensagens que chegam pelo `stdin` ate ao
//      fim do cano. Arrancado pelo vigia, com uma ficha: uma ligacao, uma chave (FR-019).
//        bun run brokers/hyperliquid/processo.ts --casos <ficheiro> --ficha base --venue base
//
//   2. BANCADA (`--bancada`): corre os casos do ficheiro, UM processo por caso (arranca o proprio processo, como
//      o duble da mesa o arranca), confere as linhas contra o contrato, a ORDEM das portas e o diagnostico, e
//      corre as provocacoes negativas do proprio conferidor. Sai 1 se houver divergencia.
//        bun run brokers/hyperliquid/processo.ts --casos <ficheiro> --bancada
//
//   3. SONDA (`--so-sonda`): arranca sem ler a CHAVE (a porta da chave fica declarada como NAO CORRIDA) e
//      imprime o manifesto no envelope. E o modo com que se mede um venue a serio sem assinar nada — e este
//      modo NAO serve boletas (quem nao pode assinar nao pode encomendar).
//        bun run brokers/hyperliquid/processo.ts --casos <ficheiro> --ficha base --ao-vivo --so-sonda
//
//   4. HISTORICO (`--historico <coin>`): le o HISTORICO do venue do instrumento (execucoes, taxas, funding,
//      resultado realizado) e escreve na costura a linha que o contrato aceitar — ou a RECUSA NOMEADA, quando
//      o venue nao publica uma grandeza que o contrato exige (FR-018/FR-019: o que o venue nao diz fica
//      desconhecido, e nao se reconstroi). Existe porque o CONTRATO NAO TEM TIPO DE MENSAGEM PARA PEDIR O
//      HISTORICO: sem pedido possivel, este modo e o caminho de fora para a mesma leitura. Nao assina nada.
//        bun run brokers/hyperliquid/processo.ts --casos <ficheiro> --ficha base --ao-vivo --historico BTC
//
// O veneno de teste: `--defeito <nome>` (classificacao | sem_motivo | versao) faz o processo responder uma
// mensagem DEFEITUOSA DE PROPOSITO, para a bancada provar que o outro lado a apanha. Sem esta bandeira, cada
// linha que sai e conferida contra o contrato antes de sair.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";
import {
  PORTAS_DO_PROCESSO,
  arrancar,
  atender,
  servirHistorico,
  type Bateria,
  type EstadoDoProcesso,
  type Ficha,
  type Porta,
} from "./conector.ts";
import {
  portaDoCliente as portaDeLeituraDoCliente,
  type ClienteDeLeitura,
} from "./sonda.ts";
import { portaDoCliente as portaDeContaDoCliente, type ClienteDeConta } from "./leitura.ts";
import {
  portaDoCliente as portaDeHistoricoDoCliente,
  type ClienteDeHistorico,
} from "./historico.ts";

const RAIZ = join(import.meta.dir, "..", "..");
const CASOS_POR_OMISSAO = join(import.meta.dir, "casos", "processo.casos.json");

const USO = `uso:
  bun run brokers/hyperliquid/processo.ts --casos <ficheiro> [--ficha <nome|@caminho>] [--venue <variante>]
        [--prazo-do-venue-ms <ms>] [--manifesto-em <caminho>] [--ao-vivo] [--so-sonda] [--defeito <nome>]
  bun run brokers/hyperliquid/processo.ts --casos <ficheiro> --ao-vivo --historico <instrumento> [--desde-ms <ms>]
  bun run brokers/hyperliquid/processo.ts --casos <ficheiro> --bancada

  --ficha <nome>      a ficha do processo, declarada em \`fichas\` do ficheiro de casos
  --ficha @<caminho>  a ficha lida da configuracao do dono (config/contas/*.json), como o vigia a entrega
  --venue <variante>  o duble do venue, declarado em \`venues\` do ficheiro de casos (por omissao: base)
  --ao-vivo           fala com o venue a serio (SDK), so LEITURAS: este modo nao assina nada
  --so-sonda          arranca sem ler a chave, publica o manifesto e sai (nao serve boletas)
  --historico <coin>  le o HISTORICO do venue (execucoes, taxas, funding, resultado) do instrumento e sai:
                      escreve na costura a linha que o contrato aceitar, ou a RECUSA NOMEADA (FR-018)
  --desde-ms <ms>     a janela DECLARADA do historico (por omissao: sem janela, o que o venue devolver)
  --bateria <nome>    a bateria de conformidade declarada em \`venues.<nome>.bateria\` (FR-027)
  --defeito <nome>    classificacao | sem_motivo | versao — responde mal DE PROPOSITO (prova negativa)
  --bancada           corre os casos deste ficheiro e sai`;

function morrer(mensagem: string): never {
  console.error(JSON.stringify({ etapa: "uso", erro: mensagem }));
  process.exit(2);
}

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function bandeira(nome: string): boolean {
  return process.argv.includes(nome);
}

function lerJson(caminho: string): any {
  return JSON.parse(readFileSync(caminho, "utf8"));
}

// ---------------------------------------------------------------------------------------------------------
// O ficheiro de casos: fichas, venues e casos.
// ---------------------------------------------------------------------------------------------------------

type Casos = any;

/** Resolve uma variante de venue, herdando de `base` o que ela nao declarar.
 *
 * A heranca funde UM nivel nos MAPAS de leitura (`conta`, `sonda`, `apos_o_envio`, `envio`): uma variante que
 * declare `conta.activo` continua a herdar `conta.perpetuo`. Fora desses mapas, a declaracao da variante
 * SUBSTITUI a da base — e o caso da `bateria`: uma bateria que mediu cinco dos seis campos tem de poder
 * declarar cinco, sem a base lhe devolver o sexto por baixo.
 */
const MAPAS_DE_LEITURA = ["conta", "sonda", "apos_o_envio", "envio"];

function fundirUmNivel(base: any, mudanca: any): any {
  const saida: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(mudanca ?? {})) {
    const antes = saida[k];
    const fundeEste = MAPAS_DE_LEITURA.includes(k);
    if (
      fundeEste &&
      typeof v === "object" && v !== null && !Array.isArray(v) &&
      typeof antes === "object" && antes !== null && !Array.isArray(antes)
    ) {
      saida[k] = { ...(antes as Record<string, unknown>), ...(v as Record<string, unknown>) };
    } else {
      saida[k] = v;
    }
  }
  return saida;
}

/** Resolve uma variante de venue, herdando de `base` o que ela nao declarar. */
function resolverVenue(casos: Casos, nome: string): any {
  const variante = casos.venues?.[nome];
  if (variante === undefined) morrer(`nao ha variante de venue \`${nome}\` no ficheiro de casos`);
  if (variante.herda === undefined) return variante;
  const base = casos.venues[variante.herda];
  if (base === undefined) morrer(`a variante \`${nome}\` herda de \`${variante.herda}\`, que nao existe`);
  return fundirUmNivel(resolverVenue(casos, variante.herda), variante);
}

/** Resolve uma ficha: uma variante do ficheiro de casos, ou a configuracao do dono (`@caminho`). */
function resolverFicha(casos: Casos, nome: string): Ficha {
  if (nome.startsWith("@")) {
    const caminho = nome.slice(1);
    const c = lerJson(caminho);
    // A configuracao do dono nao declara a versao do contrato que o conector fala: quem a sabe e o contrato
    // (contracts/versao.json). O campo vai preenchido com a VIGENTE e o diagnostico diz de onde veio.
    return {
      conector: c?.conta?.conectores?.[0] ?? c?.conta?.corretora ?? "?",
      contrato: versaoVigente(),
      versao_do_conector: "0.1.0",
      venue: {
        nome: c?.conta?.corretora ?? "?",
        ambiente: c?.conexao?.ambiente ?? "?",
        url_da_api: c?.conexao?.url_da_api ?? "",
      },
      conta: c?.conta?.identificador ?? "",
      credencial: {
        referencia: c?.conta?.credencial ?? "",
        valor_em: c?.conexao?.credencial?.valor_em ?? "",
      },
      instrumentos: c?.instrumentos ?? ["BTC"],
    };
  }
  const ficha = casos.fichas?.[nome];
  if (ficha === undefined) morrer(`nao ha ficha \`${nome}\` no ficheiro de casos`);
  return ficha as Ficha;
}

// ---------------------------------------------------------------------------------------------------------
// A porta do venue: o DUBLE (declarado em dado) ou o SDK, ao vivo.
// ---------------------------------------------------------------------------------------------------------

type Resposta = { ok: true; valor: unknown } | { ok: false; erro: string };

function resposta(v: unknown): Resposta {
  if (typeof v === "object" && v !== null && Object.prototype.hasOwnProperty.call(v, "__erro__")) {
    return { ok: false, erro: String((v as Record<string, unknown>).__erro__) };
  }
  return { ok: true, valor: v };
}

/**
 * A porta do DUBLE do venue.
 *
 * O duble declara TRES momentos de leitura, e e isso que permite provar o que o processo faz quando uma leitura
 * falha a MEIO: `conta` (o arranque, rodada 1), `conta_apos_o_pedido` (da rodada 2 em diante, antes do envio) e
 * `apos_o_envio[referencia]` (depois de a ordem ter saido). Uma leitura declarada a falhar responde com ERRO —
 * e o processo diz que nao leu, em vez de servir o valor anterior (FR-017).
 *
 * As leituras do HISTORICO (FR-018) vivem em `historico.<leitura>` — a mesma regra: o que o duble nao
 * declarar NAO vira resposta vazia, vira falha dita (uma lista vazia e uma declaracao do venue, e tem de ser
 * declarada como tal).
 */
function portaDoDuble(dados: any): Porta {
  let rodada = 0;
  let enviado = false;
  let referenciaEnviada: string | null = null;

  function fonteDaConta(): any {
    if (enviado) {
      const depois = referenciaEnviada !== null ? dados.apos_o_envio?.[referenciaEnviada] : undefined;
      if (depois !== undefined) return depois;
    }
    if (rodada >= 2 && dados.conta_apos_o_pedido !== undefined) return dados.conta_apos_o_pedido;
    return dados.conta ?? {};
  }

  const sondaDe = (chave: string): Resposta => {
    const v = dados.sonda?.[chave];
    if (v === undefined) {
      // Uma leitura que o duble nao declara nao vira «resposta vazia»: vira FALHA declarada, e o processo diz
      // que nao leu (a mesma regra do `envio`).
      throw new Error(`o duble do venue nao declara a leitura publica \`${chave}\``);
    }
    return resposta(v);
  };

  /** Uma leitura do HISTORICO declarada pelo duble (`historico.<chave>`) — ou falha dita, como as da sonda. */
  const historicoDe = (chave: string): Resposta => {
    const v = dados.historico?.[chave];
    if (v === undefined) {
      throw new Error(
        `o duble do venue nao declara a leitura do historico \`historico.${chave}\`: uma leitura nao declarada ` +
          "nao vira resposta vazia (FR-018)",
      );
    }
    return resposta(v);
  };

  return {
    leitura: {
      meta: async () => {
        const r = sondaDe("meta");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      metaEContextos: async () => {
        const r = sondaDe("meta_e_ctxs");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      fundingsPrevistos: async () => {
        const r = sondaDe("fundings_previstos");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      livro: async () => {
        const r = sondaDe("livro");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      velas: async () => {
        const r = sondaDe("velas");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      estadoDaExchange: async () => {
        const r = sondaDe("estado_da_exchange");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      activoDaConta: async () => {
        const r = sondaDe("activo_da_conta");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      ordensHistoricas: async () => {
        const r = sondaDe("ordens_historicas");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      execucoes: async () => {
        const r = sondaDe("execucoes");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
    },
    conta: {
      contaPerpetuo: async () => {
        rodada += 1; // a conta perpetua abre a rodada: e sempre a primeira leitura de `lerDoVenueDaConta`
        const r = resposta(fonteDaConta().perpetuo);
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      contaSpot: async () => {
        const r = resposta(fonteDaConta().spot);
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      activoDaConta: async () => {
        const r = resposta(fonteDaConta().activo ?? dados.conta?.activo);
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      agentesDaConta: async () => {
        const r = resposta(fonteDaConta().agentes ?? dados.conta?.agentes);
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
    },
    historico: {
      execucoes: async () => {
        const r = historicoDe("execucoes");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      ordensHistoricas: async () => {
        const r = historicoDe("ordens");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      taxasDaConta: async () => {
        const r = historicoDe("taxas");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      fundingDaConta: async () => {
        const r = historicoDe("funding_da_conta");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
      fundingPublicado: async () => {
        const r = historicoDe("funding_publicado");
        if (!r.ok) throw new Error(r.erro);
        return r.valor;
      },
    },
    envio: {
      enviar: async (_accao: unknown, _conta: string, referencia?: string) => {
        if (referencia === undefined || referencia === null) {
          throw new Error("o duble do venue nao sabe a que referencia responde: a boleta nao trouxe `referencia_do_cliente`");
        }
        const r = dados.envio?.[referencia];
        if (r === undefined) {
          // NAO ha resposta declarada: e um buraco do DUBLE, e diz-se. Nenhum caso pode chegar ao venue sem ter
          // a resposta declarada — se chegasse, o processo estaria a enviar as cegas.
          throw new Error(
            `o duble do venue nao declara resposta para a referencia ${referencia}: ou o caso nao devia chegar ao ` +
              "envio, ou falta a resposta no ficheiro de casos",
          );
        }
        enviado = true;
        referenciaEnviada = referencia;
        if (r.sem_resposta === true) return new Promise<Resposta>(() => {}); // o venue nao responde: o prazo decide
        if (typeof r.atraso_ms === "number") await new Promise((s) => setTimeout(s, r.atraso_ms));
        return { ok: true, valor: r };
      },
    },
  };
}

/** A porta do venue AO VIVO: o SDK oficial, so LEITURAS. Nao ha envio vivo neste recorte (exige assinar). */
async function portaAoVivo(ficha: Ficha): Promise<Porta> {
  const modulo = await import("@nktkas/hyperliquid");
  const isTestnet = ficha.venue.ambiente !== "producao";
  const transporte = new modulo.HttpTransport({ isTestnet });
  const info = new modulo.InfoClient({ transport: transporte });
  const cliente = info as unknown as ClienteDeLeitura & ClienteDeConta & ClienteDeHistorico;
  return {
    leitura: portaDeLeituraDoCliente(cliente),
    conta: portaDeContaDoCliente(cliente),
    // O historico (FR-018): as cinco leituras que o venue publica. A leitura e so isso — nenhuma assina nada.
    historico: portaDeHistoricoDoCliente(cliente),
    envio: {
      enviar: async () => {
        throw new Error(
          "o envio AO VIVO nao esta implementado nesta porta de processo: exige ASSINAR, e assinar sem a bateria " +
            "de conformidade ter medido o venue seria encomendar as cegas. O envio esta provado contra o duble do venue",
        );
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// O diagnostico: uma linha de JSON por etapa, no STDERR (a costura fica so com mensagens).
// ---------------------------------------------------------------------------------------------------------

function diag(o: Record<string, unknown>): void {
  console.error(JSON.stringify(o));
}

function imprimirPortas(estado: { portas: EstadoDoProcesso["portas"] }): void {
  for (const p of estado.portas) {
    diag({ porta: p.porta, veredicto: p.veredicto, ...(p.motivo ? { motivo: p.motivo } : {}), porque: p.porque });
  }
}

// ---------------------------------------------------------------------------------------------------------
// O modo SERVIR: arranca e atende o `stdin` ate ao fim do cano.
// ---------------------------------------------------------------------------------------------------------

async function servir(args: {
  casos: Casos;
  ficha: Ficha;
  porta: Porta;
  bateria: Bateria;
  semChave: boolean;
  prazoDoVenueMs?: number;
  manifestoEm?: string;
  soSonda?: boolean;
  /** O modo de LEITURA do historico (`--historico <instrumento>`): le o venue, serve a linha que o contrato
   *  aceitar — ou a recusa NOMEADA — e sai. Nada se assina e nenhuma ordem sai por este caminho. */
  historicoDoInstrumento?: string;
}): Promise<void> {
  const portas = bandeira("--sem-chave") ? { sem_chave: true } : {};
  const arranque = await arrancar(
    {
      ficha: args.ficha,
      enderecos: args.casos.enderecos_do_venue,
      porta: args.porta,
      bateria: args.bateria,
      instante_ms: Date.now(),
    },
    { ...portas, sem_chave: args.semChave },
  );

  if (!arranque.ok) {
    imprimirPortas(arranque);
    diag({
      etapa: "arranque",
      veredicto: "recusado",
      porta_que_falhou: arranque.porta,
      motivo: arranque.motivo,
      porque: arranque.porque,
      nota: "o processo NAO sobe: um conector que arranca a fingir e pior do que um conector que nao arranca",
    });
    process.exit(2);
  }

  const estado = arranque.estado;
  imprimirPortas(estado);
  diag({
    etapa: "manifesto_publicado",
    id: `${estado.ficha.conector}/manifesto`,
    versao: estado.manifesto.versao,
    instrumentos: (estado.manifesto.instrumentos as unknown[]).length,
    tipos_de_ordem: estado.manifesto.tipos_de_ordem,
    idempotencia: estado.manifesto.idempotencia,
    marca_de_posse: estado.manifesto.marca_de_posse,
    estado_da_ligacao: estado.estado_da_ligacao,
    carteiras_nao_lidas: estado.carteiras.nao_lidas,
    credencial_de: estado.credencial?.de ?? "(nao lida neste modo)",
  });
  if (args.manifestoEm !== undefined) {
    writeFileSync(args.manifestoEm, estado.linha_do_manifesto + "\n", "utf8");
    diag({ etapa: "manifesto_escrito", caminho: args.manifestoEm });
  }

  if (args.soSonda === true) {
    process.stdout.write(estado.linha_do_manifesto + "\n");
    diag({ etapa: "sonda", veredicto: "publicado", nota: "modo de sonda: nenhuma boleta e servida, nada foi assinado" });
    process.exit(0);
  }

  // ---------------------------------------------------------------------------------------------------------
  // O MODO DE LEITURA DO HISTORICO (`--historico <instrumento>`), FR-018/RN-H14.
  //
  // Existe por uma razao MEDIDA, e nao por conveniencia: o contrato NAO tem tipo de mensagem para PEDIR o
  // historico (o `historico` do envelope exige instrumento, moeda, instante e execucoes — a forma de uma
  // RESPOSTA). Sem um pedido possivel, a leitura so se exerceria por dentro; este modo da o MESMO caminho
  // de fora, como o `--so-sonda` faz com o manifesto. Ele le o venue e escreve na costura a linha que o
  // contrato aceitar — ou a recusa NOMEADA, com a razao e a lista do que o venue nao publica. Nao assina
  // nada e nao envia ordem nenhuma.
  // ---------------------------------------------------------------------------------------------------------
  if (args.historicoDoInstrumento !== undefined) {
    const desde = argumento("--desde-ms");
    const r = await servirHistorico(
      `${estado.ficha.conector}/historico`,
      args.historicoDoInstrumento,
      estado,
      args.porta,
      desde !== undefined ? { inicio_ms: Number(desde) } : {},
    );
    for (const d of r.diag) diag(d);
    for (const l of r.linhas) process.stdout.write(l + "\n");
    diag({
      etapa: "historico",
      veredicto: r.linhas.length > 0 ? "servido" : "sem_resposta",
      instrumento: args.historicoDoInstrumento,
      janela: desde !== undefined ? `desde ${desde} ms (declarada)` : "sem janela declarada (o que o venue devolver)",
      nota: "modo de leitura: nada foi assinado e nenhuma ordem foi enviada (FR-018: o historico e do venue, nao se reconstroi)",
    });
    process.exit(0);
  }

  const contador = { atendidas: 0 };
  async function atenderLinha(linha: string): Promise<void> {
    if (linha.trim() === "") return;
    contador.atendidas += 1;
    const r = await atender(linha, estado, args.porta, {
      prazo_do_venue_ms: args.prazoDoVenueMs,
      defeito: argumento("--defeito"),
    });
    for (const d of r.diag) diag(d);
    for (const l of r.linhas) process.stdout.write(l + "\n");
    if (r.linhas.length === 0) {
      diag({ etapa: "costura", veredicto: "sem_resposta", nota: "nenhuma linha saiu: o outro lado fica em ESPERA, nunca em sucesso" });
    }
  }

  // Linha a linha, com o cano ABERTO: quem fala com o processo nao tem de o fechar para ser ouvido.
  const decodificador = new TextDecoder();
  let resto = "";
  for await (const pedaco of Bun.stdin.stream()) {
    resto += decodificador.decode(pedaco, { stream: true });
    let corte = resto.indexOf("\n");
    while (corte >= 0) {
      const linha = resto.slice(0, corte);
      resto = resto.slice(corte + 1);
      await atenderLinha(linha);
      corte = resto.indexOf("\n");
    }
  }
  if (resto.trim() !== "") await atenderLinha(resto);
  diag({ etapa: "fim", atendidas: contador.atendidas, nota: "o cano fechou: nenhuma operacao fica nas maos deste processo" });
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------
// O modo BANCADA: um processo por caso, e o conferidor com dentes.
// ---------------------------------------------------------------------------------------------------------

type Saida = { nome: string; linhas: string[]; erros: string[]; portas: Record<string, unknown>[]; codigo: number };

function conferirMensagem(texto: string, tipoEsperado: string): { veredicto: string; motivo: string | null } {
  const decisao = validar(texto);
  if (decisao.veredicto !== "aceite") return { veredicto: decisao.veredicto, motivo: decisao.motivo };
  let bruto: any;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { veredicto: "recusado", motivo: "enquadramento_invalido" };
  }
  if (bruto?.tipo !== tipoEsperado) return { veredicto: "recusado", motivo: "tipo_invalido" };
  return { veredicto: "aceite", motivo: null };
}

function correrUmProcesso(args: {
  caminhoDosCasos: string;
  ficha: string;
  venue: string;
  boleta: unknown | null;
  credencialDeTeste: string;
  prazoDoVenueMs?: number;
  defeito?: string;
  soSonda?: boolean;
}): Saida {
  const comando = [
    "bun",
    "run",
    join(import.meta.dir, "processo.ts"),
    "--casos",
    args.caminhoDosCasos,
    "--ficha",
    args.ficha,
    "--venue",
    args.venue,
    ...(args.prazoDoVenueMs !== undefined ? ["--prazo-do-venue-ms", String(args.prazoDoVenueMs)] : []),
    ...(args.soSonda === true ? ["--so-sonda"] : []),
    ...(args.defeito !== undefined ? ["--defeito", args.defeito] : []),
  ];
  const p = spawnSync(comando[0]!, comando.slice(1), {
    input: args.boleta === null ? "" : JSON.stringify(args.boleta) + "\n",
    encoding: "utf8",
    cwd: RAIZ,
    env: { ...process.env, MESACORE_DUBLE_CREDENCIAL: args.credencialDeTeste },
    timeout: 20000,
  });
  const linhas = (p.stdout ?? "").split("\n").filter((l) => l.trim() !== "");
  const erros = (p.stderr ?? "").split("\n").filter((l) => l.trim() !== "");
  const portas: Record<string, unknown>[] = [];
  for (const e of erros) {
    try {
      const o = JSON.parse(e);
      // Uma linha e de PORTA quando traz as DUAS coisas: o nome da porta e um veredicto da lista fechada. A
      // linha final do arranque (a que diz porque o processo nao subiu) traz o motivo, e nao traz `porta`.
      if (
        o !== null &&
        typeof o === "object" &&
        typeof (o as any).porta === "string" &&
        ["passou", "falhou", "nao_corrida"].includes((o as any).veredicto)
      ) {
        portas.push(o);
      }
    } catch {
      /* uma linha de diagnostico que nao e JSON fica no registo bruto, e nao conta como porta */
    }
  }
  return { nome: "", linhas, erros, portas, codigo: p.status ?? -1 };
}

function correrBancada(caminhoDosCasos: string, casos: Casos): number {
  const portasDoCodigo = PORTAS_DO_PROCESSO.map((p) => p.porta);
  const portasDoDado = casos.arranque?.portas ?? [];
  const credencialDeTeste = `duble-${process.pid}-${Date.now()}-nao-e-chave-nenhuma`;

  let verificacoes = 0;
  const verificar = (problemas: string[], condicao: boolean, mensagem: string): void => {
    verificacoes += 1;
    if (!condicao) problemas.push(mensagem);
  };

  // A ordem declarada no dado tem de ser IGUAL a do codigo: duas listas da mesma coisa divergem se ninguem as
  // confrontar, e a bancada e quem as confronta.
  const problemasDaOrdem: string[] = [];
  verificar(
    problemasDaOrdem,
    JSON.stringify(portasDoCodigo) === JSON.stringify(portasDoDado),
    `a ordem declarada em \`arranque.portas\` do ficheiro de casos nao e igual a PORTAS_DO_PROCESSO do codigo: dado ${JSON.stringify(portasDoDado)}, codigo ${JSON.stringify(portasDoCodigo)}`,
  );
  verificar(
    problemasDaOrdem,
    casos.contrato_vigente === versaoVigente(),
    `o ficheiro de casos declara o contrato ${JSON.stringify(casos.contrato_vigente)} e o contrato vigente e ${JSON.stringify(versaoVigente())}: suba o ficheiro de casos com o contrato, senao esta bancada passa a medir outra coisa`,
  );

  const linhas: { caso: string; veredicto: string; esperado_ok: boolean; portas: string; problemas?: string[] }[] = [];
  const registo = new Map<string, Saida>();
  let divergentes = portasDoCodigo.length === portasDoDado.length && problemasDaOrdem.length === 0 ? 0 : 1;
  if (problemasDaOrdem.length > 0) {
    linhas.push({ caso: "arranque/ordem-das-portas", veredicto: "divergente", esperado_ok: false, portas: "", problemas: problemasDaOrdem });
  }

  const todos = [...(casos.casos ?? []), ...(casos.arranque?.casos ?? [])];
  for (const c of todos) {
    const problemas: string[] = [];
    const nome = c.nome;
    const ficha = c.ficha ?? "base";
    const venue = c.venue ?? "base";
    const boleta = c.boleta ?? null;
    const saida = correrUmProcesso({
      caminhoDosCasos,
      ficha,
      venue,
      boleta,
      credencialDeTeste,
      prazoDoVenueMs: c.prazo_do_venue_ms,
      defeito: c.defeito,
    });
    registo.set(nome, saida);

    // ---- o arranque: as portas, pela ordem, e a que caiu
    const nomesDasPortas = saida.portas.map((p) => String(p.porta));
    const declaradas = portasDoCodigo.slice(0, nomesDasPortas.length);
    verificar(problemas, JSON.stringify(nomesDasPortas) === JSON.stringify(declaradas),
      `as portas do arranque nao vieram na ordem declarada: ${JSON.stringify(nomesDasPortas)}`);
    if (c.portas_esperadas !== undefined) {
      verificar(problemas, saida.portas.length === c.portas_esperadas,
        `portas corridas: ${saida.portas.length}, esperado ${c.portas_esperadas}`);
    }
    if (c.porta_que_falha !== undefined) {
      const ultima = saida.portas[saida.portas.length - 1] as any;
      verificar(problemas, ultima?.porta === c.porta_que_falha && ultima?.veredicto === "falhou",
        `a porta que caiu foi ${JSON.stringify(ultima?.porta)}/${JSON.stringify(ultima?.veredicto)}, esperado ${c.porta_que_falha}/falhou`);
      verificar(problemas, ultima?.motivo === c.motivo_esperado,
        `motivo da porta: ${JSON.stringify(ultima?.motivo)}, esperado ${JSON.stringify(c.motivo_esperado)}`);
      verificar(problemas, saida.codigo === 2, `codigo de saida: ${saida.codigo}, esperado 2 (o processo NAO sobe)`);
      verificar(problemas, saida.linhas.length === 0, `um arranque recusado nao pode escrever na costura: saiu ${saida.linhas.length} linha(s)`);
    } else {
      verificar(problemas, saida.portas.length === portasDoCodigo.length && saida.portas.every((p: any) => p.veredicto === "passou"),
        `o arranque nao passou as sete portas: ${JSON.stringify(saida.portas.map((p: any) => `${p.porta}:${p.veredicto}`))}`);
      verificar(problemas, saida.codigo === 0, `codigo de saida: ${saida.codigo}, esperado 0`);
    }

    // ---- a costura: as linhas, contra o contrato
    if (c.linhas_esperadas !== undefined) {
      verificar(problemas, saida.linhas.length === c.linhas_esperadas,
        `linhas na costura: ${saida.linhas.length}, esperado ${c.linhas_esperadas}`);
    }
    for (const [i, linha] of saida.linhas.entries()) {
      const ultima = i === saida.linhas.length - 1;
      const esperado = ultima ? "desfecho" : "resolucao";
      const veredicto = conferirMensagem(linha, esperado);
      verificar(problemas, veredicto.veredicto === "aceite",
        `linha ${i + 1} (${esperado}) recusada pelo contrato: ${veredicto.veredicto}/${veredicto.motivo}`);
    }
    let desfecho: any = null;
    if (saida.linhas.length > 0) {
      const ultima = saida.linhas[saida.linhas.length - 1]!;
      try {
        desfecho = JSON.parse(ultima);
      } catch {
        desfecho = null;
      }
    }
    if (desfecho !== null) {
      const carga = desfecho.carga ?? {};
      const esperado = c.desfecho_esperado ?? {};
      if (esperado.classificacao !== undefined) {
        verificar(problemas, carga.classificacao === esperado.classificacao,
          `classificacao: ${JSON.stringify(carga.classificacao)}, esperado ${JSON.stringify(esperado.classificacao)}`);
      }
      if (esperado.motivo !== undefined) {
        verificar(problemas, carga.motivo === esperado.motivo, `motivo: ${JSON.stringify(carga.motivo)}, esperado ${JSON.stringify(esperado.motivo)}`);
      }
      if (esperado.resolucao !== undefined) {
        verificar(problemas, JSON.stringify(carga.resolucao) === JSON.stringify(esperado.resolucao),
          `resolucao: ${JSON.stringify(carga.resolucao)}, esperado ${JSON.stringify(esperado.resolucao)}`);
      }
      if (esperado.origem_dos_numeros !== undefined) {
        verificar(problemas, carga.resposta_do_venue?.origem_dos_numeros === esperado.origem_dos_numeros,
          `origem_dos_numeros: ${JSON.stringify(carga.resposta_do_venue?.origem_dos_numeros)}, esperado ${JSON.stringify(esperado.origem_dos_numeros)}`);
      }
      if (esperado.palavra_do_venue !== undefined) {
        verificar(problemas, carga.resposta_do_venue?.palavra_do_venue === esperado.palavra_do_venue,
          `palavra_do_venue: ${JSON.stringify(carga.resposta_do_venue?.palavra_do_venue)}, esperado ${JSON.stringify(esperado.palavra_do_venue)}`);
      }
      // O contrato: a resolucao e OBRIGATORIA fora da recusa, e proibida dentro dela (a mensagem nao pode mentir).
      if (carga.classificacao === "recusado") {
        verificar(problemas, carga.resolucao === undefined, "um desfecho recusado nao pode trazer resolucao");
        verificar(problemas, typeof carga.motivo === "string", "um desfecho recusado TEM de trazer motivo (RN-C2)");
      } else {
        verificar(problemas, carga.resolucao !== undefined, "fora da recusa, a resolucao e obrigatoria");
      }
      // A resolucao da PRIMEIRA linha e a que saiu ANTES do envio (RN-H10), e a do desfecho e a que o VENUE
      // passou a ter (RN-C10/RN-C14): sao iguais quando nada mudou, e legitimamente DIFERENTES quando o venue
      // serviu parte. Por isso cada caso declara a sua linha 1 — uma igualdade imposta a todos mediria a
      // coincidencia dos casos em que nada mudou, e nao a regra.
      if (saida.linhas.length === 2 && c.linha_1_esperada !== undefined) {
        const primeira = JSON.parse(saida.linhas[0]!);
        verificar(problemas, JSON.stringify(primeira.carga) === JSON.stringify(c.linha_1_esperada),
          `a resolucao da linha 1 (a de antes do envio) nao e a declarada: ${JSON.stringify(primeira.carga)} vs ${JSON.stringify(c.linha_1_esperada)}`);
      }
      for (const [chave, valor] of Object.entries(c.resposta_do_venue_exige ?? {})) {
        verificar(problemas, carga.resposta_do_venue?.[chave] === valor,
          `resposta_do_venue.${chave}: ${JSON.stringify(carga.resposta_do_venue?.[chave])}, esperado ${JSON.stringify(valor)}`);
      }
      // A IDEMPOTENCIA, medida: a referencia repetida tem de dar o MESMO order_id e o MESMO cloid derivado.
      if (c.mesmo_order_id_que !== undefined) {
        const outro = registo.get(c.mesmo_order_id_que);
        const outraUltima = outro !== undefined && outro.linhas.length > 0 ? JSON.parse(outro.linhas[outro.linhas.length - 1]!) : null;
        verificar(problemas, outraUltima !== null && outraUltima.carga?.resposta_do_venue?.order_id === carga.resposta_do_venue?.order_id,
          `order_id diferente do caso ${c.mesmo_order_id_que}: ${JSON.stringify(carga.resposta_do_venue?.order_id)} vs ${JSON.stringify(outraUltima?.carga?.resposta_do_venue?.order_id)}`);
      }
      if (c.mesmo_cloid_que !== undefined) {
        const outro = registo.get(c.mesmo_cloid_que);
        const cloid = (s: Saida | undefined) => s?.erros.map((e) => { try { return JSON.parse(e); } catch { return {}; } }).find((o: any) => o.cloid !== undefined)?.cloid;
        verificar(problemas, cloid(outro) !== undefined && cloid(outro) === cloid(saida),
          `o cloid derivado difere do caso ${c.mesmo_cloid_que}: ${JSON.stringify(cloid(saida))} vs ${JSON.stringify(cloid(outro))}`);
      }
    }

    const veredicto = problemas.length === 0 ? "ok" : "divergente";
    if (problemas.length > 0) divergentes += 1;
    linhas.push({
      caso: nome,
      veredicto,
      esperado_ok: problemas.length === 0,
      portas: nomesDasPortas.map((n) => `${n}:${(saida.portas.find((p) => p.porta === n) as any)?.veredicto}`).join(" > "),
      ...(problemas.length > 0 ? { problemas } : {}),
    });
  }

  // ---- o manifesto publicado: o envelope contra o contrato (US1)
  {
    const problemas: string[] = [];
    const saida = correrUmProcesso({ caminhoDosCasos, ficha: "base", venue: "base", boleta: null, credencialDeTeste, soSonda: true });
    const linha = saida.linhas[saida.linhas.length - 1];
    verificar(problemas, saida.codigo === 0, `codigo de saida da sonda: ${saida.codigo}, esperado 0`);
    verificar(problemas, linha !== undefined, "a sonda nao publicou manifesto nenhum");
    if (linha !== undefined) {
      const v = conferirMensagem(linha, "manifesto");
      verificar(problemas, v.veredicto === "aceite", `o manifesto publicado nao passou o contrato: ${v.veredicto}/${v.motivo}`);
      let bruto: any = null;
      try {
        bruto = JSON.parse(linha);
      } catch {
        bruto = null;
      }
      verificar(problemas, bruto?.carga?.versao === versaoVigente(), `o manifesto declara a versao ${JSON.stringify(bruto?.carga?.versao)}, esperado ${versaoVigente()}`);
      verificar(problemas, (bruto?.carga?.instrumentos ?? []).length > 0, "o manifesto nao declara instrumento nenhum");
      verificar(problemas, bruto?.id === "hyperliquid/manifesto", `id do manifesto: ${JSON.stringify(bruto?.id)}`);
    }
    const veredicto = problemas.length === 0 ? "ok" : "divergente";
    if (problemas.length > 0) divergentes += 1;
    linhas.push({ caso: "arranque/manifesto-publicado", veredicto, esperado_ok: problemas.length === 0, portas: "", ...(problemas.length > 0 ? { problemas } : {}) });
  }

  // ---- as provocacoes: o conferidor tem dentes?
  for (const p of casos.provocacoes?.casos ?? []) {
    const problemas: string[] = [];
    const v = conferirMensagem(JSON.stringify(p.entrada), "desfecho");
    verificar(problemas, v.veredicto === p.veredicto_esperado && v.motivo === p.motivo_esperado,
      `o conferidor devolveu ${v.veredicto}/${v.motivo} e o caso exige ${p.veredicto_esperado}/${p.motivo_esperado}: um conferidor que aceita isto nao confere nada`);
    const veredicto = problemas.length === 0 ? "ok" : "divergente";
    if (problemas.length > 0) divergentes += 1;
    linhas.push({ caso: p.nome, veredicto, esperado_ok: problemas.length === 0, portas: "", ...(problemas.length > 0 ? { problemas } : {}) });
  }

  for (const l of linhas) console.log(JSON.stringify(l));
  const total = linhas.length;
  process.stderr.write(
    `processo: ${total} casos · ${total - divergentes} ok · ${divergentes} divergentes · ${verificacoes} verificacoes · ` +
      `${portasDoCodigo.length} portas do arranque em ${JSON.stringify(portasDoCodigo)}\n`,
  );
  return divergentes === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------------------
// O arranque do executavel.
// ---------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  if (bandeira("--ajuda") || bandeira("-h")) {
    console.log(USO);
    return;
  }
  const caminhoDosCasos = argumento("--casos") ?? CASOS_POR_OMISSAO;
  if (
    !process.argv.includes("--casos") &&
    bandeira("--bancada") === false &&
    !bandeira("--so-sonda") &&
    argumento("--historico") === undefined
  ) {
    // Servir sem ficheiro de casos: usa o de omissao, e di-lo no diagnostico.
    diag({ etapa: "casos", caminho: caminhoDosCasos, nota: "nenhum --casos dado: a usar o ficheiro de casos do recorte" });
  }
  const casos = lerJson(caminhoDosCasos);

  if (bandeira("--bancada")) {
    process.exit(correrBancada(caminhoDosCasos, casos));
  }

  const nomeDaFicha = argumento("--ficha") ?? "base";
  const ficha = resolverFicha(casos, nomeDaFicha);
  const soSonda = bandeira("--so-sonda");
  const aoVivo = bandeira("--ao-vivo");

  const porta: Porta = aoVivo
    ? await portaAoVivo(ficha)
    : portaDoDuble(resolverVenue(casos, argumento("--venue") ?? "base"));

  // A bateria (FR-027): onde o venue nao publica, quem mediu foi a bateria de conformidade. Vem declarada em
  // dado — e a UNICA via por onde um numero que o venue nao deu pode entrar no manifesto.
  const varianteDaBateria = argumento("--bateria");
  const bateria: Bateria =
    varianteDaBateria !== undefined ? (resolverVenue(casos, varianteDaBateria).bateria ?? null) : (resolverVenue(casos, argumento("--venue") ?? "base").bateria ?? null);

  diag({
    etapa: "ficha",
    de: nomeDaFicha.startsWith("@") ? `configuracao do dono (${nomeDaFicha.slice(1)})` : `variante \`${nomeDaFicha}\` do ficheiro de casos`,
    conector: ficha.conector,
    ambiente: ficha.venue.ambiente,
    url: ficha.venue.url_da_api,
    instrumentos: ficha.instrumentos,
    contrato_da_ficha: ficha.contrato,
    nota: "o VALOR da credencial nao entra em linha nenhuma deste processo (FR-023)",
  });

  await servir({
    casos,
    ficha,
    porta:
      // No modo de sonda o duble do venue ainda nao sabe a referencia (nao ha boleta): a porta de envio fica sem
      // resposta declarada, e qualquer envio nesse modo e um defeito do proprio caso.
      porta,
    bateria,
    // A porta da CHAVE nao se corre no modo de historico: a leitura do historico nao assina nada e o venue
    // publica-a a quem pergunta. Um processo que le a chave para nao a usar arrisca-a sem ganho nenhum.
    semChave: soSonda || argumento("--historico") !== undefined,
    prazoDoVenueMs: argumento("--prazo-do-venue-ms") !== undefined ? Number(argumento("--prazo-do-venue-ms")) : undefined,
    manifestoEm: argumento("--manifesto-em"),
    soSonda,
    historicoDoInstrumento: argumento("--historico"),
  });
}

if (import.meta.main) {
  main().catch((e) => {
    diag({ etapa: "falha", erro: e instanceof Error ? e.message : String(e) });
    process.exit(3);
  });
}
