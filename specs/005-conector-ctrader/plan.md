# Implementation Plan: O segundo conector — cTrader, em conta de demonstração

**Branch**: `005-conector-ctrader` | **Date**: 01 out 2026 | **Spec**: [spec.md](spec.md)

**Contrato**: 1.9.0 · **Regra de negócio**: `docs/regra-de-negocio-ctrader.md` (família `RN-CT*`) ·
**Máquina de estados**: `docs/maquina-de-estados-conector-ctrader.md` · **Parecer da biblioteca**:
`docs/AVALIACAO-BIBLIOTECA-CTRADER.md`

## Summary

Construir `brokers/ctrader/` — o **segundo** conector a sério — que fala o contrato neutro de um lado e a Open
API do cTrader do outro: autentica **a aplicação e a conta** (duas camadas), sonda e publica o manifesto com os
números **lidos** (nenhum copiado para o código), traduz a boleta para a unidade do venue (volume em 0,01,
distâncias relativas em 1/100000) recusando o que não cabe, devolve a resolução e o desfecho com os números do
venue, fecha **por posição**, trata o silêncio como estado (`desconhecida`) e a **rotação do token** como
acontecimento de estado, e passa a bateria de conformidade — as oito provas da casa mais as quatro deste venue —
em **conta de demonstração**, com o resultado registado por versão.

O que este plano tem de diferente do primeiro: **a linguagem é outra** (e é aqui que se mede se a costura é mesmo
mensagem), o contrato **não pode crescer** (SC-015), e há uma camada pronta a adoptar com uma decisão de fronteira
(a biblioteca é protocolo, não conector).

## Technical Context

- **Linguagem do plugin**: **Python 3.12+** (o host tem 3.14.7, medido) — decisão **D1**, com a razão.
- **Camada de protocolo**: `ctrader-api-client`, **versão fixada 0.11.0** (parecer:
  `docs/AVALIACAO-BIBLIOTECA-CTRADER.md`). Sessão, protobuf, OAuth, reconexão e a sonda de símbolos vêm dela; **a
  fronteira é nossa** (D2).
- **Costura com o core**: mensagem **JSON por linha** no protocolo do contrato (`contracts/esqueleto/`), processo
  por (corretora, conta), arrancado pela camada de operação — igual ao conector 1, língua diferente (RN-C5,
  FR-045).
- **Ambiente de ensaio**: **demonstração** (`demo.ctraderapi.com:5035`), conta e tokens do dono, ficheiro de
  tokens **fora do repositório** (FR-050).
- **Manifesto**: ficheiro do **runtime**, fora do versionamento (como no conector 1) + `.gitignore` da pasta.
- **Bancadas**: (a) **offline**, sem rede, com casos em dado (`casos/*.casos.json`, payloads do venue gravados
  como fixture); (b) a **bateria de conformidade em demonstração**, doze provas, resultado em `conformidade/` por
  versão.
- **Alvo de desempenho**: o recorte não tem meta de latência (a mesa opera num relógio de velas); o que conta é o
  **ritmo** do venue (50/s gerais, 5/s históricos) respeitado e declarado (FR-071).
- **Restrições**: nenhum valor de credencial no repositório (FR-023/FR-050); nenhum número do venue no código
  (FR-051); o contrato não cresce (FR-046).

## Constitution Check

*GATE: passou antes da fase 0; re-avaliado depois do desenho — passa.*

| Princípio | Como este plano o cumpre |
|---|---|
| **I. A inteligência é humana; o código é burro** | Nenhum número ajustável no código: unidades, passos, distâncias mínimas e limites entram pelo **manifesto** (lido do venue) ou por **chave declarada** na ficha/conta. Teste que recusa: mudar o passo de volume no venue e ver o manifesto reflecti-lo **sem tocar em código** (US1, cenário 2). |
| **II. O contrato é neutro** | SC-015 como portão: esquema, motivos e vocabulário passam **sem alterações**. Nada de campos com nome do venue. O que é específico entra em `manifesto`/`leitura` como valor declarado. |
| **III. Falha alto, sem fallback** | O que não cabe é recusado com motivo (FR-056/057/058/059); o silêncio é `desconhecida`, nunca sucesso (FR-067); leitura falhada não produz desfecho (FR-069); `fallbacks.py --exigir-zero` no portão. |
| **IV. Uma grandeza, um dono** | O manifesto é do conector (lido do venue); a resolução e o desfecho são dele; a decisão é da mesa; o equity é **derivado** e declarado como nosso (FR-052). |
| **V. Teste antes do código** | As duas bancadas são declaradas antes da implementação, e as doze provas de conformidade são a definição de pronto (SC-014). |
| **VI. Segredos não se versionam** | Credencial por **referência**; os três valores (client secret, access, refresh) vivem em ficheiro fora do repositório; a rotação reescreve-o e o valor não passa pelo conector (FR-050). |

Sem violações a justificar; `Complexity Tracking` fica vazio.

## As cinco decisões deste plano

### D1 — A linguagem deste plugin é **Python**, e a razão é a costura

O conector 1 é **TypeScript** porque o SDK oficial do venue dele é TypeScript. Aqui os factos apontam para o
outro lado, e não é por gosto:

- a Open API do cTrader é **agnóstica de linguagem** (JSON ou Protobuf sobre TCP/TLS) e os SDKs **oficiais** são
  **C# e Python** (Spotware: `OpenAPI.Net`, `OpenApiPy`) [F];
- a camada de protocolo que vamos adoptar é **Python** [F/E];
- o host tem **Python 3.14.7** e `uv` [E, medido];
- **a fronteira é mensagem**, não função: o contrato já tem a ligação em Python, e o resto da casa não sabe — nem
  deve saber — em que língua o plugin fala.

**Alternativas consideradas**: (a) reescrever a sessão em TypeScript — trabalho a sério (protobuf, OAuth,
reconexão) para ganhar zero; (b) o SDK oficial **C#** — exige .NET no host e não traz a sonda que a biblioteca já
tem; (c) o SDK oficial **`OpenApiPy`** em vez da biblioteca — mais autoridade, **sem** a sonda de símbolos e a
reconexão prontas; fica declarado como alternativa caso a biblioteca se revele insuficiente em demonstração.

### D2 — A biblioteca é **camada de protocolo**; a fronteira continua nossa

O que entra: transporte (TCP/TLS, protobuf), sessão, heartbeat, reconexão com restauro de subscrições, OAuth com
refresh, e a **sonda de símbolos**. O que **fica nosso**, porque é a fronteira do contrato: o processo e a costura
de mensagem; os **oito portões** de arranque (+ os três deste venue); o **manifesto** (as capacidades declaradas,
incluindo o que o venue **não** suporta); as **duas metades da boleta** (o core manda % do saldo e alavancagem, a
biblioteca quer `volume` em 0,01); a **resolução**; a **marca de posse**; o **desfecho classificado**; e a
**recusa no vocabulário do contrato**.

Na prática: a biblioteca fica **dentro** de `brokers/ctrader/` (um módulo de transporte), e nenhum módulo da
fronteira importa tipos dela — o que atravessa a fronteira são dados do contrato. Versão fixada e licença
verificada (FR-072): MIT, pela API do GitHub, com o parecer datado.

**Alternativas consideradas**: vendá-la no repositório (não: 0.11.0 pre-1.0, autor único, 0 issues — fixa-se, não
se copia); escrever o transporte de raiz (não: reimplementar protobuf e reconexão sem ganho de conformidade).

### D3 — As **duas camadas** são dois estados separados, e o token é um acontecimento

O venue tem transporte vivo e sessão da conta como coisas distintas, e o conector **envia só quando as duas estão
prontas** (FR-048, SC-016). A rotação do token é acontecimento da máquina (`token_rodou`): suspende ordens novas,
re-autentica, e a re-autenticação **lê a conta antes** de aceitar pedido (FR-070). O ficheiro de tokens é do dono:
o conector relê-o, o venue reescreve-o, e o valor **nunca** entra em estado, log ou mensagem (FR-050).

É o que este recorte tem de mais próprio: a primeira credencial que **muda sozinha** a meio da corrida.

### D4 — A bateria de conformidade é bancada própria, e tem quatro provas que não existiam

As **oito** provas da casa, mais: (a) **as duas camadas** — sessão derrubada com transporte vivo, zero envios;
(b) **a identidade recusada** — ficheiro da conta apontado a outro `ctidTraderAccountId`; (c) **o fecho por
posição** — três aberturas e fechos, zero posições no fim, três fechos no histórico, e fechar o que não existe
**não** abre nada; (d) **a marca reenviada** — a mesma marca duas vezes, uma ordem e uma posição.

A bateria separa o que **precisa de rede** do que não precisa: a bancada offline corre sempre (casos em dado com
os payloads do venue gravados); a de demonstração corre quando há tokens. Resultado por versão, em `conformidade/`,
sem reescrever resultados anteriores (FR-073).

### D5 — A credencial entra por referência; e o `equity` é declaradamente nosso

Duas honestidades que este venue obriga:

1. **Credencial** — três valores (client secret, access token, refresh token), todos **referências** a ficheiro
   fora do repositório; a rotação reescreve-o, o conector relê-o, nenhum valor aparece em registo (FR-050).
2. **Equity** — a conta **não publica** equity (o campo existe só no registo de operações de saldo). A leitura
   publica-o como **derivado** (saldo + resultado não realizado) e **di-lo**; a fórmula fica declarada no
   `data-model.md` e confirmada em demonstração **antes** de o campo servir para dimensionar.

## Pedido ao sysadmin (fora do meu âmbito)

**Nada a pedir, e digo porquê**: o conector é um **processo filho** da camada de operação (como o conector 1), não
um serviço do sistema; o runtime que ele precisa (**Python 3.12+** e `uv`) **já está medido neste host** (3.14.7).
O ambiente Python do plugin nasce **dentro de `brokers/ctrader/`** (`.venv`, ignorado pelo git). Se em demonstração
se revelar preciso correr a bateria por temporizador (tarefa periódica), aí há pedido — e será feito com o comando
exacto, a verificação e a reversão.

## Project Structure

### Documentation (this feature)

```text
specs/005-conector-ctrader/
├── spec.md            ← 7 histórias, FR-045..073, SC-013..018
├── plan.md            ← este documento (as cinco decisões)
├── research.md        ← as perguntas abertas do venue, com decisão e alternativas
├── data-model.md      ← manifesto, boleta, resolução, desfecho, leitura: campo a campo e a ORIGEM de cada número
├── quickstart.md      ← correr a bancada offline e a bateria de demonstração, e onde ler o resultado
├── checklists/requirements.md
└── relatorios/        ← linha de base e resultados da bateria, por versão
```

### Onde o código toca

```text
brokers/ctrader/
├── README.md              ← o que este conector entrega, e o que não
├── .gitignore             ← manifesto do runtime, .venv e conformidade/ fora do versionamento
├── processo.py            ← a costura: uma mensagem JSON por linha (espelho de brokers/hyperliquid/processo.ts)
├── transporte.py          ← a biblioteca (D2): sessão, protobuf, OAuth, reconexão — embrulhada, não espalhada
├── sonda.py               ← símbolos (com deslistados) + conta → o manifesto
├── identidade.py          ← ctidTraderAccountId contra o ficheiro da conta; accessRights (FR-047/049)
├── credencial.py          ← referências a ficheiro; leitura do par de tokens; nunca o valor (FR-050)
├── leitura.py             ← conta (moneyDigits), posições, ordens vivas; o equity DERIVADO (FR-052)
├── ordens.py              ← a boleta: volume em 0,01, relativos em 1/100000, recusas nomeadas (FR-055..060)
├── desfecho.py            ← executionType/orderStatus/deal/positionId, classificado (FR-063/064)
├── fecho.py               ← fecho por posição (FR-065) + os dois modos CLOSE_ONLY (FR-066)
├── casos/                 ← casos em dado (os mesmos para o dublê e para o conector)
└── conformidade/          ← relatórios da bateria (fora do git)
```

**Structure Decision**: `brokers/ctrader/` como **espelho** de `brokers/hyperliquid/` — mesmo desenho de módulos,
mesma costura, mesmas bancadas — para que a prova de neutralidade seja **estrutural** e não só de contrato. O que
**não** se toca: `contracts/` (SC-015 proíbe crescimento por causa deste venue), `brokers/hyperliquid/`, a mesa e o
setup.

## Complexity Tracking

Vazio: nenhuma violação da constituição a justificar, nenhuma excepção pedida.

## Progress

- [x] Regra de negócio do venue (`docs/regra-de-negocio-ctrader.md`, família `RN-CT*`)
- [x] Máquina de estados do conector (`docs/maquina-de-estados-conector-ctrader.md`)
- [x] Spec (`spec.md`) + checklist de qualidade
- [x] Plano (este documento)
- [ ] Research consolidado, `data-model.md`, `quickstart.md`
- [ ] Tarefas (`tasks.md`)
- [ ] Implementação — **bloqueada** por: app registada na cTrader Open API e tokens OAuth de demonstração (dono)
