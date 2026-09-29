#!/usr/bin/env python3
"""Mock de conector — a ponta que TRADUZ e TRANSPORTA, e so isso (RN-E4).

Le uma boleta (unidades neutras) e devolve, por esta ordem:

  1. a RESOLUCAO — o que vai enviar, ANTES de enviar (RN-C10);
  2. o DESFECHO — o que aconteceu (RN-C2).

    echo '<boleta>' | uv run python contracts/mocks/conector/main.py
    ... --desfecho parcial | recusado | desconhecido
    ... --silencioso          # nao responde: a mesa tem de registar DESCONHECIDO (RN-T7.1)
    ... --preco 1.05000       # muda o preco simulado (para provocar a recusa por minimo)
    ... --manifesto outro.json # confere contra OUTRO manifesto (o de omissao e o fixture ao lado)

Regras que este mock tem de cumprir, e que se veem no codigo:

  - RECUSA em vez de arredondar (RN-C9): se o minimo do instrumento obrigar a mais risco do
    que a banda autorizada, nao ha ordem — ha recusa COM MOTIVO.
  - Nada de adaptar em silencio: capacidade que o manifesto nao declara e recusa, nao
    improviso (RN-C7).
  - Dinheiro em DECIMAL, nunca em virgula flutuante (D4).
  - O conector nao decide se se deve operar: nao ve estrategia, mandato nem fichas. Se um dia
    precisar de ver, o contrato esta errado.

EMENDA 1.4.0 do contrato (medida contra o venue; ver specs/004-conector-hyperliquid/relatorios/
emenda-1.4.0.txt). O campo que aqui se chamava `teto_de_valor_por_ordem` carregava o MINIMO de valor por
ordem do venue e era usado como TECTO (`nocional > teto`): recusava exactamente os nocionais que o venue
aceita e deixava passar os que ele recusa. Agora:

  - `minimo_de_valor_por_ordem` e o PISO: nocional ABAIXO dele RECUSA (`valor_abaixo_do_minimo_do_venue`);
    nocional IGUAL ao piso PASSA (um minimo e um piso, nao um «acima de»);
  - `maximo_de_valor_por_ordem` e o TECTO, e so existe quando o venue o declara (aditivo): ausente nao e
    «ilimitado», e nao medido — e nao se recusa por um limite que ninguem escreveu;
  - o escalao de alavancagem passou a declarar o limite INFERIOR (`de`, o primeiro a zero, como o venue o
    da), e o escalao de um valor e o de maior `de` que nao o excede; um valor que escalao nenhum cubra
    RECUSA em vez de cair na maxima unica por omissao;
  - um instrumento que o manifesto declare `deslistado` RECUSA (`instrumento_deslistado_no_venue`).
"""

from __future__ import annotations

import json
import sys
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from pathlib import Path

import venue

AQUI = Path(__file__).resolve().parent
CONTRATOS = AQUI.parent.parent

CENTAVO = Decimal("0.01")


def ler_json(caminho: Path) -> dict:
    with caminho.open(encoding="utf-8") as ficheiro:
        return json.load(ficheiro)


def argumento(nome: str) -> str | None:
    if nome in sys.argv:
        indice = sys.argv.index(nome)
        if indice + 1 < len(sys.argv):
            return sys.argv[indice + 1]
    return None


def quantizar(valor: Decimal, quantum: Decimal, modo: str = ROUND_HALF_UP) -> Decimal:
    return valor.quantize(quantum, rounding=modo)


def emitir(carga: dict, identificador: str) -> None:
    envelope = {
        "contrato": ler_json(CONTRATOS / "versao.json")["contrato"],
        "tipo": carga.pop("_tipo"),
        "id": identificador,
        "carga": carga,
    }
    print(json.dumps(envelope, separators=(",", ":"), ensure_ascii=False), flush=True)


def recusa(identificador: str, motivo: str, resposta: dict, resolucao: dict | None = None) -> int:
    """Recusa COM MOTIVO. A resolucao so entra quando existiu uma que pudesse ser enviada."""
    carga: dict = {"_tipo": "desfecho", "classificacao": "recusado", "motivo": motivo,
                   "resposta_do_venue": resposta}
    if resolucao is not None:
        carga["resolucao"] = resolucao
    emitir(carga, f"{identificador}/desfecho")
    return 0


def manifesto_em_vigor() -> dict:
    """O manifesto contra o qual se confere: o fixture ao lado, ou `--manifesto <ficheiro>`.

    O argumento existe para se poder conferir contra um manifesto DIFERENTE sem mexer no fixture —
    e o que permite provar a recusa por instrumento deslistado sem deixar um instrumento morto
    declarado no manifesto com que todas as outras contas correm.
    """
    indicado = argumento("--manifesto")
    caminho = Path(indicado) if indicado is not None else AQUI / "manifesto.json"
    documento = ler_json(caminho)
    return documento.get("carga", documento)


def main() -> int:
    manifesto = manifesto_em_vigor()
    conta = ler_json(AQUI / "conta.json")

    texto = sys.stdin.read().strip()
    if texto == "":
        print("[mock-conector] sem boleta na entrada", file=sys.stderr)
        return 2
    try:
        envelope = json.loads(texto)
    except json.JSONDecodeError:
        print("[mock-conector] a entrada nao e uma linha de JSON", file=sys.stderr)
        return 2
    if envelope.get("tipo") != "boleta":
        print(f"[mock-conector] esperava uma boleta, recebi tipo={envelope.get('tipo')}", file=sys.stderr)
        return 2

    boleta = envelope["carga"]
    identificador = envelope["id"]
    instrumento = boleta["instrumento"]

    # 1. o que o manifesto NAO declara, nao se improvisa (RN-C7)
    unidades = {item["simbolo"]: item for item in manifesto["instrumentos"]}
    if instrumento not in unidades:
        return recusa(
            identificador,
            "instrumento_desconhecido_no_manifesto",
            {"erro": "instrumento_sem_unidades_declaradas", "instrumento": instrumento},
        )
    unidade = unidades[instrumento]

    # DESLISTADO (emenda 1.4.0): um instrumento que o manifesto declare deslistado nao se opera — existir
    # no manifesto nao e estar a venda. Recusa nomeada, e antes das capacidades: nao se discute o que a
    # boleta pede para um instrumento que o venue deu por encerrado.
    if unidade.get("deslistado") is True:
        return recusa(
            identificador,
            "instrumento_deslistado_no_venue",
            {"erro": "instrumento_deslistado_no_venue", "instrumento": instrumento},
        )

    for capacidade, declaradas in (
        ("tipo", manifesto["tipos_de_ordem"]),
        ("parcial", manifesto["parcial_suportada"]),
    ):
        if boleta[capacidade] not in declaradas:
            return recusa(
                identificador,
                "capacidade_nao_declarada",
                {"erro": "capacidade_nao_declarada", "campo": capacidade, "valor": boleta[capacidade]},
            )

    preco = Decimal(argumento("--preco") or conta["precos"][instrumento])
    saldo = Decimal(conta["saldo"])

    # IDEMPOTENCIA (RN-C4): o manifesto declara-a, portanto o mock tem de a cumprir. Reenviar a
    # MESMA referencia devolve a ordem que ja esta la — e nao cria uma segunda. Um venue que declara
    # idempotencia e nao a cumpre esta a mentir no proprio manifesto.
    if manifesto["idempotencia"]:
        existente = venue.por_referencia(boleta["referencia_do_cliente"])
        if existente is not None:
            resolucao_existente = {
                "quantidade": existente["quantidade"],
                "nocional": str(quantizar(Decimal(existente["quantidade"]) * Decimal(existente["preco"]), CENTAVO)),
                "margem_empenhada": str(quantizar(
                    Decimal(existente["quantidade"]) * Decimal(existente["preco"])
                    / Decimal(boleta["alavancagem"]), CENTAVO)),
                "alavancagem_efectiva": boleta["alavancagem"],
                "preco_de_liquidacao": str(quantizar(
                    Decimal(existente["preco"]) * (1 - 1 / Decimal(boleta["alavancagem"])),
                    Decimal(unidade["tick"]))),
            }
            emitir({"_tipo": "resolucao", **resolucao_existente}, f"{identificador}/resolucao")
            # O silencio vale tambem aqui: e uma propriedade do VENUE (nao respondeu a tempo), nao
            # do caminho que se seguiu. Faltava — uma corrida sem resposta respondia.
            if "--silencioso" in sys.argv:
                return 0
            emitir({
                "_tipo": "desfecho",
                "classificacao": "aceite",
                "resolucao": resolucao_existente,
                "resposta_do_venue": {
                    "order_id": existente["order_id"],
                    "estado": "filled",
                    "duplicado": True,
                    "nota": "a mesma referencia ja tinha ordem; devolvida a existente, sem criar segunda",
                },
            }, f"{identificador}/desfecho")
            return 0

    pedida = Decimal(boleta["alavancagem"])
    maxima = Decimal(unidade["alavancagem_maxima"])
    if pedida > maxima:
        return recusa(
            identificador,
            "valor_fora_da_banda",
            {"erro": "alavancagem_acima_da_maxima", "pedida": str(pedida), "maxima": str(maxima)},
        )

    # 2. a traducao: percentagem do saldo -> quantidade, na unidade do instrumento
    nocional_pedido = quantizar(saldo * Decimal(boleta["saldo_pct"]) / Decimal(100) * pedida, CENTAVO)
    passo = Decimal(unidade["passo"])
    minimo = Decimal(unidade["minimo"])
    quantidade = quantizar(nocional_pedido / preco, passo, ROUND_DOWN)

    # RECUSAR, nunca arredondar para cima: arredondar para cima seria aumentar o risco do dono
    # sem ele ter autorizado. E exactamente o que o Principio II proibe (RN-C9).
    if quantidade < minimo:
        return recusa(
            identificador,
            "minimo_do_instrumento_acima_da_banda",
            {
                "erro": "minimo_do_instrumento_acima_da_banda",
                "quantidade_pedida": str(quantidade),
                "minimo": str(minimo),
                "nota": "a quantidade que caberia na banda e menor que o minimo do instrumento",
            },
        )

    nocional = quantizar(quantidade * preco, CENTAVO)
    resolucao = {
        "quantidade": str(quantidade),
        "nocional": str(nocional),
        "margem_empenhada": str(quantizar(nocional / pedida, CENTAVO)),
        "alavancagem_efectiva": str(pedida),
        "preco_de_liquidacao": str(quantizar(preco * (1 - 1 / pedida), Decimal(unidade["tick"]))),
    }

    # PISO de valor por ordem (emenda 1.4.0): ABAIXO dele o venue recusa a ordem, e IGUAL a ele passa —
    # um minimo e um piso, nao um «acima de». Este valor era lido como TECTO ate a 1.3.0 (`nocional >
    # teto`), o que recusava os nocionais grandes que o venue aceita e aceitava os pequenos que ele
    # recusa: os dois lados ao contrario.
    piso = Decimal(manifesto["minimo_de_valor_por_ordem"])
    if nocional < piso:
        return recusa(
            identificador,
            "valor_abaixo_do_minimo_do_venue",
            {"erro": "nocional_abaixo_do_minimo_do_venue", "nocional": str(nocional), "minimo": str(piso),
             "nota": "o venue recusa ordens abaixo deste valor"},
            resolucao,
        )

    # TECTO de valor por ordem: so existe quando o venue o declara. Ausente nao e «ilimitado» — e nao
    # medido, e nao se recusa por um limite que ninguem escreveu (aditivo na 1.4.0).
    maximo = Decimal(manifesto["maximo_de_valor_por_ordem"]) if "maximo_de_valor_por_ordem" in manifesto else None
    if maximo is not None and nocional > maximo:
        return recusa(
            identificador,
            "valor_fora_da_banda",
            {"erro": "nocional_acima_do_maximo", "nocional": str(nocional), "maximo": str(maximo)},
            resolucao,
        )

    # O ESCALAO de alavancagem do valor real. O escalao de um valor e o de maior `de` (limite INFERIOR)
    # que nao o excede — a forma como o venue o declara (`marginTiers[].lowerBound`, primeiro a `0.0`).
    # Um valor que escalao nenhum cubra nao tem maxima declarada: RECUSA, em vez de cair na maxima unica
    # por omissao (seria a mesa a decidir em lugar do venue).
    escaloes = unidade.get("alavancagem_por_escalao") or []
    if escaloes:
        cobrem = [escalao for escalao in escaloes if Decimal(escalao["de"]) <= nocional]
        if not cobrem:
            return recusa(
                identificador,
                "valor_fora_da_banda",
                {"erro": "nocional_fora_de_todos_os_escaloes", "nocional": str(nocional),
                 "limites_inferiores": [escalao["de"] for escalao in escaloes]},
                resolucao,
            )
        escalao = max(cobrem, key=lambda candidato: Decimal(candidato["de"]))
        maxima_do_escalao = min(Decimal(escalao["maxima"]), maxima)
        if pedida > maxima_do_escalao:
            return recusa(
                identificador,
                "valor_fora_da_banda",
                {"erro": "alavancagem_acima_da_maxima_do_escalao", "pedida": str(pedida),
                 "maxima": str(maxima_do_escalao), "de": str(escalao["de"])},
                resolucao,
            )

    # 3. a resolucao vai PRIMEIRO: quem decide ve o que vai ser enviado antes de ser enviado
    emitir({"_tipo": "resolucao", **resolucao}, f"{identificador}/resolucao")

    # 4. o silencio e um DESFECHO, nao uma excepcao: a mesa tem de saber dizer "nao sei"
    if "--silencioso" in sys.argv:
        return 0

    classificacao = argumento("--desfecho") or "aceite"
    if classificacao not in ("aceite", "parcial", "recusado", "desconhecido"):
        print(f"[mock-conector] classificacao invalida: {classificacao}", file=sys.stderr)
        return 2

    resposta = {"order_id": f"mock-{identificador}", "estado": "filled", "preenchido": resolucao["quantidade"]}
    carga: dict = {"_tipo": "desfecho", "classificacao": classificacao, "resolucao": resolucao,
                   "resposta_do_venue": resposta}
    if classificacao == "parcial":
        carga["resposta_do_venue"] = {"order_id": resposta["order_id"], "estado": "partial",
                                      "preenchido": str(quantizar(Decimal(resolucao["quantidade"]) / 2, passo, ROUND_DOWN))}
    if classificacao == "recusado":
        carga["motivo"] = "valor_fora_da_banda"
    if classificacao == "desconhecido":
        carga["resposta_do_venue"] = {"erro": "sem_confirmacao_no_prazo"}
    emitir(carga, f"{identificador}/desfecho")

    # A ordem fica no VENUE com a marca, na forma que o manifesto declara. E por ela que o
    # reinicio a vai reconhecer — nada disto vive do lado da mesa (RN-T16.1).
    if classificacao in ("aceite", "parcial"):
        venue.registrar_ordem(
            order_id=resposta["order_id"],
            instrumento=instrumento,
            lado=boleta["lado"],
            quantidade=resolucao["quantidade"],
            preco=str(preco),
            marca_de_posse=boleta["marca_de_posse"],
            forma_da_marca=manifesto["marca_de_posse"],
            referencia_do_cliente=boleta["referencia_do_cliente"],
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
