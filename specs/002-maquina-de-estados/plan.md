# Implementation Plan: A máquina de estados da mesa

**Branch**: `002-maquina-de-estados` | **Date**: 2026-09-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-maquina-de-estados/spec.md` (7 histórias, 44 FR, 12 SC)

## Summary

Este recorte escreve o **primeiro código do core**. Até aqui, `/core` era uma pasta com um README: o
recorte 001 provou a língua com mocks e ferramentas, sem tocar no cérebro.

O que se constrói é uma máquina pequena e teimosa, com três peças e uma fronteira:

1. **A tabela de transições** — em **dado**, não em código: (estado, verbo) → estado novo, ou recusa
   com motivo. É a única peça que alguém revisa a olho, e é por isso que é um ficheiro legível.
2. **O intérprete** — umas dezenas de linhas: procura na tabela, aplica, registra. Não decide nada.
3. **O ciclo** — em que **condição** está cada instrumento (das leituras do conector), e o que se pode
   fazer nessa condição: abrir, não abrir, fechar, não fechar, alarmar.
4. **As marcas** — `sessao`, `inibicao_cb`, `desconhecido`: o que sobrevive ao processo morrer, e o que
   o `reset` não apaga.

O que este recorte **não** constrói: a tradução (é do conector), a estratégia (é do setup), a ligação
viva à corretora (é da bateria de conformidade, RN-C6), o ledger e a web. O ciclo lê **fixtures** — as
mensagens que o recorte 001 já sabe produzir e validar — e essa é a decisão que mantém o recorte
medível hoje, sem corretora e sem chave.

## Technical Context

**Language/Version**: TypeScript sobre **Bun 1.4.2** (medido; é a linguagem do core pela constituição,
e o recorte 001 já deixou `ajv` + `json-schema-to-typescript` a funcionar).

**Primary Dependencies**: **nenhuma nova.** O core importa os **tipos gerados** de `/contracts`
(`contracts/gerado/ts/*.d.ts`) e o `ajv` que lá está — a mesma dependência que o recorte 001 já
instalou. Uma máquina de estados não precisa de biblioteca de máquinas de estados: precisa de uma
tabela e de um `Map`.

**Storage**: um ficheiro de **marcas** do runtime (`core/estado/.marcas.json`, estado, não código) —
escrito de forma atómica (ficheiro temporário + `rename`). **Não** é o ledger, e **nunca** guarda
posições (FR-022): guarda sessão, inibição e desconhecidos.

**Testing**: baterias em **dado** (`*.casos.json`) e um runner que imprime `ok`/`FALHA` por caso, como
no recorte 001 — mesma gramática, para não haver duas formas de ler um relatório. Mais duas provas de
linha de comando: os **invariantes da tabela** (estado sem saída, verbo sem estado, estado inalcançável,
recusa sem motivo) e o **porteiro do estado** (a tabela e os casos não importam mocks nem `/tools`).

**Target Platform**: Linux, o host do dono (sem container, sem `go`/`rustc`; `bun` e `uv` presentes).

**Project Type**: um **core** dentro de um monorepo por camadas (`/contracts` normativo, `/core`
executor, `/setups` e `/brokers` plugins, `/web` interface, `/tools` verificação).

**Performance Goals**: **nenhum alvo próprio**, e é uma decisão, não um esquecimento. O ciclo corre uma
vez por relógio do setup (que é declarado pelo setup, em ms): o que este recorte tem de garantir é não
decidir duas vezes e não perder marcas. Um número de ciclos por segundo seria um valor sem dono.

**Constraints**:

- **Sem corretora, sem chave, sem rede** (SC-009 do recorte 001 continua a valer): as leituras vêm de
  fixtures.
- Nenhum valor ajustável no código (FR-044): prazos, limites e a lista de eventos que avisam vêm do
  inventário — e o conferidor do inventário do recorte 001 passa a cobrir também as chaves deste.
- As marcas sobrevivem a reinício (FR-043) e o `reset` não as toca (FR-005).

**Scale/Scope**: 1 mesa, `n` instrumentos (hoje 2 no mock: EURUSD e XAUUSD). Estados: 4 da mesa × 5
condições × 4 posições = 80 combinações possíveis, das quais a tabela declara as que existem — e o
conferidor reprova as impossíveis que apareçam escritas.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Como este recorte o cumpre | Verificação |
|---|---|---|
| **I. A inteligência é humana; o código é burro** | A tabela de transições é dado; o intérprete não decide. Prazos e limites vêm do inventário. | `tools/verificar-maquina.sh` (tabela) + conferidor do inventário (SC-012) |
| **II. Recusar, nunca degradar em silêncio** | Toda transição ilegal recusa **com motivo**; toda decisão de não fazer fica registrada (FR-007). | Bateria de pares (estado, verbo): 100% das recusas com motivo (SC-001) |
| **III. Fronteira neutra, dinheiro não é float** | Nada aqui inventa mensagem: o ciclo consome e produz as mensagens do recorte 001, validadas pelo mesmo contrato. | A bateria do recorte 001 continua verde; nenhum schema é tocado neste recorte |
| **IV. O conector traduz e declara antes de executar** | A máquina trata a resolução antes do desfecho (o ciclo só executa depois de resolver) e nunca traduz unidades. | Casos de ciclo com fixture de resolução seguida de desfecho |
| **V. Incerteza é estado de primeira classe** | `desconhecido` é marca com saída própria (reconciliação) e bloqueia ordem nova; nunca promovido nem rebaixado. | US3 + SC-004, SC-005 |
| **VI. Dinheiro e posse são da corretora** | A mesa **não** guarda posições: lê a posse da corretora pela marca (FR-022). O ficheiro de marcas não tem campo de posição. | Porteiro do estado: reprova se o ficheiro de marcas ganhar lista de posições |
| **VII. A dependência aponta para o contrato** | `/core` importa `/contracts` (tipos gerados); nada em `/contracts` importa `/core` (já medido: 0 dependências proibidas). | `porteiro-dependencias.sh` (recorte 001, continua a correr) |
| **VIII. Sem prova, não está feito** | Cada bateria traz a sua **prova negativa**: uma tabela com um estado sem saída tem de **reprovar**. | `verificar-maquina.sh` com prova negativa guardada no repositório |

**Veredicto do portão: passa.** Nenhuma violação a justificar — e o Complexity Tracking fica vazio,
porque este recorte **não** acrescenta dependência, não acrescenta camada, e não acrescenta mensagem ao
contrato.

## As quatro decisões deste plano (as duas primeiras fecham o que a spec deixou aberto)

### D1 — As transições vivem em **dado** (`core/estados/transicoes.json`), não em código

O documento de estados já enuncia a regra de leitura: *"um estado sem saída declarada é lacuna; um
evento que não muda nada é ruído; um evento sem estado onde caiba é lacuna."* Essa frase só é
verificável por um programa se as transições forem **dados**. Em código (`switch`/`if`), a única
verificação possível é leitura humana — e foi precisamente a leitura humana que deixou passar o
`ABERTA` que não existia e a marca que faltava na boleta (recorte anterior).

A tabela tem, por linha: `de`, `verbo`, `para` **ou** `recusa` (com motivo do vocabulário), `guarda`
(condição de contexto, ex.: "sem posição viva") e `nota` (a regra `RN-*` que a obriga).

**Alternativas rejeitadas**: (a) `switch` em código — a tabela deixa de ser conferível e o motivo de
recusa passa a estar no meio da lógica; (b) biblioteca de máquinas de estados (XState e afins) — traz
uma máquina de estados genérica (estados aninhados, atores, efeitos) para um problema que é uma tabela
de 30 linhas, e esconderia as **recusas**, que aqui são o produto principal; (c) gerar a tabela de um
diagrama — o diagrama (recorte anterior) é a vista, não a fonte; inverter isto põe a fonte num
formato que ninguém escreve à mão.

### D2 — As marcas vivem num ficheiro próprio do runtime, **nunca** no ledger

As marcas (`sessao`, `inibicao_cb`, `desconhecido`) são memória de trabalho: têm de ser lidas **antes**
de qualquer outra coisa no arranque, e rescritas a cada ciclo. O ledger é o registo do que aconteceu,
com política de retenção (RN-L6) e sem escrita destrutiva.

Juntá-los partiria duas coisas: a **retenção** apagaria a inibição do CB (a mesa voltaria a operar por
expiração de prazo, que é o pior defeito possível) e o ledger passaria a ser mutável.

**Alternativas rejeitadas**: (a) guardar as marcas no ledger — a retenção apaga o que não pode ser
apagado; (b) só em memória — morre com o processo, que é exactamente o defeito que as marcas existem
para evitar (e o teste do reinício, SC-010, deixaria de passar); (c) base de dados — não há nenhuma no
host, e uma marca são três linhas de JSON.

**Limite explícito**: o ficheiro de marcas **não pode** ganhar um mapa instrumento → posição. A posse
lê-se da corretora (FR-022). O porteiro do estado reprova se esse campo aparecer — a diferença entre
"lembrar-se do que aconteceu" e "achar que sabe o que tem" é o que separa uma mesa que se reinstala de
uma que se engana.

### D3 — As leituras vêm de **fixtures** neste recorte; a ligação viva é do recorte da conformidade

O ciclo precisa de ler (mercado, posições, e o relógio do setup). Ligá-lo já a um processo externo
obrigaria a ter corretora, chave e conta — e o recorte deixaria de ser medível no host. Então: o core
recebe as leituras por uma **porta de leitura** (`core/leitura/fixtures.ts`) que, nos testes, lê
ficheiros com mensagens do contrato (as mesmas do recorte 001), e no recorte da conformidade será
trocada pelo processo (o seam já está provado: uma mensagem por linha em texto).

O que isto **não** é: um mock do conector dentro do core. A porta é uma função, e o que entra por ela
são mensagens já validadas contra o contrato — se uma fixture não validar, o teste falha antes de a
máquina decidir.

### D4 — A máquina **não** envia: ela **decide**, e a decisão é dado observável

Para que o SC-002 ("zero ordens de abertura enviadas") seja medido por **contagem** e não por inspecção
de código, o ciclo devolve, por instrumento, uma **decisão**: `abrir` (com a boleta), `fechar`,
`adoptar`, `nada` — cada uma com o motivo. Quem envia é o processo que liga o core ao conector (recorte
seguinte). Assim o teste conta decisões de `abrir` sem precisar de corretora, e a fronteira "decidir /
executar" fica onde a constituição a quer: interpretação no core, I/O nas pontas.

## Project Structure

### Documentation (this feature)

```text
specs/002-maquina-de-estados/
├── plan.md              # este ficheiro
├── spec.md              # a spec (7 histórias, 44 FR, 12 SC)
├── research.md          # Fase 0 — as decisões acima, com as alternativas
├── data-model.md        # Fase 1 — estados, condições, posições, marcas, transições, ciclo
├── contracts/interface.md  # Fase 1 — o que o vigia/web manda e o que a mesa responde
├── quickstart.md        # Fase 1 — como se prova cada história
├── checklists/requirements.md
├── relatorios/          # o que a implementação medir
└── tasks.md             # Fase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
core/                          # PRIMEIRO código do core
├── estados/
│   ├── transicoes.json        # D1: a tabela (dado, revisável a olho)
│   ├── maquina.ts             # o intérprete: procura, aplica, registra — não decide
│   ├── transicoes.casos.json  # a bateria de pares (estado, verbo)
│   └── marcas.ts              # ler/escrever as marcas, atómico
├── ciclo/
│   ├── condicoes.ts           # das leituras para a condição do instrumento (5 + dado velho)
│   ├── ciclo.ts               # a passagem por instrumento: decide (abrir/fechar/adoptar/nada)
│   └── ciclo.casos.json       # a bateria de cenários (fixture → decisão esperada)
├── leitura/
│   └── fixtures.ts            # a porta de leitura (D3), hoje por ficheiros
└── estado/
    └── .marcas.json           # ESTADO do runtime (não versionado)

tools/verificar-maquina/
├── tabela.ts                  # invariantes da tabela: estado sem saída, verbo sem casa, inalcançável
├── porteiro-do-estado.sh      # /core não importa mocks nem /tools; as marcas não têm posições
└── provar.sh                  # corre tudo: tabela + baterias + protesto negativo
```

**Structure Decision**: uma pasta por responsabilidade dentro de `/core` (`estados/`, `ciclo/`,
`leitura/`), com o **dado junto do código que o lê** (`transicoes.json` ao lado de `maquina.ts`),
porque a alternativa (um `/config` para a tabela) sugeriria que o dono a edita — e não edita: a tabela
é regra do sistema, não valor do dono. O que o dono edita continua a ser só `/config`, e nenhuma chave
nova deste recorte vive aqui.

## Complexity Tracking

> Vazio de propósito: nenhuma violação ao Constitution Check, nenhuma dependência nova, nenhuma camada
> nova. Se este recorte crescer para além do que a spec pede, é aqui que tem de se justificar — e a
> linha em falta é a prova de que não cresceu.

## Progress

- [x] Fase 0 — decisões (D1…D4) escritas em `research.md`
- [x] Fase 1 — `data-model.md`, `contracts/interface.md`, `quickstart.md`
- [x] Fase 2 — `tasks.md` (63 tarefas, mapa de cobertura 44 FR / 12 SC fechado)
- [x] Implementação — fundacional + **US1 (MVP)**: 19 de 63 tarefas, tudo medido em `relatorios/`
- [x] Implementação — **US2** (as condições e o ciclo): 29 de 63 tarefas · 12 casos de condição + 20 de ciclo · SC-002 e SC-003 medidos
- [x] Implementação — **US3** (o desconhecido fica desconhecido): 36 de 63 tarefas · SC-004, SC-005 e SC-010 medidos — **as três P1 estão fechadas**
- [ ] Implementação — US4 (arranque por seis portas), US5 (sessão e CB), US6/US7 (pausada e pedido ignorado), polish
