# Research: o que se mediu antes de planear o conector

**Fonte das verdades do venue:** a documentação oficial (`hyperliquid.gitbook.io/hyperliquid-docs`, páginas
também em `.md`, consultadas a 29 set 2026) e a biblioteca oficial em TypeScript que o outro projeto usa em
produção (`@nktkas/hyperliquid`, cujos tipos validam contra a mesma API). O que é **medição** vem do outro
projeto, com ficheiro:linha; o que é **fonte** vem da documentação.

## R1 — O venue e o que ele oferece

Perpétuos por `coin`/`assetId`; TIF `Alo` (post-only) e `Ioc`; `reduceOnly` nativo; alavancagem por
`updateLeverage`; leitura por `clearinghouseState` e `metaAndAssetCtxs`; execuções por `userFills`; funding
por `fundingHistory` (e no contexto por instrumento); taxas do utilizador por `userFees`.

## R2 — Onde cada número do manifesto nasce

`szDecimals` e alavancagem máxima: sondados do `meta` do venue (`src/market.ts:89-92,366-375` **[V]**).
Passo do tamanho: `10^-szDecimals`; preço: **5 algarismos significativos** e no máximo `6 − szDecimals` casas
nos perpétuos, com inteiro sempre aceite (documentação oficial, «Tick and lot size» **[F]**).

## R3 — O mínimo nocional

A documentação oficial mostra a recusa na letra do venue: *«Order must have minimum value of $10»* **[F]**.
Entra como premissa datada, e a bateria exige a recusa do venue (§3 da regra de negócio).

## R4 — A referência de cliente

`cloid`: *«optional 128 bit hex string»* — 16 bytes, `0x` + 32 hexadecimais (documentação oficial **[F]**); o
SDK recusa outro comprimento (34 caracteres — `cancelByCloid.d.ts:17` **[V]**). O motor antigo **não** usa
cloid **[V]** — logo não tem idempotência por referência.

## R5 — Liquidação e margem

*«Cross positions are liquidated when the account value (including unrealized pnl) is less than the
maintenance margin times the total open notional position. The maintenance margin is currently set to half of
the initial margin at max leverage.»* (documentação oficial **[F]**). O preço de liquidação por posição é
**publicado** pelo venue (`liquidationPx` **[V]**) — logo mostra-se o número dele, não um recalculado.

## R6 — Taxas e funding

Tabela pública por volume de 14 dias (base: taker `0,045%`, maker `0,015%`); rebates de maker pagos a cada
execução; taxas do utilizador por `userFees` (`userCrossRate`, `userAddRate`, `feeSchedule` **[V]**).
Funding: taxa calculada de 8 horas, **paga hora a hora a um oitavo** (documentação oficial **[F]**).

## R7 — O que o dublê do conector (recorte 001) já cobre

`contracts/mocks/conector/{manifesto.json,main.py,main.ts}` — o espelho de contrato, que continua a servir os
recortes que não podem depender de uma corretora. O conector real corre **os mesmos casos** (o padrão do SC-004
do recorte 003): divergência é falha.

## R8 — O contrato não precisa de tipo novo

Os 12 esquemas já têm o que o conector fala: `manifesto`, `mercado` (as leituras, com equity),
`proposta`/`boleta` (unidades neutras), `resolucao`, `desfecho`, `historico`. O recorte começa em **1.3.0** e só
sobe se a implementação exigir campo novo (aditivo, declarado).

## R9 — O que ainda se mede (e não se decide no papel)

Se o venue **arredonda ou recusa** um tamanho com casas a mais (a letra diz «rounded», o SDK valida e recusa);
**qual** `mark` serve de régua à distância de liquidação; e a **cadência** de re-sondagem (a palavra `currently`
da documentação envelhece). Os três entram na bateria, e o resultado vai para o manifesto.
