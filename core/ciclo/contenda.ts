// A CONTENDA: quando as fichas somam mais do que o tecto, QUEM fica de fora.
//
// A regra e FIFO pelo RELOGIO DO VENUE (emenda do dono, 28 set 2026) - nao uma lista declarada, que
// envelhece em silencio, e nao o alfabeto, que nao tem nada a ver com quem pediu primeiro. Ordem de
// chegada e a unica que o dono consegue explicar a outra pessoa sem consultar o ficheiro de config.
//
// Tres coisas que esta funcao NAO faz, e sao a razao de ela ser assim:
//   1. NAO deixa passar quem chegou depois enquanto o da frente espera. Se o primeiro nao cabe, a fila
//      para ali: sem isso, um pedido pequeno ultrapassava um grande e a ordem deixava de ser ordem.
//   2. NAO adivinha o instante que falta. Ficha sem instante conhecido nao ganha um instante inventado -
//      vai para o fim do grupo, e o criterio usado fica REGISTADO como desempate por simbolo.
//   3. NAO soma em virgula flutuante. `0.1 + 0.2` em ponto flutuante e maior do que `0.3`, e essa quarta
//      casa invisivel decidiria quem fica de fora - um numero que ninguem escreveu decide uma recusa. A
//      soma e feita em inteiros escalados (`BigInt`), pela mesma razao que o CB do recorte 002.

export type CriterioDaContenda = "fifo" | "fifo_desempatado_por_simbolo";

export interface PedidoDeContenda {
  instrumento: string;
  saldo_pct: string;
  /** O instante do PEDIDO no relogio do venue. Ausente = nao se sabe quando chegou. */
  instante_no_venue_ms?: number | null;
}

export interface Contenda {
  soma: string;
  tecto: string;
  criterio: CriterioDaContenda;
  ordem: string[];
  admitidos: string[];
  de_fora: string[];
  porque: string;
}

const casas = (s: string): number => (s.split(".")[1] ?? "").length;
const escalar = (s: string, c: number): bigint => BigInt(s.replace(".", "") + "0".repeat(c - casas(s)));

/** A soma dos saldos em inteiros escalados - nunca em ponto flutuante. */
export function somarSaldos(pedidos: PedidoDeContenda[]): { total: bigint; casas: number } {
  const c = Math.max(0, ...pedidos.map((p) => casas(p.saldo_pct)));
  return { total: pedidos.reduce((acc, p) => acc + escalar(p.saldo_pct, c), 0n), casas: c };
}

/** A ordem de atendimento: instante do venue, e o simbolo so quando os instantes coincidem (ou faltam). */
function ordenarFifo(pedidos: PedidoDeContenda[]): PedidoDeContenda[] {
  return [...pedidos].sort((a, b) => {
    const ia = a.instante_no_venue_ms ?? null;
    const ib = b.instante_no_venue_ms ?? null;
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
  const tecto = escalar(tectoPct, c);

  const admitidos: string[] = [];
  let soma = 0n;
  let cortou = false;
  const deFora: string[] = [];
  for (const p of ordenados) {
    const valor = escalar(p.saldo_pct, c);
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
  const instante = (p: PedidoDeContenda | null) => p?.instante_no_venue_ms ?? null;
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

  const casasTxt = c === 0 ? "" : "0".repeat(0);
  const emTexto = (v: bigint) => {
    const s = v.toString().padStart(c + 1, "0");
    return c === 0 ? s : `${s.slice(0, s.length - c)}.${s.slice(s.length - c)}`;
  };

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
          `${ordenados.map((p) => p.instrumento).join(" -> ")} (${criterio === "fifo" ? "FIFO pelo relogio do venue" : "FIFO com empate desempatado pelo simbolo"}). ` +
          `Entram ${admitidos.join(", ") || "nenhuma"}; ficam de fora ${deFora.join(", ")}.`,
  };
}
