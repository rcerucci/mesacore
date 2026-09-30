#!/usr/bin/env python3
"""A VARREDURA DO PINE — a tradução do indicador é fiel em TODAS as combinações de `input`, ou só nas omissões?

Corre o motor (`setups/sigma/sinal.ts`, pela boca de `imprimir-todos.ts`) e a transcrição do indicador
(`pine-sigma.py`) sobre as MESMAS barras, para cada combinação de `input` do Pine, e conta as barras em que
discordam no `ma`, `atr`, `sig` e `virada`.

Porque é que isto existe: uma tradução pode bater certo nas omissões e divergir numa opção que ninguém correu
até ao dia em que a ficha a muda. As barras do arranque (as primeiras `atr_len - 1`, onde o ATR do Pine é `na`)
são o sítio onde isso aconteceu de verdade.

Uso: varredura-pine.py [barras/*.jsonl ...]      (por omissão, todas as de `tools/verificar-setup/barras/`)
"""
import itertools
import json
import os
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PASTA = os.path.join(RAIZ, "tools", "verificar-setup")


def combos():
    """O espaço dos `input` do indicador: as escolhas (2×2×2×2×2) mais dois extremos de comprimento."""
    comuns = ["ma_len", "ma_tipo", "src_ma", "src_sinal", "usar_banda", "banda_atr", "usar_zz", "zz_atr", "atr_len"]
    lista = []
    for tipo, srcma, srcsig, banda, zz in itertools.product(
        ["EMA", "SMA"], ["hl2", "close"], ["hl2", "close"], [True, False], [True, False]
    ):
        lista.append({"ma_len": 24, "ma_tipo": tipo, "src_ma": srcma, "src_sinal": srcsig, "usar_banda": banda,
                      "banda_atr": "0.25", "usar_zz": zz, "zz_atr": "2.0", "atr_len": 14})
    lista.append({"ma_len": 50, "ma_tipo": "EMA", "src_ma": "close", "src_sinal": "close", "usar_banda": True,
                  "banda_atr": "0.5", "usar_zz": True, "zz_atr": "1.0", "atr_len": 7})
    lista.append({"ma_len": 7, "ma_tipo": "SMA", "src_ma": "hl2", "src_sinal": "hl2", "usar_banda": False,
                  "banda_atr": "0", "usar_zz": False, "zz_atr": "3.0", "atr_len": 21})
    return [{k: c[k] for k in comuns} for c in lista]


def perto(a, b, tol=1e-9):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol * max(1.0, abs(a))


def serie_do_pine(velas_path, k, tmp):
    """Roda a transcrição do Pine como processo (ela lê ficheiros), e devolve a série."""
    saida = os.path.join(tmp, "pine.json")
    subprocess.run([sys.executable, os.path.join(PASTA, "pine-sigma.py"), velas_path,
                    _escrever(k, tmp, "k.json"), saida], check=True, capture_output=True)
    return json.load(open(saida, encoding="utf-8"))


def _escrever(obj, tmp, nome):
    caminho = os.path.join(tmp, nome)
    json.dump(obj, open(caminho, "w", encoding="utf-8"))
    return caminho


def main():
    import tempfile

    argumentos = sys.argv[1:]
    if argumentos:
        series = argumentos
    else:
        pasta = os.path.join(PASTA, "barras")
        series = sorted(os.path.join(pasta, f) for f in os.listdir(pasta) if f.endswith(".jsonl"))
    if not series:
        print("varredura: nao ha barras para confrontar")
        return 1

    lista = combos()
    total_div, corridas_ok, corridas = 0, 0, 0
    with tempfile.TemporaryDirectory() as tmp:
        for velas in series:
            motor_todo = json.load(open(_motor(velas, lista, tmp), encoding="utf-8"))
            for i, k in enumerate(lista):
                pine = serie_do_pine(velas, k, tmp)
                motor = motor_todo[i]
                div = {c: sum(1 for j in range(len(motor)) if not perto(motor[j][c], pine[j][c]))
                       for c in ("ma", "atr", "sig", "virada")}
                soma = sum(div.values())
                total_div += soma
                corridas += 1
                corridas_ok += 1 if soma == 0 else 0
                etiqueta = (f"{os.path.basename(velas)} · {k['ma_tipo']}/{k['src_ma']}/{k['src_sinal']} · "
                            f"banda={'sim' if k['usar_banda'] else 'nao'}({k['banda_atr']}) · "
                            f"zz={'sim' if k['usar_zz'] else 'nao'}({k['zz_atr']}) · ma={k['ma_len']} atr={k['atr_len']}")
                if soma == 0:
                    print(f"ok    {etiqueta}")
                else:
                    print(f"DIVERGE {etiqueta} -> {div}")

    print(f"\nvarredura: {corridas} corridas · {corridas_ok} sem divergencia · {total_div} barras divergentes")
    return 1 if total_div else 0


def _motor(velas, lista, tmp):
    saida = os.path.join(tmp, "motor.json")
    subprocess.run(["bun", "run", os.path.join(PASTA, "imprimir-todos.ts"), velas,
                    _escrever(lista, tmp, "combos.json"), saida], check=True, capture_output=True, cwd=RAIZ)
    return saida


if __name__ == "__main__":
    sys.exit(main())
