"""A LEITURA do mercado do conector cTrader — o objecto de factos da mesa, de UM instrumento.

A PECA, E O LUGAR DELA. `mercado` e' o que a mesa le' a cada volta (RN-D1/RN-D5): factos, e so' factos. Quem
os vai buscar e' este ficheiro, que tem duas metades com fronteira dura: a PURA (`montar_leitura`) recebe
DADOS — o que o `transporte.py` ja' devolve, os `Resultado` com `{ok, valor, motivo, porque}` — e monta a
carga do contrato; a ORQUESTRACAO (`ler_mercado`) e' a unica que fala com o `Transporte`. E' a mesma divisao
da `sonda.py`, e pela mesma razao: a parte que decide prova-se em dado, sem rede e sem chave.

O QUE O TRANSPORTE JA' DA', E O QUE AINDA NAO DA'. Da' a conta (`trader`), o simbolo por id
(`simbolos_por_id`), as posicoes (`posicoes`), as ordens vivas (`ordens_vivas`) e o nao-realizado por posicao
(`nao_realizado`). NAO da' — ainda — a cotacao nem o livro: o transporte sabe SUBSCREVER spots e profundidade
(`subscrever_spots`/`subscrever_profundidade`), mas nao tem leitura do ultimo retrato, porque o retrato chega
por ACONTECIMENTO do venue. Por isso a `EntradaMercado` entra como parametro declarado: o que o transporte
ainda nao entrega diz-se, e nao se inventa.

AS UNIDADES DO VENUE (§0 do data-model), que e' onde se erra em silencio:
  * precos: inteiros relativos -> `/100000` (`EXPOENTE_DO_PRECO`);
  * volumes: centesimos de unidade -> `/100` (`EXPOENTE_DO_VOLUME`);
  * valores monetarios (saldo, PnL): inteiros escalados -> `/10^moneyDigits`. O `moneyDigits` da CONTA nao vem
    no modelo da biblioteca (achado medido, `transporte._conta_por_dentro`); vem por POSICAO
    (`Position.money_digits`). A leitura usa o que a conta declarar e, quando ela o nao traz, o que a posicao
    declara — e' o MESMO numero do venue, lido de onde ele o publica. Sem nenhum dos dois, ou com dois
    valores DIFERENTES, a leitura RECUSA (`expoente_dos_valores_ausente`/`expoente_dos_valores_divergente`):
    sem expoente nao se converte dinheiro, e um dinheiro convertido a' sorte e' um numero nosso a passar por
    numero do venue.

O EQUITY E' DERIVADO, E A SOMA E' NOSSA (achado 1 do data-model). O venue NAO publica o total; publica as
PARCELAS: `ProtoOATrader.balance` e, por posicao, `ProtoOAPositionUnrealizedPnL.gross_unrealized_pn_l`. A
leitura publica

    equity = saldo + soma do nao-realizado BRUTO de TODAS as posicoes da conta

e DI-LO e' obrigacao: nenhuma taxa nossa entra (a conversao para a moeda da conta e' do venue,
`pnlConversionFee`), mas a soma e' um numero NOSSO — e num campo que o contrato declara de origem `venue`. Um
numero derivado nunca se apresenta como numero do venue: esta frase e' a declaracao, e o README e a bateria
tem de a repetir.

UMA CONTA HEDGED COM DUAS POSICOES NO MESMO INSTRUMENTO RECUSA (achado 3). O manifesto declara
`modelo_de_posicao: hedging` — o venue permite duas posicoes no mesmo simbolo — mas `mercado.posicao` e' UM
objecto so'. A leitura NAO escolhe uma: RECUSA com motivo nomeado (`duas_posicoes_no_mesmo_instrumento`).
Alargar o contrato (`posicao` -> lista) esta' NOMEADO e ADIADO.

O QUE O VENUE NAO DEU FICA AUSENTE (RN-D4). `posicao` ausente quando nao ha' posicao — nunca um objecto vazio,
nunca `null`. `bid` e `ask` podem faltar UM DE CADA VEZ (o venue manda os dois separados): publica-se o que
veio, e o que faltou falta pela ausencia da chave. `ordens_abertas` e' LISTA e obrigatoria: `[]` diz
«perguntei, e nao ha' nenhuma»; se a LEITURA das ordens falhar, NAO se produz leitura (recusa nomeada), porque
uma lista vazia inventada faria a mesa achar a conta limpa quando ela nao esta'.

O QUE FICA POR CONFIRMAR EM DEMONSTRACAO, dito aqui para nao parecer esquecimento:
  * o `tradingMode` do simbolo e' mapeado na FORMA TEXTUAL do venue (`ENABLED`, `DISABLED_*`,
    `CLOSE_ONLY_MODE` — tabela §5). Se a biblioteca o devolver como NUMERO, esta leitura RECUSA: nao se
    adivinha o numero do enum;
  * o `funding`: o venue publica `swapLong`/`swapShort`/`chargeSwapAtWeekends`, mas a UNIDADE do swap (pontos?
    valor escalado?) e o CALENDARIO dele ainda nao foram medidos — e o `chargeSwapAtWeekends` nem vem no modelo
    da biblioteca. A leitura publica `funding` so' quando ele lhe e' entregue ja' na forma do contrato; por
    omissao fica AUSENTE, declarado, em vez de uma `taxa` de unidade suposta.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
sys.path.insert(0, str(RAIZ / "contracts" / "esqueleto"))
sys.path.insert(0, str(AQUI))

from framing import validar, versao_vigente  # noqa: E402

#: Os precos do venue sao inteiros relativos: `preco = inteiro / 10^EXPOENTE_DO_PRECO` (§0 do data-model).
EXPOENTE_DO_PRECO = 5

#: O volume do venue e' em 0,01 de unidade: `unidades = volume / 10^EXPOENTE_DO_VOLUME`.
EXPOENTE_DO_VOLUME = 2

#: A marca de posse que a mesa compoe e' um inteiro sem sinal de 31 bits (RN-B10). A marca que o venue
#: PUBLICA so' se publica se couber nesta forma; uma marca que nao caiba fica AUSENTE (nunca arredondada).
LIMITE_DA_MARCA_DE_POSSE = 2147483647

#: O mapa do estado do mercado, do `tradingMode` do simbolo (tabela §5 do data-model). E' FECHADO nos dois
#: sentidos: um valor que nao esteja aqui RECUSA, em vez de virar um estado por omissao. `CLOSE_ONLY_MODE` e'
#: fechado PARA ABRIR (a leitura de estado so' sabe dizer aberto/fechado).
ESTADOS_DO_VENUE = {
    "ENABLED": "aberto",
    "DISABLED_WITHOUT_EXECUTION": "fechado",
    "DISABLED_WITH_PENDINGS_EXECUTION": "fechado",
    "CLOSE_ONLY_MODE": "fechado",
}

#: O lado do venue, nas duas formas em que ele o pode dar (a doc declara `BUY`(1)/`SELL`(2)). Um valor fora
#: destes mapas RECUSA: o lado de uma posicao ou de uma ordem nao se adivinha.
LADOS_POR_NOME = {"BUY": "buy", "SELL": "sell", "buy": "buy", "sell": "sell"}
LADOS_POR_NUMERO = {1: "buy", 2: "sell"}

#: As chaves do `ProtoOAOrder` de onde se tira o preco de uma ordem viva, por ordem de preferencia: o limite,
#: o stop, e o preco de execucao ja' publicado. Nenhuma e' um valor por omissao — e' a lista de onde o preco
#: PODE vir; se nenhuma trouxer um preco, a leitura recusa.
CHAVES_DO_PRECO_DA_ORDEM = ("limite", "stop", "preco_de_execucao")

#: A forma exacta de um decimal do contrato (`_defs/forma.schema.json`), para conferir `funding.taxa` quando
#: ele chega ja' pronto. Nao substitui o contrato: e' a conferencia de entrada.
PADRAO_DECIMAL = r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?$"


@dataclass(frozen=True)
class Recusa:
    """A recusa desta ponta: nomeada, e com a razao. Nunca se produz uma leitura pela metade."""

    ok: bool
    motivo: str
    porque: str


def recusa(motivo: str, porque: str) -> Recusa:
    return Recusa(ok=False, motivo=motivo, porque=porque)


@dataclass(frozen=True)
class _Lida:
    """Uma leitura do transporte ja' normalizada: ou veio um valor, ou veio uma falha nomeada."""

    ok: bool
    valor: Any
    motivo: str
    porque: str


@dataclass(frozen=True)
class EntradaMercado:
    """O que o transporte AINDA NAO entrega: a cotacao e o livro, que chegam por ACONTECIMENTO do venue.

    Os precos sao os INTEIROS RELATIVOS do venue (`ProtoOASpotEvent`, `/100000`), nao decimais: quem os
    converte e' a parte pura, num sitio so'. Um lado pode faltar (o venue manda bid e ask separados) — a
    ausencia e' a chave a `None`, e nunca um zero.
    """

    tempo_do_venue_ms: int
    bid: int | None = None
    ask: int | None = None
    ultimo: int | None = None
    livro: dict[str, Any] | None = None


# -----------------------------------------------------------------------------------------------------------
# A FORMA. As conversoes de unidade, e a leitura crua sem coagir nada.
# -----------------------------------------------------------------------------------------------------------


def _decimal_de_escalado(inteiro: int, expoente: int) -> str:
    """Um inteiro escalado do venue -> o decimal TEXTUAL do contrato, sem zeros a' direita.

    Aritmetica de inteiros, nunca virgula flutuante: `108541/100000` e' "1.08541", e nao "1.0854100000000001".
    O sinal conserva-se, e um `-0` nao existe (o zero escreve-se "0").
    """
    modulo = abs(inteiro)
    digitos = str(modulo).rjust(expoente + 1, "0")
    parte_inteira = digitos[: len(digitos) - expoente]
    parte_fracao = digitos[len(digitos) - expoente :].rstrip("0")
    texto = parte_inteira if parte_fracao == "" else f"{parte_inteira}.{parte_fracao}"
    if inteiro < 0 and texto != "0":
        return f"-{texto}"
    return texto


def _ler_leitura(bruto: Any) -> _Lida:
    """Normaliza um `Resultado` do transporte (ja' em dicionario) para a forma interna.

    Um `ok` que nao seja `True` nunca vira um valor: vira a FALHA declarada, com o motivo de quem a leu.
    """
    if not isinstance(bruto, dict):
        return _Lida(
            ok=False,
            valor=None,
            motivo="campo_obrigatorio_ausente",
            porque="a leitura de uma grandeza do venue nao foi entregue a esta funcao",
        )
    if bruto.get("ok") is not True:
        motivo = bruto.get("motivo")
        porque = bruto.get("porque")
        if not isinstance(motivo, str):
            return _Lida(
                ok=False,
                valor=None,
                motivo="falha_ao_ler_o_venue",
                porque=f"a leitura falhou sem motivo declarado: {bruto!r}",
            )
        if not isinstance(porque, str):
            return _Lida(ok=False, valor=None, motivo=motivo, porque=f"a leitura falhou ({motivo}) sem razao declarada")
        return _Lida(ok=False, valor=None, motivo=motivo, porque=porque)
    return _Lida(ok=True, valor=bruto.get("valor"), motivo="", porque="")


def _inteiro(valor: Any) -> int | None:
    """O `valor` quando e' um inteiro de verdade. `True`/`False` NAO sao inteiros aqui (sao booleanos)."""
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    return None


def _lado_do_venue(valor: Any) -> str | None:
    """O lado neutro, ou `None` quando o venue deu um lado que nao e' compra nem venda."""
    if isinstance(valor, str):
        return LADOS_POR_NOME.get(valor)
    numero = _inteiro(valor)
    if numero is None:
        return None
    return LADOS_POR_NUMERO.get(numero)


def _marca_de_posse_31_bits(marca: Any) -> int | None:
    """A marca que o venue publicou, QUANDO ela cabe na forma do contrato (inteiro de 31 bits).

    O venue guarda a marca no `clientOrderId`/`label` — texto. Como a marca que a mesa compoe e' um inteiro de
    31 bits (RN-B10), um texto que seja esse inteiro LE-SE (nao se inventa: e' o mesmo numero). Um texto que
    nao caiba, ou uma marca ausente, fica AUSENTE — e uma posicao sem marca e' tratada pela mesa como ALHEIA
    (relata e nao gere), que e' o lado seguro do erro. Arredondar ou truncar seria dizer que a posicao e' nossa
    sem o venue o dizer.
    """
    numero = _inteiro(marca)
    if numero is not None:
        if 0 <= numero <= LIMITE_DA_MARCA_DE_POSSE:
            return numero
        return None
    if isinstance(marca, str):
        texto = marca.strip()
        if texto.isdigit():
            valor = int(texto)
            if valor <= LIMITE_DA_MARCA_DE_POSSE:
                return valor
    return None


def _preco_opcional(nome: str, valor: Any) -> str | Recusa | None:
    """Um preco que o venue pode nao ter mandado neste retrato.

    Ausente (`None`) e zero -> AUSENTE: nenhum dos dois e' um preco, e o contrato nao admite um preco zero.
    Um valor que nao seja um inteiro positivo -> RECUSA (o venue deu um preco que nao se sabe ler; omiti-lo
    seria esconder um numero que ele deu).
    """
    if valor is None:
        return None
    inteiro = _inteiro(valor)
    if inteiro is None:
        return recusa(
            "formato_invalido",
            f"o {nome} do venue veio {valor!r}, que nao e' um inteiro relativo de preco (o venue da' inteiros /100000)",
        )
    if inteiro == 0:
        return None
    if inteiro < 0:
        return recusa("formato_invalido", f"o {nome} do venue veio negativo ({inteiro}), e um preco negativo nao existe")
    return _decimal_de_escalado(inteiro, EXPOENTE_DO_PRECO)


def _preco_da_ordem(ordem: dict[str, Any]) -> str | None:
    """O preco de uma ordem viva: o primeiro dos que o venue publica, pela ordem declarada.

    Devolve `None` quando NENHUM foi publicado — e quem chama RECUSA, porque o contrato exige o preco de cada
    ordem viva e um preco inventado seria pior do que nenhuma leitura.
    """
    for chave in CHAVES_DO_PRECO_DA_ORDEM:
        valor = _inteiro(ordem.get(chave))
        if valor is not None and valor > 0:
            return _decimal_de_escalado(valor, EXPOENTE_DO_PRECO)
    return None


def _expoente_dos_valores(conta: dict[str, Any], posicoes: list[Any]) -> int | Recusa:
    """O `moneyDigits` da conta, declarado pela conta ou por uma posicao — e nunca adivinhado.

    O modelo da biblioteca nao traz o expoente na CONTA (achado medido), mas traz em cada `Position`. E' o
    mesmo numero do venue, publicado noutro sitio: le'-se de onde ele o da'. Sem nenhum, RECUSA. Com dois
    valores DIFERENTES, RECUSA tambem — escolher um seria decidir a unidade do dinheiro por conta propria.
    """
    candidatos: list[int] = []
    da_conta = _inteiro(conta.get("expoente_dos_valores"))
    if da_conta is not None and da_conta >= 0:
        candidatos.append(da_conta)
    for posicao in posicoes:
        if not isinstance(posicao, dict):
            continue
        da_posicao = _inteiro(posicao.get("expoente"))
        if da_posicao is not None and da_posicao >= 0:
            candidatos.append(da_posicao)
    if not candidatos:
        return recusa(
            "expoente_dos_valores_ausente",
            "nem a conta nem nenhuma posicao declararam o `moneyDigits`: sem ele o saldo e o nao-realizado (inteiros "
            "escalados do venue) nao se convertem, e um equity inventado seria um numero nosso a passar por numero "
            "do venue",
        )
    distintos = sorted(set(candidatos))
    if len(distintos) > 1:
        return recusa(
            "expoente_dos_valores_divergente",
            f"o expoente dos valores divergiu ({distintos}): a conta e as posicoes do venue nao dizem a mesma "
            "unidade, e a leitura nao escolhe uma",
        )
    return distintos[0]


def _estado_do_mercado(simbolo: dict[str, Any]) -> str | Recusa:
    """O `tradingMode` do simbolo -> `aberto`/`fechado`, pelo mapa FECHADO da tabela §5."""
    do_venue = simbolo.get("modo_de_negociacao")
    if not isinstance(do_venue, str):
        return recusa(
            "campo_obrigatorio_ausente",
            f"o simbolo nao declarou `tradingMode` utilizavel (veio {do_venue!r}): sem ele nao se sabe se o "
            "mercado esta' aberto, e nao se adivinha",
        )
    estado = ESTADOS_DO_VENUE.get(do_venue)
    if estado is None:
        return recusa(
            "valor_fora_do_conjunto",
            f"o venue declarou `tradingMode` = {do_venue!r}, que nao esta' no mapa conhecido "
            f"({', '.join(ESTADOS_DO_VENUE)}): sem estado do mercado nao ha' leitura — e nao se adivinha",
        )
    return estado


def _posicao_do_instrumento(posicoes: list[Any], symbol_id: int) -> dict[str, Any] | Recusa | None:
    """A posicao ABERTA deste instrumento — uma, nenhuma, ou a RECUSA por haver duas (achado 3).

    Devolve `None` quando nao ha' posicao (e o campo fica AUSENTE na carga — nunca um objecto vazio, nunca
    `null`). Numa conta HEDGED com DUAS posicoes no mesmo instrumento, devolve a recusa nomeada: o contrato so'
    tem UM `posicao`, e escolher uma seria adivinhar qual.
    """
    do_instrumento: list[dict[str, Any]] = []
    for posicao in posicoes:
        if not isinstance(posicao, dict):
            return recusa("formato_invalido", "uma posicao do venue nao veio com forma de objecto")
        if _inteiro(posicao.get("symbol_id")) != symbol_id:
            continue
        do_instrumento.append(posicao)

    if not do_instrumento:
        return None
    if len(do_instrumento) > 1:
        ids = ", ".join(str(p.get("posicao")) for p in do_instrumento)
        return recusa(
            "duas_posicoes_no_mesmo_instrumento",
            f"a conta tem {len(do_instrumento)} posicoes no instrumento de id {symbol_id} (posicoes {ids}): o "
            "contrato so' tem UMA `posicao` por leitura, e escolher uma seria adivinhar qual — a leitura RECUSA "
            "em vez de escolher (o alargamento do contrato esta' nomeado e adiado)",
        )

    posicao = do_instrumento[0]
    lado = _lado_do_venue(posicao.get("lado"))
    if lado is None:
        return recusa(
            "formato_invalido",
            f"a posicao {posicao.get('posicao')} veio com lado {posicao.get('lado')!r}: o venue so' tem compra "
            "e venda, e o lado de uma posicao nao se adivinha",
        )
    volume = _inteiro(posicao.get("volume"))
    if volume is None or volume <= 0:
        return recusa(
            "formato_invalido",
            f"a posicao {posicao.get('posicao')} veio sem volume positivo (veio {posicao.get('volume')!r}): sem "
            "unidades nao ha' posicao a publicar",
        )
    entrada = _inteiro(posicao.get("preco_de_entrada"))
    if entrada is None or entrada <= 0:
        return recusa(
            "formato_invalido",
            f"a posicao {posicao.get('posicao')} veio sem preco de entrada positivo (veio "
            f"{posicao.get('preco_de_entrada')!r}): o preco medio e' obrigatorio no contrato",
        )

    carga: dict[str, Any] = {
        "lado": lado,
        "unidades": _decimal_de_escalado(volume, EXPOENTE_DO_VOLUME),
        "preco_medio": _decimal_de_escalado(entrada, EXPOENTE_DO_PRECO),
    }
    marca = _marca_de_posse_31_bits(posicao.get("marca"))
    if marca is not None:
        carga["marca_de_posse"] = marca
    return carga


def _ordem_para_o_contrato(ordem: dict[str, Any], instrumento: str) -> dict[str, Any] | Recusa:
    """Uma ordem viva do venue -> o item de `ordens_abertas` do contrato. Qualquer falha RECUSA a leitura.

    O `unidades` e' o que FALTA executar (`volume - executedVolume`), como o data-model §6 o descreve, e nao o
    volume pedido. Uma ordem viva sem preco, sem lado ou sem resto NAO se salta em silencio: saltar uma ordem
    que se sabe existir faria a mesa achar a conta limpa — o mesmo defeito de uma lista vazia inventada.
    """
    bruto = ordem.get("ordem")
    if isinstance(bruto, str) and bruto != "":
        identificador = bruto
    else:
        numero = _inteiro(bruto)
        if numero is None:
            return recusa(
                "formato_invalido",
                "uma ordem viva do venue veio sem identificador (`orderId`): sem ele a mesa e o humano nao falam "
                "da MESMA ordem",
            )
        identificador = str(numero)

    lado = _lado_do_venue(ordem.get("lado"))
    if lado is None:
        return recusa(
            "formato_invalido",
            f"a ordem viva {identificador} veio com lado {ordem.get('lado')!r}: o venue so' tem compra e venda, "
            "e o lado nao se adivinha",
        )

    preco = _preco_da_ordem(ordem)
    if preco is None:
        return recusa(
            "formato_invalido",
            f"a ordem viva {identificador} nao trouxe preco nenhum (`limitPrice`/`stopPrice`/`executionPrice`): o "
            "contrato exige o preco de cada ordem viva, e o que o venue nao deu nao se inventa",
        )

    volume = _inteiro(ordem.get("volume"))
    executado = _inteiro(ordem.get("volume_executado"))
    if volume is None or executado is None:
        return recusa(
            "formato_invalido",
            f"a ordem viva {identificador} veio sem `volume`/`executedVolume` legivel (veio "
            f"{ordem.get('volume')!r}/{ordem.get('volume_executado')!r}): sem eles nao ha' unidades por executar",
        )
    por_executar = volume - executado
    if por_executar <= 0:
        return recusa(
            "formato_invalido",
            f"a ordem viva {identificador} nao tem volume por executar ({volume} pedido, {executado} executado): "
            "uma ordem sem resto nao e' uma ordem viva, e nao se publica com zero unidades",
        )

    item: dict[str, Any] = {
        "instrumento": instrumento,
        "ordem": identificador,
        "lado": lado,
        "preco": preco,
        "unidades": _decimal_de_escalado(por_executar, EXPOENTE_DO_VOLUME),
    }
    marca = _marca_de_posse_31_bits(ordem.get("marca_do_cliente"))
    if marca is not None:
        item["marca_de_posse"] = marca
    return item


def _livro_para_o_contrato(livro: Any) -> dict[str, Any] | Recusa:
    """O livro do venue (precos `/100000`, tamanhos `/100`) -> a forma do contrato.

    Um livro entregue mas VAZIO ou sem profundidade RECUSA: o contrato exige `minItems: 1` e uma profundidade
    declarada, e um livro a zero seria um livro que ninguem viu.
    """
    if not isinstance(livro, dict):
        return recusa("formato_invalido", "o livro entregue nao veio com forma de objecto")
    lados_brutos = livro.get("lados")
    if not isinstance(lados_brutos, list) or not lados_brutos:
        return recusa("formato_invalido", "o livro veio sem lados: um livro vazio nao e' um livro que se publica")
    profundidade = _inteiro(livro.get("profundidade"))
    if profundidade is None or profundidade < 1:
        return recusa(
            "formato_invalido",
            f"o livro veio sem profundidade declarada (veio {livro.get('profundidade')!r}): o setup tem de saber "
            "o que nao ve'",
        )
    lados: list[dict[str, str]] = []
    for lado_bruto in lados_brutos:
        if not isinstance(lado_bruto, dict):
            return recusa("formato_invalido", "um lado do livro nao veio com forma de objecto")
        preco = _inteiro(lado_bruto.get("preco"))
        tamanho = _inteiro(lado_bruto.get("tamanho"))
        if preco is None or preco <= 0:
            return recusa("formato_invalido", f"um nivel do livro veio sem preco positivo (veio {lado_bruto.get('preco')!r})")
        if tamanho is None or tamanho <= 0:
            return recusa("formato_invalido", f"um nivel do livro veio sem tamanho positivo (veio {lado_bruto.get('tamanho')!r})")
        lados.append({"preco": _decimal_de_escalado(preco, EXPOENTE_DO_PRECO), "tamanho": _decimal_de_escalado(tamanho, EXPOENTE_DO_VOLUME)})
    return {"lados": lados, "profundidade": profundidade}


def _funding_para_o_contrato(funding: Any) -> dict[str, Any] | Recusa:
    """O `funding` que o transporte ainda NAO sabe compor, publicado so' quando vem ja' na forma do contrato.

    O venue publica `swapLong`/`swapShort`/`chargeSwapAtWeekends`, mas a unidade do swap e o calendario dele
    estao por medir em demonstracao (o `chargeSwapAtWeekends` nem vem no modelo da biblioteca). Enquanto isso,
    a leitura nao converte um numero cuja unidade nao conhece: recebe-o ja' na forma do contrato, ou fica
    AUSENTE — declarado, e nao um `taxa` suposto.
    """
    if not isinstance(funding, dict):
        return recusa("formato_invalido", "o funding entregue nao veio com forma de objecto")
    taxa = funding.get("taxa")
    instante = _inteiro(funding.get("instante_ms"))
    if not isinstance(taxa, str):
        return recusa("formato_invalido", f"o `funding.taxa` veio {taxa!r}, e o contrato exige decimal textual")
    if re.fullmatch(PADRAO_DECIMAL, taxa) is None:
        return recusa("formato_invalido", f"o `funding.taxa` veio {taxa!r}, que nao e' decimal textual do contrato")
    if instante is None or instante < 0:
        return recusa("campo_obrigatorio_ausente", f"o `funding.instante_ms` veio {funding.get('instante_ms')!r}, sem instante do venue")
    return {"taxa": taxa, "instante_ms": instante}


# -----------------------------------------------------------------------------------------------------------
# A LEITURA. PURA: recebe os dados e devolve a carga do contrato — ou a recusa, nomeada.
# -----------------------------------------------------------------------------------------------------------


def montar_leitura(bruto: dict[str, Any]) -> dict[str, Any] | Recusa:
    """O `mercado` de UM instrumento, a partir do que o transporte devolveu. Nao fala com ninguem.

    O `bruto` tem o pedido (`instrumento`, `symbol_id`, `agora_ms`), o relogio do venue
    (`tempo_do_venue_ms`), a cotacao/livro em inteiros do venue (`bid`, `ask`, `ultimo`, `livro` — todos
    opcionais) e CINCO leituras do transporte, cada uma na forma `{ok, valor, motivo, porque}`: `conta`,
    `simbolo`, `posicoes`, `ordens` e `nao_realizado`. `funding` e' opcional e entra ja' na forma do contrato.

    A carga que sai e' conferida contra o contrato ANTES de ser devolvida: um objecto que o contrato recusaria
    nao chega a ser uma leitura.
    """
    # ---- o pedido -----------------------------------------------------------------------------------------
    instrumento = bruto.get("instrumento")
    if not isinstance(instrumento, str) or instrumento == "":
        return recusa("campo_obrigatorio_ausente", "a leitura nao declara o instrumento que ela le'")
    symbol_id = _inteiro(bruto.get("symbol_id"))
    if symbol_id is None:
        return recusa("campo_obrigatorio_ausente", "a leitura nao declara o `symbol_id` do venue: sem ele nao se sabe de que instrumento se fala")
    agora_ms = _inteiro(bruto.get("agora_ms"))
    if agora_ms is None or agora_ms < 0:
        return recusa(
            "campo_obrigatorio_ausente",
            "a leitura nao recebeu o NOSSO relogio (`agora_ms`): a idade do dado mede-se contra o relogio do venue, "
            "e sem o nosso lado dessa conta nao se mede",
        )

    # O INSTANTE E' DO VENUE (RN-D2), nunca do processo: e' ele que carimba o dado.
    tempo_do_venue = _inteiro(bruto.get("tempo_do_venue_ms"))
    if tempo_do_venue is None or tempo_do_venue < 0:
        return recusa(
            "tempo_do_venue_nao_lido",
            "o venue nao declarou o instante do dado (`utcTimestampInMinutes`/`executionTimestamp`): a idade mede-se "
            "contra o relogio DELE, e com o nosso relogio seria outra grandeza",
        )

    # ---- as cinco leituras do transporte ------------------------------------------------------------------
    conta_lida = _ler_leitura(bruto.get("conta"))
    if not conta_lida.ok:
        return recusa(conta_lida.motivo, conta_lida.porque)
    simbolo_lido = _ler_leitura(bruto.get("simbolo"))
    if not simbolo_lido.ok:
        return recusa(simbolo_lido.motivo, simbolo_lido.porque)
    posicoes_lidas = _ler_leitura(bruto.get("posicoes"))
    if not posicoes_lidas.ok:
        return recusa(
            posicoes_lidas.motivo,
            f"a leitura das posicoes falhou ({posicoes_lidas.porque}): uma posicao que nao se leu nunca vira «sem posicao»",
        )
    ordens_lidas = _ler_leitura(bruto.get("ordens"))
    if not ordens_lidas.ok:
        return recusa(
            ordens_lidas.motivo,
            f"a leitura das ordens vivas nao se fez ({ordens_lidas.porque}): sem ela nao se sabe o que esta' "
            "pendurado, e uma lista vazia inventada faria a mesa achar a conta limpa — nao se produz leitura",
        )
    nao_realizado_lido = _ler_leitura(bruto.get("nao_realizado"))
    if not nao_realizado_lido.ok:
        return recusa(
            nao_realizado_lido.motivo,
            f"a leitura do nao-realizado por posicao falhou ({nao_realizado_lido.porque}): sem ela o equity derivado "
            "nao se soma, e um equity estimado seria um numero nosso a passar por numero do venue",
        )

    conta = conta_lida.valor
    simbolo = simbolo_lido.valor
    posicoes = posicoes_lidas.valor
    ordens = ordens_lidas.valor
    nao_realizado = nao_realizado_lido.valor
    if not isinstance(conta, dict):
        return recusa("formato_invalido", "a leitura da conta nao veio com forma de objecto")
    if not isinstance(simbolo, dict):
        return recusa("formato_invalido", "a leitura do simbolo nao veio com forma de objecto")
    if not isinstance(posicoes, list) or not isinstance(ordens, list) or not isinstance(nao_realizado, list):
        return recusa("formato_invalido", "uma das leituras da conta nao veio em lista (`posicoes`/`ordens`/`nao_realizado`)")

    # ---- o EQUITY, DERIVADO --------------------------------------------------------------------------------
    # A SOMA E' NOSSA (achado 1 do data-model): o venue publica as PARCELAS — o saldo (`ProtoOATrader.balance`)
    # e, por posicao, o nao-realizado BRUTO (`gross_unrealized_pn_l`) — e nao o total. Publica-se
    #     equity = saldo + soma do nao-realizado bruto de TODAS as posicoes da conta
    # e diz-se que se somou: nenhuma taxa nossa entra (a conversao de moeda e' do venue, `pnlConversionFee`), mas
    # a soma e' um numero NOSSO, e um numero derivado nunca se apresenta como numero do venue.
    expoente = _expoente_dos_valores(conta, posicoes)
    if isinstance(expoente, Recusa):
        return expoente
    saldo = _inteiro(conta.get("saldo"))
    if saldo is None:
        return recusa(
            "campo_obrigatorio_ausente",
            f"a conta nao declarou o saldo (`balance`) legivel (veio {conta.get('saldo')!r}): sem a primeira parcela "
            "o equity nao se soma",
        )
    soma = saldo
    for linha in nao_realizado:
        if not isinstance(linha, dict):
            return recusa("formato_invalido", "uma linha do nao-realizado por posicao nao veio com forma de objecto")
        parcela = _inteiro(linha.get("bruto"))
        if parcela is None:
            return recusa(
                "campo_obrigatorio_ausente",
                f"a linha do nao-realizado da posicao {linha.get('posicao')} veio sem o bruto "
                f"(`gross_unrealized_pn_l` = {linha.get('bruto')!r}): o equity e' a soma das parcelas do venue, e uma "
                "parcela ausente nao vale zero",
            )
        soma += parcela
    equity = _decimal_de_escalado(soma, expoente)

    # ---- a carga -------------------------------------------------------------------------------------------
    estado = _estado_do_mercado(simbolo)
    if isinstance(estado, Recusa):
        return estado

    carga: dict[str, Any] = {
        "instrumento": instrumento,
        "tempo_do_venue_ms": tempo_do_venue,
        # A IDADE E' NOSSA [C]: agora - o instante do VENUE, nunca negativo (um relogio adiantado do venue nao
        # faz um dado do futuro). Medida, e nao um numero do venue.
        "idade_do_dado_ms": max(0, agora_ms - tempo_do_venue),
        "estado": estado,
    }

    for nome in ("bid", "ask", "ultimo"):
        preco = _preco_opcional(nome, bruto.get(nome))
        if isinstance(preco, Recusa):
            return preco
        if preco is not None:
            carga[nome] = preco

    livro = bruto.get("livro")
    if livro is not None:
        lido_livro = _livro_para_o_contrato(livro)
        if isinstance(lido_livro, Recusa):
            return lido_livro
        carga["livro"] = lido_livro

    ordens_do_instrumento: list[dict[str, Any]] = []
    for ordem in ordens:
        if not isinstance(ordem, dict):
            return recusa("formato_invalido", "uma ordem viva do venue nao veio com forma de objecto")
        if _inteiro(ordem.get("symbol_id")) != symbol_id:
            continue
        ordens_do_instrumento.append(ordem)
    ordens_abertas: list[dict[str, Any]] = []
    for ordem in ordens_do_instrumento:
        item = _ordem_para_o_contrato(ordem, instrumento)
        if isinstance(item, Recusa):
            return item
        ordens_abertas.append(item)
    # LISTA OBRIGATORIA: `[]` diz «perguntei, e nao ha' nenhuma» — que e' outra coisa de «nao perguntei».
    carga["ordens_abertas"] = ordens_abertas

    posicao = _posicao_do_instrumento(posicoes, symbol_id)
    if isinstance(posicao, Recusa):
        return posicao
    if posicao is not None:
        carga["posicao"] = posicao

    carga["equity"] = equity

    funding = bruto.get("funding")
    if funding is not None:
        lido_funding = _funding_para_o_contrato(funding)
        if isinstance(lido_funding, Recusa):
            return lido_funding
        carga["funding"] = lido_funding

    # ---- o contrato confere a leitura ANTES de ela servir de alguma coisa ----------------------------------
    linha = json.dumps(
        {"contrato": versao_vigente(), "tipo": "mercado", "id": f"mercado/{instrumento}", "carga": carga},
        ensure_ascii=False,
    )
    veredicto = validar(linha)
    if veredicto.get("veredicto") != "aceite":
        return recusa(
            "mercado_recusado_pelo_contrato",
            f"a leitura montada nao passa o contrato ({veredicto.get('motivo')}): nao se publica",
        )
    return carga


# -----------------------------------------------------------------------------------------------------------
# A ORQUESTRACAO. Aqui — e so' aqui — se fala com o `Transporte`. O que ele ainda nao entrega vem da entrada.
# -----------------------------------------------------------------------------------------------------------


def _resposta(resultado: Any) -> dict[str, Any]:
    """Um `Resultado` do transporte -> a forma `{ok, valor, motivo, porque}` que a parte pura consome."""
    return {"ok": resultado.ok, "valor": resultado.valor, "motivo": resultado.motivo, "porque": resultado.porque}


def _simbolo_lido(transporte_resultado: Any, symbol_id: int) -> dict[str, Any]:
    """Do `simbolos_por_id` (uma lista) para A leitura do simbolo desta leitura, ou a falha nomeada."""
    if not transporte_resultado.ok:
        return _resposta(transporte_resultado)
    if not isinstance(transporte_resultado.valor, list):
        return {"ok": False, "motivo": "falha_ao_ler_os_simbolos", "porque": "a leitura do simbolo nao veio em lista"}
    for simbolo in transporte_resultado.valor:
        if isinstance(simbolo, dict) and simbolo.get("symbol_id") == symbol_id:
            return {"ok": True, "valor": simbolo, "motivo": None, "porque": ""}
    return {
        "ok": False,
        "motivo": "instrumento_desconhecido_no_manifesto",
        "porque": f"o venue nao devolveu o simbolo {symbol_id} que a sonda resolveu: sem os numeros dele nao ha' leitura",
    }


def ler_mercado(
    transporte: Any,
    account_id: int,
    *,
    instrumento: str,
    symbol_id: int,
    agora_ms: int,
    entrada: EntradaMercado,
    funding: dict[str, Any] | None = None,
) -> dict[str, Any] | Recusa:
    """A leitura AO VIVO: vai buscar ao `Transporte` o que ele da', junta a entrada, e chama a parte pura.

    O `transporte` entra como PARAMETRO (e nao e' construido aqui): quem chama e' que tem o fio e a conta
    autorizada. O nome do instrumento e o `symbol_id` vem da sonda (RN-CT23) — esta funcao nao os adivinha.
    `funding` so' entra quando o chamador o tem ja' na forma do contrato (a unidade do swap do venue esta' por
    medir em demonstracao).
    """
    bruto: dict[str, Any] = {
        "instrumento": instrumento,
        "symbol_id": symbol_id,
        "agora_ms": agora_ms,
        "tempo_do_venue_ms": entrada.tempo_do_venue_ms,
        "conta": _resposta(transporte.trader(account_id)),
        "simbolo": _simbolo_lido(transporte.simbolos_por_id(account_id, [symbol_id]), symbol_id),
        "posicoes": _resposta(transporte.posicoes(account_id)),
        "ordens": _resposta(transporte.ordens_vivas(account_id)),
        "nao_realizado": _resposta(transporte.nao_realizado(account_id)),
    }
    if entrada.bid is not None:
        bruto["bid"] = entrada.bid
    if entrada.ask is not None:
        bruto["ask"] = entrada.ask
    if entrada.ultimo is not None:
        bruto["ultimo"] = entrada.ultimo
    if entrada.livro is not None:
        bruto["livro"] = entrada.livro
    if funding is not None:
        bruto["funding"] = funding
    return montar_leitura(bruto)
