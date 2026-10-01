# A regra de negócio do conector — cTrader (Open API)

Escrito 01/10/2026 · contrato 1.9.0 · irmão de `regra-de-negocio-conector.md` (Hyperliquid) e da
`maquina-de-estados-conector-ctrader.md`.

Marcas: **[F]** fonte lida (a doc oficial do venue, com o URL; ou o código da versão instalada, com o caminho) ·
**[E]** medido por execução (o que correu neste host) · **[?]** inferido, por confirmar na bateria.

A família de regras deste venue é **`RN-CT*`** (as `RN-C*` são as do conector em geral, iguais para todos).

## 0. O que um conector é, e o que não é

Traduz e transporta (RN-C5, RN-C15). Não decide lado, tamanho, preço nem momento; não lê estratégia, mandato nem
fichas; não conhece risco. **Um processo por (corretora, conta), uma ligação, uma chave** (RN-C16, RN-E3) — e quem
o arranca é a camada de operação (RN-E21), nunca o core. Vale igual para o cTrader: o que muda é a língua, não o
lugar.

## 1. O transporte, e o que ele cobra

| Regra | Facto | Evidência |
|---|---|---|
| RN-CT1 | A API fala **Protobuf ou JSON**, os dois neutros de linguagem; a doc recomenda SDK oficial para Protobuf (C# e Python — `spotware/OpenAPI.Net`, `spotware/OpenApiPy`) | [F] `help.ctrader.com/open-api/` |
| RN-CT2 | **Limites de ritmo por ligação:** 50 pedidos/s para dados não-históricos, **5 pedidos/s para históricos** | [F] idem |
| RN-CT3 | Endereços: `demo.ctraderapi.com` e `live.ctraderapi.com`, porta **5035**, TLS; heartbeat e prazos são parâmetros do cliente | [E] `ctrader-api-client` 0.11.0, `config.py` |
| RN-CT4 | Ao **contrário da Hyperliquid**, este venue tem duas coisas separadas que o resto da casa junta numa: a **ligação** (transporte vivo) e a **sessão da conta** (autorizada). Uma pode estar viva com a outra caída — e o venue avisa por evento (`ProtoOAAccountDisconnectEvent`) | [F] `messages/` |
| RN-CT5 | O venue publica a **versão do próprio esquema** (`ProtoOAVersionReq`) — a sonda pode datá-la por leitura, em vez de a assumir | [F] idem |

## 2. Autenticação e identidade

| Regra | Facto | Evidência |
|---|---|---|
| RN-CT6 | OAuth 2.0. O **código de autorização** vive **1 minuto**; o **token de acesso** vive **~30 dias** (2 628 000 s); o **token de actualização não expira** | [F] `account-authentication/` |
| RN-CT7 | O percurso é em três passos e nenhum se salta: `ProtoOAApplicationAuthReq(clientId, clientSecret)` → `ProtoOAGetAccountListByAccessTokenReq(accessToken)` → **`ProtoOAAccountAuthReq(ctidTraderAccountId, accessToken)`** | [F] idem |
| RN-CT8 | **A identidade da conta é o `ctidTraderAccountId`** — é ele que se compara com o ficheiro da conta no arranque. Não há endereço, não há login: um id. | [F] idem |
| RN-CT9 | Os âmbitos são dois: `accounts` (só leitura) e `trading` (leitura e operações). Sem `trading`, o venue recusa enviar — e é o venue que o diz, na mensagem | [F] idem |
| RN-CT10 | **A rotação invalida o par anterior e pode derrubar a sessão da conta:** o venue emite `ProtoOAAccountsTokenInvalidatedEvent` com a razão (`token was refreshed`, `revoked`, …). Logo um refresh é um acontecimento da **máquina de estados**, não um detalhe do cliente HTTP | [F] `messages/` |
| RN-CT11 | O **Playground** do portal emite um par de tokens para o próprio cTID — é o caminho do dono para a primeira corrida, sem escrever o fluxo OAuth | [F] `account-authentication/` |
| RN-CT12 | **Direitos da conta** (`ProtoOAAccessRights`): `FULL_ACCESS`, `CLOSE_ONLY`, `NO_TRADING`, `NO_LOGIN`. Numa conta `CLOSE_ONLY` a abertura é recusada e o **fecho continua permitido** — a mesma assimetria que o resto da casa já assume | [F] `model-messages/` |

## 3. A conta

| Regra | Facto | Evidência |
|---|---|---|
| RN-CT13 | `ProtoOATrader` traz `balance`, `moneyDigits`, `leverageInCents`, `maxLeverage`, `accountType`, `accessRights`, `isLimitedRisk`, `depositAssetId`, `brokerName`, `registrationTimestamp`, `stopOutStrategy`, `fairStopOut` | [F] `model-messages/` |
| RN-CT14 | **Os valores monetários são inteiros escalados:** `moneyDigits` é o expoente (`10053099944` com `moneyDigits = 8` são `100.53099944`). Ler sem aplicar o expoente dá um saldo mil vezes maior — e o número errado é do venue, o que o torna silencioso | [F] idem |
| RN-CT15 | **A conta NÃO publica `equity`.** O campo existe na doc, mas no registo de operações de saldo (equity *depois* da operação), não no retrato da conta. A leitura do equity é, portanto, **conta NOSSA** (saldo + resultado não realizado) e tem de vir declarada como derivada | [F] idem |
| RN-CT16 | A alavancagem que o dono pode pedir tem **dois** números: `leverageInCents` (a que vigora) e `maxLeverage` (o tecto daquele activo) — os dois por conta, e `ProtoOASymbol.leverageId` liga o símbolo ao escalão | [F] idem |
| RN-CT17 | **O modelo de posição é da CONTA, não do venue:** `ProtoOAAccountType` = `HEDGED` (várias posições por símbolo) ou `NETTED` (uma só). *(Esta linha corrige a tabela da própria casa, que dizia «cTrader = one-way»: quem decide é a conta, e o conector lê-a antes de operar.)* | [F] idem |

## 4. O símbolo (o que a sonda declara)

| Regra | Facto | Evidência |
|---|---|---|
| RN-CT18 | A lista vem de `ProtoOASymbolsListReq`, com `includeArchivedSymbols` para trazer também os **deslistados** — um universo que os esconde aceita um mandato que nomeia um instrumento morto | [F] `messages/` |
| RN-CT19 | `ProtoOASymbol` declara, por instrumento: `digits`, `pipPosition`, **`lotSize`**, `minVolume`, `maxVolume`, `stepVolume`, `tradingMode`, `swapLong`/`swapShort`, `chargeSwapAtWeekends`, `commission`/`commissionType`/`minCommission`, `guaranteedStopLoss`/`gslDistance`/`gslCharge`, **`slDistance`/`tpDistance`**, `leverageId`, `maxExposure`, `measurementUnits`, `enableShortSelling`, `holiday`, `distanceSetIn` | [F] `model-messages/` |
| RN-CT20 | **A unidade é a do venue: `volume` em 0,01 de unidade** (na doc: «1000 in protocol means 10.00 units»). E `lotSize` vem na **mesma** unidade (centésimos): o conector que converte quantidade tem de dividir pelo `lotSize` para falar em lotes, e nunca arredondar em silêncio | [F] `messages/` |
| RN-CT21 | **`slDistance`/`tpDistance` são o mínimo de cada símbolo** para o stop/tp: a nossa `stop_pct`/`tp_pct` da boleta confere-se contra eles **antes** de enviar, e o que não couber é **recusado**, nunca arredondado | [F] idem |
| RN-CT22 | `tradingMode` (`ENABLED`, `DISABLED_WITHOUT_PENDINGS_EXECUTION`, `DISABLED_WITH_PENDINGS_EXECUTION`, **`CLOSE_ONLY_MODE`**) é **por símbolo** e muda o que se pode fazer nele: em `CLOSE_ONLY_MODE` abre-se? não; fecha-se? sim | [F] idem |
| RN-CT23 | **O símbolo tem nome e ID, e o ID muda de corretora para corretora** (a doc di-lo: «Different brokers might have different IDs»). Logo: a ficha guarda o **nome** (é o que o humano reconhece e o que a corretora escreve) e o conector **resolve o ID na sonda** — nome que não esteja no universo é **recusa nomeada**, nunca tradução | [F] `model-messages/` (e a regra da casa, já escrita na skill) |

## 5. Os dados de mercado

| Regra | Facto | Evidência |
|---|---|---|
| RN-CT24 | **Os preços viajam em inteiros relativos:** spots e profundidade **dividem-se por 100000**; as velas trazem `low` + `deltaOpen`/`deltaClose`/`deltaHigh` (o preço é `low + delta`, tudo a dividir por 100000). Arredondar a `digits` é o último passo, não o primeiro | [F] `symbol-data/`, `model-messages/` |
| RN-CT25 | A profundidade (`ProtoOADepthEvent`) traz `newQuotes` **e** `deletedQuotes`: é um livro por deltas. O tamanho divide-se por **100** (os preços, por 100000) | [F] `symbol-data/` |
| RN-CT26 | `ProtoOATrendbar.volume` é **em ticks** (não em unidades nem em lotes) — não é o volume a que a análise de varejo está habituada, e dizê-lo evita uma leitura a mais | [F] `model-messages/` |
| RN-CT27 | A barra carimba **`utcTimestampInMinutes`** — a hora do **abertura** da barra, em minutos UTC. É relógio UTC do venue (ao contrário do MT5, que usa a hora do broker) | [F] idem |
| RN-CT28 | `ProtoOAGetTrendbarsReq` tem **limites de distância** entre `from` e `to` que dependem do período, e os pedidos históricos contam no limite de **5/s**; o histórico de **ticks** não passa de **uma semana** por pedido e traz `hasMore` | [F] `symbol-data/`, `open-api/` |
| RN-CT29 | Os spots exigem subscrição **por símbolo** (`ProtoOASubscribeSpotsReq`) e os `bid`/`ask` do evento são **opcionais** cada um por si: um evento só com `ask` é normal, não é dado corrompido | [F] `symbol-data/` |

## 6. A ordem (a boleta deste venue)

| Regra | Facto | Evidência |
|---|---|---|
| RN-CT30 | `ProtoOANewOrderReq`: `symbolId`, `orderType` (`MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT`, `MARKET_RANGE`, `STOP_LOSS_TAKE_PROFIT`), `tradeSide` (`BUY=1`, `SELL=2`), `volume` (0,01), `limitPrice`, `stopPrice`, `timeInForce` (`GTC`, `GTD`, `IOC`, `FOK`, `MOO`), `expirationTimestamp` (GTD), `comment` (512), `label` (100), **`clientOrderId` (50)**, `positionId`, `guaranteedStopLoss`, `trailingStopLoss`, `stopTriggerMethod` | [F] `messages/` · [E] `ctrader_api_client.models.requests` |
| RN-CT31 | **`stopLoss`/`takeProfit` absolutos NÃO são suportados em ordem a mercado** — a doc di-lo duas vezes, na ordem e na alteração. O que serve a mercado é o **relativo** | [F] `messages/` |
| RN-CT32 | **`relativeStopLoss`/`relativeTakeProfit` são em 1/100000 de unidade de preço** (`123000` = 1,23). É a unidade do nosso `stop_pct`/`tp_pct` traduzida — e para `BUY` a distância soma-se ao preço, para `SELL` subtrai-se | [F] idem |
| RN-CT33 | **O desvio (slippage) só existe em `MARKET_RANGE`/`STOP_LIMIT`**: `slippageInPoints` + `baseSlippagePrice` (o preço base do cálculo). Em `MARKET` puro não há campo de desvio | [F] idem |
| RN-CT34 | **Não existe `reduce_only`.** O fecho faz-se com uma ordem que **referencia a posição** (`positionId`) — e é o venue que a fecha, não a nossa aritmética. Numa conta `HEDGED` isso é o que impede que um fecho vire abertura | [F] idem |
| RN-CT35 | O **post-only não existe** neste venue (ao contrário da Hyperliquid). Uma política que precise dele tem de ser recusada na admissibilidade, não degradada em silêncio | [F] tabela da casa + `ProtoOAOrderType` |
| RN-CT36 | `guaranteedStopLoss` tem regras próprias: obrigatório em contas de risco limitado quando o símbolo o permite, **e recusado** onde o símbolo não o permite. A capacidade lê-se do símbolo (`guaranteedStopLoss`) e do trader (`isLimitedRisk`) — não se assume | [F] `messages/` |

## 7. O desfecho

| Regra | Facto | Evidência |
|---|---|---|
| RN-CT37 | `ProtoOAExecutionEvent` traz `executionType`, `order`, `position`, `deal`, `errorCode`, `isServerEvent` (e as variantes de depósito/bónus). É o desfecho do contrato, e traz **a ordem e a posição juntas** | [F] `messages/` |
| RN-CT38 | `executionType` tem 11 valores, e três deles **não são ordens**: `SWAP`, `DEPOSIT_WITHDRAW`, `BONUS_DEPOSIT_WITHDRAW`. Um leitor que trate tudo como desfecho de ordem inventa ordens que não existem | [E] `enums.py` 0.11.0 |
| RN-CT39 | Os valores de `executionType`/`orderStatus`/`dealStatus` são conhecidos e fechados (`ORDER_ACCEPTED`, `ORDER_FILLED`, `ORDER_PARTIAL_FILL`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `ORDER_EXPIRED`, `ORDER_CANCEL_REJECTED`, `ORDER_REPLACED`; `ACCEPTED`/`FILLED`/`REJECTED`/`EXPIRED`/`CANCELLED`; `FILLED`/`PARTIALLY_FILLED`/`REJECTED`/`INTERNALLY_REJECTED`/`ERROR`/`MISSED`) | [E] idem |
| RN-CT40 | `ProtoOAOrder` tem `clientOrderId` **e** `positionId`: a ordem reencontra-se pela marca que enviamos **e** liga-se à posição que abriu | [F] `model-messages/` |
| RN-CT41 | `ProtoOADeal` traz `positionId`, `orderId`, `executionPrice`, `filledVolume`, `commission`, `marginRate` e **`closePositionDetail`** (o detalhe do fecho, com o resultado) — é daqui que sai o PnL por execução, e é a fonte por item da regra da casa | [F] idem |
| RN-CT42 | O erro genérico é `ProtoOAErrorRes` (`errorCode` + descrição) e o `errorCode` também viaja no `ProtoOAExecutionEvent` de recusa: a **palavra do venue** vai ao desfecho, e não é traduzida | [F] idem |

## 8. O manifesto deste venue (o que ele declara)

Os valores saem das tabelas acima; o que fica `não tem`/`não suportado` é **declaração**, não lacuna.

| Campo do manifesto | Valor para cTrader | Porquê |
|---|---|---|
| `tipos_de_ordem` | `MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT`, `MARKET_RANGE`, `STOP_LOSS_TAKE_PROFIT` | RN-CT30 |
| `parcial_suportada` | (a sondar por símbolo: o modo de execução manda) | RN-CT22, `[?]` |
| `desvio_maximo` | **sim**, mas só em `MARKET_RANGE`/`STOP_LIMIT` | RN-CT33 |
| `reduce_only_suportado` | **não** — o fecho é por `positionId` | RN-CT34 |
| `stop_anexo` | **na ordem a mercado, não**; o stop é relativo e vai na ordem | RN-CT31/32 |
| `ajusta_alavancagem` | **não há verbo de ajuste** — a alavancagem é da conta/símbolo (`leverageInCents`, `maxLeverage`, `leverageId`) | RN-CT16 |
| `profundidade_de_livro` | **sim** (`ProtoOASubscribeDepthQuotesReq`) | RN-CT25 |
| `funding_publicado` | swap por símbolo (`swapLong`/`swapShort`, `chargeSwapAtWeekends`) — **unidade e calendário próprios** | RN-CT19 |
| `relogio_de_fecho_de_barra` | **UTC** (`utcTimestampInMinutes`) | RN-CT27 |
| `idempotencia` | **`clientOrderId`** existe (50) — a protecção continua a ser nossa até a bateria medir o comportamento | RN-CT30 |
| `marca_de_posse` | `client_order_id` | RN-CT30/40 |
| `marca_liga_ordem_a_posicao` | **sim** (`positionId` na ordem e no negócio) | RN-CT40/41 |
| `estado_do_mercado` | `tradingMode` por símbolo + `holiday` | RN-CT22 |
| `ligacao_por_protocolo` | **sim**, e em duas camadas (transporte vs sessão da conta) | RN-CT4 |
| `devolve_a_resolucao` | **sim** — `ProtoOAOrder`/`ProtoOADeal` trazem volume executado, preço, comissão, `marginRate`, `usedMargin` | RN-CT41 |

## 9. O que ainda não se sabe (material da spec e da bateria)

1. **O equity derivado.** A conta não o publica (RN-CT15). Falta decidir de onde vem a segunda parcela: uma
   mensagem própria de PnL não realizado, ou `(preço de mercado − preço da posição) × volume` por posição. **Só a
   conta de demonstração responde**, e a resposta entra na spec como fórmula declarada.
2. **`measurementUnits` e o sentido do `lotSize`.** A doc dá a unidade de `volume` (0,01) mas não diz se
   `measurementUnits` já está em unidades base nem como se lê `lotSize` em cada classe de activo. Confirmar na
   sonda, símbolo a símbolo, e escrever a conversão uma vez.
3. **O mínimo nocional por ordem.** Não há campo declarado: ou o venue publica um mínimo em dinheiro (a procurar
   no `ProtoOASymbol` e no perfil de execução do grupo), ou o mínimo **é a recusa** — caso da bateria.
4. **O modo de execução e a parcial, por símbolo.** `parcial_suportada` fica `[?]` até a sonda o ler: no MT5 isto é
   por símbolo e muda o que «a mercado» significa.
5. **O desvio em pontos: `slippageInPoints` é do quê?** Pontos (não pips), presumivelmente de `pipPosition` — a
   conversão para a nossa `desvio_maximo` (percentagem) tem de ser derivada do símbolo e conferida em demo.
6. **O custo de manter posição** (swap) e o **calendário** (`chargeSwapAtWeekends`) mudam de unidade e de
   calendário em relação à Hyperliquid: a taxa por hora de lá não se compara com a daqui sem conversão, e é conta
   nossa.
7. **O nome dos tokens na rotação.** O par é reemitido e o antigo invalidado (RN-CT10): resta saber, na bateria, se
   o venue aceita a sessão antiga até ao fim do token ou se a derruba logo — é isso que decide a linha
   `token_rodou` da máquina de estados.
