# Quickstart — como se corre o recorte 003 e o que se vê

## Pré-requisitos (medidos neste host)

`bun 1.4.2` · `node v26.8.1` · `python3 3.14.7` (por `uv`, sem `pip`) · `ajv 8.20.0` · `jsonschema 4.26.0`.
Sem container, sem `go`, sem `rustc`. Nada de corretora e nada de chave: **tudo corre contra dublês**.

## As três portas

```
# 1. a porta única (tudo o que já estava provado, mais o que este recorte traz)
bash tools/verificar-maquina/provar.sh

# 2. só o vigia (a bateria deste recorte, com o dublê de mesa e os dublês dos plugins)
bash tools/verificar-maquina/vigia.sh

# 3. o contrato (as duas linguagens, agora na versão 1.2.0)
bash tools/verificar-contrato/ponta-a-ponta.sh
```

## O que se vê, por história

| História | Comando | O que conta como prova |
|---|---|---|
| **US1** o arranque só acontece se puder | `bash tools/verificar-maquina/vigia.sh --arranque` | a recusa traz **o motivo daquela porta** (não um genérico), e um `start` repetido recusa com `mesa_ja_em_operacao` |
| **US2** a mesa sobrevive ao vigia | `bash tools/verificar-maquina/vigia.sh --orfandade` | matam-se o vigia e contam-se as linhas **novas** no ledger: têm de ser **tantas quantos os ciclos** corridos (SC-001) |
| **US3** encerramento gracioso | `bash tools/verificar-maquina/vigia.sh --encerramento` | sem resposta, a mesa volta a `em_operacao` com o stop **pendente**; com «fechar», fecha a mercado; com «manter», o aviso diz o que resta |
| **US4** `pause` ≠ `stop`, `reset` não altera | `bash tools/verificar-maquina/vigia.sh --verbos` | com a mesa pausada o CB **fecha**; com a inibição presente o `reset` **não limpa**; `nova_sessao` sem motivo é recusada |
| **US5** a fronteira é contrato | `bash tools/verificar-contrato/ponta-a-ponta.sh` | as quatro mensagens passam nas duas linguagens; um comando `1.0.0` é recusado; as duas direcções dos motivos fecham |
| **US6** o dublê de mesa | `bash tools/verificar-contrato/duble-de-mesa.sh` | os mesmos casos no dublê e na mesa real dão o **mesmo** veredicto; com o venue mudo, «espera» e depois `desconhecido` |
| **US7** regressão | `bash tools/verificar-maquina/provar.sh` | a contagem das verificações do 002 **não** cai, e a bateria do contrato mantém aceites e recusas |

## Como se lê o que aconteceu

- **`.vigia.json`** — as transições (instante, verbo, autor, `pedido_id`, estado anterior, posterior, motivo):
  é o registro que torna o vigia auditável por leitura (RN-V4).
- **`.marcas.json`** — o estado persistente da mesa (sessão, inibição, desconhecidos, pedidos pendentes).
- **ledger** — snapshot, proposta, boleta e desfecho; **nada** de operação (o ledger é do mercado, e tem um
  escritor).

## O que este quickstart **não** prova

- **A conformidade da corretora** (RN-C6): nenhuma linha aqui toca num venue. Essa bateria é o aceite de cada
  conector real, no recorte dele.
- **A ponta-a-ponta com as duas pontas reais** (setup e conector verdadeiros): é o aceite de cada plugin.

Estas duas ficam **declaradas** — adiadas de propósito, não esquecidas.
