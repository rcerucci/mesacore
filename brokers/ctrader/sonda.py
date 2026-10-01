"""A SONDA e o MANIFESTO — o que este venue oferece, lido e nao escrito.

A REGRA QUE MANDA AQUI (RN-C1): nenhum numero do venue vive no nosso codigo. Este ficheiro le' do venue os
limites, o passo, os digitos, as distancias minimas, os custos e as alavancagens, e publica-os como MANIFESTO —
a declaracao do que o conector sabe. Sem declaracao nao ha' capacidade: a mesa recusa arrancar em vez de tentar
(RN-C7).

O QUE A DOC DECLARA E A BIBLIOTECA NAO TRAZ fica AUSENTE, e dito: `gsl_distance`, `gsl_charge`, `holiday`,
`commission_type`, `min_commission`, `charge_swap_at_weekends`, `swap_calculation_type`, `distance_set_in` — e
o `money_digits` da conta (que aparece por posicao). Ausente nao vira zero, nem `False`, nem estimativa (D4).

DUAS GRANDEZAS QUE O CONTRATO EXIGE E ESTE VENUE NAO PUBLICA — resolvidas sem inventar:

1. `minimo_de_valor_por_ordem` — o venue nao tem campo de minimo em DINHEIRO; tem `minVolume`, em 0,01 de
   unidade. O manifesto publica o VALOR desse minimo ao ultimo preco conhecido do instrumento (a ultima vela
   fechada da ficha), que e' uma CONTA NOSSA declarada — e o piso global e' o MAIOR dos pisos dos instrumentos,
   porque abaixo dele algum instrumento recusa.
2. `profundidade_de_livro` — o venue nao declara quantos niveis da'; da'-os. A sonda subscreve a profundidade de
   um instrumento, espera pelo primeiro retrato, e CONTA os niveis que vieram. Sem retrato dentro do prazo, a
   sonda FALHA: um numero de niveis inventado seria uma capacidade a mais do que a real.
"""

from __future__ import annotations

import asyncio
import queue
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
sys.path.insert(0, str(RAIZ / "contracts" / "esqueleto"))
sys.path.insert(0, str(AQUI))

from framing import validar, versao_vigente  # noqa: E402

import transporte as Tr  # noqa: E402

#: Quanto tempo a sonda espera por um retrato da profundidade antes de declarar que nao o conseguiu ver.
PRAZO_DA_PROFUNDIDADE_POR_OMISSAO_S = 10.0

#: Quantas velas se pedem para achar a ultima fechada (so' a ultima interessa; pede-se mais para nao depender
#: de a barra em curso estar aberta).
VELAS_A_PEDIR = 3

#: O mapa dos tipos de ordem NEUTROS do contrato para os do venue. Os cinco servidos por este venue estao todos.
TIPOS_DE_ORDEM_DO_VENUE = {
    "mercado": "MARKET",
    "limite": "LIMIT",
    "stop": "STOP",
    "stop_limite": "STOP_LIMIT",
    "mercado_por_faixa": "MARKET_RANGE",
}

#: Da conta do venue para o vocabulario neutro do modelo de posicao.
MODELO_DE_POSICAO = {"HEDGED": "hedging", "NETTED": "netting"}

#: Do modelo de posicao para o modo de margem neutro. E' um MAPEAMENTO NOSSO, a confirmar em demonstracao.
MODOS_DE_MARGEM = {"hedging": ["isolado"], "netting": ["cruzado"]}


@dataclass(frozen=True)
class Recusa:
    ok: bool
    motivo: str
    porque: str


def recusa(motivo: str, porque: str) -> Recusa:
    return Recusa(ok=False, motivo=motivo, porque=porque)


def resolver_instrumentos(nomes: list[str], universo: list[dict[str, Any]]) -> dict[str, int] | Recusa:
    """Do NOME que a ficha declara para o `symbol_id` que o venue usa (RN-CT23).

    O nome e' a chave estavel: o id muda de corretora para corretora (a doc di-lo). Nome que nao exista e'
    RECUSA NOMEADA; nome que exista duas vezes (o mesmo nome em duas classes) e' recusa tambem — escolher o
    primeiro seria adivinhar qual.
    """
    por_nome: dict[str, list[int]] = {}
    for entrada in universo:
        nome = entrada.get("nome")
        ident = entrada.get("symbol_id")
        if not isinstance(nome, str) or not isinstance(ident, int):
            continue
        por_nome.setdefault(nome, []).append(ident)

    resolvidos: dict[str, int] = {}
    for nome in nomes:
        ids = por_nome.get(nome)
        if not ids:
            return recusa(
                "instrumento_desconhecido_no_manifesto",
                f"o instrumento `{nome}` da ficha nao esta' no universo deste venue "
                f"({len(por_nome)} nome(s) distintos): nao ha' id para ele, e nao se adivinha",
            )
        if len(ids) > 1:
            return recusa(
                "formato_invalido",
                f"o nome `{nome}` existe {len(ids)} vezes no universo (ids {ids}): escolher o primeiro seria "
                "adivinhar qual — o mandato tem de nomear um instrumento sem ambiguidade",
            )
        resolvidos[nome] = ids[0]
    return resolvidos


def montar_manifesto(
    *,
    nome_do_conector: str,
    versao_do_conector: str,
    versao_do_contrato: str,
    conta: dict[str, Any],
    nomes_por_id: dict[int, str],
    simbolos: list[dict[str, Any]],
    precos: dict[int, str],
    profundidade: int,
    desvio_maximo_pct: str,
    tipos_de_ordem: list[str],
) -> dict[str, Any]:
    """Monta o manifesto a partir do que foi LIDO. Puro: nao fala com ninguem.

    Recebe os numeros ja' em texto decimal (o contrato quer decimais textuais, nao binarios flutuantes).
    """
    # O MODELO DE POSICAO NAO SE INVENTA. `accountType` e' do venue (HEDGED/NETTED) e o mapa e' fechado: um
    # valor que nao esteja nele RECUSA, em vez de virar um modelo por omissao. (Havia aqui um `.get(..., "exchange")`
    # — um fallback que dizia a' mesa que o venue era de tipo `exchange` quando nao se sabia o que ele era.)
    tipo_do_venue = str(conta.get("tipo_de_conta"))
    if tipo_do_venue not in MODELO_DE_POSICAO:
        raise ValueError(
            f"o venue declarou `accountType` = {tipo_do_venue!r}, que nao esta' no mapa conhecido "
            f"({', '.join(MODELO_DE_POSICAO)}): sem modelo de posicao nao ha' manifesto — e nao se adivinha um"
        )
    modelo = MODELO_DE_POSICAO[tipo_do_venue]

    # A ALAVANCAGEM NAO SE INVENTA. O venue declara-a na conta (`leverageInCents`, com o helper da biblioteca a
    # traduzi-la); sem ela, a sonda RECUSA — o contrato exige uma alavancagem maxima positiva por instrumento, e
    # um `1` posto por nos seria um numero do venue escrito por engano.
    alavancagem_bruta = conta.get("alavancagem")
    if not isinstance(alavancagem_bruta, (int, float)) or alavancagem_bruta <= 0:
        raise ValueError(
            "o venue nao declarou a alavancagem da conta: sem ela nao ha' `alavancagem_maxima` para o manifesto"
        )
    alavancagem = float(alavancagem_bruta)

    instrumentos: list[dict[str, Any]] = []
    pisos: list[float] = []
    for simbolo in simbolos:
        ident = simbolo["symbol_id"]
        nome = nomes_por_id.get(ident, str(ident))
        # O minimo em VOLUME e' 0,01 de unidade; o valor dele e' `min_volume/100 × preco`. E' conta nossa, e
        # esta' declarada: o venue nao tem campo de minimo em dinheiro.
        valor_do_minimo = (simbolo["minimo"] / 100.0) * float(precos[ident])
        pisos.append(valor_do_minimo)
        instrumentos.append(
            {
                "simbolo": nome,
                "minimo": _decimal(simbolo["minimo"] / 100.0),
                "passo": _decimal(simbolo["passo"] / 100.0),
                "tick": _tick(simbolo["digitos"], simbolo["posicao_do_pip"]),
                "alavancagem_maxima": _decimal(alavancagem),
                # `funding_intervalo_horas` fica AUSENTE de proposito: o venue nao declara a cadencia do swap
                # como um numero de horas (o calendario e' o dele, e o `chargeSwapAtWeekends` nem vem no modelo
                # da biblioteca). Ausente = nao declarado, e nao um 24 inventado.
            }
        )

    piso_global = max(pisos) if pisos else 0.0

    return {
        "conector": {"nome": nome_do_conector, "versao": versao_do_conector},
        "versao": versao_do_contrato,
        "instrumentos": instrumentos,
        "sabe_ajustar_alavancagem": False,  # nao ha' verbo de ajuste neste venue (RN-CT16)
        "modos_de_margem": MODOS_DE_MARGEM[modelo],  # o mapa e' fechado nos dois sentidos: `modelo` veio dele
        "minimo_de_valor_por_ordem": _decimal(piso_global),
        "modelo_de_posicao": modelo,
        "tipos_de_ordem": tipos_de_ordem,
        "parcial_suportada": ["tudo_ou_nada", "o_que_der"],  # FOK e IOC: os dois existem neste venue
        "desvio_maximo": desvio_maximo_pct,
        "reduce_only_suportado": False,  # o venue nao tem reduce_only: o fecho e' por posicao (RN-CT34)
        "stop_anexo": True,  # o venue deixa prender stop a' POSICAO (AmendPositionRequest)
        "profundidade_de_livro": profundidade,
        "funding": True,  # swap: o venue cobra (e publica) o custo de manter
        "relogio_de_fecho_de_barra": "meia_noite_utc",  # o relogio do venue e' UTC (RN-CT27)
        "idempotencia": False,  # a marca existe; a GARANTIA do venue nao esta' medida (bateria)
        "marca_de_posse": "clientOrderId",
        "marca_liga_ordem_a_posicao": True,  # ProtoOAOrder.position_id
        "estado_do_mercado": True,  # tradingMode por simbolo
        "ligacao_por_protocolo": True,  # e em DUAS camadas (transporte != sessao da conta)
        "releitura_de_preco_ao_enviar": True,  # o conector rele' o preco ao enviar e mede o desvio da regua relida
        "devolve_a_resolucao": True,  # o desfecho traz volume executado, preco, comissao, marginRate
    }


def _decimal(valor: float) -> str:
    """Um decimal textual sem notacao cientifica e sem zeros a' direita. O contrato quer TEXTO."""
    texto = f"{valor:.10f}".rstrip("0").rstrip(".")
    return texto if texto else "0"


def _tick(digitos: Any, posicao_do_pip: Any) -> str:
    """O tick e' o menor passo de preco que o venue aceita: 10^-digitos. O `pipPosition` serve para conferir."""
    if not isinstance(digitos, int) or digitos < 0:
        raise ValueError(f"o simbolo nao declarou digitos utilizaveis: {digitos!r}")
    return _decimal(10.0 ** (-digitos))


# -----------------------------------------------------------------------------------------------------------
# A ORQUESTRACAO. Aqui fala-se com o venue: universo, simbolos, conta, ultimo preco e a profundidade.
# -----------------------------------------------------------------------------------------------------------


def sondar(
    transporte: Tr.Transporte,
    *,
    nome_do_conector: str,
    versao_do_conector: str,
    account_id: int,
    instrumentos: list[str],
    desvio_maximo_pct: str,
    prazo_da_profundidade_s: float = PRAZO_DA_PROFUNDIDADE_POR_OMISSAO_S,
) -> dict[str, Any] | Recusa:
    universo = transporte.simbolos(account_id)
    if not universo.ok:
        return recusa(str(universo.motivo), universo.porque)
    resolvidos = resolver_instrumentos(instrumentos, universo.valor)
    if isinstance(resolvidos, Recusa):
        return resolvidos

    nomes_por_id = {entrada["symbol_id"]: entrada["nome"] for entrada in universo.valor}
    ids = list(resolvidos.values())

    numeros = transporte.simbolos_por_id(account_id, ids)
    if not numeros.ok:
        return recusa(str(numeros.motivo), numeros.porque)

    conta = transporte.trader(account_id)
    if not conta.ok:
        return recusa(str(conta.motivo), conta.porque)

    # O ULTIMO PRECO FECHADO por instrumento: e' a regua do valor do minimo, e nao um numero guardado.
    precos: dict[int, str] = {}
    fim = datetime.now(timezone.utc)
    for ident in ids:
        velas = transporte.velas(account_id, ident, "H1", fim - timedelta(hours=24 * VELAS_A_PEDIR), fim)
        if not velas.ok or not velas.valor:
            return recusa(
                "falha_ao_ler_as_velas",
                f"sem a ultima vela de {nomes_por_id.get(ident, ident)} nao ha' preco para medir o valor do "
                "minimo: o manifesto nao sai com um numero inventado",
            )
        precos[ident] = _decimal(float(velas.valor[-1]["fecho"]))

    profundidade = _medir_profundidade(transporte, account_id, ids[0], prazo_da_profundidade_s)
    if isinstance(profundidade, Recusa):
        return profundidade

    manifesto = montar_manifesto(
        nome_do_conector=nome_do_conector,
        versao_do_conector=versao_do_conector,
        versao_do_contrato=versao_vigente(),
        conta=conta.valor,
        nomes_por_id=nomes_por_id,
        simbolos=numeros.valor,
        precos=precos,
        profundidade=profundidade,
        desvio_maximo_pct=desvio_maximo_pct,
        tipos_de_ordem=list(TIPOS_DE_ORDEM_DO_VENUE),
    )

    # NAO SE PUBLICA UM MANIFESTO QUE O CONTRATO RECUSA — a mesma regra da costura.
    linha = _linha_do_envelope("manifesto", manifesto)
    veredicto = validar(linha)
    if veredicto.get("veredicto") != "aceite":
        return recusa(
            "manifesto_recusado_pelo_contrato",
            f"o manifesto montado nao passa o contrato ({veredicto.get('motivo')}): nao se publica",
        )
    return manifesto


def _linha_do_envelope(tipo: str, carga: dict[str, Any]) -> str:
    import json

    return json.dumps(
        {"contrato": versao_vigente(), "tipo": tipo, "id": f"{tipo}-{int(time.time() * 1000)}", "carga": carga},
        ensure_ascii=False,
    )


def _medir_profundidade(transporte: Tr.Transporte, account_id: int, ident: int, prazo_s: float) -> int | Recusa:
    """Subscreve a profundidade e CONTA os niveis que o venue manda no primeiro retrato.

    Sem retrato dentro do prazo, RECUSA: um numero de niveis inventado seria declarar uma capacidade que nao se
    mediu.
    """
    from ctrader_api_client import DepthEvent

    chegadas: queue.Queue[Any] = queue.Queue()

    async def guardar(evento: Any) -> None:
        chegadas.put(evento)

    if not Tr.registar_evento(transporte, DepthEvent, guardar, account_id=account_id):
        return recusa(
            "capacidade_nao_declarada",
            "nao consegui ligar o tratador da profundidade: sem ele nao se mede quantos niveis o venue da'",
        )
    subscricao = transporte.subscrever_profundidade(account_id, [ident])
    if not subscricao.ok:
        return recusa(str(subscricao.motivo), subscricao.porque)

    limite = time.monotonic() + prazo_s
    while True:
        restante = limite - time.monotonic()
        if restante <= 0:
            return recusa(
                "capacidade_nao_declarada",
                f"o venue nao mandou nenhum retrato da profundidade em {prazo_s}s: a profundidade do livro "
                "fica por declarar, e nao se inventa um numero de niveis",
            )
        try:
            evento = chegadas.get(timeout=restante)
        except queue.Empty:
            continue
        lados = getattr(evento, "new_quotes", None)
        if not lados:
            # Um retrato sem cotacoes novas nao diz quantos niveis o livro tem: espera-se pelo proximo, em vez de
            # se contar o que nao veio. (Aqui havia um `... or []`, que transformava «nao veio» em «zero niveis».)
            continue
        return len(lados)
