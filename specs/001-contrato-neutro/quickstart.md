# Quickstart — como se prova o contrato

**Estado: guia, ainda não executado.** Este documento descreve os comandos que a implementação tem de
tornar verdadeiros. Nada aqui foi corrido ainda — o recorte 001 é especificação e plano; a primeira
execução é a tarefa `T-001` de `tasks.md`, e é ela que substitui esta promessa por uma saída medida.

## Pré-requisitos

| O quê | Como se confere | Medido no host (27 set 2026) |
|---|---|---|
| Bun | `bun --version` | `1.4.2` |
| Python | `python3 --version` | `3.14.7` |
| Instalador Python (o `python3` não tem `pip`) | `uv --version` | `uv 0.12.13` |
| Rede (só para instalar; **não** para correr a bateria) | `curl -sI https://registry.npmjs.org` | `HTTP/2 200` |

Sem corretora, sem chave, sem ligação de rede em tempo de execução: a bateria é local (SC-009).

## 1. Validar os casos contra o schema

```bash
# TypeScript: valida todos os casos de /contracts/casos e escreve o relatório
bun run tools/verificar-contrato/ts/verificar.ts --relatorio /tmp/relatorio-ts.jsonl

# Python: a mesma bateria, a outra implementação
uv run python tools/verificar-contrato/py/verificar.py --relatorio /tmp/relatorio-py.jsonl
```

**Esperado**: cada caso produzir uma linha JSON com `veredicto` e `motivo`, e os casos inválidos
produzirem **recusa com motivo** — não excepção, não silêncio.

## 2. Comparar as duas linguagens (SC-002)

```bash
tools/verificar-contrato/comparar.sh /tmp/relatorio-ts.jsonl /tmp/relatorio-py.jsonl
```

**Esperado**: `0 divergências` e saída 0. Qualquer divergência é **defeito do contrato** (uma das pontas
interpretou o que a outra não escreveu), não "diferença de implementação".

## 3. Os três invariantes da forma (SC-001, SC-004, SC-005)

```bash
# nenhum campo em unidade de corretora na boleta (SC-001)
bun run tools/verificar-contrato/ts/inspecionar.ts --proibidos quantidade,lote,preco_absoluto,pontos

# ida e volta sem perda de um decimal (SC-004)
uv run python tools/verificar-contrato/py/ida_e_volta.py --valor 123456789.0123456789

# versão divergente recusa antes de qualquer envio (SC-005)
bun run tools/verificar-contrato/ts/versao_divergente.ts
```

**Esperado**: `0 campos proibidos`; o valor devolvido **idêntico** ao enviado; e `recusado` com o motivo
`versao_do_contrato_divergente`, com contagem de mensagens enviadas igual a **zero**.

## 4. A prova que interessa ao dono: falar com o mock à mão

```bash
echo '{"contrato":"1.0.0","tipo":"boleta","id":"c-1","carga":{"instrumento":"EURUSD","lado":"buy","tipo":"mercado","saldo_pct":"2","alavancagem":"1","parcial":"o_que_der","desvio_maximo":"0.1","prazo_da_passiva_ms":3000,"destino_do_resto":"agressivo","reduce_only":false,"referencia_do_cliente":"r-1","marca_de_posse":1694498816}}' \
  | uv run python contracts/mocks/conector/main.py
```

**Esperado**: a **resolução** (quantidade, nocional, margem, alavancagem efectiva, preço de liquidação) e,
depois da execução simulada, um **desfecho** — nunca uma ordem real. Este é o teste que se pode correr no
telefone ou num terminal sem nada instalado além do Python.

## 5. O reinício (SC-006)

```bash
bun run contracts/mocks/setup/reiniciar.ts --marcar --reiniciar
```

**Esperado**: a posição marcada é **reencontrada pelos registos do venue**; a posição sem marca é
relatada como **alheia** e **não é gerida** (nenhuma ordem de fecho por iniciativa da mesa).

## O que **não** se prova aqui

- Nada contra uma corretora a sério: isso é a **bateria de conformidade** de `brokers/<nome>/` (RN-C6),
  outro recorte.
- Nada de estratégia: o contrato não sabe se um setup tem stop, lucro ou janela — e é isso que se
  pretende.
- Nada de desempenho: não há alvo numérico próprio (o contrato não está no caminho quente), e o único
  prazo que existe é **chave do dono**.
