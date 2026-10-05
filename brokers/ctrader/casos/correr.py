"""A BANCADA dos casos do conector cTrader — corre TUDO o que ja' esta' provado, sem rede e sem chave.

O QUE ELA E'. A porta que corre os `*.casos.json` deste conector: DESCOBRE-os (nao os nomeia um a um — um
caso novo num ficheiro que ja' existe passa a correr sozinho), chama o modulo que cada qual exercita por um
MAPA NOMEADO (ficheiro -> modulo), compara o que saiu com o `esperado` do caso e, quando o caso produz uma
carga do contrato (`mercado`, `resolucao` ou `desfecho`), confere-a contra o esquema. Nao usa rede e nao
precisa de credencial nenhuma: e' a bancada que corre SEMPRE, inclusive antes da aprovacao.

UMA BANCADA QUE ESCONDE A DIVERGENCIA NAO SERVE. Cada caso imprime uma linha (`ok`/`DIVERGE`) com o nome, e o
resumo no fim diz quantos sao conformes e quantos divergem. Se houver UM divergente, a bancada sai com codigo
1 — divergir tem de doer. Ela NAO corrige o caso nem o modulo: reporta o que veio contra o que se esperava,
com o caminho EXACTO de cada diferenca.

A FORMA DOS FICHEIROS DE CASOS NAO E' A MESMA, e o corredor sabe-o ler em todos (nao se assume uma so'):
  * `ficha.casos.json` — a ficha de bancada sobre uma `ficha_base`, com o `sem` a apagar campos (a ausencia
    mede-se apagando); os casos correm `ler_ficha` sobre um ficheiro TEMPORARIO escrito a partir do caso
    (a ficha e' um documento, e le'-se como documento), e conferem `ok`/`motivo` e, quando pedido, campos da
    `Ficha` lida. O PAR DE CONTROLE do campo `desvio_maximo` vive aqui (forma boa passa, forma ma' recusa).
  * `identidade.casos.json` — por caso, a funcao PURA que ele exercita (`funcao`: `conferir_identidade` ou
    `conferir_direitos`) e os seus argumentos como DADO. Confere `ok`/`motivo` (a recusa NOMEADA) e, quando
    pedido, campos do `Veredicto` (`so_fecha`) e pedacos do `porque` (`porque_contem`) — uma recusa que nao
    nomeia os ids/de o direito nao serve. A identidade divergente e os direitos insuficientes vivem aqui.
  * `leitura.casos.json` — por caso, `dado` (o que a parte PURA `montar_leitura` recebe) e `esperado` (a carga
    do `mercado` que ela tem de produzir, ou a recusa nomeada). Na recusa comparam-se `motivo` E `porque`.
  * `ordens.casos.json` — por caso, blocos SOBRE UMA BASE (`manifesto_base`, `simbolo_base`, `boleta_base`,
    `pedido_base`) e `conferir` (campos da accao do venue e a `resolucao`); alem deles, as
    `checagens_de_fecho`, que exercitam o `fecho.py` (`decidir_fecho`/`decidir_abertura`). O `sem` apaga
    campos do pedido ANTES de traduzir (a ausencia mede-se apagando, nunca com um valor neutro).
  * `desfecho.casos.json` — por caso, o `evento` do venue sobre o `evento_base` (com `sem` a apagar campos) e
    a `resolucao_base`; casos de `via: silencio` (`desfecho_do_silencio`) e de `acontecimento_de_conta`;
    alem deles, as `checagens_do_contrato`, que provocam o esquema e conferem o veredicto e o motivo.
  * `sonda.casos.json` — por caso, a leitura PURA nomeada (`leitura`) sobre uma `linha_de_simbolo_base`, com
    `esperadoOk`/`excecao_esperada`; alem deles, as `checagens_de_manifesto`, que metem um INSTRUMENTO num
    manifesto completo e conferem o contrato.

A DESCOBERTA E' A PORTA DE ENTRADA. Os `*.casos.json` vem do DIRECTORIO, e o mapa nomeado
(`MODULOS_POR_FICHEIRO`) diz quem cada um exercita. Um caso novo num ficheiro que ja' existe corre sozinho;
um ficheiro NOVO sem corredor no mapa NAO se salta em silencio — a bancada PARA e di-lo, porque um ficheiro
que ninguem exercita e' trabalho por fazer, e nao trabalho conforme.

A RESOLUCAO PRE-ENVIO E' PARCIAL, E ISSO E' O ESTADO HONESTO. O `ordens.py` devolve os cinco campos da
resolucao so' quando o venue ja' deu os numeros dele (`numeros_do_venue`); sem eles, os campos que faltam
ficam AUSENTES e o contrato recusa a resolucao com `campo_obrigatorio_ausente` — dito pelo proprio ficheiro de
casos. A bancada nao trata essa recusa por um defeito: confere a carga quando ela esta' completa e, quando
esta' parcial, exige que o contrato a recuse pelo motivo certo. Qualquer outra recusa e' divergencia.

A PROVA NEGATIVA E' UM PASSO DA BANCADA, e NAO UM CASO. As bancadas irma's (`prova-ritmo.py`,
`prova-leitura.py`) injectam o DEFEITO e exigem a MESMA medicao VERMELHA, a NOMEAR o caso — a linha
`{"negativa": …}` sai no proprio `stdout`. Os casos em dado tinham as negativas num harness de SCRATCH, fora do
repositorio: o portao levava so' os verdes, e a negativa era uma sessao que ninguem repetia. Aqui as quatro
negativas (identidade divergente aceite, direitos aceitos, `passo` fixo no codigo, fecho do inexistente a mandar
ordem) correm DENTRO do corredor. Nao entram na CONTAGEM dos casos — sao a mesma prova ja' contada, corrida
outra vez com o defeito dentro: por isso o total verde fica o mesmo. O que a negativa acrescenta e' o VERMELHO;
se o defeito NAO puser o caso a DIVERGIR, a bancada di-lo pelo nome e sai com codigo 1.
"""

from __future__ import annotations

import json
import sys
import tempfile
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent.parent
sys.path.insert(0, str(RAIZ / "contracts" / "esqueleto"))
sys.path.insert(0, str(AQUI.parent))

from framing import validar, versao_vigente  # noqa: E402  (o caminho tem de ser posto primeiro)

import desfecho as modulo_desfecho  # noqa: E402
import fecho as modulo_fecho  # noqa: E402
import ficha as modulo_ficha  # noqa: E402
import identidade as modulo_identidade  # noqa: E402
import leitura as modulo_leitura  # noqa: E402
import ordens as modulo_ordens  # noqa: E402
import sonda as modulo_sonda  # noqa: E402
import transporte as modulo_transporte  # noqa: E402
from ctrader_api_client import enums as enums_da_biblioteca  # noqa: E402
import ctrader_api_client._internal.proto as proto_do_venue  # noqa: E402
from ctrader_api_client._internal.proto import (  # noqa: E402
    ProtoOAOrderErrorEvent,
    ProtoOATrader,
    ProtoOATraderRes,
)

#: A extensao que marca um ficheiro de casos. O nome do ficheiro SEM ela e' a chave do mapa de corredores.
SUFIXO_DOS_CASOS = ".casos.json"

#: O mapa NOMEADO ficheiro -> modulos que aquele ficheiro de casos exercita. E' o que torna a bancada
#: descobridora: um `*.casos.json` que aqui nao esteja NAO se ignora em silencio — a bancada PARA e di-lo.
MODULOS_POR_FICHEIRO = {
    "ficha": ("ficha",),
    "identidade": ("identidade",),
    "leitura": ("leitura",),
    "ordens": ("ordens", "fecho"),
    "desfecho": ("desfecho",),
    "sonda": ("sonda",),
    "transporte": ("transporte",),
}

#: As funcoes PURAS da `sonda.py` que um caso pode exercitar, pelo nome que o caso declara em `leitura`. E' o
#: que liga o caso a' funcao sem o caso ter codigo: o ficheiro de casos nomeia-a, e a bancada resolve-a aqui.
LEITURAS_DA_SONDA = {
    "unidade_das_distancias_do_simbolo": modulo_sonda.unidade_das_distancias_do_simbolo,
}

#: Os cinco campos que uma resolucao COMPLETA tem. O contrato exige-os todos; o pre-envio so' os traz quando o
#: venue ja' deu os numeros dele — e por isso a bancada distingue a resolucao completa da parcial declarada.
CAMPOS_OBRIGATORIOS_DA_RESOLUCAO = (
    "quantidade",
    "nocional",
    "margem_empenhada",
    "alavancagem_efectiva",
    "preco_de_liquidacao",
)

#: O nome com que os casos de ordens nomeiam, no `sem`, o objecto a que o campo pertence: o `sem` fala da
#: MENSAGEM inteira (`pedido.saldo`), e a bancada apaga-o do pedido que constroi antes de traduzir.
RAIZ_DO_PEDIDO = "pedido"

#: A marca do valor AUSENTE (a chave que nao esta' la'), que nao se confunde com um `None` do JSON. O contrato
#: nao tem `null` (D4): distinguir "ausente" de "veio nulo" e' o que faz a conferencia medir a coisa certa.
AUSENTE = object()


# -----------------------------------------------------------------------------------------------------------
# A LEITURA DOS BLOCOS. Ausente = zero; forma errada PARA a bancada (nunca se le' como zero em silencio).
# -----------------------------------------------------------------------------------------------------------


def _bloco(origem: Any, nome: str) -> dict[str, Any]:
    """Um bloco de campos declarado pelo caso. Ausente = zero campos; forma errada PARA a bancada."""
    if origem is None:
        return {}
    if not isinstance(origem, dict):
        raise ValueError(
            f"o bloco `{nome}` de um caso nao e' um objecto de campos (veio {origem!r}): uma forma errada "
            "nao se le' como zero campos — a bancada tem de parar, e nao medir outra coisa"
        )
    return origem


def _lista(origem: Any, nome: str) -> list[Any]:
    """Uma lista declarada pelo caso. Ausente = zero itens; forma errada PARA a bancada."""
    if origem is None:
        return []
    if not isinstance(origem, list):
        raise ValueError(
            f"a lista `{nome}` de um caso nao e' uma lista (veio {origem!r}): uma forma errada nao se le' "
            "como zero itens"
        )
    return origem


def _copiar(valor: Any) -> Any:
    """Copia PROFUNDA. Um caso nunca toca no objecto partilhado: sem copia, o primeiro que apaga um campo
    apagava-o para toda a bateria e os seguintes passavam a medir outra coisa."""
    if isinstance(valor, list):
        return [_copiar(item) for item in valor]
    if isinstance(valor, dict):
        return {chave: _copiar(item) for chave, item in valor.items()}
    return valor


def _fundir(base: Any, mudanca: Any) -> dict[str, Any]:
    """A mudanca do caso sobre a base, devolvendo SEMPRE objectos novos (a base nunca se altera).

    Uma LISTA e' substituida INTEIRA (nao fundida item a item): um caso que mexa numa posicao declara a
    posicao toda, e le-se o que o caso afirma — fundir por indice deixaria o dado meio caso e meio base.
    """
    saida: dict[str, Any] = _copiar(base) if isinstance(base, dict) else {}
    if not isinstance(mudanca, dict):
        return saida
    for chave, valor in mudanca.items():
        anterior = saida.get(chave)
        if isinstance(valor, dict) and isinstance(anterior, dict):
            saida[chave] = _fundir(anterior, valor)
        else:
            saida[chave] = _copiar(valor)
    return saida


def _apagar(obj: Any, caminho: str) -> None:
    """Apaga um caminho pontuado — para o caso que mede a AUSENCIA de um campo (nunca um valor neutro)."""
    partes = caminho.split(".")
    alvo = obj
    for passo in partes[:-1]:
        if isinstance(alvo, dict) and passo in alvo:
            alvo = alvo[passo]
        else:
            return
    if isinstance(alvo, dict) and partes[-1] in alvo:
        del alvo[partes[-1]]


def _por_caminho(obj: Any, caminho: str) -> Any:
    """O valor no caminho pontuado, ou `AUSENTE` quando a chave nao esta' la'."""
    alvo = obj
    for passo in caminho.split("."):
        if isinstance(alvo, dict) and passo in alvo:
            alvo = alvo[passo]
        else:
            return AUSENTE
    return alvo


def _texto(valor: Any) -> str:
    """O valor escrito para o relatorio: o `AUSENTE` di-lo, o resto sai em JSON."""
    if valor is AUSENTE:
        return "AUSENTE"
    return json.dumps(valor, ensure_ascii=False)


# -----------------------------------------------------------------------------------------------------------
# A CONFERENCIA. O que veio contra o que o caso esperava, com o caminho EXACTO de cada diferenca.
# -----------------------------------------------------------------------------------------------------------


def _diferentes(veio: Any, esperado: Any) -> bool:
    """O que veio e' diferente do esperado? Um `True` nao passa por um `1` (o booleano nao e' um inteiro)."""
    if isinstance(veio, bool) != isinstance(esperado, bool):
        return True
    return veio != esperado


def _comparar(veio: Any, esperado: Any, caminho: str) -> list[str]:
    """A carga inteira contra o esperado, campo a campo, com o caminho de cada diferenca (e dos que sobram)."""
    problemas: list[str] = []
    if isinstance(esperado, dict):
        if not isinstance(veio, dict):
            return [f"{caminho}: veio {_texto(veio)}, esperado um objecto"]
        for chave, valor in esperado.items():
            if chave not in veio:
                problemas.append(f"{caminho}.{chave}: AUSENTE, esperado {_texto(valor)}")
            else:
                problemas.extend(_comparar(veio[chave], valor, f"{caminho}.{chave}"))
        for chave in veio:
            if chave not in esperado:
                problemas.append(f"{caminho}.{chave}: veio {_texto(veio[chave])}, nao declarado no esperado")
        return problemas
    if isinstance(esperado, list):
        if not isinstance(veio, list):
            return [f"{caminho}: veio {_texto(veio)}, esperado uma lista"]
        if len(veio) != len(esperado):
            return [f"{caminho}: veio {len(veio)} itens, esperado {len(esperado)}"]
        for indice, valor_esperado in enumerate(esperado):
            problemas.extend(_comparar(veio[indice], valor_esperado, f"{caminho}[{indice}]"))
        return problemas
    if _diferentes(veio, esperado):
        problemas.append(f"{caminho}: veio {_texto(veio)}, esperado {_texto(esperado)}")
    return problemas


def _um_campo(alvo: Any, chave: str, esperado: Any, caminho: str) -> list[str]:
    """Um campo so', por nome: o que veio contra o que o caso esperava."""
    if not isinstance(alvo, dict) or chave not in alvo:
        return [f"{caminho}: AUSENTE, esperado {_texto(esperado)}"]
    if _diferentes(alvo[chave], esperado):
        return [f"{caminho}: veio {_texto(alvo[chave])}, esperado {_texto(esperado)}"]
    return []


# -----------------------------------------------------------------------------------------------------------
# O CONTRATO. A carga montada tem de passar o esquema — a mesma conferencia que o modulo faz antes de publicar.
# -----------------------------------------------------------------------------------------------------------


def _veredicto_do_contrato(tipo: str, identificador: str, carga: Any) -> dict[str, Any]:
    """A carga embrulhada no ENVELOPE, pelo mesmo caminho dos modulos, e o veredicto do contrato."""
    linha = json.dumps(
        {"contrato": versao_vigente(), "tipo": tipo, "id": identificador, "carga": carga},
        ensure_ascii=False,
    )
    return validar(linha)


def _conferir_no_contrato(tipo: str, identificador: str, carga: Any, rotulo: str) -> list[str]:
    """A carga tem de PASSAR o contrato: nao se prova — nem se publica — o que o contrato recusa."""
    veredicto = _veredicto_do_contrato(tipo, identificador, carga)
    if veredicto.get("veredicto") != "aceite":
        return [f"a {rotulo} nao passa o contrato: {veredicto.get('veredicto')}/{veredicto.get('motivo')}"]
    return []


def _conferir_resolucao(resolucao: Any) -> list[str]:
    """A resolucao contra o contrato, com a parcial do PRE-ENVIO tratada como o estado que ela e'.

    Completa, tem de PASSAR. Parcial, o contrato tem de a recusar exactamente com `campo_obrigatorio_ausente`
    (o venue ainda nao deu os numeros dele, e o ficheiro de casos di-lo): qualquer outra recusa — ou uma
    completa recusada — e' divergencia.
    """
    if not isinstance(resolucao, dict):
        return [f"a resolucao nao e' um objecto ({_texto(resolucao)})"]
    veredicto = _veredicto_do_contrato("resolucao", "resolucao", resolucao)
    if veredicto.get("veredicto") == "aceite":
        return []
    motivo = veredicto.get("motivo")
    faltam = [campo for campo in CAMPOS_OBRIGATORIOS_DA_RESOLUCAO if campo not in resolucao]
    if motivo == "campo_obrigatorio_ausente" and faltam:
        return []
    return [
        f"a resolucao nao passa o contrato ({veredicto.get('veredicto')}/{motivo}) e nao e' a parcial "
        f"declarada do pre-envio (faltam {faltam})"
    ]


# -----------------------------------------------------------------------------------------------------------
# OS CASOS DA FICHA (`ficha.casos.json` -> `ficha.py`). A ficha e' um DOCUMENTO: escreve-se o caso num
# ficheiro TEMPORARIO e le'-se pelo mesmo caminho da operacao (`ler_ficha`). Nao se confere a validacao a
# meio: confere-se o que a operacao ve' — a `Ficha` lida, ou a recusa com o motivo NOMEADO.
# -----------------------------------------------------------------------------------------------------------


def _caso_de_ficha(caso: dict[str, Any], ficha_base: dict[str, Any]) -> list[str]:
    """Um caso da ficha: a `ficha_base` com o `ficha` do caso por cima e o `sem` apagado -> `ler_ficha`."""
    ficha = _fundir(ficha_base, caso.get("ficha"))
    # O `sem` fala da ficha inteira (`desvio_maximo`), e a bancada apaga-o ANTES de a escrever — a ausencia
    # mede-se apagando, nunca com um valor neutro.
    raiz = {"ficha": ficha}
    for caminho in _lista(caso.get("sem"), "sem"):
        _apagar(raiz, f"ficha.{caminho}")
    ficha = raiz["ficha"]

    with tempfile.TemporaryDirectory() as pasta:
        caminho = Path(pasta) / "caso.conector.json"
        caminho.write_text(json.dumps(ficha, ensure_ascii=False), encoding="utf-8")
        resultado = modulo_ficha.ler_ficha(caminho)

    esperado_ok = caso["esperadoOk"] is True
    if isinstance(resultado, modulo_ficha.Recusa):
        if esperado_ok:
            return [f"ok=false, esperado=true ({resultado.motivo}: {resultado.porque})"]
        problemas: list[str] = []
        motivo_esperado = caso.get("motivo_esperado")
        if motivo_esperado is not None and resultado.motivo != motivo_esperado:
            problemas.append(f"motivo={resultado.motivo!r}, esperado={motivo_esperado!r}")
        return problemas
    if not esperado_ok:
        return [f"ok=true, esperado=false ({caso.get('motivo_esperado')})"]
    problemas = []
    for campo, esperado in _bloco(caso.get("conferir"), "conferir").items():
        veio = getattr(resultado, campo, AUSENTE)
        if isinstance(veio, tuple):  # a `Ficha` guarda `instrumentos` em tuplo; o caso declara lista
            veio = list(veio)
        if veio is AUSENTE or _diferentes(veio, esperado):
            problemas.append(f"{campo}: veio {_texto(veio)}, esperado {_texto(esperado)}")
    return problemas


def _correr_ficha(conteudo: dict[str, Any]) -> list[dict[str, Any]]:
    """Todos os casos da ficha."""
    ficha_base = _bloco(conteudo.get("ficha_base"), "ficha_base")
    entradas: list[dict[str, Any]] = []
    for caso in _lista(conteudo.get("casos"), "casos"):
        esperado_ok = caso["esperadoOk"] is True
        try:
            problemas = _caso_de_ficha(caso, ficha_base)
        except Exception as erro:  # noqa: BLE001  (um caso que levanta e' divergencia DELE, nao da bancada)
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": esperado_ok, "problemas": problemas})
    return entradas


# -----------------------------------------------------------------------------------------------------------
# OS CASOS DA IDENTIDADE (`identidade.casos.json` -> `identidade.py`). As duas funcoes PURAS da porta 8:
# `conferir_identidade` (o id da ficha esta' entre as contas do token?) e `conferir_direitos` (a conta pode
# operar/fechar?). O caso declara a FUNCAO e os argumentos; a bancada confere o `ok`, o `motivo` (a recusa
# NOMEADA) e, quando pedido, campos do `Veredicto` e pedacos do `porque`.
# -----------------------------------------------------------------------------------------------------------


def _caso_de_identidade(caso: dict[str, Any]) -> list[str]:
    """Um caso da porta de identidade: a funcao pura nomeada pelo caso e os seus argumentos como dado."""
    nome_da_funcao = caso["funcao"]
    if nome_da_funcao == "conferir_identidade":
        veredicto = modulo_identidade.conferir_identidade(
            _copiar(caso["declarado"]), _copiar(caso.get("devolvido")), caso["conta"]
        )
    elif nome_da_funcao == "conferir_direitos":
        veredicto = modulo_identidade.conferir_direitos(_copiar(caso["direitos"]), caso["conta"])
    else:
        raise ValueError(
            f"o caso declara a funcao `{nome_da_funcao}`, que a bancada nao conhece "
            f"(conferir_identidade, conferir_direitos): a bancada PARA em vez de o saltar em silencio"
        )

    esperado_ok = caso["esperadoOk"] is True
    if bool(veredicto.ok) != esperado_ok:
        return [
            f"ok={veredicto.ok}, esperado={esperado_ok} "
            f"({veredicto.motivo}: {veredicto.porque})"
        ]
    problemas: list[str] = []
    if not esperado_ok:
        motivo_esperado = caso.get("motivo_esperado")
        if motivo_esperado is not None and veredicto.motivo != motivo_esperado:
            problemas.append(f"motivo={veredicto.motivo!r}, esperado={motivo_esperado!r}")
    retrato = {
        "ok": veredicto.ok,
        "motivo": veredicto.motivo,
        "porque": veredicto.porque,
        "so_fecha": veredicto.so_fecha,
    }
    for campo, esperado in _bloco(caso.get("conferir"), "conferir").items():
        problemas.extend(_um_campo(retrato, campo, esperado, campo))
    if isinstance(veredicto.porque, str):
        for pedaco in _lista(caso.get("porque_contem"), "porque_contem"):
            if pedaco not in veredicto.porque:
                problemas.append(
                    f"o `porque` da recusa NAO nomeia {pedaco!r}: veio {veredicto.porque!r}"
                )
    elif caso.get("porque_contem"):
        problemas.append(f"o `porque` da recusa nao veio em texto: {veredicto.porque!r}")
    return problemas


def _correr_identidade(conteudo: dict[str, Any]) -> list[dict[str, Any]]:
    """Todos os casos da porta de identidade (identidade divergente, direitos insuficientes e os controles)."""
    entradas: list[dict[str, Any]] = []
    for caso in _lista(conteudo.get("casos"), "casos"):
        esperado_ok = caso["esperadoOk"] is True
        try:
            problemas = _caso_de_identidade(caso)
        except Exception as erro:  # noqa: BLE001 (um caso que levanta e' divergencia DELE, nao da bancada)
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": esperado_ok, "problemas": problemas})
    return entradas


# -----------------------------------------------------------------------------------------------------------
# OS CASOS DA LEITURA (`leitura.casos.json` -> `leitura.py`).
# -----------------------------------------------------------------------------------------------------------


def _caso_de_leitura(caso: dict[str, Any]) -> list[str]:
    """Um caso da leitura: `dado` -> `montar_leitura` -> compara com `esperado` e confere a carga."""
    esperado = caso["esperado"]
    resultado = modulo_leitura.montar_leitura(_copiar(caso["dado"]))
    recusou = isinstance(resultado, modulo_leitura.Recusa)
    if esperado["ok"] is True:
        if recusou:
            return [f"ok=false, esperado=true ({resultado.motivo}: {resultado.porque})"]
        problemas = _comparar(resultado, esperado["leitura"], "leitura")
        problemas.extend(
            _conferir_no_contrato(
                "mercado", f"mercado/{caso['dado']['instrumento']}", resultado, "leitura"
            )
        )
        return problemas
    if not recusou:
        return [f"ok=true, esperado=false ({esperado['motivo']})"]
    problemas = []
    if resultado.motivo != esperado["motivo"]:
        problemas.append(f"motivo={resultado.motivo!r}, esperado={esperado['motivo']!r}")
    if resultado.porque != esperado["porque"]:
        problemas.append(f"porque={resultado.porque!r}, esperado={esperado['porque']!r}")
    return problemas


def _correr_leitura(conteudo: dict[str, Any]) -> list[dict[str, Any]]:
    """Todos os casos da leitura do mercado."""
    entradas: list[dict[str, Any]] = []
    for caso in _lista(conteudo.get("casos"), "casos"):
        esperado_ok = False
        try:
            problemas = _caso_de_leitura(caso)
            esperado_ok = caso["esperado"]["ok"] is True
        except Exception as erro:  # noqa: BLE001  (um caso que levanta e' divergencia DELE, nao da bancada)
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("nome"), "esperado_ok": esperado_ok, "problemas": problemas})
    return entradas


# -----------------------------------------------------------------------------------------------------------
# OS CASOS DO DESCODIFICADOR DE FRONTEIRA (`transporte.casos.json` -> `transporte.py`). A LICAO DO D1: o caso
# injecta o ENUM da biblioteca (o marcador `{"biblioteca_enum": ..., "membro": ...}`), NUNCA a cadeia ja'
# descodificada — era esse o buraco que deixou passar o defeito. O corredor resolve o marcador no membro REAL.
# -----------------------------------------------------------------------------------------------------------


def _resolver_marcador(marcador: Any) -> Any:
    """`{"biblioteca_enum": "TradingMode", "membro": "ENABLED"}` -> o MEMBRO real da biblioteca.

    E' o que faz a fixture injectar o ENUM, e nao a cadeia: sem isto, o descodificador nunca era exercido (o
    defeito do D1 atravessou 85+27+6+7+19 provas porque elas levavam o valor JA' descodificado).
    """
    if not isinstance(marcador, dict) or "biblioteca_enum" not in marcador:
        raise ValueError(f"marcador de enum mal formado: {marcador!r}")
    classe = getattr(enums_da_biblioteca, marcador["biblioteca_enum"], None)
    if not isinstance(classe, type):
        raise ValueError(f"o caso nomeia o enum {marcador['biblioteca_enum']!r}, que a biblioteca nao tem")
    membro = marcador.get("membro")
    if not isinstance(membro, str) or membro not in classe.__members__:
        raise ValueError(f"o caso nomeia o membro {membro!r}, que {marcador['biblioteca_enum']} nao tem")
    return classe.__members__[membro]


def _objecto_do_caso(bloco: Any) -> Any:
    """Um bloco do caso -> um objecto de ATRIBUTOS, com os marcadores de enum resolvidos (e objectos aninhados).

    Usa `SimpleNamespace`: e' o que o `transporte.py` le' de um modelo da biblioteca — ATRIBUTOS, e nao um
    dicionario. Um `{"objecto": {...}}` aninhado vira outro objecto de atributos (a comissao).
    """
    if not isinstance(bloco, dict):
        raise ValueError(f"o bloco do objecto tem de ser um objecto de campos (veio {bloco!r})")
    campos: dict[str, Any] = {}
    for chave, valor in bloco.items():
        if isinstance(valor, dict) and "biblioteca_enum" in valor:
            campos[chave] = _resolver_marcador(valor)
        elif isinstance(valor, dict) and "objecto" in valor:
            campos[chave] = _objecto_do_caso(valor["objecto"])
        else:
            campos[chave] = valor
    objecto = SimpleNamespace(**campos)
    if "_leverage" in campos:
        objecto.get_leverage = lambda: campos["_leverage"]  # type: ignore[attr-defined]
    return objecto


def _resposta_do_trader(caso: dict[str, Any]) -> Any:
    """A `resposta` que o caso declara -> uma `ProtoOATraderRes` REAL (ou outra mensagem, no caso do negativo)."""
    bloco = _bloco(caso.get("resposta"), "resposta")
    if bloco.get("tipo") == "erro":
        return ProtoOAOrderErrorEvent()
    conta = bloco.get("ctid_trader_account_id")
    if not isinstance(conta, int) or isinstance(conta, bool):
        conta = 0
    digitos = bloco.get("money_digits")
    if not isinstance(digitos, int) or isinstance(digitos, bool):
        raise ValueError(f"o caso tem de declarar `money_digits` inteiro (veio {digitos!r})")
    return ProtoOATraderRes(
        ctid_trader_account_id=conta,
        trader=ProtoOATrader(ctid_trader_account_id=conta, money_digits=digitos),
    )


def _caso_de_transporte(caso: dict[str, Any]) -> list[str]:
    """Um caso do descodificador: injecta DADO (com o ENUM) e confere o que o conversor publicou."""
    alvo = caso.get("alvo")
    esperado = caso["esperado"]
    if alvo == "simbolo":
        simbolo = _objecto_do_caso(_bloco(caso.get("simbolo"), "simbolo"))
        resultado = modulo_transporte._simbolo_por_dentro(simbolo)  # noqa: SLF001
    elif alvo == "expoente_do_trader":
        resultado = modulo_transporte._expoente_do_trader(_resposta_do_trader(caso))  # noqa: SLF001
    elif alvo == "conta_por_dentro":
        conta = _objecto_do_caso(_bloco(caso.get("conta"), "conta"))
        resultado = modulo_transporte._conta_por_dentro(  # noqa: SLF001
            conta, caso.get("expoente"), caso.get("saldo_escalado")
        )
    elif alvo == "nome_do_proto":
        nome_da_classe = caso.get("classe")
        if not isinstance(nome_da_classe, str) or nome_da_classe == "":
            return [f"o caso nao nomeia a classe do proto ({nome_da_classe!r})"]
        classe = getattr(proto_do_venue, nome_da_classe, None)
        if not isinstance(classe, type):
            return [f"classe de proto desconhecida ou invalida: {nome_da_classe!r}"]
        resultado = modulo_transporte._nome_do_proto(caso.get("valor_int"), classe)  # noqa: SLF001
    elif alvo == "status_da_ordem":
        resultado = modulo_transporte._status_da_ordem(caso.get("valor_int"))  # noqa: SLF001
    else:
        return [f"alvo desconhecido no caso: {alvo!r}"]

    if esperado["ok"] is True:
        if isinstance(resultado, modulo_transporte.Resultado):
            return [f"recusou com {resultado.motivo!r} ({resultado.porque}), esperado um valor publicado"]
        if "valor" in esperado:
            return _um_campo({"valor": resultado}, "valor", esperado["valor"], "valor")
        # Os campos esperados podem vir em caminho pontuado (`comissao.type`): le'-se pelo caminho.
        problemas_campos: list[str] = []
        for caminho, valor_esperado in esperado["campos"].items():
            veio = _por_caminho(resultado, caminho)
            if veio is AUSENTE:
                problemas_campos.append(f"{caminho}: AUSENTE, esperado {_texto(valor_esperado)}")
            elif _diferentes(veio, valor_esperado):
                problemas_campos.append(f"{caminho}: veio {_texto(veio)}, esperado {_texto(valor_esperado)}")
        return problemas_campos
    if not isinstance(resultado, modulo_transporte.Resultado):
        return [f"publicou {resultado!r}, esperado a recusa {esperado['motivo']!r}"]
    problemas: list[str] = []
    if resultado.motivo != esperado["motivo"]:
        problemas.append(f"motivo={resultado.motivo!r}, esperado={esperado['motivo']!r}")
    contem = esperado.get("porque_contem")
    if contem is not None and contem not in resultado.porque:
        problemas.append(f"porque nao contem {contem!r}: {resultado.porque!r}")
    return problemas


def _caso_do_transporte_por_nome(nome: str) -> dict[str, Any]:
    """O caso de `transporte.casos.json` com esse nome, com a base do ficheiro ja' fundida — para as negativas."""
    conteudo = _conteudo_dos_casos("transporte")
    base = _bloco(conteudo.get("simbolo_base"), "simbolo_base")
    for caso in _lista(conteudo.get("casos"), "casos"):
        if caso.get("caso") == nome:
            preparado = dict(caso)
            preparado["simbolo"] = _fundir(base, caso.get("simbolo"))
            return preparado
    raise ValueError(f"nenhum caso de transporte se chama {nome!r}")


def _correr_transporte(conteudo: dict[str, Any]) -> list[dict[str, Any]]:
    """Todos os casos do descodificador de fronteira (com a base do ficheiro fundida em cada simbolo)."""
    base = _bloco(conteudo.get("simbolo_base"), "simbolo_base")
    entradas: list[dict[str, Any]] = []
    for caso in _lista(conteudo.get("casos"), "casos"):
        esperado_ok = False
        preparado = dict(caso)
        if caso.get("alvo") == "simbolo":
            preparado["simbolo"] = _fundir(base, caso.get("simbolo"))
        try:
            problemas = _caso_de_transporte(preparado)
            esperado_ok = caso["esperado"]["ok"] is True
        except Exception as erro:  # noqa: BLE001  (um caso que levanta e' divergencia DELE, nao da bancada)
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": esperado_ok, "problemas": problemas})
    return entradas


# -----------------------------------------------------------------------------------------------------------
# OS CASOS DAS ORDENS E DO FECHO (`ordens.casos.json` -> `ordens.py` + `fecho.py`).
# -----------------------------------------------------------------------------------------------------------


def _pedido_do_caso(
    caso: dict[str, Any],
    manifesto_base: dict[str, Any],
    simbolo_base: dict[str, Any],
    boleta_base: dict[str, Any],
    pedido_base: dict[str, Any],
) -> dict[str, Any]:
    """A mensagem que o `traduzir` recebe: os blocos SOBRE A BASE, o `pedido` e, por fim, o `sem` apagado."""
    pedido: dict[str, Any] = {
        "boleta": _fundir(boleta_base, caso.get("boleta")),
        "manifesto": _fundir(manifesto_base, caso.get("manifesto")),
        "simbolo": _fundir(simbolo_base, caso.get("simbolo")),
    }
    for chave, valor in pedido_base.items():
        pedido[chave] = _copiar(valor)
    for chave, valor in _bloco(caso.get("pedido"), "pedido").items():
        pedido[chave] = _copiar(valor)
    raiz = {RAIZ_DO_PEDIDO: pedido}
    for caminho in _lista(caso.get("sem"), "sem"):
        _apagar(raiz, caminho)
    return pedido


def _caso_de_ordem(caso: dict[str, Any], bases: tuple[Any, Any, Any, Any]) -> list[str]:
    """Um caso da traducao: a boleta -> `traduzir` -> ok/motivo e os campos da accao e da resolucao."""
    manifesto_base, simbolo_base, boleta_base, pedido_base = bases
    pedido = _pedido_do_caso(caso, manifesto_base, simbolo_base, boleta_base, pedido_base)
    resultado = modulo_ordens.traduzir(pedido)
    esperado_ok = caso["esperadoOk"] is True
    if isinstance(resultado, modulo_ordens.Recusa):
        if esperado_ok:
            return [f"ok=false, esperado=true ({resultado.motivo}: {resultado.porque})"]
        problemas = []
        motivo_esperado = caso.get("motivo_esperado")
        if motivo_esperado is not None and resultado.motivo != motivo_esperado:
            problemas.append(f"motivo={resultado.motivo!r}, esperado={motivo_esperado!r}")
        return problemas
    if not esperado_ok:
        return ["ok=true, esperado=false"]
    problemas = []
    for caminho, esperado in _bloco(caso.get("conferir"), "conferir").items():
        if caminho == "resolucao":
            for sub, esperado_sub in _bloco(esperado, "conferir.resolucao").items():
                problemas.extend(_um_campo(resultado.resolucao, sub, esperado_sub, f"resolucao.{sub}"))
        else:
            problemas.extend(_um_campo(resultado.accao, caminho, esperado, caminho))
    problemas.extend(_conferir_resolucao(resultado.resolucao))
    return problemas


def _caso_de_fecho(caso: dict[str, Any]) -> list[str]:
    """Uma checagem do fecho: `decidir_fecho` (e, quando o caso o pede, `decidir_abertura`)."""
    pedido = _copiar(caso["pedido"])
    esperado = caso["esperado"]
    decisao = modulo_fecho.decidir_fecho(pedido)
    problemas: list[str] = []
    if decisao.acao != esperado["acao"]:
        problemas.append(f"acao={decisao.acao!r}, esperado={esperado['acao']!r}")
    if "motivo" in esperado and decisao.motivo != esperado["motivo"]:
        problemas.append(f"motivo={decisao.motivo!r}, esperado={esperado['motivo']!r}")
    tem_ordem = decisao.ordem is not None
    if "tem_ordem" in esperado and tem_ordem != esperado["tem_ordem"]:
        problemas.append(f"tem_ordem={tem_ordem}, esperado={esperado['tem_ordem']}")
    for campo in ("positionId", "tradeSide", "volume", "orderType"):
        if campo in esperado:
            if not tem_ordem:
                problemas.append(f"{campo}: a decisao nao trouxe ordem, esperado {_texto(esperado[campo])}")
            else:
                problemas.extend(_um_campo(decisao.ordem, campo, esperado[campo], campo))
    if "esperado_abertura" in caso:
        esperado_abertura = caso["esperado_abertura"]
        abertura = modulo_fecho.decidir_abertura(pedido)
        if abertura.acao != esperado_abertura["acao"]:
            problemas.append(f"abertura.acao={abertura.acao!r}, esperado={esperado_abertura['acao']!r}")
        if "motivo" in esperado_abertura and abertura.motivo != esperado_abertura["motivo"]:
            problemas.append(
                f"abertura.motivo={abertura.motivo!r}, esperado={esperado_abertura['motivo']!r}"
            )
    return problemas


def _caso_de_sequencia_de_fecho(caso: dict[str, Any]) -> list[str]:
    """A SEQUENCIA de aberturas/fechos sobre uma fixture de posicoes que evolui (SC-017 no offline).

    Cada `abrir` corre `decidir_abertura` e POE a posicao declarada na lista; cada `fechar` corre `decidir_fecho`
    com a lista ATE' ali, exige a ordem com o `positionId` da posicao, e TIRA-a (o venue fecha-a). O ultimo passo,
    `fechar_o_inexistente`, corre `decidir_fecho` sobre a lista ja' vazia e exige `nada` SEM ordem. No fim
    conferem-se as contagens e a lista vazia — e' o que prova que uma sequencia nao deixa posicao a tras, nem
    inventa uma ordem para fechar o que nao existe.
    """
    posicoes: list[dict[str, Any]] = []
    aberturas = 0
    fechos = 0
    fechos_com_ordem = 0
    decisao_do_inexistente: Any = None

    def _pedido_abertura() -> dict[str, Any]:
        return {
            "conta": caso["conta"],
            "instrumento": caso["instrumento"],
            "direitos_da_conta": caso["direitos_da_conta"],
            "modo_do_simbolo": caso["modo_do_simbolo"],
        }

    def _pedido_fecho() -> dict[str, Any]:
        pedido = {
            "conta": caso["conta"],
            "instrumento": caso["instrumento"],
            "symbol_id": caso["symbol_id"],
            "posicoes": _copiar(posicoes),
        }
        marca = caso.get("marca_do_cliente")
        if isinstance(marca, str) and marca != "":
            pedido["marca_do_cliente"] = marca
        return pedido

    for indice, passo in enumerate(_lista(caso.get("passos"), "passos")):
        if "abrir" in passo:
            posicao = _copiar(passo["abrir"])
            posicao.setdefault("symbol_id", caso["symbol_id"])
            decisao = modulo_fecho.decidir_abertura(_pedido_abertura())
            if decisao.acao != modulo_fecho.ACAO_ABRIR:
                return [
                    f"passo {indice}: a abertura {posicao.get('posicao')} foi {decisao.acao!r}, "
                    f"esperado `abrir` ({decisao.motivo}: {decisao.porque})"
                ]
            posicoes.append(posicao)
            aberturas += 1
        elif "fechar" in passo:
            alvo = passo["fechar"]["posicao"]
            decisao = modulo_fecho.decidir_fecho(_pedido_fecho())
            if decisao.acao != modulo_fecho.ACAO_FECHAR:
                return [
                    f"passo {indice}: o fecho da posicao {alvo} foi {decisao.acao!r}, esperado `fechar` "
                    f"({decisao.motivo}: {decisao.porque})"
                ]
            if decisao.ordem is None or decisao.ordem.get("positionId") != alvo:
                return [
                    f"passo {indice}: o fecho nao trouxe a ordem POR POSICAO {alvo}: {decisao.ordem!r}"
                ]
            posicoes = [p for p in posicoes if p.get("posicao") != alvo]
            fechos += 1
            fechos_com_ordem += 1
        elif "fechar_o_inexistente" in passo:
            decisao_do_inexistente = modulo_fecho.decidir_fecho(_pedido_fecho())

    esperado = caso["esperado"]
    problemas: list[str] = []
    if aberturas != esperado["aberturas"]:
        problemas.append(f"aberturas={aberturas}, esperado={esperado['aberturas']}")
    if fechos != esperado["fechos"]:
        problemas.append(f"fechos={fechos}, esperado={esperado['fechos']}")
    if fechos_com_ordem != esperado["fechos_com_ordem"]:
        problemas.append(f"fechos_com_ordem={fechos_com_ordem}, esperado={esperado['fechos_com_ordem']}")
    if len(posicoes) != esperado["posicoes_no_fim"]:
        problemas.append(
            f"posicoes no fim={len(posicoes)}, esperado={esperado['posicoes_no_fim']} "
            f"(a sequencia tinha de desmontar tudo: {posicoes!r})"
        )

    esperado_inexistente = _bloco(esperado.get("fecho_do_inexistente"), "fecho_do_inexistente")
    if decisao_do_inexistente is None:
        problemas.append("o passo `fechar_o_inexistente` nao correu: o caso nao mediu o SC-017")
    else:
        if decisao_do_inexistente.acao != esperado_inexistente["acao"]:
            problemas.append(
                f"fecho do inexistente: acao={decisao_do_inexistente.acao!r}, "
                f"esperado={esperado_inexistente['acao']!r}"
            )
        if decisao_do_inexistente.motivo != esperado_inexistente["motivo"]:
            problemas.append(
                f"fecho do inexistente: motivo={decisao_do_inexistente.motivo!r}, "
                f"esperado={esperado_inexistente['motivo']!r}"
            )
        tem_ordem = decisao_do_inexistente.ordem is not None
        if tem_ordem != esperado_inexistente["tem_ordem"]:
            problemas.append(
                f"fecho do inexistente: tem_ordem={tem_ordem}, esperado={esperado_inexistente['tem_ordem']} "
                "(um fecho sem posicao NAO pode trazer ordem — abriria por lado contrario, RN-CT34)"
            )
    return problemas


def _correr_ordens(conteudo: dict[str, Any]) -> list[dict[str, Any]]:
    """Todos os casos das ordens e as checagens do fecho."""
    bases = (
        _bloco(conteudo.get("manifesto_base"), "manifesto_base"),
        _bloco(conteudo.get("simbolo_base"), "simbolo_base"),
        _bloco(conteudo.get("boleta_base"), "boleta_base"),
        _bloco(conteudo.get("pedido_base"), "pedido_base"),
    )
    entradas: list[dict[str, Any]] = []
    for caso in _lista(conteudo.get("casos"), "casos"):
        esperado_ok = caso["esperadoOk"] is True
        try:
            problemas = _caso_de_ordem(caso, bases)
        except Exception as erro:  # noqa: BLE001
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": esperado_ok, "problemas": problemas})
    for caso in _lista(conteudo.get("checagens_de_fecho"), "checagens_de_fecho"):
        try:
            problemas = _caso_de_fecho(caso)
        except Exception as erro:  # noqa: BLE001
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": True, "problemas": problemas})
    for caso in _lista(conteudo.get("sequencias_de_fecho"), "sequencias_de_fecho"):
        try:
            problemas = _caso_de_sequencia_de_fecho(caso)
        except Exception as erro:  # noqa: BLE001
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": True, "problemas": problemas})
    return entradas


# -----------------------------------------------------------------------------------------------------------
# OS CASOS DO DESFECHO (`desfecho.casos.json` -> `desfecho.py`), e as provocacoes ao contrato.
# -----------------------------------------------------------------------------------------------------------


def _evento_do_caso(caso: dict[str, Any], evento_base: dict[str, Any]) -> dict[str, Any]:
    """O evento do venue: o `evento` do caso sobre o `evento_base`, com o `sem` apagado."""
    evento = _fundir(evento_base, caso.get("evento"))
    for caminho in _lista(caso.get("sem"), "sem"):
        _apagar(evento, caminho)
    return evento


def _caso_de_acontecimento(caso: dict[str, Any], evento_base: dict[str, Any]) -> list[str]:
    """Um acontecimento de CONTA (swap/deposito/bonus): nao e' desfecho de ordem nenhum."""
    evento = _evento_do_caso(caso, evento_base)
    if not modulo_desfecho.e_acontecimento_de_conta(evento):
        return ["e_acontecimento_de_conta=false, esperado=true"]
    problemas: list[str] = []
    registo = modulo_desfecho.acontecimento_de_conta(evento)
    if registo.get("tipo") != "acontecimento_de_conta":
        problemas.append(f"o registo do acontecimento veio com tipo {_texto(registo.get('tipo'))}")
    try:
        modulo_desfecho.classificar_ordem(evento)
        problemas.append("classificar_ordem NAO levantou AcontecimentoDeConta num evento de conta")
    except modulo_desfecho.AcontecimentoDeConta:
        pass
    return problemas


def _conferir_desfecho(caso: dict[str, Any], desfecho: dict[str, Any]) -> list[str]:
    """O desfecho montado contra o que o caso esperava, e contra o contrato."""
    problemas: list[str] = []
    classificacao = desfecho.get("classificacao")
    if "classificacao_esperada" in caso and classificacao != caso["classificacao_esperada"]:
        problemas.append(f"classificacao={classificacao!r}, esperado={caso['classificacao_esperada']!r}")
    if "motivo_esperado" in caso and desfecho.get("motivo") != caso["motivo_esperado"]:
        problemas.append(f"motivo={desfecho.get('motivo')!r}, esperado={caso['motivo_esperado']!r}")
    if classificacao == "recusado" and "motivo" not in desfecho:
        problemas.append("a recusa nao trouxe motivo")
    if classificacao != "recusado" and "motivo" in desfecho:
        problemas.append("uma classificacao que nao e' recusa trouxe motivo")
    for caminho, esperado in _bloco(caso.get("conferir"), "conferir").items():
        veio = _por_caminho(desfecho, caminho)
        if veio is AUSENTE or _diferentes(veio, esperado):
            problemas.append(f"{caminho}: veio {_texto(veio)}, esperado {_texto(esperado)}")
    problemas.extend(_conferir_no_contrato("desfecho", "desfecho", desfecho, "desfecho"))
    return problemas


def _caso_de_desfecho(
    caso: dict[str, Any], evento_base: dict[str, Any], resolucao_base: dict[str, Any]
) -> list[str]:
    """Um caso do desfecho: `silencio`, `acontecimento_de_conta`, ou o evento classificado."""
    if caso.get("acontecimento_de_conta_esperado") is True:
        return _caso_de_acontecimento(caso, evento_base)
    if caso.get("via") == "silencio":
        desfecho = modulo_desfecho.desfecho_do_silencio(
            _copiar(resolucao_base), caso["prazo_declarado_ms"]
        )
        return _conferir_desfecho(caso, desfecho)
    desfecho = modulo_desfecho.desfecho_do_evento(
        _evento_do_caso(caso, evento_base), _copiar(resolucao_base)
    )
    return _conferir_desfecho(caso, desfecho)


def _correr_desfecho(conteudo: dict[str, Any]) -> list[dict[str, Any]]:
    """Todos os casos do desfecho, e as checagens que provocam o contrato."""
    evento_base = _bloco(conteudo.get("evento_base"), "evento_base")
    resolucao_base = _bloco(conteudo.get("resolucao_base"), "resolucao_base")
    entradas: list[dict[str, Any]] = []
    for caso in _lista(conteudo.get("casos"), "casos"):
        try:
            problemas = _caso_de_desfecho(caso, evento_base, resolucao_base)
        except Exception as erro:  # noqa: BLE001
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": True, "problemas": problemas})
    for caso in _lista(conteudo.get("checagens_do_contrato"), "checagens_do_contrato"):
        try:
            veredicto = _veredicto_do_contrato("desfecho", "desfecho", caso["carga"])
            problemas = []
            if veredicto.get("veredicto") != caso["veredicto_esperado"]:
                problemas.append(
                    f"veredicto={veredicto.get('veredicto')!r}, esperado={caso['veredicto_esperado']!r}"
                )
            elif veredicto.get("motivo") != caso["motivo_esperado"]:
                problemas.append(
                    f"motivo={veredicto.get('motivo')!r}, esperado={caso['motivo_esperado']!r}"
                )
        except Exception as erro:  # noqa: BLE001
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": False, "problemas": problemas})
    return entradas


# -----------------------------------------------------------------------------------------------------------
# OS CASOS DA SONDA (`sonda.casos.json` -> `sonda.py`): a unidade das distancias minimas, e o contrato do
# instrumento. A leitura e' PURA (`unidade_das_distancias_do_simbolo`); a checagem do manifesto confere um
# INSTRUMENTO dentro de um manifesto COMPLETO — e o manifesto completo e' o fixture que o proprio conector ja'
# usa nos casos das ordens, e nao um manifesto inventado em codigo (RN-C1: nenhum numero do venue no codigo).
# -----------------------------------------------------------------------------------------------------------


def _manifesto_de_referencia() -> dict[str, Any]:
    """O manifesto COMPLETO que serve de fixture, lido dos casos das ordens (o mesmo conector, o mesmo dia)."""
    caminho = AQUI / ("ordens" + SUFIXO_DOS_CASOS)
    with caminho.open(encoding="utf-8") as aberto:
        return _bloco(json.load(aberto).get("manifesto_base"), "manifesto_base")


def _caso_de_sonda(caso: dict[str, Any], linha_base: dict[str, Any]) -> list[str]:
    """Um caso da sonda: a leitura PURA nomeada pelo caso, sobre a linha do simbolo montada na base."""
    nome_da_leitura = caso["leitura"]
    if nome_da_leitura not in LEITURAS_DA_SONDA:
        raise ValueError(
            f"o caso declara a leitura `{nome_da_leitura}`, que a bancada nao conhece "
            f"({', '.join(sorted(LEITURAS_DA_SONDA))}): a bancada PARA em vez de a saltar em silencio"
        )
    funcao = LEITURAS_DA_SONDA[nome_da_leitura]
    linha = _fundir(linha_base, caso.get("linha_do_simbolo"))
    esperado_ok = caso["esperadoOk"] is True
    try:
        veio = funcao(linha)
    except Exception as erro:  # noqa: BLE001  (a sonda RECUSA levantando: e' o comportamento medido)
        if esperado_ok:
            return [f"a leitura levantou e esperava-se um valor: {type(erro).__name__}: {erro}"]
        excecao_esperada = caso.get("excecao_esperada")
        if excecao_esperada is not None and type(erro).__name__ != excecao_esperada:
            return [f"levantou {type(erro).__name__}, esperado {excecao_esperada}"]
        return []
    if not esperado_ok:
        return [f"a leitura devolveu {_texto(veio)}, esperado uma excecao ({caso.get('excecao_esperada')})"]
    problemas: list[str] = []
    for chave, esperado in _bloco(caso.get("conferir"), "conferir").items():
        if _diferentes(veio, esperado):
            problemas.append(f"{chave}: veio {_texto(veio)}, esperado {_texto(esperado)}")
    return problemas


def _montar_manifesto_da_fixture(base: dict[str, Any], simbolo: dict[str, Any]) -> dict[str, Any]:
    """Monta o manifesto pela funcao PURA `sonda.montar_manifesto`, a partir da fixture do caso.

    Os `nomes_por_id` e os `precos` do ficheiro de casos tem chaves TEXTUAIS (JSON); a funcao espera-as
    INTEIRAS (o `symbol_id`). A conversao e' aqui, e e' uma so'.
    """
    return modulo_sonda.montar_manifesto(
        nome_do_conector=base["nome_do_conector"],
        versao_do_conector=base["versao_do_conector"],
        versao_do_contrato=versao_vigente(),
        conta=_copiar(base["conta"]),
        nomes_por_id={int(chave): valor for chave, valor in base["nomes_por_id"].items()},
        simbolos=[simbolo],
        precos={int(chave): valor for chave, valor in base["precos"].items()},
        profundidade=base["profundidade"],
        desvio_maximo_pct=base["desvio_maximo_pct"],
        tipos_de_ordem=list(base["tipos_de_ordem"]),
    )


def _caso_do_manifesto(caso: dict[str, Any], base: dict[str, Any]) -> list[str]:
    """Um caso do MANIFESTO MONTADO (T021): a fixture muda e o manifesto SEGUINTE reflecte-a.

    Sem `mudanca`, monta o manifesto da fixture e confere os campos pedidos. Com `mudanca`, monta DOIS
    manifestos pela MESMA funcao (o de antes e o de depois da mudanca da fixture) e exige que cada um reflicta
    o seu passo E que os campos de `mudou` tenham MESMO mudado — e' a prova de que o valor sai dos DADOS e nao
    do codigo (SC-015 no espirito, US1 cenario 2). Nos dois casos, o manifesto montado tem de passar o contrato.
    """
    simbolo_base = _bloco(base.get("simbolo_base"), "simbolo_base")
    simbolo_mudado = _fundir(simbolo_base, caso.get("mudanca"))
    manifesto_antes = _montar_manifesto_da_fixture(base, simbolo_base)
    manifesto_depois = _montar_manifesto_da_fixture(base, simbolo_mudado)

    problemas: list[str] = []
    if "conferir" in caso:
        instrumento = manifesto_antes["instrumentos"][0]
        for campo, esperado in _bloco(caso.get("conferir"), "conferir").items():
            problemas.extend(_um_campo(instrumento, campo, esperado, f"instrumento.{campo}"))
    if "conferir_antes" in caso:
        instrumento = manifesto_antes["instrumentos"][0]
        for campo, esperado in _bloco(caso.get("conferir_antes"), "conferir_antes").items():
            problemas.extend(_um_campo(instrumento, campo, esperado, f"antes.instrumento.{campo}"))
    if "conferir_depois" in caso:
        instrumento = manifesto_depois["instrumentos"][0]
        for campo, esperado in _bloco(caso.get("conferir_depois"), "conferir_depois").items():
            problemas.extend(_um_campo(instrumento, campo, esperado, f"depois.instrumento.{campo}"))
    for campo in _lista(caso.get("mudou"), "mudou"):
        de_antes = manifesto_antes["instrumentos"][0].get(campo, AUSENTE)
        de_depois = manifesto_depois["instrumentos"][0].get(campo, AUSENTE)
        if de_antes is AUSENTE or de_depois is AUSENTE:
            problemas.append(f"`{campo}` ausente no manifesto: nao se pode medir a mudanca")
        elif not _diferentes(de_antes, de_depois):
            problemas.append(
                f"`{campo}` NAO mudou com a fixture ({_texto(de_depois)}): o manifesto nao reflectiu a "
                "mudanca — o valor estaria fixo no codigo"
            )
    problemas.extend(_conferir_no_contrato("manifesto", "manifesto", manifesto_antes, "manifesto (antes)"))
    problemas.extend(_conferir_no_contrato("manifesto", "manifesto", manifesto_depois, "manifesto (depois)"))
    return problemas


def _correr_sonda(conteudo: dict[str, Any]) -> list[dict[str, Any]]:
    """Todos os casos da sonda, e as checagens do instrumento contra o contrato do manifesto."""
    linha_base = _bloco(conteudo.get("linha_de_simbolo_base"), "linha_de_simbolo_base")
    manifesto_base = _manifesto_de_referencia()
    montado_base = _bloco(conteudo.get("manifesto_montado_base"), "manifesto_montado_base")
    entradas: list[dict[str, Any]] = []
    for caso in _lista(conteudo.get("casos"), "casos"):
        esperado_ok = caso["esperadoOk"] is True
        try:
            problemas = _caso_de_sonda(caso, linha_base)
        except Exception as erro:  # noqa: BLE001
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": esperado_ok, "problemas": problemas})
    for caso in _lista(conteudo.get("casos_do_manifesto"), "casos_do_manifesto"):
        try:
            problemas = _caso_do_manifesto(caso, montado_base)
        except Exception as erro:  # noqa: BLE001
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": True, "problemas": problemas})
    for caso in _lista(conteudo.get("checagens_de_manifesto"), "checagens_de_manifesto"):
        esperado = caso["esperado"]
        try:
            manifesto = _copiar(manifesto_base)
            manifesto["instrumentos"] = [_copiar(caso["instrumento"])]
            veredicto = _veredicto_do_contrato("manifesto", "manifesto", manifesto)
            problemas = []
            if veredicto.get("veredicto") != esperado["veredicto"]:
                problemas.append(
                    f"veredicto={veredicto.get('veredicto')!r}, esperado={esperado['veredicto']!r}"
                )
            elif "motivo" in esperado and veredicto.get("motivo") != esperado["motivo"]:
                problemas.append(f"motivo={veredicto.get('motivo')!r}, esperado={esperado['motivo']!r}")
        except Exception as erro:  # noqa: BLE001
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append(
            {
                "caso": caso.get("caso"),
                "esperado_ok": esperado["veredicto"] == "aceite",
                "problemas": problemas,
            }
        )
    return entradas


# -----------------------------------------------------------------------------------------------------------
# AS NEGATIVAS DOS CASOS EM DADO (a regra da casa: uma bancada que nunca reprovou nao mediu nada).
#
# Cada uma injecta o DEFEITO que o caso afirma excluido, corre a MESMA prova ja' contada, e imprime no proprio
# `stdout` a linha `{"negativa": …}` com o que o caso fez (`VERMELHO`/`VERDE`). O defeito e' reposto em
# `finally`, sempre. NAO sao casos novos: nao contam para os 85 — a mudanca e' aditiva e o total verde fica o
# mesmo. Sao a garantia de que os 85 medem a REGRA, e nao o dado: sem este vermelho, um caso verde prova so' a
# fixture.
# -----------------------------------------------------------------------------------------------------------


def _conteudo_dos_casos(nome: str) -> dict[str, Any]:
    """O conteudo cru de um `*.casos.json` deste directorio (as negativas leem o MESMO dado que os casos)."""
    with (AQUI / f"{nome}{SUFIXO_DOS_CASOS}").open(encoding="utf-8") as aberto:
        return json.load(aberto)


def _caso_da_identidade_por_motivo(motivo: str) -> dict[str, Any]:
    """O primeiro caso de identidade que espera a recusa `motivo` — e' nele que a negativa injecta o defeito."""
    for caso in _lista(_conteudo_dos_casos("identidade").get("casos"), "casos"):
        if caso.get("motivo_esperado") == motivo:
            return caso
    raise ValueError(
        f"nenhum caso de identidade espera a recusa {motivo!r}: a negativa nao tem onde injectar o defeito"
    )


def _anunciar_negativa(nome: str, rotulo_do_caso: str, problemas_do_caso: list[str], caso: str) -> list[str]:
    """A linha da negativa no `stdout` e o problema da bancada quando o defeito NAO a puser VERMELHA.

    O `rotulo_do_caso` compoe a chave (`o_caso_<rotulo>_ficou`), tal como as bancadas de ritmo/leitura — o nome
    do caso vigiado sai na propria chave, e nao numa prosa. Um caso VERDE com o defeito dentro e' a negativa a
    FALHAR: se ela nao reprova, a bancada mede o dado, e nao a regra.
    """
    print(
        json.dumps(
            {
                "negativa": nome,
                f"o_caso_{rotulo_do_caso}_ficou": "VERMELHO" if problemas_do_caso else "VERDE",
                "primeiro_problema": problemas_do_caso[0] if problemas_do_caso else None,
            },
            ensure_ascii=False,
        )
    )
    if problemas_do_caso:
        return []
    return [
        f"a negativa `{nome}` NAO ficou VERMELHA: com o defeito dentro, o caso `{caso}` continuou VERDE — "
        "a bancada mede o dado, e nao a regra. (Um caso que nunca reprovou nao mediu nada.)"
    ]


def negativa_identidade_divergente_aceite() -> list[str]:
    """O DEFEITO: a comparacao de identidade regride a «aceita qualquer id». O caso divergente TEM de ficar VERMELHO.

    O caso afirma a RECUSA `identidade_da_conta_divergente`. Tira-se a comparacao — a funcao PURA que ele
    exercita passa a aceitar toda a conta — e exige-se que o MESMO caso DIVIRJA. Sem este vermelho, o verde do
    caso prova o `devolvido` da fixture, e nao a porta de identidade (FR-049 / RN-CT8).
    """
    caso = _caso_da_identidade_por_motivo("identidade_da_conta_divergente")
    original = modulo_identidade.conferir_identidade

    def _aceita_qualquer_id(*_: Any, **__: Any) -> Any:
        return modulo_identidade.Veredicto(
            ok=True, motivo=None, porque="DEFEITO injectado: a identidade aceita qualquer id"
        )

    modulo_identidade.conferir_identidade = _aceita_qualquer_id  # type: ignore[assignment]
    try:
        problemas_do_caso = _caso_de_identidade(caso)
    finally:
        modulo_identidade.conferir_identidade = original  # type: ignore[assignment]
    return _anunciar_negativa(
        "identidade-divergente-aceite", "identidade", problemas_do_caso, caso["caso"]
    )


def negativa_direitos_insuficientes_aceitos() -> list[str]:
    """O DEFEITO: a comparacao de direitos regride a «aceita qualquer direito». O caso NO_TRADING TEM de ficar VERMELHO.

    O caso afirma a recusa `sem_direito_de_operar`. Aceitando-se qualquer direito, um processo que nao consegue
    desfazer posicao ARRANCARIA — o MESMO caso DIVERGE (FR-049 / RN-CT12).
    """
    caso = _caso_da_identidade_por_motivo("sem_direito_de_operar")
    original = modulo_identidade.conferir_direitos

    def _aceita_qualquer_direito(*_: Any, **__: Any) -> Any:
        return modulo_identidade.Veredicto(
            ok=True, motivo=None, porque="DEFEITO injectado: os direitos aceitam qualquer conta"
        )

    modulo_identidade.conferir_direitos = _aceita_qualquer_direito  # type: ignore[assignment]
    try:
        problemas_do_caso = _caso_de_identidade(caso)
    finally:
        modulo_identidade.conferir_direitos = original  # type: ignore[assignment]
    return _anunciar_negativa(
        "direitos-insuficientes-aceitos", "direitos", problemas_do_caso, caso["caso"]
    )


def negativa_manifesto_passo_fixo_no_codigo() -> list[str]:
    """O DEFEITO: o `passo` fica FIXO no codigo. O caso da mudanca da fixture TEM de ficar VERMELHO.

    O caso afirma que o manifesto SEGUINTE reflecte a fixture (`0.1` -> `0.25`; SC-015 no espirito). Fixa-se o
    `passo` de todo instrumento em `"0.1"` no proprio montador: o manifesto deixa de sair dos DADOS, e o caso
    DIVERGE a nomea'-lo em `instrumento.passo` (RN-C1: nenhum numero do venue no codigo).
    """
    conteudo = _conteudo_dos_casos("sonda")
    base = _bloco(conteudo.get("manifesto_montado_base"), "manifesto_montado_base")
    caso: dict[str, Any] | None = None
    for candidato in _lista(conteudo.get("casos_do_manifesto"), "casos_do_manifesto"):
        if candidato.get("mudanca"):
            caso = candidato
            break
    if caso is None:
        raise ValueError("nenhum caso do manifesto muda a fixture: a negativa nao tem onde injectar o defeito")
    original = modulo_sonda.montar_manifesto

    def _montar_com_passo_fixo(**kwargs: Any) -> dict[str, Any]:
        manifesto = original(**kwargs)
        for instrumento in manifesto["instrumentos"]:
            instrumento["passo"] = "0.1"
        return manifesto

    modulo_sonda.montar_manifesto = _montar_com_passo_fixo  # type: ignore[assignment]
    try:
        problemas_do_caso = _caso_do_manifesto(caso, base)
    finally:
        modulo_sonda.montar_manifesto = original  # type: ignore[assignment]
    return _anunciar_negativa(
        "manifesto-passo-fixo-no-codigo", "manifesto", problemas_do_caso, caso["caso"]
    )


def negativa_fecho_do_inexistente_manda_ordem() -> list[str]:
    """O DEFEITO: o fecho do INEXISTENTE passa a mandar ordem. O caso da sequencia TEM de ficar VERMELHO.

    O caso afirma `nada` / `sem_posicao_para_fechar` / SEM ordem no 7.o passo. Repoe-se o defeito do SC-017: a
    decisao `nada` passa a trazer uma ordem de fecho inventada — que abriria por lado contrario (RN-CT34) — e o
    caso DIVERGE.
    """
    sequencia = _lista(_conteudo_dos_casos("ordens").get("sequencias_de_fecho"), "sequencias_de_fecho")[0]
    original = modulo_fecho.decidir_fecho

    def _decidir_fecho_com_ordem_no_nada(pedido: dict[str, Any]) -> Any:
        decisao = original(pedido)
        if decisao.acao != modulo_fecho.ACAO_NADA:
            return decisao
        return modulo_fecho.Decisao(
            acao=modulo_fecho.ACAO_FECHAR,
            motivo=None,
            porque="DEFEITO injectado: fecha o inexistente por lado contrario",
            ordem={"positionId": 999, "tradeSide": "SELL", "volume": 100, "orderType": "MARKET"},
        )

    modulo_fecho.decidir_fecho = _decidir_fecho_com_ordem_no_nada  # type: ignore[assignment]
    try:
        problemas_do_caso = _caso_de_sequencia_de_fecho(sequencia)
    finally:
        modulo_fecho.decidir_fecho = original  # type: ignore[assignment]
    return _anunciar_negativa(
        "fecho-do-inexistente-manda-ordem", "sequencia", problemas_do_caso, sequencia["caso"]
    )


def negativa_tradingMode_sai_como_enum_cru() -> list[str]:
    """O DEFEITO do D1 RE-POSTO: o `tradingMode` volta a sair pelo `.value` da biblioteca (era o defeito medido).

    O caso `DISABLED_WITHOUT_PENDINGS_EXECUTION` afirma o NOME do proto; com o defeito, o conversor publica o
    `.value` truncado (`\"DISABLED_WITHOUT_PENDINGS\"`) e o caso TEM de ficar VERMELHO a nomea'-lo. Sem este
    vermelho, o verde do caso provaria a fixture, e nao o descodificador (era exactamente o buraco do D1).
    """
    caso = _caso_do_transporte_por_nome(
        "transporte/simbolo-DISABLED_WITHOUT_PENDINGS_EXECUTION-atravessa-como-cadeia-do-proto"
    )
    original = modulo_transporte._nome_do_modo_de_negociacao  # noqa: SLF001

    def _pelo_value(valor: Any) -> Any:
        # E' o defeito: confiar no `.value` do membro, que nesta biblioteca TRUNCA tres dos quatro modos.
        if isinstance(valor, modulo_transporte.TradingMode):
            return valor.value
        return valor if isinstance(valor, str) else None

    modulo_transporte._nome_do_modo_de_negociacao = _pelo_value  # type: ignore[assignment]  # noqa: SLF001
    try:
        problemas_do_caso = _caso_de_transporte(caso)
    finally:
        modulo_transporte._nome_do_modo_de_negociacao = original  # type: ignore[assignment]  # noqa: SLF001
    return _anunciar_negativa("trading-mode-sai-como-enum-cru", "transporte", problemas_do_caso, caso["caso"])


def negativa_moneyDigits_nao_lido_do_venue() -> list[str]:
    """O DEFEITO do D2 RE-POSTO: o `moneyDigits` deixa de ser lido do VENUE (volta a nao ter fonte).

    O caso `expoente-do-trader-lido-do-venue` afirma 5 (lido da `ProtoOATraderRes`); com o descodificador
    devolvendo sempre `None`, o caso TEM de ficar VERMELHO — e' a conta plana que voltaria a recusar
    `expoente_dos_valores_ausente` (o ovo-e-galinha que o D2 fechou).
    """
    caso = _caso_do_transporte_por_nome("transporte/expoente-do-trader-lido-do-venue")
    original = modulo_transporte._expoente_do_trader  # noqa: SLF001

    def _nunca_le_o_venue(_resposta: Any) -> None:
        return None

    modulo_transporte._expoente_do_trader = _nunca_le_o_venue  # type: ignore[assignment]  # noqa: SLF001
    try:
        problemas_do_caso = _caso_de_transporte(caso)
    finally:
        modulo_transporte._expoente_do_trader = original  # type: ignore[assignment]  # noqa: SLF001
    return _anunciar_negativa("moneyDigits-nao-lido-do-venue", "transporte", problemas_do_caso, caso["caso"])


def negativa_nome_do_proto_nao_le_o_inteiro() -> list[str]:
    """O DEFEITO (mesma classe do D1): `_nome_do_proto` volta a olhar SO' para `.name`. O caso do inteiro
    (`executionType` = 3) TEM de ficar VERMELHO — e' o defeito que fazia o evento PREENCHIDO nao virar desfecho.
    """
    caso = _caso_do_transporte_por_nome("transporte/nome-do-proto-execucao-vem-do-fio-como-inteiro")
    original = modulo_transporte._nome_do_proto  # noqa: SLF001

    def _so_name(valor: Any, _classe: Any = None) -> Any:
        nome = getattr(valor, "name", None)
        return nome if isinstance(nome, str) else valor

    modulo_transporte._nome_do_proto = _so_name  # type: ignore[assignment]  # noqa: SLF001
    try:
        problemas_do_caso = _caso_de_transporte(caso)
    finally:
        modulo_transporte._nome_do_proto = original  # type: ignore[assignment]  # noqa: SLF001
    return _anunciar_negativa("nome-do-proto-nao-le-o-inteiro", "transporte", problemas_do_caso, caso["caso"])


def negativa_desvio_arredonda_para_cima() -> list[str]:
    """O DEFEITO do D5 ao CONTRARIO: o desvio (uma tolerancia MAXIMA) arredonda para CIMA. O caso TEM de ficar
    VERMELHO — arredondar para cima aceitaria MAIS desvio do que o dono pediu, que e' o lado inseguro.
    """
    conteudo = _conteudo_dos_casos("ordens")
    bases = (
        _bloco(conteudo.get("manifesto_base"), "manifesto_base"),
        _bloco(conteudo.get("simbolo_base"), "simbolo_base"),
        _bloco(conteudo.get("boleta_base"), "boleta_base"),
        _bloco(conteudo.get("pedido_base"), "pedido_base"),
    )
    caso: dict[str, Any] | None = None
    for candidato in _lista(conteudo.get("casos"), "casos"):
        if candidato.get("caso") == "ordens/mercado-por-faixa-desvio-que-nao-cai-em-pontos-inteiros-arredonda-para-baixo":
            caso = candidato
            break
    if caso is None:
        raise ValueError("o caso do desvio-em-pontos nao existe: a negativa nao tem onde injectar o defeito")
    original = modulo_ordens.desvio_em_pontos

    def _desvio_para_cima(**kwargs: Any) -> Any:
        problema = modulo_ordens._grelha_do_ponto(kwargs["digitos"], kwargs["posicao_do_pip"])  # noqa: SLF001
        if problema is not None:
            return problema
        movimento = kwargs["preco"] * kwargs["desvio_pct"] / Decimal(100)
        bruto = movimento * (Decimal(10) ** int(kwargs["digitos"]))
        if bruto < 1:
            return original(**kwargs)
        return int(bruto) + 1  # DEFEITO: arredonda para CIMA (aceita mais desvio do que o dono pediu)

    modulo_ordens.desvio_em_pontos = _desvio_para_cima  # type: ignore[assignment]
    try:
        problemas_do_caso = _caso_de_ordem(caso, bases)
    finally:
        modulo_ordens.desvio_em_pontos = original  # type: ignore[assignment]
    return _anunciar_negativa("desvio-arredonda-para-cima", "desvio", problemas_do_caso, caso["caso"])


def negativa_virada_sem_posicao_aceita() -> list[str]:
    """O DEFEITO: a traducao deixa de EXIGIR a posicao viva para a virada. O caso da virada SEM posicao TEM de
    ficar VERMELHO a nomea'-lo.

    O caso afirma a RECUSA `reversao_sem_posicao_a_reverter` (1.10.0/1.11.0). Tira-se a conferencia — a traducao
    passa a aceitar a virada sem posicao nenhuma (o comportamento ANTIGO, o `capacidade_nao_declarada` que a prova
    14 da bateria mediu ao vivo) — e exige-se que o MESMO caso DIVIRJA. Sem este vermelho, o verde do caso prova
    so' que o campo nao veio, e nao a regra que o recusa.
    """
    conteudo = _conteudo_dos_casos("ordens")
    bases = (
        _bloco(conteudo.get("manifesto_base"), "manifesto_base"),
        _bloco(conteudo.get("simbolo_base"), "simbolo_base"),
        _bloco(conteudo.get("boleta_base"), "boleta_base"),
        _bloco(conteudo.get("pedido_base"), "pedido_base"),
    )
    caso: dict[str, Any] | None = None
    for candidato in _lista(conteudo.get("casos"), "casos"):
        if candidato.get("caso") == "ordens/virada-sem-posicao-viva-recusa":
            caso = candidato
            break
    if caso is None:
        raise ValueError("o caso da virada sem posicao nao existe: a negativa nao tem onde injectar o defeito")
    original = modulo_ordens._posicao_a_reverter  # noqa: SLF001 (a negativa injecta o defeito na funcao da regra)

    def _sem_conferencia(pedido: dict[str, Any], _lado: str) -> Any:
        # DEFEITO injectado: devolve a posicao COMO VEIO, sem conferir nada — a virada passa sem posicao viva.
        return pedido.get("posicao_a_reverter")

    modulo_ordens._posicao_a_reverter = _sem_conferencia  # type: ignore[assignment]  # noqa: SLF001
    try:
        problemas_do_caso = _caso_de_ordem(caso, bases)
    finally:
        modulo_ordens._posicao_a_reverter = original  # type: ignore[assignment]  # noqa: SLF001
    return _anunciar_negativa("virada-sem-posicao-aceita", "virada", problemas_do_caso, caso["caso"])


#: As negativas, pela ordem das provas que vigiam. NAO copiam as bancadas de ritmo/leitura na contagem: ali a
#: negativa e' mais um caso (`6 provas` inclui a negativa); aqui o total em dado fica o mesmo, e a negativa e'
#: um passo proprio — o que ela acrescenta e' o VERMELHO, nao um caso.
NEGATIVAS: list[tuple[str, Any]] = [
    ("negativa/identidade-divergente-aceite", negativa_identidade_divergente_aceite),
    ("negativa/direitos-insuficientes-aceitos", negativa_direitos_insuficientes_aceitos),
    ("negativa/manifesto-passo-fixo-no-codigo", negativa_manifesto_passo_fixo_no_codigo),
    ("negativa/fecho-do-inexistente-manda-ordem", negativa_fecho_do_inexistente_manda_ordem),
    ("negativa/trading-mode-sai-como-enum-cru", negativa_tradingMode_sai_como_enum_cru),
    ("negativa/moneyDigits-nao-lido-do-venue", negativa_moneyDigits_nao_lido_do_venue),
    ("negativa/nome-do-proto-nao-le-o-inteiro", negativa_nome_do_proto_nao_le_o_inteiro),
    ("negativa/desvio-arredonda-para-cima", negativa_desvio_arredonda_para_cima),
    ("negativa/virada-sem-posicao-aceita", negativa_virada_sem_posicao_aceita),
]


#: O mapa NOMEADO ficheiro -> funcao que corre os casos daquele ficheiro. Alargar aqui e' alargar a bancada.
CORREDORES = {
    "ficha": _correr_ficha,
    "identidade": _correr_identidade,
    "leitura": _correr_leitura,
    "ordens": _correr_ordens,
    "desfecho": _correr_desfecho,
    "sonda": _correr_sonda,
    "transporte": _correr_transporte,
}


# -----------------------------------------------------------------------------------------------------------
# A PORTA. Descobre os ficheiros, corre-os, imprime uma linha por caso e o resumo, e sai 1 se algo divergir.
# -----------------------------------------------------------------------------------------------------------


def main() -> int:
    ficheiros = sorted(AQUI.glob(f"*{SUFIXO_DOS_CASOS}"))
    if not ficheiros:
        print(f"correr: nenhum `*{SUFIXO_DOS_CASOS}` em {AQUI}", file=sys.stderr)
        return 2

    total = 0
    conformes = 0
    divergentes = 0
    for caminho in ficheiros:
        ficheiro = caminho.name[: -len(SUFIXO_DOS_CASOS)]
        if ficheiro not in CORREDORES:
            print(
                f"correr: o ficheiro {caminho.name} nao tem corredor no mapa "
                f"({', '.join(sorted(CORREDORES))}): a bancada PARA em vez de o saltar em silencio",
                file=sys.stderr,
            )
            return 2
        with caminho.open(encoding="utf-8") as aberto:
            conteudo = json.load(aberto)
        try:
            entradas = CORREDORES[ficheiro](conteudo)
        except ValueError as erro:
            print(f"correr: {caminho.name}: {erro}", file=sys.stderr)
            return 2

        for entrada in entradas:
            total += 1
            problemas = entrada["problemas"]
            if problemas:
                divergentes += 1
                veredicto = "DIVERGE"
            else:
                conformes += 1
                veredicto = "ok"
            linha = {
                "caso": entrada["caso"],
                "implementacao": "ctrader",
                "veredicto": veredicto,
                "esperado_ok": entrada["esperado_ok"],
            }
            if problemas:
                linha["problemas"] = problemas
            print(json.dumps(linha, ensure_ascii=False))

    # AS NEGATIVAS (o vermelho de cada uma): um PASSO desta bancada, depois dos casos. Nao entram na contagem
    # (`total`/`conformes`/`divergentes`): o total verde dos casos em dado fica o mesmo. Uma negativa que nao
    # reprove — o caso VERDE com o defeito dentro — e' divergencia: sai nomeada e o processo termina 1.
    negativas_divergentes = 0
    for nome, prova in NEGATIVAS:
        try:
            problemas_da_negativa = prova()
        except Exception as erro:  # noqa: BLE001  (uma negativa que levanta e' divergencia DELA, nao da bancada)
            problemas_da_negativa = [f"a negativa levantou: {type(erro).__name__}: {erro}"]
            print(
                json.dumps(
                    {"negativa": nome, "veredicto": "DIVERGE", "problemas": problemas_da_negativa},
                    ensure_ascii=False,
                )
            )
        if problemas_da_negativa:
            negativas_divergentes += 1

    # O RESUMO E' A ULTIMA LINHA DO `stdout` (05/10/2026): o portao da casa corre a bancada com `2>&1` e imprime
    # o `tail -1` — enquanto o resumo ia para `stderr`, a linha que aparecia no portao era um `json` de caso, e o
    # numero nao se via. A ordem de escrita e' a razao: o resumo sai por ULTIMO, no `stdout`. A contagem e' a dos
    # CASOS: as negativas sao um passo a parte, e so' aparecem no resumo quando divergem.
    resumo = f"ctrader: {total} casos · {conformes} ok · {divergentes} divergentes"
    if negativas_divergentes > 0:
        resumo += f" · NEGATIVAS DIVERGENTES: {negativas_divergentes}"
    print(resumo)
    return 1 if divergentes > 0 or negativas_divergentes > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
