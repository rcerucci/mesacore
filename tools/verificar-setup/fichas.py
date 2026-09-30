#!/usr/bin/env python3
"""AS FICHAS CONFERIDAS — `fichas/<setup>/<PAR>-<CONTA>.json`, uma a uma, contra o que o sistema LÊ.

PORQUE EXISTE. O operador recusa uma ficha mal formada em tempo de execução (`vigia/operador.ts`,
`lerFichasDaConta`) — mas só a recusa quando alguém a corre, e só nas três regras de identidade. Este conferidor
corre no portão e vê o que a corrida não vê: as **chaves que ninguém lê** (o critério do próprio inventário:
«chave que ninguém lê é lixo»), os **tipos** (o número viaja em TEXTO, D4) e a **forma das bandas**.

REPROVA (exit 1):
  * falta uma das chaves que o sistema lê, ou o tipo não é o que o sistema lê;
  * o nome do ficheiro, a pasta ou o `setup.json` não batem com o cabeçalho (as três regras de identidade);
  * há uma chave que **ninguém lê** — nem as dez conhecidas, nem `constantes`, nem prosa (`_`), nem as que estão
    declaradas em `A_ESPERA_DE_DECISAO` (essas são REPORTADAS, com o número de leitores, para não ficarem
    escondidas atrás de um silêncio).

Uso: fichas.py [caminho-das-fichas]     (por omissão, `fichas/`)
"""
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# O QUE O SISTEMA LÊ — medido (`grep cabecalho.<chave>` em core/, vigia/, brokers/), com o tipo que se exige.
LIDAS = {
    "conta": str,
    "instrumento": str,
    "setup": str,
    "relogio": str,
    "run": bool,
    "enviar": bool,
    "saldo_pct": str,          # D4: o decimal viaja em texto
    "alavancagem": str,
    "bandas": dict,
    "prazo_de_resposta_ms": int,
}
BANDAS = ["saldo_pct", "alavancagem", "stop_pct", "tp_pct"]


def padrao_do_instrumento():
    """O padrão do nome do instrumento LE-SE do contrato (`contracts/_defs/forma.schema.json`).

    O contrato diz, textual: «Símbolo do instrumento, **como o venue o escreve**». E' essa a regra que dispensa
    o dicionario: o nome que a ficha declara e' o nome que o conector manda ao venue, tal e qual. Aqui le-se o
    padrao de forma — nao se copia —, para o conferidor nao envelhecer quando o contrato mudar.
    """
    caminho = os.path.join(RAIZ, "contracts", "_defs", "forma.schema.json")
    with open(caminho, encoding="utf-8") as fh:
        forma = json.load(fh)
    definicao = forma.get("$defs", {}).get("instrumento")
    if not isinstance(definicao, dict) or "pattern" not in definicao:
        raise SystemExit(
            f"fichas: o contrato ({caminho}) nao define `$defs.instrumento.pattern` — sem a forma do nome do "
            "instrumento nao se confere nada, e um conferidor que adivinha nao vale",
        )
    return definicao["pattern"], definicao["description"]


# Chaves que NINGUÉM lê mas que estão à espera de decisão do dono: são reportadas, não reprovadas — ficar
# escondidas era pior (o dono acreditaria num comportamento que não existe).
A_ESPERA_DE_DECISAO = {
    "ao_desligar": "documentada no `fichas/README.md` como decisão do dono («par desligado com posição viva ⇒ "
                   "propõe `caixa`») e NENHUM código a lê: a ficha com `run:false` nunca é corrida",
}


def conferir(caminho, pasta_esperada):
    falhas, notas = [], []
    padrao, descricao = padrao_do_instrumento()
    with open(caminho, encoding="utf-8") as fh:
        f = json.load(fh)
    if not isinstance(f, dict):
        return [f"{caminho}: nao e' um objecto JSON"], notas
    cab = f.get("cabecalho")
    if not isinstance(cab, dict):
        return [f"{caminho}: sem `cabecalho`"], notas
    if "constantes" not in f:
        falhas.append(f"{caminho}: sem `constantes` (ao setup vai so' isto, com o relogio)")

    for chave, tipo in LIDAS.items():
        if chave not in cab:
            falhas.append(f"{caminho}: o cabecalho nao declara `{chave}` (o sistema le'-a)")
            continue
        v = cab[chave]
        # `bool` e' subclasse de `int` em Python: 5 nao pode passar por booleano, nem True por inteiro.
        if tipo is bool and not isinstance(v, bool):
            falhas.append(f"{caminho}: `{chave}` tem de ser booleano (tem {type(v).__name__})")
        elif tipo is int and (isinstance(v, bool) or not isinstance(v, int)):
            falhas.append(f"{caminho}: `{chave}` tem de ser inteiro (tem {type(v).__name__})")
        elif tipo is str and not isinstance(v, str):
            falhas.append(f"{caminho}: `{chave}` tem de ser TEXTO (D4: o numero viaja em texto; tem {type(v).__name__})")
    if isinstance(cab.get("prazo_de_resposta_ms"), int) and not isinstance(cab.get("prazo_de_resposta_ms"), bool):
        if cab["prazo_de_resposta_ms"] <= 0:
            falhas.append(f"{caminho}: `prazo_de_resposta_ms` tem de ser > 0")

    # O NOME DO INSTRUMENTO E' O DO VENUE — e e' isso que dispensa o dicionario.
    nome = cab.get("instrumento")
    if isinstance(nome, str) and not re.match(padrao, nome):
        falhas.append(f"{caminho}: o `instrumento` nao respeita a forma do contrato ({padrao}): {descricao}")
    if isinstance(nome, str):
        notas.append(
            f"{caminho}: `instrumento={nome}` — este nome vai ao venue TAL E QUAL (o conector nao traduz nada). "
            "Quem confirma que o venue o conhece e' a porta `sonda_e_manifesto`, na corrida; sem conector para esta "
            "corretora, o nome e' uma ASSUNCAO ate' haver corrida",
        )
    bandas = cab.get("bandas")
    if isinstance(bandas, dict):
        for b in BANDAS:
            if b not in bandas:
                falhas.append(f"{caminho}: `bandas.{b}` nao esta' declarada (a mesa confere-a antes da boleta)")
            elif not isinstance(bandas[b], dict):
                falhas.append(f"{caminho}: `bandas.{b}` tem de ser um objecto com `minimo` e `maximo`")
            else:
                for lado in ("minimo", "maximo"):
                    if not isinstance(bandas[b].get(lado), str):
                        falhas.append(f"{caminho}: `bandas.{b}.{lado}` tem de ser TEXTO (D4)")
    else:
        falhas.append(f"{caminho}: `bandas` tem de ser um objecto")

    # AS TRES REGRAS DE IDENTIDADE (as mesmas do operador).
    ficheiro = os.path.basename(caminho)
    esperado = f"{cab.get('instrumento')}-{cab.get('conta')}.json"
    if ficheiro != esperado:
        falhas.append(f"{caminho}: o nome nao bate com o cabecalho (esperado `{esperado}`)")
    if cab.get("setup") != pasta_esperada:
        falhas.append(f"{caminho}: o cabecalho diz `setup: {cab.get('setup')}` e a pasta diz `{pasta_esperada}`")
    if not os.path.exists(os.path.join(RAIZ, "setups", str(cab.get("setup")), "setup.json")):
        falhas.append(f"{caminho}: o setup `{cab.get('setup')}` nao existe em setups/{cab.get('setup')}/setup.json")

    # AS CHAVES QUE NINGUEM LE.
    for chave in cab:
        if chave in LIDAS:
            continue
        if chave.startswith("_"):
            continue
        if chave in A_ESPERA_DE_DECISAO:
            notas.append(f"{caminho}: `{chave}` — ninguem a le; {A_ESPERA_DE_DECISAO[chave]}")
        else:
            falhas.append(
                f"{caminho}: a chave `{chave}` do cabecalho nao e' lida por ninguem e nao esta' declarada: "
                "chave que ninguem le e' lixo (e o dono pode acreditar nela)",
            )
    return falhas, notas


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "fichas")
    if not os.path.isdir(base):
        print(f"fichas: nao existe a pasta {base}")
        return 1
    falhas, notas, total = [], [], 0
    for pasta in sorted(os.listdir(base)):
        caminho_da_pasta = os.path.join(base, pasta)
        if not os.path.isdir(caminho_da_pasta):
            continue
        for ficheiro in sorted(os.listdir(caminho_da_pasta)):
            if not ficheiro.endswith(".json"):
                continue
            total += 1
            try:
                f_, n_ = conferir(os.path.join(caminho_da_pasta, ficheiro), pasta)
            except json.JSONDecodeError as e:
                f_, n_ = [f"{pasta}/{ficheiro}: JSON ilegivel ({e})"], []
            if f_:
                print(f"REPROVA {pasta}/{ficheiro}")
                for x in f_:
                    print(f"        {x.split(': ', 1)[-1]}")
            else:
                print(f"ok      {pasta}/{ficheiro}")
            falhas += f_
            notas += n_

    for n in notas:
        print(f"NOTA    {n.split('fichas/', 1)[-1] if 'fichas/' in n else n}")
    print(f"\nfichas: {total} conferidas · {len(falhas)} falhas · {len(notas)} notas")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
