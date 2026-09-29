# Specification Quality Checklist: O vigia e a mesa, ponta-a-ponta contra dublês

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 28 set 2026
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

## Notas da validação (o que passou, e com que ressalva)

- **Marcas `[NEEDS CLARIFICATION]`: 0.** Todas as decisões que a spec precisava já estão em regra
  (`docs/regra-de-negocio.md`): RN-V1 a RN-V10 (os verbos), RN-E21 a RN-E24 (topologia, alcance, registo,
  dublês), RN-C12 a RN-C20 (a camada do conector) e o D-005 (a fronteira vigia↔mesa). Nada ficou por decidir —
  o que ficou por fazer é trabalho, não pergunta.
- **Sobre «sem detalhes de implementação»:** a spec cita **artefactos que já existem** (`core/estados/comando.ts`,
  `contracts/mocks/mesa/`, `provar.sh`) como rastreabilidade, que é a convenção deste projecto desde o recorte
  001. E **deixa aberta** a única escolha de tecnologia que este recorte faria — a linguagem do dublê de mesa
  («numa linguagem que não a do core», FR-028): essa decisão é da spec do dublê, não desta.
- **Sobre «critérios agnósticos de tecnologia»:** os critérios falam de **ledger**, **porta única**, **contrato**
  e **casos declarados** — artefactos do domínio deste sistema, não tecnologias. Nenhum SC nomeia linguagem,
  biblioteca ou fornecedor.
- **FR cuja verificação é uma bateria que já existe** (FR-032, FR-033, FR-035): o critério de aceite é a
  **contagem medida** antes e depois, e a spec diz qual. Não é «passa nos testes» — é «a mesma contagem».
- **Uma coisa que a spec declara em vez de resolver:** o campo da conta na mensagem do comando **não** entra
  agora (FR-020). Um campo sem leitor é o defeito dos falsos botões, e o dono já pagou por esse erro uma vez.

## Resultado

Todas as linhas passam. Segue-se o `/speckit-plan`.
