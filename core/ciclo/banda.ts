// A CONFERENCIA DA BANDA (D-001): o que a corretora EXECUTOU contra o que o dono AUTORIZOU.
//
// Porque existe: quem calcula o tamanho da ordem e a CORRETORA, ao executar (o `saldo_pct` sai da mesa e
// o plugin calcula). Sem esta conferencia, a banda declarada na ficha era uma INTENCAO: uma corretora que
// arredonde para cima, que aplique outra alavancagem, ou que liquide mais perto do que o mandato permite,
// executava FORA do que o dono autorizou - e a mesa continuava a achar que mandou dentro do mandato. Era
// o defeito declarado do recorte 002, e o unico pendente que podia custar dinheiro.
//
// TRES NUMEROS, TRES COMPARACOES - e so estas, porque sao as unicas que o contrato permite emparelhar:
//
//   1. `alavancagem_efectiva` (da resolucao)      vs  `bandas.alavancagem` {minimo, maximo}
//   2. a exposicao `nocional` / `equity` (%)      vs  `bandas.saldo_pct` {minimo, maximo}
//   3. a distancia de liquidacao (%)              vs  `distancia_minima_liquidacao_pct` (piso)
//
// O QUE O DONO NAO DECLAROU DIZ-SE NAO CONFERIDO - nunca "cabe". E um valor que nao se LE (ausente,
// `null`, numero do JSON, forma com expoente) tambem nao se confere: um desconhecido nunca vira "sim",
// pela mesma razao que o D4 proibe o `null` como ausencia.
//
// A RESPOSTA A UMA RESOLUCAO FORA DA BANDA NAO E "RECUSAR": ja esta executado. E REDUZIR e REGISTRAR a
// divergencia, e nao abrir risco novo naquele instrumento ate ela estar explicada (RN-M9, FR-032).
// Ao que nao se pode conferir aplica-se a mesma trava - mas NAO se reduz: nao se fecha as cegas sobre um
// numero que nao se leu. Para, e explica o que falta.
//
// Toda a aritmetica e exacta (inteiros escalados): `0.1 + 0.2 > 0.3` em ponto flutuante ja decidiu quem
// ficava de fora na fila da contenda (T066), e aqui decide se se fecha uma posicao.

export type VeredictoDaBanda = "dentro" | "fora" | "nao_conferivel";
export type AccaoDaBanda = "seguir" | "reduzir_e_registar" | "parar_e_explicar";

export interface AchadoDeBanda {
  /** `alavancagem` · `saldo_pct` · `distancia_de_liquidacao` */
  campo: string;
  /** O numero que a resolucao trouxe (ou o calculado), como se escreve numa frase. */
  valor: string;
  /** O limite declarado pelo dono, ja na mesma unidade do valor (o da exposicao vem em nocional). */
  minimo: string | null;
  maximo: string | null;
  porque: string;
}

export interface ConferenciaDaBanda {
  veredicto: VeredictoDaBanda;
  accao: AccaoDaBanda;
  /** As comparacoes que se FIZERAM (nunca as que se podiam ter feito). */
  conferidas: string[];
  /** O que caiu fora, com o numero e o limite - um por campo, nunca uma soma. */
  fora: AchadoDeBanda[];
  /** O que NAO se pode conferir, e por que - para o dono poder tapar a lacuna. */
  nao_conferidas: { campo: string; porque: string }[];
  porque: string;
}

export interface EntradaDaConferencia {
  /** A resolucao do desfecho, ja validada pelo contrato. */
  resolucao: unknown;
  bandas?: Record<string, { minimo?: string; maximo?: string }>;
  distancia_minima_liquidacao_pct?: string;
  /** O equity da conta, para converter o `nocional` em percentagem do saldo. */
  equity?: string;
  /** O preco de referencia (a marca do venue), para a distancia de liquidacao. */
  marca?: string;
}

// ---------------------------------------------------------------- decimal textual, exacto

/** A forma que o contrato exige (D4): `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`. Sem expoente, sem `+`. */
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

/** Um decimal textual lido como inteiro escalado: valor = `n / 10^escala`. */
interface Dec {
  n: bigint;
  escala: number;
}

function ler(valor: unknown): Dec | null {
  if (typeof valor !== "string" || !DECIMAL.test(valor)) return null;
  const negativo = valor.startsWith("-");
  const corpo = negativo ? valor.slice(1) : valor;
  const ponto = corpo.indexOf(".");
  const inteiro = ponto < 0 ? corpo : corpo.slice(0, ponto);
  const fraccao = ponto < 0 ? "" : corpo.slice(ponto + 1);
  const n = BigInt(inteiro + fraccao);
  return { n: negativo ? -n : n, escala: fraccao.length };
}

function pot10(e: number): bigint {
  return 10n ** BigInt(e);
}

function alinhar(a: Dec, b: Dec): [bigint, bigint] {
  const e = Math.max(a.escala, b.escala);
  return [a.n * pot10(e - a.escala), b.n * pot10(e - b.escala)];
}

/** -1, 0 ou 1. Exacto. */
function comparar(a: Dec, b: Dec): number {
  const [x, y] = alinhar(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function menos(a: Dec, b: Dec): Dec {
  const e = Math.max(a.escala, b.escala);
  return { n: a.n * pot10(e - a.escala) - b.n * pot10(e - b.escala), escala: e };
}

function absoluto(a: Dec): Dec {
  return { n: a.n < 0n ? -a.n : a.n, escala: a.escala };
}

/** Um limite que pode nao ter sido declarado. O texto di-lo, em vez de fingir um numero. */
function pctTexto(a: Dec | null): string {
  return a === null ? "(nao declarado)" : texto(a);
}

function positivo(a: Dec): boolean {
  return a.n > 0n;
}

/** A forma legivel de um decimal escalado, com a escala que ele tem (sem arredondar nada). */
function texto(a: Dec): string {
  if (a.escala === 0) return a.n.toString();
  const negativo = a.n < 0n;
  const digitos = (negativo ? -a.n : a.n).toString().padStart(a.escala + 1, "0");
  const corpo = `${digitos.slice(0, digitos.length - a.escala)}.${digitos.slice(digitos.length - a.escala)}`;
  return negativo ? `-${corpo}` : corpo;
}

// ---------------------------------------------------------------- o que o SETUP pede

/**
 * Um valor que o SETUP declara cabe na banda que o dono declarou para ele? (RN-B7, RN-M6.2, RN-S11; D-008.)
 *
 * E' o irmao pequeno do `conferirBanda`, e a diferenca esta no MOMENTO: a conferencia olha para o que a
 * corretora EXECUTOU (depois do envio, contra o mandato); esta olha para o que o setup PEDE (antes de a
 * ordem existir). A aritmetica e' a mesma, e pelo mesmo motivo: um limite de risco comparado em virgula
 * flutuante e' o defeito seguinte.
 *
 * Os tres veredictos, e o que cada um NAO quer dizer:
 *   - `dentro`: o valor cai na banda; OU nao ha' nada a limitar (o dono nao declarou banda para o campo, ou
 *     o setup nao declarou valor). As duas coisas sao «nada a conferir», e nao «conferiu e passou» - por
 *     isso a resposta diz tambem se a comparacao se FEZ (`conferido`);
 *   - `fora`: o valor declarado nao cabe na banda declarada (comparacao exacta, o valor na fronteira CABE);
 *   - `nao_conferivel`: ha' banda e ha' valor, e um dos dois nao se le' - uma declaracao que nao se
 *     conseguiu conferir nunca passa por omissao.
 */
export interface VeredictoDoParametro {
  veredicto: VeredictoDaBanda;
  /** `true` so' quando havia valor E banda, e a comparacao se fez. */
  conferido: boolean;
  valor: string;
  minimo: string | null;
  maximo: string | null;
  porque: string;
}

export function cabeNaBanda(
  valor: unknown,
  banda?: { minimo?: string; maximo?: string },
): VeredictoDoParametro {
  const { minimo, maximo, declarada } = limites(banda);
  const comoVeio = typeof valor === "string" ? valor : JSON.stringify(valor ?? null);

  if (!declarada) {
    return {
      veredicto: "dentro",
      conferido: false,
      valor: comoVeio,
      minimo: null,
      maximo: null,
      porque: "o dono nao declarou banda para este parametro: nao ha' limite a aplicar, e a ausencia de banda nao se inventa",
    };
  }
  if (valor === undefined || valor === null) {
    return {
      veredicto: "dentro",
      conferido: false,
      valor: comoVeio,
      minimo: pctTexto(minimo),
      maximo: pctTexto(maximo),
      porque: `o setup nao declarou este parametro: nao ha' valor a limitar pela banda (${pctTexto(minimo)} a ${pctTexto(maximo)})`,
    };
  }

  const v = ler(valor);
  if (v === null) {
    return {
      veredicto: "nao_conferivel",
      conferido: false,
      valor: comoVeio,
      minimo: pctTexto(minimo),
      maximo: pctTexto(maximo),
      porque: `o valor ${comoVeio} nao se le' como decimal do contrato, e a banda existe (${pctTexto(minimo)} a ${pctTexto(maximo)}): nao saber nao e' passar`,
    };
  }
  if (minimo !== null && comparar(v, minimo) < 0) {
    return {
      veredicto: "fora",
      conferido: true,
      valor: texto(v),
      minimo: texto(minimo),
      maximo: pctTexto(maximo),
      porque: `${texto(v)} esta' ABAIXO do minimo ${texto(minimo)} que o dono declarou`,
    };
  }
  if (maximo !== null && comparar(v, maximo) > 0) {
    return {
      veredicto: "fora",
      conferido: true,
      valor: texto(v),
      minimo: pctTexto(minimo),
      maximo: texto(maximo),
      porque: `${texto(v)} PASSA o maximo ${texto(maximo)} que o dono declarou`,
    };
  }
  return {
    veredicto: "dentro",
    conferido: true,
    valor: texto(v),
    minimo: pctTexto(minimo),
    maximo: pctTexto(maximo),
    porque: `${texto(v)} cabe na banda declarada (${pctTexto(minimo)} a ${pctTexto(maximo)})`,
  };
}

// ---------------------------------------------------------------- a conferencia

function limites(banda?: { minimo?: string; maximo?: string }): { minimo: Dec | null; maximo: Dec | null; declarada: boolean } {
  const minimo = ler(banda?.minimo);
  const maximo = ler(banda?.maximo);
  return { minimo, maximo, declarada: minimo !== null || maximo !== null };
}

/**
 * Confere a resolucao contra a banda do dono. PURO: nao le ficheiros, nao escreve, nao decide enviar.
 *
 * So compara o que as duas pontas declaram. Cada comparacao que NAO se pode fazer sai nomeada em
 * `nao_conferidas` - e o veredicto, quando nenhuma se pode fazer, e `nao_conferivel` (nunca `dentro`).
 */
export function conferirBanda(entrada: EntradaDaConferencia): ConferenciaDaBanda {
  const r = (entrada.resolucao ?? {}) as Record<string, unknown>;
  const conferidas: string[] = [];
  const fora: AchadoDeBanda[] = [];
  const naoConferidas: { campo: string; porque: string }[] = [];

  // --- 1. a alavancagem que o venue REALMENTE aplicou -------------------------------
  const bandaDaAlavancagem = limites(entrada.bandas?.alavancagem);
  const alavancagem = ler(r["alavancagem_efectiva"]);
  if (!bandaDaAlavancagem.declarada) {
    naoConferidas.push({
      campo: "alavancagem",
      porque: "a ficha nao declara `bandas.alavancagem` (minimo e maximo ausentes): nao ha contra o que conferir",
    });
  } else if (alavancagem === null) {
    naoConferidas.push({
      campo: "alavancagem",
      porque: "a resolucao nao traz `alavancagem_efectiva` num decimal textual legivel (D4)",
    });
  } else {
    conferidas.push("alavancagem");
    if (bandaDaAlavancagem.maximo !== null && comparar(alavancagem, bandaDaAlavancagem.maximo) > 0) {
      fora.push({
        campo: "alavancagem",
        valor: texto(alavancagem),
        minimo: bandaDaAlavancagem.minimo === null ? null : texto(bandaDaAlavancagem.minimo),
        maximo: texto(bandaDaAlavancagem.maximo),
        porque: `a corretora aplicou alavancagem ${texto(alavancagem)} e o maximo que o dono autorizou e ${texto(bandaDaAlavancagem.maximo)}`,
      });
    } else if (bandaDaAlavancagem.minimo !== null && comparar(alavancagem, bandaDaAlavancagem.minimo) < 0) {
      fora.push({
        campo: "alavancagem",
        valor: texto(alavancagem),
        minimo: texto(bandaDaAlavancagem.minimo),
        maximo: bandaDaAlavancagem.maximo === null ? null : texto(bandaDaAlavancagem.maximo),
        porque: `a corretora aplicou alavancagem ${texto(alavancagem)} e o minimo declarado e ${texto(bandaDaAlavancagem.minimo)}`,
      });
    }
  }

  // --- 2. a exposicao: nocional sobre equity, contra a banda de `saldo_pct` ----------
  const bandaDaExposicao = limites(entrada.bandas?.saldo_pct);
  const nocional = ler(r["nocional"]);
  const equity = ler(entrada.equity);
  if (!bandaDaExposicao.declarada) {
    naoConferidas.push({
      campo: "saldo_pct",
      porque: "a ficha nao declara `bandas.saldo_pct` (minimo e maximo ausentes): a exposicao nao tem contra o que ser conferida",
    });
  } else if (nocional === null) {
    naoConferidas.push({ campo: "saldo_pct", porque: "a resolucao nao traz `nocional` num decimal textual legivel (D4)" });
  } else if (equity === null) {
    naoConferidas.push({ campo: "saldo_pct", porque: "sem o `equity` a exposicao (nocional sobre saldo) nao se calcula" });
  } else if (!positivo(equity)) {
    naoConferidas.push({ campo: "saldo_pct", porque: `o equity declarado e ${texto(equity)}: nao ha percentagem de saldo que se calcule sobre ele` });
  } else {
    conferidas.push("saldo_pct");
    // Em nocional absoluto, para o numero ser comparavel sem uma divisao que nao fecha:
    // limite = equity * limite_pct / 100 - exacto (a divisao por 100 e so deslocar a escala).
    const emNocional = (pct: Dec): Dec => ({
      n: equity.n * pct.n,
      escala: equity.escala + pct.escala + 2,
    });
    const maximoAbsoluto = bandaDaExposicao.maximo === null ? null : emNocional(bandaDaExposicao.maximo);
    const minimoAbsoluto = bandaDaExposicao.minimo === null ? null : emNocional(bandaDaExposicao.minimo);
    if (maximoAbsoluto !== null && comparar(nocional, maximoAbsoluto) > 0) {
      fora.push({
        campo: "saldo_pct",
        valor: texto(nocional),
        minimo: minimoAbsoluto === null ? null : texto(minimoAbsoluto),
        maximo: texto(maximoAbsoluto),
        porque: `a posicao ficou com nocional ${texto(nocional)} sobre um equity de ${texto(equity)}, e o maximo declarado (${pctTexto(bandaDaExposicao.maximo)}%) vale ${texto(maximoAbsoluto)} de nocional`,
      });
    } else if (minimoAbsoluto !== null && comparar(nocional, minimoAbsoluto) < 0) {
      fora.push({
        campo: "saldo_pct",
        valor: texto(nocional),
        minimo: texto(minimoAbsoluto),
        maximo: maximoAbsoluto === null ? null : texto(maximoAbsoluto),
        porque: `a posicao ficou com nocional ${texto(nocional)} sobre um equity de ${texto(equity)}, e o minimo declarado (${pctTexto(bandaDaExposicao.minimo)}%) vale ${texto(minimoAbsoluto)} de nocional`,
      });
    }
  }

  // --- 3. a distancia a liquidacao: o mandato pode proibir liquidar tao perto --------
  const minimaDistancia = ler(entrada.distancia_minima_liquidacao_pct);
  const liquidacao = ler(r["preco_de_liquidacao"]);
  const marca = ler(entrada.marca);
  if (entrada.distancia_minima_liquidacao_pct === undefined || entrada.distancia_minima_liquidacao_pct === null) {
    naoConferidas.push({
      campo: "distancia_de_liquidacao",
      porque: "a ficha nao declara `distancia_minima_liquidacao_pct`: o mandato nao diz a que distancia minima a posicao pode ser liquidada",
    });
  } else if (minimaDistancia === null) {
    naoConferidas.push({
      campo: "distancia_de_liquidacao",
      porque: "`distancia_minima_liquidacao_pct` nao e um decimal textual legivel (D4)",
    });
  } else if (liquidacao === null) {
    naoConferidas.push({
      campo: "distancia_de_liquidacao",
      porque: "a resolucao nao traz `preco_de_liquidacao` num decimal textual legivel (D4)",
    });
  } else if (marca === null) {
    naoConferidas.push({
      campo: "distancia_de_liquidacao",
      porque: "sem a marca (o preco de referencia do venue) a distancia a liquidacao nao se calcula",
    });
  } else if (!positivo(marca)) {
    naoConferidas.push({ campo: "distancia_de_liquidacao", porque: `a marca declarada e ${texto(marca)}: nao ha distancia que se calcule sobre ela` });
  } else if (liquidacao.n === 0n) {
    // Zero e valor LEGITIMO no contrato (a alavancagem 1x nao tem liquidacao a vista). Dizer que se
    // conferiu e dizer PORQUE e que o piso nao pode ser violado aqui - nao e "passou em silencio".
    conferidas.push("distancia_de_liquidacao");
  } else {
    conferidas.push("distancia_de_liquidacao");
    // Mesma tecnica da exposicao: em vez de dividir (a divisao nao fecha), converte-se o PISO a PRECO
    // - `marca * minimo / 100`, e a divisao por 100 e so deslocar a escala. Assim o numero que se
    // compara e o que se reporta, sem uma percentagem arredondada que ninguem escreveu.
    const distanciaEmPreco = absoluto(menos(marca, liquidacao));
    const pisoEmPreco: Dec = { n: marca.n * minimaDistancia.n, escala: marca.escala + minimaDistancia.escala + 2 };
    if (comparar(distanciaEmPreco, pisoEmPreco) < 0) {
      fora.push({
        campo: "distancia_de_liquidacao",
        valor: texto(distanciaEmPreco),
        minimo: texto(pisoEmPreco),
        maximo: null,
        porque:
          `a marca ${texto(marca)} e a liquidacao ${texto(liquidacao)} deixam ${texto(distanciaEmPreco)} de distancia, ` +
          `e o mandato exige no minimo ${texto(minimaDistancia)}% da marca, que valem ${texto(pisoEmPreco)}`,
      });
    }
  }

  // --- o veredicto: qualquer um fora manda; sem nenhuma conferida, nao e "dentro" ---
  if (fora.length > 0) {
    return {
      veredicto: "fora",
      accao: "reduzir_e_registar",
      conferidas,
      fora,
      nao_conferidas: naoConferidas,
      porque:
        `${fora.length} de ${conferidas.length} conferidas cairam FORA da banda declarada: ` +
        `${fora.map((f) => f.porque).join("; ")}. Ja esta executado: reduz-se e registra-se a divergencia, ` +
        `e nao se abre risco novo neste instrumento ate ela estar explicada.`,
    };
  }

  if (conferidas.length === 0) {
    return {
      veredicto: "nao_conferivel",
      accao: "parar_e_explicar",
      conferidas,
      fora,
      nao_conferidas: naoConferidas,
      porque:
        `nenhuma das tres comparacoes se pode fazer: ${naoConferidas.map((n) => `${n.campo} (${n.porque})`).join("; ")}. ` +
        `O que nao se confere nao vira "cabe": nao se abre risco novo neste instrumento ate se poder conferir.`,
    };
  }

  return {
    veredicto: "dentro",
    accao: "seguir",
    conferidas,
    fora,
    nao_conferidas: naoConferidas,
    porque:
      `${conferidas.length} de 3 conferidas, e todas dentro da banda declarada (${conferidas.join(", ")})` +
      (naoConferidas.length > 0
        ? `. Ficaram por conferir: ${naoConferidas.map((n) => n.campo).join(", ")}.`
        : ". Nada ficou por conferir."),
  };
}
