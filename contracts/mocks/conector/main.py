#!/usr/bin/env python3
"""Mock de conector — a ponta que TRADUZ e TRANSPORTA, e so isso (RN-E4).

Le uma boleta (unidades neutras) e devolve, por esta ordem:

  1. a RESOLUCAO — o que vai enviar, ANTES de enviar (RN-C10);
  2. o DESFECHO — o que aconteceu (RN-C2).

    echo '<boleta>' | uv run python contracts/mocks/conector/main.py
    ... --desfecho parcial | recusado | desconhecido
    ... --silencioso          # nao responde: a mesa tem de registar DESCONHECIDO (RN-T7.1)
    ... --preco 1.05000       # muda o preco simulado (para provocar a recusa por minimo)

Regras que este mock tem de cumprir, e que se veem no codigo:

  - RECUSA em vez de arredondar (RN-C9): se o minimo do instrumento obrigar a mais risco do
    que a banda autorizada, nao ha ordem — ha recusa COM MOTIVO.
  - Nada de adaptar em silencio: capacidade que o manifesto nao declara e recusa, nao
    improviso (RN-C7).
  - Dinheiro em DECIMAL, nunca em virgula flutuante (D4).
  - O conector nao decide se se deve operar: nao ve estrategia, mandato nem fichas. Se um dia
    precisar de ver, o contrato esta errado.
"""

from __future__ import annotations

import json
import sys
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from pathlib import Path

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


def main() -> int:
    manifesto = ler_json(AQUI / "manifesto.json")["carga"]
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
    teto = Decimal(manifesto["teto_de_valor_por_ordem"])
    resolucao = {
        "quantidade": str(quantidade),
        "nocional": str(nocional),
        "margem_empenhada": str(quantizar(nocional / pedida, CENTAVO)),
        "alavancagem_efectiva": str(pedida),
        "preco_de_liquidacao": str(quantizar(preco * (1 - 1 / pedida), Decimal(unidade["tick"]))),
    }
    if nocional > teto:
        return recusa(
            identificador,
            "valor_fora_da_banda",
            {"erro": "nocional_acima_do_teto", "nocional": str(nocional), "teto": str(teto)},
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
