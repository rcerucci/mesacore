"""A TRADUCAO DE ORDENS do conector cTrader: a boleta NEUTRA vira a mensagem do venue, ou uma RECUSA NOMEADA.

O QUE ELE E'. Uma funcao PURA (`traduzir`) que recebe a boleta, o manifesto sondado, a unidade do instrumento e
os dois numeros que so' o conector tem (saldo e preco — LIDOS do venue e entregues como DADO) e devolve a accao
que o venue aceita, ou uma recusa com motivo do conjunto do contrato. Sem rede, sem ficheiro, sem relogio: corre
offline, e por isso os casos dele correm sempre. Quem fala com o venue e' o `transporte.py`; este ficheiro nao
importa nem a biblioteca do venue nem o `core` (RN-C5, RN-C15, RN-E1).

AS DUAS UNIDADES ONDE ESTE VENUE SE ENGANHA EM SILENCIO (data-model §0). Sao conversoes NOSSAS, declaradas, e
cada uma vive num so' sitio, com nome:

  1. `volume` — **0,01 de unidade**: `volume = unidades x 100` (CENTESIMOS_POR_UNIDADE). Conferido a
     `minimo`/`maximo`/`passo` do simbolo (que a sonda publica JA' EM UNIDADES) ANTES de enviar (RN-CT20,
     FR-055/056). O volume que NAO cai na grelha DESCE ao maior degrau do passo <= pedido — nunca sobe, porque
     o risco nunca excede o declarado — e o ajuste SAI DECLARADO (`Conversao`, `ajustar_volume_ao_venue`).
     DECISAO DO DONO, datada de 06/10/2026, textual: «conta: ctrader-demo-pepperstone, a ficha do eurusd pode
     ser igual ao btc, 10% notional e 1x alavacagema. isso tem que ser padrao independente do venue, riscos
     igual ao hl. simples assim». Ate' aqui o conector RECUSAVA o tamanho fora do passo (o texto antigo do
     FR-056 dizia «nunca truncado, arredondado ou ajustado em silencio»), e a sigma nao operava neste venue:
     as velas chegavam, a sigma propunha, e a ordem caia' pela recusa. O que CONTINUA a recusar, pelo nome que
     ja' existia: o pedido ABAIXO do minimo do instrumento (`minimo_do_instrumento_acima_da_banda`), porque
     abaixo do minimo nao ha' degrau admissivel e subir ate' ao minimo aumentaria o risco que o dono nao pediu.
  2. `relativeStopLoss`/`relativeTakeProfit` — **1/100000 de preco**: `relativo = preco x (pct/100) x 100000`
     (RELATIVO_POR_PRECO), com o SINAL conforme o lado (RN-CT32: em BUY a distancia soma-se ao preco, em SELL
     subtrai-se).

O DESVIO MANDA NO TIPO DE ORDEM, E ISSO E' DE PROPOSITO. A boleta NEUTRA traz sempre `desvio_maximo` (e' campo
obrigatorio do contrato). Este venue so' tem campos de desvio em `MARKET_RANGE`/`STOP_LIMIT`
(`slippageInPoints` + `baseSlippagePrice`, RN-CT33). Logo `mercado`, `limite` e `stop` — que nao os tem — sao
RECUSADOS com `capacidade_nao_declarada`: o tipo NAO se troca para acomodar o campo (FR-059) e o desvio NAO se
descarta em silencio (seria mandar uma ordem sem a proteccao que o dono pediu).

AS DUAS GRANDEZAS CUJA UNIDADE O DATA-MODEL NAO DECIDE. O §0 da'-as como «(unidade do simbolo)» sem dizer qual,
e o `slippageInPoints` como «derivado de pipPosition/digits, confirmar em demo». Aqui nao se adivinha: o simbolo
TEM de declarar a unidade das distancias (`unidade_das_distancias`) e os digitos/posicao do pip, e o que nao
vier declarado RECUSA com `capacidade_nao_declarada` — em vez de comparar numeros de unidades diferentes.

O QUE ESTE FICHEIRO NAO FAZ. Nao decide se se opera, nem o lado, nem o tamanho, nem o momento (RN-C5/RN-C15);
nao le' estrategia, mandato nem fichas; nao julga risco.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import ROUND_FLOOR, Decimal
from typing import Any

# -----------------------------------------------------------------------------------------------------------
# AS CONVERSOES DECLARADAS, e os conjuntos FECHADOS deste venue. Cada numero que converte unidades vive AQUI, e
# so' aqui: um destes escrito duas vezes era uma segunda verdade.
# -----------------------------------------------------------------------------------------------------------

#: `volume` das ordens do venue: **0,01 de unidade**. `volume = unidades x 100`, inteiro (data-model §0).
CENTESIMOS_POR_UNIDADE = 100

#: As REGRAS do volume, pelo NOME (FR-055, decisao do dono de 06/10/2026). A declaracao di-lo sempre: o pedido
#: que JA' cai na grelha fica `exacto`; o que nao cai DESCE ao degrau admissivel e leva o nome do ajuste. Os dois
#: nomes vivem aqui, num so' sitio, para que a linha e a bancada leiam o mesmo.
REGRA_VOLUME_EXACTO = "volume_exacto_no_passo"
REGRA_VOLUME_AJUSTADO = "volume_ajustado_ao_passo"

#: `relativeStopLoss`/`relativeTakeProfit`: **1/100000 de preco**. `relativo = preco x (pct/100) x 100000`.
RELATIVO_POR_PRECO = 100000

#: `clientOrderId` (RN-CT30): a marca de posse do venue nao passa deste numero de caracteres.
LIMITE_DO_CLIENT_ORDER_ID = 50

#: O mapa dos tipos NEUTROS do contrato para os do venue. Os cinco que este venue serve estao todos; `STOP_LOSS_TAKE_PROFIT`
#: fica FORA (declarado no README) — o neutro nao cresce para o acomodar (SC-015).
TIPOS_DE_ORDEM_DO_VENUE = {
    "mercado": "MARKET",
    "limite": "LIMIT",
    "stop": "STOP",
    "stop_limite": "STOP_LIMIT",
    "mercado_por_faixa": "MARKET_RANGE",
}

#: Os UNICOS tipos do venue que tem campos de desvio (`slippageInPoints` + `baseSlippagePrice`, RN-CT33).
TIPOS_COM_DESVIO = ("MARKET_RANGE", "STOP_LIMIT")

#: A politica de parcial + o destino do resto -> o `timeInForce` do venue (data-model §5). Onde nao houver par,
#: RECUSA — nunca se improvisa um TIF.
TIF_POR_PARCIAL_E_DESTINO = {
    ("tudo_ou_nada", "cancelar"): "FOK",
    ("o_que_der", "agressivo"): "IOC",
}

#: O lado do venue. `BUY=1`, `SELL=2` (RN-CT30) — aqui pelo NOME, como o venue o escreve.
LADO_DO_VENUE = {"buy": "BUY", "sell": "SELL"}

#: O SINAL da distancia relativa conforme o lado (RN-CT32).
SINAL_DO_LADO = {"buy": 1, "sell": -1}

#: Que precos cada tipo do venue OBRIGA (`ProtoOANewOrderReq`, RN-CT30). O neutro nao traz preco absoluto — a
#: boleta e' NEUTRA (RN-B0) — e por isso o pedido tem de o trazer: sem ele nao ha' accao a enviar.
PRECOS_OBRIGATORIOS_DO_TIPO = {
    "MARKET": (),
    "MARKET_RANGE": (),
    "LIMIT": ("limitPrice",),
    "STOP": ("stopPrice",),
    "STOP_LIMIT": ("stopPrice", "limitPrice"),
}

#: O nome NEUTRO de cada preco do venue (o que se procura no pedido).
NOME_NEUTRO_DO_PRECO = {"limitPrice": "preco_limite", "stopPrice": "preco_stop"}

#: As unidades em que a `distancia_minima_do_stop`/`do_alvo` do simbolo podem vir, e as que este ficheiro sabe
#: comparar. Conjunto FECHADO: um nome que nao esteja aqui RECUSA (nao se assume a unidade).
UNIDADES_DAS_DISTANCIAS_MINIMAS = ("relativo_1_100000", "preco")

_PADRAO_DECIMAL = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$")
_PADRAO_DECIMAL_POSITIVO = re.compile(r"^(?:0*\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(?:\.[0-9]+)?)$")
_PADRAO_INSTRUMENTO = re.compile(r"^[A-Z0-9][A-Z0-9._/-]{1,31}$")

#: A alavancagem que a PROJECCAO do preco de liquidacao ([C]) aceita: um INTEIRO positivo, escrito sem casas.
#: E' a MESMA exigencia da irmao (`brokers/hyperliquid/conector.ts:304`): uma alavancagem com casas nao tem
#: projeccao declarada, e o campo fica AUSENTE — nunca um numero meio-inventado.
_PADRAO_INTEIRO_POSITIVO = re.compile(r"^[1-9][0-9]*$")


# -----------------------------------------------------------------------------------------------------------
# O RESULTADO. Duas formas, e so' duas: ou se traduziu, ou se recusou com motivo.
# -----------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Recusa:
    ok: bool
    motivo: str
    porque: str


@dataclass(frozen=True)
class Feito:
    ok: bool
    #: A mensagem que o venue aceita, nos nomes de campo DELE (`ProtoOANewOrderReq`).
    accao: dict[str, Any]
    #: A resolucao (RN-C10/FR-062): os cinco campos, com os numeros do venue quando ele os da'.
    resolucao: dict[str, str]
    #: A DECLARACAO da conversao do volume (FR-055): o volume pedido, o efectivo, a regra pelo nome e os dois
    #: nocionais. NUNCA vai a' venue (nao ha' campo para ela no `ProtoOANewOrderReq`): e' a prova de que o ajuste
    #: ao passo nao se fez em silencio. Vem `None` so' numa accao que nao seja de abertura com volume.
    conversao: dict[str, str] | None = None


def _recusa(motivo: str, porque: str) -> Recusa:
    return Recusa(ok=False, motivo=motivo, porque=porque)


# -----------------------------------------------------------------------------------------------------------
# A leitura dos campos, sem coaccao nenhuma: o que falta RECUSA, nomeando o campo (D4/D5 — ausencia nunca vira
# valor neutro, e `null` nao existe no contrato).
# -----------------------------------------------------------------------------------------------------------


def _campo(dicionario: dict[str, Any], nome: str) -> Any | Recusa:
    if nome not in dicionario:
        return _recusa("campo_obrigatorio_ausente", f"falta `{nome}` — a ausencia nao se preenche com valor neutro (D4)")
    valor = dicionario[nome]
    if valor is None:
        return _recusa("valor_nulo_nao_permitido", f"`{nome}` veio a null, e null nao existe no contrato (D4)")
    return valor


def _decimal(valor: Any, nome: str, *, positivo: bool = False) -> Decimal | Recusa:
    """Decimal TEXTUAL do contrato -> `Decimal`. Float nunca: um decimal de virgula flutuante RECUSA por tipo."""
    if isinstance(valor, bool) or not isinstance(valor, str):
        return _recusa("tipo_invalido", f"`{nome}` tem de ser decimal TEXTUAL, e veio {type(valor).__name__}")
    padrao = _PADRAO_DECIMAL_POSITIVO if positivo else _PADRAO_DECIMAL
    if not padrao.match(valor):
        return _recusa("formato_invalido", f"`{nome}` ({valor!r}) nao tem a forma de decimal do contrato")
    numero = Decimal(valor)
    if positivo and numero <= 0:
        return _recusa("formato_invalido", f"`{nome}` tem de ser estritamente positivo, e veio {valor!r}")
    return numero


def _decimal_do_campo(
    dicionario: dict[str, Any], nome: str, qualificado: str, *, positivo: bool = False
) -> Decimal | Recusa:
    """Um campo do contrato, pelas DUAS portas: primeiro a presenca (ausente/nulo RECUSA por si), depois a forma."""
    valor = _campo(dicionario, nome)
    if isinstance(valor, Recusa):
        return valor
    return _decimal(valor, qualificado, positivo=positivo)


def _texto(valor: Decimal) -> str:
    """O decimal do contrato, escrito: sem expoente e sem zeros a' direita."""
    texto = format(valor, "f")
    if "." in texto:
        texto = texto.rstrip("0").rstrip(".")
    if texto in ("", "-0"):
        return "0"
    return texto


def _inteiro(valor: Decimal, nome: str, motivo: str, porque: str) -> int | Recusa:
    """Um valor que TEM de cair na grelha inteira de uma unidade do venue. Nao cai -> RECUSA, nunca arredonda."""
    if valor != valor.to_integral_value():
        return _recusa(motivo, f"{porque}: {nome} = {_texto(valor)}, que nao e' inteiro, e nao se arredonda")
    return int(valor)


# -----------------------------------------------------------------------------------------------------------
# A CONVERSAO 1 — o volume (0,01 de unidade).
# -----------------------------------------------------------------------------------------------------------


def _em_centesimos(valor: Decimal, nome: str) -> int | Recusa:
    """Um numero do simbolo em UNIDADES -> a mesma grandeza em CENTESIMOS (a unidade do `volume` do venue)."""
    bruto = valor * Decimal(CENTESIMOS_POR_UNIDADE)
    return _inteiro(
        bruto,
        nome,
        "capacidade_nao_declarada",
        (
            f"o `{nome}` do simbolo ({_texto(valor)} unidades) e' mais fino do que a unidade de volume deste "
            "venue (0,01 de unidade): a grelha do simbolo e a grelha do volume nao coincidem, e sem coincidencia "
            "nao se traduz"
        ),
    )


@dataclass(frozen=True)
class Conversao:
    """A DECLARACAO da conversao do volume (FR-055) — o pedido, o efectivo, a regra e os dois nocionais.

    Existe para que o ajuste ao passo NUNCA seja silencioso: quem le' a linha ve' o volume que a boleta pedia, o
    que vai a' grelha do venue, e o nome da regra que liga os dois. A diferenca entre os dois nocionais e' o
    DESVIO (o risco efectivo nunca excede o pedido, porque o ajuste so' desce). Os volumes vao na unidade do
    `volume` do venue (0,01 de unidade); os nocionais, no dinheiro (`unidades x preco`). Os metodos PURA os
    escrevem em TEXTO (D4) — o numero nunca viaja em float.
    """

    volume_pedido: Decimal
    volume_efectivo: int
    regra: str
    nocional_pedido: Decimal
    nocional_efectivo: Decimal

    def declaracao(self) -> dict[str, str]:
        """A declaracao em TEXTO (D4): o volume pedido, o efectivo, a regra pelo nome, e os nocionais."""
        return {
            "volume_pedido": _texto(self.volume_pedido),
            "volume_efectivo": str(self.volume_efectivo),
            "regra": self.regra,
            "nocional_pedido": _texto(self.nocional_pedido),
            "nocional_efectivo": _texto(self.nocional_efectivo),
        }


def ajustar_volume_ao_venue(
    *,
    saldo: Decimal,
    saldo_pct: Decimal,
    alavancagem: Decimal,
    preco: Decimal,
    minimo: Decimal,
    maximo: Decimal,
    passo: Decimal,
    instrumento: str,
) -> Conversao | Recusa:
    """A CONVERSAO do tamanho (RN-CT20, FR-055/056) — com a DECISAO DO DONO, datada de 06/10/2026.

    `unidades = saldo x (saldo_pct/100) x alavancagem / preco`. O volume pedido, na unidade do venue (0,01 de
    unidade), DESCE ao MAIOR degrau do passo que nao o exceda — nunca sobe, porque o risco nunca excede o
    declarado — e a `Conversao` di-lo. A ordem do dono e' textual: «a ficha do eurusd pode ser igual ao btc, 10%
    notional e 1x alavacagema ... padrao independente do venue, riscos igual ao hl». Ate' aqui o FR-056 fazia o
    conector RECUSAR o tamanho fora da grelha, e a sigma nao operava neste venue.

    A DECISAO NAO DESTRAVA TUDO, e o que fica de fora fica NOMEADO: o pedido ABAIXO do minimo do instrumento
    RECUSA (`minimo_do_instrumento_acima_da_banda`) — abaixo do minimo nao ha' degrau admissivel, e subir ate' ao
    minimo aumentaria o risco que o dono nao pediu (RN-C9); o pedido ACIMA do maximo RECUSA (`valor_fora_da_banda`)
    — o venue recusaria a ordem, e nao se corta o tamanho por conta propria.
    """
    unidades = saldo * saldo_pct / Decimal(100) * alavancagem / preco
    volume_pedido = unidades * Decimal(CENTESIMOS_POR_UNIDADE)

    passo_em_centesimos = _em_centesimos(passo, "passo")
    if isinstance(passo_em_centesimos, Recusa):
        return passo_em_centesimos
    minimo_em_centesimos = _em_centesimos(minimo, "minimo")
    if isinstance(minimo_em_centesimos, Recusa):
        return minimo_em_centesimos
    maximo_em_centesimos = _em_centesimos(maximo, "maximo")
    if isinstance(maximo_em_centesimos, Recusa):
        return maximo_em_centesimos

    # O PEDIDO FICA ABAIXO DO MINIMO: nao ha' degrau admissivel abaixo. A recusa continua, pelo nome que ja'
    # existia — e' o unico caso em que a decisao do dono NAO destrava (o ajuste so' desce).
    if volume_pedido < minimo_em_centesimos:
        return _recusa(
            "minimo_do_instrumento_acima_da_banda",
            (
                f"o volume pedido {_texto(volume_pedido)} (0,01 de unidade) fica abaixo do minimo do simbolo "
                f"{instrumento}, que e' {minimo_em_centesimos}: o ajuste do dono so' DESCE ao degrau do passo, e "
                "abaixo do minimo nao ha' degrau admissivel — subir ate' ao minimo aumentaria o risco, e nao se faz "
                "(RN-C9/FR-056)"
            ),
        )
    # O PEDIDO EXCEDE O MAXIMO: o venue recusaria a ordem, e nao se corta o tamanho por conta propria.
    if volume_pedido > maximo_em_centesimos:
        return _recusa(
            "valor_fora_da_banda",
            (
                f"o volume pedido {_texto(volume_pedido)} (0,01 de unidade) excede o maximo do simbolo {instrumento}, "
                f"que e' {maximo_em_centesimos}: o venue recusaria a ordem, e nao se corta o tamanho por conta propria"
            ),
        )

    # O MAIOR DEGRAU DO PASSO <= PEDIDO (floor; nunca acima: o risco nunca excede o declarado).
    degrau = (volume_pedido / passo_em_centesimos).to_integral_value(rounding=ROUND_FLOOR) * passo_em_centesimos
    if degrau < minimo_em_centesimos:
        # So' acontece se o minimo do simbolo nao for multiplo do passo: o ajuste desceria abaixo do minimo.
        return _recusa(
            "minimo_do_instrumento_acima_da_banda",
            (
                f"o maior degrau do passo {passo_em_centesimos} que nao excede o volume pedido "
                f"{_texto(volume_pedido)} e' {_texto(degrau)} (0,01 de unidade), abaixo do minimo "
                f"{minimo_em_centesimos} do simbolo {instrumento}: nao ha' degrau admissivel abaixo — recusa "
                "(RN-C9/FR-056)"
            ),
        )
    volume_efectivo = int(degrau)
    regra = REGRA_VOLUME_EXACTO if degrau == volume_pedido else REGRA_VOLUME_AJUSTADO
    return Conversao(
        volume_pedido=volume_pedido,
        volume_efectivo=volume_efectivo,
        regra=regra,
        nocional_pedido=volume_pedido / Decimal(CENTESIMOS_POR_UNIDADE) * preco,
        nocional_efectivo=Decimal(volume_efectivo) / Decimal(CENTESIMOS_POR_UNIDADE) * preco,
    )


def volume_do_venue(
    *,
    saldo: Decimal,
    saldo_pct: Decimal,
    alavancagem: Decimal,
    preco: Decimal,
    minimo: Decimal,
    maximo: Decimal,
    passo: Decimal,
    instrumento: str,
) -> int | Recusa:
    """O `volume` (0,01 de unidade), INTEIRO e na grelha — ou recusa (RN-CT20, FR-055/056).

    Embrulho fino da `ajustar_volume_ao_venue` (a regra vive num so' sitio): devolve o volume EFECTIVO (o degrau
    do passo <= pedido) ou a recusa nomeada. Quem precisa da DECLARACAO do ajuste usa a `Conversao` directamente.
    """
    conversao = ajustar_volume_ao_venue(
        saldo=saldo,
        saldo_pct=saldo_pct,
        alavancagem=alavancagem,
        preco=preco,
        minimo=minimo,
        maximo=maximo,
        passo=passo,
        instrumento=instrumento,
    )
    if isinstance(conversao, Recusa):
        return conversao
    return conversao.volume_efectivo


# -----------------------------------------------------------------------------------------------------------
# A CONVERSAO 2 — as distancias relativas (1/100000 de preco) e o piso do simbolo.
# -----------------------------------------------------------------------------------------------------------


def distancia_relativa(*, preco: Decimal, pct: Decimal, lado: str) -> int | Recusa:
    """`preco x (pct/100) x 100000`, inteiro, com o SINAL do lado (RN-CT32) — ou recusa.

    O sinal: em `BUY` a distancia soma-se ao preco (sinal positivo); em `SELL` subtrai-se (sinal negativo).
    """
    bruto = preco * pct / Decimal(100) * Decimal(RELATIVO_POR_PRECO)
    magnitude = _inteiro(
        bruto,
        "distancia relativa",
        "valor_fora_da_banda",
        (
            f"a distancia de {_texto(pct)}% sobre o preco {_texto(preco)} da' {_texto(bruto)} em 1/100000 de "
            "preco, que nao e' inteiro"
        ),
    )
    if isinstance(magnitude, Recusa):
        return magnitude
    return magnitude * SINAL_DO_LADO[lado]


def conferir_distancia_minima(
    *,
    valor_relativo: int,
    minima: Decimal,
    unidade: Any,
    nome_do_campo: str,
    instrumento: str,
) -> Recusa | None:
    """O piso que o simbolo impoe ao stop/alvo (RN-CT21): abaixo dele RECUSA — o stop nao se alarga para caber.

    A UNIDADE NAO SE ADIVINHA. O data-model §0 da' `slDistance`/`tpDistance` como «(unidade do simbolo)» e nao a
    decide; sem a declaracao do simbolo (`unidade_das_distancias`), comparar dois numeros de unidades diferentes
    seria assumir — e RECUSA-se, com o nome do campo e o motivo.
    """
    if unidade is None:
        return _recusa(
            "capacidade_nao_declarada",
            (
                f"o simbolo traz a distancia minima de {nome_do_campo} mas nao declara em que unidade ela esta' "
                "(o data-model §0 da'-a como «unidade do simbolo», e nao a decide): comparar sem saber a unidade "
                "seria assumir — recusa ate' a demonstracao a fixar"
            ),
        )
    if unidade not in UNIDADES_DAS_DISTANCIAS_MINIMAS:
        return _recusa(
            "capacidade_nao_declarada",
            (
                f"a unidade declarada para a distancia minima de {nome_do_campo} ({unidade!r}) nao esta' no "
                f"conjunto conhecido ({', '.join(UNIDADES_DAS_DISTANCIAS_MINIMAS)}): nao se traduz uma unidade "
                "que nao se conhece"
            ),
        )

    em_relativo = minima if unidade == "relativo_1_100000" else minima * Decimal(RELATIVO_POR_PRECO)
    if abs(valor_relativo) < em_relativo:
        return _recusa(
            "minimo_do_instrumento_acima_da_banda",
            (
                f"a distancia de {nome_do_campo} calculada ({abs(valor_relativo)} em 1/100000 de preco) fica "
                f"abaixo do minimo do simbolo {instrumento} ({_texto(em_relativo)} na mesma unidade): alargar o "
                "stop ate' ao minimo aumentaria o risco que o dono autorizou — recusa (RN-CT21/FR-057)"
            ),
        )
    return None


# -----------------------------------------------------------------------------------------------------------
# O DESVIO — a conversao percentagem -> pontos, que vive AQUI e so' aqui (RN-CT33, research R5).
# -----------------------------------------------------------------------------------------------------------


def desvio_em_pontos(
    *,
    desvio_pct: Decimal,
    preco: Decimal,
    digitos: Any,
    posicao_do_pip: Any,
) -> int | Recusa:
    """`desvio_maximo` (%) -> `slippageInPoints` do venue. A conversao inteira vive neste sitio.

    A GRELHA DO PONTO E' O TICK. O ponto deste venue e' o menor passo de preco, `10^-digitos` (e' o `tick` que a
    sonda publica). O `posicao_do_pip` serve para CONFERIR que o pip cai dentro dos digitos: um simbolo cujo pip
    esteja fora deles nao declara a grelha de forma coerente, e RECUSA em vez de se assumir a partir do pip.
    [a confirmar em demonstracao: research R5]
    """
    problema = _grelha_do_ponto(digitos, posicao_do_pip)
    if problema is not None:
        return problema
    movimento = preco * desvio_pct / Decimal(100)
    bruto = movimento * (Decimal(10) ** int(digitos))
    # [DECISAO 05/10/2026, para o dono corrigir se quiser] O DESVIO E' UMA TOLERANCIA MAXIMA, e o venue so'
    # aceita pontos INTEIROS. Um preco de instrumento real (EURUSD = 5 decimais) quase nunca produz um numero
    # EXACTO de pontos — 0,5% sobre 1,12107 da' 560,535 pontos. Recusar (como antes) tornava este conector
    # incapaz de enviar UMA ordem: nao ha' percentagem finita que caia na grelha de um preco de 5 decimais.
    # A tolerancia e' um TETO, logo arredonda-se para BAIXO (aceitar MENOS desvio do que o dono pediu e' o lado
    # seguro; arredondar para CIMA aceitaria mais). Isto NAO e' o arredondamento que o FR-056 proibe: esse e' o
    # do TAMANHO, e continua intacto (um tamanho fora da grelha RECUSA, nunca se ajusta).
    if bruto < 1:
        return _recusa(
            "valor_fora_da_banda",
            f"o desvio de {_texto(desvio_pct)}% sobre o preco {_texto(preco)} da' {_texto(bruto)} pontos, abaixo "
            "de UM ponto inteiro: o venue nao representa esta tolerancia, e zero pontos nao e' uma tolerancia",
        )
    return int(bruto)


def _grelha_do_ponto(digitos: Any, posicao_do_pip: Any) -> Recusa | None:
    """O simbolo declara a grelha do ponto de forma UTILIZAVEL? Sem resposta, nao se converte."""
    for nome, valor in (("digitos", digitos), ("posicao_do_pip", posicao_do_pip)):
        if isinstance(valor, bool) or not isinstance(valor, int) or valor < 0:
            return _recusa(
                "capacidade_nao_declarada",
                (
                    f"o simbolo nao declarou `{nome}` de forma utilizavel ({valor!r}): a grelha do ponto e' o "
                    "tick (10^-digitos) e sem ela a percentagem do desvio nao vira pontos — recusa, em vez de "
                    "assumir a grelha [research R5]"
                ),
            )
    if posicao_do_pip > digitos:
        return _recusa(
            "capacidade_nao_declarada",
            (
                f"o simbolo declara `posicao_do_pip` = {posicao_do_pip} acima de `digitos` = {digitos}: um pip "
                "fora dos digitos do preco nao declara grelha coerente, e nao se assume qual e' o ponto"
            ),
        )
    return None


def preco_relativo(preco: Decimal, nome: str = "preco") -> int | Recusa:
    """O preco de referencia do venue em inteiros relativos (`/100000` -> `x 100000`), tal como ele os viaja."""
    bruto = preco * Decimal(RELATIVO_POR_PRECO)
    return _inteiro(
        bruto,
        nome,
        "valor_fora_da_banda",
        f"o preco {nome} ({_texto(preco)}) nao cai na grelha de 1/100000 do venue",
    )


# -----------------------------------------------------------------------------------------------------------
# A MARCA DE POSSE (RN-CT30/FR-061).
# -----------------------------------------------------------------------------------------------------------


def marca_de_posse_do_cliente(*, marca: Any, da_boleta: Any, referencia: Any) -> str | Recusa:
    """O `clientOrderId` do venue: texto, ate' 50 caracteres.

    A marca vem da OPERACAO (`pedido.marca_do_cliente`) quando ela a compoe; sem ela, compoe-se do inteiro de 31
    bits da boleta e da referencia do cliente — e' essa a marca que a operacao seguinte reencontra. Marca com
    mais do que `LIMITE_DO_CLIENT_ORDER_ID` caracteres RECUSA: cortar faria duas ordens partilharem marca.
    """
    texto = marca if marca is not None else _marca_do_inteiro(da_boleta, referencia)
    if isinstance(texto, Recusa):
        return texto
    if not isinstance(texto, str) or texto == "":
        return _recusa("tipo_invalido", f"a marca de posse tem de ser texto nao vazio, e veio {texto!r}")
    if len(texto) > LIMITE_DO_CLIENT_ORDER_ID:
        return _recusa(
            "formato_invalido",
            (
                f"a marca de posse tem {len(texto)} caracteres e o `clientOrderId` deste venue so' aceita "
                f"{LIMITE_DO_CLIENT_ORDER_ID} (RN-CT30): cortar a marca faria duas ordens partilharem marca — recusa"
            ),
        )
    return texto


def _marca_do_inteiro(da_boleta: Any, referencia: Any) -> str | Recusa:
    if isinstance(da_boleta, bool) or not isinstance(da_boleta, int):
        return _recusa("campo_obrigatorio_ausente", "falta a marca de posse da boleta e o pedido nao a compoe")
    if isinstance(referencia, str) and referencia != "":
        return f"{da_boleta}-{referencia}"
    return str(da_boleta)


# -----------------------------------------------------------------------------------------------------------
# A PROJECCAO DO PRECO DE LIQUIDACAO ([C]) — a conta NOSSA que a resolucao pre-envio precisa.
#
# O venue desta ponta NAO publica o preco de liquidacao antes de a posicao existir, e o contrato EXIGE os cinco
# campos da resolucao. A regra e' a da irmao (`brokers/hyperliquid/conector.ts:302`), portada a 05/10/2026 (A-12):
# `preco x (A-1) / A`, quantizado ao `tick` POR BAIXO. Aritmetica EXACTA de inteiros — nunca virgula flutuante.
# A projeccao e' [C] e vai dita como tal; quando o VENUE publicar o numero (a posicao lida depois do envio), e' ELE
# que manda — a projeccao nao o substitui (`montar_resolucao` da' prioridade ao numero do venue).
# -----------------------------------------------------------------------------------------------------------


def _casas_decimais(texto: str) -> int:
    """O numero de casas decimais de um decimal TEXTUAL, sem expoente (`1.25` -> 2) — conta da irmao."""
    ponto = texto.find(".")
    return 0 if ponto < 0 else len(texto) - ponto - 1


def _escalado(texto: str) -> int:
    """O decimal TEXTUAL -> inteiro na escala das suas casas (`1.25` -> `125`), sem virgula flutuante."""
    ponto = texto.find(".")
    return int(texto) if ponto < 0 else int(texto[:ponto] + texto[ponto + 1 :])


def _formatar_escalado(valor: int, escala: int) -> str:
    """O inteiro na escala `escala` -> decimal TEXTUAL, sem expoente e sem zeros a' direita (irmao `formatar`)."""
    if escala == 0:
        return str(valor)
    digitos = str(valor).rjust(escala + 1, "0")
    inteiro = digitos[: len(digitos) - escala]
    fraccao = digitos[len(digitos) - escala :].rstrip("0")
    return inteiro if fraccao == "" else f"{inteiro}.{fraccao}"


def preco_de_liquidacao_projectado(preco: str, alavancagem: str, tick: str) -> str | None:
    """O preco de liquidacao PROJECTADO, para a resolucao que sai ANTES do envio — **[C] declarado**.

    A MESMA REGRA DA IRMAO (`brokers/hyperliquid/conector.ts:302 precoDeLiquidacaoProjectado`, medida a
    05/10/2026 — A-12): `preco x (A-1) / A`, quantizado ao `tick` do simbolo POR BAIXO (o lado que nao
    promete), em aritmetica EXACTA de inteiros. A alavancagem 1 liquida a preco ZERO — e zero e' um valor
    LEGITIMO aqui, e nao «nao sei» (o contrato di-lo, `resolucao.schema.json`).

    PORQUE EXISTE. O venue so' calcula o preco de liquidacao depois de a posicao existir, e o contrato exige o
    campo na resolucao pre-envio (RN-C10). Sem esta projeccao, com alavancagem != 1 a resolucao saia com 4 dos
    5 campos, o contrato recusava-a por `campo_obrigatorio_ausente`, e numa ordem SILENCIOSA nao saia linha
    nenhuma — a mesa nunca ficava a saber que a ordem ficou em duvida (FR-067 quebrado no caso comum, medido).

    E' uma conta [C] sobre um numero do venue ([V]). Quando o venue publicar o numero, e' ELE que manda.

    `None` quando algum dos tres nao tem a forma que a irmao exige (preco/tick decimais, alavancagem inteiro
    positivo): nao se projeta sobre o que nao se le', e o campo fica AUSENTE — o estado honesto.
    """
    if not isinstance(preco, str) or not _PADRAO_DECIMAL.match(preco):
        return None
    if not isinstance(alavancagem, str) or not _PADRAO_INTEIRO_POSITIVO.match(alavancagem):
        return None
    if not isinstance(tick, str) or not _PADRAO_DECIMAL.match(tick):
        return None
    p = _casas_decimais(preco)
    t = _casas_decimais(tick)
    A = int(alavancagem)
    # A alavancagem 1 liquida a preco ZERO — e zero e' um valor LEGITIMO aqui, e nao «nao sei» (o contrato di-lo).
    if A == 1:
        return "0"
    bruto = _escalado(preco) * (A - 1) // A  # em unidades de 10^-p, por baixo
    if t >= p:
        return _formatar_escalado(bruto * pow(10, t - p), t)
    return _formatar_escalado(bruto // pow(10, p - t), t)


def _tick_por_digitos(digitos: Any) -> str | None:
    """O `tick` do simbolo, da GRADE que ele declara: `10^-digitos` (`digitos` casas). Sem ele, `None`.

    E' a MESMA grade que o `desvio_em_pontos` ja' usa («o ponto deste venue e' o menor passo de preco,
    `10^-digitos` — e' o `tick` que a sonda publica»): o tick nao se escreve a mao, sai dos `digitos` do simbolo.
    """
    if isinstance(digitos, bool) or not isinstance(digitos, int) or digitos < 0:
        return None
    if digitos == 0:
        return "1"
    return "0." + "0" * (digitos - 1) + "1"


# -----------------------------------------------------------------------------------------------------------
# A RESOLUCAO (RN-C10/FR-062). Os cinco campos; o que o venue NAO da' fica AUSENTE — nao se inventa (D4).
# -----------------------------------------------------------------------------------------------------------


def montar_resolucao(
    *,
    quantidade: Decimal | None,
    preco: Decimal | None,
    alavancagem: Decimal | None,
    numeros_do_venue: Any,
    tick: str | None = None,
) -> dict[str, str]:
    """Os cinco campos da resolucao, com os numeros do venue quando ele os da' (FR-062).

    O que o venue NAO da' fica AUSENTE, e a resolucao e' recusada pelo contrato com `campo_obrigatorio_ausente`:
    e' o estado honesto — a conta nao publica o preco de liquidacao (data-model §2), e um zero inventado seria um
    numero do venue que ninguem mediu.

    UMA EXCEPCAO, e ela e' DECLARADA ([C], A-12 fechado a 05/10/2026): o `preco_de_liquidacao`. Quando o venue
    nao o da', ele PROJETA-SE pela regra da irmao (`preco_de_liquidacao_projectado`, `preco x (A-1) / A` ao tick
    por baixo) — a alavancagem 1 da' `"0"`, que e' VERDADE (o contrato di-lo). O numero do venue, quando existe,
    manda sobre a projeccao. Sem `tick` (simbolo sem grelha legivel) o campo fica ausente, como antes.
    """
    do_venue: dict[str, Any] = {}
    if isinstance(numeros_do_venue, dict):
        do_venue = numeros_do_venue

    resolucao: dict[str, str] = {}

    quantidade_do_venue = _decimal_do_venue(do_venue, "quantidade")
    if quantidade_do_venue is not None:
        resolucao["quantidade"] = _texto(quantidade_do_venue)
    elif quantidade is not None:
        resolucao["quantidade"] = _texto(quantidade)

    nocional = _decimal_do_venue(do_venue, "nocional")
    if nocional is not None:
        resolucao["nocional"] = _texto(nocional)
    elif quantidade is not None and preco is not None:
        resolucao["nocional"] = _texto(quantidade * preco)

    for nome in ("margem_empenhada", "alavancagem_efectiva"):
        valor = _decimal_do_venue(do_venue, nome)
        if valor is not None:
            resolucao[nome] = _texto(valor)

    # O NUMERO DO VENUE MANDA; sem ele, PROJETA-SE [C] (A-12). A alavancagem 1 liquida a preco ZERO — e' a
    # VERDADE do contrato, e vale SEM o preco de referencia (o caminho do fecho, que traz os numeros do venue e
    # nao um preco nosso, continua a completar a resolucao com ele). Sem preco nem tick, o campo fica ausente.
    liquidacao = _decimal_do_venue(do_venue, "preco_de_liquidacao")
    if liquidacao is not None:
        resolucao["preco_de_liquidacao"] = _texto(liquidacao)
    elif alavancagem is not None and alavancagem == Decimal(1):
        resolucao["preco_de_liquidacao"] = "0"
    elif preco is not None and alavancagem is not None and tick is not None:
        projectado = preco_de_liquidacao_projectado(_texto(preco), _texto(alavancagem), tick)
        if projectado is not None:
            resolucao["preco_de_liquidacao"] = projectado

    return resolucao


def _decimal_do_venue(do_venue: dict[str, Any], nome: str) -> Decimal | None:
    """Um numero do venue, quando ele o deu, e so' quando tem a forma de decimal do contrato."""
    if nome not in do_venue:
        return None
    valor = do_venue[nome]
    if isinstance(valor, bool) or not isinstance(valor, str):
        return None
    if not _PADRAO_DECIMAL.match(valor):
        return None
    return Decimal(valor)


# -----------------------------------------------------------------------------------------------------------
# A POSICAO VIVA que a VIRADA vai fechar (1.10.0).
# -----------------------------------------------------------------------------------------------------------


def _posicao_a_reverter(pedido: dict[str, Any], lado: str) -> dict[str, Any] | Recusa:
    """A POSICAO VIVA que a virada vai fechar — LIDA do venue pelo conector e entregue como DADO.

    Sem ela nao ha' virada: a boleta diz so' o LADO novo, e o que esta' aberto quem o sabe e' o venue (RN-B0).
    A recusa e' NOMEADA, e cobre os tres casos em que nao ha' o que virar — a posicao nao entrou na traducao, o
    lado dela e' ilegivel, ou ja' e' o lado declarado (uma virada para o proprio lado seria uma entrada a mais).
    O `volume` tem de ser o que o venue publica (0,01 de unidade): o fecho e' por ele, e nao por um calculo nosso.

    Devolve a posicao CONFERIDA (um mapa), ou a `Recusa`.
    """
    posicao = pedido.get("posicao_a_reverter")
    if not isinstance(posicao, dict):
        return _recusa(
            "reversao_sem_posicao_a_reverter",
            (
                "a boleta pede a virada (`reverter: true`) e a posicao viva nao entrou na traducao: sem ela nao "
                "se sabe o que fechar, e mandar so' o lado novo seria uma entrada a mais com o registo a dizer "
                "`reverse`"
            ),
        )
    lado_da_posicao = posicao.get("lado")
    if lado_da_posicao not in LADO_DO_VENUE.values():
        return _recusa(
            "reversao_sem_posicao_a_reverter",
            (
                f"a posicao viva declara o lado {lado_da_posicao!r}, que nao esta' no conjunto conhecido deste "
                f"venue ({', '.join(LADO_DO_VENUE.values())}): sem saber o lado da posicao nao se sabe o que virar"
            ),
        )
    if lado_da_posicao == LADO_DO_VENUE[lado]:
        return _recusa(
            "reversao_sem_posicao_a_reverter",
            (
                f"a posicao viva ja' esta' do lado {lado!r}, que e' o lado da boleta: nao ha' nada a virar (uma "
                "virada para o proprio lado seria uma entrada a mais)"
            ),
        )
    volume = posicao.get("volume")
    if isinstance(volume, bool) or not isinstance(volume, int) or volume <= 0:
        return _recusa(
            "reversao_sem_posicao_a_reverter",
            (
                f"a posicao viva nao traz `volume` em 0,01 de unidade ({volume!r}): o fecho e' pelo volume que o "
                "venue publica, e nao por um calculo nosso"
            ),
        )
    return posicao


# -----------------------------------------------------------------------------------------------------------
# A TRADUCAO. As portas correm por ordem, e o motivo que o dono le' e' o da PRIMEIRA que falha.
# -----------------------------------------------------------------------------------------------------------


def traduzir(pedido: dict[str, Any]) -> Feito | Recusa:
    """A boleta neutra -> a accao do venue + a resolucao — ou uma recusa com motivo do contrato.

    O `pedido` traz: `boleta`, `manifesto` (sondado), `simbolo` (a unidade do instrumento), `saldo` e `preco`
    (LIDOS do venue) e, opcionalmente, `numeros_do_venue` (o que o venue ja' deu, para a resolucao). Quando a
    boleta pede a VIRADA (`reverter: true`), traz tambem `posicao_a_reverter` — a POSICAO VIVA, LIDA do venue
    pelo conector (o que esta' aberto so' o venue o sabe, RN-B0): sem ela a virada RECUSA por nome.
    """
    if not isinstance(pedido, dict):
        return _recusa("tipo_invalido", "o pedido nao e' um objecto: sem pedido nao ha' boleta a traduzir")

    boleta = _campo(pedido, "boleta")
    if isinstance(boleta, Recusa):
        return boleta
    if not isinstance(boleta, dict):
        return _recusa("tipo_invalido", "`boleta` tem de ser um objecto")

    manifesto = _campo(pedido, "manifesto")
    if isinstance(manifesto, Recusa):
        return manifesto
    if not isinstance(manifesto, dict):
        return _recusa("tipo_invalido", "`manifesto` tem de ser um objecto")

    simbolo = _campo(pedido, "simbolo")
    if isinstance(simbolo, Recusa):
        return simbolo
    if not isinstance(simbolo, dict):
        return _recusa("tipo_invalido", "`simbolo` tem de ser um objecto")

    # ---- porta 1: a forma dos campos que este ficheiro consome -------------------------------------------------
    instrumento = _campo(boleta, "instrumento")
    if isinstance(instrumento, Recusa):
        return instrumento
    if not isinstance(instrumento, str) or not _PADRAO_INSTRUMENTO.match(instrumento):
        return _recusa("formato_invalido", f"o instrumento {instrumento!r} nao tem a forma do contrato")

    lado = _campo(boleta, "lado")
    if isinstance(lado, Recusa):
        return lado
    if lado not in LADO_DO_VENUE:
        return _recusa(
            "valor_fora_do_conjunto",
            f"a traducao so' conhece `buy` e `sell`; veio {lado!r} (o `caixa` e' fecho por posicao, nao lado de ordem)",
        )

    tipo = _campo(boleta, "tipo")
    if isinstance(tipo, Recusa):
        return tipo
    if not isinstance(tipo, str):
        return _recusa("tipo_invalido", "`boleta.tipo` tem de ser texto")

    parcial = _campo(boleta, "parcial")
    if isinstance(parcial, Recusa):
        return parcial
    destino_do_resto = _campo(boleta, "destino_do_resto")
    if isinstance(destino_do_resto, Recusa):
        return destino_do_resto

    # ---- porta 2: o instrumento existe no manifesto (sem unidade nao ha' traducao) ----------------------------
    instrumentos = _campo(manifesto, "instrumentos")
    if isinstance(instrumentos, Recusa):
        return instrumentos
    if instrumento not in _nomes_declarados(instrumentos):
        return _recusa(
            "instrumento_desconhecido_no_manifesto",
            f"o instrumento `{instrumento}` nao consta das unidades declaradas pelo manifesto deste conector",
        )

    # ---- porta 3: o tipo de ordem esta' no manifesto, e o venue sabe traduzi-lo (RN-CT30/FR-060) --------------
    tipos_declarados = _campo(manifesto, "tipos_de_ordem")
    if isinstance(tipos_declarados, Recusa):
        return tipos_declarados
    if not isinstance(tipos_declarados, list) or tipo not in tipos_declarados:
        return _recusa(
            "capacidade_nao_declarada",
            f"o manifesto nao declara o tipo de ordem {tipo!r}: sem tipo declarado nao ha' ordem a enviar (RN-C7)",
        )
    tipo_do_venue = TIPOS_DE_ORDEM_DO_VENUE.get(tipo)
    if tipo_do_venue is None:
        return _recusa(
            "capacidade_nao_declarada",
            f"o manifesto declara {tipo!r} e este conector nao o sabe traduzir para o venue — recusa, nao improvisa",
        )

    # ---- porta 4: a politica de parcial, e o TIF que ela da' ---------------------------------------------------
    parciais = _campo(manifesto, "parcial_suportada")
    if isinstance(parciais, Recusa):
        return parciais
    if not isinstance(parciais, list) or parcial not in parciais:
        return _recusa(
            "capacidade_nao_declarada",
            f"o manifesto nao declara a politica de parcial {parcial!r} (RN-B6/RN-C7)",
        )
    par = (parcial, destino_do_resto)
    if par not in TIF_POR_PARCIAL_E_DESTINO:
        return _recusa(
            "capacidade_nao_declarada",
            (
                f"o par parcial={parcial!r} + destino_do_resto={destino_do_resto!r} nao tem `timeInForce` "
                "conhecido neste venue (os pares declarados sao `tudo_ou_nada`+`cancelar` = FOK e "
                "`o_que_der`+`agressivo` = IOC) — recusa, em vez de improvisar um TIF"
            ),
        )
    tif = TIF_POR_PARCIAL_E_DESTINO[par]

    # ---- porta 5-bis: a VIRADA (1.10.0) -----------------------------------------------------------------------
    # A boleta passa a declarar `reverter` — OBRIGATORIO desde a 1.10.0 (a ausencia nao e' um valor: `false` diz
    # «nao e' virada», e a ausencia diria «nao foi declarado», D4).
    #
    # ESTE VENUE NAO FAZ NETTING, e a virada aqui NAO cabe numa ordem: o contrato di-lo (1.10.0(c)) — «onde nao
    # fizer, o conector executa as DUAS pernas na MESMA passagem». Quem MONTA as duas pernas e' a costura
    # (`processo.py`): a de FECHO e' POR POSICAO (`fecho.py`), a de ABERTURA e' este ficheiro. O que esta porta
    # faz e' CONFERIR a DECLARACAO e a POSICAO VIVA que o conector LE' do venue (entra como `pedido.posicao_a_reverter`,
    # como o `saldo` e o `preco`): sem posicao a reverter — ou com a posicao ja' do lado declarado — nao ha'
    # virada a fazer, e mandar so' o lado novo seria uma entrada a mais com o registo a dizer `reverse`. A recusa
    # e' NOMEADA (`reversao_sem_posicao_a_reverter`), a MESMA resposta que o conector irmao da' onde o venue FAZ
    # netting (brokers/hyperliquid/ordens.ts:589-624).
    #
    # A CONTRADICAO continua a RECUSAR primeiro (1.10.0(b)): `reverter: true` com `reduce_only: true` — «reduz,
    # nunca inverte» e «inverte» nao cabem na mesma ordem, e por isso `reverter: true` nunca chega a' regra da
    # reducao parcial (1.11.0#e).
    reverter = _campo(boleta, "reverter")
    if isinstance(reverter, Recusa):
        return reverter
    if not isinstance(reverter, bool):
        return _recusa("tipo_invalido", "`boleta.reverter` tem de ser booleano")
    if reverter and boleta.get("reduce_only") is True:
        return _recusa(
            "reversao_com_reduce_only",
            (
                "a boleta pede `reverter: true` e `reduce_only: true` na mesma ordem: «inverte» e «reduz, nunca "
                "inverte» nao cabem juntas, e nao se resolve por precedencia"
            ),
        )
    if reverter:
        posicao = _posicao_a_reverter(pedido, lado)
        if isinstance(posicao, Recusa):
            return posicao

    # ---- porta 5-ter: o TAMANHO RELATIVO A' POSICAO (1.11.0, D-013) -------------------------------------------
    # A boleta passa a declarar `posicao_pct` — OBRIGATORIO desde a 1.11.0 (D4: `1` diz «nao e' parcial», e a
    # ausencia diria «nao foi declarado»). Este venue nao tem `reduce_only` (porta 5) e a reducao parcial
    # assenta nele: uma fracao da posicao QUE E' uma reducao cai, mais abaixo, na recusa do `reduce_only` —
    # nomeada, e nao uma abertura disfarcada. O que esta porta confere e' a DECLARACAO.
    posicao_pct = _decimal_do_campo(boleta, "posicao_pct", "boleta.posicao_pct", positivo=True)
    if isinstance(posicao_pct, Recusa):
        return posicao_pct
    if posicao_pct > Decimal(1):
        return _recusa(
            "valor_fora_da_banda",
            (
                f"posicao_pct vem {posicao_pct}: acima de 1 uma ordem reduziria mais do que a posicao que existe "
                "— recusa, em vez de a cortar por conta propria"
            ),
        )
    if posicao_pct < Decimal(1) and boleta.get("reduce_only") is not True:
        return _recusa(
            "reducao_parcial_sem_reduce_only",
            (
                f"a boleta pede uma reducao PARCIAL (posicao_pct {posicao_pct}) e nao declara reduce_only: uma "
                "fraccao da posicao e' uma reducao, e quem reduz nunca inverte — as duas declaracoes teriam de "
                "dizer a mesma coisa"
            ),
        )

    # ---- porta 5: o `reduce_only` NAO EXISTE neste venue (RN-CT34/FR-... ) ------------------------------------
    reduce_only = _campo(boleta, "reduce_only")
    if isinstance(reduce_only, Recusa):
        return reduce_only
    if not isinstance(reduce_only, bool):
        return _recusa("tipo_invalido", "`boleta.reduce_only` tem de ser booleano")
    if reduce_only:
        return _recusa(
            "capacidade_nao_declarada",
            (
                "a boleta pede `reduce_only` e este venue NAO o tem (o manifesto declara "
                "`reduce_only_suportado: false`): o fecho faz-se por POSICAO, com o `positionId` (RN-CT34) — "
                "recusa, em vez de mandar uma ordem que pode virar abertura"
            ),
        )

    # ---- porta 6: o desvio, e o tipo que o aceita (RN-CT33/FR-059) --------------------------------------------
    if tipo_do_venue not in TIPOS_COM_DESVIO:
        return _recusa(
            "capacidade_nao_declarada",
            (
                f"a boleta pede `desvio_maximo` e o tipo {tipo!r} ({tipo_do_venue}) nao tem campo de desvio "
                f"neste venue — so' {', '.join(TIPOS_COM_DESVIO)} o tem (`slippageInPoints` + "
                "`baseSlippagePrice`). O tipo NAO se troca para acomodar o campo (FR-059)"
            ),
        )

    # ---- porta 7: os numeros de que a traducao precisa --------------------------------------------------------
    saldo = _decimal_do_campo(pedido, "saldo", "pedido.saldo", positivo=True)
    if isinstance(saldo, Recusa):
        return saldo
    preco = _decimal_do_campo(pedido, "preco", "pedido.preco", positivo=True)
    if isinstance(preco, Recusa):
        return preco
    saldo_pct = _decimal_do_campo(boleta, "saldo_pct", "boleta.saldo_pct", positivo=True)
    if isinstance(saldo_pct, Recusa):
        return saldo_pct
    alavancagem = _decimal_do_campo(boleta, "alavancagem", "boleta.alavancagem", positivo=True)
    if isinstance(alavancagem, Recusa):
        return alavancagem

    # ---- porta 8: o volume, na unidade do venue, conferido ANTES de enviar ------------------------------------
    minimo = _decimal_do_campo(simbolo, "minimo", "simbolo.minimo", positivo=True)
    if isinstance(minimo, Recusa):
        return minimo
    maximo = _decimal_do_campo(simbolo, "maximo", "simbolo.maximo", positivo=True)
    if isinstance(maximo, Recusa):
        return maximo
    passo = _decimal_do_campo(simbolo, "passo", "simbolo.passo", positivo=True)
    if isinstance(passo, Recusa):
        return passo
    conversao = ajustar_volume_ao_venue(
        saldo=saldo,
        saldo_pct=saldo_pct,
        alavancagem=alavancagem,
        preco=preco,
        minimo=minimo,
        maximo=maximo,
        passo=passo,
        instrumento=instrumento,
    )
    if isinstance(conversao, Recusa):
        return conversao
    volume = conversao.volume_efectivo

    # ---- porta 9: o stop e o alvo, relativos e com sinal, conferidos ao piso do simbolo ------------------------
    relativos: dict[str, int] = {}
    for campo_da_boleta, campo_do_venue, campo_do_piso, nome_do_piso in (
        ("stop_pct", "relativeStopLoss", "distancia_minima_do_stop", "stop"),
        ("tp_pct", "relativeTakeProfit", "distancia_minima_do_alvo", "alvo"),
    ):
        if campo_da_boleta not in boleta:
            continue  # a boleta nao pede este: ausente e' ausente, e nao vira zero (D4)
        pct_decimal = _decimal_do_campo(boleta, campo_da_boleta, f"boleta.{campo_da_boleta}", positivo=True)
        if isinstance(pct_decimal, Recusa):
            return pct_decimal
        relativo = distancia_relativa(preco=preco, pct=pct_decimal, lado=lado)
        if isinstance(relativo, Recusa):
            return relativo
        minima = simbolo.get(campo_do_piso)
        if minima is not None:
            minima_decimal = _decimal(minima, f"simbolo.{campo_do_piso}", positivo=True)
            if isinstance(minima_decimal, Recusa):
                return minima_decimal
            problema = conferir_distancia_minima(
                valor_relativo=relativo,
                minima=minima_decimal,
                unidade=simbolo.get("unidade_das_distancias"),
                nome_do_campo=nome_do_piso,
                instrumento=instrumento,
            )
            if problema is not None:
                return problema
        relativos[campo_do_venue] = relativo

    # ---- porta 10: o desvio, em pontos, pela grelha declarada pelo simbolo ------------------------------------
    desvio_pct = _decimal_do_campo(boleta, "desvio_maximo", "boleta.desvio_maximo", positivo=True)
    if isinstance(desvio_pct, Recusa):
        return desvio_pct
    desvio = desvio_em_pontos(
        desvio_pct=desvio_pct,
        preco=preco,
        digitos=simbolo.get("digitos"),
        posicao_do_pip=simbolo.get("posicao_do_pip"),
    )
    if isinstance(desvio, Recusa):
        return desvio
    base_do_desvio = preco_relativo(preco, "pedido.preco")
    if isinstance(base_do_desvio, Recusa):
        return base_do_desvio

    # ---- porta 11: a marca de posse, ate' 50 caracteres --------------------------------------------------------
    marca = marca_de_posse_do_cliente(
        marca=pedido.get("marca_do_cliente"),
        da_boleta=boleta.get("marca_de_posse"),
        referencia=boleta.get("referencia_do_cliente"),
    )
    if isinstance(marca, Recusa):
        return marca

    # ---- porta 12: os precos que o tipo obriga (a boleta e' NEUTRA: nao traz preco absoluto) -------------------
    precos: dict[str, int] = {}
    for campo_do_venue in PRECOS_OBRIGATORIOS_DO_TIPO[tipo_do_venue]:
        nome_neutro = NOME_NEUTRO_DO_PRECO[campo_do_venue]
        bruto = pedido.get(nome_neutro)
        if bruto is None:
            return _recusa(
                "campo_obrigatorio_ausente",
                (
                    f"o tipo {tipo!r} ({tipo_do_venue}) obriga a `{campo_do_venue}` do venue e o pedido nao traz "
                    f"`{nome_neutro}`: a boleta e' NEUTRA e nao traz preco absoluto — sem preco nao ha' accao a enviar"
                ),
            )
        preco_do_campo = _decimal(bruto, f"pedido.{nome_neutro}", positivo=True)
        if isinstance(preco_do_campo, Recusa):
            return preco_do_campo
        em_relativo = preco_relativo(preco_do_campo, f"pedido.{nome_neutro}")
        if isinstance(em_relativo, Recusa):
            return em_relativo
        precos[campo_do_venue] = em_relativo

    # ---- a accao do venue -------------------------------------------------------------------------------------
    accao: dict[str, Any] = {
        "symbolId": simbolo.get("symbol_id"),
        "tradeSide": LADO_DO_VENUE[lado],
        "orderType": tipo_do_venue,
        "volume": volume,
        "timeInForce": tif,
        "clientOrderId": marca,
        "slippageInPoints": desvio,
        "baseSlippagePrice": base_do_desvio,
    }
    # O stop e o alvo so' entram quando a boleta os pediu: ausente e' ausente, e nao vira `null` nem zero (D4).
    for campo_do_venue, valor in relativos.items():
        accao[campo_do_venue] = valor
    accao.update(precos)

    numeros_do_venue = pedido.get("numeros_do_venue")
    resolucao = montar_resolucao(
        quantidade=Decimal(volume) / Decimal(CENTESIMOS_POR_UNIDADE),
        preco=preco,
        alavancagem=alavancagem,
        numeros_do_venue=numeros_do_venue,
        # O `tick` do simbolo, da grade que ele declara (`10^-digitos`), para a projeccao [C] do preco de
        # liquidacao (A-12, 05/10/2026): sem ele o campo fica ausente, e a resolucao pre-envio volta a sair
        # incompleta. A grade e' a MESMA que o `desvio_em_pontos` ja' usa.
        tick=_tick_por_digitos(simbolo.get("digitos")),
    )
    return Feito(ok=True, accao=accao, resolucao=resolucao, conversao=conversao.declaracao())


def _nomes_declarados(instrumentos: Any) -> list[str]:
    """Os nomes dos instrumentos que o manifesto declara, na forma que o contrato lhes da'."""
    if not isinstance(instrumentos, list):
        return []
    nomes: list[str] = []
    for entrada in instrumentos:
        if not isinstance(entrada, dict):
            continue
        nome = entrada.get("simbolo")
        if isinstance(nome, str):
            nomes.append(nome)
    return nomes
