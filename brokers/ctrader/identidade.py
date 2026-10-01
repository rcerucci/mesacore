"""A PORTA DE IDENTIDADE do conector cTrader: a conta que autentica e' a conta da ficha.

O QUE ELA RESPONDE, e so' isto: o `ctidTraderAccountId` que o venue devolve, depois de autenticarmos com o token
do ficheiro, e' o MESMO que a ficha da conta nomeia? E que direitos tem essa conta (`accessRights`)? Nao
responde mais nada: nao decide se se opera, nao julga risco, nao mede mercado (RN-C5/RN-C15). Sao COMPARACOES, e
sao puras — recebem o que a ficha declara e a resposta CRUA do venue, e devolvem um veredicto.

PORQUE E' UMA PORTA SEPARADA DA `chave`: a porta `chave` prova que a credencial se LE (a referencia resolve, os
quatro valores estao la); esta prova que ela e' DESTA conta. Sao duas perguntas diferentes, e a segunda so' se
pode responder com o venue a falar: e' por isso que ela e' a ULTIMA do arranque.

Ao contrario do venue anterior — onde a identidade era um endereco de 20 bytes em hexadecimal — aqui a
identidade e' um INTEIRO (`ctidTraderAccountId`), e a doc oficial di-lo: nao ha endereco nem login, ha um id
(RN-CT8).

FAIL-CLOSED, e sem excepcao: o que nao se pode comparar RECUSA. Uma resposta que nao traga a lista de contas, um
id que a conta nao lista, um `accessRights` que nao se le — tudo RECUSA com motivo nomeado. O desconhecido NUNCA
vira «sim»: operar por uma conta que o venue nao confirmou e' exactamente o que nao se faz as cegas.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Os direitos que o venue declara (`ProtoOAAccessRights`). O conjunto e' FECHADO: o que nao estiver aqui RECUSA.
DIREITOS_CONHECIDOS = {
    "FULL_ACCESS": "opera e fecha",
    "CLOSE_ONLY": "so' fecha: a abertura e' recusada pela conta",
    "NO_TRADING": "nao opera nem fecha",
    "NO_LOGIN": "nao entra",
}

#: Os direitos com que o conector ARRANCA (os outros recusam-no no arranque, nao na primeira ordem).
DIREITOS_QUE_ARRANCAM = ("FULL_ACCESS", "CLOSE_ONLY")


@dataclass(frozen=True)
class Veredicto:
    ok: bool
    motivo: str | None
    porque: str
    #: `True` quando a conta arranca mas so' pode FECHAR (declara-se no manifesto, nao e' recusa)
    so_fecha: bool = False


def conferir_identidade(declarado: object, devolvido: object, conta: str) -> Veredicto:
    """O id da conta que o venue devolve e' o da ficha?

    `declarado` e' o `ctid_trader_account_id` do ficheiro da credencial; `devolvido` e' a resposta CRUA do
    venue a lista de contas (`ctidTraderAccountId` por conta), como ele a publica.
    """
    if isinstance(declarado, bool) or not isinstance(declarado, int) or declarado <= 0:
        return Veredicto(
            ok=False,
            motivo="formato_invalido",
            porque=(
                f"o id da conta da ficha ({declarado!r}) nao e' um inteiro positivo: sem ele nao ha o que "
                "comparar com as contas que o venue devolve"
            ),
        )

    lista = devolvido if isinstance(devolvido, list) else None
    if lista is None:
        return Veredicto(
            ok=False,
            motivo="campo_obrigatorio_ausente",
            porque=(
                "o venue nao devolveu a lista de contas deste token: sem a lista nao se sabe de quem e' a conta, "
                "e o desconhecido nao vira «sim» (FR-023)"
            ),
        )

    ids: list[int] = []
    for entrada in lista:
        if not isinstance(entrada, dict):
            continue
        valor = entrada.get("ctidTraderAccountId")
        if isinstance(valor, bool) or not isinstance(valor, int):
            continue
        ids.append(valor)

    if declarado not in ids:
        return Veredicto(
            ok=False,
            motivo="identidade_da_conta_divergente",
            porque=(
                f"o token autentica {len(ids)} conta(s) ({', '.join(str(i) for i in ids) if ids else 'nenhuma'}) e "
                f"a ficha da conta {conta} declara {declarado}: autenticar por uma conta que nao e' esta nao se faz, "
                "e nao se envia nada (RN-CT8)"
            ),
        )

    return Veredicto(
        ok=True,
        motivo=None,
        porque=f"o id que o venue devolve para a conta {conta} ({declarado}) e' o que a ficha declara",
    )


def conferir_direitos(direitos: object, conta: str) -> Veredicto:
    """O que esta conta pode fazer, segundo o proprio venue (`accessRights`)."""
    if not isinstance(direitos, str) or direitos not in DIREITOS_CONHECIDOS:
        return Veredicto(
            ok=False,
            motivo="valor_fora_do_conjunto",
            porque=(
                f"o venue declarou `accessRights` = {direitos!r}, que nao esta no conjunto conhecido "
                f"({', '.join(DIREITOS_CONHECIDOS)}): um direito que nao se le' nao se assume — e' recusa"
            ),
        )

    if direitos not in DIREITOS_QUE_ARRANCAM:
        return Veredicto(
            ok=False,
            motivo="sem_direito_de_operar",
            porque=(
                f"a conta {conta} tem `accessRights` = {direitos} ({DIREITOS_CONHECIDOS[direitos]}) e o conector "
                "nao arranca sem poder fechar: um processo vivo que nao consegue desfazer posicao e' pior do que "
                "nenhum processo (RN-CT12)"
            ),
        )

    if direitos == "CLOSE_ONLY":
        return Veredicto(
            ok=True,
            motivo=None,
            porque=(
                f"a conta {conta} e' CLOSE_ONLY: o conector ARRANCA, declara no manifesto que so' fecha, e recusa "
                "qualquer boleta de abertura com este motivo (o fecho continua a passar)"
            ),
            so_fecha=True,
        )

    return Veredicto(ok=True, motivo=None, porque=f"a conta {conta} tem acesso total: abre e fecha")
