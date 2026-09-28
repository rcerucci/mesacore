---
description: "Lista de tarefas do contrato neutro"
---

# Tasks: O contrato neutro — mesa, setup e conector

**Input**: documentos de desenho em `specs/001-contrato-neutro/`

**Prerequisites**: [plan.md](./plan.md) · [spec.md](./spec.md) · [research.md](./research.md) ·
[data-model.md](./data-model.md) · [contracts/interface.md](./contracts/interface.md) ·
[quickstart.md](./quickstart.md) · [.specify/memory/constitution.md](../../.specify/memory/constitution.md)

**Testes**: **incluídos, e não por opção** — a constituição (secção "Fluxo de trabalho e portões de
qualidade") manda que *o teste que recusa a regra existe antes do código que a cumpre*, e a bateria de
casos **é** o produto deste recorte. Cada história começa pelos casos que a têm de recusar.

**Organização**: uma fase por história de utilizador, na ordem de prioridade da spec, para que cada uma
seja implementável e testável sozinha.

## Formato: `[ID] [P?] [Story] Descrição`

- **[P]**: pode correr em paralelo (ficheiros diferentes, sem dependência de tarefa aberta)
- **[Story]**: a história da spec (`US1`…`US6`); as fases de preparação e a final não levam etiqueta
- Todo caminho de ficheiro é relativo à raiz do repositório

## Regras de forma que valem para **toda** tarefa de schema

Copiadas verbatim do `data-model.md` — não ficam à discrição de quem implementa:

- **decimal textual**: padrão `-?(0|[1-9][0-9]*)(\.[0-9]+)?` — sem expoente, sem `+`, sem `1.`
- **`null` não existe**: ausência é a **chave que não está lá**
- **contrato fechado**: `"additionalProperties": false` em **todo** objecto, `required` explícito
- **versão**: texto, conferida por **igualdade exacta**, antes de qualquer envio
- **unidades neutras**: nada em quantidade, lote, ponto, tick ou preço absoluto fora da resolução e do
  desfecho

---

## Phase 1: Setup (infraestrutura partilhada)

**Purpose**: a árvore de `/contracts` existir, com as duas linguagens a conseguir correr e a
não-depedência do `core` verificada desde o primeiro commit.

- [ ] T001 Criar a árvore de `/contracts`: `contrato/` `casos/` `gerado/ts/` `gerado/py/` `mocks/setup/` `mocks/conector/` `_defs/`, com `.gitkeep` onde ainda não houver ficheiro
- [ ] T002 Criar `contracts/package.json` (name `@mesacore/contracts`, `"type": "module"`, scripts `validar`, `gerar`, `casos`) e `contracts/tsconfig.json` (target ES2022, `strict: true`, `noUncheckedIndexedAccess: true`)
- [ ] T003 [P] Criar `contracts/pyproject.toml` (nome `mesacore-contracts`, `requires-python = ">=3.11"`, dependências `jsonschema`, e `datamodel-code-generator` no grupo de desenvolvimento) para instalação com `uv`
- [ ] T004 [P] Escrever `contracts/casos/README.md`: o formato do caso (`{nome, mensagem, entrada, veredicto_esperado, motivo_esperado}`), o que é um caso **inválido de propósito**, e a regra de que um caso escrito uma vez corre nas duas linguagens
- [ ] T005 Escrever `contracts/_defs/forma.schema.json` com as definições partilhadas: `decimal` (o padrão acima), `instante_ms` (inteiro), `motivo` (referência ao vocabulário) — todos os outros schemas usam `$ref` para aqui
- [ ] T006 Escrever `tools/verificar-contrato/porteiro-dependencias.sh`: falha se algum ficheiro dentro de `contracts/` (fora de `mocks/`) importar de `core/`, `setups/` ou `brokers/` (Princípio VII; RN-E1)

---

## Phase 2: Foundational (pré-requisitos que bloqueiam tudo)

**Purpose**: o envelope, o vocabulário e o arnês de casos. **Nenhuma história começa antes desta fase
fechar.**

**⚠️ CRITICAL**: sem envelope e sem arnês não há como escrever um caso.

- [ ] T007 Escrever `contracts/envelope.schema.json`: `contrato` (texto), `tipo` (enum: `mercado` `proposta` `boleta` `resolucao` `desfecho` `manifesto` `historico`), `id` (texto, correlação do ciclo), `carga` (objecto, `oneOf` por `tipo`) — fechado, sem `null`
- [ ] T008 [P] Escrever `contracts/vocabulario.json` com os enums e os **motivos normalizados** de recusa (`versao_do_contrato_divergente`, `campo_em_unidade_de_corretora`, `campo_desconhecido`, `campo_obrigatorio_ausente`, `tipo_invalido`, `valor_fora_da_banda`, `minimo_do_instrumento_acima_da_banda`, `instrumento_desconhecido_no_manifesto`, `parcial_nao_declarada`) — conjunto fechado, partilhado pelas duas linguagens
- [ ] T009 [P] Implementar o leitor/escritor de enquadramento em TypeScript em `contracts/esqueleto/framing.ts`: uma mensagem por linha (UTF-8, sem quebras internas), com **validação do envelope antes do corpo** e recusa com motivo normalizado
- [ ] T010 [P] Implementar o mesmo enquadramento em Python em `contracts/esqueleto/framing.py`, com o **mesmo** comportamento e os mesmos motivos (é o par que SC-002 vai comparar)
- [ ] T011 Escrever `contracts/esqueleto/casos.ts`: carrega `casos/*.casos.json`, valida a `entrada` contra o schema da `mensagem` e escreve uma linha JSON por caso (`{caso, mensagem, veredicto, motivo, implementacao}`)
- [ ] T012 [P] Escrever `contracts/esqueleto/casos.py` com o mesmo contrato de linha de comando e o mesmo formato de relatório que T011
- [ ] T013 Escrever `contracts/casos/_arnes.casos.json`: os casos do **próprio envelope** — versão divergente, campo desconhecido, `null` onde não é permitido, número de vírgula flutuante onde se espera decimal textual, mensagem fora de linha
- [ ] T014 Rodar `(cd contracts && bun run validar)` e `(cd contracts && uv run python -m esqueleto.casos)` contra `contracts/casos/_arnes.casos.json` e confirmar que **ambos** recusam os cinco casos com o mesmo motivo

**Checkpoint**: envelope, vocabulário e arnês prontos — as histórias começam.

---

## Phase 3: User Story 1 - O setup fala, e a mesa entende (Priority: P1) 🎯 MVP

**Goal**: o objecto de factos e a proposta atravessam a fronteira; ausência é declarada; inválido é
registado como `hold`, nunca como ordem.

**Independent Test**: correr a bateria de `mercado` e `proposta` contra o mock de setup (T021) e
verificar que as ausências chegam declaradas e que `limpar`/vazio/número produzem `hold` + invalidade
registada.

### Testes de US1 (escrever primeiro, e **falharem** antes de implementar)

- [ ] T015 [P] [US1] Escrever `contracts/casos/mercado.casos.json`: um caso completo, um com `livro` ausente, um com `funding` ausente, um com `posicao` ausente, um com `estado: "fechado"`, e **três inválidos** (campo desconhecido, `null` no lugar de ausência, `bid` como número em vez de decimal textual)
- [ ] T016 [P] [US1] Escrever `contracts/casos/proposta.casos.json`: os quatro valores válidos, a `relogio` presente e ausente, e **três inválidos** (`limpar`, `lado` ausente, `lado` a número)

### Implementação de US1

- [ ] T017 [P] [US1] Escrever `contracts/mercado.schema.json` conforme a secção 2 do `data-model.md` (`idade_do_dado_ms` obrigatório; `bid`/`ask`/`ultimo`/`livro`/`posicao`/`funding` declaráveis ausentes; `equity` obrigatório; `estado` enum `aberto`/`fechado`) — fechado, sem `null`
- [ ] T018 [P] [US1] Escrever `contracts/proposta.schema.json`: `setup {nome, versao}` obrigatório, `lado` enum dos quatro, `relogio {proxima_consulta_ms}` opcional — fechado; a **invalidade não é valor do contrato**
- [ ] T019 [US1] Correr a geração (`contracts/gerado/ts/`, `contracts/gerado/py/`) sobre T017 e T018 e versionar o resultado
- [ ] T020 [US1] Implementar o mock de setup em `contracts/mocks/setup/main.ts`: responde as quatro propostas, **sabe ser inválido de propósito** (modo `--invalido limpar|vazio|numero`), e recusa responder fora do prazo declarado
- [ ] T021 [US1] Correr `contracts/esqueleto/casos.ts --mensagem mercado,proposta --mock contracts/mocks/setup/main.ts` e guardar a saída em `specs/001-contrato-neutro/relatorios/us1.jsonl`

**Checkpoint**: US1 testável sozinha, com relatório em ficheiro.

---

## Phase 4: User Story 2 - A boleta atravessa sem perder o sentido (Priority: P1)

**Goal**: a boleta em unidades neutras, conferida contra o manifesto, com recusa em vez de arredondar.

**Independent Test**: a inspecção (T025) devolve **zero** campos proibidos na boleta, e a boleta com
quantidade/lote/preço absoluto é **recusada com motivo**, sem nada enviado.

### Testes de US2

- [ ] T022 [P] [US2] Escrever `contracts/casos/boleta.casos.json`: uma boleta válida mínima, uma com `stop_pct`/`tp_pct` ausentes (setup sem stop), uma com `parcial: "tudo_ou_nada"`, e **cinco inválidos** (`quantidade`, `lote`, `preco_absoluto`, `parcial` ausente, `sl_saldo_pct` fora do enum de `destino_do_resto`)
- [ ] T023 [P] [US2] Escrever `contracts/casos/manifesto.casos.json`: manifesto completo, manifesto com `marca_de_posse: "nenhuma"`, e **três inválidos** (instrumento ausente das unidades, `idempotencia` não booleano, campo desconhecido)

### Implementação de US2

- [ ] T024 [US2] Escrever `contracts/boleta.schema.json` conforme a secção 4 do `data-model.md`: os 14 campos, `parcial` **obrigatório**, `stop_pct`/`tp_pct` ausentes permitidos, `marca_de_posse` inteiro entre 0 e 2147483647 — fechado
- [ ] T025 [US2] Escrever `tools/verificar-contrato/ts/inspecionar.ts`: percorre `boleta.schema.json` e falha com o nome de cada campo proibido encontrado (`quantidade`, `lote`, `preco_absoluto`, `pontos`, `tick`, `contrato`) — é o SC-001
- [ ] T026 [US2] Escrever `contracts/manifesto.schema.json` com todos os campos de RN-C1 (secção 7 do `data-model.md`), incluindo `marca_de_posse` como enum de forma e `versao`
- [ ] T027 [US2] Implementar a tradução da boleta no mock de conector em Python (`contracts/mocks/conector/traducao.py`): percentagem do saldo × alavancagem → quantidade na unidade do instrumento, **sem arredondar em silêncio**, e **recusa** com `minimo_do_instrumento_acima_da_banda` quando não cabe
- [ ] T028 [US2] Implementar a conferência contra o manifesto antes do envio em `contracts/esqueleto/conferir.ts`: sem capacidade declarada para o que a boleta pede, **recusa** (`campo_desconhecido`/`valor_fora_da_banda` conforme o caso) — nunca adapta
- [ ] T029 [US2] Correr a bateria de `boleta` e `manifesto` contra o mock de conector e guardar em `specs/001-contrato-neutro/relatorios/us2.jsonl`

**Checkpoint**: US1 e US2 testáveis, cada uma com o seu relatório.

---

## Phase 5: User Story 3 - O conector declara antes de executar, e o desfecho é classificado (Priority: P1)

**Goal**: resolução antes da execução, conferida contra a banda; desfecho normalizado nos quatro
valores, com `desconhecido` a não virar sucesso nem falha.

**Independent Test**: com uma resolução fora da banda, **zero ordens** são enviadas e há registo de
inconformidade; com silêncio do venue, o desfecho é `desconhecido` e o instrumento fica marcado.

### Testes de US3

- [ ] T030 [P] [US3] Escrever `contracts/casos/resolucao.casos.json`: resolução dentro da banda, uma fora (nocional acima do teto), uma em que o mínimo do instrumento exige mais do que a banda, e **dois inválidos** (valor em vírgula flutuante, `preco_de_liquidacao` ausente)
- [ ] T031 [P] [US3] Escrever `contracts/casos/desfecho.casos.json`: os quatro valores, `recusado` **sem** `motivo` (inválido), `recusado` com motivo, e um `desconhecido` que **não pode** trazer `classificacao: "aceite"` no mesmo objecto

### Implementação de US3

- [ ] T032 [P] [US3] Escrever `contracts/resolucao.schema.json` (quantidade, nocional, margem_empenhada, alavancagem_efectiva, preco_de_liquidacao — todos decimais textuais)
- [ ] T033 [P] [US3] Escrever `contracts/desfecho.schema.json`: `classificacao` enum dos quatro, `motivo` **obrigatório quando `recusado`** (via `if/then`), `resolucao` obrigatória, `resposta_do_venue` obrigatória
- [ ] T034 [US3] Implementar a conferência da resolução contra a banda em `contracts/esqueleto/conferir.ts` (depende de T028): fora da banda → registra inconformidade e **não envia**; contagem de enviadas = 0
- [ ] T035 [US3] Implementar o silêncio do venue no mock de conector (`contracts/mocks/conector/silencio.py`): sem confirmação no prazo → desfecho `desconhecido`, instrumento marcado, nenhuma ordem nova
- [ ] T036 [US3] Implementar a não-duplicação em `contracts/esqueleto/referencia.ts`: reenvio com a mesma `referencia_do_cliente` não cria segunda ordem; sem idempotência declarada no manifesto, **reconciliar antes de reenviar**
- [ ] T037 [US3] Correr a bateria de `resolucao` e `desfecho` e guardar em `specs/001-contrato-neutro/relatorios/us3.jsonl`

**Checkpoint**: o MVP do contrato fechado — proposta, boleta, resolução, desfecho.

---

## Phase 6: User Story 4 - O mesmo contrato, noutra linguagem (Priority: P2)

**Goal**: as duas implementações passam a bateria com veredictos idênticos, sem excepções ao contrato.

**Independent Test**: `comparar.sh` devolve `0 divergências` e saída 0 sobre os três relatórios.

- [ ] T038 [US4] Implementar o runner Python completo em `contracts/mocks/conector/rodar_casos.py`, lendo **os mesmos** `contracts/casos/*.casos.json` e escrevendo o mesmo formato de linha
- [ ] T039 [US4] Escrever `tools/verificar-contrato/comparar.sh`: compara dois relatórios linha a linha por `caso`, e falha com o nome do primeiro caso divergente (SC-002)
- [ ] T040 [US4] Correr a bateria completa nas duas linguagens e `comparar.sh` sobre `relatorios/us1..us3` em par TS/Python, guardando `relatorios/divergencias.txt`
- [ ] T041 [US4] Confirmar, ficheiro a ficheiro em `contracts/casos/*.casos.json`, que **nenhum** caso precisou de excepção ao contrato para passar nas duas linguagens: se precisou, o defeito é do contrato e a correcção é no `contracts/*.schema.json`, não no caso

**Checkpoint**: a neutralidade deixou de ser afirmação e passou a ser medição.

---

## Phase 7: User Story 5 - A posse reconhece-se pela marca (Priority: P2)

**Goal**: a marca viaja na forma que o venue aceita e, depois de reiniciar, a mesa reencontra o que é
seu — e trata o resto como alheio.

**Independent Test**: `marcar → reiniciar → reencontrar` passa, e a posição sem marca é relatada como
alheia, sem ordem de fecho por iniciativa da mesa.

- [ ] T042 [P] [US5] Escrever `contracts/casos/marca.casos.json`: marca válida, marca no limite (0 e 2147483647), e **três inválidos** (negativa, acima de 31 bits, hexadecimal da HL na boleta)
- [ ] T043 [US5] Escrever `contracts/marca.schema.json` com o inteiro de 31 bits e a forma declarada pelo manifesto
- [ ] T044 [US5] Implementar a geração determinística da marca em `contracts/esqueleto/marca.ts` (identificador da ficha + contador de ciclo) e o teste de determinismo: a mesma entrada produz a mesma marca, e a marca é única por (ficha, ciclo)
- [ ] T045 [US5] Implementar `marcar → reiniciar → reencontrar` em `contracts/mocks/conector/marca.py` (marca a ordem) e `contracts/mocks/conector/posicoes.py` (leitura que reconhece pela marca, **pelos registos do venue**)
- [ ] T046 [US5] Implementar a posição **alheia** no mock: posição sem a marca da mesa é relatada como vista e **não gerida**, e o caso é coberto em `contracts/casos/marca.casos.json`
- [ ] T047 [US5] Correr a bateria de US5 e guardar em `specs/001-contrato-neutro/relatorios/us5.jsonl`

**Checkpoint**: reinício coberto, sem base de dados própria de posições.

---

## Phase 8: User Story 6 - O trilho do dinheiro aparece sem ser recalculado (Priority: P3)

**Goal**: o histórico normalizado chega com taxas e funding **separados**, e ninguém o recalcula.

- [ ] T048 [P] [US6] Escrever `contracts/casos/historico.casos.json`: execuções, taxas, funding separado, e **dois inválidos** (funding somado ao resultado, campo de resultado recalculado pela mesa)
- [ ] T049 [US6] Escrever `contracts/historico.schema.json` — vista normalizada de execuções, taxas, funding e resultado realizado, com **funding em campo próprio**
- [ ] T050 [US6] Implementar a leitura do histórico no mock de conector (`contracts/mocks/conector/historico.py`) e confirmar que **nenhum** caminho de código soma ou recalcula o resultado
- [ ] T051 [US6] Correr a bateria de US6 e guardar em `specs/001-contrato-neutro/relatorios/us6.jsonl`

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T052 [P] Escrever o **teste de frescura**: regenerar `contracts/gerado/ts` e `contracts/gerado/py` a partir dos schemas e falhar se houver diff (D8) — em `tools/verificar-contrato/frescura.sh`
- [ ] T053 [P] Correr `tools/verificar-contrato/porteiro-dependencias.sh` (T006) e registar a saída
- [ ] T054 [P] Conferir `docs/inventario-de-chaves.md` contra os schemas: toda grandeza declarada no schema tem chave no inventário, e toda chave do inventário é lida por alguém (RN-A2) — corrigir o documento, não o schema, quando a divergência for de escrita
- [ ] T055 [P] Actualizar `contracts/README.md` com os ficheiros que passaram a existir e a ordem de geração
- [ ] T056 Escrever `specs/001-contrato-neutro/relatorios/RESULTADO.md`: os dez critérios de sucesso, cada um com o comando que o mediu e a saída — **nada afirmado sem número**
- [ ] T057 Correr `specs/001-contrato-neutro/quickstart.md` de ponta a ponta e substituir, em cada secção, a promessa pela saída real
- [ ] T058 Actualizar o `README.md` da raiz: `/contracts` deixa de ser uma declaração e passa a ter conteúdo, com o caminho do resultado
- [ ] T059 Revisão final contra `.specify/memory/constitution.md`: os oito princípios, um a um, com o ficheiro onde cada um se prova

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)**: sem dependências — começa já
- **Foundational (2)**: depende do Setup — **bloqueia todas as histórias**
- **US1 (3) · US2 (4) · US3 (5)**: dependem da fase 2. US1 é independente; US2 depende de T005 (forma) e do envelope; US3 depende de T028 (conferência) e do manifesto (T026)
- **US4 (6)**: depende de US1, US2 e US3 **terem casos escritos** (o runner Python corre-os todos)
- **US5 (7)**: depende de T009/T010 (enquadramento) e de T024 (boleta, porque a marca é campo dela)
- **US6 (8)**: depende apenas da fase 2 — pode correr em paralelo com US4 e US5
- **Polish (9)**: depende das histórias que se queira entregar

### Dentro de cada história

Casos **primeiro** (e a falharem), depois schema, depois geração, depois implementação, depois
relatório. A ordem não é cerimónia: é o portão da constituição.

### Parallel Opportunities

- Fase 1: T003, T004 em paralelo
- Fase 2: T008, T009 e T010 em paralelo (ficheiros diferentes); T011 e T012 em paralelo
- US1: T015, T016 (casos) em paralelo; T017, T018 (schemas) em paralelo
- US2: T022, T023 em paralelo; T024, T025, T026 em paralelo depois
- US3: T030, T031 em paralelo; T032, T033 em paralelo
- US5/US6 podem correr **junto** com US4 (ficheiros distintos)
- Polish: T052 a T055 em paralelo

### Parallel Example: User Story 2

```bash
# os casos, primeiro, em paralelo:
Task: "Escrever contracts/casos/boleta.casos.json (T022)"
Task: "Escrever contracts/casos/manifesto.casos.json (T023)"
# depois, em paralelo, os três independentes:
Task: "Escrever contracts/boleta.schema.json (T024)"
Task: "Escrever tools/verificar-contrato/ts/inspecionar.ts (T025)"
Task: "Escrever contracts/manifesto.schema.json (T026)"
```

---

## Implementation Strategy

### MVP primeiro

1. Fase 1 e Fase 2 (o arnês)
2. **US1** sozinha → parar e validar com o relatório em ficheiro
3. Depois US2 e US3, que fecham o contrato de uma ordem inteira

O MVP **não** é "uma mensagem": é o caminho `mercado → proposta → boleta → resolução → desfecho`
(US1+US2+US3), porque uma mensagem sozinha não prova nada que atravesse uma fronteira.

### Entrega incremental

Cada história fecha com o seu relatório em `specs/001-contrato-neutro/relatorios/`. Um relatório que não
existe é uma história que não está feita, independentemente do que o código pareça fazer.

---

## Notes

- Os casos são **dado**: escrevem-se em JSON e correm nas duas linguagens (D9)
- Um caso inválido tem de **recusar com motivo**, e a recusa tem de ser a **mesma** nas duas linguagens
- Nunca se altera o gerado à mão: se um caso falha, muda-se o schema — ou o caso, se estiver errado
- O mock que só sabe ser válido prova metade do contrato
- Credencial, token ou segredo em qualquer ficheiro deste recorte **reprova a revisão** (RN-E14)
- Commit por tarefa ou por grupo lógico, com a mensagem a dizer o que ficou **medido**
