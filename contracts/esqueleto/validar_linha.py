#!/usr/bin/env python3
"""Valida mensagens que chegam pelo stdin, uma por linha, e diz o que decidiu.

    echo '<mensagem>' | uv run python esqueleto/validar_linha.py

Uma linha de saida por mensagem: `aceite` ou `recusado` com o motivo normalizado. E o jeito
de testar o contrato a mao, sem corretora e sem nada instalado alem do Python.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from framing import validar  # noqa: E402


def main() -> int:
    linhas = 0
    recusadas = 0
    for linha in sys.stdin:
        if linha.strip() == "":
            continue
        linhas += 1
        decisao = validar(linha)
        if decisao["veredicto"] != "aceite":
            recusadas += 1
        print(json.dumps({"veredicto": decisao["veredicto"], "motivo": decisao["motivo"]},
                         separators=(",", ":"), ensure_ascii=False))
    if linhas == 0:
        print("nenhuma mensagem na entrada", file=sys.stderr)
        return 2
    print(f"{linhas} mensagens · {linhas - recusadas} aceites · {recusadas} recusadas", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
