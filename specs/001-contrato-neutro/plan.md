# Implementation Plan: O contrato neutro — mesa, setup e conector

**Branch**: `001-contrato-neutro` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-contrato-neutro/spec.md`

**Constituição**: [.specify/memory/constitution.md](../../.specify/memory/constitution.md) (v1.0.0)
**Regra de negócio**: [docs/regra-de-negocio.md](../../docs/regra-de-negocio.md) (v3, 136 regras)

## Summary

Entregar o **contrato neutro** — as mensagens que atravessam as duas fronteiras do terminal — com a
**fonte normativa** em `/contracts` (JSON Schema), os **mocks dos dois lados** (um deles noutra
linguagem que não a do core) e a **bateria de casos** que recusa o que tem de ser recusado. Nada do
ciclo da mesa é construído aqui: o que sai deste recorte são as mensagens, os geradores e as provas.

O contrato não é "tipos partilhados": é um **documento** que cada linguagem lê e do qual gera os seus
tipos. Três decisões governam o resto: o seam é um **processo com JSON em texto** (declarado em
`research.md`, D2), o dinheiro viaja como **decimal textual** (D4) e o contrato é **fechado** (D5).

## Technical Context

**Language/Version**: **TypeScript em Bun 1.4.2** (core, web, mock de setup e o runner de casos);
**Python 3.14.7** (mock de conector — a ponta noutra linguagem — e `/tools`).

**Primary Dependencies**: Bun (runtime e `bun test`); validação de schema com `ajv` (TS) e
`jsonschema` (Python); geração com `json-schema-to-typescript` (TS) e `datamodel-code-generator`
(Python). Confirmado por medição no host: `bun 1.4.2`, `node v26.8.1`, `python3 3.14.7`,
`uv 0.12.13` (o `python3` do sistema **não tem `pip`** — as dependências Python entram por `uv`);
**não há `go` nem `rustc`**: a ponta noutra linguagem é Python, não é escolha arbitrária.

**Storage**: ficheiros. JSON Schema normativo em `/contracts`; casos em `/contracts/casos/*.json`;
código gerado versionado em `/contracts/gerado/`; nenhum estado de posição (a posse lê-se do venue).

**Testing**: a **bateria de casos é dado** (`/contracts/casos/*.casos.json`), corrida por **dois
runners** — um em TS, um em Python — que emitem o **mesmo formato de relatório**, para que SC-002 possa
ser comparada máquina a máquina. Testes de unidade só onde não há caso de contrato a exercer.

**Target Platform**: Linux, **sem containers** (o host não tem docker/podman/nerdctl — constituição,
"Restrições adicionais"). Os mocks correm como processos locais ligados por stdio.

**Project Type**: monorepo por diretórios de topo (`/contracts`, `/core`, `/setups`, `/brokers`,
`/web`, `/tools`), com o contrato como única dependência comum. Este recorte toca `/contracts` e a
documentação de `specs/`.

**Performance Goals**: **nenhum alvo numérico próprio**, e isto é deliberado: o contrato não está no
caminho quente (um ciclo por relógio do setup, e o relógio é do setup) e o projeto não inventa limites
que o dono não pediu (RN-A1). O que se mede é a bateria (SC-002) e o prazo de resposta, que é **chave
do dono** (`setup.prazo_de_resposta_ms`), não constante do plano.

**Constraints**: (a) sem `null` no contrato — ausência é chave ausente; (b) nenhum valor de dinheiro em
vírgula flutuante; (c) contrato fechado (`additionalProperties: false` em todo o objecto);
(d) credenciais nunca no contrato, nos casos ou nos mocks — só referências (RN-E14); (e) uma ligação e
um processo por conta; (f) o seam não pode exigir nada do host que o host não tenha (portas, sockets,
daemons).

**Scale/Scope**: **8 mensagens** (mercado, proposta, boleta, resolução, desfecho, manifesto, marca,
envelope), **2 mocks**, **1 bateria de casos** partilhada. A cobertura é **100% dos casos de recusa que
a spec enumera** (28 requisitos + 13 casos de fronteira); o número de ficheiros de caso é consequência
disso, e mede-se no fim em vez de ser fixado aqui.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio da constituição | Como este plano o cumpre | Estado |
|---|---|---|
| **I** — a inteligência é humana; o código é burro | o contrato **não contém valor nenhum**: contém a *forma* e a *versão*. Bandas, prazos e limiares são chave de config e entram por mensagem, vindos do config | PASSA |
| **II** — recusar, nunca degradar em silêncio | contrato **fechado** (D5); `null` proibido (D4); nenhum arredondamento no contrato; a recusa é um **desfecho normalizado com motivo** (FR-020) | PASSA |
| **III** — fronteira neutra, e dinheiro não é float | JSON Schema como fonte única (D1) e decimal textual com escala declarada (D4) | PASSA |
| **IV** — o conector traduz, declara antes de executar, e prova | a resolução é mensagem própria, obrigatória antes da execução (FR-019); a bateria de conformidade do venue é de `brokers/<nome>`, fora deste recorte | PASSA |
| **V** — incerteza é estado de primeira classe | o desfecho tem `desconhecido` como valor de primeira classe e o mercado fechado/ausente são declarados no objecto (FR-007, FR-008, FR-020) | PASSA |
| **VI** — o dinheiro e a posse são da corretora | o contrato **não tem** campo para a mesa reconstruir resultado (FR-028); a posse lê-se do venue pela marca (FR-026) | PASSA |
| **VII** — a dependência aponta para o contrato, nunca para o core | a bateria de casos **não importa `core`**: só `contracts`. O teste de dependência é porteiro deste recorte | PASSA |
| **VIII** — sem prova, não está feito | cada artefacto deste recorte tem um caso que o recusa; a bateria corre **sem corretora** (SC-009) e compara duas linguagens (SC-002) | PASSA |

**Nenhuma violação. Complexity Tracking vazio** — e é aqui que a tentação existia: um *framework* de
ratos (RPC tipado, geração de clientes, esquema binário) entregaria o mesmo com mais peças. Ficou de
fora pelo princípio VIII ("o que a regra não nomeia não entra") e pela restrição "sem runtime de
container".

## Project Structure

### Documentation (this feature)

```text
specs/001-contrato-neutro/
├── plan.md              # este ficheiro
├── spec.md              # a especificação (o QUÊ)
├── research.md          # Phase 0 — as 12 decisões, com alternativas rejeitadas
├── data-model.md        # Phase 1 — entidades e campos (o desenho)
├── contracts/
│   └── interface.md     # Phase 1 — o seam, o envelope e as regras de forma
├── quickstart.md        # Phase 1 — como se prova, comando a comando
├── checklists/
│   └── requirements.md  # a checklist de qualidade da spec
└── tasks.md             # Phase 2 (/speckit-tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
contracts/                        # a fonte normativa — ninguém a importa, todos a leem
├── envelope.schema.json          # versão, tipo, correlação, carga
├── mercado.schema.json           # o objecto de factos (RN-D1 a RN-D5)
├── proposta.schema.json          # buy · sell · hold · caixa + relógio (RN-T4, RN-T5)
├── boleta.schema.json            # a mensagem padrão, em unidades neutras (RN-B0 a RN-B10)
├── resolucao.schema.json         # o que o conector vai enviar (RN-C10)
├── desfecho.schema.json          # aceite · parcial · desconhecido · recusado (RN-C2)
├── manifesto.schema.json         # as capacidades, sondadas (RN-C1)
├── marca.schema.json             # a forma da marca de posse (RN-B10)
├── vocabulario.json              # nomes e motivos normalizados (enum fechado, partilhado)
├── casos/                        # A BATERIA — dado, não código
│   ├── <mensagem>.casos.json     # { nome, entrada, veredicto, motivo }
│   └── README.md                 # como se escreve um caso, e o que é um caso inválido
├── gerado/
│   ├── ts/                       # gerado do schema, versionado, com teste de frescura
│   └── py/                       # idem
├── mocks/
│   ├── setup/                    # TS — o setup falso (respostas conhecidas, inválidos de propósito)
│   ├── conector/                 # PYTHON — a ponta noutra linguagem (tradução, desfechos, banda)
│   └── README.md                 # (já existe) o que cada mock exerce
└── README.md                     # (já existe)

tools/
└── verificar-contrato/           # corre a bateria nas duas linguagens e compara os relatórios
```

**Structure Decision**: a **fonte normativa fica na raiz** (`/contracts`), como o `contracts/README.md`
já declara — e não em `specs/`. O `specs/001-contrato-neutro/` guarda o **desenho** (data-model, seam,
envelope) e aponta para a raiz; assim não nascem duas versões da mesma verdade. Os mocks ficam em
`contracts/mocks/`, onde o `mocks/README.md` já os situa, porque o que eles provam é **o contrato**, não
a mesa. O verificador fica em `tools/` (a casa dos utilitários do dono, que correm sem operar — RN-E13)
e **não** importa `core`.

## Phase 0 — Outline & Research

Gerado: [research.md](./research.md) — **12 decisões**, cada uma com racional e alternativas
rejeitadas. As que mudam o desenho:

1. **D1** notação: **JSON Schema 2020-12** como fonte normativa.
2. **D2** seam: **processo + JSON em texto sobre stdio**, uma mensagem por linha.
3. **D3** envelope: versão, tipo, correlação e carga — a versão confere-se num só sítio.
4. **D4** dinheiro: **decimal textual com escala declarada; `null` proibido; ausência = chave ausente**.
5. **D5** contrato fechado: `additionalProperties: false` em todo o objecto.
6. **D6** marca de posse: inteiro sem sinal, determinístico, com o mapa marca → ficha/ciclo no ledger.
7. **D7** versão: **igualdade exacta** conferida em cada troca (v1 não tem compatibilidade a preservar).
8. **D8** código gerado: **versionado**, com teste de frescura (regenerar não pode produzir diff).
9. **D9** a bateria é **dado**, com dois runners e um formato de relatório comum.
10. **D10** onde vive a verdade: `/contracts` normativo · `specs/` desenho · inventário de chaves
    confere.
11. **D11** credenciais: por **referência**, nunca por valor, e nunca no contrato.
12. **D12** prazo: toda troca tem prazo declarado; silêncio é estado (congelamento ou desconhecido).

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — as 9 entidades, com campos, regras de validação e transições.
- [contracts/interface.md](./contracts/interface.md) — o envelope, o seam, as regras de forma (decimal,
  ausência, fecho, versão) e o que cada ponta pode e não pode ver.
- [quickstart.md](./quickstart.md) — como se prova: os comandos, por ordem, e o resultado esperado de
  cada um.

### Re-avaliação da Constitution Check depois do desenho

| Pergunta | Resposta |
|---|---|
| O desenho introduziu valor ajustável no código? | **Não** — o contrato tem forma e versão; todo número entra por mensagem, vindo do config |
| Alguma mensagem passou a transportar unidade de corretora? | **Não** — quantidade/nocional/margem/preço de liquidação vivem **só** na resolução e no desfecho, que são as mensagens da ponta que conhece o venue |
| O desenho obriga a mesa a saber a linguagem da ponta? | **Não** — o seam é texto; o mock em Python prova-o |
| Algum artefacto ficou sem caso que o recuse? | **Não** — cada mensagem tem casos válidos **e inválidos de propósito** |

## Complexity Tracking

Sem violações. Nada a justificar.

## Riscos conhecidos (e o que os torna visíveis)

| Risco | Porque é real | Como aparece |
|---|---|---|
| **Código gerado editado à mão** para fazer um caso passar | é o caminho mais curto quando um teste falha | teste de frescura: regenerar tem de reproduzir o ficheiro (D8) |
| **As duas linguagens divergirem** sem ninguém notar | cada runner evolui sozinho | a bateria é **dado comum** e o relatório é comparado (D9, SC-002) |
| **O contrato inchar** até virar framework de RPC | é o que costuma acontecer a "só uns tipos" | princípio VIII + revisão: peça que não cite regra é removida |
| **O mock tornar-se permissivo** (aceita o que o contrato recusa) | mocks escritos para passar no caminho feliz | cada mock tem de **saber ser inválido de propósito** (`contracts/mocks/README.md`) |
