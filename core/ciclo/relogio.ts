// O RELOGIO DA MESA: o que ela faz enquanto ninguem lhe fala.
//
// Existe por causa de uma regra so - FR-006/RN-V6: uma mesa em operacao NUNCA depende de o vigia estar
// vivo. Sem relogio, a mesa so agiria quando lhe chegasse uma linha pela costura; o vigia morria, ninguem
// mandava mais nada, e a operacao parava. Isso e exactamente o contrario do que a fronteira promete, e e
// o que a US2 mede: com o vigia morto, N ciclos tem de dar N linhas novas no registo (SC-001).
//
// Um CICLO e uma volta: le os instrumentos que a operacao declara, decide cada um, e escreve no registo.
// A mesa decide e REGISTA; a entrega a corretora e do conector, no recorte dele - aqui nao ha socket, nao
// ha chave, e a boleta que a decisao produziu fica no registo, que e onde se pode ler o que se decidiu.
//
// O RISCO NAO VEM DAQUI. O mandato de cada instrumento sai da configuracao do DONO (`config.fichas`), e a
// operacao so traz o que o conector e o setup reportam (mercado, proposta, ficha em vigor, template). Se a
// operacao nomear um instrumento que o dono nao governou, a mesa GRITA no arranque do relogio: decidir sem
// mandato seria decidir por ele, e inventar um mandato por omissao e a forma mais silenciosa de o fazer.
//
// A PAUSA NAO PARA O RELOGIO. `pausada` suspende ABRIR e mais nada: defender continua. Por isso o ciclo
// corre com a mesa pausada ou em operacao, e o unico estado que o desliga e `parada` (nao ha operacao para
// defender). Um `if (pausada) return` aqui seria a mesma falha pela porta do lado.

import { readFileSync } from "node:fs";
import { registarCiclo } from "../estado/registo.ts";
import { lerParaOCiclo, type LeituraCompacta } from "../leitura/fixtures.ts";
import type { ConfiguracaoDaConta } from "../config/configuracao.ts";
import type { Marcas } from "../estado/marcas.ts";
import { desconhecidoDe } from "../estado/marcas.ts";
import type { Estado } from "../estados/maquina.ts";
import type { Mandato, Template } from "./decisao.ts";
import { decidirInstrumento, decidirSemLeitura, type Falhas } from "./ciclo.ts";

/** O que a operacao declara de um instrumento: o que o conector e o setup reportam, e a ficha em vigor. */
export interface InstrumentoDaOperacao {
  /**
   * A leitura compacta do instrumento (a porta de leitura valida-a contra o contrato).
   *
   * AUSENTE = o conector nao entregou leitura NESTA volta. Nao e' «a mesma de antes» nem «sem posicao»: e'
   * nao se leu, e o ciclo trata isso como `sem_leitura` (nao abre, nao fecha, e diz) — RN-D7.
   */
  leitura?: LeituraCompacta;
  /** A proposta do setup, ou `null` quando ele nada propos - que NAO e o mesmo que `hold`. */
  proposta?: { lado?: unknown; setup?: unknown; relogio?: unknown } | null;
  /** O nome da ficha em vigor (o par risco+setup do lado do setup). */
  ficha: string;
  /** O relogio da ficha (o intervalo das velas): e' ele que define a barra de uma entrada (D-021). */
  relogio?: string;
  /** O lado do setup: quem escolhe o tipo de ordem e o setup (RN-B8). */
  template: Template;
  /** As marcas de posse que este lado conhece - e por elas que a posse se reconhece. */
  marcas_nossas_conhecidas?: number[];
  /** As falhas que a LEITURA trouxe (ditas por quem leu). Ausente = recusa: nao saber nao e' nao haver. */
  falhas?: Falhas;
  /** Se a leitura divergiu do esperado. Ausente = recusa: o ausente nao e' "nao divergente". */
  divergente?: boolean;
}

export interface Operacao {
  nota?: string;
  /** O estado da ligacao reportado pelo conector (emenda 28 set 2026). */
  /**
   * O estado da ligacao reportado pelo conector (emenda 28 set 2026). OBRIGATORIO: `lerOperacao` recusa a
   * operacao que o nao declare, e por isso o tipo pode — e deve — exigi-lo. Era opcional e o ciclo fazia
   * `?? "ligada"`, ou seja: inventava uma ligacao que ninguem reportou.
   */
  ligacao: "ligada" | "sem_ligacao";
  instrumentos: Record<string, InstrumentoDaOperacao>;
}

/** Le a operacao. Nao se le: GRITA - um relogio sobre nada ciclaria em branco e pareceria operacao. */
export function lerOperacao(caminho: string): Operacao {
  let operacao: Operacao;
  try {
    operacao = JSON.parse(readFileSync(caminho, "utf8")) as Operacao;
  } catch (erro) {
    throw new Error(
      `a operacao nao se leu (${caminho}): ${(erro as Error).message}. Sem ela o relogio ciclaria sobre ` +
        "nada, e um ciclo sobre nada e uma mesa que parece a operar e nao opera.",
    );
  }
  if (operacao.instrumentos === undefined || operacao.instrumentos === null) {
    throw new Error(
      `a operacao nao declara o mapa \`instrumentos\` (${caminho}): um ciclo sem instrumentos nao decide nada, e ` +
        "tratar o mapa ausente como vazio era o mesmo que decidir sobre nada em silencio",
    );
  }
  const instrumentos = Object.keys(operacao.instrumentos);
  if (instrumentos.length === 0) {
    throw new Error(`a operacao nao declara instrumento nenhum (${caminho}): um ciclo sem instrumentos nao decide nada.`);
  }
  // A LIGACAO: declarada ou recusa. Nao ha terceira via. `?? "ligada"` dizia que havia ligacao sem ninguem o
  // ter dito — e o ciclo decidia como se o conector estivesse vivo.
  if (operacao.ligacao !== "ligada" && operacao.ligacao !== "sem_ligacao") {
    throw new Error(
      `a operacao nao declara a \`ligacao\` (${caminho}): esperado "ligada" ou "sem_ligacao", veio ` +
        `${JSON.stringify(operacao.ligacao)}. Assumir «ligada» por omissao e' a mesa a inventar uma ligacao que ` +
        "ninguem reportou — e um ciclo a decidir sobre um mercado que pode nao estar la'.",
    );
  }
  return operacao;
}

/**
 * Confere que o dono governou cada instrumento da operacao.
 *
 * Grita no ARRANQUE do relogio e nao a cada ciclo: uma vez por volta seria a gritar a mesma coisa N vezes,
 * e a operacao nao muda debaixo dos pes do processo (e lida uma vez). Instrumento sem ficha e instrumento
 * sem mandato - e o mandato e do dono (RN-A1).
 */
export function conferirMandatos(operacao: Operacao, config: ConfiguracaoDaConta): void {
  if (config?.fichas === undefined || config.fichas === null) {
    throw new Error(
      "a configuracao da conta nao declara `fichas`: um instrumento sem ficha e' um instrumento sem mandato " +
        "(RN-A1) — e o mandato e' do dono. Nao se assume ficha nenhuma.",
    );
  }
  const fichas = config.fichas as Record<string, Partial<Mandato>>;
  const semFicha = Object.keys(operacao.instrumentos).filter(
    (i) => typeof fichas[i]?.saldo_pct !== "string" || typeof fichas[i]?.alavancagem !== "string",
  );
  if (semFicha.length > 0) {
    throw new Error(
      `instrumento sem mandato do dono: ${semFicha.join(", ")}. A operacao reporta-o e a configuracao nao o ` +
        "governa; decidir sem mandato seria decidir pelo dono.",
    );
  }
}

export interface ResultadoDoCiclo {
  ciclo: number;
  /** As linhas que esta volta escreveu no registo. */
  linhas: number;
  /** O que se decidiu, por instrumento. */
  acoes: Record<string, string>;
  /** O motivo de cada decisao, por instrumento. A ACCAO diz o que se fez; o MOTIVO diz por que nao se fez
   *  o resto - e ha perguntas (a liquidacao acabou?) que so o motivo responde. */
  motivos: Record<string, string | null>;
}

export interface FontesDoCiclo {
  operacao: Operacao;
  config: ConfiguracaoDaConta;
  marcas: Marcas;
  /** O estado da mesa AGORA (o relogio le-o a cada volta: entre voltas pode ter mudado). */
  estado: Estado;
  /** O numero da volta. Vem de fora porque o relogio nao guarda contabilidade propria. */
  ciclo: number;
  instante_ms: number;
  caminhoDoRegisto?: string;
}

/** Uma volta do relogio: le, decide, registra. Devolve o que fez, para quem quiser contabilizar. */
const MS_DO_RELOGIO: Record<string, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000,
};

/**
 * A BARRA DA ULTIMA ENTRADA, por instrumento — o travao do D-021.
 *
 * VIVE EM MEMORIA, MAS NAO SE PERDE: ao armar o relogio a mesa semeia-o do REGISTO (`barrasDasUltimasEntradas`),
 * onde cada entrada deixa a sua barra escrita. O que um reinicio apaga e' a memoria, nao o que a mesa ja' fez.
 *
 * (Isto foi uma decisao invertida, e a razao esta' medida: antes vivia so' aqui, com o argumento de que «um
 * reinicio limpa-o, e um reinicio e' decisao do dono com registo proprio (RN-V10)». O argumento caia por duas
 * vias — o reinicio passou a ser caminho normal (ficha ligada a quente), e o que se perde ao reiniciar nao e' um
 * direito do dono, e' a trava que impede uma segunda entrada na mesma barra. Um reinicio tem de ser neutro para
 * o dinheiro.)
 */
const barraDaUltimaEntrada = new Map<string, number>();

/** Semeia o travao com as barras lidas do registo. Um instrumento ja' semeado NAO se sobrepoe: o registo e' a
 *  semente inicial, e a mesa a correr sabe mais do que o registo (ela acabou de decidir). */
export function semearTravosDeBarra(barras: Map<string, number>): void {
  for (const [instrumento, barra] of barras) {
    if (!barraDaUltimaEntrada.has(instrumento)) barraDaUltimaEntrada.set(instrumento, barra);
  }
}

/** Limpa os travoes de barra. Existe para as BANCADAS: uma bancada corre muitos casos no MESMO processo, e o
 *  tempo de uma mesa e' um caso so'. Sem isto, o caso seguinte herda a barra do anterior e a medicao mente. */
export function reiniciarTravosDeBarra(): void {
  barraDaUltimaEntrada.clear();
}

export function correrUmCiclo(fontes: FontesDoCiclo): ResultadoDoCiclo {
  const { operacao, config, marcas, estado, ciclo, instante_ms } = fontes;
  const acoes: Record<string, string> = {};
  const motivos: Record<string, string | null> = {};
  let linhas = 0;

  for (const [instrumento, decl] of Object.entries(operacao.instrumentos)) {
    const mandato = (config.fichas as Record<string, Mandato>)[instrumento]!;
    // `(marcas.desconhecido ?? [])` fazia de um livro de marcas sem a chave um livro sem desconhecidos. O
    // marcador `desconhecido` e' OBRIGATORIO desde que o leitor existe (`lerMarcas` recusa o ficheiro que o
    // nao declare, core/estado/marcas.ts): aqui le-se o que la' esta', pela funcao que ja' o sabe fazer.
    const marcaDesconhecida = desconhecidoDe(marcas, instrumento);

    // A LEITURA QUE NAO CHEGOU (RN-D7). Quem escreve a operacao deixa o campo AUSENTE quando o conector nao
    // entregou leitura nesta volta — e ausente nao e' «a mesma de antes» nem «sem posicao»: e' nao se leu.
    // A partir daqui o instrumento NAO decide: entra `sem_leitura`, que impede abrir e fechar, e a linha do
    // registo diz o motivo. Seguir com uma leitura velha seria decidir sobre um mercado que ja nao existe.
    if (decl.leitura === undefined || decl.leitura === null) {
      const decisao = decidirSemLeitura({
        instrumento,
        ligacao: operacao.ligacao,
        config,
        desconhecido: marcaDesconhecida,
      });
      registarCiclo(
        instante_ms,
        instrumento,
        decisao.acao,
        decisao.motivo,
        `ciclo ${ciclo}, condicao ${decisao.condicao} (leitura ausente na operacao)`,
        fontes.caminhoDoRegisto,
      );
      acoes[instrumento] = decisao.acao;
      motivos[instrumento] = decisao.motivo;
      linhas += 1;
      continue;
    }

    const entradas = lerParaOCiclo(decl.leitura, decl.proposta ?? null, ciclo);

    // A BARRA DO RELOGIO DA FICHA (D-021): e' ela que trava uma segunda entrada na mesma barra. Sem o intervalo
    // declarado nao ha barra — e sem barra nao ha travao: recusa-se em vez de se decidir a' escuro.
    const msDoRelogio = decl.relogio === undefined ? undefined : MS_DO_RELOGIO[decl.relogio];
    if (msDoRelogio === undefined) {
      throw new Error(
        `a operacao nao declara o relogio de ${instrumento} (veio ${JSON.stringify(decl.relogio)}): sem o intervalo ` +
          "nao se sabe em que barra cai a leitura",
      );
    }
    const instanteDoVenue = Number(entradas.mercado?.tempo_do_venue_ms);
    if (!Number.isFinite(instanteDoVenue)) {
      throw new Error(`a leitura de ${instrumento} veio sem \`tempo_do_venue_ms\`: sem o instante do venue nao ha barra`);
    }
    const barraAtual = Math.floor(instanteDoVenue / msDoRelogio) * msDoRelogio;


    const decisao = decidirInstrumento({
      mercado: entradas.mercado,
      proposta: entradas.proposta,
      proposta_invalida: entradas.proposta_invalida,
      motivo_do_contrato: entradas.motivo_do_contrato,
      ficha: decl.ficha,
      ciclo,
      ligacao: operacao.ligacao,
      // AS FALHAS E A DIVERGENCIA VEM DA OPERACAO, e o ciclo NAO as inventa: `?? {}` e `?? false` diziam «sem
      // falhas» e «nao divergente» a quem nunca o declarou — e o defeito ficou escondido 12 horas.
      falhas: (() => {
        if (decl.falhas === undefined) {
          throw new Error(
            `a operacao nao declara as falhas da leitura de ${instrumento} (\`falhas\`): quem leu sabe-o, e ` +
              "tratar o ausente como vazio e' decidir a bem de uma leitura que ninguem conferiu",
          );
        }
        return decl.falhas;
      })(),
      divergente: (() => {
        if (typeof decl.divergente !== "boolean") {
          throw new Error(
            `a operacao nao declara se a leitura de ${instrumento} divergiu (\`divergente\`): o ausente nao e' "nao divergente"`,
          );
        }
        return decl.divergente;
      })(),
      mandato,
      template: decl.template,
      // AS MARCAS: sem esta lista TODA a posicao passa a ser alheia (a mesa relata e nao gere), e uma posicao
      // nossa ficaria a espera de uma decisao que ja' foi tomada. Ausente = recusa, nao = lista vazia.
      marcas_nossas_conhecidas: (() => {
        if (decl.marcas_nossas_conhecidas === undefined) {
          throw new Error(
            `a operacao nao declara as marcas de posse de ${instrumento} (\`marcas_nossas_conhecidas\`): sem elas ` +
              "uma posicao nossa le-se como alheia, e a mesa deixa de gerir o que e' dela",
          );
        }
        return decl.marcas_nossas_conhecidas;
      })(),
      config,
      desconhecido: marcaDesconhecida,
      mesa_pausada: estado === "pausada",
      barra_atual: barraAtual,
      // O SINAL E' LIDO NO FECHO DA BARRA ANTERIOR: e' essa a barra que uma proposta desta volta pode declarar.
      // (O plugin calcula sobre a ultima barra FECHADA — nunca sobre a que ainda esta' a formar.)
      barra_do_sinal_esperada: barraAtual - msDoRelogio,
      barra_da_ultima_entrada: barraDaUltimaEntrada.get(instrumento) ?? null,
    });
    // ENTROU: guarda-se a barra. E' isto que faz a segunda proposta na mesma barra virar `nada` com motivo.
    // A VIRADA TAMBEM E' UMA ENTRADA (1.10.0): o `reverse` abre a posicao do lado novo, e a barra dele conta
    // para o travo. Sem isto, uma virada e uma abertura na mesma barra passariam as duas — que e' exactamente
    // a segunda entrada na mesma barra que este travo existe para impedir.
    if (decisao.acao === "abrir" || decisao.acao === "reverse") barraDaUltimaEntrada.set(instrumento, barraAtual);


    registarCiclo(
      instante_ms,
      instrumento,
      decisao.acao,
      decisao.motivo,
      `ciclo ${ciclo}, condicao ${decisao.condicao}${decisao.boleta ? ", com boleta" : ""}`,
      fontes.caminhoDoRegisto,
      // A BOLETA VAI DENTRO DA LINHA DA DECISAO: ela e' o detalhe daquela decisao, nao um acontecimento
      // separado. E' daqui que a mao (mesa -> conector) a vai tirar quando fechar.
      undefined,
      decisao.boleta ?? undefined,
      // A BARRA DA ENTRADA, ESCRITA (D-021): e' daqui que a mesa a volta a ler quando reiniciar. Obrigatoria
      // quando a decisao e' `abrir` — `registarCiclo` recusa uma entrada sem ela.
      decisao.acao === "abrir" ? barraAtual : undefined,
    );
    acoes[instrumento] = decisao.acao;
    motivos[instrumento] = decisao.motivo;
    linhas += 1;
  }

  return { ciclo, linhas, acoes, motivos };
}
