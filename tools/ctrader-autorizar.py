#!/usr/bin/env python3
"""Autoriza OAuth a aplicacao cTrader do dono, grava as QUATRO credenciais no padrao da casa e lista as contas.

PORQUE E' UM PROGRAMA E NAO UMA RECEITA DE CURL. O fluxo inicial de OAuth do cTrader Open API nao vive na
biblioteca embrulhada (`brokers/ctrader/transporte.py` faz a sessao, o protobuf e o REFRESH, mas nao a primeira
autorizacao — medido). Fazer isto a' mao, com `curl`, obrigaria a colar o `client_secret` numa linha de comando:
ficaria no `ps` e no historico do shell. Aqui o dono corre UM programa, os quatro valores entram por entrada
escondida (`getpass`), e o que se mostra de volta e' so' a FORMA (comprimento + primeiros 4 caracteres) — nunca
o valor. E' a mesma disciplina de `tools/guardar-credencial.sh`.

O QUE O PROGRAMA FAZ, por ordem:

  1. pede, de forma escondida, o `client_id` e o `client_secret` (se ja' houver ficheiros, diz que existem e
     pergunta se quer substituir — nunca imprime o conteudo deles);
  2. monta a URL de autorizacao do cTID, abre-a no browser e espera o `code`: por servidor local de callback
     (quando o `redirect_uri` e' `http://localhost...`) E/O' por colagem da URL completa na consola;
  3. troca o `code` pelos tokens no endpoint de token do venue (pedido HTTP na biblioteca padrao, `urllib`);
  4. grava os QUATRO valores — um ficheiro `.key` por valor, fora do repositorio, modo 600, escrita ATOMICA
     (temporario + `mv`) — e registra em `historico-de-credenciais.jsonl` (instante, ficheiro, origem, sha256,
     forma; NUNCA o valor);
  5. com os tokens na mao, abre o embrulho da casa (`transporte.py`) e LISTA os `ctidTraderAccountId` daquele
     cTID, dizendo quais sao de DEMONSTRACAO e quais sao REAIS.

FONTE DOS ENDERECOS E DOS NOMES (verificados, nao inventados):
  * documentacao oficial: https://help.ctrader.com/open-api/account-authentication/ (consultada 05/10/2026).
    - URL de autorizacao (a «granting access» do cTID):
      https://id.ctrader.com/my/settings/openapi/grantingaccess/?client_id=..&redirect_uri=..&scope=..&product=web
    - Endpoint de token: GET https://openapi.ctrader.com/apps/token
      parametros: grant_type (`authorization_code` | `refresh_token`), code, redirect_uri, client_id, client_secret.
    - Resposta: `accessToken` (string), `tokenType` (string), `expiresIn` (inteiro, ~2628000 s), `refreshToken`
      (string), `errorCode` (string/null), `description` (string/null).

O `redirect_uri` tem de ser um URI REGISTADO na app no portal da cTrader Open API (a doc di-lo): o dono tem de
ter `http://localhost:<porta>/...` (ou outro) entre os Redirect URIs da app. Para o servidor local de callback
funcionar, o `redirect_uri` tem de ser http em localhost/127.0.0.1; um `redirect_uri` https so' serve pela via
de colar a URL a mao.

Uso: ver `--ajuda`. O comando normal do dono, de dentro do projecto uv do conector:

  cd /home/cerucci/Projects/MesaCore/brokers/ctrader && uv run python ../../tools/ctrader-autorizar.py
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# -----------------------------------------------------------------------------------------------------------
# Os enderecos do venue, com a fonte escrita ao lado (nao se inventa um endereco).
# -----------------------------------------------------------------------------------------------------------
RAIZ = Path(__file__).resolve().parent.parent
PASTA_DO_EMBRULHO = RAIZ / "brokers" / "ctrader"

# FONTE: https://help.ctrader.com/open-api/account-authentication/ (consultada 05/10/2026)
URL_DE_AUTORIZACAO_PADRAO = "https://id.ctrader.com/my/settings/openapi/grantingaccess/"
URL_DE_TOKEN_PADRAO = "https://openapi.ctrader.com/apps/token"
ESCOPO_PADRAO = "trading"          # `accounts` (so' leitura) ou `trading` (operacoes) — a doc lista os dois.
PRODUTO_PADRAO = "web"             # recomendado pela doc para o ecra de autorizacao.

# FONTE: brokers/ctrader/conector.exemplo.json (endereco da ficha, nao do codigo)
URL_DA_API_PADRAO = "demo.ctraderapi.com:5035"

# O padrao de credenciais da casa (mesmas convencoes de tools/guardar-credencial.sh).
CREDENCIAIS_PADRAO = "~/.config/mesacore/credenciais"
PREFIXO_PADRAO = "ctrader_mesa_"
CAMPOS = ("client_id", "client_secret", "access_token", "refresh_token")
SEGREDOS = ("client_secret", "access_token", "refresh_token")
MINIMO_DO_SEGREDO = 16
REDIRECT_URI_PADRAO = "http://localhost:8080/"
ESPERA_PADRAO_S = 300


# -----------------------------------------------------------------------------------------------------------
# Resultados: um `Feito` ou uma `Recusa` com motivo NOMEADO (nunca um texto de terceiros a passar por nosso).
# -----------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Recusa:
    motivo: str
    porque: str


@dataclass(frozen=True)
class Tokens:
    access_token: str
    refresh_token: str
    expira_em_s: int | None


# -----------------------------------------------------------------------------------------------------------
# A FORMA de cada valor (a mesma regra do guardar-credencial.sh). Nao e' validacao de seguranca: e' para o dono
# ver que colou a coisa certa. Quem diz se o valor serve e' o venue.
# -----------------------------------------------------------------------------------------------------------
def forma(campo: str, valor: str) -> tuple[bool, str]:
    n = len(valor)
    if campo == "client_id":
        # A FORMA do Client ID do portal e' `<digitos>_<codigo alfanumerico>`; o comprimento leva so' piso e tecto
        # de sanidade (medido: o do dono tem 56 caracteres — nao se inventa uma regua contra o dono).
        if re.fullmatch(r"[0-9]+_[A-Za-z0-9]+", valor) and 10 <= n <= 128:
            return True, "parece um Client ID (digitos + underscore + codigo alfanumerico)"
        return False, "NAO parece um Client ID (esperado: digitos, UM underscore, e um codigo alfanumerico)"
    if re.fullmatch(r"[A-Za-z0-9+/=_-]+", valor) and n >= MINIMO_DO_SEGREDO:
        return True, "parece um token/segredo"
    return False, f"NAO parece um token (esperado: {MINIMO_DO_SEGREDO}+ caracteres, sem espacos nem texto)"


def descrever_forma(valor: str) -> str:
    """A forma que se mostra de um valor: comprimento + primeiros 4 caracteres, NUNCA o valor."""
    return f"{len(valor)} caracteres, a comecar por «{valor[:4]}»"


# -----------------------------------------------------------------------------------------------------------
# Leitura/escrita das credenciais, no padrao da casa.
# -----------------------------------------------------------------------------------------------------------
def ler_valor(caminho: Path) -> str | None:
    if not caminho.exists():
        return None
    texto = caminho.read_text(encoding="utf-8").strip()
    return texto or None


def gravar_um(campo: str, valor: str, pasta: Path, prefixo: str, origem: str, historico: Path) -> Path:
    """Grava UM valor no seu ficheiro `.key`: modo 600, escrito de forma atomica (temporario + rename)."""
    if campo in SEGREDOS and len(valor) < MINIMO_DO_SEGREDO:
        raise ValueError(
            f"RECUSADO: o valor de {campo} tem {len(valor)} caracteres — curto de mais para um segredo "
            f"(minimo {MINIMO_DO_SEGREDO})"
        )
    pasta.mkdir(parents=True, exist_ok=True)
    os.chmod(pasta, 0o700)
    destino = pasta / f"{prefixo}{campo}.key"
    temporario = destino.with_name(f".{campo}.key.tmp.{os.getpid()}")
    descritor = os.open(temporario, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descritor, "w", encoding="utf-8") as ficheiro:
        ficheiro.write(valor)
    os.chmod(temporario, 0o600)
    os.replace(temporario, destino)
    os.chmod(destino, 0o600)

    # O REGISTO leva instante, ficheiro, ORIGEM, a impressao (sha256) e a FORMA — e NUNCA o valor.
    historico.parent.mkdir(parents=True, exist_ok=True)
    registo = {
        "instante": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "ficheiro": str(destino),
        "origem": origem,
        "impressao_sha256": hashlib.sha256(valor.encode("utf-8")).hexdigest(),
        "forma": {"comprimento": len(valor), "primeiros": valor[:4]},
    }
    try:
        with open(historico, "a", encoding="utf-8") as ficheiro:
            ficheiro.write(json.dumps(registo, ensure_ascii=False) + "\n")
        os.chmod(historico, 0o600)
    except OSError as erro:
        print(f"  (aviso: nao consegui registar no historico {historico}: {type(erro).__name__})", file=sys.stderr)
    return destino


# -----------------------------------------------------------------------------------------------------------
# O pedido HTTP de token. NAO se usa nenhuma dependencia nova: `urllib` da biblioteca padrao.
# -----------------------------------------------------------------------------------------------------------
def trocar_codigo_por_tokens(
    url_do_token: str, client_id: str, client_secret: str, code: str, redirect_uri: str
) -> Tokens | Recusa:
    parametros = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    url = f"{url_do_token}?{urllib.parse.urlencode(parametros)}"
    pedido = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
    try:
        with urllib.request.urlopen(pedido, timeout=30) as resposta:
            corpo = resposta.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as erro:
        # NAO se imprime `str(erro)`: um HTTPError carrega a URL inteira (com o client_secret) no seu texto.
        corpo = ""
        try:
            corpo = erro.read().decode("utf-8", "ignore")
        except Exception:
            pass
        motivo, porque = _erro_da_resposta(corpo)
        return Recusa(motivo or f"http_{erro.code}", porque or f"o endpoint de token respondeu HTTP {erro.code}")
    except Exception as erro:  # rede, TLS, timeout: reporta-se o TIPO, nunca o texto (que pode trazer a URL)
        return Recusa(
            "falha_de_rede",
            f"nao consegui falar com o endpoint de token ({type(erro).__name__}); confira a rede e o endereco",
        )

    try:
        dados = json.loads(corpo)
    except ValueError:
        return Recusa("resposta_nao_json", "o endpoint de token nao devolveu JSON valido")

    if isinstance(dados, dict) and dados.get("errorCode"):
        return Recusa(str(dados["errorCode"]), str(dados.get("description") or "sem descricao do venue"))

    access = dados.get("accessToken") if isinstance(dados, dict) else None
    refresh = dados.get("refreshToken") if isinstance(dados, dict) else None
    expira = dados.get("expiresIn") if isinstance(dados, dict) else None
    if not isinstance(access, str) or not access:
        return Recusa("resposta_sem_access_token", "a resposta nao trouxe `accessToken` (nenhum token foi emitido)")
    if not isinstance(refresh, str) or not refresh:
        return Recusa("resposta_sem_refresh_token", "a resposta nao trouxe `refreshToken` (a rotacao ficaria impossivel)")
    expira_s = expira if isinstance(expira, int) else None
    return Tokens(access_token=access, refresh_token=refresh, expira_em_s=expira_s)


def _erro_da_resposta(corpo: str) -> tuple[str, str]:
    """Le' `errorCode`/`description` do corpo do venue, se houver — senao devolve vazio."""
    if not corpo:
        return "", ""
    try:
        dados = json.loads(corpo)
    except ValueError:
        return "", ""
    if not isinstance(dados, dict):
        return "", ""
    return str(dados.get("errorCode") or ""), str(dados.get("description") or "")


# -----------------------------------------------------------------------------------------------------------
# O servidor local de callback (para o `redirect_uri` local) e a extracção do `code`.
# -----------------------------------------------------------------------------------------------------------
class ServidorDeCallback:
    """Escuta UMA vez em `host:porta`, guarda o `code` que o browser devolver e serve uma pagina simples."""

    def __init__(self, host: str, porta: int) -> None:
        self.host = host
        self.porta = porta
        self.codigo: str | None = None
        self.erro: str | None = None
        self._httpd: HTTPServer | None = None
        dono = self

        class _Tratador(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 (nome da biblioteca padrao)
                consulta = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                if "code" in consulta:
                    dono.codigo = consulta["code"][0]
                    aviso = "Autorizacao recebida. Pode fechar este separador e voltar a consola."
                elif "error" in consulta:
                    dono.erro = (consulta.get("error_description") or consulta["error"])[0]
                    aviso = f"O venue recusou a autorizacao: {dono.erro}"
                else:
                    aviso = "Aguardando o `code`... (esta pagina nao trouxe o parametro `code`)"
                pagina = f"<!doctype html><html lang='pt'><meta charset='utf-8'><body><h1>cTrader — MesaCore</h1><p>{aviso}</p></body></html>"
                corpo = pagina.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(corpo)))
                self.end_headers()
                self.wfile.write(corpo)

            def log_message(self, *_: object) -> None:  # silencio: nada de log do servidor no ecra
                return

        self._tratador = _Tratador

    def arrancar(self) -> None:
        self._httpd = HTTPServer((self.host, self.porta), self._tratador)
        threading.Thread(target=self._httpd.serve_forever, daemon=True, name="ctrader-callback").start()

    def parar(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()


def extrair_code(texto: str) -> str | None:
    """Aceita uma URL completa de redireccao (`...?code=..`), um `code=..`, ou o proprio `code` cru."""
    texto = (texto or "").strip()
    if not texto:
        return None
    consulta = urllib.parse.parse_qs(urllib.parse.urlparse(texto).query)
    if "code" in consulta and consulta["code"]:
        return consulta["code"][0]
    if texto.startswith("code="):
        consulta = urllib.parse.parse_qs(texto)
        if "code" in consulta and consulta["code"]:
            return consulta["code"][0]
    if " " not in texto and "=" not in texto and "/" not in texto:
        return texto  # parece o proprio code
    return None


def _esperar_code(servidor: ServidorDeCallback | None, espera_s: float) -> str | None:
    """Espera o `code` do servidor E/O' da colagem na consola (o que chegar primeiro)."""
    limite = time.time() + espera_s
    usar_select = False
    if sys.stdin is not None and sys.stdin.isatty():
        try:
            import select as _select

            usar_select = hasattr(_select, "select")
        except Exception:
            usar_select = False

    while time.time() < limite:
        if servidor is not None:
            if servidor.codigo:
                return servidor.codigo
            if servidor.erro:
                return None
        if usar_select:
            import select as _select

            prontos, _, _ = _select.select([sys.stdin], [], [], 0.5)
            if prontos:
                linha = sys.stdin.readline().strip()
                codigo = extrair_code(linha)
                if codigo:
                    return codigo
                if linha:
                    print("  (nao reconheci um `code` nessa linha; espero de novo)")
        else:
            time.sleep(0.5)
    return None


def obter_code_interactivo(argumentos: argparse.Namespace, client_id: str) -> str | None:
    url = (
        f"{argumentos.autorizacao_url}?"
        f"{urllib.parse.urlencode({'client_id': client_id, 'redirect_uri': argumentos.redirect_uri, 'scope': argumentos.scope, 'product': argumentos.produto})}"
    )
    print("")
    print("1) Abra esta URL no browser, faca login no seu cTID e carregue em «Allow access»:")
    print("")
    print(f"   {url}")
    print("")
    print("   MAQUINA SEM BROWSER (VPS, servidor, SSH): abra a URL acima ONDE TIVER browser — noutro computador ou")
    print("   no telefone — e carregue em «Allow access». O browser vai ser levado para o `redirect_uri` com o `code`")
    print("   na barra de enderecos; copie a URL INTEIRA (mesmo que a pagina de erro: o `code` esta' na barra) e cole-a")
    print("   aqui. Para esse caminho o `--url '<a URL inteira>'` faz o mesmo sem abrir nada.")
    print("")
    try:
        webbrowser.open(url)
    except Exception:
        pass

    servidor: ServidorDeCallback | None = None
    if not argumentos.sem_servidor:
        local, host, porta = _e_redirect_local(argumentos.redirect_uri)
        if local:
            try:
                servidor = ServidorDeCallback(host, porta)
                servidor.arrancar()
                print(f"2) Servidor de callback a escutar em http://{host}:{porta}/ — o browser vai voltar aqui sozinho.")
            except OSError as erro:
                servidor = None
                print(f"   (nao consegui abrir o servidor de callback local: {type(erro).__name__})")
        else:
            print("2) O `redirect_uri` nao e' local: depois de autorizar, copie a URL da barra do browser.")
    print("   Se preferir, cole aqui a URL completa (ou so' o `code`) e carregue Enter. Ctrl-C para desistir.")
    try:
        codigo = _esperar_code(servidor, argumentos.tempo_de_espera)
    except KeyboardInterrupt:
        codigo = None
    finally:
        if servidor is not None:
            servidor.parar()
    return codigo


def _e_redirect_local(redirect_uri: str) -> tuple[bool, str, int]:
    alvo = urllib.parse.urlparse(redirect_uri)
    host = alvo.hostname or ""
    local = host in ("localhost", "127.0.0.1", "::1") and alvo.scheme == "http"
    porta = alvo.port or (443 if alvo.scheme == "https" else 80)
    return local, host or "127.0.0.1", porta


# -----------------------------------------------------------------------------------------------------------
# A LISTAGEM DE CONTAS. A funcao recebe QUALQUER objecto com o metodo `.contas(access_token)` — o embrulho da
# casa (`transporte.Transporte`) em producao, um duplo na bancada. O que ela le' e' o `Resultado` do embrulho
# (`.ok`, `.valor` = lista de dicts com `conta`, `e_real`, `login`, `corretora`, ...).
# -----------------------------------------------------------------------------------------------------------
def resumir_contas(valor: list[dict]) -> list[dict]:
    """Marca cada conta do venue como demonstracao ou real. O resto do dict passa tal e qual (nao se inventa)."""
    resumo = []
    for conta in valor:
        e_real = bool(conta.get("e_real"))
        resumo.append(
            {
                "conta": conta.get("conta"),
                "ambiente": "real" if e_real else "demonstracao",
                "e_real": e_real,
                "login": conta.get("login"),
                "corretora": conta.get("corretora"),
            }
        )
    return resumo


def listar_contas(transporte_obj: object, access_token: str) -> list[dict] | Recusa:
    """Chama `.contas()` no transporte recebido e devolve o resumo — ou uma `Recusa` com o motivo do embrulho."""
    try:
        resultado = transporte_obj.contas(access_token)  # type: ignore[attr-defined]
    except Exception as erro:
        return Recusa("falha_ao_listar_contas", f"o transporte rebentou ao listar: {type(erro).__name__}")
    if not getattr(resultado, "ok", False):
        return Recusa(getattr(resultado, "motivo", "falha_ao_listar_contas"), getattr(resultado, "porque", ""))
    return resumir_contas(list(getattr(resultado, "valor", []) or []))


def abrir_o_embrulho(url_da_api: str, client_id: str, client_secret: str):
    """Importa o embrulho da casa SO' quando a listagem precisa dele (o `--ajuda` nao toca em nada)."""
    if str(PASTA_DO_EMBRULHO) not in sys.path:
        sys.path.insert(0, str(PASTA_DO_EMBRULHO))
    import transporte  # noqa: PLC0415 (import tardio de proposito)

    return transporte.Transporte(url_da_api, client_id, client_secret)


# -----------------------------------------------------------------------------------------------------------
# A ajuda e o contrato da linha de comandos.
# -----------------------------------------------------------------------------------------------------------
def construir_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ctrader-autorizar.py",
        description="Autoriza OAuth a app cTrader, grava as 4 credenciais no padrao da casa e lista as contas.",
        epilog=(
            "Enderecos (fonte: https://help.ctrader.com/open-api/account-authentication/, consultada 05/10/2026): "
            f"autorizacao={URL_DE_AUTORIZACAO_PADRAO} | token={URL_DE_TOKEN_PADRAO}. "
            "O redirect_uri tem de estar REGISTADO nos Redirect URIs da app no portal da cTrader Open API.\n"
            "MAQUINA SEM BROWSER (VPS/servidor): abra a URL de autorizacao onde tiver browser e passe o resultado a' "
            "mao — `--url '<a URL inteira a que o browser foi levado>'` (o `code` vai na barra de enderecos, mesmo "
            "que a pagina de erro), ou `--sem-servidor` e colar durante a espera."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--ajuda", action="help", help="mostra esta ajuda e sai (nao toca no venue)")
    parser.add_argument("--autorizacao-url", default=URL_DE_AUTORIZACAO_PADRAO, help="URL da pagina de autorizacao do cTID")
    parser.add_argument("--token-url", default=URL_DE_TOKEN_PADRAO, help="endpoint de troca de code por tokens")
    parser.add_argument("--redirect-uri", default=REDIRECT_URI_PADRAO, help="redirect_uri registado na app (default: %(default)s)")
    parser.add_argument("--scope", default=ESCOPO_PADRAO, choices=("accounts", "trading"), help="scope pedido a app")
    parser.add_argument("--produto", default=PRODUTO_PADRAO, help="parametro `product` do ecra de autorizacao")
    parser.add_argument("--url-da-api", default=URL_DA_API_PADRAO, help="endereco `host:porta` do venue para listar contas (default: %(default)s)")
    parser.add_argument("--credenciais-dir", default=CREDENCIAIS_PADRAO, help="pasta das credenciais, fora do repositorio (default: %(default)s)")
    parser.add_argument("--prefixo", default=PREFIXO_PADRAO, help="prefixo dos ficheiros `.key` (default: %(default)s)")
    parser.add_argument("--historico", default=None, help="ficheiro do historico (default: a pasta das credenciais + /../historico-de-credenciais.jsonl)")
    parser.add_argument("--code", default=None, help="usa ja' este `code` (nao abre o browser nem o servidor)")
    parser.add_argument("--url", default=None, help="usa o `code` desta URL de redireccao completa")
    parser.add_argument("--sem-servidor", action="store_true", help="nao abre o servidor local de callback (so' colagem)")
    parser.add_argument("--tempo-de-espera", type=float, default=ESPERA_PADRAO_S, help="segundos a esperar pelo `code` (default: %(default)s)")
    parser.add_argument("--so-contas", action="store_true", help="nao autoriza: so' lista as contas com os tokens ja' gravados")
    parser.add_argument("--sem-contas", action="store_true", help="nao lista contas (grava as credenciais e sai)")
    parser.add_argument("--nao-interativo", action="store_true", help="nao faz perguntas; usa os ficheiros que ja' existem (bancada)")
    parser.add_argument("--forcar", action="store_true", help="grava mesmo com a forma fora do esperado (assume o risco)")
    return parser


# -----------------------------------------------------------------------------------------------------------
# O programa.
# -----------------------------------------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    argumentos = construir_parser().parse_args(argv)

    pasta = Path(argumentos.credenciais_dir).expanduser()
    prefixo = argumentos.prefixo
    historico = (
        Path(argumentos.historico).expanduser()
        if argumentos.historico
        else pasta.parent / "historico-de-credenciais.jsonl"
    )
    caminhos = {campo: pasta / f"{prefixo}{campo}.key" for campo in CAMPOS}

    print("== cTrader — autorizacao OAuth e credenciais no padrao da casa ==")
    print(f"pasta de credenciais: {pasta}")
    print("")

    valores: dict[str, str] = {}

    if argumentos.so_contas:
        for campo in CAMPOS:
            valor = ler_valor(caminhos[campo])
            if valor is None:
                print(f"RECUSADO: falta o ficheiro {caminhos[campo]} (o `--so-contas` precisa dos quatro ja' gravados)", file=sys.stderr)
                return 1
            valores[campo] = valor
        print("(--so-contas) uso os quatro valores ja' gravados; nao autorizo nada de novo.")
    else:
        # 1) O client_id e o client_secret: reutiliza o que ja' existe, pergunta antes de substituir.
        for campo, rotulo in (("client_id", "Client ID"), ("client_secret", "Client secret")):
            existente = ler_valor(caminhos[campo])
            if existente is not None:
                print(f"{rotulo}: ja' existe um valor gravado ({descrever_forma(existente)}).")
                if argumentos.nao_interativo:
                    valores[campo] = existente
                    print("  (--nao-interativo) reutilizo o valor existente.")
                    continue
                resposta = input(f"  substituir o {rotulo}? (s/n) ").strip().lower()
                if resposta not in ("s", "sim", "y", "yes"):
                    valores[campo] = existente
                    print("  reutilizo o valor existente.")
                    continue
            novo = getpass.getpass(f"  cola o {rotulo} (nao aparece no ecra): ").strip()
            if not novo:
                print(f"RECUSADO: nao veio nenhum {rotulo}.", file=sys.stderr)
                return 1
            valores[campo] = novo

        # A FORMA dos dois (o que se mostra e' so' a forma, nunca o valor).
        for campo in ("client_id", "client_secret"):
            ok, texto = forma(campo, valores[campo])
            print(f"  {campo}: {texto}")
        if not argumentos.forcar and any(not forma(c, valores[c])[0] for c in ("client_id", "client_secret")):
            print("RECUSADO: algum valor nao tem a forma do campo. Confira no portal (use o botao de COPIAR) ou use --forcar.", file=sys.stderr)
            return 1

        # 2) O `code`.
        codigo: str | None = None
        if argumentos.code:
            codigo = argumentos.code.strip()
        elif argumentos.url:
            codigo = extrair_code(argumentos.url)
            if not codigo:
                print("RECUSADO: na URL dada nao encontrei o parametro `code`.", file=sys.stderr)
                return 1
        else:
            codigo = obter_code_interactivo(argumentos, valores["client_id"])
        if not codigo:
            print("nao recebi nenhum `code` — nao autorizei nem gravei nada.", file=sys.stderr)
            return 1

        # 3) Troca do `code` pelos tokens.
        print("")
        print("a trocar o `code` pelos tokens no endpoint do venue...")
        resultado = trocar_codigo_por_tokens(
            argumentos.token_url, valores["client_id"], valores["client_secret"], codigo, argumentos.redirect_uri
        )
        if isinstance(resultado, Recusa):
            print(f"RECUSADO pela troca de tokens: {resultado.motivo} — {resultado.porque}", file=sys.stderr)
            return 1
        valores["access_token"] = resultado.access_token
        valores["refresh_token"] = resultado.refresh_token
        prazo = f" (o venue declarou validade de {resultado.expira_em_s} s)" if resultado.expira_em_s else ""
        print(f"tokens recebidos{prazo}.")

    # 4) Grava os QUATRO valores (um ficheiro por valor, modo 600, escrita atomica), mostrando so' a forma.
    #    O `--so-contas` NAO grava nada: ele so' LE' o que ja' esta' gravado e vai listar. Sem esta guarda, uma
    #    corrida de leitura pedia confirmacao para reescrever os quatro — e num terminal sem `stdin` isso era um
    #    `EOFError` em vez de uma listagem (medido a 05/10/2026, na primeira corrida do dono).
    if not argumentos.so_contas:
        print("")
        print(f"Vou gravar estes quatro valores em {pasta} (modo 600):")
        for campo in CAMPOS:
            ok, texto = forma(campo, valores[campo])
            marca = "ok" if ok else "FORMA ESTRANHA"
            print(f"  {prefixo}{campo}.key : {descrever_forma(valores[campo])} [{marca}]")
        if not argumentos.forcar and any(not forma(c, valores[c])[0] for c in CAMPOS):
            print("RECUSADO: algum valor nao tem a forma do campo; use --forcar se for mesmo assim.", file=sys.stderr)
            return 1
        if not argumentos.nao_interativo:
            resposta = input("gravar os quatro? (s/n) ").strip().lower()
            if resposta not in ("s", "sim", "y", "yes"):
                print("nao gravei nada.")
                return 1

        for campo in CAMPOS:
            origem = "reutilizado" if campo in ("client_id", "client_secret") and ler_valor(caminhos[campo]) == valores[campo] else "oauth"
            destino = gravar_um(campo, valores[campo], pasta, prefixo, origem, historico)
            impressao = hashlib.sha256(valores[campo].encode("utf-8")).hexdigest()[:12]
            print(f"  gravado: {destino} (modo {oct(destino.stat().st_mode & 0o777)[2:]}, impressao {impressao}…)")

    # 5) A listagem de contas, pelo embrulho da casa.
    if argumentos.sem_contas:
        print("")
        print("(--sem-contas) parei aqui. Para listar as contas: --so-contas")
        return 0

    print("")
    print(f"a abrir o embrulho da casa ({PASTA_DO_EMBRULHO / 'transporte.py'}) em {argumentos.url_da_api} para listar contas...")
    try:
        embrulho = abrir_o_embrulho(argumentos.url_da_api, valores["client_id"], valores["client_secret"])
    except Exception as erro:
        print(f"RECUSADO: nao consegui importar o embrulho do transporte: {type(erro).__name__}: {erro}", file=sys.stderr)
        return 1

    abertura = embrulho.abrir({"access_token": caminhos["access_token"], "refresh_token": caminhos["refresh_token"]})
    if not getattr(abertura, "ok", False):
        print(f"RECUSADO ao abrir o transporte: {getattr(abertura, 'motivo', '')} — {getattr(abertura, 'porque', '')}", file=sys.stderr)
        return 1
    print(f"transporte: {abertura.valor}")

    try:
        resumo = listar_contas(embrulho, valores["access_token"])
    finally:
        embrulho.fechar()
    if isinstance(resumo, Recusa):
        print(f"RECUSADO ao listar as contas: {resumo.motivo} — {resumo.porque}", file=sys.stderr)
        return 1

    print("")
    print(f"contas deste cTID ({len(resumo)}):")
    for linha in resumo:
        print(f"  ctidTraderAccountId {linha['conta']} : {linha['ambiente'].upper()} | login {linha['login']} | corretora {linha['corretora']}")
    demonstracao = sum(1 for linha in resumo if not linha["e_real"])
    reais = sum(1 for linha in resumo if linha["e_real"])
    print(f"  -> {demonstracao} de demonstracao, {reais} reais")
    print("")
    print("A conta escolhida poem-se na ficha, no campo `ctid_trader_account_id` (a demo para o ensaio).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
