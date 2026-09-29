# A regra de negócio do conector — o primeiro plugin real (Hyperliquid)

Este documento é a **regra do primeiro conector**, e o Hyperliquid é o primeiro caso porque é o que já está
**em teste numa conta real** (no outro projeto, `jev-trade-fusao`). O que está aqui foi **medido** naquele
repositório e na biblioteca que ele usa — não foi inventado a partir da documentação do venue.

Marcas: **[V]** medido a correr · **[F]** fonte lida (ficheiro:linha) · **[D]** documento · **[?]** inferido.

## 0. O que um conector é, e o que não é

Traduz e transporta (RN-C5, RN-C15). Não decide lado, tamanho, preço nem momento; não lê estratégia, mandato
nem fichas; não conhece risco. **Um processo por (corretora, conta), uma ligação, uma chave** (RN-C16, RN-E3) —
e o vigia é quem o arranca (RN-E21), nunca o core.

O contrato que ele cumpre já existe: `boleta` (unidades neutras) → **`resolução`** (o que vai enviar, ANTES de
enviar — RN-C10) → `desfecho` (as quatro classificações — RN-C2). As mensagens estão congeladas no contrato
neutro e têm casos próprios (`contracts/casos/`).

---

## 1. O venue: o que ele é, medido

| Facto | Onde se viu |
|---|---|
| SDK `@nktkas/hyperliquid` (TS) + `viem` para assinar | `package.json` do outro projeto **[F]** |
| `InfoClient` (leitura) e `ExchangeClient` (escrita) sobre `HttpTransport({isTestnet})` | `src/market.ts:1,62-64` **[F]** |
| Moeda: **perpétuo** por `coin`, com `assetId` numérico | `src/market.ts:85-92` **[F]** |
| `szDecimals` **sondado** no arranque; o passo é `10^-(6-szDecimals)` | `src/market.ts:89-92` **[F]** + `docs/core-universal-costura.md` §3 **[D]** |
| `maxLeverage` **sondado** do `meta.universe`, nunca constante | `src/market.ts:366-375` **[F]** |
| TIF: `Alo` (post-only) e `Ioc` — literais, sem mais nenhum | `src/market.ts:204,250,283` **[F]** |
| `reduceOnly` é parâmetro nativo da ordem | `src/market.ts:199-215` **[F]** |
| Alavancagem: `updateLeverage({asset, isCross, leverage})`, inteira, com degraus próprios | `src/market.ts:184-189` **[F]** + §4 do mesmo doc **[D]** |
| Estado da conta: `clearinghouseState` (posição, equity, margem, liquidação, PnL) | `src/market.ts:173`, `src/account.ts:63-87` **[F]** |
| Execuções e taxas: `userFills` (por REST e por WS) | `src/market.ts:163`, `src/feed.ts:108,149` **[F]** |
| Funding: `fundingHistory({coin, startTime, endTime})` — hora a hora | `src/ledger/marks_source.ts:70` **[F]** |
| Idempotência por `cloid`: existe no SDK (`0x` + 16 bytes) | SDK, `esm/api/exchange/_methods/cancelByCloid.d.ts:17` **[F]** |
| Estado de ordem: `statuses[0]` com `filled{avgPx,totalSz,oid}` ou `resting{oid}`; Ioc não servida não deixa nada | `src/market.ts:263-275,311-320` **[F]** |

**O que o outro projeto faz e este conector NÃO faz** — duas diferenças que são regra, não gosto:

1. **Arredonda em silêncio.** `lot()` e `Math.min/max` cortam a quantidade e a alavancagem para o que cabe
   (`src/market.ts:77,185` **[F]**). Aqui **não**: quem não cabe **recusa com motivo** (RN-C9, RN-C3). O
   valor ajustado em silêncio é um número que ninguém autorizou.
2. **Não usa `cloid`.** Não há idempotência por referência de cliente naquele motor **[V]**: um reenvio pode
   duplicar ordem. Aqui a referência **é** o `cloid` (RN-C4).

---

## 2. As regras deste venue — família `RN-H`

### Ligação e arranque

- **RN-H1.** O conector **sonda o venue no arranque** e publica o **manifesto**: instrumentos, `szDecimals`,
  alavancagem máxima, degraus de alavancagem disponíveis, mínimo de quantidade/nocional, taxas, e o que o
  venue **não** fornece. Nada disto é constante no código, nada disto é copiado de um ficheiro nosso
  (RN-C1, RN-C7, RN-C19). O manifesto é por **(corretora, conta)**.
- **RN-H2.** O estado da ligação é o **do protocolo do venue** (RS-* e WS). Silêncio não é «ligado» nem
  «caído» (RN-C12): é `desconhecido`, dito como tal. Sem leitura da conta, o conector **não envia**.
- **RN-H3.** O conector recusa arrancar se o instrumento nomeado não existir no venue, e diz **qual**
  (alinhado com a porta `conectores`/`manifesto` da mesa, FR-009).

### Tradução (a boleta → o que o venue aceita)

- **RN-H4.** A boleta chega em **unidades neutras** — percentagem do saldo, alavancagem, percentagens de
  movimento (`contracts/boleta.schema.json`). O conector converte para **unidade do instrumento** usando o
  `szDecimals` sondado, e o preço com os decimais do venue. **Conversão, não risco** (RN-C9, RN-C15).
- **RN-H5.** **Nada arredonda em silêncio.** Se a quantidade calculada cair abaixo do mínimo do instrumento
  ou fora do passo, ou se o nocional não couber na banda autorizada, o conector **recusa com motivo**
  (RN-C9). Um valor ajustado sem dizer é uma ordem que ninguém autorizou.
- **RN-H6.** A **alavancagem** é pedida ao venue (`updateLeverage`) quando ele tem esse verbo (RN-C8) — e
  **só** se valor pedido **for um degrau oferecido pelo venue**. Se não for, o conector **recusa** e diz
  quais existem: adaptar para o degrau abaixo é decidir risco por quem decide (é a diferença 1 da §1).
- **RN-H7.** O **lado e o tipo de ordem** vêm da boleta, traduzidos para os TIF do venue: post-only para a
  entrada quando a boleta o pede (na Hyperliquid, `Alo`) e a mercado/`Ioc` para a saída. Onde o venue **não**
  tiver post-only, o manifesto **di-lo** e a propriedade «nunca cruza» deixa de ser prometida (é o que a
  §4 do doc do outro projeto mediu).
- **RN-H8.** `reduce_only` é pedido ao venue quando a boleta o pede — e o manifesto declara
  `reduce_only_suportado` (a **capacidade**, não o mecanismo): num venue sem ele, quem garante que a ordem
  não vira é o código, e isso tem de estar dito.
- **RN-H9.** A **referência de cliente** da boleta vira a referência do venue de forma **determinística e
  declarada** (na Hyperliquid, `cloid` de 16 bytes: a derivação é fixa, e o manifesto nomeia-a). Reenviar a
  mesma referência **não** cria segunda ordem (RN-C4).

### A resolução e o desfecho

- **RN-H10.** A **resolução** (quantidade, nocional, margem, alavancagem efectiva, preço de liquidação) sai
  **antes** do envio sempre que o venue deixe perguntar; onde o venue só calcula ao executar (o caso geral de
  uma ordem a mercado), a resolução sai **depois**, com os números **do venue** (RN-C10, RN-C14, RN-E20).
- **RN-H11.** O **desfecho** é normalizado nas quatro classificações do contrato, sempre com os números do
  venue e o motivo quando é recusa: `aceite`, `parcial`, `desconhecido`, `recusado` (RN-C2). A recusa traz a
  **palavra do venue** no detalhe, não uma interpretação nossa.
- **RN-H12.** **Silêncio é estado** (RN-C18): dentro do prazo declarado é **espera**; além dele o desfecho é
  **`desconhecido`** — nunca sucesso, nunca falha. Uma Ioc não servida não é «nada aconteceu» até se
  reconciliar.
- **RN-H13.** **Reconciliar antes de agir:** um `desconhecido` obriga a ler o estado da conta (posição real,
  ordens abertas, execuções desde o instante) **antes** de qualquer ordem nova (RN-T7.1). O que se conta é o
  **venue**, não a nossa memória.
- **RN-H14.** O **histórico** que o conector expõe é o do venue, por inteiro: execuções, taxas, funding e
  resultado realizado — **nada recalculado** por nós (RN-C11, RN-D6). Somar execuções para «reconstruir» o
  resultado é o defeito que a regra proíbe.

### Conta, chave e credencial

- **RN-H15.** Uma ligação, uma chave, um processo (RN-C16). O conector **não** serve duas contas e **não**
  aceita um pedido que nomeie outra.
- **RN-H16.** A credencial entra por **referência** e vive **fora** da mensagem, do ledger e do log
  (RN-C20, RN-E14). Neste documento, e em todo o material do repositório, a credencial é um **NOME** — nunca
  um valor. O outro projeto guarda o que precisa em `PRIVATE_KEY`, `WALLETS_JSON`/`.wallets.json` e escolhe o
  ambiente por `HL_TESTNET` **[F]** — **os nomes ficam, os valores não entram aqui**.
- **RN-H17.** O conector **começa em ambiente de teste** (`isTestnet`) e só passa a produção por decisão
  declarada do dono. A bateria de conformidade (RN-C6) corre **primeiro** em teste.

### A tabela de acções chega à ponta

- **RN-H18.** O conector **repete com atraso** apenas o que é seguro repetir; **recusa e registra** o que
  depende de um número que ele não tem; **para e reconcilia** o que pode ter ficado a meio (RN-C17). A
  decisão não nasce aqui: é a mesma tabela do core (`core/ciclo/acoes.json`), lida pela ponta.
- **RN-H19.** O conector **nunca** envia ordem nova enquanto houver `desconhecido` por reconciliar naquele
  instrumento. Fechar/reduzir é sempre permitido — é a única ordem que não precisa de leitura.

---

## 3. A bateria de conformidade deste conector (RN-C6)

O aceite do plugin é esta bateria, corrida **no ambiente de teste do venue**, por **versão** do conector, com
o resultado registado (RN-C7). As provas, uma a uma — cada uma é uma frase que se verifica:

| # | Prova | O que conta como PRONTO |
|---|---|---|
| 1 | **Manifesto sondado** | o manifesto é lido do venue a cada arranque; um instrumento inventado **recusa** (`RN-H1`, `RN-H3`) |
| 2 | **Passo e mínimo** | uma boleta que cai fora do passo ou abaixo do mínimo **recusa com motivo** — nunca arredonda (`RN-H5`) |
| 3 | **Degrau de alavancagem** | uma alavancagem que não é degrau do venue **recusa** e nomeia os degraus (`RN-H6`) |
| 4 | **Post-only não cruza** | uma ordem post-only nunca aparece como `filled` imediato no lado cruzado (`RN-H7`) |
| 5 | **Reduce-only** | uma ordem reduce-only não aumenta a posição em nenhum caso (`RN-H8`) |
| 6 | **Idempotência** | a mesma referência enviada duas vezes deixa **uma** ordem e **uma** posição (`RN-H9`, `RN-C4`) |
| 7 | **Desconhecido** | calando o venue dentro do prazo: `espera`; passado o prazo: `desconhecido`; e a reconciliação encontra a posição real (`RN-H12`, `RN-H13`) |
| 8 | **Histórico** | o histórico do conector bate com o do venue, ao cêntimo, sem reconstrução (`RN-H14`) |

Cada prova é **dupla**: o caso feliz e o adversário (a recusa, o silêncio, o número fora da banda). Um
conector que diz sempre sim prova a fiação, não o comportamento — e este projeto já pagou essa lição no
`ponta-a-ponta.sh`.

**O que a bateria NÃO prova:** que a estratégia ganha dinheiro, e que a mesa decide bem. Isso é da mesa, e
está provado nas bancadas dela (25 de 25).

---

## 4. O que este venue não é — e onde isso importa

- **Funding é horário** (aqui), e noutros venues é swap diário com triplo ao fim de semana: a **unidade e o
  calendário** mudam, e o número não se compara entre venues.
- **Degraus de alavancagem inteiros** são deste venue; noutro é o limite do instrumento.
- **Post-only existe** aqui; onde não existir, a propriedade «nunca cruza» **cai** e tem de ser redeclarada.
- **`reduce_only` é nativo** aqui; onde não for, a garantia vem do código.

A regra geral que sai disto: **capacidade que o venue não declara é recusada, não improvisada** (RN-C7) —
e, quando a ausência tiver palavra neutra (como o `pay_neutral` do outro projeto **[F]**), usa-se a palavra
neutra em vez de um zero que parece um número medido.

---

## 5. O que ainda não sei (declarado, para não parecer resolvido)

- **[?]** A **derivação** da referência de cliente para o `cloid` (16 bytes) não está decidida — há que
  escolher uma forma determinística e escrevê-la no manifesto (`RN-H9`).
- **[?]** A **distância de liquidação** que a mesa mostra no resumo é derivada do `liquidationPx` do venue:
  a fórmula (e o que fazer quando `liquidationPx` é nulo, sem posição) tem de ser declarada — o outro projeto
  lê o preço de liquidação, mas **não** calcula a distância **[V]**.
- **[?]** As **taxas** (maker/taker) e o **funding** entram no manifesto por sondagem: onde é que o venue os
  publica de forma estável, e com que unidade (por hora? por 8 h?) — a confirmar na bateria.
- **[?]** O **mínimo de nocional** (o outro projeto não o lê; a bateria 3 tem de o sondar).
