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

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent

#: Os QUATRO valores deste venue, cada um no seu ficheiro `.key` — como manda a casa (o conector 1 guarda a
#: chave num `.key`; aqui sao quatro). E um ficheiro por valor, e nao um ficheiro com quatro dentro, por uma
#: razao dura: o venue RODA o par de tokens e reescreve os ficheiros deles — com tudo num ficheiro so', a rotacao
#: mexia no segredo da aplicacao.
CAMPOS_DA_CREDENCIAL = ("client_id", "client_secret", "access_token", "refresh_token")
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
    """Os quatro valores da credencial, ja' resolvidos. Nunca se imprime: so' se usa para autenticar.

    O ID da conta NAO vive aqui: ele nao e' um segredo, e a ficha da conta e' que o declara (e' contra ele que a
    porta da identidade compara o que o venue devolve).
    """

    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str
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


def carregar_trio(referencia: object, arquivos: object, raiz: Path = RAIZ) -> Trio | Recusa:
    """Resolve as QUATRO referencias — uma por valor — e confere cada uma.

    Cada valor vem do seu proprio sitio, e cada um e' conferido por si: a referencia resolve, o ficheiro existe,
    o modo e' 600, o valor nao veio vazio, e (nos tres segredos) o valor nao aparece em nenhum ficheiro
    versionado. A recusa diz SEMPRE qual dos quatro falhou — um erro de copia num deles tem de ser visivel sem
    se adivinhar.
    """
    if not isinstance(arquivos, dict):
        return recusa(
            "formato_invalido",
            "`credencial.arquivos` tem de ser um objecto com uma referencia por valor "
            f"({', '.join(CAMPOS_DA_CREDENCIAL)})",
        )

    for campo in arquivos:
        if campo.startswith("_"):
            continue
        if campo not in CAMPOS_DA_CREDENCIAL:
            return recusa(
                "campo_desconhecido",
                f"`credencial.arquivos` traz `{campo}`, que este conector nao le': a ficha diz a REFERENCIA e "
                "ONDE ela vive, e nunca o valor (FR-023)",
            )
    for campo in CAMPOS_DA_CREDENCIAL:
        if campo not in arquivos:
            return recusa(
                "campo_obrigatorio_ausente",
                f"`credencial.arquivos` nao traz `{campo}`: sem esse valor nao ha autenticacao possivel",
            )

    valores: dict[str, str] = {}
    de: list[str] = []
    for campo in CAMPOS_DA_CREDENCIAL:
        lido = carregar_texto(referencia, arquivos[campo], raiz)
        if isinstance(lido, Recusa):
            return Recusa(ok=False, motivo=lido.motivo, porque=f"[{campo}] {lido.porque}")

        if campo in CAMPOS_SECRETOS:
            # O PISO, antes da varredura: um valor curto demais nao e' um segredo, e varre-lo daria um
            # diagnostico falso (um valor de um caractere aparece em qualquer ficheiro do repositorio).
            if len(lido.valor) < CARACTERES_MINIMOS_DO_SEGREDO:
                return recusa(
                    "valor_fora_da_banda",
                    f"[{campo}] tem {len(lido.valor)} caracteres e exige-se pelo menos "
                    f"{CARACTERES_MINIMOS_DO_SEGREDO}: o venue emite tokens longos, e um valor assim e' "
                    "lugar-marcado ou copia truncada — e um segredo truncado nao autentica nada",
                )
            onde = esta_no_repositorio(lido.valor, raiz)
            if onde is not None:
                return recusa(
                    "valor_fora_da_banda",
                    f"[{campo}] o VALOR aparece no ficheiro versionado {onde}: a chave esta escrita no repositorio "
                    "(RN-E14) — troque-a no venue e apague-a do historico antes de continuar",
                )

        valores[campo] = lido.valor
        de.append(f"{campo}:{lido.de}")

    return Trio(
        client_id=valores["client_id"],
        client_secret=valores["client_secret"],
        access_token=valores["access_token"],
        refresh_token=valores["refresh_token"],
        de=", ".join(de),
    )


def mascarar(valor: str, visiveis: int = 4) -> str:
    """Como um segredo se mostra num diagnostico: o suficiente para o dono reconhecer, nunca o valor."""
    if len(valor) <= visiveis:
        return "***"
    return f"{valor[:visiveis]}…***"
