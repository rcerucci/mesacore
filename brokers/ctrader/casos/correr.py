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
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent.parent
sys.path.insert(0, str(RAIZ / "contracts" / "esqueleto"))
sys.path.insert(0, str(AQUI.parent))

from framing import validar, versao_vigente  # noqa: E402  (o caminho tem de ser posto primeiro)

import desfecho as modulo_desfecho  # noqa: E402
import fecho as modulo_fecho  # noqa: E402
import leitura as modulo_leitura  # noqa: E402
import ordens as modulo_ordens  # noqa: E402
import sonda as modulo_sonda  # noqa: E402

#: A extensao que marca um ficheiro de casos. O nome do ficheiro SEM ela e' a chave do mapa de corredores.
SUFIXO_DOS_CASOS = ".casos.json"

#: O mapa NOMEADO ficheiro -> modulos que aquele ficheiro de casos exercita. E' o que torna a bancada
#: descobridora: um `*.casos.json` que aqui nao esteja NAO se ignora em silencio — a bancada PARA e di-lo.
MODULOS_POR_FICHEIRO = {
    "leitura": ("leitura",),
    "ordens": ("ordens", "fecho"),
    "desfecho": ("desfecho",),
    "sonda": ("sonda",),
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


def _correr_sonda(conteudo: dict[str, Any]) -> list[dict[str, Any]]:
    """Todos os casos da sonda, e as checagens do instrumento contra o contrato do manifesto."""
    linha_base = _bloco(conteudo.get("linha_de_simbolo_base"), "linha_de_simbolo_base")
    manifesto_base = _manifesto_de_referencia()
    entradas: list[dict[str, Any]] = []
    for caso in _lista(conteudo.get("casos"), "casos"):
        esperado_ok = caso["esperadoOk"] is True
        try:
            problemas = _caso_de_sonda(caso, linha_base)
        except Exception as erro:  # noqa: BLE001
            problemas = [f"a bancada levantou com este caso: {type(erro).__name__}: {erro}"]
        entradas.append({"caso": caso.get("caso"), "esperado_ok": esperado_ok, "problemas": problemas})
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


#: O mapa NOMEADO ficheiro -> funcao que corre os casos daquele ficheiro. Alargar aqui e' alargar a bancada.
CORREDORES = {
    "leitura": _correr_leitura,
    "ordens": _correr_ordens,
    "desfecho": _correr_desfecho,
    "sonda": _correr_sonda,
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

    print(
        f"ctrader: {total} casos · {conformes} ok · {divergentes} divergentes",
        file=sys.stderr,
    )
    return 1 if divergentes > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
