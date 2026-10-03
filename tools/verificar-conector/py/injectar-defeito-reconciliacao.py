"""Injecta o defeito REAL da reconciliacao antes do envio (D-009), para a prova negativa o ter de apanhar.

O defeito nao e aleatorio: e exactamente o que a RN-C4 proibe — o conector le' o registo de ordens da conta e
deixa de ENCONTRAR a ordem que la' esta'. Com isso, uma referencia repetida volta a produzir uma SEGUNDA ordem,
que e' o que a P6 da bateria de teste mediu (a posicao dobrou). Se o fragmento ja nao existir, o script sai com
erro em vez de escrever outra coisa qualquer.
"""
import sys

p = sys.argv[1]
t = open(p, encoding="utf-8").read()
alvo = "  if (!Array.isArray(ordens)) return null;"
if alvo not in t:
    raise SystemExit("o fragmento da prova mudou: a prova tem de ser revista")
open(p, "w", encoding="utf-8").write(
    t.replace(alvo, "  if (true) return null; // DEFEITO INJECTADO (D-009): a leitura deixa de encontrar a ordem", 1)
)
