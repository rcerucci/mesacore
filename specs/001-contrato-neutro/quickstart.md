# Quickstart — como se prova o contrato

**Estado: executado.** As secções 1 a 5 foram corridas em 28 set 2026 e trazem a saída **real** — a
secção 5 (reinício) deixou de ser promessa quando as tarefas T044–T046 ficaram medidas. Os números de
tudo isto estão em [`relatorios/RESULTADO.md`](relatorios/RESULTADO.md), e a revisão dos oito
princípios da constituição em [`relatorios/constituicao.md`](relatorios/constituicao.md).

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
cd contracts && bun run esqueleto/casos.ts --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-ts.jsonl

# Python: a mesma bateria, a outra implementação
uv run python esqueleto/casos.py --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-py.jsonl
```

**Saída real (28 set 2026)**:
```
ts · contrato 1.0.0 · 81 casos · 27 aceites · 54 recusados · 0 divergentes · 0 erros
py · contrato 1.0.0 · 81 casos · 27 aceites · 54 recusados · 0 divergentes · 0 erros
```

**Esperado**: cada caso produzir uma linha JSON com `veredicto` e `motivo`, e os casos inválidos
produzirem **recusa com motivo** — não excepção, não silêncio.

## 2. Comparar as duas linguagens (SC-002)

```bash
uv run python tools/verificar-contrato/comparar.py \
  specs/001-contrato-neutro/relatorios/us1-us3-ts.jsonl \
  specs/001-contrato-neutro/relatorios/us1-us3-py.jsonl
```

**Saída real**: `0 divergencias · 81 casos comparados · as duas implementacoes decidem igual`.
Qualquer divergência é **defeito do contrato** (uma das pontas interpretou o que a outra não escreveu),
não "diferença de implementação".

## 3. Os três invariantes da forma (SC-001, SC-004, SC-005)

```bash
# nenhum campo em unidade de corretora na boleta nem na proposta (SC-001)
bun run tools/verificar-contrato/ts/inspecionar.ts

# ida e volta sem perda de um decimal (SC-004)
cd contracts && uv run python ../tools/verificar-contrato/py/ida_e_volta.py

# versão divergente recusa ANTES de qualquer envio (SC-005): com os schemas de corpo fora do
# caminho, a mensagem continua a ser recusada — e todo o resto passa a erro_de_execucao
mkdir -p /tmp/guardados
(cd contracts && mv mercado.schema.json proposta.schema.json boleta.schema.json resolucao.schema.json desfecho.schema.json manifesto.schema.json historico.schema.json /tmp/guardados/ && bun run esqueleto/casos.ts --casos _arnes; mv /tmp/guardados/*.schema.json .)
```

**Saída real (28 set 2026)**:
```
inspeccao: 20 campos declarados, 0 em unidade de corretora
ida e volta: 9/9 valores sem perda
decidido sem schema: envelope/versao-divergente -> recusado versao_do_contrato_divergente
```

## 4. A prova que interessa ao dono: falar com o mock à mão

```bash
cd contracts
echo '{"contrato":"1.0.0","tipo":"boleta","id":"b-1","carga":{"instrumento":"EURUSD","lado":"buy","tipo":"mercado","saldo_pct":"2","alavancagem":"1","parcial":"o_que_der","desvio_maximo":"0.1","prazo_da_passiva_ms":3000,"destino_do_resto":"agressivo","reduce_only":false,"referencia_do_cliente":"r-1","marca_de_posse":1694498816}}' \
  | uv run python mocks/conector/main.py
```

Ou, com as duas fronteiras de uma vez: `bash tools/verificar-contrato/ponta-a-ponta.sh` (hoje: **0
falhas** em 13 verificações — e a prova mede duas coisas, não uma: o que a ponta **envia** passa o
contrato, e o que a ponta **decide** é o que se esperava dela). A resolução vem sempre **primeiro** e
o desfecho depois; com `--silencioso` só vem a resolução, porque quem diz "não sei" é a mesa, não o
conector.

## 5. O reinício (SC-006) — medido

```bash
bash tools/verificar-contrato/reinicio.sh
```

**Saída real (28 set 2026)**:
```
reinicio: nenhum estado da mesa guardado (nao ha base de dados de posse)
{"instrumento":"EURUSD","marca_de_posse":1694498816,"posse":"nossa","gerida":true,"unidades":"18.42","forma_da_marca":"comment"}
{"instrumento":"EURUSD","marca_de_posse":null,"posse":"alheia","gerida":false,"unidades":"0.07","motivo":"sem a marca da mesa (RN-T16.1)"}
reinicio: 0 falhas — a posse le-se do venue, pela marca
```

O reinício **não guarda nada** (não há base de dados de posse do lado da mesa): a posição marcada é
**reencontrada pelos registos do venue**, e a posição sem marca é relatada como **alheia** e **não é
gerida** — nenhuma ordem de fecho por iniciativa da mesa, e o venue continua com a ordem que era dela.

A marca em si (`bun run esqueleto/marca.ts`) traz seis invariantes: determinismo, ida e volta,
unicidade nas 4095 fichas, ciclo que não dá a volta em silêncio, ficha 0 recusada, e marca acima de 31
bits recusada — o limite do `POSITION_MAGIC`.

## O que **não** se prova aqui

- Nada contra uma corretora a sério: isso é a **bateria de conformidade** de `brokers/<nome>/` (RN-C6),
  outro recorte.
- Nada de estratégia: o contrato não sabe se um setup tem stop, lucro ou janela — e é isso que se
  pretende.
- Nada de desempenho: não há alvo numérico próprio (o contrato não está no caminho quente), e o único
  prazo que existe é **chave do dono**.
