#!/usr/bin/env python3
"""Compara dois relatorios de bateria, caso a caso (SC-002).

    tools/verificar-contrato/comparar.py relatorio-ts.jsonl relatorio-py.jsonl

Compara SO o que o contrato decide: `veredicto` e `motivo`, por `caso`. O campo
`implementacao` e o `esperado_ok` NAO entram na comparacao — sao do instrumento, nao do
contrato.

Saida 0 = nenhuma divergencia. Saida 1 = divergencias, listadas com o caso e os dois lados.
Uma divergencia NAO e "diferenca de implementacao": e o contrato a admitir duas leituras, e
corrige-se o schema.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

CHAVE = ("veredicto", "motivo")


def ler(caminho: str) -> dict[str, dict]:
    casos: dict[str, dict] = {}
    for numero, linha in enumerate(Path(caminho).read_text(encoding="utf-8").splitlines(), start=1):
        if not linha.strip():
            continue
        registo = json.loads(linha)
        nome = registo["caso"]
        if nome in casos:
            raise SystemExit(f"{caminho}:{numero}: caso repetido no relatorio: {nome}")
        casos[nome] = {chave: registo.get(chave) for chave in CHAVE}
    return casos


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print((__doc__ or "").strip(), file=sys.stderr)
        return 2

    esquerda, direita = ler(argv[1]), ler(argv[2])
    so_esquerda = sorted(set(esquerda) - set(direita))
    so_direita = sorted(set(direita) - set(esquerda))
    divergentes = []

    for nome in sorted(set(esquerda) & set(direita)):
        if esquerda[nome] != direita[nome]:
            divergentes.append((nome, esquerda[nome], direita[nome]))

    if so_esquerda:
        print(f"casos so no primeiro relatorio ({len(so_esquerda)}): {', '.join(so_esquerda)}")
    if so_direita:
        print(f"casos so no segundo relatorio ({len(so_direita)}): {', '.join(so_direita)}")

    for nome, um, outro in divergentes:
        print(f"DIVERGE {nome}: {argv[1]}={um} | {argv[2]}={outro}")

    comparados = len(set(esquerda) & set(direita))
    if divergentes or so_esquerda or so_direita:
        print(f"{len(divergentes)} divergencias em {comparados} casos comparados")
        return 1

    print(f"0 divergencias · {comparados} casos comparados · as duas implementacoes decidem igual")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
