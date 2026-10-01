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

O `expires_at` DAS CREDENCIAIS: o ficheiro do dono tem os quatro valores e mais nada, e o instante de expiracao
nao esta' entre eles. Passa-se `0.0`, que quer dizer «expirado» — e' de proposito: o arranque obriga a um
refresh, o venue roda o par, e o `save()` reescreve os ficheiros. E' o comportamento que o RN-CT10 descreve, e
e' assim que a rotacao se ve' a acontecer em demonstracao em vez de se supor. [a confirmar em demo]
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Awaitable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ctrader_api_client import AccountCredentials, AuthTrigger, ClientConfig, CTraderClient, TokenStore
from ctrader_api_client.composition import build_graph

#: Quando a biblioteca nao tem prazo declarado, o pedido espera por este tempo. E' um VALOR DECLARADO do
#: conector (a ficha nao o traz ainda; entra na proxima fatia com chave propria, research R9).
PRAZO_DE_PEDIDO_POR_OMISSAO_S = 15.0


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


class Transporte:
    """O fio e a sessao da conta. Um por (corretora, conta), como manda o RN-C16."""

    def __init__(self, url_da_api: str, client_id: str, client_secret: str) -> None:
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
        try:
            self._laco.rodar(self._cliente.__aenter__())  # type: ignore[union-attr]
            self._laco.rodar(self._grafo.auth.authenticate_app())
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

    def fechar(self) -> None:
        if self._cliente is not None:
            try:
                self._laco.rodar(self._cliente.__aexit__(None, None, None))
            except Exception:
                pass  # fechar nunca rebenta o processo que esta' a desligar-se
        self._laco.parar()

    # ---- o que a sonda e a leitura pedem -------------------------------------------------------------------
    def contas(self, access_token: str) -> Resultado:
        """A lista de contas deste token — e' daqui que sai a prova de identidade (FR-049)."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        try:
            contas = self._laco.rodar(self._grafo.accounts.list_by_token(access_token))
        except Exception as erro:
            return _falhou("falha_ao_ler_as_contas", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_conta_resumida(c) for c in contas])

    def trader(self, account_id: int) -> Resultado:
        """A conta por dentro: saldo, alavancagem, direitos, tipo (o que a porta da identidade confere)."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        try:
            conta = self._laco.rodar(self._grafo.accounts.get_trader(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_a_conta", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=_conta_por_dentro(conta))

    def simbolos(self, account_id: int) -> Resultado:
        """O UNIVERSO: id, nome e se esta' habilitado. O `includeArchivedSymbols` da doc nao esta' exposto pela
        biblioteca — os deslistados que ela nao der ficam declarados como ausentes (RN-CT18, achado da sonda)."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        try:
            simbolos = self._laco.rodar(self._grafo.symbols.list_all(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_o_universo", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_simbolo_do_universo(s) for s in simbolos])

    def simbolos_por_id(self, account_id: int, ids: list[int]) -> Resultado:
        """Os numeros de cada simbolo: o que o manifesto publica (minimos, passo, digitos, distancias)."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        try:
            simbolos = self._laco.rodar(self._grafo.symbols.get_by_ids(account_id, ids))
        except Exception as erro:
            return _falhou("falha_ao_ler_os_simbolos", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_simbolo_por_dentro(s) for s in simbolos])

    def velas(self, account_id: int, symbol_id: int, periodo: str, de: Any, ate: Any) -> Resultado:
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
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
        try:
            self._laco.rodar(self._grafo.market_data.subscribe_spots(account_id, ids))
        except Exception as erro:
            return _falhou("falha_ao_subscrever_spots", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=f"{len(ids)} simbolo(s) subscritos para spots")

    # ---- o que a leitura e o desfecho pedem ----------------------------------------------------------------
    def posicoes(self, account_id: int) -> Resultado:
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        try:
            posicoes = self._laco.rodar(self._grafo.trading.get_open_positions(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_as_posicoes", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_posicao(p) for p in posicoes])

    def ordens_vivas(self, account_id: int) -> Resultado:
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        try:
            ordens = self._laco.rodar(self._grafo.trading.get_pending_orders(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_as_ordens", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_ordem(o) for o in ordens])

    def nao_realizado(self, account_id: int) -> Resultado:
        """A parcela que falta ao equity derivado (achado 1 do data-model)."""
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        try:
            linhas = self._laco.rodar(self._grafo.trading.get_unrealized_pnl_per_position(account_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_o_nao_realizado", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_nao_realizado(p) for p in linhas])

    def negocio_de_fecho(self, account_id: int, position_id: int) -> Resultado:
        if self._grafo is None:
            return _falhou("sem_ligacao", "o transporte nao esta' aberto")
        try:
            negocios = self._laco.rodar(self._grafo.trading.get_deals_by_position_id(account_id, position_id))
        except Exception as erro:
            return _falhou("falha_ao_ler_os_negocios", f"{type(erro).__name__}: {erro}")
        return Resultado(ok=True, valor=[_negocio(n) for n in negocios])


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


def _conta_por_dentro(conta: Any) -> dict[str, Any]:
    # NOTA (achado medido): o modelo `Account` desta versao da biblioteca NAO traz `money_digits`, que a doc
    # oficial declara na conta. O expoente aparece por posicao (`Position.money_digits`). Enquanto isto for
    # assim, a leitura nao inventa um expoente: publica o saldo como o venue o da e DECLARA a ausencia.
    return {
        "conta": conta.account_id,
        "saldo": conta.balance,
        "expoente_dos_valores": None,  # 'ausente no modelo da biblioteca' — nao se adivinha
        "alavancagem_em_centesimos": conta.leverage_in_cents,
        "alavancagem_maxima": conta.max_leverage,
        "tipo_de_conta": conta.account_type,
        "direitos": conta.access_rights,
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


def _simbolo_por_dentro(simbolo: Any) -> dict[str, Any]:
    return {
        "symbol_id": simbolo.symbol_id,
        "digitos": simbolo.digits,
        "posicao_do_pip": simbolo.pip_position,
        "tamanho_do_lote": simbolo.lot_size,
        "minimo": simbolo.min_volume,
        "maximo": simbolo.max_volume,
        "passo": simbolo.step_volume,
        "modo_de_negociacao": simbolo.trading_mode,
        "swap_longo": simbolo.swap_long,
        "swap_curto": simbolo.swap_short,
        "comissao": simbolo.commission,
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


def _vela(vela: Any) -> dict[str, Any]:
    return {
        "instante_ms": vela.timestamp,
        "periodo": str(vela.period),
        "abertura": vela.open,
        "maximo": vela.high,
        "minimo": vela.low,
        "fecho": vela.close,
        "volume_em_ticks": vela.volume,
    }


def _posicao(posicao: Any) -> dict[str, Any]:
    return {
        "posicao": posicao.position_id,
        "symbol_id": posicao.symbol_id,
        "lado": posicao.side,
        "volume": posicao.volume,
        "preco_de_entrada": posicao.entry_price,
        "estado": posicao.status,
        "aberta_ms": posicao.open_timestamp,
        "expoente": posicao.money_digits,
        "stop": posicao.stop_loss,
        "alvo": posicao.take_profit,
        "margem_empenhada": posicao.used_margin,
        "taxa_de_margem": posicao.margin_rate,
        "swap": posicao.swap,
        "comissao": posicao.commission,
        "marca": posicao.label,
        "comentario": posicao.comment,
    }


def _ordem(ordem: Any) -> dict[str, Any]:
    return {
        "ordem": ordem.order_id,
        "symbol_id": ordem.symbol_id,
        "lado": ordem.side,
        "tipo": ordem.order_type,
        "estado": ordem.status,
        "volume": ordem.volume,
        "volume_executado": ordem.executed_volume,
        "preco_de_execucao": ordem.execution_price,
        "limite": ordem.limit_price,
        "stop": ordem.stop_price,
        "posicao": ordem.position_id,
        "e_fecho": ordem.is_closing_order,
        "e_stop_out": ordem.is_stop_out,
        "marca_do_cliente": ordem.client_order_id,
        "stop_relativo": ordem.relative_stop_loss,
        "alvo_relativo": ordem.relative_take_profit,
        "desvio_em_pontos": ordem.slippage_in_points,
        "preco_base_do_desvio": ordem.base_slippage_price,
        "aberta_ms": ordem.open_timestamp,
        "expira_ms": ordem.expiration_timestamp,
    }


def _negocio(negocio: Any) -> dict[str, Any]:
    return {
        "negocio": negocio.deal_id,
        "ordem": negocio.order_id,
        "posicao": negocio.position_id,
        "symbol_id": negocio.symbol_id,
        "lado": negocio.side,
        "volume": negocio.volume,
        "volume_preenchido": negocio.filled_volume,
        "preco": negocio.execution_price,
        "instante_ms": negocio.execution_timestamp,
        "estado": negocio.status,
        "comissao": negocio.commission,
        "taxa_de_margem": negocio.margin_rate,
        "detalhe_do_fecho": _detalhe_do_fecho(negocio.close_detail),
    }


def _detalhe_do_fecho(detalhe: Any) -> dict[str, Any] | None:
    """O `close_detail` do negocio de fecho: o resultado, do venue (RN-CT41). Ausente quando nao e' fecho."""
    if detalhe is None:
        return None
    campos = getattr(detalhe, "model_fields", None)
    if campos is None:
        return {"_bruto": str(detalhe)}
    return {nome: getattr(detalhe, nome) for nome in campos}


def _nao_realizado(linha: Any) -> dict[str, Any]:
    return {
        "posicao": linha.position_id,
        "bruto": linha.gross_unrealized_pnl,
        "liquido": linha.net_unrealized_pnl,
    }


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
