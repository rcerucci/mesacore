"""A PROVA DO RITMO do conector cTrader — offline, com relogio INJECTADO, SEM tocar no venue.

O QUE ESTA BANCADA MEDE. O limitador de ritmo do `transporte.py` (FR-071 / RN-CT2): o venue impoe **50
pedidos/s** nos pedidos gerais e **5/s** nos pedidos HISTORICOS (as velas). A prova corre o caminho REAL — os
verbos do `Transporte` (`contas`, `velas`) — contra um grafo DUPLO que regista o INSTANTE (do relogio injectado)
de cada pedido. Nao ha' rede, nao ha' venue, nao ha' chave: o relogio e' falso e o `dormir` avanca-o, por isso a
prova termina em milissegundos reais.

O QUE A BANCADA ASSEGURA, e nao promete. (1) Nenhuma janela de 1 s do relogio injectado cai ACIMA do tecto da
classe. (2) O intervalo minimo entre dois pedidos consecutivos e' o espacamento declarado (`1/50` = 0,02 s;
`1/5` = 0,2 s). (3) A ESPERA e' ESTADO DECLARADO: le-se' em `Transporte.estado_de_ritmo()` (`esperas`,
`ultima_espera_s`), e nao se adivinha. (4) A espera NAO vira «sem dados»: o pedido que esperou chega ao venue e
e' SERVIDO — e o unico caminho que devolve vazio e' a RECUSA NOMEADA (`falha_ao_ler_as_velas`). (5) As DUAS
classes sao INDEPENDENTES: encher a geral nao atrasa a historica.

A PROVA NEGATIVA (a regra da casa: uma bancada que nunca reprovou nao mediu nada). Injecta-se o DEFEITO — o
limitador deixa de espacar (o comportamento antigo: fala no relogio da volta) — e a MESMA medicao tem de ficar
VERMELHA a NOMEAR o caso, com o SURTO (a contagem que caiba em 1 s e o intervalo minimo). Sem esse vermelho, a
bancada nao mede o ritmo — mede o duplo.

O QUE ESTA BANCADA **NAO** MEDE, e di-lo: o limite de 50/s e 5/s e' o que a DOC/spec declara (RN-CT2, [F]) —
NAO foi medido contra o venue. Nao se martela o venue para descobrir o limite: seria a mesma rajada que esta
casa ja' pagou (253x `429` no outro venue).

Corre-se com:  cd brokers/ctrader && .venv/bin/python casos/prova-ritmo.py     (rc=1 se algo divergir)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

AQUI = Path(__file__).resolve().parent
CONECTOR = AQUI.parent
RAIZ = CONECTOR.parent.parent
sys.path.insert(0, str(RAIZ / "contracts" / "esqueleto"))
sys.path.insert(0, str(CONECTOR))

import transporte as Tr  # noqa: E402  (o caminho do conector tem de ser posto primeiro)

#: Os tectos declarados (RN-CT2): 50/s gerais, 5/s historicos. O espacamento e' o reciproco — e' ele que a prova
#: mede como INTERVALO MINIMO entre dois pedidos consecutivos.
GERAL_POR_SEGUNDO = 50
HISTORICO_POR_SEGUNDO = 5
INTERVALO_GERAL = 1.0 / GERAL_POR_SEGUNDO  # 0,02 s
INTERVALO_HISTORICO = 1.0 / HISTORICO_POR_SEGUNDO  # 0,2 s
TOLERANCIA = 1e-9  # o relogio e' aritmetica de virgula flutuante; a tolerancia absorve o ruido, nao o defeito


# =============================================================================================================
# O RELOGIO INJECTADO. `agora` diz a hora; `dormir` AVANCA a hora (em vez de dormir a serio) — por isso a prova
# mede segundos de relogio injectado em milissegundos reais. O relogio de PRODUCAO e' o real (`time.monotonic`).
# =============================================================================================================


class RelogioFalso:
    def __init__(self) -> None:
        self.t = 0.0
        self.dormidas: list[float] = []

    def agora(self) -> float:
        return self.t

    def dormir(self, segundos: float) -> None:
        self.dormidas.append(segundos)
        self.t += segundos


# =============================================================================================================
# O GRAFO DUPLO. Serve as duas leituras que a prova usa (`contas` e `velas`) e REGISTA o instante (do relogio
# injectado) de cada pedido que chega — e' a serie de instantes que a bancada mede. Nada aqui fala com o venue.
# =============================================================================================================

_CONTA_BANCADA = SimpleNamespace(
    account_id=45292558,
    is_live=False,
    trader_login=5150941,
    broker_name="Pepperstone",
    last_closing_deal_timestamp=1,
    last_balance_update_timestamp=2,
)
_VELA_BANCADA = SimpleNamespace(timestamp=1790628000000, period="H1", open=1.0, high=1.1, low=0.9, close=1.05, volume=10)


class GrafoDeRitmo:
    """O `grafo` do transporte, duplicado: regista o instante de cada pedido e devolve um valor canned."""

    def __init__(self, relogio: RelogioFalso, velas_erro: Exception | None = None) -> None:
        self.relogio = relogio
        self.instantes: list[float] = []
        self._velas_erro = velas_erro
        self.accounts = SimpleNamespace(list_by_token=self._listar_contas)
        self.market_data = SimpleNamespace(get_trendbars=self._trendbars)

    async def _listar_contas(self, token: str) -> list[Any]:
        self.instantes.append(self.relogio.agora())
        return [_CONTA_BANCADA]

    async def _trendbars(self, *args: Any, **kwargs: Any) -> list[Any]:
        self.instantes.append(self.relogio.agora())
        if self._velas_erro is not None:  # o venue falha: a bancada mede o motivo NOMEADO, nunca um vazio
            raise self._velas_erro
        return [_VELA_BANCADA]


class TransporteDeRitmo(Tr.Transporte):
    """O transporte REAL (o limitador e' o dele), com o grafo duplicado e o relogio injectado."""

    def __init__(self, relogio: RelogioFalso, grafo: GrafoDeRitmo) -> None:
        super().__init__(
            url_da_api="demo.ctraderapi.com:5035",
            client_id="bancada",
            client_secret="bancada",
            agora=relogio.agora,
            dormir=relogio.dormir,
        )
        self._grafo = grafo  # sem `abrir()`: o grafo entra aqui, e nunca houve ligacao


# =============================================================================================================
# AS MEDIDAS sobre a serie de instantes. Sao a REGRA de aceitacao, e a mesma funcao serve a prova positiva e a
# negativa — se o defeito nao a puser VERMELHA, e' a bancada que nao mede.
# =============================================================================================================


def _intervalo_minimo(instantes: list[float]) -> float | None:
    if len(instantes) < 2:
        return None
    return min(b - a for a, b in zip(instantes, instantes[1:]))


def _rajada_maxima_em_1s(instantes: list[float]) -> int:
    """O maior numero de pedidos em QUALQUER janela de 1 s.

    A janela e' fechada a' esquerda com uma tolerancia de 1 microssegundo: com espacamento minimo `1/tecto`, a
    aritmetica de virgula flutuante faz o `tecto+1`-esimo pedido cair a `0,99999999…` (por pouco dentro da
    janela). A tolerancia absorve ESSE ruido — nao um surto a serio, que aparece com intervalos de 0.
    """
    return max((sum(1 for u in instantes if t <= u < t + 1.0 - 1e-6) for t in instantes), default=0)


def _no_primeiro_segundo(instantes: list[float]) -> int:
    """Quantos pedidos caíram em [0, 1) do relogio injectado."""
    return sum(1 for t in instantes if 0.0 <= t < 1.0)


def _avaliar(instantes: list[float], estado: dict[str, Any], classe: str, tecto: int, intervalo: float, quantos: int) -> list[str]:
    """A REGRA de uma classe: intervalo minimo, rajada, e o ESTADO DECLARADO da espera.

    Le' o bloco da classe por INDICE (`estado[classe]`): `estado_de_ritmo()` declara sempre as duas classes com
    todas as chaves, e um `get(..., {})` seria um valor por omissao literal — o que a catraca de fallbacks da casa
    proibe (bancada incluida).
    """
    problemas: list[str] = []
    bloco = estado[classe]
    if bloco["maximo_por_segundo"] != tecto:
        problemas.append(f"estado.{classe}.maximo_por_segundo={bloco['maximo_por_segundo']!r}, esperado {tecto}")
    medido = _intervalo_minimo(instantes)
    if len(instantes) != quantos:
        problemas.append(f"pedidos registados={len(instantes)}, esperado {quantos}")
    if medido is None or medido < intervalo - TOLERANCIA:
        problemas.append(
            f"{classe}: intervalo minimo={medido!r} s, tem de ser >= {intervalo} s ({tecto}/s) — houve um SURTO"
        )
    rajada = _rajada_maxima_em_1s(instantes)
    if rajada > tecto:
        problemas.append(f"{classe}: rajada maxima numa janela de 1 s={rajada}, o tecto e' {tecto}/s")
    # O ESTADO DECLARADO: a espera tem de estar LEGIVEL (nao um sleep invisivel).
    if bloco["esperas"] <= 0:
        problemas.append(f"{classe}: nenhuma espera declarada — com {quantos} pedidos a seguir um ao outro, o ritmo tinha de ter esperado")
    if bloco["ultima_espera_s"] <= 0:
        problemas.append(f"{classe}: `ultima_espera_s` veio {bloco['ultima_espera_s']!r} — a espera nao esta' declarada")
    return problemas


# =============================================================================================================
# AS PROVAS.
# =============================================================================================================


def caso_geral_50_por_segundo() -> list[str]:
    """120 pedidos GERAIS (contas): o intervalo minimo e' 0,02 s e cabem 50 em 1 s de relogio injectado."""
    relogio = RelogioFalso()
    grafo = GrafoDeRitmo(relogio)
    transporte = TransporteDeRitmo(relogio, grafo)
    try:
        for _ in range(120):
            transporte.contas("token-da-bancada")
        estado = transporte.estado_de_ritmo()
    finally:
        transporte.fechar()
    problemas = _avaliar(grafo.instantes, estado, "geral", GERAL_POR_SEGUNDO, INTERVALO_GERAL, 120)
    caberam = _no_primeiro_segundo(grafo.instantes)
    if caberam != GERAL_POR_SEGUNDO:
        problemas.append(f"couberam {caberam} pedidos gerais em 1 s de relogio injectado, esperado {GERAL_POR_SEGUNDO}")
    print(
        json.dumps(
            {
                "caso": "ritmo/geral-50-por-segundo",
                "veredicto": "ok" if not problemas else "DIVERGE",
                "classe": "geral",
                "tecto_por_segundo": GERAL_POR_SEGUNDO,
                "pedidos": len(grafo.instantes),
                "couberam_em_1s": caberam,
                "intervalo_minimo_s": _intervalo_minimo(grafo.instantes),
                "rajada_maxima_em_1s": _rajada_maxima_em_1s(grafo.instantes),
                "esperas_declaradas": estado["geral"]["esperas"],
                "problemas": problemas,
            },
            ensure_ascii=False,
        )
    )
    return problemas


def caso_historico_5_por_segundo() -> list[str]:
    """10 pedidos HISTORICOS (velas): o intervalo minimo e' 0,2 s e cabem 5 em 1 s de relogio injectado."""
    relogio = RelogioFalso()
    grafo = GrafoDeRitmo(relogio)
    transporte = TransporteDeRitmo(relogio, grafo)
    try:
        for _ in range(10):
            transporte.velas(45292558, 42, "H1", 0, 1)
        estado = transporte.estado_de_ritmo()
    finally:
        transporte.fechar()
    problemas = _avaliar(grafo.instantes, estado, "historico", HISTORICO_POR_SEGUNDO, INTERVALO_HISTORICO, 10)
    caberam = _no_primeiro_segundo(grafo.instantes)
    if caberam != HISTORICO_POR_SEGUNDO:
        problemas.append(
            f"couberam {caberam} pedidos historicos em 1 s de relogio injectado, esperado {HISTORICO_POR_SEGUNDO}"
        )
    print(
        json.dumps(
            {
                "caso": "ritmo/historico-5-por-segundo",
                "veredicto": "ok" if not problemas else "DIVERGE",
                "classe": "historico",
                "tecto_por_segundo": HISTORICO_POR_SEGUNDO,
                "pedidos": len(grafo.instantes),
                "couberam_em_1s": caberam,
                "intervalo_minimo_s": _intervalo_minimo(grafo.instantes),
                "rajada_maxima_em_1s": _rajada_maxima_em_1s(grafo.instantes),
                "esperas_declaradas": estado["historico"]["esperas"],
                "problemas": problemas,
            },
            ensure_ascii=False,
        )
    )
    return problemas


def caso_classes_independentes() -> list[str]:
    """Encher a classe GERAL nao pode atrasar a HISTORICA: sao tectos SEPARADOS (RN-CT2)."""
    relogio = RelogioFalso()
    grafo = GrafoDeRitmo(relogio)
    transporte = TransporteDeRitmo(relogio, grafo)
    try:
        for _ in range(60):
            transporte.contas("token-da-bancada")
        relogio_antes_das_velas = relogio.agora()
        transporte.velas(45292558, 42, "H1", 0, 1)
        estado = transporte.estado_de_ritmo()
    finally:
        transporte.fechar()
    problemas: list[str] = []
    if estado["historico"]["esperas"] != 0:
        problemas.append(f"a 1.a vela esperou {estado['historico']['esperas']} vez(es): as classes nao sao independentes")
    if grafo.instantes[-1] != relogio_antes_das_velas:
        problemas.append(
            f"a vela nao saiu no instante do pedido ({grafo.instantes[-1]!r} != {relogio_antes_das_velas!r}): "
            "o ritmo geral atrasou a classe historica"
        )
    print(
        json.dumps(
            {
                "caso": "ritmo/classes-independentes",
                "veredicto": "ok" if not problemas else "DIVERGE",
                "esperas_historicas_apos_60_gerais": estado["historico"]["esperas"],
                "problemas": problemas,
            },
            ensure_ascii=False,
        )
    )
    return problemas


def caso_espera_nao_vira_sem_dados() -> list[str]:
    """O pedido que ESPEROU e' SERVIDO; e o unico vazio e' a RECUSA NOMEADA (nunca um «sem dados» silencioso)."""
    # (1) O pedido historico que esperou chega e e' servido.
    relogio = RelogioFalso()
    grafo = GrafoDeRitmo(relogio)
    transporte = TransporteDeRitmo(relogio, grafo)
    try:
        ultimo = None
        for _ in range(6):  # o 6.o tem de esperar 0,2 s de relogio injectado
            ultimo = transporte.velas(45292558, 42, "H1", 0, 1)
        estado = transporte.estado_de_ritmo()
    finally:
        transporte.fechar()
    problemas: list[str] = []
    if ultimo is None or not ultimo.ok:
        problemas.append(f"o pedido que esperou NAO foi servido: {ultimo!r}")
    elif not ultimo.valor:
        problemas.append(f"o pedido que esperou veio VAZIO (o «sem dados» silencioso que o FR-071 proibe): {ultimo.valor!r}")
    elif ultimo.valor[0].get("fecho") != 1.05:
        problemas.append(f"o pedido que esperou veio com o fecho {ultimo.valor[0].get('fecho')!r}, esperado 1.05 (o do venue)")
    if estado["historico"]["esperas"] < 1 or estado["historico"]["ultima_espera_s"] <= 0:
        problemas.append(
            f"a espera nao esta' declarada: {json.dumps(estado['historico'], ensure_ascii=False)}"
        )
    # (2) O unico caminho para «sem dados» e' a recusa NOMEADA — e o motivo di-lo.
    relogio2 = RelogioFalso()
    grafo2 = GrafoDeRitmo(relogio2, velas_erro=RuntimeError("o venue nao respondeu (duplo)"))
    transporte2 = TransporteDeRitmo(relogio2, grafo2)
    try:
        falha = transporte2.velas(45292558, 42, "H1", 0, 1)
    finally:
        transporte2.fechar()
    if falha.ok or falha.valor:
        problemas.append(f"a leitura falhada devolveu um valor em vez de recusar: {falha!r}")
    if falha.motivo != "falha_ao_ler_as_velas":
        problemas.append(f"a recusa veio com o motivo {falha.motivo!r}, esperado 'falha_ao_ler_as_velas' (nomeado)")
    print(
        json.dumps(
            {
                "caso": "ritmo/espera-nao-vira-sem-dados",
                "veredicto": "ok" if not problemas else "DIVERGE",
                "pedido_que_esperou_servido": bool(ultimo and ultimo.ok and ultimo.valor),
                "ultima_espera_declarada_s": estado["historico"]["ultima_espera_s"],
                "recusa_nomeada": falha.motivo,
                "problemas": problemas,
            },
            ensure_ascii=False,
        )
    )
    return problemas


def caso_relogio_de_producao_e_o_real() -> list[str]:
    """Em PRODUCAO o relogio e' o real (`time.monotonic`/`time.sleep`) — so' a prova o injecta."""
    transporte = Tr.Transporte(url_da_api="demo.ctraderapi.com:5035", client_id="x", client_secret="x")
    try:
        estado = transporte.estado_de_ritmo()
    finally:
        transporte.fechar()
    problemas: list[str] = []
    if estado.get("relogio") != "real":
        problemas.append(f"o transporte de producao declara o relogio {estado.get('relogio')!r}, esperado 'real'")
    if estado["geral"]["maximo_por_segundo"] != GERAL_POR_SEGUNDO:
        problemas.append(f"a classe geral de producao e' {estado['geral']['maximo_por_segundo']}, esperado {GERAL_POR_SEGUNDO}")
    if estado["historico"]["maximo_por_segundo"] != HISTORICO_POR_SEGUNDO:
        problemas.append(
            f"a classe historica de producao e' {estado['historico']['maximo_por_segundo']}, esperado {HISTORICO_POR_SEGUNDO}"
        )
    print(
        json.dumps(
            {
                "caso": "ritmo/relogio-de-producao-e-o-real",
                "veredicto": "ok" if not problemas else "DIVERGE",
                "relogio": estado.get("relogio"),
                "problemas": problemas,
            },
            ensure_ascii=False,
        )
    )
    return problemas


def caso_negativa_sem_limitador_surto() -> list[str]:
    """O DEFEITO INJECTADO: sem o espacamento, a MESMA medicao fica VERMELHA a NOMEAR o SURTO.

    Repoe-se o comportamento ANTIGO (`LimitadorDeRitmo.esperar` deixa de espacar — fala no relogio da volta) e
    exige-se que a regra de aceitacao da classe geral (`_avaliar`) a reprove. Sem esse vermelho, a bancada nao
    mede o ritmo.
    """
    original = Tr.LimitadorDeRitmo.esperar

    def _sem_ritmo(self: Tr.LimitadorDeRitmo) -> float:
        # O comportamento antigo: reserva um lugar mas NAO espaca — todos os pedidos caem no mesmo instante.
        self.pedidos += 1
        self.ultimo_pedido_s = self._agora()
        return self._agora()

    Tr.LimitadorDeRitmo.esperar = _sem_ritmo  # type: ignore[assignment]
    try:
        relogio = RelogioFalso()
        grafo = GrafoDeRitmo(relogio)
        transporte = TransporteDeRitmo(relogio, grafo)
        try:
            for _ in range(120):
                transporte.contas("token-da-bancada")
            estado = transporte.estado_de_ritmo()
        finally:
            transporte.fechar()
        problemas_do_caso = _avaliar(grafo.instantes, estado, "geral", GERAL_POR_SEGUNDO, INTERVALO_GERAL, 120)
        caberam = _no_primeiro_segundo(grafo.instantes)
        intervalo = _intervalo_minimo(grafo.instantes)
    finally:
        Tr.LimitadorDeRitmo.esperar = original  # type: ignore[assignment]

    # O SURTO MEDIDO (a contagem e o intervalo minimo) — impresso, e nao descrito.
    print(
        json.dumps(
            {
                "negativa": "sem-limitador-o-surto-dispara",
                "surto_em_1s": caberam,
                "intervalo_minimo_s": intervalo,
                "rajada_maxima_em_1s": _rajada_maxima_em_1s(grafo.instantes),
                "o_caso_geral_ficou": "VERMELHO" if problemas_do_caso else "VERDE",
                "primeiro_problema": problemas_do_caso[0] if problemas_do_caso else None,
            },
            ensure_ascii=False,
        )
    )
    problemas: list[str] = []
    if not problemas_do_caso:
        problemas.append(
            "sem o limitador, a regra de aceitacao da classe geral ficou VERDE — a bancada NAO mede o ritmo "
            f"(surto em 1 s={caberam}, intervalo minimo={intervalo!r} s)"
        )
    return problemas


CASOS: list[tuple[str, Any]] = [
    ("ritmo/geral-50-por-segundo", caso_geral_50_por_segundo),
    ("ritmo/historico-5-por-segundo", caso_historico_5_por_segundo),
    ("ritmo/classes-independentes", caso_classes_independentes),
    ("ritmo/espera-nao-vira-sem-dados", caso_espera_nao_vira_sem_dados),
    ("ritmo/relogio-de-producao-e-o-real", caso_relogio_de_producao_e_o_real),
    ("negativa/sem-limitador-o-surto-dispara", caso_negativa_sem_limitador_surto),
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

    # A ULTIMA LINHA DO `stdout` E' O RESUMO: o portao da casa imprime o `tail -1` do `2>&1`, e e' este numero
    # que tem de aparecer. (Antes o resumo ia para `stderr` e a ultima linha era um `json` de caso.)
    print(f"ctrader/prova-ritmo: {len(CASOS)} provas · {len(CASOS) - divergentes} ok · {divergentes} divergentes")
    return 1 if divergentes > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
