# Tasks: O vigia e a mesa, ponta-a-ponta contra dublês

**Input**: desenho em `specs/003-vigia-e-mesa/` — `spec.md` (7 histórias, 35 FR, 8 SC), `plan.md` (as cinco
decisões), `research.md` (R1 a R9), `data-model.md`, `contracts/interface.md`, `quickstart.md`.

**Testes**: incluídos **não por opção** — o portão da constituição diz que o teste que recusa a regra existe
**antes** do código que a cumpre, e os dois recortes anteriores mostraram porquê (foi a bateria a falhar
primeiro que apanhou os defeitos que a leitura não apanha). Aqui, «teste» é a **bancada declarada**: casos em
dado, um por regra, e a contagem no fim.

**Formato**: `[ID] [P?] [História] Descrição` — `[P]` = ficheiros diferentes, sem dependência. Caminhos
concretos em todas as tarefas.

**Estado da execução**: **fases 1 e 2 FECHADAS** (T001–T018). O contrato está em 1.1.0 com os quatro tipos
provados nas duas linguagens, e a mesa tem porta de processo. A porta única está em **17 de 17**. O próximo é
a **US1** (T019–T026): o vigia de pé, que é o MVP deste recorte. A linha de base medida está
em `relatorios/linha-de-base.txt` (porta única **16 de 16**, `chaves.ts` 3 verificações · 0 divergentes · 7
chaves, **116** sítios da versão `1.0.0` em **19** ficheiros de contrato). O recorte 002 está fechado (67 de 67) e a porta única em
**16 de 16**; o contrato está em **1.0.0**. Os números que estas tarefas usam foram medidos, não estimados:
a versão `1.0.0` aparece em **116 sítios em 19 ficheiros** (105 mensagens `contrato` + 11 manifestos `versao`); os motivos da mesa são **42**, dos quais **20** cruzam
a fronteira (R7); a mesa **não** tem porta de processo.

---

## Phase 1: Setup (T001–T004)

**Purpose**: linha de base medida, a chave que este recorte precisa, e os esqueletos dos ficheiros novos.

- [x] T001 Medir a **linha de base** (`bash tools/verificar-maquina/provar.sh`, `bun run tools/verificar-maquina/chaves.ts`, a contagem de `1.0.0` em `contracts/`) e guardar em `specs/003-vigia-e-mesa/relatorios/linha-de-base.txt` — sem isto não se sabe o que o recorte mexeu
- [x] T002 [P] Declarar a chave **`setup.prazo_de_resposta_ms`** no inventário (`docs/inventario-de-chaves.md` §7) e no schema do dono — nome, tipo, unidade, valor por omissão e significado, **sem inventar o valor** (RN-A3: a spec inventa a chave, o valor é do dono)
- [x] T003 [P] Criar `tools/verificar-maquina/vigia.sh` — a porta deste recorte, com os modos `--arranque`, `--orfandade`, `--encerramento`, `--verbos` (esqueleto que chama a bancada, ainda sem casos)
- [x] T004 [P] Criar `contracts/mocks/mesa/README.md` — o que o dublê de mesa é, o que promete e **o que não promete** (não substitui a conformidade da corretora, RN-C6)

---

## Phase 2: Foundational (T005–T018)

**Purpose**: o contrato na versão nova e a porta de processo da mesa. **Bloqueia todas as histórias** — sem a
mensagem não há fronteira, e sem a porta o vigia não tem o que arrancar.

**⚠️ CRITICAL**: nenhuma história começa antes desta fase fechar.

### O contrato sobe para 1.1.0

**FEITO (T005–T013).** O relato medido está em `relatorios/migracao-da-versao.txt` — incluindo os pontos em
que a máquina me corrigiu (o `$id` contra o nome do ficheiro, o `strictRequired` do ajv, a origem das
grandezas novas, e o segundo nome da versão no topo do manifesto). Duas notas de fidelidade ao que foi feito:
(a) o `resumo` de T007 nasceu partido em `numeros` (os cinco da corretora) e `aviso_de_manter` (nosso) porque
assim o mapa de origem consegue dizer de quem é cada um — a pergunta é da mesa, os números são do venue;
(b) os quatro tipos vivem num só ficheiro de casos (`casos/vigia.casos.json`, 16 casos), porque a fronteira é
uma só.

- [x] T005 [P] `contracts/comando.schema.json` — envelope de sempre + carga `{verbo, autor, pedido_id, motivo?}`; `verbo` do conjunto **fechado de 5**; `motivo` obrigatório **só** no `nova_sessao`; `additionalProperties: false`
- [x] T006 [P] `contracts/resposta-de-comando.schema.json` — `aceito` booleano; `motivo` quando recusado, `efeito` quando aceito (conjuntos fechados, R7); `transicao {de, para}`; `instante_ms`
- [x] T007 [P] `contracts/pergunta-do-encerramento.schema.json` — `resumo` (os números da corretora, RN-V8), `opcoes` fechadas (`fechar_a_mercado`, `manter`), `prazo_de_resposta_ms` (**a chave de T002**), `aviso_de_manter`
- [x] T008 [P] `contracts/decisao-do-encerramento.schema.json` — `{pedido_id, resposta}` com `resposta` fechada; **sem** campo de verbo (a decisão não é um verbo, R5)
- [x] T009 [P] `contracts/vocabulario.json` ganha a família `motivos_de_comando` com os **20** de R7, e cada motivo declara **de que conjunto fechado vem** (a lição da `fail-closed-validation`)
- [x] T010 `contracts/versao.json` → **1.1.0** e a migração: **116 sítios em 19 ficheiros** (105 mensagens `contrato` + 11 manifestos `versao`), com a medida em `relatorios/migracao-da-versao.txt`; nenhum `1.0.0` **de contrato** sobra — os 38 que ficam são versões de plugin/pacote, e ficar é o certo
- [x] T011 [P] `contracts/casos/comando.casos.json` — aceites e recusados pelo mesmo critério dos outros ficheiros de caso (um campo a mais, tipo errado, verbo desconhecido, `nova_sessao` sem motivo)
- [x] T012 Regenerar `contracts/gerado/ts`, `contracts/gerado/py` e `contracts/esqueleto/*` nas duas linguagens, e conferir a **frescura** (`bash tools/verificar-contrato/frescura.sh`)
- [x] T013 `bash tools/verificar-contrato/ponta-a-ponta.sh` e `inventario.sh` passam a 1.1.0 e ganham os casos novos, **somando** aos que já contavam

### A mesa ganha porta de processo (T014–T018 — FEITO)

**FEITO.** A porta é `core/servidor.ts` (processo: uma linha entra, uma linha sai), a bancada é
`tools/verificar-maquina/servidor.ts` (**77 verificações · 0 divergentes · 6 casos · 6 processos**), e a porta
única passou a **17 de 17**. Três achados, todos medidos, e um deles **contra a minha própria recomendação**:

1. **A mesa não pode correr as seis portas sozinha.** O `arrancar()` precisa de quatro coisas que não nascem
   na mesa: o *registo de operação retomado* (é do vigia), o *conferidor de inventário* (vive em `tools/`, e
   o `/core` não pode importá-lo — RN-E2), o manifesto e a posição. Corrigi a recomendação que tinha dado ao
   dono: quem **produz** o desfecho das portas é o vigia (T021 decide por que canal); à mesa cabe **decidir
   sobre ele** — e enquanto ele não chegar, o `start` **recusa**, nomeando a porta `(não conferidas)`.
2. **Duas verdades entram por argumento, não por campo na mensagem**: `--portas` e `--posicao-viva`. O
   `comando` não tem contexto e não pode ter (campo a mais recusa) — foi essa a razão de o desconhecido
   ganhar nome próprio (`posicao_desconhecida`, que **vem da porta**, não do livro).
3. **D-006**: as guardas `sem_posicao_viva` e `portas_do_arranque_falham` tratam «não sei» como «não há» — a
   mesa arrancaria sem conferir e pararia sem perguntar. A porta fecha-o por fora (recusando); a correcção
   dentro da tabela é do US3.

- [x] T014 `core/servidor.ts` — a porta: lê **uma linha** JSON, entrega ao intérprete da mesa, escreve **uma** linha. Não decide, não tem log próprio, não lê configuração que a mesa já lê
- [x] T015 `core/estados/comando.ts` — a validação re-alojada na **mensagem do contrato** (não numa forma própria ao lado): os mesmos três motivos, agora com versão conferida
- [x] T016 [P] `tools/verificar-maquina/servidor.ts` — bancada da porta: linha entra/linha sai; campo a mais recusado; versão diferente recusada; comando sem autor recusado
- [x] T017 `core/estados/motivos.json` — cada um dos 42 motivos ganha `cruzam_a_fronteira: true|false` (20/22), para a conferência das duas direcções ter **âmbito declarado**
- [x] T018 Ligar a porta da mesa ao `provar.sh` e medir: as 16 verificações continuam a passar **e** a bancada da porta entra na contagem

**Checkpoint**: o contrato está em 1.1.0 nas duas linguagens, a mesa fala por porta, e nada do que estava provado caiu.

---

## Phase 3: User Story 1 — O dono pede arranque e a mesa só arranca se puder (P1) 🎯 MVP

**Goal**: o vigia existe como processo, obedece aos cinco verbos, e um `start` recusado devolve **o motivo daquela porta** — nunca um genérico, nunca silêncio.

**Independent Test**: `bash tools/verificar-maquina/vigia.sh --arranque` — com uma ficha que falha uma porta, a resposta nomeia aquela porta; com tudo válido, a mesa fica `em_operacao` e a transição fica no `.vigia.json`.

- [x] T019 [US1] `vigia/vigia.ts` — o processo: cinco verbos, uma linha por comando, uma por resposta
- [x] T020 [US1] `vigia/registro.ts` — `.vigia.json` com escrita **atómica** (tmp + rename), uma linha por transição
- [x] T021 [US1] `start` submete a mesa às **seis portas** e devolve a recusa com o motivo **daquela** porta (`porta_do_arranque_falhou` traz o nome dela no detalhe)
- [x] T022 [US1] `start` numa mesa em operação → `mesa_ja_em_operacao`; `stop` numa mesa parada → `mesa_ja_parada`; ambos com transição `{de, para}`
- [x] T023 [US1] A resposta de comando: aceito traz **efeito**, recusado traz **motivo**, e o `instante_ms` é do **relógio da mesa** (RN-M4.9)
- [x] T024 [P] [US1] `tools/verificar-maquina/vigia.ts --arranque` — casos: porta falhada por porta (cada uma das seis), `start` repetido, `stop` em parada, comando com campo a mais
- [x] T025 [US1] Ligar `--arranque` à porta única (`tools/verificar-maquina/vigia.sh`) e medir
- [x] T026 [US1] `specs/003-vigia-e-mesa/relatorios/us1.txt` — o comando e a saída, sem paráfrase

**Checkpoint (medido)**: US1 é o MVP — **61 de 61** as tarefas T019–T026 estão feitas e a bancada do vigia
mede **46 verificações · 0 divergentes · 10 cenários**, com o vigia E a mesa como processos
(`bash tools/verificar-maquina/vigia.sh --arranque`; saída crua em `relatorios/us1.txt`).

Duas coisas que a implementação mudou em relação ao que estava escrito aqui:

- **T021 — o nome da porta vive no registro do vigia, e não na mensagem.** A resposta de comando é fechada
  (`additionalProperties: false`) e não tem campo `detalhe`; acrescentar-lhe um seria mexer no contrato para
  caber um diagnóstico. O vigia sabe qual porta recusou (foi ele que as correu) e escreve-o em
  `vigia/.vigia.json`, com a lista do que se chegou a conferir. Fica dito para não se procurar no sítio errado.
- **T022 — a porta não recusa por não saber a posição: recusa se o que não sabe MUDAR a resposta.** A regra
  antiga (pré-verificar e recusar) escondia a verdade da mesa: um `stop` numa mesa já parada respondia
  `posicao_desconhecida` em vez de `mesa_ja_parada`. Agora a porta pergunta à **tabela** (função pura, sem
  gravar nada) com a posição a `false` e a `true`: se a resposta é a mesma, a mesa decide; se muda, recusa.

---

## Phase 4: User Story 2 — A mesa sobrevive à morte do vigia (P1)

**Goal**: matar o vigia não para nada. É esta história que prova que a fronteira é real.

**Independent Test**: `bash tools/verificar-maquina/vigia.sh --orfandade` — mata o vigia com a mesa a operar, corre N ciclos e conta as linhas **novas** do ledger: têm de ser **N** (SC-001).

- [ ] T027 [US2] O vigia arranca a mesa como **processo separado** e arranca os **conectores** que a configuração nomeia (RN-E21); se um conector faltar, a mesa recusa o arranque **dizendo qual**
- [ ] T028 [US2] Com o vigia morto, a mesa continua a reconciliar, a conferir o CB e a escrever no ledger (RN-V6)
- [ ] T029 [US2] Quando o vigia volta, ele **lê o estado da mesa** e não tenta arrancar nada por conta própria
- [ ] T030 [US2] Um só escritor na costura: um segundo canal é **recusado** (o precedente é o RN-E7)
- [ ] T031 [P] [US2] `tools/verificar-maquina/vigia.ts --orfandade` — a contagem das linhas novas e a leitura do estado no regresso
- [ ] T032 [US2] `relatorios/us2.txt` — comando e saída, e o número de ciclos comparado com as linhas

---

## Phase 5: User Story 3 — O encerramento é gracioso e não deixa posição sem governo (P1)

**Goal**: `stop` com posição aberta pergunta antes de sair, e nunca sai em silêncio.

**Independent Test**: `bash tools/verificar-maquina/vigia.sh --encerramento` — sem resposta, a mesa volta a `em_operacao` (a abrir incluído) com o `stop` **pendente**; com «fechar», fecha a mercado; com «manter», o aviso diz o que resta.

- [ ] T033 [US3] A mesa emite `pergunta_do_encerramento` com o **resumo** (números da corretora) e o `aviso_de_manter` como **campo**
- [ ] T034 [US3] O vigia entrega `decisao_do_encerramento` com o `pedido_id` da pergunta; decisão sem pergunta é recusada
- [ ] T035 [US3] `fechar_a_mercado` fecha e registra o desfecho; `manter` deixa parada com posição viva e o aviso no registro
- [ ] T036 [US3] Sem resposta dentro do prazo: a mesa volta a `em_operacao` **a abrir incluído**, com o `stop` arquivado como pendente (RN-V9.1)
- [ ] T037 [US3] `reset` durante o encerramento volta ao normal **sem** fechar posição, **sem** apagar ledger e **sem** limpar o desconhecido
- [ ] T038 [P] [US3] `tools/verificar-maquina/vigia.ts --encerramento` — os quatro desfechos e a decisão sem pergunta
- [ ] T039 [US3] `relatorios/us3.txt`

---

## Phase 6: User Story 4 — `pause` não é `stop`, e `reset` não altera nada (P2)

**Goal**: os três verbos em que uma confusão custa dinheiro.

**Independent Test**: `bash tools/verificar-maquina/vigia.sh --verbos` — com a mesa pausada e posição aberta, o CB **fecha**; com a inibição presente, o `reset` **não limpa**; `nova_sessao` sem motivo é recusada.

- [ ] T040 [US4] `pause` suspende **abertura** e não suspende reconciliação nem CB (RN-V2.1)
- [ ] T041 [US4] `reset` reinicia sem alterar nada — e **di-lo** (o efeito `reset_nao_toca_em_nada`), sem limpar inibição nem desconhecido
- [ ] T042 [US4] `nova_sessao` exige **autor e motivo**, grava instante e equity de partida, e é o **único** caminho fora da inibição
- [ ] T043 [US4] O alcance dos verbos (RN-E22): `start`/`stop`/`pause`/`reset` da **mesa**; `nova_sessao` **por conta** — com o campo da conta **ainda ausente** e a razão registada (FR-020)
- [ ] T044 [P] [US4] `tools/verificar-maquina/vigia.ts --verbos`
- [ ] T045 [US4] `relatorios/us4.txt`

---

## Phase 7: User Story 5 — A fronteira entre o vigia e a mesa é contrato (P2)

**Goal**: a conferência que prova que a fronteira está contratada, e não acordada.

**Independent Test**: `bash tools/verificar-contrato/ponta-a-ponta.sh` — as quatro mensagens passam nas duas linguagens; um comando `1.0.0` é recusado; as duas direcções dos motivos fecham.

- [ ] T046 [US5] Conferência dos motivos nas **duas direcções** com âmbito declarado (SC-003): produzido e ausente do vocabulário é falha; no vocabulário sem quem o produza também
- [ ] T047 [US5] A recusa por **versão diferente** como caso declarado, com as duas versões no detalhe
- [ ] T048 [P] [US5] O conferidor de **campos sem leitor** na mensagem do comando (a outra metade do SC-003): um campo que ninguém lê é falha, não reserva
- [ ] T049 [P] [US5] Os casos novos do contrato entram na contagem de aceites e recusas **somando**
- [ ] T050 [US5] `relatorios/us5.txt`

---

## Phase 8: User Story 6 — O dublê de mesa, para os plugins se construírem sem a mesa real (P2)

**Goal**: quem construir o primeiro setup ou o primeiro conector não precisa da mesa real (RN-E24).

**Independent Test**: `bash tools/verificar-contrato/duble-de-mesa.sh` — os mesmos casos dão o mesmo veredicto no dublê e na mesa real; com o venue mudo, «espera» e depois `desconhecido`.

- [ ] T051 [US6] `contracts/mocks/mesa/main.py` — o dublê: entrega `mercado` e confere `proposta`; entrega `boleta` e confere `desfecho`; lê os **esquemas** e **não** importa `core/`
- [ ] T052 [P] [US6] Os casos do dublê em **dado** (`contracts/mocks/mesa/*.casos.json`) e os modos adversários: recusa, atraso, silêncio, números fora da banda
- [ ] T053 [US6] A prova de fidelidade: os **mesmos** casos contra a mesa real, com divergência = **falha** (SC-004)
- [ ] T054 [P] [US6] `tools/verificar-contrato/duble-de-mesa.sh` — a bancada, ligada à porta do contrato
- [ ] T055 [US6] `relatorios/us6.txt`

---

## Phase 9: User Story 7 — O que já corria não se perde (P3)

**Goal**: garantir que o recorte não reabre o que estava fechado.

**Independent Test**: `bash tools/verificar-maquina/provar.sh` — a contagem do 002 não cai, e a do contrato soma.

- [ ] T056 [US7] Contagem antes/depois da porta única e da bateria do contrato, lado a lado em `relatorios/us7.txt`
- [ ] T057 [P] [US7] A **frescura** do gerado: um gerado atrasado em relação ao esquema tem de ser **recusado** (ensaio negativo, não só o positivo)
- [ ] T058 [US7] Nenhum ficheiro de `~/Projects/jev-trade-fusao` tocado: medido (a árvore do motor antigo, e o `git status` dela)

---

## Phase 10: Polish & Cross-Cutting (T059–T063)

- [ ] T059 `specs/003-vigia-e-mesa/relatorios/RESULTADO.md` — os **8 SC**, cada um com o comando que o mediu e o número que saiu
- [ ] T060 [P] `docs/inventario-de-chaves.md` §8.5 (o que este recorte escreveu) e a actualização da §7 (a chave nova com o seu valor por omissão)
- [ ] T061 [P] `docs/diagrama-de-blocos.html` — o vigia entra no desenho, e o dublê de mesa também
- [ ] T062 A revisão final: nenhum campo sem leitor nas quatro mensagens novas; nenhum número ajustável no código (RN-A1); nenhuma credencial em `/config`, ledger ou log (RN-E14) — os três conferidos por comando
- [ ] T063 O resumo ao dono: o que ficou feito, o que ficou declarado (conformidade por venue, campo da conta, hospedagem do setup) e o que é decisão dele

---

## Dependencies & Execution Order

### Fases

- **Setup (T001–T004)**: sem dependências.
- **Foundational (T005–T018)**: depende do Setup. **Bloqueia todas as histórias.** T002 (a chave) precede T007 (o esquema que a usa); T005–T009 precedem T010 (a versão) e T012 (o gerado).
- **US1 (T019–T026)**: depende do Foundational. É o MVP.
- **US2 (T027–T032)**, **US3 (T033–T039)**: dependem do Foundational e da US1 (o vigia existe).
- **US4 (T040–T045)**: depende de US1.
- **US5 (T046–T050)**: depende do Foundational (o contrato) — e é a conferência dele.
- **US6 (T051–T055)**: depende do Foundational.
- **US7 (T056–T058)**: por último, e depende de tudo.
- **Polish (T059–T063)**: no fim.

### Dentro de cada história

A bancada vem **antes** do código que ela recusa (o portão da constituição): o caso declarado primeiro, a
implementação depois, o relatório com o número.

### Parallel Opportunities

- T002, T003, T004 em paralelo (ficheiros diferentes).
- T005–T009 em paralelo (esquemas diferentes); T010 e T012 em série depois deles.
- T011, T016, T017 em paralelo.
- T024, T031, T038, T044 são bancadas em ficheiros próprios — paralelizáveis entre histórias.
- T048, T049, T052, T054 em paralelo.

---

## Implementation Strategy

### MVP primeiro

1. Setup (T001–T004).
2. Foundational (T005–T018) — **sem isto não há fronteira nem porta**.
3. US1 (T019–T026): o vigia governa a mesa e sabe dizer não com o motivo certo.
4. **PARAR e validar** com `vigia.sh --arranque`.

### Entrega incremental

Cada história acrescenta valor sem quebrar a anterior: US2 prova a orfandade, US3 o encerramento, US4 os verbos
delicados, US5 a conferência da fronteira, US6 o dublê que destrava os plugins, US7 a regressão.

---

## Notas

- **A US1 é o MVP**, mas a US2 é a que **prova** o desenho: sem ela, «o vigia é um processo» seria uma frase.
- **Nenhuma tarefa toca em `~/Projects/jev-trade-fusao`** (RN-T16.1 do recorte 001 na prática: o motor antigo é
  oráculo, não base).
- **Tudo o que aqui se mede corre sem corretora e sem chave** — é a decisão do dono (RN-E24) e é o que faz
  deste recorte um recorte.
- A tarefa que **inventar um número** sem chave falha por definição (RN-A1): a chave inventa-se primeiro (T002).
