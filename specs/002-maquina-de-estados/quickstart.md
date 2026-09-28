# Quickstart — como se prova a máquina de estados

**Estado: escrito, ainda não executado.** Nada aqui correu ainda: este documento nasce com o plano e
serve de guião à implementação (`tasks.md`). Cada secção é um comando que tem de dar a saída descrita —
e as saídas só entram neste ficheiro **depois** de medidas, como no recorte 001.

## Pré-requisitos

| O quê | Como se confere | Medido no host (28 set 2026) |
|---|---|---|
| Bun | `bun --version` | `1.4.2` |
| Contrato do recorte 001 a funcionar | `bash tools/verificar-contrato/ponta-a-ponta.sh` | **0 falhas** em 13 verificações |
| Nenhuma rede em tempo de execução | `grep -rInE "fetch\(|socket\.|http" core/` | **0** (a manter) |

Sem corretora, sem chave e sem conta: o ciclo lê **fixtures** (mensagens do contrato), e é isso que
torna os 41 cenários da spec executáveis hoje.

## 1. A tabela de transições é coerente (R1, SC-001)

```bash
bun run tools/verificar-maquina/tabela.ts
```

**Esperado**: os cinco invariantes da tabela — todo o estado tem saída, todo o verbo tem casa, nenhum
estado é inalcançável, toda a recusa tem motivo do vocabulário, e `reset` não leva a estado novo.
**Zero** violações. E a **prova negativa**: uma tabela com um estado sem saída tem de **reprovar**
(o script altera o dado, exige o vermelho e repõe).

## 2. Os pares (estado, verbo) — US1

```bash
bun run core/estados/maquina.ts --casos core/estados/transicoes.casos.json
```

**Esperado**: **100%** dos pares legais produzem o estado novo, e **100%** dos ilegais produzem recusa
**com motivo**, sem o estado mudar (SC-001). Os casos são dados: incluem `pause` com a mesa `parada`,
`start` com a mesa já em operação, `stop` repetido durante o encerramento, e `reset` em cada estado.

## 3. O instrumento que não está em condições não abre — US2

```bash
bun run core/ciclo/ciclo.ts --casos core/ciclo/ciclo.casos.json --historia US2
```

**Esperado**: a mesma proposta submetida em cada condição. As **decisões de `abrir` são contadas** e
têm de ser **zero** fora de `normal` (SC-002); com dado velho, os pedidos legítimos de fechar são
permitidos em **100%** dos casos e as aberturas são **zero** (SC-003). O relatório traz, por caso, a
condição, a decisão, o motivo e o aviso.

## 4. O desconhecido fica desconhecido — US3

```bash
bun run core/ciclo/ciclo.ts --casos core/ciclo/ciclo.casos.json --historia US3
bash tools/verificar-maquina/reiniciar.sh   # reiniciar o processo e reencontrar as marcas
```

**Esperado**: o desfecho sem confirmação produz a marca `desconhecido` em **100%** dos casos e **zero**
promoções a `aceite` ou `recusado` (SC-004); com a marca, **zero** decisões de `abrir` para aquele
instrumento (SC-005); a reconciliação que decide leva a `aberta` ou `nenhuma`, e a que não decide
mantém a marca; e `reset` **não** a apaga. Depois de reiniciar o processo, **100%** das marcas
continuam legíveis (SC-010).

## 5. As seis portas do arranque — US4

```bash
bun run core/ciclo/ciclo.ts --casos core/ciclo/arranque.casos.json --historia US4
```

**Esperado**: cada porta falhada de propósito (uma de cada vez) recusa o arranque com o **motivo
daquela** porta, e a mesa permanece `parada` (SC-006). A porta do inventário é a que liga este recorte
ao conferidor do recorte 001.

## 6. Sessão, CB e inibição — US5

```bash
bun run core/ciclo/ciclo.ts --casos core/ciclo/sessao.casos.json --historia US5
```

**Esperado**: o CB a disparar leva a `encerrando`, liquida e deixa `parada` **com a inibição marcada**;
`start` recusa em **100%** dos casos com a marca (SC-007); `nova_sessao` levanta a inibição e grava a
configuração em vigor; e trocar de setup sem sessão nova é recusado.

## 7. Pausada defende, e um pedido ignorado não paralisa — US6 e US7

```bash
bun run core/ciclo/ciclo.ts --casos core/ciclo/pausa.casos.json --historia US6
bun run core/ciclo/ciclo.ts --casos core/ciclo/pausa.casos.json --historia US7
```

**Esperado**: com a mesa `pausada`, **zero** decisões de `abrir` e o CB a disparar em **100%** dos casos
em que o limite é atingido (SC-008); sem resposta ao encerramento, **100%** dos casos voltam a
`em_operacao` com o `stop` registrado como pendente (SC-009).

## 8. As fronteiras do recorte

```bash
bash tools/verificar-maquina/porteiro-do-estado.sh
bash tools/verificar-contrato/porteiro-dependencias.sh
bash tools/verificar-contrato/inventario.sh
```

**Esperado**: o core não importa mocks nem `/tools`; o ficheiro de marcas **não tem** campo de posição
(nem `unidades`, nem `quantidade`) — é o que garante que a mesa se reinstala em vez de se enganar; o
contrato continua sem depender do core; e **100%** das chaves deste recorte têm dono no inventário
(SC-012).

## 9. O registo reconstrói o dia (SC-011)

```bash
bun run tools/verificar-maquina/registo.ts --registo core/estado/.registo.jsonl
```

**Esperado**: o estado final da mesa é reconstruído a partir do registo **sem ler código**, e **zero**
linhas de decisão de não-fazer vêm sem motivo. Uma linha sem motivo é a diferença entre um registo e uma
lista de acontecimentos.

## O que **não** se prova aqui

- **Nada contra uma corretora a sério**: isso é a bateria de conformidade (RN-C6), recorte próprio. Aqui
  as leituras são fixtures.
- **Nada de desempenho**: não há alvo próprio, e é decisão (o ciclo corre pelo relógio declarado pelo
  setup).
- **Nada de estratégia**: o lado e a janela vêm do template do setup; a mesa decide **se pode** agir, não
  se **deve** — isso é do setup e do dono.
- **Nada da web**: o que a web desenha não é medido por este recorte.
