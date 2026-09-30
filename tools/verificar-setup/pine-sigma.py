#!/usr/bin/env python3
"""O ESPELHO DO PINE — a transcricao, linha por linha, do indicador `sign(mid - MA) + ZZ`.

FONTE: `setups/sigma/pine/sign-mid-ma-zz.pine` (o script que o dono manda, guardado no repositorio ao lado desta
transcricao para que a traducao seja RASTREAVEL ate' ao artefacto). Se o Pine mudar, o que se faz e' comparar as
duas versoes com espacos normalizados — as linhas que decidem tem de continuar identicas — e so' depois mexer aqui.

ISTO NAO E' UMA SEGUNDA IMPLEMENTACAO DA NOSSA REGRA: e' a regra do PINE escrita em Python, com a semantica
`na` do Pine preservada, para poder ser confrontada com o motor (`setups/sigma/sinal.ts`). O irmao que existia
aqui antes (`espelho.py`) copiava a ESTRUTURA do nosso TypeScript — provava que duas linguagens concordam, nao
que a regra e' a do indicador.

O QUE O PINE FAZ E O QUE ISSO OBRIGA (o que so' se ve' lendo o `na`):
  * `pronta = not na(mid) and not na(maH) and not na(pxT)` — o ATR **nao** entra na prontidao;
  * `banda = usarBanda and not na(atrH) ? bandaAtr*atrH : 0.0` — sem ATR a banda e' ZERO, ou seja **nao ha zona
    morta** nas primeiras `atr_len - 1` barras;
  * o `recuoOk` do zigzag so' se calcula com `not na(atrH)` — sem ATR o zigzag tambem **nao trava**.
  * `ta.ema` comeca no primeiro valor (alpha = 2/(n+1)); `ta.atr` = `ta.rma(tr, n)`, cuja semente e' a media
    simples das primeiras n.

Uso: pine-sigma.py <velas.jsonl> <constantes.json> <saida.json>
"""
import json
import sys

velas = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
K = json.load(open(sys.argv[2], encoding="utf-8"))


def num(x):
    return float(x)


def hl2(v):
    return (num(v["h"]) + num(v["l"])) / 2.0


def preco(v, qual):
    return hl2(v) if qual == "hl2" else num(v["c"])


def ta_ema(valores, n):
    """`ta.ema`: recursiva, comeca no PRIMEIRO valor; nunca e' `na`."""
    alpha = 2.0 / (n + 1)
    out, ema = [], None
    for x in valores:
        ema = x if ema is None else alpha * x + (1 - alpha) * ema
        out.append(ema)
    return out


def ta_sma(valores, n):
    """`ta.sma`: `na` enquanto nao houver n valores."""
    out, soma = [], 0.0
    for i, x in enumerate(valores):
        soma += x
        if i >= n:
            soma -= valores[i - n]
        out.append(soma / n if i + 1 >= n else None)
    return out


def ta_tr(velas):
    """`ta.tr`: na primeira barra e' high - low; depois entra o fecho anterior."""
    out = []
    for i, v in enumerate(velas):
        if i == 0:
            out.append(num(v["h"]) - num(v["l"]))
            continue
        fc = num(velas[i - 1]["c"])
        out.append(max(num(v["h"]) - num(v["l"]), abs(num(v["h"]) - fc), abs(num(v["l"]) - fc)))
    return out


def ta_rma(valores, n):
    """`ta.rma`: semente = media simples das primeiras n (e' o que o `ta.atr` usa)."""
    out, rma, soma = [], None, 0.0
    for i, x in enumerate(valores):
        if i < n:
            soma += x
            if i + 1 == n:
                rma = soma / n
                out.append(rma)
            else:
                out.append(None)
            continue
        rma = (rma * (n - 1) + x) / n
        out.append(rma)
    return out


srcM = preco  # srcMA = "hl2" | "close"
srcS = preco  # srcSig = "hl2" | "close"
maH = (ta_ema if K["ma_tipo"] == "EMA" else ta_sma)([preco(v, K["src_ma"]) for v in velas], int(K["ma_len"]))
atrH = ta_rma(ta_tr(velas), int(K["atr_len"]))
mid = [preco(v, K["src_sinal"]) for v in velas]
pxT = [v["t"] for v in velas]

bandaAtr = num(K["banda_atr"])
zzAtr = num(K["zz_atr"])
usarBanda = bool(K["usar_banda"])
usarZZ = bool(K["usar_zz"])

sig, extremo, tVista, saida = 0, None, None, []
for i in range(len(velas)):
    m, ma, atr, t = mid[i], maH[i], atrH[i], pxT[i]
    pronta = m is not None and ma is not None and t is not None
    nova = pronta  # `barstate.isconfirmed` (a barra a formar fica de fora, a montante)
    sigAntes = sig
    banda = bandaAtr * atr if (usarBanda and atr is not None) else 0.0  # no Pine e' calculada em toda a barra
    if nova and ma is not None:
        tVista = t
        if sig == 1:
            extremo = m if extremo is None else max(extremo, m)
        elif sig == -1:
            extremo = m if extremo is None else min(extremo, m)
        recuoOk = True
        if usarZZ and extremo is not None and atr is not None and atr > 0 and sig != 0:
            recuo = extremo - m if sig == 1 else m - extremo
            recuoOk = recuo >= zzAtr * atr
        acima = m > ma + banda
        abaixo = m < ma - banda
        if sig != 1 and acima and (sig == 0 or recuoOk):
            sig, extremo = 1, m
        elif sig != -1 and abaixo and (sig == 0 or recuoOk):
            sig, extremo = -1, m
    saida.append({"t": t, "ma": ma, "atr": atr, "mid": m, "banda": banda,
                  "sig": sig, "extremo": extremo, "virada": sig if sig != sigAntes else 0})

json.dump(saida, open(sys.argv[3], "w", encoding="utf-8"))
print(f"pine (transcrito): {len(saida)} barras")
