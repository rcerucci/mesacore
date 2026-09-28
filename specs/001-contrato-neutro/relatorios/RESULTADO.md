# Resultado do recorte 001 — o que ficou medido

**Segunda passagem, medida no host em 2026-09-28.** Cada número abaixo tem o comando ao lado. O que
ainda **não** foi medido aparece como não medido, na secção do fim: um critério não medido é uma
tarefa aberta, nunca um "praticamente feito".

Esta passagem fechou as tarefas que tinham ficado abertas (T028, T034, T036, T044–T046, T050, T054,
T059) e **encontrou quatro defeitos novos** — três deles em instrumentos de medida, um deles no
próprio conferidor. Estão na tabela dos defeitos, e são a razão de a passagem ter valido a pena.

## O que passou a existir

| | Quantidade | Como se conta |
|---|---|---|
| Schemas do contrato | **9** (`8` mensagens + `_defs/forma`) | `find contracts -name '*.schema.json' -not -path '*/node_modules/*' \| wc -l` |
| Casos de **mensagem** | **81** em **9** ficheiros | `_arnes` 10 · `mercado` 13 · `proposta` 11 · `boleta` 13 · `manifesto` 7 · `resolucao` 6 · `desfecho` 10 · `marca` 6 · `historico` 5 |
| Casos de **decisão da mesa** | **9** | `contracts/casos/referencia.decisoes.json` |
| Casos de **conformidade com o manifesto** | **12** | `contracts/casos/conferencia.conformidade.json` |
| Grandezas do contrato com origem declarada | **44** | `contracts/origem-das-grandezas.json` + `tools/verificar-contrato/py/inventario.py` |
| Código das pontas, do enquadramento e das ferramentas | **2520** linhas em **26** ficheiros | `find contracts tools -type f \( -name '*.ts' -o -name '*.py' -o -name '*.sh' \) -not -path '*/node_modules/*' -not -path '*/.venv/*' -not -path '*/gerado/*' -exec cat {} + \| wc -l` |
| Código gerado (versionado) | **19** ficheiros | `8` `.d.ts` + `11` `.py` (inclui `_defs`) |
| Provas de linha de comando | **6** | `ponta-a-ponta.sh` · `reinicio.sh` · `reenvio.sh` · `inventario.sh` · `frescura.sh` · `porteiro-dependencias.sh` |

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

### SC-003 ✅ medido — toda a recusa traz motivo normalizado, e nada sai

```
$ (relatório TS) recusados: 54 | sem motivo: 0 | aceites: 27
motivos distintos usados: 11

$ bun run esqueleto/conferir.ts --bateria
conferencia: 12 casos · 0 divergentes        # cada caso traz `enviadas_esperadas`
```
Nenhuma das **54** recusas ficou sem motivo. E a prova de que **nada sai antes da recusa** passou a ser
contada, não afirmada: na conferência contra o manifesto, cada caso declara **quantas** mensagens
seriam enviadas (`enviadas=1` no aceite, `enviadas=0` em todas as recusas), e a bateria reprova se a
contagem não for essa.

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

### SC-006 ✅ medido — reinício e reencontro pela marca

```
$ bash tools/verificar-contrato/reinicio.sh
reinicio: nenhum estado da mesa guardado (nao ha base de dados de posse)
{"instrumento":"EURUSD","marca_de_posse":1694498816,"posse":"nossa","gerida":true,"unidades":"18.42","forma_da_marca":"comment"}
{"instrumento":"EURUSD","marca_de_posse":null,"posse":"alheia","gerida":false,"unidades":"0.07","motivo":"sem a marca da mesa (RN-T16.1)"}
ok      a posicao com a nossa marca foi reencontrada   linhas com a marca 1694498816: 1
ok      exactamente uma posicao e gerida               geridas: 1
ok      a posicao sem a marca e alheia e NAO gerida    alheias nao geridas: 1
ok      o venue tem 1 ordem (a da mesa), nao mais      ordens no venue: 1
ok      a posicao alheia continua no venue, intacta    posicoes alheias: 1
reinicio: 0 falhas — a posse le-se do venue, pela marca
```

O "reinício" **não guarda nada**: o mock do conector não tem lista de posições próprias — se tivesse,
o teste seria o teste de uma cópia, não o da corretora. A posse deduz-se de uma marca que se lê do
venue, e o mock do conector **declara a forma** em que a escreve (`comment`, a do manifesto).

A geração da marca tem seis invariantes medidos (`bun run esqueleto/marca.ts`): determinismo, ida e
volta, unicidade nas 4095 fichas, ciclo que **não** dá a volta em silêncio, ficha 0 recusada, marca
acima de 31 bits recusada.

### SC-007 ✅ medido em parte — nenhum desconhecido vira sucesso nem falha

- O desfecho tem enum **fechado** de quatro valores; um quinto valor é recusado
  (`desfecho/classificacao-inventada` → `valor_fora_do_conjunto`).
- `desconhecido` é um valor próprio, e a recusa **antes de resolver** deixou de ser obrigada a trazer resolução.
- Com o conector em silêncio (`--silencioso`), o mock escreve **1 linha** (a resolução) e nenhum desfecho.
- A decisão de reenviar, com desfecho `desconhecido`: com idempotência declarada reenvia com a mesma
  referência; **sem** ela, reconcilia antes — e a bateria recusa explicitamente qualquer reenvio "a
  credo" fora do primeiro envio.

Falta medir o outro lado: a mesa a **gravar** `desconhecido` depois do silêncio (depende da máquina de
estados — fora do recorte 001).

### SC-008 ✅ medido — reenvio com a mesma referência não duplica

```
$ bash tools/verificar-contrato/reenvio.sh
ok      a bateria de decisoes passa                    10 verificacoes
ok      primeira referencia: ordem criada              order_id mock-reenvio-b1
ok      reenvio da MESMA referencia devolve a mesma ordem   mock-reenvio-b1 = mock-reenvio-b1
ok      e o venue diz que foi duplicado, em vez de o esconder   duplicado=True
ok      referencia DIFERENTE abre ordem nova           mock-reenvio-b2
ok      o venue ficou com 2 ordens (e nao 3)           ordens no venue: 2
reenvio: 0 falhas — a mesma referencia nao produz segunda ordem
```

Os dois lados estão medidos: a **decisão da mesa** (9 casos: primeira vez envia; com desfecho não
reenvia; dentro do prazo espera; sem idempotência **reconcilia antes**) e o **comportamento do venue**
(a mesma referência devolve a ordem que já lá está, e uma referência diferente abre ordem nova — sem
este segundo caso, o teste passaria por não fazer nada).

### SC-009 ✅ medido — a bateria corre sem corretora

```
$ grep -rInE "fetch\(|require\(['\"]net|socket\.|urllib|requests\.|http\.client|WebSocket|connect\(" esqueleto mocks
0
```
Zero ligações de rede no contrato e nas duas pontas. Os únicos `https://` no código são
**identificadores de schema** (`$id`), que nunca se visitam — servem para o validador resolver `$ref`.
Toda a bateria, as seis provas de linha de comando e a geração correram neste host, offline, sem chave
e sem conta.

### SC-010 ✅ medido em parte — uma ponta nova só precisa do contrato

- O mock de setup (TypeScript) lê o objecto de mercado e devolve a proposta: nunca vê boleta, saldo ou corretora.
- O mock de conector (Python) lê a boleta e as suas próprias fixtures: nunca vê estratégia nem mandato.
- O **porteiro de dependências** prova a direcção:
  `porteiro: 0 dependencias proibidas em 33 ficheiros de /contracts`.
- `validar_linha.{ts,py}` valida qualquer mensagem usando **só** o contrato — é o que as duas pontas usam
  para se conferirem a si próprias, e é o que uma ponta nova tem de fazer antes de pedir ajuda a alguém.

Falta a prova mais forte (uma terceira pessoa a escrever uma ponta só com o contrato), que não se mede
por comando. Está declarado como não medido.

## A prova que interessa: as duas pontas a falar, à mão

```
$ bash tools/verificar-contrato/ponta-a-ponta.sh
ok      setup/mercado-aberto-propoe-lado               aceite null
ok      setup/mercado-fechado-vai-para-caixa           aceite null
ok      setup/invalido-limpar-e-recusado               recusado "valor_fora_do_conjunto"
ok      setup/invalido-vazio-e-recusado                recusado "campo_obrigatorio_ausente"
ok      setup/invalido-numero-e-recusado               recusado "tipo_invalido"
ok      conector/resolucao-antes-de-executar           aceite null
ok      conector/desfecho-aceite                       aceite null
ok      conector/executou-a-boleta-valida              aceite -
ok      conector/recusa-tipo-nao-declarado             recusado capacidade_nao_declarada
ok      conector/recusa-por-minimo-do-instrumento      recusado minimo_do_instrumento_acima_da_banda
ok      conector/silencio-devolve-so-a-resolucao       linhas: 1
ok      conector/historico-passa-o-contrato            aceite null
ok      historico/taxa-e-funding-em-campos-proprios    sem resultado recalculado por execucao
ponta-a-ponta: 0 falhas — as duas pontas falam o contrato, e decidem o que deviam
```

Duas famílias de verificação, e as duas são precisas: o que a ponta **envia** passa o contrato, e o que
a ponta **decide** é o que se esperava dela. A segunda foi acrescentada nesta passagem — sem ela, uma
mensagem válida dava por bom um comportamento errado (foi o que aconteceu, ver defeito nº 9).

E a recusa que o mock do conector faz por conta própria, com o motivo escrito e os números:

```json
{"contrato":"1.0.0","tipo":"desfecho","id":"e2e-b-minimo/desfecho","carga":{"classificacao":"recusado",
 "motivo":"minimo_do_instrumento_acima_da_banda","resposta_do_venue":{"erro":"minimo_do_instrumento_acima_da_banda",
 "quantidade_pedida":"0.00","minimo":"0.01","nota":"a quantidade que caberia na banda e menor que o minimo do instrumento"}}}
```
A banda não chegava para o mínimo do instrumento, e o conector **recusou** em vez de arredondar para
cima — que seria aumentar o risco do dono sem ele ter autorizado.

## O histórico, e por que não se reconstrói

```
$ uv run python mocks/conector/historico.py --instrumento EURUSD
{"contrato":"1.0.0","tipo":"historico","id":"historico-EURUSD","carga":{"instrumento":"EURUSD","moeda":"USD",
 "instante_ms":1759000000000,"resultado_realizado":"12.40","execucoes":[{"referencia_do_cliente":"r-e2e-1",
 "marca_de_posse":1694498816,"instante_ms":1759000000000,"lado":"buy","quantidade":"18.42","preco":"1.08542",
 "taxa":"0.40","funding":"-0.02"}]}}

parcelas reportadas: -0.02 · resultado do venue: 12.40 · diferem (por isso o resultado nao se reconstroi)
```

Taxa e funding vêm em **campos próprios**, como o venue os cobra; não há campo de resultado por
execução; e `resultado_realizado` é o número do venue. A última linha é a prova: a soma das parcelas
que o venue reporta **não dá** o resultado dele — uma mesa que "conferisse" somando estaria a inventar
a conta da corretora.

## Os defeitos que só apareceram por medir

**Onze**, todos corrigidos, nenhum visível na leitura. Os sete primeiros da passagem anterior; os
quatro últimos desta.

| # | Defeito | Como apareceu | Correção |
|---|---|---|---|
| 1 | `required` no `then` sem o campo declarado (desfecho) | modo `strict` do `ajv` recusou compilar | schema corrigido; o `strict` ficou |
| 2 | Recusa **antes** de haver resolução era obrigada a trazê-la | o mock do conector recusou por capacidade não declarada e não tinha resolução para dar | `resolucao` obrigatória **fora** da recusa; caso novo |
| 3 | Preço de liquidação só aceitava positivo | alavancagem 1 → liquidação a **0**, que é a verdade | passou a aceitar zero, com a razão escrita no schema |
| 4 | `id` correlacionado como `ciclo/proposta` era recusado | as próprias pontas foram recusadas | `/` admitido; o identificador é opaco |
| 5 | **`frescura.sh` deu verde com a geração a falhar** (4 de 8 ficheiros Python) | o gerador Python falhava e o script comparava o que sobrara | a geração falhada passou a sair **2**, e o gerador **verifica o próprio trabalho** |
| 6 | Geração Python não determinística (nome de temporário no cabeçalho) | `md5sum` diferente em duas corridas | directório de entrada fixo; `md5sum` igual em duas corridas |
| 7 | `contrato` na lista de unidades proibidas colidia com o `contrato` do envelope (a versão) | a inspecção de SC-001 acusou o envelope | renomeado para `tamanho_do_contrato`, e o âmbito passou a ser declarado (`unidades_neutras_em`) |
| 8 | **`reduce_only_nativo` não decidia nada** | ao escrever a conferência contra o manifesto: `false` tanto podia significar "o conector emula" como "não há como" | passou a `reduce_only_suportado` — declara-se a **capacidade**, não o mecanismo; inventário e data-model corrigidos |
| 9 | **A prova de ponta-a-ponta arrastava estado do venue** | a "recusa por mínimo" devolveu a ordem **duplicada** de uma corrida anterior e o teste passou na mesma | o venue começa limpo, referências próprias por caso, e a prova passou a exigir a **decisão** (recusou, com aquele motivo) |
| 10 | **O caminho do duplicado ignorava `--silencioso`** | o cenário do silêncio passou a dar 2 linhas em vez de 1 | o silêncio é propriedade do venue, não do caminho: passou a valer nos dois |
| 11 | **O conferidor do inventário procurava um `$def` com o nome errado** (`inteiro_ms`, que não existe) | ao conferir o inventário: 9 grandezas — prazos, instantes, marcas — estavam fora da conferência e o verde era largo | a lista passou a ser a dos `$defs` numéricos reais (44 grandezas); 3 chaves passaram a estar nomeadas no inventário (`setup.stop_pct`, `setup.tp_pct`, `setup.relogio.proxima_consulta_ms`) |

Os nºs 5, 9, 10 e 11 são o mesmo erro em quatro sítios: **um instrumento que não consegue medir, e não
o diz**. Um teste que passa por não ter corrido é pior do que um teste que falta — e é por isso que
cada conferidor deste recorte traz a sua prova negativa: o do inventário reprova por três caminhos
diferentes (`prova-negativa-inventario.py`), a frescura reprova um gerado editado à mão, e a prova de
ponta-a-ponta agora mede a decisão, não só a validade.

## O estado dos critérios, sem rodeios

| Critério | Estado |
|---|---|
| SC-001, SC-002, SC-003, SC-004, SC-005, SC-006, SC-008, SC-009 | **medidos**, com o comando acima |
| SC-007, SC-010 | medidos **em parte** — falta o lado da máquina de estados (gravar `desconhecido`) e a prova humana (uma terceira pessoa a escrever uma ponta) |

Das **59 tarefas** do recorte, **59** estão fechadas. O que fica por medir não é tarefa aberta deste
recorte: é trabalho do recorte seguinte (a máquina de estados), e está nomeado.

## Como reproduzir tudo

```bash
cd ~/Projects/MesaCore/contracts && bun install && uv sync

# a bateria, nas duas linguagens, e a comparação
bun run esqueleto/casos.ts --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-ts.jsonl
uv run python esqueleto/casos.py --relatorio ../specs/001-contrato-neutro/relatorios/us1-us3-py.jsonl
uv run python ../tools/verificar-contrato/comparar.py ../specs/001-contrato-neutro/relatorios/us1-us3-{ts,py}.jsonl

# as decisões da mesa, a marca e a conformidade
bun run esqueleto/referencia.ts
bun run esqueleto/marca.ts
bun run esqueleto/conferir.ts --bateria

# as provas de linha de comando
cd .. && bash tools/verificar-contrato/ponta-a-ponta.sh
bash tools/verificar-contrato/reinicio.sh
bash tools/verificar-contrato/reenvio.sh
bash tools/verificar-contrato/inventario.sh
bash tools/verificar-contrato/porteiro-dependencias.sh
bash tools/verificar-contrato/frescura.sh

# os critérios de forma e de dinheiro
cd contracts && bun run ../tools/verificar-contrato/ts/inspecionar.ts
uv run python ../tools/verificar-contrato/py/ida_e_volta.py
```

A revisão dos oito princípios da constituição, cada um com o comando que o mede, está em
`relatorios/constituicao.md`.
