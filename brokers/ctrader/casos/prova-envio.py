"""A PROVA DO ENVIO do conector cTrader — offline, com um DUPLO da camada de negociacao, SEM tocar no venue.

O QUE ESTA BANCADA MEDE. Os dois verbos que faltavam ao `transporte.py` — `colocar_ordem` e `fechar_posicao` —
e o caminho INTEIRO que deles depende: a boleta entra pelo `processo.py` (o REAL, importado por caminho
absoluto, sem reescrita), a accao do `ordens.py`/`fecho.py` vira o pedido da biblioteca, o VERBO manda-o pelo
protocolo (aqui DUPLICADO), e o evento do venue volta a dicionario e vira `desfecho` classificado.

O QUE ESTA BANCADA ASSEGURA, e nao promete. NAO ha' ligacao nenhuma ao venue: o `abrir()` do transporte e'
espionado e tem de dar ZERO chamadas; o `build_graph` (o unico que constroi um transporte TCP real) tambem; o
`cliente` fica `None`; e `socket.socket` esta' substituido por uma armadilha que aborta se alguem o tocar.
Tres verdades sobre o duplo, ditas como o que sao: nao ha' `_cliente`, nao ha' autenticacao, nao ha' socket.

A PROVA NEGATIVA. Com o VERBO AUSENTE (o comportamento antigo: `getattr` sem o metodo) a MESMA boleta tem de
cair em `capacidade_nao_declarada` e o caso (a) tem de ficar VERMELHO a nomea-lo — sem esse vermelho a bancada
nao mede o envio, mede o duplo.

O D6 — O PREENCHIMENTO QUE CHEGA DEPOIS DO ACEITE (05/10/2026). Medido ao vivo na demonstracao: o venue responde
`ORDER_ACCEPTED` (a ordem existe, SEM `executedVolume`/`executionPrice`/`usedMargin`) e o PREENCHIMENTO chega
DEPOIS, por EVENTO PROPRIO. Ler so' o primeiro evento montava uma resolucao de 3 de 5 campos, o contrato
recusava-a (`campo_obrigatorio_ausente`) e a ordem PREENCHIDA nunca publicava linha nenhuma — a prova 8 da bateria
ao vivo «falhava», e as provas 10 e 12 ficavam BLOQUEADAS atras dela. O caso `(D6) seguir o preenchimento` injecta
a SEQUENCIA EM DADO (aceite parcial -> preenchimento, este ultimo entregue pelo tratador de EVENTOS do protocolo,
o mesmo `on_event` que o venue usa) e exige o desfecho `aceite` com os numeros do VENUE e a linha no CONTRATO. A
negativa repoe o comportamento antigo (`_precisa_seguir_o_preenchimento` -> `False`) e exige o VERMELHO a nomear o
caso — e ele cai em `nao_publicado`/`campo_obrigatorio_ausente`, que e' a face do defeito.

O D7 — O FECHO TAMBEM PRECISA DOS CINCO CAMPOS (05/10/2026). O fecho NAO tem resolucao pre-envio (`resolucao={}`),
e o `preco_de_liquidacao` nao vinha do venue: a resolucao do fecho saia com 4 dos 5 campos e o contrato recusava o
desfecho — a prova 10 (fecho por `positionId`) ficava bloqueada mesmo depois do D6. O conector passa a PROJETAR
esse campo pela MESMA regra [C] do pre-envio (`preco x (A-1) / A` ao `tick`), a partir do PRECO DE EXECUCAO do
VENUE — sem numero inventado. O caso `(D7) fecho a alavancagem 30 completa a resolucao` exige o `aceite` com os
cinco campos; a negativa (a projecao desligada) exige o VERMELHO a nomear o campo em falta.

Corre-se com:  cd brokers/ctrader && uv run python casos/prova-envio.py     (rc=1 se algo divergir)
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import socket
import sys
import threading
import time
from decimal import Decimal
from pathlib import Path
from typing import Any

AQUI = Path(__file__).resolve().parent
CONECTOR = AQUI.parent
RAIZ = CONECTOR.parent.parent

# A MODULAGEM DA BIBLIOTECA — so' aqui, e so' no duplo (o conector nao a conhece fora do `transporte.py`).
from ctrader_api_client._internal.proto import (  # noqa: E402
    ProtoOAClosePositionReq,
    ProtoOADeal,
    ProtoOADealStatus,
    ProtoOAExecutionEvent,
    ProtoOAExecutionType,
    ProtoOANewOrderReq,
    ProtoOAOrder,
    ProtoOAOrderErrorEvent,
    ProtoOAOrderStatus,
    ProtoOAOrderType,
    ProtoOAPosition,
    ProtoOATradeData,
    ProtoOATradeSide,
)

#: OS EVENTOS de SESSAO (FR-070): os que a biblioteca ROTEIA a partir dos proto do venue. O `EventEmitter` e' o
#: ORIGINAL dela — a bancada injecta o evento pelo MESMO mecanismo que a producao usa (nao ha' atalho proprio).
from ctrader_api_client import (  # noqa: E402
    AccountDisconnectEvent,
    AuthTrigger,
    ClientDisconnectEvent,
    ReadyEvent,
    TokenInvalidatedEvent,
)
from ctrader_api_client.events import EventEmitter  # noqa: E402


def _importar(nome: str, caminho: Path) -> Any:
    """Importa um modulo REAL por caminho absoluto (nunca uma copia). O `processo` instala os `sys.path`."""
    spec = importlib.util.spec_from_file_location(nome, caminho)
    modulo = importlib.util.module_from_spec(spec)
    sys.modules[nome] = modulo
    spec.loader.exec_module(modulo)
    return modulo


# O PROCESSO REAL. Ao importar-se, ele poe no `sys.path` o esqueleto do contrato e a pasta do conector.
proc = _importar("processo_real", CONECTOR / "processo.py")
Tr = sys.modules["transporte"]
feixo = sys.modules["fecho"]
framing = sys.modules["framing"]
Or = sys.modules["ordens"]

FICHA = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "/home/cerucci/.hermes/profiles/appbuilder/cache/scratch/audit-ctrader/ficha-demo-real.conector.json"
)
ficha = sys.modules["ficha"].ler_ficha(FICHA)
MANIFESTO = json.loads((AQUI / "ordens.casos.json").read_text(encoding="utf-8"))["manifesto_base"]

CONTA = {
    "conta": ficha.ctid_trader_account_id,
    "saldo": 1000000,
    "expoente_dos_valores": 2,
    "alavancagem": 30,
    "tipo_de_conta": "NETTED",
    "direitos": "FULL_ACCESS",
}
SIMBOLO = {
    "symbol_id": 42,
    "digitos": 5,
    "posicao_do_pip": 3,
    "minimo": 1000,
    "maximo": 10000000,
    "passo": 10,
    "modo_de_negociacao": "ENABLED",
}
BOLETA = {
    "instrumento": "EURUSD",
    "lado": "buy",
    "tipo": "mercado_por_faixa",
    "saldo_pct": "10",
    "alavancagem": "1",
    "parcial": "o_que_der",
    "desvio_maximo": "0.5",
    "prazo_da_passiva_ms": 0,
    "destino_do_resto": "agressivo",
    "reduce_only": False,
    "reverter": False,
    "posicao_pct": "1",
    "referencia_do_cliente": "ciclo-1/linha-1",
    "marca_de_posse": 7,
}
#: A boleta de FECHO (lado `caixa`): a costura leva-a pelo `fecho.py`, e o verbo a enviar e' o `fechar_posicao`.
BOLETA_CAIXA = {**BOLETA, "lado": "caixa"}

def _mapa(valor: Any) -> dict[str, Any]:
    """O valor QUANDO e' um mapa de campos; senao um mapa VAZIO — dito UMA vez, com nome.

    A catraca de fallbacks da casa proibe o valor literal por omissao (`x or {}`); a leitura de um sub-objecto do
    evento do venue (que pode nao vir) fica aqui, nomeada, em vez de espalhada em trinta sitios (a licao do
    `brokers/hyperliquid/casos/blocos.ts`). E' equivalente EXACTA do `valor or {}` que substitui.
    """
    return valor if valor else {}

# =============================================================================================================
# O DUPLO DA CAMADA DE NEGOCIACAO. `ProtocoloFalso` e' o `grafo.protocol`; ele GUARDA cada pedido (para a prova
# (e)) e devolve um evento GRAVADO (um `ProtoOAExecutionEvent` do venue). As LEITURAS do transporte (conta,
# simbolos, posicoes, velas) sao servidas por valores fixos — o passo a medir e' o ENVIO, nao a leitura.
# =============================================================================================================


class ProtocoloFalso:
    def __init__(
        self, resposta: Any = None, atraso: float = 0.0, erro: Exception | None = None, respostas: list[Any] | None = None
    ) -> None:
        self.resposta = resposta
        #: As respostas POR ORDEM DE ENVIO (`respostas[0]` ao 1.o pedido, e assim por diante). E' o que permite
        #: medir a VIRADA (1.10.0): sao DUAS pernas na mesma passagem, e cada uma tem a SUA resposta do venue. A
        #: `resposta` continua a servir os casos de uma so' perna (inalterados).
        self.respostas = respostas
        self.atraso = atraso
        self.erro = erro
        self.pedidos: list[Any] = []
        #: A ORDEM das operacoes que TOCAM no transporte (leitura da conta / envio), para a prova (d) mostrar
        #: que a leitura da conta vem ANTES de qualquer envio novo depois de a sessao recuperar.
        self.operacoes: list[str] = []
        #: OS TRATADORES DE EVENTO do protocolo (D6): o conector liga aqui o tratador das execucoes CRUAS
        #: (`Transporte.ligar_as_execucoes`). A bancada entrega-lhes o evento pelo MESMO mecanismo do venue —
        #: o evento que NAO casa pedido nenhum vai para os tratadores, e nao para a resposta (`send_request`).
        self.tratadores: dict[type, list[Any]] = {}

    async def send_request(self, message: Any, timeout: float | None = None) -> Any:
        self.operacoes.append("envio")
        self.pedidos.append(message)
        if self.atraso:
            await asyncio.sleep(self.atraso)
        if self.erro is not None:
            raise self.erro
        if self.respostas is not None:
            # A resposta DESTA perna: a lista avanca com os pedidos (a virada tem duas, e cada uma a sua).
            if not self.respostas:
                return self.resposta
            return self.respostas.pop(0)
        return self.resposta

    def on_event(self, tipo: type, tratador: Any) -> Any:
        """O registo dos tratadores de evento do protocolo — o mesmo contrato do `Protocol.on_event` real."""
        self.tratadores.setdefault(tipo, []).append(tratador)

        def desligar() -> None:
            registados = self.tratadores.get(tipo)
            if registados is not None and tratador in registados:
                registados.remove(tratador)

        return desligar

    async def entregar(self, mensagem: Any) -> None:
        """Entrega um EVENTO aos tratadores do tipo (o caminho do venue quando a mensagem nao casa um pedido)."""
        for cls in type(mensagem).__mro__:
            registados = self.tratadores.get(cls)
            if not registados:
                continue
            for tratador in list(registados):
                await tratador(mensagem)


class GrafoFalso:
    def __init__(self, protocolo: ProtocoloFalso) -> None:
        self.protocol = protocolo


class ClienteFalso:
    """O `_cliente` do duplo: um `register_handler` que DELEGA no `EventEmitter` ORIGINAL da biblioteca.

    E' o que permite a bancada ligar os tratadores de sessao pelo caminho REAL (`registar_evento` ->
    `cliente.register_handler` -> `emitter.subscribe`) e injectar o evento pelo MESMO `emit` que a producao usa —
    com as validacoes de filtro da propria biblioteca (ex.: `TokenInvalidatedEvent` nao tem `account_id`).
    """

    def __init__(self, emissor: EventEmitter) -> None:
        self._emissor = emissor

    def register_handler(self, tipo: type, tratador: Any, *, account_id: int | None = None, symbol_id: int | None = None) -> None:
        self._emissor.subscribe(tipo, tratador, account_id=account_id, symbol_id=symbol_id)


class TransporteDuplo(Tr.Transporte):
    """O transporte REAL (os verbos sao os dele) com as LEITURAS servidas e o protocolo duplicado."""

    def __init__(
        self,
        protocolo: ProtocoloFalso,
        posicoes: list[dict[str, Any]] | None = None,
        ordens: list[dict[str, Any]] | None = None,
        leituras_falham: tuple[str, ...] = (),
    ) -> None:
        super().__init__(url_da_api=ficha.url_da_api, client_id="duplo", client_secret="duplo")
        self._grafo = GrafoFalso(protocolo)  # sem `abrir()`: o grafo entra aqui, e nunca houve ligacao
        #: O duplo REPRESENTA um transporte JA' ABERTO: a aplicacao autenticou (senao nada enviaria) e a conta
        #: esta' autorizada. E' o ponto de partida dos casos de controle; os casos de sessao mudam-no a mao.
        self.app_autenticada = True
        self._conta_autorizada = True
        #: O EMISSOR da biblioteca, ligado pelo `_cliente` abaixo — os tratadores de sessao (FR-070) entram por
        #: aqui, e a bancada injecta por `emissor.emit`. Nada de `_cliente = None` (senao nao haveria olhos).
        self.emissor = EventEmitter()
        self._cliente = ClienteFalso(self.emissor)  # type: ignore[assignment]
        self._posicoes = posicoes if posicoes else []
        #: O REGISTO de ordens do venue (FR-069): e' a fonte da verdade da reconciliacao e o que a idempotencia
        #: procura pela marca. Vazio = o venue nao tem ordens nossas (o caso de controle).
        self._ordens = ordens if ordens else []
        #: As LEITURAS que este duplo faz FALHAR, pelo nome (o caso (e) da reconciliacao): a leitura falhada
        #: NAO produz desfecho, e quem a pede fica em `indecidivel` — e' o que a prova (e) mede.
        self._leituras_falham = set(leituras_falham)

    # ---- a SESSAO: o duplo serve a autorizacao; o EVENTO (injectado) e' que a invalida --------------------
    def conta_autorizada(self, account_id: int) -> bool:
        return self._conta_autorizada

    # ---- as leituras (valores fixos; o alvo desta bancada e' o envio) --------------------------------------
    def trader(self, account_id: int) -> Tr.Resultado:
        self._grafo.protocol.operacoes.append("leitura_da_conta")
        return Tr.Resultado(ok=True, valor=dict(CONTA))

    def posicoes(self, account_id: int) -> Tr.Resultado:
        self._grafo.protocol.operacoes.append("leitura_das_posicoes")
        if "posicoes" in self._leituras_falham:
            return Tr.Resultado(
                ok=False, motivo="falha_ao_ler_as_posicoes", porque="o venue nao respondeu a leitura das posicoes (duplo)"
            )
        return Tr.Resultado(ok=True, valor=[dict(p) for p in self._posicoes])

    def ordens_do_registo(self, account_id: int) -> Tr.Resultado:
        self._grafo.protocol.operacoes.append("leitura_do_registo")
        if "ordens_do_registo" in self._leituras_falham:
            return Tr.Resultado(
                ok=False,
                motivo="falha_ao_ler_o_registo_de_ordens",
                porque="o venue nao respondeu a leitura do registo de ordens (duplo)",
            )
        return Tr.Resultado(ok=True, valor=[dict(o) for o in self._ordens])

    def simbolos(self, account_id: int) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=[{"symbol_id": 42, "nome": "EURUSD", "habilitado": True, "descricao": "x", "deslistado": None}])

    def simbolos_por_id(self, account_id: int, ids: list[int]) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=[dict(SIMBOLO)])

    def velas(self, account_id: int, symbol_id: int, periodo: str, de: Any, ate: Any) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=[{"fecho": Decimal("1.25"), "instante_ms": 1790628000000}])


# =============================================================================================================
# OS EVENTOS GRAVADOS. Constroem-se como o VENUE os manda (o `ProtoOAExecutionEvent`), nao como a biblioteca
# os resume — e' a diferenca entre os dois que esta' em jogo na prova (a).
# =============================================================================================================


def _ordem_do_venue(*, executado: int, volume: int, preco: float, estado: Any, posicao: int | None, marca: str) -> ProtoOAOrder:
    return ProtoOAOrder(
        order_id=501,
        order_type=ProtoOAOrderType.MARKET_RANGE,
        order_status=estado,
        trade_data=ProtoOATradeData(symbol_id=42, volume=volume, trade_side=ProtoOATradeSide.BUY),
        executed_volume=executado,
        execution_price=preco,
        client_order_id=marca,
        position_id=posicao if posicao else 0,
        slippage_in_points=625,
        base_slippage_price=1.25,
    )


def _posicao_do_venue(*, posicao: int, volume: int, margem: int) -> ProtoOAPosition:
    """O `position` de um EVENTO DE EXECUCAO, como o VENUE o manda (medido AO VIVO a 05/10/2026, D6).

    SEM `margin_rate`: o `position` do evento empurrado traz `usedMargin` mas **nao** `marginRate` (o do FECHO
    nao traz nem um nem outro). E' esta a forma que fez o desfecho sair com 4 dos 5 campos e o contrato recusa-lo
    — a bancada tem de a reproduzir, ou mede uma forma que o venue nao manda.
    """
    return ProtoOAPosition(
        position_id=posicao,
        trade_data=ProtoOATradeData(symbol_id=42, volume=volume, trade_side=ProtoOATradeSide.BUY),
        used_margin=margem,
        money_digits=2,
    )


def evento_preenchido(*, executado: int = 80000, volume: int = 80000, posicao: int = 9001, margem: int = 1000) -> ProtoOAExecutionEvent:
    """O PREENCHIMENTO como o VENUE o manda por EVENTO PROPRIO (medido AO VIVO a 05/10/2026): com os numeros no
    `order` (executedVolume/executionPrice), `usedMargin` na `position` e o `deal` — e SEM `marginRate`."""
    return ProtoOAExecutionEvent(
        ctid_trader_account_id=ficha.ctid_trader_account_id,
        execution_type=ProtoOAExecutionType.ORDER_FILLED,
        order=_ordem_do_venue(executado=executado, volume=volume, preco=1.25, estado=ProtoOAOrderStatus.ORDER_STATUS_FILLED, posicao=posicao, marca="7-ciclo-1/linha-1"),
        position=_posicao_do_venue(posicao=posicao, volume=executado, margem=margem),
        deal=ProtoOADeal(
            deal_id=7001,
            order_id=501,
            position_id=posicao,
            symbol_id=42,
            volume=volume,
            filled_volume=executado,
            execution_price=1.25,
            trade_side=ProtoOATradeSide.BUY,
            deal_status=ProtoOADealStatus.FILLED,
            commission=-35,
            money_digits=2,
            execution_timestamp=1790628000456,
        ),
    )


def evento_parcial(*, executado: int = 60000, volume: int = 100000, posicao: int = 9002, margem: int = 7500) -> ProtoOAExecutionEvent:
    """O PREENCHIMENTO PARCIAL, na mesma forma do venue (com os numeros, sem `marginRate`)."""
    return ProtoOAExecutionEvent(
        ctid_trader_account_id=ficha.ctid_trader_account_id,
        execution_type=ProtoOAExecutionType.ORDER_PARTIAL_FILL,
        order=_ordem_do_venue(executado=executado, volume=volume, preco=1.25, estado=ProtoOAOrderStatus.ORDER_STATUS_ACCEPTED, posicao=posicao, marca="7-ciclo-1/linha-1"),
        position=_posicao_do_venue(posicao=posicao, volume=executado, margem=margem),
        deal=ProtoOADeal(
            deal_id=7002,
            order_id=501,
            position_id=posicao,
            symbol_id=42,
            volume=volume,
            filled_volume=executado,
            execution_price=1.25,
            trade_side=ProtoOATradeSide.BUY,
            deal_status=ProtoOADealStatus.PARTIALLY_FILLED,
            commission=-21,
            money_digits=2,
            execution_timestamp=1790628000999,
        ),
    )


def evento_recusado(error_code: str = "TRADING_BAD_VOLUME") -> ProtoOAExecutionEvent:
    return ProtoOAExecutionEvent(
        ctid_trader_account_id=ficha.ctid_trader_account_id,
        execution_type=ProtoOAExecutionType.ORDER_REJECTED,
        error_code=error_code,
        order=_ordem_do_venue(executado=0, volume=0, preco=0.0, estado=ProtoOAOrderStatus.ORDER_STATUS_REJECTED, posicao=None, marca="7-ciclo-1/linha-1"),
    )


def evento_aceite_sem_numeros(*, ordem: int = 501, marca: str = "7-ciclo-1/linha-1") -> ProtoOAExecutionEvent:
    """O `ORDER_ACCEPTED` COMO ESTE VENUE O MANDA (MEDIDO a 05/10/2026): a ordem existe, e os numeros NAO vem aqui.

    Nenhum `executedVolume`/`executionPrice`, nenhuma `position` (`usedMargin`/`marginRate`): e' exactamente a
    forma que fez o D6 — ler so' este evento monta uma resolucao de 3 de 5 campos, o contrato recusa-a e a ordem
    PREENCHIDA nunca publicava linha nenhuma. O preenchimento chega DEPOIS, por evento proprio.
    """
    return ProtoOAExecutionEvent(
        ctid_trader_account_id=ficha.ctid_trader_account_id,
        execution_type=ProtoOAExecutionType.ORDER_ACCEPTED,
        order=ProtoOAOrder(
            order_id=ordem,
            order_type=ProtoOAOrderType.MARKET_RANGE,
            order_status=ProtoOAOrderStatus.ORDER_STATUS_ACCEPTED,
            trade_data=ProtoOATradeData(symbol_id=42, volume=80000, trade_side=ProtoOATradeSide.BUY),
            client_order_id=marca,
            slippage_in_points=625,
            base_slippage_price=1.25,
        ),
        # A `position` que o venue manda no ACEITE: so' o id, o `moneyDigits` e o lado — SEM `usedMargin` e SEM
        # `marginRate` (medido ao vivo). E' a forma exacta que fazia a resolucao sair de 3 campos.
        position=ProtoOAPosition(
            position_id=9001,
            trade_data=ProtoOATradeData(symbol_id=42, volume=80000, trade_side=ProtoOATradeSide.BUY),
            money_digits=2,
        ),
    )


def evento_erro_do_venue(error_code: str = "TRADING_BAD_VOLUME") -> ProtoOAOrderErrorEvent:
    """A recusa CRUA do venue (A-11): o `ProtoOAOrderErrorEvent` — o `ProtoOAErrorRes` do pedido.

    NAO e' um `ProtoOAExecutionEvent` (o evento de execucao): e' o OUTRO tipo que o `send_request` devolve
    quando a ordem nao passa — o ramo `transporte.py:430` que nenhum caso corria.
    """
    return ProtoOAOrderErrorEvent(
        ctid_trader_account_id=ficha.ctid_trader_account_id,
        order_id=501,
        error_code=error_code,
        description="o volume da ordem nao serve para este instrumento",
        position_id=0,
    )


# =============================================================================================================
# A CORRIDA DE UM CASO. Constroi o `Arranque` com o duplo e chama o processo REAL (`atender`).
# =============================================================================================================


def _arranque(transporte: Tr.Transporte, prazo_ms: int) -> Any:
    return proc.Arranque(
        ok=True,
        ficha=ficha,
        credencial=None,
        transporte=transporte,
        manifesto=MANIFESTO,
        direitos_da_conta="FULL_ACCESS",
        so_fecha=False,
        prazo_do_venue_ms=prazo_ms,
    )


#: O caso em curso (posto pelo `main`) e as saidas CRUAS de cada um, para o relatorio. A bancada nao descreve o
#: que mediu: cola a linha que saiu (ou diz que nao saiu nenhuma).
_CASO = ""
_CRU: dict[str, list[Any]] = {}


def _correr(
    transporte: Tr.Transporte,
    carga: dict[str, Any],
    prazo_ms: int = 3000,
    correlacao: str = "prova/1",
    arranque: Any = None,
) -> Any:
    """Atende UMA boleta pelo processo REAL. O `arranque` pode ser REUTILIZADO entre mensagens — e' o que faz o
    estado por instrumento (a pendencia do FR-068) sobreviver de uma mensagem para a seguinte, como na vida."""
    if arranque is None:
        arranque = _arranque(transporte, prazo_ms)
    linha = json.dumps({"contrato": "1.12.0", "tipo": "boleta", "id": correlacao, "carga": carga}, ensure_ascii=False)
    at = proc.atender(linha, arranque)
    _CRU.setdefault(_CASO, []).append(at)
    return at


def _desfecho(at: Any) -> dict[str, Any] | None:
    for linha in at.linhas:
        bruto = json.loads(linha)
        if bruto.get("tipo") == "desfecho":
            return {"linha": linha, "carga": bruto["carga"], "id": bruto["id"]}
    return None


def _no_contrato(linha: str) -> dict[str, Any]:
    return framing.validar(linha)


def _diag_de(at: Any, etapa: str) -> dict[str, Any] | None:
    for d in at.diag:
        if d.get("etapa") == etapa:
            return d
    return None


# =============================================================================================================
# (f) A ASSERCAO DE QUE NADA FOI AO VENUE. Os contadores ficam aqui, e sao impressos.
# =============================================================================================================

_ESPIAO = {"abrir": 0, "build_graph": 0, "connect": 0}
_ABRIR_REAL = Tr.Transporte.abrir
_BUILD_GRAPH_REAL = Tr.build_graph
_SOCKET_CONNECT_REAL = socket.socket.connect
_CREATE_CONNECTION_REAL = socket.create_connection


def _armar_espioes() -> None:
    def abrir_espiao(self, *a, **k):
        _ESPIAO["abrir"] += 1
        return _ABRIR_REAL(self, *a, **k)

    def build_graph_espiao(*a, **k):
        _ESPIAO["build_graph"] += 1
        return _BUILD_GRAPH_REAL(*a, **k)

    def connect_espiao(self, *a, **k):
        _ESPIAO["connect"] += 1
        raise AssertionError("houve um connect(): a bancada NAO devia abrir ligacao nenhuma ao venue")

    def create_connection_espiao(*a, **k):
        _ESPIAO["connect"] += 1
        raise AssertionError("houve um create_connection(): a bancada NAO devia abrir ligacao nenhuma ao venue")

    Tr.Transporte.abrir = abrir_espiao
    Tr.build_graph = build_graph_espiao
    socket.socket.connect = connect_espiao
    socket.create_connection = create_connection_espiao


def _desarmar_espioes() -> None:
    Tr.Transporte.abrir = _ABRIR_REAL
    Tr.build_graph = _BUILD_GRAPH_REAL
    socket.socket.connect = _SOCKET_CONNECT_REAL
    socket.create_connection = _CREATE_CONNECTION_REAL


# =============================================================================================================
# AS PROVAS. Cada uma devolve a lista de problemas (vazia = conforme).
# =============================================================================================================


def prova_a_aceite() -> list[str]:
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    at = _correr(transporte, BOLETA)
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    problemas = []
    if carga.get("classificacao") != "aceite":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'aceite'")
    resolucao = _mapa(carga.get("resolucao"))
    for campo, esperado in (("quantidade", "800"), ("nocional", "1000"), ("margem_empenhada", "10"), ("alavancagem_efectiva", "1"), ("preco_de_liquidacao", "0")):
        if resolucao.get(campo) != esperado:
            problemas.append(f"resolucao.{campo}={resolucao.get(campo)!r}, esperado {esperado!r}")
    rv = _mapa(carga.get("resposta_do_venue"))
    if _mapa(rv.get("order")).get("executedVolume") != 80000:
        problemas.append(f"order.executedVolume={_mapa(rv.get('order')).get('executedVolume')!r}, esperado 80000 (o do VENUE)")
    if _mapa(rv.get("order")).get("executionPrice") != 125000:
        problemas.append(f"order.executionPrice={_mapa(rv.get('order')).get('executionPrice')!r}, esperado 125000 (o do VENUE)")
    if _mapa(rv.get("position")).get("positionId") != 9001:
        problemas.append(f"position.positionId={_mapa(rv.get('position')).get('positionId')!r}, esperado 9001")
    if _mapa(rv.get("order")).get("clientOrderId") != "7-ciclo-1/linha-1":
        problemas.append(f"order.clientOrderId={_mapa(rv.get('order')).get('clientOrderId')!r}, esperado a marca")
    if _mapa(rv.get("deal")).get("commission") != -35:
        problemas.append(f"deal.commission={_mapa(rv.get('deal')).get('commission')!r}, esperado -35 (o do VENUE)")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_b_recusa() -> list[str]:
    protocolo = ProtocoloFalso(resposta=evento_recusado())
    transporte = TransporteDuplo(protocolo)
    at = _correr(transporte, BOLETA)
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    problemas = []
    if carga.get("classificacao") != "recusado":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'recusado'")
    if carga.get("motivo") != "desfecho_nao_reconhecido":
        problemas.append(f"motivo={carga.get('motivo')!r}, esperado 'desfecho_nao_reconhecido'")
    palavras = _mapa(carga.get("resposta_do_venue"))
    if palavras.get("errorCode") != "TRADING_BAD_VOLUME":
        problemas.append(f"errorCode={(palavras.get('errorCode'))!r}, esperado 'TRADING_BAD_VOLUME' (a palavra do VENUE, intacta)")
    if "resolucao" in carga:
        problemas.append("uma recusa NAO deve trazer resolucao")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_h_recusa_crua_do_venue() -> list[str]:
    """A recusa CRUA do venue (A-11): o `ProtoOAOrderErrorEvent` -> `recusado`, com a palavra dele INTACTA.

    O ramo existe no `transporte.py` (`_enviar_pedido` -> `_evento_do_erro_do_venue`) e NENHUM caso o corria:
    a resposta do protocolo e' o PROPRIO evento de erro do venue (`ProtoOAErrorRes`), e nao um
    `ProtoOAExecutionEvent` — e' outro caminho, e e' este que o cobre. Exige-se a classificacao `recusado`, a
    palavra do venue (`errorCode`) caracter a caracter em `resposta_do_venue`, e que a linha passe o CONTRATO.
    """
    codigo = "TRADING_BAD_VOLUME"
    protocolo = ProtocoloFalso(resposta=evento_erro_do_venue(codigo))
    transporte = TransporteDuplo(protocolo)
    at = _correr(transporte, BOLETA)
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    problemas = []
    if carga.get("classificacao") != "recusado":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'recusado'")
    if carga.get("motivo") != "desfecho_nao_reconhecido":
        problemas.append(f"motivo={carga.get('motivo')!r}, esperado 'desfecho_nao_reconhecido'")
    palavras = _mapa(carga.get("resposta_do_venue"))
    if palavras.get("errorCode") != codigo:
        problemas.append(f"errorCode={palavras.get('errorCode')!r}, esperado {codigo!r} (a palavra do VENUE, intacta)")
    if "resolucao" in carga:
        problemas.append("uma recusa NAO deve trazer resolucao")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_c_parcial() -> list[str]:
    protocolo = ProtocoloFalso(resposta=evento_parcial())
    transporte = TransporteDuplo(protocolo)
    at = _correr(transporte, BOLETA)
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    problemas = []
    if carga.get("classificacao") != "parcial":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'parcial'")
    resolucao = _mapa(carga.get("resolucao"))
    if resolucao.get("quantidade") != "600":
        problemas.append(f"resolucao.quantidade={resolucao.get('quantidade')!r}, esperado '600' (o executado do VENUE, sem arredondar para cima)")
    if resolucao.get("margem_empenhada") != "75":
        problemas.append(f"resolucao.margem_empenhada={resolucao.get('margem_empenhada')!r}, esperado '75'")
    rv = _mapa(carga.get("resposta_do_venue"))
    if _mapa(rv.get("order")).get("executedVolume") != 60000:
        problemas.append(f"order.executedVolume={_mapa(rv.get('order')).get('executedVolume')!r}, esperado 60000")
    if _mapa(rv.get("deal")).get("filledVolume") != 60000:
        problemas.append(f"deal.filledVolume={_mapa(rv.get('deal')).get('filledVolume')!r}, esperado 60000")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def _entregar_execucao(protocolo: ProtocoloFalso, evento: Any) -> None:
    """Entrega um EVENTO de execucao aos tratadores do protocolo — o caminho do venue (nao o da resposta)."""
    asyncio.run(protocolo.entregar(evento))


def prova_d6_seguir_o_preenchimento() -> list[str]:
    """D6 — O DESFECHO DA ORDEM QUE PREENCHEU: a SEQUENCIA (aceite parcial -> preenchimento), em DADO.

    O venue responde `ORDER_ACCEPTED` (a ordem existe, SEM os numeros do preenchimento) e SO' DEPOIS empurra o
    preenchimento, por EVENTO PROPRIO. A bancada injecta essa SEQUENCIA, e nao o valor ja' resolvido: o aceite e'
    a resposta do protocolo, e o preenchimento chega pelo tratador de EVENTOS (o mesmo `on_event` que o venue
    usa). O desfecho tem de sair `aceite`, com os numeros do VENUE (preco, volume executado, comissao,
    `positionId`/`dealId`), e passar o CONTRATO. Sem o seguimento, o limite e' o silencio — mede-se abaixo.
    """
    protocolo = ProtocoloFalso(resposta=evento_aceite_sem_numeros())
    transporte = TransporteDuplo(protocolo)
    # O PREENCHIMENTO chega DEPOIS do aceite, por evento proprio — entregue pelo MESMO caminho dos tratadores.
    threading.Timer(0.05, _entregar_execucao, args=(protocolo, evento_preenchido())).start()
    at = _correr(transporte, BOLETA, prazo_ms=3000)
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    problemas: list[str] = []
    if carga.get("classificacao") != "aceite":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'aceite'")
    resolucao = _mapa(carga.get("resolucao"))
    for campo, esperado in (("quantidade", "800"), ("nocional", "1000"), ("margem_empenhada", "10"), ("alavancagem_efectiva", "1"), ("preco_de_liquidacao", "0")):
        if resolucao.get(campo) != esperado:
            problemas.append(f"resolucao.{campo}={resolucao.get(campo)!r}, esperado {esperado!r}")
    rv = _mapa(carga.get("resposta_do_venue"))
    if _mapa(rv.get("order")).get("executedVolume") != 80000:
        problemas.append(f"order.executedVolume={_mapa(rv.get('order')).get('executedVolume')!r}, esperado 80000 (o do VENUE)")
    if _mapa(rv.get("order")).get("executionPrice") != 125000:
        problemas.append(f"order.executionPrice={_mapa(rv.get('order')).get('executionPrice')!r}, esperado 125000 (o do VENUE)")
    if _mapa(rv.get("position")).get("positionId") != 9001:
        problemas.append(f"position.positionId={_mapa(rv.get('position')).get('positionId')!r}, esperado 9001")
    if _mapa(rv.get("deal")).get("dealId") != 7001:
        problemas.append(f"deal.dealId={_mapa(rv.get('deal')).get('dealId')!r}, esperado 7001 (o negocio do VENUE)")
    if _mapa(rv.get("deal")).get("commission") != -35:
        problemas.append(f"deal.commission={_mapa(rv.get('deal')).get('commission')!r}, esperado -35 (o do VENUE)")
    if _mapa(rv.get("order")).get("clientOrderId") != "7-ciclo-1/linha-1":
        problemas.append(f"order.clientOrderId={_mapa(rv.get('order')).get('clientOrderId')!r}, esperado a marca")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_negativa_sem_seguir_o_preenchimento() -> list[str]:
    """A PROVA NEGATIVA (D6): SEM seguir o preenchimento, o MESMO caso fica VERMELHO a nomea'-lo.

    Repoe-se o comportamento ANTIGO (`_precisa_seguir_o_preenchimento` -> `False`: le'-se so' o primeiro evento):
    o aceite sem numeros monta uma resolucao incompleta, o contrato recusa-a e NENHUMA linha sai. Sem este
    vermelho a bancada nao mede o seguimento do preenchimento — media so' o duplo. O `Timer` do caso continua a
    entregar o preenchimento (o defeito e' NAO o seguir), por isso o vermelho e' do caminho, nao da ausencia do
    evento.
    """
    original = proc._precisa_seguir_o_preenchimento  # type: ignore[attr-defined]
    proc._precisa_seguir_o_preenchimento = lambda *a, **k: False  # type: ignore[attr-defined]
    try:
        problemas_do_caso = prova_d6_seguir_o_preenchimento()
    finally:
        proc._precisa_seguir_o_preenchimento = original  # type: ignore[attr-defined]
    print("# (negativa) sem seguir o preenchimento, o caso (D6) fica:", file=sys.stderr)
    print(f"#   {problemas_do_caso if problemas_do_caso else 'VERDE — o que seria um defeito da bancada'}", file=sys.stderr)
    if not problemas_do_caso:
        return ["o caso (D6) ficou VERDE sem seguir o preenchimento — a bancada nao mede o seguimento (D6)"]
    return []


def prova_d6_bis_fecho_completa_a_resolucao() -> list[str]:
    """O FECHO a alavancagem != 1 tem de completar os CINCO campos da resolucao (medido a 05/10/2026).

    O fecho NAO tem resolucao pre-envio (`resolucao={}`): sem a projecao [C] do `preco_de_liquidacao` sobre o
    preco do VENUE ao `tick` do simbolo, a resolucao saia com 4 dos 5 campos e o contrato RECUSAVA o desfecho — a
    prova 10 da bateria ao vivo (fecho por `positionId`) ficava bloqueada. Aqui o fecho corre a alavancagem 30 (a
    que a bateria usa) e exige `aceite` com os cinco campos, o `preco_de_liquidacao` projectado e a linha no
    CONTRATO. E' o segundo bloqueio que estava atras do D6.
    """
    protocolo = ProtocoloFalso(resposta=evento_preenchido(posicao=555, executado=8000, volume=8000, margem=100))
    transporte = TransporteDuplo(protocolo, posicoes=[{"posicao": 555, "symbol_id": 42, "lado": "BUY", "volume": 8000}])
    boleta = {**BOLETA_CAIXA, "alavancagem": "30"}
    at = _correr(transporte, boleta, prazo_ms=3000)
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    problemas: list[str] = []
    if carga.get("classificacao") != "aceite":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'aceite'")
    resolucao = _mapa(carga.get("resolucao"))
    for campo in ("quantidade", "nocional", "margem_empenhada", "alavancagem_efectiva", "preco_de_liquidacao"):
        if campo not in resolucao:
            problemas.append(f"resolucao.{campo} AUSENTE no fecho (o contrato exige os cinco campos)")
    if resolucao.get("alavancagem_efectiva") != "30":
        problemas.append(f"resolucao.alavancagem_efectiva={resolucao.get('alavancagem_efectiva')!r}, esperado '30' (o do VENUE)")
    if resolucao.get("preco_de_liquidacao") != "1.2":
        problemas.append(f"resolucao.preco_de_liquidacao={resolucao.get('preco_de_liquidacao')!r}, esperado '1.2' (a projecao [C])")
    if _mapa(_mapa(carga.get("resposta_do_venue")).get("position")).get("positionId") != 555:
        problemas.append("a linha do fecho nao traz a posicao fechada")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_negativa_sem_a_projecao_do_fecho() -> list[str]:
    """A PROVA NEGATIVA (D7): SEM a projecao [C], o FECHO a alavancagem 30 NAO sai — o vermelho que mede.

    Repoe-se o comportamento ANTIGO pelo caminho mais fino: passa-se `tick=None` a' `_resolucao_completa`, que e'
    exactamente o que existia antes desta correccao (nao havia projecao). O fecho tem de ficar VERMELHO a nomear o
    campo em falta (`preco_de_liquidacao`), senao a bancada nao mede a projecao do fecho — media so' o duplo.
    """
    original = proc._resolucao_completa  # type: ignore[attr-defined]
    proc._resolucao_completa = lambda antes, numeros, alavancagem, tick=None: original(antes, numeros, alavancagem, None)  # type: ignore[attr-defined]
    try:
        problemas_do_caso = prova_d6_bis_fecho_completa_a_resolucao()
    finally:
        proc._resolucao_completa = original  # type: ignore[attr-defined]
    print("# (negativa) sem a projecao [C] do fecho, o caso (D7) fica:", file=sys.stderr)
    print(f"#   {problemas_do_caso if problemas_do_caso else 'VERDE — o que seria um defeito da bancada'}", file=sys.stderr)
    if not problemas_do_caso:
        return ["o caso (D7) ficou VERDE sem a projecao do fecho — a bancada nao mede a resolucao do fecho"]
    return []


def prova_negativa_sem_a_completacao_declarada() -> list[str]:
    """A PROVA NEGATIVA (D6-bis): SEM a completacao declarada, os casos (D6) e (D7) ficam VERMELHOS a nomea'-los.

    O venue NAO publica a alavancagem no evento (medido ao vivo): `_completar_pela_declaracao` e' quem fecha os
    cinco campos. Desligado (devolve a resolucao como veio), o (D6) fica com 4 campos e o (D7) com 3 — o contrato
    recusa-os e nenhuma linha sai. Sem este vermelho, a bancada nao mediria a completacao — media so' o duplo.
    """
    original = proc._completar_pela_declaracao  # type: ignore[attr-defined]
    proc._completar_pela_declaracao = lambda resolucao, alavancagem: dict(resolucao)  # type: ignore[attr-defined]
    try:
        problemas_d6 = prova_d6_seguir_o_preenchimento()
        problemas_d7 = prova_d6_bis_fecho_completa_a_resolucao()
    finally:
        proc._completar_pela_declaracao = original  # type: ignore[attr-defined]
    print("# (negativa) sem a completacao declarada, os casos (D6)/(D7) ficam:", file=sys.stderr)
    print(f"#   (D6) {problemas_d6 if problemas_d6 else 'VERDE — o que seria um defeito da bancada'}", file=sys.stderr)
    print(f"#   (D7) {problemas_d7 if problemas_d7 else 'VERDE — o que seria um defeito da bancada'}", file=sys.stderr)
    problemas: list[str] = []
    if not problemas_d6:
        problemas.append("o caso (D6) ficou VERDE sem a completacao declarada — a bancada nao a mede")
    if not problemas_d7:
        problemas.append("o caso (D7) ficou VERDE sem a completacao declarada — a bancada nao a mede")
    return problemas


#: A TABELA DECLARADA do silencio: o `preco_de_liquidacao` [C] projectado por alavancagem (preco 1.25 do
#: duplo, tick 0.00001 = `10^-5`, `digitos` 5). Alavancagem 1 -> `"0"` (o contrato di-lo); 5 -> `"1"`; 30 -> `"1.2"`.
LIQUIDACAO_PROJECTADA_NO_SILENCIO = {"1": "0", "5": "1", "30": "1.2"}


def _conferir_silencio(alavancagem: str, desfecho: dict[str, Any] | None, at: Any) -> list[str]:
    """Confere UMA corrida do silencio: `desconhecido`, os cinco campos da resolucao, e o [C] da tabela."""
    if desfecho is None:
        return [f"alavancagem {alavancagem}: nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    problemas = []
    if carga.get("classificacao") != "desconhecido":
        problemas.append(f"alavancagem {alavancagem}: classificacao={carga.get('classificacao')!r}, esperado 'desconhecido'")
    if "motivo" in carga:
        problemas.append(f"alavancagem {alavancagem}: `desconhecido` NAO leva motivo (so' a recusa o exige)")
    resolucao = _mapa(carga.get("resolucao"))
    for campo in ("quantidade", "nocional", "margem_empenhada", "alavancagem_efectiva", "preco_de_liquidacao"):
        if campo not in resolucao:
            problemas.append(f"alavancagem {alavancagem}: resolucao.{campo} AUSENTE no `desconhecido` (o contrato exige a resolucao completa)")
    if resolucao.get("alavancagem_efectiva") != alavancagem:
        problemas.append(f"alavancagem {alavancagem}: resolucao.alavancagem_efectiva={resolucao.get('alavancagem_efectiva')!r}, esperado {alavancagem!r}")
    if resolucao.get("margem_empenhada") != "1000":
        problemas.append(f"alavancagem {alavancagem}: resolucao.margem_empenhada={resolucao.get('margem_empenhada')!r}, esperado '1000'")
    esperado_liq = LIQUIDACAO_PROJECTADA_NO_SILENCIO[alavancagem]
    if resolucao.get("preco_de_liquidacao") != esperado_liq:
        problemas.append(f"alavancagem {alavancagem}: resolucao.preco_de_liquidacao={resolucao.get('preco_de_liquidacao')!r}, esperado {esperado_liq!r} (a projecao [C])")
    if _mapa(carga.get("resposta_do_venue")).get("sem_resposta") is not True:
        problemas.append(f"alavancagem {alavancagem}: resposta_do_venue.sem_resposta tem de ser true")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"alavancagem {alavancagem}: a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_d_silencio() -> list[str]:
    """O silencio com ALAVANCAGEM 1, 5 e 30 (o par de controle): com TODAS tem de SAIR a linha `desconhecido`.

    ANTES da A-12 (medido, 05/10/2026): so' a alavancagem 1 saia — com 5 e 30 a resolucao pre-envio vinha sem
    `preco_de_liquidacao`, o contrato recusava-a por `campo_obrigatorio_ausente` e NAO saia linha nenhuma (o
    FR-067 quebrado no caso comum). DEPOIS: sai com os CINCO campos, e o `preco_de_liquidacao` e' o [C] da
    tabela declarada. O prazo declarado (300 ms) tem de ser respeitado em cada uma.
    """
    problemas: list[str] = []
    for alavancagem in ("1", "5", "30"):
        protocolo = ProtocoloFalso(atraso=10.0)  # o duplo NAO responde dentro do prazo
        transporte = TransporteDuplo(protocolo)
        t0 = time.time()
        at = _correr(transporte, {**BOLETA, "alavancagem": alavancagem}, prazo_ms=300)
        decorrido = time.time() - t0
        problemas.extend(_conferir_silencio(alavancagem, _desfecho(at), at))
        if decorrido > 2.0:
            problemas.append(f"alavancagem {alavancagem}: o prazo declarado nao foi respeitado (decorrido {decorrido:.2f}s)")
    return problemas


def prova_e_a_accao_entra_inteira() -> list[str]:
    """A accao do `ordens.py`/`fecho.py` tem de entrar no pedido EXACTAMENTE — campo a campo."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    at = _correr(transporte, BOLETA)
    traducao = _diag_de(at, "traducao")
    if traducao is None:
        return ["nao houve diagnostico de traducao: nao se pode comparar a accao com o pedido"]
    accao = traducao["accao"]
    if not protocolo.pedidos:
        return ["o pedido nao chegou ao protocolo"]
    pedido = protocolo.pedidos[0]
    if not isinstance(pedido, ProtoOANewOrderReq):
        return [f"o pedido de abertura nao foi um ProtoOANewOrderReq (foi {type(pedido).__name__})"]

    def inteiro_do_preco(valor: Any) -> int | None:
        if not valor:
            return None
        return int((Decimal(str(valor)) * 100000).to_integral_value())

    tabela = [
        ("symbolId", accao.get("symbolId"), pedido.symbol_id),
        ("tradeSide", accao.get("tradeSide"), ProtoOATradeSide(pedido.trade_side).name),
        ("orderType", accao.get("orderType"), ProtoOAOrderType(pedido.order_type).name),
        ("volume", accao.get("volume"), pedido.volume),
        ("timeInForce(FOK|IOC)", accao.get("timeInForce"), {4: "FOK", 3: "IOC", 2: "GTC"}.get(pedido.time_in_force)),
        ("clientOrderId", accao.get("clientOrderId"), pedido.client_order_id),
        ("slippageInPoints", accao.get("slippageInPoints"), pedido.slippage_in_points),
        ("baseSlippagePrice", accao.get("baseSlippagePrice"), inteiro_do_preco(pedido.base_slippage_price)),
        ("relativeStopLoss", accao.get("relativeStopLoss"), pedido.relative_stop_loss if pedido.relative_stop_loss else None),
        ("relativeTakeProfit", accao.get("relativeTakeProfit"), pedido.relative_take_profit if pedido.relative_take_profit else None),
        ("limitPrice", accao.get("limitPrice"), inteiro_do_preco(pedido.limit_price)),
        ("stopPrice", accao.get("stopPrice"), inteiro_do_preco(pedido.stop_price)),
    ]
    problemas = []
    print("# (e) a accao do `ordens.py` vs o PEDIDO que entrou no protocolo da biblioteca", file=sys.stderr)
    for nome, da_accao, do_pedido in tabela:
        marca = "==" if da_accao == do_pedido else "!="
        print(f"#   {marca} {nome}: accao={da_accao!r} pedido={do_pedido!r}", file=sys.stderr)
        if da_accao != do_pedido:
            problemas.append(f"{nome}: o pedido levou {do_pedido!r}, a accao trazia {da_accao!r}")

    # ---- o FECHO: a accao do `fecho.py` (com o `positionId`) tem de entrar no pedido ------------------------
    ordem = feixo.decidir_fecho(
        {
            "conta": ficha.conta,
            "instrumento": "EURUSD",
            "symbol_id": 42,
            "posicoes": [{"posicao": 555, "symbol_id": 42, "lado": "BUY", "volume": 8000}],
            "marca_do_cliente": "7-ciclo-1/linha-1",
        }
    ).ordem
    if ordem is None:
        problemas.append("o fecho nao produziu ordem para enviar")
        return problemas
    protocolo_fecho = ProtocoloFalso(resposta=evento_preenchido(posicao=555))
    transporte_fecho = TransporteDuplo(protocolo_fecho)
    resultado = transporte_fecho.fechar_posicao(ficha.ctid_trader_account_id, ordem)
    if not resultado.ok:
        problemas.append(f"o fecho nao foi enviado: {resultado.motivo}: {resultado.porque}")
        return problemas
    pedido_fecho = protocolo_fecho.pedidos[0]
    if not isinstance(pedido_fecho, ProtoOAClosePositionReq):
        problemas.append(f"o pedido de fecho nao foi um ProtoOAClosePositionReq (foi {type(pedido_fecho).__name__})")
    else:
        # A TABELA CHAVE-A-CHAVE DO FECHO — e o que NAO CABE, dito (para o relatorio).
        print("# (e) a accao do `fecho.py` vs o PEDIDO de fecho (ClosePositionRequest)", file=sys.stderr)
        print(f"#   == positionId: accao={ordem.get('positionId')!r} pedido={pedido_fecho.position_id!r}", file=sys.stderr)
        print(f"#   == volume: accao={ordem.get('volume')!r} pedido={pedido_fecho.volume!r}", file=sys.stderr)
        for chave in ("tradeSide", "orderType", "clientOrderId"):
            if chave in ordem:
                print(
                    f"#   -- {chave}={ordem[chave]!r}: O `ClosePositionRequest` NAO TEM este campo — o lado sai da "
                    "POSICAO no venue, e a marca nao viaja no fecho por posicao",
                    file=sys.stderr,
                )
        if pedido_fecho.position_id != ordem["positionId"]:
            problemas.append(f"fecho.position_id={pedido_fecho.position_id!r}, a accao do fecho trazia positionId={ordem['positionId']!r}")
        if pedido_fecho.volume != ordem["volume"]:
            problemas.append(f"fecho.volume={pedido_fecho.volume!r}, a accao do fecho trazia volume={ordem['volume']!r}")
    return problemas


def prova_fecho_pela_costura() -> list[str]:
    """O FECHO pela COSTURA inteira: boleta `caixa` -> `fecho.py` -> `fechar_posicao` -> desfecho."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido(posicao=555, executado=8000, volume=8000, margem=100))
    transporte = TransporteDuplo(protocolo, posicoes=[{"posicao": 555, "symbol_id": 42, "lado": "BUY", "volume": 8000}])
    at = _correr(transporte, BOLETA_CAIXA)
    if not protocolo.pedidos:
        return [f"o fecho NAO chegou ao protocolo (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    pedido = protocolo.pedidos[0]
    problemas = []
    if not isinstance(pedido, ProtoOAClosePositionReq):
        return [f"o pedido de fecho nao foi um ProtoOAClosePositionReq (foi {type(pedido).__name__})"]
    if pedido.position_id != 555:
        problemas.append(f"fecho.position_id={pedido.position_id!r}, esperado 555 (o `positionId` da accao)")
    if pedido.volume != 8000:
        problemas.append(f"fecho.volume={pedido.volume!r}, esperado 8000 (o volume que o venue publicou)")
    desfecho = _desfecho(at)
    if desfecho is None:
        problemas.append(f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})")
        return problemas
    if desfecho["carga"].get("classificacao") != "aceite":
        problemas.append(f"classificacao={desfecho['carga'].get('classificacao')!r}, esperado 'aceite'")
    rv = _mapa(desfecho["carga"].get("resposta_do_venue"))
    if _mapa(rv.get("position")).get("positionId") != 555:
        problemas.append(f"position.positionId={_mapa(rv.get('position')).get('positionId')!r}, esperado 555")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha do fecho nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_porque_o_protocolo() -> list[str]:
    """A MEDICAO que justifica ler o evento do VENUE e nao o `ExecutionEvent` achatado da biblioteca.

    `place_order`/`close_position` passam por `_execute_trade`, que devolve `execution_event_from_proto(response)`
    — um resumo ACHATADO. Aqui mede-se, campo a campo, o que esse resumo PERDE: sem `order`/`position`/`deal` nao
    ha' `usedMargin`/`marginRate`/`moneyDigits`, a resolucao sai sem `margem_empenhada` e o desfecho de um
    `ORDER_FILLED` e' RECUSADO pelo contrato (medido: nenhuma linha sai).
    """
    from ctrader_api_client.events._execution import execution_event_from_proto

    evento = evento_preenchido()
    achatado = execution_event_from_proto(evento)
    campos = sorted(achatado.__dataclass_fields__)
    perdeu = [campo for campo in ("order", "position", "deal", "order_status", "deal_status") if campo not in campos]
    print("# (g) o `ExecutionEvent` achatado da biblioteca — campos:", file=sys.stderr)
    print(f"#   {campos}", file=sys.stderr)
    print(f"#   PERDEU: {perdeu}", file=sys.stderr)
    problemas = []
    if not perdeu:
        problemas.append("o `ExecutionEvent` da biblioteca JA' traz order/position/deal: a razao desta escolha caiu")
    return problemas


def prova_negativa_verbo_ausente() -> list[str]:
    """Com o VERBO AUSENTE, a MESMA boleta tem de cair em `capacidade_nao_declarada` — o vermelho que mede."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    transporte.colocar_ordem = None  # type: ignore[assignment]  (o comportamento ANTIGO: `getattr` sem o metodo)
    at = _correr(transporte, BOLETA)
    desfecho = _desfecho(at)
    if desfecho is None:
        return ["nem a recusa saiu: o caminho antigo mudou de comportamento"]
    carga = desfecho["carga"]
    if carga.get("classificacao") != "recusado" or carga.get("motivo") != "capacidade_nao_declarada":
        return [f"com o verbo ausente esperava-se recusado/capacidade_nao_declarada, veio {carga.get('classificacao')!r}/{carga.get('motivo')!r}"]
    # E o caso (a) fica VERMELHO a nomea-lo:
    problemas_da_a = prova_a_aceite_com_transporte(transporte)
    print("# (negativa) com o verbo ausente, a MESMA boleta do caso (a) fica:", file=sys.stderr)
    print(f"#   {problemas_da_a if problemas_da_a else 'VERDE — o que seria um defeito da bancada'}", file=sys.stderr)
    if not problemas_da_a:
        return ["o caso (a) ficou VERDE com o verbo ausente — a bancada nao mede o envio"]
    return []


def prova_negativa_sem_a_projecao() -> list[str]:
    """SEM a projeccao [C], a MESMA boleta com alavancagem 30 NAO pode sair — o vermelho que mede a A-12.

    Contraparte da `prova_negativa_verbo_ausente`: desliga-se `ordens.preco_de_liquidacao_projectado` (devolve
    `None` — o comportamento ANTIGO, em que o campo so' se preenchia com alavancagem 1) e o caso da alavancagem
    30 tem de ficar VERMELHO a nomear a resolucao incompleta. Sem esse vermelho, a bancada nao mede a projecao.
    """
    original = Or.preco_de_liquidacao_projectado
    Or.preco_de_liquidacao_projectado = lambda *a, **k: None  # type: ignore[assignment]
    try:
        protocolo = ProtocoloFalso(atraso=10.0)
        transporte = TransporteDuplo(protocolo)
        at = _correr(transporte, {**BOLETA, "alavancagem": "30"}, prazo_ms=300)
        problemas_da_d = _conferir_silencio("30", _desfecho(at), at)
    finally:
        Or.preco_de_liquidacao_projectado = original  # type: ignore[assignment]
    print("# (negativa) sem a projecao, a alavancagem 30 fica:", file=sys.stderr)
    print(f"#   {problemas_da_d if problemas_da_d else 'VERDE — o que seria um defeito da bancada'}", file=sys.stderr)
    if not problemas_da_d:
        return ["a alavancagem 30 ficou VERDE sem a projecao — a bancada nao mede a projecao (A-12)"]
    return []


def prova_a_aceite_com_transporte(transporte: Tr.Transporte) -> list[str]:
    at = _correr(transporte, BOLETA)
    desfecho = _desfecho(at)
    if desfecho is None:
        return ["nao saiu linha `desfecho`"]
    if desfecho["carga"].get("classificacao") != "aceite":
        return [f"classificacao={desfecho['carga'].get('classificacao')!r}, esperado 'aceite'"]
    return []


# =============================================================================================================
# US5 — FR-068/FR-069: O ESTADO POR INSTRUMENTO, A RECUSA DA ORDEM NOVA E A RECONCILIACAO POR LEITURA.
#
# A DECISAO DO DONO, com data (05/10/2026): a recusa da ordem nova (FR-068) sai com o motivo
# `prazo_excedido` — o unico do conjunto FECHADO que ja' significa isto, no vocabulario da MESA
# (`core/ciclo/acoes.json#por_motivo.prazo_excedido` -> accao `parar_e_reconciliar`). NAO se emendou o
# contrato: fica por decidir um nome PROPRIO (`desconhecido_por_reconciliar`) no dia em que se quiser pagar
# esse custo (emenda + subida de versao + TRADUCAO da mesa).
# =============================================================================================================


def _pendente(transporte: Tr.Transporte, prazo_ms: int = 300, correlacao: str = "us5/a") -> tuple[Any, Any]:
    """Deixa o instrumento PENDENTE pelo caminho REAL: uma abertura que o duplo NAO responde dentro do prazo.

    Devolve `(arranque, atendimento_do_silencio)`. O `arranque` e' o MESMO objecto que o processo usa em
    producao — e' ele que guarda a pendencia por instrumento, e por isso tem de atravessar as mensagens.
    """
    arranque = _arranque(transporte, prazo_ms)
    at = _correr(transporte, BOLETA, prazo_ms=prazo_ms, correlacao=correlacao, arranque=arranque)
    return arranque, at


def prova_us5_a_silencio_marca_pendente() -> list[str]:
    """(a) ENVIO SEM RESPOSTA -> `desconhecido` E o instrumento fica PENDENTE."""
    protocolo = ProtocoloFalso(atraso=10.0)  # o duplo NAO responde dentro do prazo
    transporte = TransporteDuplo(protocolo)
    arranque, at = _pendente(transporte)
    problemas: list[str] = []
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    if desfecho["carga"].get("classificacao") != "desconhecido":
        problemas.append(f"classificacao={desfecho['carga'].get('classificacao')!r}, esperado 'desconhecido'")
    if "EURUSD" not in arranque.pendentes:
        problemas.append(f"o instrumento NAO ficou pendente: pendentes={sorted(arranque.pendentes)}")
    if len(protocolo.pedidos) != 1:
        problemas.append(f"mensagens ao protocolo={len(protocolo.pedidos)}, esperado 1 (a ordem FOI enviada)")
    print(
        "# (a) mensagens ao protocolo (o envio que ficou sem resposta):",
        len(protocolo.pedidos),
        file=sys.stderr,
    )
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha do `desconhecido` nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_us5_b_ordem_nova_com_pendente() -> list[str]:
    """(b) COM PENDENTE, uma ordem NOVA no mesmo instrumento e' RECUSADA — e sao ZERO as mensagens ao protocolo.

    O motivo e' `prazo_excedido` (decisao do dono): no vocabulario da MESA e' ele que dispara
    `parar_e_reconciliar`. A ordem nova nao chega a ser traduzida — a trava e' a PRIMEIRA coisa do caminho.
    """
    protocolo = ProtocoloFalso(atraso=10.0)
    transporte = TransporteDuplo(protocolo)
    arranque, _ = _pendente(transporte)
    antes = len(protocolo.pedidos)  # = 1 (o envio silencioso de (a))
    at = _correr(
        transporte,
        {**BOLETA, "referencia_do_cliente": "ciclo-2/linha-1"},
        prazo_ms=300,
        correlacao="us5/b",
        arranque=arranque,
    )
    problemas: list[str] = []
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    if carga.get("classificacao") != "recusado":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'recusado'")
    if carga.get("motivo") != "prazo_excedido":
        problemas.append(f"motivo={carga.get('motivo')!r}, esperado 'prazo_excedido' (a decisao do dono)")
    novas = len(protocolo.pedidos) - antes
    if novas != 0:
        problemas.append(f"a ordem nova gerou {novas} mensagem(ns) ao protocolo: tinha de ser ZERO")
    if "EURUSD" not in arranque.pendentes:
        problemas.append("o instrumento deixou de estar pendente sem reconciliacao (nao podia)")
    print("# (b) mensagens ao protocolo NESTA ordem nova (tem de ser ZERO):", novas, file=sys.stderr)
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha da recusa nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_us5_c_fecho_passa_com_pendente() -> list[str]:
    """(c) O FECHO no mesmo instrumento PASSA, mesmo com o instrumento pendente (a exposicao desmonta-se)."""
    protocolo = ProtocoloFalso(atraso=10.0)
    transporte = TransporteDuplo(protocolo, posicoes=[{"posicao": 555, "symbol_id": 42, "lado": "BUY", "volume": 8000}])
    arranque, _ = _pendente(transporte)
    # A partir daqui, o venue RESPONDE (o fecho nao e' o caso do silencio).
    protocolo.atraso = 0.0
    protocolo.resposta = evento_preenchido(posicao=555, executado=8000, volume=8000, margem=100)
    antes = len(protocolo.pedidos)
    at = _correr(transporte, BOLETA_CAIXA, prazo_ms=300, correlacao="us5/c", arranque=arranque)
    problemas: list[str] = []
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"o fecho NAO saiu (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    if desfecho["carga"].get("classificacao") != "aceite":
        problemas.append(f"classificacao={desfecho['carga'].get('classificacao')!r}, esperado 'aceite' (o fecho PASSA com pendente)")
    if len(protocolo.pedidos) - antes != 1:
        problemas.append("o fecho nao chegou ao protocolo (o FR-068 so' trava a ABERTURA, nunca o fecho)")
    if "EURUSD" not in arranque.pendentes:
        problemas.append("o fecho mexeu na pendencia: nao devia — so' a reconciliacao a tira")
    return problemas


def prova_us5_d_reconciliacao_acha_a_ordem() -> list[str]:
    """(d) RECONCILIADO POR LEITURA (a ordem existe no venue) -> o desfecho VERDADEIRO sai, o instrumento sai
    de pendente, e um pedido NOVO passa."""
    protocolo = ProtocoloFalso(atraso=10.0)
    ordem_no_venue = {
        "ordem": 501,
        "symbol_id": 42,
        "lado": "BUY",
        "estado": "FILLED",
        "volume": 80000,
        "volume_executado": 80000,
        "preco_de_execucao": 125000,
        "posicao": 9001,
        "marca_do_cliente": "7-ciclo-1/linha-1",
    }
    transporte = TransporteDuplo(protocolo)  # sem registo: o silencio cria a pendencia de facto
    arranque, _ = _pendente(transporte)
    # So' DEPOIS do silencio e' que a ordem aparece no registo do venue — e' a leitura que a vai encontrar.
    transporte._ordens = [ordem_no_venue]  # noqa: SLF001 (a bancada controla o duplo)
    problemas: list[str] = []

    # A LEITURA que reconcilia: procura a NOSSA marca no registo do venue.
    at_rec = proc.reconciliar(arranque, "EURUSD")
    _CRU.setdefault(_CASO, []).append(at_rec)
    if not at_rec.linhas:
        return [f"a reconciliacao NAO publicou desfecho (diag: {json.dumps(at_rec.diag, ensure_ascii=False)})"]
    carga_rec = json.loads(at_rec.linhas[0])["carga"]
    if carga_rec.get("classificacao") != "aceite":
        problemas.append(f"o desfecho VERDADEIRO veio {carga_rec.get('classificacao')!r}, esperado 'aceite' (a ordem existe)")
    if "EURUSD" in arranque.pendentes:
        problemas.append("o instrumento CONTINUA pendente depois de a leitura achar a ordem")
    veredicto = _no_contrato(at_rec.linhas[0])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha do desfecho verdadeiro nao passa o CONTRATO: {veredicto}")

    # UM PEDIDO NOVO (referencia diferente) tem de PASSAR: o instrumento ja' nao esta' pendente.
    protocolo.atraso = 0.0
    protocolo.resposta = evento_preenchido()
    at_novo = _correr(
        transporte,
        {**BOLETA, "referencia_do_cliente": "ciclo-3/linha-1"},
        prazo_ms=300,
        correlacao="us5/d",
        arranque=arranque,
    )
    desfecho_novo = _desfecho(at_novo)
    if desfecho_novo is None:
        problemas.append("o pedido novo NAO saiu depois da reconciliacao (devia passar)")
    elif desfecho_novo["carga"].get("classificacao") != "aceite":
        problemas.append(f"o pedido novo veio {desfecho_novo['carga'].get('classificacao')!r}, esperado 'aceite'")
    return problemas


def prova_us5_e_leitura_falhada_nao_inventa() -> list[str]:
    """(e) LEITURA FALHADA -> continua `desconhecido`, instrumento PENDENTE, NENHUM desfecho inventado."""
    protocolo = ProtocoloFalso(atraso=10.0)
    transporte = TransporteDuplo(protocolo)
    arranque, _ = _pendente(transporte)
    pendencia_antes = arranque.pendentes.get("EURUSD")
    # A LEITURA falha nas DUAS pontas (posicoes e registo de ordens). O duplo e' o MESMO — e' isso que faz a
    # reconciliacao ver a falha.
    transporte._leituras_falham = {"posicoes", "ordens_do_registo"}  # noqa: SLF001 (a bancada controla o duplo)
    at_rec = proc.reconciliar(arranque, "EURUSD")
    _CRU.setdefault(_CASO, []).append(at_rec)
    problemas: list[str] = []
    if at_rec.linhas:
        problemas.append(f"a leitura falhada produziu {len(at_rec.linhas)} linha(s): NENHUM desfecho pode sair (FR-069)")
    if "EURUSD" not in arranque.pendentes:
        problemas.append("o instrumento deixou de estar pendente com uma leitura falhada (nao podia)")
    elif arranque.pendentes["EURUSD"] is not pendencia_antes:
        problemas.append("a pendencia mudou de identidade com a leitura falhada (nao devia tocar-lhe)")
    diag = at_rec.diag[0] if at_rec.diag else {}
    if diag.get("veredicto") != "indecidivel":
        problemas.append(f"o diag da reconciliacao veio {diag.get('veredicto')!r}, esperado 'indecidivel'")
    # E a ordem NOVA continua recusada (a pendencia nao saiu).
    at_nova = _correr(
        transporte,
        {**BOLETA, "referencia_do_cliente": "ciclo-2/linha-1"},
        prazo_ms=300,
        correlacao="us5/e-nova",
        arranque=arranque,
    )
    desfecho = _desfecho(at_nova)
    if desfecho is None or desfecho["carga"].get("motivo") != "prazo_excedido":
        problemas.append("depois da leitura falhada, a ordem nova devia continuar recusada por `prazo_excedido`")
    return problemas


def prova_us5_f_controle_sem_pendente_passa() -> list[str]:
    """(f) CONTROLE: SEM pendente, uma ordem nova PASSA e chega ao protocolo — a recusa nao e' o caminho normal."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    arranque = _arranque(transporte, 3000)
    at = _correr(transporte, BOLETA, prazo_ms=3000, correlacao="us5/f", arranque=arranque)
    problemas: list[str] = []
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    if desfecho["carga"].get("classificacao") != "aceite":
        problemas.append(f"classificacao={desfecho['carga'].get('classificacao')!r}, esperado 'aceite'")
    if len(protocolo.pedidos) != 1:
        problemas.append(f"mensagens ao protocolo={len(protocolo.pedidos)}, esperado 1 (a ordem nova PASSA)")
    if arranque.pendentes:
        problemas.append(f"o instrumento ficou pendente sem silencio: {sorted(arranque.pendentes)}")
    return problemas


def prova_us5_g_reinicio_primeira_leitura_reconcilia() -> list[str]:
    """O ESTADO MORRE COM O PROCESSO, e e' isso que obriga a verdade a vir da LEITURA (FR-069).

    Simula-se um reinicio: um `Arranque` NOVO (a memoria do processo perdeu-se — nao ha pendencia nenhuma) e
    reenvia-se a MESMA referencia. A leitura vai ao REGISTO do venue, encontra a NOSSA marca e RECUSA a
    segunda ordem (`referencia_ja_enviada_ao_venue`): a primeira leitura a seguir ao arranque reconciliou, sem
    a memoria ter guardado nada.
    """
    protocolo = ProtocoloFalso(atraso=10.0)
    ordem_no_venue = {
        "ordem": 501,
        "symbol_id": 42,
        "lado": "BUY",
        "estado": "FILLED",
        "volume": 80000,
        "volume_executado": 80000,
        "posicao": 9001,
        "marca_do_cliente": "7-ciclo-1/linha-1",
    }
    transporte = TransporteDuplo(protocolo, ordens=[ordem_no_venue])
    arranque = _arranque(transporte, 3000)  # ARRANQUE NOVO: sem pendencia nenhuma (a memoria morreu)
    at = _correr(transporte, BOLETA, prazo_ms=3000, correlacao="us5/g", arranque=arranque)
    problemas: list[str] = []
    desfecho = _desfecho(at)
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    if carga.get("classificacao") != "recusado" or carga.get("motivo") != "referencia_ja_enviada_ao_venue":
        problemas.append(
            f"veio {carga.get('classificacao')!r}/{carga.get('motivo')!r}, esperado recusado/referencia_ja_enviada_ao_venue"
        )
    if len(protocolo.pedidos) != 0:
        problemas.append(f"foram enviadas {len(protocolo.pedidos)} mensagem(ns) ao protocolo: tinha de ser ZERO (nao se manda segunda ordem)")
    return problemas


# =============================================================================================================
# US6 — FR-070/FR-048: A SESSAO DA CONTA. O EVENTO (roda/revoga/kick) que a biblioteca ROTEIA; a sessao
# `invalidada`; zero ordens novas; a recuperacao que LE' A CONTA antes de aceitar pedido novo, e reconcilia a
# pendencia ANTES; e as DUAS CAMADAS (transporte + sessao) conferidas no momento do envio.
#
# O DUPLO NAO FINGE A RECUPERACAO: quem re-autentica e' o maintainer da biblioteca; aqui so' se injecta o EVENTO
# que ele publicaria (`ReadyEvent`) pelo MESMO `EventEmitter` original. O evento do VENUE nao se mede — na vida
# ele so' chega numa rotacao/revogacao/kick a serio; o que se mede e' o que o conector FAZ quando ele chega.
# =============================================================================================================


def _injectar(transporte: TransporteDuplo, evento: Any) -> None:
    """Entrega o evento pelo `EventEmitter` ORIGINAL da biblioteca — o mesmo caminho da producao."""
    asyncio.run(transporte.emissor.emit(evento))


def _seguir(transporte: TransporteDuplo) -> None:
    """O degrau do ARRANQUE: liga os tratadores de sessao (a linha que da' olhos a' maquina)."""
    seguida = transporte.seguir_a_sessao_da_conta(ficha.ctid_trader_account_id)
    if not seguida.ok:
        raise AssertionError(f"nao se ligaram os tratadores de sessao: {seguida.motivo}: {seguida.porque}")


def _invalidar(transporte: TransporteDuplo) -> None:
    """O EVENTO de invalidacao do token (rotacao/revogacao) chega para a NOSSA conta."""
    _injectar(
        transporte,
        TokenInvalidatedEvent(account_ids=(ficha.ctid_trader_account_id,), reason="token was refreshed"),
    )


def _recuperar(transporte: TransporteDuplo) -> None:
    """A biblioteca re-autentica (a conta volta a autorizada) e publica o `ReadyEvent` — o unico sinal que o
    conector ve'. Nos NAO re-autenticamos nada: so' observamos este evento."""
    transporte._conta_autorizada = True  # noqa: SLF001 (a biblioteca re-autorizou; o duplo reflecte-o)
    _injectar(
        transporte,
        ReadyEvent(account_id=ficha.ctid_trader_account_id, trigger=AuthTrigger.ACCOUNT_REAUTH),
    )


def prova_us6_a_evento_marca_a_sessao() -> list[str]:
    """(a) O EVENTO de invalidacao CHEGA -> a sessao fica `invalidada` (lida pelo NOME)."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    conta = ficha.ctid_trader_account_id
    problemas: list[str] = []
    antes = transporte.estado_da_sessao(conta)
    _seguir(transporte)
    _invalidar(transporte)
    depois = transporte.estado_da_sessao(conta)
    if antes != Tr.SESSAO_AUTORIZADA:
        problemas.append(f"antes do evento o estado era {antes!r}, esperado {Tr.SESSAO_AUTORIZADA!r}")
    if depois != Tr.SESSAO_INVALIDADA:
        problemas.append(f"depois do evento o estado e' {depois!r}, esperado {Tr.SESSAO_INVALIDADA!r}")
    print(
        json.dumps(
            {
                "us6": "(a) evento -> sessao",
                "estado_antes": antes,
                "estado_depois": depois,
                "contadores": transporte.contas_da_sessao,
            },
            ensure_ascii=False,
        )
    )
    return problemas


def prova_us6_a_bis_kick_do_servidor_marca_a_sessao() -> list[str]:
    """(a-bis) O KICK do servidor (`ClientDisconnectEvent`, que nao nomeia conta) tambem marca a sessao invalidada.

    E' a cobertura do terceiro caso da spec: a ROTACAO e a REVOGACAO entram por `TokenInvalidatedEvent`, o KICK do
    servidor por `ClientDisconnectEvent`. O transporte e' de UMA conta, e o kick ao cliente marca a conta SEGUIDA.
    """
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    conta = ficha.ctid_trader_account_id
    _seguir(transporte)
    _injectar(transporte, ClientDisconnectEvent(reason="server kick"))
    depois = transporte.estado_da_sessao(conta)
    problemas: list[str] = []
    if depois != Tr.SESSAO_INVALIDADA:
        problemas.append(f"depois do kick o estado e' {depois!r}, esperado {Tr.SESSAO_INVALIDADA!r}")
    print(json.dumps({"us6": "(a-bis) kick do servidor -> sessao", "estado_depois": depois}, ensure_ascii=False))
    return problemas


def prova_us6_b_ordem_nova_com_sessao_invalidada() -> list[str]:
    """(b) Com a sessao INVALIDADA, uma ordem NOVA -> recusada por `prazo_excedido`, ZERO mensagens ao protocolo."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    _seguir(transporte)
    _invalidar(transporte)
    antes = len(protocolo.pedidos)
    at = _correr(transporte, BOLETA, correlacao="us6/b")
    desfecho = _desfecho(at)
    problemas: list[str] = []
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    if carga.get("classificacao") != "recusado":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'recusado'")
    if carga.get("motivo") != "prazo_excedido":
        problemas.append(f"motivo={carga.get('motivo')!r}, esperado 'prazo_excedido' (a decisao do dono)")
    novas = len(protocolo.pedidos) - antes
    if novas != 0:
        problemas.append(f"a ordem nova gerou {novas} mensagem(ns) ao protocolo: tinha de ser ZERO")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha da recusa nao passa o CONTRATO: {veredicto}")
    print(
        json.dumps(
            {
                "us6": "(b) ordem nova com sessao invalidada",
                "classificacao": carga.get("classificacao"),
                "motivo": carga.get("motivo"),
                "mensagens_ao_protocolo": novas,
                "estado_da_sessao": transporte.estado_da_sessao(ficha.ctid_trader_account_id),
            },
            ensure_ascii=False,
        )
    )
    return problemas


def prova_us6_c_fecho_com_sessao_invalidada() -> list[str]:
    """(c) O FECHO com a sessao INVALIDADA e' RECUSADO (uma sessao caida nao serve pedido nenhum) — e di'-se.

    DECISAO (justificada no `processo.py`): o fecho deste venue vai pelo MESMO canal da conta (o protocolo), e
    uma sessao morta nao o serve — tentar envia'-lo seria mandar por uma sessao que se sabe caida. E' DISTINTO da
    pendencia do FR-068, em que o fecho CONTINUA a passar (ai' a sessao esta' VIVA). Sessao caida = parar;
    pendencia = fechar continua.
    """
    protocolo = ProtocoloFalso(resposta=evento_preenchido(posicao=555, executado=8000, volume=8000, margem=100))
    transporte = TransporteDuplo(protocolo, posicoes=[{"posicao": 555, "symbol_id": 42, "lado": "BUY", "volume": 8000}])
    _seguir(transporte)
    _invalidar(transporte)
    antes = len(protocolo.pedidos)
    at = _correr(transporte, BOLETA_CAIXA, correlacao="us6/c")
    desfecho = _desfecho(at)
    problemas: list[str] = []
    if desfecho is None:
        return [f"o fecho nao saiu (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    if carga.get("classificacao") != "recusado":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'recusado' (a sessao caida nao serve o fecho)")
    if carga.get("motivo") != "prazo_excedido":
        problemas.append(f"motivo={carga.get('motivo')!r}, esperado 'prazo_excedido'")
    novas = len(protocolo.pedidos) - antes
    if novas != 0:
        problemas.append(f"o fecho gerou {novas} mensagem(ns) ao protocolo: tinha de ser ZERO")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha do fecho recusado nao passa o CONTRATO: {veredicto}")
    print(json.dumps({"us6": "(c) fecho com sessao invalidada", "linha": desfecho["linha"], "mensagens_ao_protocolo": novas}, ensure_ascii=False))
    return problemas


def prova_us6_d_releitura_antes_do_envio() -> list[str]:
    """(d) RECUPERADA -> a LEITURA DA CONTA vem ANTES de qualquer envio novo (a ordem das operacoes, com contadores)."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    _seguir(transporte)
    _invalidar(transporte)
    _recuperar(transporte)
    conta = ficha.ctid_trader_account_id
    estado = transporte.estado_da_sessao(conta)
    releitura = transporte.releitura_pendente(conta)
    protocolo.operacoes.clear()
    at = _correr(transporte, BOLETA, correlacao="us6/d")
    operacoes = list(protocolo.operacoes)
    problemas: list[str] = []
    if estado != Tr.SESSAO_AUTORIZADA:
        problemas.append(f"depois de recuperar o estado e' {estado!r}, esperado 'autorizada'")
    if not releitura:
        problemas.append("a recuperacao NAO deixou a releitura da conta pendente (US6 cenario 2)")
    primeira_leitura = operacoes.index("leitura_da_conta") if "leitura_da_conta" in operacoes else None
    primeiro_envio = operacoes.index("envio") if "envio" in operacoes else None
    if primeira_leitura is None:
        problemas.append("nao houve LEITURA DA CONTA depois de recuperar (tinha de ser a primeira coisa)")
    if primeiro_envio is None:
        problemas.append("a ordem nova nao chegou ao protocolo (devia passar depois da releitura)")
    if primeira_leitura is not None and primeiro_envio is not None and not (primeira_leitura < primeiro_envio):
        problemas.append(f"a leitura da conta ({primeira_leitura}) NAO veio antes do envio ({primeiro_envio})")
    if transporte.contas_da_sessao["releituras"] != 1:
        problemas.append(f"releituras confirmadas={transporte.contas_da_sessao['releituras']}, esperado 1")
    desfecho = _desfecho(at)
    if desfecho is None or desfecho["carga"].get("classificacao") != "aceite":
        problemas.append(f"a ordem nova devia passar depois da releitura (diag: {json.dumps(at.diag, ensure_ascii=False)})")
    print(
        json.dumps(
            {
                "us6": "(d) recuperada -> leitura da conta antes do envio",
                "estado_da_sessao": estado,
                "releitura_pendente_antes": releitura,
                "operacoes": operacoes,
                "contador_leitura_da_conta": operacoes.count("leitura_da_conta"),
                "contador_envio": operacoes.count("envio"),
                "contadores_da_sessao": transporte.contas_da_sessao,
            },
            ensure_ascii=False,
        )
    )
    return problemas


def prova_us6_e_recuperacao_reconcilia_antes_da_ordem_nova() -> list[str]:
    """(e) Com a PENDENCIA do US5 em curso e a sessao a recuperar -> RECONCILIA antes de aceitar ordem nova."""
    protocolo = ProtocoloFalso(atraso=10.0)
    ordem_no_venue = {
        "ordem": 501,
        "symbol_id": 42,
        "lado": "BUY",
        "estado": "FILLED",
        "volume": 80000,
        "volume_executado": 80000,
        "preco_de_execucao": 125000,
        "posicao": 9001,
        "marca_do_cliente": "7-ciclo-1/linha-1",
    }
    transporte = TransporteDuplo(protocolo)
    _seguir(transporte)
    arranque, _ = _pendente(transporte)  # a ordem fica `desconhecida` (silencio) e o instrumento PENDENTE
    problemas: list[str] = []
    if "EURUSD" not in arranque.pendentes:
        return ["o instrumento nao ficou pendente: sem pendencia este caso nao mede a US6 cenario 3"]
    transporte._ordens = [ordem_no_venue]  # noqa: SLF001 (a ordem aparece no registo do venue)
    _invalidar(transporte)
    _recuperar(transporte)
    # A partir daqui o venue RESPONDE (o pedido novo nao e' o caso do silencio).
    protocolo.atraso = 0.0
    protocolo.resposta = evento_preenchido()
    protocolo.operacoes.clear()
    antes = len(protocolo.pedidos)
    at = _correr(
        transporte,
        {**BOLETA, "referencia_do_cliente": "ciclo-3/linha-1"},
        prazo_ms=300,
        correlacao="us6/e",
        arranque=arranque,
    )
    linhas = [json.loads(linha) for linha in at.linhas]
    desfechos = [bruto for bruto in linhas if bruto.get("tipo") == "desfecho"]
    ids = [bruto.get("id") for bruto in desfechos]
    if "EURUSD" in arranque.pendentes:
        problemas.append("o instrumento CONTINUA pendente: a recuperacao nao reconciliou antes de aceitar a ordem nova")
    reconcilia = next((b for b in desfechos if b.get("id") == "us5/a"), None)
    if reconcilia is None:
        problemas.append(f"a reconciliacao da ordem pendente NAO veio nas linhas (ids: {ids})")
    if not any(b.get("id") == "us6/e" for b in desfechos):
        problemas.append(f"o pedido NOVO nao saiu depois da reconciliacao (ids: {ids})")
    novas = len(protocolo.pedidos) - antes
    if novas != 1:
        problemas.append(f"o pedido novo gerou {novas} mensagem(ns) ao protocolo: esperado 1 (so' o envio novo)")
    print(
        json.dumps(
            {
                "us6": "(e) pendencia + recuperacao -> reconcilia antes da ordem nova",
                "ids_dos_desfechos": ids,
                "instrumento_ainda_pendente": "EURUSD" in arranque.pendentes,
                "operacoes": list(protocolo.operacoes),
                "mensagens_ao_protocolo_da_ordem_nova": novas,
            },
            ensure_ascii=False,
        )
    )
    return problemas


def prova_us6_f_falta_a_camada_do_transporte() -> list[str]:
    """(f) Falta a camada do TRANSPORTE (a aplicacao nao autenticou) -> recusa NOMEADA, ZERO envios."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    _seguir(transporte)
    transporte.app_autenticada = False  # a camada do TRANSPORTE cai; a sessao da conta continua autorizada
    antes = len(protocolo.pedidos)
    at = _correr(transporte, BOLETA, correlacao="us6/f")
    desfecho = _desfecho(at)
    problemas: list[str] = []
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    if carga.get("classificacao") != "recusado":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'recusado'")
    if carga.get("motivo") != "prazo_excedido":
        problemas.append(f"motivo={carga.get('motivo')!r}, esperado 'prazo_excedido'")
    novas = len(protocolo.pedidos) - antes
    if novas != 0:
        problemas.append(f"faltando o transporte houve {novas} mensagem(ns) ao protocolo: tinha de ser ZERO")
    if transporte.estado_da_sessao(ficha.ctid_trader_account_id) != Tr.SESSAO_AUTORIZADA:
        problemas.append("a sessao da conta devia estar autorizada — so' o TRANSPORTE faltava (uma bandeira so' nao decide)")
    print(
        json.dumps(
            {
                "us6": "(f) falta a camada do transporte",
                "classificacao": carga.get("classificacao"),
                "motivo": carga.get("motivo"),
                "mensagens_ao_protocolo": novas,
                "transporte_pronto": transporte.app_autenticada,
                "estado_da_sessao": transporte.estado_da_sessao(ficha.ctid_trader_account_id),
            },
            ensure_ascii=False,
        )
    )
    return problemas


def prova_us6_g_controle_tudo_autorizado_passa() -> list[str]:
    """(g) CONTROLE: tudo autorizado e sem pendencia -> a ordem PASSA (1 mensagem ao protocolo)."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo)
    _seguir(transporte)
    at = _correr(transporte, BOLETA, correlacao="us6/g")
    desfecho = _desfecho(at)
    problemas: list[str] = []
    if desfecho is None:
        return [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    if desfecho["carga"].get("classificacao") != "aceite":
        problemas.append(f"classificacao={desfecho['carga'].get('classificacao')!r}, esperado 'aceite'")
    if len(protocolo.pedidos) != 1:
        problemas.append(f"mensagens ao protocolo={len(protocolo.pedidos)}, esperado 1")
    print(json.dumps({"us6": "(g) controle: tudo autorizado passa", "mensagens_ao_protocolo": len(protocolo.pedidos)}, ensure_ascii=False))
    return problemas


def prova_negativa_sem_a_guarda_das_camadas() -> list[str]:
    """A PROVA NEGATIVA: tirada a guarda das duas camadas, a ordem com a sessao INVALIDADA SAI — e o caso (b) cai VERMELHO.

    Repoe-se o comportamento de HOJE (o `_enviar_pedido` nao conferia camada nenhuma): o guarda passa a devolver
    `None` sempre. Sem este vermelho a bancada nao mede a guarda, mede o duplo.
    """
    original = Tr.Transporte.conferir_as_duas_camadas
    Tr.Transporte.conferir_as_duas_camadas = lambda self, account_id: None  # type: ignore[assignment]
    try:
        protocolo = ProtocoloFalso(resposta=evento_preenchido())
        transporte = TransporteDuplo(protocolo)
        _seguir(transporte)
        _invalidar(transporte)
        _correr(transporte, BOLETA, correlacao="us6/neg")
        saiu = len(protocolo.pedidos)
        # E o caso (b) — a MESMA regra — tem de ficar VERMELHO a nomea'-la:
        problemas_da_b = prova_us6_b_ordem_nova_com_sessao_invalidada()
    finally:
        Tr.Transporte.conferir_as_duas_camadas = original  # type: ignore[assignment]
    print("# (negativa) com a guarda tirada, a ordem com a sessao invalidada:", file=sys.stderr)
    print(f"#   mensagens ao protocolo = {saiu} (o defeito reposto: a ordem SAI)", file=sys.stderr)
    print(f"#   caso (b) -> {problemas_da_b if problemas_da_b else 'VERDE — o que seria um defeito da bancada'}", file=sys.stderr)
    problemas: list[str] = []
    if saiu == 0:
        problemas.append("com a guarda tirada a ordem NAO saiu — o defeito nao se reproduz, a bancada nao mede a guarda")
    if not problemas_da_b:
        problemas.append("o caso (b) ficou VERDE com a guarda tirada — a bancada nao mede a guarda das duas camadas")
    return problemas


# =============================================================================================================


# =============================================================================================================
# A VIRADA DE MAO (1.10.0) — as DUAS pernas na MESMA passagem, e «nunca meia virada em silencio».
#
# Este venue NAO faz netting (RN-CT34): a virada NAO cabe numa ordem. O contrato (1.10.0(c)) manda o conector
# executar as DUAS pernas — FECHAR a posicao viva (por `positionId`) e ABRIR a do lado declarado — na MESMA
# passagem. O duplo devolve uma resposta POR PERNA (`ProtocoloFalso(respostas=[...])`), e a bancada mede:
#   * a SEQUENCIA (viva -> virada -> posicao do lado NOVO): os DOIS pedidos, na ordem — um
#     `ProtoOAClosePositionReq` e depois um `ProtoOANewOrderReq` — e o desfecho com a posicao que FICA;
#   * a MEIA VIRADA: o fecho RECUSADO -> a abertura NAO se envia, e a viva continua; a virada SEM posicao ->
#     RECUSA nomeada, ZERO pedidos ao fio.
# A negativa repoe o comportamento ANTIGO (a virada recusada `capacidade_nao_declarada`, antes de correr) e exige
# a sequencia a VERMELHO — sem esse vermelho, o verde da sequencia prova so' a fixture.
# =============================================================================================================

POSICAO_VIVA_SELL = {"posicao": 555, "symbol_id": 42, "lado": "SELL", "volume": 8000}
BOLETA_VIRADA = {**BOLETA, "lado": "buy", "reverter": True, "referencia_do_cliente": "virada/1", "marca_de_posse": 71}


def _virada_duas_pernas() -> list[str]:
    """A SEQUENCIA: posicao viva SELL -> `reverter: true` buy -> a posicao do lado NOVO, e o desfecho com ela."""
    protocolo = ProtocoloFalso(
        respostas=[
            evento_preenchido(posicao=555, executado=8000, volume=8000, margem=100),  # perna 1: o FECHO da viva
            evento_preenchido(posicao=9001),  # perna 2: a ABERTURA do lado declarado
        ]
    )
    transporte = TransporteDuplo(protocolo, posicoes=[dict(POSICAO_VIVA_SELL)])
    at = _correr(transporte, BOLETA_VIRADA, correlacao="virada/1")
    problemas: list[str] = []
    if len(protocolo.pedidos) != 2:
        return problemas + [
            f"pedidos ao protocolo={len(protocolo.pedidos)}, esperado 2 (o fecho e a abertura, na MESMA passagem)"
        ]
    primeiro, segundo = protocolo.pedidos
    if not isinstance(primeiro, ProtoOAClosePositionReq):
        problemas.append(f"o 1.o pedido nao foi o FECHO (foi {type(primeiro).__name__}, esperado ProtoOAClosePositionReq)")
    elif primeiro.position_id != 555 or primeiro.volume != 8000:
        problemas.append(f"o fecho nao levou a viva: positionId={primeiro.position_id!r} (esperado 555), volume={primeiro.volume!r} (esperado 8000)")
    if not isinstance(segundo, ProtoOANewOrderReq):
        problemas.append(f"o 2.o pedido nao foi a ABERTURA (foi {type(segundo).__name__}, esperado ProtoOANewOrderReq)")
    desfecho = _desfecho(at)
    if desfecho is None:
        return problemas + [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    if carga.get("classificacao") != "aceite":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'aceite' (a posicao NOVA preencheu)")
    rv = _mapa(carga.get("resposta_do_venue"))
    virada = _mapa(rv.get("virada"))
    perna_fecho = _mapa(virada.get("perna_1_o_fecho"))
    if perna_fecho.get("positionId") != 555:
        problemas.append(f"virada.perna_1_o_fecho.positionId={perna_fecho.get('positionId')!r}, esperado 555")
    if perna_fecho.get("classificacao") != "aceite":
        problemas.append(f"virada.perna_1_o_fecho.classificacao={perna_fecho.get('classificacao')!r}, esperado 'aceite'")
    o_que_fica = _mapa(virada.get("o_que_fica"))
    if o_que_fica.get("positionId") != 9001:
        problemas.append(f"virada.o_que_fica.positionId={o_que_fica.get('positionId')!r}, esperado 9001 (a posicao NOVA)")
    if o_que_fica.get("lado") != "buy":
        problemas.append(f"virada.o_que_fica.lado={o_que_fica.get('lado')!r}, esperado 'buy'")
    if o_que_fica.get("volume_no_venue_em_centesimos") != 80000:
        problemas.append(f"virada.o_que_fica.volume_no_venue_em_centesimos={o_que_fica.get('volume_no_venue_em_centesimos')!r}, esperado 80000 (o do VENUE)")
    resolucao = _mapa(carga.get("resolucao"))
    if resolucao.get("quantidade") != "800":
        problemas.append(f"resolucao.quantidade={resolucao.get('quantidade')!r}, esperado '800' (a quantidade da posicao NOVA)")
    if _mapa(rv.get("position")).get("positionId") != 9001:
        problemas.append(f"position.positionId={_mapa(rv.get('position')).get('positionId')!r}, esperado 9001")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_virada_duas_pernas() -> list[str]:
    """A sequencia da virada, com os dados crus impressos."""
    problemas = _virada_duas_pernas()
    print("# (virada) a sequencia posicao viva -> virada -> posicao do lado novo:", file=sys.stderr)
    for nome in _CRU:
        for at in _CRU[nome]:
            d = _desfecho(at)
            print(f"#   {nome}: {d['linha'] if d else '(nenhuma linha)'}", file=sys.stderr)
    return problemas


def prova_virada_fecho_recusado_nao_abre() -> list[str]:
    """A MEIA VIRADA: o FECHO recusado pelo venue -> a ABERTURA NAO se envia, e a viva continua nomeada."""
    protocolo = ProtocoloFalso(
        respostas=[evento_recusado(), evento_preenchido(posicao=9001)]  # a 2.a resposta NUNCA devia ser usada
    )
    transporte = TransporteDuplo(protocolo, posicoes=[dict(POSICAO_VIVA_SELL)])
    at = _correr(transporte, BOLETA_VIRADA, correlacao="virada/fecho-recusado")
    problemas: list[str] = []
    if len(protocolo.pedidos) != 1:
        problemas.append(f"pedidos ao protocolo={len(protocolo.pedidos)}, esperado 1 (o fecho recusado: a abertura NAO se envia)")
    desfecho = _desfecho(at)
    if desfecho is None:
        return problemas + [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    if carga.get("classificacao") != "recusado":
        problemas.append(f"classificacao={carga.get('classificacao')!r}, esperado 'recusado' (o fecho nao passou)")
    virada = _mapa(_mapa(carga.get("resposta_do_venue")).get("virada"))
    if _mapa(virada.get("perna_2_a_abertura")).get("acao") != "nao_enviada":
        problemas.append(f"virada.perna_2_a_abertura.acao={_mapa(virada.get('perna_2_a_abertura')).get('acao')!r}, esperado 'nao_enviada'")
    if _mapa(virada.get("o_que_fica")).get("positionId") != 555:
        problemas.append(f"virada.o_que_fica.positionId={_mapa(virada.get('o_que_fica')).get('positionId')!r}, esperado 555 (a viva CONTINUA)")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_virada_sem_posicao_recusa() -> list[str]:
    """A virada SEM posicao viva: RECUSA nomeada `reversao_sem_posicao_a_reverter`, ZERO pedidos ao fio."""
    protocolo = ProtocoloFalso(resposta=evento_preenchido())
    transporte = TransporteDuplo(protocolo, posicoes=[])  # conta PLANA no instrumento
    at = _correr(transporte, BOLETA_VIRADA, correlacao="virada/sem-posicao")
    problemas: list[str] = []
    if protocolo.pedidos:
        problemas.append(f"pedidos ao protocolo={len(protocolo.pedidos)}, esperado 0 (a virada sem posicao RECUSA antes)")
    desfecho = _desfecho(at)
    if desfecho is None:
        return problemas + [f"nao saiu linha `desfecho` (diag: {json.dumps(at.diag, ensure_ascii=False)})"]
    carga = desfecho["carga"]
    if carga.get("classificacao") != "recusado" or carga.get("motivo") != "reversao_sem_posicao_a_reverter":
        problemas.append(f"esperava-se recusado/reversao_sem_posicao_a_reverter, veio {carga.get('classificacao')!r}/{carga.get('motivo')!r}")
    veredicto = _no_contrato(desfecho["linha"])
    if veredicto.get("veredicto") != "aceite":
        problemas.append(f"a linha nao passa o CONTRATO: {veredicto}")
    return problemas


def prova_negativa_virada_recusada_como_antes() -> list[str]:
    """O DEFEITO (comportamento ANTIGO): a virada volta a ser recusada `capacidade_nao_declarada` numa so' ordem.

    Repoe-se a recusa que esteve no `ordens.py` ate' esta vaga (o `reverter: true` recusado ANTES de a posicao
    ser olhada) e exige-se a SEQUENCIA a VERMELHO: sem este vermelho, o verde da sequencia provaria o dado.
    """
    original = Or.traduzir

    def _recusa_a_virada_como_antes(pedido: Any) -> Any:
        boleta = pedido.get("boleta") if isinstance(pedido, dict) else None
        if isinstance(boleta, dict) and boleta.get("reverter") is True:
            return Or.Recusa(
                ok=False,
                motivo="capacidade_nao_declarada",
                porque="DEFEITO injectado: a virada recusada ANTES de correr (o comportamento antigo)",
            )
        return original(pedido)

    Or.traduzir = _recusa_a_virada_como_antes  # type: ignore[assignment]
    try:
        problemas_da_sequencia = _virada_duas_pernas()
    finally:
        Or.traduzir = original  # type: ignore[assignment]
    print("# (negativa) com a virada recusada como ANTES, a sequencia fica:", file=sys.stderr)
    print(f"#   {problemas_da_sequencia if problemas_da_sequencia else 'VERDE — o que seria um defeito da bancada'}", file=sys.stderr)
    if problemas_da_sequencia:
        return []
    return [
        "a sequencia da VIRADA continuou VERDE com a recusa antiga (`capacidade_nao_declarada`): a bancada nao "
        "mede a virada de duas pernas (RN-C17 / 1.10.0(c))"
    ]


def main() -> int:
    _armar_espioes()

    casos = [
        ("(a) aceite", prova_a_aceite),
        ("(b) recusado", prova_b_recusa),
        ("(h) recusa crua do venue (ProtoOAOrderErrorEvent)", prova_h_recusa_crua_do_venue),
        ("(c) parcial", prova_c_parcial),
        ("(D6) seguir o preenchimento — aceite -> preenchimento", prova_d6_seguir_o_preenchimento),
        ("(D7) fecho a alavancagem 30 completa a resolucao", prova_d6_bis_fecho_completa_a_resolucao),
        ("(d) desconhecido", prova_d_silencio),
        ("(e) accao->pedido", prova_e_a_accao_entra_inteira),
        ("(e-bis) fecho pela costura", prova_fecho_pela_costura),
        ("(g) porque o protocolo", prova_porque_o_protocolo),
        ("negativa: verbo ausente", prova_negativa_verbo_ausente),
        ("negativa: sem a projecao (A-12)", prova_negativa_sem_a_projecao),
        ("negativa: sem seguir o preenchimento (D6)", prova_negativa_sem_seguir_o_preenchimento),
        ("negativa: sem a projecao do fecho (D7)", prova_negativa_sem_a_projecao_do_fecho),
        ("negativa: sem a completacao declarada (D6/D7)", prova_negativa_sem_a_completacao_declarada),
        ("US5 (a) silencio -> desconhecido + instrumento pendente", prova_us5_a_silencio_marca_pendente),
        ("US5 (b) ordem nova com pendente -> recusada, ZERO envios", prova_us5_b_ordem_nova_com_pendente),
        ("US5 (c) fecho passa com pendente", prova_us5_c_fecho_passa_com_pendente),
        ("US5 (d) reconciliacao por leitura acha a ordem", prova_us5_d_reconciliacao_acha_a_ordem),
        ("US5 (e) leitura falhada nao inventa desfecho", prova_us5_e_leitura_falhada_nao_inventa),
        ("US5 (f) controle: sem pendente a ordem passa", prova_us5_f_controle_sem_pendente_passa),
        ("US5 (g) reinicio: a primeira leitura reconcilia", prova_us5_g_reinicio_primeira_leitura_reconcilia),
        ("US6 (a) evento de invalidacao -> sessao invalidada", prova_us6_a_evento_marca_a_sessao),
        ("US6 (a-bis) kick do servidor -> sessao invalidada", prova_us6_a_bis_kick_do_servidor_marca_a_sessao),
        ("US6 (b) ordem nova com sessao invalidada -> recusada, ZERO envios", prova_us6_b_ordem_nova_com_sessao_invalidada),
        ("US6 (c) fecho com sessao invalidada -> recusado", prova_us6_c_fecho_com_sessao_invalidada),
        ("US6 (d) recuperada -> leitura da conta antes do envio", prova_us6_d_releitura_antes_do_envio),
        ("US6 (e) pendencia + recuperacao -> reconcilia antes da ordem nova", prova_us6_e_recuperacao_reconcilia_antes_da_ordem_nova),
        ("US6 (f) falta a camada do transporte -> recusada, ZERO envios", prova_us6_f_falta_a_camada_do_transporte),
        ("US6 (g) controle: tudo autorizado passa", prova_us6_g_controle_tudo_autorizado_passa),
        ("negativa: sem a guarda das duas camadas (FR-048)", prova_negativa_sem_a_guarda_das_camadas),
        ("(virada) duas pernas na mesma passagem — viva -> lado novo", prova_virada_duas_pernas),
        ("(virada) fecho recusado -> a abertura NAO se envia", prova_virada_fecho_recusado_nao_abre),
        ("(virada) sem posicao viva -> recusa nomeada, ZERO envios", prova_virada_sem_posicao_recusa),
        ("negativa: virada recusada como antes (1.10.0)", prova_negativa_virada_recusada_como_antes),
    ]

    divergentes = 0
    for nome, prova in casos:
        globals()["_CASO"] = nome
        try:
            problemas = prova()
        except Exception as erro:  # noqa: BLE001 (um caso que levanta e' divergencia DELE)
            problemas = [f"a bancada levantou: {type(erro).__name__}: {erro}"]
        veredicto = "ok" if not problemas else "DIVERGE"
        if problemas:
            divergentes += 1
        print(json.dumps({"caso": nome, "veredicto": veredicto, "problemas": problemas}, ensure_ascii=False))

    # ---- A SAIDA CRUA de cada caso: a linha que saiu (ou o dito de que nao saiu), e o veredicto do CONTRATO ---
    for nome in _CRU:
        for at in _CRU[nome]:
            desfecho = _desfecho(at)
            if desfecho is None:
                print(json.dumps({"cru": nome, "linha": None, "diag": at.diag}, ensure_ascii=False))
            else:
                print(json.dumps({"cru": nome, "linha": desfecho["linha"], "contrato": _no_contrato(desfecho["linha"]).get("veredicto")}, ensure_ascii=False))

    # ---- (f) a assercao de que NADA foi ao venue, impressa ------------------------------------------------
    abrir = _ESPIAO["abrir"]
    grafo = _ESPIAO["build_graph"]
    connect = _ESPIAO["connect"]
    nenhuma_ligacao = abrir == 0 and grafo == 0 and connect == 0
    if not nenhuma_ligacao:
        divergentes += 1
    print(
        json.dumps(
            {
                "caso": "(f) assercao sem ligacao",
                "veredicto": "ok" if nenhuma_ligacao else "DIVERGE",
                "abrir_chamado": abrir,
                "build_graph_chamado": grafo,
                "connect_de_socket_chamado": connect,
                "nota": (
                    "abrir() (o fio + a autenticacao), build_graph() (o unico que constroi o transporte TCP "
                    "real) e socket.connect()/create_connection() espionados: tem de dar ZERO os tres"
                ),
            },
            ensure_ascii=False,
        )
    )

    # O RESUMO E' A ULTIMA LINHA DO `stdout` (05/10/2026): o portao da casa corre a bancada com `2>&1` e imprime
    # o `tail -1`; enquanto o resumo ia para `stderr`, a linha do portao era um `json` de caso, e o numero nao se
    # via. O resumo sai por ULTIMO, no `stdout`.
    print(f"ctrader/prova-envio: {len(casos) + 1} provas · {len(casos) + 1 - divergentes} ok · {divergentes} divergentes")
    _desarmar_espioes()
    return 1 if divergentes > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
