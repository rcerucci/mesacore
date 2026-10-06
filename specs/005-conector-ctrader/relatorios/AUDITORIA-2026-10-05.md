# Auditoria independente — o plugin do cTrader (`brokers/ctrader/`)

Medida em **05/10/2026** (hora local do host do dono) · sobre o `HEAD` **87bf3a6** · por uma **sessão nova** do
perfil `appbuilder` — que não é a que escreveu o código, mas é a mesma máquina, o mesmo perfil e as mesmas
ferramentas: o limite dessa independência está declarado em §6, e não se esconde.

**O critério.** O estado declarado (o `README.md` do conector, o `tasks.md`, o `ONDE_ESTAMOS.md`, a
`linha-de-base.txt`) **não é prova**: esta casa já mediu que títulos e números escritos à mão envelhecem e passam
a mentir. Cada linha abaixo tem o **comando** e a **saída crua** ao lado. O que não se mediu diz-se **não medido**.

**O número que resume:** a bancada offline do conector passa **63 de 63** — e **não está no portão da casa**.

---

## 1. As medidas de topo

| O que | Comando | Saída (05/10/2026) |
|---|---|---|
| A bancada offline do conector | `uv run python casos/correr.py` (em `brokers/ctrader/`) | `ctrader: 63 casos · 63 ok · 0 divergentes` |
| **O conector está no portão?** | `grep -c ctrader tools/verificar-maquina/provar.sh` | **`0`** — a porta declara **52** verificações, **nenhuma** do ctrader |
| Tarefas do recorte 005 | `grep -c '^- \[x\]'` / `'^- \[ \]'` em `specs/005-.../tasks.md` | **13** feitas · **39** abertas |
| O contrato cresceu por causa deste venue? | `git show --stat` dos 9 commits do ctrader | **0** ficheiros em `contracts/` (SC-015 medido) |
| O arranque recusa com a costura limpa? | 3 corridas de `processo.py` (abaixo) | **rc=2 · 0 linhas no stdout** nas três |

O `provar.sh` declara 52 verificações e cobre, do lado dos conectores: o `hyperliquid` offline, o manifesto a
quente, o envio (41 casos), as ordens (53 casos), o feed (16 provas), a porta do contrato, o dublê de mesa, a
fronteira e o inventário. **Do ctrader, nenhuma.**

---

## 2. A lista de aceite da fatia, item a item

Formato: `ID | veredicto | a prova | o que falta`.

### Arranque (US1 · SC-013 · FR-045..FR-051, FR-072)

| ID | Veredicto | A prova (comando + saída) | O que falta |
|---|---|---|---|
| `FR-072` versão fixada | **FECHADO** | `pyproject.toml`: `ctrader-api-client==0.11.0`; `uv.lock` presente; parecer datado em `docs/AVALIACAO-BIBLIOTECA-CTRADER.md` | — |
| `FR-050`/`FR-023` credencial por referência | **FECHADO** | porta `chave` passa e diz os **caminhos**, nunca os valores: `client_id:ficheiro:/…/client_id.key, …` —e nenhum valor em estado/log | — |
| `FR-047` os 8 portões + os 3 deste venue | **PARCIAL** | portas `1-5` **passam** numa ficha completa (`ficha, versao_do_contrato, uma_conta, ambiente_e_rede, chave`); a `6 ligacao` **tenta o venue a sério** e falha com `sem_ligacao`; a `7 sonda_e_manifesto` é **inalcançável por construção** (achado **A-1**); a `8 identidade` não foi alcançada | fechar A-1; a 6 e a 8 só com a app registada + OAuth |
| `FR-048` enviar exige as duas camadas | **FECHADO no arranque** | `_abrir_ligacao` (`processo.py:324`) exige `abrir()` **e** `autorizar_conta()` — a porta só passa com as duas | não há envio onde a regra volte a morder (A-1) |
| `FR-049` identidade da conta | **implementado, sem caso em dado** | `identidade.py` compara o `ctidTraderAccountId` do venue com o da ficha e diz os dois ids (`identidade_da_conta_divergente`) | o caso em dado é o **T015**, aberto — hoje a prova é execução directa |
| `FR-045` arrancado pela camada de operação | **ABERTO (do outro lado da mesa)** | `grep -rn ctrader vigia/ core/` → **0**; `vigia/operador.ts:675-680` fixa `brokers/hyperliquid/processo.ts` e importa `../brokers/hyperliquid/cloid.ts` | nada arranca este conector (achado **A-4**) |

### A boleta e as recusas (US2 · FR-055..FR-060, FR-066)

| ID | Veredicto | A prova | O que falta |
|---|---|---|---|
| `FR-055..060` tradução + recusas nomeadas | **FECHADO offline** | 63 casos, entre eles `volume-fora-do-passo`, `volume-abaixo-do-minimo`, `volume-acima-do-maximo`, `stop-abaixo-da-distancia-minima`, `desvio-pedido-em-MARKET-recusa-e-o-tipo-nao-se-troca`, `reduce-only-pedido-recusa-o-venue-nao-o-tem`, `reducao-parcial-este-venue-nao-a-sabe-fazer-recusa` | nada: é aqui que a ponta está mais sólida |
| `FR-066` CLOSE_ONLY (conta e símbolo) | **FECHADO offline** | `fecho/conta-CLOSE_ONLY-recusa-a-abertura-e-o-fecho-continua-a-passar` · `fecho/simbolo-CLOSE_ONLY_MODE-…` | o caso em conta real é do dono (bloqueio 2 do `tasks.md`) |

### O desfecho e o fecho (US3/US4 · FR-061..FR-065)

| ID | Veredicto | A prova | O que falta |
|---|---|---|---|
| `FR-063` as 4 classificações + acontecimentos de conta | **FECHADO offline** | `desfecho.casos.json` + `desfecho.py` (módulo puro, `SWAP`/depósito/bónus separados) | — |
| `FR-064` números lidos, `positionId` | **FECHADO offline** | o desfecho **transporta** o que o venue deu; nada recalculado (`desfecho.py` §FR-064) | prova contra o venue (exige envio) |
| `FR-062` resolução escrita **antes** do envio | **PARCIAL, e dito** | `ordens.py` devolve os cinco campos só quando o venue já deu os números; sem eles o contrato recusa por `campo_obrigatorio_ausente` — e o corredor exige **essa** recusa | depende de A-1 |
| `FR-065` fecho por posição | **FECHADO offline** | `fecho/posicao-viva-fecha-por-positionId-com-o-lado-oposto` · `fecho/sem-posicao-no-instrumento-e-nada-sem-ordem` | — |
| `SC-017` três ciclos → zero posições | **NÃO COBERTO** | não existe caso de sequência em `fecho.casos.json` (os casos são de uma decisão cada) | o caso (T039) |

### O silêncio, a reconciliação e a rotação (US5/US6 · FR-067..FR-071)

| ID | Veredicto | A prova | O que falta |
|---|---|---|---|
| `FR-067` silêncio → `desconhecido` | **FECHADO** | `desfecho_do_silencio` (`desfecho.py:102` `CLASSIFICACAO_DO_SILENCIO = "desconhecido"`), com caso `via: silencio` | — |
| `FR-068` `desconhecido_por_reconciliar` | **VIVO — 0 no código** | `grep -rn desconhecido_por_reconciliar` → **3 acertos, todos em documentos** (`docs/maquina-de-estados-conector-ctrader.md:63`, `spec.md:151`, `tasks.md:82`); **0** em `brokers/ctrader/` | não há estado por instrumento (`grep` de `pendente/por_instrumento` no `processo.py` → **0**): **A-3** |
| `FR-069` reconciliação por leitura | **VIVO — não existe** | `desfecho.py` declara-o por escrito: «Nao decide risco, nao reenvia, **nao reconcilia**, nao le' a conta: CLASSIFICA» | o leitor que relê a conta (T042): **A-3** |
| `FR-070` a rotação derruba a sessão | **VIVO — não existe** | `grep -n "TokenInvalidated\|Disconnect"` no conector → **0**; o único evento registado é `DepthEvent` (`sonda.py:364`). A biblioteca **encaminha** o evento (`ctrader_api_client/events/router.py:117` `ProtoOAAccountsTokenInvalidatedEvent`) — e ninguém o escuta | o tratador da sessão `invalidada` + a releitura antes de operar: **A-3** |
| `FR-071` ritmo 50/s e 5/s | **VIVO — 0 código** | nenhum limitador no conector; a biblioteca também não limita (só tem a *excepção* em `exceptions.py`) | o ritmo declarado (T044). Esta casa já pagou 253×`429` no outro venue: **A-5** |

### Conformidade e neutralidade (US7 · SC-014, SC-015, SC-016, SC-018)

| ID | Veredicto | A prova | O que falta |
|---|---|---|---|
| `SC-015`/`FR-046` o contrato não cresce | **FECHADO por medição** | os 9 commits do ctrader (`d1f0724 … 0335e10`) tocam **0** ficheiros em `contracts/`; `grep -i ctrader\|ctidTrader\|moneyDigits` em `contracts/` → **0** | — (a emenda 1.10.0, que tocou 19 ficheiros, foi do **flip ao vivo** do outro venue — o ctrader só teve de *responder* a ela) |
| `SC-014`/`FR-073` bateria das 12 provas | **ABERTO — não existe** | `brokers/ctrader/conformidade/` **não existe** (e o `.gitignore` ignora `conformidade/`) | bloqueio do dono: OAuth (abaixo) |
| `SC-013` portões com prova escrita | **PARCIAL** | ver `FR-047`; as recusas existem, mas **sem caso em dado** no portão (T015) | T015 |
| `SC-016` zero envios com a sessão caída | **NÃO MEDIDO** | sem envio (A-1) e sem sessão (OAuth) não há o que medir | exige as duas |
| `SC-018` marca repetida → uma ordem | **NÃO MEDIDO, e honestamente declarado** | `sonda.py:220`: `"idempotencia": False,  # a marca existe; a GARANTIA do venue nao esta' medida (bateria)` | exige venue; a declaração não mente |

---

## 3. Os defeitos achados (por ordem de risco)

### A-1 — **O conector, como está, não serve uma única ordem.** (o mais caro, e não está em título nenhum)

A porta `7 sonda_e_manifesto` exige `ficha.desvio_maximo`; a ficha é **fechada** e **não lê** esse campo. Os dois
lados da contradição, medidos por execução:

```
$ uv run python processo.py --ficha <ficha com `desvio_maximo`>
{"porta":"ficha","veredicto":"falhou","motivo":"campo_desconhecido",
 "porque":"… traz `desvio_maximo`, que este conector nao le'…"}                 rc=2 · 0 linhas na costura

$ uv run python processo.py --ficha <a mesma ficha, sem `desvio_maximo`>
… 5 portas `passou` … {"porta":"ligacao","veredicto":"falhou","motivo":"sem_ligacao",
 "porque":"a aplicacao nao autenticou: ExceptionGroup: unhandled errors in a TaskGroup (2 sub-exceptions)"}
```

`ficha.py:30 CAMPOS_LIDOS` não tem `desvio_maximo` → declarar o campo é recusa; não o declarar faz a porta 7
cair em `nao_corrida` e o manifesto **nunca** é publicado. E com `manifesto is None`, o processo real (importado
por caminho absoluto, sem reescrita) responde a uma boleta válida:

```
$ uv run python <sonda>   # importa processo.py e chama _atender_ordem com manifesto=None
{"classificacao":"recusado","motivo":"capacidade_nao_declarada",
 "resposta_do_venue":{"nota":"nenhuma ordem foi enviada",
 "porque":"nao ha manifesto publicado (a porta `sonda_e_manifesto` nao correu)…"}}
```

**Consequência:** a fatia está a meio — o que existe é um conector que **sabe** traduzir, recusar e classificar
(63 casos), e **não consegue arrancar até servir**. **Quem decide:** o desenho (Fase 4, T017–T021 abertas: é a
`sonda.py`+`ficha.py` que têm de fechar de comum acordo). **Comando que o fecha:** acrescentar `desvio_maximo` a
`CAMPOS_LIDOS` e ao modelo, e um caso em dado para o manifesto publicado.

### A-2 — **A bancada do ctrader está fora do portão da casa.**

`grep -c ctrader tools/verificar-maquina/provar.sh` → **0**. E o `ordens.py` é, palavra da própria casa, «o único
sítio onde uma redução parcial se vira em número» — a mesma razão pela qual o `provar.sh` já tinha puxado o
`correr-ordens.ts` do outro venue para dentro («um caminho que mexe em dinheiro fora do portão é um caminho que
pode regredir sem ninguém dar por isso», escrito no próprio `provar.sh:106-110`). **Quem decide:** o desenho.
**Custo de fechar:** uma linha (`declarar "ctrader: a boleta e o fecho (63 casos)" bash -c "cd brokers/ctrader &&
uv run python casos/correr.py"`), mais o mesmo para o caminho Python não pagar duas vezes o `uv`.

### A-3 — **A máquina de estados declarada não tem leitor.**

`docs/maquina-de-estados-conector-ctrader.md` declara **quatro eixos** — transporte, sessão da conta, ordem em
curso (por instrumento) e reconciliação (por instrumento). Medido no código: **nenhum** estado por instrumento
(`grep pendente|em_curso|por_instrumento` no `processo.py` → 0), **nenhuma** reconciliação por leitura
(o `desfecho.py` di-lo por escrito), **nenhum** tratador dos eventos de sessão (`TokenInvalidatedEvent`,
`AccountDisconnectEvent` — a biblioteca encaminha-os e o conector não os escuta). O que **existe** é a
classificação de um evento isolado, que é o que os 63 casos cobrem. **Quem decide:** o desenho (T040–T043).
**Risco:** quando a mão abrir, é esta ausência que deixa uma ordem `desconhecida` não travar a seguinte — a
classe que o `D-009` do outro venue fechou com prova.

### A-4 — **Nada arranca este conector.** (do outro lado da mesa, mas é o que impede a corrida)

`vigia/operador.ts` fixa o comando do conector no código e importa um módulo **do hyperliquid** (`cloid.ts`); o
`provar.sh` não menciona ctrader; `core/` não menciona ctrader. O painel, no entanto, **oferece** o ctrader na
criação de conta (`web/painel/vivo.json` e `brokers/ctrader/questionario.json`), o que faz a superfície
prometer o que a camada de operação não entrega. A `spec.md` declara o outro lado como «recorte próprio» — logo
não é defeito *do plugin*: é a **dependência** que hoje o impede de correr, e leva-se ao dono como tal.

### A-5 — **Sem ritmo.** FR-071 não tem código (o conector não limita; a biblioteca também não). O outro venue
desta casa já levou **253× `429`** em menos de dois minutos por bater à porta no relógio da volta.

### A-6 — **Documentos e restos que fazem a próxima auditoria repetir-se.**

- `tasks.md` (bloco «Estado», 01/10) diz «fase 2 feita» e marca **Fases 5–7 abertas** — mas `leitura.py`,
  `ordens.py`, `fecho.py`, `desfecho.py` e `sonda.py` existem e passam **63 casos**. O documento **subestima** o
  código (e a contagem 13/52 repete-se no `ONDE_ESTAMOS.md`).
- `relatorios/linha-de-base.txt` (01/10) diz que as portas `6, 7 e 8` são `nao_corrida` por
  `conferencia_por_escrever`. Hoje a **6 constrói o transporte e autentica a sério** (medido) — o retrato
  envelheceu.
- `processo.py:1528` declara `--casos` e **nunca o lê** (a costura não tem bancada: não existe
  `casos/processo.casos.json`, ao contrário do outro conector, que tem 41 casos de envio).
- `transporte.py:247 subscrever_spots` existe e **ninguém o chama** (0 chamadores) — daí a leitura de mercado
  cair na última vela fechada, como o próprio módulo declara.
- A porta `6 ligacao` devolve como diagnóstico um `ExceptionGroup: unhandled errors in a TaskGroup (2
  sub-exceptions)` — não nomeia **qual** das duas camadas falhou nem a causa. A casa recusa texto de terceiros a
  passar por motivo nosso; aqui é o oposto: um motivo nosso que não diz nada.

---

## 4. As duas listas

**Fechado com prova (o que era · o sintoma medido · o conserto):** `FR-072` (versão fixada) · `FR-050`
(credencial por referência, 4 ficheiros, nada em log) · `FR-055..060` e `FR-066` (a boleta e as recusas — 63
casos) · `FR-063`/`FR-064` (o desfecho classificado e lido) · `FR-065` (fecho por posição) · `FR-067` (o silêncio
é estado) · `SC-015`/`FR-046` (o contrato não cresceu: 0 ficheiros em `contracts/`).

**Aberto — cada um com quem decide e o comando que o fecha:**

| # | Aberto | Quem decide | O comando/prova que o fecha |
|---|---|---|---|
| A-1 | a porta 7 inalcançável → nenhuma ordem pode ser servida | desenho (T017–T021) | `desvio_maximo` lido pela ficha + manifesto publicado em caso |
| A-2 | a bancada fora do portão | desenho (T048) | uma linha no `provar.sh` |
| A-3 | estado por instrumento, `desconhecido_por_reconciliar`, reconciliação, rotação do token | desenho (T040–T043, FR-068/069/070) | um caso por regra, com o par de controle |
| A-4 | nada arranca o conector | dono / o outro recorte (a camada de operação) | despacho por venue no operador, ou o recorte que o declara |
| A-5 | ritmo 50/s e 5/s | desenho (T044, FR-071) | o limitador com a espera **declarada** |
| A-6 | `tasks.md`, `linha-de-base.txt`, `--casos`, `subscrever_spots`, o envelope opaco da porta 6 | desenho (barato) | nota datada com o texto antigo por baixo; a chave/flags mortas saem ou ganham leitor |

---

## 5. Árvore e estado no instante desta auditoria

```
$ git status --short
 M fichas/sigma/BTC-hl-teste-plugin.json      (ficha VIVA da observação: relogio 30m→1m, prazo 5000→500 ms, `enviar: true`)
 M fichas/sigma/ETH-hl-teste-plugin.json
```

Duas fichas sujas, **nenhuma do ctrader** — e a do BTC está **armada ao venue** (`enviar: true`). Não são
minhas e não se toca nelas: quem decide se a árvore fica limpa é quem trabalha nela. O `HEAD` é `87bf3a6`; nada
desta auditoria foi commitado.

---

## 6. O que **não** foi medido (declarado, e não arredondado)

1. **Nada contra o venue.** Os dois `.key` de token **não existem** (`~/.config/mesacore/credenciais/` só tem
   `ctrader_mesa_client_id.key` e `ctrader_mesa_client_secret.key`): a app está registada, o **OAuth não foi
   autorizado**. Logo `SC-014`, `SC-016`, `SC-017` e `SC-018` ficam por medir, e a bateria das 12 provas não
   existe. *(E o bloqueio é o declarado no `tasks.md` «Bloqueios» 1 e 2.)*
2. **O embrulho do transporte.** A corrida com credenciais falsas **chegou** ao endereço do venue e falhou; isso
   prova que o fio se tenta abrir a sério, **não** que o embrulho esteja certo — a autenticação válida é do dono.
3. **A independência desta auditoria tem limite:** mesma máquina, mesmo perfil, mesmas ferramentas de quem
   escreveu. As 63 provas offline **não têm contraprova externa** (uma segunda implementação escrita da
   especificação, como a casa exige para um *golden*): o que aqui se mede é o que o **próprio módulo** diz de
   si. Sem a bateria contra o venue, a metade que *só o venue* prova fica em falta — e é a metade que importa.

---

*O que eu proporia fechar primeiro, e por esta ordem:* **A-1** (é o que separa «existe» de «arranca»), **A-2**
(uma linha, e é o caminho do dinheiro), **A-3** (a classe que já custou dinheiro no outro venue), **A-6** (barato
e evita a repetição), **A-5**, e **A-4** na mão do dono.

---

# ADENDA — 05/10/2026, mais tarde: a PRIMEIRA corrida a sério (credenciais reais)

O dono correu o `tools/ctrader-autorizar.py` criado nesta vaga e **autorizou o OAuth**: os quatro valores ficaram
gravados (`~/.config/mesacore/credenciais/ctrader_mesa_*.key`, modo 600). A partir daí o conector pôde, **pela
primeira vez**, falar com o venue com credenciais válidas — e o que estava atrás das portas apareceu. Nada disto
era visível com credenciais falsas: a porta 6 falhava sempre, e **o código por trás dela nunca tinha corrido**.

## Fechado com prova (nesta adenda)

| # | O defeito | A prova (antes → depois) | O conserto |
|---|---|---|---|
| **A-7** | `transporte.abrir()` autenticava a **APLICAÇÃO DUAS VEZES** na mesma ligação: o `__aenter__` do cliente já a autentica (o *maintainer* da biblioteca chama `authenticate_app()` no `prepare()` — `auth/_maintain.py:118`) e o embrulho repetia a chamada. O venue recusa a segunda: `ALREADY_LOGGED_IN - Open API application is already authorized` → **a porta `ligacao` nunca passava** | sonda que importa o embrulho real e conta as chamadas: **2 chamadas · `ok=False` · `ALREADY_LOGGED_IN`** → **1 chamada · `ok=True`** | `brokers/ctrader/transporte.py`: a chamada repetida saiu (com o porquê escrito) |
| **A-7b** | `_abrir_ligacao()` construía o `Transporte` e **não o devolvia**; o `assert transporte is not None` a seguir rebentava **sempre** que a porta 6 passasse | `processo.py` linha 262: `AssertionError` (a 1ª corrida a sério) → hoje o arranque segue até à porta 8 | `processo.py`: a função devolve o transporte e o `assert` passou a **recusa nomeada** (`sem_ligacao`), porque rebentar não é dizer |
| **A-7c** | `--so-contas` (só listar) voltava a pedir confirmação para **gravar** os quatro valores → `EOFError` num terminal sem `stdin` | `Traceback … EOFError` → hoje lista e sai com `rc=0` | `tools/ctrader-autorizar.py`: com `--so-contas` não se grava nada |

Depois disto, a bancada offline continua **63 de 63 · 0 divergentes**, e a listagem de contas correu.

## A lista de contas deste cTID (medida contra o venue, 05/10/2026)

| `ctidTraderAccountId` | Ambiente | login | corretora |
|---|---|---|---|
| 512323 | **REAL** | 8110664 | FxPro |
| 2552764 | **REAL** | 2010766 | IC Markets |
| 43633753 | **REAL** | 2010766 | icmarketsau |
| **45292558** | **DEMONSTRAÇÃO** | 5150941 | Pepperstone |

A ficha do ensaio nomeia o `ctid_trader_account_id` **45292558** (a de demonstração).

## O que o arranque dá agora (ficha apontada à 45292558, medido 2×)

```
portas 1-5  passou
porta  6    passou   as DUAS camadas prontas (FR-048) — a primeira vez que esta porta passa
porta  7    nao_corrida  conferencia_por_escrever  <- A-1 (o manifesto nunca é publicado)
porta  8    FALHOU   falha_ao_ler_as_contas: TokenExpiredError: Token refused by the server
```

## Abertos NOVOS (medidos nesta corrida)

| # | O defeito | A prova | Quem decide / o que o fecha |
|---|---|---|---|
| **A-8** | A porta 8 lê as contas com `credencial.access_token` (`processo.py:396`) — a cópia lida na porta 5 — e a porta 6 **já rodou o par**: o `establish()` refrescou e reescreveu os `.key` (mtime dos dois tokens: 10:08:02 e 10:08:31, um por corrida), e o token em memória ficou **morto**. A porta 8 recusa um token que é bom — duas cópias do mesmo número, uma a morrer por baixo da outra | as duas corridas dão exactamente `Token refused by the server`; os `.key` mudam de mtime a cada corrida | desenho: a porta 8 (e quem lista) têm de usar o token **que o transporte tem**, não a cópia da porta 5 |
| **A-9** | O `GuardaDeTokens` **nunca recebe o `expira_em`** — `_caminhos_da_credencial` só mapeia o que a ficha declara (os 4) — logo `prazo_declarado()` é **0.0 para sempre** e a biblioteca trata o token como expirado e **refresca (e roda) em cada ligação**. Uma rotação por arranque, e é ela que faz o A-8 disparar sempre | medido: 1 rotação por corrida (2 corridas → 2 mtimes novos) | desenho: persistir o prazo declarado (um 5º caminho, não-segredo) **ou** decidir que o refresh por arranque é o que se quer — mas então o A-8 tem de estar fechado |

**Nada disto muda o estado do A-1**: o conector continua a não publicar manifesto e por isso **não serve uma única
ordem** (a sonda com `manifesto=None` desta auditoria continua a valer). A diferença é que agora se sabe **onde**
mais ele está partido, e que o caminho até ao venue funciona (autenticação nas duas camadas, listagem de contas).

**Árvore:** o `tools/ctrader-autorizar.py` é novo (`??`), o `specs/005-.../relatorios/AUDITORIA-2026-10-05.md` é
novo (`??`), e estão alterados `brokers/ctrader/transporte.py` e `brokers/ctrader/processo.py`. Nada commitado.
As duas fichas vivas do σ continuam sujas, e não são desta vaga.

---

# ADENDA 2 — 05/10/2026: os passos 1 a 3, cada um com auditoria de quem não o escreveu

Regra desta série: **cada passo é feito por uma sessão nova, e o auditor (esta sessão) corre as provas dele
outra vez antes de o dar por fechado.** O que está abaixo é a medição do auditor, não o relatório de quem
executou.

## Passo 1 — A-8 + A-9 (o *refresh* automático) — FECHADO

| Verificação do auditor | Resultado |
|---|---|
| Duas corridas seguidas com a ficha da demo | 1-6 `passou` · 7 `nao_corrida` · **8 `passou`** · `rc=0` nas duas |
| O par roda na 2.ª corrida? | **Não** — mtime dos dois tokens e do `expira_em` idêntico (10:20:08) |
| Bancada offline | `63 · 63 ok · 0 divergentes` |
| Bancada do prazo + controle (`--antigo`) | 5/5 verde → **3 divergentes, rc=1**, a nomear os casos |

O `expira_em` passa a viver ao lado dos outros (`ctrader_mesa_expira_em.key`, ESTADO e não segredo, modo 600 —
nota datada no `config/README.md` e no `brokers/ctrader/README.md`), e a porta 8 passou a usar
`transporte.token_actual()` com recusa nomeada `sem_token_vivo`.

## Passo 2 — A-1 (o manifesto) — FECHADO

| Verificação do auditor | Resultado |
|---|---|
| `--sonda` | `rc=0` · **1 linha** no `stdout` = o manifesto, **aceite pelo contrato**; `desvio_maximo 0.5`; `EURUSD` com mínimo/passo/tick/alavancagem **lidos do venue** |
| Arranque completo | `rc=0` · **8 de 8 portas `passou`** (a 7 pela primeira vez de sempre) |
| Instrumento inexistente no mandato | `instrumento_desconhecido_no_manifesto`, a **nomear** o nome e o universo (1941 nomes distintos) |
| Bancada offline | `71 · 71 ok · 0 divergentes` (63 + 8 casos do campo novo da ficha, com par de controle) |
| `contracts/` | **0 alterações** (SC-015 segue medido) |

A ficha ganhou `desvio_maximo` na lista dos campos que **se leem** (continua fechada: forma má é recusa
nomeada), e o `tipo_de_conta` deixou de sair como enum cru (`AccountType.HEDGED` → `"HEDGED"`).

## Passo 3 — A-10 (o manifesto na costura, em modo de serviço) — FECHADO

Achado **novo**, do passo 2: o manifesto só era publicado com `--sonda`, quando o US1 cenário 1 exige que seja
**no arranque da camada de operação** — e o conector 1 publica-o (`brokers/hyperliquid/processo.ts:817`).

| Verificação do auditor | Resultado |
|---|---|
| Modo de serviço, sem `--sonda` | `rc=0` · `stdout` com **exactamente 1 linha**, e é o manifesto (`tipo=manifesto`, `id=ctrader_mesa/manifesto`) · 8 portas `passou` |
| `--manifesto-em <ficheiro>` | ficheiro com 1 linha **idêntica** à do `stdout` (`diff` vazio) |
| `--sonda` | inalterado (1 linha) |
| Bancada offline | `71 · 71 ok · 0 divergentes` · `contracts/` limpo |

O caminho é um só (`publicar_o_manifesto` → `linha_do_contrato` → `framing.validar`): **a linha só sai se o
contrato a aceitar**, e se ele a recusar o arranque não serve (`manifesto_nao_publicado`, rc=2).

## O que continua aberto, e o passo seguinte de cada um

| # | Aberto | Próximo a fazer |
|---|---|---|
| — | **O verbo de envio** do transporte (`colocar_ordem`/`fechar_posicao`) | **passo 4**: implementar + provar offline com duplo; o envio a sério continua a ser decisão do dono |
| A-3 | estado por instrumento, `desconhecido_por_reconciliar`, reconciliação por leitura, rotação de sessão | passo 5 |
| A-5 / mercado | ritmo (50/s, 5/s) e a leitura do último retrato (spots subscritos e não lidos) | passo 6 |
| A-2 / SC-014 | a bancada offline no `provar.sh` e a bateria das 12 provas contra demonstração | passo 7 |
| A-4 | **nada arranca este conector** (o operador fixa o `hyperliquid`) | dono / o outro recorte |
| A-6 | `tasks.md` e a `linha-de-base.txt` atrás do código; `--casos` e `subscrever_spots` sem leitor | barato, a arrumar numa vaga de documento |

---

# ADENDA 3 — 05/10/2026: os passos 4 e 5

## Passo 4 — o verbo de envio — FECHADO

O `transporte.py` ganhou `colocar_ordem`/`fechar_posicao`; a boleta deixa de cair em `capacidade_nao_declarada`.

| Verificação do auditor | Resultado |
|---|---|
| `casos/prova-envio.py` | **9 provas · 9 ok** — as cinco classificações (`aceite`, `recusado`, `parcial`, `desconhecido`, e a negativa) com `"contrato": "aceite"` em cada |
| Asserção de não-ligação (impressa) | `abrir_chamado: 0 · build_graph_chamado: 0 · connect_de_socket_chamado: 0` |
| A alegação sobre a biblioteca | **confere**: `execution_event_from_proto` acha-ta o evento e perde `order`/`position`/`deal` — usar o `protocol` com os **modelos** de pedido da biblioteca está justificado e escrito |
| `ClosePositionRequest` | tem **só** `position_id` + `volume` (a marca e o lado não viajam no fecho por posição) — a tabela chave-a-chave confere |
| O ramo `ProtoOAOrderErrorEvent` | estava implementado e nenhum caso o corria; **exercitei-o eu** → `ORDER_REJECTED` com `TRADING_BAD_VOLUME` intacto |
| Bancada + contrato | `71 · 71 ok` · `contracts/` limpo |

## Passo 5 — A-12 (o `desconhecido` com alavancagem real) + a cobertura do A-11 — FECHADO

**A-12 era um buraco no caminho do dinheiro, achado pela auditoria do passo 4:** a resolução pré-envio só ficava
completa com alavancagem 1, e com a alavancagem **real** da conta (30) uma ordem silenciosa **não produzia linha
nenhuma** — a mesa nunca sabia que a ordem ficou em dúvida (FR-067). Fechado com a regra que o irmão já tinha
(`precoDeLiquidacaoProjectado`, `conector.ts:302`), declarada [C].

| Verificação do auditor | Resultado |
|---|---|
| A sonda do auditor, alavancagem 1 e 30 (caminho real) | 1 → `desconhecido` completo; **30 → `desconhecido` completo, `preco_de_liquidacao: "1.2"`** (antes: nenhuma linha) |
| Paridade Python ↔ TypeScript | **medida por mim**, 9 inputs (3 meus, fora da tabela dele): `IGUAIS? True` |
| `casos/prova-envio.py` | **11 provas · 11 ok** (entrou a recusa crua e o controle negativo da projecção) |
| `casos/correr.py` | **73 · 73 ok** · `contracts/` limpo |

**O que continua por medir, e é do dono:** a fórmula da projecção é [C] — foi correlacionada com o **irmão**, não
com o venue (ele não publica este número antes do envio). Fica dito.

---

# ADENDA 4 — 05/10/2026: o passo 6 (US5: estado por instrumento e reconciliação)

| Verificação do auditor | Resultado |
|---|---|
| `casos/prova-envio.py` | **18 provas · 18 ok · rc=0** |
| (a) envio silencioso | `desconhecido` + diag `fr_068_instrumento_pendente` · **1** mensagem ao protocolo |
| (b) ordem nova com pendente | `recusado` · **`motivo: "prazo_excedido"`** · **0** mensagens ao protocolo |
| (c) fecho com pendente | **passa** — a exposição pode sempre desmontar-se |
| (d) reconciliação por leitura | `aceite` (`fonte: reconciliacao_por_leitura`); pendência resolvida, pedido novo passa |
| (e) leitura falhada | **`linha: null`** + diag `indecidivel` — nenhum desfecho inventado |
| (g) reinício sem memória | a mesma referência → `referencia_ja_enviada_ao_venue`, 0 envios (a leitura é que sabe) |
| Bancadas + contrato | `73 · 73` · `contracts/` limpo (a decisão evitou a emenda) |

**A decisão do dono que fechou o FR-068 sem tocar no contrato:** o motivo da recusa é **`prazo_excedido`**, e não
por conveniência — no vocabulário da **mesa** esse motivo já significa exactamente isto
(`core/ciclo/acoes.json#por_motivo.prazo_excedido` → **`parar_e_reconciliar`**, «Desfecho desconhecido: o bilhete
pode ter chegado. Primeiro reconcilia-se.»). Ficou registado com nota datada na máquina de estados, que **deixou
de nomear** `desconhecido_por_reconciliar` como se fosse produzido.

**Abertos desta vaga:** **A-13** — o **fecho** que fica em silêncio não cria pendência (a trava é das aberturas);
**A-14** — a linha 62 da máquina nomeia o `ProtoOAReconcileReq`, e o código reconcilia pelo **registo de ordens**
(`get_orders`) + posições: documento e código têm de concordar (ou um, ou o outro, com nota datada).

---

# ADENDA 5 — 05/10/2026: o passo 7 (A-2 + A-5)

| Verificação do auditor | Resultado |
|---|---|
| `bash tools/verificar-maquina/provar.sh` | **55 de 55 passaram, rc=0** (eram 52) |
| As bancadas do ctrader no portão | `boleta e fecho (73)` · `envio e reconciliacao (18)` · `ritmo do venue (6)` — as três `OK`, com o número no portão |
| `fallbacks (ZERO exigido)` | **OK** — a catraca mordeu o ficheiro da própria bancada nova (6 idiomas `or {}`), foi limpa, e a porta fechou |
| Ritmo (medido por mim) | geral **50 pedidos em 1 s** (intervalo mínimo 0,019999 s; 119 esperas declaradas) · histórico **5 em 1 s** (0,199999 s) · classes independentes · `relogio: real` em produção |
| Espera ≠ «sem dados» | `pedido_que_esperou_servido: true`; o único vazio vem com recusa nomeada (`falha_ao_ler_as_velas`) |
| Prova negativa do ritmo | sem limitador: **surto de 120 em 1 s**, intervalo 0,0 — o caso geral fica **VERMELHO a nomeá-lo** |
| O resto declarado pelo executante | limpou **33 fallbacks** em ficheiros que a instrução dizia para não mexer (32 na bancada do US5, 1 no `processo.py`). **Verifiquei o que importava**: `_texto_de_decimal(0 | 0.00 | 1000 | 1.20 | 0.00001)` → `'0'`, `'0'`, `'1000'`, `'1.2'`, `'0.00001'` — o `or "0"` era mesmo código morto, e a limpeza é equivalente |
| `contracts/` | limpo |

**O limite do ritmo, dito:** os 50/s e 5/s são os que a **doc/spec** declaram (RN-CT2, [F]) — não foram medidos
contra o venue (não se martela o venue para descobrir o limite). O relógio injectado mede segundos simulados; a
produção usa o relógio real.

---

# ADENDA 6 — 05/10/2026: o passo 8 (o eixo da SESSÃO, FR-070, e o FR-048 no envio)

| Verificação do auditor | Resultado |
|---|---|
| `bash tools/verificar-maquina/provar.sh` | **55 de 55, rc=0** |
| As bancadas | `73 · 73` · **`27 · 27`** (eram 18) · `6 · 6` |
| US6 (b) ordem nova com sessão invalidada | `recusado` / **`prazo_excedido`** · **0 mensagens ao protocolo** |
| US6 (c) fecho com sessão invalidada | `recusado` / `prazo_excedido` — **decidido e justificado**: uma sessão caída não serve pedido nenhum |
| **As duas regras não se misturaram** | com **pendência** o fecho continua a **passar** (US5 (c) continua verde); com a **sessão caída** é recusado. No código, `_porta_da_sessao(..., reconciliar_pendencia=True/False)` separa os caminhos |
| US6 (d)/(e) | recuperada → a **leitura da conta vem antes** do envio; com pendência, o desfecho verdadeiro da ordem antiga sai **à frente** da nova |
| US6 (f)/(g) | falta a camada do TRANSPORTE → recusado; controlo → 1 envio |
| Prova negativa | sem a guarda das duas camadas → `aceite` (a ordem **sai**) — é o caso que a mede |
| `contracts/` | limpo (a decisão do dono evitou outra emenda) |

**O que fica por medir:** o **evento real** do venue (a bancada injecta-o; na vida ele só chega numa
rotação/revogação/kick a sério) — os três casos têm tratador ligado (`TokenInvalidatedEvent`,
`ClientDisconnectEvent`, `AccountDisconnectEvent`), mas a tradução proto real é prova ao vivo.

---

# ADENDA 7 — 05/10/2026: o passo 9 (a leitura do mercado)

| Verificação do auditor | Resultado |
|---|---|
| `bash tools/verificar-maquina/provar.sh` | **56 de 56, rc=0** (entrou `ctrader: leitura do mercado (7 provas)`) |
| As bancadas | `73 · 73` · `27 · 27` · `6 · 6` · **`7 · 7`** |
| (a) divisão, antes/depois | `venue_bid: 125000` → `bid: "1.25"` · `ask: "1.25001"` · contrato `aceite` |
| (b) livro por deltas | acrescentar/apagar níveis reflecte-se; apagar um id inexistente não inventa nada |
| (c) um lado só | `bid` presente, **`ask` ausente** (a chave não entra) — nunca zero; e o controlo ao contrário |
| (d) sem retrato | régua **declarada**: `ultimo: "1.09"`, sem bid/ask |
| Idade do dado | sai do `tempo_do_venue_ms` do evento, não do relógio local |
| As duas negativas | divisão errada → `bid: "125"`, caso VERMELHO nomeado; lado ausente a virar zero → caso VERMELHO nomeado |
| A divisão não se aplica duas vezes | conferido no caminho: a biblioteca entrega `Decimal` (`events/router.py:153`), o embrulho re-encoda com `Decimal(str(…))` **exacto**, e a **leitura** divide uma só vez (`_decimal_de_escalado`, aritmética de inteiros). O livro vem **cru** (`DepthQuote.size` é «volume in cents») e quem divide é a leitura |
| `contracts/` | limpo — o executante **parou** em vez de emendar (não há campo para a régua; a linha declara-a pelos campos que traz, e o diagnóstico di-lo por palavras) |

**O que fica por medir:** a **subscrição a sério** (o duplo injecta os eventos) — não se confirmou que o venue
aceita `ProtoOASubscribeSpotsReq`/`…DepthQuotesReq`, e o `_assinar_o_mercado` só corre no arranque de serviço com
`--leitura-a-cada`. E, se o venue omitir o `timestamp` do spot, a biblioteca cai para o **seu** relógio
(`router.py:155`) e a idade medir-se-ia contra um carimbo nosso — declarado [a confirmar em demonstração].

---

# ADENDA 8 — 05/10/2026: o passo 10 (os documentos) e os defeitos que a auditoria achou

| Verificação do auditor | Resultado |
|---|---|
| `bash tools/verificar-maquina/provar.sh` | **56 de 56, rc=0** — corrida por mim **depois** da mudança de código deste passo (o `--casos` saiu) |
| `contracts/` | limpo |
| `tasks.md` (contado por mim) | **44 `[x]`** · **8 `[ ]` por medir** · 52 — bate com o que o relatório diz; cada `[x]` traz a bancada e o número ao lado |
| As 8 por medir | têm nome de quem as fecha: **o desenho** (T015, T021, T039, T047) e **o dono** (T046, T049, T050, T052 — a bateria e as fixtures reais) |
| O flag morto | `--casos` saiu do `processo.py`, com **nota datada** onde vivia; os `--casos` que restam no repo são do dublê da mesa e do operador do hyperliquid |
| Números velhos | no recorte: só as notas datadas (o número vivo é 56 nas duas pontas, `quickstart.md` e a máquina) |

## A-15 — o quickstart do recorte mandava correr o que NÃO corre (medido)

| Comando que o `quickstart.md` dá | O que acontece |
|---|---|
| `python brokers/ctrader/casos/correr.py` (da raiz) | **`ModuleNotFoundError: No module named 'jsonschema'`, rc=1** — a raiz não tem a venv do conector. O que corre: `cd brokers/ctrader && .venv/bin/python casos/correr.py` |
| `bash tools/verificar-conector/provas-offline.sh --conector ctrader` | O script **não lê `--conector`** (`grep -c conector provas-offline.sh` → **0**) e corre a bateria do **hyperliquid** (`posse-do-preenchimento.ts`, `porta-das-dependencias.ts`, `conformidade.ts`). Quem segue o quickstart **vê verde e julga o ctrader coberto** — pior que um erro: um verde enganador |

Os dois são defeitos de **instrução**, não de código (o executante farejou-os e não os corrigiu, e diz isso no
relatório). Fecham com a instrução a nomear o que hoje roda e **a lacuna dita** (é a T047: a bateria de casos no
dublê ainda não cobre este venue).

## A-16 — números da casa fora do recorte (achado, não reparado aqui)

`README.md:142` (**52 de 52**, «re-medido 04/10/2026») e `docs/ONDE_ESTAMOS.md:3` (idem 04/10) ficaram atrás da
porta (**56**). Os dois levam data e o `README` explica por que a levam — é um registo datado, não uma mentira
viva. Fica dito para quem escrever o próximo estado da casa; aqui não se mexe no que tem dia.

---

# ADENDA 9 — 05/10/2026: o passo 11 (T015, T021, T039)

| Verificação do auditor | Resultado |
|---|---|
| `casos/correr.py` | **85 · 85 ok · 0 divergentes** (eram 73) |
| `bash tools/verificar-maquina/provar.sh` | **56 de 56, rc=0** — o rótulo do portão passou a `85 casos`; as outras três bancadas intactas (`27 · 6 · 7`) |
| Os 14 casos novos | todos `ok`: **9** de identidade (`identidade.casos.json`), **4** do manifesto (montagem pura), **1** da sequência de fechos |
| T039 (linha crua) | `601 SELL` · `602 BUY` · `603 SELL` → **zero posições no fim**; o 7.º passo → `nada` / `sem_posicao_para_fechar` / **`ordem: null`**; `problemas: []` |
| As 4 negativas (harness, corrido por mim) | divergente aceite → `ok=True, esperado=False` · direitos aceites → idem · `passo` fixo → *«veio "0.1", esperado "0.25"»* · fecho do inexistente com ordem → `tem_ordem=True, esperado=False` (a razão: *abriria por lado contrário, RN-CT34*) |
| `contracts/` | limpo |

## A-17 — as negativas dos casos novos vivem FORA do repositório (achado)

O executante diz, e a auditoria confirma: as quatro negativas do T015/T021/T039 correm num **harness de scratch**
(`…/cache/scratch/prova-t015-t021-t039.py`, fora do repo) — o portão leva **só os verdes**. As bancadas mais
recentes do conector (ritmo, leitura) já correm a negativa **inline** (a linha `{"negativa": …}` sai no próprio
`stdout` da bancada). Os casos em dado do `correr.py` ficaram atrás desse padrão: quem correr o portão não vê o
vermelho de cada um. Fecha-se pondo o injector de defeito **dentro** do corredor, para a negativa ser um passo da
bancada (e não uma sessão de scratch que ninguém repete).

**As três lacunas que o executante declara, e que a auditoria aceita como ditas:** T015 é 2 em dado + 1 por
execução (a camada em falta); T021 mede a **montagem pura** (`montar_manifesto`), não a sonda viva contra o venue;
T039 é uma **simulação pura** sobre fixtures (o caminho com estado é do `prova-envio.py`).

---

# ADENDA 10 — 05/10/2026: o passo 12 (A-17 dentro da bancada, A-15 no quickstart)

| Verificação do auditor | Resultado |
|---|---|
| `casos/correr.py` | **85 · 85 ok · 0 divergentes**, `rc=0`, e a **última linha do `stdout` continua a ser o resumo** (é o que o portão imprime com `tail -1`) |
| As quatro negativas | dentro da bancada, no `stdout` dela: `identidade-divergente-aceite` · `direitos-insuficientes-aceitos` · `manifesto-passo-fixo-no-codigo` · `fecho-do-inexistente-manda-ordem` |
| **O controlo anti-vacuidade (medido por mim)** | Com uma negativa **vacuosa** (o caso a continuar VERDE sob o defeito), o resumo passa a `ctrader: 85 casos · 85 ok · 0 divergentes · **NEGATIVAS DIVERGENTES: 1**` e o `main()` devolve **1** — a bancada reprova a negativa falsa. Sem este passo, uma negativa podia passar em silêncio |
| `bash tools/verificar-maquina/provar.sh` | **56 de 56, rc=0** · as quatro bancadas do ctrader na mesma (`85 · 27 · 6 · 7`) |
| O quickstart | os dois comandos do bloco **correm** (e a saída crua está colada no documento); o comando que dava `ModuleNotFoundError` morreu; o `--conector ctrader` saiu do bloco e vive num aviso que **nomeia o A-15**; o §2 diz «ainda não existe — a lacuna dita, não prometida» e nomeia **T046/T047/T049/T050** com quem fecha cada uma |
| `contracts/` | limpo |

*Nota de método: a primeira sonda desta auditoria concluiu «o controlo não existe» e estava **errada** — a
convenção do corredor é que a prova devolve os problemas **dela** (a vacuidade), não os do caso. O código dizia-o
(`_anunciar_negativa`, com dois `if` e a razão escrita); a segunda sonda mediu o controlo como ele é.*

---

# ADENDA 11 — 05/10/2026: o passo 13 (T047 — os casos do contrato nos DOIS lados)

| Verificação do auditor | Resultado |
|---|---|
| `casos/correr-duble.py` (corrido por mim) | `lado DUBLE (mesa, --papel conector): 19 casos · 19 ok · 0 divergentes` · `lado CONECTOR (framing.py, o motor do desfecho): 19 casos · 19 ok · 0 divergentes` · resumo `ctrader/duble: 19 casos · 0 divergentes · duble 19/19 · conector 19/19`, `rc=0` |
| A negativa (`--prova-negativa`) | `rc=**1**` e o caso **NOMEADO com os dois lados**: `DIVERGE ctrader/desfecho-preenchimento-total · duble aceite/None · conector recusado/campo_desconhecido` |
| Os 19 casos | **11** do venue (`ctrader/desfecho-*`, **montados** pelo módulo puro — não copiados: o que atravessa a fronteira é o que o conector produz) + **8** `adversario/*` (recusa sem motivo, aceite sem resolução, classificação fora das quatro, campo a mais, versão à frente, nulo, decimal com expoente, unidade de corretora) |
| `bash tools/verificar-maquina/provar.sh` | **57 de 57, rc=0** — a **5.ª** bancada do ctrader entrou no portão: `contrato nos dois lados (19 casos)` |
| `contracts/` | limpo (SC-015) |
| `tasks.md` | **48 feitas · 4 por medir** — e as quatro que restam são **do dono** (T046, T049, T050, T052) |

**O caso-fronteira que o executante excluiu — e fez bem.** Uma mensagem com o `tipo` errado: o dublê confere o
**papel** (`tipo_invalido`) e o motor do contrato confere o **envelope** — medem coisas diferentes de propósito.
Excluí-lo (em vez de o contar como «divergência») é o certo, e está escrito onde acontece (`correr-duble.py:22`).

## A-18 (cosmético) — as duas linhas misturam dois eixos

No modo `--prova-negativa` lê-se `lado DUBLE … 19 casos · 19 ok · 1 divergentes`: o `ok` é o veredicto **próprio**
de cada lado e o `divergentes` é o da **comparação** — duas medidas na mesma linha (não é mentira; lê-se como
uma). Não muda veredicto nem `rc` (que é 1, correcto). A clareza ganhava com os eixos rotulados.

---

## O que o executante declarou, e a auditoria confirma

O **A-15** dizia que o quickstart nomeava duas lacunas; uma delas era a **T047** (os casos do contrato no dublê da
mesa). Fechou-a **o desenho**, e a medição fica aqui:

| Verificação | Resultado |
|---|---|
| `cd brokers/ctrader && .venv/bin/python casos/correr-duble.py` | **lado DUBLE 19/19 · lado CONECTOR 19/19 · 0 divergentes**, `rc=0` — 11 payloads deste venue (montados por `desfecho.py` a partir de `desfecho.casos.json`, não copiados) + 8 adversários |
| A negativa (dentro da bancada) | veredicto do conector estragado de propósito → **VERMELHO a nomear** `ctrader/desfecho-preenchimento-total` («o DUBLE disse aceite/None e o CONECTOR disse recusado/campo_desconhecido»); **vacuosa** → `· NEGATIVAS DIVERGENTES: 1`, `rc=1`; e o modo explícito `--prova-negativa` (defeito no caminho REAL) → `DIVERGE …`, `ctrader/duble: 19 casos · 1 DIVERGENTES`, `rc=1` |
| `bash tools/verificar-maquina/provar.sh` | **57 de 57, rc=0** — a T047 somou a QUINTA bancada do ctrader (`ctrader: contrato nos dois lados (19 casos)`) |
| A catraca dos fallbacks | **reprovou primeiro** (6 sítios no ficheiro novo: `or {}`, `.get(k, …)`) e foi o portão a apanhá-los; corrigidos, `fallbacks: 0 sítios` |
| `contracts/` | limpo — a paridade dos dois lados NÃO fez o contrato crescer (SC-015) |
| O quickstart | §1 passa a ter o **terceiro comando** correto (`casos/correr-duble.py`) com a saída crua colada; a T047 sai das «por medir» e a lacuna que o A-15 nomeava fica **dita como fechada** (a outra metade do A-15, o `provas-offline.sh --conector`, mantém-se) |

**O que a bancada NÃO cobre, e di-lo:** só o lado **`desfecho`** (o dublê só confere esse tipo no papel `conector`);
o caso do `tipo` errado fica fora (papel × envelope medem coisas diferentes de propósito); e as fixtures REAIS do
venue continuam a ser a **T046** (dono).

---

# ADENDA 12 — 05/10/2026: a BATERIA ao vivo e os defeitos do caminho do dinheiro

A bateria das doze provas correu contra a demonstração `45292558` (autorizada pelo dono). Pela primeira vez a
**ordem SAIU** — e o caminho do dinheiro revelou defeitos que as **85+27+6+7+19 provas offline** não viam, porque
as fixtures levavam o valor **já descodificado / na unidade errada**. Todos foram apanhados **contra o venue**, e
cada conserto leva caso **em dado** (injecta o ENUM, não a cadeia) e a **negativa dentro da bancada**.

## Fechado com prova (a bancada `casos/correr.py` passou de 85 para **105 · 105 ok · 0 divergentes**)

| # | O defeito | A prova (antes → depois) |
|---|---|---|
| **D1** | `tradingMode` saía como **ENUM cru** (`transporte._simbolo_por_dentro` publicava `simbolo.trading_mode`); TODA a abertura recusava `capacidade_nao_declarada`. *(O `.value` da biblioteca TRUNCA 3 dos 4 membros: `DISABLED_WITHOUT_PENDINGS`, `CLOSE_ONLY` — nem `.value` nem `.name` servem sozinhos.)* | ao vivo, o símbolo publicava `<TradingMode.ENABLED: 'ENABLED'>` → hoje `'ENABLED'` (mapa declarado `MODOS_DE_NEGOCIACAO_POR_MEMBRO`). Casos: **um por membro** (injectando o ENUM) + a recusa por nome; negativa `trading-mode-sai-como-enum-cru` **VERMELHO**. |
| **D2** | `moneyDigits` **sem fonte numa conta plana**: `leitura._expoente_dos_valores` recusava `expoente_dos_valores_ausente` sem posição (ovo-e-galinha). | `transporte.trader` pergunta-o ao **VENUE** por `ProtoOATraderReq` — medido `expoente_dos_valores = 2`. A posição fica a 2.ª fonte; divergência continua a RECUSAR. Casos `expoente-do-trader-*` + `leitura/expoente-…`; negativa `moneyDigits-nao-lido-do-venue` **VERMELHO**. |
| **D3** | Unidades na fronteira: o `saldo` vinha `Decimal` já dividido (a leitura quer o INTEIRO escalado); posições/ordens/negócios publicavam `Decimal`/`datetime` crus (não-JSON). | saldo = `ProtoOATrader.balance` cru; preços em inteiros relativos; dinheiro em texto; instantes em millis. |
| **D5** | `desvio_maximo` (%) → **pontos inteiros**: 0,5% sobre `1.12107` = `560,535`, e o venue só aceita inteiros — **recusar tornava impossível enviar UMA ordem**. | **Decisão (dono corrige se quiser):** o desvio é tolerância **máxima** → arredonda **para BAIXO** (560). O **tamanho** continua a NUNCA se arredondar (FR-056). Caso + negativa `desvio-arredonda-para-cima` **VERMELHO**. |
| **D-la** | `_nome_do_proto` não lia o **INTEIRO**: o evento lido do fio traz os enums do proto como `int` (betterproto), não membros — `desfecho.py` recusava o evento. | o inteiro sobe pela **classe do enum**; casos `transporte/nome-do-proto-*` (injectando o INTEIRO) + negativa `nome-do-proto-nao-le-o-inteiro` **VERMELHO**. |
| — | A **bateria**, dimensionada pela **grelha viva** e com sufixo único por corrida (o registo do venue sobrevive ao processo). | `saldo_pct` calculado com saldo/preço/mínimo/passo vivos, conferido pelo módulo PURO `ordens.volume_do_venue`. |

## O que FALTA — D6 (dito, não escondido)

**O DESFECHO da ordem não sai.** O venue responde `ORDER_ACCEPTED` — `{executionType: ORDER_ACCEPTED, order:{… sem
executionPrice}, position:{positionId, symbolId, moneyDigits, tradeSide}}`, **sem** `executedVolume`/`usedMargin`/
`executionPrice` — e só **depois** manda o preenchimento. O conector lê **só o primeiro evento** (`protocol.send_request`
devolve a resposta correlacionada), a resolução fica **parcial (3 de 5 campos)** e o contrato recusa o desfecho
(`campo_obrigatorio_ausente`). Consequência: a prova **8 envia e enche** (posição `246819991`, volume `100000`, preço
`112141`), mas **não publica desfecho**; a 10 e a 12 dependem dele. **Fecha-se seguindo o SEGUNDO evento
(`ORDER_FILLED`)** ou relendo o registo do venue. **T049/T050 só ficam `[x]` quando isto fechar.**

## O estado da conta

Limpa em **todas** as corridas: zero posições/ordens vivas no fim (o `finally` da bateria fechou tudo o que abriu).
`git status --short contracts/` → **vazio** (SC-015). Portão: **57 de 57, rc=0**.

---

# ADENDA 13 — 05/10/2026: a auditoria do passo 14 (o caminho do dinheiro, medido ao vivo)

| Verificação do auditor | Resultado |
|---|---|
| `casos/correr.py` | **105 · 105 ok · 0 divergentes** (eram 85) — e **8 negativas inline** no `stdout` (as quatro antigas + `trading-mode-sai-como-enum-cru`, `moneyDigits-nao-lido-do-venue`, `nome-do-proto-nao-le-o-inteiro`, `desvio-arredonda-para-cima`) |
| `bash tools/verificar-maquina/provar.sh` | **57 de 57, rc=0** — cinco bancadas (`105 · 27 · 6 · 7 · 19`) |
| `contracts/` | limpo (SC-015) |
| Os registos da bateria | o original + `-r2 … -r7` — **nenhum reescrito** (FR-073) |
| A corrida `-r7` | **7 passou · 1 falhou · 2 bloqueado · 2 não forçável** (era 4/0/4/2) |
| **A ordem saiu** | prova 8: **1 mensagem de ordem ao fio**, e a conta passou a ter a posição `246825154` — `volume 100000`, `preco_de_entrada 112177`, `margem_empenhada 37.39`, `comissao -0.03`, `estado OPEN`, `expoente 2` — todos **números do venue** |
| O mapa do D1 (no código) | `MODOS_DE_NEGOCIACAO_POR_MEMBRO` com os **quatro** membros, e a armadilha tratada: `CLOSE_ONLY → "CLOSE_ONLY_MODE"` (nem o `.value` nem o `.name` da biblioteca dariam o nome do proto) |
| O D5 | a tolerância **arredonda para baixo** (`ordens.py:377`): aceitar menos desvio do que o dono pediu é o lado seguro |
| **A conta, lida por MIM ao vivo** | `POSICOES: ok=True · valor=[]` e `ORDENS VIVAS: ok=True · valor=[]` — limpa. Os três fechos de limpeza que o registo só dizia «enviado» **chegaram ao venue** |

## A-19 (defeito do REGISTO, não do conector)

A linha «O ESTADO DA CONTA NO FIM · posicoes que a bateria abriu e registou: `[246825154]`» **subconta**: a prova 12
abriu mais três (`246825219`, `246825244`, `246825253`), que só o `finally` fechou. Quem lê o registo fica a pensar
que se abriu uma posição — abriram-se quatro. A linha ganhava em dizer o que a **leitura** viu vivas (3) e o que o
`finally` fechou, que é o que o meu instrumento confirmou.

## O bloqueio seguinte (D6), como o executante o declara — e a auditoria confere

O venue responde `ORDER_ACCEPTED` (sem `executedVolume`/`usedMargin`/`executionPrice`) e só **depois** manda o
preenchimento; o conector lê **o primeiro** evento, a resolução fica a **3 de 5** campos e o contrato recusa o
desfecho (`campo_obrigatorio_ausente`). É por isso que a prova 8 «falha» **depois** de enviar e encher, e que 10 e
12 ficam bloqueadas atrás dela. **T049/T050 ficam `[ ]`** — bem: as doze provas ainda não medem o que prometem.

---

# ADENDA 14 — 05/10/2026: a auditoria do passo 15 (D6 fechado — o desfecho segue o preenchimento)

| Verificação do auditor | Resultado |
|---|---|
| `bash tools/verificar-maquina/provar.sh` (corrido por mim, **depois** do último código) | **57 de 57, rc=0** — cinco bancadas (`105 · 32 · 6 · 7 · 19`) e **`fallbacks (ZERO exigido) OK`** |
| `contracts/` | limpo (SC-015) |
| A bateria ao vivo (corrida final) | **12 provas · 10 passou · 2 não forçável · 0 falhou · 0 bloqueado** |
| **A prova 8 (o dinheiro)** | **PASSOU**, com a linha crua do desfecho: `classificacao aceite`, `executionType ORDER_FILLED`, `orderId 365295126`, `executedVolume 100000`, `positionId 246833601`, `executionPrice 112189`, `baseSlippagePrice 112200`, `slippageInPoints 561`, `orderStatus FILLED` |
| As provas 10 e 12 | **PASSOU** — o fecho por `positionId` e as três aberturas/fechos, com a leitura final a exigir zero posições |
| Os registos | o original + `-r2 … -r10` — **dez**, nenhum reescrito (FR-073) |
| **A conta, lida por MIM ao vivo** | `POSICOES: []` · `ORDENS VIVAS: []` — limpa (terceira confirmação independente) |
| O D6 no código | `_precisa_seguir_o_preenchimento` (1732) / `_seguir_o_preenchimento` (1758) / `transportes.esperar_o_preenchimento`, com `_desfecho_por_falta_de_preenchimento` para quando o preenchimento não chega no prazo — o caminho honesto: nunca um sucesso inventado |
| `tasks.md` | **50 feitas · 2 por medir** — T049/T050 passaram a `[x]` (medem o que prometem: 10 ao vivo + 2 não forçáveis, cobertas offline **por desenho**); restam **T046** (as fixtures reais — dono) e **T052** (a tabela comparativa dos dois conectores) |

**Nota da auditoria:** a corrida `-r8` (intermédia) **ainda falhava** a prova 8 — o D6 só ficou provado na final. O
rasto foi: portão **vermelho** na catraca dos fallbacks (três `.get(k, default)` novos) → limpos → portão verde →
bateria outra vez. Cada iteração deixou o seu registo, e nenhum foi apagado — é isso que permite ler o rasto.

---

## O que o executante declarou, e a auditoria confirma (D6 e D7 fechados)

O texto acima descreve os bloqueios **como estavam**. Esta adenda diz o que os fechou, com os números; nada acima
foi reescrito (FR-073).

| Verificação | Resultado |
|---|---|
| O **D6** (seguir o preenchimento) | `transporte.esperar_o_preenchimento(marca, ordemId, prazo)` sobre um tratador das execuções **cruas** de `Protocol.on_event(ProtoOAExecutionEvent, …)`; o `processo` só segue quando o evento não traz os números (`ORDER_ACCEPTED`); sem preenchimento no prazo → **`desconhecido`** + PENDENTE (nunca sucesso inventado) |
| O **D7** (o fecho com 5 campos) | o `preco_de_liquidacao` do FECHO projeta-se pela regra **[C]** sobre o preço de execução do VENUE ao `tick`; e `alavancagem_efectiva`/`margem_empenhada` completam-se pela DECLARAÇÃO quando o evento as omite (o `position` do evento não traz `marginRate`) |
| `casos/prova-envio.py` | **32 · 32 ok · 0 divergentes** — os casos `(D6)` e `(D7)` injectam a sequência em dado (aceite → preenchimento pelo tratador de eventos) na **forma real do venue**; **3 negativas** novas (sem seguir o preenchimento, sem a projeção do fecho, sem a completação declarada) exigem o VERMELHO a nomear |
| `bash tools/verificar-maquina/provar.sh` | **57 de 57, rc=0** — cinco bancadas do ctrader (`105 · 32 · 6 · 7 · 19`) |
| Os registos da bateria | `-r8` (reprovou: D7 ainda aberto) e `-r9` / `-r10` (**12 provas · 10 `passou` · 2 `nao_forcavel`**) — nenhum anterior reescrito (FR-073) |
| As provas **8, 10 e 12** | **PASSARAM**: a linha `desfecho` `aceite` com os números do VENUE (`orderId`, `executedVolume`, `executionPrice`, `dealId`, comissão), o fecho por `positionId` com o `closePositionDetail`, e a `LEITURA FINAL` a **zero posições** |
| `contracts/` | limpo (SC-015) |

---

# ADENDA 15 — 05/10/2026: a auditoria do passo 16 (T052 — as duas baterias, lado a lado)

| Verificação do auditor | Resultado |
|---|---|
| `bash tools/verificar-maquina/provar.sh` (corrido por mim, **depois** das edições do passo) | **57 de 57, rc=0** |
| `contracts/` e a árvore | limpo · a árvore continua com os mesmos **30** ficheiros (o passo só tocou em `README.md` e `tasks.md`) |
| Os números do irmão, **relidos por mim** | `brokers/hyperliquid/conformidade/1.4.0.txt`: **9 de 9 passaram · 238 verificações · 0 divergentes**, **9** linhas `PROVA`, contrato **1.4.0**, 29/09/2026 — batem com a tabela |
| A tabela | cada número com a **linha de onde saiu** (`r10:3`, `h:4`, …); o cabeçalho compara registo, versão do conector, versão do CONTRATO, data, comando, **modo**, o que prova e o nº de provas |
| **A conclusão** | dita por inteiro e sem maquilhar: a exigência **não se cumpre hoje** — ctrader **ao vivo** (12 provas · 10 passou · 2 não forçável · contrato 1.12.0) contra hyperliquid **offline com dublê** (9 provas · contrato 1.4.0): divergem em **modo**, **contagem** e **versão** |
| `tasks.md` | **T052 fica `[ ]`** — bem: o critério não se cumpre, e a decisão é do dono |

**O que a T052 descobriu, e que os dois registos provam:** o SC-014 pede «os **dois** conectores passam a **mesma**
bateria — **doze provas** cada», e não existem dois registos que o mostrem. Não é um defeito de conector: é um
**critério de aceite que descreve um estado que nunca existiu**. Fica ao dono: (a) levar a bateria ao vivo ao
hyperliquid (exige rede + chave e **assinar ordens** — o próprio registo dele diz que não as manda), (b) mudar a
redação do SC-014 para o que as duas provas de facto são, ou (c1/c2) as variantes nomeadas.

---

# ADENDA 16 — 05/10/2026: as provas do dono (VENDA, VIRADA DE MAO, NOTIONAL, ALAVANCAGEM) e o commit

**O pedido do dono, textual:** «faca voce mesmo o teste de sell e virada de mao, teste de notional, e alavancagem.
se tudo correr ok, pode commitar para o github». A auditoria **estendeu a bateria** às três provas (13 = VENDA,
14 = VIRADA DE MAO, 15 = ALAVANCAGEM 5), com uma **conferência** do notional e da alavancagem contra os números do
próprio venue (sem substituir nenhum: o desfecho continua a transportar o que o venue deu — FR-064).

| Verificação do auditor | Resultado |
|---|---|
| `bash tools/verificar-maquina/provar.sh` (corrido por mim, depois do último código) | **57 de 57, rc=0** — bancadas `109 · 36 · 6 · 7 · 19`, `fallbacks (ZERO exigido) OK` |
| A bateria ao vivo (registo `-r12`) | **15 provas · 13 passou · 2 não forçável** |
| **Prova 13 — a VENDA** | **PASSOU**: `posicao 246843477`, lado **SELL**, `volume 100000`, `preco 112176`; `executedVolume 100000 (=1000 un.) × executionPrice 112176 (=1.12176) → nocional 1121.76`, e o publicado **confere ao centésimo**; margem `1121.76/30 = 37.392` (o venue publica 37.4 — delta 0,008) |
| **Prova 14 — a VIRADA DE MAO** | **PASSOU**: **2 mensagens** ao fio (`fechar_posicao=1`, `colocar_ordem=1`) — a perna do fecho **e** a da abertura na mesma passagem; a posição que fica é `246850042`, lado **BUY**, `volume 100000`, `preco 112236`, `margem 37.41`, `nocional 1122.36` conferido |
| **Prova 15 — a ALAVANCAGEM 5** | **PASSOU** (na 2.ª corrida; ver a nota do meu defeito abaixo) |
| `contracts/` | limpo (SC-015) |
| **A conta, lida por MIM ao vivo** | `POSICOES: []` · `ORDENS VIVAS: []` — limpa |

## A-20 — o tecto de ordens estava declarado e NÃO travava nada

`MAXIMO_DE_ORDENS = 12` só existia escrito no cabeçalho do registo: nenhum sítio o conferia. Um limite que não
limita é decoração — e numa corrida que manda ordens a sério, é a decoração perigosa. Passou a **kill switch**
(`_enviar_envelope` levanta `TectoDeOrdens`; o `main` apanha, fecha tudo no `finally` e escreve a secção), e subiu
para **18** com a data e a razão (as três provas novas do dono).

## O defeito que era MEU, na prova 15 (dito, e não escondido)

A 1.ª corrida reprovou a prova 15 — e a culpa **não** era do conector: dimensionei a boleta com o `saldo_pct`
calculado para alavancagem 30 e pedi 5, o volume caiu fora da grelha e o conector **recusou correctamente**
(`minimo_do_instrumento_acima_da_banda`, «não é inteiro e não se arredonda» — FR-056). Corrigi a sonda
(`_saldo_pct_para_o_minimo(numeros, alavancagem)`); a lição para a bancada é esta: **o tamanho depende da
alavancagem pedida, e a sonda tem de a levar consigo**.

## A limitação que o dono desenterrou (a virada de mão existia recusada)

Antes deste passo, `reverter: true` era **recusado** por desenho (`ordens.py:746`: «este venue nao faz a inversao
numa ordem… as duas pernas nao se improvisam»). A recusa era honesta, mas o contrato **1.10.0 (c)** espera as
**duas pernas na mesma passagem** quando o venue não faz netting — e sem isso o verbo **`reverse`** da mesa não
funcionaria neste venue. Ficou implementado (fecho por `positionId` + abertura do lado declarado, **um só
desfecho** a descrever a posição que fica, e nenhuma meia virada em silêncio: fecho recusado → abertura não
enviada; fecho `desconhecido` → pendente e reconciliação).

## O commit

`7f17f5d` em `origin/master` (`github.com/rcerucci/mesacore`), verificado por leitura do remoto
(`git ls-remote origin refs/heads/master` devolve o mesmo hash). **28 ficheiros** — a vaga do ctrader inteira.
**De fora, de propósito:** as duas fichas `fichas/sigma/*.json`, que estão modificadas **desde 04/10** por **outra
sessão** e não são desta vaga (a árvore fica com essas duas, e só essas). Os registos das corridas **não** vão no
commit: `brokers/*/conformidade/` está no `.gitignore` por desenho — são ESTADO, não FORMA.

---

# ADENDA 17 — 06/10/2026: as VELAS do ctrader (o que a σ consome) — o primeiro passo dos dois venues

O dono vai subir um **setup σ a 1m em EURUSD** nesta conta e pôr **os dois venues a operar em paralelo**. O primeiro
passo era o que a σ come: **velas**. O conector do ctrader não tinha modo nenhum que as escrevesse.

| Verificação do auditor | Resultado |
|---|---|
| `bash tools/verificar-maquina/provar.sh` (corrido por mim) | **58 de 58, rc=0** — a bancada nova entrou: `ctrader: velas p/ a sigma (7 + 3 neg)` |
| `contracts/` | limpo (SC-015) |
| O ficheiro escrito do venue | **7158 linhas** em `velas-EURUSD-1m.jsonl`, todas em múltiplos de 60000 ms; primeira `t 1790678100000` (2026-09-29 10:35Z), última `1791282840000` (2026-10-06 10:34Z); descritor com `periodo_do_venue: M1` |
| A forma vs o irmão | os **mesmos campos na mesma ordem** (`t,o,c,h,l`); só o irmão tem `T,s,i,v,n` — e o `v` ficou de fora **por nome**: o venue dá volume em **ticks**, grandeza diferente (a σ não o lê) |
| **A σ a consumi-las — MEDIDO POR MIM** | Com a receita do harness da casa (`tools/verificar-setup/sigma-casos.py`): as velas copiadas para a `PASTA_DE_MERCADO` como `velas-EURUSD-1m.jsonl`, `CONSTANTES` = as omissões do template, a leitura no stdin. **No instante real**: silêncio, com o diagnóstico (`7158 no ficheiro · 7158 fechadas · ultima 2026-10-06T10:34Z`). **No replay da barra `10:33Z`**: **proposta real** `{"lado":"sell","barra_ms":1791282780000}` — a barra da viragem (`sig=-1 · virada=-1`) |
| A limitação declarada | o relógio **`2h`** (o 8.º da σ) **não tem trendbar** neste venue: recusado por nome, nunca arredondado para H1/H4 |

**O que este passo NÃO fecha, e é o seguinte:** a σ consumiu as velas **numa corrida minha, à mão**. O que falta é o
**operador** a pedi-las e a chamar a σ **a cada volta**, para os pares das duas contas — e é aí que entra o
**roteamento** (os três sítios ainda fixos no hyperliquid: as velas em `operador.ts:463`, o conector em `:675`, o
feed em `:703`). A σ a operar a 1m contra o venue **depende ainda** da decisão do **tamanho na grelha** (FR-055/
FR-056): hoje quase todas as ordens caem fora do passo. Sem essa decisão, as velas chegam e a σ propõe — e a ordem
é recusada.

---

# ADENDA 18 — 06/10/2026: o padrão do dono no conector (a ficha é a mesma, quem cede é o tamanho)

**A decisão do dono, textual:** «conta: ctrader-demo-pepperstone, a ficha do eurusd pode ser igual ao btc, **10%
notional e 1x alavacagema**. isso tem que ser **padrão independente do venue, riscos igual ao hl**. simples assim».
Traduzida: a ficha não muda por venue; quem se adapta é a conversão — **o tamanho desce ao degrau admissível do
venue e o ajuste SAI DECLARADO** (nunca em silêncio).

| Verificação do auditor | Resultado |
|---|---|
| `bash tools/verificar-maquina/provar.sh` (corrido por mim) | **58 de 58, rc=0** |
| `casos/correr.py` | **109 · 109 ok · 0 divergentes**, e a etiqueta do portão diz o mesmo (`boleta e fecho (109 casos)`) |
| As negativas novas | **`volume-fora-do-passo-volta-a-recusar`** e **`ajuste-ao-passo-em-silencio`** correm **dentro** da bancada e ficam **VERMELHO** (`o_caso_ajuste-declarado_ficou: VERMELHO`); a bancada tem agora **11** negativas |
| A regra no código | `ordens.ajustar_volume_ao_venue(...)` (linha 254) devolve `Conversao` ou `Recusa` — o degrau **≤** pedido, e a recusa pelo nome antigo quando o pedido fica abaixo do mínimo |
| A spec | **duas notas datadas (06/10/2026)** em `spec.md` (FR-055 e FR-056), com as palavras do dono citadas; o texto antigo fica |
| Os casos em dado | `ordens.casos.json`: o volume fora do passo **desce ao degrau e declara o ajuste**; o que cai exacto declara `volume_exacto_no_passo`; abaixo do mínimo continua recusado |
| **A corrida ao vivo** (`conformidade/1.12.0-2026-10-06.txt`, registo NOVO) | **`15 provas · 13 passou · 2 não forçável`** — a prova 6 (reescrita) **PASSOU**: `executedVolume 400000` (4000 un.), `executionPrice 112604`, `positionId 247222769`, e a **declaração** `{volume_pedido 444003.002…, volume_efectivo 400000, regra volume_ajustado_ao_passo, nocional_pedido 4998.719, nocional_efectivo 4503.32}` |
| O desvio | **9,9105 %** do volume (o pedido de 10 % cai a 4000 un. porque o passo são 1000 un.) — o número está no registo |
| `contracts/` | limpo (SC-015) |
| **A conta, lida por MIM ao vivo** | `POSICOES: []` · `ORDENS VIVAS: []` — limpa |

## A-21 (achado, para o dono) — a `alavancagem_efectiva` deste venue é uma DECLARAÇÃO de dimensionamento

Medido ao vivo: a resolução publica `alavancagem_efectiva: "1"` (o que a boleta pediu) mas a margem que o **venue**
empenha é `usedMargin 15014` (= 150,14, isto é `4504,16 / 30`) — o ctrader **não aplica alavancagem por ordem**:
aplica o **escalão da conta** (1:30 nesta demo). No hyperliquid a `alavancagem` é real (o venue aplica-a); aqui é
uma regra de **dimensionamento**. O risco (a exposição) fica **igual** — mas o campo não distingue as duas coisas,
e a mesa pode ler `alavancagem_efectiva` a pensar no venue. A linha traz os dois números (a declarada e a
`margem_empenhada`), por isso está dita — falta decidir se o **nome** deve dizer qual é qual (decisão do dono).

**O que este passo NÃO fecha:** a σ a operar de ponta a ponta — o **roteamento do operador** é o passo seguinte
(é o que falta para os dois venues em paralelo). E a bateria ao vivo **perdeu** a prova da recusa pela grelha (já
não existe): a recusa abaixo do mínimo e as duas negativas medem-se **offline**.
