#!/usr/bin/env python3
"""O estado do VENUE simulado — ordens e posicoes, como a corretora as guardaria.

Este ficheiro existe para uma coisa so: provar que a posse se le **do venue**, pela marca
(RN-T16.1). Nada aqui guarda a nocao de "nossa" ou "alheia": isso e o que a mesa DEDUZ, comparando
a marca que encontra com as marcas que ela propria sabe compor. Se a mesa perder a memoria (reinicio),
o que sobra e isto — e por isto que ela reencontra o que e seu.

O estado vive num ficheiro ignorado no git (`.estado-do-venue.json`), porque e estado, nao codigo.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ESTADO = AQUI / ".estado-do-venue.json"


def limpar() -> None:
    ESTADO.write_text(json.dumps({"ordens": [], "posicoes_alheias": []}, indent=2), encoding="utf-8")


def _ler() -> dict:
    if not ESTADO.exists():
        limpar()
    with ESTADO.open(encoding="utf-8") as ficheiro:
        return json.load(ficheiro)


def _escrever(estado: dict) -> None:
    ESTADO.write_text(json.dumps(estado, indent=2, ensure_ascii=False), encoding="utf-8")


def registrar_ordem(*, order_id: str, instrumento: str, lado: str, quantidade: str,
                    preco: str, marca_de_posse: int, forma_da_marca: str,
                    referencia_do_cliente: str) -> dict:
    """Guarda a ordem como o venue a guardaria: com a marca na forma que o manifesto declara."""
    ordem = {
        "order_id": order_id,
        "instrumento": instrumento,
        "lado": lado,
        "quantidade": quantidade,
        "preco": preco,
        "referencia_do_cliente": referencia_do_cliente,
        # A forma muda por venue; o CONTEUDO e sempre o mesmo inteiro de 31 bits.
        forma_da_marca: marca_de_posse,
        "marca_de_posse": marca_de_posse,
    }
    estado = _ler()
    estado["ordens"].append(ordem)
    _escrever(estado)
    return ordem


def por_referencia(referencia_do_cliente: str) -> dict | None:
    """A ordem que o venue ja tem com esta referencia — a base da idempotencia (RN-C4)."""
    for ordem in _ler()["ordens"]:
        if ordem["referencia_do_cliente"] == referencia_do_cliente:
            return ordem
    return None


def semear_posicao_alheia(*, instrumento: str, lado: str, quantidade: str, preco: str,
                          comentario: str = "ordem aberta a mao nesta conta") -> dict:
    """Uma posicao que NAO e da mesa: existe no venue e nao tem a marca dela."""
    posicao = {"instrumento": instrumento, "lado": lado, "quantidade": quantidade,
               "preco": preco, "comentario": comentario}
    estado = _ler()
    estado["posicoes_alheias"].append(posicao)
    _escrever(estado)
    return posicao


def _somadas(ordens: list[dict], instrumento: str) -> list[dict]:
    por_marca: dict[int, Decimal] = {}
    precos: dict[int, Decimal] = {}
    for ordem in ordens:
        if ordem["instrumento"] != instrumento:
            continue
        marca = ordem["marca_de_posse"]
        sinal = Decimal(1) if ordem["lado"] == "buy" else Decimal(-1)
        por_marca[marca] = por_marca.get(marca, Decimal(0)) + sinal * Decimal(ordem["quantidade"])
        precos[marca] = Decimal(ordem["preco"])
    return [
        {"marca_de_posse": marca, "unidades": str(unidades), "preco_medio": str(precos[marca]),
         "lado": "buy" if unidades > 0 else "sell"}
        for marca, unidades in sorted(por_marca.items())
        if unidades != 0
    ]


def ordens() -> list[dict]:
    """As ordens que o venue guarda, na forma dele. E a fonte do historico e das posicoes."""
    return _ler()["ordens"]


def posicoes(instrumento: str) -> dict:
    """O que o venue reporta para este instrumento: a posicao das ordens + as alheias."""
    estado = _ler()
    return {
        "nossas": _somadas(estado["ordens"], instrumento),
        "alheias": [p for p in estado["posicoes_alheias"] if p["instrumento"] == instrumento],
        "ordens": len(estado["ordens"]),
    }
