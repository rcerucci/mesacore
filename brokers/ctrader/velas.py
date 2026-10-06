"""A CONVERSAO DAS VELAS do cTrader para a forma que o setup `sigma` consome — a parte PURA.

PORQUE EXISTE, E O QUE FALTAVA (medido 06/10/2026). O setup `sigma` (`setups/sigma/sinal.ts`) le^ as barras do
par de um ficheiro `velas-<INSTRUMENTO>-<RELOGIO>.jsonl` — o ficheiro JSONL que o operador puxa. Hoje so' o
conector do HYPERLIQUID o escreve (`brokers/hyperliquid/mercado.ts`, modo `--velas`). O conector do cTrader
sabia LER as velas do venue (`transporte.velas(...)`, usado em `processo.py` para achar a ultima vela fechada),
mas NAO tinha modo nenhum que as escrevesse na forma da sigma — e sem ficheiro a sigma nao decide. Este modulo
e' a conversao; o modo de linha de comando que o usa vive em `processo.py`.

O QUE O VENUE DA' (lido da biblioteca instalada, `ctrader_api_client==0.11.0`, nao de memoria:

`models/market_data.py`, classe `Trendbar`):
  * `timestamp` — datetime UTC da ABERTURA da barra (o `utc_timestamp_in_minutes * 60`);
  * `period`    — `TrendbarPeriod` (M1, M2, ..., H1, H4, H12, D1, W1, MN1);
  * `open`/`high`/`low`/`close` — `Decimal`, JA' divididos por 100000 (unidades reais do par);
  * `volume`    — `int`, a contagem de TICKS da barra.
A `transporte.velas(...)` desta ponta devolve, por vela, o dicionario que o `transporte._vela` monta:
`{instante_ms, periodo, abertura, maximo, minimo, fecho, volume_em_ticks}` — com os nomes do NOSSO interior.

O QUE A SIGMA LE' (`setups/sigma/sinal.ts`, interface `Vela`): `t` (abertura da barra, em ms, NUMERO) e
`o`,`h`,`l`,`c` (TEXTO); `v?` opcional. E so' isto: `calcular`, o `plugin.ts` e o `sobreposicao.ts` leem
`t`/`o`/`h`/`l`/`c` e mais nada — o `v` nunca e' lido por este setup.

O MAPA, NOME A NOME (o que se renomeia, e so' o que a sigma precisa):
  instante_ms -> t   ·   abertura -> o   ·   fecho -> c   ·   maximo -> h   ·   minimo -> l
A ORDEM DOS CAMPOS NA LINHA e' a do IRMAO (`t`,`o`,`c`,`h`,`l`), porque o ficheiro do hyperliquid publica
`...o,c,h,l,v,n` e e' bom que os dois ficheiros se leiam lado a lado, campo a campo. (A sigma le' por NOME: a
ordem nao a afecta.)

O QUE SE DEIXA DE FORA, E DITO POR NOME (nada se inventa para encher a forma):
  * `volume_em_ticks` — o venue publica o volume em TICKS (contagem de negocios). O `v` do irmao e' volume na
    UNIDADE-BASE do par: grandeza DIFERENTE. A sigma nao le^ `v` (e' opcional em `sinal.ts`), logo NAO se
    escreve um `v` com outro significado so' para a linha parecer a do irmao.
  * `T` (instante de FECHO), `n` (numero de negocios) — o cTrader NAO os publica na trendbar.
  * `s` (simbolo) e `i` (intervalo) — o irmao escreve-os; aqui o simbolo e o periodo sao o que o OPERADOR
    pediu no comando, nao um campo da vela. Ficam no DESCRITOR (ao lado do ficheiro), nao na linha.
  * o `relogio` `2h` do vocabulario da sigma NAO tem trendbar neste venue (nao ha H2): recusado por nome.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

#: O MAPA do relogio da ficha (o vocabulario do setup `sigma`) -> o periodo do VENUE.
#: FONTE: `ctrader_api_client.enums.TrendbarPeriod` (lido do `.venv`, nao de memoria): M1 M2 M3 M4 M5 M10 M15
#: M30 H1 H4 H12 D1 W1 MN1. A `sigma` conhece OITO relogios (`setups/sigma/plugin.ts`, `msDoRelogio`); o venue
#: cobre SETE. O oitavo (`2h`) nao tem periodo equivalente — e' recusado por NOME, nao arredondado para H1/H4.
RELOCIOS_DO_VENUE: dict[str, str] = {
    "1m": "M1",
    "5m": "M5",
    "15m": "M15",
    "30m": "M30",
    "1h": "H1",
    "4h": "H4",
    "1d": "D1",
}

#: Os relogios que a `sigma` conhece mas este venue NAO serve — ditos, para a recusa nomear o buraco.
RELOCIOS_DA_SIGMA_SEM_PERIODO_DO_VENUE = ("2h",)

#: As chaves da linha, NA ORDEM DO IRMAO (o ficheiro do hyperliquid: `...o,c,h,l...`).
CHAVES_DA_LINHA = ("t", "o", "c", "h", "l")


@dataclass(frozen=True)
class Recusa:
    """A recusa NOMEADA da parte pura: um motivo do vocabulario e a razao humana."""

    motivo: str
    porque: str


def periodo_do_relogio(relogio: str) -> str | None:
    """O periodo do VENUE para um relogio do setup, ou `None` quando o venue nao o serve.

    `None` (e nao uma omissao nem um arredondamento para o vizinho): o `2h` da sigma nunca viraria H1 nem H4
    — seria medir a media de barras que o dono nao pediu.
    """
    return RELOCIOS_DO_VENUE.get(relogio)


def nome_do_ficheiro(instrumento: str, relogio: str) -> str:
    """O nome do ficheiro que a sigma procura: `velas-<INSTRUMENTO>-<RELOGIO>.jsonl` (o relogio E' o da sigma)."""
    return f"velas-{instrumento}-{relogio}.jsonl"


def _texto(valor: Any) -> str | None:
    """Um numero do venue (Decimal/int) -> o TEXTO da casa (D4: o numero viaja em texto, sem virgula flutuante).

    Um `bool` e' um `int` em Python, e nao e' um preco: recusa-se. Um `None`/um tipo que nao se le^ devolve
    `None` — quem chama e' que decide a recusa, para nao inventar um valor.
    """
    if isinstance(valor, bool):
        return None
    if isinstance(valor, Decimal):
        return format(valor, "f")
    if isinstance(valor, int):
        return str(valor)
    return None


def _instante_em_ms(valor: Any) -> int | None:
    """O instante do venue em ms: a `transporte.velas` entrega-o como `datetime` (o nome `instante_ms` e' do
    interior, nao a unidade). Um inteiro passa tal e qual; outra coisa nao se le^."""
    if isinstance(valor, datetime):
        return int(valor.timestamp() * 1000)
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor
    return None


def vela_para_a_sigma(vela: Any) -> dict[str, Any] | Recusa:
    """UMA vela como o `transporte.velas` a devolve -> UMA linha da forma que a sigma consome.

    Falha FECHADO: uma vela sem o tempo ou sem um dos quatro precos RECUSA por NOME (com o campo do venue e o
    campo da sigma) em vez de escrever um preco de enfeite — uma barra com um zero inventado e' um sinal
    inventado, e a sigma decide sobre ela.
    """
    if not isinstance(vela, dict):
        return Recusa("formato_invalido", f"a vela do venue nao e' um objecto (veio {type(vela).__name__})")

    t = _instante_em_ms(vela.get("instante_ms"))
    if t is None:
        return Recusa(
            "campo_obrigatorio_ausente",
            f"a vela veio sem `instante_ms` legivel ({vela.get('instante_ms')!r}): sem o tempo da barra nao se "
            "sabe onde ela entra no ficheiro, e uma barra no lugar errado e' um sinal no lugar errado",
        )

    precos: dict[str, str] = {}
    for do_venue, do_setup in (("abertura", "o"), ("fecho", "c"), ("maximo", "h"), ("minimo", "l")):
        texto = _texto(vela.get(do_venue))
        if texto is None:
            return Recusa(
                "campo_obrigatorio_ausente",
                f"a vela de {t} veio sem `{do_venue}` legivel ({vela.get(do_venue)!r}): a sigma le'-o como "
                f"`{do_setup}`, e um valor de enfeite seria um preco que o venue nao publicou",
            )
        precos[do_setup] = texto

    # A ORDEM: a do irmao (t, o, c, h, l). A sigma le' por nome.
    return {"t": t, "o": precos["o"], "c": precos["c"], "h": precos["h"], "l": precos["l"]}


def velas_para_a_sigma(velas: Any) -> list[dict[str, Any]] | Recusa:
    """A lista do venue -> as linhas da sigma, na ordem em que vieram. A PRIMEIRA que nao se converter para tudo
    (uma vela ma' no meio corromperia a serie a partir dali) — a recusa nomeia-a pelo indice."""
    if not isinstance(velas, list):
        return Recusa("formato_invalido", f"as velas do venue nao vieram em lista (veio {type(velas).__name__})")
    linhas: list[dict[str, Any]] = []
    for i, vela in enumerate(velas):
        convertida = vela_para_a_sigma(vela)
        if isinstance(convertida, Recusa):
            return Recusa(convertida.motivo, f"[vela #{i}] {convertida.porque}")
        linhas.append(convertida)
    return linhas


def linhas_jsonl(velas_do_setup: list[dict[str, Any]]) -> str:
    """As linhas -> o TEXTO do ficheiro: um objecto JSON por linha, terminado por mudanca de linha (como o irmao
    o escreve), para uma vela nova ser APPENDAVEL e uma linha truncada ser detectavel a linha a linha."""
    import json

    return "".join(json.dumps(v, ensure_ascii=False) + "\n" for v in velas_do_setup)


def novas_por_tempo(ja: list[dict[str, Any]], novas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """As velas que comecam DEPOIS da ultima que ja' esta' no ficheiro — o append sem duplicar (a mesma regra do
    irmao: `--actualizar` nao reescreve o historico nem duplica a barra ja' escrita)."""
    ultima = ja[-1]["t"] if ja else None
    if ultima is None:
        return list(novas)
    return [v for v in novas if v["t"] > ultima]


def descritor(
    *,
    instrumento: str,
    relogio: str,
    periodo_do_venue: str,
    ambiente: str,
    url: str,
    desde_ms: int | None,
    ate_ms: int | None,
    quantas: int,
    ficheiro: str,
    escrito_em_ms: int,
) -> dict[str, Any]:
    """O DESCRITOR ao lado do ficheiro: diz o que esta' dentro sem ser preciso le'-lo, e DIZ o que nao esta'.

    `chaves_da_vela` sao as cinco chaves da linha (`t`,`o`,`c`,`h`,`l`); `campos_do_venue_ausentes` nomeia o que
    o irmao traz e este venue nao da' (`T`,`n`) e o que tem OUTRO significado (`v` = ticks, nao unidade-base).
    """
    return {
        "formato": "jsonl — um objecto por vela, campos do setup, numeros em TEXTO",
        "instrumento": instrumento,
        "relogio": relogio,
        "periodo_do_venue": periodo_do_venue,
        "ambiente": ambiente,
        "url": url,
        "desde_ms": desde_ms,
        "ate_ms": ate_ms,
        "quantas": quantas,
        "chaves_da_vela": list(CHAVES_DA_LINHA),
        "ficheiro": ficheiro,
        "escrito_em_ms": escrito_em_ms,
        "fonte_do_campo_do_tempo": "`t` e' a ABERTURA da trendbar, em ms (o `Trendbar.timestamp` do venue, UTC)",
        "campos_do_venue_ausentes": {
            "T": "o cTrader nao publica o instante de fecho na trendbar (o irmao publica-o)",
            "n": "o cTrader nao publica o numero de negocios da barra",
            "v": "o cTrader publica volume em TICKS (contagem), grandeza DIFERENTE do `v` (unidade-base) do "
                 "irmao; a sigma nao le^ `v` — fica fora, em vez de um `v` com outro significado",
            "s": "o simbolo e' o que o operador pediu, nao um campo da vela (o irmao escreve-o)",
            "i": "o intervalo, idem: e' o `relogio` pedido, declarado aqui no descritor",
        },
    }
