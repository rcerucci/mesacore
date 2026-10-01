# Data model — o conector cTrader

Fase 1 do plano. Cada campo do contrato, com a **origem de cada número** (venue / conversão nossa / derivado) e a
mensagem do venue de onde ele sai. Serve para três coisas: implementar sem inventar, provar que o contrato **não
precisa de crescer** (SC-015), e deixar escrito o que a demonstração tem de confirmar.

Fontes: `contracts/*.schema.json`, `contracts/origem-das-grandezas.json`, a doc oficial do venue
(`help.ctrader.com/open-api/`) e a versão instalada da biblioteca (0.11.0). Convenção deste documento: **[V]** =
número do venue, tal como ele o dá; **[C]** = conversão nossa, declarada; **[D]** = derivado nosso (soma de
números do venue).

## 0. As unidades do venue (onde se erra em silêncio)

| Grandeza do venue | Unidade | Como se lê | Marca |
|---|---|---|---|
| `volume` (ordens) | 0,01 de unidade | `volume = unidades × 100`, inteiro | [C] |
| `lotSize` | mesma unidade (centésimos) | lotes = `volume / lotSize` — **só para falar em lotes**, nunca para decidir tamanho | [V] |
| `minVolume`/`maxVolume`/`stepVolume` | 0,01 de unidade | conferidos **antes** de enviar | [V] |
| `relativeStopLoss`/`relativeTakeProfit` | 1/100000 de preço | `relativo = preço × pct/100 × 100000` | [C] |
| `slDistance`/`tpDistance` | (unidade do símbolo) | piso para o stop/alvo calculado | [V] |
| `slippageInPoints` | pontos | derivado de `pipPosition`/`digits`; **confirmar em demo** (research R5) | [C] |
| preços (spots, velas, livro) | inteiros relativos | `/100000`; nas velas, `low + delta` | [V] |
| tamanhos (livro) | centésimos | `/100` | [V] |
| valores monetários (saldo, PnL, comissão, margem) | inteiros escalados | **aplicar `moneyDigits` da conta** (RN-CT14) | [V] |
| `ProtoOATrendbar.volume` | **ticks** | publicado como o venue dá; não é volume de unidades | [V] |

## 1. Manifesto (`manifesto.schema.json`) → o que o venue responde

| Campo | cTrader | Origem |
|---|---|---|
| `conector`, `versao` | nome do conector + versão do **contrato** que ele fala | [C] (declaração) |
| `instrumentos[].minimo`, `.passo`, `.tick`, `.alavancagem_maxima` | `minVolume`/`stepVolume`/`digits`+`pipPosition` (tick derivado) / `maxLeverage` do escalão | [V] + [C] onde derivado |
| `instrumentos[].alavancagem_por_escalao[]` | `leverageId` + o escalão da conta (`leverageInCents`, `maxLeverage`) | [V] |
| `modelo_de_posicao` | **do `ProtoOATrader.accountType`**: `HEDGED`→`hedging`, `NETTED`→`netting` | [V] (RN-CT17) |
| `tipos_de_ordem` | os 5 neutros que o venue serve (tabela §5) | [V]+[C] |
| `parcial_suportada` | lido do modo de execução do símbolo; `[?]` até a sonda o dizer (R4) | [V] |
| `desvio_maximo` | só onde o venue o aceita (`MARKET_RANGE`/`STOP_LIMIT`); senão **declarado como não suportado** | [V] (RN-CT33) |
| `reduce_only_suportado` | **`false`** — o venue não tem reduce_only; o fecho é por `positionId` | [V] (RN-CT34) |
| `stop_anexo` | **`false`** para ordem a mercado: o stop vai **relativo** na própria ordem | [V] (RN-CT31/32) |
| `sabe_ajustar_alavancagem` | **`false`** — não há verbo de ajuste; a alavancagem é da conta/símbolo | [V] (RN-CT16) |
| `profundidade_de_livro` | `ProtoOASubscribeDepthQuotesReq` → `true` | [V] (RN-CT25) |
| `funding` | `swapLong`/`swapShort` + `chargeSwapAtWeekends` — unidade e calendário do venue | [V] (R6) |
| `relogio_de_fecho_de_barra` | UTC (`utcTimestampInMinutes`) | [V] (RN-CT27) |
| `idempotencia` | **`false`** até a bateria a medir: o `clientOrderId` existe, mas a garantia é do venue e **não** está documentada | [V] → bateria (SC-018) |
| `marca_de_posse` | `clientOrderId` (≤ 50) | [V] (RN-CT30) |
| `marca_liga_ordem_a_posicao` | **`true`** — `ProtoOAOrder.positionId` e `ProtoOADeal.positionId` | [V] (RN-CT40/41) |
| `estado_do_mercado` | `true` — `tradingMode` por símbolo (+ `holiday`) | [V] (RN-CT22) |
| `ligacao_por_protocolo` | `true` — **e em duas camadas** (§7, achado 2) | [V] (RN-CT4) |
| `releitura_de_preco_ao_enviar` | consoante o tipo: mercado → o venue resolve; limite → o preço é nosso | [C] |
| `devolve_a_resolucao` | `true` — `ProtoOAOrder`/`ProtoOADeal` trazem volume executado, preço, comissão, `marginRate` | [V] (RN-CT41) |

## 2. Boleta (`boleta.schema.json`) → resolução (`resolucao.schema.json`)

A boleta é **neutra**: `instrumento`, `lado` (`buy`/`sell`), `tipo`, `saldo_pct`, `alavancagem`, `stop_pct`,
`tp_pct`, `parcial`, `desvio_maximo`, `prazo_da_passiva_ms`, `destino_do_resto`, `reduce_only`,
`referencia_do_cliente`, `marca_de_posse`. Nada disto sabe do cTrader.

| Campo da resolução | Como nasce aqui | Origem |
|---|---|---|
| `quantidade` | `saldo_pct` × `equity` × `alavancagem` → preço do instrumento → `volume` (0,01) → conferido a `minVolume`/`stepVolume`/`maxVolume` | **[V]** (RN-B0: a mesa não calcula unidades; o venue resolve) |
| `nocional` | preço × volume → na moeda da conta (a conversão do venue) | [V] |
| `margem_empenhada` | `ProtoOAPosition.usedMargin` (na abertura, o que o venue reportar) | [V] |
| `alavancagem_efectiva` | `marginRate` do negócio/posição | [V] |
| `preco_de_liquidacao` | não publicado pela conta → **ausente** até a bateria o encontrar; ausência **declarada**, não inventada | — |

`reduce_only` na boleta: para este venue o campo é **recusado como pedido** (não existe; RN-CT34) — o fecho é
outra mensagem (§4).

## 3. O envio (a boleta vira mensagem)

| Peça | Campo do venue | Nota |
|---|---|---|
| instrumento | `symbolId` | resolvido da sonda pelo **nome** da ficha (RN-CT23) |
| lado | `tradeSide` = `BUY`(1)/`SELL`(2) | — |
| tipo | `orderType` | tabela §5 |
| tamanho | `volume` | 0,01 |
| tipo de execução | `timeInForce` | tabela §5 (parcial/destino do resto) |
| stop/alvo | `relativeStopLoss`/`relativeTakeProfit` | 1/100000, com sinal conforme o lado |
| desvio | `slippageInPoints` + `baseSlippagePrice` | só `MARKET_RANGE`/`STOP_LIMIT` |
| **marca de posse** | `clientOrderId` | ≤ 50; é a marca que a operação seguinte reencontra |
| preço | `limitPrice`/`stopPrice` | em inteiros relativos |

## 4. Desfecho (`desfecho.schema.json`) e o fecho

| Campo neutro | cTrader | Nota |
|---|---|---|
| `classificacao` | das 4 (`aceite`/`parcial`/`recusado`/`desconhecido`) → derivada de `executionType`+`orderStatus`+`dealStatus` (§5) | 11 tipos de execução, **3 não são ordens** (`SWAP`, `DEPOSIT_WITHDRAW`, `BONUS_DEPOSIT_WITHDRAW`) → acontecimentos de **conta**, registados e não classificados |
| `motivo` | o **`errorCode`** do `ProtoOAErrorRes`/execução, com a palavra do venue | nunca traduzido (RN-CT42) |
| `resolucao` | o que o venue deu: preço, volume executado, comissão | [V] (FR-064) |
| `resposta_do_venue` | o payload relevante (ordem/posição/negócio) | preserva o vocabulário do venue |
| fecho | `ProtoOANewOrderReq` com **`positionId`** e lado contrário | o venue fecha por id; **fechar não abre** (RN-CT34, SC-017) |
| detalhe do fecho | `ProtoOADeal.closePositionDetail` | o resultado do fecho, do venue |

## 5. Os mapeamentos de vocabulário (contrato ↔ venue)

| Neutro | cTrader |
|---|---|
| `mercado` | `MARKET` |
| `limite` | `LIMIT` |
| `stop` | `STOP` |
| `stop_limite` | `STOP_LIMIT` |
| `mercado_por_faixa` | `MARKET_RANGE` (o único com desvio) |
| `parcial: tudo_ou_nada` + `destino_do_resto: cancelar` | `FOK` |
| `parcial: o_que_der` + `destino_do_resto: agressivo` | `IOC` |
| `estado_do_mercado: aberto` | `tradingMode = ENABLED` |
| `estado_do_mercado: fechado` | `DISABLED_WITHOUT/WITH_PENDINGS_EXECUTION`; **`CLOSE_ONLY_MODE`** = fechado **para abrir**, aberto para fechar |
| `lado: caixa` | fecho por `positionId` (não é lado de ordem) |
| marca de posse | `formas_de_marca`: **`clientOrderId`** (forma: `marca_de_posse_do_venue` — string) |

Os tipos que o venue tem e o neutro não usa (`STOP_LOSS_TAKE_PROFIT`): ficam **de fora**, declarados no README do
conector. O neutro não cresce para os acomodar (SC-015).

## 6. Leitura (`mercado.schema.json`) e a conta

| Campo | cTrader | Origem |
|---|---|---|
| `tempo_do_venue_ms` | `utcTimestampInMinutes` / `executionTimestamp` | [V] |
| `idade_do_dado_ms` | medida por nós contra o relógio do venue | [C] |
| `estado` | `tradingMode` (§5) | [V] |
| `bid`/`ask`/`ultimo` | `ProtoOASpotEvent` (`/100000`); **um dos dois pode faltar** — publica-se o que veio | [V] (RN-CT29) |
| `livro` | `ProtoOADepthEvent` (`newQuotes`/`deletedQuotes`, preços `/100000`, tamanhos `/100`) | [V] |
| `posicao` | `ProtoOAPosition` (`positionStatus = OPEN`) — `lado`, `unidades`, `preco_medio`, `marca_de_posse` | [V] (§7 achado 3) |
| `ordens_abertas[]` | `ProtoOAOrder` (`orderStatus` em aberto): preço, unidades por executar, marca | [V] |
| `equity` | **`ProtoOATrader.balance` + Σ `ProtoOAPositionUnrealizedPnL.gross_unrealized_pn_l`** | **[D]** (§7 achado 1) |
| `funding` | `swapLong`/`swapShort`/`chargeSwapAtWeekends` | [V] |

Ficha/conta: `conta` (nome), `ctidTraderAccountId` (**referência**, nunca valor), e as **três** referências de
credencial (client secret, access token, refresh token) — todas apontam para ficheiro **fora do repositório**
(FR-023/FR-050). `moneyDigits` **não** é chave: é lido da conta a cada leitura (é um número do venue, e o venue
pode mudá-lo).

## 7. Achados (o que o contrato já tem, e o que este venue obriga a decidir)

**Achado 1 — o `equity` é satisfazível, com uma soma declarada.** O contrato diz `mercado.equity` com origem
**venue** (RN-M3: «o equity é o da corretora, com não realizado») — e o cTrader **não publica** o total. Mas
publica **as parcelas**: `ProtoOATrader.balance` e `ProtoOAGetPositionUnrealizedPnLRes` (`gross_unrealized_pn_l`
por posição). A leitura publica a soma **e declara que somou** (nenhuma taxa nossa entra; a conversão para a
moeda da conta é do venue, `pnlConversionFee`). O contrato **não cresce** — mas o README e a bateria têm de dizer
esta frase, senão fica um número nosso a passar por número do venue.

**Achado 2 — as duas camadas não têm campo, e não precisam de ter.** O neutro tem `ligacao_por_protocolo`
(booleano) e o estado da ligação vivido pelo protocolo. Para o cTrader há **duas** camadas (transporte e sessão da
conta). A resolução: a leitura só **existe** quando as duas estão prontas — o que o core vê é «há leitura» ou
«não há», e o porquê vai no **motivo** da recusa quando ele tenta operar. Nenhum campo novo.

**Achado 3 — `hedging` declarado, mas a leitura só sabe ler UMA posição.** O manifesto tem
`modelo_de_posicao: hedging` ✓ (o contrato previu-o), mas `mercado.posicao` é **um objecto** (com `lado`,
`unidades`, `preco_medio`) e não há `posicao[]`. Numa conta HEDGED com **duas** posições no mesmo instrumento
(o que o venue permite), a leitura não as sabe dizer. **Resolução deste recorte (sem crescer o contrato)**: o
conector **recusa a leitura** com motivo nomeado (`duas_posicoes_no_mesmo_instrumento`) em vez de escolher uma —
e o ensaio corre numa conta **NETTED**, o que fica declarado como condição do dono. O alargamento do contrato
(`posicao` → lista, com o instrumento em cada uma) é **matéria de outro recorte**, e este documento deixa-o dito
para não parecer esquecimento.

**Achado 4 — o `CLOSE_ONLY` da conta não tem campo, e o motivo chega.** O neutro sabe dizer `estado_do_mercado`
por instrumento. O cTrader tem **também** um modo de conta (`accessRights = CLOSE_ONLY`). O core não precisa de
saber *porquê*: tenta abrir, a boleta é **recusada** e o motivo nomeia o direito da conta. Fecho continua a
passar. Nenhum campo novo.

**Achado 5 — o desvio existe numa unidade que o neutro não tem, e não precisa.** O neutro pede `desvio_maximo`
em percentagem; o venue quer **pontos**. A conversão é nossa ([C]) e vive num sítio só. O neutro não ganha
`pontos` (a lista `campos_em_unidade_de_corretora` já existe para o que **não** pode ser lido cru pelo core).

**Resultado para o SC-015**: zero campos novos, dois pontos declarados (a soma do equity; a conta NETTED) e um
alargamento **nomeado e adiado** (a posição múltipla do modo hedging).
