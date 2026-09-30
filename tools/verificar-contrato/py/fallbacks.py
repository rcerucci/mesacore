#!/usr/bin/env python3
"""Fallbacks no produto: um `?? "x"`, um `|| []`, um `?? 0` — um valor LITERAL escrito no codigo a tapar um
campo em falta. O dono foi taxativo: nenhum pode existir em nenhum plugin nem na mesa, porque um fallback nao
falha — decide. Foi um `["BTC"]` por omissao que fez uma conta que dizia SOL operar BTC uma noite inteira.

Este conferidor e' uma CATRACA: compara com a linha de base (`fallbacks-baseline.json`) e REPROVA se algum
ficheiro tiver mais sitios do que tinha. Assim o numero so' pode descer, e um fallback novo nao entra.

Uso:  uv run python tools/verificar-contrato/py/fallbacks.py [--actualizar-baseline]
"""
import collections, json, os, re, sys

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ALVOS = ["core", "vigia", "brokers", "setups"]
BASELINE = os.path.join(RAIZ, "tools", "verificar-contrato", "fallbacks-baseline.json")

LITERAL = r'(?:"[^"]*"|\'[^\']*\'|\[[^\]]*\]|\{[^}]*\}|-?\d+(?:\.\d+)?|true|false)'
PADROES = [re.compile(r"\?\?\s*" + LITERAL), re.compile(r"\|\|\s*" + LITERAL)]
IGNORAR = re.compile(r"\.prova\.ts$|\.casos\.|casos\.json|node_modules|mocks/|fixtures\.ts$|\.test\.")

def contar():
    por_ficheiro = collections.Counter()
    sitios = []
    for alvo in ALVOS:
        for raiz, _, ficheiros in os.walk(os.path.join(RAIZ, alvo)):
            if "node_modules" in raiz:
                continue
            for f in ficheiros:
                if not f.endswith((".ts", ".py", ".sh")):
                    continue
                caminho = os.path.join(raiz, f)
                rel = os.path.relpath(caminho, RAIZ)
                if IGNORAR.search(rel):
                    continue
                for i, linha in enumerate(open(caminho, encoding="utf-8", errors="replace"), 1):
                    codigo = linha.split("//")[0]
                    if any(p.search(codigo) for p in PADROES):
                        por_ficheiro[rel] += 1
                        sitios.append(f"{rel}:{i}  {linha.strip()[:110]}")
    return por_ficheiro, sitios

por_ficheiro, sitios = contar()
total = sum(por_ficheiro.values())
print(f"fallbacks no produto: {total} sitios em {len(por_ficheiro)} ficheiros")

if "--actualizar-baseline" in sys.argv:
    json.dump(dict(sorted(por_ficheiro.items())), open(BASELINE, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"linha de base actualizada: {BASELINE}")
    sys.exit(0)

base = json.load(open(BASELINE, encoding="utf-8")) if os.path.exists(BASELINE) else {}
pioraram = [(f, n, base.get(f, 0)) for f, n in sorted(por_ficheiro.items()) if n > base.get(f, 0)]
if pioraram:
    print("REPROVA — fallbacks NOVOS (a catraca so' deixa descer):")
    for f, n, b in pioraram:
        print(f"   {f}: {n} (tinha {b})")
    sys.exit(1)

recuperados = sum(base.get(f, 0) - n for f, n in por_ficheiro.items() if n < base.get(f, 0))
print(f"ok    nenhum fallback novo (a linha de base e' de {sum(base.values())}; ja' desceram {recuperados})")
print(f"      sitios que faltam limpar: {total}")
