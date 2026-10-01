"""O DESFECHO do conector cTrader — a resposta do venue traduzida nas QUATRO classificacoes neutras.

O QUE ESTE FICHEIRO FAZ, e so' isto: pega' no evento de execucao do venue (`ProtoOAExecutionEvent`, que o
transporte entrega como DICIONARIO) e diz o que ACONTECEU em vocabulario NEUTRO do contrato (RN-C2,
FR-063/FR-064/FR-067): `aceite`, `parcial`, `desconhecido` ou `recusado`. Nao decide risco, nao reenvia, nao
reconcilia, nao le' a conta: CLASSIFICA. As funcoes sao PURAS — recebem o dicionario do venue e devolvem a
classificacao (ou o desfecho ja' montado).

AS QUATRO, e por que' sao quatro. `aceite` e `parcial` dizem que ha' posicao, e o desfecho traz — em
`resposta_do_venue` — o `positionId` que a liga a' ordem e os numeros que o venue deu. `recusado` diz que nao
ha', e traz SEMPRE um `motivo` do conjunto FECHADO do contrato (recusa sem motivo e' recusada pelo proprio
contrato). `desconhecido` e' o que a casa mais protege: uma ordem SEM resposta dentro do prazo declarado nao e'
sucesso (mandaria uma segunda ordem sobre uma posicao que talvez exista) nem falha (deixaria uma posicao orfa'
que ninguem defende) — e' NAO SABER, e diz-se. A funcao que a produz e' `desfecho_do_silencio`, e o nome dela
di-lo: nem falha nem sucesso.

TRES TIPOS NAO SAO ORDENS, e isso e' a armadilha (RN-CT38). `SWAP`, `DEPOSIT_WITHDRAW` e `BONUS_DEPOSIT_WITHDRAW`
sao ACONTECIMENTOS DE CONTA: um leitor que os tratasse como desfecho de ordem INVENTAVA ordens que nao existem.
Quem os separa e' `e_acontecimento_de_conta`; o que se faz com eles e' `acontecimento_de_conta` — registo
proprio, sem classificacao nenhuma.

A PALAVRA DO VENUE NAO SE TRADUZ (RN-CT42). O `errorCode` do venue (e os valores de `executionType`,
`orderStatus` e `dealStatus`) entram em `resposta_do_venue` TAL COMO O VENUE OS DEU. O `motivo` do desfecho e'
do conjunto fechado do CONTRATO — nunca um texto do venue a passar por motivo nosso.

O QUE NAO SE RECALCULA (FR-064). O preco, o volume executado, a comissao e o `positionId` vao em
`resposta_do_venue` COMO CHEGARAM. Este ficheiro nao multiplica, nao soma, nao arredonda e nao converte unidade
nenhuma: quem o faz e' a resolucao (`ordens.py`, data-model §0), e a resolucao entra aqui como DADO — o
desfecho apenas a transporta, porque «nao se resolve o que nunca se chegou a resolver» (RN-C10).

FAIL-CLOSED, sem excepcao. Um `executionType`/`orderStatus`/`dealStatus` fora do repertorio documentado e'
RECUSA NOMEADA e nunca vira `aceite`; um evento sem `executionType` e' recusa nomeada; e o desfecho montado e'
conferido contra o contrato ANTES de ser devolvido — o que o contrato recusar nao sai daqui (a mesma regra da
sonda e da costura).
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
sys.path.insert(0, str(RAIZ / "contracts" / "esqueleto"))

from framing import validar, versao_vigente  # noqa: E402  (o caminho tem de ser posto primeiro)

# -----------------------------------------------------------------------------------------------------------
# O REPERTORIO DO VENUE. Sao NOMES, e estao declarados aqui — este conector NAO importa a biblioteca (a
# fronteira e' o `transporte.py`, o unico ficheiro que sabe que ela existe). Fonte dos nomes: RN-CT38/RN-CT39,
# medidos em `ctrader_api_client/enums.py` 0.11.0. O que aqui nao estiver RECUSA-se.
# -----------------------------------------------------------------------------------------------------------

#: Os tres `executionType` que NAO sao ordens (RN-CT38): sao ACONTECIMENTOS DE CONTA, e nao viram desfecho.
ACONTECIMENTOS_DE_CONTA = ("SWAP", "DEPOSIT_WITHDRAW", "BONUS_DEPOSIT_WITHDRAW")

#: Os oito `executionType` que SAO ordens, e a classificacao neutra de cada um. Mapa FECHADO: um tipo que
#: aqui nao esteja e' recusa nomeada (nunca `aceite` por omissao).
CLASSIFICACAO_POR_EXECUTION_TYPE = {
    "ORDER_ACCEPTED": "aceite",  # em repouso: a ORDEM existe (maquina de estados: `enviada` -> desfecho `aceite`)
    "ORDER_FILLED": "aceite",  # preenchida
    "ORDER_PARTIAL_FILL": "parcial",  # preenchida so' em parte: ha' posicao, e sabe-se qual
    "ORDER_REPLACED": "aceite",  # a ordem continua viva, com os campos novos
    "ORDER_REJECTED": "recusado",  # o venue recusou
    "ORDER_CANCELLED": "recusado",  # nao chegou a acontecer
    "ORDER_EXPIRED": "recusado",  # nao chegou a acontecer
    "ORDER_CANCEL_REJECTED": "recusado",  # o cancelamento foi recusado pelo venue
}

#: O repertorio de `orderStatus` (RN-CT39). Fora dele e' recusa nomeada.
ORDER_STATUS_DO_VENUE = ("ACCEPTED", "FILLED", "REJECTED", "EXPIRED", "CANCELLED")

#: O repertorio de `dealStatus` (RN-CT39).
DEAL_STATUS_DO_VENUE = ("FILLED", "PARTIALLY_FILLED", "REJECTED", "INTERNALLY_REJECTED", "ERROR", "MISSED")

#: Os `dealStatus` que sao FALHA: o negocio nao se fez, e o desfecho e' recusa (o venue e' quem o diz).
DEAL_STATUS_DE_RECUSA = ("REJECTED", "INTERNALLY_REJECTED", "ERROR", "MISSED")

#: Os campos do evento cuja PALAVRA e' do VENUE e vai INTACTA para `resposta_do_venue` (RN-CT42).
PALAVRAS_DO_VENUE = ("executionType", "orderStatus", "dealStatus", "errorCode")

#: Os payloads relevantes que vao INTACTOS para `resposta_do_venue` (data-model §4): ordem, posicao, negocio.
#: E' daqui — e nao de conta nossa — que saem o `positionId` e os numeros LIDOS (preco, volume, comissao).
PAYLOADS_DO_VENUE = ("order", "position", "deal")

#: Motivo da recusa quando quem recusou foi o VENUE e a razao dele nao tem nome no nosso vocabulario. A palavra
#: do venue (o `errorCode`) fica intacta em `resposta_do_venue`; o motivo e' NOSSO e e' do conjunto fechado.
MOTIVO_DA_RECUSA_DO_VENUE = "desfecho_nao_reconhecido"

#: Motivo quando um valor do repertorio (`executionType`/`orderStatus`/`dealStatus`) vem FORA do conjunto
#: conhecido: e' um valor que nao pertence ao conjunto fechado do campo, e nao se adivinha o que ele significa.
MOTIVO_DE_VALOR_FORA_DO_REPERTORIO = "valor_fora_do_conjunto"

#: Motivo quando falta o `executionType`: sem ele nao ha' classificacao nenhuma a dar — e nao se da' `aceite`.
MOTIVO_SEM_TIPO_DE_EXECUCAO = "campo_obrigatorio_ausente"

#: A classificacao do SILENCIO. Uma ordem sem resposta dentro do prazo declarado fica nesta — nem falha nem
#: sucesso (FR-067). Esta' aqui como constante para que o nome apareca uma vez so', e no sitio que o produz.
CLASSIFICACAO_DO_SILENCIO = "desconhecido"


class AcontecimentoDeConta(Exception):
    """O evento e' de CONTA (swap/deposito/bonus), e nao de ORDEM: nao ha' desfecho de ordem a dar (RN-CT38).

    Levantada quando alguem pede um desfecho de ordem a um evento que nao e' uma ordem. Nao e' uma recusa do
    desfecho — e' a afirmacao de que ESTE evento nao tem desfecho nenhum: quem o recebeu regista-o pelo
    `acontecimento_de_conta()`.
    """


@dataclass(frozen=True)
class Veredicto:
    """A classificacao de UM evento de ordem, com o motivo quando (e so' quando) ela e' recusa."""

    classificacao: str
    motivo: str | None
    porque: str


def e_acontecimento_de_conta(evento: dict[str, Any]) -> bool:
    """Separa os ACONTECIMENTOS DE CONTA dos DESFECHOS DE ORDEM (RN-CT38).

    `True` quando o `executionType` do evento e' `SWAP`, `DEPOSIT_WITHDRAW` ou `BONUS_DEPOSIT_WITHDRAW`: sao
    acontecimentos da CONTA — o swap que o venue cobrou, um deposito ou um levantamento, um bonus — e NAO viram
    desfecho de ordem. Quem os tratasse como desfecho inventava ordens que nao existem.
    """
    execution_type = _palavra_do_venue(evento, "executionType")
    return execution_type in ACONTECIMENTOS_DE_CONTA


def acontecimento_de_conta(evento: dict[str, Any]) -> dict[str, Any]:
    """O registo PROPRIO de um acontecimento de conta: sem classificacao e sem desfecho (RN-CT38).

    Nao e' mensagem do contrato neutro (o contrato nao tem `desfecho` para o que nao e' ordem) — e' a linha que
    o conector regista para que o dinheiro que mexeu na conta fique dito. A palavra do venue vai intacta.
    """
    if not e_acontecimento_de_conta(evento):
        raise ValueError(
            "`acontecimento_de_conta` so' serve um evento de CONTA (SWAP/DEPOSIT_WITHDRAW/BONUS_DEPOSIT_WITHDRAW): "
            "este evento traz um `executionType` de ordem, e o lugar dele e' o desfecho"
        )
    return {"tipo": "acontecimento_de_conta", **_resposta_do_venue(evento)}


def classificar_ordem(evento: dict[str, Any]) -> Veredicto:
    """Classifica UM evento de ordem do venue nas quatro do contrato. Pura: nao fala com ninguem.

    A ordem das verificacoes e' a ordem dos perigos: primeiro o que faz o evento NAO SER um desfecho de ordem
    (acontecimento de conta), depois o que o torna ILEGIVEL (tipo fora do repertorio, sem tipo), depois o que o
    torna recusa (erro do venue), e so' no fim a leitura normal do tipo. Nunca ao contrario.
    """
    if e_acontecimento_de_conta(evento):
        raise AcontecimentoDeConta(
            "o evento e' um ACONTECIMENTO DE CONTA (swap/deposito/bonus) e nao uma ordem: nao ha' desfecho de "
            "ordem a classificar — registe-o por `acontecimento_de_conta()` (RN-CT38)"
        )

    execution_type = _palavra_do_venue(evento, "executionType")
    if execution_type is None:
        return Veredicto(
            classificacao="recusado",
            motivo=MOTIVO_SEM_TIPO_DE_EXECUCAO,
            porque=(
                "o evento do venue nao trouxe `executionType`: sem o tipo nao ha' classificacao a dar, e o que "
                "nao se le' nao vira `aceite`"
            ),
        )

    if execution_type not in CLASSIFICACAO_POR_EXECUTION_TYPE:
        return Veredicto(
            classificacao="recusado",
            motivo=MOTIVO_DE_VALOR_FORA_DO_REPERTORIO,
            porque=(
                f"o venue declarou `executionType` = {execution_type!r}, que nao esta' no repertorio conhecido "
                f"({', '.join(CLASSIFICACAO_POR_EXECUTION_TYPE)}): um tipo que nao se le' nao se assume — e' recusa"
            ),
        )

    # O ERRO DO VENUE MANDA. `ORDER_REJECTED`/`ProtoOAErrorRes` traz um `errorCode`: houve recusa, mesmo que o
    # tipo diga outra coisa. A palavra dele vai intacta para `resposta_do_venue` (RN-CT42).
    error_code = _palavra_do_venue(evento, "errorCode")
    if error_code is not None:
        return Veredicto(
            classificacao="recusado",
            motivo=MOTIVO_DA_RECUSA_DO_VENUE,
            porque=(
                f"o venue recusou e deu `errorCode` = {error_code!r}: o motivo neutro e' nosso, e a palavra do "
                "venue fica em `resposta_do_venue` sem traducao"
            ),
        )

    order_status = _palavra_do_venue(evento, "orderStatus")
    if order_status is not None and order_status not in ORDER_STATUS_DO_VENUE:
        return Veredicto(
            classificacao="recusado",
            motivo=MOTIVO_DE_VALOR_FORA_DO_REPERTORIO,
            porque=(
                f"o venue declarou `orderStatus` = {order_status!r}, fora do repertorio conhecido "
                f"({', '.join(ORDER_STATUS_DO_VENUE)}): nao se adivinha o que ele significa"
            ),
        )

    deal_status = _palavra_do_venue(evento, "dealStatus")
    if deal_status is not None and deal_status not in DEAL_STATUS_DO_VENUE:
        return Veredicto(
            classificacao="recusado",
            motivo=MOTIVO_DE_VALOR_FORA_DO_REPERTORIO,
            porque=(
                f"o venue declarou `dealStatus` = {deal_status!r}, fora do repertorio conhecido "
                f"({', '.join(DEAL_STATUS_DO_VENUE)}): nao se adivinha o que ele significa"
            ),
        )

    if deal_status in DEAL_STATUS_DE_RECUSA:
        return Veredicto(
            classificacao="recusado",
            motivo=MOTIVO_DA_RECUSA_DO_VENUE,
            porque=(
                f"o negocio do venue ficou em `dealStatus` = {deal_status!r}: nao se fez, e o venue e' quem o diz"
            ),
        )

    classificacao = CLASSIFICACAO_POR_EXECUTION_TYPE[execution_type]
    if classificacao == "recusado":
        # O TIPO diz que nao houve ordem (cancelada, expirada, cancelamento recusado) e o venue nao deu
        # `errorCode`: a recusa continua a ser recusa, e leva motivo do conjunto fechado como qualquer outra.
        return Veredicto(
            classificacao=classificacao,
            motivo=MOTIVO_DA_RECUSA_DO_VENUE,
            porque=(
                f"o venue declarou `{execution_type}`: a ordem nao se fez, e a razao e' a palavra dele — que vai "
                "intacta em `resposta_do_venue`"
            ),
        )
    return Veredicto(
        classificacao=classificacao,
        motivo=None,
        porque=_porque(execution_type, classificacao),
    )


def desfecho_do_evento(evento: dict[str, Any], resolucao: dict[str, Any] | None = None) -> dict[str, Any]:
    """Monta o DESFECHO NEUTRO a partir do evento do venue. Pura: nao fala com ninguem.

    `resolucao` e' a que foi escrita ANTES do envio (ou, quando o venue so' calcula ao executar, a que saiu
    DEPOIS com os numeros dele — data-model §4). Entra aqui como DADO: este ficheiro nao calcula resolucao
    nenhuma (FR-064). Onde o contrato a exige (aceite/parcial/desconhecido) e ela nao vier, o proprio contrato
    recusa o desfecho e ele NAO sai daqui — e' o comportamento querido: nao se publica o que o contrato recusa.

    Um evento de CONTA (swap/deposito/bonus) nao tem desfecho: levanta `AcontecimentoDeConta`.
    """
    veredicto = classificar_ordem(evento)

    carga: dict[str, Any] = {
        "classificacao": veredicto.classificacao,
        "resposta_do_venue": _resposta_do_venue(evento),
    }
    if veredicto.classificacao == "recusado":
        # A recusa do contrato EXIGE motivo — e o motivo e' do conjunto FECHADO (nunca a palavra do venue).
        carga["motivo"] = _exigir_motivo(veredicto)
    if resolucao is not None:
        carga["resolucao"] = resolucao

    return _exigir_do_contrato(carga)


def desfecho_do_silencio(resolucao: dict[str, Any], prazo_declarado_ms: int) -> dict[str, Any]:
    """A ordem SEM resposta dentro do prazo declarado fica `desconhecido` — NEM FALHA NEM SUCESSO (FR-067).

    E' o desfecho mais importante desta casa, e o nome desta funcao di-lo para que ninguem tenha de o deduzir
    do corpo: promove-lo a `aceite` mandaria uma segunda ordem sobre uma posicao que talvez exista; rebaixa-lo
    a `recusado` deixaria uma posicao orfa' que ninguem defende. As duas coisas sao piores do que nao saber.

    Nao leva `motivo`: a recusa e' que exige motivo, e aqui nao houve recusa nenhuma — houve FALTA DE RESPOSTA.
    Leva `resolucao` (existiu uma: foi escrita antes de enviar) e a declaracao do prazo em `resposta_do_venue`,
    porque nao ha' resposta bruta do venue para guardar. A verdade deste estado so' sai por RECONCILIACAO
    (leitura do venue) — nunca por aqui.
    """
    carga: dict[str, Any] = {
        "classificacao": CLASSIFICACAO_DO_SILENCIO,
        "resolucao": resolucao,
        "resposta_do_venue": {
            "sem_resposta": True,
            "prazo_declarado_ms": prazo_declarado_ms,
            "porque": (
                "o venue nao respondeu dentro do prazo declarado: e' `desconhecido` — nem falha nem sucesso — "
                "e so' a reconciliacao por leitura o faz sair daqui"
            ),
        },
    }
    return _exigir_do_contrato(carga)


# -----------------------------------------------------------------------------------------------------------
# As ajudas. Nenhuma delas inventa valor: o que nao veio fica AUSENTE, e o que veio com a forma errada recusa.
# -----------------------------------------------------------------------------------------------------------


def _palavra_do_venue(evento: dict[str, Any], campo: str) -> str | None:
    """A PALAVRA do venue tal como veio; `None` quando o campo nao veio (ausente ou nulo).

    Um campo que esteja la' com uma forma que nao seja palavra (`executionType` numerico, por exemplo) RECUSA:
    o repertorio do venue e' de nomes, e converter um numero em texto seria ler um valor que ninguem escreveu.
    """
    if campo not in evento:
        return None
    valor = evento[campo]
    if valor is None:
        return None
    if not isinstance(valor, str):
        raise ValueError(
            f"`{campo}` veio como {type(valor).__name__} ({valor!r}) e o repertorio do venue e' de PALAVRAS: "
            "nao se converte em silencio um valor que ninguem escreveu"
        )
    return valor


def _resposta_do_venue(evento: dict[str, Any]) -> dict[str, Any]:
    """O payload relevanto do venue, TAL COMO CHEGOU: as palavras dele e os objectos ordem/posicao/negocio.

    Data-model §4: `resposta_do_venue` preserva o vocabulario do venue. E' daqui — sem uma conta nossa pelo
    meio — que saem o `positionId` (a ligacao ordem->posicao) e os numeros LIDOS (preco, volume, comissao).
    """
    resposta: dict[str, Any] = {}
    for campo in PALAVRAS_DO_VENUE:
        if campo in evento and evento[campo] is not None:
            resposta[campo] = evento[campo]
    for campo in PAYLOADS_DO_VENUE:
        if campo not in evento or evento[campo] is None:
            continue
        objeto = evento[campo]
        if not isinstance(objeto, dict):
            raise ValueError(
                f"o payload `{campo}` do evento veio como {type(objeto).__name__}, e o venue entrega um objecto: "
                "nao se guarda uma resposta com forma que nao se le'"
            )
        resposta[campo] = dict(objeto)
    return resposta


def _exigir_motivo(veredicto: Veredicto) -> str:
    """O motivo de uma recusa. Sem motivo nao ha' recusa — o contrato recusa-a, e por isso se exige aqui."""
    if veredicto.motivo is None:
        raise ValueError(
            f"a classificacao `{veredicto.classificacao}` exige um motivo do conjunto fechado do contrato, e "
            f"nenhum foi produzido ({veredicto.porque}): nao se publica uma recusa sem motivo"
        )
    return veredicto.motivo


def _porque(execution_type: str, classificacao: str) -> str:
    """O porque', em palavras, de uma classificacao que nao e' recusa — vai para quem le' o desfecho."""
    if execution_type == "ORDER_FILLED":
        return "o venue deu a ordem por preenchida: ha' posicao, com os numeros que ele mesmo publicou"
    if execution_type == "ORDER_PARTIAL_FILL":
        return (
            "o venue preencheu so' parte da ordem: ha' posicao e sabe-se exactamente qual — a parcial NAO e' "
            "um desconhecido"
        )
    if execution_type == "ORDER_ACCEPTED":
        return "o venue aceitou a ordem e ela esta' em repouso: o preenchimento chega por evento proprio"
    return f"o venue declarou `{execution_type}`: a ordem continua viva ({classificacao})"


def _exigir_do_contrato(carga: dict[str, Any]) -> dict[str, Any]:
    """Nao se devolve um desfecho que o CONTRATO recusa — a mesma regra da sonda e da costura.

    A conferencia e' contra o esquema (nao contra um literal escrito aqui): e' ela que garante que a recusa
    traz motivo, que fora da recusa a resolucao esta' la', e que nenhum campo a mais saiu. Falhar AQUI e' o
    comportamento querido: um desfecho torto nao chega a quem o le'.
    """
    linha = json.dumps(
        {"contrato": versao_vigente(), "tipo": "desfecho", "id": "desfecho", "carga": carga},
        ensure_ascii=False,
    )
    veredicto = validar(linha)
    if veredicto.get("veredicto") != "aceite":
        raise ValueError(
            f"o desfecho montado nao passa o contrato ({veredicto.get('motivo')}): nao se publica — um desfecho "
            "que o contrato recusa nao e' um desfecho"
        )
    return carga
