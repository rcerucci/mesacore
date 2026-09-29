"""Injecta um defeito REAL no manifesto, para a prova negativa o ter de apanhar.

O defeito nao e aleatorio: e exactamente o que a regra proibe — uma capacidade que passa a valer
`true` por omissao (fail-closed trocado por fail-open). Se o fragmento ja nao existir, o script
sai com erro em vez de escrever outra coisa qualquer.
"""
import sys
p = sys.argv[1]
t = open(p).read()
alvo = "sonda.marca_liga_ordem_a_posicao],"
if alvo not in t:
    raise SystemExit("o fragmento da prova mudou: a prova tem de ser revista")
open(p, "w").write(t.replace(alvo, "sonda.marca_liga_ordem_a_posicao ?? true],", 1))
