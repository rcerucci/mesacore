# Data model: o que o conector recebe, o que devolve, e de onde vem cada número

Campo a campo, com a **origem** de cada número: **[V]** do venue (lido, não calculado por nós), **[C]** da
nossa conversão (declarada), **[?]** ausente ou não-sabido — e o que se diz quando está ausente.

Fontes: os esquemas do contrato (`contracts/*.schema.json`, versão **1.4.0**) e a documentação oficial do
venue. Onde o contrato não chega, este documento **diz** — e há dois achados no fim (§7).

**Emenda 1.4.0** (medida contra o venue; relatório em `relatorios/emenda-1.4.0.txt`): os quatro defeitos que
a sonda real mostrou — o nome do campo do **mínimo** de valor por ordem, a **forma do escalão** de alavancagem,
a **cadência do funding** e os **instrumentos deslistados** — passam a caber no contrato. As linhas marcadas
com **(1.4.0)** são as que esta emenda acrescentou ou corrigiu.

## 1. O manifesto (o que o venue oferece àquela conta)

Sondado a cada arranque. O esquema pede estes campos (lidos do `manifesto.schema.json`): `conector{nome,
versao}`, `versao` (a versão do **contrato**), `instrumentos[]`, `sabe_ajustar_alavancagem`,
`modos_de_margem[]`, `minimo_de_valor_por_ordem` (1.4.0), `maximo_de_valor_por_ordem?` (1.4.0, aditivo),
`modelo_de_posicao`, `tipos_de_ordem[]`,
`parcial_suportada[]`, `desvio_maximo`, `reduce_only_suportado`, `stop_anexo`, `profundidade_de_livro`,
`funding`, `relogio_de_fecho_de_barra`, `idempotencia`, `marca_de_posse`, `marca_liga_ordem_a_posicao`,
`estado_do_mercado`. E cada instrumento de `instrumentos[]` pode declarar, além da sua unidade,
`alavancagem_por_escalao[]` (1.4.0), `funding_intervalo_horas` (1.4.0) e `deslistado` (1.4.0).

| Campo | Origem neste venue | Como se lê |
|---|---|---|
| `instrumentos[]` | **[V]** | a lista de perpétuos do `meta` do venue |
| `szDecimals` / passo do tamanho | **[V]** | `meta`; o passo é `10^-szDecimals` |
| alavancagem máxima | **[V]** | `meta` (por instrumento) |
| `alavancagem_por_escalao[]` **(1.4.0)** | **[V]** | `meta.marginTables[marginTableId].marginTiers[].lowerBound` — o limite **inferior** de cada escalão, e o primeiro é `0.0` (medido no BTC: `0.0 / 10000.0 / 50000.0` → 40x / 25x / 10x) |
| `sabe_ajustar_alavancagem` | **[V]** | o venue tem `updateLeverage` → `true` |
| `modos_de_margem[]` | **[V]** | cross e isolated; alguns activos são *strict isolated* |
| `minimo_de_valor_por_ordem` **(1.4.0)** | **[V]** | o **mínimo** do venue (`$10`, documentação oficial; a bateria exige a recusa). Chamava-se `teto_de_valor_por_ordem` até à 1.4.0 — o nome dizia o contrário do que o valor era, e a mesa usava-o como teto |
| `maximo_de_valor_por_ordem`? **(1.4.0)** | **[V]** ou **[?]** | o **teto**, e só quando o venue o declara. Este venue **não** publica nenhum (medido): o campo fica ausente, e ausência não é «ilimitado» |
| `tipos_de_ordem[]` | **[V]** | os que a mesa usa: post-only e mercado |
| `reduce_only_suportado` | **[V]** | `true` (parâmetro nativo) |
| `stop_anexo` | **[V]** | `false` (o venue não anexa stop à ordem) |
| `funding` | **[V]** | `true`; taxa horária |
| `funding_intervalo_horas` **(1.4.0)** | **[V]** | `predictedFundings()[coin][HlPerp].fundingIntervalHours` — **por instrumento**, e medido: `1` hora nos 212 instrumentos. A mesma resposta traz 8 horas para outras modalidades, e é por isso que o campo é por instrumento |
| `deslistado` **(1.4.0)** | **[V]** ou **[?]** | `meta.universe[].isDelisted`. O venue só escreve a chave quando é **verdadeira** (medido: 54 de 212). Ausente = não dito, e não `false`. Um mandato que nomeie um deslistado **RECUSA** (`instrumento_deslistado_no_venue`, medido com `MATIC`) |
| `idempotencia` | **[V]** | `true` — o venue tem referência de cliente (`cloid`, 16 bytes) |
| `profundidade_de_livro` | **[V]** | a que a nossa leitura pede |
| `relogio_de_fecho_de_barra` | **[V]** | `continuo` (perpétuo, sem fecho de sessão) |
| `desvio_maximo` | **[C]** | a mesa manda-o na boleta; o manifesto declara o que o venue aceita |
| `estado_do_mercado` | **[V]** | `true`: o venue publica estado de mercado |

**Nenhum destes valores vive em código** (FR-001). Um número do venue copiado para o nosso código é um número
que ninguém volta a conferir — e o SC-001 mede exactamente isso: mudar o limite **no venue** muda o manifesto
seguinte sem uma linha nossa mudar.

## 2. A boleta (o que a mesa manda)

Unidades **neutras** (nada de unidades de corretora): `instrumento`, `lado`, `tipo`, `saldo_pct`,
`alavancagem`, `stop_pct?`, `tp_pct?`, `parcial`, `desvio_maximo`, `prazo_da_passiva_ms`,
`destino_do_resto`, `reduce_only`, `referencia_do_cliente`, `marca_de_posse`.

O conector **não** altera nada disto (RN-C5). O que ele faz é **converter**, e recusar o que não cabe.

## 3. A resolução (o que vai ser enviado, antes do envio)

Esquema: `quantidade`, `nocional`, `margem_empenhada`, `alavancagem_efectiva`, `preco_de_liquidacao` —
todos obrigatórios, todos decimais.

| Campo | Origem | Nota |
|---|---|---|
| `quantidade` | **[C]** | de `saldo_pct` × equity ÷ (preço × alavancagem), arredondada **ao passo do instrumento** — e se o resultado **não** couber no passo, **não há resolução**: há recusa (RN-C9) |
| `nocional` | **[C]** | quantidade × preço; é contra o **piso** e o **teto** do manifesto que se confere: abaixo de `minimo_de_valor_por_ordem` **recusa** (`valor_abaixo_do_minimo_do_venue`, e igual ao piso **passa**), acima de `maximo_de_valor_por_ordem` — quando o venue o declara — recusa (`valor_fora_da_banda`) |
| `margem_empenhada` | **[C]** | nocional ÷ alavancagem efectiva |
| `alavancagem_efectiva` | **[C]** | a pedida, depois de o venue a aceitar |
| `preco_de_liquidacao` | **[V]** ou **[?]** | ver **achado 2** (§7): antes de a ordem existir, o venue não o tem |

## 4. O desfecho (o que aconteceu)

Esquema: `classificacao` (`aceite` | `parcial` | `desconhecido` | `recusado`), `motivo?` (obrigatório na
recusa), `resolucao?` (obrigatória fora da recusa), `resposta_do_venue` (o que o venue disse — objecto).

| Situação | Classificação | Origem dos números |
|---|---|---|
| preenchida | `aceite` | **[V]** (`avgPx`, `totalSz`) |
| preenchida em parte | `parcial` | **[V]** |
| recusada pelo venue | `recusado` + `motivo` | **[V]** a **palavra dele**, não a nossa interpretação |
| calado dentro do prazo | `espera` | — |
| calado depois do prazo | `desconhecido` | — até haver leitura |
| reconciliado | a que a leitura disser | **[V]** |

`desconhecido` só sai deste estado por **leitura do venue** (FR-014) — nunca por tempo nem por otimismo.

## 5. As leituras (o que a mesa pergunta)

Esquema `mercado`: `instrumento`, `tempo_do_venue_ms`, `idade_do_dado_ms`, `estado`, `bid?`, `ask?`,
`ultimo?`, `livro{lados[], profundidade}`, `posicao{lado, unidades, preco_medio, marca_de_posse?}`,
`equity`, `funding{taxa, instante_ms}`.

E o resumo do encerramento precisa de **cinco números da corretora**: posição, nocional, margem, distância de
liquidação, resultado não realizado. Ver **achado 1** (§7).

| Número | Origem |
|---|---|
| posição (unidades, lado, preço médio) | **[V]** |
| equity | **[V]** (`clearinghouseState`) |
| nocional | **[V]** (`positionValue`) |
| margem | **[V]** (`marginUsed`) |
| resultado não realizado | **[V]** (`unrealizedPnl`) |
| distância de liquidação | **[C]** a partir de **[V]**: `\|mark − liquidationPx\| / mark`, com a origem do `mark` nomeada |
| sem posição | a distância é **[?] ausente** — nunca `0`, que pareceria um número medido |
| leitura falhada | **[?]** diz-se que não se leu; nunca se serve o valor anterior |

## 6. A referência de cliente e o `cloid`

A mesa manda `referencia_do_cliente` (correlação do contrato). O venue quer **16 bytes** (`0x` + 32
hexadecimais). A derivação é **[C]**, **pura** e **declarada no manifesto**: a mesma referência dá sempre o
mesmo `cloid` — e é por isso que reenviar não duplica (FR-011). Um derivado que incluísse o instante daria uma
ordem nova a cada reenvio, que é o defeito que se quer evitar.

## 7. Dois achados (o contrato, hoje, não chega — e isto é dito, não contornado)

**Achado 1 — o `mercado` traz menos números do que o encerramento precisa.** O esquema tem `posicao` (lado,
unidades, preço médio) e `equity`; o resumo do encerramento (FR-014 do recorte 003) precisa de **nocional,
margem, distância de liquidação e resultado não realizado**. No recorte 003 esses números vieram de fixtures —
nunca de uma corretora (está declarado no `RESULTADO.md` de lá). Aqui, com um venue a responder, eles existem
— e não têm por onde viajar. **Decisão proposta (aditiva, contrato 1.4.0):** quatro campos opcionais em
`posicao` (`nocional`, `margem`, `distancia_de_liquidacao`, `resultado_nao_realizado`), marcados como «do
venue, nunca recalculados», e `distancia_de_liquidacao` **ausente** quando não há posição.

**Achado 2 — `preco_de_liquidacao` não sabe dizer «ainda não sei».** O esquema é
`decimal_nao_negativo`, e diz porquê: «zero é valor LEGÍTIMO: a alavancagem 1 só liquida a preço zero». Logo
um zero **antes** de a ordem existir seria uma afirmação falsa (diria «1x»). Numa ordem a mercado, o venue só
calcula o preço de liquidação **depois** de haver posição. **Decisão proposta (aditiva, contrato 1.4.0):**
o campo passa a aceitar um **valor neutro** declarado no conjunto fechado (o precedente é o
`relogio_de_fecho_de_barra`, que tem `desconhecido` no enum) — nunca zero, nunca um número inventado. A
resolução completa (com o preço real) chega com a leitura seguinte, e o registo mostra as duas.

Os dois achados viram tarefa (T0xx) e são conferidos pelo portão do contrato: os casos novos declaram
`esperadoOk` para os dois lados (o número presente e o ausente).

## 8. A emenda 1.4.0: os quatro defeitos medidos, e o que se decidiu

O que este documento declarava por escrito, a sonda real desmentiu em quatro pontos. Cada um foi medido
(`relatorios/sonda-real.txt`), decidido, e mudou o contrato — os dois motores (TS e Python) e os dois dublês
acompanharam, e a prova está em `relatorios/emenda-1.4.0.txt`.

**(1) O nome do campo do mínimo mentia nos dois sentidos.** `teto_de_valor_por_ordem` carregava o **mínimo**
do venue (a sonda alimentava-o com `$10`) e o dublê da mesa conferia-o como **teto** (`nocional > teto`).
Recusava exactamente os nocionais que o venue aceita e aceitava os que ele recusa. **Decisão:** o campo
passa a `minimo_de_valor_por_ordem` (piso: abaixo **recusa**, igual **passa**) e o tecto entra aditivo em
`maximo_de_valor_por_ordem` — que só existe quando o venue o declara, e este não declara nenhum.

**(2) O escalão de alavancagem não cabia no contrato.** O esquema pedia `ate` (limite **superior**,
`decimal_positivo`) e o venue declara `lowerBound`, com o primeiro escalão a **`0.0`** — que `decimal_positivo`
recusa. **Decisão:** o escalão passa a declarar o limite **inferior** (`de`, decimal **não negativo**, zero
legítimo no primeiro), como o venue o dá; o escalão de um valor é o maior `de` que não o excede, e um valor
que escalão nenhum cubra **recusa** em vez de cair na máxima única por omissão. Medido no BTC:
`0.0 / 10000.0 / 50000.0` → 40x / 25x / 10x.

**(3) A cadência do funding não atravessava o contrato.** O manifesto só tinha o booleano `funding`, e o
venue publica `fundingIntervalHours` — **por instrumento** (`1` hora nos 212, medido). **Decisão:** entra
aditivo `instrumentos[].funding_intervalo_horas` (inteiro ≥ 1), com o valor do venue tal como ele o dá;
ausente = não declarado para aquele instrumento.

**(4) Um instrumento deslistado era aceite.** O venue lista 54 dos 212 instrumentos com `isDelisted: true`
e continua a dar-lhes unidade — e o contrato não tinha onde declarar o facto, nem nome para o recusar.
**Decisão:** entra aditivo `instrumentos[].deslistado` (booleano), e a recusa tem nome próprio:
`instrumento_deslistado_no_venue`. Quem recusa é o conector, ao construir o manifesto a partir do mandato —
e a conferência da mesa recusa a boleta sobre um manifesto que declare `deslistado: true`. Medido contra o
venue: o mandato que nomeia `MATIC` recusa nomeando-o.
