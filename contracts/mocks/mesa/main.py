#!/usr/bin/env python3
"""O duble de MESA — a mesa de mentira, para quem constroi um PLUGIN (T051-T054, RN-E17, RN-E24).

O que ele e: o **assento da mesa** virado a um plugin. Da o `mercado` a um setup e CONFERE a `proposta` que
ele devolve; da a `boleta` a um conector e CONFERE o `desfecho`. Quem quiser construir um setup ou um conector
nao precisa de por a mesa real de pe.

O que ele NAO e: nao decide risco, nao contende, nao mede CB, e nao substitui a conformidade da corretora
(RN-C6). E nao vale como prova de comportamento da mesa: se um dia divergir dela, a divergencia e DEFEITO DE
UM DOS DOIS e aparece como falha (SC-004) - e e por isso que este programa sabe correr os **mesmos casos**
contra o motor do contrato, que e o caminho por onde a mesa real os faz passar.

Escrito DO CONTRATO (`contracts/*.schema.json`, `vocabulario.json`) e **nunca** importando `core/`: um duble
copiado do core prova compatibilidade com a nossa implementacao, e nao com o contrato - e esconde o defeito
dos dois lados ao mesmo tempo.

    python3 contracts/mocks/mesa/main.py --papel setup    --casos setup.casos.json
    python3 contracts/mocks/mesa/main.py --papel conector --casos conector.casos.json
    python3 contracts/mocks/mesa/main.py --papel setup    --casos setup.casos.json \
            --plugin "bun run contracts/mocks/setup/main.ts --barra 1730001600000 --lado buy"
    python3 contracts/mocks/mesa/main.py --fidelidade     --casos conector.casos.json

`--plugin` poe o duble a falar com o plugin a SERIO (o mock do recorte 001, por exemplo): escreve a mensagem
no stdin dele, le a resposta do stdout, e confere-a. Sem `--plugin`, o caso traz a resposta declarada - e e
assim que os modos adversarios se correm sem depender de um plugin de verdade.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

RAIZ = Path(__file__).resolve().parents[3]
CONTRATOS = RAIZ / "contracts"
CASOS_DO_CONTRATO = CONTRATOS / "casos"
ID_DO_ENVELOPE = "https://mesacore.local/contracts/envelope.schema.json"

# O vocabulario DESTE duble: os nomes que so ele pronuncia (o plugin calado, o plugin que recusou, o atraso
# que passou do prazo). Os nomes de recusa da MENSAGEM sao os do contrato, e vem de `vocabulario.json`.
VOCABULARIO_DO_DUBLE = {
    "plugin_nao_respondeu": "o plugin nao escreveu nada dentro do prazo declarado",
    "plugin_recusou": "o plugin escreveu uma saida que nao e uma mensagem (saiu com erro ou disse que nao)",
    "atraso_alem_do_prazo": "a resposta chegou depois do prazo: ja nao se sabe se chegou a tempo",
}

VEREDICTOS = ("aceite", "recusado", "espera", "desconhecido")  # o vocabulario do CONTRATO: `aceite`, nunca `aceita`


def ler(caminho: Path) -> Any:
    with caminho.open(encoding="utf-8") as ficheiro:
        return json.load(ficheiro)


def versao_vigente() -> str:
    return ler(CONTRATOS / "versao.json")["contrato"]


# ---------------------------------------------------------------------------------------------------
# A VERSAO DO CONTRATO NAO SE ESCREVE NUM FICHEIRO DE CASOS.
#
# Os casos escrevem o TOKEN (`$CONTRATO`, e `$CONTRATO_A_FRENTE` / `$CONTRATO_ATRAS` onde o caso e
# ADVERSARIO), e e aqui — no momento de os ler — que o token e trocado pela versao LIDA de
# `contracts/versao.json`. A vigente vive num so sitio; copiada para 26 mensagens, envelhece em silencio e
# passa a ser recusada por `versao_do_contrato_divergente`, e a bateria mede o contrario do que diz medir.
#
# Um token DESCONHECIDO (ou um que ficasse por resolver) NAO passa como texto: e uma RECUSA nomeada. Um
# literal a chegar ao validador daria a mesma recusa em todos os casos, e ninguem saberia por que.
#
# O mesmo resolver vive do lado TypeScript (tools/verificar-conector/conformidade.ts), que le os MESMOS
# casos: se os dois resolverem de forma diferente, os veredictos divergem e a bateria fica vermelha.
# ---------------------------------------------------------------------------------------------------

TOKEN_VIGENTE = "$CONTRATO"
TOKEN_A_FRENTE = "$CONTRATO_A_FRENTE"
TOKEN_ATRAS = "$CONTRATO_ATRAS"


class TokenDeVersaoDesconhecido(Exception):
    """Um token de versao que ninguem sabe resolver. Recusa NOMEADA, nunca um texto a passar por versao."""


def _versao_deslocada(delta: int) -> str:
    """Uma versao DIFERENTE da vigente — sempre: sobe (ou desce) o numero do meio.

    Ex.: vigente 1.4.0 -> a frente 1.5.0, atras 1.3.0. Se o deslocamento cair na propria vigente (o numero
    do meio ja e zero), muda-se a ultima casa: o que o caso adversario pede e uma versao DIFERENTE, e so.
    """
    maior, menor, _ = (int(p) for p in versao_vigente().split("."))
    candidata = f"{maior}.{menor + delta}.0" if delta > 0 else f"{maior}.{max(0, menor - 1)}.0"
    return candidata if candidata != versao_vigente() else f"{maior}.{menor}.1"


def resolver_tokens_de_versao(valor: Any) -> Any:
    if isinstance(valor, str):
        if valor == TOKEN_VIGENTE:
            return versao_vigente()
        if valor == TOKEN_A_FRENTE:
            return _versao_deslocada(1)
        if valor == TOKEN_ATRAS:
            return _versao_deslocada(-1)
        if valor.startswith("$CONTRATO"):
            raise TokenDeVersaoDesconhecido(f"token de versao desconhecido nos casos: {valor!r}")
        return valor
    if isinstance(valor, list):
        return [resolver_tokens_de_versao(v) for v in valor]
    if isinstance(valor, dict):
        return {chave: resolver_tokens_de_versao(v) for chave, v in valor.items()}
    return valor


def vocabulario() -> dict[str, Any]:
    return ler(CONTRATOS / "vocabulario.json")


_validadores: dict[str, Draft202012Validator] = {}


def validadores() -> dict[str, Draft202012Validator]:
    """Um validador por tipo de mensagem, compilado dos esquemas do contrato."""
    if _validadores:
        return _validadores
    recursos = []
    for caminho in sorted(CONTRATOS.glob("*.schema.json")) + sorted((CONTRATOS / "_defs").glob("*.schema.json")):
        esquema = ler(caminho)
        recursos.append((esquema["$id"], Resource.from_contents(esquema)))
    registo = Registry().with_resources(recursos)
    # O ENVELOPE e o validador: e ele que encaminha para o schema do tipo. Validar o schema do tipo
    # directamente daria `campo_desconhecido` em TODAS as mensagens (as chaves do envelope nao sao da carga) -
    # foi o que a primeira corrida deste duble fez, e a bateria apanhou-o no primeiro caso.
    envelope = ler(CONTRATOS / "envelope.schema.json")
    _validadores["envelope"] = Draft202012Validator(envelope, registry=registo)
    return _validadores


def _caminho(dados: Any, passos: list[Any]) -> Any:
    atual = dados
    for passo in passos:
        if not isinstance(atual, (dict, list)):
            return None
        try:
            atual = atual[passo]
        except (KeyError, IndexError, TypeError):
            return None
    return atual


def _extras(esquema: dict[str, Any], instancia: Any) -> list[str]:
    if not isinstance(instancia, dict):
        return []
    declaradas = set(esquema.get("properties", {}))
    return [chave for chave in instancia if chave not in declaradas]


def _motivo(erro: Any, dados: Any, voc: dict[str, Any]) -> str | None:
    """A traducao do erro do esquema para o nome do contrato - escrita DE NOVO aqui, de proposito.

    O motor do contrato faz esta traducao do lado dele; este duble faz a sua. Se as duas nao concordarem,
    os mesmos casos dao veredictos diferentes e a bateria fica vermelha. Uma traducao copiada nao provava nada.
    """
    proibidos = voc["campos_em_unidade_de_corretora"]
    if erro.validator == "additionalProperties":
        for chave in _extras(erro.schema, erro.instance):
            if chave in proibidos:
                return "campo_em_unidade_de_corretora"
        return "campo_desconhecido"
    if erro.validator == "required":
        if erro.validator_value == ["parcial"] or "parcial" in erro.message:
            return "parcial_nao_declarada"
        return "campo_obrigatorio_ausente"
    if erro.validator == "type":
        return "valor_nulo_nao_permitido" if _caminho(dados, list(erro.absolute_path)) is None else "tipo_invalido"
    if erro.validator == "pattern":
        return "formato_invalido"
    if erro.validator == "enum":
        return "valor_fora_do_conjunto"
    if erro.validator == "const":
        return "valor_fora_do_conjunto"
    if erro.validator in ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"):
        return "valor_fora_da_banda"
    return None


def escolher_motivo(erros: list[Any], dados: Any, voc: dict[str, Any]) -> str | None:
    encontrados = {m for m in (_motivo(e, dados, voc) for e in erros) if m}
    for motivo in voc["prioridade_dos_motivos"]:
        if motivo in encontrados:
            return motivo
    return sorted(encontrados)[0] if encontrados else None


def conferir_mensagem(texto: str, tipo: str) -> dict[str, Any]:
    """O veredicto DESTE duble para uma mensagem de um plugin: enquadramento, versao e forma."""
    voc = vocabulario()
    try:
        dados = json.loads(texto)
    except (json.JSONDecodeError, TypeError):
        return {"veredicto": "recusado", "motivo": "enquadramento_invalido"}
    if not isinstance(dados, dict) or isinstance(dados, list):
        return {"veredicto": "recusado", "motivo": "enquadramento_invalido"}
    if dados.get("contrato") != versao_vigente():
        bruto = dados.get("contrato")
        como_texto = "(ausente)" if "contrato" not in dados else (bruto if isinstance(bruto, str) else "(nao textual)")
        return {"veredicto": "recusado", "motivo": "versao_do_contrato_divergente",
                "detalhe": f"declarada {como_texto}, vigente {versao_vigente()}"}
    if dados.get("tipo") != tipo:
        return {"veredicto": "recusado", "motivo": "tipo_invalido"}
    erros = sorted(validadores()["envelope"].iter_errors(dados), key=lambda e: list(e.absolute_path))
    if erros:
        return {"veredicto": "recusado", "motivo": escolher_motivo(erros, dados, voc)}
    return {"veredicto": "aceite", "motivo": None}


def falar_com_o_plugin(comando: str, mensagem: str, prazo_ms: int, ultima: bool = False) -> dict[str, Any]:
    """Escreve a mensagem ao plugin e le o que ele devolve, dentro do prazo declarado.

    O prazo e o do caso, e o tempo conta-se no relogio do DUBLE: um plugin calado dentro do prazo e ESPERA (ainda
    se sabe que ele pode responder), e calado depois do prazo e DESCONHECIDO (ja nao se sabe se chegou a tempo)
    - nunca sucesso (SC-008).
    """
    processo = subprocess.run(
        ["bash", "-lc", comando], input=mensagem + "\n", capture_output=True, text=True,
        timeout=max(1.0, prazo_ms / 1000.0 * 4), cwd=RAIZ,
    )
    if processo.returncode != 0:
        return {"veredicto": "recusado", "motivo": "plugin_recusou", "detalhe": processo.stderr.strip()[-200:]}
    linhas = [l for l in processo.stdout.strip().splitlines() if l.strip()]
    if not linhas:
        return {"veredicto": "espera", "motivo": None}
    # O conector responde DUAS linhas (a resolucao ANTES de enviar, depois o desfecho): do lado do desfecho,
    # o que se confere e a ULTIMA. A primeira e a resolucao, e tem o seu proprio caso no recorte 001.
    return {"linha": linhas[-1] if ultima else linhas[0]}


def correr_caso(caso: dict[str, Any], papel: str, plugin: str | None) -> dict[str, Any]:
    tipo_da_mensagem = "proposta" if papel == "setup" else "desfecho"
    tipo_que_o_duble_da = "mercado" if papel == "setup" else "boleta"
    prazo_ms = int(caso.get("prazo_de_resposta_ms", 3000))
    modo = caso.get("modo_adversario")

    saida = {"caso": caso["nome"], "papel": papel, "modo": modo}
    if modo == "silencio":
        # O plugin nao responde. Dentro do prazo e ESPERA; passado o prazo, DESCONHECIDO; nunca sucesso.
        chegou = caso.get("chegada_ms")
        if chegou is None:
            saida.update(veredicto="espera", motivo=None,
                         nota="calado dentro do prazo: ainda pode responder")
        else:
            saida.update(veredicto="desconhecido", motivo="atraso_alem_do_prazo",
                         nota=f"calado {chegou} ms depois, e o prazo era {prazo_ms} ms")
        return saida
    if modo == "atraso":
        return dict(saida, veredicto="desconhecido", motivo="atraso_alem_do_prazo",
                    nota="a resposta chegou depois do prazo")
    if modo == "recusa":
        return dict(saida, veredicto="recusado", motivo="plugin_recusou", nota="o plugin disse que nao")

    if plugin and caso.get("com_plugin"):
        # So os casos que DECLARAM correr contra o plugin de verdade o fazem: os outros trazem a resposta
        # declarada, e e assim que os adversarios se correm sem depender de um plugin que os saiba fazer.
        mensagem = json.dumps(caso[tipo_que_o_duble_da], ensure_ascii=False)
        resposta = falar_com_o_plugin(plugin, mensagem, prazo_ms, ultima=(papel == "conector"))
        if resposta.get("veredicto") in VEREDICTOS:
            return dict(saida, **resposta)
        linha = resposta["linha"]
    else:
        linha = json.dumps(caso.get("resposta_do_plugin"), ensure_ascii=False)

    veredicto = conferir_mensagem(linha, tipo_da_mensagem)
    return dict(saida, **veredicto)


def correr(papel: str, casos: dict[str, Any], plugin: str | None) -> int:
    falhas = 0
    ao_plugin = 0
    for caso in casos["casos"]:
        if plugin and caso.get("com_plugin"):
            ao_plugin += 1
        saida = correr_caso(caso, papel, plugin)
        esperado, motivo_esperado = caso["veredicto_esperado"], caso.get("motivo_esperado")
        ok = saida["veredicto"] == esperado and saida.get("motivo") == motivo_esperado
        saida["esperado_ok"] = ok
        if not ok:
            falhas += 1
        print(json.dumps(saida, ensure_ascii=False))
    return falhas


def fidelidade(casos: dict[str, Any], papel: str) -> int:
    """SC-004: os MESMOS casos contra o motor do contrato. Divergencia = falha.

    O duble corre o caso e da o seu veredicto; depois o caso vai INTEIRO, na forma dos casos do contrato, para
    o motor (`contracts/esqueleto/casos.py` e `casos.ts`), que da o veredicto dele. Os dois numeros comparam-se
    aqui. O ficheiro temporario entra no directório dos casos e sai no fim, dentro de um `finally`.
    """
    do_duble: dict[str, tuple[str, str | None]] = {}
    emitidos = []
    for caso in casos["casos"]:
        if caso.get("modo_adversario") or "resposta_do_plugin" not in caso:
            # Sem resposta declarada nao ha MENSAGEM para o motor conferir: os modos adversarios (calado,
            # atrasado, recusou) sao comportamento do plugin, e nao forma de mensagem.
            continue
        saida = correr_caso(caso, papel, None)
        do_duble[caso["nome"]] = (saida["veredicto"], saida.get("motivo"))
        emitidos.append({
            "nome": caso["nome"],
            "mensagem": "proposta" if papel == "setup" else "desfecho",
            "entrada": caso["resposta_do_plugin"],
            "veredicto_esperado": saida["veredicto"],
            "motivo_esperado": saida.get("motivo"),
            "historico": "T053/SC-004 - emitido pelo duble de mesa; o motor do contrato diz se concorda",
        })
    temporario = CASOS_DO_CONTRATO / "zz-duble-de-mesa.casos.json"
    try:
        temporario.write_text(json.dumps({"mensagem": "fidelidade", "nota": "temporario do duble de mesa",
                                          "casos": emitidos}, ensure_ascii=False, indent=2) + "\n",
                              encoding="utf-8")
        saidas = {}
        for nome, comando in (("py", ["uv", "run", "python", "esqueleto/casos.py"]),
                              ("ts", ["bun", "run", "esqueleto/casos.ts"])):
            processo = subprocess.run(comando, cwd=CONTRATOS, capture_output=True, text=True)
            saidas[nome] = processo.stdout + processo.stderr
    finally:
        temporario.unlink(missing_ok=True)

    falhas = 0
    for nome, texto in saidas.items():
        do_motor = {}
        for linha in texto.splitlines():
            try:
                item = json.loads(linha)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict) and item.get("caso") in do_duble:
                do_motor[item["caso"]] = (item.get("veredicto"), item.get("motivo"))
        print(f"    motor {nome}: {len(do_motor)} casos conferidos contra o duble")
        for caso_nome, (veredicto_duble, motivo_duble) in do_duble.items():
            do_motor_veredicto = do_motor.get(caso_nome)
            if do_motor_veredicto is None:
                print(f"FALHA o motor {nome} nao devolveu o caso {caso_nome}")
                falhas += 1
            elif do_motor_veredicto != (veredicto_duble, motivo_duble):
                print(f"FALHA {nome}: {caso_nome} — duble {veredicto_duble}/{motivo_duble}, "
                      f"motor {do_motor_veredicto[0]}/{do_motor_veredicto[1]}")
                falhas += 1
    print(f"    {len(do_duble)} casos do duble: veredicto e motivo conferidos contra as duas linguagens do motor")
    return falhas


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="O duble de mesa (US6)")
    p.add_argument("--papel", choices=("setup", "conector"))
    p.add_argument("--casos", required=True)
    p.add_argument("--plugin", default=None)
    p.add_argument("--fidelidade", action="store_true")
    args = p.parse_args(argv[1:])

    caminho = Path(args.casos)
    if not caminho.is_absolute():
        caminho = Path(__file__).resolve().parent / caminho
    # OS TOKENS DE VERSAO resolvem-se AQUI, uma so vez, antes de qualquer leitor os ver: os casos nunca
    # trazem a versao escrita, e um token que ninguem soubesse resolver e RECUSADO com nome.
    try:
        casos = resolver_tokens_de_versao(ler(caminho))
    except TokenDeVersaoDesconhecido as erro:
        print(f"duble de mesa: RECUSADO — {erro}", file=sys.stderr)
        return 2
    if args.fidelidade:
        if not args.papel:
            print("--fidelidade precisa do --papel (e o papel decide qual resposta se confere)", file=sys.stderr)
            return 2
        papel = args.papel
        print(f"a fidelidade do duble de mesa (SC-004), no papel {papel}")
        falhas = fidelidade(casos, papel)
        print()
        print("fidelidade: 0 falhas — o duble e o motor do contrato dao o mesmo veredicto nos mesmos casos"
              if falhas == 0 else f"fidelidade: {falhas} falhas (divergencia entre o duble e o motor)")
        return 0 if falhas == 0 else 1

    if not args.papel:
        print("--papel e obrigatorio (setup ou conector)", file=sys.stderr)
        return 2
    falhas = correr(args.papel, casos, args.plugin)
    print()
    if falhas == 0:
        # Quantos casos foram ao plugin A SERIO: sem este numero, "correu contra o mock" nao se distingue de
        # "correu com a resposta declarada no proprio caso".
        ao_plugin = sum(1 for c in casos["casos"] if args.plugin and c.get("com_plugin"))
        print(f"duble de mesa ({args.papel}): 0 falhas — {len(casos['casos'])} casos, cada um com o veredicto "
              f"declarado" + (f", {ao_plugin} deles contra o plugin a serio" if args.plugin else ""))
        return 0
    print(f"duble de mesa ({args.papel}): {falhas} falhas em {len(casos['casos'])} casos")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
