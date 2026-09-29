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
import type { ConfiguracaoDaConta } from "../config/configuracao.ts";
import {
  resolverContenda,
  type Contenda,
  type PedidoDeContenda,
} from "./contenda.ts";
import { type Marcas } from "../estado/marcas.ts";

export const PORTAS = [
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
}

export interface Recusa {
  porta: NomeDaPorta;
  /** Motivo do vocabulario da mesa (`core/estados/motivos.json`). */
  motivo: string;
  /** O motivo do CONTRATO, quando foi ele a recusar a carga. */
  motivo_do_contrato: string | null;
  porque: string;
}

export interface ResultadoDoArranque {
  arrancou: boolean;
  /** `em_operacao` so quando as seis portas passam; em qualquer recusa, `parada`. */
  estado: "parada" | "em_operacao";
  porta: NomeDaPorta | null;
  motivo: string | null;
  motivo_do_contrato: string | null;
  porque: string;
  /** As portas conferidas ate parar - o que se chegou a olhar, e nao o que se diz que se olhou. */
  portas_conferidas: NomeDaPorta[];
  /** A fila da contenda, quando houve: quem entra, quem espera e o criterio que decidiu o corte. */
  contenda: Contenda | null;
  /** O que foi LIDO, tal e qual. Existe para a FR-032 ter prova: o que sai e o que entrou. */
  lido: { fichas: Record<string, unknown>; manifesto: { versao: unknown; instrumentos: unknown } };
}

const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** Texto decimal -> numero, sem tolerancia. Um valor que nao e decimal GRITA em vez de virar NaN. */
function numero(texto: unknown, onde: string): number {
  if (typeof texto !== "string" || !DECIMAL.test(texto)) {
    throw new Error(`${onde}: '${String(texto)}' nao e um decimal textual (o contrato exige a forma, D4)`);
  }
  return Number(texto);
}

interface Ficha {
  saldo_pct?: unknown;
  alavancagem?: unknown;
  bandas?: Record<string, { minimo?: string; maximo?: string }>;
}

// ---------------------------------------------------------------- as seis portas

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
  const faltam = Object.keys((config.fichas ?? {}) as Record<string, unknown>).filter(
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
  return null;
}

function portaDoMandato(config: ConfiguracaoDaConta): Recusa | null {
  const fichas = (config.fichas ?? {}) as Record<string, Ficha>;

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
  const fichas = (config.fichas ?? {}) as Record<string, Ficha>;
  // A soma e feita em inteiros escalados, dentro do resolver: quem entra e quem espera nao pode depender
  // de uma casa decimal que ninguem escreveu (`0.1 + 0.2 > 0.3` em ponto flutuante).
  // As fichas vem da CONFIGURACAO: ninguem as pediu, logo nao tem hora de chegada. Vao para a fila sem
  // instante, e o criterio registado diz que foi o simbolo a desempatar - em vez de inventar uma ordem de
  // chegada que nao existe (D-003).
  const pedidos: PedidoDeContenda[] = Object.entries(fichas).map(([instrumento, f]) => ({
    instrumento,
    saldo_pct: String((f as Ficha).saldo_pct ?? "0"),
  }));
  const contenda = resolverContenda(pedidos, String(config.margem_total_maxima_pct ?? "0"));

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

/** As seis portas, por ordem. Devolve a recusa da PRIMEIRA que falhar, ou `null`. */
export function passarPelasPortas(entrada: EntradaDoArranque): {
  recusa: Recusa | null;
  conferidas: NomeDaPorta[];
  contenda: Contenda | null;
} {
  const conferidas: NomeDaPorta[] = [];
  let contenda: Contenda | null = null;
  const passos: [NomeDaPorta, () => Recusa | null][] = [
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
    fichas: (entrada.config.fichas ?? {}) as Record<string, unknown>,
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
    porque: "As seis portas passaram: o manifesto declara o que a configuracao usa, o mandato cabe nas bandas, a conta cabe no tecto, as chaves tem dono, a versao bate certo e a sessao pode correr.",
    portas_conferidas: conferidas,
    contenda,
    lido,
  };
}
