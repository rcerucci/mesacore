# Specification Quality Checklist: O segundo conector — cTrader, em conta de demonstração

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 01 out 2026
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

- **«No implementation details»**: lido no registo da casa, o mesmo que o recorte 004. Esta spec **não** escolhe
  linguagem, biblioteca nem estrutura de código — isso é do `plan.md`. O que ela nomeia são **factos de negócio
  do venue** (o id da conta, a marca de posse, a posição, os dois modos de «fechar sim, abrir não»): para um
  conector, o vocabulário do venue **é** a linguagem do negócio. As duas decisões técnicas que aparecem na
  secção «não é» (a biblioteca como camada de protocolo e a sua fixação de versão) são **fronteiras de escopo
  verificáveis**, e a escolha técnica leva-as a sério no plano — ficam lá as duas, com a razão.
- **«Success criteria technology-agnostic»**: as seis são contagens e presenças verificáveis contra um venue a
  sério (zero envios, três fechos, uma posição, contrato sem alterações). Nenhuma depende de linguagem,
  biblioteca ou ferramenta.
- **Rastreabilidade**: cada FR aponta para uma regra `RN-CT*` de `docs/regra-de-negocio-ctrader.md` e para uma
  linha de `docs/maquina-de-estados-conector-ctrader.md`; cada SC aponta para uma prova da bateria. A conferência
  fina (FR ↔ regra ↔ prova) é matéria do `plan.md` — e é onde os buracos aparecem se houver algum.
- **As perguntas abertas do venue** (as 7 da regra de negócio) não ficam nesta spec como lacunas: as que mudam o
  **desenho** viram caso de bateria (equity derivado, parcial por símbolo, mínimo nocional, desvio em pontos,
  rotação do token); as que são **números a colher** ficam para a sonda, na demonstração.
