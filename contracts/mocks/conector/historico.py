#!/usr/bin/env python3
"""O historico como o VENUE o conta (RN-C11, RN-D6).

    uv run python mocks/conector/historico.py --instrumento EURUSD

O que este ficheiro prova, e e a razao de existir:

  - a taxa de cada execucao e o funding vao em campos PROPRIOS, como o venue os cobra;
  - NAO ha campo de resultado por execucao: somar e do venue, nunca da mesa. Uma mesa que somasse
    taxas e funding para "conferir" o resultado estaria a reescrever a conta da corretora;
  - `resultado_realizado` e o numero do venue, lido de conta.json — e o fim do ficheiro mostra,
    medido, que a soma de taxas e funding NAO da esse numero. Nao e que a mesa nao saiba somar:
    e que a conta da corretora nao e a soma das parcelas que ela reporta.
"""

from __future__ import annotations

import json
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import venue

AQUI = Path(__file__).resolve().parent


def quantizar(valor: Decimal, passo: str) -> str:
    return str(valor.quantize(Decimal(passo), rounding=ROUND_HALF_UP))


def argumento(nome: str) -> str | None:
    if nome in sys.argv:
        indice = sys.argv.index(nome)
        if indice + 1 < len(sys.argv):
            return sys.argv[indice + 1]
    return None


def main() -> int:
    conta = json.loads((AQUI / "conta.json").read_text(encoding="utf-8"))
    manifesto = json.loads((AQUI / "manifesto.json").read_text(encoding="utf-8"))["carga"]
    instrumento = argumento("--instrumento") or "EURUSD"
    instante = int(argumento("--instante-ms") or 1759000000000)
    regra = conta["taxas_do_venue"]

    execucoes = []
    for ordem in venue.ordens():
        if ordem["instrumento"] != instrumento:
            continue
        quantidade = Decimal(ordem["quantidade"])
        preco = Decimal(ordem["preco"])
        execucao = {
            "referencia_do_cliente": ordem["referencia_do_cliente"],
            "marca_de_posse": ordem["marca_de_posse"],
            "instante_ms": instante,
            "lado": ordem["lado"],
            "quantidade": str(quantidade),
            "preco": str(preco),
            # A taxa e do venue: calculada pela regra DELE, num campo so dela.
            "taxa": quantizar(quantidade * preco * Decimal(regra["por_execucao_pct"]) / 100, "0.01"),
        }
        if manifesto["funding"]:
            execucao["funding"] = regra["funding_por_execucao"]
        execucoes.append(execucao)

    if not execucoes:
        # Sem execucoes nao ha historico: o schema exige minItems 1, e inventar uma linha vazia
        # seria pior do que nao emitir nada.
        print("historico: nenhuma execucao no venue para este instrumento (nada a emitir)", file=sys.stderr)
        return 1

    carga = {
        "instrumento": instrumento,
        "moeda": conta["moeda"],
        "instante_ms": instante,
        "resultado_realizado": conta["resultado_realizado"][instrumento],
        "execucoes": execucoes,
    }
    envelope = {"contrato": "1.3.0", "tipo": "historico", "id": f"historico-{instrumento}", "carga": carga}
    print(json.dumps(envelope, separators=(",", ":"), ensure_ascii=False))

    # Medido, para o relatorio: a soma das parcelas NAO da o numero do venue.
    somadas = sum(Decimal(e["taxa"]) + Decimal(e.get("funding", "0")) for e in execucoes)
    do_venue = Decimal(carga["resultado_realizado"])
    print(
        f"parcelas reportadas: {somadas} · resultado do venue: {do_venue} · "
        f"{'diferem' if somadas != do_venue else 'coincidem'} "
        f"(por isso o resultado nao se reconstroi)",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
