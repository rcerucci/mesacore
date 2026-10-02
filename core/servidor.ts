#!/usr/bin/env bun
// A PORTA DE PROCESSO DA MESA: uma linha entra, uma linha sai. Nada mais - com UMA excepcao declarada:
// em `encerrando` saem DUAS (a resposta e a pergunta do encerramento, FR-013 a FR-015), porque a resposta
// diz o que mudou e a pergunta diz o que se espera do dono. Juntar as duas numa so obrigaria o contrato a
// alargar o tipo de resposta com campos que so o encerramento usa.
//
// O que esta porta NAO faz, e por que:
//
//   - NAO decide. Valida a MENSAGEM (o contrato: enquadramento, versao, forma) e entrega a carga ao
//     interprete da mesa (`Mesa.receber`), que e quem conhece a tabela. Nao ha aqui um `if` de regra.
//   - NAO tem log proprio. A transicao vai na resposta; quem guarda e quem comanda (`.vigia.json`).
//     Duas contabilidades do mesmo facto divergem - e a que fica escondida e a que mente.
//   - NAO le configuracao. A mesa le a que precisa; uma segunda leitura e uma segunda verdade.
//   - NAO se cala. Mensagem invalida, versao errada, verbo desconhecido: sai SEMPRE resposta com motivo.
//     Silencio obrigaria o vigia a adivinhar - e adivinhar e a unica forma de comandar uma mesa errada.
//
// O instante da resposta e carimbado AQUI, com o relogio da mesa (RN-M4.9: quem recebe e que carimba).
//
// DUAS VERDADES QUE A MESA NAO TIRA DE SI - e o que esta porta faz quando nao as tem:
//
//   1. AS SEIS PORTAS DO ARRANQUE. Elas precisam da configuracao, do manifesto, do registo de operacao e
//      do conferidor de inventario - quarto coisas que nao nascem dentro desta porta. Enquanto o vigia
//      nao as trouxer na lingua das portas (T021), entram por `--portas <ficheiro.json>`. SEM esse
//      ficheiro o `start` RECUSA, nomeando a porta "(nao conferidas)".
//      ATE 29/09/2026 esta recusa era o PALIATIVO de um buraco da tabela (a guarda `portas_do_arranque_falham`
//      exigia `passam === false`, e o vazio valia como "as portas passaram"). Fechado o D-006, a TABELA tem
//      guarda propria para o desconhecido (`portas_do_arranque_nao_conferidas`) e recusa-o ela mesma; a
//      porta continua a recusar mais cedo - e' ela que tem o ficheiro - e ja nao e' a unica que segura isto.
//   2. A POSICAO VIVA. Ela le-se da corretora, e as marcas nao tem posicao de propositio (RN-T16.1). Por
//      `--posicao-viva true|false`: e o unico jeito de a mesa saber. Sem ela, ou com `true`, o `stop`
//      RECUSA com `posicao_desconhecida` - porque o caminho `encerrando` (o resumo e a pergunta) e o US3,
//      e entrar em `encerrando` sem perguntar seria pior do que nao parar.
//      A SONDA DA TABELA (logo abaixo, na decisao) e a mesma coisa pela outra ponta: pergunta-se a tabela
//      com os DOIS valores e recusa-se so quando a resposta MUDA. Desde 29/09/2026 (D-006) a tabela tem
//      linha propria para o desconhecido (`posicao_viva_desconhecida`), e e por isso que a sonda passou a
//      ser redundante - fica porque nao mente, e porque a porta nao delega uma decisao que sabe fazer.
//
// O RELOGIO. A mesa NAO vive da costura: uma mesa em operacao continua a operar com o vigia morto
// (FR-006/RN-V6), e por isso tem um relogio proprio (`--tick`), armado no arranque e NAO desligado pelo fim
// da entrada. Quem o desliga e o estado: `parada` nao tem operacao para defender, e a volta nao decide.
// `pausada` CICLA - a pausa suspende abrir e mais nada (RN-V2.1).
//
// Uso:  echo '<mensagem>' | bun run core/servidor.ts [--uma-linha] [--portas f.json] [--posicao-viva false]
//                                                  [--marcas f.json] [--registo f.jsonl]
//        [--tick <ms> --operacao f.json --config f.json]   # liga o relogio (a mesa opera sozinha)

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { validar, versaoVigente } from "../contracts/esqueleto/framing.ts";
import { Mesa, type ContextoDaMesa } from "./mesa.ts";
import { aplicar, verbosDeclarados } from "./estados/maquina.ts";
import { haInibicao, lerMarcas } from "./estado/marcas.ts";
import { motivoConhecido } from "./livro-de-motivos.ts";
import { conferirMandatos, correrUmCiclo, lerOperacao, semearTravosDeBarra } from "./ciclo/relogio.ts";
import { cargaDaPergunta, NUMEROS_DA_CORRETORA, type NumerosDaCorretora } from "./ciclo/encerramento.ts";
import type { ConfiguracaoDaConta } from "./config/configuracao.ts";
import type { ConfiguracaoEmVigor } from "./estado/marcas.ts";
import { barrasDasUltimasEntradas, registarMudancaDeMandato, ultimaTransicaoPara } from "./estado/registo.ts";

/** O contrato recusa a MENSAGEM; a mesa fala dos seus motivos. Nada atravessa sem nome de um dos dois. */
export const TRADUCAO: Record<string, string> = {
  versao_do_contrato_divergente: "versao_do_contrato_divergente",
  enquadramento_invalido: "comando_com_tipo_invalido",
  campo_obrigatorio_ausente: "comando_incompleto",
  valor_nulo_nao_permitido: "comando_com_tipo_invalido",
  campo_desconhecido: "comando_com_campo_a_mais",
  campo_em_unidade_de_corretora: "comando_com_tipo_invalido",
  parcial_nao_declarada: "comando_com_tipo_invalido",
  formato_invalido: "comando_com_tipo_invalido",
  tipo_invalido: "comando_com_tipo_invalido",
  valor_fora_do_conjunto: "comando_com_tipo_invalido",
  valor_fora_da_banda: "comando_com_tipo_invalido",
  capacidade_nao_declarada: "comando_com_tipo_invalido",
  instrumento_desconhecido_no_manifesto: "comando_com_tipo_invalido",
  minimo_do_instrumento_acima_da_banda: "comando_com_tipo_invalido",
  valor_abaixo_do_minimo_do_venue: "comando_com_tipo_invalido",
  instrumento_deslistado_no_venue: "comando_com_tipo_invalido",
  // A VIRADA (1.10.0): as duas recusas da reversao sao da mesma familia — a boleta nao passou a porta da
  // traducao, e o defeito esta' do nosso lado (a mesa pediu uma virada sem o que ela exige). Vao para o mesmo
  // motivo do vigia que as outras recusas de validade, e o nome certo da recusa fica no `dizer` do conector.
  reversao_com_reduce_only: "comando_com_tipo_invalido",
  reversao_sem_posicao_a_reverter: "comando_com_tipo_invalido",
  // A REDUCAO PARCIAL (1.11.0): as duas recusas sao da mesma familia das da reversao — a boleta nao passou a
  // porta da traducao, e o defeito esta' do nosso lado (o tamanho relativo a' posicao sem o que ele exige). O
  // nome certo da recusa fica no `dizer` do conector.
  reducao_parcial_sem_reduce_only: "comando_com_tipo_invalido",
  reducao_parcial_sem_posicao_viva: "comando_com_tipo_invalido",
  prazo_excedido: "comando_com_tipo_invalido",
  desfecho_nao_reconhecido: "comando_com_tipo_invalido",
};

/**
 * O MOTIVO DO CONTRATO, traduzido para o vocabulario da mesa — ou GRITA.
 *
 * Era `TRADUCAO[decisao.motivo ?? ""] ?? "comando_com_tipo_invalido"`, e o `??` do fim fazia de qualquer
 * motivo por traduzir um "o tipo do comando estava mal". Isso tem dois custos: o dono le um diagnostico falso
 * (o comando podia estar bem formado), e um motivo novo do contrato entrava em produção sem ninguem dar por
 * isso — porque o resultado era sempre uma recusa plausivel.
 *
 * A bateria `tools/verificar-maquina/servidor.ts` confere que TODO o motivo do livro tem traducao. Se um dia
 * nao tiver, e' aqui que se sabe — e o que sai e' um erro que nomeia o motivo, nao um generico.
 */
export function traduzirMotivoDoContrato(motivo: string | null): string {
  if (motivo === null) {
    throw new Error(
      "o contrato recusou a mensagem SEM declarar motivo: uma recusa sem motivo nao se traduz nem se inventa " +
        "(o enquadramento do contrato obriga a nomear o que recusou)",
    );
  }
  const traduzido = TRADUCAO[motivo];
  if (typeof traduzido !== "string" || traduzido.length === 0) {
    throw new Error(
      `o contrato recusou por '${motivo}', que nao consta da TRADUCAO da mesa (core/servidor.ts). Um motivo por ` +
        "traduzir nao vira um generico: ou se acrescenta a traducao, ou a mesa passa a mentir sobre o que recusou.",
    );
  }
  return traduzido;
}

/** A declaracao honesta de que o pedido NAO trouxe correlacao: o contrato exige uma correlacao VALIDA na resposta. */
const SEM_PEDIDO = "sem_pedido";

/** A correlacao do pedido, ou a declaracao de que ele nao trouxe nenhuma. Nunca uma correlacao inventada. */
export function correlacaoDoPedido(pedidoId: string | null): string {
  if (pedidoId === null || pedidoId === "") return SEM_PEDIDO;
  return pedidoId;
}

export interface Opcoes {
  caminhoDasMarcas?: string;
  caminhoDoRegisto?: string;
  /** O CAMINHO do desfecho das sete portas, escrito por quem as corre (o vigia). Le-se a cada `start`:
   *  fixado no arranque do processo, um segundo `start` usaria as portas de uma corrida antiga - e o
   *  vigia teria de reiniciar a mesa para cada arranque, perdendo o estado dela. */
  caminhoDasPortas?: string;
  posicaoViva?: boolean;
  /** O periodo do relogio da mesa, em ms. Sem ele a mesa so age quando lhe falam - e a morte do vigia
   *  pararia a operacao, que e o contrario da FR-006. */
  tickMs?: number;
  /** A operacao (o que o conector e o setup reportam) e a configuracao do dono, para o relogio. */
  caminhoDaOperacao?: string;
  caminhoDaConfig?: string;
}

function lerArgumentos(argv: string[]): Opcoes {
  const o: Opcoes = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--marcas") o.caminhoDasMarcas = argv[++i];
    else if (a === "--registo") o.caminhoDoRegisto = argv[++i];
    else if (a === "--portas") o.caminhoDasPortas = argv[++i];
    else if (a === "--posicao-viva") o.posicaoViva = argv[++i] === "true";
    else if (a === "--tick") o.tickMs = Number(argv[++i]);
    else if (a === "--operacao") o.caminhoDaOperacao = argv[++i];
    else if (a === "--config") o.caminhoDaConfig = argv[++i];
  }
  return o;
}

/** O desfecho das sete portas, como quem as correu o escreveu. Nao se le: RECUSA - e a unica leitura
 *  honesta (desde 29/09/2026 a TABELA recusa o desconhecido por guarda propria; a porta recusa mais cedo
 *  porque e' ela que tem o ficheiro, e nao porque o vazio valha como "passaram"). */
function lerPortas(caminho: string | undefined): { passam: boolean; porta?: string; motivo?: string } | null {
  if (caminho === undefined) return null;
  try {
    const lido = JSON.parse(readFileSync(caminho, "utf8"));
    if (typeof lido?.passam !== "boolean") return null;
    return lido;
  } catch {
    return { passam: false, porta: "(nao se leu o desfecho)", motivo: `${caminho} nao se leu` };
  }
}

/** O decimal textual do contrato - o mesmo padrao do `forma.schema.json` (D4: nao se compara o que nao se leu). */
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * OS CINCO NUMEROS DA CORRETORA, do relato do venue que o conector traz na operacao (RN-V8).
 *
 * Devolve `null` quando o relato nao os traz - e `null` NAO e "nao sei": e "nao foi declarado", que e o que
 * a guarda da tabela precisa de saber. Nao se completa nenhum numero: o resumo mostra os da corretora, e
 * um numero estimado apresentado como facto seria pior do que nao perguntar.
 */
function lerNumerosDaCorretora(caminhoDaOperacao: string | undefined): NumerosDaCorretora | null {
  if (caminhoDaOperacao === undefined) return null;
  let operacao: any;
  try { operacao = JSON.parse(readFileSync(caminhoDaOperacao, "utf8")); } catch { return null; }
  const relato = operacao?.corretora;
  if (relato === null || typeof relato !== "object") return null;
  const numeros = {} as NumerosDaCorretora;
  for (const nome of NUMEROS_DA_CORRETORA) {
    if (typeof relato[nome] !== "string") return null;
    numeros[nome] = relato[nome];
  }
  return numeros;
}

/**
 * O EQUITY DE PARTIDA da sessao nova (T042): e um numero DA CORRETORA, e le-se da LEITURA do venue.
 *
 * `null` quando nao se leu - ausente, fora da forma decimal, ou em DESACORDO entre instrumentos. Discutir
 * qual vale seria escolher por quem decide: uma sessao que nasce com a base de outro instrumento mede a
 * corrida contra um numero que ninguem teve.
 */
function lerEquityDePartida(caminhoDaOperacao: string | undefined): string | null {
  if (caminhoDaOperacao === undefined) return null;
  let operacao: any;
  try { operacao = JSON.parse(readFileSync(caminhoDaOperacao, "utf8")); } catch { return null; }
  const instrumentos = operacao?.instrumentos;
  if (instrumentos === null || typeof instrumentos !== "object") return null;
  const nomes = Object.keys(instrumentos);
  if (nomes.length === 0) return null;
  const lidos = new Set<string>();
  for (const nome of nomes) {
    const equity = instrumentos[nome]?.leitura?.equity;
    if (typeof equity !== "string" || !DECIMAL.test(equity)) return null;
    lidos.add(equity);
  }
  return lidos.size === 1 ? [...lidos][0]! : null;
}

/**
 * A UNIDADE DE COMPARACAO da sessao nova (T042/FR-034): `ficha` e `versao_do_setup` vem da PROPOSTA do
 * setup, e a `versao_do_mandato` do mandato do DONO (`fichas.<instrumento>.versao_do_mandato`).
 *
 * `null` quando qualquer das tres falta (ou discorda entre instrumentos). A versao do mandato nao se
 * substitui por nenhuma outra: a do contrato diz que lingua se fala, nao que risco se corre - e sem a
 * unidade os numeros de duas sessoes nao se comparam entre si (FR-034, FR-039).
 */
function lerUnidadeDeComparacao(caminhoDaOperacao: string | undefined, caminhoDaConfig: string | undefined): ConfiguracaoEmVigor | null {
  if (caminhoDaOperacao === undefined || caminhoDaConfig === undefined) return null;
  let operacao: any, config: any;
  try {
    operacao = JSON.parse(readFileSync(caminhoDaOperacao, "utf8"));
    config = JSON.parse(readFileSync(caminhoDaConfig, "utf8"));
  } catch { return null; }
  const instrumentos = operacao?.instrumentos;
  if (instrumentos === null || typeof instrumentos !== "object") return null;
  const nomes = Object.keys(instrumentos);
  if (nomes.length === 0) return null;
  const fichas = new Set<string>(), setups = new Set<string>(), mandatos = new Set<string>();
  for (const nome of nomes) {
    const setup = instrumentos[nome]?.proposta?.setup;
    if (typeof setup?.nome !== "string" || setup.nome === "") return null;
    if (typeof setup?.versao !== "string" || setup.versao === "") return null;
    fichas.add(setup.nome); setups.add(setup.versao);
    const versaoDoMandato = config?.fichas?.[nome]?.versao_do_mandato;
    if (typeof versaoDoMandato !== "string" || versaoDoMandato === "") return null;
    mandatos.add(versaoDoMandato);
  }
  if (fichas.size !== 1 || setups.size !== 1 || mandatos.size !== 1) return null;
  return { ficha: [...fichas][0]!, versao_do_setup: [...setups][0]!, versao_do_mandato: [...mandatos][0]! };
}

/**
 * O PRAZO DE RESPOSTA DO DONO, da ficha (`setup.prazo_de_resposta_ms`).
 *
 * `null` quando nenhuma ficha o declara - e a mesa recusa, nao adivinha (RN-V9.1/RN-A3). Fichas que
 * DISCORDAM valem o mesmo que nenhuma: escolher uma delas em silencio seria decidir pelo dono, e o prazo
 * decide se a posicao volta a ficar defendida.
 */
function lerPrazoDoDono(caminhoDaConfig: string | undefined): number | null {
  if (caminhoDaConfig === undefined) return null;
  let config: any;
  try { config = JSON.parse(readFileSync(caminhoDaConfig, "utf8")); } catch { return null; }
  const declarados = new Set<number>();
  // `config?.fichas ?? {}` fazia de uma configuracao sem fichas uma configuracao sem prazo — e o prazo sem
  // declaracao ja' recusa (abaixo). Mas as duas coisas nao sao a mesma, e a leitura diz qual delas e':
  // sem `fichas` nao ha' nada a ler, e isso nao pode parecer "as fichas nao declararam prazo".
  const fichas: unknown = config?.fichas;
  if (fichas === null || fichas === undefined || typeof fichas !== "object" || Array.isArray(fichas)) return null;
  for (const ficha of Object.values<any>(fichas as Record<string, unknown>)) {
    const p = ficha?.setup?.prazo_de_resposta_ms;
    if (p === undefined) continue;
    if (!Number.isInteger(p) || p <= 0) return null;
    declarados.add(p);
  }
  if (declarados.size !== 1) return null;
  return [...declarados][0]!;
}

/**
 * `conta.identificador` - de que conta fala esta mesa (residuo do D-004: a atribuicao por conta no registo).
 *
 * Sem configuracao, ou com o campo ausente ou vazio, devolve `null` e as linhas saem SEM conta. Nao ha aqui
 * nome inventado: uma linha muda sobre a conta e' uma linha que se sabe nao atribuivel, o que e' melhor do
 * que uma que parece atribuida e nao esta'.
 */
function lerIdentificadorDaConta(caminhoDaConfig: string | undefined): string | null {
  if (caminhoDaConfig === undefined) return null;
  let config: any;
  try { config = JSON.parse(readFileSync(caminhoDaConfig, "utf8")); } catch { return null; }
  const id = config?.conta?.identificador;
  return typeof id === "string" && id.trim() !== "" ? id : null;
}

/**
 * O MANDATO, EM TEXTO CANONICO: as mesmas chaves, sempre pela mesma ordem, em qualquer profundidade.
 *
 * Serve para comparar duas leituras da configuracao e dizer se o mandato MUDOU. Comparar o texto do ficheiro
 * seria mais simples e estaria errado: quem o reescreve (o operador, a cada leitura) pode mudar a ordem das
 * chaves sem mudar um valor — e o registo encheria-se de linhas de mudanca que nao mudaram nada.
 */
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (valor !== null && typeof valor === "object") {
    const obj = valor as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

/**
 * OS PARES QUE O MANDATO GOVERNA, por nome. Sem `fichas` na configuracao governa ZERO pares — que e' a verdade
 * (e `conferirMandatos` recusa a operacao que reporte algum, como deve), nao um valor por omissao.
 */
function paresDoMandato(config: unknown): string[] {
  const fichas = (config as { fichas?: unknown }).fichas;
  if (fichas === null || fichas === undefined || typeof fichas !== "object") return [];
  return Object.keys(fichas as Record<string, unknown>);
}

/** A pergunta do encerramento, quando a mesa entrou em `encerrando`. */
function pergunta(pedidoId: string, prazoMs: number, numeros: NumerosDaCorretora): string {
  const carga = cargaDaPergunta(pedidoId, prazoMs, numeros);
  // O `id` da pergunta DERIVA do pedido que a mandou abrir: quem recebe a pergunta e a decisao que a
  // responde consegue liga-las sem uma tabela em memoria - e uma pergunta sem essa ligacao seria uma
  // pergunta que ninguem sabe a que pedido pertence.
  return JSON.stringify({ contrato: versaoVigente(), tipo: "pergunta_do_encerramento", id: `p-${pedidoId}`, carga });
}

/** A resposta do contrato, montada a partir do que a mesa decidiu. */
function resposta(
  id: unknown,
  pedidoId: string | null,
  estadoAnterior: string,
  estadoNovo: string,
  instante_ms: number,
  resto: { efeito?: string; motivo?: string },
) {
  const carga: Record<string, unknown> = {
    // Um `pedido_id` inventado tem de ser ele proprio uma correlacao VALIDA (o contrato confere o
    // formato na resposta): `sem_pedido` e a declaracao honesta de que o pedido nao trouxe correlacao.
    pedido_id: correlacaoDoPedido(pedidoId),
    aceito: resto.motivo === undefined,
    transicao: { de: estadoAnterior, para: estadoNovo },
    instante_ms,
  };
  if (resto.efeito !== undefined) carga.efeito = resto.efeito;
  if (resto.motivo !== undefined) carga.motivo = resto.motivo;
  return JSON.stringify({
    contrato: versaoVigente(),
    tipo: "resposta_de_comando",
    id: typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(id) ? id : "sem_id",
    carga,
  });
}

/** Uma linha entra, uma linha sai. Devolve SEMPRE uma linha. */
function marcasPresentes(m: ReturnType<typeof lerMarcas>): string[] {
  return [...(m.sessao ? ["sessao"] : []), ...(m.inibicao_cb ? ["inibicao_cb"] : []),
          ...m.desconhecido.map((d) => `desconhecido:${d.instrumento}`), ...m.pedidos.map((p) => `pedido:${p.verbo}`)];
}

export function atender(linha: string, mesa: Mesa, opcoes: Opcoes): string {
  const instante = Date.now();
  const estado = mesa.estado;

  // 1. a mensagem, pelo contrato (enquadramento, versao, forma)
  const decisao = validar(linha);
  if (decisao.veredicto !== "aceite") {
    let id: unknown = null;
    let verbo: unknown = null;
    try {
      const cru = JSON.parse(linha) as { id?: unknown; carga?: { verbo?: unknown } };
      id = cru?.id ?? null;
      verbo = cru?.carga?.verbo ?? null;
    } catch { /* nem e JSON: o motivo do contrato ja o disse */ }
    // Um verbo fora dos cinco tem nome no livro (`verbo_desconhecido`) e nao se afoga num generico: o
    // que o vigia precisa de saber e que aquele verbo nao existe, nao que "o tipo estava mal".
    const foraDosCinco = typeof verbo === "string" && !verbosDeclarados().includes(verbo as never);
    const motivo = foraDosCinco ? "verbo_desconhecido" : traduzirMotivoDoContrato(decisao.motivo);
    return resposta(id, null, estado, estado, instante, { motivo });
  }

  let envelope: { id?: unknown; carga?: unknown; tipo?: string };
  try { envelope = JSON.parse(linha); } catch { return resposta(null, null, estado, estado, instante, { motivo: "comando_com_tipo_invalido" }); }
  const carga = envelope.carga as Record<string, unknown> | undefined;
  const pedidoId = typeof carga?.pedido_id === "string" ? carga.pedido_id : null;

  // 2. A DECISAO DO ENCERRAMENTO (T034). Nao e verbo, nao entra pela tabela: e a resposta a uma pergunta,
  // e quem a aplica e o encerramento do recorte 002. Sem pergunta em aberto a mesa RECUSA nomeado - aceitar
  // faria a mesa mudar de estado por um pedido que ela nunca fez.
  if (envelope.tipo === "decisao_do_encerramento") {
    const respostaDoDono = (carga as { resposta?: unknown })?.resposta;
    if (respostaDoDono !== "fechar_a_mercado" && respostaDoDono !== "manter") {
      return resposta(envelope.id, pedidoId, estado, estado, instante, { motivo: "comando_com_tipo_invalido" });
    }
    const config = opcoes.caminhoDaConfig !== undefined ? JSON.parse(readFileSync(opcoes.caminhoDaConfig, "utf8")) : undefined;
    const r = mesa.receberDecisaoDoEncerramento(respostaDoDono, {
      instante_ms: instante,
      posicao_viva: opcoes.posicaoViva,
      prazo_de_resposta_ms: lerPrazoDoDono(opcoes.caminhoDaConfig) ?? undefined,
      configuracao: config,
    });
    if (r.resultado !== "aceite") {
      // A MESA RECUSA E NOMEIA. Uma recusa sem motivo (`r.motivo === null`) e' um defeito da propria mesa, e
      // um defeito nao se tapa com um motivo de recurso: quem le "decisao_sem_pergunta" acredita nele.
      if (r.motivo === null) {
        throw new Error(
          "a mesa recusou a decisao do encerramento sem declarar motivo: a recusa da mesa nomeia-se sempre " +
            "(core/ciclo/encerramento.ts), e sem motivo ela nao se pode ler nem se pode corrigir",
        );
      }
      return resposta(envelope.id, pedidoId, r.estado_anterior, r.estado_novo, instante, { motivo: r.motivo });
    }
    return resposta(envelope.id, pedidoId, r.estado_anterior, r.estado_novo, instante, r.efeito === null ? {} : { efeito: r.efeito });
  }

  // 3. o tipo: a porta so fala comando (e a decisao, acima). Outro tipo e recusado, nao encaminhado em silencio.
  if (envelope.tipo !== "comando") {
    return resposta(envelope.id, pedidoId, estado, estado, instante, { motivo: "comando_com_tipo_invalido" });
  }

  // 3. as duas verdades que a mesa nao tira de si
  const verbo = carga?.verbo;
  const portas = verbo === "start" ? lerPortas(opcoes.caminhoDasPortas) : null;
  if (verbo === "start" && portas === null) {
    return resposta(envelope.id, pedidoId, estado, estado, instante, { motivo: "porta_do_arranque_falhou" });
  }
  // A POSICAO VIVA: nao se recusa por nao a saber - recusa-se se o que nao se sabe MUDAR a resposta.
  // A pergunta faz-se a TABELA (funcao pura), e nao a mesa: `Mesa.receber` grava marcas e registo, e
  // uma sonda que gravasse seria uma operacao que nunca aconteceu. Se a resposta e a mesma com e sem
  // posicao, a mesa decidiu sem precisar dela - e um `stop` numa mesa ja parada da `mesa_ja_parada`.
  if (verbo === "stop" && opcoes.posicaoViva === undefined) {
    const m = lerMarcas(opcoes.caminhoDasMarcas);
    const base = { inibicao_cb: haInibicao(m) };
    const semPosicao = aplicar(estado, "stop", { ...base, posicao_viva: false }, marcasPresentes(m));
    const comPosicao = aplicar(estado, "stop", { ...base, posicao_viva: true }, marcasPresentes(m));
    if (semPosicao.estado_novo !== comPosicao.estado_novo || semPosicao.resultado !== comPosicao.resultado) {
      return resposta(envelope.id, pedidoId, estado, estado, instante, { motivo: "posicao_desconhecida" });
    }
  }

  // 4. o comando, pelo interprete da mesa. A mesa decide - a porta nao.
  const contexto: ContextoDaMesa = { instante_ms: instante };
  if (portas !== null) contexto.portas_do_arranque = portas;
  if (opcoes.posicaoViva !== undefined) contexto.posicao_viva = opcoes.posicaoViva;

  // O ENCERRAMENTO (T033): a tabela recusa o `stop` se o resumo nao puder ser construido, e para isso
  // precisa de saber se o veneno e o prazo foram D E C L A R A D O S. As duas leituras sao daqui (a mesa nao
  // le configuracao - uma segunda leitura seria uma segunda verdade), e os dois campos so entram quando o
  // verbo e o `stop`: noutro verbo nao ha resumo nenhum a construir.
  // O PONTO DE PARTIDA DA SESSAO NOVA (T042): o equity e a unidade de comparacao. As duas leituras sao
  // daqui pela mesma razao das outras - a mesa nao le a operacao nem a configuracao, e uma segunda leitura
  // seria uma segunda verdade. As duas guardas da tabela julgam-nas em separado: o motivo que sai tem de
  // dizer QUAL das duas faltou.
  if (verbo === "nova_sessao") {
    const equity = lerEquityDePartida(opcoes.caminhoDaOperacao);
    const unidade = lerUnidadeDeComparacao(opcoes.caminhoDaOperacao, opcoes.caminhoDaConfig);
    contexto.equity_de_partida_nao_lido = equity === null;
    contexto.unidade_de_comparacao_nao_declarada = unidade === null;
    if (equity !== null && unidade !== null) {
      contexto.sessao_nova = { equity_de_partida: equity, configuracao_em_vigor: unidade };
    }
  }

  const numerosDaCorretora = verbo === "stop" ? lerNumerosDaCorretora(opcoes.caminhoDaOperacao) : null;
  const prazoDaFicha = verbo === "stop" ? lerPrazoDoDono(opcoes.caminhoDaConfig) : null;
  if (verbo === "stop") {
    contexto.numeros_da_corretora_ausentes = numerosDaCorretora === null;
    contexto.prazo_de_resposta_nao_declarado = prazoDaFicha === null;
  }

  const r = mesa.receber(carga, contexto);
  if (r.resultado !== "aceite") {
    const motivo = r.motivo && motivoConhecido(r.motivo) ? r.motivo : "comando_com_tipo_invalido";
    return resposta(envelope.id, pedidoId, r.estado_anterior, r.estado_novo, instante, { motivo });
  }

  // O efeito existe quando ACONTECEU algo alem da transicao (um `start` comum nao tem efeito proprio).
  let efeito: string | undefined;
  if (r.verbo === "reset") efeito = "reset_nao_toca_em_nada";
  else if (r.verbo === "nova_sessao") efeito = "sessao_nova_gravada";
  const respostaDoComando = resposta(envelope.id, pedidoId, r.estado_anterior, r.estado_novo, instante, { efeito });

  // A SEGUNDA LINHA: em `encerrando` a mesa nao fica so com a resposta - ela PERGUNTA (FR-013 a FR-015). A
  // pergunta vai identificada pelo `pedido_id` do `stop`, para a decisao que a responde poder ser ligada a
  // ela. Aqui e o unico sitio da porta onde duas linhas saem: a resposta diz o que mudou, a pergunta diz o
  // que se espera do dono, e juntar as duas numa so obrigaria o contrato a alargar.
  if (r.verbo === "stop" && r.estado_novo === "encerrando") {
    if (prazoDaFicha === null || numerosDaCorretora === null) {
      // Inatingivel: as guardas da tabela recusam o `stop` sem prazo ou sem numeros. Se algum dia chegar
      // aqui, e um defeito NOSSO e sai a gritar - aquietar com um valor por omissao seria apresentar ao dono
      // um resumo com numeros que ninguem relatou.
      throw new Error(
        "a mesa entrou em `encerrando` sem prazo declarado ou sem os numeros da corretora: " +
          "as guardas da tabela deviam ter recusado o stop",
      );
    }
    const carga = cargaDaPergunta(correlacaoDoPedido(pedidoId), prazoDaFicha, numerosDaCorretora);
    const pergunta = JSON.stringify({
      contrato: versaoVigente(),
      tipo: "pergunta_do_encerramento",
      id: `p-${correlacaoDoPedido(pedidoId)}`,
      carga,
    });
    return respostaDoComando + "\n" + pergunta;
  }
  return respostaDoComando;
}

async function main() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  const umaLinha = process.argv.includes("--uma-linha");
  const mesa = new Mesa({
    caminhoDasMarcas: opcoes.caminhoDasMarcas,
    caminhoDoRegisto: opcoes.caminhoDoRegisto,
    // A CONTA (D-004): sai da configuracao, e nao de uma bandeira na linha de comando - quem sabe de que
    // conta fala e' a configuracao dela. Sem configuracao, as linhas saem sem conta (e isso le-se na linha).
    conta: lerIdentificadorDaConta(opcoes.caminhoDaConfig) ?? undefined,
  });
  // Escrever para um cano fechado (o vigia morreu) NAO pode matar a mesa: seria a morte a chegar pela
  // costura, que e exactamente o que a FR-006 proibe.
  process.stdout.on("error", () => {
    /* a costura fechou; o registo continua a ser escrito */
  });
  // O `stderr` tambem e um cano de quem chamou: sem isto, a linha "a costura fechou" (escrita DEPOIS de a
  // costura fechar) rebentava a mesa - a morte a chegar pela costura, que e o que a FR-006 proibe.
  process.stderr.on("error", () => {
    /* idem */
  });

  // O RELOGIO, armado no arranque. Quem o desliga e o ESTADO, nunca o fim da entrada.
  let relogio: ReturnType<typeof setInterval> | null = null;
  if (opcoes.tickMs !== undefined) {
    if (opcoes.caminhoDaOperacao === undefined || opcoes.caminhoDaConfig === undefined) {
      throw new Error(
        "`--tick` sem `--operacao` ou sem `--config`: um relogio sem operacao ciclaria em branco, e decidir " +
          "sem o mandato do dono seria decidir por ele.",
      );
    }
    // O MANDATO DO DONO E' RELIDO A CADA VOLTA — E O QUE MUDA REGISTA-SE (RN-V10).
    //
    // Era lido UMA VEZ, aqui, com o argumento de que «mudar os termos de uma mesa em operacao e' outro assunto,
    // com a RN-V10 e registo proprio». O outro assunto passou a ser o caminho normal: quem escreve esta
    // configuracao e' o operador — e' a VISTA das fichas do dono, reescrita a cada leitura — e uma ficha ligada a
    // quente tem de entrar sem reiniciar a mesa. Medido a 30/09/2026 (`tools/observar-multipar.sh`): o par entrava
    // na operacao, o mandato do arranque nao o governava, e a mesa RECUSAVA e morria. Meio-quente e' pior do que
    // frio: mesa morta nao defende posicao nenhuma. Agora rele-se, e a diferenca fica no registo — um par por
    // linha, com o motivo — que e' o que a RN-V10 exige de quem muda os termos de uma mesa em operacao.
    const lerConfig = (): ConfiguracaoDaConta =>
      JSON.parse(readFileSync(opcoes.caminhoDaConfig!, "utf8")) as ConfiguracaoDaConta;
    let config: ConfiguracaoDaConta = lerConfig();
    let impressaoDoMandato = canonico(config);

    // A SEMENTE DO TRAVAO DA BARRA (D-021). A mesa escreve a barra de cada entrada no registo; ao armar o relogio
    // volta a ler o que ela propria fez. Sem isto, um reinicio a meio de uma barra apagava o travao de uma entrada
    // por barra — e o reinicio passou a ser caminho normal (ficha ligada a quente).
    semearTravosDeBarra(barrasDasUltimasEntradas(opcoes.caminhoDoRegisto));
    let ciclo = 0;
    relogio = setInterval(() => {
      if (mesa.estado === "parada") return; // sem operacao para defender, a volta nao decide

      // A OPERACAO E' RELIDA A CADA VOLTA, e isto e' o que separa uma mesa de um retrato.
      //
      // Medido a 30/09: a mesa lia a operacao UMA VEZ, no arranque, e decidia 44 vezes sobre o mesmo retrato —
      // a mesma proposta, a mesma posicao, a mesma barra. Com a mao fechada isso daria UMA posicao no arranque
      // e mais nada: nem gestao da posicao aberta, nem viragem de mao, nem nada. A operacao e' um ficheiro que
      // o operador reescreve a cada leitura (escrita atomica: temp + rename, por isso nunca se le' meio
      // ficheiro). O que a mesa decide tem de ser o que ACABOU de ser lido.
      //
      // O MANDATO E' RELIDO AQUI, A CADA VOLTA (a nota esta' no arranque do relogio). Quando ele MUDA, a mudanca
      // vai para o registo ANTES de a volta decidir: um dia de operacao tem de se reconstruir sem ler codigo
      // (SC-011), e «os termos do dono mudaram» e' dos acontecimentos que mais explicam o que veio depois.
      const operacao = lerOperacao(opcoes.caminhoDaOperacao!);
      const configDaVolta = lerConfig();
      const impressaoDaVolta = canonico(configDaVolta);
      if (impressaoDaVolta !== impressaoDoMandato) {
        const antes = paresDoMandato(config);
        const agora = paresDoMandato(configDaVolta);
        const emVigor = agora.length > 0 ? agora.join(", ") : "(nenhum par)";
        const conta = lerIdentificadorDaConta(opcoes.caminhoDaConfig) ?? undefined;
        for (const instrumento of agora) {
          if (antes.includes(instrumento)) continue;
          registarMudancaDeMandato(Date.now(), instrumento, true,
            "a ficha do dono passou a mandar neste par: entra no mandato da mesa sem a mesa reiniciar",
            `mandato em vigor: ${emVigor}`, opcoes.caminhoDoRegisto, conta);
        }
        for (const instrumento of antes) {
          if (agora.includes(instrumento)) continue;
          registarMudancaDeMandato(Date.now(), instrumento, false,
            "a ficha do dono deixou de mandar neste par: a mesa deixa de o governar",
            `mandato em vigor: ${emVigor}`, opcoes.caminhoDoRegisto, conta);
        }
        config = configDaVolta;
        impressaoDoMandato = impressaoDaVolta;
      }
      conferirMandatos(operacao, config);

      // EM `encerrando` ha DUAS coisas a fazer, e sao diferentes:
      //
      //   a LIQUIDACAO ja comecou (o dono escolheu fechar a mercado) -> a mesa LIQUIDA: a mesma volta do
      //   ciclo, com a proposta `caixa` no lugar da do setup. A autoridade para essa proposta e a DECISAO do
      //   dono - o `caixa` no encerramento nao e do setup, e dele. Quando o ciclo diz `sem_posicao_para_fechar`
      //   a liquidacao esta cumprida, e so entao a mesa fica `parada`;
      //
      //   a LIQUIDACAO ainda nao comecou -> a mesa esta a espera do dono, e o que ela faz e cumprir o PRAZO
      //   (T036/RN-V9.1): dentro dele espera, fora dele VOLTA A OPERAR - a abrir incluido - com o `stop`
      //   arquivado como pendente.
      if (mesa.estado === "encerrando") {
        ciclo += 1;
        const instante = Date.now();
        const entrada = ultimaTransicaoPara("encerrando", opcoes.caminhoDoRegisto);
        if (entrada?.motivo === "liquidacao_em_curso") {
          const paraLiquidar = {
            ...operacao,
            instrumentos: Object.fromEntries(
              // A proposta da liquidacao e a DO SETUP com o lado trocado por `caixa`: o `setup` (nome e
              // versao) e o `relogio` do template continuam a ser os dele - so o LADO e que passa a ser a
              // decisao do dono. Construir uma proposta de raiz perderia a assinatura do setup no registo,
              // que e o que diz quem propoe (RN-S7).
              Object.entries(operacao.instrumentos).map(([i, d]: [string, any]) => {
                // SEM PROPOSTA NAO HA' LIQUIDACAO DAQUELE INSTRUMENTO, e a mesa nao a inventa: o lado trocado
                // por `caixa` e' o lado DA proposta do setup — sem ela, o que sairia era uma proposta sem
                // `setup` nem `relogio`, que o contrato recusa e que ninguem poderia atribuir a quem a fez
                // (RN-S7). Parar aqui nomeia o instrumento; deixar passar dava a culpa ao contrato.
                if (d.proposta === undefined || d.proposta === null) {
                  throw new Error(
                    `a liquidacao de ${i} nao tem proposta do setup de onde tirar o lado: sem proposta nao se ` +
                      "constroi a da mesa (RN-S7), e a mesa nao fecha por uma proposta que ela propria inventou",
                  );
                }
                return [i, { ...d, proposta: { ...d.proposta, lado: "caixa" } }];
              }),
            ),
          };
          const resultado = correrUmCiclo({
            operacao: paraLiquidar as typeof operacao,
            config,
            marcas: mesa.marcas(),
            estado: mesa.estado,
            ciclo,
            instante_ms: instante,
            caminhoDoRegisto: opcoes.caminhoDoRegisto,
          });
          // LIQUIDACAO CUMPRIDA: TODOS os instrumentos dizem `sem_posicao_para_fechar` - nao ha posicao nossa
          // para fechar em nenhum deles. E o MOTIVO que o diz, e nao a accao: `nada` tanto e "ja nao havia
          // nada" (cumprida) como "havia e a condicao impediu" (nao cumprida). So agora a mesa fica parada -
          // e a transicao vai para o registo, que e o unico sitio onde o desfecho fica.
          const cumprida =
            Object.keys(resultado.motivos).length > 0 &&
            Object.values(resultado.motivos).every((m) => m === "sem_posicao_para_fechar");
          if (cumprida) mesa.terminarLiquidacao({ instante_ms: instante });
          return;
        }
        mesa.esperarPeloEncerramento({
          instante_ms: instante,
          posicao_viva: opcoes.posicaoViva,
          prazo_de_resposta_ms: lerPrazoDoDono(opcoes.caminhoDaConfig) ?? undefined,
          configuracao: config,
        });
        return;
      }

      ciclo += 1;
      try {
        correrUmCiclo({
          operacao,
          config,
          marcas: mesa.marcas(),
          estado: mesa.estado,
          ciclo,
          instante_ms: Date.now(),
          caminhoDoRegisto: opcoes.caminhoDoRegisto,
        });
      } catch (erro) {
        // Uma volta que rebenta e um defeito NOSSO (a linha do registo e obrigatoria em `registarCiclo`).
        // Grita e continua: parar o relogio deixaria a posicao sem defesa por causa de um erro de codigo -
        // e a contagem da bancada (N ciclos = N linhas) apanha a volta que faltou.
        console.error(`ciclo ${ciclo} rebentou: ${(erro as Error).message}`);
      }
    }, opcoes.tickMs);
  }

  const rl = createInterface({ input: process.stdin });
  for await (const linha of rl) {
    if (linha.trim() === "") continue;
    process.stdout.write(atender(linha, mesa, opcoes) + "\n");
    if (umaLinha) break;
  }

  // FIM DA ENTRADA: a costura fechou. Duas respostas, e a diferenca e o que a mesa tem para defender:
  //  - em operacao (ou pausada): NAO sai. Continua a defender com o vigia morto - e a FR-006 inteira;
  //  - parada: sai. Sem operacao, sem costura e sem ninguem que a possa arrancar, ficar seria um processo
  //    a segurar um estado que ninguem pode usar.
  if (relogio !== null) {
    if (mesa.estado === "parada") {
      clearInterval(relogio);
    } else {
      console.error(`a costura fechou; a mesa continua em operacao (FR-006), estado ${mesa.estado}`);
    }
  }
}

if (import.meta.main) await main();
