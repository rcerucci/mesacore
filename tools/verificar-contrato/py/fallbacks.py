#!/usr/bin/env python3
"""Fallbacks no produto: um `?? "x"`, um `|| []`, um `?? 0` — um valor LITERAL escrito no codigo a tapar um
campo em falta. O dono foi taxativo: nenhum pode existir em nenhum plugin nem na mesa, porque um fallback nao
falha — decide. Foi um `["BTC"]` por omissao que fez uma conta que dizia SOL operar BTC uma noite inteira.

Este conferidor e' uma CATRACA: compara com a linha de base (`fallbacks-baseline.json`) e REPROVA se algum
ficheiro tiver mais sitios do que tinha. Assim o numero so' pode descer, e um fallback novo nao entra.

O QUE CONTA, E O QUE NAO CONTA. Conta o que esta' no CODIGO. Um `?? "x"` escrito dentro de um comentario — de
linha (`//`) ou de bloco (`/** ... */`) — nao e' fallback nenhum: e' prosa, e prosa que EXPLICA o fallback
retirado aparecia aqui como se ele ainda estivesse la'. Medido a 30/09/2026: das 167 ocorrencias que este
conferidor contava, **11 eram comentario** (`core/ciclo/ciclo.ts:89`, `setups/sigma/plugin.ts:34`, ...) — e as
duas do `setups/sigma/plugin.ts` que o dono viu eram exactamente isso: a prosa que dizia o que tinha sido
retirado. Por isso o conferidor passa a LER o codigo a serio (sabe onde começa e acaba um comentario de bloco e
uma string), em vez de cortar a linha no primeiro `//` — que tambem partia um `"https://..."` ao meio.

Uso:  uv run python tools/verificar-contrato/py/fallbacks.py [--listar|--actualizar-baseline|--exigir-zero]
      --listar              imprime cada sitio (ficheiro:linha + o codigo, sem comentarios)
      --actualizar-baseline  regrava a linha de base com o que existe agora
      --exigir-zero          REPROVA se existir um unico sitio (e' o modo do fim: zero e' zero)
"""
import collections, json, os, re, sys

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ALVOS = ["core", "vigia", "brokers", "setups"]
BASELINE = os.path.join(RAIZ, "tools", "verificar-contrato", "fallbacks-baseline.json")

LITERAL = r'(?:"[^"]*"|\'[^\']*\'|\[[^\]]*\]|\{[^}]*\}|-?\d+(?:\.\d+)?|true|false)'
PADROES = [re.compile(r"\?\?\s*" + LITERAL), re.compile(r"\|\|\s*" + LITERAL)]
IGNORAR = re.compile(r"\.prova\.ts$|\.casos\.|casos\.json|node_modules|mocks/|fixtures\.ts$|\.test\.")


def sem_comentarios(linhas):
    """As linhas do ficheiro com todo o comentario (de linha e de BLOCO) fora, e as strings intactas.

    A string fica: e' dentro dela que vive o literal do fallback (`?? "sem_pedido"`). O que sai e' o
    comentario, incluindo o de bloco, que atravessa linhas — era por ele que a prosa do `plugin.ts` contava.
    """
    saida = []
    em_bloco = False
    for linha in linhas:
        pedacos = []
        i = 0
        while i < len(linha):
            c = linha[i]
            if em_bloco:
                if linha.startswith("*/", i):
                    em_bloco = False
                    i += 2
                    continue
                i += 1
                continue
            if linha.startswith("//", i):
                break
            if linha.startswith("/*", i):
                em_bloco = True
                i += 2
                continue
            if c in "\"'`":
                pedacos.append(c)
                i += 1
                while i < len(linha):
                    if linha[i] == "\\":
                        pedacos.append(linha[i:i + 2])
                        i += 2
                        continue
                    pedacos.append(linha[i])
                    if linha[i] == c:
                        i += 1
                        break
                    i += 1
                continue
            pedacos.append(c)
            i += 1
        saida.append("".join(pedacos))
    return saida


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
                linhas = open(caminho, encoding="utf-8", errors="replace").read().split("\n")
                for i, codigo in enumerate(sem_comentarios(linhas), 1):
                    if any(p.search(codigo) for p in PADROES):
                        por_ficheiro[rel] += 1
                        sitios.append(f"{rel}:{i}  {codigo.strip()[:110]}")
    return por_ficheiro, sitios


por_ficheiro, sitios = contar()
total = sum(por_ficheiro.values())
print(f"fallbacks no produto: {total} sitios em {len(por_ficheiro)} ficheiros")

if "--listar" in sys.argv:
    # A LISTA, e nao so' o numero. Sem isto, limpar fallbacks e' as cegas: o conferidor diz que faltam 167 e
    # nao diz quais. `--listar` imprime cada sitio (ficheiro:linha) para que a limpeza seja um trabalho com
    # principio e fim contaveis, e nao uma caca ao texto.
    for sitio in sitios:
        print(sitio)
    sys.exit(0)

if "--actualizar-baseline" in sys.argv:
    json.dump(dict(sorted(por_ficheiro.items())), open(BASELINE, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"linha de base actualizada: {BASELINE}")
    sys.exit(0)

if "--exigir-zero" in sys.argv:
    # O FIM DA CATRACA. A catraca so' deixa descer; este modo e' o que ela descia PARA: zero. Sem ele, um
    # `0 sitios` poderia conviver com um sitio novo num ficheiro que ja' tinha 3 — a catraca e' por ficheiro.
    if total > 0:
        print("REPROVA — o produto TEM fallbacks (o alvo e' zero):")
        for sitio in sitios:
            print(f"   {sitio}")
        sys.exit(1)
    print("ok    zero fallbacks no produto (todos os ficheiros a zero)")
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
