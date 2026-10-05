"""O PROCESSO do conector cTrader: a costura entre o contrato neutro e o venue.

    python3 brokers/ctrader/processo.py --ficha @brokers/ctrader/ctrader-demo.conector.json --ao-vivo

PORQUE EXISTE. O operador arranca-o, como arranca o conector 1, e a partir daqui e' tudo mensagem: o contrato
neutro entra pelo `stdin` (uma linha, um envelope) e as respostas saem pelo `stdout`, tambem uma linha por
mensagem. O DIAGNOSTICO nunca entra na costura: vai para o `stderr`, porque quem le' o `stdout` le' contrato.

AS PORTAS DO ARRANQUE, e a ordem delas. O criterio e' o custo e o alcance: o que se sabe sem falar com ninguem
vem primeiro; o que exige ir ao venue vem no fim. O dono le' o PRIMEIRO obstaculo, nao o terceiro:

    1. ficha                — um processo por (corretora, conta), e a ficha diz qual
    2. versao_do_contrato   — igualdade EXACTA antes de qualquer envio (D7)
    3. uma_conta            — uma ligacao, uma chave, UMA conta
    4. ambiente_e_rede      — o ambiente declarado e a rede nao podem discordar
    5. chave                — a credencial entra por REFERENCIA, e a falta dela e' recusa nomeada
    6. ligacao              — o estado vem do protocolo do venue, e tem DUAS camadas aqui
    7. sonda_e_manifesto    — o que o venue nao declarar RECUSA, nunca vira `true` por omissao
    8. identidade           — o `ctidTraderAccountId` que o venue devolve e' o da ficha, e os direitos dela

Um arranque que FALHA uma porta NAO SERVE: sai com codigo 2 e nao escreve uma unica linha na costura. Uma porta
que ainda nao tem como ser corrida declara-se `nao_corrida` com o motivo nomeado — nunca `passou`: nao se declara
«passou» o que nao se mediu. E' a regra do conector 1 (em producao de ensaio): o `nao_corrida` e' uma conferencia
DECLARADA, e o que dela depende e' recusado pelo nome — nunca servido por omissao.

O CICLO DE SERVICO, e o que ele decide. Cada linha que chega e' um envelope; a resposta sai no formato do
contrato, e so' sai se o contrato a aceitar:

    * `boleta` com lado `buy`/`sell` — `ordens.traduzir` (a boleta neutra -> a accao do venue), o envio pelo
      TRANSPORTE, e o desfecho (`desfecho.py`) com os numeros que o venue deu;
    * `boleta` com lado `caixa` — o FECHO (`fecho.py`): fecha POR POSICAO, e sem posicao nao sai ordem nenhuma;
    * um pedido de paragem pelo protocolo (`comando` com o verbo `stop`) — o processo encerra LIMPO, e o
      `ao_desligar` da ficha decide o que fica;
    * a LEITURA do mercado (`leitura.py`) — no relogio declarado (`--leitura-a-cada`), como no conector 1.

O QUE ESTA PONTA JA' LE' DO MERCADO, e com que regua. A subscricao de spots/profundidade (`seguir_o_mercado`)
guarda o ULTIMO RETRATO por simbolo, e `publicar_mercado` publica a COTACAO (`bid`/`ask`, e o `livro` por
deltas) quando ha' retrato, com o INSTANTE DO VENUE do spot. Quando nao ha' retrato nenhum, a regua DECLARADA e'
a ULTIMA VELA FECHADA, e o `ultimo` e' o fecho dela. A linha do contrato diz qual das duas foi pelo que traz
(`bid`/`ask` = cotacao; `ultimo` = vela) e o diagnostico (`regua`) di-lo por palavras. O que o venue nao
declarar continua a RECUSAR por NOME (`capacidade_nao_declarada`) — nunca um numero nosso a passar por numero do
venue.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, DivisionByZero, InvalidOperation
from pathlib import Path
from typing import Any, Callable, Iterable

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
sys.path.insert(0, str(RAIZ / "contracts" / "esqueleto"))
sys.path.insert(0, str(AQUI))

from framing import validar, versao_vigente  # noqa: E402  (o caminho tem de ser posto primeiro)

import credencial as Cr  # noqa: E402
import desfecho as De  # noqa: E402
import fecho as Fe  # noqa: E402
import ficha as Fi  # noqa: E402
import identidade as Id  # noqa: E402
import leitura as Le  # noqa: E402
import ordens as Or  # noqa: E402
import sonda as So  # noqa: E402
import transporte as Tr  # noqa: E402

PORTAS: tuple[tuple[str, str], ...] = (
    ("ficha", "FR-019: um processo por (corretora, conta), e a ficha diz qual — sem ficha legivel nao ha conector"),
    ("versao_do_contrato", "D7/RN-E18: a versao do contrato confere-se por igualdade EXACTA antes de qualquer envio"),
    ("uma_conta", "FR-019/FR-022: uma ligacao, uma chave, UMA conta — um pedido que nomeie outra conta nao entra"),
    ("ambiente_e_rede", "o ambiente declarado e a rede nao podem discordar: e' assim que um ensaio passa a operar a serio"),
    ("chave", "FR-023/RN-C20: a credencial entra por REFERENCIA e a falta dela e' uma recusa NOMEADA"),
    ("ligacao", "FR-020/FR-021: o estado da ligacao e' o do protocolo do venue, e aqui tem DUAS camadas (transporte e sessao da conta)"),
    ("sonda_e_manifesto", "US1/FR-051: a sonda le' o venue e o manifesto e' publicado — o que o venue nao declarar RECUSA"),
    ("identidade", "FR-047/FR-049/RN-CT8: o id que o venue devolve e' o da ficha, e os direitos da conta sao lidos. E' a ULTIMA porque exige a leitura mais recente"),
)

#: Os motivos que fazem uma porta ficar `nao_corrida` (e nao `falhou`): a conferencia existe, mas falta-lhe uma
#: entrada que esta ponta ainda nao tem de onde ler. Sao declarados, e nao maquilhados.
PORTA_SEM_COMO_CORRER = "conferencia_por_escrever"

#: O prazo declarado para a resposta do venue, quando quem corre nao o declara (`--prazo-do-venue-ms`). E' o que
#: decide se o SILENCIO do venue fica `desconhecido` (nem falha nem sucesso, FR-067) — e um numero que decide
#: isso nao se escreve dentro de uma expressao: vive aqui, nomeado, a' vista de quem o muda.
PRAZO_DO_VENUE_POR_OMISSAO_MS = 3000

#: OS VERBOS DE ENVIO que esta costura espera do `transporte.py`. O transporte embrulha a biblioteca e e' o UNICO
#: ficheiro que a conhece (D2): e' por estes nomes que a costura envia, e quando eles nao existem a recusa e'
#: NOMEADA — nao ha caminho nenhum daqui que fale com a biblioteca.
VERBO_DE_ABERTURA = "colocar_ordem"
VERBO_DE_FECHO = "fechar_posicao"

#: O lado NEUTRO que pede o FECHO (o `caixa` da casa, RN-T4): e' fecho por POSICAO, nunca lado de ordem.
LADO_DE_FECHO = "caixa"

#: O MOTIVO com que sai a recusa do FR-068 — uma ordem NOVA com uma `desconhecida` por reconciliar no mesmo
#: instrumento. DECISAO DO DONO (05/10/2026), e a razao e' medida, nao escolhida por conveniencia: o conjunto
#: FECHADO do contrato (`contracts/_defs/forma.schema.json#/$defs/motivo`, 23 nomes) NAO tem nome proprio para
#: este caso, e o dono decidiu NAO emendar o contrato. Usa-se `prazo_excedido`, porque no vocabulario da MESA
#: e' ELE que ja' significa exactamente isto — `core/ciclo/acoes.json#por_motivo.prazo_excedido` mapeia-o para a
#: accao `parar_e_reconciliar`, com o porque' «Desfecho desconhecido: o bilhete pode ter chegado. Primeiro
#: reconcilia-se.». O CUSTO que se evitou, e que fica dito: uma emenda ao conjunto fechado = subida de versao do
#: contrato + o espelho `_defs/forma.schema.json` + a TRADUCAO da mesa em `core/`. O dia em que se quiser um nome
#: PROPRIO (`desconhecido_por_reconciliar`) e' o dia de pagar esse custo — a decisao e' do dono. Nota datada em
#: `docs/maquina-de-estados-conector-ctrader.md`.
MOTIVO_DA_ORDEM_NOVA_COM_PENDENTE = "prazo_excedido"
#: Os lados neutros que viram ORDEM. `hold` e `caixa` nao: um e' esperar, o outro e' fechar.
LADOS_DE_ORDEM = ("buy", "sell")

TIPO_BOLETA = "boleta"
TIPO_COMANDO = "comando"
#: O verbo do vigia que pede a PARAGEM (RN-V1): e' o unico que esta costura atende, porque e' o unico que a
#: obriga a encerrar. Os outros verbos sao da mesa, e a mesa nao se improvisa aqui.
VERBO_DE_PARAGEM = "stop"

#: As instrucoes de encerramento da ficha (`ao_desligar`): a declaracao do dono sobre o que fica vivo quando o
#: processo se desliga. Um valor fora deste conjunto RECUSA (o que esta' em jogo e' uma posicao viva).
INSTRUCOES_DE_ENCERRAMENTO = ("fechar", "manter")

#: A forma da correlacao do contrato (RN-T3): e' OPACA, so' se usa para responder a' mesma mensagem.
PADRAO_CORRELACAO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$")

#: A janela do preco de referencia: quantas horas de velas se pedem para achar a ULTIMA FECHADA do instrumento.
VELAS_PARA_O_PRECO_HORAS = 24 * 3
PERIODO_DA_VELA_DE_REFERENCIA = "H1"

#: A costura e' de UMA linha por mensagem: o relogio de leitura (um fio proprio) e o ciclo escrevem no MESMO
#: `stdout`, e duas linhas entrelacadas fariam o outro lado ler a mensagem errada. Um so' cadeado.
_COSTURA = threading.Lock()


def diag(**campos: object) -> None:
    """O canal de quem le' esta ponta. Nunca entra na costura (o `stdout` e' do contrato)."""
    print(json.dumps(campos, ensure_ascii=False), file=sys.stderr, flush=True)


def escrever_na_costura(linha: str) -> None:
    """Escreve UMA linha de contrato na costura, com o cadeado que a mantem inteira."""
    with _COSTURA:
        print(linha, flush=True)


@dataclass
class ResultadoDaPorta:
    porta: str
    veredicto: str  # "passou" | "falhou" | "nao_corrida"
    porque: str
    motivo: str | None = None


@dataclass
class Pendencia:
    """O que a memoria do processo guarda de uma ordem que ficou `desconhecida` (FR-067/068/069).

    O QUE ISTO E', e o que NAO e'. Guarda SO' que ha' algo por reconciliar NAQUELE instrumento, e por onde o
    procurar (a marca do `clientOrderId`, o `positionId`, a referencia do cliente e a resolucao que a
    acompanhou). NAO guarda a VERDADE — se a ordem existe ou nao, se foi aceite ou recusada — porque essa so'
    sai da LEITURA do venue (FR-069). A razao e' dura e esta' dita: este estado vive na MEMORIA e morre com o
    processo; se guardasse a verdade, um arranque novo ficaria a menti-la. Por isso a pendencia e' so' um
    bilhete de «vai la' ver ao venue» — e a leitura e' que decide (FR-069, scenario 3 do US5).
    """

    instrumento: str
    symbol_id: int
    marca: str | None
    position_id: int | None
    referencia_do_cliente: str | None
    resolucao: dict[str, str]
    alavancagem: str | None
    correlacao: str
    instante_ms: int
    verbo: str


@dataclass
class Arranque:
    ok: bool
    portas: list[ResultadoDaPorta] = field(default_factory=list)
    ficha: Fi.Ficha | None = None
    credencial: Cr.Trio | None = None
    #: O fio e a sessao da conta, ja' abertos e autorizados (porta 6). Fica aqui porque e' ele que o ciclo usa.
    transporte: Tr.Transporte | None = None
    #: O manifesto publicado pela sonda (porta 7): e' a declaracao de capacidade sem a qual nao ha traducao.
    manifesto: dict[str, Any] | None = None
    #: Os direitos da conta, como o VENUE os declarou (porta 8). O fecho e a abertura leem-nos daqui.
    direitos_da_conta: str | None = None
    #: `True` quando a conta so' deixa FECHAR (o `accessRights = CLOSE_ONLY`): arranca, e a abertura e' recusada.
    so_fecha: bool = False
    #: O prazo declarado da resposta do venue, em ms (decide o `desconhecido`). Declarado, nunca adivinhado.
    prazo_do_venue_ms: int = PRAZO_DO_VENUE_POR_OMISSAO_MS
    #: As ordens que ficaram `desconhecida` e ainda nao foram reconciliadas, POR INSTRUMENTO (FR-068/FR-069).
    #: Vive na memoria e morre com o processo — de proposito: guarda QUE ha' algo por reconciliar, nunca a
    #: verdade, que so' a leitura do venue da'. E' ele que trava a ordem NOVA no mesmo instrumento (FR-068) e
    #: que o fecho NAO le' (o fecho continua sempre a passar).
    pendentes: dict[str, Pendencia] = field(default_factory=dict)



def _falhou(portas: list[ResultadoDaPorta], porta: str, motivo: str, porque: str) -> Arranque:
    portas.append(ResultadoDaPorta(porta=porta, veredicto="falhou", motivo=motivo, porque=porque))
    return Arranque(ok=False, portas=portas)


def _passou(portas: list[ResultadoDaPorta], porta: str, porque: str) -> None:
    portas.append(ResultadoDaPorta(porta=porta, veredicto="passou", porque=porque))


def _nao_corrida(portas: list[ResultadoDaPorta], porta: str, porque: str) -> None:
    portas.append(ResultadoDaPorta(porta=porta, veredicto="nao_corrida", motivo=PORTA_SEM_COMO_CORRER, porque=porque))


# -----------------------------------------------------------------------------------------------------------
# As portas. As cinco primeiras nao falam com ninguem; a 6, a 7 e a 8 exigem o venue a falar.
# -----------------------------------------------------------------------------------------------------------


def arrancar(caminho_da_ficha: Path, transporte: Tr.Transporte | None = None) -> Arranque:
    """Corre as oito portas, por ordem, e para na primeira que FALHA. Nao levanta: devolve o que decidiu.

    O `transporte` entra como PARAMETRO por uma razao so': a prova. Com um duplo declarado (um `Transporte`
    FALSO, com a mesma superficie) as portas 6 a 8 correm sem rede, e o que se mede e' a FIACAO desta costura.
    Quem o passa e' quem escreve a prova; em operacao ele e' `None`, e a porta 6 constroi o transporte a serio.
    """
    portas: list[ResultadoDaPorta] = []

    # ---- porta 1: a ficha ---------------------------------------------------------------------------------
    lida = Fi.ler_ficha(caminho_da_ficha)
    if isinstance(lida, Fi.Recusa):
        return _falhou(portas, "ficha", lida.motivo, lida.porque)
    ficha = lida
    _passou(
        portas,
        "ficha",
        (
            f"ficha `{ficha.conector}` legivel: venue {ficha.venue}, ambiente {ficha.ambiente}, UMA conta "
            f"`{ficha.conta}`, {len(ficha.instrumentos)} instrumento(s) do mandato "
            f"({', '.join(ficha.instrumentos)})"
        ),
    )

    # ---- porta 2: a versao do contrato --------------------------------------------------------------------
    vigente = versao_vigente()
    if ficha.contrato != vigente:
        return _falhou(
            portas,
            "versao_do_contrato",
            "versao_do_contrato_divergente",
            f"a ficha declara {ficha.contrato} e a versao vigente e' {vigente} — igualdade EXACTA, nunca "
            "«compativel» (D7). Nada sai",
        )
    _passou(
        portas,
        "versao_do_contrato",
        f"a ficha e a versao vigente concordam: contrato {vigente} (conferido em contracts/versao.json)",
    )

    # ---- porta 3: uma conta -------------------------------------------------------------------------------
    # O que a porta da ficha confere e' a FORMA do documento; o que esta confere e' a REGRA: uma conta, e nenhum
    # lugar para uma segunda. (`contas`, uma lista, nem chega aqui: a ficha e' fechada e recusa-a.)
    if ficha.conta.strip() == "":
        return _falhou(portas, "uma_conta", "campo_obrigatorio_ausente", "a ficha declara `conta` vazia")
    _passou(
        portas,
        "uma_conta",
        f"uma conta por processo: {ficha.conta} (um pedido que nomeie outra conta nao atravessa este envelope fechado)",
    )

    # ---- porta 4: o ambiente e a rede ---------------------------------------------------------------------
    # A conferencia vive em `ficha.py` (o endereco e o ambiente tem de dizer o mesmo); aqui REGISTA-SE o que ela
    # decidiu, porque o dono le' as portas e nao o codigo da ficha.
    _passou(portas, "ambiente_e_rede", f"o ambiente `{ficha.ambiente}` e o endereco `{ficha.url_da_api}` concordam")

    # ---- porta 5: a chave ---------------------------------------------------------------------------------
    # QUATRO valores, um por ficheiro `.key` (o venue reescreve dois deles quando roda o par). O id da conta vem
    # da FICHA (nao e' segredo) e e' contra ele que a porta 8 compara o que o venue devolver.
    credencial = Cr.carregar_trio(ficha.credencial_referencia, ficha.credencial_arquivos)
    if isinstance(credencial, Cr.Recusa):
        return _falhou(portas, "chave", credencial.motivo, credencial.porque)
    _passou(
        portas,
        "chave",
        (
            f"a credencial `{ficha.credencial_referencia}` traz os quatro valores, um por ficheiro "
            f"({credencial.de}), e a ficha declara a conta {ficha.conta} "
            f"({ficha.ctid_trader_account_id}) — nenhum valor entra no registo (FR-023)"
        ),
    )

    # ---- porta 6: a ligacao (o fio de pe', e a conta autorizada) -------------------------------------------
    resultado, ligacao, transporte = _abrir_ligacao(transporte, ficha, credencial)
    if not resultado.ok:
        portas.append(
            ResultadoDaPorta(porta="ligacao", veredicto="falhou", motivo=resultado.motivo, porque=resultado.porque)
        )
        return Arranque(ok=False, portas=portas, ficha=ficha, credencial=credencial)
    _passou(portas, "ligacao", ligacao)
    # `_abrir_ligacao` DEVOLVE o transporte que construiu — antes havia aqui um `assert transporte is not None`
    # que rebentava SEMPRE que a porta 6 passava, porque o transporte nascia dentro da funcao chamada e ficava la'
    # (medido a 05/10/2026, na primeira corrida a serio: a porta 6 nunca tinha passado, e o codigo por tras dela
    # nunca tinha corrido). Sem fio nao se segue — e diz-se, em vez de rebentar.
    if transporte is None:
        return _falhou(
            portas,
            "transporte",
            "sem_ligacao",
            "a porta da ligacao passou sem construir o transporte: nao se segue sem fio (era um `assert`, e "
            "rebentava aqui — medido a 05/10/2026, na primeira corrida a serio)",
        )

    # ---- porta 7: a sonda e o manifesto --------------------------------------------------------------------
    desvio = _desvio_maximo_da_ficha(ficha)
    if desvio is None:
        _nao_corrida(
            portas,
            "sonda_e_manifesto",
            (
                "a sonda existe e corre (`sonda.py`), mas falta-lhe a ULTIMA entrada que so' a ficha a podia dar: "
                "o `desvio_maximo` (o que o venue aceita, em percentagem). A ficha desta ponta ainda o nao "
                "declara, e `ficha.py` — que e' fechada — recusa uma chave que nao leia: sem ele nao se publica "
                "um manifesto, e um manifesto sem desvio declarado seria uma capacidade a mais do que a real"
            ),
        )
        manifesto: dict[str, Any] | None = None
    else:
        medido = So.sondar(
            transporte,
            nome_do_conector=ficha.conector,
            versao_do_conector=_versao_do_conector(ficha),
            account_id=ficha.ctid_trader_account_id,
            instrumentos=list(ficha.instrumentos),
            desvio_maximo_pct=desvio,
        )
        if isinstance(medido, So.Recusa):
            return _falhou(
                portas,
                "sonda_e_manifesto",
                medido.motivo,
                f"a sonda do venue nao produziu manifesto: {medido.porque}",
            )
        manifesto = medido
        _passou(
            portas,
            "sonda_e_manifesto",
            (
                f"o venue foi sondado e o manifesto publicado: {len(manifesto['instrumentos'])} instrumento(s), "
                f"tipos de ordem {manifesto['tipos_de_ordem']}, desvio maximo {manifesto['desvio_maximo']}% "
                "(o que o venue nao declarou ficou AUSENTE, e nao virou zero)"
            ),
        )

    # ---- porta 8: a identidade (o id da ficha esta' entre as contas que o token autoriza?) ------------------
    identidade = _conferir_identidade(transporte, ficha)
    if not identidade.ok:
        return _falhou(portas, "identidade", identidade.motivo, identidade.porque)
    _passou(portas, "identidade", identidade.porque)

    return Arranque(
        ok=True,
        portas=portas,
        ficha=ficha,
        credencial=credencial,
        transporte=transporte,
        manifesto=manifesto,
        direitos_da_conta=identidade.direitos,
        so_fecha=identidade.so_fecha,
        prazo_do_venue_ms=PRAZO_DO_VENUE_POR_OMISSAO_MS,
    )


def _abrir_ligacao(
    transporte: Tr.Transporte | None, ficha: Fi.Ficha, credencial: Cr.Trio
) -> tuple[Tr.Resultado, str, Tr.Transporte | None]:
    """Abre o fio e autoriza a CONTA — as DUAS camadas do FR-048.

    O transporte constroi-se aqui, a serio, quando nao veio de fora (a prova injecta um duplo). As duas camadas
    sao `abrir()` (o fio de pe' + a aplicacao autenticada) e `autorizar_conta()` (a sessao da CONTA): o conector
    so' envia quando as duas estao prontas, e por isso a porta so' passa quando as duas passarem.

    DEVOLVE o transporte (novo ou o que veio de fora): ele tem de chegar ao `Arranque`, porque e' por ele que o
    ciclo de servico envia. Antes nao o devolvia, e quem chamava ficava com `None` — o `assert` a seguir rebentava
    (medido a 05/10/2026, na primeira corrida a serio).
    """
    if transporte is None:
        transporte = Tr.Transporte(
            url_da_api=ficha.url_da_api,
            client_id=credencial.client_id,
            client_secret=credencial.client_secret,
        )
    aberto = transporte.abrir(_caminhos_da_credencial(ficha))
    if not aberto.ok:
        return (
            Tr.Resultado(ok=False, motivo=aberto.motivo, porque=aberto.porque),
            "",
            None,
        )
    autorizada = transporte.autorizar_conta(
        ficha.ctid_trader_account_id, credencial.access_token, credencial.refresh_token
    )
    if not autorizada.ok:
        return (
            Tr.Resultado(ok=False, motivo=autorizada.motivo, porque=autorizada.porque),
            "",
            transporte,
        )
    # ---- a SESSAO da conta passa a ser OBSERVADA (FR-070): ligam-se os tratadores dos eventos do venue ---------
    # E' o degrau que da' OLHOS a' maquina: sem ele o conector nao ve' a invalidacao (roda/revoga/kick) e a guarda
    # das duas camadas (FR-048) fica cega. Se o registo FALHAR, a porta da ligacao NAO passa — e o porque' e'
    # DITO (`seguir_a_sessao_da_conta` recusa por nome), nunca silencio. Nada de recuperacao propria: quem
    # re-autentica e' o maintainer da biblioteca; aqui so' se observa.
    seguida = transporte.seguir_a_sessao_da_conta(ficha.ctid_trader_account_id)
    if not seguida.ok:
        return (
            Tr.Resultado(ok=False, motivo=seguida.motivo, porque=seguida.porque),
            "",
            transporte,
        )
    return (
        Tr.Resultado(ok=True),
        (
            "as DUAS camadas estao prontas: o fio de pe' e a aplicacao autenticada (`abrir`), e a sessao da conta "
            f"{ficha.conta} ({ficha.ctid_trader_account_id}) autorizada (`autorizar_conta`) — e a sessao passou a "
            "ser SEGUIDA por evento (FR-048/FR-070)"
        ),
        transporte,
    )


@dataclass(frozen=True)
class _Identidade:
    ok: bool
    motivo: str
    porque: str
    direitos: str | None = None
    so_fecha: bool = False


def _conferir_identidade(transporte: Tr.Transporte, ficha: Fi.Ficha) -> _Identidade:
    """A porta 8: QUAIS contas o token autoriza, e o id da ficha esta' entre elas?

    A lista vem do TOKEN (`contas`), e a porta NOMEIA as contas que ele trouxer — o id da ficha tem de estar
    entre elas, ou nao se serve nada (FR-049/RN-CT8). Depois leem-se os DIREITOS da conta (`trader`), porque um
    conector que arranca sem poder fechar e' pior do que nenhum (RN-CT12).

    O TOKEN E' O QUE O TRANSPORTE TEM, NAO A COPIA DA PORTA 5 (A-8, fechado a 05/10/2026). A porta 6 chama
    `autorizar_conta()`, que por sua vez chama `establish()`: com um prazo declarado expirado (ou ausente) ele
    REFRESCA e RODA o par, e o token que a porta 5 tinha lido dos `.key` morre nesse instante. Ler as contas
    com essa copia era usar um token que o venue acabara de invalidar — `TokenExpiredError: Token refused by the
    server` contra um token que era bom. Agora o token vem de `transporte.token_actual()`, que le' o que o
    manager guarda AGORA (`auth/manager.py: get_credentials`).
    """
    token = transporte.token_actual(ficha.ctid_trader_account_id)
    if token is None:
        return _Identidade(
            ok=False,
            motivo="sem_token_vivo",
            porque=(
                f"o transporte nao tem credenciais vivas para a conta {ficha.ctid_trader_account_id}: a sessao "
                "da conta nao ficou autorizada, e sem o token que o manager guarda nao se le' a lista de contas "
                "(o token da porta 5 pode ter sido rodado e morto pela porta 6 — A-8)"
            ),
        )
    lidas = transporte.contas(token)
    if not lidas.ok:
        return _Identidade(
            ok=False, motivo="falha_ao_ler_as_contas", porque=f"o venue nao devolveu as contas do token: {lidas.porque}"
        )
    lista = _contas_do_token(lidas.valor)
    if lista is None:
        return _Identidade(
            ok=False,
            motivo="campo_obrigatorio_ausente",
            porque=(
                "o venue respondeu a lista de contas numa forma que nao se le': sem a lista nao se sabe de quem e' "
                "a conta, e o desconhecido nao vira «sim» (FR-023)"
            ),
        )
    nomes = ", ".join(str(conta["ctidTraderAccountId"]) for conta in lista)
    if not nomes:
        nomes = "nenhuma"
    veredicto = Id.conferir_identidade(ficha.ctid_trader_account_id, lista, ficha.conta)
    if not veredicto.ok:
        return _Identidade(ok=False, motivo=str(veredicto.motivo), porque=f"{veredicto.porque} (o token autoriza: {nomes})")

    conta = transporte.trader(ficha.ctid_trader_account_id)
    if not conta.ok:
        return _Identidade(
            ok=False,
            motivo="falha_ao_ler_a_conta",
            porque=(
                f"o token autoriza {len(lista)} conta(s) ({nomes}) e o id {ficha.ctid_trader_account_id} esta' entre "
                f"elas, mas os DIREITOS da conta nao se leram: {conta.porque}"
            ),
        )
    interior = conta.valor
    if not isinstance(interior, dict):
        return _Identidade(
            ok=False,
            motivo="formato_invalido",
            porque="a leitura da conta nao veio com forma de objecto: nao se leem os direitos sem a conta",
        )
    direitos = interior.get("direitos")
    veredicto_direitos = Id.conferir_direitos(direitos, ficha.conta)
    if not veredicto_direitos.ok:
        return _Identidade(ok=False, motivo=str(veredicto_direitos.motivo), porque=veredicto_direitos.porque)

    return _Identidade(
        ok=True,
        motivo="",
        porque=(
            f"o token autoriza {len(lista)} conta(s) ({nomes}) e o id que a ficha declara "
            f"({ficha.ctid_trader_account_id}) esta' entre elas; {veredicto_direitos.porque}"
        ),
        direitos=direitos if isinstance(direitos, str) else None,
        so_fecha=veredicto_direitos.so_fecha,
    )


def _contas_do_token(valor: Any) -> list[dict[str, Any]] | None:
    """A lista do venue -> a forma que `identidade.conferir_identidade` le' (`ctidTraderAccountId` por conta).

    O transporte publica a conta resumida com o nome do CONTRATO (`conta`); a porta de identidade compara o
    campo do VENUE (`ctidTraderAccountId`). A conversao e' aqui, e e' uma so'.
    """
    if not isinstance(valor, list):
        return None
    contas: list[dict[str, Any]] = []
    for entrada in valor:
        if not isinstance(entrada, dict):
            continue
        ident = entrada.get("conta")
        if isinstance(ident, bool) or not isinstance(ident, int):
            continue
        contas.append({"ctidTraderAccountId": ident})
    return contas


def _caminhos_da_credencial(ficha: Fi.Ficha) -> dict[str, Path]:
    """As REFERENCIAS da ficha -> os caminhos que o `GuardaDeTokens` reescreve quando o venue roda o par.

    Os quatro valores entram por referencia (`env:` ou `ficheiro:`) e e' `credencial.py` que os resolve; o
    transporte, para RODAR o par, precisa dos CAMINHOS dos dois tokens — um `.key` por valor (RN-CT10).

    O QUINTO CAMINHO, o `expira_em` (A-9, fechado a 05/10/2026). Ate' aqui mapeava-se so' o que a ficha declara,
    e a ficha declara QUATRO valores: o `GuardaDeTokens.save` nunca recebia a chave `expira_em`, logo NUNCA
    escrevia o prazo; `prazo_declarado()` devolvia `0.0` para sempre; e com `expires_at=0.0` o
    `expires_soon(buffer=300)` da biblioteca (`auth/credentials.py`) e' SEMPRE `True`, o que fazia o par de
    tokens RODAR em cada ligacao — e a rotacao matava o token que a porta 8 ia usar (A-8). Medido a 05/10/2026:
    os dois `.key` de token mudavam de mtime a cada corrida (10:08:02, 10:08:31).

    O caminho DERIVA-SE do access token (mesma pasta de credenciais, o mesmo prefixo, `expira_em` no lugar do
    `access_token`): nao se toca na ficha (que e' fechada e recusaria uma chave a mais) nem se inventa uma pasta
    nova. O prazo e' ESTADO que o venue declara na rotacao — nao e' segredo, mas vive ao lado dos tokens, modo
    600, como eles (dito em `config/README.md`).
    """
    caminhos: dict[str, Path] = {}
    for campo, referencia in ficha.credencial_arquivos.items():
        if not referencia.startswith("ficheiro:"):
            continue
        caminhos[campo] = Path(referencia[len("ficheiro:") :]).expanduser()
    access = caminhos.get("access_token")
    if access is not None:
        nome = access.name.replace("access_token", "expira_em")
        if nome == access.name:  # o nome do ficheiro nao trazia `access_token`: deriva-se ao lado, sem o pisar
            nome = "expira_em.key"
        caminhos["expira_em"] = access.with_name(nome)
    return caminhos


def _desvio_maximo_da_ficha(ficha: Fi.Ficha) -> str | None:
    """O `desvio_maximo` que a ficha declara, QUANDO o declara. `None` = nao ha de onde o ler.

    O manifesto exige-o (e' o que o venue aceita, em percentagem). [FECHADO A-1 a 05/10/2026: `ficha.py`
    passou a LE'-lo (`CAMPOS_LIDOS` + validacao de forma), e por isso este nome encontra-o e a sonda corre.
    Antes o campo nao era lido (declara-lo era recusa `campo_desconhecido`), esta funcao devolvia `None` e a
    porta da sonda ficava `nao_corrida` — o manifesto nunca era publicado e nenhuma ordem podia ser servida.]
    Continua a ser o ponto de guarda: sem valor declarado nao se inventa uma percentagem do venue.
    """
    declarado = getattr(ficha, "desvio_maximo", None)
    if isinstance(declarado, str) and declarado != "":
        return declarado
    return None


def _versao_do_conector(ficha: Fi.Ficha) -> str:
    """A versao do CONECTOR (do plugin), quando a ficha a declarar; sem ela, a versao do contrato.

    O manifesto publica `conector: {nome, versao}`: o nome e' o da ficha, e a versao e' a do plugin. A ficha
    desta ponta nao a traz — declara-se a do contrato, e di-lo quem le' o manifesto pelo `conector.nome`.
    """
    declarada = getattr(ficha, "versao_do_conector", None)
    if isinstance(declarada, str) and declarada != "":
        return declarada
    return versao_vigente()


# -----------------------------------------------------------------------------------------------------------
# A COSTURA: o envelope que sai, e o desfecho de recusa que este processo compoe.
# -----------------------------------------------------------------------------------------------------------


def linha_do_contrato(tipo: str, correlacao: str, carga: dict[str, Any]) -> str | None:
    """Uma linha de contrato, e so' depois de o contrato a aceitar.

    A regra e' a mesma do conector 1: nao se publica uma mensagem que o contrato recusa. Se a mensagem nao passar,
    devolve `None` — e o diagnostico diz por que'. Uma mensagem invalida na costura faz o outro lado ler a
    mensagem errada.
    """
    linha = json.dumps(
        {"contrato": versao_vigente(), "tipo": tipo, "id": correlacao, "carga": carga}, ensure_ascii=False
    )
    veredicto = validar(linha)
    if veredicto.get("veredicto") != "aceite":
        diag(
            etapa="resposta_nao_publicada",
            tipo=tipo,
            motivo=veredicto.get("motivo"),
            porque="o contrato recusou a resposta: nao se publica o que o contrato nao aceita",
        )
        return None
    return linha


def publicar_o_manifesto(arranque: Arranque, ficha: Fi.Ficha, caminho_do_ficheiro: Path | None = None) -> str | None:
    """Publica o manifesto NA COSTURA — e so' depois de o contrato o aceitar (A-10, fechado a 05/10/2026).

    PORQUE EXISTE. O passo 1 do US1 (`specs/005-conector-ctrader/spec.md`) exige o manifesto publicado quando a
    camada de OPERACAO arranca o conector — no modo de SERVICO, e nao so' no `--sonda`. Ate' esta data o manifesto
    era apenas DIAGNOSTICADO no `stderr` (`main`: `diag(etapa="manifesto_publicado", ...)`) e a LINHA do contrato
    so' era construida no ramo `if args.sonda:` — quem arrancasse o conector a serio (como a mesa o arranca) nunca
    a ouvia: A-10. Agora ha' UM so' caminho, o MESMO que o `--sonda` ja' usava.

    A ORDEM DOS PASSOS E' A DA CASA (copiada, nao inventada): construir a linha, CONFERI-LA contra o contrato
    (`linha_do_contrato`, que devolve `None` quando o contrato a RECUSA), e so' depois escrever. Um manifesto que
    o contrato recusa NAO sai — nem na costura nem no ficheiro —, porque uma mensagem que o contrato recusa faz o
    outro lado ler a mensagem errada. Quem chama decide o que fazer com o `None` (nao servir).

    O `caminho_do_ficheiro` e' o `--manifesto-em`, por PARIDADE com o conector 1 (`brokers/hyperliquid/processo.ts`
    escreve `estado.linha_do_manifesto` em ficheiro e na costura): grava a MESMA linha que passou o contrato. Sem
    a opcao, o manifesto sai so' na costura.

    DEVOLVE a linha publicada, ou `None` quando nao ha' manifesto ou o contrato o recusou.
    """
    if arranque.manifesto is None:
        diag(
            etapa="manifesto_nao_publicado",
            veredicto="sem_manifesto",
            porque="a porta `sonda_e_manifesto` nao correu: nao ha' manifesto a publicar, e nao se inventa um",
        )
        return None
    linha = linha_do_contrato("manifesto", f"{ficha.conector}/manifesto", arranque.manifesto)
    if linha is None:
        return None
    escrever_na_costura(linha)
    if caminho_do_ficheiro is not None:
        caminho_do_ficheiro.parent.mkdir(parents=True, exist_ok=True)
        caminho_do_ficheiro.write_text(linha + "\n", encoding="utf-8")
        diag(
            etapa="manifesto_escrito",
            caminho=str(caminho_do_ficheiro),
            porque=(
                "a MESMA linha que saiu na costura (a que o contrato aceitou) foi gravada em ficheiro "
                "(`--manifesto-em`, paridade com o conector 1)"
            ),
        )
    return linha


def _desfecho_de_recusa(correlacao: str, motivo: Any, porque: str) -> list[str]:
    """O desfecho `recusado` desta ponta: um motivo do conjunto FECHADO do contrato, e o porque' em palavras.

    O `porque` (a razao humana) nao cabe no motivo — o motivo e' um identificador do vocabulario. Vai em
    `resposta_do_venue`, que o contrato guarda como o venue o deu (aqui, o que NOS recusamos).
    """
    if not isinstance(motivo, str):
        diag(etapa="recusa_sem_motivo", porque=porque)
        return []
    linha = linha_do_contrato(
        "desfecho",
        correlacao,
        {
            "classificacao": "recusado",
            "motivo": motivo,
            "resposta_do_venue": {"nota": "nenhuma ordem foi enviada", "porque": porque},
        },
    )
    if linha is None:
        return []
    return [linha]


# -----------------------------------------------------------------------------------------------------------
# AS LEITURAS DO VENUE que o ciclo precisa — e as conversoes que NAO se repetem: as unidades sao da LEITURA.
# -----------------------------------------------------------------------------------------------------------


def _carga_da_conta(transporte: Tr.Transporte, account_id: int) -> dict[str, Any] | Le.Recusa:
    """A conta por dentro, ou a recusa nomeada de quem a foi ler."""
    lida = transporte.trader(account_id)
    if not lida.ok:
        return Le.recusa(str(lida.motivo), lida.porque)
    interior = lida.valor
    if not isinstance(interior, dict):
        return Le.recusa("formato_invalido", "a leitura da conta nao veio com forma de objecto")
    return interior


def _saldo_em_decimal(conta: dict[str, Any], posicoes: list[Any]) -> str | Le.Recusa:
    """O saldo da conta em decimal do contrato, com o expoente lido pela regra da LEITURA (§0 do data-model).

    O expoente (`moneyDigits`) e' a unica grandeza que decide a unidade do dinheiro: sem ele um saldo e' um
    numero por ordens de grandeza. A regra (conta, e depois posicao; divergencia RECUSA) vive em `leitura.py`, e
    e' de la' que se usa — nunca se repete aqui.
    """
    expoente = Le._expoente_dos_valores(conta, posicoes)  # noqa: SLF001 (a regra e' da leitura, e so' dela)
    if isinstance(expoente, Le.Recusa):
        return expoente
    saldo = conta.get("saldo")
    if isinstance(saldo, bool) or not isinstance(saldo, int):
        return Le.recusa("campo_obrigatorio_ausente", f"a conta nao declarou o saldo legivel (veio {saldo!r})")
    return Le._decimal_de_escalado(saldo, expoente)  # noqa: SLF001


def _universo_do_instrumento(
    transporte: Tr.Transporte, account_id: int, instrumento: str
) -> int | Le.Recusa:
    """O `symbol_id` do instrumento, do universo do venue (RN-CT23: o NOME e' a chave estavel)."""
    universo = transporte.simbolos(account_id)
    if not universo.ok:
        return Le.recusa(str(universo.motivo), universo.porque)
    if not isinstance(universo.valor, list):
        return Le.recusa("formato_invalido", "o universo do venue nao veio em lista")
    resolvidos = So.resolver_instrumentos([instrumento], universo.valor)
    if isinstance(resolvidos, So.Recusa):
        return Le.recusa(resolvidos.motivo, resolvidos.porque)
    return resolvidos[instrumento]


def _unidade_do_instrumento(
    transporte: Tr.Transporte, account_id: int, symbol_id: int
) -> dict[str, Any] | Le.Recusa:
    """Os numeros do simbolo (minimo, maximo, passo, digitos, distancias) — o que a traducao consome."""
    numeros = transporte.simbolos_por_id(account_id, [symbol_id])
    if not numeros.ok:
        return Le.recusa(str(numeros.motivo), numeros.porque)
    if not isinstance(numeros.valor, list):
        return Le.recusa("formato_invalido", "a leitura do simbolo nao veio em lista")
    for simbolo in numeros.valor:
        if isinstance(simbolo, dict) and simbolo.get("symbol_id") == symbol_id:
            return simbolo
    return Le.recusa(
        "instrumento_desconhecido_no_manifesto",
        f"o venue nao devolveu o simbolo {symbol_id} que a sonda resolveu: sem os numeros dele nao ha traducao",
    )


def _unidade_para_a_traducao(simbolo: dict[str, Any]) -> dict[str, Any] | Le.Recusa:
    """Os numeros do simbolo, como o `transporte.py` os da' (inteiros do VENUE), -> a forma que a TRADUCAO le'.

    O `volume` e o `minimo`/`maximo`/`passo` do venue vivem em 0,01 de unidade, e as distancias
    (`slDistance`/`tpDistance`) em 1/100000 de preco (§0 do data-model): a conversao para as unidades neutras e'
    a MESMA da leitura, e vive em `leitura.py` — nao se repete aqui. A `unidade_das_distancias` NAO se declara: o
    data-model nao a decide, e um stop pedido com a unidade por decidir RECUSA no `ordens.py`
    (`capacidade_nao_declarada`) em vez de comparar numeros de unidades diferentes.
    """
    identificador = _inteiro(simbolo.get("symbol_id"))
    if identificador is None:
        return Le.recusa("campo_obrigatorio_ausente", f"o simbolo nao declarou `symbol_id` utilizavel ({simbolo.get('symbol_id')!r})")
    digitos = _inteiro(simbolo.get("digitos"))
    if digitos is None:
        return Le.recusa("campo_obrigatorio_ausente", f"o simbolo nao declarou `digitos` utilizavel ({simbolo.get('digitos')!r})")
    pip = _inteiro(simbolo.get("posicao_do_pip"))
    if pip is None:
        return Le.recusa(
            "campo_obrigatorio_ausente",
            f"o simbolo nao declarou `posicao_do_pip` utilizavel ({simbolo.get('posicao_do_pip')!r})",
        )

    unidade: dict[str, Any] = {"symbol_id": identificador, "digitos": digitos, "posicao_do_pip": pip}
    for campo in ("minimo", "maximo", "passo"):
        valor = _inteiro(simbolo.get(campo))
        if valor is None:
            return Le.recusa(
                "campo_obrigatorio_ausente",
                f"o simbolo nao declarou `{campo}` utilizavel ({simbolo.get(campo)!r}): sem ele a grelha do volume nao se confere",
            )
        unidade[campo] = Le._decimal_de_escalado(valor, Le.EXPOENTE_DO_VOLUME)  # noqa: SLF001
    for campo in ("distancia_minima_do_stop", "distancia_minima_do_alvo"):
        valor = _inteiro(simbolo.get(campo))
        if valor is not None:
            unidade[campo] = Le._decimal_de_escalado(valor, Le.EXPOENTE_DO_PRECO)  # noqa: SLF001
    modo = simbolo.get("modo_de_negociacao")
    if isinstance(modo, str):
        unidade["modo_de_negociacao"] = modo
    return unidade


def _preco_de_referencia(
    transporte: Tr.Transporte, account_id: int, symbol_id: int, instrumento: str
) -> str | Le.Recusa:
    """A regua do preco: a ULTIMA VELA FECHADA do instrumento, lida do venue.

    O venue desta ponta ainda nao entrega a cotacao por leitura (a subscricao de spots existe, a leitura do
    ultimo retrato nao): a regua que ele JA' publica e' a vela fechada. E' um numero DELE, nao nosso, e a
    escolha esta' declarada — [a confirmar em demonstracao, com a cotacao a serio].
    """
    fim = datetime.now(timezone.utc)
    inicio = fim - timedelta(hours=VELAS_PARA_O_PRECO_HORAS)
    velas = transporte.velas(account_id, symbol_id, PERIODO_DA_VELA_DE_REFERENCIA, inicio, fim)
    if not velas.ok:
        return Le.recusa(str(velas.motivo), velas.porque)
    if not isinstance(velas.valor, list) or not velas.valor:
        return Le.recusa(
            "campo_obrigatorio_ausente",
            f"o venue nao devolveu nenhuma vela de {instrumento}: sem a ultima vela fechada nao ha preco de "
            "referencia, e um preco inventado seria um numero nosso",
        )
    ultima = velas.valor[-1]
    if not isinstance(ultima, dict):
        return Le.recusa("formato_invalido", "a ultima vela do venue nao veio com forma de objecto")
    fecho = _decimal_textual(ultima.get("fecho"))
    if fecho is None:
        return Le.recusa(
            "formato_invalido",
            f"a ultima vela de {instrumento} veio sem fecho legivel (veio {ultima.get('fecho')!r})",
        )
    return fecho


def _decimal_textual(valor: Any) -> str | None:
    """Um numero do venue -> o decimal TEXTUAL do contrato. Nao passa por virgula flutuante binaria."""
    if isinstance(valor, bool) or valor is None:
        return None
    if isinstance(valor, Decimal):
        return format(valor, "f")
    if isinstance(valor, int):
        return str(valor)
    if isinstance(valor, float):
        return format(Decimal(str(valor)), "f")
    return None


# -----------------------------------------------------------------------------------------------------------
# O DESFECHO com os numeros do VENUE: a resolucao le'-se do evento, nunca se recalcula (RN-C10/FR-064).
# -----------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Atendimento:
    linhas: list[str] = field(default_factory=list)
    diag: list[dict[str, Any]] = field(default_factory=list)
    encerrar: bool = False


def _numeros_do_venue_do_evento(evento: dict[str, Any], expoente: int | None) -> dict[str, str]:
    """Os numeros que o evento do venue TRAZ, ja' na forma decimal do contrato — e so' os que ele traz.

    E' a materia da resolucao pos-envio (data-model §4): quantidade, nocional, margem e alavancagem efectiva,
    lidos do `order`/`position` do evento. O que o venue nao deu fica AUSENTE — e o contrato recusa a resolucao
    com `campo_obrigatorio_ausente`, que e' o estado honesto (o venue nao publica o preco de liquidacao).
    """
    numeros: dict[str, str] = {}
    ordem = evento.get("order")
    if isinstance(ordem, dict):
        executado = _inteiro(ordem.get("executedVolume"))
        preco = _inteiro(ordem.get("executionPrice"))
        if executado is not None and preco is not None:
            quantidade = Le._decimal_de_escalado(executado, Le.EXPOENTE_DO_VOLUME)  # noqa: SLF001
            preco_em_decimal = Le._decimal_de_escalado(preco, Le.EXPOENTE_DO_PRECO)  # noqa: SLF001
            numeros["quantidade"] = quantidade
            numeros["nocional"] = _produto(quantidade, preco_em_decimal)
            # O PRECO DO VENUE fica aqui, fora do conjunto fechado da resolucao: e' o numero de que a projeccao
            # [C] do `preco_de_liquidacao` vive quando `antes` NAO o trouxe (o FECHO, que nao tem resolucao
            # pre-envio — medido a 05/10/2026: sem ele o fecho a alavancagem != 1 saia com 4 dos 5 campos e o
            # contrato recusava-o). `montar_resolucao` ignora as chaves que nao conhece, por isso nao polui.
            numeros["preco"] = preco_em_decimal
    posicao = evento.get("position")
    if isinstance(posicao, dict):
        margem = _inteiro(posicao.get("usedMargin"))
        # O EXPOENTE DO DINHEIRO VEM DA CONTA E, QUANDO ELA NAO O TRAZ, DO PROPRIO EVENTO (05/10/2026). A regra da
        # LEITURA e' «conta, senao posicao» (`leitura._expoente_dos_valores`): a conta passa a declarar o
        # `moneyDigits` do VENUE (D2 fechado — `transporte.trader` pergunta-o por `ProtoOATraderReq`), e o evento
        # traz o MESMO numero na POSICAO. Le'-se da conta quando ela o tem; sem ele, le'-se do evento — nunca se
        # inventa (o `DEFAULT_MONEY_DIGITS` da biblioteca nao e' resposta).
        expoente_da_margem = expoente if expoente is not None else _inteiro(posicao.get("moneyDigits"))
        if margem is not None and expoente_da_margem is not None:
            numeros["margem_empenhada"] = Le._decimal_de_escalado(margem, expoente_da_margem)  # noqa: SLF001
        alavancagem = _inteiro(posicao.get("marginRate"))
        if alavancagem is not None:
            numeros["alavancagem_efectiva"] = str(alavancagem)
    return numeros


def _produto(primeiro: str, segundo: str) -> str:
    """O produto de dois decimais textuais, sem virgula flutuante: o contrato quer texto."""
    resultado = Decimal(primeiro) * Decimal(segundo)
    return format(resultado.normalize(), "f")


def _inteiro(valor: Any) -> int | None:
    """O valor quando e' um inteiro de verdade. `True`/`False` NAO sao inteiros aqui (sao booleanos)."""
    if isinstance(valor, bool) or not isinstance(valor, int):
        return None
    return valor


# -----------------------------------------------------------------------------------------------------------
# O ENVIO. O transporte e' quem tem o fio; aqui so' se lhe pede, com prazo, e nada se improvisa.
# -----------------------------------------------------------------------------------------------------------


def _com_prazo(chamada: Callable[[], Any], prazo_s: float) -> Any | None:
    """Corre a chamada e espera o prazo declarado. Prazo passado -> `None` (o venue nao respondeu).

    `None` NAO e' falha nem sucesso: e' o SILENCIO, que vira `desconhecido` no desfecho (FR-067).
    """
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="ctrader-envio")
    futuro = executor.submit(chamada)
    try:
        return futuro.result(timeout=prazo_s)
    except concurrent.futures.TimeoutError:
        return None
    finally:
        executor.shutdown(wait=False)


def _enviar(transporte: Tr.Transporte, verbo: str, account_id: int, accao: dict[str, Any]) -> Tr.Resultado:
    """Pede ao TRANSPORTE o envio da accao, pelo verbo declarado.

    Quando o verbo nao existe, a recusa e' NOMEADA: esta costura nao fala com a biblioteca do venue (D2), e um
    envio por um caminho que nao existe seria um envio as cegas.
    """
    metodo = getattr(transporte, verbo, None)
    if not callable(metodo):
        return Tr.Resultado(
            ok=False,
            motivo="capacidade_nao_declarada",
            porque=(
                f"o transporte desta ponta ainda nao tem o verbo `{verbo}`: a ordem nao se envia por um caminho "
                "que nao existe, e este processo nao fala com a biblioteca do venue (D2)"
            ),
        )
    resultado = metodo(account_id, accao)
    if isinstance(resultado, Tr.Resultado):
        return resultado
    return Tr.Resultado(
        ok=False,
        motivo="formato_invalido",
        porque=(
            f"o verbo `{verbo}` do transporte respondeu numa forma que esta costura nao le' (nao e' um "
            "`transporte.Resultado`): nao se adivinha o que o venue respondeu"
        ),
    )


def _desfecho_do_envio(
    arranque: Arranque, correlacao: str, evento: Any, resolucao: dict[str, str]
) -> tuple[list[str], list[dict[str, Any]]]:
    """Classifica o que o venue devolveu, e monta o desfecho (RN-C2/FR-063). Nunca inventa um desfecho."""
    carga, diag_local = _carga_do_desfecho(evento, resolucao)
    if carga is None:
        return [], diag_local
    linha = linha_do_contrato("desfecho", correlacao, carga)
    return ([] if linha is None else [linha]), diag_local


def _carga_do_desfecho(evento: Any, resolucao: dict[str, str]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """A CARGA neutra de UM evento do venue — ou `None` quando ele nao tem desfecho de ordem a dar.

    Separa os tres casos em que NAO ha' desfecho (acontecimento de conta, resposta ilegivel, e o contrato a
    recusar a carga) da montagem normal. E' a peca que a VIROU (a virada) reusa por PERNA: cada uma das duas
    pernas vale por si, e a que nao der desfecho publicavel di-lo no diagnostico, sem inventar linha.
    """
    diag_local: list[dict[str, Any]] = []
    if not isinstance(evento, dict):
        diag_local.append(
            {
                "etapa": "envio",
                "veredicto": "resposta_ilegivel",
                "porque": "o transporte devolveu a resposta do venue numa forma que nao se le' (nao e' objecto)",
            }
        )
        return None, diag_local
    if De.e_acontecimento_de_conta(evento):
        diag_local.append(
            {
                "etapa": "acontecimento_de_conta",
                "registo": De.acontecimento_de_conta(evento),
                "porque": "o venue mexeu no dinheiro da conta (swap/deposito/bonus): nao e' desfecho de ordem (RN-CT38)",
            }
        )
        return None, diag_local
    try:
        carga = De.desfecho_do_evento(evento, resolucao)
    except ValueError as erro:
        diag_local.append(
            {
                "etapa": "desfecho",
                "veredicto": "nao_publicado",
                "porque": f"o desfecho montado nao passou o contrato: {erro}",
            }
        )
        return None, diag_local
    return carga, diag_local


@dataclass(frozen=True)
class _Perna:
    """O que UMA perna do envio devolveu — dito, sem publicar linha nenhuma (quem chama decide).

    `estado`:
      * `evento`               — houve evento do venue (com o preenchimento seguido, D6); `carga` e' o desfecho
                                 NEUTRO dele, ou `None` quando ele nao e' desfecho de ordem publicavel;
      * `silencio`             — o venue nao respondeu no prazo (nem falha nem sucesso, FR-067); `carga` e' o
                                 `desconhecido` quando a resolucao o permite publicar;
      * `recusa_de_transporte` — o envio nao chegou ao fio (o verbo nao existe): `motivo`/`porque` NOMEADOS.
    """

    estado: str
    evento: dict[str, Any] | None = None
    carga: dict[str, Any] | None = None
    motivo: str | None = None
    porque: str = ""


def _perna_do_silencio(
    arranque: Arranque,
    resolucao: dict[str, str],
    alavancagem: Decimal | None,
    pendencia: Pendencia | None,
    diag_local: list[dict[str, Any]],
) -> _Perna:
    """A perna SEM resposta no prazo -> `desconhecido` (FR-067), com a pendencia marcada quando ela veio."""
    completa = _resolucao_do_silencio(resolucao, alavancagem)
    if pendencia is not None:
        # A pendencia guarda a resolucao COMPLETA (a mesma que sai no desfecho): se a reconciliacao depois
        # achar a ordem, o desfecho verdadeiro leva uma resolucao que passa o contrato — nunca a parcial.
        pendencia.resolucao = completa
    _registar_pendencia(arranque, pendencia, diag_local)
    try:
        carga = De.desfecho_do_silencio(completa, arranque.prazo_do_venue_ms)
    except ValueError as erro:
        diag_local.append({"etapa": "desfecho", "veredicto": "nao_publicado", "porque": str(erro)})
        return _Perna(estado="silencio", carga=None)
    return _Perna(estado="silencio", carga=carga)


def _perna_por_falta_de_preenchimento(
    arranque: Arranque,
    evento_aceite: dict[str, Any],
    seguido: Tr.Resultado,
    resolucao: dict[str, str],
    alavancagem: Decimal | None,
    pendencia: Pendencia | None,
    diag_local: list[dict[str, Any]],
) -> _Perna:
    """O ACEITE sem preenchimento dentro do prazo -> `desconhecido` + instrumento PENDENTE (D6/FR-067/068)."""
    marca, ordem_id = _marca_e_ordem_do_evento(evento_aceite)
    ordem = evento_aceite.get("order") if isinstance(evento_aceite, dict) else None
    diag_local.append(
        {
            "etapa": "envio",
            "veredicto": "aceite_sem_preenchimento_no_prazo",
            "motivo": seguido.motivo,
            "marca": marca,
            "ordem": ordem_id,
            "order": ordem if isinstance(ordem, dict) else None,
            "porque": seguido.porque,
        }
    )
    completa = _resolucao_do_silencio(resolucao, alavancagem)
    if pendencia is not None:
        # A pendencia guarda a resolucao COMPLETA e a marca do ACEITE: a leitura depois procura-a no registo do
        # venue e publica o desfecho verdadeiro — nunca a parcial.
        pendencia.resolucao = completa
        if pendencia.marca is None and marca is not None:
            pendencia.marca = marca
    _registar_pendencia(arranque, pendencia, diag_local)
    try:
        carga = De.desfecho_do_silencio(completa, arranque.prazo_do_venue_ms)
    except ValueError as erro:
        diag_local.append({"etapa": "desfecho", "veredicto": "nao_publicado", "porque": str(erro)})
        return _Perna(estado="silencio", carga=None)
    return _Perna(estado="silencio", carga=carga)


def _mandar_e_seguir(
    arranque: Arranque,
    verbo: str,
    accao: dict[str, Any],
    resolucao: dict[str, str],
    alavancagem: Decimal | None,
    conta: dict[str, Any] | None,
    diag_local: list[dict[str, Any]],
    pendencia: Pendencia | None,
    tick: str | None,
) -> _Perna:
    """Manda UMA perna ao venue e SEGUE o preenchimento (D6) — a maquina do envio, num so' sitio.

    E' a MESMA maquina para as duas pernas da virada (1.10.0(c)) e para a ordem simples: o que muda e' o que
    quem chama faz com o resultado — publicar um desfecho, ou compor o da virada. Nao publica linha nenhuma.
    """
    transporte = arranque.transporte
    ficha = arranque.ficha
    if transporte is None or ficha is None:
        return _Perna(
            estado="recusa_de_transporte",
            motivo="capacidade_nao_declarada",
            porque="nao ha transporte aberto: sem fio nao se envia ordem nenhuma",
        )
    account_id = ficha.ctid_trader_account_id
    prazo_s = arranque.prazo_do_venue_ms / 1000.0
    inicio_s = time.monotonic()
    enviado = _com_prazo(lambda: _enviar(transporte, verbo, account_id, accao), prazo_s)
    if enviado is None:
        diag_local.append(
            {
                "etapa": "envio",
                "veredicto": "sem_resposta_no_prazo",
                "verbo": verbo,
                "prazo_ms": arranque.prazo_do_venue_ms,
                "porque": "o venue nao respondeu dentro do prazo declarado: e' `desconhecido`, e so' a reconciliacao por leitura o faz sair daqui",
            }
        )
        return _perna_do_silencio(arranque, resolucao, alavancagem, pendencia, diag_local)
    if not enviado.ok:
        if enviado.motivo == "capacidade_nao_declarada":
            diag_local.append(
                {"etapa": "envio", "veredicto": "nao_enviado", "verbo": verbo, "motivo": enviado.motivo, "porque": enviado.porque}
            )
            return _Perna(estado="recusa_de_transporte", motivo=enviado.motivo, porque=enviado.porque)
        diag_local.append(
            {"etapa": "envio", "veredicto": "sem_resposta", "verbo": verbo, "motivo": enviado.motivo, "porque": enviado.porque}
        )
        return _perna_do_silencio(arranque, resolucao, alavancagem, pendencia, diag_local)

    # ---- D6: A ORDEM QUE PREENCHEU — SEGUIR O EVENTO QUE TRAZ OS NUMEROS (nunca os inventar) ----------------
    # O QUE FOI MEDIDO AO VIVO (05/10/2026, demonstracao): o venue responde `ORDER_ACCEPTED` — a ordem existe,
    # mas SEM `executedVolume`/`executionPrice`/`usedMargin` — e o PREENCHIMENTO chega DEPOIS, por evento proprio.
    # Ler so' o primeiro evento montava uma resolucao de 3 de 5 campos, o contrato recusava-a
    # (`campo_obrigatorio_ausente`) e a ordem PREENCHIDA nunca publicava linha nenhuma. Aqui segue-se o evento
    # seguinte, dentro do prazo declarado. Se ele nao chegar, cai-se no SILENCIO — nunca num sucesso inventado.
    expoente = _expoente_do_dinheiro(conta) if isinstance(conta, dict) else None
    numeros = _numeros_do_venue_do_evento(enviado.valor, expoente)
    evento_do_desfecho = enviado.valor
    if _precisa_seguir_o_preenchimento(enviado.valor, numeros):
        restante_s = max(0.0, prazo_s - (time.monotonic() - inicio_s))
        seguido = _seguir_o_preenchimento(arranque, enviado.valor, restante_s)
        if not seguido.ok:
            return _perna_por_falta_de_preenchimento(
                arranque, enviado.valor, seguido, resolucao, alavancagem, pendencia, diag_local
            )
        evento_do_desfecho = seguido.valor
        # OS DOIS EVENTOS SAO DO MESMO VENUE E DA MESMA ORDEM. O ACEITE traz numeros que o PREENCHIMENTO omite —
        # medido ao vivo a 05/10/2026: no FECHO o `position` do aceite traz o `usedMargin` (3740), e o do
        # preenchimento NAO. Combinam-se, e onde o preenchimento da' ele MANDA (e' o estado final). Sem isto a
        # margem do fecho so' se completava pela DECLARACAO, quando o VENUE a tinha publicado no aceite.
        numeros = {
            **_numeros_do_venue_do_evento(enviado.valor, expoente),
            **_numeros_do_venue_do_evento(evento_do_desfecho, expoente),
        }
        diag_local.append(
            {
                "etapa": "preenchimento",
                "veredicto": "seguido_por_evento",
                "tipo": evento_do_desfecho.get("executionType"),
                "porque": (
                    "o evento do envio nao trazia os numeros do preenchimento: seguiu-se o EVENTO do venue que "
                    "os traz (D6) — o desfecho leva-os de la', sem uma conta nossa pelo meio (FR-064)"
                ),
            }
        )
    resolucao_do_venue = _resolucao_completa(resolucao, numeros, alavancagem, tick)
    carga, diag_do_desfecho = _carga_do_desfecho(evento_do_desfecho, resolucao_do_venue)
    diag_local.extend(diag_do_desfecho)
    return _Perna(estado="evento", evento=evento_do_desfecho, carga=carga)


# -----------------------------------------------------------------------------------------------------------
# O CICLO DE SERVICO. Uma linha entra, uma mensagem sai — e o mandato e' relido a cada volta (RN-V10).
# -----------------------------------------------------------------------------------------------------------


def _correlacao_da_linha(linha: str) -> str:
    """O `id` do envelope, quando ele tem a forma do contrato; `sem_id` quando nao tem (nao se inventa um id)."""
    try:
        bruto = json.loads(linha)
    except json.JSONDecodeError:
        return "sem_id"
    if not isinstance(bruto, dict):
        return "sem_id"
    valor = bruto.get("id")
    if isinstance(valor, str) and PADRAO_CORRELACAO.match(valor):
        return valor
    return "sem_id"


def atender(linha: str, arranque: Arranque) -> Atendimento:
    """Atende UMA mensagem da costura. Devolve as linhas que saem e o diagnostico — nao escreve nada.

    A ORDEM DAS VERIFICACOES e' a ordem dos perigos: primeiro o envelope (um envelope invalido nao tem tipo nem
    carga), depois o tipo, depois o que depende do venue. O mandato (a ficha) e' o MESMO objecto em cada volta:
    um `arranque` novo por mensagem seria um conector que le' a ficha uma vez e a congela.
    """
    correlacao = _correlacao_da_linha(linha)
    veredicto = validar(linha)
    if veredicto.get("veredicto") == "erro_de_execucao":
        raise RuntimeError(
            "o instrumento de medicao (o contrato) falhou a julgar a mensagem: nao se responde por omissao"
        )
    if veredicto.get("veredicto") != "aceite":
        motivo = veredicto.get("motivo")
        return Atendimento(
            linhas=_desfecho_de_recusa(correlacao, motivo, "a mensagem nao passou o envelope do contrato"),
            diag=[
                {
                    "etapa": "envelope",
                    "veredicto": "recusado",
                    "motivo": motivo,
                    "detalhe": veredicto.get("detalhe"),
                }
            ],
        )

    mensagem = json.loads(linha)
    tipo = mensagem["tipo"]
    carga = mensagem["carga"]

    if tipo == TIPO_BOLETA:
        return _atender_boleta(correlacao, carga, arranque)
    if tipo == TIPO_COMANDO:
        return _atender_comando(correlacao, carga)
    return Atendimento(
        diag=[
            {
                "etapa": "tipo_nao_servido",
                "tipo": tipo,
                "porque": (
                    "esta porta de processo entrega a BOLETA (abrir e fechar) e a PARAGEM do protocolo. As "
                    "mensagens `mercado`, `manifesto`, `resolucao` e `desfecho` sao DESTE conector para a mesa "
                    "(nunca da mesa para ele), e um `comando` que nao seja a paragem e' da mesa — nao se improvisa "
                    "aqui. Nao sai linha nenhuma, e o silencio faz o outro lado ficar em ESPERA, nunca em sucesso"
                ),
            }
        ]
    )


def _atender_comando(correlacao: str, carga: dict[str, Any]) -> Atendimento:
    """O `comando` do vigia: a costura atende a PARAGEM, e so' a paragem.

    Um `stop` pelo protocolo encerra LIMPO: o processo para de servir, cumpre o `ao_desligar` da ficha e sai com
    zero. Um comando que nao seja a paragem nao se improvisa — a maquina de estados da mesa e' dela.
    """
    verbo = carga.get("verbo")
    if verbo == VERBO_DE_PARAGEM:
        return Atendimento(
            diag=[
                {
                    "etapa": "paragem",
                    "veredicto": "pedida_pelo_protocolo",
                    "pedido_id": carga.get("pedido_id"),
                    "porque": "o protocolo pediu a paragem: o processo encerra limpo, e o `ao_desligar` da ficha decide o que fica",
                }
            ],
            encerrar=True,
        )
    return Atendimento(
        diag=[
            {
                "etapa": "comando_nao_servido",
                "verbo": verbo,
                "porque": (
                    f"o unico verbo que esta costura atende e' `{VERBO_DE_PARAGEM}` (a paragem). Os outros quatro "
                    "verbos do vigia sao da MESA, e a mesa nao se improvisa dentro do conector (RN-V1)"
                ),
            }
        ]
    )


def _alavancagem_da_boleta(boleta: dict[str, Any]) -> Decimal | None:
    """A alavancagem que a boleta pediu, como Decimal — o que decide se `preco_de_liquidacao` pode ser `0`.

    O contrato garante a forma (decimal textual positivo); quando ela nao vier, `None` e' o honesto: nao se
    inventa uma alavancagem para completar uma resolucao.
    """
    valor = boleta.get("alavancagem")
    if isinstance(valor, str) and valor != "":
        return Decimal(valor)
    return None


def _atender_boleta(correlacao: str, boleta: dict[str, Any], arranque: Arranque) -> Atendimento:
    """A boleta neutra: o lado decide se e' ORDEM ou FECHO (e nunca outra coisa)."""
    lado = boleta.get("lado")
    if lado == LADO_DE_FECHO:
        return _atender_fecho(correlacao, boleta, arranque)
    if lado in LADOS_DE_ORDEM:
        return _atender_ordem(correlacao, boleta, arranque)
    return Atendimento(
        linhas=_desfecho_de_recusa(
            correlacao,
            "valor_fora_do_conjunto",
            (
                f"a boleta traz o lado {lado!r}: os lados deste processo sao {LADOS_DE_ORDEM} (ordem) e "
                f"`{LADO_DE_FECHO}` (fecho por posicao). Um lado que nao se serve nao se adivinha"
            ),
        )
    )


def _porta_da_sessao(
    correlacao: str,
    arranque: Arranque,
    instrumento: str | None,
    diag_local: list[dict[str, Any]],
    *,
    reconciliar_pendencia: bool,
) -> tuple[list[str], Atendimento | None]:
    """A PORTA DA SESSAO (FR-048/FR-070), no momento do pedido — e a recuperacao (US6 cenarios 2 e 3).

    Devolve `(linhas_a_prefixar, recusa)`. `recusa` e' o `Atendimento` que TRAVA o pedido (duas camadas em falta,
    ou a leitura da conta falhada apos a recuperacao); `None` quando o pedido segue. `linhas_a_prefixar` traz o
    desfecho VERDADEIRO da ordem antiga quando a recuperacao reconciliou uma pendencia — reconcilia-se ANTES de
    aceitar a ordem nova.

    A ORDEM DOS PASSOS e' a propria regra: (1) as DUAS camadas; (2) se a sessao recuperou, LER a conta (a
    primeira coisa); (3) se havia pendencia e o pedido e' uma ABERTURA, reconciliar antes de a aceitar. `None`
    quando as duas camadas estao prontas e nao ha' recuperacao por tratar.
    """
    transporte = arranque.transporte
    ficha = arranque.ficha
    if transporte is None or ficha is None:
        return [], Atendimento(
            linhas=_desfecho_de_recusa(
                correlacao, "capacidade_nao_declarada", "nao ha transporte aberto: sem fio nao se serve pedido nenhum"
            )
        )
    account_id = ficha.ctid_trader_account_id

    # (1) AS DUAS CAMADAS (FR-048) — a PRIMEIRA coisa, antes de qualquer leitura ou envio.
    camadas = transporte.conferir_as_duas_camadas(account_id)
    if camadas is not None:
        diag_local.append(
            {
                "etapa": "fr_048_as_duas_camadas",
                "instrumento": instrumento,
                "transporte_pronto": transporte.app_autenticada,
                "estado_da_sessao": transporte.estado_da_sessao(account_id),
                "motivo": camadas.motivo,
                "porque": camadas.porque,
            }
        )
        return [], Atendimento(
            linhas=_desfecho_de_recusa(correlacao, camadas.motivo, camadas.porque), diag=list(diag_local)
        )

    # (2) A RECUPERACAO (US6 cenario 2): a biblioteca re-autenticou; a PRIMEIRA coisa e' LER a conta.
    if not transporte.releitura_pendente(account_id):
        return [], None
    conta = _carga_da_conta(transporte, account_id)
    if isinstance(conta, Le.Recusa):
        diag_local.append(
            {
                "etapa": "fr_070_releitura_da_conta",
                "veredicto": "falhou",
                "motivo": conta.motivo,
                "porque": (
                    f"a sessao recuperou, mas a conta nao se leu ({conta.porque}): sem a leitura da conta depois de "
                    "re-autenticar, o pedido novo NAO se aceita (US6 cenario 2)"
                ),
            }
        )
        return [], Atendimento(
            linhas=_desfecho_de_recusa(correlacao, conta.motivo, conta.porque), diag=list(diag_local)
        )
    transporte.confirmar_releitura(account_id)
    diag_local.append(
        {
            "etapa": "fr_070_releitura_da_conta",
            "veredicto": "lida_antes_de_qualquer_envio",
            "porque": (
                "a sessao recuperou por re-autenticacao da biblioteca: a PRIMEIRA coisa foi LER a conta (US6 "
                "cenario 2), e so' depois se serve pedido novo"
            ),
        }
    )

    # (3) A PENDENCIA (US6 cenario 3): com a sessao recuperada e uma ordem `desconhecida` no instrumento,
    # reconcilia-se ANTES de aceitar a ordem nova. So' a ABERTURA reconcilia (o FECHO fecha, nao reconcilia).
    prefixo: list[str] = []
    if reconciliar_pendencia and instrumento is not None and instrumento in arranque.pendentes:
        at_rec = reconciliar(arranque, instrumento)
        prefixo.extend(at_rec.linhas)
        diag_local.extend(at_rec.diag)
        diag_local.append(
            {
                "etapa": "fr_070_reconciliar_antes_da_ordem_nova",
                "instrumento": instrumento,
                "veredicto": "decidida" if instrumento not in arranque.pendentes else "indecidivel",
                "porque": (
                    "a sessao recuperou com uma ordem `desconhecida` no instrumento: reconciliou-se por LEITURA "
                    "ANTES de aceitar ordem nova (US6 cenario 3 / FR-069)"
                ),
            }
        )
    return prefixo, None


def _atender_ordem(correlacao: str, boleta: dict[str, Any], arranque: Arranque) -> Atendimento:
    """A ABERTURA, com a PORTA DA SESSAO a' frente (FR-048/FR-070) e a recuperacao (US6 cenarios 2 e 3).

    A trava das DUAS camadas e' a PRIMEIRA coisa: antes de ler simbolo, de ler conta e — sobretudo — antes de
    enviar. Com a sessao INVALIDADA nada sai (o fecho tambem nao, que e' o mesmo caminho). Se a sessao RECUPEROU
    por re-autenticacao da biblioteca, a primeira coisa e' LER a conta, e uma pendencia reconcilia-se ANTES de
    aceitar ordem nova. As linhas da reconciliacao (o desfecho VERDADEIRO da ordem antiga) viajam nesta resposta,
    a' frente da ordem nova — reconciliar primeiro, aceitar depois.
    """
    instrumento = boleta.get("instrumento")
    diag_da_sessao: list[dict[str, Any]] = []
    prefixo, recusa = _porta_da_sessao(
        correlacao,
        arranque,
        instrumento if isinstance(instrumento, str) else None,
        diag_da_sessao,
        reconciliar_pendencia=True,
    )
    if recusa is not None:
        return recusa
    atendimento = _atender_ordem_no_venue(correlacao, boleta, arranque)
    return Atendimento(
        linhas=prefixo + atendimento.linhas,
        diag=diag_da_sessao + atendimento.diag,
        encerrar=atendimento.encerrar,
    )


def _atender_ordem_no_venue(correlacao: str, boleta: dict[str, Any], arranque: Arranque) -> Atendimento:
    """A ABERTURA: a leitura dos numeros, a trava do «fechar sim, abrir nao», a traducao, o envio e o desfecho."""
    if arranque.manifesto is None:
        return Atendimento(
            linhas=_desfecho_de_recusa(
                correlacao,
                "capacidade_nao_declarada",
                (
                    "nao ha manifesto publicado (a porta `sonda_e_manifesto` nao correu): sem as unidades "
                    "declaradas pelo venue nao ha traducao possivel, e nao se envia uma ordem a' sorte (RN-C7)"
                ),
            )
        )
    assert arranque.transporte is not None
    assert arranque.ficha is not None
    transporte = arranque.transporte
    account_id = arranque.ficha.ctid_trader_account_id
    instrumento = boleta.get("instrumento")
    if not isinstance(instrumento, str) or instrumento == "":
        return Atendimento(
            linhas=_desfecho_de_recusa(correlacao, "campo_obrigatorio_ausente", "a boleta nao nomeia o instrumento")
        )

    # ---- FR-068: com uma ordem `desconhecida` PENDENTE neste instrumento, a ordem NOVA NAO ENTRA ----------
    # E' a Invariante 5 da maquina de estados: uma segunda ordem sobre uma posicao que TALVEZ exista e' abrir
    # duas vezes. A trava e' PURA — corre ANTES de qualquer leitura de simbolo e de qualquer envio — e por
    # isso sao ZERO as mensagens ao protocolo (a prova (b) conta-as). O FECHO nao passa por aqui de proposito
    # (`_atender_fecho` e' outro caminho): a exposicao tem de se poder sempre desmontar.
    pendencia = arranque.pendentes.get(instrumento)
    if pendencia is not None:
        return Atendimento(
            linhas=_desfecho_de_recusa(
                correlacao,
                MOTIVO_DA_ORDEM_NOVA_COM_PENDENTE,
                (
                    f"ha' uma ordem DESCONHECIDA por reconciliar em {instrumento} (o bilhete `{pendencia.correlacao}`, "
                    f"marca {pendencia.marca!r}): o prazo declarado foi excedido e ela ainda nao voltou do venue — "
                    "o bilhete pode ter chegado. A ordem nova NAO entra: primeiro reconcilia-se por leitura "
                    f"(FR-068/FR-069). O FECHO continua a passar. Nenhuma mensagem foi enviada ao venue; o motivo "
                    f"`{MOTIVO_DA_ORDEM_NOVA_COM_PENDENTE}` e' o do vocabulario da mesa para este caso (a accao "
                    "`parar_e_reconciliar`, `core/ciclo/acoes.json`)."
                ),
            ),
            diag=[
                {
                    "etapa": "fr_068_ordem_nova_com_pendente",
                    "instrumento": instrumento,
                    "motivo": MOTIVO_DA_ORDEM_NOVA_COM_PENDENTE,
                    "pendencia_de": pendencia.correlacao,
                    "marca_da_pendencia": pendencia.marca,
                    "porque": "o instrumento esta' pendente: a ordem nova e' recusada ANTES de qualquer envio",
                }
            ],
        )

    symbol_id = _universo_do_instrumento(transporte, account_id, instrumento)
    if isinstance(symbol_id, Le.Recusa):
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, symbol_id.motivo, symbol_id.porque))
    simbolo = _unidade_do_instrumento(transporte, account_id, symbol_id)
    if isinstance(simbolo, Le.Recusa):
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, simbolo.motivo, simbolo.porque))
    conta = _carga_da_conta(transporte, account_id)
    if isinstance(conta, Le.Recusa):
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, conta.motivo, conta.porque))

    # A TRAVA DOS DOIS MODOS «fechar sim, abrir nao» (RN-CT12/RN-CT22): o direito da CONTA e o modo do SIMBOLO.
    # E' `fecho.py` que a decide — a mesma regra do caminho do fecho, num so' sitio.
    abertura = Fe.decidir_abertura(
        {
            "conta": arranque.ficha.conta,
            "instrumento": instrumento,
            "direitos_da_conta": conta.get("direitos"),
            "modo_do_simbolo": simbolo.get("modo_de_negociacao"),
        }
    )
    if abertura.acao == Fe.ACAO_RECUSAR:
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, abertura.motivo, abertura.porque))

    unidade = _unidade_para_a_traducao(simbolo)
    if isinstance(unidade, Le.Recusa):
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, unidade.motivo, unidade.porque))

    posicoes = transporte.posicoes(account_id)
    if not posicoes.ok:
        return Atendimento(
            linhas=_desfecho_de_recusa(
                correlacao,
                posicoes.motivo,
                f"a leitura das posicoes falhou ({posicoes.porque}): sem ela o expoente do dinheiro nao se le'",
            )
        )
    if not isinstance(posicoes.valor, list):
        return Atendimento(
            linhas=_desfecho_de_recusa(correlacao, "formato_invalido", "a leitura das posicoes nao veio em lista")
        )
    saldo = _saldo_em_decimal(conta, posicoes.valor)
    if isinstance(saldo, Le.Recusa):
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, saldo.motivo, saldo.porque))
    preco = _preco_de_referencia(transporte, account_id, symbol_id, instrumento)
    if isinstance(preco, Le.Recusa):
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, preco.motivo, preco.porque))

    # ---- A VIRADA (1.10.0): a POSICAO VIVA entra na traducao como DADO (o conector e' quem a le', RN-B0) ------
    # Com `reverter: true`, a traducao CONFERE a posicao viva — sem ela, ou ja' do lado declarado, RECUSA por
    # nome (`reversao_sem_posicao_a_reverter`). Com uma posicao OPOSTA, a virada segue por DUAS pernas na MESMA
    # passagem (1.10.0(c)): este venue nao faz netting na inversao. `duas_posicoes_no_mesmo_instrumento` (achado
    # 3 do data-model) tambem RECUSA aqui — nao se escolhe uma posicao para virar.
    posicao_a_reverter: dict[str, Any] | None = None
    if boleta.get("reverter") is True:
        achada = Fe.posicao_do_instrumento(posicoes.valor, symbol_id)
        if isinstance(achada, Fe.Recusa):
            return Atendimento(linhas=_desfecho_de_recusa(correlacao, achada.motivo, achada.porque))
        posicao_a_reverter = achada

    traduzido = Or.traduzir(
        {
            "boleta": boleta,
            "manifesto": arranque.manifesto,
            "simbolo": unidade,
            "saldo": saldo,
            "preco": preco,
            "posicao_a_reverter": posicao_a_reverter,
        }
    )
    if isinstance(traduzido, Or.Recusa):
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, traduzido.motivo, traduzido.porque))

    diag_local = [
        {
            "etapa": "traducao",
            "instrumento": instrumento,
            "symbol_id": symbol_id,
            "accao": traduzido.accao,
            "resolucao_antes_do_envio": traduzido.resolucao,
            "regua_do_preco": f"{PERIODO_DA_VELA_DE_REFERENCIA} (ultima vela fechada) — [a confirmar em demonstracao]",
        }
    ]
    # O `tick` do simbolo (a grade `10^-digitos`), para a projecao [C] do preco de liquidacao quando a resolucao
    # do desfecho a tiver de completar (D6/D7, 05/10/2026). A resolucao pre-envio ja' o traz; aqui e' a MESMA
    # grade, do MESMO simbolo — e a virada usa-a nas duas pernas.
    tick = Or._tick_por_digitos(simbolo.get("digitos"))  # noqa: SLF001 (a regra do tick e' do `ordens.py`)

    # ---- A VIRADA (1.10.0): FECHAR a viva e ABRIR a do lado declarado, na MESMA passagem ----------------------
    if posicao_a_reverter is not None:
        diag_local.append(
            {
                "etapa": "virada",
                "instrumento": instrumento,
                "posicao_viva": posicao_a_reverter.get("posicao"),
                "lado_da_posicao_viva": posicao_a_reverter.get("lado"),
                "porque": (
                    "a boleta pede `reverter: true` com uma posicao viva do lado OPOSTO: este venue nao faz "
                    "netting (RN-CT34), logo a virada faz-se em DUAS pernas na MESMA passagem (1.10.0(c)) — "
                    "`fechar_posicao` pela viva e `colocar_ordem` pelo lado declarado"
                ),
            }
        )
        return _enviar_reversao_e_desfechar(
            correlacao,
            boleta,
            arranque,
            symbol_id,
            instrumento,
            posicao_a_reverter,
            traduzido.accao,
            traduzido.resolucao,
            conta,
            diag_local,
            tick,
        )

    alavancagem = _alavancagem_da_boleta(boleta)
    marca = traduzido.accao.get("clientOrderId")
    referencia = boleta.get("referencia_do_cliente")
    pendencia = Pendencia(
        instrumento=instrumento,
        symbol_id=symbol_id,
        marca=marca if isinstance(marca, str) else None,
        position_id=None,
        referencia_do_cliente=referencia if isinstance(referencia, str) else None,
        resolucao=traduzido.resolucao,
        alavancagem=None if alavancagem is None else _texto_de_decimal(alavancagem),
        correlacao=correlacao,
        instante_ms=_agora_ms(),
        verbo=VERBO_DE_ABERTURA,
    )

    # ---- FR-061/D-009: RECONCILIAR ANTES DE ENVIAR — a mesma marca nao produz segunda ordem ---------------
    # Esta leitura acontece em TODO o envio (D-009): e' a guarda de idempotencia e, ao mesmo tempo, a que
    # sobrevive ao processo morrer — a memoria perde-se, a leitura vai ao venue e encontra a marca.
    travado = _reconciliar_antes_de_enviar(
        arranque, correlacao, marca, traduzido.resolucao, alavancagem, pendencia, diag_local
    )
    if travado is not None:
        return travado

    return _enviar_e_desfechar(
        correlacao,
        arranque,
        VERBO_DE_ABERTURA,
        traduzido.accao,
        traduzido.resolucao,
        alavancagem,
        conta,
        diag_local,
        pendencia=pendencia,
        tick=tick,
    )


def _atender_fecho(correlacao: str, boleta: dict[str, Any], arranque: Arranque) -> Atendimento:
    """O FECHO, com a PORTA DA SESSAO a' frente (FR-048/FR-070).

    AO FECHO, UMA SESSAO CAIDA NAO SERVE PEDIDO NENHUM — e' a decisao, e o porque' e' concreto: o fecho deste venue
    e' uma ordem que REFERENCIA a posicao e vai pelo MESMO canal (o protocolo da conta). Com a sessao invalidada o
    venue recusa-a de qualquer forma, e tentar envia'-la seria mandar uma mensagem por uma sessao que se sabe
    morta. Por isso o fecho tambem e' recusado por `prazo_excedido` — DISTINTO da pendencia do FR-068, em que o
    fecho CONTINUA a passar (ai' a sessao esta' VIVA: so' ha' uma ordem `desconhecida` por reconciliar, e a
    exposicao tem de se poder desmontar). Sessao caida = parar; pendencia = fechar continua. Sao duas regras, e
    nao se misturam.
    """
    diag_da_sessao: list[dict[str, Any]] = []
    instrumento = boleta.get("instrumento")
    prefixo, recusa = _porta_da_sessao(
        correlacao,
        arranque,
        instrumento if isinstance(instrumento, str) else None,
        diag_da_sessao,
        reconciliar_pendencia=False,
    )
    if recusa is not None:
        return recusa
    atendimento = _atender_fecho_no_venue(correlacao, boleta, arranque)
    return Atendimento(
        linhas=prefixo + atendimento.linhas,
        diag=diag_da_sessao + atendimento.diag,
        encerrar=atendimento.encerrar,
    )


def _atender_fecho_no_venue(correlacao: str, boleta: dict[str, Any], arranque: Arranque) -> Atendimento:
    """O FECHO: fecha POR POSICAO, e sem posicao nao sai ordem nenhuma (FR-065/SC-017)."""
    if arranque.ficha is None:
        return Atendimento()
    transporte = arranque.transporte
    if transporte is None:
        return Atendimento(
            linhas=_desfecho_de_recusa(
                correlacao, "capacidade_nao_declarada", "nao ha transporte aberto: sem fio nao ha fecho a enviar"
            )
        )
    account_id = arranque.ficha.ctid_trader_account_id
    instrumento = boleta.get("instrumento")
    if not isinstance(instrumento, str) or instrumento == "":
        return Atendimento(
            linhas=_desfecho_de_recusa(correlacao, "campo_obrigatorio_ausente", "a boleta nao nomeia o instrumento")
        )
    symbol_id = _universo_do_instrumento(transporte, account_id, instrumento)
    if isinstance(symbol_id, Le.Recusa):
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, symbol_id.motivo, symbol_id.porque))

    posicoes = transporte.posicoes(account_id)
    if not posicoes.ok:
        return Atendimento(
            linhas=_desfecho_de_recusa(
                correlacao,
                posicoes.motivo,
                (
                    f"a leitura das posicoes falhou ({posicoes.porque}): sem ela nao se sabe se ha' o que fechar, "
                    "e o desconhecido nao vira `nada`"
                ),
            )
        )
    marca = boleta.get("marca_de_posse")
    decisao = Fe.decidir_fecho(
        {
            "conta": arranque.ficha.conta,
            "instrumento": instrumento,
            "symbol_id": symbol_id,
            "posicoes": posicoes.valor,
            "marca_do_cliente": None if isinstance(marca, bool) else str(marca) if isinstance(marca, int) else None,
        }
    )
    if decisao.acao == Fe.ACAO_NADA:
        # "NADA" NAO E' MENSAGEM DO CONTRATO: as quatro classificacoes do desfecho sao aceite/parcial/recusado/
        # desconhecido, e nao ha' `nada` nem corpo para ele. O que se faz e' NAO ENVIAR ORDEM NENHUMA (o
        # FR-065/SC-017, que e' a parte medivel) e di-lo no diagnostico — nunca uma recusa inventada, que diria
        # a' mesa que a ordem falhou quando o que aconteceu foi nao haver nada a fechar.
        return Atendimento(
            diag=[
                {
                    "etapa": "fecho",
                    "veredicto": "nada",
                    "instrumento": instrumento,
                    "motivo": decisao.motivo,
                    "porque": decisao.porque,
                }
            ]
        )
    if decisao.acao == Fe.ACAO_RECUSAR:
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, decisao.motivo, decisao.porque))
    ordem = decisao.ordem
    if ordem is None:
        return Atendimento(
            linhas=_desfecho_de_recusa(
                correlacao, "campo_obrigatorio_ausente", "a decisao de fecho nao trouxe ordem para enviar"
            )
        )
    conta_interior = _carga_da_conta(transporte, account_id)
    if isinstance(conta_interior, Le.Recusa):
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, conta_interior.motivo, conta_interior.porque))
    diag_local = [
        {
            "etapa": "fecho",
            "instrumento": instrumento,
            "symbol_id": symbol_id,
            "por_positionId": ordem.get("positionId"),
            "porque": decisao.porque,
        }
    ]
    # O `tick` do simbolo (a grade `10^-digitos`) para a projecao [C] do `preco_de_liquidacao` DO FECHO (D7,
    # medido a 05/10/2026): o fecho NAO tem resolucao pre-envio, e sem esse 5o campo a resolucao saia com 4 e o
    # contrato RECUSAVA o desfecho (a prova 10 ficava bloqueada). A leitura e' BEST-EFFORT: se falhar, o fecho
    # SEGUE (a exposicao tem de poder desmontar-se, Invariante 5) e so' o campo nao se completa.
    simbolo_do_fecho = _unidade_do_instrumento(transporte, account_id, symbol_id)
    tick = (
        Or._tick_por_digitos(simbolo_do_fecho.get("digitos"))  # noqa: SLF001 (a regra do tick e' do `ordens.py`)
        if isinstance(simbolo_do_fecho, dict)
        else None
    )
    return _enviar_e_desfechar(
        correlacao, arranque, VERBO_DE_FECHO, ordem, {}, _alavancagem_da_boleta(boleta), conta_interior, diag_local,
        tick=tick,
    )


def _completar_pela_declaracao(resolucao: dict[str, str], alavancagem: Decimal | None) -> dict[str, str]:
    """Completa `alavancagem_efectiva`/`margem_empenhada` pela DECLARACAO da boleta quando o VENUE nao os deu ([C]).

    PARA QUE SERVE, e por que existe (05/10/2026). O CONTRATO exige os CINCO campos da resolucao. `quantidade`,
    `nocional` e o `preco_de_liquidacao` a traducao ja' os escreve; `margem_empenhada` e `alavancagem_efectiva`
    entram quando o VENUE os da. Mas ha' dois caminhos em que ele NAO os da':

      * o SILENCIO (`desconhecido`, FR-067): o venue nao respondeu NADA — sem numero nenhum para ler, os dois
        campos completam-se pela declaracao, senao o contrato recusa e a linha do `desconhecido` nunca sai;
      * o DESFECHO de uma ordem PREENCHIDA (D6, medido AO VIVO a 05/10/2026): o `position` do evento empurrado
        traz `usedMargin` mas NAO `marginRate` — o desfecho saia com 4 dos 5 campos e o contrato RECUSAVA-o
        (a prova 8 ficava sem linha). No FECHO o `position` do evento nao traz nem um nem outro.

    A regra e' a MESMA do conector irmao (`brokers/hyperliquid/conector.ts:748`): `alavancagem_efectiva` = a
    pedida; `margem_empenhada` = `nocional / alavancagem`. O numero do VENUE MANDA: onde ele o deu, este passo
    nao toca (os campos ja' estao em `resolucao`); so' preenche o que falta.
    """
    completa = dict(resolucao)
    if alavancagem is None:
        return completa
    if "alavancagem_efectiva" not in completa:
        completa["alavancagem_efectiva"] = _texto_de_decimal(alavancagem)
    if "margem_empenhada" not in completa:
        nocional = completa.get("nocional")
        if isinstance(nocional, str):
            try:
                margem = Decimal(nocional) / alavancagem
            except (InvalidOperation, DivisionByZero):
                return completa
            completa["margem_empenhada"] = _texto_de_decimal(margem)
    return completa


def _resolucao_do_silencio(resolucao: dict[str, str], alavancagem: Decimal | None) -> dict[str, str]:
    """A resolucao que acompanha um `desconhecido` (FR-067): a de ANTES do envio, COMPLETADA pela declaracao.

    Mesma completacao declarada que o desfecho usa quando o venue omite `usedMargin`/`marginRate` (ver
    `_completar_pela_declaracao`): aqui o venue nao respondeu NADA, e nao se deixa o `desconhecido` por publicar.
    """
    return _completar_pela_declaracao(resolucao, alavancagem)


def _texto_de_decimal(valor: Decimal) -> str:
    """Um Decimal -> o decimal textual do contrato: sem expoente e sem zeros a' direita.

    SEM FALLBACK (05/10/2026): `format(Decimal, "f")` produz sempre um texto (um zero fica «0»), e o `rstrip` so'
    tira zeros e o ponto a' DIREITA — o texto nunca fica vazio, logo um `or "0"` seria codigo morto. A catraca de
    fallbacks da casa exige ZERO valores literais por omissao, por isso devolve-se o texto tal como esta'.
    """
    texto = format(valor, "f")
    if "." in texto:
        texto = texto.rstrip("0").rstrip(".")
    return texto


def _enviar_e_desfechar(
    correlacao: str,
    arranque: Arranque,
    verbo: str,
    accao: dict[str, Any],
    resolucao: dict[str, str],
    alavancagem: Decimal | None,
    conta: dict[str, Any],
    diag_local: list[dict[str, Any]],
    pendencia: Pendencia | None = None,
    tick: str | None = None,
) -> Atendimento:
    """O envio (com prazo) e o desfecho. O silencio do venue vira `desconhecido` — nem falha nem sucesso.

    Quando o envio fica em SILENCIO e a `pendencia` veio preenchida, o instrumento passa a PENDENTE (FR-068):
    a memoria guarda SO' que ha' algo por reconciliar e a marca por onde o procurar — nunca a verdade, que
    so' a leitura do venue da' (FR-069). E' essa pendencia que trava a ordem NOVA no mesmo instrumento e que
    o FECHO NAO le' (o fecho continua a passar).
    """
    perna = _mandar_e_seguir(arranque, verbo, accao, resolucao, alavancagem, conta, diag_local, pendencia, tick)
    if perna.estado == "recusa_de_transporte":
        return Atendimento(linhas=_desfecho_de_recusa(correlacao, perna.motivo, perna.porque), diag=diag_local)
    if perna.carga is None:
        return Atendimento(diag=diag_local)
    linha = linha_do_contrato("desfecho", correlacao, perna.carga)
    return Atendimento(linhas=[] if linha is None else [linha], diag=diag_local)


def _classificacao_do_evento(evento: Any) -> tuple[str | None, str | None]:
    """A classificacao NEUTRA de UM evento do venue — ou `(None, None)` quando ele nao e' desfecho de ordem.

    Nao constroi a carga (isso e' `_carga_do_desfecho`): serve para, na virada, saber se a perna do FECHO se
    pode considerar passada ANTES de decidir enviar (ou nao) a da abertura.
    """
    if not isinstance(evento, dict):
        return None, None
    if De.e_acontecimento_de_conta(evento):
        return None, None
    try:
        veredicto = De.classificar_ordem(evento)
    except ValueError:
        return None, None
    return veredicto.classificacao, veredicto.motivo


def _com_virada(
    carga: dict[str, Any],
    registo_do_fecho: dict[str, Any],
    registo_da_abertura: dict[str, Any],
    o_que_fica: dict[str, Any],
) -> dict[str, Any]:
    """A carga do desfecho da VIRADA: a da perna que decide + as DUAS pernas e o que FICA, nomeado.

    O `resposta_do_venue` e' um objecto LIVRE no contrato (o venue da'-o como o da'): e' ai' que a virada regista
    o que ACONTECEU em cada perna — para que MEIA VIRADA nunca fique em silencio. A classificacao e a `resolucao`
    de cima sao, por inteiro, as da perna que decide (a abertura, quando ela correu; o fecho, quando parou ai').
    """
    composta = dict(carga)
    resposta = composta.get("resposta_do_venue")
    resposta = dict(resposta) if isinstance(resposta, dict) else {}
    resposta["virada"] = {
        "nota": (
            "1.10.0(c): o venue nao faz netting, logo a virada fez-se em DUAS pernas na MESMA passagem — FECHAR "
            "a posicao viva e ABRIR a do lado declarado. Cada perna vai nomeada abaixo, com o que ficou (FR-064)"
        ),
        "perna_1_o_fecho": registo_do_fecho,
        "perna_2_a_abertura": registo_da_abertura,
        "o_que_fica": o_que_fica,
    }
    composta["resposta_do_venue"] = resposta
    return composta


def _o_que_fica_da_virada(boleta: dict[str, Any], perna_da_abertura: _Perna, carga_da_abertura: dict[str, Any]) -> dict[str, Any]:
    """O que FICA no fim da virada: a posicao NOVA — ou `plano`, quando a abertura nao se fez.

    Os numeros sao os do VENUE, sem uma conta nossa pelo meio (FR-064): a `resolucao` de cima (os cinco campos) e
    os crus do evento de preenchimento (`executedVolume` em 0,01, `executionPrice` em 1/100000).
    """
    resolucao = carga_da_abertura.get("resolucao")
    resolucao = dict(resolucao) if isinstance(resolucao, dict) else {}
    evento = perna_da_abertura.evento
    ordem_bruta = evento.get("order") if isinstance(evento, dict) else None
    posicao_bruta = evento.get("position") if isinstance(evento, dict) else None
    ordem: dict[str, Any] = ordem_bruta if isinstance(ordem_bruta, dict) else {}
    posicao: dict[str, Any] = posicao_bruta if isinstance(posicao_bruta, dict) else {}
    classificacao = carga_da_abertura.get("classificacao")
    if classificacao in ("aceite", "parcial"):
        descricao = "a posicao NOVA (a que a mesa passa a gerir), com os numeros do VENUE"
    elif classificacao == "desconhecido":
        descricao = (
            "a posicao NOVA ficou em DUVIDA (desconhecido): a abertura pode ter chegado — a reconciliacao por "
            "leitura decide (FR-067/069)"
        )
    elif classificacao == "recusado":
        descricao = "PLANO: o fecho passou e a abertura foi RECUSADA — nao ha' posicao viva (o que ficou e' nada)"
    else:
        descricao = "a abertura nao deu desfecho publicavel: o estado tem de ser lido do venue"
    return {
        "descricao": descricao,
        "positionId": posicao.get("positionId") if posicao.get("positionId") else None,
        "lado": boleta.get("lado"),
        "volume_no_venue_em_centesimos": ordem.get("executedVolume"),
        "preco_no_venue": ordem.get("executionPrice"),
        "margem_empenhada": resolucao.get("margem_empenhada"),
        "alavancagem_efectiva": resolucao.get("alavancagem_efectiva"),
        "nocional": resolucao.get("nocional"),
        "quantidade": resolucao.get("quantidade"),
        "resolucao": resolucao,
    }


def _enviar_reversao_e_desfechar(
    correlacao: str,
    boleta: dict[str, Any],
    arranque: Arranque,
    symbol_id: int,
    instrumento: str,
    posicao_a_reverter: dict[str, Any],
    accao_abertura: dict[str, Any],
    resolucao_abertura: dict[str, str],
    conta: dict[str, Any],
    diag_local: list[dict[str, Any]],
    tick: str | None,
) -> Atendimento:
    """A VIRADA (1.10.0) em DUAS pernas na MESMA passagem: FECHA a posicao viva e ABRE a do lado declarado.

    PORQUE DUAS PERNAS, e nao uma. O contrato (1.10.0(c)) manda o conector executar as duas quando o venue nao
    faz netting na inversao, e este venue NAO faz (`reduce_only_suportado: false`, RN-CT34): o fecho e' uma ordem
    POR POSICAO (`positionId`), a abertura e' uma ordem a mercado. Sao os DOIS verbos que o transporte ja' tem
    (`fechar_posicao`, `colocar_ordem`) — nada de protocolo improvisado.

    NUNCA MEIA VIRADA EM SILENCIO. Cada perna passa pela MESMA maquina (`_mandar_e_seguir`) e o desfecho diz
    SEMPRE o que FICOU, nomeado, em `resposta_do_venue.virada`:
      * o FECHO foi RECUSADO pelo venue: a posicao viva CONTINUA aberta, e a abertura NAO se envia;
      * o FECHO ficou `desconhecido` (silencio): nao se sabe se a viva fechou — abertura NAO se envia, e o
        instrumento fica PENDENTE para a reconciliacao (US5/US6, FR-067/068/069);
      * o fecho passou e a ABERTURA falhou: o par fica PLANO — o `o_que_fica` di-lo.
    A classificacao e a `resolucao` de cima sao as da perna que DECIDE: a abertura quando ela correu (descrevendo
    a posicao NOVA, com os numeros do VENUE), o fecho quando a virada parou ai'.

    A IDEMPOTENCIA (FR-061/D-009) e' a da ABERTURA e corre ANTES de qualquer perna: se a marca ja' produziu
    ordem neste venue, a virada JA' se fez — nao se manda nem o fecho nem a abertura.
    """
    alavancagem = _alavancagem_da_boleta(boleta)
    marca = accao_abertura.get("clientOrderId")
    referencia = boleta.get("referencia_do_cliente")
    ficha = arranque.ficha
    decisao_do_fecho = Fe.decidir_fecho(
        {
            "conta": ficha.conta if ficha is not None else None,
            "instrumento": instrumento,
            "symbol_id": symbol_id,
            "posicoes": [posicao_a_reverter],
            "marca_do_cliente": None,  # o fecho e' por POSICAO: a marca e' da ORDEM NOVA, e o venue nao a leva no fecho
        }
    )
    if decisao_do_fecho.acao != Fe.ACAO_FECHAR or decisao_do_fecho.ordem is None:
        return Atendimento(
            linhas=_desfecho_de_recusa(correlacao, decisao_do_fecho.motivo, decisao_do_fecho.porque),
            diag=diag_local,
        )
    ordem_de_fecho = decisao_do_fecho.ordem
    registo_do_fecho: dict[str, Any] = {
        "perna": "1_de_2",
        "acao": "fechar_a_posicao_viva",
        "positionId": ordem_de_fecho.get("positionId"),
        "volume_no_venue_em_centesimos": ordem_de_fecho.get("volume"),
        "lado_da_posicao_viva": posicao_a_reverter.get("lado"),
    }
    diag_local.append(
        {
            "etapa": "virada",
            "perna": "1_de_2_fechar_a_viva",
            "instrumento": instrumento,
            "positionId": ordem_de_fecho.get("positionId"),
            "volume": ordem_de_fecho.get("volume"),
            "porque": (
                "1.10.0(c): o venue NAO faz netting, logo a virada faz-se em DUAS pernas na MESMA passagem. Esta "
                "e' a 1.a — FECHAR a posicao viva POR POSICAO (`positionId`), com o volume que o venue publicou"
            ),
        }
    )
    pendencia_da_abertura = Pendencia(
        instrumento=instrumento,
        symbol_id=symbol_id,
        marca=marca if isinstance(marca, str) else None,
        position_id=None,
        referencia_do_cliente=referencia if isinstance(referencia, str) else None,
        resolucao=resolucao_abertura,
        alavancagem=None if alavancagem is None else _texto_de_decimal(alavancagem),
        correlacao=correlacao,
        instante_ms=_agora_ms(),
        verbo=VERBO_DE_ABERTURA,
    )
    # FR-061/D-009 — reconciliar ANTES de qualquer perna (a marca da ABERTURA e' a chave da virada).
    travado = _reconciliar_antes_de_enviar(
        arranque, correlacao, marca, resolucao_abertura, alavancagem, pendencia_da_abertura, diag_local
    )
    if travado is not None:
        return travado

    # ============================== PERNA 1: FECHAR A POSICAO VIVA ==============================
    perna_do_fecho = _mandar_e_seguir(
        arranque, VERBO_DE_FECHO, ordem_de_fecho, {}, alavancagem, conta, diag_local, None, tick
    )
    if perna_do_fecho.estado == "recusa_de_transporte":
        return Atendimento(
            linhas=_desfecho_de_recusa(correlacao, perna_do_fecho.motivo, perna_do_fecho.porque), diag=diag_local
        )
    classificacao_do_fecho, _motivo_do_fecho = _classificacao_do_evento(perna_do_fecho.evento)
    fecho_passou = perna_do_fecho.estado == "evento" and classificacao_do_fecho in ("aceite", "parcial")
    # O ESTADO da 1.a perna, para o desfecho o dizer (o que FICOU, nomeado): do evento quando o houve, ou o
    # `desconhecido` do silencio.
    registo_do_fecho["classificacao"] = classificacao_do_fecho if perna_do_fecho.estado == "evento" else "desconhecido"
    registo_do_fecho["motivo"] = _motivo_do_fecho

    if not fecho_passou:
        # A ABERTURA NAO SE ENVIA. Se o que houve foi SILENCIO, o instrumento fica PENDENTE (nao se sabe se a
        # viva fechou) e a reconciliacao por leitura decide. Recusa do venue: a viva CONTINUA aberta.
        if perna_do_fecho.estado == "silencio":
            _registar_pendencia(
                arranque,
                Pendencia(
                    instrumento=instrumento,
                    symbol_id=symbol_id,
                    marca=None,
                    position_id=(
                        ordem_de_fecho.get("positionId")
                        if isinstance(ordem_de_fecho.get("positionId"), int)
                        else None
                    ),
                    referencia_do_cliente=None,
                    resolucao={},
                    alavancagem=None,
                    correlacao=correlacao,
                    instante_ms=_agora_ms(),
                    verbo=VERBO_DE_FECHO,
                ),
                diag_local,
            )
        carga_base = perna_do_fecho.carga
        if carga_base is None:
            # A perna do fecho nao deu carga publicavel (o contrato recusou-a): diz-se o que se sabe, sem
            # inventar linha nenhuma. O desfecho honesto e' `desconhecido` com a resolucao que existe (a da
            # abertura, a unica composta antes de enviar) — a mesma regra da perna em SILENCIO.
            try:
                carga_base = De.desfecho_do_silencio(
                    _resolucao_do_silencio(resolucao_abertura, alavancagem), arranque.prazo_do_venue_ms
                )
            except ValueError as erro:
                diag_local.append({"etapa": "desfecho", "veredicto": "nao_publicado", "porque": str(erro)})
                return Atendimento(diag=diag_local)
        o_que_fica = {
            "descricao": (
                "a posicao VIVA (a que ja' existia) CONTINUA aberta: o fecho NAO passou, e a abertura NAO se "
                "enviou — abrir agora seria expor a mais"
            ),
            "positionId": posicao_a_reverter.get("posicao"),
            "lado": posicao_a_reverter.get("lado"),
            "volume_no_venue_em_centesimos": posicao_a_reverter.get("volume"),
        }
        carga = _com_virada(
            carga_base,
            registo_do_fecho,
            {
                "perna": "2_de_2",
                "acao": "nao_enviada",
                "porque": "o fecho nao passou: abertura NAO se envia (seria expor duas vezes a mesma intencao)",
            },
            o_que_fica,
        )
        linha = linha_do_contrato("desfecho", correlacao, carga)
        return Atendimento(linhas=[] if linha is None else [linha], diag=diag_local)

    # ============================== PERNA 2: ABRIR O LADO DECLARADO ==============================
    perna_da_abertura = _mandar_e_seguir(
        arranque, VERBO_DE_ABERTURA, accao_abertura, resolucao_abertura, alavancagem, conta, diag_local,
        pendencia_da_abertura, tick,
    )
    if perna_da_abertura.estado == "recusa_de_transporte":
        carga_base = {
            "classificacao": "recusado",
            "motivo": perna_da_abertura.motivo,
            "resposta_do_venue": {
                "nota": "a abertura nao chegou ao fio (o fecho JA' passou)",
                "porque": perna_da_abertura.porque,
            },
        }
    elif perna_da_abertura.carga is not None:
        carga_base = perna_da_abertura.carga
    else:
        diag_local.append(
            {
                "etapa": "desfecho",
                "veredicto": "nao_publicado",
                "porque": "a perna de abertura nao deu desfecho publicavel: nao se inventa linha para o que o contrato recusa",
            }
        )
        return Atendimento(diag=diag_local)
    diag_local.append(
        {
            "etapa": "virada",
            "perna": "2_de_2_abrir_o_lado_novo",
            "instrumento": instrumento,
            "classificacao": carga_base.get("classificacao"),
            "porque": (
                "1.10.0(c): a 2.a perna — ABRIR o lado declarado. O desfecho descreve a posicao que FICA, com os "
                "numeros do VENUE (FR-064): e' ela que a mesa passa a gerir"
            ),
        }
    )
    carga = _com_virada(
        carga_base,
        registo_do_fecho,
        {
            "perna": "2_de_2",
            "acao": "abrir_o_lado_declarado",
            "classificacao": carga_base.get("classificacao"),
            "porque": "o fecho passou; a abertura e' a segunda perna, na MESMA passagem",
        },
        _o_que_fica_da_virada(boleta, perna_da_abertura, carga_base),
    )
    linha = linha_do_contrato("desfecho", correlacao, carga)
    return Atendimento(linhas=[] if linha is None else [linha], diag=diag_local)


def _precisa_seguir_o_preenchimento(evento: dict[str, Any], numeros: dict[str, str]) -> bool:
    """D6: o evento diz que a ordem EXISTE (`aceite`/`parcial`) mas nao traz os numeros do preenchimento?

    E' o `ORDER_ACCEPTED` deste venue: a ordem fica em repouso, sem `executedVolume`/`executionPrice`. So' nesse
    caso se segue o evento seguinte; uma recusa, um `desconhecido` ou um evento JA' com os numeros NAO se seguem
    (ha' desfecho a publicar — ou nao ha' ordem nenhuma).
    """
    if "quantidade" in numeros:
        return False
    try:
        veredicto = De.classificar_ordem(evento)
    except De.AcontecimentoDeConta:
        return False
    return veredicto.classificacao in ("aceite", "parcial")


def _marca_e_ordem_do_evento(evento: dict[str, Any]) -> tuple[str | None, int | None]:
    """A MARCA do cliente e o ID da ORDEM que o evento traz — as DUAS chaves para seguir o preenchimento (D6)."""
    ordem = evento.get("order")
    if not isinstance(ordem, dict):
        return None, None
    marca = ordem.get("clientOrderId")
    marca = marca if isinstance(marca, str) and marca != "" else None
    return marca, _inteiro(ordem.get("orderId"))


def _seguir_o_preenchimento(arranque: Arranque, evento_aceite: dict[str, Any], prazo_s: float) -> Tr.Resultado:
    """Pede ao TRANSPORTE o EVENTO do VENUE que traz os numeros do preenchimento DESTA ordem (D6).

    Nao se inventa numero nenhum: quem fala com o venue e' o transporte, e a resposta DELE e' que decide. Uma
    ponta que nao declare o metodo recusa por NOME (`capacidade_nao_declarada`) — e quem chama cai no silencio.
    """
    transporte = arranque.transporte
    if transporte is None:
        return Tr.Resultado(
            ok=False, motivo="capacidade_nao_declarada", porque="nao ha transporte aberto para seguir o preenchimento"
        )
    metodo = getattr(transporte, "esperar_o_preenchimento", None)
    if not callable(metodo):
        return Tr.Resultado(
            ok=False,
            motivo="capacidade_nao_declarada",
            porque=(
                "o transporte desta ponta nao sabe seguir o preenchimento por evento (D6): sem o numero do "
                "VENUE nao se completa a resolucao, e um numero inventado seria uma conta NOSSA"
            ),
        )
    marca, ordem_id = _marca_e_ordem_do_evento(evento_aceite)
    resultado = metodo(marca, ordem_id, prazo_s)
    if isinstance(resultado, Tr.Resultado):
        return resultado
    return Tr.Resultado(
        ok=False,
        motivo="formato_invalido",
        porque="o metodo de seguir o preenchimento respondeu numa forma que esta costura nao le' (nao e' um `Resultado`)",
    )


def _registar_pendencia(arranque: Arranque, pendencia: Pendencia | None, diag_local: list[dict[str, Any]]) -> None:
    """Marca o instrumento como PENDENTE — a memoria guarda QUE ha' algo por reconciliar, nunca a verdade."""
    if pendencia is None:
        return
    arranque.pendentes[pendencia.instrumento] = pendencia
    diag_local.append(
        {
            "etapa": "fr_068_instrumento_pendente",
            "instrumento": pendencia.instrumento,
            "marca": pendencia.marca,
            "verbo": pendencia.verbo,
            "porque": (
                "a ordem ficou `desconhecida` (silencio): o instrumento passa a PENDENTE — nao entra ordem NOVA "
                "nele (FR-068) e so' a reconciliacao por LEITURA o tira dai (FR-069). A memoria guarda so' QUE "
                "ha' algo por reconciliar; a verdade (existe ou nao) so' o venue a da'."
            ),
        }
    )


def _nome_do_estado(valor: Any) -> Any:
    """O nome de um campo-ENUM (a biblioteca da' `OrderStatus.FILLED`; o contrato escreve `FILLED`)."""
    nome = getattr(valor, "name", None)
    return nome if isinstance(nome, str) else valor


def _ordem_pela_marca(ordens: list[Any], marca: Any) -> dict[str, Any] | None:
    """A ordem do registo cuja MARCA de cliente e' a NOSSA — a ligacao da referencia a' ordem (D-009/FR-069)."""
    if not isinstance(marca, str) or marca == "":
        return None
    for ordem in ordens:
        if isinstance(ordem, dict) and ordem.get("marca_do_cliente") == marca:
            return ordem
    return None


def _posicao_por_id(posicoes: list[Any], position_id: Any) -> dict[str, Any] | None:
    """A posicao viva com o `positionId` que a pendencia guardou, quando ela o conhece."""
    if isinstance(position_id, bool) or not isinstance(position_id, int):
        return None
    for posicao in posicoes:
        if isinstance(posicao, dict) and posicao.get("posicao") == position_id:
            return posicao
    return None


def _reconciliar_antes_de_enviar(
    arranque: Arranque,
    correlacao: str,
    marca: Any,
    resolucao: dict[str, str],
    alavancagem: Decimal | None,
    pendencia: Pendencia,
    diag_local: list[dict[str, Any]],
) -> Atendimento | None:
    """FR-061/D-009 — RECONCILIAR ANTES DE ENVIAR: le'-se o REGISTO de ordens do venue e procura-se a NOSSA marca.

    `None` quando NAO ha' nada a opor (a ordem nova segue). Caso contrario, o `Atendimento` que a trava:
      * a MARCA JA' produziu ordem -> `recusado` / `referencia_ja_enviada_ao_venue`, com a ordem que EXISTE
        inteira em `resposta_do_venue` (nao se manda segunda — FR-061/RN-C4);
      * a LEITURA nao se fez -> NAO se envia (sem saber se a marca ja' esta' la', mandar e' uma aposta) e a
        resposta e' `desconhecido`, com a pendencia registada para ser reconciliada depois.

    E' a guarda que SOBREVIVE ao processo morrer: a memoria do processo perde-se, a leitura vai ao venue. Logo
    depois de um arranque, reenviar a MESMA referencia nao cria segunda ordem — a leitura encontra a marca.
    """
    ficha = arranque.ficha
    if ficha is None:
        return None
    registo = arranque.transporte.ordens_do_registo(ficha.ctid_trader_account_id) if arranque.transporte else None
    if registo is None or not registo.ok or not isinstance(registo.valor, list):
        motivo = None if registo is None else registo.motivo
        porque = "nao ha transporte para ler o registo de ordens" if registo is None else registo.porque
        diag_local.append(
            {
                "etapa": "reconciliacao_antes_de_enviar",
                "veredicto": "leitura_falhada",
                "motivo": motivo,
                "porque": f"a leitura do registo de ordens falhou ({motivo}): NAO se envia — sem saber se a marca ja' esta' no venue, mandar e' uma aposta (D-009)",
            }
        )
        _registar_pendencia(arranque, pendencia, diag_local)
        try:
            silencio = De.desfecho_do_silencio(_resolucao_do_silencio(resolucao, alavancagem), arranque.prazo_do_venue_ms)
        except ValueError as erro:
            diag_local.append({"etapa": "desfecho", "veredicto": "nao_publicado", "porque": str(erro)})
            return Atendimento(diag=diag_local)
        linha = linha_do_contrato("desfecho", correlacao, silencio)
        return Atendimento(linhas=[] if linha is None else [linha], diag=diag_local)

    existente = _ordem_pela_marca(registo.valor, marca)
    if existente is None:
        diag_local.append(
            {
                "etapa": "reconciliacao_antes_de_enviar",
                "veredicto": "marca_ausente_do_registo",
                "marca": marca,
                "porque": "a marca NAO esta' no registo de ordens do venue: esta referencia ainda nao produziu ordem — a ordem nova segue",
            }
        )
        return None

    # A MARCA JA' PRODUZIU ORDEM. Nao se manda segunda (FR-061): devolve-se a ordem que EXISTE, inteira.
    diag_local.append(
        {
            "etapa": "reconciliacao_antes_de_enviar",
            "veredicto": "marca_ja_no_registo",
            "marca": marca,
            "ordem_existente": existente.get("ordem"),
            "porque": "a marca ja' produziu ordem neste venue: NAO se manda segunda — devolve-se a que existe (FR-061/RN-C4)",
        }
    )
    # A DUVIDA RESOLVE-SE: se havia uma pendencia neste instrumento, a leitura provou que a marca esta' la'.
    arranque.pendentes.pop(pendencia.instrumento, None)
    carga = {
        "classificacao": "recusado",
        "motivo": "referencia_ja_enviada_ao_venue",
        "resposta_do_venue": {
            "fonte": "reconciliacao_antes_de_enviar",
            "nota": "nenhuma ordem nova foi enviada; a ordem desta referencia ja' existe no registo do venue",
            "marca": marca,
            "order": existente,
        },
    }
    linha = linha_do_contrato("desfecho", correlacao, carga)
    return Atendimento(linhas=[] if linha is None else [linha], diag=diag_local)


def _classificacao_da_ordem_lida(ordem: dict[str, Any]) -> tuple[str, str | None, str]:
    """A classificacao VERDADEIRA da ordem que a LEITURA encontrou — pelo estado que o próprio venue publicou."""
    estado = _nome_do_estado(ordem.get("estado"))
    if estado in ("REJECTED", "CANCELLED", "EXPIRED"):
        return (
            "recusado",
            "desfecho_nao_reconhecido",
            f"a ordem esta' no registo do venue com estado {estado!r}: a ordem nao se fez, e a palavra e' do venue",
        )
    executado = _inteiro(ordem.get("volume_executado"))
    volume = _inteiro(ordem.get("volume"))
    if executado is not None and volume is not None and 0 < executado < volume:
        return (
            "parcial",
            None,
            f"a ordem esta' no registo do venue e so' {executado} de {volume} foram preenchidos: e' PARCIAL, e sabe-se qual",
        )
    return "aceite", None, "a ordem existe no registo do venue: a verdade e' que ela se fez"


def reconciliar(arranque: Arranque, instrumento: str) -> Atendimento:
    """FR-069 — a UNICA saida de `desconhecida`: RELE' O VENUE (posicoes + registo de ordens) e procura a NOSSA
    ordem pela marca / `positionId`.

    Achada, publica o desfecho VERDADEIRO (uma das quatro classificacoes do conjunto fechado) e tira o
    instrumento de pendente. Leitura FALHADA **nao produz desfecho nenhum** — a ordem continua `desconhecida`
    e o instrumento continua pendente: nao se inventa um desfecho a partir de uma leitura que falhou (US5,
    cenario 4). Sem pendencia nao ha' nada a reconciliar (uma reconciliacao do que nao estava em duvida nao
    muda nada — `reconciliacao_sem_marca` da mesa).

    A VERDADE NUNCA VEM DA MEMORIA: a memoria guarda so' QUE ha' algo por reconciliar, e por onde o procurar.
    """
    pendencia = arranque.pendentes.get(instrumento)
    if pendencia is None:
        return Atendimento(
            diag=[
                {
                    "etapa": "reconciliacao",
                    "instrumento": instrumento,
                    "veredicto": "sem_pendencia",
                    "motivo_da_mesa": "reconciliacao_sem_marca",
                    "porque": "nao havia pendencia neste instrumento: uma reconciliacao do que nao estava em duvida nao muda nada",
                }
            ]
        )
    transporte = arranque.transporte
    ficha = arranque.ficha
    if transporte is None or ficha is None:
        return Atendimento(
            diag=[
                {
                    "etapa": "reconciliacao",
                    "instrumento": instrumento,
                    "veredicto": "indecidivel",
                    "motivo_da_mesa": "reconciliacao_indecidivel",
                    "porque": "nao ha transporte aberto: sem ler o venue nao ha' verdade a publicar — a pendencia fica",
                }
            ]
        )
    account_id = ficha.ctid_trader_account_id
    posicoes = transporte.posicoes(account_id)
    registo = transporte.ordens_do_registo(account_id)

    falhas: list[str] = []
    if not posicoes.ok:
        falhas.append(f"posicoes: {posicoes.motivo} ({posicoes.porque})")
    elif not isinstance(posicoes.valor, list):
        falhas.append("posicoes: a leitura nao veio em lista")
    if not registo.ok:
        falhas.append(f"registo de ordens: {registo.motivo} ({registo.porque})")
    elif not isinstance(registo.valor, list):
        falhas.append("registo de ordens: a leitura nao veio em lista")

    if falhas:
        # LEITURA FALHADA NAO PRODUZ DESFECHO (FR-069): nenhuma linha de desfecho sai; a pendencia FICA.
        return Atendimento(
            diag=[
                {
                    "etapa": "reconciliacao",
                    "instrumento": instrumento,
                    "veredicto": "indecidivel",
                    "motivo_da_mesa": "reconciliacao_indecidivel",
                    "falhas": falhas,
                    "porque": (
                        "a leitura falhou: NENHUM desfecho e' inventado — a ordem CONTINUA `desconhecida` e o "
                        "instrumento CONTINUA pendente (FR-069, US5 cenario 4)"
                    ),
                }
            ]
        )

    ordem = _ordem_pela_marca(registo.valor, pendencia.marca)
    posicao = _posicao_por_id(posicoes.valor, pendencia.position_id)

    if ordem is None and posicao is None:
        # LEITURA COMPLETA E NADA ENCONTRADO: e' a AUSENCIA dos negocios que decide — a ordem nao chegou a
        # existir (US5 cenario 3: «ou da ausencia deles»). O desfecho verdadeiro e' `recusado`, e o motivo do
        # conjunto fechado e' o do prazo: o venue nao respondeu dentro do prazo, e a leitura prova que a ordem
        # nao ficou la'. A pendencia SAI (a duvida foi decidida por leitura).
        classificacao, motivo = "recusado", MOTIVO_DA_ORDEM_NOVA_COM_PENDENTE
        porque = (
            "a leitura foi completa e NAO encontrou a nossa ordem (nem no registo, nem nas posicoes): a ordem "
            "nao chegou a existir — o venue nao respondeu dentro do prazo, e a leitura prova-o"
        )
        resposta = {
            "fonte": "reconciliacao_por_leitura",
            "veredicto": "inexistente",
            "marca": pendencia.marca,
            "porque": porque,
        }
    elif ordem is not None:
        classificacao, motivo, porque = _classificacao_da_ordem_lida(ordem)
        resposta = {
            "fonte": "reconciliacao_por_leitura",
            "veredicto": "preenchida",
            "marca": pendencia.marca,
            "order": ordem,
            **({"position": posicao} if posicao is not None else {}),
            "porque": porque,
        }
    else:
        classificacao, motivo = "aceite", None
        porque = "a leitura encontrou a POSICAO viva da pendencia: a ordem existe na corretora"
        resposta = {
            "fonte": "reconciliacao_por_leitura",
            "veredicto": "preenchida",
            "marca": pendencia.marca,
            "position": posicao,
            "porque": porque,
        }

    carga: dict[str, Any] = {"classificacao": classificacao, "resposta_do_venue": resposta}
    if classificacao == "recusado":
        carga["motivo"] = motivo
    else:
        # A resolucao de antes do envio acompanha o desfecho verdadeiro (existiu uma — foi escrita antes de
        # enviar). O VENUE nao publica preco de liquidacao; o que ele deu vai em `resposta_do_venue`.
        carga["resolucao"] = pendencia.resolucao

    linha = linha_do_contrato("desfecho", pendencia.correlacao, carga)
    if linha is None:
        return Atendimento(
            diag=[
                {
                    "etapa": "reconciliacao",
                    "instrumento": instrumento,
                    "veredicto": "nao_publicado",
                    "classificacao": classificacao,
                    "porque": "o desfecho verdadeiro nao passou o contrato: nao se publica um desfecho recusado — a pendencia FICA",
                }
            ]
        )
    arranque.pendentes.pop(instrumento, None)
    return Atendimento(
        linhas=[linha],
        diag=[
            {
                "etapa": "reconciliacao",
                "instrumento": instrumento,
                "veredicto": "decidida",
                "motivo_da_mesa": "reconciliacao_decidiu_preenchida" if classificacao != "recusado" else "reconciliacao_decidiu_inexistente",
                "classificacao": classificacao,
                "porque": f"{porque} — o instrumento SAI de pendente (FR-069)",
            }
        ],
    )


def _expoente_do_dinheiro(conta: dict[str, Any]) -> int | None:
    """O `moneyDigits` da conta, quando ela o traz (o modelo da biblioteca nao o traz — achado medido)."""
    valor = _inteiro(conta.get("expoente_dos_valores"))
    if valor is None or valor < 0:
        return None
    return valor


def _resolucao_completa(
    antes: dict[str, str],
    numeros_do_venue: dict[str, str],
    alavancagem: Decimal | None,
    tick: str | None = None,
) -> dict[str, str]:
    """A resolucao do desfecho: a de antes do envio, completada com os numeros que o VENUE deu (RN-C10).

    O que o venue nao deu fica AUSENTE — e' o estado honesto (o venue nao publica o preco de liquidacao), e o
    contrato recusa a resolucao com `campo_obrigatorio_ausente` em vez de aceitar um zero inventado.

    A EXCEPCAO e' o `preco_de_liquidacao` do FECHO (medido a 05/10/2026): o fecho NAO tem resolucao pre-envio
    (`resolucao={}`), logo `antes` nao o traz; e sem esse campo a resolucao do fecho saia com 4 dos 5 campos e o
    contrato RECUSAVA o desfecho (a prova 10 da bateria ao vivo ficava bloqueada). Projecta-se pela MESMA regra
    [C] que a resolucao pre-envio ja' usa (`preco x (A-1) / A` ao tick), a partir do PRECO DE EXECUCAO do VENUE
    (`numeros_do_venue["preco"]`) e do `tick` do simbolo — nenhum numero e' inventado: quando o venue nao deu o
    preco, ou quando nao ha' `tick`, o campo fica AUSENTE e o contrato recusa, como antes.
    """
    if not numeros_do_venue:
        return antes
    completada = Or.montar_resolucao(
        quantidade=None,
        preco=None,
        alavancagem=alavancagem,
        numeros_do_venue=numeros_do_venue,
    )
    for chave, valor in antes.items():
        if chave not in completada:
            completada[chave] = valor
    if "preco_de_liquidacao" not in completada:
        preco_do_venue = numeros_do_venue.get("preco")
        if isinstance(preco_do_venue, str) and alavancagem is not None and tick is not None:
            projectado = Or.preco_de_liquidacao_projectado(
                preco_do_venue, _texto_de_decimal(alavancagem), tick
            )
            if projectado is not None:
                completada["preco_de_liquidacao"] = projectado
    # O VENUE NAO PUBLICA A ALAVANCAGEM NO EVENTO (D6, medido ao vivo a 05/10/2026): o `position` do evento
    # empurrado traz `usedMargin` mas NAO `marginRate`, e o do FECHO nao traz nem um nem outro. Sem este passo o
    # desfecho saia com 4 dos 5 campos e o contrato RECUSAVA-o (a prova 8/10 ficava sem linha). Completa-se pela
    # DECLARACAO — a MESMA regra [C] do silencio (`_completar_pela_declaracao`) —, e o numero do VENUE, onde ele
    # o deu, ja' esta' em `completada` e nao se toca.
    return _completar_pela_declaracao(completada, alavancagem)


# -----------------------------------------------------------------------------------------------------------
# A LEITURA DO MERCADO, no relogio declarado. Aqui — e so' aqui — se compoe a mensagem `mercado`.
# -----------------------------------------------------------------------------------------------------------


def publicar_mercado(arranque: Arranque, instrumento: str) -> list[dict[str, Any]]:
    """Le' o mercado de UM instrumento e publica a linha `mercado` que o contrato aceitar.

    DUAS REGUAS, UMA SO' LINHA (US1 / data-model §6 / RN-CT29). Quando ha' RETRATO do venue — os eventos de
    spot/profundidade que a subscricao guarda — publica-se a COTACAO: `bid`/`ask` (um lado pode faltar, e falta
    pela AUSENCIA da chave, nunca por um zero) e o `livro` por deltas, com o INSTANTE DO VENUE do spot. Quando
    NAO ha' retrato nenhum, a regua DECLARADA e' a ULTIMA VELA FECHADA e o `ultimo` publicado e' o fecho dela,
    tambem com o instante do VENUE.

    A LINHA DIZ QUAL DAS DUAS FOI pelo que traz: com o retrato saem `bid`/`ask`; com a vela sai `ultimo`. O
    `mercado` do contrato NAO tem campo para a regua, e NAO se emenda (SC-015): a declaracao vive no DIAGNOSTICO
    (`regua`), e a presenca/ausencia das chaves e' o que a propria linha do contrato diz.
    """
    ficha = arranque.ficha
    transporte = arranque.transporte
    if ficha is None or transporte is None:
        return []
    account_id = ficha.ctid_trader_account_id
    symbol_id = _universo_do_instrumento(transporte, account_id, instrumento)
    if isinstance(symbol_id, Le.Recusa):
        return [{"etapa": "leitura_de_mercado", "instrumento": instrumento, "veredicto": "recusado", "motivo": symbol_id.motivo, "porque": symbol_id.porque}]
    retrato = transporte.retrato_do_mercado(symbol_id) if hasattr(transporte, "retrato_do_mercado") else None
    if retrato is not None and retrato.get("tempo_do_venue_ms") is not None:
        # O RETRATO DO VENUE: a cotacao substitui a vela. O lado que nao veio fica AUSENTE (a chave nao entra).
        entrada = Le.EntradaMercado(
            tempo_do_venue_ms=retrato["tempo_do_venue_ms"],
            bid=retrato["bid"],
            ask=retrato["ask"],
            livro=retrato["livro"],
        )
        regua = "retrato do venue (spots)"
    else:
        # A REGUA DECLARADA: a ultima vela fechada, com o instante do VENUE dela. O livro do venue, se ja' chegou,
        # publica-se tambem (e' dado do venue) — mas o preco de referencia continua a ser o fecho da vela, e dito.
        vela = _ultima_vela(transporte, account_id, symbol_id, instrumento)
        if isinstance(vela, Le.Recusa):
            return [{"etapa": "leitura_de_mercado", "instrumento": instrumento, "veredicto": "recusado", "motivo": vela.motivo, "porque": vela.porque}]
        fecho, instante = vela
        ultimo = Or.preco_relativo(fecho, "fecho da vela")
        if isinstance(ultimo, Or.Recusa):
            return [{"etapa": "leitura_de_mercado", "instrumento": instrumento, "veredicto": "recusado", "motivo": ultimo.motivo, "porque": ultimo.porque}]
        entrada = Le.EntradaMercado(
            tempo_do_venue_ms=instante,
            ultimo=ultimo,
            livro=(retrato["livro"] if retrato is not None else None),
        )
        regua = "ultima vela fechada"
    lida = Le.ler_mercado(
        transporte,
        account_id,
        instrumento=instrumento,
        symbol_id=symbol_id,
        agora_ms=_agora_ms(),
        entrada=entrada,
    )
    if isinstance(lida, Le.Recusa):
        return [{"etapa": "leitura_de_mercado", "instrumento": instrumento, "veredicto": "recusado", "motivo": lida.motivo, "porque": lida.porque}]
    linha = linha_do_contrato("mercado", f"mercado/{instrumento}", lida)
    if linha is None:
        return [{"etapa": "leitura_de_mercado", "instrumento": instrumento, "veredicto": "nao_publicada", "porque": "a leitura nao passou o contrato"}]
    escrever_na_costura(linha)
    return [
        {
            "etapa": "leitura_de_mercado",
            "instrumento": instrumento,
            "veredicto": "publicada",
            "regua": regua,
            "cotacao": bool(retrato is not None and retrato.get("tempo_do_venue_ms") is not None),
        }
    ]


def _ultima_vela(
    transporte: Tr.Transporte, account_id: int, symbol_id: int, instrumento: str
) -> tuple[Decimal, int] | Le.Recusa:
    """O fecho e o instante do VENUE da ultima vela fechada (a regua declarada da leitura)."""
    fim = datetime.now(timezone.utc)
    inicio = fim - timedelta(hours=VELAS_PARA_O_PRECO_HORAS)
    velas = transporte.velas(account_id, symbol_id, PERIODO_DA_VELA_DE_REFERENCIA, inicio, fim)
    if not velas.ok:
        return Le.recusa(str(velas.motivo), velas.porque)
    if not isinstance(velas.valor, list) or not velas.valor:
        return Le.recusa("campo_obrigatorio_ausente", f"o venue nao devolveu nenhuma vela de {instrumento}")
    ultima = velas.valor[-1]
    if not isinstance(ultima, dict):
        return Le.recusa("formato_invalido", "a ultima vela do venue nao veio com forma de objecto")
    fecho = ultima.get("fecho")
    instante = _instante_em_ms(ultima.get("instante_ms"))
    if isinstance(fecho, bool) or not isinstance(fecho, (Decimal, int, float)):
        return Le.recusa("formato_invalido", f"a ultima vela de {instrumento} veio sem fecho legivel")
    if instante is None:
        return Le.recusa(
            "tempo_do_venue_nao_lido",
            (
                f"a ultima vela de {instrumento} nao trouxe o instante do venue utilizavel: a idade do dado "
                "mede-se contra o relogio DELE, e com o nosso seria outra grandeza"
            ),
        )
    return Decimal(str(fecho)) if not isinstance(fecho, Decimal) else fecho, instante


def _instante_em_ms(valor: Any) -> int | None:
    """O instante do venue em milissegundos, quando ele vem utilizavel (`datetime` ou inteiro)."""
    if isinstance(valor, datetime):
        return int(valor.timestamp() * 1000)
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    return None


def _agora_ms() -> int:
    """O NOSSO relogio. So' serve para medir a idade do dado — nunca para carimbar o dado (RN-D2)."""
    return int(time.time() * 1000)


def armar_leitura(arranque: Arranque, intervalo_ms: int) -> None:
    """Arma o relogio da leitura: a cada intervalo, um `mercado` por instrumento do mandato (RN-V10 — a lista
    de instrumentos e' a da FICHA, que e' o mandato deste processo, e e' relida em cada volta)."""
    ficha = arranque.ficha
    if ficha is None:
        return

    def volta() -> None:
        for instrumento in list(ficha.instrumentos):
            try:
                for linha in publicar_mercado(arranque, instrumento):
                    diag(**linha)
            except Exception as erro:  # um rebenta' da leitura nao pode matar o relogio
                diag(etapa="leitura_de_mercado", instrumento=instrumento, veredicto="rebentou", porque=str(erro))

    parado = threading.Event()
    while not parado.wait(intervalo_ms / 1000.0):
        volta()


def _armar_leitura(arranque: Arranque, intervalo_ms: int) -> threading.Thread:
    fio = threading.Thread(target=armar_leitura, args=(arranque, intervalo_ms), name="ctrader-leitura", daemon=True)
    fio.start()
    return fio


def _assinar_o_mercado(arranque: Arranque) -> None:
    """Liga a LEITURA VIVA da ponta: subscreve os spots (e o livro) dos instrumentos do mandato.

    O `symbol_id` resolve-se pelo NOME (RN-CT23), pelo MESMO caminho da leitura. Se um instrumento nao resolver,
    ou o registo/a subscricao falhar, DI'-SE POR NOME no diagnostico: a leitura fica sem retrato e recai na regua
    DECLARADA (a ultima vela fechada), em vez de inventar uma cotacao. Nunca ha' silencio.
    """
    ficha = arranque.ficha
    transporte = arranque.transporte
    if ficha is None or transporte is None:
        return
    account_id = ficha.ctid_trader_account_id
    universo = transporte.simbolos(account_id)
    if not universo.ok or not isinstance(universo.valor, list):
        diag(
            etapa="subscricao_de_mercado",
            veredicto="recusada",
            motivo=str(universo.motivo),
            porque="o universo do venue nao se leu: a leitura cai na regua declarada (a ultima vela fechada)",
        )
        return
    resolvidos = So.resolver_instrumentos(list(ficha.instrumentos), universo.valor)
    if isinstance(resolvidos, So.Recusa):
        diag(etapa="subscricao_de_mercado", veredicto="recusada", motivo=resolvidos.motivo, porque=resolvidos.porque)
        return
    ids = list(resolvidos.values())
    resultado = transporte.seguir_o_mercado(account_id, ids)
    if not resultado.ok:
        diag(etapa="subscricao_de_mercado", veredicto="recusada", motivo=resultado.motivo, porque=resultado.porque)
        return
    diag(etapa="subscricao_de_mercado", veredicto="ligada", instrumentos=list(ficha.instrumentos), simbolos=ids)


# -----------------------------------------------------------------------------------------------------------
# O SERVICO e o ENCERRAMENTO.
# -----------------------------------------------------------------------------------------------------------


def servir(arranque: Arranque, entrada: Iterable[str] | None = None) -> int:
    """Atende o `stdin` ate' ao fim do cano — ou ate' um pedido de paragem pelo protocolo.

    Cada linha e' uma mensagem; cada resposta, uma linha. O `entrada` existe para a prova: um duplo que entrega
    as linhas em memoria corre o MESMO ciclo, sem `stdin`.
    """
    if entrada is None:
        entrada = sys.stdin
    atendidas = 0
    for bruta in entrada:
        linha = bruta.rstrip("\n")
        if linha.strip() == "":
            continue
        atendidas += 1
        try:
            atendimento = atender(linha, arranque)
        except RuntimeError as erro:
            diag(etapa="mensagem", veredicto="nao_atendida", porque=str(erro))
            continue
        for campo in atendimento.diag:
            diag(**campo)
        for resposta in atendimento.linhas:
            escrever_na_costura(resposta)
        if not atendimento.linhas:
            diag(
                etapa="costura",
                veredicto="sem_resposta",
                nota="nenhuma linha saiu: o outro lado fica em ESPERA, nunca em sucesso",
            )
        if atendimento.encerrar:
            diag(etapa="paragem", veredicto="encerra", atendidas=atendidas)
            break
    diag(etapa="fim", atendidas=atendidas, nota="o cano fechou: nenhuma operacao fica nas maos deste processo")
    return 0


def encerrar(arranque: Arranque) -> None:
    """O ENCERRAMENTO: o `ao_desligar` da ficha decide o que fica, e o fio fecha-se sempre.

    Os valores sao dois, e um valor que nao se entende nao se adivinha (o que esta' em jogo e' uma posicao
    viva). Sem declaracao, o processo NAO decide pelo dono: nao ha' aqui um `fechar` por omissao — quem governa
    a retirada de um par e' a OPERACAO (a ficha do setup), nunca a costura do conector.
    """
    diag(etapa="encerramento", veredicto="a_comecar", porque="o processo vai desligar-se")
    instrucao = _instrucao_de_encerramento(arranque.ficha)
    if instrucao == "manter":
        diag(
            etapa="ao_desligar",
            instrucao="manter",
            porque="a ficha manda MANTER: as posicoes ficam vivas e o processo nao lhes toca — fica dito",
        )
    elif instrucao == "fechar":
        diag(etapa="ao_desligar", instrucao="fechar", porque="a ficha manda FECHAR: as posicoes vivas sao fechadas POR POSICAO antes de o fio se fechar (fechar nao abre — RN-CT34)")
        for instrumento in arranque.ficha.instrumentos:
            for campo in _fechar_no_encerramento(arranque, instrumento):
                diag(**campo)
    else:
        diag(
            etapa="ao_desligar",
            instrucao="nao_declarada",
            porque=(
                "a ficha do conector nao declara `ao_desligar` (e o leitor da ficha ainda nao le' o campo): o "
                "conector NAO decide pelo dono — posicao nenhuma e' tocada"
            ),
        )
    if arranque.transporte is not None:
        arranque.transporte.fechar()
        diag(etapa="transporte", veredicto="fechado", porque="o fio e a sessao foram fechados")


def _instrucao_de_encerramento(ficha: Fi.Ficha | None) -> str | None:
    """O `ao_desligar` da ficha, quando ela o declara; `None` quando nao ha' o que cumprir."""
    if ficha is None:
        return None
    declarado = getattr(ficha, "ao_desligar", None)
    if declarado is None:
        return None
    if declarado in INSTRUCOES_DE_ENCERRAMENTO:
        return declarado
    diag(
        etapa="ao_desligar",
        veredicto="valor_fora_do_conjunto",
        valor=declarado,
        porque=(
            f"a ficha declara `ao_desligar` = {declarado!r}, que nao esta' no conjunto "
            f"{INSTRUCOES_DE_ENCERRAMENTO}: nao se adivinha, e posicao nenhuma e' tocada"
        ),
    )
    return None


def _fechar_no_encerramento(arranque: Arranque, instrumento: str) -> list[dict[str, Any]]:
    """Fecha, POR POSICAO, o que estiver vivo no instrumento — e so' quando a ficha o manda."""
    transporte = arranque.transporte
    ficha = arranque.ficha
    if transporte is None or ficha is None:
        return []
    account_id = ficha.ctid_trader_account_id
    symbol_id = _universo_do_instrumento(transporte, account_id, instrumento)
    if isinstance(symbol_id, Le.Recusa):
        return [{"etapa": "ao_desligar", "instrumento": instrumento, "veredicto": "sem_leitura", "motivo": symbol_id.motivo}]
    posicoes = transporte.posicoes(account_id)
    if not posicoes.ok or not isinstance(posicoes.valor, list):
        return [{"etapa": "ao_desligar", "instrumento": instrumento, "veredicto": "sem_leitura", "porque": posicoes.porque}]
    decisao = Fe.decidir_fecho(
        {
            "conta": ficha.conta,
            "instrumento": instrumento,
            "symbol_id": symbol_id,
            "posicoes": posicoes.valor,
            "marca_do_cliente": None,
        }
    )
    if decisao.acao != Fe.ACAO_FECHAR:
        return [{"etapa": "ao_desligar", "instrumento": instrumento, "veredicto": decisao.acao, "motivo": decisao.motivo, "porque": decisao.porque}]
    ordem = decisao.ordem
    if ordem is None:
        return [{"etapa": "ao_desligar", "instrumento": instrumento, "veredicto": "sem_ordem", "porque": decisao.porque}]
    enviado = _com_prazo(
        lambda: _enviar(transporte, VERBO_DE_FECHO, account_id, ordem),
        arranque.prazo_do_venue_ms / 1000.0,
    )
    if enviado is None:
        return [{"etapa": "ao_desligar", "instrumento": instrumento, "veredicto": "sem_resposta_no_prazo", "porque": "o fecho do encerramento nao teve resposta dentro do prazo declarado"}]
    if not enviado.ok:
        return [{"etapa": "ao_desligar", "instrumento": instrumento, "veredicto": "nao_enviado", "motivo": enviado.motivo, "porque": enviado.porque}]
    return [{"etapa": "ao_desligar", "instrumento": instrumento, "veredicto": "fecho_enviado", "por_positionId": ordem.get("positionId")}]


# -----------------------------------------------------------------------------------------------------------
# O ARRANQUE DO EXECUTAVEL.
# -----------------------------------------------------------------------------------------------------------


def _caminho_da_ficha(declarado: str) -> Path:
    caminho = Path(declarado.lstrip("@")).expanduser()
    if not caminho.is_absolute():
        caminho = RAIZ / caminho
    return caminho


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="O conector cTrader: fala o contrato neutro de um lado e o venue do outro.")
    ap.add_argument("--ficha", required=True, help="caminho da ficha do conector (aceita o prefixo `@` do operador)")
    # NOTA DATADA — 05/10/2026 (A-6): aqui vivia `--casos`, um flag que se DECLARAVA e NUNCA se lia (a costura
    # nao tem bancada de processo: nao existe `casos/processo.casos.json`, ao contrario do outro conector, que
    # tem 41 casos de envio). O operador (`vigia/operador.ts`) so' passa `--casos` ao conector do HYPERLIQUID;
    # ninguem o passa a este. Um flag que nao governa nada e' uma mentira pequena: SAIU. Quando a costura ganhar
    # bancada de processo, o flag volta COM um leitor — e nao antes.
    ap.add_argument("--ao-vivo", action="store_true", help="fala com o venue a serio")
    ap.add_argument("--sonda", action="store_true", help="so' sonda e publica o manifesto, sem servir")
    ap.add_argument(
        "--manifesto-em",
        dest="manifesto_em",
        default=None,
        help=(
            "grava a linha do manifesto num ficheiro (paridade com o conector 1); sem a opcao, o manifesto sai "
            "so' na costura (o `stdout`)"
        ),
    )
    ap.add_argument("--leitura-a-cada", type=int, default=None, help="intervalo das leituras de mercado (ms)")
    ap.add_argument("--prazo-do-venue-ms", type=int, default=None, help="prazo declarado para a resposta do venue")
    args = ap.parse_args(argv)

    arranque = arrancar(_caminho_da_ficha(str(args.ficha)))
    prazo = args.prazo_do_venue_ms
    arranque.prazo_do_venue_ms = PRAZO_DO_VENUE_POR_OMISSAO_MS if prazo is None else prazo

    for porta in arranque.portas:
        diag(
            etapa="porta",
            porta=porta.porta,
            veredicto=porta.veredicto,
            motivo=porta.motivo,
            porque=porta.porque,
        )

    if not arranque.ok:
        diag(
            etapa="arranque",
            veredicto="nao_sobe",
            porque="uma porta FALHOU: o processo nao serve, e nao escreve uma linha na costura",
            portas=len(arranque.portas),
        )
        return 2

    ficha = arranque.ficha
    if ficha is None:
        diag(etapa="arranque", veredicto="nao_sobe", porque="o arranque passou sem ficha: e' um defeito desta ponta")
        return 2

    # O `--manifesto-em` (paridade com o conector 1): quando declarado, a MESMA linha que sair na costura e'
    # gravada nesse ficheiro. O caminho resolve-se uma so' vez, aqui.
    caminho_do_manifesto: Path | None = None
    if args.manifesto_em is not None:
        caminho_do_manifesto = Path(args.manifesto_em).expanduser()

    if arranque.manifesto is not None:
        diag(
            etapa="manifesto_publicado",
            id=f"{ficha.conector}/manifesto",
            versao=arranque.manifesto["versao"],
            instrumentos=len(arranque.manifesto["instrumentos"]),
            tipos_de_ordem=arranque.manifesto["tipos_de_ordem"],
            so_fecha=arranque.so_fecha,
        )

    if args.sonda:
        if arranque.manifesto is None:
            diag(
                etapa="sonda",
                veredicto="sem_manifesto",
                porque="a porta `sonda_e_manifesto` nao correu: nao ha' manifesto a publicar, e nao se inventa um",
            )
            return 2
        if publicar_o_manifesto(arranque, ficha, caminho_do_manifesto) is None:
            diag(etapa="sonda", veredicto="nao_publicada", porque="o manifesto nao passou o contrato")
            return 2
        diag(etapa="sonda", veredicto="publicado", nota="modo de sonda: nenhuma boleta e' servida")
        return 0

    # ---- O MODO DE SERVICO: o manifesto publica-se NA COSTURA antes de servir (A-10, fechado a 05/10/2026) ----
    # O passo 1 do US1 exige-o: a mesa que ARRANCA o conector (sem `--sonda`) tem de ouvir o manifesto na costura.
    # Publica-se pelo MESMO caminho do `--sonda` — `publicar_o_manifesto` valida a linha contra o contrato ANTES de
    # a escrever. Se o contrato a RECUSAR, o arranque NAO serve: a mesa ficaria sem o manifesto, e um conector que
    # serve sem o manifesto publicado deixa a mesa a operar uma capacidade que nao leu.
    if arranque.manifesto is not None:
        if publicar_o_manifesto(arranque, ficha, caminho_do_manifesto) is None:
            diag(
                etapa="arranque",
                veredicto="nao_sobe",
                motivo="manifesto_nao_publicado",
                porque=(
                    "o manifesto foi construido mas o CONTRATO recusou-o: nao se serve um conector cujo manifesto "
                    "a mesa nao pode ler (o envelope do contrato nao o aceita)"
                ),
            )
            return 2
    else:
        # Sem manifesto nao ha' linha a publicar (a porta `sonda_e_manifesto` nao correu). O processo SERVE, mas o
        # que dele depende e' recusado por NOME no ciclo (`_atender_ordem`: `capacidade_nao_declarada`) — e' a regra
        # do `nao_corrida`: nunca servido por omissao, e dito.
        diag(
            etapa="manifesto_nao_publicado",
            veredicto="sem_manifesto",
            porque=(
                "a porta `sonda_e_manifesto` nao correu: nao ha' manifesto a publicar. O processo serve, mas as "
                "ordens sao recusadas por `capacidade_nao_declarada` — o que depende do manifesto nunca e' servido "
                "por omissao"
            ),
        )

    intervalo = args.leitura_a_cada
    if intervalo is not None and intervalo > 0:
        # A LEITURA VIVA ANTES DO RELOGIO: os spots (e o livro) assinam-se primeiro, para que o primeiro retrato
        # ja' esteja guardado quando a primeira volta publicar. O registo falhado di'-se por nome e a leitura cai
        # na regua declarada (a ultima vela fechada).
        _assinar_o_mercado(arranque)
        _armar_leitura(arranque, intervalo)
        diag(
            etapa="leitura_de_mercado_armada",
            cada_ms=intervalo,
            instrumentos=list(ficha.instrumentos),
            nota="a leitura corre no relogio declarado; o mandato e' a ficha, e e' relida em cada volta (RN-V10)",
        )

    try:
        codigo = servir(arranque)
    finally:
        encerrar(arranque)
    return codigo


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
