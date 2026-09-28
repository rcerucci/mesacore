# Feature Specification: O contrato neutro — mesa, setup e conector

**Feature Branch**: `001-contrato-neutro`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "O contrato neutro entre a mesa, o setup e o conector: schema das mensagens, mocks dos dois lados e provas de fronteira."

## Contexto

Este é o primeiro recorte do MesaCore e é o que torna o resto possível: **o vocabulário que atravessa as
fronteiras**. A mesa fala com o setup por um lado e com o conector pelo outro; nenhuma das três pontas
partilha código com as outras, e cada uma pode estar escrita noutra linguagem. O que as liga é este
contrato — a única coisa que todas conhecem.

O recorte entrega três coisas juntas, porque uma sem as outras não se prova: **as mensagens** (o que cada
ponta entrega e recebe), **os mocks** (uma implementação falsa de cada ponta, para exercer a fronteira
sem corretora) e **as provas** (os casos que recusam). O valor do recorte não é "ter tipos": é poder
afirmar, com casos corridos, que a boleta atravessa sem perder o sentido, que o dinheiro não se perde na
ida e volta, e que uma ponta escrita noutra linguagem é indistinguível.

**Fora do recorte:** o ciclo da mesa, a lógica de qualquer setup, o protocolo de qualquer corretora, a
superfície web, e a geração do inventário de chaves a partir do schema.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O setup fala, e a mesa entende (Priority: P1)

A mesa entrega ao setup **um objecto de factos** — preços, livro quando houver, posição e equity, funding
quando houver, o tempo do venue e **a idade do dado** — e o setup responde com o seu relógio (quando quer
ser consultado) e **um de quatro valores**: `buy`, `sell`, `hold`, `caixa`. O mesmo objecto, no mesmo
instante lógico, é o que o humano veria.

**Why this priority**: é a fronteira que define o que é "inteligência" no sistema. Sem ela, a mesa não
tem de onde tirar o lado, e todo o resto do desenho fica sem entrada.

**Independent Test**: corre-se contra um setup falso (mock) que devolve respostas conhecidas:
verifica-se que ele recebe o mesmo objecto que o humano, que ausências chegam declaradas como ausentes, e
que o valor inválido (`limpar`, vazio, número) é registado e tratado como `hold` — sem nunca virar ordem.

**Acceptance Scenarios**:

1. **Given** um ciclo com mercado lido, **When** o setup declara que quer ser consultado, **Then**
   recebe o objecto de factos com a idade do dado e responde um dos quatro valores.
2. **Given** um facto que a corretora não fornece, **When** o objecto chega ao setup, **Then** o campo
   vem **ausente e declarado como ausente** — nunca um valor neutro calculado pela mesa.
3. **Given** uma proposta com valor fora dos quatro (`limpar`), **When** a mesa a recebe, **Then** trata
   como `hold`, registra a invalidade e conta-a para o limite de inválidos seguidos.
4. **Given** um setup que declara não querer ser consultado neste ciclo, **When** o ciclo corre, **Then**
   a mesa mantém a posição e não re-cotiza.

---

### User Story 2 - A boleta atravessa sem perder o sentido (Priority: P1)

A mesa escreve a **boleta** em unidades que valem em qualquer corretora — percentagem do saldo,
alavancagem, percentagens de movimento — e o conector recebe-a inteira, sem ter de adivinhar nada. A
boleta diz o que se quer, não como a corretora o escreve.

**Why this priority**: é a mensagem central do projeto. Se ela exigir a unidade de uma corretora, o core
deixa de ser universal e cada venue novo obriga a mexer no core.

**Independent Test**: com o mock de conector, expede-se uma boleta e verifica-se que **nenhum** dos seus
campos está em unidade de venue; em seguida expede-se uma boleta com quantidade/lote/preço absoluto e
verifica-se que é **recusada com motivo** e que nada foi enviado.

**Acceptance Scenarios**:

1. **Given** uma ficha e uma proposta, **When** a mesa monta a boleta, **Then** ela declara lado, tipo,
   percentagem do saldo, alavancagem, stop e tp em percentagem de movimento (ou ausentes), parcial,
   desvio máximo, prazo da passiva, destino do resto, reduce-only, referência do cliente e marca de posse.
2. **Given** uma boleta sem política de execução parcial declarada, **When** a mesa tenta expedi-la,
   **Then** a boleta **não sai** e o motivo fica registado.
3. **Given** uma boleta que pede algo que o manifesto do conector não declara suportar, **When** esta
   chega à fronteira, **Then** a mesa **recusa** — não adapta, não arredonda, não improvisa.
4. **Given** um conector cuja menor unidade do instrumento exige mais do que a banda autorizada, **When**
   ele traduz a boleta, **Then** **recusa com motivo** em vez de arredondar para caber.

---

### User Story 3 - O conector declara antes de executar, e o desfecho é classificado (Priority: P1)

Antes de qualquer ordem ir ao venue, o conector devolve a **resolução**: quantidade, nocional, margem
empenhada, alavancagem efectiva e preço de liquidação. É com ela na mão que a mesa confere a banda e
decide se a ordem sai. Depois, o **desfecho** volta normalizado: aceite, parcial, desconhecido ou
recusado — e o desconhecido nunca é apresentado como sucesso nem como falha.

**Why this priority**: é o que permite o "não" da mesa na última porta, e o que impede o pior estado
possível — a mesa a acreditar numa posição que não existe.

**Independent Test**: com o mock de conector, devolve-se uma resolução **fora da banda** e verifica-se
que a mesa registra inconformidade e **envia zero ordens**; devolve-se depois uma resposta **sem
confirmação no prazo** e verifica-se que o desfecho é `desconhecido`, que o instrumento fica marcado e
que nenhuma ordem nova sai até reconciliar.

**Acceptance Scenarios**:

1. **Given** uma boleta válida, **When** o conector devolve a resolução, **Then** a mesa confere-a
   contra a banda autorizada **antes** de a ordem ser executada.
2. **Given** uma resolução dentro da banda, **When** a ordem é executada, **Then** boleta, resolução e
   resposta do venue vão **inteiras** para o registo.
3. **Given** resposta do venue sem confirmação no prazo declarado, **When** o desfecho é classificado,
   **Then** é `desconhecido` — nunca sucesso, nunca falha — e o instrumento fica marcado até reconciliar.
4. **Given** uma recusa explícita do venue, **When** o desfecho chega, **Then** traz o **motivo**, e não
   é o silêncio a fazer de resposta.
5. **Given** um reenvio com a mesma referência de cliente, **When** a corretora não declara idempotência,
   **Then** a mesa reconcilia antes de reenviar e **nenhuma ordem duplicada** é criada.

---

### User Story 4 - O mesmo contrato, noutra linguagem (Priority: P2)

Um segundo implementador — o **mock do outro lado**, escrito numa linguagem diferente da do core —
atende ao mesmo contrato e passa os mesmos casos, sem que nada no contrato mude para o acomodar.

**Why this priority**: é a prova da neutralidade. Sem ela, "o contrato é neutro" é uma intenção; com ela,
é um facto medido. É também o que impede o core de voltar a ser o centro do mundo por conveniência de
linguagem.

**Independent Test**: corre-se a mesma bateria de casos contra as duas implementações da fronteira e
compara-se o veredicto caso a caso: têm de ser idênticos, com zero alterações ao contrato.

**Acceptance Scenarios**:

1. **Given** a bateria de casos do contrato, **When** é corrida contra a implementação da ponta na
   linguagem do core, **Then** passa.
2. **Given** a mesma bateria, **When** é corrida contra o mock escrito noutra linguagem, **Then** passa
   com os **mesmos veredictos**, sem excepções feitas ao contrato.
3. **Given** um caso que produz mensagem inválida, **When** corre contra as duas implementações,
   **Then** ambas recusam, com o mesmo motivo normalizado.

---

### User Story 5 - A posse reconhece-se pela marca (Priority: P2)

Toda ordem leva uma **marca de posse** curta, numérica e determinística, gerada pela mesa, na forma que
caiba na corretora mais restritiva. Depois de a mesa reiniciar, é pelo que a corretora reporta que ela
reconhece **as suas** posições — sem base de dados própria — e o que não tem a marca é visto como alheio.

**Why this priority**: é o que permite reconciliar e retomar sem inventar estado. É P2 e não P1 porque só
morde quando há reinício ou posição pré-existente.

**Independent Test**: marca-se uma ordem no mock, reinicia-se a mesa e verifica-se que ela reencontra a
posição **pelos registos do venue**; em seguida injeta-se uma posição sem a marca e verifica-se que é
tratada como alheia, vista e não gerida.

**Acceptance Scenarios**:

1. **Given** uma ordem expedida, **When** ela chega ao venue, **Then** leva a marca na forma que o
   manifesto declara ser aceite.
2. **Given** a mesa reiniciada com posição aberta, **When** ela reconcilia, **Then** reconhece como suas
   as posições com a marca e o resto como alheio.
3. **Given** um venue cujo manifesto declara **`nenhuma`** forma de marca, **When** a mesa precisa de
   saber a posse, **Then** declara que cai para o registo das decisões, e fá-lo explicitamente — nunca em
   silêncio.
4. **Given** uma posição sem a marca da mesa, **When** o ciclo corre, **Then** ela é **vista, não
   gerida**: nenhuma ordem de fecho é enviada por iniciativa da mesa.

---

### User Story 6 - O trilho do dinheiro aparece sem ser recalculado (Priority: P3)

O conector expõe o histórico da corretora — execuções, taxas, funding, resultado realizado e o detalhe
de cada ordem — numa vista normalizada, e a mesa mostra-o. Ninguém recalcula nada a partir de execuções.

**Why this priority**: é o que separa os dois trilhos e o que dá sentido ao funding ser explícito. É P3
porque o contrato já funciona sem isto, mas sem isto a comparação de setups fica cega.

**Independent Test**: com o mock de conector, pede-se o histórico e verifica-se que ele chega
normalizado, com taxas e funding **separados** e o resultado **tal como a corretora o reporta**; e
verifica-se que nenhum caminho do contrato prevê a mesa calcular o resultado.

**Acceptance Scenarios**:

1. **Given** uma ordem executada, **When** o histórico é pedido, **Then** volta normalizado —
   execuções, taxas, funding e resultado realizado — sem que a mesa o recalcule.
2. **Given** um venue que reporta funding à parte, **When** o histórico chega, **Then** o funding vem
   **explícito e separado**, para se poder julgar a viabilidade de um setup.

---

### Edge Cases

- **Campo a mais, a menos, tipo errado ou unidade em falta**: o contrato é **fechado** — campo que ele não
  declara é recusado, nunca ignorado em silêncio.
- **Segredo no contrato**: qualquer credencial, token ou segredo nos ficheiros do contrato, dos mocks ou
  dos casos recusa a revisão — o contrato fala de **referências**, nunca de valores (RN-E14).
- **Campo calculado no objecto** (média, classificação, adjectivo): é defeito do contrato — a mesa entrega
  factos e quem calcula é o setup (RN-T2).
- **`reduce-only` num venue sem garantia nativa**: a mesa garante pelo tamanho e reconcilia depois; o
  contrato declara **qual dos dois casos** é (RN-B5).
- **Manifesto que não bate com o venue**: a divergência é **detectada** pela bateria e recusa a operação
  (RN-C7).
- **Escalas equivalentes** (`1.50` e `1.5`): comparadas como iguais, mas **registadas como recebidas**; o
  contrato nunca reescreve o que recebeu.
- **Valores-limite**: zero, negativo, percentagem acima da banda, quantidade abaixo do mínimo do
  instrumento — cada um com a sua recusa, com motivo.
- **Mercado fechado** no meio do ciclo: é **estado**, não erro.
- **Livro ausente, funding ausente, profundidade não declarada**: ausente é ausente.
- **Setup silencioso** além do prazo declarado: congela a abertura, sem cancelar o que já serve.
- **Resposta duplicada ou fora de ordem**: a mesma referência não produz segunda ordem nem segunda
  posição.
- **Duas pontas com versões diferentes do contrato**: recusa **antes** de qualquer envio — nunca
  adaptação silenciosa de uma versão à outra.
- **Instrumento desconhecido no manifesto**: recusa; a mesa não envia para o que não foi declarado.

## Requirements *(mandatory)*

### Functional Requirements

**O contrato em si**

- **FR-001**: O contrato DEVE ser uma **fonte única e neutra de linguagem**, da qual cada linguagem gera
  os seus tipos — nenhum par de tipos partilhados entre linguagens diferentes (RN-E16).
- **FR-002**: Toda mensagem DEVE declarar a **versão do contrato**; versões diferentes recusam antes de
  qualquer envio (RN-E18).
- **FR-003**: Dinheiro e percentagens DEVEM atravessar como **decimal textual**; nenhum campo de valor
  pode ser número de vírgula flutuante (RN-E19).
- **FR-004**: O contrato DEVE ter **mocks dos dois lados**, e pelo menos um escrito **noutra linguagem**
  que não a do core (RN-E17).
- **FR-005**: O contrato DEVE ser **fechado**: campo que ele não declara é motivo de recusa, com motivo
  normalizado.
- **FR-006**: O contrato, os mocks e os casos NUNCA contêm credenciais; a ligação vem de fora, por
  referência (RN-E14).

**Proposta e objecto de mercado (mesa ↔ setup)**

- **FR-007**: O objecto de mercado DEVE conter apenas **factos**: preço (bid, ask, último), livro quando
  houver (com a profundidade declarada), posição e equity, funding quando existir, o tempo do venue e a
  **idade do dado** (RN-D1).
- **FR-008**: Um facto que a corretora não fornece DEVE chegar como **ausente declarado**, nunca como
  valor neutro calculado (RN-D4).
- **FR-009**: A proposta DEVE carregar o **relógio do setup** e um de **quatro valores** (`buy`, `sell`,
  `hold`, `caixa`); qualquer outro valor é inválido, tratado como `hold` e registado (RN-T4, RN-T5).
- **FR-010**: Os inválidos **seguidos** DEVEM ser contáveis contra o limite declarado pelo dono (RN-T4).
- **FR-011**: O objecto entregue ao setup e ao humano DEVE ser o mesmo, no mesmo instante lógico (RN-D5).
- **FR-012**: O contrato NUNCA transporta indicadores, médias, classificações ou adjectivos: factos,
  apenas (RN-T2).

**Boleta (mesa → conector)**

- **FR-013**: A boleta DEVE transportar: ciclo, instrumento, lado, tipo, percentagem do saldo,
  alavancagem, stop e tp em **percentagem de movimento** (ou ausentes), política de execução parcial,
  desvio máximo, prazo da passiva, destino do resto, reduce-only, referência do cliente e **marca de
  posse**.
- **FR-014**: **Nenhum** campo da boleta pode estar em unidade de corretora — quantidade, contrato, lote,
  ponto, tick, preço absoluto (RN-B0).
- **FR-015**: A política de execução parcial DEVE ser campo obrigatório; sem ela declarada, a boleta não
  sai (RN-B6).
- **FR-016**: A boleta DEVE ser conferida contra o **manifesto** antes do envio; sem capacidade declarada
  para o que ela pede, a mesa recusa (RN-B3).
- **FR-017**: A boleta DEVE ir **integral** para o registo, junto com a resolução e a resposta do venue
  (RN-B2).
- **FR-018**: `reduce-only` DEVE viajar como **intenção**; onde o venue não a garante, a garantia é da
  mesa, e o contrato DEVE permitir declarar qual dos dois casos é (RN-B5).

**Resolução e desfecho (conector → mesa)**

- **FR-019**: A resolução DEVE devolver quantidade, nocional, margem empenhada, alavancagem efectiva e
  preço de liquidação, **antes** de a ordem ser executada (RN-C10).
- **FR-020**: O desfecho DEVE ser normalizado em **aceite, parcial, desconhecido ou recusado**; a recusa
  traz **motivo** e o desconhecido nunca é reportado como sucesso nem como falha (RN-C2, RN-T7.1).
- **FR-021**: O desfecho DEVE carregar a **resposta original do venue**, para que o registo não dependa de
  interpretação da mesa.
- **FR-022**: Reenvio com a mesma referência de cliente NUNCA duplica ordem; onde não houver idempotência
  declarada, a mesa reconcilia antes de reenviar (RN-C4).

**Manifesto (conector → mesa)**

- **FR-023**: O manifesto DEVE ser **sondado** no arranque — nunca constante escrita no código — e
  declarar instrumentos e unidades (mínimo, passo, tick), alavancagem máxima por instrumento e escalão,
  se sabe ajustar alavancagem e em que modos, teto de valor por ordem, modelo de posição (netting ou
  hedging), tipos de ordem disponíveis, política de parcial suportada, desvio máximo, `reduce-only`
  nativo, stop anexo, profundidade de livro, funding, relógio de fecho de barra, idempotência, **forma da
  marca de posse**, estado do mercado e **versão do contrato** (RN-C1, RN-D8, RN-E18).
- **FR-024**: Divergência entre o manifesto declarado e o comportamento observado DEVE ser **detectada** e
  recusar a operação (RN-C7).

**Posse**

- **FR-025**: A marca de posse DEVE ser curta, **numérica e determinística**, gerada pela mesa, e caber
  na **forma mais restrita** dos venues que a transportam (RN-B10).
- **FR-026**: O contrato DEVE declarar como a posse se lê do venue, sem que a mesa mantenha base de dados
  própria de posições (RN-T16.1).
- **FR-027**: Uma posição **sem** a marca da mesa DEVE ser representável como **alheia**: vista, não
  gerida (RN-T16).

**Histórico e mercado**

- **FR-028**: O conector DEVE expor o histórico da corretora — execuções, taxas, funding, resultado
  realizado e detalhe de cada ordem — numa **vista normalizada**, e o contrato NUNCA prevê campo para a
  mesa reconstruir resultado a partir de execuções (RN-C11, RN-D6).

### Key Entities

- **Objecto de mercado**: os factos de um instante — preços, livro e a sua profundidade, posição e equity,
  funding, tempo do venue e **idade do dado**; ausências declaradas.
- **Proposta**: a resposta do setup — um dos quatro valores, o seu relógio, e a invalidade quando existe.
- **Boleta**: a mensagem padrão da mesa ao conector, em unidades neutras, com a marca de posse.
- **Resolução**: o que o conector vai enviar, em unidades da sua corretora, **antes** de enviar.
- **Desfecho**: a classificação normalizada da resposta do venue (aceite, parcial, desconhecido,
  recusado), com motivo e a resposta original.
- **Manifesto**: o que o conector declara saber fazer, sondado — incluindo a forma da marca e a versão.
- **Marca de posse**: identificador curto e determinístico que liga a ordem à mesa e à ficha.
- **Envelope do registo**: a decisão inteira — objecto, proposta, boleta, resolução e desfecho — como uma
  unidade reexecutável.
- **Versão do contrato**: o número que as pontas conferem antes de conversar.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **Zero** campos da boleta em unidade de corretora, verificado por inspecção automática do
  contrato — não por revisão de olho.
- **SC-002**: Duas implementações independentes, em linguagens diferentes, passam **100%** da bateria de
  casos com veredictos idênticos, sem qualquer alteração ao contrato.
- **SC-003**: **100%** das mensagens inválidas dos casos (campo a mais, tipo errado, valor fora dos
  quatro, unidade em falta) são recusadas com motivo normalizado; **zero** ordens disparadas a partir de
  mensagem inválida.
- **SC-004**: Valores de dinheiro e percentagens sobrevivem à ida e volta **sem perda**: em 100% dos
  casos, o valor devolvido é exactamente o valor enviado (nenhuma diferença de último dígito).
- **SC-005**: Com versões divergentes do contrato, **zero** ordens enviadas antes da recusa.
- **SC-006**: Após reinício, **100%** das posições com a marca da mesa são reencontradas pelos registos
  do venue; **zero** posições sem marca são geridas.
- **SC-007**: **Zero** desfechos desconhecidos classificados como sucesso ou como falha.
- **SC-008**: Reenvio com a mesma referência de cliente produz **zero** ordens duplicadas, nos casos que
  cobrem venue com e sem idempotência declarada.
- **SC-009**: **100%** da bateria de casos corre **sem ligação a nenhuma corretora** — a fronteira
  prova-se isolada.
- **SC-010**: Uma ponta nova (um setup ou um conector) fica utilizável conhecendo **apenas** o contrato:
  nenhum dos casos exige ler código da mesa para saber o que fazer.

## Assumptions

- **A linguagem de cada plugin decide-se na spec desse plugin** (RN-E16); é por isso que o contrato é
  neutro e os tipos de cada linguagem são **gerados** dele. Core e web em TypeScript, `/tools` em Python.
- **A notação do schema não é decidida aqui**: este recorte diz *o que* o contrato tem de expressar
  (incluindo decimais textuais, ausências declaradas e recusas com motivo); a escolha da notação e dos
  geradores é do plano.
- **O envelope do registo faz parte deste recorte**, porque é ele que torna a decisão reexecutável.
- **O primeiro setup pode ser o manual** (o lado vem de uma pessoa); o contrato é o mesmo, sem campo de
  origem na boleta.
- **Contrato v1**: nenhum dos dois plugins existe ainda, portanto não há compatibilidade anterior a
  preservar; a primeira versão pode ser fechada sem cerimónia de migração.
- **Os números não estão no contrato**: bandas, limites e valores são chave de config, valor do dono
  (RN-A1). O contrato governa a **forma**, e o inventário de chaves a lê daqui.
- **O motor que opera hoje** (`~/Projects/jev-trade-fusao`) é fonte de consulta para os casos que só se
  sabem por ter corrido contra a corretora de verdade; os seus vectores alimentam a bateria de SC-002.
