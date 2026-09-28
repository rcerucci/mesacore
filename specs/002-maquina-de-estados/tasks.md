# Tasks: A máquina de estados da mesa

**Input**: desenho em `specs/002-maquina-de-estados/` — `spec.md` (7 histórias, 44 FR, 12 SC),
`plan.md` (as quatro decisões), `research.md`, `data-model.md`, `contracts/interface.md`,
`quickstart.md`

**Testes**: incluídos **não por opção** — o portão da constituição diz que o teste que recusa a regra
existe **antes** do código que a cumpre, e o recorte 001 mostrou porquê (foi a bateria de casos
primeiro, e a falhar, que apanhou os defeitos que a leitura não apanha).

**Formato**: `[ID] [P?] [História] Descrição` — `[P]` = ficheiros diferentes, sem dependência.
Caminhos concretos em todas as tarefas.

## Estado da execução (medido em 28 set 2026)

Fases 1 e 2 fechadas. **O recorte 002 esta implementado e medido: 63 de 63 tarefas** — e a **fase 10 (emenda do dono, T064-T067) esta aberta** desde 28 set 2026: o recorte volta a estar fechado quando ela estiver medida. Os 12 SC estao no `relatorios/RESULTADO.md`. Comandos e números reais em
`relatorios/fundacional.txt` e `relatorios/us1.jsonl`.

| O que | Comando | Medido |
|---|---|---|
| Invariantes da tabela + prova negativa | `bun run tools/verificar-maquina/tabela.ts --prova-negativa` | **0 falhas nos 7 invariantes** · **7 provas negativas, 7 reprovadas** |
| Bateria dos pares (estado, verbo) | `bun run core/estados/provar.ts` | **29 casos · 13 aceites · 16 recusados · 0 divergentes · 0 recusas sem motivo** |
| Prova da mesa (comando → resposta → marcas → registo) | `bun run core/mesa.prova.ts` | **24 verificações · 0 falhas** |
| Porteiro do estado + prova negativa | `bash tools/verificar-maquina/porteiro-do-estado.sh` | **2 verificações · 0 falhas** · 2 provas negativas reprovadas |
| A bateria do recorte 001 não regrediu | `bash tools/verificar-contrato/ponta-a-ponta.sh` | **0 falhas** |

### US2 — as condições e o ciclo (T011, T021–T029)

| O que | Comando | Medido |
|---|---|---|
| Invariantes do livro das condições + prova negativa | `bun run core/ciclo/provar.ts` | **0 problemas** no livro · prova negativa **reprovada** (3 problemas apanhados) |
| Condições (o que se leu → o que se pode fazer) | `bun run core/ciclo/provar.ts` | **12 casos · 0 divergentes** |
| Ciclo (a mesma proposta em cada condição) | `bun run core/ciclo/provar.ts` | **20 casos · 0 divergentes** |
| SC-002 | idem | **0 decisões de abrir fora de `normal`** |
| SC-003 | idem | **0 aberturas com dado velho** · **1 de 1** pedidos legítimos de fechar permitidos |

Quatro defeitos apanhados pela própria bateria, e todos do mesmo tipo — dados meus que o instrumento
recusou:

1. a fixture usava `ema-cruz` e o contrato exige `^[a-z][a-z0-9_]{1,31}$` (**sem hífen**): a porta de
   leitura recusou-a, que é exactamente o que ela existe para fazer;
2. a `marca_de_posse` esperada num caso com `ciclo: 1` estava copiada do caso com `ciclo: 0` (a
   aritmética do código estava certa);
3. o caso «sem leitura também não fecha» não declarava posição — e sem posição o motivo certo é
   «não há o que fechar», não «fechar impedido»;
4. o motivo dizia `..._como_hold` no caso e `..._com_hold` no livro: a máquina apanhou o que a leitura
   não apanha. O nome ficou `proposta_ausente_tratada_como_hold`.

Duas decisões novas nasceram daí (**R9** e **R10** em `research.md`). A R10 é a que mais vale: com uma
condição única por instrumento, `congelada` + `divergente` perdiam a restrição que impede **fechar**
sobre um número que se sabe errado.

### US3 — o desfecho desconhecido fica desconhecido (T030–T036)

| O que | Comando | Medido |
|---|---|---|
| Desfecho: silêncio, aceite, parcial, recusa, confirmação ilegível | `bun run core/ciclo/provar.ts` | **8 casos · 0 divergentes** |
| Reconciliação: as duas saídas que decidem, a que não decide e o reset | idem | **6 casos · 0 divergentes** |
| **SC-004** | idem | **0 de 3** silêncios e **0 de 2** confirmações ilegíveis viraram `aceite`/`recusado` |
| **SC-005** | idem | **0 de 1** tentativas de abrir com a marca passaram (e há o par de controle: a mesma proposta sem a marca abre) |
| **SC-010** | `bash tools/verificar-maquina/reiniciar.sh` | **3 processos + 1 leitura externa em python · 0 marcas perdidas** · o `reset` não tocou em nada |
| A bateria toda | `bun run core/ciclo/provar.ts` | **62 verificações · 0 divergentes** |

Duas coisas mudaram de sítio ao executar, e as duas por a medição derrubar o texto:

1. **a lista dos avisos é do dono (R11)**. O `condicoes.json` tinha uma coluna `alarma` booleana — a mesa
   a decidir o que avisa, contra a FR-042. Passou a `evento` (o NOME), e quem decide se avisa é
   `conta.eventos_que_avisam[]`. Sem lista declarada ou com um nome inventado, **grita** em vez de não
   avisar. A bateria ficou com o mesmo dado em duas listas diferentes para o provar.
2. **o desconhecido não é uma condição (R12)**. É uma dívida da mesa consigo própria, e não passa com uma
   leitura nova: só uma reconciliação que decida a paga. A marca bloqueia ordem nova **naquele
   instrumento** e mais nada — defender continua permitido.

A prova do reinício (SC-010) foi feita com **três processos separados** e uma leitura final em python, que
não sabe nada do nosso código: se a marca sobrevivesse apenas por a variável continuar viva na memória, a
prova não provaria nada. E o `reset` é aplicado no meio, de propósito: é o caso que a spec pede
explicitamente (FR-029) e a porta por onde uma posição órfã entraria sem ninguém dar por ela.

**Uma dívida que fica registada**: um motivo inventado no runner (`reset_nao_toca_em_nada`) foi apanhado
porque não existia no livro. Passou a existir (FR-005) **e** a bateria ganhou a conferência cruzada dos
dois vocabulários — todos os motivos da mesa contra `motivos.json`, todos os motivos do contrato contra
`vocabulario.json`.

### US4 — o arranque passa por seis portas (T037–T042)

| O que | Comando | Medido |
|---|---|---|
| As seis portas, falhadas uma de cada vez | `bun run tools/verificar-maquina/arranque.ts` | **15 casos · 0 divergentes** |
| **SC-006** | idem | **0 arranques com porta falhada** · **11 de 11 recusas com o motivo daquela porta** |
| FR-032 (nada é ajustado) | idem | **15 de 15** casos com a configuração, as marcas e o manifesto iguais ao que entraram |
| A porta do inventário ligada ao conferidor que já existe | idem (caso `o-inventario-a-serio`) | corre o `inventario.py` num processo e lê o veredicto |
| Regressão | baterias 002 + ponta-a-ponta do 001 | **0 falhas** |

**Uma tarefa mudou de sítio, e por uma razão de fronteira.** As tarefas diziam `core/ciclo/ciclo.ts
--casos ...`: o runner ficou em `tools/verificar-maquina/arranque.ts` porque a porta do inventário corre
um processo, e o core não chama processos (RN-E2 — o porteiro do estado reprova quem o faça). A porta
entra no core como **função**, sem valor por omissão: uma porta que passa quando ninguém a ligou seria
pior do que não ter porta nenhuma. A implementação a sério vive em `tools/`, e a bateria usa-a nos casos
que não pedem um stub.

**O que a bancada de prova apanhou em si mesma**: o `fundir()` devolvia o objecto partilhado quando um
caso não trazia mudança, e o caso que apagava um campo do manifesto apagava-o para todos os seguintes — a
partir dali a bateria media outra coisa. Só apareceu porque a FR-032 obriga a comparar o que entrou com o
que saiu; a partir de agora o manifesto entra nessa comparação.

**Os pares de controle, que é onde está o valor**: os mesmos 60%+60% que recusam sem política declarada
**arrancam** com `politica_de_contencao, e o mesmo mandato que é recusado por zero arranca quando o valor
é legítimo. Sem as metades que passam, «recusa acima do tecto» podia estar no código em vez de na
declaração do dono.

### US5 — a sessão é a unidade de comparação (T043–T048)

| O que | Comando | Medido |
|---|---|---|
| CB por sessão, com não realizado, nas duas janelas | `bun run tools/verificar-maquina/sessao.ts` | **13 casos · 0 divergentes · 7 disparos** |
| **SC-007** (lado A) | idem | **0 de 1** `start` aceites depois do CB |
| **SC-007** (lado B) | idem | **1 de 1** sessões novas gravou a configuração em vigor antes de a mesa voltar a operar |
| **SC-008** (lado do CB) | idem | **1 de 1** casos com a mesa `pausada` dispararam |
| Motivos | idem | **6 de 6** constam do livro (conferência cruzada) |
| Regressão | baterias 002 + ponta-a-ponta do 001 | **0 falhas** |

**Três decisões que valem mais do que os números:**

1. **A comparação é exacta.** `perda ≥ limite` decide-se por multiplicação cruzada em `BigInt` — não há
   divisão, logo não há dízima, logo não há terceira casa decimal a decidir um disparo. O que se reporta é
   o **défice** (exacto), nunca uma percentagem arredondada ao lado de um limite de 5%. O par de casos que
   o prova: 5,00% de perda **dispara**, e 4,999% **não dispara**.
2. **O estado da mesa não entra no CB** (FR-040), e isso é medido de duas maneiras: o CB dispara com os
   mesmos dados com a mesa `pausada`, **e** o runner confere na fonte (já sem comentários) que o `cb.ts`
   não menciona estado nenhum. A segunda é o que impede a primeira de ser coincidência — e tem prova
   negativa própria. Se o estado entrasse como parâmetro, alguém acabaria a usá-lo para «não verificar
   quando está pausada», e a pausa passaria a ser o lugar onde a conta se afunda.
3. **`nova_sessao` é o único caminho fora da inibição** (FR-038): não há neste recorte nenhuma outra
   função que toque na inibição, e a sessão nova grava a configuração em vigor **no mesmo passo** em que a
   levanta — para não existir o instante em que há sessão nova com a inibição velha, nem inibição
   levantada sem sessão que a justifique.

**O defeito que a bateria apanhou em mim**: um caso sem sessão em curso (a troca de configuração antes de
haver sessão) fez o CB medir contra `null`. O conserto certo não foi no runner — foi no CB, que passou a
**gritar** quando não há sessão: *«não há sessão, a corrida não tem início, e uma perda sem início não se
mede»*. Devolver «não disparou» seria a mesa a dizer a si própria que está tudo bem para poder continuar.

Três tarefas mudaram de forma ao serem executadas, e ficam registadas para não parecer que foram
feitas como escritas:

- **T016** (a resposta do comando) **não ganhou ficheiro próprio**: o tipo `Resposta` e a sua
  construção vivem em `core/estados/maquina.ts`, que é onde a decisão acontece. Um `resposta.ts`
  separado só serviria para separar duas coisas que mudam juntas.
- **T003** cresceu para `core/livro-de-motivos.ts` — porque a implementação mostrou que o
  vocabulário do contrato **não tem** motivos de recusa da mesa (os 16 são de validade de mensagem).
  Isso virou a decisão **R7** em `research.md`, e a implementação apanhou ainda um segundo defeito da
  mesma família: três motivos meus com **nomes iguais** aos do contrato. Nasceu daí o invariante 7.
- **T011** (`core/leitura/fixtures.ts`) **fica aberta**: a porta de leitura só é usada a partir de
  US2, e escrever agora uma porta que ninguém chama seria código não exercitado. Ela nasce com US2.

---

## Phase 1: Setup (T001–T005)

**Purpose**: o `/core` deixa de ser uma pasta com um README.

- [x] T001 Criar a árvore do core e das ferramentas: `core/{estados,ciclo,leitura,estado}/` e `tools/verificar-maquina/`
- [x] T002 Escrever `core/package.json` (dependência `ajv ^8.20.0`, a mesma do contrato) e `core/tsconfig.json` (com os caminhos para `contracts/gerado/ts`), e correr `bun install` em `core/`
- [x] T003 [P] Escrever `core/livro-de-motivos.ts`: carrega `contracts/vocabulario.json` e expõe os conjuntos fechados e os motivos — **nenhum motivo é escrito em código** neste recorte (RN-A1)
- [x] T004 [P] Acrescentar `core/estado/.marcas.json` ao `.gitignore` e conferir que o ficheiro de marcas não é versionado (é estado, não código — R2)
- [x] T005 [P] Escrever `tools/verificar-maquina/porteiro-do-estado.sh`: falha se `/core` importar `mocks/`, `tools/` ou `specs/`, e falha se o ficheiro de marcas tiver campo de posição (`unidades`, `quantidade`, `posicao`)

---

## Phase 2: Foundational (T006–T013)

**Purpose**: a tabela, o intérprete e as marcas. **Bloqueia todas as histórias.**

**⚠️ CRÍTICO**: nenhuma história começa antes desta fase fechar.

### A tabela (dado) e os invariantes

- [x] T006 [P] Escrever `core/estados/transicoes.json`: as linhas de (estado, verbo) com `para` **ou** `recusa`, `guarda` e `nota` com a regra `RN-*` — os 4 estados × os 5 verbos, incluindo as recusas (`pause` em `parada`, `start` em `em_operacao`, `reset` em cada estado)
- [x] T007 [P] Escrever `core/estados/transicoes.casos.json`: a bateria de pares (estado, verbo, contexto) com `resultado_esperado` e `motivo_esperado` — legais e **ilegais de propósito**
- [x] T008 Escrever `tools/verificar-maquina/tabela.ts`: os cinco invariantes (todo o estado tem saída; todo o verbo tem casa; nenhum estado inalcançável a partir de `parada`; toda a recusa traz motivo do vocabulário; `reset` nunca leva a estado novo) + **prova negativa** guardada (tira uma saída à tabela, exige o vermelho, repõe)

### O intérprete e as marcas

- [x] T009 Escrever `core/estados/maquina.ts`: carrega a tabela, procura (estado, verbo) com as guardas, aplica ou recusa com motivo — e **nunca** muda de estado sem linha que o autorize
- [x] T010 [P] Escrever `core/estado/marcas.ts`: ler/gravar com escrita atómica (temporário + `rename`), com a forma do `data-model.md` §4 (`sessao`, `inibicao_cb`, `desconhecido[]`) e sem nenhum campo de posição
- [x] T011 [P] Escrever `core/leitura/fixtures.ts`: a porta de leitura (R4) — lê as mensagens do contrato de ficheiros, **valida-as** contra o contrato antes de as devolver, e devolve `sem_leitura` quando a leitura falha
- [x] T012 Escrever `core/estados/provar.ts`: o runner da bateria — uma linha `ok`/`FALHA` por caso, resumo no fim, saída 1 se houver divergência (a mesma gramática do recorte 001)
- [x] T013 Correr `bun run core/estados/maquina.ts --casos core/estados/transicoes.casos.json` e `bash tools/verificar-maquina/porteiro-do-estado.sh`; guardar a saída em `specs/002-maquina-de-estados/relatorios/fundacional.txt`

**Checkpoint**: a tabela é conferível, o intérprete obedece-lhe e as marcas persistem. As histórias podem começar.

---

## Phase 3: User Story 1 — A mesa só faz o que pode fazer, e di-lo quando não pode (P1) 🎯 MVP

**Goal**: os cinco verbos, as transições legais e as recusas com motivo, com o estado intacto em cada recusa.

**Independent Test**: `bun run core/estados/maquina.ts --casos core/estados/transicoes.casos.json` → 100% dos pares legais mudam de estado, 100% dos ilegais recusam **com motivo** e o estado não muda (SC-001).

- [x] T014 [P] [US1] Estender `core/estados/transicoes.casos.json` com os casos da história: `stop` repetido durante o encerramento, `start` com a mesa em operação, `pause` em `parada`, `reset` nos quatro estados
- [x] T015 [US1] Implementar o `nao_tocado[]` do `reset` em `core/estados/maquina.ts`: a resposta lista explicitamente as marcas que **não** foram mexidas (FR-005)
- [x] T016 [US1] Implementar a resposta do comando em `core/estados/resposta.ts` conforme `contracts/interface.md` §2: `resultado`, `estado_anterior`, `estado_novo`, `motivo`
- [x] T017 [US1] Implementar a guarda `sem_posicao_viva` em `core/estados/maquina.ts`: `stop` leva a `parada` sem posição e a `encerrando` com posição (FR-012)
- [x] T018 [US1] Implementar o registo da transição (`{instante, de, verbo, para, autor, motivo}`) em `core/estado/registo.ts`, com instante do relógio do venue (FR-041)
- [x] T019 [US1] Implementar a recusa de comando com campo a mais (ficha, instrumento, saldo, lado) em `core/estados/comando.ts` — a porta dos verbos não aceita ordens (`interface.md` §1)
- [x] T020 [US1] Correr a bateria de US1 e guardar `specs/002-maquina-de-estados/relatorios/us1.jsonl`

**Checkpoint**: a mesa é operável e recusa de forma compreensível — sozinha, sem mais nada deste recorte.

---

## Phase 4: User Story 2 — O instrumento que não está em condições não abre (P1)

**Goal**: as cinco condições (e o dado velho), com abrir/fechar/alarmar por condição, e o ciclo que decide.

**Independent Test**: `bun run core/ciclo/ciclo.ts --casos core/ciclo/ciclo.casos.json --historia US2` → **zero** decisões de `abrir` fora de `normal` (SC-002) e, com dado velho, fechar permitido em 100% e aberturas em 0 (SC-003).

- [x] T021 [P] [US2] Escrever `core/ciclo/condicoes.casos.json`: uma leitura por condição (`normal`, `sem_leitura`, `divergente`, `congelada`, `mercado_fechado`) e o caso de dado velho, com a condição esperada e `abre`/`fecha`/`alarma` esperados
- [x] T022 [P] [US2] Escrever `core/ciclo/ciclo.casos.json` (parte US2): a **mesma** proposta submetida em cada condição, com a decisão esperada
- [x] T023 [US2] Implementar `core/ciclo/condicoes.ts`: das leituras para a condição, incluindo `dado_velho` contra `conta.idade_maxima_do_dado_ms` e os três derivados `abre`/`fecha`/`alarma`
- [x] T024 [US2] Implementar `core/ciclo/decisao.ts`: o tipo `Decisao` (`data-model.md` §6) e a montagem da boleta a partir do mandato e do template
- [x] T025 [US2] Implementar `core/ciclo/ciclo.ts`: a passagem por instrumento, devolvendo `Decisao[]` com motivo em cada `nada` — **sem enviar nada** (R5)
- [x] T026 [US2] Implementar a ordem do ciclo: ler → conferir o CB → condição por instrumento → decidir → reconciliar
- [x] T027 [US2] Implementar as regras de fechar por condição: permitido com dado velho; proibido em `sem_leitura`, `divergente`, `congelada` e `mercado_fechado` (FR-016 a FR-020)
- [x] T028 [US2] Implementar a recusa de fecho como alarme grave com nova tentativa declarada (FR-026) e o `avisa` das condições que alarmam
- [x] T029 [US2] Correr a bateria de US2 e guardar `specs/002-maquina-de-estados/relatorios/us2.jsonl`

**Checkpoint**: o instrumento deixou de abrir quando não deve — e o clássico "fechar às cegas" está impedido por teste.

---

## Phase 5: User Story 3 — O desfecho desconhecido fica desconhecido (P1)

**Goal**: a marca `desconhecido`, o bloqueio, e as duas saídas por reconciliação. Fecha o lado do SC-007 que ficou por medir no recorte 001.

**Independent Test**: `bun run core/ciclo/ciclo.ts --casos core/ciclo/ciclo.casos.json --historia US3` → a marca aparece em 100% dos casos de silêncio e nenhum vira `aceite`/`recusado` (SC-004); com a marca, zero decisões de `abrir` (SC-005); `bash tools/verificar-maquina/reiniciar.sh` → 0 marcas perdidas (SC-010).

- [x] T030 [P] [US3] Estender `core/ciclo/ciclo.casos.json` (parte US3): silêncio além do prazo, proposta com a marca presente, as três reconciliações (preenchida, inexistente, indecidível) e o `reset` no meio
- [x] T031 [US3] Implementar a escrita da marca `desconhecido` em `core/estado/marcas.ts` (instrumento, motivo, instante, `referencia_do_cliente`) quando o desfecho é `desconhecido`
- [x] T032 [US3] Implementar o bloqueio: com a marca, `abrir` é recusado com motivo do vocabulário (`core/ciclo/ciclo.ts`)
- [x] T033 [US3] Implementar as saídas por reconciliação em `core/ciclo/reconciliacao.ts`: decide preenchida → `aberta`; decide inexistente → `nenhuma`; não decide → a marca permanece e o motivo alarma
- [x] T034 [US3] Implementar e testar que o `reset` **não** remove a marca (caso explícito da bateria, FR-029)
- [x] T035 [P] [US3] Escrever `tools/verificar-maquina/reiniciar.sh`: marcar, reiniciar o processo (as marcas voltam do ficheiro), reencontrar — e falhar se alguma marca se perder
- [x] T036 [US3] Correr a bateria de US3 e guardar `specs/002-maquina-de-estados/relatorios/us3.jsonl`

**Checkpoint**: nenhum desconhecido vira sucesso nem falha, e a mesa sobrevive a reiniciar sem perder o que sabia.

---

## Phase 6: User Story 4 — O arranque passa por seis portas (P2)

**Goal**: o `start` como verificação, com o motivo da porta que falhou — e sem corrigir nada.

**Independent Test**: `bun run core/ciclo/ciclo.ts --casos core/ciclo/arranque.casos.json --historia US4` → cada porta falhada recusa o arranque com o motivo daquela porta e a mesa fica `parada` (SC-006).

- [x] T037 [P] [US4] Escrever `core/ciclo/arranque.casos.json`: as seis portas falhadas uma de cada vez, com o motivo esperado e `estado_esperado: parada`
- [x] T038 [US4] Implementar `core/ciclo/arranque.ts`: as seis portas em sequência (manifesto, mandato, contenda, inventário, versão do contrato, sessão), cada uma a recusar com o seu motivo
- [x] T039 [US4] Ligar a porta do inventário ao conferidor existente (`tools/verificar-contrato/py/inventario.py`) — uma só fonte de verdade sobre as chaves, em vez de uma segunda implementação
- [x] T040 [US4] Implementar a recusa de corrigir: mandato com valor zero, negativo ou fora da banda recusa o arranque e **nada** é ajustado (FR-032)
- [x] T041 [US4] Implementar a contenda: soma das fichas ≤ teto **ou** política de contenção declarada; sem declaração, recusa (FR-033)
- [x] T042 [US4] Correr a bateria de US4 e guardar `specs/002-maquina-de-estados/relatorios/us4.jsonl`

---

## Phase 7: User Story 5 — A sessão é a unidade de comparação (P2)

**Goal**: sessão com configuração em vigor, CB por sessão, inibição e `nova_sessao` como única saída.

**Independent Test**: `bun run core/ciclo/ciclo.ts --casos core/ciclo/sessao.casos.json --historia US5` → CB dispara, liquida, deixa inibição marcada; `start` recusa em 100% dos casos com a marca (SC-007); `nova_sessao` grava a configuração em vigor.

- [x] T043 [P] [US5] Escrever `core/ciclo/sessao.casos.json`: CB a disparar, `start` com inibição, `nova_sessao` com e sem posição viva, troca de setup sem sessão nova
- [x] T044 [US5] Implementar `core/ciclo/cb.ts`: o CB por sessão sobre a perda do equity da corretora **com não realizado**, contra o limite declarado
- [x] T045 [US5] Implementar `nova_sessao` em `core/estado/sessao.ts`: gravar instante, equity de partida, autor, motivo e a configuração em vigor; e levantar a inibição
- [x] T046 [US5] Implementar a recusa de `start` com a inibição marcada e a recusa de trocar ficha/setup sem `nova_sessao`
- [x] T047 [US5] Implementar o encadeamento do CB: `encerrando` → liquidação → `parada` com `inibicao_cb` e o motivo
- [x] T048 [US5] Correr a bateria de US5 e guardar `specs/002-maquina-de-estados/relatorios/us5.jsonl`

---

## Phase 8: User Story 6 e 7 — Pausada defende; pedido ignorado não paralisa (P2/P3)

**Goal**: `pause` suspende abrir e mantém a defesa; e o encerramento sem resposta volta ao normal com o `stop` pendente.

**Independent Test**: `--historia US6` → zero aberturas em pausa e o CB a disparar em 100% dos casos de limite atingido (SC-008); `--historia US7` → 100% voltam a `em_operacao` com o `stop` pendente (SC-009).

- [x] T049 [P] [US6] Escrever `core/ciclo/pausa.casos.json` (parte US6): proposta em pausa, limite atingido em pausa, ordem viva desconhecida em pausa, retomar
- [x] T050 [US6] Implementar em `core/ciclo/ciclo.ts` que a pausa suspende `abrir` **apenas** — o CB e a reconciliação continuam a correr
- [x] T051 [US6] Implementar a adopção de ordem viva desconhecida com a mesa pausada → `divergente` e alarme, sem cancelar (FR-021)
- [x] T052 [US7] Escrever `core/ciclo/pausa.casos.json` (parte US7) e implementar o encerramento sem resposta: volta a `em_operacao` e registra o `stop` como pendente (FR-014)
- [x] T053 [US7] Implementar o `resumo_do_encerramento` com a escolha necessária — incluindo o aviso de que "manter" deixa a posição **sem defesa** (`interface.md` §2)
- [x] T054 [US6,US7] Correr as baterias e guardar `specs/002-maquina-de-estados/relatorios/us6-us7.jsonl`

---

## Phase 9: Polish & Cross-Cutting (T055–T063) — **fechada**

**Uma porta, uma saída:** `bash tools/verificar-maquina/provar.sh` → **15 de 15**. Relatório dos 12 SC em
`relatorios/RESULTADO.md`; a constituição aplicada em `relatorios/constituicao.md`. O que o recorte **nao**
mediu esta la declarado como nao medido.

- [x] T055 [P] Escrever `tools/verificar-maquina/provar.sh`: corre a tabela, as baterias, o porteiro do estado e a prova negativa — uma porta só, saída 1 se alguma falhar
- [x] T056 [P] Declarar em `docs/inventario-de-chaves.md` as chaves que este recorte passa a usar (prazo do encerramento, lista de eventos que avisam, limites) e correr `tools/verificar-contrato/inventario.sh` (SC-012)
- [x] T057 [P] Actualizar `core/README.md`: deixa de ser uma pasta com um README e passa a descrever a tabela, o intérprete, o ciclo e as marcas
- [x] T058 [P] Actualizar `README.md` da raiz e `docs/maquina-de-estados.md` (a tabela passou a ser a **fonte**; o documento é a vista)
- [x] T059 Correr o `quickstart.md` secção a secção e substituir cada promessa pela **saída real**
- [x] T060 Escrever `specs/002-maquina-de-estados/relatorios/RESULTADO.md`: os 12 SC, cada um com o comando que o mediu — e o que não foi medido declarado como não medido
- [x] T061 Escrever `specs/002-maquina-de-estados/relatorios/constituicao.md`: os oito princípios aplicados a este recorte, um a um
- [x] T062 Revisão final: `grep` de segredos em `/core` (RN-E14), `bash tools/verificar-contrato/frescura.sh` (o contrato não regrediu) e `bash tools/verificar-contrato/ponta-a-ponta.sh` (a bateria do recorte 001 continua verde)
- [x] T063 Escrever `tools/verificar-maquina/registo.ts`: reconstrói o estado da mesa a partir do registo de um dia de operação e **falha** se alguma linha de decisão de não-fazer vier sem motivo, ou se a reconstrução não fechar no estado final (SC-011)

---

## Phase 10: Emenda do dono (T064–T067) — aberta em 28 set 2026

**Goal**: cumprir as quatro decisões do dono registadas em `docs/inventario-de-chaves.md` §8 e nas Emendas
de `docs/regra-de-negocio.md`. Cada uma com o mesmo padrão do resto: **caso que falha antes**, medido
depois.

- [ ] T064 [US2] A condição `dado_velho` passa a ser alimentada pelo **estado da ligação** (facto declarado); o limiar de idade sai do caminho da decisão. Par de casos com o mesmo dado: ligado / desligado
- [ ] T065 [US2] Substituir o gatilho do contador de inválidos pela **tabela por motivo** (*repetir com atraso* · *recusar e registar* · *parar e reconciliar*), com o caso de controlo: sem confirmação, **reconciliar primeiro** — repetir às cegas abre uma segunda posição
- [ ] T066 [US4] A porta da contenda passa a **FIFO** (instante do pedido no relógio do venue) com desempate alfabético; registrar o critério (`fifo` | `fifo_desempatado_por_simbolo`). A ordem decide quem fica de fora, nunca a ordem de execução
- [ ] T067 [US4] Declarar no manifesto do conector as três obrigações novas — reportar a ligação pelo protocolo, reler o preço no envio, devolver a resolução — e **nomear como defeito** a conferência da resolução contra a banda que hoje não existe (é trabalho do recorte do conector)

---

## Dependencies & Execution Order

### Fases

- **Setup (1)**: sem dependências
- **Foundational (2)**: depende do Setup — **bloqueia todas as histórias**
- **US1 (3)**: depende da tabela e do intérprete (T006–T009)
- **US2 (4)**: depende da fundação (condições usam a porta de leitura, T011)
- **US3 (5)**: depende de US2 (o ciclo tem de existir para haver desfecho a classificar)
- **US4 (6)**: depende de sessão/marcas (T010) e da configuração; **não** depende de US2/US3
- **US5 (7)**: depende de US4 (a porta da sessão) e do CB
- **US6/US7 (8)**: dependem de US2 (o ciclo) e de US5 (o CB)
- **Polish (9)**: depende das histórias que se queira entregar

### Dentro de cada história

**Casos primeiro, e a falhar** (o caso que recusa a regra existe antes do código); depois o dado
(tabela), depois o código que o lê, depois o relatório. Um relatório que não existe é uma história que
não está feita, independentemente do que o código pareça fazer.

### Parallel Opportunities

- Fase 1: T003, T004, T005 em paralelo
- Fase 2: T006, T007 em paralelo; T010, T011 em paralelo
- US1: T014 em paralelo com o resto (casos são ficheiro próprio)
- US2: T021, T022 em paralelo (dois ficheiros de casos)
- US3: T030 e T035 em paralelo
- US4: T037 isolado (casos) — o resto é sequencial (mesma peça)
- Polish: T055 a T058 em paralelo

---

## Implementation Strategy

### MVP primeiro

`Setup` + `Foundational` + **US1** (P1) — e parar para validar com o relatório em ficheiro. A partir daí
as outras P1 (US2, US3) fecham o que dói de verdade: não abrir quando não se deve, e não inventar
desfecho.

### Entrega incremental

Cada história fecha com o seu relatório em `specs/002-maquina-de-estados/relatorios/`. As histórias P2
(US4, US5, US6) podem entregar-se depois do MVP sem tocar no que já está provado — **US4 não depende de
US2 nem de US3**, e é essa independência que permite entregá-lo primeiro se o dono preferir o arranque
ao ciclo.

---

## Notas

- **Uma só fonte por regra**: a tabela é a fonte das transições; o vocabulário do contrato é a fonte dos
  motivos; o inventário é a fonte dos valores. Nada disto se repete em código.
- **Nenhum valor no código** (SC-012): prazos, limites e listas vêm do inventário — se aparecer um
  número, é defeito e a correcção é no `docs/inventario-de-chaves.md`.
- **A máquina decide, não envia** (R5): se um teste precisar de corretora para medir uma decisão, o
  desenho está errado.
- **Credencial, token ou segredo em qualquer ficheiro deste recorte reprova a revisão** (RN-E14).
- **O ficheiro de marcas nunca ganha posições** (R2) — é o invariante que o porteiro do estado protege, e
  é o que mantém uma mesa que se reinstala em vez de uma que se engana.
- Commit por tarefa ou por grupo lógico, com a mensagem a dizer o que ficou **medido**.

---

## Cobertura: nenhum requisito fica órfão

Cada requisito tem **a tarefa que o prova**. Uma linha sem tarefa é um requisito que ninguém executa — e
foi esse o defeito que a checklist do recorte 001 apanhou (FR-028 sem cenário que a recusasse). Este mapa
existe para que a mesma falha não passe em silêncio.

| FR | Provado por | FR | Provado por |
|---|---|---|---|
| FR-001 | T006, T007 | FR-023 | T024, T029 |
| FR-002 | T021, T023 | FR-024 | T024, T029 |
| FR-003 | T023, T024 | FR-025 | T024, T047 |
| FR-004 | T007, T009 | FR-026 | T028 |
| FR-005 | T015, T034 | FR-027 | T031 |
| FR-006 | T023, T025 | FR-028 | T032, T036 |
| FR-007 | T025, T063 | FR-029 | T033, T034 |
| FR-008 | T014, T016 | FR-030 | T033 |
| FR-009 | T025, T026 | FR-031 | T037, T038 |
| FR-010 | T050 | FR-032 | T040 |
| FR-011 | T053 | FR-033 | T041 |
| FR-012 | T017 | FR-034 | T045 |
| FR-013 | T047, T053 | FR-035 | T044 |
| FR-014 | T052 | FR-036 | T047 |
| FR-015 | T023, T027 | FR-037 | T046 |
| FR-016 | T027 | FR-038 | T045, T046 |
| FR-017 | T027, T033 | FR-039 | T046 |
| FR-018 | T023, T027 | FR-040 | T050 |
| FR-019 | T027 | FR-041 | T018, T063 |
| FR-020 | T023, T027 | FR-042 | T028, T056 |
| FR-021 | T051 | FR-043 | T035 |
| FR-022 | T005, T023 | FR-044 | T056, T062 |

| SC | Provado por | SC | Provado por |
|---|---|---|---|
| SC-001 | T008, T013, T020 | SC-007 | T048 |
| SC-002 | T029 | SC-008 | T054 |
| SC-003 | T029 | SC-009 | T054 |
| SC-004 | T036 | SC-010 | T035 |
| SC-005 | T032, T036 | SC-011 | **T063** |
| SC-006 | T042 | SC-012 | T056 |

**Achado da análise cruzada** (28 set): na primeira escrita, **SC-011 não tinha tarefa nenhuma** — o
critério que exige que um dia de operação seja reconstruível a partir do registo não era medido por
ninguém. Nasceu daí a **T063**. É exactamente o defeito da FR-028 do recorte 001, e é a razão de este
mapa existir: a análise cruzada entre spec, plano e tarefas encontrou-o antes da implementação, não
depois.

| História | Tarefas | Relatório |
|---|---|---|
| US1 (P1) | T014–T020 | `relatorios/us1.jsonl` |
| US2 (P1) | T021–T029 | `relatorios/us2.jsonl` |
| US3 (P1) | T030–T036 | `relatorios/us3.jsonl` |
| US4 (P2) | T037–T042 | `relatorios/us4.jsonl` |
| US5 (P2) | T043–T048 | `relatorios/us5.jsonl` |
| US6, US7 (P2/P3) | T049–T054 | `relatorios/us6-us7.jsonl` |
