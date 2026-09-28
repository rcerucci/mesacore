#!/usr/bin/env python3
"""Ida e volta do dinheiro — SC-004: o valor devolvido e EXACTAMENTE o valor enviado.

    uv run python tools/verificar-contrato/py/ida_e_volta.py

Poe cada valor num campo de dinheiro de uma mensagem verdadeira, valida a mensagem contra o
contrato e VOLTA A LER o valor do texto. Compara cadeia com cadeia: se um unico digito mudar,
a ida e volta perdeu informacao e o contrato esta errado para dinheiro.

Este verificador USA o enquadramento do contrato (em vez de o reimplementar). A dependencia vai
no sentido /tools -> /contracts, que e a direccao permitida: o contrato nao sabe que este
ficheiro existe.
"""

# pyright: reportMissingImports=false

from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ / "contracts" / "esqueleto"))

from framing import validar, versao_vigente  # noqa: E402

VALORES = [
    "0",
    "0.00000001",
    "2",
    "0.5",
    "-2.34",
    "123456789.0123456789",
    "1000000000000.000000000000001",
    "-0.000000000000000001",
    "1.08542",
]


def main() -> int:
    perdas = 0
    for valor in VALORES:
        mensagem = {
            "contrato": versao_vigente(),
            "tipo": "mercado",
            "id": "ida-e-volta",
            "carga": {
                "instrumento": "EURUSD",
                "tempo_do_venue_ms": 1759000000000,
                "idade_do_dado_ms": 10,
                "estado": "aberto",
                "equity": valor,
            },
        }
        texto = json.dumps(mensagem, separators=(",", ":"), ensure_ascii=False)
        decisao = validar(texto)
        devolvido = json.loads(texto)["carga"]["equity"]
        if decisao["veredicto"] != "aceite":
            perdas += 1
            print(f"RECUSADO {valor!r}: {decisao['motivo']}")
        elif devolvido != valor:
            perdas += 1
            print(f"PERDA    {valor!r} voltou como {devolvido!r}")
        else:
            print(f"ok       {valor} -> {devolvido}")

    print(f"ida e volta: {len(VALORES) - perdas}/{len(VALORES)} valores sem perda")
    return 0 if perdas == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
