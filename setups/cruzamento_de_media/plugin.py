#!/usr/bin/env python3
# O MESMO setup, em Python — a prova de que a lingua do plugin nao interessa a ninguem deste lado.
# Le a mesma leitura (stdin), as mesmas velas (JSONL) e emite a mesma `proposta`. Para o operador, o que muda e'
# uma linha no `setup.json`: `comando` e `linguagem`.
import json, os, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
manifesto = json.loads((Path(__file__).resolve().parent / "setup.json").read_text())
ficha = json.loads(os.environ.get("FICHA_DO_PAR", "{}"))
rapida_n = int(ficha.get("parametros_rapida", ficha.get("parametros.rapida", 5)))
lenta_n = int(ficha.get("parametros_lenta", ficha.get("parametros.lenta", 20)))
janela = ficha.get("janela", "1h")

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

pasta = os.environ.get("PASTA_DE_MERCADO", "")
velas = []
if pasta:
    base = Path(pasta) if os.path.isabs(pasta) else RAIZ / pasta
    caminho = base / f"velas-{os.environ.get('INSTRUMENTO','BTC')}-{janela}.jsonl"
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
