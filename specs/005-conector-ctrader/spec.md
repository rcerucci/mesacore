# Feature Specification: O segundo conector — cTrader, em conta de demonstração

**Feature Branch**: `005-conector-ctrader`

**Created**: 01 out 2026

**Status**: Draft

**Input**: Pedido do dono: «precisamos, criar um conector do ctrader agora. pode analizar este projeto e
verificar se serve algo para nosso novo plugin?» · «bom base no projeto vamos construir o plugin. pode concluir
os passos necessarios antes do codigo, decida o que é necessario de acordo com seu conhecimento do plugin ja
criado.» A regra de negócio (`docs/regra-de-negocio-ctrader.md`, família **RN-CT**) e a máquina de estados
(`docs/maquina-de-estados-conector-ctrader.md`) estão escritas e ancoradas na documentação oficial do venue
(`help.ctrader.com/open-api/`) e na versão instalada da biblioteca (`ctrader-api-client` 0.11.0 — parecer em
`docs/AVALIACAO-BIBLIOTECA-CTRADER.md`).

## O que este recorte é, e o que ele não é

**É** o **segundo** conector — e com ele a prova que faltava: o contrato neutro **aguenta dois venues que não se
parecem**, sem crescer. Um é uma corretora descentralizada de perpetuais, com endereço de carteira por
identidade e reduce-only nativo; o outro é uma corretora de CFDs, com **`ctidTraderAccountId`** por identidade,
**contas HEDGED ou NETTED**, **OAuth com rotação de token** e **fecho por posição**. Se o mesmo motor, o mesmo
manifesto e o mesmo desfecho servem os dois, o contrato deixou de ser uma aposta — é medido.

É também o primeiro conector com **duas camadas de ligação** (o transporte vivo ≠ a sessão da conta autorizada),
o primeiro que precisa de **re-autenticar a quente** e o primeiro em que a leitura de uma grandeza (**equity**) é
declaradamente **conta nossa**, porque o venue não a publica.

**Não é** (declarado para não parecer esquecimento):

- **dinheiro real** — este recorte corre em **demonstração**; a passagem a real é decisão declarada do dono;
- **a biblioteca como conector** — `ctrader-api-client` 0.11.0 entra como **camada de protocolo** (sessão,
  protobuf, OAuth, sonda), fixada na versão; a fronteira (processo, portões, manifesto, boleta, resolução,
  desfecho, recusa) continua nossa, como em qualquer venue (RN-C5, RN-C15);
- **o setup, a mesa e o painel** — o outro lado da mesa, com recorte próprio; aqui só se entrega e recebe
  mensagem;
- **a segunda metade da boleta** — o core manda percentagem do saldo e alavancagem; a conversão em `volume`
  (0,01) é deste lado, como em qualquer venue;
- **o instrumento do mandato** — a ficha continua a declarar o **nome** que o humano reconhece; o `symbolId`
  resolve-se na sonda (RN-CT23);
- **a conferência de banda da mesa (D-001)** — o conector **entrega** a resolução; quem a confere contra a banda
  é a mesa.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O conector arranca, autentica nas duas camadas, sonda e publica o manifesto (Priority: P1)

A camada de operação arranca o conector. Ele autentica a aplicação, lê a lista de contas do token, autentica
**a conta do ficheiro**, confere que é mesmo ela, sonda os instrumentos (**incluindo os deslistados**) e publica
o **manifesto**: limites de volume, passo, decimais, modo de negociação, swap, comissão, distâncias mínimas de
stop e de alvo, e o que **não** suporta. A mesa recusa arrancar se o instrumento do mandato não estiver lá,
dizendo **qual**.

**Why this priority**: é a razão de o conector existir, e aqui ganha um segundo sentido — **nenhum número do
venue pode ser copiado para o nosso código**. Todo o número (0,01 de volume, 1/100000 do stop relativo, 5/s dos
históricos) entra por leitura ou por declaração, nunca por memória do programador.

**Independent Test**: correr o conector contra a **demonstração** e ler o manifesto; depois apontar o ficheiro da
conta a outro `ctidTraderAccountId` e ver a recusa com o id divergente.

**Acceptance Scenarios**:

1. **Given** o venue acessível e uma conta de demonstração, **When** a camada de operação arranca o conector, **Then** o manifesto é publicado com os instrumentos e os limites **lidos do venue**, e o conector diz qual versão de contrato fala.
2. **Given** o manifesto publicado, **When** a corretora muda o passo de volume do instrumento **no venue**, **Then** o manifesto seguinte reflecte a mudança **sem que uma linha de código nosso mude**.
3. **Given** uma conta de demonstração cujo `ctidTraderAccountId` não é o do ficheiro da conta, **When** o conector arranca, **Then** recusa com `identidade_da_conta_divergente` e diz os dois ids.
4. **Given** uma conta com `accessRights = CLOSE_ONLY`, **When** o conector arranca, **Then** arranca, **declara** no manifesto que só fecha, e a primeira boleta de **abertura** é recusada com esse motivo.
5. **Given** um mandato que nomeia um instrumento que não está no universo (nem nos deslistados), **When** o conector arranca, **Then** recusa e diz **qual** o nome que não encontrou.

---

### User Story 2 - A boleta traduzida, e o que não cabe é recusado com motivo (Priority: P1)

A mesa manda a boleta em unidades neutras: percentagem do saldo, alavancagem, percentagens de movimento. O
conector converte para a unidade do venue — `volume` em **0,01**, distâncias de stop e alvo **relativas em
1/100000** — e quando o resultado não cabe (abaixo do mínimo, fora do passo, abaixo da distância mínima do
símbolo, desvio pedido num tipo de ordem que não o tem), **recusa com o motivo**, em vez de arredondar.

**Why this priority**: é a diferença entre operar o que o dono autorizou e operar um número que ninguém
autorizou — e neste venue há **duas** unidades onde se pode errar em silêncio (o volume em centésimos e a
distância relativa em 1/100000).

**Independent Test**: mandar uma boleta cujo stop calculado fica abaixo do `slDistance` do símbolo e ver a recusa
com o mínimo nomeado — e nenhuma ordem no venue.

**Acceptance Scenarios**:

1. **Given** uma quantidade que cai fora do passo do instrumento, **When** chega a boleta, **Then** o desfecho é `recusado` com o motivo a nomear o passo, e **nenhuma** ordem é enviada.
2. **Given** um stop percentual que, no preço de referência, fica **abaixo** do `slDistance` do símbolo, **When** chega a boleta, **Then** a recusa nomeia a distância mínima e o símbolo — o stop **não** é alargado para caber.
3. **Given** uma boleta que pede desvio máximo numa ordem `MARKET`, **When** chega ao conector, **Then** é recusada com o motivo (o venue só aceita desvio em `MARKET_RANGE`/`STOP_LIMIT`) — o conector **não** troca o tipo de ordem para poder aceitar o campo.
4. **Given** um stop/alvo absoluto pedido para execução a mercado, **When** chega a boleta, **Then** a recusa nomeia a regra do venue, em vez de enviar o que o venue recusaria.
5. **Given** uma boleta válida, **When** é resolvida, **Then** a **resolução é escrita antes do envio** com o volume, o lado e as distâncias já na unidade do venue.

---

### User Story 3 - A marca de posse, a resolução e o desfecho com os números do venue (Priority: P2)

Cada tentativa leva uma **marca** (`clientOrderId`, até 50 caracteres). O desfecho vem do venue — `executionType`,
`orderStatus`, o negócio com preço e volume executados, comissão e `positionId` — e é **lido**, não calculado. A
mesma marca repetida não pode gerar uma segunda ordem.

**Why this priority**: é o que sobrevive a um silêncio e a um reinício. Neste venue a marca viaja na ordem e a
ordem **liga-se à posição** (`positionId`): é o que permite reconciliar sem adivinhar.

**Independent Test**: reenviar a mesma marca duas vezes e contar as posições — uma, não duas; e ler o desfecho
com o `clientOrderId` que enviámos.

**Acceptance Scenarios**:

1. **Given** um envio aceite, **When** o desfecho chega, **Then** traz o `clientOrderId` que enviámos, o preço e o volume executados **do venue**, a comissão e o `positionId` — e nenhum destes números é calculado por nós.
2. **Given** a mesma marca reenviada, **When** o conector a reconhece, **Then** **não** envia segunda ordem e devolve o desfecho da mesma (por consulta ao venue, nunca por memória).
3. **Given** um `executionType` de `SWAP`, depósito ou bónus, **When** chega, **Then** é registado como acontecimento de **conta** e **não** como desfecho de ordem.
4. **Given** uma execução parcial, **When** o desfecho chega, **Then** a operação fica com o volume **executado**, com a marca do que ficou por executar — sem arredondar para cima.

---

### User Story 4 - O fecho por posição: fechar não abre (Priority: P2)

Um fecho referencia a **posição** (`positionId`) e é o venue que a fecha. Não existe `reduce_only` neste venue —
e não precisa de existir: o fecho por id não pode virar abertura. Sem posição, o fecho é `nada` com motivo.

**Why this priority**: é o defeito já medido noutro venue (o fecho por lado oposto que abre quando não havia
nada para fechar). Aqui a garantia é do venue, e o recorte tem de a **medir**, não presumir.

**Independent Test**: fechar uma posição inexistente e ver `nada` com motivo; fechar uma viva e ler, no negócio
de fecho, o detalhe do fecho.

**Acceptance Scenarios**:

1. **Given** uma posição viva, **When** chega a ordem de fecho, **Then** o envio referencia o `positionId` e o desfecho traz o negócio de fecho com o resultado.
2. **Given** nenhuma posição no instrumento, **When** chega a ordem de fecho, **Then** o desfecho é `nada` com o motivo `sem_posicao_para_fechar` e **nenhuma** ordem é enviada.
3. **Given** três ciclos de abre-e-fecha no mesmo instrumento, **When** o terceiro fecho termina, **Then** a conta tem **zero** posições naquele instrumento e o número de négocios de fecho é **três** (o venue fecha; nós não abrimos por engano).
4. **Given** um símbolo em `CLOSE_ONLY_MODE`, **When** chega uma abertura, **Then** é recusada e o fecho do que já existe **continua a passar**.

---

### User Story 5 - O silêncio é estado, e reconcilia-se antes de agir (Priority: P2)

Se a resposta não chega dentro do prazo declarado, a ordem fica `desconhecida`. A partir daí: nada de ordem nova
naquele instrumento; nada de reenvio às cegas; a verdade vem de **ler** a conta (posições, ordens, negócios pelo
`positionId`, `orderId` e pela nossa marca). Fechar continua sempre permitido.

**Why this priority**: é a diferença entre um sistema que não sabe e o diz, e um que decide por optimismo. E
neste venue há uma armadilha a mais: a sessão pode ter caído **depois** de a ordem ter sido aceite.

**Independent Test**: matar a ligação entre o envio e a resposta, e provar que o conector fica `desconhecida`,
que recusa ordem nova no instrumento, que permite fechar, e que o desfecho final sai da leitura.

**Acceptance Scenarios**:

1. **Given** um envio sem resposta dentro do prazo, **When** o prazo expira, **Then** a ordem fica `desconhecida` e o desfecho ao core diz que é desconhecida — não falha, não sucesso.
2. **Given** uma ordem `desconhecida`, **When** chega um pedido novo no mesmo instrumento, **Then** é recusado com `desconhecido_por_reconciliar`; um pedido de **fecho** passa.
3. **Given** uma ordem `desconhecida`, **When** o conector relê a conta, **Then** o desfecho verdadeiro sai dos negócios do venue (ou da ausência deles) e a ordem sai de `desconhecida`.
4. **Given** uma reconciliação a decorrer e a sessão da conta invalidada a meio, **When** a leitura falha, **Then** a ordem **continua** `desconhecida` — não se inventa um desfecho a partir de uma leitura falhada.

---

### User Story 6 - A rotação do token derruba a sessão, e o conector re-autentica sem enviar às cegas (Priority: P3)

O venue emite tokens novos e invalida os antigos; um dos avisos é explícito (`token was refreshed`) e pode
derrubar a **sessão da conta** com o transporte vivo. O conector trata isto como acontecimento de estado:
nenhuma ordem nova até re-autenticar, e a re-autenticação **lê a conta antes** de deixar entrar ordem nova.

**Why this priority**: é a primeira vez que a nossa máquina de estados tem de lidar com credenciais que mudam
**sozinhas**, a meio da corrida, sem que ninguém tenha feito nada.

**Independent Test**: forçar a rotação (reemitir o par de tokens) e provar que o conector para de enviar, volta
a autenticar, relê a conta e só depois aceita pedido novo.

**Acceptance Scenarios**:

1. **Given** a sessão invalidada por rotação, **When** chega um pedido de abertura, **Then** é recusado com o motivo (sessão por re-autenticar) e nenhuma ordem sai — e a **ligação** pode estar de pé.
2. **Given** a re-autenticação concluída, **When** o conector volta a poder operar, **Then** a **primeira** coisa que faz é ler a conta, e só depois aceita pedido.
3. **Given** a rotação a meio de uma ordem em curso, **When** o conector recupera, **Then** a ordem é reconciliada **antes** de qualquer ordem nova no instrumento.
4. **Given** o ficheiro de tokens reescrito pelo venue, **When** o conector o relê, **Then** nenhum valor de token aparece em log, mensagem ou registo (FR-023).

---

### User Story 7 - A bateria de conformidade, em demonstração, com o resultado por versão (Priority: P3)

A bateria das **oito provas** da casa corre contra a demonstração, mais as quatro que **este** venue obriga a
acrescentar: as duas camadas da ligação, a identidade recusada, o fecho por posição, e a marca reenviada. O
resultado fica registado por versão do conector, como no primeiro conector.

**Why this priority**: é o que transforma «está implementado» em «está provado contra um venue a sério» — e é a
única parte deste recorte que não se pode simular.

**Independent Test**: correr a bateria numa conta de demonstração e ler o relatório; nenhuma prova pode depender
de mercado favorável (a que precisar de posição abre-a no tamanho mínimo e fecha-a).

**Acceptance Scenarios**:

1. **Given** a conta de demonstração e os tokens válidos, **When** a bateria corre, **Then** as doze provas passam e o relatório fica em `brokers/ctrader/conformidade/` com a versão.
2. **Given** a mesma bateria depois de uma mudança no conector, **When** corre de novo, **Then** o relatório **novo** é escrito ao lado do antigo — nenhum resultado anterior é reescrito.
3. **Given** o repositório, **When** se procura por credencial, **Then** não há nenhum valor de token, client secret ou id de conta **em claro** — só referências a ficheiro (FR-023).

---

### Edge Cases

- **Nome de símbolo ambíguo ou ausente** — o universo tem o nome, mas a sonda devolve dois `symbolId` diferentes (o mesmo nome em classes/estruturas distintas): recusa nomeada, nunca escolha do primeiro.
- **Símbolo deslistado no mandato** — arranca? não: o manifesto marca-o e a mesa recusa; a leitura dele continua possível se a posição existir (é preciso saber fechá-la).
- **`tradingMode` muda a meio da corrida** (o venue fecha o instrumento) — a abertura seguinte é recusada com o motivo lido no manifesto renovado, sem reiniciar o conector.
- **Preço com mais precisão do que `digits`** — a resolução arredonda **ao `digits` do símbolo**, e só no último passo (os preços viajam em inteiros relativos).
- **Conta HEDGED com duas posições no mesmo instrumento** — a leitura devolve as duas; a regra de uma posição por instrumento é da **mesa**, e o conector **não** a impõe em silêncio (nem a esconde: nomeia as duas).
- **`moneyDigits` diferente entre contas** — os números são lidos com o expoente da conta em causa, nunca com uma constante nossa.
- **Limite de ritmo esgotado** (50/s, ou 5/s nos históricos) — o conector espera e **declara** a espera; não responde «sem dados» a um pedido que ainda não fez.
- **Aplicação sem o âmbito de negociação** (token só de leitura) — a sonda funciona e a primeira tentativa de ordem é recusada com o motivo do venue, nomeado.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-045**: O conector é **um processo por (corretora, conta)**, com uma ligação e uma credencial, arrancado pela camada de operação — nunca por si próprio nem de dentro do core.
- **FR-046**: O conector fala o contrato neutro **sem o aumentar**: nenhum campo novo no esquema, nos motivos ou no vocabulário por causa deste venue. O que é específico entra como **declaração** (manifesto, capacidades, leitura).
- **FR-047**: No arranque correm os **oito portões** da casa mais os três deste venue: **identidade** (`ctidTraderAccountId` contra o ficheiro da conta), **direitos da conta** (`accessRights`) e **as duas camadas prontas** (transporte e sessão).
- **FR-048**: **Enviar exige as duas camadas**: transporte `pronto` **e** sessão da conta `autorizada`. Uma bandeira só nunca decide um envio.
- **FR-049**: A identidade confere-se no arranque **e em cada re-autenticação**; divergência é recusa nomeada (`identidade_da_conta_divergente`), com os dois ids ditos.
- **FR-050**: A credencial é **referência**, nunca valor: os três valores deste venue (client secret, access token, refresh token) vivem em ficheiro fora do repositório; a rotação reescreve o ficheiro e o valor não passa pelo conector, pelo log nem pelo registo (FR-023).
- **FR-051**: A sonda lê o universo de instrumentos **incluindo os deslistados** e publica no manifesto, por instrumento: `digits`, `lotSize`, mínimo, máximo e passo de volume, `tradingMode`, swap (long/short e calendário), comissão, distância mínima de stop e de alvo, `guaranteedStopLoss` e exposição máxima.
- **FR-052**: A leitura do **equity** é declarada como **derivada** (o venue não a publica), com a fórmula escrita; número derivado nunca se apresenta como número do venue.
- **FR-053**: Os valores monetários são lidos com o **expoente** da conta (`moneyDigits`); sem ele a leitura está errada por ordens de grandeza e o conector não a publica.
- **FR-054**: O instrumento do mandato é um **nome**; o `symbolId` resolve-se na sonda, e um nome ausente do universo (ou ambíguo) é **recusa nomeada**, nunca tradução.
- **FR-055**: A conversão da boleta produz `volume` na unidade do venue (0,01), conferido a mínimo, máximo e passo do instrumento, e declara a conversão usada.
- **FR-056**: O tamanho que não cabe é **recusado** com o motivo a nomear o limite — nunca truncado, arredondado ou ajustado em silêncio.
- **FR-057**: `stop_pct`/`tp_pct` convertem-se em distâncias **relativas** na unidade do venue (1/100000), com o sinal conforme o lado; abaixo do mínimo do símbolo é recusa nomeada.
- **FR-058**: Um stop ou alvo **absoluto** para execução a mercado é recusado **antes** do envio (o venue não o aceita), com a regra nomeada.
- **FR-059**: O desvio máximo só é aceite nos tipos de ordem que o venue suporta; pedido noutro tipo é recusa, e o tipo de ordem **nunca** é trocado para acomodar o campo.
- **FR-060**: O tipo de ordem do pedido tem de estar no manifesto daquele venue; fora dele, é recusa nomeada.
- **FR-061**: Cada tentativa leva uma **marca de posse** (`clientOrderId`, ≤ 50 caracteres) única e reenviável; a mesma marca repetida não gera segunda ordem.
- **FR-062**: A **resolução** é escrita antes do envio e usa os números do venue quando ele os dá; quando o venue só calcula ao executar, a resolução sai **depois**, com os números dele.
- **FR-063**: O desfecho usa o vocabulário do venue (`executionType`, `orderStatus`, `dealStatus`), e os tipos que **não são ordens** (swap, depósito, bónus) são registados como acontecimentos de conta.
- **FR-064**: O desfecho traz a ligação ordem→posição (`positionId`) e os números de execução **lidos** (preço, volume, comissão) — nenhum recalculado por nós.
- **FR-065**: O fecho referencia a **posição**; sem posição no instrumento, o desfecho é `nada` com motivo e nenhuma ordem é enviada.
- **FR-066**: Os dois modos de «fechar sim, abrir não» (conta `CLOSE_ONLY`, símbolo `CLOSE_ONLY_MODE`) são **lidos** e aplicados: abertura recusada, fecho permitido — e ambos declarados no manifesto.
- **FR-067**: Uma ordem sem resposta dentro do prazo declarado fica **`desconhecida`** — nem falha nem sucesso — e o desfecho diz que é desconhecida.
- **FR-068**: Com ordem `desconhecida` pendente, **nenhuma** ordem nova entra naquele instrumento; o **fecho** continua permitido.
- **FR-069**: A reconciliação é feita por **leitura do venue** (posições, ordens e negócios por `positionId`/`orderId`/marca), nunca por memória do processo; leitura falhada **não** produz desfecho.
- **FR-070**: A invalidação da sessão (rotação de token, revogação, kick) suspende o envio de ordens novas até re-autenticar; a re-autenticação **lê a conta** antes de aceitar pedido novo.
- **FR-071**: Os limites de ritmo do venue (50 pedidos/s gerais, 5/s históricos) são respeitados, e a espera é **estado declarado** — nunca um «sem dados» silencioso.
- **FR-072**: A biblioteca de protocolo fica **fixada** numa versão, com licença verificada e parecer datado (não se segue o ramo principal), e a fronteira do conector permanece nossa.
- **FR-073**: A bateria de conformidade corre em **demonstração**, registra o resultado **por versão** e não guarda nenhuma credencial no repositório.

### Key Entities

- **Manifesto** — o que o venue oferece: instrumentos (com deslistados marcados), unidades, passos, limites, distâncias mínimas, modos de negociação, custos e **as capacidades declaradas** (o que não suporta incluído).
- **Ficha/conta** — o nome da conta, o id da conta no venue (**referência**, nunca valor) e o que o conector precisa para autenticar; a credencial fica fora do repositório.
- **Boleta** — o pedido em unidades neutras (percentagem do saldo, alavancagem, percentagens de movimento, tipo de ordem, lado).
- **Resolução** — a boleta já na unidade do venue, antes do envio: volume, preço (quando aplicável), distâncias, marca de posse.
- **Desfecho** — o que o venue responde: tipo de execução, ordem, posição, negócio, palavra de recusa; classificado (aceite/parcial/recusado/nada/desconhecido) sem tradução inventada.
- **Leitura** — o retrato do momento: conta (com o expoente monetário aplicado), posições (com as duas do modo HEDGED, se existirem), ordens vivas e o mercado que o pedido exigir.
- **Ordem** — a entidade do venue, com marca de posse, estado, lado, volume executado e o **`positionId`** que a liga à posição.
- **Negócio** — a execução: preço, volume, comissão, e o detalhe do fecho quando é fecho.

## Success Criteria *(mandatory)*

- **SC-013**: Os oito portões do arranque mais os três deste venue passam, com a prova escrita (comando e saída), e o arranque recusa nos casos de identidade divergente, direitos insuficientes e camada em falta.
- **SC-014**: Os **dois** conectores passam a mesma **bateria de conformidade** no ambiente de teste do seu venue — **doze provas** cada (as oito da casa + as deste venue) — com o resultado registado por versão e nenhuma prova a depender de mercado favorável.
- **SC-015**: O contrato neutro **não cresce**: o esquema, os motivos e o vocabulário passam o portão **sem alterações** por causa deste venue (medido pelo portão, não por inspecção).
- **SC-016**: Com a **sessão da conta** derrubada e a ligação de pé, o conector faz **zero envios** e volta a operar só depois de re-autenticar e reler a conta; com o **transporte** caído, zero envios.
- **SC-017**: Numa sequência de **três** aberturas e fechos no mesmo instrumento, a conta termina com **zero posições** e **três** fechos no histórico (o fecho por posição nunca abre).
- **SC-018**: A mesma marca de posse enviada **duas** vezes produz **uma** ordem e **uma** posição (a idempotência é medida contra o venue, não presumida).

## Assumptions

- A biblioteca de protocolo escolhida (`ctrader-api-client`, versão fixada) mantém-se adequada: o parecer em `docs/AVALIACAO-BIBLIOTECA-CTRADER.md` é datado e o recorte registra a versão usada. Se mudar, o parecer é refeito **antes** do código.
- Existe **conta de demonstração** com os dois âmbitos (leitura e negociação) — condição do dono, não do código.
- O venue continua a oferecer demonstração com símbolos reais e preços reais: as provas são de **conformidade**, não de mercado.
- O relógio da máquina está em UTC e o venue carimba em UTC; nenhuma conversão de fuso é precisa para o que aqui se prova.
- A mesa e o setup continuam a consumir o conector pelo contrato neutro, sem saber que venue está do outro lado.

## Dependências (do dono, não do código)

1. **Registar a aplicação** na cTrader Open API (obter `client_id`/`client_secret`) — o código fica pronto antes, e o arranque é que os exige.
2. **Decidir demonstração primeiro** (este recorte assume que sim) e **autorizar o OAuth uma vez**, guardando os tokens **fora do repositório**.
3. Confirmar a **conta** e o **nome do instrumento** que o mandato vai nomear (o par do primeiro ensaio: o mesmo do primeiro conector, ou o equivalente com liquidez na conta).
