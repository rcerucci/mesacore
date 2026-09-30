// O arranque: o `start` como VERIFICACAO, e nao como botao.
//
// Seis portas, por ordem: manifesto, mandato, contenda, inventario de chaves, versao do contrato e
// sessao. A primeira que falhar recusa o arranque e da o motivo DELA (FR-031) - e a mesa fica `parada`
// com esse motivo registrado.
//
// A regra que da sentido a tudo isto e a FR-032: a mesa NAO CORRIGE NADA para conseguir entrar. Nao
// arredonda um valor para dentro da banda, nao completa uma unidade em falta, nao escolhe a politica que
// o dono nao declarou. Uma mesa que se ajusta para passar transforma uma recusa visivel num arranque
// silencioso com numeros que o dono nao escreveu - e a partir dai nada mais e auditavel.
//
// A ordem das portas e declarada e nao decorativa: o caso que falha tres portas reporta a PRIMEIRA. Sem
// isso, o motivo que o dono le depende de quem escreveu o codigo por ultimo.
//
// Este ficheiro NAO decide o que avisa (FR-042) e nao toca em marcas: le-as. Quem muda o estado da mesa e
// o `mesa.ts`.

import { validar, versaoVigente } from "../../contracts/esqueleto/framing.ts";
import { lista } from "../../contracts/esqueleto/texto.ts";
import type { ConfiguracaoDaConta } from "../config/configuracao.ts";
import {
  resolverContenda,
  type Contenda,
  type PedidoDeContenda,
} from "./contenda.ts";
import { type Marcas } from "../estado/marcas.ts";

export const PORTAS = [
  // AS SETE PORTAS. A dos conectores entrou na frente das outras seis por uma razao de ordem, e nao de
  // importancia: o MANIFESTO vem do conector. Sem o conector de pe nao ha manifesto a ler, e uma porta de
  // manifesto a recusar "instrumento desconhecido" por o conector estar morto daria o diagnostico errado
  // (T027, FR-005).
  "conectores",
  "manifesto",
  "mandato",
  "contenda",
  "inventario",
  "versao_do_contrato",
  "sessao",
] as const;
export type NomeDaPorta = (typeof PORTAS)[number];

/**
 * A porta do inventario e uma FUNCAO que entra por parametro, e nao um import.
 *
 * Duas razoes. A primeira: uma so fonte de verdade sobre as chaves - a implementacao a serio liga-se ao
 * conferidor que ja existe (`tools/verificar-contrato/py/inventario.py`), em vez de uma segunda
 * implementacao que envelhece a par. A segunda: o core nao chama processos. Quem liga o core ao
 * conferidor e quem monta o processo - e o core continua a poder ser exercitado sem shell.
 *
 * Nao tem valor por omissao, de proposito: uma porta que passa quando ninguem a ligou seria pior do que
 * nao ter porta nenhuma.
 */
export type PortaDoInventario = () => { ok: boolean; problemas: string[] };

export interface EntradaDoArranque {
  /** A CARGA da mensagem `manifesto` do contrato, tal como a ponta a mandou. */
  manifesto: unknown;
  config: ConfiguracaoDaConta;
  marcas: Marcas;
  /** O registo de operacao foi retomado? Se nao foi, a mesa nao arranca (FR-031, sessao). */
  registo_retomavel: boolean;
  portaDoInventario: PortaDoInventario;
  /**
   * OS CONECTORES QUE ESTAO DE PE, pelos nomes que a configuracao declara.
   *
   * Quem os arranca e o vigia (RN-E21) e quem os sonda e ele; a mesa so tem a REGRA. Vem de fora e nao de
   * um import pelo mesmo motivo da porta do inventario: quem liga a mesa ao processo alheio e quem monta o
   * processo, e a mesa continua a poder ser exercitada sem shell.
   */
  conectores_de_pe: string[];
}

export interface Recusa {
  porta: NomeDaPorta;
  /** Motivo do vocabulario da mesa (`core/estados/motivos.json`). */
  motivo: string;
  /** O motivo do CONTRATO, quando foi ele a recusar a carga. */
  motivo_do_contrato: string | null;
  porque: string;
  /**
   * O NOME do que faltou, quando ha um (o conector que nao esta de pe). Vai para o registro de quem
   * comanda, que e quem o pode ler; a resposta do contrato nao tem campo para isto e nao se inventa um
   * para caber um diagnostico. O `porque` ja o diz em palavras; este campo diz-o por nome, para quem
   * quiser agir sem ler portugues.
   */
  detalhe?: string;
}

export interface ResultadoDoArranque {
  arrancou: boolean;
  /** `em_operacao` so quando as sete portas passam; em qualquer recusa, `parada`. */
  estado: "parada" | "em_operacao";
  porta: NomeDaPorta | null;
  motivo: string | null;
  motivo_do_contrato: string | null;
  porque: string;
  /** O nome do que faltou, quando a recusa tem um (o conector que nao esta de pe - T027). */
  detalhe: string | null;
  /** As portas conferidas ate parar - o que se chegou a olhar, e nao o que se diz que se olhou. */
  portas_conferidas: NomeDaPorta[];
  /** A fila da contenda, quando houve: quem entra, quem espera e o criterio que decidiu o corte. */
  contenda: Contenda | null;
  /** O que foi LIDO, tal e qual. Existe para a FR-032 ter prova: o que sai e o que entrou. */
  lido: { fichas: Record<string, unknown>; manifesto: { versao: unknown; instrumentos: unknown } };
}

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/**
 * Texto decimal -> o PROPRIO texto, ja conferido. Um valor que nao e decimal GRITA em vez de virar NaN (D4).
 *
 * Existe separado de `numero` porque ha' sitios onde o que se transporta e' o TEXTO (a contenda soma em
 * inteiros escalados a partir do texto, para `0.1 + 0.2 > 0.3` nao decidir por nos). Aqueles sitios faziam
 * `String(f.saldo_pct ?? "0")`: um `saldo_pct` ausente virava o texto `"0"` e a contenda era resolvida sobre
 * um numero que ninguem escreveu. Agora o texto passa por aqui, e o ausente nao tem texto.
 */
function decimalTextual(valor: unknown, onde: string): string {
  if (typeof valor !== "string" || !DECIMAL.test(valor)) {
    throw new Error(`${onde}: '${String(valor)}' nao e um decimal textual (o contrato exige a forma, D4)`);
  }
  return valor;
}

/** Texto decimal -> numero, sem tolerancia. */
function numero(valor: unknown, onde: string): number {
  return Number(decimalTextual(valor, onde));
}

interface Ficha {
  saldo_pct?: unknown;
  alavancagem?: unknown;
  bandas?: Record<string, { minimo?: string; maximo?: string }>;
}

/**
 * AS FICHAS DA CONTA, ou recusa alta.
 *
 * Era `config.fichas ?? {}` em quatro sitios, e o mapa vazio nao falhava: passava pela porta do mandato (nao
 * ha' ficha nenhuma para conferir) e pela da contenda (nao ha' pedido nenhum para somar). Uma configuracao sem
 * `fichas` chegava assim a `em_operacao` — uma mesa sem mandato que parecia conferida. Uma mesa sem fichas nao
 * e' uma mesa sem risco: e' uma mesa que nao se sabe o que mandata, e isso nao arranca.
 */
function exigirFichas(config: ConfiguracaoDaConta): Record<string, Ficha> {
  const fichas: unknown = config.fichas;
  if (fichas === undefined || fichas === null || typeof fichas !== "object" || Array.isArray(fichas)) {
    throw new Error(
      `conta.fichas: a configuracao nao declara as fichas (veio ${String(fichas)}). Sem fichas ` +
        "nao ha' mandato nem contenda a conferir, e as portas passariam sem conferir nada.",
    );
  }
  if (Object.keys(fichas).length === 0) {
    throw new Error(
      "conta.fichas: a configuracao declara zero fichas. Uma mesa que arranca sem ficha nenhuma arranca sem " +
        "mandato — e nao ha' porta nenhuma que o possa conferir depois.",
    );
  }
  return fichas as Record<string, Ficha>;
}

// ---------------------------------------------------------------- as sete portas

function portaDoManifesto(manifesto: any, config: ConfiguracaoDaConta): Recusa | null {
  // O envelope e NOSSO (por isso nasce com a versao vigente): o que se confere aqui e a FORMA da carga.
  // A versao que a ponta declara e conferida na porta propria, mais adiante - se fosse conferida aqui,
  // uma versao errada apareceria como "manifesto invalido", que e um diagnostico falso.
  const decisao = validar(
    JSON.stringify({ contrato: versaoVigente(), tipo: "manifesto", id: "arranque/manifesto", carga: manifesto }),
  );
  if (decisao.veredicto !== "aceite") {
    return {
      porta: "manifesto",
      motivo: "porta_do_arranque_falhou",
      motivo_do_contrato: decisao.motivo ?? null,
      porque: `O manifesto nao passou o contrato: ${decisao.veredicto}${decisao.motivo ? ` - ${decisao.motivo}` : ""}.`,
    };
  }

  const declarados = new Set(((manifesto as any).instrumentos as any[]).map((i) => i.simbolo));
  const faltam = Object.keys(exigirFichas(config)).filter(
    (simbolo) => !declarados.has(simbolo),
  );
  if (faltam.length > 0) {
    return {
      porta: "manifesto",
      motivo: "porta_do_arranque_falhou",
      motivo_do_contrato: null,
      porque: `O manifesto nao declara as unidades de ${faltam.join(", ")} - e sem unidade declarada nao ha resolucao possivel (RN-M1).`,
    };
  }

  // As TRES OBRIGACOES DO CONECTOR (contrato 1.7.0, D-002). A mesa depende delas em TRES regras suas, e por
  // isso uma obrigacao em falta (ou declarada `false`) RECUSA o arranque — nomeando qual. Nao e zelo: sem (1)
  // a condicao `sem_ligacao` nao tem fonte (RN-D3) e a mesa nao sabe se o venue esta vivo; sem (2) o
  // `desvio_maximo` da boleta seria medido contra uma regua guardada do ciclo, e nao contra o preco do
  // instante do envio (RN-B11); sem (3) a conferencia da banda (D-001) nao tem numeros para conferir, e quem
  // garante a banda declarada passa a ser o conector.
  const obrigacoes: [string, unknown, string][] = [
    [
      "ligacao_por_protocolo",
      (manifesto as any).ligacao_por_protocolo,
      "a condicao `sem_ligacao` trava ABRIR, e sem a ligacao reportada PELO PROTOCOLO a mesa nao distingue mercado calmo de ligacao morta",
    ],
    [
      "releitura_de_preco_ao_enviar",
      (manifesto as any).releitura_de_preco_ao_enviar,
      "o `desvio_maximo` da boleta seria medido contra uma marca guardada, e nao contra a regua RELIDA no instante do envio",
    ],
    [
      "devolve_a_resolucao",
      (manifesto as any).devolve_a_resolucao,
      "sem os numeros da corretora a conferencia da banda nao tem o que conferir (D-001) — e quem garante a banda declarada passa a ser o conector",
    ],
  ];
  for (const [nome, valor, porque] of obrigacoes) {
    if (valor !== true) {
      return {
        porta: "manifesto",
        motivo: "porta_do_arranque_falhou",
        motivo_do_contrato: null,
        porque: `o manifesto nao declara ${nome} == true (veio ${JSON.stringify(valor ?? null)}): ${porque}. O conector nao arranca por uma obrigacao de que a mesa depende (D-002, contrato 1.7.0).`,
      };
    }
  }
  return null;
}

function portaDoMandato(config: ConfiguracaoDaConta): Recusa | null {
  const fichas = exigirFichas(config);

  for (const [simbolo, ficha] of Object.entries(fichas)) {
    for (const campo of ["saldo_pct", "alavancagem"] as const) {
      const valor = numero(ficha[campo], `ficha ${simbolo}.risco.${campo}`);

      // Zero e negativo: nao ha nada a ajustar, ha que recusar (FR-032).
      if (valor <= 0) {
        return {
          porta: "mandato",
          motivo: "porta_do_arranque_falhou",
          motivo_do_contrato: null,
          porque: `ficha ${simbolo}: ${campo} vale '${String(ficha[campo])}'. Zero ou negativo nao se corrige - o mandato e do dono (RN-M9).`,
        };
      }

      // "Fora das bandas declaradas": valida-se onde o dono disse que o valor tem de caber.
      const banda = ficha.bandas?.[campo];
      if (banda && (banda.minimo !== undefined || banda.maximo !== undefined)) {
        const minimo = banda.minimo === undefined ? null : numero(banda.minimo, `ficha ${simbolo}.bandas.${campo}.minimo`);
        const maximo = banda.maximo === undefined ? null : numero(banda.maximo, `ficha ${simbolo}.bandas.${campo}.maximo`);
        if ((minimo !== null && valor < minimo) || (maximo !== null && valor > maximo)) {
          return {
            porta: "mandato",
            motivo: "porta_do_arranque_falhou",
            motivo_do_contrato: null,
            porque: `ficha ${simbolo}: ${campo} vale ${valor} e a banda declarada vai de ${banda.minimo} a ${banda.maximo}. A mesa nao encolhe o valor para o fazer caber (RN-M9).`,
          };
        }
      }
    }
  }
  return null;
}

function portaDaContenda(
  config: ConfiguracaoDaConta,
  anotar?: (c: Contenda) => void,
): Recusa | null {
  const fichas = exigirFichas(config);
  // A soma e feita em inteiros escalados, dentro do resolver: quem entra e quem espera nao pode depender
  // de uma casa decimal que ninguem escreveu (`0.1 + 0.2 > 0.3` em ponto flutuante).
  // As fichas vem da CONFIGURACAO: ninguem as pediu, logo nao tem hora de chegada. Vao para a fila sem
  // instante, e o criterio registado diz que foi o simbolo a desempatar - em vez de inventar uma ordem de
  // chegada que nao existe (D-003).
  const pedidos: PedidoDeContenda[] = Object.entries(fichas).map(([instrumento, f]) => ({
    instrumento,
    saldo_pct: decimalTextual(f.saldo_pct, `ficha ${instrumento}.risco.saldo_pct`),
  }));
  const contenda = resolverContenda(pedidos, decimalTextual(config.margem_total_maxima_pct, "conta.margem_total_maxima_pct"));

  // Cabe todo: nao ha contenda, e nem se chega a ler a politica.
  if (contenda.de_fora.length === 0) {
    anotar?.(contenda);
    return null;
  }

  // Acima do tecto, o que resolve e uma DECLARACAO do dono - nao uma omissao simpatica.
  const politica = config.contencao;
  if (typeof politica !== "string" || politica.length === 0) {
    return {
      porta: "contenda",
      motivo: "porta_do_arranque_falhou",
      motivo_do_contrato: null,
      porque: `Sem 'conta.contencao' declarada, o arranque recusa: contenda nao se resolve por omissao (RN-M4.7). ${contenda.porque}`,
    };
  }

  anotar?.(contenda);

  // `espera`: quem cabe entra, quem nao cabe ESPERA - e a espera fica registada com o criterio dela.
  if (politica === "espera") return null;

  return {
    porta: "contenda",
    motivo: "porta_do_arranque_falhou",
    motivo_do_contrato: null,
    porque: `A politica declarada e '${politica}': ${contenda.porque}`,
  };
}

/** OS CONECTORES: a mesa arranca sem os que ela propria nomeia? Nao arranca - e diz QUAL. */
function portaDosConectores(config: ConfiguracaoDaConta, dePe: string[]): Recusa | null {
  // `config.conectores ?? []` fazia de uma configuracao MUDADA uma configuracao sem conectores, e a recusa
  // saia com o diagnostico errado ("nao declara conector nenhum"). O ausente e o vazio sao coisas diferentes
  // e a porta di-las por nomes diferentes.
  const declarados: unknown = config.conectores;
  if (!Array.isArray(declarados)) {
    return {
      porta: "conectores",
      motivo: "porta_do_arranque_falhou",
      motivo_do_contrato: null,
      porque:
        `A configuracao nao declara \`conta.conectores\` (veio ${String(declarados)}). Nao se sabe que conectores ` +
        "a mesa devia ter de pe — e presumir que nenhum chega para recusar por um motivo que nao e' o verdadeiro.",
    };
  }
  if (declarados.length === 0) {
    return {
      porta: "conectores",
      motivo: "porta_do_arranque_falhou",
      motivo_do_contrato: null,
      porque:
        "A configuracao nao declara conector nenhum (conta.conectores). Uma mesa sem conector nao tem por onde " +
        "falar com a corretora: recusa-se aqui, e nao no primeiro ciclo sem ligacao.",
    };
  }
  const faltam = declarados.map(String).filter((nome) => !dePe.includes(nome));
  if (faltam.length === 0) return null;
  return {
    porta: "conectores",
    motivo: "porta_do_arranque_falhou",
    motivo_do_contrato: null,
    porque: `Conector(es) declarado(s) e NAO de pe: ${faltam.join(", ")} (de pe: ${lista(dePe)}). O vigia arranca os conectores (RN-E21) e a mesa recusa arrancar sem eles.`,
    detalhe: faltam[0]!,
  };
}

function portaDoInventario(porta: PortaDoInventario): Recusa | null {
  const { ok, problemas } = porta();
  if (ok) return null;
  return {
    porta: "inventario",
    motivo: "porta_do_arranque_falhou",
    motivo_do_contrato: null,
    porque: `Uma chave em uso nao consta do inventario: ${problemas.join(" | ")}. Valor sem origem declarada nao se usa (RN-A2).`,
  };
}

function portaDaVersao(manifesto: any): Recusa | null {
  const vigente = versaoVigente();
  const declarada = (manifesto as any)?.versao;
  if (declarada === vigente) return null;
  return {
    porta: "versao_do_contrato",
    motivo: "porta_do_arranque_falhou",
    motivo_do_contrato: "versao_do_contrato_divergente",
    porque: `A ponta declara o contrato ${String(declarada)} e a versao vigente e ${vigente}: conferida por igualdade exacta (RN-E18, D7). Nada de operacao sai antes disto.`,
  };
}

function portaDaSessao(marcas: Marcas, registoRetomavel: boolean, config: ConfiguracaoDaConta): Recusa | null {
  // A ordem dentro desta porta segue o `ordem_de_leitura` do livro: o mais especifico primeiro.
  if (marcas.inibicao_cb !== null) {
    // O QUE ACONTECE DEPOIS DO CB E DECISAO DECLARADA, nao um `if` escondido (FR-037, RN-M3.3): a unica
    // forma declarada e `exige_decisao`. Se a chave estiver ausente ou trouxer outro nome, a mesa GRITA -
    // nao escolhe por omissao o caminho que a deixa arrancar.
    const politica = config.arranque_apos_cb;
    if (politica !== "exige_decisao") {
      throw new Error(
        `conta.arranque_apos_cb: '${String(politica)}' nao e uma politica declarada (a declarada e ` +
          "'exige_decisao'). Uma mesa inibida que arranca por omissao e uma mesa que ignora o CB que ela propria disparou.",
      );
    }
    return {
      porta: "sessao",
      motivo: "sessao_inibida",
      motivo_do_contrato: null,
      porque: `A sessao esta inibida pelo circuit breaker (${marcas.inibicao_cb.motivo}, perda medida ${marcas.inibicao_cb.perda_medida}). So uma sessao nova levanta a inibicao - e a sessao nova e do dono.`,
    };
  }
  if (!registoRetomavel) {
    return {
      porta: "sessao",
      motivo: "registo_nao_retomavel",
      motivo_do_contrato: null,
      porque:
        "O registo de operacao nao foi possivel retomar. Uma mesa que arranca sem saber o que ja fez repete o que ja fez.",
    };
  }
  return null;
}

/** As sete portas, por ordem. Devolve a recusa da PRIMEIRA que falhar, ou `null`. */
export function passarPelasPortas(entrada: EntradaDoArranque): {
  recusa: Recusa | null;
  conferidas: NomeDaPorta[];
  contenda: Contenda | null;
} {
  const conferidas: NomeDaPorta[] = [];
  let contenda: Contenda | null = null;
  const passos: [NomeDaPorta, () => Recusa | null][] = [
    ["conectores", () => portaDosConectores(entrada.config, entrada.conectores_de_pe)],
    ["manifesto", () => portaDoManifesto(entrada.manifesto, entrada.config)],
    ["mandato", () => portaDoMandato(entrada.config)],
    ["contenda", () => portaDaContenda(entrada.config, (c) => { contenda = c; })],
    ["inventario", () => portaDoInventario(entrada.portaDoInventario)],
    ["versao_do_contrato", () => portaDaVersao(entrada.manifesto)],
    ["sessao", () => portaDaSessao(entrada.marcas, entrada.registo_retomavel, entrada.config)],
  ];

  for (const [nome, porta] of passos) {
    conferidas.push(nome);
    const recusa = porta();
    if (recusa !== null) return { recusa, conferidas, contenda };
  }
  return { recusa: null, conferidas, contenda };
}

export function arrancar(entrada: EntradaDoArranque): ResultadoDoArranque {
  const manifesto = entrada.manifesto as any;
  const lido = {
    fichas: exigirFichas(entrada.config),
    manifesto: { versao: manifesto?.versao, instrumentos: manifesto?.instrumentos },
  };

  const { recusa, conferidas, contenda } = passarPelasPortas(entrada);

  if (recusa !== null) {
    return {
      arrancou: false,
      // Uma porta falhada NAO muda o estado: a mesa fica onde estava (FR-031, SC-006).
      estado: "parada",
      porta: recusa.porta,
      motivo: recusa.motivo,
      motivo_do_contrato: recusa.motivo_do_contrato,
      porque: recusa.porque,
      detalhe: recusa.detalhe ?? null,
      portas_conferidas: conferidas,
      contenda,
      lido,
    };
  }

  return {
    arrancou: true,
    estado: "em_operacao",
    porta: null,
    motivo: null,
    motivo_do_contrato: null,
    detalhe: null,
    porque: "As sete portas passaram: os conectores estao de pe, o manifesto declara o que a configuracao usa, o mandato cabe nas bandas, a conta cabe no tecto, as chaves tem dono, a versao bate certo e a sessao pode correr.",
    portas_conferidas: conferidas,
    contenda,
    lido,
  };
}
