#!/usr/bin/env python3
"""Le as posicoes DO VENUE e diz de quem sao — a prova do reinicio (SC-006).

    uv run python mocks/conector/posicoes.py --instrumento EURUSD
    uv run python mocks/conector/posicoes.py --reiniciar          # simula o reinicio da mesa
    uv run python mocks/conector/posicoes.py --semear-alheia      # poe la uma posicao que nao e nossa

O que este ficheiro NAO faz, de proposito:

  - nao guarda nenhuma lista de posicoes "nossas". A mesa nao tem base de dados de posse; se
    tivesse, o reinicio seria o teste de uma copia, nao o teste da corretora.
  - nao decide nada sobre a posicao alheia. Ela e RELATADA e nao gerida: nenhuma ordem de fecho
    sai por iniciativa da mesa (SC-006).

A posse deduz-se comparando a marca que o venue tem com as marcas que a mesa sabe compor. A
marca viaja como inteiro de 31 bits, na forma que o manifesto declara (`comment`, `magic`,
`clientOrderId` ou `cloid`).
"""

from __future__ import annotations

import json
import sys

import venue

FORMAS = {"cloid", "clientOrderId", "magic", "comment"}


def argumento(nome: str) -> str | None:
    if nome in sys.argv:
        indice = sys.argv.index(nome)
        if indice + 1 < len(sys.argv):
            return sys.argv[indice + 1]
    return None


def marcas_da_mesa() -> set[int]:
    """As marcas que a mesa sabe compor: ficha x ciclo, com o layout declarado no vocabulario.

    Aqui a mesa e simulada por um conjunto de marcas passadas com --marca (uma por cada ficha
    viva). O que importa e a PROPRIEDADE: a posse e um calculo local sobre uma marca lida do
    venue, nao um registo guardado.
    """
    marcas: set[int] = set()
    for i, valor in enumerate(sys.argv):
        if valor == "--marca" and i + 1 < len(sys.argv):
            marcas.add(int(sys.argv[i + 1]))
    return marcas


def main() -> int:
    instrumento = argumento("--instrumento") or "EURUSD"
    manifesto = json.loads((venue.AQUI / "manifesto.json").read_text(encoding="utf-8"))["carga"]
    forma = manifesto["marca_de_posse"]

    if "--semear-alheia" in sys.argv:
        posicao = venue.semear_posicao_alheia(
            instrumento=instrumento, lado="sell", quantidade="0.07", preco="1.09000"
        )
        print(f"alheia semeada: {json.dumps(posicao, ensure_ascii=False)}")
        return 0

    relatorio = venue.posicoes(instrumento)
    nossas = marcas_da_mesa()

    if "--reiniciar" in sys.argv:
        # O reinicio da mesa nao apaga nada do venue: e o contrario — e do venue que se volta a ler.
        print("reinicio: nenhum estado da mesa guardado (nao ha base de dados de posse)")

    if forma not in FORMAS:
        # O manifesto declarou 'nenhuma': a mesa nao tem onde escrever a marca, e tem de o DIZER
        # em vez de fingir posse (FR-027).
        print(f"marca_de_posse declarada como '{forma}': a posse NAO e verificavel pelo venue")
        return 0

    for posicao in relatorio["nossas"]:
        marca = posicao["marca_de_posse"]
        nossa = marca in nossas
        print(json.dumps({
            "instrumento": instrumento,
            "marca_de_posse": marca,
            "posse": "nossa" if nossa else "alheia",
            "gerida": nossa,
            "unidades": posicao["unidades"],
            "forma_da_marca": forma,
        }, separators=(",", ":"), ensure_ascii=False))

    for posicao in relatorio["alheias"]:
        print(json.dumps({
            "instrumento": instrumento,
            "marca_de_posse": None,
            "posse": "alheia",
            "gerida": False,
            "unidades": posicao["quantidade"],
            "motivo": "sem a marca da mesa (RN-T16.1)",
        }, separators=(",", ":"), ensure_ascii=False))

    total_nossas = sum(1 for p in relatorio["nossas"] if p["marca_de_posse"] in nossas)
    nao_geridas = len(relatorio["nossas"]) - total_nossas + len(relatorio["alheias"])
    print(f"posicoes: {total_nossas} nossas · {nao_geridas} nao geridas · {relatorio['ordens']} ordens no venue",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
