#!/usr/bin/env python3
"""A conferencia da fronteira vigia<->mesa (SC-003, T046/T048/T049).

    uv run python tools/verificar-contrato/py/fronteira.py [--motivos|--campos|--contagem|--tudo]

Tres perguntas, e nas tres a mesma regra: o AMBITO e declarado, e o conferidor tem de saber reprovar.

  --motivos   os motivos que CRUZAM a fronteira, nas DUAS direcoes: um motivo marcado no livro
              (`core/estados/motivos.json`) que nao exista no conjunto fechado do contrato e falha; um nome
              no conjunto que o livro nao conheca tambem - a excecao e o que estiver declarado como vindo da
              PORTA (`conjuntos_do_vigia.excecoes_da_porta`, em dado e nao em prosa). As contagens declaradas
              no proprio livro (`fronteira.cruzam` / `nao_cruzam`) conferem-se contra a verdade: um numero
              escrito a mao que envelheceu e a forma mais barata de um conferidor mentir.
  --campos    os campos que a mensagem do `comando` declara, contra QUEM OS LE. Um campo que ninguem le e
              falha, e nao reserva: um campo a mais na mensagem e a porta dos verbos a alargar-se sozinha
              (FR-020). O AMBITO e a mensagem do `comando` - as outras sao do recorte 001.
  --contagem  os casos novos entram na contagem SOMANDO (T049): o total que as duas linguagens imprimem tem
              de ser a soma dos casos de todos os ficheiros, igual nas duas, e crescer exactamente um quando
              um caso entra. A prova da soma faz-se a serio: entra um caso a mais, corre, e sai outra vez.

Nao se prova comportamento da mesa aqui: prova-se a FORMA da fronteira.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
CONTRATOS = RAIZ / "contracts"
CASOS = CONTRATOS / "casos"
LIVRO = RAIZ / "core" / "estados" / "motivos.json"
VOCABULARIO = CONTRATOS / "vocabulario.json"
COMANDO = CONTRATOS / "comando.schema.json"
# O PRODUTO: onde um campo da mensagem pode ter leitor. As bancadas e os casos ficam de fora - um campo lido
# so por uma bancada e um campo que o produto nao le.
AMBITO_DOS_LEITORES = [RAIZ / "core", RAIZ / "vigia"]

falhas: list[str] = []


def conferir(condicao: bool, texto: str) -> None:
    if condicao:
        print(f"ok    {texto}")
    else:
        falhas.append(texto)
        print(f"FALHA {texto}")


def ler(caminho: Path) -> dict:
    return json.loads(caminho.read_text(encoding="utf-8"))


def sem_comentarios(texto: str) -> str:
    """Tira os comentarios antes de procurar o identificador.

    O cabecalho de um ficheiro explica porque razao um campo NAO e lido ali dentro; um conferidor que leia
    comentarios acusa a propria explicacao (licao da `fail-closed-validation`).
    """
    texto = re.sub(r"/\*.*?\*/", "", texto, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", texto)


def motivos(livro: dict | None = None, vocabulario: dict | None = None) -> int:
    livro = livro if livro is not None else ler(LIVRO)
    vocabulario = vocabulario if vocabulario is not None else ler(VOCABULARIO)
    itens = livro["motivos"]
    conjuntos = vocabulario["conjuntos_do_vigia"]
    da_porta = set(conjuntos.get("excecoes_da_porta", []))
    no_conjunto = set(conjuntos["motivos_de_comando"]) | set(conjuntos["efeitos_de_comando"])
    cruzam = {nome for nome, item in itens.items() if item.get("cruzam_a_fronteira")}
    ficam = set(itens) - cruzam

    print(f"    livro: {len(itens)} motivos · {len(cruzam)} cruzam · {len(ficam)} ficam · "
          f"conjunto fechado: {len(no_conjunto)} nomes · da porta (declarados): {len(da_porta)}")

    # DIRECAO A: quem o livro marca como cruzando tem de existir no conjunto fechado do contrato.
    sem_conjunto = sorted(cruzam - no_conjunto - da_porta)
    conferir(not sem_conjunto, f"direcao A: todo o motivo que cruza existe no conjunto fechado ({', '.join(sem_conjunto) or 'nenhum em falta'})")

    # DIRECAO B: o conjunto nao pode ter nome que o livro nao conheca nem declarado como vindo da porta.
    sem_livro = sorted(no_conjunto - cruzam - da_porta)
    conferir(not sem_livro, f"direcao B: todo o nome do conjunto tem quem o produza ({', '.join(sem_livro) or 'nenhum orfao'})")

    # As duas excecoes da porta existem mesmo, e nao sao um deposito: cada uma tem de constar do conjunto.
    conferir(da_porta <= no_conjunto, f"a excecao da porta esta no conjunto ({', '.join(sorted(da_porta)) or 'nenhuma'})")

    # As contagens escritas no livro conferem-se contra a verdade - e nao se escrevem a mao.
    declarado = livro.get("fronteira", {})
    conferir(declarado.get("cruzam") == len(cruzam),
             f"fronteira.cruzam declarado ({declarado.get('cruzam')}) e a verdade ({len(cruzam)})")
    conferir(declarado.get("nao_cruzam") == len(ficam),
             f"fronteira.nao_cruzam declarado ({declarado.get('nao_cruzam')}) e a verdade ({len(ficam)})")
    return len(falhas)


def _campos_do_produto() -> list[str]:
    """Os campos que o PRODUTO declara ler - MEDIDOS ao correr o modulo, e nao por grep.

    O `core/estados/comando.ts` publica `CAMPOS_DO_COMANDO`, e e por essa lista que ele recusa um campo a
    mais (`comando_com_campo_a_mais`). Importar o modulo e a unica medida que nao depende de o nome estar
    escrito da mesma maneira em dois sitios - e um grep por `conta` encontra o macro da CONTA (`cb.ts`), que
    nao tem nada a ver com um campo da mensagem. Foi assim que a primeira versao deste conferidor deu um
    falso positivo: media o NOME, nao a leitura.
    """
    programa = (
        'import { CAMPOS_DO_COMANDO } from "' + (RAIZ / "core" / "estados" / "comando.ts").as_posix() + '";'
        "console.log(JSON.stringify(CAMPOS_DO_COMANDO));"
    )
    processo = subprocess.run(["bun", "-e", programa], capture_output=True, text=True, cwd=RAIZ)
    if processo.returncode != 0:
        raise SystemExit(f"nao se leu CAMPOS_DO_COMANDO do produto:\n{processo.stderr[-600:]}")
    return list(json.loads(processo.stdout.strip().splitlines()[-1]))


def campos(schema: dict | None = None, ambito: list[Path] | None = None, do_produto: list[str] | None = None) -> int:
    schema = schema if schema is not None else ler(COMANDO)
    ambito = ambito if ambito is not None else AMBITO_DOS_LEITORES
    do_produto = do_produto if do_produto is not None else _campos_do_produto()
    declarados = list(schema["properties"])

    print(f"    a mensagem do `comando` declara {', '.join(declarados)}")
    print(f"    o produto declara ler {', '.join(do_produto)} (CAMPOS_DO_COMANDO, core/estados/comando.ts)")

    # AS DUAS DIRECOES, com a mesma regra da conferencia dos motivos: um campo na mensagem que o produto nao
    # le e um campo a mais (FR-020); um campo que o produto le e o contrato nao declara e a mesa a aceitar o
    # que ninguem escreveu.
    so_na_mensagem = sorted(set(declarados) - set(do_produto))
    so_no_produto = sorted(set(do_produto) - set(declarados))
    conferir(not so_na_mensagem and not so_no_produto,
             "os campos da mensagem e os que o produto le sao OS MESMOS"
             + (f" (so na mensagem: {so_na_mensagem or 'nenhum'}; so no produto: {so_no_produto or 'nenhum'})"
                if (so_na_mensagem or so_no_produto) else ""))

    # E cada campo tem de ser LIDO, e nao apenas listado. A leitura procura-se no modulo que VALIDA o
    # comando, que e onde o objecto cru chega: `c.<campo>`. Um campo que entre na lista sem ser lido ali fica
    # no conjunto sem leitor - e um campo a mais na lista e um campo a mais na mensagem.
    fonte = sem_comentarios((RAIZ / "core" / "estados" / "comando.ts").read_text(encoding="utf-8"))
    for campo in do_produto:
        padrao = re.compile(rf"c\.{re.escape(campo)}\b")
        conferir(bool(padrao.search(fonte)),
                 f"campo '{campo}' e LIDO do comando cru (core/estados/comando.ts: c.{campo})")
    return len(falhas)

def _totais_dos_runners() -> dict[str, tuple[int, int, int]]:
    """Corre os dois runners e le os totais que eles imprimem (e a implementacao real de cada lingua)."""
    saida: dict[str, tuple[int, int, int]] = {}
    for nome, comando in (("py", ["uv", "run", "python", "esqueleto/casos.py"]),
                          ("ts", ["bun", "run", "esqueleto/casos.ts"])):
        processo = subprocess.run(comando, cwd=CONTRATOS, capture_output=True, text=True)
        texto = processo.stdout + processo.stderr
        achado = re.search(r"(\d+) casos · (\d+) aceites · (\d+) recusados", texto)
        if achado is None:
            raise SystemExit(f"nao se leu o resumo do runner {nome}:\n{texto[-800:]}")
        saida[nome] = (int(achado.group(1)), int(achado.group(2)), int(achado.group(3)))
    return saida


def contagem(com_prova: bool = True) -> int:
    ficheiros = sorted(CASOS.glob("*.casos.json"))
    por_ficheiro = {f.name: len(ler(f)["casos"]) for f in ficheiros}
    soma = sum(por_ficheiro.values())
    print(f"    {len(ficheiros)} ficheiros de caso · {soma} casos somados: "
          + ", ".join(f"{nome}={quantos}" for nome, quantos in por_ficheiro.items()))

    totais = _totais_dos_runners()
    for nome, (casos, aceites, recusados) in totais.items():
        conferir(casos == soma, f"runner {nome}: total ({casos}) e a soma dos ficheiros ({soma})")
        conferir(aceites + recusados == casos, f"runner {nome}: aceites+recusados ({aceites}+{recusados}) e o total")
        print(f"    runner {nome}: {casos} casos · {aceites} aceites · {recusados} recusados")
    conferir(totais["py"][0] == totais["ts"][0],
             f"as duas linguagens correm os mesmos casos ({totais['py'][0]} = {totais['ts'][0]})")

    if not com_prova:
        return len(falhas)

    # A PROVA DA SOMA, feita a serio: entra um caso a mais, corre, e sai outra vez. Sem isto, "soma" e uma
    # afirmacao sobre um numero que ninguem viu crescer.
    original = CASOS / "vigia.casos.json"
    temporario = CASOS / "zz-temp-contagem.casos.json"
    try:
        # UM caso a mais, e nao o ficheiro inteiro copiado: a primeira versao desta prova escrevia os 19
        # casos do ficheiro sob outro nome e esperava +1 - e o total subiu 20. A contagem estava certa; a
        # prova e que nao media o que dizia medir.
        conteudo = ler(original)
        novo = json.loads(json.dumps(conteudo["casos"][0]))
        novo["nome"] = novo["nome"] + "-copia-para-a-prova-da-soma"
        temporario.write_text(json.dumps({"mensagem": conteudo["mensagem"], "nota": "temporario da prova da soma", "casos": [novo]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        depois = _totais_dos_runners()
    finally:
        temporario.unlink(missing_ok=True)
    conferir(depois["py"][0] == soma + 1 and depois["ts"][0] == soma + 1,
             f"com um caso a mais nas duas linguagens o total sobe um ({soma} -> {depois['py'][0]}/{depois['ts'][0]})")
    conferir(_totais_dos_runners()["py"][0] == soma,
             f"e volta ao total de antes quando o caso sai ({soma})")
    return len(falhas)


def main(argv: list[str]) -> int:
    modo = argv[1] if len(argv) > 1 else "--tudo"
    antes = len(falhas)
    if modo in ("--motivos", "--tudo"):
        print("os motivos que CRUZAM a fronteira, nas duas direcoes")
        motivos()
    if modo in ("--campos", "--tudo"):
        print("\nos campos da mensagem do `comando`, contra quem os le")
        campos()
    if modo in ("--contagem", "--tudo"):
        print("\nos casos do contrato, somando")
        contagem()
    print()
    if len(falhas) == antes:
        print("fronteira: 0 falhas — os motivos fecham nas duas direcoes, todo o campo tem leitor, e os casos somam")
        return 0
    for falha in falhas:
        print(f"FALHA {falha}")
    print(f"fronteira: {len(falhas) - antes} falhas")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
