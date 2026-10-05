"""OS CASOS DO CONTRATO DO cTrader NOS DOIS LADOS — o duble da mesa e este conector (T047).

O QUE ESTA BANCADA FAZ, e e' so' isto: pega' nos casos do contrato deste venue
(`casos-duble.json`), corre-os pelo **duble da mesa** (`contracts/mocks/mesa/main.py --papel conector`,
que confere a mensagem contra o envelope e o esquema do tipo) E pelo **lado do conector** (o motor do
contrato, `contracts/esqueleto/framing.py`, que e' o mesmo que o `desfecho.py` usa antes de publicar),
compara os DOIS veredictos caso a caso, e registra as duas contagens LADO A LADO. **Divergencia e' FALHA
NOMEADA**: a bancada diz QUAL caso, o que o DUBLE disse e o que o CONECTOR disse, e sai com codigo 1.

PORQUE DOIS LEITORES, E NAO UM. O duble da mesa re-escreveu a traducao do erro do esquema (de proposito:
uma traducao copiada nao provava nada — `main.py` di-lo). O motor do contrato faz a traducao dele, do lado
dele. Se os dois nao concordarem, os MESMOS casos dao veredictos diferentes — e e' isso que esta bancada
apanha. Um so' leitor nunca se contradiz; dois, sim.

DE ONDE VEM O PAYLOAD. Nao ha' credencial e nao ha' rede: os casos VALIDOS (`fonte: "venue"`) nao trazem o
desfecho escrito — eles nomeiam o caso de `desfecho.casos.json` (payload do venue EM DADO) e esta bancada
MONTA o desfecho por `desfecho_do_evento`/`desfecho_do_silencio`. Assim o que atravessa a fronteira e' o
que o CONECTOR produz, e nao uma copia que envelhece. Os ADVERSARIOS (`fonte: "declarado"`) trazem a
`resposta_do_plugin` escrita a mao — um payload torto nao se produz de proposito.

O QUE NAO ENTRA, e di-lo: o caso em que a mensagem tem o `tipo` ERRADO. O duble confere o PAPEL (um
conector responde `desfecho`; um `boleta` e' `tipo_invalido`), e o motor do contrato confere o ENVELOPE
(que aceita qualquer tipo do contrato e valida a carga pelo esquema dele). Os dois medem coisas diferentes
de proposito, e compará-los ali daria uma divergencia que NAO e' defeito de nenhum — por isso esse caso
fica fora, dito aqui em vez de escondido.

A PROVA NEGATIVA E' UM PASSO, e nao um caso (a regra da casa: uma bancada que nunca reprovou nao mediu
nada). Ela injecta o defeito no lado do CONECTOR — um veredicto ESTRAGADO de proposito — corre a MESMA
comparacao, e exige que ela fique VERMELHA a NOMEAR o caso, com os dois veredictos. A linha
`{"negativa": …}` sai no proprio `stdout`. Se o defeito NAO puser a bancada a DIVERGIR, a bancada di-lo
pelo nome e sai com codigo 1: a negativa vacuosa e' uma divergencia DELA.

Uso:  cd brokers/ctrader && .venv/bin/python casos/correr-duble.py [--prova-negativa]
      --prova-negativa  estraga de proposito o veredicto do conector de um caso e corre a bancada NORMAL:
                        ela fica VERMELHA a nomear o caso, e o processo sai 1 (a prova de que a comparacao
                        detecta a divergencia — e nao a inventa).
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent.parent
CONTRATOS = RAIZ / "contracts"

# O caminho do contrato primeiro: o `framing` e o `desfecho` leem-no daqui (a mesma regra do `correr.py`).
sys.path.insert(0, str(CONTRATOS / "esqueleto"))
sys.path.insert(0, str(AQUI.parent))

from framing import validar, versao_vigente  # noqa: E402  (o caminho tem de ser posto primeiro)

import desfecho as modulo_desfecho  # noqa: E402

CASOS_DUBLE = AQUI / "casos-duble.json"
CASOS_DO_VENUE = AQUI / "desfecho.casos.json"
CORRER_DO_CONECTOR = AQUI / "correr.py"
MESA_DUBLE = CONTRATOS / "mocks" / "mesa" / "main.py"

#: O tipo da mensagem que o duble confere quando faz de mesa virada a um conector (o papel decide).
TIPO_DA_MENSAGEM = "desfecho"

#: A `fonte` declarada por um caso cujo payload e' escrito a mao (adversario). Qualquer OUTRA fonte e' o
#: NOME do caso de `desfecho.casos.json` de onde o payload deste venue e' MONTADO pelo conector.
FONTE_DECLARADA = "declarado"

#: Os tokens de versao — o MESMO resolver do duble (`contracts/mocks/mesa/main.py`) e do `conformidade.ts`.
TOKEN_VIGENTE = "$CONTRATO"
TOKEN_A_FRENTE = "$CONTRATO_A_FRENTE"
TOKEN_ATRAS = "$CONTRATO_ATRAS"


class TokenDeVersaoDesconhecido(Exception):
    """Um token de versao que ninguem sabe resolver. Recusa NOMEADA, nunca um texto a passar por versao."""


def _versao_deslocada(delta: int) -> str:
    """Uma versao DIFERENTE da vigente, como o duble a calcula (o numero do meio, ou a ultima casa)."""
    maior, menor, _ = (int(p) for p in versao_vigente().split("."))
    candidata = f"{maior}.{menor + delta}.0" if delta > 0 else f"{maior}.{max(0, menor - 1)}.0"
    return candidata if candidata != versao_vigente() else f"{maior}.{menor}.1"


def resolver_tokens_de_versao(valor: Any) -> Any:
    """Troca os tokens de versao pelos valores lidos de `contracts/versao.json`. Igual ao duble, de proposito."""
    if isinstance(valor, str):
        if valor == TOKEN_VIGENTE:
            return versao_vigente()
        if valor == TOKEN_A_FRENTE:
            return _versao_deslocada(1)
        if valor == TOKEN_ATRAS:
            return _versao_deslocada(-1)
        if valor.startswith("$CONTRATO"):
            raise TokenDeVersaoDesconhecido(f"token de versao desconhecido nos casos: {valor!r}")
        return valor
    if isinstance(valor, list):
        return [resolver_tokens_de_versao(v) for v in valor]
    if isinstance(valor, dict):
        return {chave: resolver_tokens_de_versao(v) for chave, v in valor.items()}
    return valor


# -----------------------------------------------------------------------------------------------------------
# A MONTAGEM DO EVENTO DO VENUE. As mesmas regras do `correr.py`: o caso funde sobre a base, e o `sem`
# apaga (a ausencia mede-se apagando, nunca com um valor neutro). Sem isto, os payloads deste lado seriam
# uma copia — e a bancada mediria a copia, nao o que o conector produz.
# -----------------------------------------------------------------------------------------------------------


def _copiar(valor: Any) -> Any:
    if isinstance(valor, list):
        return [_copiar(item) for item in valor]
    if isinstance(valor, dict):
        return {chave: _copiar(item) for chave, item in valor.items()}
    return valor


def _fundir(base: Any, mudanca: Any) -> Any:
    """A mudanca do caso sobre a base, com objectos novos (a base nunca se altera). Lista substitui inteira."""
    saida: dict[str, Any] = _copiar(base) if isinstance(base, dict) else {}
    if not isinstance(mudanca, dict):
        return saida
    for chave, valor in mudanca.items():
        anterior = saida.get(chave)
        if isinstance(valor, dict) and isinstance(anterior, dict):
            saida[chave] = _fundir(anterior, valor)
        else:
            saida[chave] = _copiar(valor)
    return saida


def _apagar(obj: Any, caminho: str) -> None:
    partes = caminho.split(".")
    alvo = obj
    for passo in partes[:-1]:
        if isinstance(alvo, dict) and passo in alvo:
            alvo = alvo[passo]
        else:
            return
    if isinstance(alvo, dict) and partes[-1] in alvo:
        del alvo[partes[-1]]


def _mensagem_do_venue(caso_do_venue: dict[str, Any], evento_base: dict[str, Any], resolucao_base: dict[str, Any], identificador: str) -> dict[str, Any]:
    """O desfecho do conector para um caso do venue EM DADO: `desfecho_do_evento` / `desfecho_do_silencio`.

    Nao se escreve aqui nenhuma classificacao nem nenhum numero: o desfecho sai do modulo PURO do conector,
    e e' ele — tal como saiu — que atravessa os dois lados.
    """
    if caso_do_venue.get("via") == "silencio":
        carga = modulo_desfecho.desfecho_do_silencio(
            _copiar(resolucao_base), caso_do_venue["prazo_declarado_ms"]
        )
    else:
        evento = _fundir(evento_base, caso_do_venue.get("evento"))
        sem = caso_do_venue.get("sem")
        if sem is not None:
            for caminho in sem:
                _apagar(evento, caminho)
        carga = modulo_desfecho.desfecho_do_evento(evento, _copiar(resolucao_base))
    return {"contrato": versao_vigente(), "tipo": TIPO_DA_MENSAGEM, "id": identificador, "carga": carga}


# -----------------------------------------------------------------------------------------------------------
# O LADO DO CONECTOR. O veredicto do conector sobre a MENSAGEM e' o do MOTOR DO CONTRATO (`framing.validar`)
# — o mesmo que o `desfecho.py` chama (`_exigir_do_contrato`) antes de publicar. E' por isso que comparar
# os dois lados mede alguma coisa: sao duas traducoes independentes do MESMO esquema.
# -----------------------------------------------------------------------------------------------------------


def veredicto_do_conector(mensagem: dict[str, Any]) -> dict[str, Any]:
    """O veredicto do MOTOR DO CONTRATO sobre a mensagem montada (o lado do conector)."""
    return validar(json.dumps(mensagem, ensure_ascii=False))


def veredicto_do_duble(casos_dubl: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Corre o DUBLE DE MESA (`--papel conector`) sobre os casos e devolve o veredicto dele por nome.

    O duble le a `resposta_do_plugin` de cada caso e confere-a contra o envelope e o esquema. Devolve, por
    caso, `{veredicto, motivo, esperado_ok}` — o `esperado_ok` e' a conferencia do proprio duble contra o
    que o caso DECLARA.
    """
    ficheiro = {
        "nota": "temporario da bancada correr-duble.py (T047): o duble le os MESMOS casos que o conector",
        "mensagem": TIPO_DA_MENSAGEM,
        "casos": [
            {
                "nome": caso["nome"],
                "veredicto_esperado": caso["veredicto_esperado"],
                "motivo_esperado": caso["motivo_esperado"],
                "resposta_do_plugin": caso["mensagem"],
            }
            for caso in casos_dubl
        ],
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(ficheiro, tmp, ensure_ascii=False)
        caminho = tmp.name
    try:
        processo = subprocess.run(
            [sys.executable, str(MESA_DUBLE), "--papel", "conector", "--casos", caminho],
            capture_output=True,
            text=True,
        )
    finally:
        Path(caminho).unlink(missing_ok=True)

    por_caso: dict[str, dict[str, Any]] = {}
    for linha in processo.stdout.splitlines():
        linha = linha.strip()
        if not linha.startswith("{"):
            continue
        try:
            item = json.loads(linha)
        except json.JSONDecodeError:
            continue
        if "caso" in item:
            por_caso[item["caso"]] = {
                "veredicto": item.get("veredicto"),
                "motivo": item.get("motivo"),
                "esperado_ok": item.get("esperado_ok"),
            }
    if not por_caso:
        raise RuntimeError(
            f"o duble de mesa nao devolveu nenhum caso (exit {processo.returncode}); stderr: "
            f"{processo.stderr.strip()[:200]}"
        )
    return por_caso


# -----------------------------------------------------------------------------------------------------------
# A COMPARACAO. O que o duble disse contra o que o conector disse, caso a caso. Divergencia e' FALHA NOMEADA.
# -----------------------------------------------------------------------------------------------------------


def comparar(
    casos: list[dict[str, Any]],
    do_duble: dict[str, dict[str, Any]],
    funcao_do_conector: Any = veredicto_do_conector,
) -> list[str]:
    """Compara os dois veredictos caso a caso. Devolve a lista das divergencias, NOMEADAS.

    A `funcao_do_conector` e' um parametro para a PROVA NEGATIVA poder injectar o defeito sem tocar no
    modulo: o defeito e' um veredicto do conector ESTRAGADO, e a comparacao tem de o apanhar.
    """
    divergencias: list[str] = []
    for caso in casos:
        nome = caso["nome"]
        conector = funcao_do_conector(caso["mensagem"])
        duble = do_duble.get(nome)
        if duble is None:
            divergencias.append(f"{nome}: o duble de mesa nao devolveu o caso")
            continue
        if duble["esperado_ok"] is not True:
            divergencias.append(
                f"{nome}: o duble divergiu do que o proprio caso declara "
                f"(duble {duble['veredicto']}/{duble['motivo']} contra declarado "
                f"{caso['veredicto_esperado']}/{caso['motivo_esperado']})"
            )
            continue
        if (duble["veredicto"], duble["motivo"]) != (conector["veredicto"], conector.get("motivo")):
            divergencias.append(
                f"{nome}: o DUBLE disse {duble['veredicto']}/{duble['motivo']} e o CONECTOR disse "
                f"{conector['veredicto']}/{conector.get('motivo')}"
            )
    return divergencias


# -----------------------------------------------------------------------------------------------------------
# A PROVA NEGATIVA. Estraga o veredicto do CONECTOR de proposito e exige o VERMELHO a nomear o caso.
# -----------------------------------------------------------------------------------------------------------


def _anunciar_negativa(nome: str, caso_vigiado: str, divergencias: list[str]) -> list[str]:
    """A linha da negativa no `stdout`, e o problema da bancada quando o defeito NAO a puser VERMELHA.

    Um caso que continua concordante sob o defeito e' a negativa a FALHAR: se o veredicto estragado nao
    divergir, a bancada mede o dado, e nao a regra (um caso que nunca reprovou nao mediu nada).
    """
    nomeou = any(divergencia.startswith(caso_vigiado + ":") for divergencia in divergencias)
    print(
        json.dumps(
            {
                "negativa": nome,
                "o_caso_vigiado_ficou": "VERMELHO" if nomeou else "VERDE",
                "caso": caso_vigiado,
                "divergencia": next(
                    (d for d in divergencias if d.startswith(caso_vigiado + ":")), None
                ),
            },
            ensure_ascii=False,
        )
    )
    if nomeou:
        return []
    return [
        f"a negativa `{nome}` NAO ficou VERMELHA: com o veredicto do conector estragado, o caso "
        f"`{caso_vigiado}` continuou a concordar com o duble — a bancada nao mede o que diz medir."
    ]


def _conector_mentiroso(caso_alvo: str) -> Any:
    """O DEFEITO: um veredicto do CONECTOR estragado de proposito, so' no caso `caso_alvo`.

    Devolve uma funcao com a mesma forma de `veredicto_do_conector`, que MENTE no caso vigiado (diz
    `recusado/campo_desconhecido` onde o motor diz `aceite`) e diz a verdade em todos os outros. Serve a
    negativa inline E o modo `--prova-negativa` — o defeito e' um so', e vem do mesmo sitio.
    """
    def _mentiroso(mensagem: dict[str, Any]) -> dict[str, Any]:
        if mensagem.get("id") == caso_alvo:
            return {"veredicto": "recusado", "motivo": "campo_desconhecido"}
        return veredicto_do_conector(mensagem)
    return _mentiroso


def negativa_veredicto_estragado(
    casos: list[dict[str, Any]], do_duble: dict[str, dict[str, Any]]
) -> list[str]:
    """O DEFEITO: o veredicto do CONECTOR de um caso estragado de proposito. A bancada TEM de ficar VERMELHA.

    O caso vigiado e' o primeiro dos VALIDOS (a mensagem que o conector produziu, declarada valida). O
    defeito troca-lhe o veredicto por `recusado/campo_desconhecido`, que o duble nao vai dar — e a
    comparacao tem de o apanhar, a NOMEAR o caso com os dois veredictos.
    """
    caso_vigiado = casos[0]["nome"]
    divergencias = comparar(casos, do_duble, _conector_mentiroso(caso_vigiado))
    return _anunciar_negativa("veredicto-estragado-do-conector", caso_vigiado, divergencias)


# -----------------------------------------------------------------------------------------------------------
# A LEITURA DOS CASOS E A CORRIDA.
# -----------------------------------------------------------------------------------------------------------


def _carregar_casos() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Le `casos-duble.json` e resolve os tokens de versao; devolve os casos ja' com o payload MONTADO.

    Cada caso devolvido tem `nome`, `mensagem` (o desfecho, montado ou declarado), `veredicto_esperado` e
    `motivo_esperado` (o que o CONECTOR deve dizer — a conferencia dos dois lados e' contra isto).
    """
    conteudo = resolver_tokens_de_versao(json.loads(CASOS_DUBLE.read_text(encoding="utf-8")))
    venue = json.loads(CASOS_DO_VENUE.read_text(encoding="utf-8"))
    # OS TRES BLOCOS SAO OBRIGATORIOS. Uma fonte que nao os traga PARA a bancada (a mesma regra da
    # descoberta do `correr.py`): um `{}` por omissao mediria um payload vazio em vez de parar.
    for obrigatorio in ("casos", "evento_base", "resolucao_base"):
        if obrigatorio not in venue:
            raise RuntimeError(
                f"{CASOS_DO_VENUE.name}: falta o bloco `{obrigatorio}` — a bancada PARA em vez de medir "
                "um payload que nao esta' la'"
            )
    por_nome = {caso["caso"]: caso for caso in venue["casos"]}
    evento_base = venue["evento_base"]
    resolucao_base = venue["resolucao_base"]

    casos: list[dict[str, Any]] = []
    for caso in conteudo["casos"]:
        fonte = caso.get("fonte")
        if fonte == FONTE_DECLARADA:
            # ADVERSARIO: o payload torto e' escrito a mao no proprio caso (nao se produz de proposito).
            mensagem = caso["resposta_do_plugin"]
        else:
            # VALIDO (payload deste venue): a `fonte` NOMEIA o caso de `desfecho.casos.json`, e o desfecho e'
            # MONTADO aqui pelo modulo PURO do conector — o que atravessa a fronteira e' o que ele produz.
            origem = por_nome.get(fonte)
            if origem is None:
                raise RuntimeError(
                    f"{caso['nome']}: a fonte `{fonte}` nao existe em {CASOS_DO_VENUE.name} — a bancada "
                    "PARA em vez de medir um payload que ja' nao esta' la'"
                )
            mensagem = _mensagem_do_venue(origem, evento_base, resolucao_base, caso["nome"])
        casos.append(
            {
                "nome": caso["nome"],
                "mensagem": mensagem,
                "veredicto_esperado": caso["veredicto_esperado"],
                "motivo_esperado": caso["motivo_esperado"],
            }
        )
    return casos, conteudo


def _correr_conector_offline() -> str:
    """A contagem do conector na SUA propria bancada offline (`correr.py`), para o registo lado a lado."""
    try:
        processo = subprocess.run(
            [sys.executable, str(CORRER_DO_CONECTOR)], capture_output=True, text=True, cwd=str(AQUI.parent)
        )
    except Exception as erro:  # noqa: BLE001
        return f"nao correu ({type(erro).__name__}: {erro})"
    ultima = [l for l in processo.stdout.splitlines() if l.strip()]
    return ultima[-1].strip() if ultima else f"sem resumo (exit {processo.returncode})"


def main(argv: list[str]) -> int:
    prova_negativa = "--prova-negativa" in argv
    print("=== os casos do contrato do cTrader nos DOIS lados (duble da mesa + conector) ===")
    print(f"contrato vigente: {versao_vigente()} (lido de contracts/versao.json)")
    print(f"casos: brokers/ctrader/casos/casos-duble.json")
    print(f"fonte do venue (payload em dado): brokers/ctrader/casos/desfecho.casos.json")

    try:
        casos, _ = _carregar_casos()
    except (TokenDeVersaoDesconhecido, RuntimeError) as erro:
        print(f"correr-duble: RECUSADO — {erro}", file=sys.stderr)
        return 2

    do_duble = veredicto_do_duble(casos)

    # O MODO `--prova-negativa` (o defeito INJECTADO no caminho real): estraga o veredicto do conector de um
    # caso de propósito e corre a bancada NORMAL — ela tem de ficar VERMELHA a NOMEAR o caso, e o processo sai
    # 1. E' a prova de que a comparacao detecta a divergencia, e nao de que ela existe por construcao.
    funcao_do_conector = veredicto_do_conector
    if prova_negativa:
        caso_alvo = casos[0]["nome"]
        funcao_do_conector = _conector_mentiroso(caso_alvo)
        print(f"\n*** PROVA NEGATIVA: o veredicto do CONECTOR do caso `{caso_alvo}` estragado de proposito ***")

    # O CASO A CASO: uma linha por caso, com os dois veredictos. E' o rasto cru da corrida.
    print()
    divergencias = comparar(casos, do_duble, funcao_do_conector)
    divergentes = set(divergencia.split(":", 1)[0] for divergencia in divergencias)
    for caso in casos:
        nome = caso["nome"]
        duble = do_duble.get(nome)
        conector = funcao_do_conector(caso["mensagem"])
        marca = "DIVERGE" if nome in divergentes else "ok     "
        retrato_do_duble = (
            f"{duble['veredicto']}/{duble['motivo']}" if duble is not None else "AUSENTE"
        )
        print(
            f"  {marca} {nome:52s} duble {retrato_do_duble} · "
            f"conector {conector['veredicto']}/{conector.get('motivo')}"
        )
        if nome in divergentes:
            print(f"          -> {next(d for d in divergencias if d.startswith(nome + ':'))}")

    # A NEGATIVA: injecta o defeito e exige o VERMELHO. Nao entra na contagem dos casos.
    print()
    negativas_divergentes = 0
    try:
        problemas_da_negativa = negativa_veredicto_estragado(casos, do_duble)
    except Exception as erro:  # noqa: BLE001  (uma negativa que levanta e' divergencia DELA)
        problemas_da_negativa = [f"a negativa levantou: {type(erro).__name__}: {erro}"]
        print(json.dumps({"negativa": "veredicto-estragado-do-conector", "veredicto": "DIVERGE", "problemas": problemas_da_negativa}, ensure_ascii=False))
    if problemas_da_negativa:
        negativas_divergentes += 1

    # AS DUAS CONTAGENS, LADO A LADO. O lado do conector e o do duble correm os MESMOS casos; o `correr.py`
    # e' a bancada offline deste conector, registada ao lado para se ver que ela nao ficou atras.
    total = len(casos)
    ok_duble = 0
    for caso in casos:
        duble = do_duble.get(caso["nome"])
        if duble is not None and duble["esperado_ok"] is True:
            ok_duble += 1
    ok_conector = total - len(divergentes)
    offline = _correr_conector_offline()

    print()
    print(f"lado DUBLE (mesa, --papel conector): {total} casos · {ok_duble} ok · {len(divergentes)} divergentes")
    print(f"lado CONECTOR (framing.py, o motor do desfecho): {total} casos · {ok_conector} ok · {len(divergentes)} divergentes")
    print(f"conector offline (correr.py, os casos em dado deste venue): {offline}")

    resumo = (
        f"ctrader/duble: {total} casos · 0 divergentes · duble {ok_duble}/{total} · conector {ok_conector}/{total}"
        if not divergencias
        else f"ctrader/duble: {total} casos · {len(divergentes)} DIVERGENTES"
    )
    if negativas_divergentes > 0:
        resumo += f" · NEGATIVAS DIVERGENTES: {negativas_divergentes}"
    print(resumo)
    return 1 if divergencias or negativas_divergentes > 0 else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
