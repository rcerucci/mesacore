"""Carrega a credencial do conector cTrader — do sitio que a config declarar, e so de la.

Espelho de `brokers/hyperliquid/credencial.ts`, com a diferenca que este venue tem: aqui sao QUATRO valores que
vivem juntos (client_id, client_secret, access_token, refresh_token) mais a identidade da conta
(`ctid_trader_account_id`). O venue REESCREVE o ficheiro quando roda o par de tokens — quem o aponta para
leitura-e-escrita e' o dono, e este modulo so' o LE'.

O valor NUNCA vive no repositorio (RN-E14, RN-C20): o que a config traz e' uma REFERENCIA. Este ficheiro
resolve-a em dois sitios e mais nenhum:

    "env:NOME_DA_VARIAVEL"          -> a variavel de ambiente
    "ficheiro:/caminho/fora.json"   -> um ficheiro FORA do repositorio, modo 0600

E recusa em cinco casos, todos nomeados:

  * a referencia nao diz de onde vem (`formato_invalido`);
  * o que ela aponta nao existe ou veio vazio (`campo_obrigatorio_ausente` / `valor_nulo_nao_permitido`);
  * o ficheiro e' legivel por OUTROS (`valor_fora_da_banda`): a chave esta protegida, mas nao pela banda que se
    exige — grupo ou mundo com leitura e' um segredo partilhado com quem passar;
  * algum dos VALORES aparece num ficheiro VERSIONADO do repositorio (`valor_fora_da_banda`): um vazamento
    acidental passa a ser um arranque RECUSADO, e nao um commit que ninguem ve;
  * o ficheiro nao traz os quatro campos que o venue exige (`campo_obrigatorio_ausente`), ou traz um id de conta
    que nao e' um inteiro positivo (`formato_invalido`).

A varredura do repositorio faz-se em memoria, ficheiro a ficheiro: o valor nao entra em linha de comando
nenhuma (nem no `ps`, nem no historico).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent

#: As quatro chaves que o ficheiro de tokens deste venue tem de trazer, e a identidade da conta.
CAMPOS_DO_FICHEIRO = ("client_id", "client_secret", "access_token", "refresh_token", "ctid_trader_account_id")
CAMPOS_SECRETOS = ("client_secret", "access_token", "refresh_token")

REFERENCIA_VALIDA = re.compile(r"^(env|ficheiro):.+$")

#: A partir de quantos caracteres um valor pode ser um segredo. Nao e' um numero do venue: e' o piso que separa
#: um token de um lugar-marcado ou de uma copia truncada. Abaixo disto RECUSA, e a varredura ao repositorio nem
#: se faz — um valor de um caractere aparece em qualquer ficheiro, e acusar o dono de o ter versionado seria um
#: diagnostico falso (medido: um `client_secret` de teste com 1 caractere recusava um ficheiro em modo 600).
CARACTERES_MINIMOS_DO_SEGREDO = 16


@dataclass(frozen=True)
class Feito:
    ok: bool
    #: o texto resolvido (env) ou o conteudo do ficheiro — NUNCA se imprime isto
    valor: str
    de: str
    protegido: str


@dataclass(frozen=True)
class Recusa:
    ok: bool
    motivo: str
    porque: str


@dataclass(frozen=True)
class Trio:
    """Os valores da credencial, ja resolvidos. Nunca se imprime: so' se usa para autenticar."""

    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str
    ctid_trader_account_id: int
    de: str


def recusa(motivo: str, porque: str) -> Recusa:
    return Recusa(ok=False, motivo=motivo, porque=porque)


def esta_no_repositorio(valor: str, raiz: Path = RAIZ) -> str | None:
    """O valor aparece em algum ficheiro VERSIONADO? Comparado em memoria — nunca por linha de comando."""
    try:
        saida = subprocess.run(
            ["git", "ls-files"], cwd=raiz, capture_output=True, text=True, check=True
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Sem git a responder nao se afirma nada: quem decide e' quem chamou (a porta `chave`).
        return None

    for relativo in saida.splitlines():
        if not relativo:
            continue
        caminho = raiz / relativo
        try:
            if caminho.stat().st_size > 5_000_000:
                continue
            if valor in caminho.read_text(encoding="utf-8", errors="ignore"):
                return relativo
        except OSError:
            continue  # binario ou ilegivel: nao conta como prova de ausencia, mas tambem nao trava a leitura
    return None


def carregar_texto(referencia: object, valor_em: object, raiz: Path = RAIZ) -> Feito | Recusa:
    """Resolve a REFERENCIA no texto do ficheiro (ou da variavel). Nao interpreta o conteudo."""
    if not isinstance(referencia, str) or referencia.strip() == "":
        return recusa("campo_obrigatorio_ausente", "a ficha nao declara `credencial.referencia` (o NOME da credencial)")
    if not isinstance(valor_em, str) or not REFERENCIA_VALIDA.match(valor_em):
        return recusa(
            "formato_invalido",
            f'credencial.valor_em tem de ser "env:NOME" ou "ficheiro:CAMINHO", e veio {valor_em!r}',
        )

    if valor_em.startswith("env:"):
        nome = valor_em[4:]
        bruto = os.environ.get(nome)
        if bruto is None:
            return recusa("campo_obrigatorio_ausente", f"a variavel de ambiente {nome} nao esta definida neste processo")
        texto = bruto.strip()
        de = f"env:{nome}"
        protegido = "ambiente do processo (a variavel nao entra na linha de comando)"
    else:
        bruto = valor_em[len("ficheiro:") :]
        caminho = Path(bruto).expanduser()
        if not caminho.is_absolute():
            caminho = raiz / caminho
        if not caminho.exists():
            return recusa("campo_obrigatorio_ausente", f"o ficheiro da credencial nao existe: {bruto}")
        if not caminho.is_file():
            return recusa("formato_invalido", f"o caminho da credencial nao e' um ficheiro: {bruto}")
        modo = caminho.stat().st_mode & 0o777
        if modo & 0o077:
            return recusa(
                "valor_fora_da_banda",
                f"o ficheiro da credencial e' legivel por grupo ou por outros (modo {modo:o}); exige-se 600 — "
                "a chave esta protegida, mas nao pela banda que se exige",
            )
        texto = caminho.read_text(encoding="utf-8").strip()
        de = f"ficheiro:{bruto}"
        protegido = f"ficheiro fora do repositorio, modo {modo:o}"

    if texto == "":
        return recusa("valor_nulo_nao_permitido", f"a credencial {referencia} veio vazia de {de}")

    return Feito(ok=True, valor=texto, de=de, protegido=protegido)


def carregar_trio(referencia: object, valor_em: object, raiz: Path = RAIZ) -> Trio | Recusa:
    """Resolve a referencia E confere que o ficheiro traz os quatro valores mais o id da conta."""
    texto = carregar_texto(referencia, valor_em, raiz)
    if isinstance(texto, Recusa):
        return texto

    try:
        dados = json.loads(texto.valor)
    except json.JSONDecodeError as erro:
        return recusa("formato_invalido", f"o ficheiro da credencial {texto.de} nao e' JSON: {erro.msg}")
    if not isinstance(dados, dict):
        return recusa("formato_invalido", f"o ficheiro da credencial {texto.de} tem de ser um objecto JSON")

    for campo in CAMPOS_DO_FICHEIRO:
        if campo not in dados:
            return recusa(
                "campo_obrigatorio_ausente",
                f"o ficheiro da credencial {texto.de} nao traz `{campo}`: sem ele nao ha autenticacao possivel",
            )
        if dados[campo] is None:
            return recusa("valor_nulo_nao_permitido", f"`{campo}` veio a null em {texto.de}: ausencia nao se escreve com null (D4)")

    for campo in CAMPOS_DO_FICHEIRO:
        if campo == "ctid_trader_account_id":
            continue
        if not isinstance(dados[campo], str) or dados[campo].strip() == "":
            return recusa("formato_invalido", f"`{campo}` tem de ser texto nao vazio em {texto.de}")

    # O PISO, antes da varredura: um valor curto demais nao e' um segredo, e varre-lo daria um diagnostico falso.
    for campo in CAMPOS_SECRETOS:
        comprimento = len(dados[campo].strip())
        if comprimento < CARACTERES_MINIMOS_DO_SEGREDO:
            return recusa(
                "valor_fora_da_banda",
                f"`{campo}` tem {comprimento} caracteres e exige-se pelo menos {CARACTERES_MINIMOS_DO_SEGREDO}: "
                "o venue emite tokens longos, e um valor assim e' lugar-marcado ou copia truncada — e um segredo "
                "truncado nao autentica nada",
            )

    identidade = dados["ctid_trader_account_id"]
    if isinstance(identidade, bool) or not isinstance(identidade, int) or identidade <= 0:
        return recusa(
            "formato_invalido",
            f"`ctid_trader_account_id` tem de ser um inteiro positivo em {texto.de}, e veio {identidade!r}: "
            "o id da conta e' a identidade do venue, e nao se adivinha",
        )

    # Os SEGREDOS nao podem estar num ficheiro versionado. O `client_id` e o id da conta sao publicos: o que se
    # varre sao os tres valores que autenticam.
    for campo in CAMPOS_SECRETOS:
        onde = esta_no_repositorio(dados[campo], raiz)
        if onde is not None:
            return recusa(
                "valor_fora_da_banda",
                f"o VALOR de `{campo}` aparece no ficheiro versionado {onde}: a chave esta escrita no repositorio "
                "(RN-E14) — troque-a no venue e apague-a do historico antes de continuar",
            )

    return Trio(
        client_id=dados["client_id"],
        client_secret=dados["client_secret"],
        access_token=dados["access_token"],
        refresh_token=dados["refresh_token"],
        ctid_trader_account_id=identidade,
        de=texto.de,
    )


def mascarar(valor: str, visiveis: int = 4) -> str:
    """Como um segredo se mostra num diagnostico: o suficiente para o dono reconhecer, nunca o valor."""
    if len(valor) <= visiveis:
        return "***"
    return f"{valor[:visiveis]}…***"
