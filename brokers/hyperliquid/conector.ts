// A PORTA DE PROCESSO do conector Hyperliquid (FR-019).
//
// Este ficheiro e a MAQUINA: o processo que arranca, cumpre as portas do arranque NA ORDEM declarada, publica
// o manifesto e fala no envelope do contrato. Nao ha `stdio` aqui — quem o tem e `processo.ts`, que chama isto.
//
// O que ele e, em tres partes:
//   1. AS PORTAS DO ARRANQUE do processo (`PORTAS_DO_PROCESSO`), pela ordem, fail-closed: a PRIMEIRA que falha
//      decide o motivo, e o processo nao serve nada. O arranque nao e uma lista de verificacoes soltas: e uma
//      sequencia, e o motivo que o dono le e o da primeira porta que caiu.
//   2. A CONVERSA: uma linha entra, zero, uma ou duas linhas saem. A `resolucao` sai ANTES do envio (o que vai
//      ser enviado, para a mesa conferir); o `desfecho` sai depois, com os numeros do venue.
//   3. A PONTE com o venue por uma PORTA injectada: o SDK ao vivo, ou um duble declarado em dado. O nucleo
//      nao sabe qual dos dois esta do outro lado — e e por isso que ele corre offline.
//
// O que ele NUNCA faz:
//   * decidir lado, tamanho, preco ou momento; ler estrategia ou mandato; julgar risco (FR-024, RN-C5/RN-C15);
//   * importar o `core` (RN-E1) — so o `contracts`, que e a lingua que ele fala;
//   * arredondar em silencio: o que nao cabe RECUSA, com motivo do conjunto fechado do contrato;
//   * inventar um numero que o venue nao deu, nem servir a leitura anterior quando a de agora falhou;
//   * dizer «sim» a um campo que o venue nao declarou (fail-closed: `!== true` nunca vira verdadeiro).
//
// NOTA DE FRONTEIRA: as portas de arranque da MESA (as sete de `core/ciclo/arranque.ts`) sao outras, e sao
// corridas pelo vigia (RN-E21) — o conector nao as corre, nao le a configuracao do dono nem o mandato (RN-C5).
// Das sete da mesa, este processo SUPRE duas: a porta `conectores` (ele esta de pe, e e o conector que a
// config nomeia) e a porta `manifesto` (o manifesto que ele publica e que a mesa confere). As outras cinco sao
// do mandato, da contenda, das chaves, da versao e da sessao — pecas que o conector nao le de proposito.

import { construirManifesto, manifestoParaInstrumento, type Resultado as ResultadoDoManifesto, type Sonda } from "./manifesto.ts";
import {
  compararDecimais,
  construirSonda,
  lerDoVenue,
  type PedidoDaSonda,
  type PortaDeLeitura,
  type Resposta,
  type SondaMedida,
} from "./sonda.ts";
import {
  lerConta,
  lerDoVenueDaConta,
  type PedidoDeLeitura,
  type PortaDeConta,
  type PosicaoDaLeitura,
  type RespostasDaConta,
} from "./leitura.ts";
import { traduzirOrdem, type AccaoDoVenue, type Boleta, type ManifestoDoVenue } from "./ordens.ts";
import {
  cargaDoHistorico,
  lerDoVenueDoHistorico,
  lerHistorico,
  type PedidoDeHistorico,
  type PortaDeHistorico,
} from "./historico.ts";
import { carregarCredencial } from "./credencial.ts";
// A PORTA DE IDENTIDADE (FR-023/RN-E13): a comparacao pura entre o agente que ASSINA e os agentes que o venue
// declara registados NA CONTA. Vive num ficheiro proprio para poder ser provada em dado, sem chave e sem rede.
import { conferirIdentidade } from "./identidade.ts";
// O contrato e a lingua do conector (FR-024: importa `contracts`, nunca o `core`). O enquadramento, a versao
// e o vocabulario vem de LA — nao ha aqui uma segunda copia das regras do envelope.
import { validar, versaoVigente, vocabulario } from "../../contracts/esqueleto/framing.ts";
import { lista, ouAusente } from "../../contracts/esqueleto/texto.ts";

// ---------------------------------------------------------------------------------------------------------
// O que entra: a ficha, os enderecos declarados, o duble do venue e a bateria.
// ---------------------------------------------------------------------------------------------------------

/**
 * A FICHA do processo — o que o vigia entrega ao arrancar. Uma por (corretora, conta) (FR-019).
 *
 * Nao ha aqui politica de risco, limites do dono nem mandato: o conector nao julga risco (FR-024). O que ha e
 * com quem ele fala, por que conta, com que chave, e que instrumentos o mandato nomeia — este ultimo so para o
 * manifesto conferir contra o universo do venue e RECUSAR o que nao existir (FR-003).
 */
export type Ficha = {
  /** O nome que a config do dono declara em `conta.conectores` (nome_de_plugin). */
  conector: string;
  /** A versao do CONTRATO que este processo fala — conferida por igualdade exacta antes de qualquer envio (D7). */
  contrato: string;
  versao_do_conector: string;
  venue: { nome: string; ambiente: "teste" | "producao"; url_da_api: string };
  /** UMA conta (o endereco master): uma ligacao, uma chave, um processo (FR-019, RN-H15). */
  conta: string;
  /**
   * O que a ficha DECLAROU da credencial — a referencia e onde ela vive, nunca o valor (FR-023).
   *
   * Os dois campos admitem `undefined` de proposito: era `texto(...) ?? ""`, e um campo AUSENTE chegava a' porta
   * `chave` com a cara de «declarado vazio». Sao duas ausencias diferentes, e a porta que as julga e' a `chave`
   * (que recusa nomeando, FR-023) — aqui o que veio viaja como veio.
   */
  credencial: { referencia: string | undefined; valor_em: string | undefined };
  /** Os instrumentos que o MANDATO nomeia. Nao sao um facto do venue: sao o que se confere contra ele. */
  instrumentos: string[];
};

/** Os enderecos que o dono declara por ambiente. Um facto do venue que vive em DADO, nunca no codigo (RN-C1). */
export type EnderecosDoVenue = { teste: string[]; producao: string[] };

/** A porta de ENVIO: a accao ja na forma do venue entra, o que ele responde volta CRU. */
export type PortaDeEnvio = {
  /**
   * Envia a accao ao venue. A `referencia_do_cliente` vai declarada porque e ELA que o venue usa para saber a
   * que ordem responde (na Hyperliquid, pelo `cloid` derivado dela): um venue que nao soubesse a referencia
   * nao teria o que responder, e um duble que a adivinhasse nao estaria a medir nada.
   */
  enviar(accao: AccaoDoVenue, conta: string, referencia_do_cliente?: string): Promise<Resposta>;
};

/** A porta do venue inteira: as leituras da sonda, as da conta, as do historico e o envio. */
export type Porta = {
  leitura: PortaDeLeitura;
  conta: PortaDeConta;
  historico: PortaDeHistorico;
  envio: PortaDeEnvio;
  /**
   * O AJUSTE DE ALAVANCAGEM NO VENUE (FR-008). Medido em 29/09/2026 (D-010): a boleta pedia uma alavancagem, o
   * venue tinha outra, e este conector nunca lha pedia — a `resolucao` declarava a pedida, e era sobre ela que a
   * mesa conferia a banda (D-001). Um venue sem este verbo NAO ajusta, e por isso uma boleta que peca alavancagem
   * e' RECUSADA quando ele falta — nao se abre com uma alavancagem diferente da declarada (fail-closed, FR-007).
   */
  ajuste?: {
    alavancagem(instrumento: string, alavancagem: string, modo: "cruzado" | "isolado"): Promise<Resposta>;
  };
  /**
   * O ENDERECO DO AGENTE QUE ASSINA — o unico dado que a porta de identidade precisa e que so quem tem a
   * chave sabe. NAO e' um segredo: e' um endereco publico. A porta AO VIVO deriva-o da chave carregada por
   * REFERENCIA (o VALOR nunca sai de `credencial.ts`, FR-023); o DUBLE declara-o no seu dado. Sem ele, a
   * porta de identidade fica `nao_corrida` — nao vira «conferida» por omissao.
   */
  identidade?: { endereco_do_agente: string; porque: string };
};

/** O que a bateria de conformidade MEDIU dos campos que o venue nao publica (FR-027). `null` = nao mediu nada. */
export type Bateria = Record<string, unknown> | null;

// ---------------------------------------------------------------------------------------------------------
// As PORTAS DO ARRANQUE do processo, pela ordem em que sao conferidas.
// ---------------------------------------------------------------------------------------------------------

/**
 * A ORDEM e declarada, e e ela que decide o motivo quando mais do que uma porta esta mal: o dono le o primeiro
 * obstaculo, nao o terceiro. O criterio de ordenacao e o custo e o alcance de cada conferencia — o que se sabe
 * sem falar com ninguem vem primeiro; o que exige ir ao venue vem no fim.
 *
 * `casos/processo.casos.json` carrega a MESMA lista, e a bancada confere que as duas sao iguais: se esta ordem
 * mudar sem o dado mudar, a bancada cai.
 */
export const PORTAS_DO_PROCESSO: { porta: string; regra: string }[] = [
  {
    porta: "ficha",
    regra:
      "FR-019: um processo por (corretora, conta), e a ficha diz qual. Sem ficha legivel nao ha conector — e um " +
      "arranque sem ficha nao se adivinha a partir do ambiente",
  },
  {
    porta: "versao_do_contrato",
    regra: "D7/RN-E18: a versao do contrato confere-se por igualdade EXACTA antes de qualquer envio. Nada sai.",
  },
  {
    porta: "uma_conta",
    regra: "FR-019/FR-022/RN-H15: uma ligacao, uma chave, UMA conta. Um pedido que nomeie outra conta nao entra",
  },
  {
    porta: "ambiente_e_rede",
    regra:
      "RN-H17: o recorte corre no ambiente de TESTE, e producao e decisao declarada do dono — nunca uma bandeira " +
      "que o processo levanta sozinho. O endereco tem de bater com o ambiente declarado",
  },
  {
    porta: "chave",
    regra: "FR-023/RN-C20: a credencial entra por REFERENCIA, e a falta dela e uma recusa NOMEADA",
  },
  {
    porta: "ligacao",
    regra:
      "FR-020/FR-021/RN-H2: o estado da ligacao e o do protocolo do venue (silencio e `desconhecido`), e sem " +
      "leitura da conta o conector nao serve ordem que aumente exposicao",
  },
  {
    porta: "sonda_e_manifesto",
    regra:
      "US1/FR-001..FR-005: a sonda le o venue e o manifesto e publicado — e o que o venue nao declarar RECUSA " +
      "(`capacidade_nao_declarada`), em vez de virar `true` por omissao",
  },
  {
    porta: "identidade",
    regra:
      "FR-023/RN-E13/RN-H15: a credencial que a porta `chave` provou que se LE tem de ser DESTA conta. Compara-se " +
      "o endereco do agente que assina com os agentes que o venue publica para a conta (`extraAgents`), e o prazo " +
      "deles. Divergencia, lista que nao se le ou prazo passado = arranque RECUSADO, e nada sai. E a ULTIMA porta " +
      "porque e a que exige a leitura mais recente do venue: o que se sabe sem falar com ninguem vem primeiro",
  },
];

export type VeredictoDaPorta = "passou" | "falhou" | "nao_corrida";

export type ResultadoDaPorta = {
  porta: string;
  veredicto: VeredictoDaPorta;
  /** Só quando falhou: motivo do conjunto FECHADO de `contracts/vocabulario.json`. */
  motivo?: string | null;
  porque: string;
};

export type EstadoDoProcesso = {
  ficha: Ficha;
  manifesto: Record<string, unknown>;
  /** A mensagem do manifesto ja no envelope do contrato (validada antes de sair daqui). */
  linha_do_manifesto: string;
  /**
   * A SONDA que produziu o manifesto — ja' JUNTADA com a bateria de conformidade.
   *
   * Era a `medida` (o resultado cru das leituras, antes de a bateria declarar o que o venue nao publica).
   * Guardar a juntada e' o que permite RECONSTRUIR o manifesto sem rede nenhuma (o caso do instrumento que
   * entra por uma ficha ligada a' quente): a partir da medida crua, `construirManifesto` recusaria os campos
   * que so' a bateria declara — e a reconstrucao caia sempre no manifesto do arranque.
   */
  sonda: Sonda;
  /** Onde a credencial foi buscar o VALOR — o valor nunca entra aqui (FR-023). */
  credencial: { de: string; protegido: string } | null;
  estado_da_ligacao: "ligada" | "desconhecido";
  carteiras: { nomes: string[]; nao_lidas: string[]; nota: string };
  portas: ResultadoDaPorta[];
};

export type Arranque =
  | { ok: true; estado: EstadoDoProcesso }
  | { ok: false; portas: ResultadoDaPorta[]; porta: string; motivo: string; porque: string };

export type Entrada = {
  ficha: unknown;
  enderecos: EnderecosDoVenue | undefined;
  porta: Porta;
  bateria: Bateria;
  /** O instante (relogio do CHAMADOR) que data as janelas pedidas ao venue. Declarado como tal. */
  instante_ms: number;
};

// ---------------------------------------------------------------------------------------------------------
// Helpers de forma: um motivo inventado LANCA (nao sai uma mensagem com motivo fora do contrato).
// ---------------------------------------------------------------------------------------------------------

function motivoDoContrato(motivo: string): string {
  const v = vocabulario();
  if (!Object.prototype.hasOwnProperty.call(v.motivos, motivo)) {
    throw new Error(
      `motivo ${JSON.stringify(motivo)} nao existe no conjunto fechado de contracts/vocabulario.json: ` +
        "um motivo inventado nao se escreve numa mensagem — o processo para aqui",
    );
  }
  return motivo;
}

function objecto(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

const PADRAO_INSTRUMENTO = /^[A-Z0-9][A-Z0-9._/-]{1,31}$/;
const PADRAO_NOME_DE_PLUGIN = /^[a-z][a-z0-9_]{1,31}$/;
const PADRAO_VERSOA = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// ---------------------------------------------------------------------------------------------------------
// Aritmetica em DECIMAL TEXTUAL com BigInt (dinheiro nao e float).
//
// Estas quatro funcoes sao as MESMAS de `ordens.ts` (que nao as exporta): aqui so existem para quantizar o
// preco de liquidacao projectado ao tick. Se `ordens.ts` as passar a exportar (ou se nascer um `decimais.ts`),
// este bloco desaparece — esta dito, em vez de ficar uma segunda verdade escondida.
// ---------------------------------------------------------------------------------------------------------

function decimais(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

function escalado(s: string): bigint {
  const i = s.indexOf(".");
  return i < 0 ? BigInt(s) : BigInt(s.slice(0, i) + s.slice(i + 1));
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function formatar(valor: bigint, escala: number): string {
  if (escala === 0) return valor.toString();
  const dig = valor.toString().padStart(escala + 1, "0");
  const inteiro = dig.slice(0, dig.length - escala);
  const fracao = dig.slice(dig.length - escala).replace(/0+$/, "");
  return fracao === "" ? inteiro : `${inteiro}.${fracao}`;
}

/**
 * O preco de liquidacao PROJECTADO, para a resolucao que sai ANTES do envio: `preco * (1 - 1/alavancagem)`,
 * quantizado ao tick POR BAIXO. E uma conta NOSSA ([C]) sobre um numero do venue ([V]) — e vai dita como tal
 * (ver o achado 2 do `data-model.md`: o venue so calcula o preco de liquidacao depois de a posicao existir, e o
 * contrato 1.3.0 exige o campo na resolucao; a emenda proposta e a T068). Quando o venue JA o publica (a
 * posicao lida depois do envio), e ELE que manda — este calculo nao e usado.
 */
export function precoDeLiquidacaoProjectado(preco: string, alavancagem: string, tick: string): string | null {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(preco)) return null;
  if (!/^[1-9][0-9]*$/.test(alavancagem)) return null;
  const p = decimais(preco);
  const t = decimais(tick);
  const A = BigInt(alavancagem);
  // A alavancagem 1 liquida a preco ZERO — e zero e um valor LEGITIMO aqui, e nao «nao sei» (o contrato di-lo).
  if (A === 1n) return "0";
  const bruto = (escalado(preco) * (A - 1n)) / A; // em unidades de 10^-p, por baixo
  return t >= p ? formatar(bruto * pow10(t - p), t) : formatar(bruto / pow10(p - t), t);
}

/** A mesma escala para todos os valores que vao no envelope: DECIMAL TEXTUAL, sem expoente e sem sinal. */
const CASAS_DA_MARGEM = 2;

/** Divide um decimal textual por um inteiro, com `casasDeSaida` casas, POR BAIXO (o lado que nao promete). */
function dividirPorInteiro(valor: string, divisor: string, casasDeSaida: number): string {
  const c = decimais(valor);
  const d = BigInt(divisor);
  const k = c <= casasDeSaida ? (escalado(valor) * pow10(casasDeSaida - c)) / d : escalado(valor) / pow10(c - casasDeSaida) / d;
  return formatar(k, casasDeSaida);
}

// ---------------------------------------------------------------------------------------------------------
// A ficha: leitura sem coerir nada (o que falta RECUSA, nomeando o campo).
// ---------------------------------------------------------------------------------------------------------

function exigirFicha(cru: unknown): { ok: true; ficha: Ficha } | { ok: false; motivo: string; porque: string } {
  if (cru === undefined || cru === null) {
    return { ok: false, motivo: "campo_obrigatorio_ausente", porque: "o arranque nao trouxe ficha nenhuma do conector" };
  }
  const f = objecto(cru);
  if (f === undefined) {
    return { ok: false, motivo: "tipo_invalido", porque: `a ficha do conector tem de ser um objecto, e veio ${typeof cru}` };
  }
  for (const campo of ["conector", "contrato", "versao_do_conector"]) {
    const v = f[campo];
    if (v === undefined) return { ok: false, motivo: "campo_obrigatorio_ausente", porque: `a ficha do conector nao declara \`${campo}\`` };
    if (v === null) return { ok: false, motivo: "valor_nulo_nao_permitido", porque: `a ficha do conector traz \`${campo}\` a null (D4: null nao existe)` };
    if (typeof v !== "string") return { ok: false, motivo: "tipo_invalido", porque: `a ficha traz \`${campo}\` como ${typeof v}, e devia ser texto` };
  }
  // A ficha nao tem lugar para o que o contrato nao declara: um campo a mais nao se ignora em silencio (RN-C1).
  //   * `conta` nao esta na lista de obrigatorios de proposito — quem a exige e a porta `uma_conta` (FR-019);
  //   * `nota` e o unico campo de DOCUMENTACAO admitido: nao entra em decisao nenhuma (o processo nunca o le),
  //     e existe para a ficha se poder explicar a si propria.
  const declarados = ["conector", "contrato", "versao_do_conector", "venue", "conta", "credencial", "instrumentos", "nota"];
  for (const chave of Object.keys(f)) {
    if (!declarados.includes(chave)) {
      return {
        ok: false,
        motivo: "campo_desconhecido",
        porque: `a ficha do conector traz \`${chave}\`, que o contrato desta ponta nao declara (os declarados sao: ${declarados.join(", ")})`,
      };
    }
  }
  const conector = f.conector as string;
  if (!PADRAO_NOME_DE_PLUGIN.test(conector)) {
    return { ok: false, motivo: "formato_invalido", porque: `o nome do conector ${JSON.stringify(conector)} nao tem a forma do contrato (nome_de_plugin)` };
  }
  const contrato = f.contrato as string;
  if (!PADRAO_VERSOA.test(contrato)) {
    return { ok: false, motivo: "formato_invalido", porque: `a versao do contrato declarada pela ficha (${JSON.stringify(contrato)}) nao tem a forma x.y.z` };
  }
  const venue = objecto(f.venue);
  if (venue === undefined) {
    return { ok: false, motivo: "campo_obrigatorio_ausente", porque: "a ficha nao declara `venue` — sem venue nao se sabe com quem se fala" };
  }
  for (const campo of ["nome", "ambiente", "url_da_api"]) {
    const v = venue[campo];
    if (v === undefined) return { ok: false, motivo: "campo_obrigatorio_ausente", porque: `a ficha nao declara \`venue.${campo}\`` };
    if (typeof v !== "string") return { ok: false, motivo: "tipo_invalido", porque: `a ficha traz \`venue.${campo}\` como ${typeof v}, e devia ser texto` };
  }
  const credencial = objecto(f.credencial);
  if (credencial === undefined) {
    return { ok: false, motivo: "campo_obrigatorio_ausente", porque: "a ficha nao declara `credencial` — o conector nao procura chaves, le a referencia que lhe derem" };
  }
  // A CREDENCIAL DA FICHA: o que ela DECLAROU, e nada mais. Era `texto(credencial.referencia) ?? ""` (e o mesmo
  // em `valor_em`): um campo AUSENTE virava a cadeia vazia, e a porta `chave` deixava de distinguir «nao
  // declarado» de «declarado vazio» — duas ausencias diferentes a chegar com a mesma cara. O valor viaja como
  // veio (`texto` devolve `undefined` ao que nao e' texto) e quem o recusa e' a porta `chave`, nomeando o que
  // falta (FR-023). A identidade do conector nao inventa um sitio para a chave.
  const instrumentos = f.instrumentos;
  if (!Array.isArray(instrumentos) || instrumentos.length === 0) {
    return { ok: false, motivo: "campo_obrigatorio_ausente", porque: "a ficha nao declara os `instrumentos` que o mandato nomeia" };
  }
  for (const i of instrumentos) {
    if (typeof i !== "string" || !PADRAO_INSTRUMENTO.test(i)) {
      return { ok: false, motivo: "formato_invalido", porque: `o instrumento ${JSON.stringify(i)} da ficha nao tem a forma do contrato` };
    }
  }
  return {
    ok: true,
    ficha: {
      conector,
      contrato,
      versao_do_conector: f.versao_do_conector as string,
      venue: {
        nome: venue.nome as string,
        ambiente: venue.ambiente as "teste" | "producao",
        url_da_api: venue.url_da_api as string,
      },
      conta: f.conta as string,
      credencial: {
        referencia: texto(credencial.referencia),
        valor_em: texto(credencial.valor_em),
      },
      instrumentos: instrumentos as string[],
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// A bateria: os campos que o venue nao publica e que SO a bateria de conformidade mede (FR-027).
// ---------------------------------------------------------------------------------------------------------

/**
 * Junta a sonda (o que o venue publicou) com o que a BATERIA mediu. Fail-closed nos dois sentidos:
 *
 *   * sem bateria e com campos por medir, nao ha manifesto — e diz-se QUAIS faltam (nao se inventa um numero
 *     do venue no nosso codigo, RN-C1);
 *   * uma declaracao da bateria sobre um campo que a sonda JA mediu e uma CONTRADICAO: o processo nao escolhe
 *     uma das duas verdades, recusa e diz qual e o campo.
 */
export function juntarBateria(
  medida: SondaMedida,
  bateria: Bateria,
): { ok: true; sonda: Sonda; usados: string[] } | { ok: false; motivo: string; porque: string } {
  const porMedir = medida.nao_medidos;
  if (bateria === null || bateria === undefined) {
    if (porMedir.length === 0) return { ok: true, sonda: medida.sonda, usados: [] };
    return {
      ok: false,
      motivo: "capacidade_nao_declarada",
      porque:
        `o venue nao publica ${porMedir.join(", ")} e a bateria de conformidade ainda nao os mediu (FR-027/RN-C6) — ` +
        "sem a declaracao dela nao ha manifesto, e o manifesto e o que a mesa le",
    };
  }
  const sonda: Sonda = { ...medida.sonda };
  const usados: string[] = [];
  for (const [campo, valor] of Object.entries(bateria)) {
    if (!porMedir.includes(campo)) {
      return {
        ok: false,
        motivo: "campo_desconhecido",
        porque:
          `a bateria declara \`${campo}\`, e a sonda do venue JA o mediu (os que ela nao mede sao: ` +
          `${lista(porMedir)}): duas declaracoes do mesmo campo, e o processo nao escolhe uma`,
      };
    }
    (sonda as unknown as Record<string, unknown>)[campo] = valor;
    usados.push(campo);
  }
  return { ok: true, sonda, usados };
}

// ---------------------------------------------------------------------------------------------------------
// O ARRANQUE: as portas do processo, pela ordem declarada.
// ---------------------------------------------------------------------------------------------------------

export async function arrancar(entrada: Entrada, opcoes: { sem_chave?: boolean } = {}): Promise<Arranque> {
  const portas: ResultadoDaPorta[] = [];

  function passou(porta: string, porque: string): void {
    portas.push({ porta, veredicto: "passou", porque });
  }
  function naoCorrida(porta: string, porque: string): void {
    portas.push({ porta, veredicto: "nao_corrida", porque });
  }
  function falhou(porta: string, motivo: string, porque: string): Arranque {
    const limpo = motivoDoContrato(motivo);
    portas.push({ porta, veredicto: "falhou", motivo: limpo, porque });
    return { ok: false, portas, porta, motivo: limpo, porque };
  }

  // ---- porta 1: a ficha --------------------------------------------------------------------------------
  const fichaR = exigirFicha(entrada.ficha);
  if (!fichaR.ok) return falhou("ficha", fichaR.motivo, fichaR.porque);
  const ficha = fichaR.ficha;
  passou(
    "ficha",
    `ficha do conector \`${ficha.conector}\` legivel: venue ${ficha.venue.nome}, ambiente ${ficha.venue.ambiente}, ` +
      `UMA conta, ${ficha.instrumentos.length} instrumento(s) do mandato (${ficha.instrumentos.join(", ")})`,
  );

  // ---- porta 2: a versao do contrato -------------------------------------------------------------------
  const vigente = versaoVigente();
  if (ficha.contrato !== vigente) {
    return falhou(
      "versao_do_contrato",
      "versao_do_contrato_divergente",
      `a ficha declara ${ficha.contrato} e a versao vigente e ${vigente} — igualdade EXACTA, nunca "compativel" (D7). Nada sai`,
    );
  }
  passou("versao_do_contrato", `a ficha e a versao vigente concordam: contrato ${vigente} (conferido em contracts/versao.json)`);

  // ---- porta 3: uma conta ------------------------------------------------------------------------------
  // A `conta` exige-se AQUI, e nao na porta da ficha: o que a porta da ficha confere e a FORMA do documento
  // (os campos que o contrato desta ponta declara); o que esta porta confere e a REGRA — uma conta, utilizavel,
  // e nenhum lugar para uma segunda (FR-019/FR-022). Uma ficha sem conta nao e uma ficha mal formada: e uma
  // ficha que nao diz com quem fala.
  if (ficha.conta === undefined || ficha.conta === null) {
    return falhou("uma_conta", "campo_obrigatorio_ausente", "a ficha nao declara `conta` — sem conta nao ha um processo por (corretora, conta) (FR-019)");
  }
  // `objecto(...) ?? {}` fazia de uma ficha que nao e' objecto uma ficha sem `contas` — e a porta passava. A
  // ficha e' o documento que este processo confere: se ela nao tem forma, a recusa e' aqui, e nao numa
  // leitura mais abaixo que daria um diagnostico pior.
  const fichaComoObjecto = objecto(entrada.ficha);
  if (fichaComoObjecto === undefined) {
    return falhou("uma_conta", "campo_obrigatorio_ausente", "a ficha do conector nao e um objecto: nao ha `conta` que se possa conferir num documento que nao tem forma");
  }
  if (Object.prototype.hasOwnProperty.call(fichaComoObjecto, "contas")) {
    return falhou(
      "uma_conta",
      "campo_desconhecido",
      "a ficha traz `contas` (uma lista) e o contrato desta ponta e UMA conta por processo: uma ligacao, uma chave (FR-019)",
    );
  }
  if (ficha.conta.trim() === "") {
    return falhou("uma_conta", "campo_obrigatorio_ausente", "a ficha declara `conta` vazia — sem conta nao ha um processo por conta");
  }
  passou("uma_conta", `uma conta por processo: ${ficha.conta} (um pedido que nomeie outra conta nao atravessa este envelope fechado)`);

  // ---- porta 4: o ambiente e a rede --------------------------------------------------------------------
  const ambiente = ficha.venue.ambiente;
  if (ambiente !== "teste" && ambiente !== "producao") {
    return falhou(
      "ambiente_e_rede",
      "valor_fora_do_conjunto",
      `a ficha declara o ambiente ${JSON.stringify(ambiente)}; os declarados sao teste e producao`,
    );
  }
  const enderecos = entrada.enderecos?.[ambiente];
  if (!Array.isArray(enderecos) || enderecos.length === 0) {
    return falhou(
      "ambiente_e_rede",
      "campo_obrigatorio_ausente",
      `nao ha endereco declarado nenhum para o ambiente ${ambiente}: sem a lista do dono, a rede nao se adivinha`,
    );
  }
  if (!enderecos.includes(ficha.venue.url_da_api)) {
    return falhou(
      "ambiente_e_rede",
      "valor_fora_do_conjunto",
      `o endereco ${ficha.venue.url_da_api} nao esta entre os declarados para o ambiente ${ambiente} ` +
        `(${enderecos.join(", ")}): a rede tem de bater com o ambiente, e nao se corrige em silencio`,
    );
  }
  if (ambiente === "producao") {
    return falhou(
      "ambiente_e_rede",
      "valor_fora_do_conjunto",
      "este recorte corre no ambiente de TESTE (RN-H17): a passagem a producao e decisao declarada do dono, " +
        "nunca uma bandeira que este processo levanta sozinho — recusa-se em vez de se estrear em dinheiro a serio",
    );
  }
  passou("ambiente_e_rede", `ambiente ${ambiente} e endereco ${ficha.venue.url_da_api} batem certo com o que o dono declarou`);

  // ---- porta 5: a chave --------------------------------------------------------------------------------
  let credencial: EstadoDoProcesso["credencial"] = null;
  if (opcoes.sem_chave === true) {
    naoCorrida(
      "chave",
      "modo de SONDA: nenhuma assinatura e feita e o VALOR da credencial nao e lido (FR-023/RN-E14). " +
        "Este modo NAO serve boletas — quem nao pode assinar nao pode encomendar",
    );
  } else {
    const c = carregarCredencial(ficha.credencial.referencia, ficha.credencial.valor_em);
    if (!c.ok) return falhou("chave", c.motivo, c.porque);
    credencial = { de: c.de, protegido: c.protegido };
    passou(
      "chave",
      `credencial \`${ficha.credencial.referencia}\` resolvida de ${c.de} (${c.protegido}); ` +
        "o VALOR da chave nunca entra no registo deste processo (FR-023)",
    );
  }

  // ---- porta 6: a ligacao (o estado vem do protocolo do venue) -----------------------------------------
  const pedidoDeLeitura: PedidoDeLeitura = { conta: ficha.conta, instrumento: ficha.instrumentos[0] };
  const respostasDaConta: RespostasDaConta = await lerDoVenueDaConta(entrada.porta.conta, pedidoDeLeitura);
  const leitura = lerConta(respostasDaConta, pedidoDeLeitura);
  if (!leitura.ok) {
    return falhou("ligacao", leitura.motivo, `o venue nao respondeu o que a leitura precisa: ${leitura.porque}`);
  }
  const carteiras = leitura.leitura.carteiras;
  if (carteiras.perpetuo.estado !== "lida") {
    return falhou(
      "ligacao",
      "campo_obrigatorio_ausente",
      `leu-se(s) ${carteiras.confirmadas_pelo_venue} carteira(s) e o PERPETUO nao esta entre as lidas ` +
        `(nao lidas: ${lista(carteiras.nao_lidas)}): sem o equity do perpetuo nao ha traducao ` +
        "possivel — FR-021, sem leitura da conta o conector nao manda ordem que aumente exposicao",
    );
  }
  const estadoDaExchange = respostasDaConta.perpetuo?.ok === true || respostasDaConta.spot?.ok === true ? "ligada" : "desconhecido";
  const lidas: string[] = [];
  const falhadas: string[] = [];
  for (const [nome, r] of [
    ["perpetuo", respostasDaConta.perpetuo],
    ["spot", respostasDaConta.spot],
    ["activo", respostasDaConta.activo],
    ["agentes", respostasDaConta.agentes],
  ] as [string, Resposta | undefined][]) {
    if (r?.ok === true) lidas.push(nome);
    else falhadas.push(nome);
  }
  passou(
    "ligacao",
    `estado da ligacao pelo protocolo do venue: ${estadoDaExchange} (o venue RESPONDEU ao pedido da conta; o ` +
      `silencio do protocolo seria \`desconhecido\`, nunca \`ligada\` nem \`caido\` — FR-020). Leituras respondidas: ` +
      `${lidas.join(", ")}${falhadas.length ? `; SEM resposta: ${falhadas.join(", ")}` : ""}. Carteiras: ` +
      `${carteiras.nomes.join(", ")}${carteiras.nao_lidas.length ? ` (NAO lidas: ${carteiras.nao_lidas.join(", ")})` : ""}`,
  );

  // ---- porta 7: a sonda e o manifesto ------------------------------------------------------------------
  const pedidoDaSonda: PedidoDaSonda = {
    venue: ficha.venue.nome,
    ambiente: ficha.venue.ambiente,
    versao_do_conector: ficha.versao_do_conector,
    instrumentos_pedidos: ficha.instrumentos,
    instrumento_de_referencia: ficha.instrumentos[0],
    instante_de_referencia_ms: entrada.instante_ms,
  };
  const respostasDaSonda = await lerDoVenue(entrada.porta.leitura, pedidoDaSonda, ficha.conta);
  const medida = construirSonda(respostasDaSonda, pedidoDaSonda);
  const juntada = juntarBateria(medida, entrada.bateria);
  if (!juntada.ok) return falhou("sonda_e_manifesto", juntada.motivo, juntada.porque);
  const m: ResultadoDoManifesto = construirManifesto(juntada.sonda);
  if (!m.ok) {
    // O porque do manifesto nomeia o PRIMEIRO campo que falta, e so ele. A lista COMPLETA do que a sonda nao
    // mediu e do que a bateria declarou vai tambem: e essa lista que diz a quem mede (a conformidade) o que
    // ainda falta medir — um campo de cada vez obrigaria a N arranques para descobrir a lista toda.
    return falhou(
      "sonda_e_manifesto",
      m.motivo,
      `${m.porque}. A sonda desta corrida NAO mediu: ${lista(medida.nao_medidos)}. A bateria declarou: ${
        lista(juntada.usados)
      }`,
    );
  }

  // A PUBLICACAO: o manifesto sai no envelope do contrato, e so sai se o contrato o aceitar.
  const linha = JSON.stringify({
    contrato: vigente,
    tipo: "manifesto",
    id: `${ficha.conector}/manifesto`,
    carga: m.manifesto,
  });
  const decisao = validar(linha);
  if (decisao.veredicto === "erro_de_execucao") {
    throw new Error("o instrumento de medicao (o contrato) nao conseguiu julgar o manifesto: nao se publica por omissao");
  }
  if (decisao.veredicto !== "aceite") {
    // O MOTIVO DA RECUSA E O DO CONTRATO, com o nome dele. Era `decisao.motivo ?? "capacidade_nao_declarada"`:
    // quando o contrato recusava sem nomear, este processo inventava um motivo — e um motivo inventado e' pior
    // do que um motivo em falta, porque quem o le acredita nele (diria que falta declarar capacidade, quando o
    // que faltou foi outra coisa). Um contrato que recusa sem motivo e' um contrato partido, e diz-se.
    const nomeDoMotivo = decisao.motivo;
    if (nomeDoMotivo === null) {
      return falhou(
        "sonda_e_manifesto",
        "desfecho_nao_reconhecido",
        `o envelope do contrato recusou o manifesto da sonda SEM declarar motivo (veredicto ${decisao.veredicto}) — ` +
          "uma recusa sem motivo nao se substitui por um motivo nosso",
      );
    }
    return falhou(
      "sonda_e_manifesto",
      nomeDoMotivo,
      `o manifesto que a sonda produziu nao passou o envelope do contrato: ${decisao.veredicto}/${decisao.motivo}` +
        `${decisao.detalhe ? ` (${decisao.detalhe})` : ""} — um manifesto que o contrato nao aceita nao se publica`,
    );
  }
  passou(
    "sonda_e_manifesto",
    `sonda do venue lida e manifesto publicado: ${(m.manifesto.instrumentos as unknown[]).length} instrumento(s) ` +
      `com unidade declarada, tipos de ordem ${JSON.stringify(m.manifesto.tipos_de_ordem)}, ` +
      `parcial ${JSON.stringify(m.manifesto.parcial_suportada)}` +
      (juntada.usados.length ? `; a bateria declarou ${juntada.usados.join(", ")}` : "; nada veio da bateria (o venue declarou tudo)"),
  );

  // ---- porta 8: a IDENTIDADE (o agente que assina esta registado NA CONTA?) --------------------------------
  // A porta `chave` provou que a credencial se LE; esta prova que ela e' DESTA conta. Compara-se o endereco do
  // agente que assina (derivado da chave, por referencia, na porta ao vivo; declarado no dado, no duble) com os
  // agentes que o VENUE publica para a conta — `extraAgents`, que ja foi lido na porta `ligacao`. Divergencia,
  // lista ilegivel ou prazo passado: RECUSA, e o processo nao serve nada (FR-023/RN-E13/RN-H15).
  const doAgente = entrada.porta.identidade;
  if (doAgente === undefined) {
    naoCorrida(
      "identidade",
      "esta porta do venue nao declara o endereco do agente que assina: sem ele nao ha o que comparar com os " +
        "agentes da conta. A porta ao vivo deriva-o da chave carregada por REFERENCIA (`credencial.ts`); o duble " +
        "declara-o em `identidade.endereco_do_agente` do ficheiro de casos. Nao se inventa: fica `nao_corrida`",
    );
  } else {
    const identidadeDoVenue = conferirIdentidade({
      agente: doAgente.endereco_do_agente,
      conta: ficha.conta,
      agentes: respostasDaConta.agentes?.ok === true ? respostasDaConta.agentes.valor : undefined,
      instante_ms: entrada.instante_ms,
    });
    if (!identidadeDoVenue.ok) return falhou("identidade", identidadeDoVenue.motivo, identidadeDoVenue.porque);
    passou("identidade", identidadeDoVenue.porque);
  }

  return {
    ok: true,
    estado: {
      ficha,
      manifesto: m.manifesto,
      linha_do_manifesto: linha,
      sonda: juntada.sonda,
      credencial,
      estado_da_ligacao: estadoDaExchange,
      carteiras: { nomes: carteiras.nomes, nao_lidas: carteiras.nao_lidas, nota: carteiras.nota },
      portas,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// A CONVERSA NO ENVELOPE.
// ---------------------------------------------------------------------------------------------------------

export type Atendimento = { linhas: string[]; diag: Record<string, unknown>[] };

const PADRAO_CORRELACAO = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

function envelope(tipo: string, id: string, carga: Record<string, unknown>, contrato: string): string {
  return JSON.stringify({ contrato, tipo, id, carga });
}

/** A `resolucao` da traducao — a que sai ANTES do envio: [C] sobre numeros do venue, e dito. */
export function resolucaoDaTraducao(accao: AccaoDoVenue, tick: string): Record<string, unknown> {
  const liquidacao = precoDeLiquidacaoProjectado(accao.preco, accao.alavancagem, tick);
  if (liquidacao === null) {
    // Chegar aqui e um defeito NOSSO (a traducao ja garantiu a forma do preco e da alavancagem): uma resolucao
    // sem preco de liquidacao nao se manda com um zero inventado — o processo para.
    throw new Error(
      `nao consegui projectar o preco de liquidacao (preco ${JSON.stringify(accao.preco)}, alavancagem ` +
        `${JSON.stringify(accao.alavancagem)}, tick ${JSON.stringify(tick)}): nao se manda uma resolucao com um numero inventado`,
    );
  }
  return {
    quantidade: accao.quantidade,
    nocional: accao.nocional,
    margem_empenhada: dividirPorInteiro(accao.nocional, accao.alavancagem, CASAS_DA_MARGEM),
    alavancagem_efectiva: accao.alavancagem,
    preco_de_liquidacao: liquidacao,
  };
}

/** A `resolucao` com os numeros do VENUE, lidos DEPOIS do envio. Todos [V] — nenhum recalculado por nos. */
export function resolucaoDaPosicao(posicao: PosicaoDaLeitura, totalSz: string): Record<string, unknown> | null {
  const liquidacao = posicao.preco_de_liquidacao;
  if (liquidacao === undefined || liquidacao === null || liquidacao === "") return null;
  return {
    quantidade: totalSz,
    nocional: posicao.nocional,
    margem_empenhada: posicao.margem,
    alavancagem_efectiva: String(posicao.alavancagem.valor),
    preco_de_liquidacao: liquidacao,
  };
}

/**
 * A tabela DECLARADA que traduz a PALAVRA do venue para o motivo do contrato.
 *
 * A palavra do venue vai SEMPRE inteira em `resposta_do_venue` (FR-012: e a palavra DELE, nao a nossa
 * interpretacao). Esta tabela existe so porque o contrato exige um motivo do conjunto fechado: onde ela nao
 * conhece a palavra, o motivo generico declarado e usado E DITO no diagnostico — nunca se inventa um motivo
 * especifico que o venue nao deu.
 */
const MOTIVO_PELA_PALAVRA_DO_VENUE: { fragmento: string; motivo: string; nota: string }[] = [
  {
    fragmento: "minimum",
    motivo: "valor_abaixo_do_minimo_do_venue",
    nota: "o venue recusa ordens abaixo do piso de valor dele",
  },
  {
    fragmento: "post only",
    motivo: "valor_fora_da_banda",
    nota:
      "o venue recusou por cruzamento: a boleta nao e corrigida para caber (US2.4) — o contrato 1.3.0 nao tem " +
      "motivo proprio para o cruzamento, e usa-se o generico, com a palavra do venue ao lado",
  },
];

function motivoPelaPalavraDoVenue(palavra: string): { motivo: string; nota: string } {
  const baixa = palavra.toLowerCase();
  for (const linha of MOTIVO_PELA_PALAVRA_DO_VENUE) {
    if (baixa.includes(linha.fragmento)) return { motivo: linha.motivo, nota: linha.nota };
  }
  return {
    motivo: "valor_fora_da_banda",
    nota: "palavra do venue sem traducao propria nesta tabela declarada: motivo generico, com a palavra DELE inteira ao lado",
  };
}

function comPrazo(promessa: Promise<Resposta>, ms: number): Promise<Resposta> {
  return new Promise((resolve) => {
    let feito = false;
    const t = setTimeout(() => {
      if (!feito) {
        feito = true;
        resolve({ ok: false, erro: `o venue nao respondeu em ${ms} ms` });
      }
    }, ms);
    promessa
      .then((r) => {
        if (!feito) {
          feito = true;
          clearTimeout(t);
          resolve(r);
        }
      })
      .catch((e) => {
        if (!feito) {
          feito = true;
          clearTimeout(t);
          resolve({ ok: false, erro: e instanceof Error ? e.message : String(e) });
        }
      });
  });
}

// ---------------------------------------------------------------------------------------------------------
// A RECONCILIACAO ANTES DO ENVIO — a guarda contra a ORDEM DUPLICADA (D-009, RN-C4).
//
// O QUE SE MEDIU, e porque isto existe. O manifesto declara `idempotencia`, e este venue DECLARA `true` — mas a
// P6 da bateria de teste (29/09/2026) mediu o CONTRARIO: a MESMA boleta (mesma referencia de cliente, logo o
// mesmo `cloid`) enviada duas vezes produziu DUAS ordens, e a posicao passou de 0.00023 para 0.00046. O `cloid`
// NAO e um mecanismo de deduplicacao neste venue: ele guarda-o, publica-o, e aceita a segunda ordem na mesma.
//
// Uma declaracao que mente nao pode ser a unica guarda do dinheiro. Por isso a reconciliacao e' INCONDICIONAL
// (corre em todo o envio, e nao so' quando a declaracao diz «nao»): antes de mandar, le-se o registo de ordens
// da conta e procura-se o `cloid` que a traducao DERIVOU desta referencia. A derivacao e' de mao unica: da
// referencia para o `cloid` vai-se; de volta, nao (o venue guarda o hash, nao a referencia).
//
// E' o que a decisao de reenviar da casa ja' diz por escrito (`contracts/esqueleto/referencia.ts`): «sem
// idempotencia declarada pelo venue, a mesa NUNCA reenvia a credo — reconcilia primeiro». Aqui a reconciliacao
// e' feita onde o venue esta' — esta ponta — em vez de se esperar que outra ponta a peca.
//
// OS TRES DESFECHOS, e nenhum deles manda uma segunda ordem:
//   * ninguem com este `cloid` -> segue (envia);
//   * a ordem JA' ESTA' LA'     -> RECUSA (`referencia_ja_enviada_ao_venue`), e a ordem que existe vai inteira
//     em `resposta_do_venue` (a resposta BRUTA do venue, que o contrato nao interpreta);
//   * a leitura NAO SE FEZ (venue calado, erro, ou fora do prazo) -> `desconhecido`, e NAO se envia: sem saber
//     se a ordem ja' la' esta', mandar e' uma aposta — e uma aposta custa dinheiro duas vezes.
export function ordemDaReferencia(ordens: unknown, cloid: string): Record<string, unknown> | null {
  if (!Array.isArray(ordens)) return null;
  for (const item of ordens) {
    // A forma do registo deste venue: cada item traz a ordem em `order` (`historicalOrders`).
    const o = objecto(objecto(item)?.order);
    if (o === undefined) continue;
    // Comparacao EXACTA: o venue ecoa o `cloid` que recebeu (medido: `0xbf…aa8` foi e voltou igual).
    if (texto(o.cloid) === cloid) return o;
  }
  return null;
}

export type VeredictoDaReconciliacao =
  | { veredicto: "livre" }
  | { veredicto: "ja_existe"; ordem: Record<string, unknown> }
  | { veredicto: "nao_se_leu"; erro: string };

function reconciliarAntesDoEnvio(porta: Porta, conta: string, cloid: string, prazoMs: number): Promise<VeredictoDaReconciliacao> {
  return comPrazo(
    (async () => ({ ok: true as const, valor: await porta.historico.ordensHistoricas(conta) }))(),
    prazoMs,
  ).then((r) => {
    if (!r.ok) return { veredicto: "nao_se_leu" as const, erro: r.erro };
    const ordem = ordemDaReferencia(r.valor, cloid);
    return ordem === null ? ({ veredicto: "livre" } as const) : ({ veredicto: "ja_existe", ordem } as const);
  });
}

function marcaDoVenue(resposta: unknown): string | undefined {
  const o = objecto(objecto(resposta)?.valor);
  return o !== undefined ? texto(o.markPx) : undefined;
}

/**
 * O identificador que o venue deu, em TEXTO decimal: um `oid` que vem como numero entra como texto (o
 * contrato desta ponta nao transporta numeros com virgula flutuante, e um inteiro nao e uma grandeza). */
function identificadorDe(v: unknown): string | undefined {
  if (typeof v === "string" && v !== "") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  return undefined;
}

function unidadeDo(manifesto: Record<string, unknown>, instrumento: string): { tick: string } | undefined {
  const lista = manifesto.instrumentos;
  if (!Array.isArray(lista)) return undefined;
  const u = (lista as Record<string, unknown>[]).find((i) => i?.simbolo === instrumento);
  if (u === undefined) return undefined;
  const tick = texto(u.tick);
  return tick !== undefined ? { tick } : undefined;
}

export type OpcoesDaConversa = {
  /** O prazo declarado do processo para a resposta do venue (o contrato nao tem campo para ele: ver o relatorio). */
  prazo_do_venue_ms?: number;
  /** Defeitos DE PROPOSITO, so para a prova negativa da bancada: `classificacao`, `sem_motivo`, `versao`. */
  defeito?: string;
};

/**
 * SERVE UM PEDIDO DE HISTORICO (FR-018, RN-H14) — a leitura do trilho do dinheiro, do venue.
 *
 * E uma funcao propria, e nao um pedaco dentro do `atender`, por uma razao MEDIDA: o contrato nao tem tipo
 * de mensagem para PEDIR o historico (o `historico` do envelope e o CORPO do que o venue conta — o
 * esquema dele exige instrumento, moeda, instante e execucoes, que e a forma de uma RESPOSTA, nao a de um
 * pedido). Quem o serve, entao, e: (a) uma linha `historico` que chegue ao processo (o `atender` chama
 * isto), e (b) o modo `--historico <instrumento>` do `processo.ts`, que da a mesma leitura sem pedido —
 * como o `--so-sonda` faz com o manifesto. Uma funcao, dois caminhos.
 *
 * A ordem: le-se o venue; o que ele nao deu fica `nao_publicado`, pelo nome; a carga do contrato leva SO o
 * que foi lido; e quem julga se ela esta completa e O ESQUEMA DO CONTRATO. Se ele a recusar, NAO se serve
 * uma mensagem com um campo preenchido por nos — sai a RECUSA NOMEADA, com o motivo do contrato, a razao e
 * a lista do que o venue nao publica. Nunca zero, nunca soma (somar execucoes para «reconstruir» o
 * resultado e o defeito que a regra proibe).
 */
export async function servirHistorico(
  id: string,
  instrumento: string,
  estado: EstadoDoProcesso,
  porta: Porta,
  opcoes: { inicio_ms?: number; defeito?: string } = {},
): Promise<Atendimento> {
  const diag: Record<string, unknown>[] = [];
  const defeito = opcoes.defeito;
  const versao = defeito === "versao" ? "9.9.9" : versaoVigente();

  function conferivel(l: string): string {
    if (defeito === undefined) conferirAntesDeSair(l);
    return l;
  }

  function recusar(motivo: string, porque: string, resposta: Record<string, unknown>): Atendimento {
    const limpo = motivoDoContrato(motivo);
    diag.push({ etapa: "historico", veredicto: "recusado", motivo: limpo, porque });
    const carga: Record<string, unknown> = { classificacao: "recusado", motivo: limpo, resposta_do_venue: resposta };
    if (defeito === "sem_motivo") delete carga.motivo;
    return { linhas: [conferivel(envelope("desfecho", id, carga, versao))], diag };
  }

  const pedido: PedidoDeHistorico = {
    conta: estado.ficha.conta,
    instrumento,
    ...(opcoes.inicio_ms !== undefined ? { inicio_ms: opcoes.inicio_ms } : {}),
  };
  const respostas = await lerDoVenueDoHistorico(porta.historico, pedido);
  const h = lerHistorico(respostas, pedido);
  if (!h.ok) {
    diag.push({ etapa: "historico", veredicto: "nao_lido", motivo: h.motivo, porque: h.porque });
    return recusar(h.motivo, `o historico do venue nao se leu: ${h.porque}`, {
      estado: "historico_nao_lido",
      instrumento,
    });
  }

  const carga = cargaDoHistorico(h.leitura);
  diag.push({
    etapa: "historico",
    veredicto: "lido",
    instrumento,
    execucoes: h.leitura.execucoes.length,
    instante_do_venue_ms: h.leitura.instante_ms,
    moeda: h.leitura.moeda,
    taxas_da_conta: h.leitura.taxas_da_conta,
    funding_da_conta: h.leitura.funding_da_conta,
    funding_publicado: h.leitura.funding_publicado,
    resultado_realizado_do_instrumento: h.leitura.resultado_realizado_do_instrumento,
    marca_de_posse: h.leitura.marca_de_posse,
    nao_publicados: h.leitura.nao_publicados,
    origens: h.leitura.origens,
    notas: h.leitura.notas,
  });

  const linhaDoHistorico = envelope("historico", `${id}/historico`, carga, versao);
  const decisao = validar(linhaDoHistorico);
  if (decisao.veredicto === "erro_de_execucao") {
    throw new Error("o instrumento de medicao (o contrato) falhou a julgar o historico: nao se serve por omissao");
  }
  if (decisao.veredicto !== "aceite") {
    // O CONTRATO e o juiz da completude: se ele recusa a carga, o que falta e DO VENUE, e a resposta honesta
    // e a recusa NOMEADA. A leitura crua vai na resposta para nada depender da nossa interpretacao.
    //
    // O MOTIVO E O DELE. Era `decisao.motivo ?? "campo_obrigatorio_ausente"`: quando o contrato recusava sem
    // nomear, esta ponta respondia com um motivo PROPRIO — e o dono lia uma causa que ninguem tinha dito.
    const nomeDoMotivo = decisao.motivo;
    if (nomeDoMotivo === null) {
      throw new Error(
        `o contrato recusou o historico do venue SEM declarar motivo (veredicto ${decisao.veredicto}): uma recusa ` +
          "sem motivo nao se substitui por um motivo nosso — o que falta e' do venue, e quem o nomeia e' o contrato",
      );
    }
    return recusar(
      nomeDoMotivo,
      `o historico lido do venue nao passou o envelope do contrato: ${decisao.veredicto}/${decisao.motivo}` +
        `${decisao.detalhe ? ` (${decisao.detalhe})` : ""} — as grandezas que o contrato exige e que o venue NAO deu ` +
        `(ou nao deu na forma do contrato) sao: ${h.leitura.nao_publicados.join(", ")}. ` +
        "Nenhum desses campos se preenche por nossa conta: somar as parcelas seria reconstruir o resultado e " +
        "escrever zero seria inventar um numero medido (FR-018/RN-H14)",
      { estado: "historico_lido_e_nao_servivel", instrumento, leitura: h.leitura },
    );
  }
  return { linhas: [conferivel(linhaDoHistorico)], diag };
}

/**
 * Atende UMA mensagem. Devolve as linhas que saem (zero, uma ou duas) e o diagnostico.
 *
 * A ordem das linhas e a ordem dos factos: a `resolucao` sai antes do envio; o `desfecho` sai depois. Nada sai
 * que o contrato nao aceite — cada linha e conferida com `validar()` antes de sair daqui, e uma linha nossa que
 * o contrato recuse PARA O PROCESSO (nao se manda uma mensagem invalida e espera-se que o outro a note).
 */
export async function atender(
  linha: string,
  estado: EstadoDoProcesso,
  porta: Porta,
  opcoes: OpcoesDaConversa = {},
): Promise<Atendimento> {
  const diag: Record<string, unknown>[] = [];
  const defeito = opcoes.defeito;

  // O PRAZO DO VENUE E DECLARADO POR QUEM CHAMA — o conector nao tem omissao.
  //
  // Era `opcoes.prazo_do_venue_ms ?? 3000`, em dois sitios. Um numero que decide se o SILENCIO do venue fica
  // `desconhecido` ou passa por sucesso (FR-013/RN-T7.1) estava escrito dentro de uma expressao, onde nao se le
  // como decisao nem se muda com consciencia. Quem corre o conector declara-o (`processo.ts`, no limite do CLI
  // e da bancada); aqui exige-se, e um conector sem prazo nao serve nada em vez de servir com um prazo seu.
  const prazoDoVenue = opcoes.prazo_do_venue_ms;
  if (typeof prazoDoVenue !== "number" || !Number.isFinite(prazoDoVenue) || prazoDoVenue <= 0) {
    throw new Error(
      `o conector foi chamado sem um prazo do venue declarado (veio ${String(prazoDoVenue)}): o prazo e' o que ` +
        "decide se o silencio do venue fica `desconhecido`, e nao se adivinha",
    );
  }

  // O defeito da versao: uma versao que NAO e a vigente (o valor e declarado aqui como um numero que nenhuma
  // serie do contrato usa — quando a vigente era a 1.3.0 este defeito escrevia 1.4.0, e com a 1.4.0 vigente
  // passou a ser um defeito que nao era defeito nenhum: a armadilha de escrever a versao do contrato num teste).
  const versao = defeito === "versao" ? "9.9.9" : versaoVigente();

  /**
   * Confere a linha antes de ela sair (menos nos casos de DEFEITO DE PROPOSITO, que existem para provar que o
   * conferidor do outro lado as apanha). Uma mensagem nossa que o contrato recuse PARA a conversa.
   */
  function conferivel(l: string): string {
    if (defeito === undefined) conferirAntesDeSair(l);
    return l;
  }

  function saida(id: string, carga: Record<string, unknown>): string {
    const c = { ...carga };
    if (defeito === "classificacao") c.classificacao = "aceita"; // fora do conjunto, DE PROPOSITO
    if (defeito === "sem_motivo") delete c.motivo;
    return conferivel(envelope("desfecho", id, c, versao));
  }

  function recusa(id: string, motivo: string, porque: string, resposta: Record<string, unknown>, jaSaida: string[]): Atendimento {
    const limpo = motivoDoContrato(motivo);
    diag.push({ etapa: "desfecho", veredicto: "recusado", motivo: limpo, porque });
    jaSaida.push(saida(id, { classificacao: "recusado", motivo: limpo, resposta_do_venue: resposta }));
    return { linhas: jaSaida, diag };
  }

  // 1. o envelope: uma linha, um objecto, a versao vigente, o esquema do tipo (D4/D5/D7).
  const decisao = validar(linha);
  let pedido: Record<string, unknown> | undefined;
  try {
    const bruto = JSON.parse(linha);
    pedido = objecto(bruto);
  } catch {
    pedido = undefined;
  }
  const id = typeof pedido?.id === "string" && PADRAO_CORRELACAO.test(pedido.id as string) ? (pedido.id as string) : "sem_id";

  if (decisao.veredicto === "erro_de_execucao") {
    throw new Error("o instrumento de medicao (o contrato) falhou a julgar a mensagem: nao se responde por omissao");
  }
  if (decisao.veredicto !== "aceite") {
    diag.push({ etapa: "envelope", veredicto: "recusado", motivo: decisao.motivo, detalhe: decisao.detalhe });
    return {
      linhas: [
        saida(id, {
          classificacao: "recusado",
          motivo: decisao.motivo,
          resposta_do_venue: {},
        }),
      ],
      diag,
    };
  }

  const tipo = pedido?.tipo as string;

  // -------------------------------------------------------------------------------------------------------
  // O TIPO `historico` (FR-018, RN-H14) — o trilho do dinheiro, como o venue o conta.
  //
  // O corpo esta em `servirHistorico` (acima) porque este mesmo trabalho tem DOIS caminhos de entrada: uma
  // linha `historico` que chegue ao processo, e o modo `--historico <instrumento>` do `processo.ts` — que
  // existe porque o contrato NAO tem tipo de mensagem para PEDIR o historico (medido: o esquema do
  // `historico` exige instrumento, moeda, instante e execucoes — a forma de uma RESPOSTA). Uma funcao, dois
  // caminhos, para nao haver duas regras a divergir.
  // -------------------------------------------------------------------------------------------------------
  if (tipo === "historico") {
    // A CARGA DO PEDIDO, ou recusa. Era `objecto(pedido?.carga) ?? {}`: um pedido sem carga seguia como um
    // pedido sem `instrumento`, e a recusa saia por "campo obrigatorio ausente" — verdadeira, mas apontando
    // para o instrumento quando o que faltava era a carga inteira.
    const cargaDoPedido = objecto(pedido?.carga);
    if (cargaDoPedido === undefined) {
      return recusa(
        id,
        "campo_obrigatorio_ausente",
        "o pedido de historico nao traz `carga`: sem ela nao ha instrumento, nem janela, nem nada a ler do venue",
        {},
        [],
      );
    }
    const instrumento = texto(cargaDoPedido.instrumento);
    if (instrumento === undefined) {
      return recusa(
        id,
        "campo_obrigatorio_ausente",
        "o pedido de historico nao nomeia o `instrumento`: o trilho do dinheiro e por instrumento, e sem o nome nao se sabe de quem e",
        {},
        [],
      );
    }
    const inicio = typeof cargaDoPedido.inicio_ms === "number" && Number.isInteger(cargaDoPedido.inicio_ms)
      ? (cargaDoPedido.inicio_ms as number)
      : undefined;
    return servirHistorico(id, instrumento, estado, porta, {
      ...(inicio !== undefined ? { inicio_ms: inicio } : {}),
      ...(opcoes.defeito !== undefined ? { defeito: opcoes.defeito } : {}),
    });
  }

  if (tipo !== "boleta") {
    diag.push({
      etapa: "tipo_nao_servido",
      tipo,
      porque:
        "esta porta de processo entrega a BOLETA e o HISTORICO do venue (FR-019/T010/T047). As leituras de " +
        "mercado e o comando sao tarefas proprias e nao se improvisam aqui: nao sai linha nenhuma, e o " +
        "silencio faz a mesa ficar em ESPERA dentro do prazo (nunca em sucesso)",
    });
    return { linhas: [], diag };
  }

  // A CARGA DA BOLETA, ou recusa — pelo mesmo motivo do historico acima: `objecto(pedido?.carga) ?? {}` deixava
  // um pedido sem carga entrar na traducao como uma boleta vazia, e a recusa aparecia la' longe, com o nome de
  // outro campo. O que falta diz-se aqui.
  const b = objecto(pedido?.carga);
  if (b === undefined) {
    return recusa(id, "campo_obrigatorio_ausente", "o pedido de boleta nao traz `carga`: sem ela nao ha lado, nem tamanho, nem referencia a traduzir", {}, []);
  }
  diag.push({ etapa: "boleta", referencia_do_cliente: ouAusente(texto(b.referencia_do_cliente), "(ausente)"), instrumento: ouAusente(texto(b.instrumento), "(ausente)") });

  // 2. A LEITURA DA CONTA, antes de tudo o resto: sem ela nao se serve ordem que aumente exposicao (FR-021).
  const pedidoDeLeitura: PedidoDeLeitura = {
    conta: estado.ficha.conta,
    instrumento: texto(b.instrumento),
  };
  const respostasDaConta = await lerDoVenueDaConta(porta.conta, pedidoDeLeitura);
  const leitura = lerConta(respostasDaConta, pedidoDeLeitura);
  if (!leitura.ok) {
    return recusa(id, leitura.motivo, `a leitura da conta falhou: ${leitura.porque}`, {}, []);
  }
  const perpetuo = leitura.leitura.carteiras.perpetuo;
  if (perpetuo.estado !== "lida") {
    return recusa(
      id,
      "campo_obrigatorio_ausente",
      `o PERPETUO nao foi lido (nao lidas: ${lista(leitura.leitura.carteiras.nao_lidas)}): ` +
        "sem o equity nao ha traducao possivel, e sem traducao nao ha ordem (FR-021)",
      {},
      [],
    );
  }
  const saldo = perpetuo.equity;
  const marca = marcaDoVenue(respostasDaConta.activo);
  if (marca === undefined) {
    return recusa(
      id,
      "campo_obrigatorio_ausente",
      "o venue nao declarou `markPx` no activo de referencia: sem marca nao ha preco, e sem preco nao ha quantidade",
      {},
      [],
    );
  }
  diag.push({ etapa: "conta", equity: saldo, marca, origem_marca: "info.activeAssetData({user,coin}).markPx — [V]" });

  // A POSICAO VIVA, da MESMA leitura que ja' se fez: e' dela que a virada (1.10.0) precisa para saber o que
  // fechar — e a mesa nao a calcula (RN-B0). Nada novo se pede ao venue: le-se o que ja' esta' lido.
  const posicaoViva = leitura.leitura.posicoes.find((p) => p.instrumento === b.instrumento);

  // 3. A TRADUCAO (o conector nao altera a boleta: converte, e recusa o que nao cabe). O manifesto entra
  // como esta: a traducao le o nome que o CONTRATO publica (`minimo_de_valor_por_ordem`), sem ponte.
  //
  // O MANIFESTO ACOMPANHA AS FICHAS: `manifestoParaInstrumento` devolve o do arranque, ou um reconstruido da
  // sonda guardada quando o instrumento desta boleta entrou por uma ficha ligada a' quente (funcao pura, sem
  // rede). Sem isto, a ordem desse par era RECUSADA com `instrumento_desconhecido_no_manifesto` — medido a
  // 02/10/2026 com o ETH.
  const manifestoEmVigor = manifestoParaInstrumento(
    estado.sonda,
    estado.manifesto,
    String(b.instrumento),
  ) as unknown as ManifestoDoVenue;
  const accao = traduzirOrdem({
    conta: estado.ficha.conta,
    boleta: b as unknown as Boleta,
    manifesto: manifestoEmVigor,
    saldo,
    preco: marca,
    // A virada leva a posicao viva declarada (ausente quando nao ha posicao — e quem exige a posicao positiva e'
    // a traducao, que recusa `reversao_sem_posicao_a_reverter` se a boleta a pedir sem ela existir).
    posicao_a_reverter: posicaoViva?.unidades,
    lado_da_posicao: posicaoViva?.lado,
    // A REDUCAO PARCIAL (1.11.0) le a MESMA posicao viva, pela mesma leitura: e' dela que sai a quantidade da
    // fraccao pedida (`posicao_pct`). Ausente quando nao ha posicao — e quem recusa e' a traducao
    // (`reducao_parcial_sem_posicao_viva`), antes de qualquer envio.
    posicao_viva: posicaoViva?.unidades,
  });
  if (!accao.ok) {
    return recusa(id, accao.motivo, `${accao.porque} — e nao se arredonda para caber (RN-C9)`, {}, []);
  }
  const unidade = unidadeDo(manifestoEmVigor as Parameters<typeof unidadeDo>[0], accao.accao.instrumento);
  // O TICK DO INSTRUMENTO, DO MANIFESTO — nunca um. Era `unidade?.tick ?? "1"`, e o `"1"` era uma unidade
  // INVENTADA: a resolucao que sai antes do envio (a que a mesa confere contra a banda, D-001) seria calculada
  // sobre uma unidade que o venue nao declarou. Se o instrumento nao esta no manifesto, quem recusa e' o
  // manifesto — e aqui isso nomeia-se, em vez de se responder com um numero que ninguem publicou.
  if (unidade === undefined) {
    return recusa(
      id,
      "instrumento_desconhecido_no_manifesto",
      `o instrumento ${accao.accao.instrumento} nao esta no manifesto que esta ponta publicou: sem a unidade ` +
        "dele nao ha resolucao a compor, e a mesa nao confere a banda contra uma unidade inventada (D-001)",
      {},
      [],
    );
  }
  const tick = unidade.tick;
  const resolucaoAntes = resolucaoDaTraducao(accao.accao, tick);
  diag.push({
    etapa: "traducao",
    cloid: accao.accao.cloid, // a referencia derivada: e' por ela que se PROCURA no registo do venue (D-009)
    quantidade: accao.accao.quantidade,
    nocional: accao.accao.nocional,
    tif: accao.accao.tif,
  });

  // 3-ter. A RECONCILIACAO ANTES DO ENVIO (D-009, RN-C4) — uma referencia que JA' produziu ordem nao volta a
  // produzir. Fica AQUI, e nao depois da alavancagem, por uma razao pratica: o ajuste de alavancagem e' uma
  // ESCRITA no venue, e uma ordem que nao vai sair nao deve mexer em nada. E antes de a `resolucao` sair: nada
  // foi resolvido quando nada foi enviado.
  //
  // O COMENTARIO DO `diag` ACIMA DIZIA «e' por ela que um reenvio NAO duplica (FR-011)» — e isso era FALSO neste
  // venue: medido (P6 da bateria, 29/09/2026), a mesma referencia produziu DUAS ordens. O que impede a segunda
  // ordem nao e' o `cloid` la' dentro: e' esta leitura, feita do NOSSO lado.
  const reconciliacao = await reconciliarAntesDoEnvio(porta, estado.ficha.conta, accao.accao.cloid, prazoDoVenue);
  if (reconciliacao.veredicto === "ja_existe") {
    diag.push({ etapa: "reconciliacao", veredicto: "ja_existe_no_venue", cloid: accao.accao.cloid });
    return recusa(
      id,
      "referencia_ja_enviada_ao_venue",
      `a referencia de cliente ${JSON.stringify(String(b.referencia_do_cliente))} ja' produziu ordem neste ` +
        `venue (o cloid ${accao.accao.cloid} esta' no registo de ordens da conta): NAO se manda segunda. ` +
        "Reenviar a mesma referencia abre uma posicao a mais — este venue NAO deduplica pelo cloid (medido, P6 " +
        "da bateria de teste), e quem garante a nao-duplicacao somos nos (RN-C4)",
      { estado: "ja_existia_no_venue", cloid: accao.accao.cloid, ordem: reconciliacao.ordem },
      [],
    );
  }
  if (reconciliacao.veredicto === "nao_se_leu") {
    diag.push({ etapa: "reconciliacao", veredicto: "nao_se_leu", erro: reconciliacao.erro });
    // NAO SE ENVIA, e di-lo: sem saber se a ordem ja' esta' la', mandar e' uma aposta — e a aposta custa dinheiro
    // duas vezes. O desfecho e' `desconhecido` (RN-T7.1: o silencio nao vira sucesso nem falha) e leva a
    // `resolucao` que se compôs ANTES do envio — o contrato EXIGE-a fora da recusa («aceite, parcial e
    // desconhecido so existem depois de haver algo resolvido para enviar»), e a origem dos numeros vai dita.
    return {
      linhas: [
        saidaDeDesconhecido(id, resolucaoAntes, {
          estado: "reconciliacao_nao_lida",
          erro: reconciliacao.erro,
          origem_dos_numeros: "calculo_antes_do_envio",
          nota: "sem saber se esta referencia ja' produziu ordem, nao se manda segunda (RN-C4)",
        }),
      ],
      diag,
    };
  }
  diag.push({ etapa: "reconciliacao", veredicto: "livre", cloid: accao.accao.cloid });

  // 3-bis. A ALAVANCAGEM PEDIDA TEM DE CHEGAR AO VENUE (FR-008). Antes de a `resolucao` sair: se ela saisse
  // primeiro, a resolucao declararia a alavancagem PEDIDA enquanto o venue tinha outra — e a conferencia da
  // banda (D-001) estaria a conferir uma alavancagem que nao vigora. Pede-se, e CONFIRMA-SE pela leitura.
  const lerAlavancagem = (v: unknown): string => (typeof v === "number" ? String(v) : typeof v === "string" ? v : "");
  const alavancagemNoVenue = lerAlavancagem(objecto(objecto(respostasDaConta.activo)?.leverage)?.value);
  const modoDoVenue: "cruzado" | "isolado" =
    objecto(objecto(respostasDaConta.activo)?.leverage)?.type === "isolated" ? "isolado" : "cruzado";
  const pedida = String(accao.accao.alavancagem);
  if (Number(alavancagemNoVenue) !== Number(pedida) || !Number.isFinite(Number(pedida))) {
    if (porta.ajuste === undefined) {
      return recusa(
        id,
        "capacidade_nao_declarada",
        `a boleta pede alavancagem ${pedida} e o venue tem ${alavancagemNoVenue}: esta porta nao tem verbo de ` +
          "ajuste, e nao se abre com uma alavancagem diferente da declarada (a resolucao sairia a mentir sobre o risco)",
        {},
        [],
      );
    }
    const prazoDoAjuste = prazoDoVenue;
    const ajuste = await comPrazo(porta.ajuste.alavancagem(accao.accao.instrumento, pedida, modoDoVenue), prazoDoAjuste);
    if (!ajuste.ok) {
      diag.push({ etapa: "alavancagem", veredicto: "nao_aplicada", pedida, antes: alavancagemNoVenue, erro: ajuste.erro });
      return recusa(
        id,
        "capacidade_nao_declarada",
        `o venue nao aplicou a alavancagem ${pedida} (tinha ${alavancagemNoVenue}): ${ajuste.erro}`,
        { pedida, antes: alavancagemNoVenue },
        [],
      );
    }
    // A releitura e' uma LEITURA: nao passa por `comPrazo` (o prazo e' do envio) — le-se, e compara-se.
    const relido = await porta.conta.activoDaConta(estado.ficha.conta, accao.accao.instrumento);
    const depois = lerAlavancagem(objecto(objecto(relido)?.leverage)?.value);
    diag.push({ etapa: "alavancagem", pedida, antes: alavancagemNoVenue, depois, modo: modoDoVenue });
    if (Number(depois) !== Number(pedida)) {
      return recusa(
        id,
        "capacidade_nao_declarada",
        `o venue respondeu que sim ao ajuste de alavancagem e continua com ${depois} (a boleta pede ${pedida}): ` +
          "recusa, porque a resolucao sairia a declarar uma alavancagem que nao vigora (FR-008)",
        { pedida, depois },
        [],
      );
    }
  } else {
    diag.push({ etapa: "alavancagem", pedida, antes: alavancagemNoVenue, nota: "ja' era a pedida" });
  }

  const linhas: string[] = [conferivel(envelope("resolucao", `${id}/resolucao`, resolucaoAntes, versao))];

  // 4. O ENVIO, dentro do prazo declarado. Silencio nao e exito nem falha: e `desconhecido` (FR-013).
  const prazo = prazoDoVenue;
  const resposta = await comPrazo(porta.envio.enviar(accao.accao, estado.ficha.conta, texto(b.referencia_do_cliente)), prazo);
  if (!resposta.ok) {
    diag.push({ etapa: "envio", veredicto: "sem_resposta", erro: resposta.erro, prazo_ms: prazo });
    linhas.push(
      saidaDeDesconhecido(id, resolucaoAntes, {
        estado: "sem_resposta_no_prazo",
        prazo_ms: prazo,
        erro: resposta.erro,
        origem_dos_numeros: "calculo_antes_do_envio",
      }),
    );
    return { linhas, diag };
  }

  // 5. O QUE O VENUE DISSE — classificado nas QUATRO do contrato, com os numeros DELE.
  const bruto = objecto(resposta.valor);
  // A RECUSA AO NIVEL DA ACCAO: o venue tambem responde `{status:"err", response:"<palavra dele>"}` — sem
  // `data.statuses`. E' uma recusa DELE, e entra pela MESMA classificacao, com a palavra dele: nao se trata
  // como forma desconhecida (isso seria perder a recusa) nem como sucesso.
  if (bruto?.status === "err") {
    const palavra = typeof bruto.response === "string" ? bruto.response : JSON.stringify(bruto.response);
    const { motivo, nota } = motivoPelaPalavraDoVenue(palavra);
    diag.push({ etapa: "envio", veredicto: "recusado_pelo_venue", palavra_do_venue: palavra, motivo, nota });
    return recusa(
      id,
      motivo,
      `o venue recusou a accao com a palavra DELE: ${palavra} (${nota})`,
      { erro: palavra, palavra_do_venue: palavra, bruto },
      linhas,
    );
  }
  const dados = objecto(objecto(bruto?.response)?.data);
  const statuses = Array.isArray(dados?.statuses) ? (dados?.statuses as unknown[]) : undefined;
  const primeiro = statuses !== undefined && statuses.length > 0 ? objecto(statuses[0]) : undefined;
  if (primeiro === undefined) {
    throw new Error(
      `o venue respondeu numa forma que esta ponta nao conhece (${JSON.stringify(bruto)}): um venue que muda de ` +
        "forma nao se adivinha — o processo para aqui em vez de inventar um desfecho",
    );
  }

  if (typeof primeiro.error === "string") {
    const { motivo, nota } = motivoPelaPalavraDoVenue(primeiro.error);
    diag.push({ etapa: "envio", veredicto: "recusado_pelo_venue", palavra_do_venue: primeiro.error, motivo, nota });
    return recusa(
      id,
      motivo,
      `o venue recusou com a palavra DELE: ${primeiro.error} (${nota})`,
      { erro: primeiro.error, palavra_do_venue: primeiro.error, bruto: primeiro },
      linhas,
    );
  }

  const preenchido = objecto(primeiro.filled);
  const emRepouso = objecto(primeiro.resting);

  if (preenchido !== undefined) {
    const totalSz = texto(preenchido.totalSz);
    const avgPx = texto(preenchido.avgPx);
    if (totalSz === undefined || avgPx === undefined) {
      throw new Error(`a execucao do venue veio sem totalSz/avgPx (${JSON.stringify(preenchido)}): nao se completa por conta propria`);
    }
    const completo = compararDecimais(totalSz, accao.accao.quantidade) >= 0;

    // A leitura DEPOIS do envio: quando o venue ja tem a posicao, e ELE que da os cinco numeros.
    const depois = await lerDoVenueDaConta(porta.conta, pedidoDeLeitura);
    const leituraDepois = lerConta(depois, pedidoDeLeitura);
    let resolucao = resolucaoAntes;
    let origem = "calculo_antes_do_envio";
    if (leituraDepois.ok) {
      const posicao = leituraDepois.leitura.posicoes.find((p) => p.instrumento === accao.accao.instrumento);
      if (posicao !== undefined) {
        const doVenue = resolucaoDaPosicao(posicao, totalSz);
        if (doVenue !== null) {
          resolucao = doVenue;
          origem = "posicao_lida_depois_do_envio";
        } else {
          origem = "calculo_antes_do_envio (a posicao do venue nao publica preco de liquidacao)";
        }
      } else {
        origem = "calculo_antes_do_envio (o venue nao reporta posicao neste instrumento depois do envio)";
      }
    } else {
      origem = "calculo_antes_do_envio (a leitura depois do envio falhou)";
    }
    diag.push({ etapa: "envio", veredicto: completo ? "aceite" : "parcial", preenchido: totalSz, preco_medio: avgPx, origem_dos_numeros: origem });
    linhas.push(
      saida(id, {
        classificacao: completo ? "aceite" : "parcial",
        resolucao,
        resposta_do_venue: {
          estado: completo ? "filled" : "partially_filled",
          order_id: ouAusente(identificadorDe(preenchido.oid), "(sem oid)"),
          preenchido: totalSz,
          preco_medio: avgPx,
          origem_dos_numeros: origem,
          bruto: preenchido,
        },
      }),
    );
    return { linhas, diag };
  }

  if (emRepouso !== undefined) {
    // O venue aceitou a ordem e NADA executou: nao ha execucao a declarar. O contrato 1.3.0 nao tem
    // classificacao para «na ordem, por executar» — e o ACHADO 3 deste recorte. Diz-se `desconhecido`, com a
    // resolucao que saiu antes do envio e a origem dela nomeada; inventar `aceite` seria dizer que executou.
    diag.push({
      etapa: "envio",
      veredicto: "em_repouso",
      order_id: ouAusente(identificadorDe(emRepouso.oid), "(sem oid)"),
      porque:
        "o venue registou a ordem e nada executou: o desfecho fica `desconhecido` ate a leitura do venue dizer " +
        "o que se passou — FR-014/FR-015, e o achado 3 (o contrato nao tem classificacao para «na ordem, por executar»)",
    });
    linhas.push(
      saidaDeDesconhecido(id, resolucaoAntes, {
        estado: "resting",
        order_id: ouAusente(identificadorDe(emRepouso.oid), "(sem oid)"),
        origem_dos_numeros: "calculo_antes_do_envio",
        bruto: emRepouso,
        nota: "o venue aceitou a ordem e nada executou; o contrato 1.3.0 nao tem classificacao propria para este estado",
      }),
    );
    return { linhas, diag };
  }

  throw new Error(`o venue respondeu um estado que esta ponta nao classifica (${JSON.stringify(primeiro)}): recusa-se a adivinhar`);

  function saidaDeDesconhecido(identificador: string, resolucao: Record<string, unknown>, resposta: Record<string, unknown>): string {
    // Passa por `saida()` como TODOS os desfechos: e por aqui que o defeito de proposito (`--defeito`) chega
    // tambem a este caminho — um instrumento de prova que so alcanca alguns ramos nao prova os outros.
    return saida(identificador, { classificacao: "desconhecido", resolucao, resposta_do_venue: resposta });
  }
}

/** Confere uma linha antes de ela sair: uma mensagem nossa que o contrato recuse PARA a conversa. */
export function conferirAntesDeSair(linha: string): void {
  const decisao = validar(linha);
  if (decisao.veredicto !== "aceite") {
    throw new Error(
      `uma mensagem produzida pelo proprio conector nao passou o contrato: ${decisao.veredicto}/${decisao.motivo}` +
        `${decisao.detalhe ? ` (${decisao.detalhe})` : ""} — a mensagem nao sai`,
    );
  }
}
