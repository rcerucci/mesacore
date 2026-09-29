#!/usr/bin/env python3
"""A prova de que o conferidor da fronteira SABE REPROVAR (T046/T048).

    uv run python tools/verificar-contrato/py/prova-negativa-fronteira.py

Um conferidor que nunca reprovou nao mediu nada ainda. Aqui dao-se-lhe de proposito as tres doencas que ele
existe para apanhar - cada uma numa COPIA em memoria, sem tocar nos ficheiros:

  1. um motivo marcado como cruzando que o conjunto fechado do contrato nao tem;
  2. um nome no conjunto fechado que o livro nao conhece (nem esta declarado como vindo da porta);
  3. uma contagem escrita a mao que envelheceu (`fronteira.cruzam`);
  4. um campo na mensagem do `comando` que ninguem le.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fronteira  # noqa: E402


def silenciar() -> int:
    """Corre a funcao com a saida calada e devolve quantas falhas ela acumulou."""
    antes = len(fronteira.falhas)
    return antes


def correr_reprimido(funcao, *args, **kwargs) -> int:
    antes = len(fronteira.falhas)
    guardado = sys.stdout
    try:
        sys.stdout = open("/dev/null", "w", encoding="utf-8")
        funcao(*args, **kwargs)
    finally:
        sys.stdout.close()
        sys.stdout = guardado
    novas = len(fronteira.falhas) - antes
    del fronteira.falhas[antes:]
    return novas


falhas = 0


def conferir(condicao: bool, texto: str) -> None:
    global falhas
    if condicao:
        print(f"ok    {texto}")
    else:
        falhas += 1
        print(f"FALHA {texto}")


livro = json.loads(fronteira.LIVRO.read_text(encoding="utf-8"))
vocabulario = json.loads(fronteira.VOCABULARIO.read_text(encoding="utf-8"))
schema = json.loads(fronteira.COMANDO.read_text(encoding="utf-8"))

# 0. o dado do dono passa (a linha de base: sem isto, uma prova negativa nao diz nada).
conferir(correr_reprimido(fronteira.motivos, livro, vocabulario) == 0, "o livro e o vocabulario reais passam")
conferir(correr_reprimido(fronteira.campos_das_mensagens) == 0, "os campos reais das QUATRO mensagens passam")

# 1. um motivo que cruza e o contrato nao tem.
m1 = copy.deepcopy(livro)
m1["motivos"]["motivo_que_ninguem_conhece"] = {"cruzam_a_fronteira": True, "quando": "prova negativa"}
conferir(correr_reprimido(fronteira.motivos, m1, vocabulario) >= 1,
         "direcao A: um motivo marcado que nao existe no conjunto fechado REPROVA")

# 2. um nome no conjunto fechado sem quem o produza.
v2 = copy.deepcopy(vocabulario)
v2["conjuntos_do_vigia"]["motivos_de_comando"].append("nome_sem_produtor")
conferir(correr_reprimido(fronteira.motivos, livro, v2) >= 1,
         "direcao B: um nome no conjunto sem quem o produza REPROVA")

# 3. uma contagem escrita a mao que envelheceu.
m3 = copy.deepcopy(livro)
m3["fronteira"]["cruzam"] = m3["fronteira"]["cruzam"] + 1
conferir(correr_reprimido(fronteira.motivos, m3, vocabulario) >= 1,
         "uma contagem declarada que nao bate com a verdade REPROVA")

# 4. um campo sem leitor numa das QUATRO mensagens novas (T062/SC-003). O de prova chama-se de proposito
#    como o macro da conta (`conta`), que foi o falso positivo real da primeira versao deste conferidor.
for tipo in ("comando", "resposta_de_comando", "pergunta_do_encerramento", "decisao_do_encerramento"):
    original = json.loads((fronteira.CONTRATOS / f"{tipo}.schema.json").read_text(encoding="utf-8"))
    com_extra = copy.deepcopy(original)
    com_extra.setdefault("properties", {})["campo_sem_leitor_nenhum"] = {"type": "string"}
    guardados = dict(fronteira.LEITORES_POR_MENSAGEM)
    fronteira.LEITORES_POR_MENSAGEM.clear()
    fronteira.LEITORES_POR_MENSAGEM[tipo] = guardados[tipo]
    # o schema real fica em memoria: a funcao le do disco, por isso a prova escreve um ficheiro temporario
    alvo = fronteira.CONTRATOS / f"{tipo}.schema.json"
    copia = alvo.read_text(encoding="utf-8")
    try:
        alvo.write_text(json.dumps(com_extra, ensure_ascii=False, indent=2), encoding="utf-8")
        conferir(correr_reprimido(fronteira.campos_das_mensagens) >= 1,
                 f"um campo sem leitor na mensagem `{tipo}` REPROVA")
    finally:
        alvo.write_text(copia, encoding="utf-8")
        fronteira.LEITORES_POR_MENSAGEM.clear()
        fronteira.LEITORES_POR_MENSAGEM.update(guardados)

# 5. o caso do `conta`: o nome existe no codigo (o macro da CONTA, no cb.ts) mas nao como campo da mensagem.
s5 = copy.deepcopy(schema)
s5["properties"]["conta"] = {"type": "string"}
conferir(correr_reprimido(fronteira.campos_das_mensagens) == 0,
         "o falso positivo conhecido (`conta`) nao se repete: o nome noutro sitio nao conta como leitura")

print()
if falhas == 0:
    print("prova negativa da fronteira: 0 falhas — o conferidor reprova as cinco doencas que existe para apanhar")
    sys.exit(0)
print(f"prova negativa da fronteira: {falhas} falhas")
sys.exit(1)
