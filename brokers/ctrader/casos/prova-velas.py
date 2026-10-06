"""A BANCADA DA CONVERSAO DAS VELAS do cTrader — OFFLINE, sem rede, sem chave e sem venue.

O QUE ELA MEDE. A parte PURA do modo de velas (`brokers/ctrader/velas.py`): o MAPA do relogio da sigma para o
periodo do venue, e a CONVERSAO de uma vela do venue (a que o `transporte.velas` devolve: `instante_ms` como
`datetime`, `abertura/maximo/minimo/fecho` como `Decimal`, `volume_em_ticks` como `int`) para a linha que o
setup `sigma` consome (`setups/sigma/sinal.ts`, interface `Vela`: `t` inteiro de ms, `o`/`h`/`l`/`c` em TEXTO).

A FORMA E' MEDIDA CONTRA O FICHEIRO DO IRMAO, e nao contra prosa. A ordem das chaves da linha e' comparada com
as chaves REAIS de uma linha do ficheiro do hyperliquid (`tools/verificar-setup/barras/velas-BTC-1h.jsonl`,
versionado) — os campos comuns tem de aparecer na mesma ordem.

A PROVA NEGATIVA (a regra da casa: uma bancada que nunca reprovou nao mediu nada). TRES defeitos injectados no
modulo REAL, e cada um tem de pôr VERMELHO o caso que ele estraga, nomeando-o:
  1. o numero em FLOAT (`_texto` a devolver `float`) — quebra a regra D4 (o numero viaja em TEXTO) na FORMA;
  2. o preco de ENFEITE (`_texto` a devolver `"0"` para um campo ausente) — a vela sem fecho tem de RECUSAR;
  3. o MAPA ARREDONDADO (`2h` -> `H1`) — o relogio que o venue nao serve tem de ser recusado por NOME.
Sem estes vermelhos a bancada media o duplo, nao a conversao.

O QUE ESTA BANCADA **NAO** MEDE, e di-lo: a LEITURA A SERIO contra o venue (o `transporte.velas` e a autenticacao)
— isso e' prova de execucao ao vivo, e nao se finge aqui. O que aqui se prova e' a CONVERSAO e o MAPA.

Corre-se com:  cd brokers/ctrader && .venv/bin/python casos/prova-velas.py    (rc=1 se algo divergir)
"""

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

AQUI = Path(__file__).resolve().parent
CONECTOR = AQUI.parent
RAIZ = CONECTOR.parent.parent


def _importar(nome: str, caminho: Path) -> Any:
    """Importa o modulo REAL por caminho absoluto (nunca uma copia)."""
    spec = importlib.util.spec_from_file_location(nome, caminho)
    modulo = importlib.util.module_from_spec(spec)
    sys.modules[nome] = modulo
    spec.loader.exec_module(modulo)
    return modulo


Ve = _importar("velas_real", CONECTOR / "velas.py")

#: As chaves REAIS de uma linha do ficheiro do IRMAO (o hyperliquid), lidas do ficheiro versionado — a forma
#: contra a qual a ordem da linha nova se mede.
_IRMAO = RAIZ / "tools" / "verificar-setup" / "barras" / "velas-BTC-1h.jsonl"
CHAVES_DO_IRMAO = list(json.loads(_IRMAO.read_text(encoding="utf-8").split("\n")[0]).keys())

#: UMA vela como o `transporte.velas` a devolve (a fonte: `transporte._vela`).
VELA = {
    "instante_ms": datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc),
    "periodo": "M1",
    "abertura": Decimal("1.12345"),
    "maximo": Decimal("1.12400"),
    "minimo": Decimal("1.12300"),
    "fecho": Decimal("1.12380"),
    "volume_em_ticks": 1234,
}


def _e_subsequencia(chaves: list[str], referencia: list[str]) -> bool:
    """Os elementos de `chaves` aparecem em `referencia`, pela mesma ordem (nao contiguos)? """
    i = 0
    for chave in chaves:
        while i < len(referencia) and referencia[i] != chave:
            i += 1
        if i == len(referencia):
            return False
        i += 1
    return True


def problemas_da_linha(linha: Any) -> list[str]:
    """A FORMA da linha, medida contra o que a sigma le' e contra a ordem do irmao. Vazio = conforme."""
    if not isinstance(linha, dict):
        return [f"a linha nao e' um objecto ({linha!r})"]
    problemas: list[str] = []
    chaves = list(linha.keys())
    if tuple(chaves) != Ve.CHAVES_DA_LINHA:
        problemas.append(f"chaves {chaves} != {list(Ve.CHAVES_DA_LINHA)} (a forma que a sigma le')")
    if not _e_subsequencia(chaves, CHAVES_DO_IRMAO):
        problemas.append(f"a ordem {chaves} nao e' a do irmao ({CHAVES_DO_IRMAO})")
    t = linha.get("t")
    if not isinstance(t, int) or isinstance(t, bool):
        problemas.append(f"`t` nao e' um inteiro de ms ({t!r})")
    for chave in ("o", "c", "h", "l"):
        valor = linha.get(chave)
        if not isinstance(valor, str):
            problemas.append(f"`{chave}` nao e' TEXTO (D4) — veio {type(valor).__name__}={valor!r}")
    return problemas


def caso_forma() -> list[str]:
    """A linha da conversao REAL tem a forma da sigma e a ordem do irmao."""
    return problemas_da_linha(Ve.vela_para_a_sigma(VELA))


def caso_mapa() -> list[str]:
    """O mapa relogio->periodo cobre os SETE relogios da sigma que o venue serve."""
    esperado = {"1m": "M1", "5m": "M5", "15m": "M15", "30m": "M30", "1h": "H1", "4h": "H4", "1d": "D1"}
    problemas = []
    for relogio, periodo in esperado.items():
        veio = Ve.periodo_do_relogio(relogio)
        if veio != periodo:
            problemas.append(f"{relogio} -> {veio!r} (esperado {periodo})")
    return problemas


def caso_2h_recusa() -> list[str]:
    """O oitavo relogio da sigma (`2h`) NAO tem periodo no venue: recusado, nao arredondado para o vizinho."""
    if Ve.periodo_do_relogio("2h") is not None:
        return [f"`2h` virou {Ve.periodo_do_relogio('2h')!r}: o venue nao tem H2, e arredondar media outras barras"]
    return []


def caso_precisao_textual() -> list[str]:
    """O TEXTO nao perde casas (o caminho por float binario perderia)."""
    vela = dict(VELA, abertura=Decimal("1.123455"))
    linha = Ve.vela_para_a_sigma(vela)
    if isinstance(linha, Ve.Recusa):
        return [linha.porque]
    if linha["o"] != "1.123455":
        return [f"o texto do `o` perdeu casas: {linha['o']!r} (esperado '1.123455')"]
    return []


def caso_recusa_fechado() -> list[str]:
    """Uma vela sem um preco RECUSA por nome — nunca um valor de enfeite."""
    vela = {
        "instante_ms": datetime(2026, 10, 6, tzinfo=timezone.utc),
        "abertura": Decimal("1.1"),
        "maximo": Decimal("1.2"),
        "minimo": Decimal("1.0"),
    }
    r = Ve.vela_para_a_sigma(vela)
    problemas: list[str] = []
    if not isinstance(r, Ve.Recusa):
        return [f"nao recusou (veio {r!r}): um preco de enfeite seria um preco que o venue nao publicou"]
    if r.motivo != "campo_obrigatorio_ausente":
        problemas.append(f"motivo {r.motivo!r} (esperado `campo_obrigatorio_ausente`)")
    if "fecho" not in r.porque or "`c`" not in r.porque:
        problemas.append(f"o porque nao nomeia o campo do venue (`fecho`) e o da sigma (`c`): {r.porque}")
    return problemas


def caso_append_sem_duplicar() -> list[str]:
    """O `--actualizar` acrescenta sem duplicar: so' as velas com `t` depois da ultima ja' escrita."""
    ja = [{"t": 1000, "o": "1", "c": "1", "h": "1", "l": "1"}, {"t": 2000, "o": "1", "c": "1", "h": "1", "l": "1"}]
    novas = [{"t": 1500, "o": "1", "c": "1", "h": "1", "l": "1"}, {"t": 2000, "o": "1", "c": "1", "h": "1", "l": "1"}, {"t": 3000, "o": "1", "c": "1", "h": "1", "l": "1"}]
    veio = [v["t"] for v in Ve.novas_por_tempo(ja, novas)]
    if veio != [3000]:
        return [f"as velas novas sairam {veio} (esperado [3000]: a 2000 ja' esta', a 1500 e' anterior)"]
    if [v["t"] for v in Ve.novas_por_tempo([], novas)] != [1500, 2000, 3000]:
        return ["com o ficheiro vazio, todas tem de entrar"]
    return []


def caso_nome_do_ficheiro() -> list[str]:
    """O ficheiro chama-se como a sigma o procura: `velas-<INSTRUMENTO>-<RELOGIO>.jsonl` (o RELOGIO da sigma)."""
    nome = Ve.nome_do_ficheiro("EURUSD", "1m")
    if nome != "velas-EURUSD-1m.jsonl":
        return [f"nome {nome!r} != 'velas-EURUSD-1m.jsonl' (a sigma procura `1m`, nao `M1`)"]
    return []


CASOS: list[tuple[str, Callable[[], list[str]]]] = [
    ("forma (a que a sigma le')", caso_forma),
    ("mapa relogio -> periodo", caso_mapa),
    ("2h sem periodo no venue (recusa)", caso_2h_recusa),
    ("precisao textual (sem float)", caso_precisao_textual),
    ("vela sem preco RECUSA por nome", caso_recusa_fechado),
    ("actualizar sem duplicar", caso_append_sem_duplicar),
    ("nome do ficheiro da sigma", caso_nome_do_ficheiro),
]
CASOS_POR_NOME = dict(CASOS)


# -----------------------------------------------------------------------------------------------------------
# AS NEGATIVAS: injecta-se o defeito no modulo REAL e exige-se o MESMO caso VERMELHO, a NOMEAR o defeito.

def _defeito_float() -> Callable[[], None]:
    original = Ve._texto

    def texto_em_float(valor: Any) -> Any:  # noqa: ANN401
        return float(valor) if isinstance(valor, Decimal) else None

    Ve._texto = texto_em_float  # type: ignore[assignment]
    return lambda: setattr(Ve, "_texto", original)


def _defeito_zero() -> Callable[[], None]:
    original = Ve._texto

    def texto_com_zero(valor: Any) -> Any:  # noqa: ANN401
        if valor is None:
            return "0"  # o preco de enfeite: um campo ausente vira zero
        return format(valor, "f") if isinstance(valor, Decimal) else None

    Ve._texto = texto_com_zero  # type: ignore[assignment]
    return lambda: setattr(Ve, "_texto", original)


def _defeito_mapa_arredondado() -> Callable[[], None]:
    original = dict(Ve.RELOCIOS_DO_VENUE)
    Ve.RELOCIOS_DO_VENUE["2h"] = "H1"  # arredondar o 2h para o vizinho
    return lambda: setattr(Ve, "RELOCIOS_DO_VENUE", original)


NEGATIVAS: list[tuple[str, Callable[[], Callable[[], None]], str]] = [
    ("D4 quebrado: o numero em float", _defeito_float, "forma (a que a sigma le')"),
    ("preco de enfeite: o fecho ausente vira '0'", _defeito_zero, "vela sem preco RECUSA por nome"),
    ("mapa arredondado: o `2h` vira H1", _defeito_mapa_arredondado, "2h sem periodo no venue (recusa)"),
]


def main() -> int:
    print(f"# chaves do irmao (velas-BTC-1h.jsonl): {CHAVES_DO_IRMAO}")
    falhas = 0
    corridas = 0
    for nome, funcao in CASOS:
        corridas += 1
        problemas = funcao()
        if problemas:
            falhas += 1
            print(json.dumps({"caso": nome, "veredicto": "DIVERGE", "problemas": problemas}, ensure_ascii=False))
        else:
            print(json.dumps({"caso": nome, "veredicto": "ok"}, ensure_ascii=False))

    print(f"# negativas: {len(NEGATIVAS)} defeitos injectados no modulo REAL")
    for nome, injectar, alvo in NEGATIVAS:
        restaurar = injectar()
        try:
            problemas = CASOS_POR_NOME[alvo]()
        finally:
            restaurar()
        if not problemas:
            falhas += 1
            print(json.dumps({"negativa": nome, "veredicto": "NAO FICOU VERMELHA", "caso_alvo": alvo, "porque": "o defeito nao pôs o caso a divergir: a bancada mediu o duplo, nao a conversao"}, ensure_ascii=False))
        else:
            print(json.dumps({"negativa": nome, "veredicto": "vermelha (como devia)", "caso_alvo": alvo, "problema": problemas[0]}, ensure_ascii=False))

    print(json.dumps({"resumo": {"casos": corridas, "falhas": falhas}}, ensure_ascii=False))
    if falhas:
        print(f"prova-velas: {falhas} de {corridas} casos DIVERGIRAM (+ negativas)", file=sys.stderr)
        return 1
    print(f"prova-velas: {corridas} de {corridas} casos conformes, {len(NEGATIVAS)} negativas vermelhas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
