"""A PROVA DA LEITURA DO MERCADO da ponta cTrader — offline, com EVENTOS do venue INJECTADOS, SEM tocar no venue.

O QUE ESTA BANCADA MEDE. A LEITURA VIVA da ponta (US1 / `specs/005-conector-ctrader/data-model.md` §6 / RN-CT29):
a subscricao de spots e de profundidade que faltava (`transporte.seguir_o_mercado`), o ULTIMO RETRATO por
simbolo, e o que `processo.publicar_mercado` publica a partir dele — a COTACAO (`bid`/`ask`, um lado pode
faltar) e o LIVRO POR DELTAS quando ha' retrato, e a regua DECLARADA (a ultima vela fechada) quando nao ha'.

A INJECCAO E' A DO VENUE, nao um atalho. O `EventRouter` ORIGINAL da biblioteca e' quem converte o
`ProtoOA*Event` (o MESMO que a producao usa): injecta-se o proto cru pelo `on_event` do protocolo duplicado, a
biblioteca divide os precos por 100000 (`events/router.py:153-154`), e o tratador da ponta guarda o retrato. E'
por isso que a prova (a) pode mostrar o numero do VENUE antes e depois da divisao.

O QUE ESTA BANCADA ASSEGURA, e nao promete. NAO ha' ligacao nenhuma ao venue: `_grafo.market_data` e' um duplo
(as subscricoes sao no-op), o `_cliente` e' um embrulho do `EventEmitter` da biblioteca, e o `abrir()` nunca
corre. As leituras da conta/simbolo/velas sao canned — o passo a medir e' a LEITURA DO MERCADO.

A PROVA NEGATIVA (a regra da casa: uma bancada que nunca reprovou nao mediu nada). Duas: (1) com a DIVISAO
errada (`EXPOENTE_DO_PRECO` trocado) o caso (a) tem de ficar VERMELHO; (2) com o LADO AUSENTE a virar ZERO o
caso (c) tem de ficar VERMELHO. Sem esses vermelhos a bancada mede o duplo, nao a leitura.

O QUE ESTA BANCADA **NAO** MEDE, e di-lo: a subscricao a SERIO contra o venue (o duplo injecta os eventos —
nao ha' TCP, nem conta autorizada, nem confirmacao de que o venue aceita a subscricao). E o instante do spot e'
o do `ProtoOASpotEvent.timestamp` que a biblioteca carimba: se o venue o omitir, a biblioteca cai para
`datetime.now(UTC)` (`router.py:155`) e a idade medir-se-ia contra um carimbo NOSSO — fica por confirmar em
demonstracao.

Corre-se com:  cd brokers/ctrader && .venv/bin/python casos/prova-leitura.py     (rc=1 se algo divergir)
"""

from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import sys
from contextlib import redirect_stdout
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

AQUI = Path(__file__).resolve().parent
CONECTOR = AQUI.parent
RAIZ = CONECTOR.parent.parent


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
Le = sys.modules["leitura"]
framing = sys.modules["framing"]

#: O `EventRouter` ORIGINAL da biblioteca: o MESMO conversor que a producao tem. A bancada injecta o proto cru
#: pelo `on_event` do protocolo duplicado, e e' ele que divide os precos (nao ha' conversao propria na bancada).
from ctrader_api_client import DepthEvent, SpotEvent  # noqa: E402
from ctrader_api_client._internal.proto import (  # noqa: E402
    ProtoOADepthEvent,
    ProtoOADepthQuote,
    ProtoOASpotEvent,
)
from ctrader_api_client.events import EventEmitter  # noqa: E402
from ctrader_api_client.events.router import EventRouter  # noqa: E402

#: A identidade da conta de bancada (o `ctidTraderAccountId`); o `symbol_id` 42 e' o do EURUSD da bancada.
CTID = 45292558
SYMBOL_ID = 42
INSTRUMENTO = "EURUSD"

CONTA = {
    "conta": CTID,
    "saldo": 1000000,
    "expoente_dos_valores": 2,
    "alavancagem": 30,
    "tipo_de_conta": "NETTED",
    "direitos": "FULL_ACCESS",
}
SIMBOLO = {
    "symbol_id": SYMBOL_ID,
    "digitos": 5,
    "posicao_do_pip": 3,
    "minimo": 1000,
    "maximo": 10000000,
    "passo": 10,
    "modo_de_negociacao": "ENABLED",
}
UNIVERSO = [{"symbol_id": SYMBOL_ID, "nome": INSTRUMENTO, "habilitado": True, "descricao": "x", "deslistado": None}]
#: O fecho da ULTIMA VELA FECHADA (a regua declarada) — 109000/100000 = "1.09" quando o retrato nao existe.
FECHO_DA_VELA = Decimal("1.09")


def _agora_ms() -> int:
    """O NOSSO relogio (so' serve para conferir a idade publicada, nunca para carimbar o dado)."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _instante(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


# =============================================================================================================
# O DUPLO. O `protocolo` guarda os tratadores que o `EventRouter` regista (`on_event`) e serve os protos que a
# bancada injecta; o `_grafo` serve as subscricoes (no-op) e as leituras canned; o `_cliente` liga os tratadores
# da ponta ao `EventEmitter` ORIGINAL da biblioteca (o MESMO caminho da producao).
# =============================================================================================================


class RecoveryFalso:
    """O `AccountDisconnectHandler` do router (nao e' exercitado nesta bancada)."""

    async def handle_account_disconnect(self, account_id: int) -> None:
        return None


class ProtocoloFalso:
    def __init__(self) -> None:
        self._tratadores: dict[type, list[Any]] = {}

    def on_event(self, message_type: type, handler: Any) -> Any:
        self._tratadores.setdefault(message_type, []).append(handler)

        def dispose() -> None:
            self._tratadores[message_type].remove(handler)

        return dispose

    async def disparar(self, proto: Any) -> None:
        """Entrega um proto do VENUE aos tratadores registados (o router converte-o e emite o evento tipado)."""
        tratadores = self._tratadores.get(type(proto))
        if not tratadores:
            return
        for handler in list(tratadores):
            await handler(proto)


class ClienteFalso:
    """O `_cliente` do duplo: um `register_handler` que DELEGA no `EventEmitter` ORIGINAL da biblioteca."""

    def __init__(self, emissor: EventEmitter) -> None:
        self._emissor = emissor

    def register_handler(self, tipo: type, tratador: Any, *, account_id: int | None = None, symbol_id: int | None = None) -> None:
        self._emissor.subscribe(tipo, tratador, account_id=account_id, symbol_id=symbol_id)


class GrafoFalso:
    def __init__(self, protocolo: ProtocoloFalso) -> None:
        self.protocol = protocolo
        self.market_data = SimpleNamespace(subscribe_spots=self._subscrever, subscribe_depth=self._subscrever)

    async def _subscrever(self, *a: Any, **k: Any) -> None:
        return None  # a subscricao a SERIO nao se mede aqui: o duplo injecta os eventos (dito no cabecalho)


class TransporteDuplo(Tr.Transporte):
    """O transporte REAL (os verbos sao os dele), com o protocolo duplicado e as LEITURAS servidas."""

    def __init__(self, protocolo: ProtocoloFalso, *, velas: list[dict[str, Any]] | None = None) -> None:
        super().__init__(url_da_api="demo.ctraderapi.com:5035", client_id="duplo", client_secret="duplo")
        self.protocolo = protocolo
        self._grafo = GrafoFalso(protocolo)
        self.emissor = EventEmitter()
        self._cliente = ClienteFalso(self.emissor)  # type: ignore[assignment]
        #: O router ORIGINAL: os mesmos proto->evento da producao, para que a divisao do venue seja a DELE.
        self.router = EventRouter(protocolo, self.emissor, RecoveryFalso())
        self.router.start()
        self._velas = velas if velas is not None else [
            {"fecho": FECHO_DA_VELA, "instante_ms": _agora_ms() - 3000}
        ]

    def conta_autorizada(self, account_id: int) -> bool:
        return True

    def trader(self, account_id: int) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=dict(CONTA))

    def simbolos(self, account_id: int) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=[dict(u) for u in UNIVERSO])

    def simbolos_por_id(self, account_id: int, ids: list[int]) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=[dict(SIMBOLO)])

    def posicoes(self, account_id: int) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=[])

    def ordens_vivas(self, account_id: int) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=[])

    def nao_realizado(self, account_id: int) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=[])

    def velas(self, account_id: int, symbol_id: int, periodo: str, de: Any, ate: Any) -> Tr.Resultado:
        return Tr.Resultado(ok=True, valor=[dict(v) for v in self._velas])


FICHA = SimpleNamespace(ctid_trader_account_id=CTID, instrumentos=[INSTRUMENTO], conector="ctrader")


def _arranque(transporte: Tr.Transporte) -> Any:
    return proc.Arranque(
        ok=True,
        ficha=FICHA,
        credencial=None,
        transporte=transporte,
        manifesto=None,
        direitos_da_conta="FULL_ACCESS",
        so_fecha=False,
        prazo_do_venue_ms=3000,
    )


def _novo(**kwargs: Any) -> TransporteDuplo:
    protocolo = ProtocoloFalso()
    transporte = TransporteDuplo(protocolo, **kwargs)
    resultado = transporte.seguir_o_mercado(CTID, [SYMBOL_ID])
    if not resultado.ok:
        raise AssertionError(f"`seguir_o_mercado` falhou: {resultado.motivo}: {resultado.porque}")
    return transporte


def _injectar(transporte: TransporteDuplo, proto: Any) -> None:
    """Entrega o proto do venue pelo MESMO caminho que a producao usa (router -> emitter -> tratador)."""
    asyncio.run(transporte.protocolo.disparar(proto))


def _publicar(transporte: TransporteDuplo, instrumento: str = INSTRUMENTO) -> tuple[str, list[dict[str, Any]]]:
    """Corre o `publicar_mercado` REAL e devolve a LINHA CRUA que saiu na costura e o diagnostico dele."""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        diags = proc.publicar_mercado(_arranque(transporte), instrumento)
    saida = buffer.getvalue().strip()
    linha = saida.splitlines()[-1] if saida else ""
    return linha, diags


def _conferir(linha: str) -> tuple[dict[str, Any] | None, dict[str, Any], list[str]]:
    """A linha CRUA e o veredicto do CONTRATO; devolve (carga, veredicto, problemas-de-contrato)."""
    if not linha:
        return None, {}, ["nao saiu linha nenhuma na costura"]
    veredicto = framing.validar(linha)
    if veredicto.get("veredicto") != "aceite":
        return None, veredicto, [f"o CONTRATO recusou a linha: {veredicto.get('motivo')}"]
    return json.loads(linha).get("carga"), veredicto, []


def _campo(mapa: Any, chave: str) -> Any:
    """O valor da chave QUANDO o mapa tem forma de dicionario; senao `None`. Substitui o `x or {}` do `or` —
    a catraca de fallbacks da casa proibe o valor literal por omissao, e aqui a ausencia NOMEIA-se."""
    if isinstance(mapa, dict):
        return mapa.get(chave)
    return None


def _anunciar(caso: str, linha: str, veredicto: dict[str, Any], problemas: list[str]) -> None:
    estado = veredicto.get("veredicto")
    if not isinstance(estado, str):
        estado = "nao_conferida"  # nomeado: a linha nao chegou a ser conferida
    texto_da_linha = linha
    if not texto_da_linha:
        texto_da_linha = "(nenhuma)"
    resultado = "DIVERGE" if problemas else "ok"
    print(
        json.dumps(
            {
                "caso": caso,
                "linha_mercado": texto_da_linha,
                "contrato": estado,
                "veredicto": resultado,
                "problemas": problemas,
            },
            ensure_ascii=False,
        )
    )


# =============================================================================================================
# (a) UM EVENTO DE SPOT -> a linha sai com bid/ask, passa o CONTRATO, com o instante do VENUE e a divisao certa.
# =============================================================================================================


def caso_a_spot() -> list[str]:
    """O numero do venue ANTES e DEPOIS da divisao: 125000 -> "1.25", 125001 -> "1.25001"."""
    instante = _agora_ms() - 1500
    transporte = _novo()
    # O PROTO CRU do venue: `bid`/`ask` em inteiros relativos (125000 = 1,25). O router da biblioteca divide-os.
    proto = ProtoOASpotEvent(ctid_trader_account_id=CTID, symbol_id=SYMBOL_ID, bid=125000, ask=125001, timestamp=instante)
    _injectar(transporte, proto)
    linha, diags = _publicar(transporte)
    carga, veredicto, problemas = _conferir(linha)
    if carga is not None:
        if carga.get("bid") != "1.25":
            problemas.append(f"a) `bid`: esperado '1.25' (125000 do venue /100000), veio {carga.get('bid')!r}")
        if carga.get("ask") != "1.25001":
            problemas.append(f"a) `ask`: esperado '1.25001' (125001 do venue /100000), veio {carga.get('ask')!r}")
        if "ultimo" in carga:
            problemas.append("a) o retrato NAO devia publicar `ultimo`: a cotacao substitui a vela")
        if carga.get("tempo_do_venue_ms") != instante:
            problemas.append(f"a) instante do venue: esperado {instante}, veio {carga.get('tempo_do_venue_ms')!r}")
        if carga.get("estado") != "aberto":
            problemas.append(f"a) estado do mercado veio {carga.get('estado')!r}")
    regua = diags[0].get("regua") if diags else None
    if regua != "retrato do venue (spots)":
        problemas.append(f"a) a regua declarada devia ser o retrato do venue, veio {regua!r}")
    print(json.dumps({"caso": "leitura/a-venue-antes", "venue_bid": 125000, "venue_ask": 125001}, ensure_ascii=False))
    _anunciar("leitura/a-spot-bid-ask-e-divisao", linha, veredicto, problemas)
    return problemas


# =============================================================================================================
# (b) O LIVRO POR DELTAS: acrescentar niveis, apagar niveis — e a remocao de um id que NAO existe nao inventa.
# =============================================================================================================


def _cota(identificador: int, *, bid: int | None = None, ask: int | None = None, size: int) -> ProtoOADepthQuote:
    # O proto exige um inteiro no campo que nao veio; o lado que a bancada nao declara escreve-se 0 no PROTO (o
    # venue manda assim o lado ausente), e a biblioteca da'-lo como ausente na cotacao.
    return ProtoOADepthQuote(
        id=identificador,
        size=size,
        bid=0 if bid is None else bid,
        ask=0 if ask is None else ask,
    )


def caso_b_livro_por_deltas() -> list[str]:
    instante = _agora_ms() - 1200
    transporte = _novo()
    # O retrato precisa de um INSTANTE do venue: o spot ancora-o (a profundidade nao traz tempo).
    _injectar(
        transporte,
        ProtoOASpotEvent(ctid_trader_account_id=CTID, symbol_id=SYMBOL_ID, bid=108541, ask=108543, timestamp=instante),
    )
    problemas: list[str] = []

    # 1) ACRESCENTAR dois niveis.
    _injectar(
        transporte,
        ProtoOADepthEvent(
            ctid_trader_account_id=CTID,
            symbol_id=SYMBOL_ID,
            new_quotes=[_cota(1, bid=108541, size=1200000), _cota(2, bid=108540, size=800000)],
        ),
    )
    linha1, _ = _publicar(transporte)
    carga1, _, p1 = _conferir(linha1)
    problemas += p1
    # O tamanho do livro e' centesimos: 1200000/100 = "12000"; o preco e' /100000: 108541 -> "1.08541".
    if carga1 is not None:
        lados = _campo(_campo(carga1, "livro"), "lados")
        profundidade = _campo(_campo(carga1, "livro"), "profundidade")
        esperado = [{"preco": "1.08541", "tamanho": "12000"}, {"preco": "1.0854", "tamanho": "8000"}]
        if lados != esperado:
            problemas.append(f"b) apos acrescentar 2 niveis, lados esperados {esperado}, veio {lados!r}")
        if profundidade != 2:
            problemas.append(f"b) profundidade esperada 2, veio {profundidade!r}")

    # 2) APAGAR o id=1 e ACRESCENTAR o id=3.
    _injectar(
        transporte,
        ProtoOADepthEvent(
            ctid_trader_account_id=CTID,
            symbol_id=SYMBOL_ID,
            new_quotes=[_cota(3, ask=108545, size=500000)],
            deleted_quotes=[1],
        ),
    )
    linha2, _ = _publicar(transporte)
    carga2, _, p2 = _conferir(linha2)
    problemas += p2
    if carga2 is not None:
        lados = _campo(_campo(carga2, "livro"), "lados")
        esperado = [{"preco": "1.0854", "tamanho": "8000"}, {"preco": "1.08545", "tamanho": "5000"}]
        if lados != esperado:
            problemas.append(f"b) apos apagar o id=1 e acrescentar o id=3, lados esperados {esperado}, veio {lados!r}")

    # 3) O CONTROLE: apagar um id que NAO existe nao inventa nem remove nada.
    _injectar(
        transporte,
        ProtoOADepthEvent(ctid_trader_account_id=CTID, symbol_id=SYMBOL_ID, new_quotes=[], deleted_quotes=[99]),
    )
    linha3, _ = _publicar(transporte)
    carga3, _, p3 = _conferir(linha3)
    problemas += p3
    if carga3 is not None:
        lados = _campo(_campo(carga3, "livro"), "lados")
        if lados != [{"preco": "1.0854", "tamanho": "8000"}, {"preco": "1.08545", "tamanho": "5000"}]:
            problemas.append(f"b) apagar um id inexistente mudou o livro: veio {lados!r}")
        if _campo(_campo(carga3, "livro"), "profundidade") != 2:
            problemas.append("b) apagar um id inexistente mudou a profundidade")

    _anunciar("leitura/b-livro-por-deltas", linha3, framing.validar(linha3) if linha3 else {}, problemas)
    # A SEQUENCIA CRUA, para a prova mostrar os tres retratos publicados (acrescentar -> apagar+acrescentar -> o
    # controle). Nao e' descricao: sao as linhas que sairam na costura, pela ordem em que sairam.
    print(json.dumps({"caso": "leitura/b-sequencia", "linhas": [linha1, linha2, linha3]}, ensure_ascii=False))
    return problemas


# =============================================================================================================
# (c) UM LADO SO': o lado que faltou fica AUSENTE (a chave nao entra) — nunca zero — e o CONTRATO aceita.
# =============================================================================================================


def _um_lado(somente: str) -> list[str]:
    instante = _agora_ms() - 900
    transporte = _novo()
    campos: dict[str, Any] = {"ctid_trader_account_id": CTID, "symbol_id": SYMBOL_ID, "timestamp": instante}
    if somente == "bid":
        campos["bid"] = 125000  # so' bid: o ask fica a zero no proto -> a biblioteca da' None
    else:
        campos["ask"] = 125003
    _injectar(transporte, ProtoOASpotEvent(**campos))
    linha, _ = _publicar(transporte)
    carga, veredicto, problemas = _conferir(linha)
    faltou = "ask" if somente == "bid" else "bid"
    presente = somente
    retrato = transporte.retrato_do_mercado(SYMBOL_ID)
    if carga is not None:
        if presente not in carga:
            problemas.append(f"c) o lado presente ({presente}) nao saiu na linha: {carga!r}")
        if faltou in carga:
            problemas.append(f"c) o lado que faltou ({faltou}) veio na linha com valor {carga.get(faltou)!r} — um lado ausente NUNCA vira zero")
    # A REGRA MEDE-SE NO RETRATO TAMBEM: o lado que faltou e' `None`, nunca `0`.
    if retrato is None:
        problemas.append("c) nao ha' retrato nenhum guardado")
    elif retrato.get(faltou) is not None:
        problemas.append(f"c) no retrato, o lado que faltou ({faltou}) devia ser `None`, veio {retrato.get(faltou)!r} (um zero seria um lado inventado)")
    _anunciar(f"leitura/c-so-{somente}", linha, veredicto, problemas)
    return problemas


def caso_c_um_lado() -> list[str]:
    return _um_lado("bid") + _um_lado("ask")


# =============================================================================================================
# (d) SEM RETRATO NENHUM -> publica a REGUA DECLARADA (a ultima vela fechada), e a linha di-lo.
# =============================================================================================================


def caso_d_sem_retrato() -> list[str]:
    transporte = _novo()  # nenhum evento injectado: nao ha' retrato
    linha, diags = _publicar(transporte)
    carga, veredicto, problemas = _conferir(linha)
    if carga is not None:
        if carga.get("ultimo") != "1.09":
            problemas.append(f"d) `ultimo` da vela: esperado '1.09' (109000/100000), veio {carga.get('ultimo')!r}")
        if "bid" in carga or "ask" in carga:
            problemas.append("d) sem retrato NAO pode sair `bid`/`ask`: saiu a vela, e a vela e' `ultimo`")
    regua = diags[0].get("regua") if diags else None
    if regua != "ultima vela fechada":
        problemas.append(f"d) a regua declarada devia dizer a ultima vela fechada, veio {regua!r}")
    if transporte.retrato_do_mercado(SYMBOL_ID) is not None:
        problemas.append("d) nao devia haver retrato nenhum guardado")
    _anunciar("leitura/d-sem-retrato-a-regua-declarada", linha, veredicto, problemas)
    return problemas


# =============================================================================================================
# A IDADE VEM DO INSTANTE DO VENUE (nunca do relogio local): com um instante mais ANTIGO, a idade cresce.
# =============================================================================================================


def caso_idade_do_venue() -> list[str]:
    transporte = _novo()
    agora = _agora_ms()
    _injectar(
        transporte,
        ProtoOASpotEvent(ctid_trader_account_id=CTID, symbol_id=SYMBOL_ID, bid=125000, ask=125001, timestamp=agora - 65000),
    )
    linha_velha, _ = _publicar(transporte)
    carga_velha, _, p1 = _conferir(linha_velha)
    _injectar(
        transporte,
        ProtoOASpotEvent(ctid_trader_account_id=CTID, symbol_id=SYMBOL_ID, bid=125000, ask=125001, timestamp=agora - 5000),
    )
    linha_nova, _ = _publicar(transporte)
    carga_nova, _, p2 = _conferir(linha_nova)
    problemas = p1 + p2
    if carga_velha is not None and carga_nova is not None:
        idade_velha = carga_velha.get("idade_do_dado_ms")
        idade_nova = carga_nova.get("idade_do_dado_ms")
        if not isinstance(idade_velha, int) or not isinstance(idade_nova, int):
            problemas.append(f"idade ausente/ilegivel: velha={idade_velha!r}, nova={idade_nova!r}")
        else:
            # 65 s atras vs 5 s atras: a diferenca tem de ser ~60 s (o relogio real avanca so' um pouco na corrida).
            diferenca = idade_velha - idade_nova
            if not (58000 <= diferenca <= 62000):
                problemas.append(f"a idade nao seguiu o instante do venue: velha={idade_velha}, nova={idade_nova}, diferenca={diferenca}")
            if idade_velha < 60000:
                problemas.append(f"a idade do retrato velho ({idade_velha}) devia ser > 60000 ms")
    _anunciar("leitura/idade-vem-do-instante-do-venue", linha_nova, framing.validar(linha_nova) if linha_nova else {}, problemas)
    return problemas


# =============================================================================================================
# AS NEGATIVAS: injecta-se o DEFEITO e a MESMA medicao tem de ficar VERMELHA a NOMEAR o caso.
# =============================================================================================================


def negativa_divisao_errada() -> list[str]:
    """A DIVISAO errada (`/1000` em vez de `/100000`): o caso (a) tem de ficar VERMELHO."""
    original = Le.EXPOENTE_DO_PRECO
    Le.EXPOENTE_DO_PRECO = 3  # o defeito: 125000/1000 = "125" (a divisao do venue e' por 100000)
    try:
        problemas_do_caso = caso_a_spot()
    finally:
        Le.EXPOENTE_DO_PRECO = original
    print(
        json.dumps(
            {
                "negativa": "divisao-errada",
                "o_caso_a_ficou": "VERMELHO" if problemas_do_caso else "VERDE",
                "primeiro_problema": problemas_do_caso[0] if problemas_do_caso else None,
            },
            ensure_ascii=False,
        )
    )
    if not problemas_do_caso:
        return ["com a divisao errada o caso (a) continuou VERDE: a bancada nao mede a divisao do venue"]
    return []


def negativa_lado_ausente_vira_zero() -> list[str]:
    """O LADO AUSENTE a virar ZERO: a esteira do tratador passa a devolver 0 em vez de `None`; o caso (c) VERMELHO."""
    original = Tr._escalado_do_preco  # noqa: SLF001 (e' a fronteira que a bancada injecta)

    def _zero(valor: Any) -> int | None:
        return 0 if valor is None else original(valor)

    Tr._escalado_do_preco = _zero  # type: ignore[assignment]
    try:
        problemas_do_caso = caso_c_um_lado()
    finally:
        Tr._escalado_do_preco = original  # type: ignore[assignment]
    print(
        json.dumps(
            {
                "negativa": "lado-ausente-vira-zero",
                "o_caso_c_ficou": "VERMELHO" if problemas_do_caso else "VERDE",
                "primeiro_problema": problemas_do_caso[0] if problemas_do_caso else None,
            },
            ensure_ascii=False,
        )
    )
    if not problemas_do_caso:
        return ["com o lado ausente a virar zero o caso (c) continuou VERDE: a bancada nao mede a ausencia"]
    return []


CASOS: list[tuple[str, Any]] = [
    ("leitura/a-spot-bid-ask-e-divisao", caso_a_spot),
    ("leitura/b-livro-por-deltas", caso_b_livro_por_deltas),
    ("leitura/c-um-lado-so-ausente-nunca-zero", caso_c_um_lado),
    ("leitura/d-sem-retrato-a-regua-declarada", caso_d_sem_retrato),
    ("leitura/idade-vem-do-instante-do-venue", caso_idade_do_venue),
    ("negativa/divisao-errada-o-caso-a-fica-vermelho", negativa_divisao_errada),
    ("negativa/lado-ausente-vira-zero-o-caso-c-fica-vermelho", negativa_lado_ausente_vira_zero),
]


def main() -> int:
    divergentes = 0
    for nome, prova in CASOS:
        try:
            problemas = prova()
        except Exception as erro:  # noqa: BLE001  (um caso que levanta e' divergencia DELE)
            problemas = [f"a bancada levantou: {type(erro).__name__}: {erro}"]
            print(json.dumps({"caso": nome, "veredicto": "DIVERGE", "problemas": problemas}, ensure_ascii=False))
        if problemas:
            divergentes += 1
    # A ULTIMA LINHA DO `stdout` E' O RESUMO: o portao da casa imprime o `tail -1`, e e' este numero que aparece.
    print(f"ctrader/prova-leitura: {len(CASOS)} provas · {len(CASOS) - divergentes} ok · {divergentes} divergentes")
    return 1 if divergentes > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
