# Research — o segundo conector (cTrader)

Fase 0 do plano. Cada entrada: **decisão · razão · alternativas**. As perguntas são as que a regra de negócio
(`docs/regra-de-negocio-ctrader.md` §9) deixou abertas, mais as técnicas que a decisão D1/D2 obriga a resolver.
O que só a demonstração responde fica declarado como **caso de bateria**, não como suposição.

## R1 — De onde vem o `equity`, se a conta não o publica

**Decisão**: o conector **deriva** o equity (saldo + resultado não realizado das posições) e **declara** que é
derivado, no manifesto e no `data-model.md`. Nunca o apresenta como número do venue.

**Razão**: a conta não publica o campo (RN-CT15 — o `equity` da doc vive no registo de operações de saldo, não no
retrato da conta). O core precisa de um número para dimensionar; o venue dá as peças (saldo, preço da posição,
preço de mercado, volume, `pnlConversionRate` do símbolo) e não dá o total.

**Alternativas**: (a) publicar `equity = balance` — **errado por desenho**: numa posição aberta o número
governaria o risco com o capital todo; (b) recusar a leitura sem equity — a mesa ficaria sem arrancar por uma
grandeza que é possível derivar; (c) procurar uma mensagem de PnL não realizado e, se existir, preferi-la à
derivação (fica como **primeiro passo da bateria**: se o venue a tiver, a fórmula nossa fica só como conferência).

## R2 — A unidade do `lotSize` e o que é `measurementUnits`

**Decisão**: **ler do símbolo, símbolo a símbolo**, e escrever a conversão num só sítio (`ordens.py`), com a
unidade do venue (0,01) como a única constante **declarada** da conversão — e essa vem do campo, não do código.

**Razão**: a doc diz que `volume` é em 0,01 de unidade mas não fixa o sentido de `lotSize` em todas as classes de
activo (o mesmo `lotSize` significa coisas diferentes em CFD de índice e em câmbio). Derivar do par
(`lotSize`, `stepVolume`, `minVolume`) evita a segunda tabela escondida.

**Alternativas**: (a) uma tabela de conversão nossa por classe de activo — é precisamente o número que ninguém
volta a conferir (Princípio I); (b) assumir 1 lote = 100.000 unidades (verdade em câmbio, falsa em índices) —
recusado.

## R3 — O mínimo nocional por ordem

**Decisão**: procurar o mínimo em `minVolume` (quantidade) e, se existir mínimo em dinheiro, no perfil do grupo
de execução; **não encontrando campo nenhum, o caso é o da bateria**: mandar uma ordem abaixo do mínimo e
registar a recusa do venue, com a palavra dele. A recusa passa a estar no manifesto como facto lido.

**Razão**: o venue recusa — e a recusa dele é dado de conformidade, não um erro de programação. Inventar um
mínimo nosso criaria uma regra que o venue não tem (e o contrário: um mínimo que o venue tem e nós não
conhecemos seria uma ordem rejeitada por surpresa).

**Alternativas**: um mínimo por omissão fixo no código — recusado (nenhum número ajustável vive no código).

## R4 — A parcial por símbolo (`parcial_suportada`)

**Decisão**: fica `[?]` até a sonda o ler no modo de execução do símbolo; o manifesto declara o que leu e o
recorte **não** presume. Em demonstração, a bateria manda uma ordem que atravessa o livro para ver se volta
`ORDER_PARTIAL_FILL` ou `ORDER_FILLED`.

**Razão**: no MT5 isto é por símbolo (mercado vs instantânea) e muda o significado de «a mercado». O cTrader tem
modos de execução por símbolo (o `tradingMode` é o que se lê para abrir/fechar; o modo de execução é outro
campo) — e o número tem de vir de lá.

**Alternativas**: assumir parcial suportada (a biblioteca tem `ORDER_PARTIAL_FILL` no enum, o que **não** prova
que aquele símbolo a produza — um enum é vocabulário, não comportamento).

## R5 — O que é um «ponto» de `slippageInPoints`

**Decisão**: derivar do símbolo (`pipPosition`, `digits`) e **confirmar em demonstração**; na ficha, o desvio
continua em unidades neutras (percentagem), e a conversão para pontos vive no `ordens.py`, num só sítio.

**Razão**: a doc diz «slippage in points» e mais nada — em câmbio, «ponto» é o 5.º decimal e «pip» o 4.º, e
confundir os dois é um factor 10 **silencioso**. O desvio só existe em `MARKET_RANGE`/`STOP_LIMIT` (RN-CT33), o
que limita o dano, mas não o elimina.

**Alternativas**: tratar ponto = pip (recusado: erra por 10); não usar desvio nenhum (recusado: o dono pede-o
para controlar derrapagem).

## R6 — O swap (`swapLong`/`swapShort`, `chargeSwapAtWeekends`)

**Decisão**: **publicar como o venue dá**, com a unidade e o calendário dele, e **não** converter para a taxa por
hora que o outro venue usa. Se o core precisar de comparar custos entre venues, a conversão é do core — e leva a
unidade declarada na origem.

**Razão**: a unidade do swap é do venue (pontos por noite, por norma em CFDs) e o calendário também (fim de
semana diferente). Converter aqui seria inventar um número que ninguém pode conferir contra o venue.

**Alternativas**: normalizar para «taxa por hora» — recusado: produziria um número que nenhuma das duas pontas
consegue verificar, e é o defeito clássico da grandeza sem dono.

## R7 — A rotação do token: a sessão antiga cai logo?

**Decisão**: tratar a rotação como **invalidação imediata** (conservador): nenhuma ordem nova entre o aviso e a
re-autenticação, e a re-autenticação lê a conta antes de aceitar pedido. Medir em demonstração se é mais suave.

**Razão**: o evento `ProtoOAAccountsTokenInvalidatedEvent` existe com a razão `token was refreshed` — o venue
**diz** que invalidou. Assumir o contrário (que a sessão sobrevive uns minutos) é apostar num comportamento não
documentado com ordens a sério a jusante.

**Alternativas**: manter a sessão até a próxima recusa (recusado: transforma um aviso explícito em falha
silenciosa sob carga).

## R8 — A biblioteca ou o SDK oficial (`OpenApiPy`)?

**Decisão**: biblioteca `ctrader-api-client` **0.11.0** (D2), com o SDK oficial como alternativa **declarada**.
Antes disso: verificar licença, fixar versão, ler o parecer.

**Razão**: a biblioteca traz a sonda de símbolos e a reconexão com restauro de subscrições — exactamente o
trabalho que não é a nossa fronteira. O SDK oficial é mais autoritário mas mais cru para este uso.

**Alternativas**: (a) SDK oficial — mais peso mas menos pronto; (b) escrever o transporte — recusado (D2);
(c) seguir o `master` da biblioteca — recusado: pre-1.0, autor único, 0 issues (fixa-se a versão).

## R9 — Os prazos de heartbeat e reconexão são nossos ou do venue?

**Decisão**: são **valores declarados** do conector (chave na ficha/conta com valor por omissão), não constantes
no código — o prazo do `desconhecida` (US5) sai deles. O valor por omissão nasce da biblioteca e é **confirmado
em demonstração** (o que o venue aguenta sem derrubar).

**Razão**: o prazo é o que decide quantas ordens ficam «em dúvida» por dia; é um número ajustável e por isso tem
chave (Princípio I). Escrevê-lo no código tornaria impossível afrouxá-lo numa rede má sem recompilar.

**Alternativas**: herdar o prazo da biblioteca sem chave nossa — recusado: a casa não aceita grandeza sem dono
declarado.
