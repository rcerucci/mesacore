# Tasks: O primeiro conector real — Hyperliquid, em ambiente de teste

**Input**: `specs/004-conector-hyperliquid/` — `spec.md` (7 histórias, 28 FR, 8 SC), `plan.md` (as cinco
decisões), `research.md` (R1–R9).

**Testes**: incluídos **não por opção** — o portão da constituição diz que o teste que recusa a regra existe
**antes** do código que a cumpre. Aqui, «teste» é a **bancada declarada**: casos em dado, um por regra, e a
contagem no fim. Duas bancadas: a que **não** precisa do venue (corre sempre) e a que corre no **ambiente de
teste** (a bateria de conformidade).

**Formato**: `[ID] [P?] [História] Descrição` — `[P]` = ficheiros diferentes, sem dependência.

**Estado da execução**: **fase 1 por começar**. O contrato está em **1.3.0** e este recorte não cria tipo novo
(R8): o conector fala o que já existe.

---

## Fase 1 — Preparação e linha de base (T001–T005)

- [ ] T001 Medir a linha de base e escrevê-la em `relatorios/linha-de-base.txt`: `provar.sh` (25 de 25), casos do contrato (100), versão do contrato (1.3.0), e os ficheiros do outro projeto tocados (**0** — o motor antigo é oráculo, não se toca)
- [ ] T002 [P] Criar `brokers/hyperliquid/` com `README.md` (o que este conector entrega, e o que não) e `.gitignore` (o manifesto do runtime e a `conformidade/` fora do versionamento)
- [ ] T003 [P] Escrever `data-model.md`: manifesto, boleta, resolução, desfecho, leitura — campo a campo, com a origem de cada número (venue, nossa conversão, ou ausente)
- [ ] T004 [P] Escrever `quickstart.md`: como correr a bateria offline e a do venue, e onde ler o resultado
- [ ] T005 Pedir ao sysadmin as duas dependências (D1) e registar o pedido; **enquanto não houver resposta**, as tarefas que não precisam do SDK seguem (as de tradução, recusas e derivação da referência correm contra o dublê)

## Fase 2 — Fundacional: o conector de pé e o manifesto (T006–T014) — **US1**

- [ ] T006 [US1] `brokers/hyperliquid/casos/manifesto.casos.json`: casos da sonda (instrumento existente, instrumento inexistente, limite que muda, venue indisponível) — com `esperadoOk`/`motivo_esperado`
- [ ] T007 [US1] `brokers/hyperliquid/manifesto.ts`: a sonda (instrumentos, `szDecimals` e passo, alavancagem máxima, tipos de ordem, mínimo, taxas da conta, funding) e a publicação do manifesto — **nenhum** destes valores constante no código (FR-001, FR-002)
- [ ] T008 [US1] Recusa nomeada para instrumento inexistente, dizendo **qual** (FR-003)
- [ ] T009 [US1] O manifesto declara o que o venue **não** oferece e a forma da referência do venue (FR-004, FR-005)
- [ ] T010 [US1] `brokers/hyperliquid/processos.ts`: a porta de processo (arrancado pelo vigia, uma ligação, uma chave) (FR-019)
- [ ] T011 [US1] `tools/verificar-conector/provas-offline.sh`: correr os casos do manifesto contra o dublê e contra o conector (o que não precisa de rede)
- [ ] T012 [US1] Bancada `tools/verificar-maquina/provar.sh` ganha a linha do conector; medir e escrever em `relatorios/us1.txt`
- [ ] T013 [US1] O manifesto do runtime entra no `.gitignore` (a **forma** versiona-se, o conteúdo não — D2)
- [ ] T014 [US1] Commit da US1 e resumo ao dono

## Fase 3 — A tradução e as recusas (T015–T022) — **US2**

- [ ] T015 [US2] Casos da tradução: fora do passo, abaixo do mínimo, preço com casas a mais, alavancagem fora do intervalo, post-only que cruza, reduce-only
- [ ] T016 [US2] `brokers/hyperliquid/traducao.ts`: percentagem do saldo/alavancagem/percentagens → quantidade e preço na unidade do instrumento (FR-006)
- [ ] T017 [US2] **Nenhum arredondamento silencioso**: cada caso fora de regra é recusa **com motivo**, e nenhuma ordem é enviada (FR-007) — a diferença declarada face ao motor antigo
- [ ] T018 [US2] Alavancagem: só inteiro dentro do intervalo aceite; fora disso, recusa com o máximo nomeado (FR-008)
- [ ] T019 [US2] Post-only: nunca corrigir preço para caber; se cruzar, é recusa (FR-009)
- [ ] T020 [US2] Reduce-only: pedido, e a capacidade declarada no manifesto (FR-010)
- [ ] T021 [US2] Casos + bancada medidos; `relatorios/us2.txt`
- [ ] T022 [US2] Commit da US2 e resumo ao dono

## Fase 4 — A resolução e o desfecho (T023–T030) — **US3**

- [ ] T023 [US3] Casos da resolução e do desfecho (aceite, parcial, recusado com a palavra do venue, e a ordem que produz cada um)
- [ ] T024 [US3] Resolução **antes** do envio, com quantidade, nocional, margem, alavancagem e preço de liquidação (FR-006, FR-012)
- [ ] T025 [US3] `brokers/hyperliquid/desfecho.ts`: normalização nas quatro classificações, com os números do venue (FR-012)
- [ ] T026 [US3] Recusa com o motivo **do venue**, nunca interpretado (FR-012)
- [ ] T027 [US3] Nada se deduz por contagem própria: o que não está no venue é `desconhecido` (FR-015)
- [ ] T028 [US3] Conferência contra o contrato (o envelope e o esquema de cada mensagem) — portão automático
- [ ] T029 [US3] Medições em `relatorios/us3.txt`
- [ ] T030 [US3] Commit da US3 e resumo ao dono

## Fase 5 — Silêncio é estado (T031–T038) — **US4**

- [ ] T031 [US4] Casos do silêncio: espera dentro do prazo, desconhecido depois, reconciliação que encontra posição, pedido novo recusado, fecho permitido
- [ ] T032 [US4] `espera` dentro do prazo declarado e `desconhecido` depois — nunca sucesso (FR-013)
- [ ] T033 [US4] Reconciliar antes de agir: posição, ordens abertas e execuções desde o instante (FR-014)
- [ ] T034 [US4] Com `desconhecido` pendente, **abertura** recusada e **fecho** permitido (FR-014)
- [ ] T035 [US4] O estado da ligação pelo protocolo do venue; silêncio = `desconhecido` (FR-020)
- [ ] T036 [US4] Sem leitura da conta, nenhuma ordem que aumente exposição (FR-021)
- [ ] T037 [US4] Medições em `relatorios/us4.txt`
- [ ] T038 [US4] Commit da US4 e resumo ao dono

## Fase 6 — A mesma referência não duplica ordem (T039–T043) — **US5**

- [ ] T039 [US5] Casos da idempotência (mesma referência duas vezes; referência com forma inválida para o venue)
- [ ] T040 [US5] Derivação da referência para a forma do venue, **pura e declarada** (sem instante dentro) (FR-011)
- [ ] T041 [US5] Duas boletas com a mesma referência → **uma** ordem, mesmo desfecho nas duas respostas (FR-011)
- [ ] T042 [US5] Medição com contagem no venue (SC-003) em `relatorios/us5.txt`
- [ ] T043 [US5] Commit da US5 e resumo ao dono

## Fase 7 — As leituras e os cinco números (T044–T049) — **US6**

- [ ] T044 [US6] Casos das leituras (posição viva, sem posição, leitura falhada)
- [ ] T045 [US6] `brokers/hyperliquid/leituras.ts`: posição, equity, marcas e os **cinco números** do resumo do encerramento, com a origem nomeada (FR-016)
- [ ] T046 [US6] Sem posição, a distância de liquidação é **ausente** (nunca zero); leitura falhada é dita como falha (FR-017)
- [ ] T047 [US6] Histórico do venue (execuções, taxas, funding, resultado realizado) sem reconstrução (FR-018)
- [ ] T048 [US6] Medição dos cinco números contra o venue, no mesmo instante (SC-007) em `relatorios/us6.txt`
- [ ] T049 [US6] Commit da US6 e resumo ao dono

## Fase 8 — A bateria de conformidade (T050–T058) — **US7**

- [ ] T050 [US7] `tools/verificar-conector/conformidade.sh` com as **oito provas**, cada uma dizendo o que mediu
- [ ] T051 [US7] Prova 1: manifesto sondado (o instrumento inventado recusa) e Prova 2: passo e mínimo (recusa, nunca arredonda)
- [ ] T052 [US7] Prova 3: degrau de alavancagem (recusa e nomeia o máximo) e Prova 4: post-only não cruza
- [ ] T053 [US7] Prova 5: reduce-only não aumenta posição e Prova 6: idempotência (uma ordem)
- [ ] T054 [US7] Prova 7: desconhecido e reconciliação e Prova 8: histórico bate com o venue
- [ ] T055 [US7] Registo por **versão e data** em `brokers/hyperliquid/conformidade/<versao>.txt`; prova que não corre deixa o resultado **incompleto** (FR-025, FR-026)
- [ ] T056 [US7] Onde a documentação oficial não for conclusiva, medir e **escrever no manifesto** (FR-027) — os três casos de R9
- [ ] T057 [US7] Correr a bateria no ambiente de teste e medir (SC-004); `relatorios/us7.txt`
- [ ] T058 [US7] Commit da US7 e resumo ao dono

## Fase 9 — Fecho do recorte (T059–T065)

- [ ] T059 [US8] Alavancagem e leituras de borda: os casos de `liquidationPx` nulo, pedido de outra conta, credencial ausente (FR-022, FR-023)
- [ ] T060 [US9] Histórico e taxas: casos do histórico sem reconstrução (FR-018) — se não couber na US6, é história própria
- [ ] T061 Prova de que o conector **não importa o `core`** (RN-E1), por comando, e de que não contém regra de decisão (FR-024)
- [ ] T062 Varredura de credenciais (RN-E14) em `brokers/`, `docs/` e `config/`: **zero** valores
- [ ] T063 `relatorios/RESULTADO.md`: os 8 SC, cada um com o comando que o mediu e o número que saiu
- [ ] T064 Actualizar `docs/inventario-de-chaves.md` (§ do conector: as chaves que ele passou a ler, cada uma com o leitor nomeado) e `docs/diagrama-de-blocos.html` (o conector real ao lado do dublê)
- [ ] T065 Resumo ao dono: o que ficou provado, o que ficou por provar, e a decisão de passagem a produção (que é dele)
