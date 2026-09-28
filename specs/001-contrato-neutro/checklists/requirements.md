# Specification Quality Checklist: O contrato neutro — mesa, setup e conector

**Purpose**: Validar a completude e a qualidade da especificação antes de passar ao plano
**Created**: 2026-09-27
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

**Iteração 1 (27 set 2026) — reprovou, e por um motivo que interessa registar.**

A primeira passagem tinha **28 requisitos funcionais e 5 histórias**, e a validação apanhou exactamente
o defeito que este projeto trata como lei: **a FR-028 (o histórico vem da corretora) não tinha cenário
nenhum que a recusasse.** Era um requisito que ninguém podia falhar — e um requisito que ninguém pode
falhar não é requisito, é decoração. Corrigido com a **User Story 6** (P3): o trilho do dinheiro aparece
normalizado, com taxas e funding separados, e nenhum caminho do contrato prevê a mesa recalcular.

A mesma passagem achou **cinco requisitos sem caso que os pudesse recusar** — FR-005 (contrato fechado),
FR-006 (sem segredos), FR-012 (só factos no objecto), FR-018 (`reduce-only` como intenção) e FR-024
(divergência de manifesto). Cada um ganhou a sua linha nos **Edge Cases**, escrita como recusa e não
como descrição.

**Iteração 2 — passou.** 28 requisitos, 6 histórias, 22 cenários de aceite, 13 casos de fronteira, 10
critérios de sucesso. Zero marcadores `[NEEDS CLARIFICATION]`: as decisões de escopo que faltavam foram
tomadas por omissão informada e estão declaradas nas **Assumptions** (a notação do schema é do plano; o
envelope do registo é deste recorte; o contrato v1 não tem compatibilidade a preservar).

**Ressalvas honestas sobre três itens marcados como cumpridos:**

1. **"No implementation details"** — não há linguagem, framework, API nem protocolo nos requisitos. As
   **Assumptions** nomeiam TypeScript e Python porque a constituição fixa essas linguagens para o core, a
   web e o `/tools`, e a neutralidade do contrato só é afirmável contra esse facto. A notação do schema
   fica deliberadamente para o plano: aqui diz-se *o que* o contrato tem de expressar.
2. **"Written for non-technical stakeholders"** — vale com a ressalva de que o vocabulário do domínio
   (*boleta*, *resolução*, *desfecho*, *ficha*) é o do próprio dono, que o criou nesta conversa. Não há
   código, mas há jargão, e o jargão é o do cliente.
3. **"Feature meets measurable outcomes"** — os critérios são verificáveis por casos, **mas nenhum foi
   ainda corrido**: este recorte é a especificação, não a implementação. SC-001 a SC-010 são o alvo que o
   plano tem de tornar executável, e é a implementação que os mede. Marcar este item como cumprido agora
   significa "o alvo está declarado", não "o alvo foi atingido".
