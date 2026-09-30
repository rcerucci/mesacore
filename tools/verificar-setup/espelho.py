#!/usr/bin/env python3
"""O espelho do motor do Pine, em Python — escrito DE NOVO, sem importar o TypeScript.

E' a unica forma honesta de conferir uma traducao: duas implementacoes independentes da mesma regra, barra a
barra. Se as duas concordarem em 500 barras, o que se provou foi a REGRA; se discordarem, uma das duas tem um
erro que nenhum teste de "bateu" apanharia.

Uso: espelho.py <velas.jsonl> <constantes.json> <saida.json>
"""
import json, sys
from decimal import Decimal

velas = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
K = json.load(open(sys.argv[2], encoding="utf-8"))

def num(x): return float(x)
def hl2(v): return (num(v["h"]) + num(v["l"])) / 2.0
def preco(v, qual): return hl2(v) if qual == "hl2" else num(v["c"])

def serie_media(valores, n, tipo, semente):
    if tipo == "SMA":
        out, soma = [], 0.0
        for i, x in enumerate(valores):
            soma += x
            if i >= n: soma -= valores[i - n]
            out.append(soma / n if i + 1 >= n else None)
        return out
    alpha = 2.0 / (n + 1)
    out, ema, soma = [], None, 0.0
    for i, x in enumerate(valores):
        if ema is None:
            if semente == "recursiva":
                ema = x
            else:
                soma += x
                if i + 1 < n:
                    out.append(None); continue
                ema = soma / n; out.append(ema); continue
        else:
            ema = alpha * x + (1 - alpha) * ema
        out.append(ema)
    return out

def serie_atr(velas, n):
    trs = []
    for i, v in enumerate(velas):
        if i == 0: trs.append(num(v["h"]) - num(v["l"])); continue
        fc = num(velas[i-1]["c"])
        trs.append(max(num(v["h"]) - num(v["l"]), abs(num(v["h"]) - fc), abs(num(v["l"]) - fc)))
    out, rma, soma = [], None, 0.0
    for i, tr in enumerate(trs):
        if i < n:
            soma += tr
            if i + 1 == n: rma = soma / n; out.append(rma)
            else: out.append(None)
            continue
        rma = (rma * (n - 1) + tr) / n
        out.append(rma)
    return out

semente = K.get("semente_da_ema", "recursiva")
mid = [preco(v, K["src_sinal"]) for v in velas]
ma = serie_media([preco(v, K["src_ma"]) for v in velas], int(K["ma_len"]), K["ma_tipo"], semente)
atr = serie_atr(velas, int(K["atr_len"]))
banda_atr, zz_atr = num(K["banda_atr"]), num(K["zz_atr"])

sig, extremo, saida = 0, None, []
for i, v in enumerate(velas):
    m, a = mid[i], atr[i]
    banda = banda_atr * a if (K["usar_banda"] and a is not None) else 0.0
    antes = sig
    if ma[i] is not None and a is not None:
        if sig == 1: extremo = m if extremo is None else max(extremo, m)
        elif sig == -1: extremo = m if extremo is None else min(extremo, m)
        recuo_ok = True
        if K["usar_zz"] and extremo is not None and a > 0 and sig != 0:
            recuo_ok = (extremo - m) >= zz_atr * a if sig == 1 else (m - extremo) >= zz_atr * a
        acima, abaixo = m > ma[i] + banda, m < ma[i] - banda
        if sig != 1 and acima and (sig == 0 or recuo_ok): sig, extremo = 1, m
        elif sig != -1 and abaixo and (sig == 0 or recuo_ok): sig, extremo = -1, m
    saida.append({"t": v["t"], "ma": ma[i], "atr": a, "mid": m, "sig": sig, "virada": sig if sig != antes else 0})
json.dump(saida, open(sys.argv[3], "w", encoding="utf-8"))
print(f"espelho: {len(saida)} barras · semente {semente}")
