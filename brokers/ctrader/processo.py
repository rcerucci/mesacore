"""O PROCESSO do conector cTrader: a costura entre o contrato neutro e o venue.

    python3 brokers/ctrader/processo.py --ficha @brokers/ctrader/ctrader-demo.conector.json --ao-vivo

PORQUE EXISTE. O operador arranca-o, como arranca o conector 1, e a partir daqui e' tudo mensagem: o contrato
neutro entra pelo `stdin` (uma linha, um envelope) e as respostas saem pelo `stdout`, tambem uma linha por
mensagem. O DIAGNOSTICO nunca entra na costura: vai para o `stderr`, porque quem le' o `stdout` le' contrato.

AS PORTAS DO ARRANQUE, e a ordem delas. O criterio e' o custo e o alcance: o que se sabe sem falar com ninguem
vem primeiro; o que exige ir ao venue vem no fim. O dono le' o PRIMEIRO obstaculo, nao o terceiro:

    1. ficha                — um processo por (corretora, conta), e a ficha diz qual
    2. versao_do_contrato   — igualdade EXACTA antes de qualquer envio (D7)
    3. uma_conta            — uma ligacao, uma chave, UMA conta
    4. ambiente_e_rede      — o ambiente declarado e a rede nao podem discordar
    5. chave                — a credencial entra por REFERENCIA, e a falta dela e' recusa nomeada
    6. ligacao              — o estado vem do protocolo do venue, e tem DUAS camadas aqui
    7. sonda_e_manifesto    — o que o venue nao declarar RECUSA, nunca vira `true` por omissao
    8. identidade           — o `ctidTraderAccountId` que o venue devolve e' o da ficha, e os direitos dela

Um arranque que nao passa as oito NAO SERVE: sai com codigo 2 e nao escreve uma unica linha na costura. Uma
porta que ainda nao tem como ser corrida declara-se `nao_corrida` com o motivo nomeado — nunca `passou`.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
sys.path.insert(0, str(RAIZ / "contracts" / "esqueleto"))
sys.path.insert(0, str(AQUI))

from framing import validar, versao_vigente  # noqa: E402  (o caminho tem de ser posto primeiro)

import credencial as Cr  # noqa: E402
import ficha as Fi  # noqa: E402

PORTAS: tuple[tuple[str, str], ...] = (
    ("ficha", "FR-019: um processo por (corretora, conta), e a ficha diz qual — sem ficha legivel nao ha conector"),
    ("versao_do_contrato", "D7/RN-E18: a versao do contrato confere-se por igualdade EXACTA antes de qualquer envio"),
    ("uma_conta", "FR-019/FR-022: uma ligacao, uma chave, UMA conta — um pedido que nomeie outra conta nao entra"),
    ("ambiente_e_rede", "o ambiente declarado e a rede nao podem discordar: e' assim que um ensaio passa a operar a serio"),
    ("chave", "FR-023/RN-C20: a credencial entra por REFERENCIA e a falta dela e' uma recusa NOMEADA"),
    ("ligacao", "FR-020/FR-021: o estado da ligacao e' o do protocolo do venue, e aqui tem DUAS camadas (transporte e sessao da conta)"),
    ("sonda_e_manifesto", "US1/FR-051: a sonda le' o venue e o manifesto e' publicado — o que o venue nao declarar RECUSA"),
    ("identidade", "FR-047/FR-049/RN-CT8: o id que o venue devolve e' o da ficha, e os direitos da conta sao lidos. E' a ULTIMA porque exige a leitura mais recente"),
)

#: Os motivos que fazem uma porta ficar `nao_corrida` (e nao `falhou`): a conferencia existe, mas esta ponta ainda
#: nao tem como a correr. Sao declarados, e nao maquilhados.
PORTA_SEM_COMO_CORRER = "conferencia_por_escrever"


def diag(**campos: object) -> None:
    """O canal de quem le' esta ponta. Nunca entra na costura (o `stdout` e' do contrato)."""
    print(json.dumps(campos, ensure_ascii=False), file=sys.stderr, flush=True)


@dataclass
class ResultadoDaPorta:
    porta: str
    veredicto: str  # "passou" | "falhou" | "nao_corrida"
    porque: str
    motivo: str | None = None


@dataclass
class Arranque:
    ok: bool
    portas: list[ResultadoDaPorta] = field(default_factory=list)
    ficha: Fi.Ficha | None = None
    credencial: Cr.Trio | None = None


def _falhou(portas: list[ResultadoDaPorta], porta: str, motivo: str, porque: str) -> Arranque:
    portas.append(ResultadoDaPorta(porta=porta, veredicto="falhou", motivo=motivo, porque=porque))
    return Arranque(ok=False, portas=portas)


def arrancar(caminho_da_ficha: Path) -> Arranque:
    """Corre as oito portas, por ordem, e para na primeira que falha. Nao levanta: devolve o que decidiu."""
    portas: list[ResultadoDaPorta] = []

    # ---- porta 1: a ficha ---------------------------------------------------------------------------------
    lida = Fi.ler_ficha(caminho_da_ficha)
    if isinstance(lida, Fi.Recusa):
        return _falhou(portas, "ficha", lida.motivo, lida.porque)
    ficha = lida
    portas.append(
        ResultadoDaPorta(
            porta="ficha",
            veredicto="passou",
            porque=(
                f"ficha `{ficha.conector}` legivel: venue {ficha.venue}, ambiente {ficha.ambiente}, UMA conta "
                f"`{ficha.conta}`, {len(ficha.instrumentos)} instrumento(s) do mandato "
                f"({', '.join(ficha.instrumentos)})"
            ),
        )
    )

    # ---- porta 2: a versao do contrato --------------------------------------------------------------------
    vigente = versao_vigente()
    if ficha.contrato != vigente:
        return _falhou(
            portas,
            "versao_do_contrato",
            "versao_do_contrato_divergente",
            f"a ficha declara {ficha.contrato} e a versao vigente e' {vigente} — igualdade EXACTA, nunca "
            "«compativel» (D7). Nada sai",
        )
    portas.append(
        ResultadoDaPorta(
            porta="versao_do_contrato",
            veredicto="passou",
            porque=f"a ficha e a versao vigente concordam: contrato {vigente} (conferido em contracts/versao.json)",
        )
    )

    # ---- porta 3: uma conta -------------------------------------------------------------------------------
    # O que a porta da ficha confere e' a FORMA do documento; o que esta confere e' a REGRA: uma conta, e nenhum
    # lugar para uma segunda. (`contas`, uma lista, nem chega aqui: a ficha e' fechada e recusa-a.)
    if ficha.conta.strip() == "":
        return _falhou(portas, "uma_conta", "campo_obrigatorio_ausente", "a ficha declara `conta` vazia")
    portas.append(
        ResultadoDaPorta(
            porta="uma_conta",
            veredicto="passou",
            porque=f"uma conta por processo: {ficha.conta} (um pedido que nomeie outra conta nao atravessa este envelope fechado)",
        )
    )

    # ---- porta 4: o ambiente e a rede ---------------------------------------------------------------------
    # A conferencia vive em `ficha.py` (o endereco e o ambiente tem de dizer o mesmo); aqui REGISTA-SE o que ela
    # decidiu, porque o dono le' as portas e nao o codigo da ficha.
    portas.append(
        ResultadoDaPorta(
            porta="ambiente_e_rede",
            veredicto="passou",
            porque=f"o ambiente `{ficha.ambiente}` e o endereco `{ficha.url_da_api}` concordam",
        )
    )

    # ---- porta 5: a chave ---------------------------------------------------------------------------------
    # QUATRO valores, um por ficheiro `.key` (o venue reescreve dois deles quando roda o par). O id da conta vem
    # da FICHA (nao e' segredo) e e' contra ele que a porta 8 compara o que o venue devolver.
    credencial = Cr.carregar_trio(ficha.credencial_referencia, ficha.credencial_arquivos)
    if isinstance(credencial, Cr.Recusa):
        return _falhou(portas, "chave", credencial.motivo, credencial.porque)
    portas.append(
        ResultadoDaPorta(
            porta="chave",
            veredicto="passou",
            porque=(
                f"a credencial `{ficha.credencial_referencia}` traz os quatro valores, um por ficheiro "
                f"({credencial.de}), e a ficha declara a conta {ficha.conta} "
                f"({ficha.ctid_trader_account_id}) — nenhum valor entra no registo (FR-023)"
            ),
        )
    )

    # ---- portas 6, 7 e 8: exigem o venue a falar ----------------------------------------------------------
    # Ficam declaradas como `nao_corrida` COM MOTIVO, ate' o transporte e a sonda existirem. Nunca `passou`: uma
    # porta que nao se correu e' uma promessa, e o arranque so' serve com as oito passadas.
    for porta in ("ligacao", "sonda_e_manifesto", "identidade"):
        portas.append(
            ResultadoDaPorta(
                porta=porta,
                veredicto="nao_corrida",
                motivo=PORTA_SEM_COMO_CORRER,
                porque=(
                    "esta ponta ainda nao fala com o venue (o transporte e a sonda estao por escrever): a "
                    "conferencia existe e nao se correu — nao se declara «passou» o que nao se mediu"
                ),
            )
        )

    return Arranque(ok=False, portas=portas, ficha=ficha, credencial=credencial)


def _responder(tipo: str, correlacao: str, carga: dict[str, object]) -> None:
    """Escreve UMA linha de contrato, e so' depois de o contrato a aceitar.

    A regra e' a mesma do conector 1: nao se publica uma mensagem que o contrato recusa. Se a mensagem nao passar,
    nao sai nada — e o diagnostico diz por que'.
    """
    linha = json.dumps({"contrato": versao_vigente(), "tipo": tipo, "id": correlacao, "carga": carga}, ensure_ascii=False)
    veredicto = validar(linha)
    if veredicto.get("veredicto") != "aceite":
        diag(etapa="resposta_nao_publicada", tipo=tipo, motivo=veredicto.get("motivo"), porque="o contrato recusou a resposta")
        return
    print(linha, flush=True)


def servir(arranque: Arranque) -> int:
    """Atende o `stdin` ate' ao fim do cano. Cada linha e' uma mensagem; cada resposta, uma linha."""
    with sys.stdin as entrada:
        for bruta in entrada:
            linha = bruta.rstrip("\n")
            if linha.strip() == "":
                continue
            veredicto = validar(linha)
            if veredicto.get("veredicto") != "aceite":
                # Enquadramento ou contrato: nao ha' a quem responder (um envelope invalido nao traz correlacao).
                diag(etapa="mensagem_recusada", motivo=veredicto.get("motivo"), detalhe=veredicto.get("detalhe"))
                continue

            mensagem = json.loads(linha)
            tipo = mensagem["tipo"]
            correlacao = mensagem["id"]
            carga = mensagem["carga"]

            if tipo == "boleta":
                # O desfecho diz `recusado` — e um `recusado` exige `motivo`, do conjunto FECHADO do contrato.
                # `capacidade_nao_declarada` e' o que aqui e' verdade: este processo nao declarou a capacidade de
                # servir (o arranque nao passou). O PORQUE, com as palavras todas, vai em `resposta_do_venue`.
                _responder(
                    "desfecho",
                    correlacao,
                    {
                        "classificacao": "recusado",
                        "motivo": "capacidade_nao_declarada",
                        "resposta_do_venue": {
                            "nota": "nenhuma ordem foi enviada",
                            "porque": "o arranque nao passou as oito portas: o processo nao serve, e nao declara a capacidade",
                        },
                    },
                )
                continue
            diag(
                etapa="tipo_que_este_processo_nao_serve",
                tipo=tipo,
                porque=(
                    "um conector serve o contrato NUMA direcao: recebe `boleta` e responde `desfecho`. O `comando` "
                    "e' da mesa — o vigia arranca este processo e mata-o por processo, nao por mensagem — e o "
                    "`mercado`, `manifesto` e `historico` sao mensagens DELE para a mesa, nunca da mesa para ele"
                ),
            )

    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="O conector cTrader: fala o contrato neutro de um lado e o venue do outro.")
    ap.add_argument("--ficha", required=True, help="caminho da ficha do conector (aceita o prefixo `@` do operador)")
    ap.add_argument("--casos", default=None, help="a bateria de casos do processo (o operador passa-a; a bancada le'-a)")
    ap.add_argument("--ao-vivo", action="store_true", help="fala com o venue a serio")
    ap.add_argument("--sonda", action="store_true", help="so' sonda e publica o manifesto, sem servir")
    ap.add_argument("--leitura-a-cada", type=int, default=None, help="intervalo das leituras de mercado (ms)")
    ap.add_argument("--prazo-do-venue-ms", type=int, default=None, help="prazo declarado para a resposta do venue")
    args = ap.parse_args(argv)

    caminho = Path(str(args.ficha).lstrip("@")).expanduser()
    if not caminho.is_absolute():
        caminho = RAIZ / caminho

    arranque = arrancar(caminho)

    for porta in arranque.portas:
        diag(
            etapa="porta",
            porta=porta.porta,
            veredicto=porta.veredicto,
            motivo=porta.motivo,
            porque=porta.porque,
        )

    if not arranque.ok:
        diag(
            etapa="arranque",
            veredicto="nao_sobe",
            porque="nem todas as portas passaram: o processo nao serve, e nao escreve uma linha na costura",
            portas=len(arranque.portas),
        )
        return 2

    if args.sonda:
        diag(etapa="sonda", veredicto="por_escrever", porque="a sonda ainda nao existe nesta ponta")
        return 2

    return servir(arranque)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
