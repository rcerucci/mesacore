"""O FECHO do conector cTrader: fecha POR POSICAO — e fechar NAO abre.

PORQUE E' QUE ISTO E' UM FICHEIRO E NAO UMA LINHA. Noutro venue o fecho faz-se com uma ordem de lado contrario,
e a casa ja' mediu o defeito: quando nao havia nada para fechar, a ordem de lado contrario ABRIA. Este venue tem
o verbo que resolve isso — uma ordem que REFERENCIA a posicao (`positionId`) e e' o venue que a fecha (RN-CT34).
Um fecho nunca se compoe por lado contrario: aqui nao ha' caminho de codigo que o faca, porque o lado sai da
POSICAO (o oposto dela), e nao de boleta nenhuma.

SEM POSICAO, NAO SAI ORDEM. Sem posicao aberta no instrumento, a decisao e' `nada` com o motivo
`sem_posicao_para_fechar`, e `ordem` fica ausente: nao se manda uma ordem para «fechar» o que nao existe — e' o
FR-065, e e' o caso que a bateria tem de medir (SC-017).

OS DOIS MODOS DE «FECHAR SIM, ABRIR NAO» (RN-CT12/RN-CT22, FR-066). Este venue tem os dois, e em sitios
diferentes: o DIREITO da conta (`accessRights = CLOSE_ONLY`) e o MODO do simbolo (`tradingMode =
CLOSE_ONLY_MODE`). Ambos sao LIDOS, nunca adivinhados, e ambos recusam a ABERTURA — e so' a abertura: o FECHO do
que ja' existe CONTINUA A PASSAR (e' o que os distingue de um mercado fechado).

O QUE ESTE FICHEIRO NAO FAZ. Nao fala com o venue (o transporte e' do `transporte.py`), nao le' posicoes por si
(elas chegam como DADO, da leitura), nao decide se se fecha, nem o momento, nem o tamanho (RN-C5/RN-C15).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# -----------------------------------------------------------------------------------------------------------
# O vocabulario deste ficheiro. Dois conjuntos FECHADOS do venue, um motivo da decisao, e o mapa do lado.
# -----------------------------------------------------------------------------------------------------------

#: A classificacao da decisao quando NAO ha' nada a fazer: nem ordem enviada, nem recusa de ordem.
ACAO_NADA = "nada"
#: A decisao de enviar a ordem de fecho.
ACAO_FECHAR = "fechar"
#: A decisao de enviar uma abertura.
ACAO_ABRIR = "abrir"
#: A decisao de recusar (a abertura, nos dois modos de «fechar sim, abrir nao»; ou a leitura ambigua).
ACAO_RECUSAR = "recusar"

#: O motivo do «nada» quando nao ha' posicao no instrumento (FR-065 / SC-017). E' o nome que a spec fixa.
MOTIVO_SEM_POSICAO = "sem_posicao_para_fechar"
#: O motivo da leitura ambigua: duas posicoes no mesmo instrumento (achado 3 do data-model). Nao se escolhe uma.
MOTIVO_DUAS_POSICOES = "duas_posicoes_no_mesmo_instrumento"

#: O direito da CONTA que so' deixa fechar (`ProtoOAAccessRights`, RN-CT12).
DIREITO_QUE_SO_FECHA = "CLOSE_ONLY"

#: O modo do SIMBOLO que so' deixa fechar (`ProtoOASymbol.tradingMode`, RN-CT22).
MODO_QUE_SO_FECHA = "CLOSE_ONLY_MODE"

#: Os modos do simbolo que este ficheiro conhece. Conjunto FECHADO: um valor que nao esteja aqui RECUSA —
#: um modo que nao se le' nao vira «abre».
MODOS_DE_NEGOCIACAO_CONHECIDOS = (
    "ENABLED",
    "DISABLED_WITHOUT_PENDINGS_EXECUTION",
    "DISABLED_WITH_PENDINGS_EXECUTION",
    MODO_QUE_SO_FECHA,
)

#: O lado do venue (RN-CT30) e o seu OPOSTO — o fecho vai pelo oposto da POSICAO, nunca por um lado de boleta.
LADO_DO_VENUE_COMPRA = "BUY"
LADO_DO_VENUE_VENDA = "SELL"
LADO_OPOSTO = {LADO_DO_VENUE_COMPRA: LADO_DO_VENUE_VENDA, LADO_DO_VENUE_VENDA: LADO_DO_VENUE_COMPRA}


@dataclass(frozen=True)
class Decisao:
    """O que se decidiu: uma accao, o motivo (quando ha'), o porque escrito, e a ordem (quando ha' uma)."""

    acao: str
    motivo: str | None
    porque: str
    ordem: dict[str, Any] | None = None


@dataclass(frozen=True)
class Recusa:
    ok: bool
    motivo: str
    porque: str


def recusa(motivo: str, porque: str) -> Recusa:
    return Recusa(ok=False, motivo=motivo, porque=porque)


# -----------------------------------------------------------------------------------------------------------
# A leitura das posicoes — uma so' por instrumento, ou nada.
# -----------------------------------------------------------------------------------------------------------


def posicao_do_instrumento(posicoes: Any, symbol_id: Any) -> dict[str, Any] | None | Recusa:
    """A posicao ABERTA neste instrumento: uma, nenhuma, ou RECUSA quando ha' duas.

    O contrato tem `mercado.posicao` como UM objecto, e o venue permite duas no mesmo instrumento numa conta
    HEDGED. O conector nao escolhe uma (achado 3 do data-model): recusa, com o motivo nomeado. Duas posicoes
    sem `symbol_id` utilizavel tambem nao se adivinham.
    """
    if not isinstance(posicoes, list):
        return recusa(
            "campo_obrigatorio_ausente",
            "nao veio a lista de posicoes: sem ela nao se sabe se ha' o que fechar, e o desconhecido nao vira `nada`",
        )
    if isinstance(symbol_id, bool) or not isinstance(symbol_id, int):
        return recusa("campo_obrigatorio_ausente", f"o instrumento nao trouxe `symbol_id` utilizavel ({symbol_id!r})")

    encontradas: list[dict[str, Any]] = []
    for posicao in posicoes:
        if not isinstance(posicao, dict):
            continue
        if posicao.get("symbol_id") == symbol_id:
            encontradas.append(posicao)

    if not encontradas:
        return None
    if len(encontradas) > 1:
        return recusa(
            MOTIVO_DUAS_POSICOES,
            (
                f"ha' {len(encontradas)} posicoes abertas no instrumento {symbol_id} (ids "
                f"{[p.get('posicao') for p in encontradas]}) e o contrato so' sabe dizer UMA: escolher a primeira "
                "seria fechar a que nao se queria — recusa (achado 3 do data-model)"
            ),
        )
    return encontradas[0]


# -----------------------------------------------------------------------------------------------------------
# Os dois modos de «fechar sim, abrir nao» (RN-CT12/RN-CT22).
# -----------------------------------------------------------------------------------------------------------


def recusar_abertura(*, direitos_da_conta: Any, modo_do_simbolo: Any, conta: str, instrumento: str) -> Recusa | None:
    """A abertura e' recusada? Devolve a recusa quando SIM, e `None` quando nao ha' nada a opor.

    Sao DOIS sitios diferentes do venue, e ambos contam: o direito da conta (`accessRights`) e o modo do simbolo
    (`tradingMode`). Um modo de negociacao que nao se le' RECUSA (fail-closed) — nao vira «abre».
    """
    if direitos_da_conta == DIREITO_QUE_SO_FECHA:
        return recusa(
            "capacidade_nao_declarada",
            (
                f"a conta {conta} tem `accessRights = {DIREITO_QUE_SO_FECHA}` (RN-CT12): a abertura e' recusada "
                "pela conta, e o FECHO do que ja' existe continua a passar"
            ),
        )

    if modo_do_simbolo == MODO_QUE_SO_FECHA:
        return recusa(
            "capacidade_nao_declarada",
            (
                f"o simbolo {instrumento} esta' em `tradingMode = {MODO_QUE_SO_FECHA}` (RN-CT22): abre-se? nao. "
                "Fecha-se? sim — a abertura e' recusada, o fecho continua a passar"
            ),
        )

    if modo_do_simbolo not in MODOS_DE_NEGOCIACAO_CONHECIDOS:
        return recusa(
            "capacidade_nao_declarada",
            (
                f"o simbolo {instrumento} declara `tradingMode` = {modo_do_simbolo!r}, que nao esta' no conjunto "
                f"conhecido ({', '.join(MODOS_DE_NEGOCIACAO_CONHECIDOS)}): um modo que nao se le' nao vira «abre»"
            ),
        )
    return None


def decidir_abertura(pedido: dict[str, Any]) -> Decisao:
    """A decisao da ABERTURA: recusada nos dois modos de «fechar sim, abrir nao», aberta fora deles."""
    conta = _texto_do_pedido(pedido, "conta")
    instrumento = _texto_do_pedido(pedido, "instrumento")
    problema = recusar_abertura(
        direitos_da_conta=pedido.get("direitos_da_conta"),
        modo_do_simbolo=pedido.get("modo_do_simbolo"),
        conta=conta,
        instrumento=instrumento,
    )
    if problema is not None:
        return Decisao(acao=ACAO_RECUSAR, motivo=problema.motivo, porque=problema.porque, ordem=None)
    return Decisao(
        acao=ACAO_ABRIR,
        motivo=None,
        porque=f"nem a conta {conta} nem o simbolo {instrumento} fecham a abertura: a ordem de abertura segue",
        ordem=None,
    )


# -----------------------------------------------------------------------------------------------------------
# O fecho, por posicao.
# -----------------------------------------------------------------------------------------------------------


def decidir_fecho(pedido: dict[str, Any]) -> Decisao:
    """A decisao do FECHO: `nada` sem posicao, senao a ordem com `positionId` e o lado OPOSTO ao da posicao.

    O `CLOSE_ONLY` da conta e o `CLOSE_ONLY_MODE` do simbolo NAO travam este caminho, de proposito: e' a
    assimetria que a regra da casa exige («fechar sim, abrir nao»). Sem posicao, nao ha' ordem nenhuma — a
    decisao e' `nada`, com o motivo, e `ordem` fica a `None` (FR-065, SC-017).
    """
    conta = _texto_do_pedido(pedido, "conta")
    instrumento = _texto_do_pedido(pedido, "instrumento")

    posicao = posicao_do_instrumento(pedido.get("posicoes"), pedido.get("symbol_id"))
    if isinstance(posicao, Recusa):
        return Decisao(acao=ACAO_RECUSAR, motivo=posicao.motivo, porque=posicao.porque, ordem=None)
    if posicao is None:
        return Decisao(
            acao=ACAO_NADA,
            motivo=MOTIVO_SEM_POSICAO,
            porque=(
                f"nao ha' posicao aberta em {instrumento} na conta {conta}: nao ha' o que fechar, e NENHUMA "
                f"ordem e' enviada ({MOTIVO_SEM_POSICAO}) — um fecho por lado contrario ABRIRIA (RN-CT34)"
            ),
            ordem=None,
        )

    position_id = posicao.get("posicao")
    if isinstance(position_id, bool) or not isinstance(position_id, int):
        return Decisao(
            acao=ACAO_RECUSAR,
            motivo="campo_obrigatorio_ausente",
            porque=f"a posicao de {instrumento} nao trouxe `positionId` utilizavel ({position_id!r}): sem id nao ha' fecho que o venue aceite",
            ordem=None,
        )

    lado_da_posicao = posicao.get("lado")
    if lado_da_posicao not in LADO_OPOSTO:
        return Decisao(
            acao=ACAO_RECUSAR,
            motivo="valor_fora_do_conjunto",
            porque=(
                f"a posicao {position_id} declara o lado {lado_da_posicao!r}, que nao esta' no conjunto conhecido "
                f"({', '.join(LADO_OPOSTO)}): sem saber o lado da posicao nao se sabe qual e' o do fecho"
            ),
            ordem=None,
        )

    volume = posicao.get("volume")
    if isinstance(volume, bool) or not isinstance(volume, int) or volume <= 0:
        return Decisao(
            acao=ACAO_RECUSAR,
            motivo="campo_obrigatorio_ausente",
            porque=f"a posicao {position_id} nao trouxe `volume` em 0,01 de unidade ({volume!r}): o fecho e' pelo tamanho que o venue publica, e nao por um calculo nosso",
            ordem=None,
        )

    ordem: dict[str, Any] = {
        "positionId": position_id,
        "tradeSide": LADO_OPOSTO[lado_da_posicao],
        "volume": volume,
        "orderType": "MARKET",
    }
    marca = pedido.get("marca_do_cliente")
    if isinstance(marca, str) and marca != "":
        ordem["clientOrderId"] = marca

    return Decisao(
        acao=ACAO_FECHAR,
        motivo=None,
        porque=(
            f"fecho POR POSICAO: a ordem referencia `positionId` = {position_id} e leva o lado OPOSTO ao da "
            f"posicao ({lado_da_posicao} -> {LADO_OPOSTO[lado_da_posicao]}), com o volume {volume} que o venue "
            "publicou. Nao ha' caminho nenhum que feche por lado contrario (RN-CT34)"
        ),
        ordem=ordem,
    )


def _texto_do_pedido(pedido: dict[str, Any], nome: str) -> str:
    """Um campo de texto do pedido, para o `porque`. Sem ele, o nome do campo e' o que se escreve."""
    valor = pedido.get(nome)
    if isinstance(valor, str) and valor != "":
        return valor
    return f"(sem {nome})"
