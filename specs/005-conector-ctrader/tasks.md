# Tasks — o segundo conector (cTrader, demonstração)

**Input**: `specs/005-conector-ctrader/` — `spec.md` (7 histórias, FR-045..073, SC-013..018), `plan.md` (as cinco
decisões), `research.md` (R1–R9), `data-model.md` (§0–§7, com os cinco achados).

**Testes**: incluídos **não por opção** — a bancada declarada existe **antes** do código que a cumpre. Duas: a
**offline** (casos em dado, corre sempre) e a **bateria de conformidade** (demonstração, doze provas). O que
distingue este recorte: cada prova tem de dizer também **o que o contrato** recebeu — a neutralidade mede-se.

**Formato**: `[ID] [P?] [História] Descrição` — `[P]` = ficheiros diferentes, sem dependência.

---

## Estado (05/10/2026 — medido, não declarado)

Os números abaixo saíram de comandos que **correram** neste dia; o comando vai ao lado de cada um. Uma tarefa
só está `[x]` quando a prova existe; o que depende do dono fica `[ ] **por medir**`, com o nome de quem o pode
fechar. A versão anterior deste bloco (01/10/2026, «fase 2 feita») fica **no fim do documento**, com nota
datada — não se apaga história.

- **A porta única da casa**: `bash tools/verificar-maquina/provar.sh` → **57 de 57 passaram, rc=0**.
- **As cinco bancadas do ctrader, dentro da porta** (o número é a saída crua de cada uma):
  - `casos/correr.py` → **109 casos · 109 ok · 0 divergentes** (boleta e fecho + o descodificador de fronteira + os **4 casos em dado da VIRADA**, 05/10/2026);
  - `casos/prova-envio.py` → **36 provas · 36 ok** (envio, reconciliação, sessão, o desfecho das provas 8/10, e a **sequência da VIRADA em duas pernas**, 05/10/2026);
  - `casos/prova-ritmo.py` → **6 provas · 6 ok** (ritmo do venue);
  - `casos/prova-leitura.py` → **7 provas · 7 ok** (leitura do mercado);
  - `casos/correr-duble.py` → **19 casos · duble 19/19 · conector 19/19 · 0 divergentes** (os casos do
    contrato nos **dois lados** — T047, 05/10/2026).
- **O contrato não cresceu**: `git status --short contracts/` → **vazio** (SC-015 medido).
- **A bateria AO VIVO (05/10/2026 — a VIRADA DE MÃO passa):** correu contra a demonstração `45292558`; registo
  `1.12.0-2026-10-05-r12.txt` (**15 provas · 13 `passou` · 2 `nao_forcavel`** — as provas 4 e 5, que não se forçam
  ao vivo). As provas do dono passaram: a **13** (VENDA, lado SELL, nocional/alavancagem conferidos contra o VENUE),
  a **14 — A VIRADA DE MÃO** (`reverter: true` com uma posição SELL viva: **DUAS pernas na mesma passagem** — o
  fecho por `positionId` e a abertura do lado declarado —, **2 mensagens de ordem ao fio** (`colocar_ordem=1`,
  `fechar_posicao=1`), desfecho `aceite` com a **posição NOVA** e os números do VENUE),
  a **15** (alavancagem 5). A linha crua da virada (a posição que fica): `o_que_fica` → `positionId 246850042`,
  `lado buy`, `volume 100000` (= 1000 unidades), `preco 112236` (= 1.12236), `margem_empenhada 37.41`; e a conta
  ficou **LIMPA** no fim (**0 posições, 0 ordens vivas**, lida por fora pelo `ler-conta.py`).
- **A VIRADA DE MÃO (1.10.0(c)) deixou de ser recusa e passa a ser execução** (05/10/2026): este venue não faz
  netting, logo o conector executa as **duas pernas na MESMA passagem** — `fechar_posicao` pela viva e
  `colocar_ordem` pelo lado declarado. Sem posição viva (ou com a posição já do lado declarado): **recusa
  nomeada** `reversao_sem_posicao_a_reverter`, ZERO envios. Nunca meia virada em silêncio: o desfecho traz as
  duas pernas e o que ficou em `resposta_do_venue.virada`.
- **O que deixou de ser papel** (passos 4 a 9): o **envio** (`colocar_ordem`/`fechar_posicao`), o **estado por
  instrumento** e a **reconciliação** (FR-068/069), o **limitador de ritmo** (FR-071), os **eventos da sessão**
  (FR-070 → `nao_autorizada`·`autorizada`·`invalidada`), as **duas camadas no envio** (FR-048) e a **leitura do
  mercado** (último retrato por símbolo, bid/ask opcionais, livro por deltas).

**O que ainda NÃO está medido — e por quem.** A **tabela comparativa** dos dois conectores (T052) já está escrita
no README do ctrader, e o que ela **mediu** é que o SC-014 (paridade, doze provas cada) **não se cumpre hoje** — a
**decisão** (igualar as duas baterias ou mudar a redação do critério) é do **dono**. As **fixtures reais** do venue
gravadas (T046) dependem também do **dono**. O **arranque do conector pelo operador** (A-4 — nada arranca este
conector hoje) é do **dono / do outro recorte** (a camada de operação).

---

## Fase 1 — Linha de base e documentos (fechada)

- [x] T001 Medir a linha de base e escrevê-la em `relatorios/linha-de-base.txt`: `provar.sh`, casos do contrato, versão do contrato, e a árvore limpa por fora — **feito:** a linha de base existe (01/10/2026, contrato 1.9.0) e ganhou a **nota datada de 05/10/2026** com a medição de hoje (`provar.sh` **56 de 56**, `contracts/` **0**)
- [x] T002 [P] Escrever a **regra de negócio do venue** — `docs/regra-de-negocio-ctrader.md`, 42 regras `RN-CT*`, cada linha com marca `[F]`/`[E]`/`[?]` — **feito:** commit `f183755`
- [x] T003 [P] Escrever a **máquina de estados do conector** — `docs/maquina-de-estados-conector-ctrader.md`, 4 eixos, tabela, 3 ausências deliberadas, invariantes — **feito:** commit `f183755` (com as notas datadas de 05/10/2026 dos eixos que ganharam leitor)
- [x] T004 [P] Escrever a **spec** e a checklist — **feito:** commit `efae7c5`
- [x] T005 [P] Escrever **plano** (5 decisões), **research** (R1–R9), **data-model** (§0–§7) e **quickstart** — **feito:** este documento e os seus irmãos

## Fase 2 — A costura e o transporte (US1) — fechada

- [x] T006 Criar `brokers/ctrader/` com `README.md` (o que entrega, o que não, e as declarações dos achados 1–5) e `.gitignore` (manifesto do runtime, `.venv`, `conformidade/`) — **feito:** ambos, com o `.gitignore` a proteger também `*credencial*.json`/`*.key`
- [x] T007 [P] `processo.py`: a costura — uma mensagem JSON por linha, no protocolo do contrato (`contracts/esqueleto/`), espelho de `brokers/hyperliquid/processo.ts`; recusa de enquadramento inválido **antes** de qualquer tradução — **feito:** usa o `framing.py` PARTILHADO (não uma cópia), diagnóstico no `stderr`, e o contrato a validar cada resposta antes de a publicar
- [x] T008 [P] `transporte.py`: embrulhar a biblioteca (sessão, protobuf, OAuth, reconexão) **sem** deixar nenhum tipo dela atravessar a fronteira; versão fixada (0.11.0) e licença declarada — **feito por inteiro:** além do embrulho, o transporte tem hoje o **envio** (`colocar_ordem`/`fechar_posicao`), o **limitador de ritmo** (50/s · 5/s), o **registo de ordens** e os **eventos da sessão** — provado por `casos/prova-envio.py` (**32 · 32**), `casos/prova-ritmo.py` (**6 · 6**) e `casos/prova-leitura.py` (**7 · 7**)
- [x] T009 Criar `.venv` com `uv` e fixar as dependências (`pyproject.toml`/lock) dentro de `brokers/ctrader/`; provar que o `provar.sh` da casa continua a verde com a pasta nova — **feito:** Python 3.12.14 + `jsonschema 4.26.0` + `ctrader-api-client 0.11.0`; e o portão obrigou a uma correcção da casa (o conferidor de fallbacks passou a conhecer o lado Python e a ignorar o `.venv`)

## Fase 3 — Arranque: portões, identidade, credencial (US1) — fechada

- [x] T010 [P] [US1] `identidade.py`: `ctidTraderAccountId` contra o ficheiro da conta, no arranque **e** em cada re-autenticação; `identidade_da_conta_divergente` com os dois ids — **feito** (função pura, com os dois ids ditos no motivo)
- [x] T011 [P] [US1] `credencial.py`: as três referências (client secret, access, refresh) lidas de ficheiro **fora do repositório**; a rotação reescreve-o e o conector relê; nenhum valor em estado, log ou mensagem — **feito:** **quatro** ficheiros `.key` (um por valor, `ctrader_mesa_*`) e um **quinto** não-segredo — o `expira_em` (ESTADO, criado pelo conector: sem ele o par rodava em cada arranque, A-9); modo 600 exigido, varredura ao repositório, e um piso de 16 caracteres
- [x] T012 [US1] Os **oito portões** da casa no arranque, na ordem do conector 1, + os três deste venue (identidade, `accessRights`, duas camadas); cada portão com o seu motivo nomeado — **feito:** os oito na ordem; o arranque completo dá **8 de 8 portas `passou`** (a sonda/manifesto, a primeira de sempre, no passo 2)
- [x] T013 [US1] `accessRights`: `CLOSE_ONLY`/`NO_TRADING`/`NO_LOGIN` lidos e aplicados — abertura recusada com o direito nomeado, fecho permitido (FR-066) — **feito:** conjunto FECHADO (valor desconhecido recusa); casos em dado `fecho/conta-CLOSE_ONLY…` e `fecho/simbolo-CLOSE_ONLY_MODE…` em `casos/ordens.casos.json` (**85 · 85**)
- [x] T014 [US1] As **duas camadas** como dois estados (transporte × sessão) e a regra: enviar exige as duas prontas (FR-048) — **feito (passo 8):** `conferir_as_duas_camadas` no `transporte.py` e `_porta_da_sessao` no `processo.py`; a prova negativa (tirada a guarda, a ordem com a sessão invalidada **sai**) fica VERMELHA a nomeá-lo — `casos/prova-envio.py` (**32 · 32**)
- [x] T015 [US1] Bancada: portão de identidade divergente, de direitos insuficientes e de camada em falta — três casos em dado, três recusas nomeadas — **feito:** `casos/identidade.casos.json` (**9** casos) com a **identidade divergente** (`identidade_da_conta_divergente`, que NOMEIA as contas do token e o id declarado) e os **direitos insuficientes** (`sem_direito_de_operar` para `NO_TRADING` e `NO_LOGIN`), mais o fail-closed (sem lista de contas → `campo_obrigatorio_ausente`) e os controles (`FULL_ACCESS` passa; `CLOSE_ONLY` arranca marcado `so_fecha`). Dentro de `casos/correr.py` → **85 · 85**. A **camada em falta** (a terceira recusa, `prazo_excedido`) fica onde o desenho já a provava: `casos/prova-envio.py` US6 (f) — é uma porta COM estado (o duplo do transporte), e não um caso em dado puro. **Provas negativas** (no harness): com a comparação de identidade/direitos a aceitar tudo, os casos `divergente-…` e `direitos-NO_TRADING-…` ficam VERMELHOS a nomeá-lo (`ok=True, esperado=False`)
- [x] T016 [US1] Escrever `relatorios/linha-de-base.txt` com a medição de T001 + o estado dos portões deste conector — **feito:** o ficheiro ganhou a **nota datada de 05/10/2026** (porta única **56 de 56**, as quatro bancadas, `contracts/` **0**)

## Fase 4 — A sonda e o manifesto (US1) — fechada

- [x] T017 [P] [US1] `sonda.py`: símbolos **com deslistados** (`includeArchivedSymbols`) + conta; produzir o manifesto campo a campo, conforme `data-model.md` §1 — **feito (passo 2):** a porta `sonda_e_manifesto` passa e o manifesto é aceite pelo contrato; **1941** nomes distintos lidos do venue
- [x] T018 [P] [US1] `sonda.py`: resolver **nome → `symbolId`** pelo nome da ficha; nome ausente ou **ambíguo** é recusa nomeada (FR-054) — **feito:** `instrumento_desconhecido_no_manifesto`, a **nomear** o nome e o universo (passo 2)
- [x] T019 [US1] O manifesto declara o que o venue **não** suporta (`reduce_only`, `stop_anexo`, `sabe_ajustar_alavancagem`) — declarar não é lacuna — **feito:** `sonda.py` publica `reduce_only_suportado: false`, `stop_anexo: true` (prende o stop à posição) e `sabe_ajustar_alavancagem: false`
- [x] T020 [US1] `moneyDigits` lido da conta a **cada** leitura (nunca chave nossa) e aplicado aos valores monetários (FR-053) — **feito:** o expoente vem publicado na conta e é usado; casos `leitura/expoente-do-venue-publicado-na-posicao-e-usado` e `leitura/expoente-dos-valores-ausente-recusa` (**11** casos da leitura)
- [x] T021 [US1] Bancada: manifesto com uma mudança de `stepVolume` simulada numa fixture → o manifesto seguinte reflecte-a **sem tocar em código** (SC-015 no espírito, US1 cenário 2) — **feito:** dois casos novos em `casos/sonda.casos.json` (`casos_do_manifesto`) montam o manifesto pela função PURA `sonda.montar_manifesto` a partir da fixture do símbolo; o caso `manifesto-seguinte-reflecte-a-mudanca-do-stepVolume-sem-tocar-em-codigo` muda a fixture (`passo` = 10 → 25, em 0,01 de unidade) e exige o reflexo (`passo` = `0.1` → `0.25`) pela MESMA função — nenhuma linha de código muda entre os dois manifestos, e ambos passam o contrato (`aceite`). Dentro de `casos/correr.py` → **85 · 85**. **Prova negativa** (no harness): com o `passo` fixo no código, o caso fica VERMELHO a nomear `depois.instrumento.passo: veio "0.1", esperado "0.25"`

## Fase 5 — A leitura (US1, US5) — fechada

- [x] T022 [P] [US1] `leitura.py`: conta (saldo, expoente), posições, ordens vivas e mercado — conforme `data-model.md` §6 — **feito (passo 9):** `casos/prova-leitura.py` (**7 · 7**) e os casos em dado da leitura (**11**)
- [x] T023 [US1] O **equity derivado**: saldo + Σ não realizado do venue (`ProtoOAGetPositionUnrealizedPnLRes`), com a soma **declarada** (achado 1) — **feito:** caso `leitura/equity-derivado-e-a-soma-do-nao-realizado`
- [x] T024 [US1] Spots com `bid`/`ask` opcionais um a um (RN-CT29) e livro por deltas (`newQuotes`/`deletedQuotes`) com as divisões certas (`/100000`, `/100`) — **feito (passo 9):** o último retrato por símbolo, bid/ask opcionais (lado ausente fica AUSENTE, nunca zero), livro por deltas (remover id inexistente não inventa nada) — `casos/prova-leitura.py` (**7 · 7**)
- [x] T025 [US5] **Duas posições no mesmo instrumento** numa conta hedging → **recusa nomeada** da leitura (`duas_posicoes_no_mesmo_instrumento`), nunca escolher uma (achado 3) — **feito:** caso em dado `leitura/hedged-com-duas-posicoes-no-mesmo-instrumento-recusa`
- [x] T026 [US1] Bancada: leitura com fixtures de conta/posições/livro, incluindo os casos-limite das unidades (expoente, `/100000`, `/100`) — **feito:** `casos/leitura.casos.json` (**11** casos) + `casos/prova-leitura.py` (**7 · 7**)

## Fase 6 — A boleta, a resolução e o envio (US2, US3) — fechada

- [x] T027 [P] [US2] `ordens.py`: a **primeira metade** da boleta (percentagem do saldo × alavancagem → volume em 0,01), com `minVolume`/`maxVolume`/`stepVolume` conferidos **antes** de enviar (FR-055) — **feito:** `casos/ordens.casos.json` (**25** casos) dentro de `correr.py` (**85 · 85**)
- [x] T028 [P] [US2] `ordens.py`: `stop_pct`/`tp_pct` → relativos em 1/100000, com o sinal conforme o lado, conferidos a `slDistance`/`tpDistance` (FR-057) — **feito:** casos `ordens/stop-limite-aceite-e-o-stop-e-o-alvo-saem-relativos-com-sinal` e `ordens/VENDA-o-stop-e-o-alvo-levam-o-sinal-do-lado-negativo`
- [x] T029 [US2] As recusas nomeadas: fora do passo, abaixo do mínimo, acima do máximo, stop/alvo abaixo do piso, absoluto a mercado, desvio em tipo que não o aceita, `reduce_only` pedido (FR-056/058/059) — **feito:** as recusas estão em dado (ex. `volume-fora-do-passo-do-simbolo-recusa`, `reduce-only-pedido-recusa-o-venue-nao-o-tem`, `reducao-parcial-este-venue-nao-a-sabe-fazer-recusa`) — **85 · 85**
- [x] T030 [US2] O **mapeamento de vocabulário** (`data-model.md` §5) num só sítio, e a recusa do tipo de ordem fora do manifesto (FR-060) — **feito:** caso `ordens/tipo-de-ordem-fora-do-manifesto-recusa`; mapeamento no `ordens.py` (**85 · 85**)
- [x] T031 [US3] A **marca de posse** em `clientOrderId` (≤ 50), gerada pela mesa e transportada tal e qual; o reenvio da mesma marca não gera segunda ordem (FR-061) — **feito:** `casos/prova-envio.py` (**32 · 32**), com o reinício a resolver `referencia_ja_enviada_ao_venue` (US5 (g))
- [x] T032 [US3] A **resolução** escrita antes do envio, com os números do venue quando ele os dá (FR-062) — **feito, com o limite dito:** a resolução sai só quando o venue deu os números (`numeros_do_venue`); sem eles o contrato recusa por `campo_obrigatorio_ausente` — e o corredor **exige essa recusa** (`correr.py`, «a resolução pré-envio é parcial, e isso é o estado honesto»). Em `MARKET` o venue só calcula ao executar — a resolução sai **depois**, com os números dele
- [x] T033 [US3] O envio em si, com `timeInForce`/`baseSlippagePrice` conforme o tipo, e a nova tentativa **só** por reconciliação — **feito (passo 4):** `colocar_ordem`/`fechar_posicao` no `transporte.py`; a boleta deixou de cair em `capacidade_nao_declarada` — `casos/prova-envio.py` (**32 · 32**)
- [x] T034 [US2] Bancada: uma boleta por regra — cada recusa com o motivo nomeado, e **zero** mensagens de ordem no venue (contagem medida) — **feito:** `casos/ordens.casos.json` + a contagem de mensagens ao protocolo nas provas do envio (**32 · 32**)

## Fase 7 — O desfecho e o fecho (US3, US4) — fechada

- [x] T035 [P] [US3] `desfecho.py`: `executionType`/`orderStatus`/`dealStatus` → as 4 classificações neutras; os três tipos que **não** são ordens vão para acontecimentos de conta (FR-063) — **feito:** `casos/desfecho.casos.json` (**13** casos, com `SWAP`/depósito/bónus separados) — **85 · 85**
- [x] T036 [P] [US3] O desfecho traz `positionId` e os números **lidos** (preço, volume executado, comissão, `marginRate`) — nenhum recalculado (FR-064) — **feito offline:** o desfecho **transporta** o que o venue deu (`desfecho/preenchimento-total-traz-o-positionId-e-os-numeros-do-venue`). A prova **contra o venue** fica por medir (dono — bateria)
- [x] T037 [US4] `fecho.py`: fecho por `positionId` + detalhe do fecho (`closePositionDetail`); sem posição, `nada` com motivo, e **nenhuma** ordem enviada (FR-065) — **feito:** as `checagens_de_fecho` de `casos/ordens.casos.json` (fecho por `positionId`, nunca por lado contrário; sem posição → `nada`), dentro de **85 · 85**
- [x] T038 [US4] Os dois modos `CLOSE_ONLY` (conta e símbolo): abertura recusada, fecho permitido (FR-066) — **feito:** `fecho/conta-CLOSE_ONLY-recusa-a-abertura-e-o-fecho-continua-a-passar` e `fecho/simbolo-CLOSE_ONLY_MODE-…` (**85 · 85**)
- [x] T039 [US4] Bancada: sequência de três aberturas/fechos sobre fixtures → zero posições no fim, três fechos, e o fecho do inexistente sem ordem (SC-017 no offline) — **feito:** `casos/ordens.casos.json` (`sequencias_de_fecho`) corre a SEQUÊNCIA sobre a fixture de posições que evolui (cada fecho tira a posição — o venue fecha-a): três aberturas e três fechos, a lista fica **vazia** no fim, três fechos com ordem (o `positionId` de cada um e o lado OPOSTO ao da posição), e o sétimo passo (fechar o inexistente) devolve `nada`/`sem_posicao_para_fechar` **sem ordem**. Os casos de uma decisão cada continuam em `checagens_de_fecho`. Dentro de `casos/correr.py` → **85 · 85**. **Prova negativa** (no harness): com o fecho do inexistente a mandar ordem, o caso fica VERMELHO a nomear `fecho do inexistente: tem_ordem=True, esperado=False`

## Fase 8 — O silêncio, a reconciliação e a rotação (US5, US6) — fechada

- [x] T040 [P] [US5] O prazo declarado (research R9) e o estado `desconhecida`: nem falha nem sucesso (FR-067) — **feito:** `desfecho_do_silencio` (`desfecho.py`, `CLASSIFICACAO_DO_SILENCIO = "desconhecido"`), caso `via: silencio`; a sonda com alavancagem **real (30)** produz o `desconhecido` completo (passo 5, A-12)
- [x] T041 [P] [US5] Com `desconhecida` pendente: ordem nova recusada, fecho permitido (FR-068) — **feito (passo 6):** ordem nova → `recusado`/`prazo_excedido`, **0** mensagens ao protocolo; fecho **passa** (a exposição desmonta-se) — `casos/prova-envio.py` (**32 · 32**)
- [x] T042 [US5] A reconciliação por leitura (posições/ordens/negócios por `positionId`, `orderId`, marca); leitura falhada **não** produz desfecho (FR-069) — **feito (passo 6):** `processo.reconciliar` lê as posições e o **registo de ordens** (`ordens_do_registo`) e acha a ordem pela marca; leitura falhada → **sem linha de desfecho** + diag `indecidivel` (**32 · 32**)
- [x] T043 [US6] A rotação do token como acontecimento: sessão `invalidada` → nenhuma ordem nova; re-autenticação **lê a conta antes** (FR-070) — **feito (passo 8):** `estado_da_sessao`/`seguir_a_sessao_da_conta` (quatro tratadores: `TokenInvalidatedEvent`, `AccountDisconnectEvent`, `ClientDisconnectEvent`, `ReadyEvent`); a re-autenticação marca releitura pendente e a leitura da conta vem **antes** do envio (**32 · 32**)
- [x] T044 [US5] O ritmo do venue respeitado (50/s, 5/s históricos) e a espera declarada — nunca «sem dados» (FR-071) — **feito (passo 7):** `casos/prova-ritmo.py` (**6 · 6**) — geral 50/s, histórico 5/s, classes independentes, espera declarada, relógio real em produção; prova negativa sem limitador → surto de 120 em 1 s, caso VERMELHO

## Fase 9 — As bancadas (transversal)

- [x] T045 [P] `casos/*.casos.json`: os casos em dado deste conector, na mesma forma dos do conector 1, e o runner que os corre offline — **feito:** seis ficheiros (`ficha` 8 · `identidade` 9 · `leitura` 11 · `ordens` 25 · `desfecho` 13 · `sonda` 6, mais as `checagens_*` de cada um) corridos por `casos/correr.py` → **85 · 85 · 0 divergentes**
- [ ] T046 [P] As fixtures do venue: payloads reais gravados em demonstração (sem valores de credencial), uma por mensagem que a fronteira toca — **por medir:** os casos em dado são um **duplo declarado** (não payloads gravados do venue). **Fecha-o o dono** (conta de demonstração autorizada)
- [x] T047 Correr os casos do contrato nos **dois** lados (dublê e conector) e registar a contagem; divergência é falha — **feito (o desenho, 05/10/2026, sem o dono):** o ficheiro `casos/casos-duble.json` (19 casos — 11 **payloads deste venue** em dado + 8 adversários) e a bancada `casos/correr-duble.py`, que corre os MESMOS casos pelo **dublê da mesa** (`contracts/mocks/mesa/main.py --papel conector`, com o venv do conector) E pelo **lado do conector** (o motor do contrato, `contracts/esqueleto/framing.py`, o mesmo que o `desfecho.py` usa antes de publicar), compara os veredictos caso a caso e **registra as duas contagens lado a lado**. Saída crua (`cd brokers/ctrader && .venv/bin/python casos/correr-duble.py`, rc=0): **«lado DUBLE (mesa, --papel conector): 19 casos · 19 ok · 0 divergentes» · «lado CONECTOR (framing.py, o motor do desfecho): 19 casos · 19 ok · 0 divergentes» · «conector offline (correr.py, os casos em dado deste venue): ctrader: 85 casos · 85 ok · 0 divergentes»**. Sem credencial, sem rede, sem ordem ao venue (`contracts/` intocado). Os casos **válidos** não trazem o desfecho escrito: a bancada MONTA-o por `desfecho_do_evento`/`desfecho_do_silencio` a partir de `desfecho.casos.json` — o que atravessa a fronteira é o que o conector **produz**, não uma cópia. **Divergência é FALHA NOMEADA**: a linha diz qual caso, o que o dublê disse e o que o conector disse. **Prova negativa dentro da bancada** (um veredicto do conector estragado de propósito): fica VERMELHA a nomear o caso — `{"negativa": "veredicto-estragado-do-conector", "o_caso_vigiado_ficou": "VERMELHO", "caso": "ctrader/desfecho-preenchimento-total", "divergencia": "…o DUBLE disse aceite/None e o CONECTOR disse recusado/campo_desconhecido"}`; com a negativa **vacuosa** o resumo passa a `· NEGATIVAS DIVERGENTES: 1` e o `rc` vira **1** (controlo anti-vacuidade medido). No modo explícito `--prova-negativa` o defeito entra no caminho REAL: a bancada fica **VERMELHA a nomear o caso** e o processo sai **1** — `*** PROVA NEGATIVA … ***` · `DIVERGE ctrader/desfecho-preenchimento-total … duble aceite/None · conector recusado/campo_desconhecido` · `ctrader/duble: 19 casos · 1 DIVERGENTES`, `rc=1`. A bancada entrou no `provar.sh` → a porta única passou a **57 de 57, rc=0**. **O que NÃO cobre, e di-lo:** só o lado **`desfecho`** (é o único tipo que o dublê confere no papel `conector`; ficha, identidade, leitura, ordens e sonda não são mensagens de um conector para a mesa); e o caso do `tipo` errado fica FORA, porque o dublê confere o **papel** e o motor confere o **envelope** — medem coisas diferentes de propósito. As fixtures gravadas em demonstração continuam na **T046** (dono)
- [x] T048 Ligar a bancada nova ao portão da casa (`provar.sh`) sem partir as verificações existentes — **feito (passo 7, A-2):** as **quatro** bancadas do ctrader estão no `provar.sh` (linhas 150–161) e a porta única deu **56 de 56, rc=0** — a T047 (05/10/2026) somou a **QUINTA** (`ctrader: contrato nos dois lados (19 casos)`, linhas 163–172), e a porta única passou a **57 de 57, rc=0**

## Fase 10 — Conformidade e neutralidade (US7, SC-014/SC-015)

- [x] T049 [US7] `conformidade/`: a bateria das **doze** provas, com o registo por versão e sem reescrever resultados anteriores (FR-073) — **feito (05/10/2026, sessão nova, D6/D7 fechados):** a bateria existe (`brokers/ctrader/conformidade/bateria.py`), correu **10×** contra a demonstração `45292558` e arquivou um registo NOVO por corrida (`1.12.0-2026-10-05.txt` … `-r10.txt`; nenhum anterior reescrito — FR-073). A última corrida (`-r10.txt`) deu **12 provas · 10 `passou` · 2 `nao_forcavel`** — as duas `nao_forcavel` são as provas **4** (sessão derrubada) e **5** (re-autenticação), que **não se forçam ao vivo sem inventar um mecanismo** e estão cobertas ao evento pela bancada offline `casos/prova-envio.py` US6 (declarado no próprio registo). A prova **8** publicou a linha `desfecho` `aceite` com os números do VENUE (`orderId 365295126`, `executedVolume 100000`, `executionPrice 112189`, `dealId 323200516`, comissão `-3`, `positionId 246833601`), a **10** (fecho por `positionId`) e a **12** (três aberturas e fechos → **zero posições**) passaram. Os dois bloqueios que aqui estavam estão fechados: **D6** (o venue manda `ORDER_ACCEPTED` e o preenchimento por EVENTO próprio; o conector passa a SEGUI-LO) e **D7** (a resolução do FECHO saía com 4 dos 5 campos). Notas datadas no fim deste documento e no `docs/maquina-de-estados-conector-ctrader.md`.
- [x] T050 [US7] Correr a bateria em **demonstração** e arquivar o relatório com os números crus (bid/ask, volume, comissão, ids) — **feito (05/10/2026):** os números CRUS do venue saem agora no próprio `desfecho` (`-r10.txt`): preço de execução `112189` (= 1.12189), `executedVolume 100000` (= 1000 unidades), comissão `-3` (= −0,03), `positionId 246833601`, `dealId 323200516`; e os fechos com o `closePositionDetail` do venue (`entry_price`, `gross_profit`, `commission`, `balance`). A conta ficou **LIMPA** no fim (a `LEITURA FINAL` da prova 12 deu **zero posições**, e o `finally` da bateria fecha tudo e grita se um fecho falhar).
- [x] T051 **SC-015 medido**: `git diff` do contrato antes/depois do recorte → **zero** alterações em `contracts/` por causa deste venue; e o portão a verde — **feito:** `git status --short contracts/` → **vazio**; a porta única **56 de 56, rc=0**
- [ ] T052 **SC-014 medido**: os dois conectores passam a mesma bateria (doze provas cada), com o resultado por versão; escrever a tabela comparativa dos dois relatórios no README do conector — **tabela ESCRITA (05/10/2026); o SC-014 NÃO fica medido, e a diferença está dita:** a tabela comparativa está na secção «SC-014, lado a lado» do `brokers/ctrader/README.md`, com os números dos dois registos e, ao lado de cada um, a linha de onde saiu. O que a medição mostra é que a **paridade que o SC-014 exige NÃO existe hoje**: a bateria do ctrader é **AO VIVO** (12 provas · 10 `passou` · 2 `nao_forcavel`; contrato **1.12.0**; 05/10/2026; contra a demo `45292558`), a do hyperliquid é **OFFLINE, com dublê de mesa** (9 provas · `9 de 9 passaram · 238 verificações · 0 divergentes`; contrato **1.4.0**; 29/09/2026; a linha do venue fica `INCOMPLETO`). **A decisão — (a) levar a bateria ao vivo ao hyperliquid, (b) mudar a redação do SC-014 para o que as duas provas de facto são, ou (c) outra — é do dono**, com o custo de cada lado escrito na mesma secção do README. **Fecha-o o dono**

---

## Bloqueios (do dono, não do código)

> **NOTA DATADA — 05/10/2026:** o bloqueio 1 mudou de estado. A app **está** registada na cTrader Open API e o
> **OAuth foi autorizado** (`tools/ctrader-autorizar.py`, os quatro valores gravados fora do repositório, modo
> 600): o conector já falou com o venue com credenciais válidas (arranque **8 de 8 portas**, listagem de contas,
> a conta de demonstração `45292558`). O que **fica** do bloqueio 1 é a **bateria das doze provas** (T049, T050,
> T052) — que exige a corrida contra a demonstração, decisão do dono. Os bloqueios 2 e 3 mantêm-se como estão.

1. **T049–T052** correm contra a **demonstração** com os tokens do dono (o OAuth já foi autorizado a 05/10/2026 —
   ver a nota acima). A conta de demonstração é a **NETTED** (`45292558`, achado 3).
2. **T013/T038** (direitos da conta) precisam de uma decisão do dono: operar a demonstração com `FULL_ACCESS`; o
   caso `CLOSE_ONLY` prova-se por configuração da corretora, se ela o permitir — senão fica provado só em dado
   (fixture) e **declarado** como tal.
3. **T019** (`parcial_suportada`) e **T025** dependem de respostas da conta de demonstração — o recorte **não**
   as presume: ficam `[?]` no manifesto até a sonda as ler.

## Dependências entre fases

- Fase 2 antes de 3–8 (a costura é o chão).
- Fase 3 antes de 4 (sem identidade não há sonda), e 4 antes de 5–8 (o manifesto dá os números).
- Fase 6 antes de 7 (sem envio não há desfecho).
- Fase 9 acompanha 3–8 (os casos nascem com o código que os cumpre).
- Fase 10 fecha: **é** o critério de pronto (SC-014/SC-015).

---

## Nota datada — 05/10/2026: o «Estado» antigo (01/10/2026), mantido por baixo

O bloco que este documento trazia (substituído no topo, e **não** apagado) dizia:

> **Estado** (01/10/2026): fase 1 fechada, e a **fase 2 feita** — o conector ja' arranca e recusa pelas oito
> portas. Medido no fim da fatia: `provar.sh` **33 de 33**, produto com **0 fallbacks**, `contracts/` com **0
> alteracoes**, e o arranque a sair com codigo **2** e **ZERO linhas na costura** quando falta a credencial. O
> codigo comecou ANTES dos tokens, de proposito: metade dele nao precisa deles (o resto espera em §Bloqueios).

**Porque mudou, e o que era mentira (A-6):** aquele texto **subestimava** o código — dizia «fase 2 feita» e
marcava as Fases 5–7 abertas quando `leitura.py`, `ordens.py`, `fecho.py`, `desfecho.py` e `sonda.py` já existiam
e passavam uma bancada; e o `provar.sh` **já não** era 33 de 33. O número repetia-se no `ONDE_ESTAMOS.md` (é do
outro recorte/documento; não se toca aqui). Hoje: porta única **57 de 57, rc=0**, e as cinco bancadas do ctrader
dentro dela — os números do topo deste ficheiro, cada um com o comando que o mediu.

---

## Nota datada — 05/10/2026 (mais tarde): a BATERIA ao vivo e os defeitos do caminho do dinheiro

A bateria das doze provas **correu contra a demonstração** (autorizada pelo dono) e, pela PRIMEIRA vez, a
**ordem saiu** — mas o caminho estava partido em vários sítios, todos **invisíveis às 85+27+6+7+19 provas
offline**, porque as fixtures levavam o valor JÁ descodificado/na unidade errada. Cada conserto leva caso EM DADO
(a injecção é o ENUM/o INTEIRO, não a cadeia) e a NEGATIVA dentro da bancada (defeito reposto → VERMELHO a
nomear). Fechados nesta vaga (a bancada `casos/correr.py` passou de **85** para **105 · 105 ok**):

- **D1 — `tradingMode` saía como ENUM cru.** `transporte._simbolo_por_dentro` publicava `simbolo.trading_mode`
  (o objecto `<TradingMode.ENABLED: 'ENABLED'>`): TODA a abertura recusava `capacidade_nao_declarada`. Conserto:
  **mapa declarado** membro→nome-do-proto (`MODOS_DE_NEGOCIACAO_POR_MEMBRO`), num só sítio, com recusa NOMEADA
  fora do mapa. Casos: um por membro do `TradingMode` (injectando o ENUM) + a recusa; negativa
  `negativa/trading-mode-sai-como-enum-cru`.
- **D2 — o `moneyDigits` sem fonte numa conta plana.** `leitura._expoente_dos_valores` recusava
  `expoente_dos_valores_ausente` sem posição (ovo-e-galinha: não se abre a primeira ordem). Conserto: o
  `transporte.trader` **pergunta-o ao VENUE** por `ProtoOATraderReq` (a posição fica a 2.ª fonte; divergência
  continua a RECUSAR). Casos: `transporte/expoente-do-trader-*` + `leitura/expoente-do-venue-na-conta-plana-*` e
  a divergência; negativa `negativa/moneyDigits-nao-lido-do-venue`.
- **D3 — unidades do dinheiro/preço na fronteira.** O `saldo` vinha como `Decimal` já dividido pela biblioteca
  (a leitura espera o INTEIRO escalado do venue); as posições/ordens/negócios publicavam `Decimal`/`datetime`
  crus (não são JSON e não são as unidades do contrato). Conserto: saldo = `ProtoOATrader.balance` cru; preços em
  inteiros relativos (`_escalado_do_preco`); dinheiro em texto; instantes em millis.
- **D5 — `desvio_maximo` (%) → pontos inteiros.** Sobre um preço de 5 decimais (EURUSD `1.12107`), 0,5% dá
  `560,535` pontos — e o venue só aceita pontos INTEIROS. Recusar (como antes) tornava **impossível enviar UMA
  ordem** (nenhuma percentagem finita cai na grelha de um preço de 5 decimais). Decisão (do dono corrigir se
  quiser): o desvio é uma **tolerância MÁXIMA**, logo arredonda-se **para BAIXO** (aceitar menos é o lado seguro;
  o TAMANHO continua a NUNCA se arredondar, FR-056). Caso + negativa `negativa/desvio-arredonda-para-cima`.
- **D-la — `_nome_do_proto` não lia o INTEIRO.** O evento do venue lido do fio traz os enums do PROTO como
  INTEIROS (`betterproto`), não membros: `_nome_do_proto` só olhava para `.name` e deixava passar o inteiro — o
  `desfecho.py` recusava o evento. Conserto: o inteiro sobe pela CLASSE do enum. Casos `transporte/nome-do-proto-*`
  + negativa `negativa/nome-do-proto-nao-le-o-inteiro`.
- **A BATERIA, dimensionada pela grelha viva.** O conector NÃO arredonda o volume: um `saldo_pct` fixo quase
  nunca cai no passo do símbolo. A bateria passa a CALCULAR o `saldo_pct` com os números vivos (saldo, preço,
  mínimo/passo), conferido pelo módulo PURO `ordens.volume_do_venue`, e a dar à corrida um sufixo ÚNICO (o registo
  do venue sobrevive ao processo).

**O que FALTA (D6, bloqueio seguinte, dito e não escondido):** o **DESFECHO** da ordem não sai. O venue responde
`ORDER_ACCEPTED` (sem `executedVolume`/`usedMargin`/`executionPrice`) e só DEPOIS manda o preenchimento; o
conector lê SÓ o primeiro evento, a resolução fica parcial (3 de 5 campos) e o contrato recusa o desfecho
(`campo_obrigatorio_ausente`). Consequência nas provas do dinheiro: a 8 envia e enche (posição criada), mas não
publica desfecho; a 10 e a 12 dependem dele. **Fecha-se seguindo o SEGUNDO evento (`ORDER_FILLED`)** ou relendo o
registo do venue para completar a resolução. T049/T050 só ficam `[x]` quando isto fechar. A conta ficou **limpa**
em todas as corridas (o `finally` da bateria fechou tudo).

## Nota datada — 05/10/2026 (ainda mais tarde): D6 e D7 FECHADOS — e as provas 8, 10 e 12 passam

O parágrafo acima descreve o bloqueio D6 **como ele estava**; esta nota diz o que o fechou, com os números. O
conserto vive em `transporte.py` + `processo.py` e mede-se em três provas ao vivo (registos `-r9.txt` e `-r10.txt`
em `conformidade/`, nenhum anterior reescrito — FR-073):

- **D6 — SEGUIR o preenchimento (05/10/2026).** O `transporte.py` liga um tratador das execuções **cruas** do venue
  no **protocolo** (`Protocol.on_event(ProtoOAExecutionEvent, …)` — o mesmo canal por onde o router da biblioteca
  as vê; NÃO o `ExecutionEvent` **achatado**, que perde `order`/`position`/`deal`), guarda-as convertidas na forma
  do contrato, e `esperar_o_preenchimento(marca, ordemId, prazo)` devolve o **evento decisivo** desta ordem dentro
  do prazo declarado. O `processo.py` só segue quando o evento **não traz os números** e a classificação é
  `aceite`/`parcial` (o `ORDER_ACCEPTED`); se o preenchimento não chegar no prazo, cai no **SILÊNCIO**
  (`desconhecido`, FR-067) + instrumento **PENDENTE** (FR-068) — **nunca um sucesso inventado**.
  **Medido ao vivo (sonda focada, 1 ordem):** o aceite traz `order`/`position` **sem** `executedVolume`/
  `usedMargin`/`executionPrice`; o preenchimento chega **por evento próprio** (`ORDER_FILLED` com
  `executedVolume`/`executionPrice`/`usedMargin`/`deal`), ~0,3 s depois.
- **D6-bis — os dois eventos do MESMO venue combinam-se.** O `position` do evento de preenchimento **não traz
  `marginRate`**, e o do FECHO não traz nem `usedMargin`; os dois campos que faltavam ao 5.º campo completam-se
  pela **DECLARAÇÃO** da boleta (a MESMA regra [C] do silêncio: `alavancagem_efectiva` = a pedida,
  `margem_empenhada` = `nocional / alavancagem`). No FECHO a margem ainda sai do **VENUE** (o `usedMargin` do
  evento ACEITE, que o de preenchimento omite) — os números do venue combinam-se, o preenchimento manda onde dá.
- **D7 — o FECHO também precisa dos cinco campos.** O fecho **não** tem resolução pré-envio e o
  `preco_de_liquidacao` não vinha do venue: com a alavancagem da bateria (**30**) a resolução saía com **4 dos 5**
  campos e o contrato recusava-a (a prova **10** ficava bloqueada). Projeta-se pela mesma regra [C] do pré-envio
  sobre o **preço de execução do VENUE** ao `tick` do símbolo; sem preço ou sem `tick`, o campo fica ausente e o
  contrato recusa, como antes.

**Provas (bancada offline, `casos/prova-envio.py`, agora 32 · 32):** os casos `(D6) seguir o preenchimento` e
`(D7) fecho a alavancagem 30 completa a resolução` injectam a **SEQUÊNCIA EM DADO** (aceite parcial → preenchimento
pelo tratador de eventos do protocolo) na **forma real do venue** (sem `marginRate`), e as negativas
(`sem seguir o preenchimento`, `sem a projeção do fecho`, `sem a completação declarada`) exigem o **VERMELHO** a
nomear cada caso.

**Bateria ao vivo (`-r10.txt`):** `12 provas · 10 passou · 2 nao_forcavel` (as provas 4 e 5, declaradas). A prova
**8** publicou a linha `desfecho` `aceite` com os números do VENUE; a **10** fechou por `positionId` com o
`closePositionDetail`; a **12** fez três aberturas e fechos e a **LEITURA FINAL** deu **zero posições**. T049/T050
ficam `[x]`. (A linha do portão **dentro** do `-r10.txt` saiu `RECUSADO — outra bateria esta a correr`: outra
sessão segurava a trava do `provar.sh` na mesma árvore; o portão correu limpo no `-r9.txt` — **57 de 57, rc=0** —
e é corrido à parte no fecho desta vaga.)

---

## Nota datada — 05/10/2026 (a VIRADA DE MÃO implementada e medida ao vivo)

O contrato 1.10.0(c) manda o conector executar **as duas pernas na MESMA passagem** quando o venue não faz
netting — e este venue não faz (`reduce_only_suportado: false`, RN-CT34). O conector ctrader **recusava**
`reverter: true` a nomear (`capacidade_nao_declarada`, medido ao vivo pela prova 14 da bateria a 05/10/2026:
**0 mensagens ao fio**), o que deixava a mesa sem poder emitir `reverse` (contrato 1.10.0(a)) nesta ponta. Agora
**executa**:

- **`ordens.py`** — a porta da virada deixou de recusar: **confere** a DECLARAÇÃO e a POSIÇÃO VIVA que o conector
  lê do venue (entra como `pedido.posicao_a_reverter`, como o `saldo` e o `preco`). Sem posição viva, com o lado
  dela ilegível, ou já no lado declarado: **recusa NOMEADA** `reversao_sem_posicao_a_reverter` (o motivo do
  vocabulário; nada inventado). A contradição `reverter: true` + `reduce_only: true` **continua** a recusar
  (`reversao_com_reduce_only`). O montante da abertura sai como sempre (`saldo_pct`), pelo mandato — a boleta
  continua em unidades NEUTRAS (RN-B0).
- **`processo.py`** — `_enviar_reversao_e_desfechar`: com uma posição viva do lado OPOSTO, **fecha-a**
  (`fechar_posicao`, por `positionId`, com o volume que o venue publicou) e **abre o lado declarado**
  (`colocar_ordem`), na mesma passagem, pelos dois verbos que o transporte já tinha. O **desfecho** é UM só e
  descreve a posição que **FICA** (a nova), com os números do VENUE (FR-064) e os cinco campos da `resolucao`
  (RN-C10); as duas pernas vão nomeadas em `resposta_do_venue.virada`.
- **Nunca meia virada em silêncio** — as duas pernas passam pela MESMA máquina (`_mandar_e_seguir`, extraída do
  `_enviar_e_desfechar`, que continua a usá-la): se o FECHO é recusado, a ABERTURA **não** se envia e o desfecho
  diz que a viva continua; se o FECHO fica `desconhecido`, a ABERTURA **não** se envia e o instrumento fica
  **PENDENTE** (US5/US6); se o fecho passa e a ABERTURA falha, o desfecho nomeia **plano**.
- **Provas offline** — `casos/ordens.casos.json`: **4 casos novos** (posição oposta → abre o lado declarado;
  `reverter`+`reduce_only` → recusa; sem posição → recusa nomeada; posição do mesmo lado → recusa), dentro de
  `correr.py` → **109 · 109 ok**. Negativa DENTRO do corredor: `negativa/virada-sem-posicao-aceita` (tirada a
  conferência, o caso fica **VERMELHO** a nomeá-lo). `casos/prova-envio.py` → **36 · 36 ok**, com a SEQUÊNCIA
  (viva → lado novo: `ProtoOAClosePositionReq` e depois `ProtoOANewOrderReq`, 2 pedidos ao fio, desfecho com a
  posição NOVA e os números do venue), a MEIA VIRADA (fecho recusado → abertura **não** enviada, 1 pedido), a
  virada SEM posição (recusa nomeada, **0** pedidos), e a negativa que repõe o comportamento ANTIGO (a sequência
  fica VERMELHA).
- **Prova AO VIVO** — `conformidade/bateria.py` contra a demonstração `45292558`, registo
  `1.12.0-2026-10-05-r12.txt`: **15 provas · 13 `passou` · 2 `nao_forcavel`**. A **prova 14** (a VIRADA DE MÃO)
  **PASSOU**: `fio_ordens=2` (`colocar_ordem=1` + `fechar_posicao=1`), o `o_que_fica` com os números do VENUE
  (`positionId 246850042`, `lado buy`, `volume 100000`, `preco 112236`, `margem 37.41`), o nocional e a
  alavancagem a conferir, e a conta **LIMPA** no fim (`0 posições, 0 ordens vivas`, lida por fora). As provas
  **13** (VENDA) e **15** (ALAVANCAGEM 5) também passaram.
- **`provar.sh`** → **57 de 57, rc=0**; `git status --short contracts/` → **vazio** (SC-015).

**Nota de higiene, dita:** o portão estava **vermelho** antes desta vaga por **2 fallbacks** em
`conformidade/bateria.py` (as linhas 832 e 914, escritas na auditoria): `str(valores.get(..., "ausente"))` e
`str(vivas[0].get("lado", "")).upper()`. Foram reescritas pela forma que **não** tapa a ausência (o portão volta
a 57/57). E o `specs/005-conector-ctrader/relatorios/AUDITORIA-2026-10-05.md` e o `docs/ONDE_ESTAMOS.md` dizem
que o ctrader «recusa a nomear» a inversão — a primeira linha era verdadeira antes desta vaga e fica dita aqui
como **superada** (o `ONDE_ESTAMOS.md` é de outro recorte e não se toca neste; a linha do ctrader fica corrigida
na fonte que este recorte governa: `tasks.md`).
