// O SINAL DO PINE, EM MOTOR — a tradução fiel de `sign(mid - MA) + ZZ`.
//
// ISTO É UMA FUNÇÃO PURA. Recebe velas fechadas e as constantes, devolve um ponto por barra com o que o
// indicador calcula: a média, o ATR, o `mid`, o lado (`sig`), o extremo da perna e se houve VIRAGEM. Não lê
// ficheiros, não fala com o venue, não sabe o que é uma posição. É por isso que se pode REBOBINAR: o mesmo
// código que corre ao vivo corre sobre o histórico, e uma divergência aparece como uma divergência — não como
// uma opinião.
//
// O QUE O INDICADOR FAZ, e é isto que está aqui, linha por linha:
//   * `srcM`/`srcS` = hl2 ou close (das velas FECHADAS);
//   * a média = EMA (ou SMA) de `ma_len` dessas velas, A INCLUIR a barra que fechou (não há `[1]` no Pine);
//   * o ATR = ta.atr(atr_len), que em Pine é **RMA de Wilder** (não média simples) e também inclui a barra;
//   * `banda = banda_atr * ATR` (0 se a banda estiver desligada) — e é uma zona morta: dentro dela não há lado;
//   * `acima = mid > MA + banda`, `abaixo = mid < MA - banda`;
//   * a cada barra FECHADA: o `extremo` passa a ser o máximo (se `sig=1`) ou o mínimo (se `sig=-1`) visto desde
//     a última viragem; e vira quando o preço está acima/abaixo da banda e — se já havia lado — o recuo desde o
//     extremo chega a `zz_atr * ATR`. Com `sig=0` o zigzag NÃO trava: a primeira entrada é sempre permitida.
//
// O `na` DO PINE, QUE JA' NOS FALTOU AQUI (medido em 30/09/2026, 505 barras de SOL H1 contra a transcrição do
// indicador em `tools/verificar-setup/pine-sigma.py`): a prontidão do Pine é `not na(mid) and not na(maH) and
// not na(pxT)` — **o ATR não entra nela**. Sem ATR (as primeiras `atr_len - 1` barras) a `banda` é **0, ou seja
// não há zona morta**, e o `recuoOk` do zigzag **não trava**. O nosso motor exigia ATR e calava-se nessas
// barras: ficava `sig=0` nas barras #1..#13 onde o gráfico já tinha lado, e a virada que o Pine marcava na #1
// saía-nos na #14. As duas séries reconvergiam, mas por sorte — o lado e o `extremo` do arranque alimentam o
// travão do zigzag de todas as barras seguintes.
//
// A ARMADILHA, e é a razão de este ficheiro existir separado do plugin: `ta.ema` e `ta.rma` TÊM SEMENTE, e a
// semente muda os primeiros valores. Uma "simplificação" que arranque a média do primeiro valor dá números
// quase iguais e um dia vira onde o gráfico não virou. Aqui a semente é explícita e medida contra o gráfico.

/** Uma vela como o venue a dá (os números vêm em TEXTO: D4 do contrato). */
export interface Vela {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v?: string;
}

/** As constantes da ficha do par — os `input` do indicador. */
export interface Constantes {
  ma_len: number;
  ma_tipo: "EMA" | "SMA";
  src_ma: "hl2" | "close";
  src_sinal: "hl2" | "close";
  usar_banda: boolean;
  banda_atr: string | number;
  usar_zz: boolean;
  zz_atr: string | number;
  atr_len: number;
}

/** O que o indicador mostra numa barra. `sig` é o do FIM dessa barra. */
export interface Ponto {
  t: number;
  ma: number | null;
  atr: number | null;
  mid: number;
  banda: number;
  sig: number;
  extremo: number | null;
  /** 1 = virou para comprado nesta barra; -1 = para vendido; 0 = não virou. É o triângulo do gráfico. */
  virada: number;
}

const num = (x: string | number): number => (typeof x === "number" ? x : Number(x));
const hl2 = (v: Vela): number => (num(v.h) + num(v.l)) / 2;
const preco = (v: Vela, qual: "hl2" | "close"): number => (qual === "hl2" ? hl2(v) : num(v.c));

/**
 * A MÉDIA, com a semente do Pine.
 *
 * `ta.ema(x, n)` do Pine é recursiva e começa no PRIMEIRO valor (alpha = 2/(n+1)) — e é essa a convenção que
 * fica por omissão. A outra (`sma` das primeiras n) existe aqui porque foi medida: a diferença entre as duas
 * desvanece, e há que provar que não muda nenhuma viragem. Medir as duas é a única forma honesta de escolher.
 */
export function serieDaMedia(valores: number[], n: number, tipo: "EMA" | "SMA", semente: "recursiva" | "sma" = "recursiva"): (number | null)[] {
  const saida: (number | null)[] = [];
  if (tipo === "SMA") {
    let soma = 0;
    for (let i = 0; i < valores.length; i++) {
      soma += valores[i]!;
      if (i >= n) soma -= valores[i - n]!;
      saida.push(i + 1 >= n ? soma / n : null);
    }
    return saida;
  }
  const alpha = 2 / (n + 1);
  let ema: number | null = null;
  let somaInicial = 0;
  for (let i = 0; i < valores.length; i++) {
    const x = valores[i]!;
    if (ema === null) {
      if (semente === "recursiva") {
        ema = x; // o Pine: a recursão começa no primeiro valor
      } else {
        somaInicial += x;
        if (i + 1 < n) { saida.push(null); continue; }
        ema = somaInicial / n; // a outra convenção: média simples das primeiras n
        saida.push(ema);
        continue;
      }
    } else {
      ema = alpha * x + (1 - alpha) * ema;
    }
    saida.push(ema);
  }
  return saida;
}

/** O TR e o ATR. `ta.atr(n)` do Pine = `ta.rma(tr, n)`: Wilder, com a semente na média simples das primeiras n. */
export function serieDoAtr(velas: Vela[], n: number): (number | null)[] {
  const trs: number[] = [];
  for (let i = 0; i < velas.length; i++) {
    const v = velas[i]!;
    if (i === 0) { trs.push(num(v.h) - num(v.l)); continue; }
    const fechoAnterior = num(velas[i - 1]!.c);
    trs.push(Math.max(num(v.h) - num(v.l), Math.abs(num(v.h) - fechoAnterior), Math.abs(num(v.l) - fechoAnterior)));
  }
  const saida: (number | null)[] = [];
  let rma: number | null = null;
  let soma = 0;
  for (let i = 0; i < trs.length; i++) {
    if (i < n) {
      soma += trs[i]!;
      if (i + 1 === n) { rma = soma / n; saida.push(rma); } else saida.push(null);
      continue;
    }
    rma = (rma! * (n - 1) + trs[i]!) / n;
    saida.push(rma);
  }
  return saida;
}

/**
 * O estado do indicador, barra a barra.
 *
 * Repare-se no que NÃO está aqui: não há "estado plano". Depois da primeira viragem o `sig` é 1 ou -1 e é a
 * viragem que o muda — a única saída é virar. É por isso que a ficha tem `ao_desligar`: desligar um par passa a
 * ser um acto, não uma espera.
 */
export function calcular(velas: Vela[], k: Constantes, semente: "recursiva" | "sma" = "recursiva"): Ponto[] {
  const mid = velas.map((v) => preco(v, k.src_sinal));
  const daMedia = serieDaMedia(velas.map((v) => preco(v, k.src_ma)), k.ma_len, k.ma_tipo, semente);
  const doAtr = serieDoAtr(velas, k.atr_len);
  const bandaAtr = num(k.banda_atr);
  const zzAtr = num(k.zz_atr);

  const saida: Ponto[] = [];
  let sig = 0;
  let extremo: number | null = null;

  for (let i = 0; i < velas.length; i++) {
    const ma = daMedia[i] ?? null;
    const atr = doAtr[i] ?? null;
    const m = mid[i]!;
    const banda = k.usar_banda && atr !== null ? bandaAtr * atr : 0;
    const sigAntes = sig;

    // A barra "nova" do Pine: aqui TODAS as velas são fechadas (o plugin deixa a que está a formar de fora), e
    // por isso todas contam — a mesma semântica de `barstate.isconfirmed` no mesmo timeframe. E o ATR **não**
    // entra na prontidão do Pine: sem ele a `banda` é 0 (não há zona morta) e o zigzag não trava.
    if (ma !== null) {
      if (sig === 1) extremo = extremo === null ? m : Math.max(extremo, m);
      else if (sig === -1) extremo = extremo === null ? m : Math.min(extremo, m);

      let recuoOk = true;
      if (k.usar_zz && extremo !== null && atr !== null && atr > 0 && sig !== 0) {
        recuoOk = sig === 1 ? extremo - m >= zzAtr * atr : m - extremo >= zzAtr * atr;
      }

      const acima = m > ma + banda;
      const abaixo = m < ma - banda;
      if (sig !== 1 && acima && (sig === 0 || recuoOk)) {
        sig = 1;
        extremo = m;
      } else if (sig !== -1 && abaixo && (sig === 0 || recuoOk)) {
        sig = -1;
        extremo = m;
      }
    }

    saida.push({ t: velas[i]!.t, ma, atr, mid: m, banda, sig, extremo, virada: sig !== sigAntes ? sig : 0 });
  }
  return saida;
}
