// A CONTENDA: quando as fichas somam mais do que o tecto, QUEM fica de fora.
//
// A regra e FIFO (emenda do dono, 28 set 2026) - nao uma lista declarada, que envelhece em silencio, e
// nao o alfabeto, que nao tem nada a ver com quem pediu primeiro. Ordem de chegada e a unica que o dono
// consegue explicar a outra pessoa sem consultar o ficheiro de config.
//
// O RELOGIO E O DA MESA, e nao o do venue. Esta fila e feita de INTENCOES que chegam a mesa - o venue
// nunca as viu, logo nao tem instante nenhum para lhes dar. E o instante de chegada tem de ser o NOSSO,
// medido quando o pedido e recebido: aceitar o instante que o pedido traz seria deixar quem chama escolher
// o lugar na fila, e um plugin (ou uma ponta com pressa) passaria a frente de todos.
//
// O relogio do venue serve para outra coisa, e essa e outra pergunta: casar a NOSSA ordem com o que o
// venue respondeu. Sao dois tempos diferentes, e mistura-los e o erro classico - o carimbo do venue diz
// quando o preco existiu; a idade de chegada diz ha quanto tempo nao ouvimos nada. Aqui so entra o
// segundo.
//
// Tres coisas que esta funcao NAO faz, e sao a razao de ela ser assim:
//   1. NAO deixa passar quem chegou depois enquanto o da frente espera. Se o primeiro nao cabe, a fila
//      para ali: sem isso, um pedido pequeno ultrapassava um grande e a ordem deixava de ser ordem.
//   2. NAO adivinha o instante que falta. Ficha sem instante conhecido nao ganha um instante inventado -
//      vai para o fim do grupo, e o criterio usado fica REGISTADO como desempate por simbolo.
//   3. NAO soma em virgula flutuante. `0.1 + 0.2` em ponto flutuante e maior do que `0.3`, e essa quarta
//      casa invisivel decidiria quem fica de fora - um numero que ninguem escreveu decide uma recusa. A
//      soma e feita em inteiros escalados (`BigInt`), pela mesma razao que o CB do recorte 002.

export type CriterioDaContenda = "fifo" | "fifo_desempatado_por_simbolo" | "recusada";

/**
 * O motivo da RECUSA da contenda: quando o tecto e os saldos nao partilham uma escala, nao ha soma
 * comparavel a tecto nenhum, e a contenda nao se resolve por omissao (RN-M4.7).
 *
 * E um nome PROPRIO e exportado, e nao um texto solto no meio do codigo: quem le a recusa (a bancada, o
 * registo) le o nome DAQUI. Comparar um motivo contra um literal escrito no consumidor nao mede
 * vocabulario nenhum. Isto e o vocabulario da CONTENDA (uma funcao pura do core), e por isso nao vive em
 * `contracts/vocabulario.json`, que e a lingua que cruza a fronteira entre processos — a contenda nao a
 * cruza: o arranque le-a em processo e recusa com a porta `contenda` e o motivo `porta_do_arranque_falhou`.
 */
export const MOTIVO_DA_ESCALA = "escala_do_tecto_incompativel_com_os_saldos";

/**
 * Uma recusa COM NOME — o motivo e a razao dele. Substitui a excepcao: um numero que nao cabe na escala
 * dos outros RECUSA-se, e recusa nomeia-se. Nao ha `null` em lado nenhum: ou o campo esta la, ou nao esta.
 */
export interface RecusaDaContenda {
  motivo: string;
  porque: string;
}


export interface PedidoDeContenda {
  instrumento: string;
  saldo_pct: string;
  /**
   * O instante em que a MESA recebeu o pedido, no relogio da propria mesa (monotonico).
   *
   * Ausente = o pedido nao foi carimbado. Nao se inventa um instante para ele: entra no grupo dos que
   * chegaram ao mesmo tempo, e o criterio registado diz que foi o simbolo a desempatar. O instante que o
   * pedido traga de fora NAO e usado - quem escolhe o lugar na fila e quem recebe, nao quem pede.
   */
  instante_de_chegada_ms?: number | null;
}

export interface Contenda {
  soma: string;
  tecto: string;
  criterio: CriterioDaContenda;
  ordem: string[];
  admitidos: string[];
  de_fora: string[];
  porque: string;
  /**
   * A recusa, quando a contenda NAO se pode decidir: os numeros declarados nao sao comparaveis, e por
   * isso nenhuma ficha entra. AUSENTE = a contenda decidiu — mesmo com `de_fora` cheio, que ai e a fila a
   * ESPERAR (a politica do dono), nao uma recusa.
   */
  recusa?: RecusaDaContenda;
}

const casas = (s: string): number => (s.split(".")[1] ?? "").length;

/**
 * O valor de um decimal textual na escala `c` — ou `undefined` quando ele NAO CABE nessa escala (tem
 * mais casas decimais do que ela admite).
 *
 * Era aqui o defeito: `"0".repeat(c - casas(s))` sem guarda recebia um numero NEGATIVO e lancava
 * `RangeError: String.prototype.repeat argument must be greater than or equal to 0` — uma excepcao
 * anonima no lugar de uma recusa com motivo, e um fail-closed que deixava de fechar. Um numero que nao
 * cabe na escala dos outros NAO SE COMPARA: devolve-se `undefined`, e quem chama RECUSA pelo nome.
 */
const escalar = (s: string, c: number): bigint | undefined => {
  const d = casas(s);
  if (d > c) return undefined;
  return BigInt(s.replace(".", "") + "0".repeat(c - d));
};

/** A soma dos saldos em inteiros escalados - nunca em ponto flutuante. */
export function somarSaldos(pedidos: PedidoDeContenda[]): { total: bigint; casas: number } {
  const c = Math.max(0, ...pedidos.map((p) => casas(p.saldo_pct)));
  // `c` e o MAXIMO das casas dos saldos: cada saldo cabe nele por construcao, e e essa a unica razao de
  // aqui poder afirmar o valor (a guarda da escala so pode disparar para um valor com MAIS casas do que
  // a escala pedida - que aqui nao existe).
  return { total: pedidos.reduce((acc, p) => acc + escalar(p.saldo_pct, c)!, 0n), casas: c };
}

/** A ordem de atendimento: chegada na mesa, e o simbolo so quando os instantes coincidem (ou faltam). */
function ordenarFifo(pedidos: PedidoDeContenda[]): PedidoDeContenda[] {
  return [...pedidos].sort((a, b) => {
    const ia = a.instante_de_chegada_ms ?? null;
    const ib = b.instante_de_chegada_ms ?? null;
    if (ia !== null && ib !== null && ia !== ib) return ia - ib;
    if (ia !== null && ib === null) return -1;
    if (ia === null && ib !== null) return 1;
    return a.instrumento < b.instrumento ? -1 : a.instrumento > b.instrumento ? 1 : 0;
  });
}

/**
 * Resolve a contenda. Devolve a ordem, quem entra e quem fica de fora, e o criterio que decidiu o corte.
 *
 * Chamada com o tecto ja convertido: quem chama le a chave (`conta.margem_total_maxima_pct`).
 */
export function resolverContenda(pedidos: PedidoDeContenda[], tectoPct: string): Contenda {
  const ordenados = ordenarFifo(pedidos);
  const { total, casas: c } = somarSaldos(pedidos);

  const casasTxt = c === 0 ? "" : "0".repeat(0);
  const emTexto = (v: bigint) => {
    const s = v.toString().padStart(c + 1, "0");
    return c === 0 ? s : `${s.slice(0, s.length - c)}.${s.slice(s.length - c)}`;
  };

  // O TECTO TEM DE CABER NA ESCALA DOS SALDOS — e um facto sobre os numeros DECLARADOS, e nao um detalhe
  // de implementacao. Um tecto com mais casas do que TODOS os saldos (ex.: tecto `99.75` com saldos
  // inteiros) nao cabe em inteiro nenhum na escala deles, e o tecto NAO se arredonda para o fazer caber
  // (isso seria a mesa a decidir pelo dono): RECUSA-SE, pelo nome. Antes disto o motor lancava
  // `RangeError` aqui e a porta da contenda deixava de ser um portao.
  const tecto = escalar(tectoPct, c);
  if (tecto === undefined) {
    const porque =
      `O tecto declarado '${tectoPct}' tem ${casas(tectoPct)} casa(s) decimal(is) e os saldos das fichas ` +
      `levam no maximo ${c}: com escalas diferentes nao ha soma comparavel a tecto nenhum, e arredondar ` +
      "o tecto para o fazer caber esta fora do que a mesa pode fazer (o tecto e do dono, RN-M9). A " +
      "contenda RECUSA e nenhuma ficha entra — nao se resolve por omissao (RN-M4.7).";
    return {
      soma: emTexto(total) + casasTxt,
      tecto: tectoPct,
      criterio: "recusada",
      ordem: ordenados.map((p) => p.instrumento),
      admitidos: [],
      // Ninguem entra. Aqui `de_fora` NAO e a fila a esperar (essa e a politica do dono): e a RECUSA —
      // quem a le tem de ler `recusa`, porque o nome do motivo vive la.
      de_fora: ordenados.map((p) => p.instrumento),
      porque,
      recusa: { motivo: MOTIVO_DA_ESCALA, porque },
    };
  }

  const admitidos: string[] = [];
  let soma = 0n;
  let cortou = false;
  const deFora: string[] = [];
  for (const p of ordenados) {
    // `c` e o maximo das casas dos saldos: o valor cabe sempre nesta escala (ver `somarSaldos`).
    const valor = escalar(p.saldo_pct, c)!;
    if (!cortou && soma + valor <= tecto) {
      soma += valor;
      admitidos.push(p.instrumento);
    } else {
      cortou = true;
      deFora.push(p.instrumento);
    }
  }

  // O criterio que decidiu o CORTE - nao o que ordenou a fila inteira. E o corte que decide quem fica
  // de fora, e e isso que o dono precisa de ler para saber a quem perguntar.
  const ultimoDentro = ordenados[admitidos.length - 1] ?? null;
  const primeiroFora = ordenados[admitidos.length] ?? null;
  const instante = (p: PedidoDeContenda | null) => p?.instante_de_chegada_ms ?? null;
  // Sem corte, ninguem foi decidido pelo alfabeto: a fila foi servida por ordem de chegada e chegou para
  // todos. So quando o CORTE cai dentro de um empate (ou de instantes que faltam) e que o desempate
  // decidiu alguma coisa - e e isso que o criterio tem de dizer, porque e isso que o dono vai ler.
  const decididoPeloInstante =
    deFora.length === 0 ||
    (ultimoDentro !== null &&
      primeiroFora !== null &&
      instante(primeiroFora) !== null &&
      instante(ultimoDentro) !== null &&
      (instante(primeiroFora) as number) > (instante(ultimoDentro) as number));
  const criterio: CriterioDaContenda = decididoPeloInstante ? "fifo" : "fifo_desempatado_por_simbolo";

  return {
    soma: emTexto(total) + casasTxt,
    tecto: emTexto(tecto),
    criterio,
    ordem: ordenados.map((p) => p.instrumento),
    admitidos,
    de_fora: deFora,
    porque:
      deFora.length === 0
        ? `As fichas somam ${emTexto(total)}% e o tecto e ${emTexto(tecto)}%: entram todas.`
        : `As fichas somam ${emTexto(total)}% e o tecto e ${emTexto(tecto)}%. Ordem de atendimento: ` +
          `${ordenados.map((p) => p.instrumento).join(" -> ")} (${criterio === "fifo" ? "FIFO pela hora de chegada na mesa" : "FIFO com empate desempatado pelo simbolo"}). ` +
          `Entram ${admitidos.join(", ") || "nenhuma"}; ficam de fora ${deFora.join(", ")}.`,
  };
}
