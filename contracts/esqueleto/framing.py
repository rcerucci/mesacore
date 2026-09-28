"""Enquadramento e validacao do envelope — lado Python.

Espelho de framing.ts. As duas implementacoes leem a MESMA versao, o MESMO vocabulario e os
MESMOS casos: o que SC-002 compara e a divergencia entre elas, caso a caso.

Nada aqui decide o que e valido: quem decide e o schema. Este ficheiro so enquadra, confere a
versao e TRADUZ o erro do schema para o motivo normalizado.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

RAIZ = Path(__file__).resolve().parent.parent
ID_DO_ENVELOPE = "https://mesacore.local/contracts/envelope.schema.json"

MOTIVO_NULO = "valor_nulo_nao_permitido"


def _ler_json(caminho: Path) -> Any:
    with caminho.open(encoding="utf-8") as ficheiro:
        return json.load(ficheiro)


def versao_vigente() -> str:
    return _ler_json(RAIZ / "versao.json")["contrato"]


def vocabulario() -> dict[str, Any]:
    return _ler_json(RAIZ / "vocabulario.json")


def _schemas() -> list[Path]:
    return sorted(RAIZ.glob("*.schema.json")) + sorted((RAIZ / "_defs").glob("*.schema.json"))


_validadores: dict[str, Draft202012Validator] = {}


def _validador() -> Draft202012Validator:
    """Compila o envelope. Falha ALTO se faltar um schema — nao ha validacao por omissao."""
    if ID_DO_ENVELOPE in _validadores:
        return _validadores[ID_DO_ENVELOPE]
    recursos = []
    for caminho in _schemas():
        schema = _ler_json(caminho)
        recursos.append((schema["$id"], Resource.from_contents(schema)))
    registo = Registry().with_resources(recursos)
    envelope = _ler_json(RAIZ / "envelope.schema.json")
    validador = Draft202012Validator(envelope, registry=registo)
    _validadores[ID_DO_ENVELOPE] = validador
    return validador


def _valor_no_caminho(dados: Any, caminho: list[Any]) -> Any:
    atual = dados
    for passo in caminho:
        if not isinstance(atual, (dict, list)):
            return None
        try:
            atual = atual[passo]
        except (KeyError, IndexError, TypeError):
            return None
    return atual


def _campos_extras(schema: dict[str, Any], instancia: Any) -> list[str]:
    """Nomes das chaves que a instancia traz a mais do que o schema declara."""
    if not isinstance(instancia, dict):
        return []
    declaradas = set(schema.get("properties", {}))
    return [chave for chave in instancia if chave not in declaradas]


def _motivo_do_erro(erro: Any, dados: Any, voc: dict[str, Any]) -> str | None:
    caminho = [p for p in erro.absolute_path]
    proibidos = voc["campos_em_unidade_de_corretora"]

    if erro.validator == "additionalProperties":
        for chave in _campos_extras(erro.schema, erro.instance):
            if chave in proibidos:
                return "campo_em_unidade_de_corretora"
        return "campo_desconhecido"
    if erro.validator == "required":
        if erro.validator_value == ["parcial"] or "parcial" in erro.message:
            return "parcial_nao_declarada"
        return "campo_obrigatorio_ausente"
    if erro.validator == "type":
        valor = _valor_no_caminho(dados, caminho)
        return MOTIVO_NULO if valor is None else "tipo_invalido"
    if erro.validator == "pattern":
        return "formato_invalido"
    if erro.validator == "enum":
        return "valor_fora_do_conjunto"
    if erro.validator in ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"):
        return "valor_fora_da_banda"
    if erro.validator == "const":
        return "valor_fora_do_conjunto"
    return None


def escolher_motivo(erros: list[Any], dados: Any, voc: dict[str, Any]) -> str | None:
    """Um so motivo: o primeiro da ordem declarada no vocabulario que apareceu."""
    encontrados = set()
    for erro in erros:
        motivo = _motivo_do_erro(erro, dados, voc)
        if motivo:
            encontrados.add(motivo)
    for motivo in voc["prioridade_dos_motivos"]:
        if motivo in encontrados:
            return motivo
    return sorted(encontrados)[0] if encontrados else None


def validar(texto: str) -> dict[str, Any]:
    """Valida uma mensagem recebida como TEXTO CRU. Nunca levanta: devolve sempre uma decisao."""
    voc = vocabulario()

    # 1. enquadramento: uma linha, um objecto
    linha = texto[:-1] if texto.endswith("\n") else texto
    if "\n" in linha or linha.strip() == "":
        return {"veredicto": "recusado", "motivo": "enquadramento_invalido"}
    try:
        dados = json.loads(linha)
    except json.JSONDecodeError:
        return {"veredicto": "recusado", "motivo": "enquadramento_invalido"}
    if not isinstance(dados, dict):
        return {"veredicto": "recusado", "motivo": "enquadramento_invalido"}

    # 2. a versao do contrato, por igualdade exacta, ANTES de qualquer envio (D7)
    if dados.get("contrato") != versao_vigente():
        return {"veredicto": "recusado", "motivo": "versao_do_contrato_divergente"}

    # 3. o envelope contra o schema
    try:
        validador = _validador()
    except Exception:
        return {"veredicto": "erro_de_execucao", "motivo": None}

    erros = list(validador.iter_errors(dados))
    if not erros:
        return {"veredicto": "aceite", "motivo": None}

    motivo = escolher_motivo(erros, dados, voc)
    if motivo is None:
        return {"veredicto": "erro_de_execucao", "motivo": None}
    return {"veredicto": "recusado", "motivo": motivo}
