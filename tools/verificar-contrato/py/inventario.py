#!/usr/bin/env python3
"""O inventario confere com os schemas — as duas direcoes (RN-A1, RN-A2, T054).

    uv run python tools/verificar-contrato/py/inventario.py

Mede tres coisas, e as tres tem de dar zero:

  1. **grandeza sem origem** — um campo numerico do contrato que ninguem declarou de onde vem.
     "Toda grandeza tem dono" era intencao ate este ficheiro existir.
  2. **dono ou setup sem chave no inventario** — a grandeza vem do dono, e a chave nao esta em
     docs/inventario-de-chaves.md: e um valor ajustavel que ninguem sabe onde ajustar.
  3. **declaracao sem grandeza** — uma entrada do mapa que nenhum schema usa. Mapa que fica a
     mentir sobre o que existe e pior do que mapa nenhum.

A chave e conferida na SECCAO certa do inventario (`conta.*` na 1, `risco` na 2, `setup` na 3):
a mesma palavra numa secao errada nao e a mesma chave.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
CONTRATOS = RAIZ / "contracts"
INVENTARIO = RAIZ / "docs" / "inventario-de-chaves.md"

# Os $refs que fazem de um campo uma GRANDEZA (um valor numerico que alguem escolhe ou reporta).
# A lista e a dos $defs NUMERICOS de `_defs/forma.schema.json` — e o nome tem de ser este mesmo:
# procurar `inteiro_ms` (que nao existe) deixava os prazos e os instantes fora da conferencia.
GRANDEZAS = {
    "decimal",
    "decimal_nao_negativo",
    "decimal_positivo",
    "percentagem",
    "instante_ms",
    "duracao_ms",
    "marca_de_posse",
    # 1.5.0: a marca que o VENUE publica no historico. E uma grandeza — um valor que o venue
    # REPORTA — e tem duas formas (o inteiro de 31 bits e o `cloid`), por isso nao podia continuar
    # a chamar-se `marca_de_posse`: essa e a que a MESA compoe, e continuar a ser so o inteiro.
    "marca_de_posse_do_venue",
}
# Um inteiro tambem e grandeza: prazo, contagem, profundidade. Nao confundir com `minItems`/`maxItems`
# do proprio schema (esses sao restricoes da forma, nao valores).
INTEIROS = {"integer", "number"}


def grandezas_dos_schemas() -> dict[str, str]:
    """`schema.campo` -> o tipo de grandeza, para todos os schemas do contrato."""
    achadas: dict[str, str] = {}

    def percorrer(no, caminho: str) -> None:
        if isinstance(no, dict):
            ref = no.get("$ref")
            if isinstance(ref, str) and ref.split("/")[-1] in GRANDEZAS:
                achadas[caminho] = ref.split("/")[-1]
            elif no.get("type") in INTEIROS:
                achadas[caminho] = str(no["type"])
            for chave, valor in no.items():
                if chave not in ("properties", "items", "then", "else", "if", "allOf", "oneOf"):
                    continue
                if chave == "properties" and isinstance(valor, dict):
                    for nome, sub in valor.items():
                        percorrer(sub, f"{caminho}.{nome}" if caminho else nome)
                elif chave == "items":
                    percorrer(valor, f"{caminho}[]")
                elif isinstance(valor, list):
                    for sub in valor:
                        percorrer(sub, caminho)
                else:
                    percorrer(valor, caminho)
        elif isinstance(no, list):
            for sub in no:
                percorrer(sub, caminho)

    for ficheiro in sorted(CONTRATOS.glob("*.schema.json")):
        nome = ficheiro.name.replace(".schema.json", "")
        percorrer(json.loads(ficheiro.read_text(encoding="utf-8")), nome)
    return achadas


def secoes_do_inventario() -> dict[str, list[str]]:
    """As linhas de cada secao numerada do inventario, para conferir a chave no lugar certo."""
    secoes: dict[str, list[str]] = {"1": [], "2": [], "3": [], "outra": []}
    secao = "outra"
    for linha in INVENTARIO.read_text(encoding="utf-8").splitlines():
        if linha.startswith("## "):
            if "`conta." in linha:
                secao = "1"
            elif ".risco." in linha:
                secao = "2"
            elif ".setup." in linha:
                secao = "3"
            else:
                secao = "outra"
        secoes[secao].append(linha)
    return secoes


def chave_no_inventario(chave: str, secoes: dict[str, list[str]]) -> tuple[bool, str]:
    """A chave nomeia um campo da secao certa? A secao vem do proprio prefixo da chave."""
    partes = chave.split(".")
    if partes[0] == "conta":
        secao, campo = "1", partes[-1]
    elif len(partes) >= 3 and partes[1] == "risco":
        secao, campo = "2", partes[-1]
    elif len(partes) >= 3 and partes[1] == "setup":
        secao, campo = "3", partes[-1]
    else:
        return False, f"prefixo nao reconhecido em '{chave}'"
    for linha in secoes.get(secao, []):
        # A chave vale se o campo for nomeado em codigo na linha, sozinho (`campo`) ou com o
        # prefixo da secao (`setup.campo`) — as duas formas aparecem no inventario.
        if re.search(r"`[^`]*\b" + re.escape(campo) + r"\b[^`]*`", linha):
            return True, f"seccao {secao}, campo `{campo}`"
    return False, f"`{campo}` nao nomeado na seccao {secao} do inventario"


def main() -> int:
    grandeza = grandezas_dos_schemas()
    mapa = json.loads((CONTRATOS / "origem-das-grandezas.json").read_text(encoding="utf-8"))
    declarado: dict[str, dict] = dict(mapa["grandezas"])
    for prefixo, entrada in mapa.get("prefixos", {}).items():
        if prefixo == "nota":
            continue
        # Um prefixo vale por todas as grandezas que comeca por ele.
        for chave in grandeza:
            if chave.startswith(prefixo):
                declarado.setdefault(chave, entrada)

    secoes = secoes_do_inventario()
    falhas = 0

    # 1. grandeza sem origem declarada
    sem_origem = sorted(chave for chave in grandeza if chave not in declarado)
    if sem_origem:
        falhas += len(sem_origem)
        for chave in sem_origem:
            print(f"FALHOU  sem origem declarada: {chave}  [{grandeza[chave]}]")
    else:
        print(f"ok      toda grandeza tem origem declarada ({len(grandeza)} grandezas)")

    # 2. declaracao sem grandeza (mapa a mentir) e origem desconhecida
    orfaos = sorted(chave for chave in declarado if chave not in grandeza)
    if orfaos:
        falhas += len(orfaos)
        for chave in orfaos:
            print(f"FALHOU  declaracao sem grandeza: {chave} (nenhum schema usa isto)")
    else:
        print("ok      nenhuma declaracao sem grandeza")

    for chave, entrada in sorted(declarado.items()):
        origem = entrada.get("origem")
        if origem not in ("dono", "setup", "mesa", "venue"):
            print(f"FALHOU  origem desconhecida em {chave}: {origem}")
            falhas += 1
            continue
        if origem not in ("dono", "setup"):
            continue
        if "chave" not in entrada:
            print(f"FALHOU  {chave}: origem '{origem}' sem chave de config")
            falhas += 1
            continue
        ok, detalhe = chave_no_inventario(entrada["chave"], secoes)
        if not ok:
            print(f"FALHOU  {chave}: {entrada['chave']} — {detalhe}")
            falhas += 1

    # 3. o retrato, por origem
    contagem: dict[str, int] = {}
    for entrada in declarado.values():
        contagem[entrada["origem"]] = contagem.get(entrada["origem"], 0) + 1
    retrato = " · ".join(f"{quantas} de {origem}" for origem, quantas in sorted(contagem.items()))
    do_dono = [c for c, e in declarado.items() if e["origem"] in ("dono", "setup")]
    print(f"origem: {retrato}")
    for chave in sorted(do_dono):
        print(f"        {chave} <- {declarado[chave]['chave']}")

    print(f"inventario: {'0 falhas — cada grandeza tem dono, e cada dono tem chave' if falhas == 0 else f'{falhas} falhas'}")
    return 0 if falhas == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
