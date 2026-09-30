#!/usr/bin/env python3
# O MESMO setup, em Python — a prova de que a lingua do plugin nao interessa a ninguem deste lado.
# Le a mesma leitura (stdin), as mesmas velas (JSONL) e emite a mesma `proposta`. Para o operador, o que muda e'
# uma linha no `setup.json`: `comando` e `linguagem`.
import json, os, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
manifesto = json.loads((Path(__file__).resolve().parent / "setup.json").read_text())
# A VERSAO DO CONTRATO LE-SE, NAO SE ESCREVE AQUI. Estava `"1.9.0"` escrito a mao: passou uma emenda e este
# exemplo — que e' MOLDE para o proximo setup — passava a emitir propostas que o contrato recusa.
VIGENTE = json.loads((RAIZ / "contracts" / "versao.json").read_text())["contrato"]
# A BARRA DO SINAL (contrato 1.8.0, obrigatoria): a ultima barra FECHADA do relogio da ficha. A que ainda esta'
# a formar nao conta — decidir sobre ela e' decidir sobre um preco que ainda pode mudar.
MS_DO_RELOGIO = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
                 "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000}
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

# Sem barra nao ha proposta (a `barra_ms` e' obrigatoria): o diagnostico vai para o stderr e o stdout fica vazio.
if leitura is None or leitura.get("estado") != "aberto" or not velas:
    print(json.dumps({"setup": manifesto["nome"], "diagnostico": "sem leitura aberta ou sem velas: nao ha barra, e sem barra nao se propoe"}), file=sys.stderr)
    sys.exit(0)
passo = MS_DO_RELOGIO.get(janela)
if passo is None:
    print(json.dumps({"setup": manifesto["nome"], "diagnostico": f"o relogio {janela} nao me e' conhecido"}), file=sys.stderr)
    sys.exit(0)
agora_ms = int(leitura.get("tempo_do_venue_ms", 0))
fechadas = [v for v in velas if int(v["t"]) + passo <= agora_ms]
if not fechadas or len(fechadas) < lenta_n:
    print(json.dumps({"setup": manifesto["nome"], "diagnostico": f"barras fechadas: {len(fechadas)} (a media lenta pede {lenta_n})"}), file=sys.stderr)
    sys.exit(0)

fechos = [float(v["c"]) for v in fechadas]
media = lambda n: sum(fechos[-n:]) / n
r, l = media(rapida_n), media(lenta_n)
lado = "buy" if r > l else "sell" if r < l else "hold"

print(json.dumps({"contrato": VIGENTE, "tipo": "proposta", "id": f"cruzamento-py-{int(__import__('time').time()*1000)}",
                  "carga": {"setup": {"nome": manifesto["nome"], "versao": manifesto["versao"]}, "lado": lado,
                            "barra_ms": int(fechadas[-1]["t"])}}))
