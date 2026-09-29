# `core/` — a mesa

A pasta deixou de ser uma pasta com um README. O que vive aqui, e por que ordem:

## 1. A tabela (`estados/`)

`estados/transicoes.json` é a **fonte** do comportamento: cada linha diz o par (estado, verbo), a guarda, o
resultado e o motivo. `estados/maquina.ts` é o **intérprete** — não sabe nada de trading, sabe ler a tabela.
Sete invariantes conferidos (`tools/verificar-maquina/tabela.ts`), entre eles: todo o par tem uma linha
`sempre` como última, e nenhum motivo da mesa se chama como um do contrato.

- `estados/motivos.json` — o livro dos motivos da **mesa** (38). É a resposta a «porque não fez?».
- `estados/comando.ts` — o validador da linha de comando.
- `estados/provar.ts` — as 29 mensagens de (estado, verbo).

## 2. O ciclo (`ciclo/`)

A ordem é sempre a mesma: **posição → condição → lado → decisão**.

| Ficheiro | O que faz |
|---|---|
| `leitura/fixtures.ts` | a porta de leitura: valida contra o contrato **antes** de a mesa decidir. Leitura recusada é **fatal** |
| `ciclo/condicoes.json` + `condicoes.ts` | as condições **somam** impedimentos (não vencem). Dado, não código |
| `ciclo/ciclo.ts` | a ordem do ciclo e as travas. **Não envia** (R5) |
| `ciclo/decisao.ts` | monta a boleta do mandato + template, e valida-a contra o contrato antes de sair |
| `ciclo/desfecho.ts` | classifica o que voltou: aceite, parcial, recusado ou **desconhecido** |
| `ciclo/reconciliacao.ts` | três veredictos; só os que **decidem** limpam a marca de desconhecido |
| `ciclo/cb.ts` | o circuit breaker: comparação **exacta**, sem percentagem arredondada |
| `ciclo/encerramento.ts` | o resumo e a pergunta; sem resposta, a mesa **volta a operar** com o `stop` pendente |
| `ciclo/arranque.ts` | as sete portas, por ordem (`conectores` **na frente**: o manifesto vem do conector); a primeira falha recusa com o motivo **dela**, e nada é corrigido |
| `ciclo/relogio.ts` | **o relógio**: uma volta lê os instrumentos da operação, decide cada um e escreve no registo. Existe por uma regra só — a mesa em operação **não** depende de ninguém vivo (FR-006/RN-V6) |

## 3. O que persiste (`estado/`)

O estado da mesa **não** persiste (R3): as **marcas** persistem, em `estado/.marcas.json` (fora do
versionamento), escritas em atómico (tmp + rename). São três: `sessao`, `inibicao_cb`, `desconhecido[]`
(+ `pedidos[]`). Escrita sempre por objecto **novo** — uma marca nunca é mutada no lugar.

`estado/registo.ts` é o registo do dia: uma linha por acontecimento, com o motivo sempre presente. Um
`nada` sem motivo **não se registra**: corrige-se (é a linha que torna o dia inexplicável).

## 4. Config (`config/`)

`configuracao.ts` lê `conta.eventos_que_avisam[]`. Se a lista não existir, ou tiver um nome fora do
conjunto fechado dos eventos (`ciclo/eventos.json`), a mesa **grita** — não avisa por omissão.

## Como se prova

```bash
bash tools/verificar-maquina/provar.sh          # tudo, uma porta, uma saída
bash tools/verificar-maquina/provar.sh --rapido # sem a bateria do contrato (001)
```
