# Resultado do recorte 001 — o que ficou medido

**Medido no host em 2026-09-28 17:04 (-03), por comandos deste repositório.** Cada número abaixo tem
o comando ao lado. O que ainda **não** foi medido aparece como não medido, na secção do fim: um
critério não medido é uma tarefa aberta, nunca um "praticamente feito".

## O que passou a existir

| | Quantidade | Como se conta |
|---|---|---|
| Schemas do contrato | **9** (`8` mensagens + `_defs/forma`) | `find contracts -name '*.schema.json' -not -path '*/node_modules/*' \| wc -l` |
| Casos de bateria | **81** em **9** ficheiros | `casos/_arnes` 10 · `mercado` 13 · `proposta` 11 · `boleta` 13 · `manifesto` 7 · `resolucao` 6 · `desfecho` 10 · `marca` 6 · `historico` 5 |
| Linhas de código das duas pontas e do enquadramento | **851** | `wc -l esqueleto/*.ts esqueleto/*.py mocks/setup/*.ts mocks/conector/*.py` |
| Código gerado (versionado) | **19** ficheiros | `8` `.d.ts` + `11` `.py` (inclui `_defs`) |

## Os critérios de sucesso, um a um

### SC-001 ✅ medido — zero campos da boleta em unidade de corretora

```
$ bun run tools/verificar-contrato/ts/inspecionar.ts
inspeccao: 20 campos declarados, 0 em unidade de corretora
          (proibidos: quantidade, lote, preco_absoluto, pontos, tick, tamanho_do_contrato)
```
A inspecção **não** é revisão de olho: lê `vocabulario.json` e percorre o schema. Prova negativa feita:
injectado `quantidade` na boleta, a inspecção saiu com **1** e nomeou o campo; schema reposto, voltou a
**0**.

### SC-002 ✅ medido — duas linguagens, veredictos idênticos

```
$ bun run esqueleto/casos.ts --relatorio us1-us3-ts.jsonl
ts · contrato 1.0.0 · 81 casos · 27 aceites · 54 recusados · 0 divergentes · 0 erros

$ uv run python esqueleto/casos.py --relatorio us1-us3-py.jsonl
py · contrato 1.0.0 · 81 casos · 27 aceites · 54 recusados · 0 divergentes · 0 erros

$ uv run python tools/verificar-contrato/comparar.py us1-us3-ts.jsonl us1-us3-py.jsonl
0 divergencias · 81 casos comparados · as duas implementacoes decidem igual
```
**Zero** excepções ao contrato foram precisas: nenhum caso teve de ser mexido para as duas linguagens
concordarem.

### SC-003 ✅ medido — toda a recusa traz motivo normalizado

```
$ (relatório TS) recusados: 54 | sem motivo: 0 | aceites: 27
motivos distintos usados: 11
```
Nenhuma das **54** recusas ficou sem motivo. E a prova de que **nada sai antes da recusa**: no cenário
de SC-005 abaixo, a mensagem é recusada **antes de o corpo ser tocado**.

### SC-004 ✅ medido — o dinheiro não perde um dígito

```
$ uv run python tools/verificar-contrato/py/ida_e_volta.py
ok       0.00000001 -> 0.00000001
ok       -2.34 -> -2.34
ok       123456789.0123456789 -> 123456789.0123456789
ok       1000000000000.000000000000001 -> 1000000000000.000000000000001
ok       -0.000000000000000001 -> -0.000000000000000001
ida e volta: 9/9 valores sem perda
```
Se o dinheiro fosse número de vírgula flutuante, o terceiro e o quarto valores mudavam. Não mudaram.

### SC-005 ✅ medido — versão divergente recusa antes de qualquer envio

Com **todos os schemas de corpo removidos** do directório, a versão ainda é conferida:

```
$ (schemas de corpo movidos para /tmp) bun run esqueleto/casos.ts --casos _arnes
  decidido sem schema: envelope/versao-divergente -> recusado versao_do_contrato_divergente
  decidido sem schema: enquadramento/mensagem-partida-em-duas-linhas -> recusado enquadramento_invalido
  decidido sem schema: enquadramento/json-malformado -> recusado enquadramento_invalido
  decidido sem schema: enquadramento/linha-vazia -> recusado enquadramento_invalido
```
Ou seja: a conferência de versão e o enquadramento acontecem **antes** de existir corpo. Todo o resto da
bateria vira `erro_de_execucao` — que é o comportamento certo: sem schema o instrumento não mede, e não
diz "aceite".

### SC-006 ❌ **não medido** — reinício e reencontro pela marca

Os **6 casos** da marca (zero, limite de 31 bits, negativa, acima de 31 bits, hexadecimal do `cloid`,
ausente) passam, mas o `marcar → reiniciar → reencontrar` do mock ainda não existe. Tarefa T044–T046
aberta.

### SC-007 ✅ medido em parte — nenhum desconhecido vira sucesso nem falha

- O desfecho tem enum **fechado** de quatro valores; um quinto valor é recusado (`desfecho/classificacao-inventada`).
- `desconhecido` é um valor próprio, e a recusa **antes de resolver** deixou de ser obrigada a trazer resolução.
- Com o conector em silêncio (`--silencioso`), o mock escreve **1 linha** (a resolução) e nenhum desfecho: quem
  inventa o desfecho é a mesa, e o registo dela diz `desconhecido`.

Falta medir o outro lado: a mesa a gravar `desconhecido` depois do silêncio (depende da máquina de estados
implementada — fora do recorte 001).

### SC-008 ❌ **não medido** — reenvio com a mesma referência não duplica

A referência viaja na boleta e o manifesto declara `idempotencia`; o caminho de reconciliação antes de
reenviar (T036) ainda não está implementado.

### SC-009 ✅ medido — a bateria corre sem corretora

```
$ grep -rInE "fetch\(|require\(['\"]net|socket\.|urllib|requests\.|http\.client|WebSocket|connect\(" esqueleto mocks
0
```
Zero ligações de rede no contrato e nas duas pontas. Os únicos dois `https://` no código são
**identificadores de schema** (`$id`), que nunca se visitam — servem para o validador resolver `$ref`.
Toda a bateria e a prova de ponta-a-ponta correram neste host, offline, sem chave e sem conta.

### SC-010 ✅ medido em parte — uma ponta nova só precisa do contrato

- O mock de setup (TypeScript) lê o objecto de mercado e devolve a proposta: nunca vê boleta, saldo ou corretora.
- O mock de conector (Python) lê a boleta e as suas próprias fixtures: nunca vê estratégia nem mandato.
- O **porteiro de dependências** prova a direcção: `porteiro: 0 dependencias proibidas em 9 ficheiros de /contracts`.

Falta a prova mais forte (uma terceira pessoa a escrever uma ponta só com o contrato), que não se mede
por comando.

## A prova que interessa: as duas pontas a falar, à mão

```
$ bash tools/verificar-contrato/ponta-a-ponta.sh
ok      setup/mercado-aberto-propoe-buy            aceite null
ok      setup/mercado-fechado-vai-para-caixa       aceite null
ok      setup/invalido-limpar-e-recusado           recusado "valor_fora_do_conjunto"
ok      setup/invalido-vazio-e-recusado            recusado "campo_obrigatorio_ausente"
ok      setup/invalido-numero-e-recusado           recusado "tipo_invalido"
ok      conector/resolucao-antes-de-executar       aceite null
ok      conector/desfecho-aceite                   aceite null
ok      conector/capacidade-nao-declarada          aceite null
ok      conector/recusa-por-minimo-do-instrumento  aceite null
ok      conector/silencio-nao-inventa-desfecho     aceite null
ponta-a-ponta: 0 falhas — as duas pontas falam o contrato
```

E a recusa que o mock do conector faz por conta própria, com o motivo escrito:

```json
{"contrato":"1.0.0","tipo":"desfecho","id":"e2e-b1/desfecho","carga":{"classificacao":"recusado",
 "motivo":"minimo_do_instrumento_acima_da_banda","resposta_do_venue":{"erro":"minimo_do_instrumento_acima_da_banda",
 "quantidade_pedida":"0.00","minimo":"0.01","nota":"a quantidade que caberia na banda e menor que o minimo do instrumento"}}}
```
Isto é o coração do recorte: a banda não chegava para o mínimo do instrumento, e o conector **recusou** em
vez de arredondar para cima — que seria aumentar o risco do dono sem ele ter autorizado.

## Os defeitos que só apareceram por medir

Sete, todos corrigidos, nenhum deles visível na leitura:

| # | Defeito | Como apareceu | Correção |
|---|---|---|---|
| 1 | `required` no `then` sem o campo declarado (desfecho) | modo `strict` do `ajv` recusou compilar | schema corrigido; o `strict` ficou |
| 2 | Recusa **antes** de haver resolução era obrigada a trazê-la | o mock do conector recusou por capacidade não declarada e não tinha resolução para dar | `resolucao` obrigatória **fora** da recusa; caso novo (`desfecho/recusado-antes-de-resolver-sem-resolucao`) |
| 3 | Preço de liquidação só aceitava positivo | alavancagem 1 → liquidação a **0**, que é a verdade | passou a aceitar zero, com a razão escrita no schema |
| 4 | `id` correlacionado como `ciclo/proposta` era recusado | as próprias pontas foram recusadas | `/` admitido; o identificador é opaco |
| 5 | **`frescura.sh` deu verde com a geração a falhar** (4 de 8 ficheiros Python) | o gerador Python falhava e o script comparava o que sobrara | a geração falhada passou a sair **2**, e o gerador **verifica o próprio trabalho** |
| 6 | Geração Python não determinística (nome de temporário no cabeçalho) | `md5sum` diferente em duas corridas | directório de entrada fixo; `md5sum` igual em duas corridas |
| 7 | `contrato` na lista de unidades proibidas colidia com o `contrato` do envelope (a versão) | a inspecção de SC-001 acusou o envelope | renomeado para `tamanho_do_contrato`, e o âmbito passou a ser declarado (`unidades_neutras_em`) |

O nº 5 é o mais importante: era um instrumento de medida a dar **verde falso** — exactamente a falha que
a constituição proíbe (recusar, nunca degradar em silêncio). Um teste que passa por não ter corrido é pior
do que um teste que falta.

## O estado dos restantes critérios, sem rodeios

| Critério | Estado |
|---|---|
| SC-001, SC-002, SC-003, SC-004, SC-005, SC-009 | medidos, com o comando acima |
| SC-007, SC-010 | medidos em parte (falta o lado da máquina de estados e a prova humana) |
| SC-006, SC-008 | **não medidos** — tarefas T036 e T044–T046 abertas |

## Como reproduzir tudo

```bash
cd ~/Projects/MesaCore/contracts && bun install && uv sync
bun run esqueleto/casos.ts --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-ts.jsonl
uv run python esqueleto/casos.py --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-py.jsonl
uv run python ../tools/verificar-contrato/comparar.py ../specs/001-contrato-neutro/relatorios/us1-us3-{ts,py}.jsonl
cd .. && bun run tools/verificar-contrato/ts/inspecionar.ts
cd contracts && uv run python ../tools/verificar-contrato/py/ida_e_volta.py
cd .. && bash tools/verificar-contrato/ponta-a-ponta.sh
bash tools/verificar-contrato/porteiro-dependencias.sh && bash tools/verificar-contrato/frescura.sh
```
