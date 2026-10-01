"""A ficha do conector e a rede do venue: leem-se, conferem-se, e recusam-se com motivo nomeado.

A ficha deste conector e' `brokers/ctrader/<nome>.conector.json` — o mesmo sitio e a mesma forma do conector 1
(para o operador os arrancar da mesma maneira, sem saber de que venue se trata). Traz o venue, o ambiente, o
endereco da API, o NOME da conta, os instrumentos que o mandato vai servir, e a REFERENCIA da credencial.

Duas coisas que este ficheiro faz e que sao a razao de ele existir separado:

  * **Nao ha' nenhum endereco de venue no codigo.** O endereco vem da ficha; o que o codigo sabe e' que o
    ambiente `demonstracao` e o ambiente `real` NAO podem apontar para o mesmo sitio — e que um ficheiro que diga
    «demonstracao» e aponte para producao RECUSA (e' o erro que poe dinheiro real em ensaio, ou o contrario).
  * **A ficha e' FECHADA.** Campo que ninguem le' e' lixo, e lixo numa ficha de conta e' uma promessa que nao se
    cumpre: chave desconhecida RECUSA.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

#: Os dois ambientes deste venue. O nome e' NOSSO (o venue chama-lhes `demo` e `live`); o que se confere e' a
#: coerencia entre o ambiente declarado e o endereco declarado.
AMBIENTES = ("demonstracao", "real")

#: Campos da ficha que este conector LE'. Tudo o que nao esteja aqui e' recusado (D5: objectos fechados).
#: `ctid_trader_account_id` NAO e' segredo: e' a identidade da conta no venue, e a ficha declara-a porque e'
#: contra ela que a porta da identidade compara o que o venue devolve (FR-049).
CAMPOS_LIDOS = (
    "conector",
    "contrato",
    "venue",
    "ambiente",
    "url_da_api",
    "conta",
    "ctid_trader_account_id",
    "instrumentos",
    "credencial",
)
CAMPOS_LIDOS_DA_CREDENCIAL = ("referencia", "arquivos")


@dataclass(frozen=True)
class Ficha:
    conector: str
    contrato: str
    venue: str
    ambiente: str
    url_da_api: str
    conta: str
    ctid_trader_account_id: int
    instrumentos: tuple[str, ...]
    credencial_referencia: str
    credencial_arquivos: dict[str, str]
    origem: str


@dataclass(frozen=True)
class Recusa:
    ok: bool
    motivo: str
    porque: str


def recusa(motivo: str, porque: str) -> Recusa:
    return Recusa(ok=False, motivo=motivo, porque=porque)


def _endereco_do_ambiente(url: str) -> str | None:
    """A que ambiente pertence este endereco, pelo proprio endereco. `None` = nao se sabe dizer."""
    hospedeiro = url.split(":", 1)[0].strip().lower()
    if hospedeiro.startswith("demo.") or hospedeiro.endswith("-demo.ctraderapi.com"):
        return "demonstracao"
    if hospedeiro.startswith("live.") or hospedeiro.endswith("-live.ctraderapi.com"):
        return "real"
    return None


def ler_ficha(caminho: Path) -> Ficha | Recusa:
    """Le' e confere a ficha do conector. Nunca levanta: devolve sempre uma decisao."""
    if not caminho.exists():
        return recusa("campo_obrigatorio_ausente", f"a ficha do conector nao existe: {caminho}")
    try:
        dados = json.loads(caminho.read_text(encoding="utf-8"))
    except json.JSONDecodeError as erro:
        return recusa("formato_invalido", f"a ficha {caminho} nao e' JSON: {erro.msg}")
    if not isinstance(dados, dict):
        return recusa("formato_invalido", f"a ficha {caminho} tem de ser um objecto JSON")

    # Campos que ninguem le': recusados. Chaves comecadas por `_` sao comentarios do modelo, e aceitam-se.
    for chave in dados:
        if chave.startswith("_"):
            continue
        if chave not in CAMPOS_LIDOS:
            return recusa(
                "campo_desconhecido",
                f"a ficha {caminho.name} traz `{chave}`, que este conector nao le': uma ficha so' tem as chaves "
                "que o sistema le' (RN-A2)",
            )

    for campo in CAMPOS_LIDOS:
        if campo not in dados:
            return recusa("campo_obrigatorio_ausente", f"a ficha {caminho.name} nao traz `{campo}`")

    venue = dados["venue"]
    if venue != "ctrader":
        return recusa(
            "valor_fora_do_conjunto",
            f"a ficha diz `venue` = {venue!r} e este processo e' do conector cTrader: cada conector serve o seu "
            "venue, e nao outro",
        )

    # A VERSAO DO CONTRATO que este conector fala. Confere-se por igualdade EXACTA na porta `versao_do_contrato`
    # (D7), antes de qualquer envio: o que aqui se confere e' a forma (uma versao declarada).
    contrato = dados["contrato"]
    if not isinstance(contrato, str) or not re.match(r"^\d+\.\d+\.\d+$", contrato):
        return recusa(
            "formato_invalido",
            f"`contrato` = {contrato!r} tem de ser a versao que este conector fala (`MAJOR.MINOR.PATCH`): sem ela "
            "nao ha igualdade exacta a conferir, e nada sai",
        )

    conector = dados["conector"]
    # A REGRA E' DO CONTRATO, e nao nossa: `nome_de_plugin` (`_defs/forma.schema.json`) exige
    # `^[a-z][a-z0-9_]{1,31}$` — minusculas com underscore, SEM HIFEN. O nome da ficha atravessa o manifesto
    # (`conector.nome`) e um nome invalido so' seria apanhado la', com um erro pior de ler.
    if not isinstance(conector, str) or not re.match(r"^[a-z][a-z0-9_]{1,31}$", conector):
        return recusa(
            "formato_invalido",
            f"`conector` = {conector!r} tem de seguir a regra do contrato (`^[a-z][a-z0-9_]{{1,31}}$`): "
            "minusculas, digitos e underscore — hifen nao entra. Use, por exemplo, `ctrader_mesa`",
        )

    ambiente = dados["ambiente"]
    if ambiente not in AMBIENTES:
        return recusa(
            "valor_fora_do_conjunto",
            f"`ambiente` = {ambiente!r} nao esta no conjunto {AMBIENTES}: o ambiente decide a que rede se liga, e "
            "nao se adivinha",
        )

    url = dados["url_da_api"]
    if not isinstance(url, str) or ":" not in url:
        return recusa(
            "formato_invalido",
            f"`url_da_api` = {url!r} tem de ser `endereco:porta`: o endereco do venue vem da ficha, nunca do codigo",
        )
    do_endereco = _endereco_do_ambiente(url)
    if do_endereco is None:
        return recusa(
            "formato_invalido",
            f"`url_da_api` = {url!r} nao diz de que ambiente e' (esperado um endereco de demonstracao ou de real): "
            "um endereco que nao se reconhece e' recusa, porque ligar-se ao sitio errado e' o defeito caro",
        )
    if do_endereco != ambiente:
        return recusa(
            "ambiente_e_rede_incoerentes",
            f"a ficha declara `ambiente` = {ambiente} e aponta para {url}, que e' de {do_endereco}: o ambiente "
            "declarado e a rede nao podem discordar — e' assim que um ensaio passa a operar a serio sem ninguem dar "
            "por isso",
        )

    conta = dados["conta"]
    if not isinstance(conta, str) or conta.strip() == "":
        return recusa("campo_obrigatorio_ausente", "`conta` tem de ser o NOME nao vazio da conta")

    identidade = dados["ctid_trader_account_id"]
    if isinstance(identidade, bool) or not isinstance(identidade, int) or identidade <= 0:
        return recusa(
            "formato_invalido",
            f"`ctid_trader_account_id` tem de ser um inteiro positivo, e veio {identidade!r}: e' a identidade da "
            "conta no venue, e e' contra ele que a porta da identidade compara o que o venue devolve (FR-049) — "
            "nao se adivinha",
        )

    instrumentos = dados["instrumentos"]
    if not isinstance(instrumentos, list) or not instrumentos:
        return recusa(
            "campo_obrigatorio_ausente",
            "`instrumentos` tem de ser uma lista com pelo menos um nome: a lista nomeia o que o mandato espera "
            "encontrar no manifesto, e a mesa recusa arrancar sem ela",
        )
    for instrumento in instrumentos:
        if not isinstance(instrumento, str) or instrumento.strip() == "":
            return recusa("formato_invalido", f"`instrumentos` traz {instrumento!r}, que nao e' um nome")
    if len(set(instrumentos)) != len(instrumentos):
        return recusa("valor_fora_da_banda", f"`instrumentos` repete um nome: {instrumentos}")

    credencial = dados["credencial"]
    if not isinstance(credencial, dict):
        return recusa(
            "formato_invalido",
            "`credencial` tem de ser um objecto com `referencia` (o NOME da credencial) e `arquivos` (ONDE cada "
            "valor vive)",
        )
    for chave in credencial:
        if chave.startswith("_"):
            continue
        if chave not in CAMPOS_LIDOS_DA_CREDENCIAL:
            return recusa(
                "campo_desconhecido",
                f"`credencial` traz `{chave}`, que ninguem le': a ficha diz a REFERENCIA e ONDE ela vive, e nunca "
                "o valor (FR-023)",
            )
    for campo in CAMPOS_LIDOS_DA_CREDENCIAL:
        if campo not in credencial:
            return recusa("campo_obrigatorio_ausente", f"`credencial` nao traz `{campo}`")

    arquivos = credencial["arquivos"]
    if not isinstance(arquivos, dict) or not arquivos:
        return recusa(
            "formato_invalido",
            "`credencial.arquivos` tem de ser um objecto com uma referencia por valor — um ficheiro `.key` por "
            "valor, como manda a casa (o venue reescreve DOIS deles quando roda o par de tokens, e com tudo num "
            "ficheiro so' a rotacao mexia no segredo da aplicacao)",
        )
    for campo, referencia in arquivos.items():
        if campo.startswith("_"):
            continue
        if not isinstance(referencia, str) or referencia.strip() == "":
            return recusa(
                "formato_invalido",
                f"`credencial.arquivos.{campo}` tem de ser uma REFERENCIA nao vazia (`env:NOME` ou "
                "`ficheiro:CAMINHO`) — o valor nunca se escreve aqui",
            )

    return Ficha(
        conector=conector.strip(),
        contrato=contrato,
        venue=venue,
        ambiente=ambiente,
        url_da_api=url,
        conta=conta.strip(),
        ctid_trader_account_id=identidade,
        instrumentos=tuple(instrumentos),
        credencial_referencia=str(credencial["referencia"]),
        credencial_arquivos={c: str(v) for c, v in arquivos.items() if not c.startswith("_")},
        origem=str(caminho),
    )
