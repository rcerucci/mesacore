"""O TRANSPORTE do conector cTrader — a biblioteca embrulhada, e a fronteira intacta.

A DECISAO D2, em codigo: a biblioteca (`ctrader-api-client`, versao FIXADA) faz o transporte — TCP/TLS,
protobuf, sessao, heartbeat, reconexao com restauro de subscricoes, OAuth com refresh — e nada mais. Nenhum
tipo dela atravessa esta fronteira: tudo o que sai daqui sao DICIONARIOS SIMPLES com os nomes do contrato. Quem
precisa de saber que existe uma biblioteca e' este ficheiro, e so' este.

AS DUAS CAMADAS. O venue tem o transporte (o fio, vivo) e a sessao da conta (autorizada) como coisas
diferentes, e o conector so' envia quando as duas estao prontas (FR-048). Aqui isso quer dizer:
`abrir()` poe o fio de pe' e autentica a APLICACAO; `autorizar_conta()` autentica A CONTA. Sao dois passos, e a
porta da ligacao confere os dois.

A ROTACAO DO TOKEN E' UM ACONTECIMENTO, NAO UM DETALHE (RN-CT10). O venue ROda o par quando refresca, e
invalida o anterior. A biblioteca chama `TokenStore.save()` quando isso acontece — e' por essa porta que os dois
ficheiros `.key` dos tokens sao REESCRITOS, com o dono a ter posto la' os valores a mao. O segredo da aplicacao
(`client_id`/`client_secret`) nunca e' tocado por aqui: ele nao roda.

O `expires_at` DAS CREDENCIAIS: o prazo que o venue declarou na ULTIMA rotacao, quando ele ficou gravado no
`.key` derivado do access token (`ctrader_mesa_expira_em.key`, ao lado dos outros, modo 600). Presente e no
futuro, o `establish` NAO refresca — e' isso que evita rodar o par em cada arranque. Ausente ou ja' passado,
passa-se o prazo tal como esta' (ou `0.0`), e o `establish` refresca e RODA o par: o comportamento automatico
continua a funcionar, e e' por ele que a rotacao se ve' a acontecer. [FECHADO A-9 a 05/10/2026: antes o caminho
do `expira_em` nunca chegava ao `GuardaDeTokens`, o prazo era `0.0` PARA SEMPRE, e o par rodava em CADA
ligacao — medido nos mtimes dos dois tokens: 10:08:02 e 10:08:31, uma rotacao por corrida.]
"""

from __future__ import annotations

import asyncio
import threading
import time
from collections import deque
from collections.abc import Awaitable
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable

from ctrader_api_client import (
    AccountCredentials,
    AuthTrigger,
    ClientConfig,
    CTraderClient,
    DepthEvent,
    SpotEvent,
    TokenStore,
)
from ctrader_api_client._internal.proto import (
    ProtoOAExecutionEvent,
    ProtoOAExecutionType,
    ProtoOAOrderErrorEvent,
    ProtoOAOrderStatus,
    ProtoOAOrderType,
    ProtoOADealStatus,
    ProtoOATradeSide,
    ProtoOATraderReq,
    ProtoOATraderRes,
)
from ctrader_api_client.composition import build_graph
from ctrader_api_client.enums import OrderSide, OrderType, TimeInForce, TradingMode
from ctrader_api_client.models.requests import ClosePositionRequest, NewOrderRequest

import betterproto

#: Quando a biblioteca nao tem prazo declarado, o pedido espera por este tempo. E' um VALOR DECLARADO do
#: conector (a ficha nao o traz ainda; entra na proxima fatia com chave propria, research R9).
PRAZO_DE_PEDIDO_POR_OMISSAO_S = 15.0

#: A unidade dos PRECOS do venue: inteiros em 1/100000 (data-model §0). O protobuf da biblioteca viaja o preco
#: como duplo em unidades de preco, e o dicionario do contrato viaja-o em inteiros relativos — a conversao
#: vive AQUI, num so' sitio, e so' na fronteira.
ESCALA_DO_PRECO = 100000

#: O RITMO DO VENUE (RN-CT2, FR-071). O venue impoe DUAS classes de tecto: 50 pedidos/s para os dados NAO
#: historicos e 5 pedidos/s para os HISTORICOS (as velas). O limite e' aplicado por ESPACAMENTO MINIMO entre
#: pedidos (1/50 = 0,02 s e 1/5 = 0,2 s): e' o mais conservador dos desenhos possiveis — nenhuma janela de 1 s
#: chega a cair ACIMA do tecto, e o intervalo minimo fica LEGIVEL na prova. A espera e' ESTADO DECLARADO
#: (`Transporte.estado_de_ritmo()`), nunca um «sem dados» silencioso: quem espera chega ao venue e e' servido —
#: esta casa ja' pagou 253x `429 Too Many Requests` no outro venue por falar no relogio da volta
#: (`docs/ONDE_ESTAMOS.md` §0, medido 05/10/2026).
RITMO_GERAL_POR_SEGUNDO = 50
RITMO_HISTORICO_POR_SEGUNDO = 5

#: O PASSO da espera pelo PREENCHIMENTO (D6). O `send_request` de uma ordem devolve, neste venue, o
#: `ORDER_ACCEPTED` — a ordem existe mas SEM os numeros do preenchimento — e o preenchimento chega DEPOIS, por
#: EVENTO PROPRIO. Quem espera pelo numero do venue nao pode ficar a girar: dorme este passo entre leituras do
#: registo de execucoes, ate' ao prazo declarado. E' curto para nao atrasar um preenchimento que ja' chegou, e
#: nao e' zero para nao queimar nucleo. (Medido na demonstracao a 05/10/2026: o preenchimento chega a seguir ao
#: aceite, dentro do prazo de 3 s.)
PASSO_DA_ESPERA_DO_PREENCHIMENTO_S = 0.02

#: Quantas execucoes EMPURRADAS pelo venue se guardam. O registo existe para SEGUIR o preenchimento de uma ordem
#: que acabou de ser enviada; um tecto impede que um processo de dias o deixe crescer sem fim. As mais antigas
#: caem — e o que se segue e' sempre a ULTIMA, o preenchimento (a ordem -> negocio), do instante.
MAXIMO_DE_EXECUCOES_GUARDADAS = 500

#: O eixo «Sessao da conta» (FR-070/US6), LEGIVEL POR NOME — os TRES estados que a sua maquina declara. O venue
#: di'-lo por EVENTO (roda o token, revoga-o, ou derruba a conta) e a biblioteca re-autentica SOZINHA; este
#: conector so' OBSERVA o evento e guarda o nome. Os mesmos nomes da maquina de estados do conector.
SESSAO_NAO_AUTORIZADA = "nao_autorizada"
SESSAO_AUTORIZADA = "autorizada"
SESSAO_INVALIDADA = "invalidada"

#: Os pedidos da biblioteca sao os modelos `NewOrderRequest`/`ClosePositionRequest`; o vocabulario do venue
#: (`BUY`/`SELL`, `MARKET_RANGE`, `IOC`) -> os ENUM da biblioteca. Conjuntos FECHADOS: um nome que nao esteja
#: aqui e' RECUSA, nunca um `get` com omissao (um tipo a mais seria uma ordem com outro numero).
LADO_POR_NOME = {"BUY": OrderSide.BUY, "SELL": OrderSide.SELL}
TIPO_POR_NOME = {
    "MARKET": OrderType.MARKET,
    "LIMIT": OrderType.LIMIT,
    "STOP": OrderType.STOP,
    "STOP_LIMIT": OrderType.STOP_LIMIT,
    "MARKET_RANGE": OrderType.MARKET_RANGE,
}
TIF_POR_NOME = {
    "FOK": TimeInForce.FILL_OR_KILL,
    "IOC": TimeInForce.IMMEDIATE_OR_CANCEL,
    "GTC": TimeInForce.GOOD_TILL_CANCEL,
}


def separar_endereco(url: str) -> tuple[str, int]:
    """`demo.ctraderapi.com:5035` -> (`demo.ctraderapi.com`, 5035). Sem porta, recusa — nao se adivinha."""
    if ":" not in url:
        raise ValueError(f"o endereco da ficha nao traz porta: {url!r}")
    hospedeiro, _, porta = url.rpartition(":")
    if not hospedeiro or not porta.isdigit():
        raise ValueError(f"o endereco da ficha nao tem forma `endereco:porta`: {url!r}")
    return hospedeiro, int(porta)


class GuardaDeTokens(TokenStore):
    """A porta por onde o venue REESCREVE os tokens, e a unica coisa que este conector escreve num ficheiro.

    O dono escreveu os quatro valores a mao. Quando o venue roda o par, isto grava os DOIS tokens — e o prazo
    que ele declara (`expires_at`), que e' o que evita um refresh novo em cada arranque. Os valores nunca passam
    por um log: o que se diz e' que houve rotacao, e de que ficheiro.

    O CAMINHO DO `expira_em` CHEGA AQUI DESDE 05/10/2026 (A-9). Ate' entao so' entravam as quatro chaves que a
    ficha declara, e `"expira_em" in self._caminhos` era FALSO para sempre: o ramo abaixo nunca escrevia, e o
    prazo nunca se gravava. Quem o acrescenta e' `_caminhos_da_credencial` (`processo.py`), derivando-o do
    access token.

    O `save` da biblioteca e' ASSINCRONO e e' chamado durante o refresh, antes de o token novo ser usado; uma
    excepcao aqui aborta o refresh (e o cliente volta a tentar na proxima verificacao) — por isso NAO se engole
    um erro de escrita: um par de tokens que nao se consegue guardar nao serve para nada.
    """

    def __init__(self, caminhos: dict[str, Path]) -> None:
        self._caminhos = caminhos
        self.rotacoes = 0

    async def save(self, credentials: AccountCredentials) -> None:
        self._caminhos["access_token"].write_text(credentials.access_token, encoding="utf-8")
        self._caminhos["refresh_token"].write_text(credentials.refresh_token, encoding="utf-8")
        if "expira_em" in self._caminhos:
            self._caminhos["expira_em"].write_text(str(credentials.expires_at), encoding="utf-8")
            self._caminhos["expira_em"].chmod(0o600)
        for caminho in (self._caminhos["access_token"], self._caminhos["refresh_token"]):
            caminho.chmod(0o600)
        self.rotacoes += 1


class _Laco:
    """Um laco asyncio num fio proprio: a biblioteca e' assincrona e a costura do conector e' sincrona.

    A costura le' uma linha e responde — nao pode ser ela a esperar por um `await`. O laco vive no fio, e cada
    pedido atravessa-o com `run_coroutine_threadsafe`, que devolve o resultado como se fosse sincrono.
    """

    def __init__(self) -> None:
        self._laco = asyncio.new_event_loop()
        self._fio = threading.Thread(target=self._laco.run_forever, daemon=True, name="ctrader-laco")
        self._fio.start()

    def rodar(self, coro: Any, prazo: float = PRAZO_DE_PEDIDO_POR_OMISSAO_S) -> Any:
        futuro = asyncio.run_coroutine_threadsafe(coro, self._laco)
        return futuro.result(timeout=prazo)

    def parar(self) -> None:
        self._laco.call_soon_threadsafe(self._laco.stop)
        self._fio.join(timeout=5)


@dataclass(frozen=True)
class Resultado:
    ok: bool
    valor: Any = None
    motivo: str | None = None
    porque: str = ""


def _falhou(motivo: str, porque: str) -> Resultado:
    return Resultado(ok=False, motivo=motivo, porque=porque)


class LimitadorDeRitmo:
    """O tecto de pedidos/s de UMA classe do venue (geral ou historica) — RN-CT2 / FR-071.

    O RELOGIO E' INJECTAVEL, e e' isso que torna a prova possivel SEM tocar no venue e SEM esperar em tempo
    real: em producao `agora`/`dormir` sao `time.monotonic`/`time.sleep` (os reais); a bancada passa um relogio
    falso, mede os intervalos no relogio injectado, e o venue nunca e' martelado para descobrir o limite.

    O DESENHO (05/10/2026): ESPACAMENTO MINIMO entre pedidos (`1/maximo` segundos). E' o mais conservador dos
    dois desenhos obvios (o outro seria uma janela deslizante que deixa rajadas de `maximo` de uma so' vez): com
    o espacamento, nenhuma janela de 1 s cai ACIMA do tecto e o INTERVALO MINIMO entre dois pedidos fica um
    numero legivel — que e' o que a prova mede.

    «ESPERAR» NUNCA VIRA «SEM DADOS». Este objecto so' atrasa o pedido; nao toca no que o venue responde. Quem
    esperou chega ao venue e e' SERVIDO (ou recebe a recusa NOMEADA do caminho real, nao um vazio silencioso).
    A espera e' ESTADO DECLARADO — le-se' em `estado()` (`esperas`, `ultima_espera_s`), e nao se adivinha.
    """

    def __init__(
        self,
        maximo_por_segundo: int,
        *,
        agora: Callable[[], float] = time.monotonic,
        dormir: Callable[[float], None] = time.sleep,
    ) -> None:
        if maximo_por_segundo <= 0:
            raise ValueError(f"o tecto de ritmo tem de ser positivo (veio {maximo_por_segundo!r})")
        self.maximo_por_segundo = maximo_por_segundo
        self.intervalo_minimo_s = 1.0 / maximo_por_segundo
        self._agora = agora
        self._dormir = dormir
        #: O `agora` do ULTIMO pedido ja' reservado — o espacamento mede-se a partir daqui.
        self.ultimo_pedido_s: float | None = None
        #: O ESTADO DECLARADO da espera (FR-071): quantos pedidos, quantas vezes se esperou, e a ultima espera.
        self.pedidos = 0
        self.esperas = 0
        self.ultima_espera_s = 0.0

    def esperar(self) -> float:
        """Reserva um lugar respeitando o intervalo minimo; devolve o `agora` (pos-espera) do pedido."""
        agora = self._agora()
        if self.ultimo_pedido_s is not None:
            alvo = self.ultimo_pedido_s + self.intervalo_minimo_s
            if agora < alvo:
                espera = alvo - agora
                # A ESPERA DECLARA-SE ANTES DE ACONTECER: fica registada no estado lido por `estado()`.
                self.esperas += 1
                self.ultima_espera_s = espera
                self._dormir(espera)
                agora = self._agora()
        self.pedidos += 1
        self.ultimo_pedido_s = agora
        return agora

    def estado(self) -> dict[str, Any]:
        """O estado legivel deste limitador: o tecto, o intervalo minimo e a ESPERA (pedidos/esferas/ultima)."""
        return {
            "maximo_por_segundo": self.maximo_por_segundo,
            "intervalo_minimo_s": self.intervalo_minimo_s,
            "pedidos": self.pedidos,
            "esperas": self.esperas,
            "ultima_espera_s": self.ultima_espera_s,
        }


class Transporte:
    """O fio e a sessao da conta. Um por (corretora, conta), como manda o RN-C16."""

    def __init__(
        self,
        url_da_api: str,
        client_id: str,
        client_secret: str,
        *,
        agora: Callable[[], float] = time.monotonic,
        dormir: Callable[[float], None] = time.sleep,
    ) -> None:
        # O RELOGIO E' INJECTAVEL (FR-071): em producao e' o REAL (`time.monotonic`/`time.sleep`), e a prova
        # offline passa um relogio falso para medir o ritmo SEM esperar em tempo real e SEM tocar no venue.
        self._relogio_injectado = agora is not time.monotonic or dormir is not time.sleep
        self._ritmo = {
            "geral": LimitadorDeRitmo(RITMO_GERAL_POR_SEGUNDO, agora=agora, dormir=dormir),
            "historico": LimitadorDeRitmo(RITMO_HISTORICO_POR_SEGUNDO, agora=agora, dormir=dormir),
        }
        hospedeiro, porta = separar_endereco(url_da_api)
        self._config = ClientConfig(
            host=hospedeiro,
            port=porta,
            use_ssl=True,
            client_id=client_id,
            client_secret=client_secret,
        )
        self._laco = _Laco()
        self._cliente: CTraderClient | None = None
        self._grafo: Any = None
        self.guarda: GuardaDeTokens | None = None
        self.app_autenticada = False
        #: O eixo «Sessao da conta» (FR-070). As contas cujo token foi INVALIDADO por EVENTO do venue (roda,
        #: revoga, kick) e que ainda nao recuperaram. Enquanto a conta aqui estiver, NENHUMA ordem nova sai — e o
        #: FECHO tambem nao: uma sessao caida nao serve pedido nenhum. A biblioteca re-autentica sozinha; nos so'
        #: observamos o evento e guardamos o nome do estado (`estado_da_sessao`).
        self._sessoes_invalidadas: set[int] = set()
        #: As contas RECUPERADAS cuja CONTA ainda nao foi RELIDA (US6 cenario 2): depois de a biblioteca
        #: re-autenticar, a PRIMEIRA coisa e' LER a conta. Marca-se no evento de recuperacao; a leitura tira-a.
        self._releitura_pendente: set[int] = set()
        #: Contadores LEGIVEIS da sessao (para a prova mostrar, nunca para decidir): quantas invalidacoes se viram,
        #: quantas recuperacoes, quantas releituras da conta se confirmaram.
        self.contas_da_sessao = {"invalidadas": 0, "recuperadas": 0, "releituras": 0}
        #: A conta cuja sessao esta' a ser SEGUIDA (`seguir_a_sessao_da_conta`) — e' por ela que um `kick` ao
        #: CLIENTE (que nao nomeia conta) sabe que conta marcar. `None` ate' o arranque a seguir.
        self._conta_da_sessao: int | None = None
        #: O ULTIMO RETRATO de mercado POR SIMBOLO (US1 / data-model §6 / RN-CT29): o que os eventos de SPOT
        #: (`bid`/`ask`) e de PROFUNDIDADE (o livro por deltas) deixaram. Vive na memoria do processo (morre com
        #: ele, como a pendencia do FR-068) e guarda os INTEIROS RELATIVOS do contrato — a divisao do venue
        #: (`/100000` nos precos, `/100` nos tamanhos) fica na parte PURA (`leitura.py`), num so' caminho.
        self._retratos: dict[int, dict[str, Any]] = {}
        #: AS EXECUCOES EMPURRADAS PELO VENUE (D6). O `send_request` de uma ordem devolve, neste venue, o
        #: `ORDER_ACCEPTED` (sem `executedVolume`/`usedMargin`/`executionPrice`) — e o PREENCHIMENTO chega
        #: depois, por EVENTO PROPRIO. Esse evento nao casa pedido nenhum, e por isso o protocolo entrega-o aos
        #: TRATADORES de evento (o router da biblioteca e' um deles). Aqui guarda-se o mesmo evento JA'
        #: convertido na forma do contrato (`_evento_do_venue`), para a costura o poder SEGUIR sem inventar
        #: numero nenhum (FR-064). E' um `deque` com TECTO: o registo serve um instante, nao um historico.
        self._execucoes: deque[dict[str, Any]] = deque(maxlen=MAXIMO_DE_EXECUCOES_GUARDADAS)
        self._trava_das_execucoes = threading.Lock()
        #: O desligador do tratador das execucoes (`protocol.on_event` devolve-o); `None` enquanto nao se ligou.
        self._desligar_as_execucoes: Callable[[], None] | None = None

    # ---- as duas camadas -----------------------------------------------------------------------------------
    def abrir(self, caminhos: dict[str, Path]) -> Resultado:
        """O fio de pe' + a aplicacao autenticada. A CONTA e' o passo seguinte, e e' outro."""
        self.guarda = GuardaDeTokens(caminhos)
        try:
            self._grafo = build_graph(self._config, token_store=self.guarda)
        except Exception as erro:  # a biblioteca pode recusar a configuracao
            self._laco.parar()  # nao se deixa um laco de eventos vivo atras de um arranque que falhou
            return _falhou("falha_ao_montar_o_transporte", f"a biblioteca recusou a configuracao: {type(erro).__name__}")
        self._cliente = CTraderClient.from_graph(self._grafo)
        # UMA AUTENTICACAO, UMA VEZ. O `__aenter__` do cliente JA' autentica a aplicacao: o «maintainer» da
        # biblioteca chama `authenticate_app()` no `prepare()` de cada ligacao nova (`auth/_maintain.py:118`), e a
        # docstring do proprio metodo di-lo — «The maintainer calls this on each new link. Nothing else can be
        # authenticated before it succeeds.». Chamar `authenticate_app()` A SEGUIR na mesma ligacao e' um SEGUNDO
        # `ProtoOAApplicationAuthReq`, e o venue RECUSA-o com
        #   ALREADY_LOGGED_IN - Open API application is already authorized
        # (medido a 05/10/2026 com as credenciais reais do dono, contando as chamadas: 2 -> a porta `ligacao`
        # nunca passava, e sem ela o conector nao arranca). Sobrou UMA.
        try:
            self._laco.rodar(self._cliente.__aenter__())  # type: ignore[union-attr]
        except Exception as erro:
            self.fechar()
            return _falhou("sem_ligacao", f"a aplicacao nao autenticou: {type(erro).__name__}: {erro}")
        self.app_autenticada = True
        return Resultado(ok=True, valor="aplicacao autenticada e fio de pe'")

    def autorizar_conta(self, account_id: int, access_token: str, refresh_token: str) -> Resultado:
        """A SEGUNDA camada: a conta. Sem ela, o fio pode estar vivo e o conector nao envia nada."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto: a conta nao se autoriza sem fio")
        credenciais = AccountCredentials(
            account_id=account_id,
            access_token=access_token,
            refresh_token=refresh_token,
            # O prazo que o venue declarou na ultima rotacao, se ele ficou gravado; 0.0 (expirado) quando nao
            # ha' prazo conhecido — o que obriga a um refresh, e o refresh e' o caminho pelo qual a rotacao se
            # ve' a acontecer em vez de se supor (RN-CT10). Nunca se inventa um prazo: ou veio do venue, ou e' 0.
            expires_at=self.prazo_declarado(),
        )
        try:
            self._laco.rodar(self._grafo.auth.establish(credenciais, AuthTrigger.INITIAL))
        except Exception as erro:
            return _falhou("conta_nao_autorizada", f"o venue nao autorizou a conta {account_id}: {type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=f"conta {account_id} autorizada")

    def prazo_declarado(self) -> float:
        """O `expires_at` que o venue gravou na ultima rotacao. Ausente ou ilegivel -> 0.0 (expirado)."""
        if self.guarda is None or "expira_em" not in self.guarda._caminhos:  # noqa: SLF001 (e' o embrulho)
            return 0.0
        caminho = self.guarda._caminhos["expira_em"]  # noqa: SLF001
        if not caminho.exists():
            return 0.0
        try:
            return float(caminho.read_text(encoding="utf-8").strip())
        except (ValueError, OSError):
            return 0.0

    def conta_autorizada(self, account_id: int) -> bool:
        if self._grafo is None:
            return False
        return bool(self._grafo.auth.is_account_authorized(account_id))

    # ---- o eixo «Sessao da conta» (FR-070/US6) -------------------------------------------------------------
    def estado_da_sessao(self, account_id: int) -> str:
        """O estado da sessao da conta, LEGIVEL POR NOME (FR-070): `nao_autorizada`/`autorizada`/`invalidada`.

        `invalidada` MANDA sobre as outras duas: foi o EVENTO do venue que o disse (roda/revoga/kick) e ate' a
        biblioteca re-autenticar nao se envia nada. Sem evento, o estado e' o que a biblioteca diz do lado dela
        (`is_account_authorized`).
        """
        if account_id in self._sessoes_invalidadas:
            return SESSAO_INVALIDADA
        if self.conta_autorizada(account_id):
            return SESSAO_AUTORIZADA
        return SESSAO_NAO_AUTORIZADA

    def marcar_sessao_invalidada(self, account_id: int) -> None:
        """O EVENTO de invalidacao chegou para esta conta: a sessao fica `invalidada` ate' re-autenticar (FR-070)."""
        if account_id not in self._sessoes_invalidadas:
            self._sessoes_invalidadas.add(account_id)
            self.contas_da_sessao["invalidadas"] += 1

    def releitura_pendente(self, account_id: int) -> bool:
        """A sessao recuperou por re-autenticacao da biblioteca e a CONTA ainda NAO foi relida (US6 cenario 2)."""
        return account_id in self._releitura_pendente

    def confirmar_releitura(self, account_id: int) -> None:
        """A conta foi LIDA depois da recuperacao: a marca sai — e so' depois de sair e' que o pedido novo segue."""
        if account_id in self._releitura_pendente:
            self._releitura_pendente.discard(account_id)
            self.contas_da_sessao["releituras"] += 1

    # ---- os TRATADORES dos eventos de sessao. A biblioteca ROTEIA-os; aqui so' se OBSERVA --------------------
    # NADA de lacos de re-autenticacao proprios: quem re-autentica e' o maintainer da biblioteca
    # (`auth/_maintain.py`: `handle_account_disconnect`, `_recovery_loop`, `_rotate`). Estes tratadores so'
    # guardam o NOME do estado, para a guarda das duas camadas (FR-048) ter olhos.
    async def ao_invalidarem_o_token(self, evento: Any) -> None:
        """`TokenInvalidatedEvent` (rotacao/revogacao do token): marca INVALIDADA cada conta que ele nomeia."""
        for conta in getattr(evento, "account_ids", ()):
            if isinstance(conta, int):
                self.marcar_sessao_invalidada(conta)

    async def ao_desligarem_a_conta(self, evento: Any) -> None:
        """`AccountDisconnectEvent` (a conta derrubada pelo servidor): a conta fica INVALIDADA."""
        conta = getattr(evento, "account_id", None)
        if isinstance(conta, int):
            self.marcar_sessao_invalidada(conta)

    async def ao_desligarem_o_cliente(self, evento: Any) -> None:
        """`ClientDisconnectEvent` (o servidor DERRUBA o cliente — o `kick` da spec): a NOSSA conta fica INVALIDADA.

        Este evento NAO nomeia conta (tem so' `reason`): o transporte e' de UMA conta, e e' a conta SEGUIDA que
        fica marcada. Fica conservador de proposito — um kick suspende o envio ate' a biblioteca reconectar e
        publicar o `ReadyEvent` (que e' quem a tira deste estado).
        """
        if self._conta_da_sessao is not None:
            self.marcar_sessao_invalidada(self._conta_da_sessao)

    async def ao_recuperarem_a_conta(self, evento: Any) -> None:
        """`ReadyEvent` (a biblioteca re-autenticou): a sessao volta, mas a CONTA tem de ser RELIDA (US6 cenario 2).

        So' se AQUI tiver estado invalidada e' que a recuperacao conta: um `ReadyEvent` de arranque/reconexao que
        nao veio de uma invalidacao observada nao pede releitura desta conta.
        """
        conta = getattr(evento, "account_id", None)
        if not isinstance(conta, int):
            return
        if conta in self._sessoes_invalidadas:
            self._sessoes_invalidadas.discard(conta)
            self._releitura_pendente.add(conta)
            self.contas_da_sessao["recuperadas"] += 1

    def seguir_a_sessao_da_conta(self, account_id: int) -> Resultado:
        """Liga os TRATADORES dos eventos de sessao — a linha do ARRANQUE que da' OLHOS a' maquina (FR-070).

        Nao se reimplementa recuperacao nenhuma: a biblioteca re-autentica sozinha, e aqui so' se OBSERVA. Devolve
        a recusa NOMEADA quando algum tratador NAO se liga — um silencio aqui deixaria a guarda das duas camadas
        (FR-048) cega, e um conector cego nao sabe se pode enviar: a falha tem de ser dita, nao engolida.
        """
        from ctrader_api_client import (
            AccountDisconnectEvent,
            ClientDisconnectEvent,
            ReadyEvent,
            TokenInvalidatedEvent,
        )

        self._conta_da_sessao = account_id
        ligados = {
            # `TokenInvalidatedEvent` nao tem campo `account_id` (tem `account_ids`): o filtro por conta nao
            # existe, e o tratador decide por dentro quais contas ele nomeia. Cobre a ROTACAO e a REVOGACAO.
            "token_invalidado": registar_evento(self, TokenInvalidatedEvent, self.ao_invalidarem_o_token),
            # A conta derrubada pelo servidor (a biblioteca so' o publica depois de verificar que foi REAL).
            "conta_desligada": registar_evento(
                self, AccountDisconnectEvent, self.ao_desligarem_a_conta, account_id=account_id
            ),
            # O KICK do servidor ao CLIENTE (nao nomeia conta: marca a conta SEGUIDA).
            "cliente_desligado": registar_evento(self, ClientDisconnectEvent, self.ao_desligarem_o_cliente),
            # A re-autenticacao da biblioteca: a sessao volta, mas a conta tem de ser RELIDA (US6 cenario 2).
            "conta_recuperada": registar_evento(self, ReadyEvent, self.ao_recuperarem_a_conta, account_id=account_id),
        }
        faltas = sorted(nome for nome, ligou in ligados.items() if not ligou)
        if faltas:
            return _falhou(
                "sessao_nao_seguida",
                f"nao se ligaram os tratadores de sessao {faltas} (rotacao/revogacao/kick): sem eles a sessao da "
                "conta nao tem estado observado, a guarda das duas camadas (FR-048) fica cega e nao se sabe se "
                "pode enviar — a falha do registo e' DITA, nunca silencio",
            )
        return Resultado(ok=True, valor=f"sessao da conta {account_id} seguida: {sorted(ligados)} (FR-070)")

    def conferir_as_duas_camadas(self, account_id: int) -> Resultado | None:
        """FR-048: `None` quando as DUAS camadas estao prontas; a RECUSA NOMEADA quando falta uma.

        «Uma bandeira so' nunca decide um envio»: conferem-se SEMPRE as duas — o TRANSPORTE (a aplicacao
        autenticada) e a SESSAO da conta (autorizada) — e o `porque` diz QUAL faltou. O motivo e' `prazo_excedido`,
        o nome que a casa ja' da' a' «credencial/sessao nao esta' valida» (DECISAO DO DONO, 05/10/2026 — a mesma do
        FR-068). Com a sessao INVALIDADA o FECHO tambem e' recusado: uma sessao caida nao serve pedido nenhum.
        """
        if not self.app_autenticada:
            return _falhou(
                "prazo_excedido",
                "a camada do TRANSPORTE nao esta' pronta (a aplicacao nao autenticou): sem o fio nao ha' envio — "
                "uma bandeira so' nunca decide um envio (FR-048)",
            )
        estado = self.estado_da_sessao(account_id)
        if estado == SESSAO_INVALIDADA:
            return _falhou(
                "prazo_excedido",
                "a sessao da conta esta' INVALIDADA (token rodado/revogado, ou a conta derrubada pelo servidor — "
                "FR-070): nenhuma ordem nova sai ate' a biblioteca re-autenticar — e o FECHO tambem nao, porque uma "
                "sessao caida nao serve pedido nenhum (FR-048)",
            )
        if estado != SESSAO_AUTORIZADA:
            return _falhou(
                "prazo_excedido",
                f"a sessao da conta nao esta' autorizada (estado {estado!r}): o fio pode estar de pe' e a conta "
                "nao — sem as DUAS camadas nao ha' envio (FR-048)",
            )
        return None

    def token_actual(self, account_id: int) -> str | None:
        """O access token VIVO que a biblioteca tem para esta conta, AGORA — nao a copia lida de um ficheiro.

        A dimensao que faltava no A-8 (medido a 05/10/2026 e fechado aqui): `autorizar_conta()` chama
        `establish()`, e quando o token declarado esta' expirado ele REFRESCA e RODA o par. A partir desse
        instante o token que a porta 5 leu dos `.key` esta' MORTO — o venue invalida-o — e o manager passa a
        guardar o NOVO (`establish` -> `authorize`/`replace_credentials`, em `auth/manager.py`). Quem precisa de
        falar com o venue depois da porta 6 (a porta 8, a leitura) tem de usar ESTE token, e nao a copia.

        `None` quando o manager nao tem a conta: quem chama decide a recusa — aqui nao se inventa um token.
        """
        if self._grafo is None:
            return None
        credenciais = self._grafo.auth.get_credentials(account_id)
        if credenciais is None:
            return None
        return credenciais.access_token

    def fechar(self) -> None:
        if self._cliente is not None:
            try:
                self._laco.rodar(self._cliente.__aexit__(None, None, None))
            except Exception:
                pass  # fechar nunca rebenta o processo que esta' a desligar-se
        self._laco.parar()

    # ---- o RITMO do venue (RN-CT2 / FR-071) -----------------------------------------------------------------
    def _vez_geral(self) -> None:
        """Reserva um lugar na classe GERAL (50/s) antes de um pedido que NAO e' historico.

        E' o unico ponto por onde os pedidos gerais passam: os verbos de leitura (contas, trader, simbolos,
        posicoes, ordens, nao-realizado, negocio de fecho) e o ENVIO. O limitador so' atrasa — nao mexe no que
        o venue responde.
        """
        self._ritmo["geral"].esperar()

    def _vez_historica(self) -> None:
        """Reserva um lugar na classe HISTORICA (5/s) antes de um pedido de VELAS (o pedido historico)."""
        self._ritmo["historico"].esperar()

    def estado_de_ritmo(self) -> dict[str, Any]:
        """O ESTADO DECLARADO do ritmo — e' AQUI que a ESPERA do venue se LE' (FR-071).

        Devolve, por classe (`geral`/`historico`): o `maximo_por_segundo` (50/5), o `intervalo_minimo_s` com que
        o conector se espaca (0,02/0,2), os `pedidos` feitos, as `esperas` (quantas vezes o ritmo obrigou a
        esperar), e a `ultima_espera_s` (a ultima espera declarada, em segundos do relogio que o transporte
        tem). `relogio` diz se e' o REAL (producao) ou INJECTADO (a prova offline). Um pedido que esperou NAO
        fica «sem dados»: chega ao venue e e' servido — esta funcao e' o que o torna legivel, e nao adivinhavel.
        """
        return {
            "relogio": "injectado" if self._relogio_injectado else "real",
            "geral": self._ritmo["geral"].estado(),
            "historico": self._ritmo["historico"].estado(),
        }

    # ---- o que a sonda e a leitura pedem -------------------------------------------------------------------
    def contas(self, access_token: str) -> Resultado:
        """A lista de contas deste token — e' daqui que sai a prova de identidade (FR-049)."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            contas = self._laco.rodar(self._grafo.accounts.list_by_token(access_token))
        except Exception as erro:
            return _falhou("falha_ao_ler_as_contas", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_conta_resumida(c) for c in contas])

    def trader(self, account_id: int) -> Resultado:
        """A conta por dentro: saldo, alavancagem, direitos, tipo, e o `moneyDigits` do VENUE (D2).

        O `moneyDigits` NAO chega no modelo `Account` da biblioteca (ela le'-o para dividir o saldo e deita-o
        fora: `models/account.py:143`), mas o PROTO tem-no. Pergunta-se pelo `ProtoOATraderReq` — a MESMA fonte
        que a biblioteca usou — e le'-se do `ProtoOATraderRes.trader.moneyDigits`. O que o venue nao disser fica
        AUSENTE (a leitura cai na POSICAO como segunda fonte, e sem nenhuma RECUSA).
        """
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            resposta = self._laco.rodar(
                self._grafo.protocol.send_request(ProtoOATraderReq(ctid_trader_account_id=account_id))
            )
            conta = self._laco.rodar(self._grafo.accounts.get_trader(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_a_conta", f"{type(erro).__name__}: {erro}")
        expoente = _expoente_do_trader(resposta)
        if isinstance(expoente, Resultado):
            return expoente
        return Resultado(ok=True, valor=_conta_por_dentro(conta, expoente, resposta.trader.balance))

    def simbolos(self, account_id: int) -> Resultado:
        """O UNIVERSO: id, nome e se esta' habilitado. O `includeArchivedSymbols` da doc nao esta' exposto pela
        biblioteca — os deslistados que ela nao der ficam declarados como ausentes (RN-CT18, achado da sonda)."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            simbolos = self._laco.rodar(self._grafo.symbols.list_all(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_o_universo", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_simbolo_do_universo(s) for s in simbolos])

    def simbolos_por_id(self, account_id: int, ids: list[int]) -> Resultado:
        """Os numeros de cada simbolo: o que o manifesto publica (minimos, passo, digitos, distancias)."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            simbolos = self._laco.rodar(self._grafo.symbols.get_by_ids(account_id, ids))
        except Exception as erro:
            return _falhou("falha_ao_ler_os_simbolos", f"{type(erro).__name__}: {erro}")
        publicados: list[dict[str, Any]] = []
        for simbolo in simbolos:
            convertido = _simbolo_por_dentro(simbolo)
            if isinstance(convertido, Resultado):
                # O simbolo recusou-se (modo de negociacao fora do mapa declarado): NAO se publica nenhum com um
                # modo inventado — a recusa sobe com o nome, e o chamador decide o que faz com ela.
                return convertido
            publicados.append(convertido)
        return Resultado(ok=True, valor=publicados)

    def velas(self, account_id: int, symbol_id: int, periodo: str, de: Any, ate: Any) -> Resultado:
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_historica()  # as VELAS sao o pedido HISTORICO: a classe de 5/s (RN-CT2)
        try:
            from ctrader_api_client import TrendbarPeriod

            bars = self._laco.rodar(
                self._grafo.market_data.get_trendbars(account_id, symbol_id, TrendbarPeriod(periodo), de, ate)
            )
        except Exception as erro:
            return _falhou("falha_ao_ler_as_velas", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_vela(b) for b in bars])

    def subscrever_spots(self, account_id: int, ids: list[int]) -> Resultado:
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            self._laco.rodar(self._grafo.market_data.subscribe_spots(account_id, ids))
        except Exception as erro:
            return _falhou("falha_ao_subscrever_spots", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=f"{len(ids)} simbolo(s) subscritos para spots")

    def subscrever_profundidade(self, account_id: int, ids: list[int]) -> Resultado:
        """A profundidade do livro. O venue NAO declara quantos niveis da' — da'-os, e a sonda conta-os."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            self._laco.rodar(self._grafo.market_data.subscribe_depth(account_id, ids))
        except Exception as erro:
            return _falhou("falha_ao_subscrever_profundidade", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=f"{len(ids)} simbolo(s) subscritos para profundidade")

    # ---- a LEITURA VIVA do mercado (US1 / data-model §6 / RN-CT29) -----------------------------------------
    # PORQUE EXISTE (05/10/2026). A `subscrever_spots` existia e NINGUEM a chamava (0 chamadores), e a
    # `subscrever_profundidade` so' era usada pela `sonda.py`: o venue mandava os retratos e nao havia quem os
    # guardasse. `seguir_o_mercado` liga o caminho inteiro (tratadores + subscricao) e guarda o ULTIMO RETRATO
    # por simbolo, nos INTEIROS do CONTRATO — a parte pura (`leitura.py`) e' quem divide, num so' caminho.
    def seguir_o_mercado(self, account_id: int, ids: list[int], *, com_profundidade: bool = True) -> Resultado:
        """Liga a LEITURA VIVA: registra os tratadores dos eventos e subscreve os spots (e, se pedido, o livro).

        A ORDEM E' OBRIGATORIA: o tratador TEM de estar ligado ANTES da subscricao. Um evento que chegue primeiro
        nao tem quem o leia, e o retrato perde-se em silencio — e' a ordem que a `sonda.py` ja' mediu
        (`registar_evento` antes de `subscrever_profundidade`). O registo falhado RECUSA por NOME
        (`tratador_da_leitura_nao_ligado`): uma subscricao que ninguem le' seria um pedido ao venue a troco de nada.
        """
        if not registar_evento(self, SpotEvent, self.ao_chegar_spot, account_id=account_id):
            return _falhou(
                "tratador_da_leitura_nao_ligado",
                "nao consegui ligar o tratador dos spots (`registar_evento`): sem ele a subscricao nao teria quem "
                "a leia, e o ULTIMO retrato nunca se guardaria",
            )
        if com_profundidade and not registar_evento(self, DepthEvent, self.ao_chegar_profundidade, account_id=account_id):
            return _falhou(
                "tratador_da_leitura_nao_ligado",
                "nao consegui ligar o tratador da profundidade (`registar_evento`): sem ele o livro por deltas "
                "nao se guardaria",
            )
        spots = self.subscrever_spots(account_id, ids)
        if not spots.ok:
            return spots
        if com_profundidade:
            profundidade = self.subscrever_profundidade(account_id, ids)
            if not profundidade.ok:
                return profundidade
            return Resultado(ok=True, valor=f"{len(ids)} simbolo(s) a seguir: spots + profundidade")
        return Resultado(ok=True, valor=f"{len(ids)} simbolo(s) a seguir: spots")

    async def ao_chegar_spot(self, evento: Any) -> None:
        """`SpotEvent` ROTEADO pela biblioteca -> o ULTIMO retrato de bid/ask do simbolo, nos inteiros do contrato.

        O LADO QUE VEIO AUSENTE FICA AUSENTE (RN-CT29), nunca zero: a biblioteca converte `proto.bid`/`proto.ask`
        a `Decimal` e o LADO A ZERO (`if proto.bid else None`, `events/router.py:153-154`) entra como `None`; o
        `_escalado_do_preco` de um `None`/`0` da' `None`. O INSTANTE E' O DO VENUE (`evento.timestamp`, dos
        `timestamp` millis do venue): sem um instante legivel NAO se carimba o retrato com o NOSSO relogio — o
        ultimo instante do venue fica como estava, e a idade continua a medir-se contra o relogio DELE.
        """
        numero = _inteiro_do_venue(getattr(evento, "symbol_id", None))
        if numero is None:
            return  # um evento sem simbolo legivel nao inventa um retrato (nao ha' a quem o atribuir)
        retrato = self._retrato_do_simbolo(numero)
        retrato["bid"] = _escalado_do_preco(getattr(evento, "bid", None))
        retrato["ask"] = _escalado_do_preco(getattr(evento, "ask", None))
        instante = _instante_do_evento_ms(getattr(evento, "timestamp", None))
        if instante is not None:
            retrato["tempo_do_venue_ms"] = instante

    async def ao_chegar_profundidade(self, evento: Any) -> None:
        """`DepthEvent` ROTEADO pela biblioteca -> o LIVRO POR DELTAS (RN-CT25), guardado por id de cotacao.

        `new_quotes` acrescenta/actualiza niveis; `deleted_quote_ids` apaga-os. Uma REMOCAO de um id que NAO esta'
        no livro NAO inventa nivel nenhum (`dict.pop(id, None)`) — e' a regra da casa aplicada ao caso: o que o
        venue nao disse nao se preenche. Os precos/tamanhos sao os INTEIROS CRUS que a biblioteca ja' entrega
        (`DepthQuote.price`/`.size`: o preco em `q.bid`/`q.ask`, o tamanho em centesimos) — a divisao fica na
        parte PURA, num so' caminho.
        """
        numero = _inteiro_do_venue(getattr(evento, "symbol_id", None))
        if numero is None:
            return
        livro = self._retrato_do_simbolo(numero)["livro"]
        cotacoes = getattr(evento, "new_quotes", None)
        if isinstance(cotacoes, (tuple, list)):
            for cota in cotacoes:
                identificador = _inteiro_do_venue(getattr(cota, "quote_id", None))
                preco = _inteiro_do_venue(getattr(cota, "price", None))
                tamanho = _inteiro_do_venue(getattr(cota, "size", None))
                if identificador is None or preco is None or tamanho is None:
                    continue
                livro[identificador] = {"preco": preco, "tamanho": tamanho}
        apagadas = getattr(evento, "deleted_quote_ids", None)
        if isinstance(apagadas, (tuple, list)):
            for identificador in apagadas:
                livro.pop(identificador, None)

    def _retrato_do_simbolo(self, symbol_id: int) -> dict[str, Any]:
        """O estado do ULTIMO retrato deste simbolo — cria-o vazio na primeira vez que ele aparece."""
        return self._retratos.setdefault(
            symbol_id, {"tempo_do_venue_ms": None, "bid": None, "ask": None, "livro": {}}
        )

    def retrato_do_mercado(self, symbol_id: int) -> dict[str, Any] | None:
        """O ULTIMO retrato do simbolo, nos INTEIROS do contrato — ou `None` quando nao chegou evento nenhum.

        Devolve uma COPIA: quem le' nao mexe no estado da subscricao. O `livro` sai ja' na forma do
        `EntradaMercado` (`lados` com `preco`/`tamanho` inteiros + `profundidade` declarada) e fica `None` quando
        nao ha' nivel nenhum — um livro vazio NAO se publica (o contrato exige `minItems: 1`).
        """
        retrato = self._retratos.get(symbol_id)
        if retrato is None:
            return None
        niveis = retrato["livro"]
        livro: dict[str, Any] | None = None
        if niveis:
            lados = [{"preco": nivel["preco"], "tamanho": nivel["tamanho"]} for nivel in niveis.values()]
            livro = {"lados": lados, "profundidade": len(lados)}
        return {
            "tempo_do_venue_ms": retrato["tempo_do_venue_ms"],
            "bid": retrato["bid"],
            "ask": retrato["ask"],
            "livro": livro,
        }

    # ---- o que a leitura e o desfecho pedem ----------------------------------------------------------------
    def posicoes(self, account_id: int) -> Resultado:
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            posicoes = self._laco.rodar(self._grafo.trading.get_open_positions(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_as_posicoes", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_posicao(p) for p in posicoes])

    def ordens_vivas(self, account_id: int) -> Resultado:
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            ordens = self._laco.rodar(self._grafo.trading.get_pending_orders(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_as_ordens", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_ordem(o) for o in ordens])

    def ordens_do_registo(self, account_id: int) -> Resultado:
        """O REGISTO DE ORDENS da conta (`ProtoOAOrderListReq`): TODAS as ordens, vivas ou ja' acabadas.

        PORQUE E' QUE ESTA LEITURA EXISTE (05/10/2026, D-009/FR-069). E' a FONTE DA VERDADE da costura, em dois
        sitios e pela mesma leitura:
          * a RECONCILIACAO de uma ordem `desconhecida` (FR-069) procura aqui a NOSSA marca — a memoria do
            processo guarda so' QUE ha' algo por reconciliar, nunca a verdade (que existe uma ordem ou que nao);
          * a IDEMPOTENCIA (D-009, FR-061) procura aqui o `clientOrderId` derivado da referencia ANTES de
            enviar: a mesma marca que ja' produziu uma ordem NAO produz uma segunda — e e' a unica guarda que
            sobrevive ao processo morrer, porque a leitura vai ao venue e a memoria do processo nao.
        A leitura falhada NAO vira «nada encontrado»: devolve a recusa nomeada, e quem a pede decide (na
        reconciliacao, um `desconhecido` que fica; na idempotencia, NAO se envia).
        """
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            ordens = self._laco.rodar(self._grafo.trading.get_orders(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_o_registo_de_ordens", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_ordem(o) for o in ordens])

    def nao_realizado(self, account_id: int) -> Resultado:
        """A parcela que falta ao equity derivado (achado 1 do data-model)."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            linhas = self._laco.rodar(self._grafo.trading.get_unrealized_pnl_per_position(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_o_nao_realizado", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_nao_realizado(p) for p in linhas])

    def negocio_de_fecho(self, account_id: int, position_id: int) -> Resultado:
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        self._vez_geral()  # pedido GERAL: a classe de 50/s (RN-CT2)
        try:
            negocios = self._laco.rodar(self._grafo.trading.get_deals_by_position_id(account_id, position_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_os_negocios", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_negocio(n) for n in negocios])

    # ---- SEGUIR O PREENCHIMENTO (D6): o evento que traz os NUMEROS, e nao so' o aceite ----------------------
    async def _ao_chegar_uma_execucao(self, evento: Any) -> None:
        """Guarda CADA execucao que o venue empurra, ja' na forma do contrato.

        O protocolo entrega o evento a TODOS os tratadores do tipo (o router da biblioteca e' um deles): aqui
        nao se substitui nada — acrescenta-se um par de olhos. A conversao e' a mesma do envio (`_evento_do_venue`),
        por isso o que fica guardado tem os inteiros/objectos do venue (order/position/deal), prontos a virar
        resolucao. Um evento que a conversao nao saiba ler NAO derruba o tratador: perde-se uma execucao, e a
        espera diz que o preenchimento nao chegou — nunca inventa um numero.
        """
        try:
            dicionario = _evento_do_venue(evento)
        except Exception:  # noqa: BLE001 (um evento ilegivel nao pode matar o leitor do venue)
            return
        with self._trava_das_execucoes:
            self._execucoes.append(dicionario)

    def ligar_as_execucoes(self) -> bool:
        """Liga (UMA vez) o tratador das execucoes CRUAS do venue no PROTOCOLO — a fonte do preenchimento (D6).

        PORQUE NO PROTOCOLO, e nao no `_cliente`: o `ExecutionEvent` que a biblioteca publica e' ACHATADO (perde
        `order`/`position`/`deal` — medido a 05/10/2026), e sem esses sub-objectos nao ha' `usedMargin`/`marginRate`
        nem `moneyDigits`, logo a resolucao nunca se completa. O `Protocol.on_event` recebe o `ProtoOAExecutionEvent`
        do VENUE inteiro, e e' o MESMO canal por onde o router da biblioteca o ve'. Idempotente: liga uma so' vez,
        devolve `True` se o tratador (ja') esta' ligado e `False` quando nao ha' ligacao para ligar.
        """
        if self._grafo is None:
            return False
        if self._desligar_as_execucoes is not None:
            return True
        try:
            self._desligar_as_execucoes = self._grafo.protocol.on_event(
                ProtoOAExecutionEvent, self._ao_chegar_uma_execucao
            )
            return True
        except Exception:  # noqa: BLE001 (sem `on_event` nao ha' como ver o preenchimento empurrado: quem espera decide)
            return False

    def _execucao_decisiva(self, marca: Any, ordem_id: int | None) -> dict[str, Any] | None:
        """A ULTIMA execucao guardada DESTA ordem que traz um desfecho — e nao um simples aceite/replace.

        Uma ordem em repouso (`ORDER_ACCEPTED`/`ORDER_REPLACED`) nao tem numero de preenchimento: enquanto so'
        houver dessas, nao ha' nada a devolver. Os restantes tipos (preenchida/parcial/recusada/...) SAO decisivos,
        e vale o ULTIMO (uma parcial seguida de preenchimento resolve pelo preenchimento).
        """
        with self._trava_das_execucoes:
            candidatos = list(self._execucoes)
        decisiva: dict[str, Any] | None = None
        for evento in candidatos:
            if not _e_desta_ordem(evento, marca, ordem_id):
                continue
            if evento.get("executionType") in ("ORDER_ACCEPTED", "ORDER_REPLACED"):
                continue
            decisiva = evento
        return decisiva

    def esperar_o_preenchimento(self, marca: Any, ordem_id: int | None, prazo_s: float) -> Resultado:
        """Espera, DENTRO DO PRAZO, o evento do venue que traz os NUMEROS do preenchimento (D6).

        O `ORDER_ACCEPTED` diz que a ordem existe, mas nao traz `executedVolume`/`executionPrice`/`usedMargin` —
        e sem esses numeros a resolucao nao se completa e o contrato RECUSA o desfecho (medido a 05/10/2026: a
        ordem PREENCHIDA nunca publicava linha nenhuma). Aqui segue-se o evento seguinte DESTA ordem que traz os
        numeros (o preenchimento), ou um evento TERMINAL (recusa/cancelamento). Se nada chegar dentro do prazo, a
        recusa e' NOMEADA (`sem_preenchimento_no_prazo`): quem chama cai no SILENCIO — NUNCA um sucesso inventado
        (FR-064/FR-067). E' o mesmo prazo declarado que governa a resposta ao envio.
        """
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto: sem fio nao ha' evento a seguir")
        self.ligar_as_execucoes()
        limite = time.monotonic() + max(0.0, float(prazo_s))
        while True:
            decisiva = self._execucao_decisiva(marca, ordem_id)
            if decisiva is not None:
                return Resultado(ok=True, valor=decisiva)
            if time.monotonic() >= limite:
                return _falhou(
                    "sem_preenchimento_no_prazo",
                    (
                        f"o venue aceitou a ordem (marca={marca!r}, ordem={ordem_id!r}) mas o preenchimento nao "
                        f"chegou por evento dentro do prazo declarado ({prazo_s:.3f}s): e' o SILENCIO — nem sucesso "
                        "nem falha — e so' a reconciliacao por LEITURA o resolve (FR-067/FR-069)"
                    ),
                )
            time.sleep(PASSO_DA_ESPERA_DO_PREENCHIMENTO_S)

    # ---- o ENVIO: os dois verbos que a costura pede (processo.VERBO_DE_ABERTURA/VERBO_DE_FECHO) --------------
    def colocar_ordem(self, account_id: int, accao: dict[str, Any]) -> Resultado:
        """A ABERTURA: a accao do venue (o que o `ordens.py` produziu) -> `NewOrderRequest` -> o evento do venue.

        A ACCAO ENTRA PRONTA. Este verbo NAO traduz, nao recalcula e nao confere banda nenhuma: recebe os campos
        ja' na unidade do venue (volume em 0,01, distancias relativas em 1/100000, inteiros) e limita-se a
        montar o pedido da biblioteca. O que nao tiver forma esperada RECUSA por nome — um pedido a' sorte seria
        uma ordem com outro numero.
        """
        pedido = _pedido_de_abertura(accao)
        if isinstance(pedido, Resultado):
            return pedido
        return self._enviar_pedido(pedido, account_id)

    def fechar_posicao(self, account_id: int, accao: dict[str, Any]) -> Resultado:
        """O FECHO: fecha POR POSICAO — a accao do `fecho.py` leva o `positionId` e o volume que o venue publicou.

        A ORDEM DE FECHO DESTE VENUE E' UMA ORDEM QUE REFERENCIA A POSICAO (`ClosePositionRequest`): o lado sai
        da POSICAO, no venue, e nao de boleta nenhuma. Por isso a accao de fecho nao traz (nem pode trazer) um
        lado para aqui — quem fecha e' o venue, contra o `positionId` (RN-CT34, fechar nao abre).
        """
        if not isinstance(accao, dict):
            return _falhou("formato_invalido", f"a accao de fecho nao e' um objecto (veio {type(accao).__name__})")
        position_id = _inteiro_do_venue(accao.get("positionId"))
        if position_id is None:
            return _falhou(
                "campo_obrigatorio_ausente",
                f"a accao de fecho nao traz `positionId` utilizavel ({accao.get('positionId')!r}): sem id nao ha' fecho",
            )
        volume = _inteiro_do_venue(accao.get("volume"))
        if volume is None or volume <= 0:
            return _falhou(
                "campo_obrigatorio_ausente",
                f"a accao de fecho nao traz `volume` (0,01 de unidade) utilizavel ({accao.get('volume')!r}): o "
                "fecho e' pelo tamanho que o venue publicou, e nao por um calculo nosso",
            )
        return self._enviar_pedido(ClosePositionRequest(position_id=position_id, volume=volume), account_id)

    def _enviar_pedido(self, pedido: NewOrderRequest | ClosePositionRequest, account_id: int) -> Resultado:
        """Manda o pedido da biblioteca pelo PROTOCOLO do grafo e devolve o evento do venue — em DICIONARIO.

        PORQUE NAO SE USA `place_order`/`close_position` (MEDIDO a 05/10/2026): esses dois metodos embrulham o
        mesmo `send_request`, mas devolvem `execution_event_from_proto(response)` — um `ExecutionEvent` ACHATADO
        que DESCARTA os sub-objectos `order`/`position`/`deal`. E' exactamente desses que o `desfecho.py` e o
        `processo.py` vivem (`usedMargin`, `marginRate`, `moneyDigits`, `orderStatus`, `dealStatus`, `commission`):
        medido, com o evento achatado um `ORDER_FILLED` produz um desfecho que o CONTRATO RECUSA (resolucao sem
        `margem_empenhada`) e NENHUMA linha sai. O pedido continua a ser o MODELO da biblioteca (o mesmo que
        `place_order` monta com `to_proto`), e o evento e' o do VENUE — o `Protocol` e' o mesmo canal que
        `place_order` usa, e e' publico no grafo (`ClientGraph.protocol`).
        """
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto: nao se envia por um fio que nao existe")
        # FR-048 — AS DUAS CAMADAS, no momento de mandar: transporte (aplicacao autenticada) E sessao da conta
        # (autorizada). Faltando uma, a recusa e' NOMEADA e NAO SAI NENHUMA MENSAGEM. Esta conferencia vive num
        # so' sitio (`conferir_as_duas_camadas`) e e' a MESMA que o pedido corre antes de ler o venue: uma
        # bandeira so' nunca decide um envio.
        camadas = self.conferir_as_duas_camadas(account_id)
        if camadas is not None:
            return camadas
        self._vez_geral()  # o ENVIO e' um pedido GERAL: a classe de 50/s (RN-CT2)
        # D6 — LIGA OS OLHOS NO PREENCHIMENTO ANTES DE MANDAR. O preenchimento chega por EVENTO PROPRIO, e pode
        # chegar entre a resposta (o `ORDER_ACCEPTED`) e a espera: ligar o tratador agora fecha essa janela. Nao
        # custa um pedido ao venue (e' registo local no protocolo) e a espera recusa-se por si quando nada chega.
        self.ligar_as_execucoes()
        try:
            resposta = self._laco.rodar(self._grafo.protocol.send_request(pedido.to_proto(account_id)))
        except Exception as erro:  # ligacao caida a meio, prazo do protocolo, resposta de erro do venue
            return _falhou(
                "falha_no_envio",
                f"o envio nao teve resposta legivel ({type(erro).__name__}: {erro}) — e' o SILENCIO, que a "
                "costura classifica `desconhecido` (nunca sucesso nem falha, FR-067)",
            )
        if isinstance(resposta, ProtoOAExecutionEvent):
            return Resultado(ok=True, valor=_evento_do_venue(resposta))
        if isinstance(resposta, ProtoOAOrderErrorEvent):
            # A recusa de ordem do venue e' um `ProtoOAOrderErrorEvent` (o `ProtoOAErrorRes` do pedido). Traduzimo-la
            # para a FORMA do desfecho — `ORDER_REJECTED` e' o nome que o PROPRIO venue da' a esta mensagem, e a
            # palavra DELE (o `errorCode`) vai intacta em `resposta_do_venue`, sem traducao (RN-CT42).
            return Resultado(ok=True, valor=_evento_do_erro_do_venue(resposta))
        return _falhou(
            "resposta_inesperada",
            f"o venue respondeu {type(resposta).__name__}, que nao e' um evento de execucao — nao se adivinha o desfecho",
        )


# -----------------------------------------------------------------------------------------------------------
# AS CONVERSOES. Cada uma tira o tipo da biblioteca e devolve um dicionario com os nomes do CONTRATO. E' aqui
# que a fronteira se cumpre: depois desta linha, ninguem la' dentro sabe que existe uma biblioteca.
# -----------------------------------------------------------------------------------------------------------


def _conta_resumida(conta: Any) -> dict[str, Any]:
    return {
        "conta": conta.account_id,
        "e_real": conta.is_live,
        "login": conta.trader_login,
        "corretora": conta.broker_name,
        "ultimo_negocio_ms": conta.last_closing_deal_timestamp,
        "ultima_alteracao_de_saldo_ms": conta.last_balance_update_timestamp,
    }


def _nome_do_enum(valor: Any) -> Any:
    """Um ENUM da biblioteca -> o nome simples (`FULL_ACCESS`), que e' o que a fronteira (D2) publica.

    O que nao for enum passa tal como veio — esta funcao nao adivinha, so' despe o embrulho do enum.
    """
    nome = getattr(valor, "value", None)
    return nome if nome is not None else valor


#: O MAPA DECLARADO do `tradingMode` do SIMBOLO: o MEMBRO da biblioteca (`TradingMode`) -> o NOME do proto
#: (`ProtoOATradingMode`), que e' o vocabulario que ATRAVESSA a fronteira (D2).
#:
#: PORQUE UM MAPA, E NAO `.value`/`.name` (MEDIDO a 05/10/2026, `enums.py:112`): nesta biblioteca o `.value` de
#: TRES dos QUATRO membros NAO e' o nome do proto — `TradingMode.DISABLED_WITHOUT_PENDINGS_EXECUTION.value ==
#: "DISABLED_WITHOUT_PENDINGS"` e `TradingMode.CLOSE_ONLY.value == "CLOSE_ONLY"`, enquanto o proto (e o conjunto
#: FECHADO do `fecho.py`: `MODOS_DE_NEGOCIACAO_CONHECIDOS`) escrevem `DISABLED_WITHOUT_PENDINGS_EXECUTION` e
#: `CLOSE_ONLY_MODE`. Nem `.value` nem `.name` servem sozinhos (o `.name` do membro do meio casa, o do
#: `CLOSE_ONLY` NAO). Este mapa e' a UNICA traducao, num so' sitio — e um membro que aqui nao esteja RECUSA
#: pelo NOME, nunca por um valor adivinhado.
MODOS_DE_NEGOCIACAO_POR_MEMBRO: dict[TradingMode, str] = {
    TradingMode.ENABLED: "ENABLED",
    TradingMode.DISABLED_WITHOUT_PENDINGS_EXECUTION: "DISABLED_WITHOUT_PENDINGS_EXECUTION",
    TradingMode.DISABLED_WITH_PENDINGS_EXECUTION: "DISABLED_WITH_PENDINGS_EXECUTION",
    TradingMode.CLOSE_ONLY: "CLOSE_ONLY_MODE",
}

#: O conjunto FECHADO dos NOMES do proto — o vocabulario da fronteira. Sai do mapa acima (um so' dono da verdade).
MODOS_DE_NEGOCIACAO_DO_PROTO = frozenset(MODOS_DE_NEGOCIACAO_POR_MEMBRO.values())


def _nome_do_modo_de_negociacao(valor: Any) -> str | None:
    """O `tradingMode` da biblioteca -> o NOME do proto (`DISABLED_WITHOUT_PENDINGS_EXECUTION`, `CLOSE_ONLY_MODE`).

    Aceita o MEMBRO (`TradingMode`) e, por tolerancia de fronteira, um texto JA' na forma do proto (o nome do
    venue passa como veio). Tudo o resto devolve `None` — e quem chama RECUSA pelo nome; aqui nao se le' o
    `.value`/`.name` do membro, porque nesta biblioteca eles divergem do proto (ver o comentario do mapa).
    """
    if isinstance(valor, TradingMode):
        return MODOS_DE_NEGOCIACAO_POR_MEMBRO.get(valor)
    if isinstance(valor, str) and valor in MODOS_DE_NEGOCIACAO_DO_PROTO:
        return valor
    return None


def _multiplicador_de_alavancagem(conta: Any) -> float:
    """`Account.get_leverage()` devolve `1:N` -> o multiplicador `N` como numero (o que o manifesto exige).

    A biblioteca JA' desfez o `leverageInCents` do venue; o que ela entrega e' TEXTO (`"1:30"`). MEDIDO a
    05/10/2026, na primeira vez que a porta 8 chegou a ler a conta (45292558, Pepperstone): o `float()` directo
    sobre essa string rebentava com `ValueError: could not convert string to float: '1:30'` e derrubava o
    arranque. Nao se inventa a unidade: parte-se a saida do proprio helper no `:` e publica-se o lado direito.
    """
    texto = str(conta.get_leverage())
    if ":" in texto:
        return float(texto.rsplit(":", 1)[1])
    return float(texto)


def _expoente_do_trader(resposta: Any) -> int | None | Resultado:
    """O `moneyDigits` do VENUE (`ProtoOATraderRes.trader.moneyDigits`) -> o expoente, ou `None` AUSENTE (D2).

    proto3 deixa um escalar NAO posto a `0`, e `0` NAO distingue «o venue disse zero» de «nao disse» — a propria
    biblioteca o trata como ausente (`money_divisor`/`DEFAULT_MONEY_DIGITS`). Aqui nao se adivinha: `0` (e o
    ausente) ficam `None`, e a leitura cai na POSICAO como segunda fonte (e sem nenhuma, RECUSA). NAO se usa o
    `DEFAULT_MONEY_DIGITS = 2` da biblioteca: ele e' o que ela faz quando o venue NAO diz, e o venue diz. Uma
    resposta que nao seja o `ProtoOATraderRes` esperado RECUSA — nao se le' um `moneyDigits` de outra mensagem.
    """
    if not isinstance(resposta, ProtoOATraderRes):
        return _falhou(
            "resposta_inesperada",
            f"o pedido do trader respondeu {type(resposta).__name__}, que nao e' um `ProtoOATraderRes`: nao se "
            "adivinha o `moneyDigits` de outra mensagem",
        )
    digitos = resposta.trader.money_digits
    if isinstance(digitos, bool) or not isinstance(digitos, int) or digitos <= 0:
        return None
    return digitos


def _conta_por_dentro(conta: Any, expoente_dos_valores: int | None, saldo_escalado: int | None) -> dict[str, Any]:
    # O EXPOENTE DO DINHEIRO VEM DO VENUE (FECHADO D2 a 05/10/2026). O modelo `Account` da biblioteca NAO traz
    # `money_digits` (ela usa-o e deita-o fora: `models/account.py:143` faz `money_divisor(proto.money_digits)`
    # e nao o guarda), mas o PROTO tem-no — e por isso `Transporte.trader` pergunta-o por `ProtoOATraderReq` e
    # passa-o aqui. Nao se inventa um expoente: o que o venue NAO disse fica `None` (a leitura cai na POSICAO
    # como segunda fonte, e sem nenhuma RECUSA — `leitura._expoente_dos_valores`).
    # O SALDO E' O INTEIRO ESCALADO DO VENUE (D3, FECHADO a 05/10/2026): `conta.balance` do modelo da
    # biblioteca ja' vem DIVIDIDO por `10^moneyDigits` (`models/account.py:143`) e a leitura espera o INTEIRO
    # escalado (`/10^moneyDigits` e' ela que faz). Publicar o `Decimal` ja' dividido era uma unidade trocada no
    # caminho do dinheiro (medido ao vivo: `a conta nao declarou o saldo legivel (veio Decimal('49997.58'))`) —
    # por isso o saldo vem do `ProtoOATrader.balance` CRU, o mesmo numero que o venue publica.
    return {
        "conta": conta.account_id,
        "saldo": saldo_escalado,
        "expoente_dos_valores": expoente_dos_valores,
        "alavancagem_em_centesimos": conta.leverage_in_cents,
        # A alavancagem JA' TRADUZIDA, pelo helper da propria biblioteca (`Account.get_leverage`) — a unidade e'
        # uma armadilha do venue (`leverageInCents`), e quem a desfaz e' quem a escreveu. O helper devolve o
        # multiplicador em forma TEXTUAL `1:N` (medido a 05/10/2026, na 45292558/Pepperstone: `"1:30"`); o
        # `float()` que aqui estava rebentava com `ValueError` e matava a porta 8 antes de ela concluir — o
        # numero que o manifesto exige POSITIVO (`sonda.py`) e' o `N`, e e' ele que se publica.
        "alavancagem": _multiplicador_de_alavancagem(conta),
        "alavancagem_maxima": conta.max_leverage,
        # O `accountType` do venue vem como ENUM da biblioteca, e NAO como texto. MEDIDO a 05/10/2026:
        # `conta.account_type` e' `AccountType.HEDGED`, cujo `str()` e' `'AccountType.HEDGED'` (a classe
        # do enum, nao o valor) e cujo `.value` e' `'HEDGED'`. O `sonda.py` compara este valor com o mapa
        # FECHADO `MODELO_DE_POSICAO` (`HEDGED`/`NETTED`); passado o enum cru, `str(...)` dava
        # `'AccountType.HEDGED'`, a comparacao caia SEMPRE no ramo de recusa e `montar_manifesto` levantava
        # `ValueError` a meio da sonda — o manifesto nunca era publicado. A fronteira (D2) exige o nome
        # simples, como nos `direitos` logo abaixo: `_nome_do_enum` despe o embrulho.
        "tipo_de_conta": _nome_do_enum(conta.account_type),
        # O `accessRights` do venue vem como ENUM da biblioteca (medido a 05/10/2026: `AccessRights.FULL_ACCESS`);
        # a porta da identidade (`identidade.conferir_direitos`) compara STRINGS contra um conjunto FECHADO, e um
        # enum nao e' `str` — passava-o cru e a conta era recusada por um direito que estava certo. A fronteira
        # (D2) exige o nome simples.
        "direitos": _nome_do_enum(conta.access_rights),
        "risco_limitado": conta.is_limited_risk,
        "moeda_de_deposito": conta.deposit_asset_id,
        "sem_swap": conta.swap_free,
        "corretora": conta.broker_name,
        "registo_ms": conta.registration_timestamp,
    }


def _simbolo_do_universo(simbolo: Any) -> dict[str, Any]:
    return {
        "symbol_id": simbolo.symbol_id,
        "nome": simbolo.name,
        "habilitado": simbolo.enabled,
        "descricao": simbolo.description,
        "deslistado": None,  # a biblioteca nao expoe `includeArchivedSymbols` — ausente, e nao `False`
    }


def _comissao_do_simbolo(comissao: Any) -> dict[str, Any]:
    """A comissao do simbolo (modelo `Commission` da biblioteca) -> um dicionario do CONTRATO.

    Os DOIS enums da comissao (`CommissionType`, `MinCommissionType`) atravessam como CADEIA do vocabulario
    (`USD_PER_LOT`, `QUOTE_CURRENCY`) — a fronteira (D2) nao deixa passar o modelo cru (era o unico sitio onde
    um tipo da biblioteca atravessava a fronteira inteiro). O `rate`/`minimum` sao `Decimal` e viajam como TEXTO
    do venue: a unidade deles e' declarada pelo `type`/`minimum_type`, e nao se converte aqui.
    """
    return {
        "type": _nome_do_enum(comissao.type),
        "rate": str(comissao.rate),
        "minimum": str(comissao.minimum),
        "minimum_type": _nome_do_enum(comissao.minimum_type),
        "minimum_asset": comissao.minimum_asset,
    }


def _simbolo_por_dentro(simbolo: Any) -> dict[str, Any] | Resultado:
    """Os numeros do simbolo, com os ENUMS ja' na forma do proto (D1/D2). RECUSA NOMEADA fora do mapa.

    O `tradingMode` NAO atravessa como o membro da biblioteca: passa pelo MAPA DECLARADO
    (`MODOS_DE_NEGOCIACAO_POR_MEMBRO`) e sai como o NOME do proto. Um membro que nao esteja no mapa RECUSA o
    simbolo INTEIRO pelo nome (`modo_de_negociacao_desconhecido`) — nunca se adivinha o nome pelo `.value`/`.name`.
    """
    modo = _nome_do_modo_de_negociacao(simbolo.trading_mode)
    if modo is None:
        return _falhou(
            "modo_de_negociacao_desconhecido",
            f"o simbolo {simbolo.name!r} declara `tradingMode` = {simbolo.trading_mode!r}, um membro fora do mapa "
            f"declarado ({sorted(MODOS_DE_NEGOCIACAO_DO_PROTO)}): um modo que nao se le' nao vira «abre», e o "
            "vocabulario da fronteira e' o NOME do proto — nao se adivinha pelo `.value`/`.name` da biblioteca",
        )
    return {
        "symbol_id": simbolo.symbol_id,
        "digitos": simbolo.digits,
        "posicao_do_pip": simbolo.pip_position,
        "tamanho_do_lote": simbolo.lot_size,
        "minimo": simbolo.min_volume,
        "maximo": simbolo.max_volume,
        "passo": simbolo.step_volume,
        "modo_de_negociacao": modo,
        "swap_longo": simbolo.swap_long,
        "swap_curto": simbolo.swap_short,
        "comissao": _comissao_do_simbolo(simbolo.commission),
        "exposicao_maxima": simbolo.max_exposure,
        "escalao_de_alavancagem": simbolo.leverage_id,
        "permite_venda": simbolo.enable_short_selling,
        "stop_garantido": simbolo.guaranteed_stop_loss,
        "distancia_minima_do_stop": simbolo.sl_distance,
        "distancia_minima_do_alvo": simbolo.tp_distance,
        "unidades_de_medida": simbolo.measurement_units,
        "fuso": simbolo.schedule_timezone,
        # O que a doc declara e este modelo NAO traz, dito: `gsl_distance`, `gsl_charge`, `holiday`,
        # `commission_type`, `min_commission`, `charge_swap_at_weekends`, `swap_calculation_type`,
        # `distance_set_in`. Ausente fica ausente (D4): nao vira zero, nem `False`, nem `0.0`.
    }


def _texto_do_decimal(valor: Any) -> Any:
    """Um `Decimal` do venue -> o TEXTO do contrato (`format(..., 'f')`); o resto passa. JSON-safe (D2/D3).

    Os modelos da biblioteca trazem o DINHEIRO ja' dividido por `10^moneyDigits` (nao o inteiro escalado do
    contrato), e um `Decimal` nao e' JSON. Publica-se o texto — o valor do venue, sem perder casas e sem
    virgula flutuante binaria. Um `None` continua `None`.
    """
    if isinstance(valor, Decimal):
        return format(valor, "f")
    return valor


def _vela(vela: Any) -> dict[str, Any]:
    return {
        "instante_ms": vela.timestamp,
        "periodo": _nome_do_enum(vela.period),
        "abertura": vela.open,
        "maximo": vela.high,
        "minimo": vela.low,
        "fecho": vela.close,
        "volume_em_ticks": vela.volume,
    }


def _posicao(posicao: Any) -> dict[str, Any]:
    # AS UNIDADES DO CONTRATO (D3/D2): os precos do modelo da biblioteca sao `Decimal` em unidades reais
    # (`1.12107`); o contrato usa INTEIROS RELATIVOS (1/100000, como o `_evento_do_venue` ja' publica) — e a
    # LEITURA le'-os por `_inteiro`. O dinheiro (margem/swap/comissao) sai em TEXTO (o modelo ja' o traz
    # dividido; nada o consome como inteiro escalado aqui). Os instantes saem em millis (uma `datetime` nao e'
    # JSON). Sem isto, a leitura de uma posicao viva RECUSARIA e o desfecho nem se escrevia.
    return {
        "posicao": posicao.position_id,
        "symbol_id": posicao.symbol_id,
        "lado": _nome_do_enum(posicao.side),
        "volume": posicao.volume,
        "preco_de_entrada": _escalado_do_preco(posicao.entry_price),
        "estado": _nome_do_enum(posicao.status),
        "aberta_ms": _instante_do_evento_ms(posicao.open_timestamp),
        "expoente": posicao.money_digits,
        "stop": _escalado_do_preco(posicao.stop_loss),
        "alvo": _escalado_do_preco(posicao.take_profit),
        "margem_empenhada": _texto_do_decimal(posicao.used_margin),
        "taxa_de_margem": _texto_do_decimal(posicao.margin_rate),
        "swap": _texto_do_decimal(posicao.swap),
        "comissao": _texto_do_decimal(posicao.commission),
        "marca": posicao.label,
        "comentario": posicao.comment,
    }


def _ordem(ordem: Any) -> dict[str, Any]:
    # OS PRECOS EM INTEIROS RELATIVOS (1/100000), como a leitura os le' (`_preco_da_ordem`), e os instantes em
    # millis — o modelo da biblioteca da' `Decimal`/`datetime`, que o contrato nao aceita e o JSON nao escreve.
    return {
        "ordem": ordem.order_id,
        "symbol_id": ordem.symbol_id,
        "lado": _nome_do_enum(ordem.side),
        "tipo": _nome_do_enum(ordem.order_type),
        "estado": _nome_do_enum(ordem.status),
        "volume": ordem.volume,
        "volume_executado": ordem.executed_volume,
        "preco_de_execucao": _escalado_do_preco(ordem.execution_price),
        "limite": _escalado_do_preco(ordem.limit_price),
        "stop": _escalado_do_preco(ordem.stop_price),
        "posicao": ordem.position_id,
        "e_fecho": ordem.is_closing_order,
        "e_stop_out": ordem.is_stop_out,
        "marca_do_cliente": ordem.client_order_id,
        "stop_relativo": ordem.relative_stop_loss,
        "alvo_relativo": ordem.relative_take_profit,
        "desvio_em_pontos": ordem.slippage_in_points,
        "preco_base_do_desvio": _escalado_do_preco(ordem.base_slippage_price),
        "aberta_ms": _instante_do_evento_ms(ordem.open_timestamp),
        "expira_ms": _instante_do_evento_ms(ordem.expiration_timestamp),
    }


def _negocio(negocio: Any) -> dict[str, Any]:
    return {
        "negocio": negocio.deal_id,
        "ordem": negocio.order_id,
        "posicao": negocio.position_id,
        "symbol_id": negocio.symbol_id,
        "lado": _nome_do_enum(negocio.side),
        "volume": negocio.volume,
        "volume_preenchido": negocio.filled_volume,
        "preco": _escalado_do_preco(negocio.execution_price),
        "instante_ms": _instante_do_evento_ms(negocio.execution_timestamp),
        "estado": _nome_do_enum(negocio.status),
        "comissao": _texto_do_decimal(negocio.commission),
        "taxa_de_margem": _texto_do_decimal(negocio.margin_rate),
        "detalhe_do_fecho": _detalhe_do_fecho(negocio.close_detail),
    }


def _detalhe_do_fecho(detalhe: Any) -> dict[str, Any] | None:
    """O `close_detail` do negocio de fecho: o resultado, do venue (RN-CT41). Ausente quando nao e' fecho.

    Os campos do modelo sao `Decimal` — saem em TEXTO (JSON-safe), sem perder casas.
    """
    if detalhe is None:
        return None
    campos = getattr(detalhe, "model_fields", None)
    if campos is None:
        return {"_bruto": str(detalhe)}
    return {nome: _texto_do_decimal(getattr(detalhe, nome)) for nome in campos}


def _nao_realizado(linha: Any) -> dict[str, Any]:
    return {
        "posicao": linha.position_id,
        "bruto": _texto_do_decimal(linha.gross_unrealized_pnl),
        "liquido": _texto_do_decimal(linha.net_unrealized_pnl),
    }


# -----------------------------------------------------------------------------------------------------------
# O ENVIO: a accao do venue -> o pedido da biblioteca, e o evento do venue -> o dicionario do contrato.
# Nenhum tipo da biblioteca atravessa esta fronteira (D2): o que sai daqui sao inteiros e nomes do CONTRATO.
# -----------------------------------------------------------------------------------------------------------


def _inteiro_do_venue(valor: Any) -> int | None:
    """O valor QUANDO e' um inteiro de verdade. `True`/`False` NAO sao inteiros aqui (sao booleanos)."""
    if isinstance(valor, bool) or not isinstance(valor, int):
        return None
    return valor


def _escalado_do_preco(valor: Any) -> int | None:
    """Um preco do venue (duplo, em unidades de preco) -> o inteiro relativo do contrato (1/100000).

    O protobuf viaja o preco como duplo (`1.085`) e o dicionario do contrato como inteiro (`108500`). A conta e'
    de DECIMAL sobre a representacao textual do duplo — nunca virgula flutuante binaria a acumular erro.
    """
    if valor is None or valor == 0:
        return None
    try:
        relativo = Decimal(str(valor)) * Decimal(ESCALA_DO_PRECO)
    except (InvalidOperation, ValueError):
        return None
    return int(relativo.to_integral_value())


def _preco_do_venue(inteiro: int) -> Decimal:
    """O inteiro relativo do contrato (1/100000) -> o preco em unidades que o modelo da biblioteca pede."""
    return Decimal(inteiro) / Decimal(ESCALA_DO_PRECO)


def _instante_do_evento_ms(valor: Any) -> int | None:
    """O instante do VENUE que a biblioteca pos no evento (`datetime` UTC) -> millis — ou `None`.

    A biblioteca carimba `timestamp_to_datetime(proto.timestamp)` — os millis do venue — e, quando o venue NAO
    o manda, cai para `datetime.now(UTC)` (`events/router.py:155`): nesse caso o carimbo e' NOSSO e nao do venue.
    Aqui so' se le'-o (nao se distingue o carimbo do venue do de recurso), e um valor que nao seja `datetime`
    NAO vira um instante inventado — fica `None`, e o retrato nao se carimba com o nosso relogio.
    """
    if isinstance(valor, datetime):
        return int(valor.timestamp() * 1000)
    return None


def _nome_do_proto(valor: Any, classe: Any = None) -> Any:
    """Um campo-ENUM do protobuf -> o NOME simples (`BUY`, `MARKET`, `FILLED`). Fora do repertorio, o inteiro.

    DOIS CASOS, porque o betterproto os da' assim (MEDIDO a 05/10/2026): um enum posto no objecto e' um membro
    (com `.name`), mas o MESMO campo LIDO DO FIO volta como INTEIRO (`ProtoOAExecutionEvent().parse(raw)
    .execution_type` -> `3`). Por isso a CLASSE do enum entra como parametro: e' ela que vira o inteiro no nome,
    e um inteiro de um enum que nao se sabe ler fica inteiro (o `desfecho.py` recusa-o por
    `valor_fora_do_conjunto`, fail-closed — nunca se adivinha a palavra). Sem a classe, um inteiro nao vira nome.
    """
    nome = getattr(valor, "name", None)
    if isinstance(nome, str):
        return nome
    if isinstance(valor, int) and not isinstance(valor, bool) and isinstance(classe, type):
        try:
            return classe(valor).name
        except ValueError:
            return valor
    return valor


def _status_da_ordem(valor: Any) -> Any:
    """O `orderStatus` do venue: o protobuf escreve `ORDER_STATUS_FILLED`, o contrato escreve `FILLED`."""
    nome = _nome_do_proto(valor, ProtoOAOrderStatus)
    if isinstance(nome, str) and nome.startswith("ORDER_STATUS_"):
        return nome[len("ORDER_STATUS_") :]
    return nome


def _pedido_de_abertura(accao: Any) -> NewOrderRequest | Resultado:
    """A accao PRONTA do `ordens.py` -> o `NewOrderRequest` da biblioteca, ou uma recusa NOMEADA.

    Nao se confere banda nenhuma aqui (isso e' do `ordens.py`, e ja' foi feito): confere-se a FORMA dos campos
    que o pedido da biblioteca obriga, e o resto viaja como veio.
    """
    if not isinstance(accao, dict):
        return _falhou("formato_invalido", f"a accao de abertura nao e' um objecto (veio {type(accao).__name__})")

    symbol_id = _inteiro_do_venue(accao.get("symbolId"))
    if symbol_id is None:
        return _falhou("campo_obrigatorio_ausente", f"a accao nao traz `symbolId` utilizavel ({accao.get('symbolId')!r})")
    lado = LADO_POR_NOME.get(accao.get("tradeSide"))
    if lado is None:
        return _falhou("valor_fora_do_conjunto", f"a accao traz `tradeSide` = {accao.get('tradeSide')!r}, fora de BUY/SELL")
    tipo = TIPO_POR_NOME.get(accao.get("orderType"))
    if tipo is None:
        return _falhou("valor_fora_do_conjunto", f"a accao traz `orderType` = {accao.get('orderType')!r}, que este verbo nao conhece")
    volume = _inteiro_do_venue(accao.get("volume"))
    if volume is None or volume <= 0:
        return _falhou("campo_obrigatorio_ausente", f"a accao nao traz `volume` (0,01 de unidade) utilizavel ({accao.get('volume')!r})")
    tif = TIF_POR_NOME.get(accao.get("timeInForce"))
    if tif is None:
        return _falhou("valor_fora_do_conjunto", f"a accao traz `timeInForce` = {accao.get('timeInForce')!r}, fora de FOK/IOC/GTC")

    campos: dict[str, Any] = {
        "symbol_id": symbol_id,
        "side": lado,
        "volume": volume,
        "order_type": tipo,
        "time_in_force": tif,
    }
    marca = accao.get("clientOrderId")
    if isinstance(marca, str) and marca != "":
        campos["client_order_id"] = marca
    desvio = _inteiro_do_venue(accao.get("slippageInPoints"))
    if desvio is not None:
        campos["slippage_in_points"] = desvio
    base = _inteiro_do_venue(accao.get("baseSlippagePrice"))
    if base is not None:
        campos["base_slippage_price"] = _preco_do_venue(base)
    for chave_do_venue, campo_do_pedido in (
        ("relativeStopLoss", "relative_stop_loss"),
        ("relativeTakeProfit", "relative_take_profit"),
    ):
        relativo = _inteiro_do_venue(accao.get(chave_do_venue))
        if relativo is not None:
            campos[campo_do_pedido] = _preco_do_venue(relativo)
    for chave_do_venue, campo_do_pedido in (("limitPrice", "limit_price"), ("stopPrice", "stop_price")):
        preco = _inteiro_do_venue(accao.get(chave_do_venue))
        if preco is not None:
            campos[campo_do_pedido] = _preco_do_venue(preco)
    return NewOrderRequest(**campos)


def _e_desta_ordem(evento: dict[str, Any], marca: Any, ordem_id: int | None) -> bool:
    """A execucao e' DESTA ordem? Casa pela MARCA do cliente (`clientOrderId`) ou pelo ID da ordem.

    A marca e' a ligacao que sobrevive (o `ordem_id` so' existe depois de o venue o atribuir): casa-se por
    qualquer das duas, e pelo NEGOCIO quando a ordem nao vem no evento. Um evento que nao case NAO se usa —
    seguir o preenchimento de OUTRA ordem seria publicar numeros que nao sao desta boleta.
    """
    ordem = evento.get("order")
    if isinstance(ordem, dict):
        if isinstance(ordem_id, int) and not isinstance(ordem_id, bool) and ordem.get("orderId") == ordem_id:
            return True
        if isinstance(marca, str) and marca != "" and ordem.get("clientOrderId") == marca:
            return True
    negocio = evento.get("deal")
    if isinstance(negocio, dict) and isinstance(ordem_id, int) and not isinstance(ordem_id, bool):
        if negocio.get("orderId") == ordem_id:
            return True
    return False


def _evento_do_venue(evento: Any) -> dict[str, Any]:
    """O `ProtoOAExecutionEvent` do VENUE -> o dicionario que o `desfecho.py`/`processo.py` consomem.

    PORQUE NAO SE USA O `ExecutionEvent` DA BIBLIOTECA (MEDIDO a 05/10/2026): `execution_event_from_proto`
    achata o evento e DESCARTA `order`/`position`/`deal`. Medido: um `ORDER_FILLED` achatado da' um desfecho
    que o contrato RECUSA (resolucao sem `margem_empenhada`) e nenhuma linha sai. Aqui le'em-se os
    sub-objectos do venue, e cada um vira um dicionario de INTEIROS/NOMES — nenhum tipo da biblioteca passa.
    """
    dicionario: dict[str, Any] = {}
    tipo = _nome_do_proto(evento.execution_type, ProtoOAExecutionType)
    if tipo is not None:
        dicionario["executionType"] = tipo
    if evento.error_code:
        dicionario["errorCode"] = str(evento.error_code)
    if betterproto.serialized_on_wire(evento.order):
        dicionario["order"] = _ordem_do_evento(evento.order)
    if betterproto.serialized_on_wire(evento.position):
        dicionario["position"] = _posicao_do_evento(evento.position)
    if betterproto.serialized_on_wire(evento.deal):
        dicionario["deal"] = _negocio_do_evento(evento.deal)
    return dicionario


def _ordem_do_evento(ordem: Any) -> dict[str, Any]:
    """O `order` do evento -> os campos que a costura le'. So' entra o que o venue deu (ausente fica ausente)."""
    dados: dict[str, Any] = {}
    for chave, valor in (
        ("orderId", ordem.order_id),
        ("symbolId", ordem.trade_data.symbol_id),
        ("volume", ordem.trade_data.volume),
        ("executedVolume", ordem.executed_volume),
        ("positionId", ordem.position_id),
        ("slippageInPoints", ordem.slippage_in_points),
        ("relativeStopLoss", ordem.relative_stop_loss),
        ("relativeTakeProfit", ordem.relative_take_profit),
    ):
        inteiro = _inteiro_do_venue(valor)
        if inteiro is not None and inteiro != 0:
            dados[chave] = inteiro
    for chave, valor in (("executionPrice", ordem.execution_price), ("limitPrice", ordem.limit_price), ("stopPrice", ordem.stop_price), ("baseSlippagePrice", ordem.base_slippage_price)):
        escalado = _escalado_do_preco(valor)
        if escalado is not None:
            dados[chave] = escalado
    if ordem.trade_data.trade_side:
        dados["tradeSide"] = _nome_do_proto(ordem.trade_data.trade_side, ProtoOATradeSide)
    if ordem.order_type:
        dados["orderType"] = _nome_do_proto(ordem.order_type, ProtoOAOrderType)
    if ordem.order_status:
        dados["orderStatus"] = _status_da_ordem(ordem.order_status)
    if ordem.client_order_id:
        dados["clientOrderId"] = ordem.client_order_id
    return dados


def _posicao_do_evento(posicao: Any) -> dict[str, Any]:
    """O `position` do evento -> o dicionario. E' daqui que saem `usedMargin`/`marginRate`/`moneyDigits`."""
    dados: dict[str, Any] = {}
    for chave, valor in (
        ("positionId", posicao.position_id),
        ("symbolId", posicao.trade_data.symbol_id),
        ("volume", posicao.trade_data.volume),
        ("usedMargin", posicao.used_margin),
        ("marginRate", posicao.margin_rate),
        ("moneyDigits", posicao.money_digits),
        ("swap", posicao.swap),
        ("commission", posicao.commission),
    ):
        inteiro = _inteiro_do_venue(valor)
        if inteiro is not None and inteiro != 0:
            dados[chave] = inteiro
    if posicao.trade_data.trade_side:
        dados["tradeSide"] = _nome_do_proto(posicao.trade_data.trade_side, ProtoOATradeSide)
    return dados


def _negocio_do_evento(negocio: Any) -> dict[str, Any]:
    """O `deal` do evento -> o dicionario: o preco, o volume preenchido, a comissao e o detalhe do fecho."""
    dados: dict[str, Any] = {}
    for chave, valor in (
        ("dealId", negocio.deal_id),
        ("orderId", negocio.order_id),
        ("positionId", negocio.position_id),
        ("symbolId", negocio.symbol_id),
        ("volume", negocio.volume),
        ("filledVolume", negocio.filled_volume),
        ("commission", negocio.commission),
        ("marginRate", negocio.margin_rate),
        ("executionTimestamp", negocio.execution_timestamp),
    ):
        inteiro = _inteiro_do_venue(valor)
        if inteiro is not None and inteiro != 0:
            dados[chave] = inteiro
    preco = _escalado_do_preco(negocio.execution_price)
    if preco is not None:
        dados["executionPrice"] = preco
    if negocio.trade_side:
        dados["tradeSide"] = _nome_do_proto(negocio.trade_side, ProtoOATradeSide)
    if negocio.deal_status:
        dados["dealStatus"] = _nome_do_proto(negocio.deal_status, ProtoOADealStatus)
    if betterproto.serialized_on_wire(negocio.close_position_detail):
        dados["closePositionDetail"] = _detalhe_do_fecho_do_evento(negocio.close_position_detail)
    return dados


def _detalhe_do_fecho_do_evento(detalhe: Any) -> dict[str, Any]:
    """O `closePositionDetail` do negocio de fecho: o resultado, do VENUE (RN-CT41). Inteiros escalados como vieram."""
    dados: dict[str, Any] = {}
    for chave in (
        "entry_price",
        "gross_profit",
        "swap",
        "commission",
        "balance",
        "closed_volume",
        "balance_version",
        "money_digits",
        "pnl_conversion_fee",
        "quote_to_deposit_conversion_rate",
    ):
        valor = getattr(detalhe, chave, None)
        if isinstance(valor, bool) or valor in (None, 0):
            continue
        dados[chave] = valor if isinstance(valor, int) else str(valor)
    return dados


def _evento_do_erro_do_venue(erro: Any) -> dict[str, Any]:
    """O `ProtoOAOrderErrorEvent` do venue -> a forma do desfecho, com a PALAVRA dele intacta (RN-CT42).

    `ORDER_REJECTED` e' o nome que o proprio venue da' a esta mensagem — o `errorCode` e a `description` vao
    sem traducao, e o `desfecho.py` classifica `recusado` com motivo do conjunto FECHADO do contrato.
    """
    dicionario: dict[str, Any] = {"executionType": "ORDER_REJECTED"}
    codigo = getattr(erro, "error_code", None)
    if codigo:
        dicionario["errorCode"] = str(codigo)
    descricao = getattr(erro, "description", None)
    if descricao:
        dicionario["description"] = str(descricao)
    posicao = getattr(erro, "position_id", None)
    if isinstance(posicao, int) and not isinstance(posicao, bool) and posicao:
        dicionario["position"] = {"positionId": posicao}
    return dicionario


def registar_evento(
    transporte: Transporte,
    tipo_do_evento: type,
    tratador: Callable[[Any], Awaitable[None]],
    account_id: int | None = None,
) -> bool:
    """Liga um tratador a um evento do venue, pelo TIPO do evento (e' assim que a biblioteca o faz).

    O tratador e' ASSINCRONO — a biblioteca espera um `Awaitable` (medido: um tratador sincrono nao serve, e o
    erro so' apareceria em execucao, no meio de um acontecimento). Quem chama passa um `async def`.

    Devolve `False` quando nao ha' cliente ou o tipo nao serve — e quem chamou decide o que faz com isso: aqui
    nao se inventa um tratador que nunca dispara.
    """
    if transporte._cliente is None:  # noqa: SLF001 (e' o embrulho: ninguem mais toca no cliente)
        return False
    try:
        transporte._cliente.register_handler(tipo_do_evento, tratador, account_id=account_id)  # noqa: SLF001
        return True
    except Exception:
        return False
