"""Corre a bateria de casos contra o contrato — lado Python.

    uv run python esqueleto/casos.py
    uv run python esqueleto/casos.py --relatorio r.jsonl --casos boleta,marca

Mesmo contrato de linha de comando, mesma linha de relatorio, mesma saida (0 = tudo como
esperado). E de proposito: SC-002 compara os dois relatorios caso a caso.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from framing import RAIZ, validar, versao_vigente

FALTANTE = re.compile(r"'([^']+)' is a required property")


def argumento(nome: str) -> str | None:
    if nome in sys.argv:
        indice = sys.argv.index(nome)
        if indice + 1 < len(sys.argv):
            return sys.argv[indice + 1]
    return None


def main() -> int:
    pasta = RAIZ / "casos"
    pedidos = argumento("--casos")
    filtro = {p.strip() for p in pedidos.split(",")} if pedidos else None

    ficheiros = sorted(
        caminho
        for caminho in pasta.glob("*.casos.json")
        if filtro is None or caminho.name.replace(".casos.json", "") in filtro
    )
    if not ficheiros:
        print("nenhum ficheiro de casos encontrado", file=sys.stderr)
        return 2

    linhas: list[dict] = []
    divergentes = 0
    erros = 0

    for caminho in ficheiros:
        with caminho.open(encoding="utf-8") as ficheiro:
            conteudo = json.load(ficheiro)
        for caso in conteudo["casos"]:
            if "entrada_texto" in caso:
                texto = caso["entrada_texto"]
            else:
                texto = json.dumps(caso.get("entrada", {}), separators=(",", ":"), ensure_ascii=False)
            decisao = validar(texto)
            esperado_ok = (
                decisao["veredicto"] == caso["veredicto_esperado"]
                and decisao["motivo"] == caso["motivo_esperado"]
                # O detalhe so se confere quando o caso o DECLARA: um caso que nao o declare nao afirma nada
                # sobre ele (e o detalhe nao e contrato entre as pontas - e o que a ponta sabe dizer da recusa).
                and ("detalhe_esperado" not in caso or decisao.get("detalhe") == caso["detalhe_esperado"])
            )
            if not esperado_ok:
                if decisao["veredicto"] == "erro_de_execucao":
                    erros += 1
                else:
                    divergentes += 1
            linha = {
                "caso": caso["nome"],
                "mensagem": caso["mensagem"],
                "veredicto": decisao["veredicto"],
                "motivo": decisao["motivo"],
                "implementacao": "py",
                "esperado_ok": esperado_ok,
            }
            linhas.append(linha)
            print(json.dumps(linha, separators=(",", ":"), ensure_ascii=False))

    relatorio = argumento("--relatorio")
    if relatorio:
        destino = Path(relatorio)
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(
            "\n".join(json.dumps(linha, separators=(",", ":"), ensure_ascii=False) for linha in linhas)
            + "\n",
            encoding="utf-8",
        )

    aceites = sum(1 for linha in linhas if linha["veredicto"] == "aceite")
    recusados = sum(1 for linha in linhas if linha["veredicto"] == "recusado")
    print(
        f"py · contrato {versao_vigente()} · {len(linhas)} casos · {aceites} aceites · "
        f"{recusados} recusados · {divergentes} divergentes · {erros} erros",
        file=sys.stderr,
    )
    return 0 if divergentes + erros == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
