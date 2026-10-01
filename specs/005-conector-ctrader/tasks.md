# Tasks — o segundo conector (cTrader, demonstração)

**Input**: `specs/005-conector-ctrader/` — `spec.md` (7 histórias, FR-045..073, SC-013..018), `plan.md` (as cinco
decisões), `research.md` (R1–R9), `data-model.md` (§0–§7, com os cinco achados).

**Testes**: incluídos **não por opção** — a bancada declarada existe **antes** do código que a cumpre. Duas: a
**offline** (casos em dado, corre sempre) e a **bateria de conformidade** (demonstração, doze provas). O que
distingue este recorte: cada prova tem de dizer também **o que o contrato** recebeu — a neutralidade mede-se.

**Formato**: `[ID] [P?] [História] Descrição` — `[P]` = ficheiros diferentes, sem dependência.

**Estado** (01/10/2026): fase 1 fechada, e a **fase 2 feita** — o conector ja' arranca e recusa pelas oito
portas. Medido no fim da fatia: `provar.sh` **33 de 33**, produto com **0 fallbacks**, `contracts/` com **0
alteracoes**, e o arranque a sair com codigo **2** e **ZERO linhas na costura** quando falta a credencial. O
codigo comecou ANTES dos tokens, de proposito: metade dele nao precisa deles (o resto espera em §Bloqueios).

---

## Fase 1 — Linha de base e documentos (fechada)

- [x] T001 Medir a linha de base e escrevê-la em `relatorios/linha-de-base.txt`: `provar.sh` (33 de 33), casos do contrato, versão do contrato (**1.9.0**), e a árvore limpa por fora — **feito:** portão 33/33, contrato 1.9.0, 22 formas, fallbacks 0 (relatório por escrever; a medição está no commit `efae7c5`)
- [x] T002 [P] Escrever a **regra de negócio do venue** — `docs/regra-de-negocio-ctrader.md`, 42 regras `RN-CT*`, cada linha com marca `[F]`/`[E]`/`[?]` — **feito:** commit `f183755`
- [x] T003 [P] Escrever a **máquina de estados do conector** — `docs/maquina-de-estados-conector-ctrader.md`, 4 eixos, tabela, 3 ausências deliberadas, invariantes — **feito:** commit `f183755`
- [x] T004 [P] Escrever a **spec** e a checklist — **feito:** commit `efae7c5`
- [x] T005 [P] Escrever **plano** (5 decisões), **research** (R1–R9), **data-model** (§0–§7) e **quickstart** — **feito:** este documento e os seus irmãos

## Fase 2 — A costura e o transporte (US1) — feita

- [x] T006 Criar `brokers/ctrader/` com `README.md` (o que entrega, o que não, e as declarações dos achados 1–5) e `.gitignore` (manifesto do runtime, `.venv`, `conformidade/`) — **feito:** ambos, com o `.gitignore` a proteger também `*credencial*.json`/`*.key`
- [x] T007 [P] `processo.py`: a costura — uma mensagem JSON por linha, no protocolo do contrato (`contracts/esqueleto/`), espelho de `brokers/hyperliquid/processo.ts`; recusa de enquadramento inválido **antes** de qualquer tradução — **feito:** usa o `framing.py` PARTILHADO (não uma cópia), diagnóstico no `stderr`, e o contrato a validar cada resposta antes de a publicar (medido: uma resposta mal formada foi RECUSADA e a costura ficou limpa)
- [x] T008 [P] `transporte.py`: embrulhar a biblioteca (sessão, protobuf, OAuth, reconexão) **sem** deixar nenhum tipo dela atravessar a fronteira; versão fixada (0.11.0) e licença declarada — **feito em parte:** a dependência está fixada no `pyproject.toml`/`uv.lock` (0.11.0, D2) e o embrulho é a próxima fatia (as portas 6-8 dizem-no: `conferencia_por_escrever`)
- [x] T009 Criar `.venv` com `uv` e fixar as dependências (`pyproject.toml`/lock) dentro de `brokers/ctrader/`; provar que o `provar.sh` da casa continua 33/33 com a pasta nova — **feito:** Python 3.12.14 + `jsonschema 4.26.0` + `ctrader-api-client 0.11.0`; e o portão **obrigou a uma correcção da casa**: o conferidor de fallbacks varria o `.venv` (dependências não são produto) e não conhecia o lado Python (`or "x"`/`get(k,"x")`)

## Fase 3 — Arranque: portões, identidade, credencial (US1) — feita

- [x] T010 [P] [US1] `identidade.py`: `ctidTraderAccountId` contra o ficheiro da conta, no arranque **e** em cada re-autenticação; `identidade_da_conta_divergente` com os dois ids — **feito** (função pura, com os dois ids ditos no motivo)
- [x] T011 [P] [US1] `credencial.py`: as três referências (client secret, access, refresh) lidas de ficheiro **fora do repositório**; a rotação reescreve-o e o conector relê; nenhum valor em estado, log ou mensagem — **feito:** um ficheiro único com os QUATRO valores (o trio + o id da conta), modo 600 exigido, varredura ao repositório, e um piso de 16 caracteres (senão um `a` fazia acusar o dono de ter uma chave versionada — medido)
- [x] T012 [US1] Os **oito portões** da casa no arranque, na ordem do conector 1, + os três deste venue (identidade, `accessRights`, duas camadas); cada portão com o seu motivo nomeado — **feito:** os oito na ordem, com o critério do custo/alcance; os três deste venue estão declarados `nao_corrida` porque exigem o transporte
- [x] T013 [US1] `accessRights`: `CLOSE_ONLY`/`NO_TRADING`/`NO_LOGIN` lidos e aplicados — abertura recusada com o direito nomeado, fecho permitido (FR-066) — **feito:** conjunto FECHADO (valor desconhecido recusa), `CLOSE_ONLY` arranca e declara `so_fecha`, `NO_TRADING`/`NO_LOGIN` recusam o arranque
- [ ] T014 [US1] As **duas camadas** como dois estados (transporte × sessão) e a regra: enviar exige as duas prontas (FR-048) — **por fazer:** a regra está escrita e a porta 6 declara-a; falta o código que a tem, e ele vive no transporte
- [ ] T015 [US1] Bancada: portão de identidade divergente, de direitos insuficientes e de camada em falta — três casos em dado, três recusas nomeadas — **por fazer:** as funções estão provadas por execução directa; os casos em dado são a próxima fatia (T045)
- [ ] T016 [US1] Escrever `relatorios/linha-de-base.txt` com a medição de T001 + o estado dos portões deste conector — **por fazer**

## Fase 4 — A sonda e o manifesto (US1)

- [ ] T017 [P] [US1] `sonda.py`: símbolos **com deslistados** (`includeArchivedSymbols`) + conta; produzir o manifesto campo a campo, conforme `data-model.md` §1
- [ ] T018 [P] [US1] `sonda.py`: resolver **nome → `symbolId`** pelo nome da ficha; nome ausente ou **ambíguo** é recusa nomeada (FR-054)
- [ ] T019 [US1] O manifesto declara o que o venue **não** suporta (`reduce_only: false`, `stop_anexo: false`, `sabe_ajustar_alavancagem: false`) — declarar não é lacuna
- [ ] T020 [US1] `moneyDigits` lido da conta a **cada** leitura (nunca chave nossa) e aplicado aos valores monetários (FR-053)
- [ ] T021 [US1] Bancada: manifesto com uma mudança de `stepVolume` simulada numa fixture → o manifesto seguinte reflecte-a **sem tocar em código** (SC-015 no espírito, US1 cenário 2)

## Fase 5 — A leitura (US1, US5)

- [ ] T022 [P] [US1] `leitura.py`: conta (saldo, expoente), posições, ordens vivas e mercado — conforme `data-model.md` §6
- [ ] T023 [US1] O **equity derivado**: saldo + Σ não realizado do venue (`ProtoOAGetPositionUnrealizedPnLRes`), com a soma **declarada** (achado 1)
- [ ] T024 [US1] Spots com `bid`/`ask` opcionais um a um (RN-CT29) e livro por deltas (`newQuotes`/`deletedQuotes`) com as divisões certas (`/100000`, `/100`)
- [ ] T025 [US5] **Duas posições no mesmo instrumento** numa conta hedging → **recusa nomeada** da leitura (`duas_posicoes_no_mesmo_instrumento`), nunca escolher uma (achado 3)
- [ ] T026 [US1] Bancada: leitura com fixtures de conta/posições/livro, incluindo os casos-limite das unidades (expoente, `/100000`, `/100`)

## Fase 6 — A boleta, a resolução e o envio (US2, US3)

- [ ] T027 [P] [US2] `ordens.py`: a **primeira metade** da boleta (percentagem do saldo × alavancagem → volume em 0,01), com `minVolume`/`maxVolume`/`stepVolume` conferidos **antes** de enviar (FR-055)
- [ ] T028 [P] [US2] `ordens.py`: `stop_pct`/`tp_pct` → relativos em 1/100000, com o sinal conforme o lado, conferidos a `slDistance`/`tpDistance` (FR-057)
- [ ] T029 [US2] As recusas nomeadas: fora do passo, abaixo do mínimo, acima do máximo, stop/alvo abaixo do piso, absoluto a mercado, desvio em tipo que não o aceita, `reduce_only` pedido (FR-056/058/059)
- [ ] T030 [US2] O **mapeamento de vocabulário** (`data-model.md` §5) num só sítio, e a recusa do tipo de ordem fora do manifesto (FR-060)
- [ ] T031 [US3] A **marca de posse** em `clientOrderId` (≤ 50), gerada pela mesa e transportada tal e qual; o reenvio da mesma marca não gera segunda ordem (FR-061)
- [ ] T032 [US3] A **resolução** escrita antes do envio, com os números do venue quando ele os dá (FR-062)
- [ ] T033 [US3] O envio em si, com `timeInForce`/`baseSlippagePrice` conforme o tipo, e a nova tentativa **só** por reconciliação
- [ ] T034 [US2] Bancada: uma boleta por regra — cada recusa com o motivo nomeado, e **zero** mensagens de ordem no venue (contagem medida)

## Fase 7 — O desfecho e o fecho (US3, US4)

- [ ] T035 [P] [US3] `desfecho.py`: `executionType`/`orderStatus`/`dealStatus` → as 4 classificações neutras; os três tipos que **não** são ordens vão para acontecimentos de conta (FR-063)
- [ ] T036 [P] [US3] O desfecho traz `positionId` e os números **lidos** (preço, volume executado, comissão, `marginRate`) — nenhum recalculado (FR-064)
- [ ] T037 [US4] `fecho.py`: fecho por `positionId` + detalhe do fecho (`closePositionDetail`); sem posição, `nada` com motivo, e **nenhuma** ordem enviada (FR-065)
- [ ] T038 [US4] Os dois modos `CLOSE_ONLY` (conta e símbolo): abertura recusada, fecho permitido (FR-066)
- [ ] T039 [US4] Bancada: sequência de três aberturas/fechos sobre fixtures → zero posições no fim, três fechos, e o fecho do inexistente sem ordem (SC-017 no offline)

## Fase 8 — O silêncio, a reconciliação e a rotação (US5, US6)

- [ ] T040 [P] [US5] O prazo declarado (research R9) e o estado `desconhecida`: nem falha nem sucesso (FR-067)
- [ ] T041 [P] [US5] Com `desconhecida` pendente: ordem nova recusada (`desconhecido_por_reconciliar`), fecho permitido (FR-068)
- [ ] T042 [US5] A reconciliação por leitura (posições/ordens/negócios por `positionId`, `orderId`, marca); leitura falhada **não** produz desfecho (FR-069)
- [ ] T043 [US6] A rotação do token como acontecimento: sessão `invalidada` → nenhuma ordem nova; re-autenticação **lê a conta antes** (FR-070)
- [ ] T044 [US5] O ritmo do venue respeitado (50/s, 5/s históricos) e a espera declarada — nunca «sem dados» (FR-071)

## Fase 9 — As bancadas (transversal)

- [ ] T045 [P] `casos/*.casos.json`: os casos em dado deste conector, na mesma forma dos do conector 1, e o runner que os corre offline
- [ ] T046 [P] As fixtures do venue: payloads reais gravados em demonstração (sem valores de credencial), uma por mensagem que a fronteira toca
- [ ] T047 Correr os casos do contrato nos **dois** lados (dublê e conector) e registar a contagem; divergência é falha
- [ ] T048 Ligar a bancada nova ao portão da casa (`provar.sh`) sem partir as 33 verificações existentes

## Fase 10 — Conformidade e neutralidade (US7, SC-014/SC-015)

- [ ] T049 [US7] `conformidade/`: a bateria das **doze** provas, com o registo por versão e sem reescrever resultados anteriores (FR-073)
- [ ] T050 [US7] Correr a bateria em **demonstração** e arquivar o relatório com os números crus (bid/ask, volume, comissão, ids)
- [ ] T051 **SC-015 medido**: `git diff` do contrato antes/depois do recorte → **zero** alterações em `contracts/` por causa deste venue; e o portão a verde
- [ ] T052 **SC-014 medido**: os dois conectores passam a mesma bateria (doze provas cada), com o resultado por versão; escrever a tabela comparativa dos dois relatórios no README do conector

---

## Bloqueios (do dono, não do código)

1. **T049–T052** não correm sem: app registada na cTrader Open API (`client_id`/`client_secret`), conta de
   demonstração (**NETTED** — achado 3), e uma autorização OAuth com os tokens guardados fora do repositório.
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
- Fases 10 fecha: **é** o critério de pronto (SC-014/SC-015).
