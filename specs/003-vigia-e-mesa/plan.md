# Implementation Plan: O vigia e a mesa, ponta-a-ponta contra dublês

**Branch**: `003-vigia-e-mesa` | **Spec**: [spec.md](./spec.md) | **Created**: 28 set 2026

## Summary

Pôr o **vigia** no ar como **processo** e governar a **mesa** por ele, com a fronteira entre os dois
**contratada** (a única fronteira do sistema que ainda não tem mensagem no contrato) e os **dublês** a
sustentar tudo. Três coisas nascem aqui: a **porta de processo da mesa** (medida: não existe), a **mensagem
do comando** (contrato **1.1.0**) e o **dublê de mesa** (`contracts/mocks/mesa/`, Python, escrito do contrato),
para que os plugins se construam sem a mesa real (RN-E24).

## Technical Context

| O quê | Com o quê | Por quê |
|---|---|---|
| **vigia** | TypeScript sobre **Bun** (o do core) | é processo irmão da mesa, na mesma linguagem e no mesmo runtime |
| **porta de processo da mesa** | TypeScript, **uma linha JSON por mensagem** (stdin/stdout) | é a forma que os dublês já usam (`echo '<mercado>' \| bun run mocks/setup/main.ts`) |
| **dublê de mesa** | **Python 3.14 + `jsonschema`** | obriga a fronteira a valer **fora** da nossa linguagem (RN-E17, RN-E24) |
| **contrato** | JSON Schema 2020-12 + `ajv` (TS) e `jsonschema` (Py) | normativo desde o recorte 001 (D1, D10) |
| **registro do vigia** | ficheiro próprio do runtime (`.vigia.json`), escrita atómica | o ledger é da mesa e tem um só escritor (RN-E7) |
| **medição** | `tools/verificar-maquina/provar.sh` (porta única) + `tools/verificar-contrato/*` | sem prova não está feito (princípio VIII) |

**Medições que este plano usa** (todas desta sessão, não digitadas):

- o **contrato tem 9 esquemas** hoje e **354 ocorrências da versão `1.0.0` em 91 ficheiros** (o `45` que este plano trazia era um filtro mais estreito, só por extensões `.json/.ts/.py/.sh`) — é este o custo
  da subida de versão, e é contável;
- a **mesa não tem porta de processo**: nenhum ficheiro de `core/` lê `stdin` (só os tipos do Node);
- os **dublês de setup e de conector já são processos** que leem uma linha JSON e respondem por linha;
- os **motivos da mesa** são um conjunto **fechado de __N_MOTIVOS__** em `core/estados/motivos.json`, e nenhum
  deles é escrito em código (o intérprete lê-os de lá);
- `provar.sh` corre **16 verificações** (13 em `--rapido`).

**Alvo e limites do host** (medidos em sessões anteriores): Linux **sem container**, sem `go` nem `rustc`;
`python3` sem `pip` (entra por `uv`); `bun 1.4.2`, `node v26.8.1`, `ajv 8.20.0`, `jsonschema 4.26.0`.

## Constitution Check

| Princípio | Como este plano o cumpre | O teste que recusa |
|---|---|---|
| **I. A inteligência é humana; o código é burro** | o vigia não conhece estratégia, mercado nem ledger; os verbos são cinco e o `nova_sessao` exige **autor e motivo** | um comando com campo a mais é recusado (`comando_com_campo_a_mais`) |
| **II. Recusar, nunca degradar em silêncio** | toda recusa do vigia e da mesa traz **motivo do conjunto fechado**; nenhum caminho fecha por prazo ou em silêncio | um `start` com porta falhada devolve **o motivo daquela porta** (SC-006) |
| **III. A fronteira fala uma língua neutra, e dinheiro não é float** | o comando é mensagem de contrato, validado nas **duas** linguagens; o dublê de mesa é Python a ler os mesmos esquemas | o mesmo comando aceite em TS e recusado em Py (ou vice-versa) é falha |
| **IV. O conector traduz, declara antes de executar, e prova** | nada aqui toca no conector; o dublê de mesa passa a permitir prová-lo sem a mesa real | os casos do dublê e da mesa real divergirem (SC-004) |
| **V. Incerteza é estado de primeira classe** | o vigia morto **não** é estado da mesa (RN-V6); o silêncio do venue continua a virar `desconhecido`, nunca sucesso | o vigia morre e a mesa continua a reconciliar (SC-001) |
| **VI. O dinheiro e a posse são da corretora** | o resumo do encerramento traz **números da corretora**, nunca estimativas | um resumo com número calculado por nós é falha |
| **VII. A dependência aponta para o contrato, nunca para o core** | a mesa e o vigia dependem do contrato; o **dublê de mesa é escrito do contrato**, nunca do core | o dublê importar código do core é falha de revisão |
| **VIII. Sem prova, não está feito** | cada FR tem o comando que o mede, em `relatorios/` | FR sem linha no relatório é tarefa aberta |

## As cinco decisões deste plano

### D1 — O comando é mensagem do contrato, e a versão sobe para **1.1.0** (aditiva)

A fronteira vigia↔mesa é uma fronteira de verdade: dois processos, uma língua que tem de ser neutra, e uma
versão que ambos comparam (D7). O **D-005** já tinha nomeado a dívida. Duas alternativas foram consideradas e
recusadas:

- **manter 1.0.0 e deixar o comando fora do contrato** (um acordo interno entre dois processos): recusada —
  um acordo tácito entre processos é um defeito que só aparece quando um dos dois é actualizado sozinho;
- **um segundo documento de contrato só para esta fronteira**: recusada — dois contratos com duas versões no
  mesmo sistema obrigam a duas comparações de versão na mesma mensagem, e a segunda seria esquecida.

**Por que 1.1.0 e não 2.0.0:** nada que existia mudou de sentido; o que entra é **aditivo** (dois tipos de
mensagem e vocabulário). Quem não conhece o tipo recusa-o com `tipo_desconhecido` — que é exactamente o
comportamento declarado, e não um comportamento novo. E o envelope já leva a versão, logo a mudança é
**detectada**, que é o que se quer (RN-C7: mudança detectada, não sofrida).

**A migração é um acto com contagem:** a versão é comparada por igualdade exacta, logo **todos** os casos
existentes passam a `1.1.0` — **354 ocorrências em 91 ficheiros**. A tarefa mede: antes, depois, **zero**
ocorrências de `1.0.0` fora do histórico.

### D2 — A mesa ganha **porta de processo** (hoje não tem)

Medido: a mesa é hoje uma **biblioteca** (`core/mesa.ts`) que as bancadas chamam em processo
(`core/mesa.prova.ts`). Nada em `core/` lê `stdin`. Sem porta de processo não há vigia que arranque a mesa —
e «arrancar a mesa» é metade do que o vigia faz.

A porta é **magra de propósito**: lê uma linha JSON (a mensagem do contrato), entrega ao intérprete da mesa,
devolve **uma** linha JSON. Não faz nada mais — nem log próprio, nem decisão, nem leitura de configuração que
a mesa já lê. Se esta porta começar a decidir, é o defeito dos falsos botões outra vez.

### D3 — O registro do vigia vive em **ficheiro próprio do runtime** (`.vigia.json`), nunca no ledger

O ledger é da mesa, tem **um só escritor** (RN-E7) e tem tipos de linha **declarados** (RN-L2). As transições
do vigia são **operações**, não linhas de mercado. Vão para um ficheiro do runtime, com a mesma escrita
atómica das marcas (tmp + rename), e a **retenção dele pode ser diferente** da do ledger — o que também é uma
decisão explícita, e não um acidente.

### D4 — O vigia **arranca** a mesa e os conectores, e **não valida** nada

RN-E21: quem monta processos é a camada de operação — **e o vigia é essa camada**. Isto **corrige a FR-005 da
spec**, que eu tinha escrito ao contrário (dizia que o vigia não arranca os conectores; a regra diz que
arranca). O vigia sabe **nomes de processos** e mais nada: não lê estratégia, não valida mandato (RN-V5) e
**não reinterpreta** a recusa que vem da mesa — a recusa **é** o resultado, e sobe como mensagem.

Nota de âmbito: **a hospedagem do setup** (biblioteca no processo da mesa ou processo próprio) **não** se
decide aqui — é decisão da spec do setup. Este recorte monta a mesa e os **conectores**, que a regra já
desenhou como um processo por conta (RN-E3, RN-E5).

### D5 — O dublê de mesa é **Python** e escrito **do contrato**; os casos são os **mesmos** da mesa real

Terceira linguagem em termos de autoria (core TS, dublê Py), escrita a ler **os esquemas**, nunca a importar
`core/`. E a prova de fidelidade é a mais forte que este projecto sabe fazer: **os mesmos casos** correm no
dublê e na mesa real, e uma **divergência aparece como falha** (SC-004). Se o dublê for copiado do core, prova
compatibilidade com a nossa implementação — e esconde o defeito dos dois lados ao mesmo tempo.

## Project Structure

### Documentation (this feature)

```
specs/003-vigia-e-mesa/
├── spec.md              # as histórias, os 35 requisitos e os 8 critérios
├── plan.md              # este ficheiro
├── research.md          # R1 a R9 — as decisões, com as alternativas recusadas
├── data-model.md        # as entidades novas (vigia, comando, transição, resumo, dublê)
├── contracts/interface.md  # a mensagem do comando e a resposta, com o contrato 1.1.0
├── quickstart.md        # como se corre e o que se vê
├── checklists/requirements.md
├── relatorios/          # o que se mediu, por tarefa (nasce com T001)
└── tasks.md             # (o /speckit-tasks escreve)
```

### Onde o código toca

```
core/
├── mesa.ts                      (modificado) — devolve a decisão de forma serializável
├── servidor.ts                  (NOVO) — a porta de processo: uma linha JSON entra, uma sai
├── estados/motivos.json         (modificado) — passa a espelho do vocabulário do contrato
└── estados/comando.ts           (modificado) — valida pela mensagem do contrato, não por forma própria

vigia/
├── vigia.ts                     (NOVO) — o processo, os cinco verbos, o registro das transições
├── registro.ts                  (NOVO) — `.vigia.json`, escrita atómica
└── prover.ts                    (NOVO) — a bancada do vigia (bateria própria)

contracts/
├── comando.schema.json          (NOVO)
├── resposta-de-comando.schema.json (NOVO)
├── versao.json                  (modificado) — 1.1.0
├── vocabulario.json             (modificado) — os __N_MOTIVOS__ motivos da mesa entram
├── casos/comando.casos.json     (NOVO) — aceites e recusados, pelo mesmo critério dos outros
├── casos/*.json                 (migrados) — a versão 1.1.0
├── gerado/ts, gerado/py, esqueleto (regenerados)
└── mocks/mesa/                  (NOVO) — o dublê de mesa, em Python, com os seus casos

tools/verificar-maquina/provar.sh  (modificado) — ganha a porta do vigia
tools/verificar-contrato/*         (modificado) — a bateria do contrato passa a 1.1.0 e ganha os casos novos
```

**O que este recorte NÃO toca:** `~/Projects/jev-trade-fusao` (nenhum ficheiro), o motor que opera a conta, e
o ledger (escreve-se nele como sempre; não se redesenha).

## Complexity Tracking

| Complexidade | Por que é necessária | Alternativa mais simples recusada |
|---|---|---|
| **um processo a mais** (vigia) | é o que permite a mesa operar sem ele (RN-V6) e o que torna a superfície possível depois | vigia dentro da mesa: mataria a RN-V6 e juntaria numa morte o vigia e as mesas que ele vigia |
| **dois tipos de mensagem novos** | a fronteira existe e tem de ser língua, não acordo | comando por CLI: não teria versão, nem vocabulário, nem recusa com motivo |
| **subir a versão do contrato** (354 ocorrências) | a versão é comparada por igualdade exacta; deixar mensagens em duas versões é ter duas verdades | aceitar a versão antiga «por compatibilidade»: é exactamente a adaptação em silêncio que a constituição proíbe |
| **um dublê de mesa em Python** | provar a fronteira fora da nossa linguagem | dublê em TS: provaria a lógica, não a fronteira (RN-E17) |

## Progress

- [x] Spec escrita e validada (7 histórias, 35 FR, 8 SC, 0 marcas de dúvida)
- [x] Plano escrito (5 decisões) — e uma **correcção à spec**: a FR-005 dizia o contrário da RN-E21 (ver D4)
- [x] `research.md` (R1 a R9) — com a lista dos **20 de 42** motivos que cruzam a fronteira
- [x] `data-model.md` (6 entidades novas + o que muda nas existentes)
- [x] `contracts/interface.md` (os quatro tipos de mensagem, no contrato 1.1.0)
- [x] `quickstart.md` (as três portas e a prova de cada história)
- [x] **Reconferência da constituição depois do desenho** — nenhum dos 8 princípios ficou em falta: o desenho
      *acrescenta* prova (o dublê escrito do contrato) e *não* relaxa nenhuma (nenhum caminho novo de escrita
      no ledger, nenhuma decisão nova na porta, nenhum número ajustável no código — o prazo do encerramento
      entra como **chave**, RN-A3)
- [ ] `tasks.md`
- [ ] Implementação, tarefa a tarefa, com relatório
