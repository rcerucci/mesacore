# Specification Quality Checklist: A máquina de estados da mesa

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-28
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

### Iteração 1 — **reprovou**, e o que ela apanhou

Três defeitos, os três do mesmo tipo ("regra sem cenário que a recuse"), e nenhum visível na leitura
corrida:

1. **FR-026** (recusa de fechar é alarme grave) **não tinha cenário nenhum**: era uma regra escrita no
   documento e nunca exercida. Corrigido com um cenário em US2 (o instrumento volta a `aberta`, o caso
   é alarmado como grave e a nova tentativa fica declarada).
2. **FR-042** (a lista de eventos que avisam é do dono) só aparecia em texto; nenhum cenário exigia o
   **aviso** a sair. Corrigido em US5: o disparo do CB registra **e avisa**.
3. **FR-044** (nenhum valor ajustável no código) **não tinha critério de sucesso** — era uma promessa
   do recorte anterior repetida aqui. Corrigido com **SC-012**, medido pela conferência do inventário
   nas duas direções.

É o mesmo padrão da checklist do recorte 001 (onde caiu a FR-028): **regra sem cenário é regra que não
corre**. Uma revisão que só lê o documento não apanha isto — a checklist apanha, porque obriga a
percorrer requisito a requisito à procura de quem o recusa.

### Iteração 2 — passa

Depois das três correcções, todos os itens fecham. O que segue é a **cobertura**, requisito a requisito,
para não ficar nenhum órfão:

| Requisitos | Onde tem cenário |
|---|---|
| FR-001 · FR-004 · FR-005 | US1 (transições legais, recusa com motivo, `reset` não apaga) |
| FR-002 · FR-003 · FR-006 | US2 (as cinco condições, `sem_margem` não é estado) |
| FR-007 | US2 e US3 (motivo registrado de cada decisão de **não** fazer) |
| FR-008 · FR-011 · FR-012 · FR-013 | US1 (os verbos e o encadeamento do `stop`) |
| FR-009 · FR-010 · FR-040 | US6 (operação, pausa que não suspende a defesa, CB em pausa) |
| FR-014 | US7 (pedido ignorado não paralisa) |
| FR-015 a FR-021 | US2 (uma condição por cenário, mais o dado velho) |
| FR-022 | US3 e US6 (a posse lida do venue; ordem viva adoptada) |
| FR-023 · FR-024 · FR-025 · FR-026 | US2 (o ciclo da posição, incluindo a recusa de fechar) |
| FR-027 a FR-030 | US3 (o desconhecido, o bloqueio e as duas saídas) |
| FR-031 · FR-032 · FR-033 | US4 (as seis portas, uma a uma, e a recusa de corrigir) |
| FR-034 · FR-035 · FR-036 · FR-037 · FR-038 · FR-039 | US5 (sessão, CB, inibição, `nova_sessao`) |
| FR-041 · FR-043 | US1 (registo da transição) e US3 (marca que sobrevive) — e SC-010/SC-011 os medem |
| FR-042 | US5 (o aviso do CB) e US2/US3 (congelamento e desconhecido alarmados) |
| FR-044 | US4 (porta do inventário) e **SC-012** |

### Decisões tomadas sem perguntar (e porquê)

O limite de `[NEEDS CLARIFICATION]` é 3, e nenhum foi usado: as ambiguidades que apareceram tinham
resposta boa no documento de regras ou custam menos a decidir do que a perguntar — e todas ficaram
escritas no spec para poderem ser contestadas:

1. **`stop` repetido durante `encerrando`** → registrado como repetição, sem reabrir a pergunta
   (edge case).
2. **`nova_sessao` com posição viva** → recusa; sessão nova não serve para limpar posição (edge case).
3. **`pause` com a mesa parada** → recusa com motivo (US1, cenário 3) — o inverso também se podia
   defender, mas uma transição que não muda nada é ruído, e o documento de estados diz que evento que
   não muda nada é ruído.
4. **`parada` com posição viva** → nada defende a posição, e o resumo tem de o dizer **antes** da
   escolha (edge case). É a decisão mais desconfortável deste spec, e é por isso que está escrita.

### O que fica por decidir para o plano

- Se a máquina é implementada como transição declarada em **dado** (tabela de estados) ou em código com
  os estados nomeados — o spec não decide, e o plano tem de decidir com o argumento de RN-A1 à frente.
- Onde vivem as marcas persistidas (ficheiro do registo, ou o próprio ledger) — depende do recorte do
  ledger, que ainda não tem spec.
