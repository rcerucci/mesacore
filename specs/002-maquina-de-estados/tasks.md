# Tasks: A máquina de estados da mesa

**Input**: desenho em `specs/002-maquina-de-estados/` — `spec.md` (7 histórias, 44 FR, 12 SC),
`plan.md` (as quatro decisões), `research.md`, `data-model.md`, `contracts/interface.md`,
`quickstart.md`

**Testes**: incluídos **não por opção** — o portão da constituição diz que o teste que recusa a regra
existe **antes** do código que a cumpre, e o recorte 001 mostrou porquê (foi a bateria de casos
primeiro, e a falhar, que apanhou os defeitos que a leitura não apanha).

**Formato**: `[ID] [P?] [História] Descrição` — `[P]` = ficheiros diferentes, sem dependência.
Caminhos concretos em todas as tarefas.

---

## Phase 1: Setup (T001–T005)

**Purpose**: o `/core` deixa de ser uma pasta com um README.

- [ ] T001 Criar a árvore do core e das ferramentas: `core/{estados,ciclo,leitura,estado}/` e `tools/verificar-maquina/`
- [ ] T002 Escrever `core/package.json` (dependência `ajv ^8.20.0`, a mesma do contrato) e `core/tsconfig.json` (com os caminhos para `contracts/gerado/ts`), e correr `bun install` em `core/`
- [ ] T003 [P] Escrever `core/livro-de-motivos.ts`: carrega `contracts/vocabulario.json` e expõe os conjuntos fechados e os motivos — **nenhum motivo é escrito em código** neste recorte (RN-A1)
- [ ] T004 [P] Acrescentar `core/estado/.marcas.json` ao `.gitignore` e conferir que o ficheiro de marcas não é versionado (é estado, não código — R2)
- [ ] T005 [P] Escrever `tools/verificar-maquina/porteiro-do-estado.sh`: falha se `/core` importar `mocks/`, `tools/` ou `specs/`, e falha se o ficheiro de marcas tiver campo de posição (`unidades`, `quantidade`, `posicao`)

---

## Phase 2: Foundational (T006–T013)

**Purpose**: a tabela, o intérprete e as marcas. **Bloqueia todas as histórias.**

**⚠️ CRÍTICO**: nenhuma história começa antes desta fase fechar.

### A tabela (dado) e os invariantes

- [ ] T006 [P] Escrever `core/estados/transicoes.json`: as linhas de (estado, verbo) com `para` **ou** `recusa`, `guarda` e `nota` com a regra `RN-*` — os 4 estados × os 5 verbos, incluindo as recusas (`pause` em `parada`, `start` em `em_operacao`, `reset` em cada estado)
- [ ] T007 [P] Escrever `core/estados/transicoes.casos.json`: a bateria de pares (estado, verbo, contexto) com `resultado_esperado` e `motivo_esperado` — legais e **ilegais de propósito**
- [ ] T008 Escrever `tools/verificar-maquina/tabela.ts`: os cinco invariantes (todo o estado tem saída; todo o verbo tem casa; nenhum estado inalcançável a partir de `parada`; toda a recusa traz motivo do vocabulário; `reset` nunca leva a estado novo) + **prova negativa** guardada (tira uma saída à tabela, exige o vermelho, repõe)

### O intérprete e as marcas

- [ ] T009 Escrever `core/estados/maquina.ts`: carrega a tabela, procura (estado, verbo) com as guardas, aplica ou recusa com motivo — e **nunca** muda de estado sem linha que o autorize
- [ ] T010 [P] Escrever `core/estado/marcas.ts`: ler/gravar com escrita atómica (temporário + `rename`), com a forma do `data-model.md` §4 (`sessao`, `inibicao_cb`, `desconhecido[]`) e sem nenhum campo de posição
- [ ] T011 [P] Escrever `core/leitura/fixtures.ts`: a porta de leitura (R4) — lê as mensagens do contrato de ficheiros, **valida-as** contra o contrato antes de as devolver, e devolve `sem_leitura` quando a leitura falha
- [ ] T012 Escrever `core/estados/provar.ts`: o runner da bateria — uma linha `ok`/`FALHA` por caso, resumo no fim, saída 1 se houver divergência (a mesma gramática do recorte 001)
- [ ] T013 Correr `bun run core/estados/maquina.ts --casos core/estados/transicoes.casos.json` e `bash tools/verificar-maquina/porteiro-do-estado.sh`; guardar a saída em `specs/002-maquina-de-estados/relatorios/fundacional.txt`

**Checkpoint**: a tabela é conferível, o intérprete obedece-lhe e as marcas persistem. As histórias podem começar.

---

## Phase 3: User Story 1 — A mesa só faz o que pode fazer, e di-lo quando não pode (P1) 🎯 MVP

**Goal**: os cinco verbos, as transições legais e as recusas com motivo, com o estado intacto em cada recusa.

**Independent Test**: `bun run core/estados/maquina.ts --casos core/estados/transicoes.casos.json` → 100% dos pares legais mudam de estado, 100% dos ilegais recusam **com motivo** e o estado não muda (SC-001).

- [ ] T014 [P] [US1] Estender `core/estados/transicoes.casos.json` com os casos da história: `stop` repetido durante o encerramento, `start` com a mesa em operação, `pause` em `parada`, `reset` nos quatro estados
- [ ] T015 [US1] Implementar o `nao_tocado[]` do `reset` em `core/estados/maquina.ts`: a resposta lista explicitamente as marcas que **não** foram mexidas (FR-005)
- [ ] T016 [US1] Implementar a resposta do comando em `core/estados/resposta.ts` conforme `contracts/interface.md` §2: `resultado`, `estado_anterior`, `estado_novo`, `motivo`
- [ ] T017 [US1] Implementar a guarda `sem_posicao_viva` em `core/estados/maquina.ts`: `stop` leva a `parada` sem posição e a `encerrando` com posição (FR-012)
- [ ] T018 [US1] Implementar o registo da transição (`{instante, de, verbo, para, autor, motivo}`) em `core/estado/registo.ts`, com instante do relógio do venue (FR-041)
- [ ] T019 [US1] Implementar a recusa de comando com campo a mais (ficha, instrumento, saldo, lado) em `core/estados/comando.ts` — a porta dos verbos não aceita ordens (`interface.md` §1)
- [ ] T020 [US1] Correr a bateria de US1 e guardar `specs/002-maquina-de-estados/relatorios/us1.jsonl`

**Checkpoint**: a mesa é operável e recusa de forma compreensível — sozinha, sem mais nada deste recorte.

---

## Phase 4: User Story 2 — O instrumento que não está em condições não abre (P1)

**Goal**: as cinco condições (e o dado velho), com abrir/fechar/alarmar por condição, e o ciclo que decide.

**Independent Test**: `bun run core/ciclo/ciclo.ts --casos core/ciclo/ciclo.casos.json --historia US2` → **zero** decisões de `abrir` fora de `normal` (SC-002) e, com dado velho, fechar permitido em 100% e aberturas em 0 (SC-003).

- [ ] T021 [P] [US2] Escrever `core/ciclo/condicoes.casos.json`: uma leitura por condição (`normal`, `sem_leitura`, `divergente`, `congelada`, `mercado_fechado`) e o caso de dado velho, com a condição esperada e `abre`/`fecha`/`alarma` esperados
- [ ] T022 [P] [US2] Escrever `core/ciclo/ciclo.casos.json` (parte US2): a **mesma** proposta submetida em cada condição, com a decisão esperada
- [ ] T023 [US2] Implementar `core/ciclo/condicoes.ts`: das leituras para a condição, incluindo `dado_velho` contra `conta.idade_maxima_do_dado_ms` e os três derivados `abre`/`fecha`/`alarma`
- [ ] T024 [US2] Implementar `core/ciclo/decisao.ts`: o tipo `Decisao` (`data-model.md` §6) e a montagem da boleta a partir do mandato e do template
- [ ] T025 [US2] Implementar `core/ciclo/ciclo.ts`: a passagem por instrumento, devolvendo `Decisao[]` com motivo em cada `nada` — **sem enviar nada** (R5)
- [ ] T026 [US2] Implementar a ordem do ciclo: ler → conferir o CB → condição por instrumento → decidir → reconciliar
- [ ] T027 [US2] Implementar as regras de fechar por condição: permitido com dado velho; proibido em `sem_leitura`, `divergente`, `congelada` e `mercado_fechado` (FR-016 a FR-020)
- [ ] T028 [US2] Implementar a recusa de fecho como alarme grave com nova tentativa declarada (FR-026) e o `avisa` das condições que alarmam
- [ ] T029 [US2] Correr a bateria de US2 e guardar `specs/002-maquina-de-estados/relatorios/us2.jsonl`

**Checkpoint**: o instrumento deixou de abrir quando não deve — e o clássico "fechar às cegas" está impedido por teste.

---

## Phase 5: User Story 3 — O desfecho desconhecido fica desconhecido (P1)

**Goal**: a marca `desconhecido`, o bloqueio, e as duas saídas por reconciliação. Fecha o lado do SC-007 que ficou por medir no recorte 001.

**Independent Test**: `bun run core/ciclo/ciclo.ts --casos core/ciclo/ciclo.casos.json --historia US3` → a marca aparece em 100% dos casos de silêncio e nenhum vira `aceite`/`recusado` (SC-004); com a marca, zero decisões de `abrir` (SC-005); `bash tools/verificar-maquina/reiniciar.sh` → 0 marcas perdidas (SC-010).

- [ ] T030 [P] [US3] Estender `core/ciclo/ciclo.casos.json` (parte US3): silêncio além do prazo, proposta com a marca presente, as três reconciliações (preenchida, inexistente, indecidível) e o `reset` no meio
- [ ] T031 [US3] Implementar a escrita da marca `desconhecido` em `core/estado/marcas.ts` (instrumento, motivo, instante, `referencia_do_cliente`) quando o desfecho é `desconhecido`
- [ ] T032 [US3] Implementar o bloqueio: com a marca, `abrir` é recusado com motivo do vocabulário (`core/ciclo/ciclo.ts`)
- [ ] T033 [US3] Implementar as saídas por reconciliação em `core/ciclo/reconciliacao.ts`: decide preenchida → `aberta`; decide inexistente → `nenhuma`; não decide → a marca permanece e o motivo alarma
- [ ] T034 [US3] Implementar e testar que o `reset` **não** remove a marca (caso explícito da bateria, FR-029)
- [ ] T035 [P] [US3] Escrever `tools/verificar-maquina/reiniciar.sh`: marcar, reiniciar o processo (as marcas voltam do ficheiro), reencontrar — e falhar se alguma marca se perder
- [ ] T036 [US3] Correr a bateria de US3 e guardar `specs/002-maquina-de-estados/relatorios/us3.jsonl`

**Checkpoint**: nenhum desconhecido vira sucesso nem falha, e a mesa sobrevive a reiniciar sem perder o que sabia.

---

## Phase 6: User Story 4 — O arranque passa por seis portas (P2)

**Goal**: o `start` como verificação, com o motivo da porta que falhou — e sem corrigir nada.

**Independent Test**: `bun run core/ciclo/ciclo.ts --casos core/ciclo/arranque.casos.json --historia US4` → cada porta falhada recusa o arranque com o motivo daquela porta e a mesa fica `parada` (SC-006).

- [ ] T037 [P] [US4] Escrever `core/ciclo/arranque.casos.json`: as seis portas falhadas uma de cada vez, com o motivo esperado e `estado_esperado: parada`
- [ ] T038 [US4] Implementar `core/ciclo/arranque.ts`: as seis portas em sequência (manifesto, mandato, contenda, inventário, versão do contrato, sessão), cada uma a recusar com o seu motivo
- [ ] T039 [US4] Ligar a porta do inventário ao conferidor existente (`tools/verificar-contrato/py/inventario.py`) — uma só fonte de verdade sobre as chaves, em vez de uma segunda implementação
- [ ] T040 [US4] Implementar a recusa de corrigir: mandato com valor zero, negativo ou fora da banda recusa o arranque e **nada** é ajustado (FR-032)
- [ ] T041 [US4] Implementar a contenda: soma das fichas ≤ teto **ou** política de contenção declarada; sem declaração, recusa (FR-033)
- [ ] T042 [US4] Correr a bateria de US4 e guardar `specs/002-maquina-de-estados/relatorios/us4.jsonl`

---

## Phase 7: User Story 5 — A sessão é a unidade de comparação (P2)

**Goal**: sessão com configuração em vigor, CB por sessão, inibição e `nova_sessao` como única saída.

**Independent Test**: `bun run core/ciclo/ciclo.ts --casos core/ciclo/sessao.casos.json --historia US5` → CB dispara, liquida, deixa inibição marcada; `start` recusa em 100% dos casos com a marca (SC-007); `nova_sessao` grava a configuração em vigor.

- [ ] T043 [P] [US5] Escrever `core/ciclo/sessao.casos.json`: CB a disparar, `start` com inibição, `nova_sessao` com e sem posição viva, troca de setup sem sessão nova
- [ ] T044 [US5] Implementar `core/ciclo/cb.ts`: o CB por sessão sobre a perda do equity da corretora **com não realizado**, contra o limite declarado
- [ ] T045 [US5] Implementar `nova_sessao` em `core/estado/sessao.ts`: gravar instante, equity de partida, autor, motivo e a configuração em vigor; e levantar a inibição
- [ ] T046 [US5] Implementar a recusa de `start` com a inibição marcada e a recusa de trocar ficha/setup sem `nova_sessao`
- [ ] T047 [US5] Implementar o encadeamento do CB: `encerrando` → liquidação → `parada` com `inibicao_cb` e o motivo
- [ ] T048 [US5] Correr a bateria de US5 e guardar `specs/002-maquina-de-estados/relatorios/us5.jsonl`

---

## Phase 8: User Story 6 e 7 — Pausada defende; pedido ignorado não paralisa (P2/P3)

**Goal**: `pause` suspende abrir e mantém a defesa; e o encerramento sem resposta volta ao normal com o `stop` pendente.

**Independent Test**: `--historia US6` → zero aberturas em pausa e o CB a disparar em 100% dos casos de limite atingido (SC-008); `--historia US7` → 100% voltam a `em_operacao` com o `stop` pendente (SC-009).

- [ ] T049 [P] [US6] Escrever `core/ciclo/pausa.casos.json` (parte US6): proposta em pausa, limite atingido em pausa, ordem viva desconhecida em pausa, retomar
- [ ] T050 [US6] Implementar em `core/ciclo/ciclo.ts` que a pausa suspende `abrir` **apenas** — o CB e a reconciliação continuam a correr
- [ ] T051 [US6] Implementar a adopção de ordem viva desconhecida com a mesa pausada → `divergente` e alarme, sem cancelar (FR-021)
- [ ] T052 [US7] Escrever `core/ciclo/pausa.casos.json` (parte US7) e implementar o encerramento sem resposta: volta a `em_operacao` e registra o `stop` como pendente (FR-014)
- [ ] T053 [US7] Implementar o `resumo_do_encerramento` com a escolha necessária — incluindo o aviso de que "manter" deixa a posição **sem defesa** (`interface.md` §2)
- [ ] T054 [US6,US7] Correr as baterias e guardar `specs/002-maquina-de-estados/relatorios/us6-us7.jsonl`

---

## Phase 9: Polish & Cross-Cutting (T055–T062)

- [ ] T055 [P] Escrever `tools/verificar-maquina/provar.sh`: corre a tabela, as baterias, o porteiro do estado e a prova negativa — uma porta só, saída 1 se alguma falhar
- [ ] T056 [P] Declarar em `docs/inventario-de-chaves.md` as chaves que este recorte passa a usar (prazo do encerramento, lista de eventos que avisam, limites) e correr `tools/verificar-contrato/inventario.sh` (SC-012)
- [ ] T057 [P] Actualizar `core/README.md`: deixa de ser uma pasta com um README e passa a descrever a tabela, o intérprete, o ciclo e as marcas
- [ ] T058 [P] Actualizar `README.md` da raiz e `docs/maquina-de-estados.md` (a tabela passou a ser a **fonte**; o documento é a vista)
- [ ] T059 Correr o `quickstart.md` secção a secção e substituir cada promessa pela **saída real**
- [ ] T060 Escrever `specs/002-maquina-de-estados/relatorios/RESULTADO.md`: os 12 SC, cada um com o comando que o mediu — e o que não foi medido declarado como não medido
- [ ] T061 Escrever `specs/002-maquina-de-estados/relatorios/constituicao.md`: os oito princípios aplicados a este recorte, um a um
- [ ] T062 Revisão final: `grep` de segredos em `/core` (RN-E14), `bash tools/verificar-contrato/frescura.sh` (o contrato não regrediu) e `bash tools/verificar-contrato/ponta-a-ponta.sh` (a bateria do recorte 001 continua verde)
- [ ] T063 Escrever `tools/verificar-maquina/registo.ts`: reconstrói o estado da mesa a partir do registo de um dia de operação e **falha** se alguma linha de decisão de não-fazer vier sem motivo, ou se a reconstrução não fechar no estado final (SC-011)

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
