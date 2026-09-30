#!/usr/bin/env python3
# O MESMO setup, em Python — a prova de que a lingua do plugin nao interessa a ninguem deste lado.
# Le a mesma leitura (stdin), as mesmas velas (JSONL) e emite a mesma `proposta`. Para o operador, o que muda e'
# uma linha no `setup.json`: `comando` e `linguagem`.
import json, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
manifesto = json.loads((Path(__file__).resolve().parent / "setup.json").read_text())
rapida_n = manifesto.get("parametros", {}).get("rapida", 5)
lenta_n = manifesto.get("parametros", {}).get("lenta", 20)

leitura = None
for linha in sys.stdin.read().split("\n"):
    if not linha.strip():
        continue
    try:
        o = json.loads(linha)
        if o.get("tipo") == "mercado":
            leitura = o["carga"]
    except json.JSONDecodeError:
        pass

mercado = manifesto.get("mercado")
velas = []
if mercado:
    caminho = RAIZ / mercado["pasta"] / mercado["ficheiro"]
    if caminho.exists():
        velas = [json.loads(l) for l in caminho.read_text().split("\n") if l.strip()]

lado = "hold"
if leitura and leitura.get("estado") == "aberto" and velas and len(velas) >= lenta_n:
    fechos = [float(v["c"]) for v in velas]
    media = lambda n: sum(fechos[-n:]) / n
    r, l = media(rapida_n), media(lenta_n)
    lado = "buy" if r > l else "sell" if r < l else "hold"

print(json.dumps({"contrato": "1.7.0", "tipo": "proposta", "id": f"cruzamento-py-{int(__import__('time').time()*1000)}",
                  "carga": {"setup": {"nome": manifesto["nome"], "versao": manifesto["versao"]}, "lado": lado}}))
