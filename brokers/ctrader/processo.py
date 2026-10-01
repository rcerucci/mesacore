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

O QUE ESTA PONTA AINDA NAO TEM, e por isso diz, em vez de inventar: o VERBO DE ENVIO do transporte
(`colocar_ordem`/`fechar_posicao`) e o RETRATO do mercado (a subscricao de spots/profundidade existe, a leitura
do ultimo retrato ainda nao). Onde falta, a recusa e' NOMEADA (`capacidade_nao_declarada`) com o que falta dito
— nunca um numero nosso a passar por numero do venue.
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
from decimal import Decimal
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
    resultado, ligacao = _abrir_ligacao(transporte, ficha, credencial)
    if not resultado.ok:
        portas.append(
            ResultadoDaPorta(porta="ligacao", veredicto="falhou", motivo=resultado.motivo, porque=resultado.porque)
        )
        return Arranque(ok=False, portas=portas, ficha=ficha, credencial=credencial)
    _passou(portas, "ligacao", ligacao)
    assert transporte is not None  # posto por `_abrir_ligacao` quando ele nao veio de fora

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
    identidade = _conferir_identidade(transporte, ficha, credencial)
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
) -> tuple[Tr.Resultado, str]:
    """Abre o fio e autoriza a CONTA — as DUAS camadas do FR-048.

    O transporte constroi-se aqui, a serio, quando nao veio de fora (a prova injecta um duplo). As duas camadas
    sao `abrir()` (o fio de pe' + a aplicacao autenticada) e `autorizar_conta()` (a sessao da CONTA): o conector
    so' envia quando as duas estao prontas, e por isso a porta so' passa quando as duas passarem.
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
        )
    autorizada = transporte.autorizar_conta(
        ficha.ctid_trader_account_id, credencial.access_token, credencial.refresh_token
    )
    if not autorizada.ok:
        return (
            Tr.Resultado(ok=False, motivo=autorizada.motivo, porque=autorizada.porque),
            "",
        )
    return (
        Tr.Resultado(ok=True),
        (
            "as DUAS camadas estao prontas: o fio de pe' e a aplicacao autenticada (`abrir`), e a sessao da conta "
            f"{ficha.conta} ({ficha.ctid_trader_account_id}) autorizada (`autorizar_conta`) — FR-048"
        ),
    )


@dataclass(frozen=True)
class _Identidade:
    ok: bool
    motivo: str
    porque: str
    direitos: str | None = None
    so_fecha: bool = False


def _conferir_identidade(transporte: Tr.Transporte, ficha: Fi.Ficha, credencial: Cr.Trio) -> _Identidade:
    """A porta 8: QUAIS contas o token autoriza, e o id da ficha esta' entre elas?

    A lista vem do TOKEN (`contas`), e a porta NOMEIA as contas que ele trouxer — o id da ficha tem de estar
    entre elas, ou nao se serve nada (FR-049/RN-CT8). Depois leem-se os DIREITOS da conta (`trader`), porque um
    conector que arranca sem poder fechar e' pior do que nenhum (RN-CT12).
    """
    lidas = transporte.contas(credencial.access_token)
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
    """
    caminhos: dict[str, Path] = {}
    for campo, referencia in ficha.credencial_arquivos.items():
        if not referencia.startswith("ficheiro:"):
            continue
        caminhos[campo] = Path(referencia[len("ficheiro:") :]).expanduser()
    return caminhos


def _desvio_maximo_da_ficha(ficha: Fi.Ficha) -> str | None:
    """O `desvio_maximo` que a ficha declara, QUANDO o declara. `None` = nao ha de onde o ler.

    O manifesto exige-o (e' o que o venue aceita, em percentagem). Hoje `ficha.py` nao o le': quando o dono o
    acrescentar, este nome passa a encontra'-lo, e a sonda corre. Ate' la' a porta da sonda declara-se
    `nao_corrida` — nao se inventa uma percentagem do venue.
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
    posicao = evento.get("position")
    if isinstance(posicao, dict):
        margem = _inteiro(posicao.get("usedMargin"))
        if margem is not None and expoente is not None:
            numeros["margem_empenhada"] = Le._decimal_de_escalado(margem, expoente)  # noqa: SLF001
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
    diag_local: list[dict[str, Any]] = []
    if not isinstance(evento, dict):
        diag_local.append(
            {
                "etapa": "envio",
                "veredicto": "resposta_ilegivel",
                "porque": "o transporte devolveu a resposta do venue numa forma que nao se le' (nao e' objecto)",
            }
        )
        return [], diag_local
    if De.e_acontecimento_de_conta(evento):
        diag_local.append(
            {
                "etapa": "acontecimento_de_conta",
                "registo": De.acontecimento_de_conta(evento),
                "porque": "o venue mexeu no dinheiro da conta (swap/deposito/bonus): nao e' desfecho de ordem (RN-CT38)",
            }
        )
        return [], diag_local
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
        return [], diag_local
    linha = linha_do_contrato("desfecho", correlacao, carga)
    return ([] if linha is None else [linha]), diag_local


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


def _atender_ordem(correlacao: str, boleta: dict[str, Any], arranque: Arranque) -> Atendimento:
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

    traduzido = Or.traduzir(
        {
            "boleta": boleta,
            "manifesto": arranque.manifesto,
            "simbolo": unidade,
            "saldo": saldo,
            "preco": preco,
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
    return _enviar_e_desfechar(
        correlacao,
        arranque,
        VERBO_DE_ABERTURA,
        traduzido.accao,
        traduzido.resolucao,
        _alavancagem_da_boleta(boleta),
        conta,
        diag_local,
    )


def _atender_fecho(correlacao: str, boleta: dict[str, Any], arranque: Arranque) -> Atendimento:
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
    return _enviar_e_desfechar(
        correlacao, arranque, VERBO_DE_FECHO, ordem, {}, _alavancagem_da_boleta(boleta), conta_interior, diag_local
    )


def _enviar_e_desfechar(
    correlacao: str,
    arranque: Arranque,
    verbo: str,
    accao: dict[str, Any],
    resolucao: dict[str, str],
    alavancagem: Decimal | None,
    conta: dict[str, Any],
    diag_local: list[dict[str, Any]],
) -> Atendimento:
    """O envio (com prazo) e o desfecho. O silencio do venue vira `desconhecido` — nem falha nem sucesso."""
    transporte = arranque.transporte
    ficha = arranque.ficha
    if transporte is None or ficha is None:
        return Atendimento(
            linhas=_desfecho_de_recusa(correlacao, "capacidade_nao_declarada", "nao ha transporte aberto"),
            diag=diag_local,
        )
    account_id = ficha.ctid_trader_account_id
    prazo_s = arranque.prazo_do_venue_ms / 1000.0
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
        try:
            silencio = De.desfecho_do_silencio(resolucao, arranque.prazo_do_venue_ms)
        except ValueError as erro:
            diag_local.append({"etapa": "desfecho", "veredicto": "nao_publicado", "porque": str(erro)})
            return Atendimento(diag=diag_local)
        linha = linha_do_contrato("desfecho", correlacao, silencio)
        return Atendimento(linhas=[] if linha is None else [linha], diag=diag_local)
    if not enviado.ok:
        motivo = enviado.motivo
        if motivo == "capacidade_nao_declarada":
            return Atendimento(
                linhas=_desfecho_de_recusa(correlacao, motivo, enviado.porque),
                diag=diag_local,
            )
        diag_local.append(
            {
                "etapa": "envio",
                "veredicto": "sem_resposta",
                "verbo": verbo,
                "motivo": motivo,
                "porque": enviado.porque,
            }
        )
        try:
            silencio = De.desfecho_do_silencio(resolucao, arranque.prazo_do_venue_ms)
        except ValueError as erro:
            diag_local.append({"etapa": "desfecho", "veredicto": "nao_publicado", "porque": str(erro)})
            return Atendimento(diag=diag_local)
        linha = linha_do_contrato("desfecho", correlacao, silencio)
        return Atendimento(linhas=[] if linha is None else [linha], diag=diag_local)

    expoente = _expoente_do_dinheiro(conta)
    numeros = _numeros_do_venue_do_evento(enviado.valor, expoente)
    resolucao_do_venue = _resolucao_completa(resolucao, numeros, alavancagem)
    linhas, diag_do_desfecho = _desfecho_do_envio(arranque, correlacao, enviado.valor, resolucao_do_venue)
    return Atendimento(linhas=linhas, diag=diag_local + diag_do_desfecho)


def _expoente_do_dinheiro(conta: dict[str, Any]) -> int | None:
    """O `moneyDigits` da conta, quando ela o traz (o modelo da biblioteca nao o traz — achado medido)."""
    valor = _inteiro(conta.get("expoente_dos_valores"))
    if valor is None or valor < 0:
        return None
    return valor


def _resolucao_completa(
    antes: dict[str, str], numeros_do_venue: dict[str, str], alavancagem: Decimal | None
) -> dict[str, str]:
    """A resolucao do desfecho: a de antes do envio, completada com os numeros que o VENUE deu (RN-C10).

    O que o venue nao deu fica AUSENTE — e' o estado honesto (o venue nao publica o preco de liquidacao), e o
    contrato recusa a resolucao com `campo_obrigatorio_ausente` em vez de aceitar um zero inventado.
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
    return completada


# -----------------------------------------------------------------------------------------------------------
# A LEITURA DO MERCADO, no relogio declarado. Aqui — e so' aqui — se compoe a mensagem `mercado`.
# -----------------------------------------------------------------------------------------------------------


def publicar_mercado(arranque: Arranque, instrumento: str) -> list[dict[str, Any]]:
    """Le' o mercado de UM instrumento e publica a linha `mercado` que o contrato aceitar.

    O `EntradaMercado` (a cotacao e o livro) chega por ACONTECIMENTO do venue, e esta ponta ainda nao le' o
    ultimo retrato: a regua declarada e' a ULTIMA VELA FECHADA, e o `ultimo` publicado e' o fecho dela — com o
    instante do VENUE e a idade calculada. O que falta (bid/ask/livro) fica AUSENTE, e dito.
    [a confirmar em demonstracao: com a subscricao de spots a ser lida, a cotacao substitui a vela]
    """
    ficha = arranque.ficha
    transporte = arranque.transporte
    if ficha is None or transporte is None:
        return []
    account_id = ficha.ctid_trader_account_id
    symbol_id = _universo_do_instrumento(transporte, account_id, instrumento)
    if isinstance(symbol_id, Le.Recusa):
        return [{"etapa": "leitura_de_mercado", "instrumento": instrumento, "veredicto": "recusado", "motivo": symbol_id.motivo, "porque": symbol_id.porque}]
    vela = _ultima_vela(transporte, account_id, symbol_id, instrumento)
    if isinstance(vela, Le.Recusa):
        return [{"etapa": "leitura_de_mercado", "instrumento": instrumento, "veredicto": "recusado", "motivo": vela.motivo, "porque": vela.porque}]
    fecho, instante = vela
    ultimo = Or.preco_relativo(fecho, "fecho da vela")
    if isinstance(ultimo, Or.Recusa):
        return [{"etapa": "leitura_de_mercado", "instrumento": instrumento, "veredicto": "recusado", "motivo": ultimo.motivo, "porque": ultimo.porque}]
    entrada = Le.EntradaMercado(tempo_do_venue_ms=instante, ultimo=ultimo)
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
            "regua": "ultima vela fechada (o retrato da subscricao ainda nao se le') — [a confirmar em demonstracao]",
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
    ap.add_argument("--casos", default=None, help="a bateria de casos do processo (o operador passa-a; a bancada le'-a)")
    ap.add_argument("--ao-vivo", action="store_true", help="fala com o venue a serio")
    ap.add_argument("--sonda", action="store_true", help="so' sonda e publica o manifesto, sem servir")
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
        linha = linha_do_contrato("manifesto", f"{ficha.conector}/manifesto", arranque.manifesto)
        if linha is None:
            diag(etapa="sonda", veredicto="nao_publicada", porque="o manifesto nao passou o contrato")
            return 2
        escrever_na_costura(linha)
        diag(etapa="sonda", veredicto="publicado", nota="modo de sonda: nenhuma boleta e' servida")
        return 0

    intervalo = args.leitura_a_cada
    if intervalo is not None and intervalo > 0:
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
