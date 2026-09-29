# Feature Specification: O primeiro conector real — Hyperliquid, em ambiente de teste

**Feature Branch**: `004-conector-hyperliquid`

**Created**: 29 set 2026

**Status**: Draft

**Input**: Pedido do dono: «vamos ao primeiro conector e temos um exemplo em teste na conta real. como base no
venue do outro projeto, crie a regra de negócio, máquina de estados para podermos criar as spec/task do nosso
primeiro plugin.» A regra de negócio (`docs/regra-de-negocio-conector.md`, família **RN-H**) e a máquina de
estados (`docs/maquina-de-estados-conector.md`) estão escritas e foram confrontadas com a documentação oficial
do venue.

## O que este recorte é, e o que ele não é

**É** o primeiro conector **a sério**: um processo por (corretora, conta) que fala a língua do contrato neutro
de um lado e a do venue do outro, com a **bateria de conformidade** a correr no **ambiente de teste** do venue,
e o resultado registado por versão. É ele que destrava a ida a campo: sem conector não há ligação nenhuma.

**Não é** (e fica declarado para não parecer esquecimento):

- **dinheiro real**: este recorte corre em teste e a passagem a produção é decisão declarada do dono (RN-H17);
- **o setup** — o outro lado da mesa, com recorte próprio;
- **a superfície web** — ela consome, não decide;
- **a conferência de banda da mesa (D-001)** — o conector **entrega** a resolução; quem a confere contra a
  banda é a mesa, e esse defeito fecha-se onde ele mora;
- **o dublê do conector** (o `contracts/mocks/conector/` do recorte 001): ele é o espelho de contrato, e
  continua a servir os recortes que não podem depender de uma corretora.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O conector arranca, sonda o venue e publica o manifesto, sem constantes no código (Priority: P1)

O vigia arranca o conector. O conector liga-se ao venue **e lê de lá** o que este oferece: instrumentos,
`szDecimals` e o passo que dele sai, alavancagem máxima, tipos de ordem, reduce-only nativo ou não, mínimo,
taxas e funding. Publica isso como **manifesto** — e a mesa recusa arrancar se o instrumento do mandato não
estiver lá, dizendo **qual**.

**Why this priority**: é a razão de o conector existir, e é o que separa um conector de um ficheiro de
configuração. Um número do venue copiado para o nosso código é um número que ninguém volta a conferir — e é o
primeiro defeito que este recorte tem de tornar impossível.

**Independent Test**: correr o conector contra o **ambiente de teste** do venue e ler o manifesto; depois
pedir um instrumento que não existe e ver a recusa com o nome dele.

**Acceptance Scenarios**:

1. **Given** o venue acessível e uma conta de teste, **When** o vigia arranca o conector, **Then** o manifesto é publicado com os instrumentos e os limites **lidos do venue**, e o conector diz qual versão de contrato fala.
2. **Given** o manifesto publicado, **When** o dono muda a alavancagem máxima do instrumento **no venue**, **Then** o manifesto seguinte reflecte a mudança **sem que uma linha de código nosso mude**.
3. **Given** um mandato que nomeia um instrumento inexistente, **When** o conector arranca, **Then** recusa e diz **qual** o instrumento que não encontrou.

---

### User Story 2 - O que não cabe é recusado com motivo; nada se ajusta em silêncio (Priority: P1)

A mesa manda a boleta em unidades neutras: percentagem do saldo, alavancagem, percentagens de movimento. O
conector converte para a unidade do instrumento — e quando o resultado não cabe (abaixo do mínimo, fora do
passo, acima do máximo nocional, preço com mais casas do que o venue aceita), **recusa com o motivo**, em vez
de arredondar para o valor mais próximo.

**Why this priority**: é a diferença declarada face ao motor antigo (que corta com `lot()`), e é a diferença
entre operar o que o dono autorizou e operar um número que ninguém autorizou.

**Independent Test**: mandar uma boleta que calcula 0,0004 de um instrumento cujo passo é 0,001 e ver a recusa
com o passo nomeado — e nenhuma ordem no venue.

**Acceptance Scenarios**:

1. **Given** uma quantidade que cai fora do passo do instrumento, **When** chega a boleta, **Then** o desfecho é `recusado` com o motivo a nomear o passo, e **nenhuma** ordem é enviada.
2. **Given** um nocional abaixo do mínimo do venue, **When** chega a boleta, **Then** a recusa é a **do venue**, com a palavra dele.
3. **Given** um preço com mais de 5 algarismos significativos, **When** chega a boleta, **Then** a recusa acontece **antes** do envio, e o motivo diz a regra.
4. **Given** uma boleta de entrada que pede post-only, **When** é enviada, **Then** ela nunca cruza: se o venue a recusar por cruzamento, o desfecho é `recusado` — o conector **não** corrige o preço para caber.

---

### User Story 3 - A resolução sai antes de executar; o desfecho sai depois, com os números do venue (Priority: P1)

Antes de mandar executar, o conector devolve à mesa a **resolução**: quantidade na unidade da corretora,
nocional, margem, alavancagem efectiva e preço de liquidação — para a mesa conferir contra a banda e gravar no
ledger. Depois da resposta, devolve o **desfecho** normalizado, com os números que o venue deu.

**Why this priority**: é o que mantém o dinheiro e a posse do lado da corretora (princípio VI) e o que permite
à mesa dizer «não» antes de a ordem existir. Sem isto, a mesa decide sobre estimativas.

**Independent Test**: enviar uma boleta e ver a resolução chegar antes do envio (com os números), e o desfecho
depois (com os números do venue, e nenhum calculado por nós).

**Acceptance Scenarios**:

1. **Given** uma boleta válida, **When** o conector a recebe, **Then** sai a `resolução` **antes** de qualquer ordem no venue, com quantidade, nocional, margem e alavancagem.
2. **Given** uma resposta do venue com execução parcial, **When** o conector a lê, **Then** o desfecho é `parcial` e os números são os do venue.
3. **Given** uma recusa do venue, **When** o conector a lê, **Then** o desfecho é `recusado` e o motivo é a **palavra do venue**, não a nossa interpretação.

---

### User Story 4 - Silêncio é estado, e reconciliar vem antes de agir (Priority: P1)

A ordem foi enviada e o venue não respondeu. Dentro do prazo declarado, o desfecho é `espera`; passado o prazo,
é **`desconhecido`** — nunca sucesso, nunca falha. E, naquele instrumento, **não entra ordem nova** enquanto o
desconhecido não for reconciliado com o que o venue conta (posição, ordens abertas, execuções desde o
instante). Fechar ou reduzir continua permitido: é a única ordem que não precisa de leitura.

**Why this priority**: é onde moram as perdas caras — «reenviei porque não respondeu» e «deve ter falhado». A
regra já existe (RN-C18, RN-T7.1) e ainda não tem quem a cumpra num venue real.

**Independent Test**: cortar a resposta do venue dentro do prazo (prazo curto) e ver `espera` → `desconhecido`;
voltar a ligar e ver a reconciliação encontrar a posição real; e ver um pedido novo ser recusado com o motivo.

**Acceptance Scenarios**:

1. **Given** uma ordem enviada e sem resposta dentro do prazo, **When** o prazo passa, **Then** o desfecho é `desconhecido` — nunca `aceite`.
2. **Given** um `desconhecido` por reconciliar naquele instrumento, **When** chega uma boleta de **abertura**, **Then** é recusada com o motivo; **When** chega uma boleta de **fecho**, **Then** é atendida.
3. **Given** o `desconhecido`, **When** o conector relê o venue, **Then** o desfecho é corrigido para o que o venue conta, e o registo mostra os dois.

---

### User Story 5 - A mesma referência não cria segunda ordem (Priority: P2)

A mesa reenvia a mesma boleta (retentativa, rede, ou decisão do vigia). O conector usa a **referência de
cliente** que o contrato já tem e tradu-la para a referência do venue (`cloid`, 16 bytes — a documentação
oficial do venue diz a forma). Reenviar a mesma referência **não** cria segunda ordem: devolve o desfecho da
mesma ordem.

**Why this priority**: o motor antigo não tem idempotência — um reenvio pode duplicar. Não é o defeito mais
urgente, mas é o mais barato de nunca ter.

**Independent Test**: mandar duas boletas com a mesma referência e contar as ordens no venue: **uma**.

**Acceptance Scenarios**:

1. **Given** duas boletas com a mesma referência, **When** as duas chegam, **Then** existe **uma** ordem no venue e as duas respostas têm o mesmo desfecho.
2. **Given** uma referência que não cabe na forma do venue, **When** chega a boleta, **Then** o conector deriva-a pela forma declarada no manifesto — de maneira **pura** (a mesma referência dá sempre a mesma), nunca com um instante dentro.

---

### User Story 6 - Os cinco números do encerramento vêm do venue (Priority: P2)

Quando o dono manda `stop` numa posição viva, a mesa pergunta-lhe se fecha a mercado — e para isso precisa do
resumo com números **da corretora**: posição, nocional, margem, **distância de liquidação** e resultado não
realizado. Quem os dá é o conector, lendo-os do venue.

**Why this priority**: já está pedido e provado do lado da mesa (US3 do recorte 003), mas com números de dublê.
Aqui passa a haver um venue a responder.

**Independent Test**: com uma posição aberta em teste, pedir o resumo e conferir os cinco números contra o que
o venue mostra.

**Acceptance Scenarios**:

1. **Given** uma posição aberta em teste, **When** a mesa pede o resumo, **Then** os cinco números vêm do venue, e o resultado não realizado é o do venue, não um cálculo nosso.
2. **Given** **sem** posição, **When** a mesa pede o resumo, **Then** a distância de liquidação fica **ausente** — nunca zero, que pareceria um número medido.
3. **Given** uma leitura que falhou, **When** a mesa pede o resumo, **Then** o conector diz que não leu, e a mesa não inventa.

---

### User Story 7 - A bateria de conformidade corre em teste e fica registada por versão (Priority: P2)

Existe uma bateria de **oito provas** (RN-C6), cada uma com o caso feliz e o adversário, corrida no ambiente
de teste do venue, com o resultado **registado por versão do conector**. Onde a resposta da documentação
oficial do venue não for conclusiva (por exemplo: o venue **arredonda** ou **recusa** um tamanho com casas a
mais), é a bateria que decide — e o resultado entra no manifesto.

**Why this priority**: é o aceite deste recorte. Sem ela, «o conector funciona» é uma impressão.

**Independent Test**: correr a bateria e ler o resultado: 8 de 8, com cada prova a dizer o que mediu.

**Acceptance Scenarios**:

1. **Given** o ambiente de teste, **When** a bateria corre, **Then** cada uma das oito provas diz o que mediu e o número que saiu, e o resultado é registado com a versão do conector e a data.
2. **Given** uma prova que não corre (venue indisponível), **When** a bateria termina, **Then** o resultado é **incompleto** — nunca «passou».
3. **Given** uma mudança de comportamento do venue, **When** a bateria corre outra vez, **Then** a divergência aparece como **falha**, e não é absorvida.

---

### Edge Cases

- O venue **indisponível no arranque**: o conector não publica manifesto e di-lo; a mesa não arranca (porta `conectores`), com o motivo certo.
- O venue devolve **meia resposta** (aceitou, mas o preenchimento vem depois): `parcial` e depois actualização — sem nunca inventar o número que falta.
- A **ligação cai a meio de um envio**: a ordem viva passa a `desconhecida`, e nada mais é enviado naquele instrumento até reconciliar.
- Duas boletas **ao mesmo tempo** no mesmo instrumento: a segunda espera ou é recusada — nunca duas a voar.
- O instrumento **não tem** a funcionalidade (reduce-only, post-only): o manifesto **declara** a ausência e a garantia é dada ou negada — nunca prometida por engano.
- **`liquidationPx` nulo** (sem posição, ou posição em modo que não o publica): a distância é ausente e diz-se porquê.
- Um pedido que **nomeia outra conta**: recusado (uma ligação, uma chave, um processo).
- **Credencial ausente**: o conector não arranca e **diz o nome da credencial que falta** — nunca tenta com o que tem à mão.

## Requirements *(mandatory)*

### Functional Requirements

**O manifesto (a sonda, não a constante)**

- **FR-001**: O conector DEVE ler do venue, **a cada arranque**, os instrumentos, o `szDecimals` de cada um, a alavancagem máxima, os tipos de ordem aceites, o mínimo nocional, as taxas da conta e o funding — e publicá-los como manifesto, **sem nenhum desses valores constante no código** (RN-H1, RN-C1, RN-C7).
- **FR-002**: O manifesto DEVE ser **por (corretora, conta)** e DEVE nomear a **versão do contrato** que o conector fala (RN-C19, RN-E18).
- **FR-003**: O conector DEVE recusar arrancar quando um instrumento do mandato **não existir** no venue, dizendo qual (RN-H3).
- **FR-004**: O manifesto DEVE declarar o que o venue **não** oferece (reduce-only nativo, post-only, stop anexo) e, quando faltar, dizer como a garantia é dada ou que ela **cai** (RN-H7, RN-H8).
- **FR-005**: O manifesto DEVE declarar a **forma da referência do venue** e a sua derivação a partir da referência do contrato (RN-H9).

**A tradução (a boleta → a ordem)**

- **FR-006**: O conector DEVE converter a boleta em unidades neutras (percentagem do saldo, alavancagem, percentagens de movimento) para a **unidade do instrumento** e o preço nas regras do venue, e DEVE devolver a `resolução` **antes** de enviar sempre que o venue o permita (RN-H4, RN-H10).
- **FR-007**: O conector **NUNCA** DEVE adaptar uma boleta em silêncio: quantidade fora do passo, nocional abaixo do mínimo, preço fora das regras, alavancagem fora do intervalo — cada um é **recusa com motivo**, e nenhuma ordem é enviada (RN-C3, RN-H5, RN-H6).
- **FR-008**: A alavancagem DEVE ser pedida ao venue quando houver esse verbo, e **só** se for um inteiro dentro do intervalo aceite; fora disso, recusa com o máximo nomeado (RN-H6).
- **FR-009**: O conector DEVE respeitar post-only quando a boleta o pedir, e **nunca** corrigir preço para fazer caber: se o venue recusar por cruzamento, a recusa é o resultado (RN-H7).
- **FR-010**: O conector DEVE pedir reduce-only quando a boleta o pedir, e o manifesto DEVE declarar se a corretora o suporta nativamente (RN-H8).
- **FR-011**: A referência de cliente DEVE ser derivada para a forma do venue por função **pura e declarada**, e **nenhum** reenvio da mesma referência DEVE criar segunda ordem (RN-H9, RN-C4).

**O desfecho (e o que não é desfecho)**

- **FR-012**: Todo pedido DEVE produzir um desfecho normalizado com uma das quatro classificações do contrato — `aceite`, `parcial`, `desconhecido`, `recusado` — com motivo na recusa e com os números **do venue** (RN-C2, RN-C14).
- **FR-013**: Silêncio dentro do prazo declarado DEVE ser `espera`; além do prazo, `desconhecido` — **nunca** sucesso (RN-C18, RN-H12).
- **FR-014**: O conector DEVE reconciliar um `desconhecido` **antes** de aceitar qualquer ordem nova naquele instrumento, lendo posição, ordens abertas e execuções desde o instante; **fechar ou reduzir** DEVE continuar permitido (RN-H13, RN-H19).
- **FR-015**: O conector NUNCA DEVE deduzir sucesso, falha ou resultado por contagem própria: o que não está no venue está **desconhecido** (RN-H14, RN-D6).

**As leituras**

- **FR-016**: O conector DEVE expor as leituras que a mesa pede — posição, equity, marcas e os **cinco números** do resumo do encerramento (posição, nocional, margem, distância de liquidação, resultado não realizado) — com a **origem** de cada um nomeada (RN-C11).
- **FR-017**: Sem posição, a distância de liquidação DEVE ser **ausente**, nunca zero; e uma leitura falhada DEVE ser dita como falha, nunca substituída por um valor anterior.
- **FR-018**: O histórico exposto DEVE ser o do venue (execuções, taxas, funding, resultado realizado), sem reconstrução por soma (RN-C11, RN-H14).

**Ligação e processo**

- **FR-019**: O conector DEVE existir como **processo próprio**, um por (corretora, conta), arrancado pelo vigia, com **uma ligação e uma chave** (RN-C16, RN-E3, RN-E21).
- **FR-020**: O estado da ligação DEVE ser o do **protocolo do venue**; silêncio DEVE ser `desconhecido`, nunca «ligado» nem «caído» (RN-C12, RN-H2).
- **FR-021**: Sem leitura da conta, o conector NUNCA DEVE enviar ordem que aumente exposição (RN-H2).
- **FR-022**: O conector DEVE recusar qualquer pedido que nomeie outra conta (RN-H15).
- **FR-023**: A credencial DEVE entrar por **referência** e NUNCA aparecer em `/config`, no ledger, no log ou na mensagem (RN-C20, RN-E14). Falta de credencial DEVE ser uma recusa **nomeada**, nunca uma tentativa com o que houver à mão.
- **FR-024**: O conector DEVE importar **`contracts`** e NUNCA o `core`, e NUNCA conter regra de decisão: não escolhe lado, tamanho, preço nem momento; não lê estratégia nem mandato; não julga risco (RN-E1, RN-C5, RN-C15).

**A bateria e o aceite**

- **FR-025**: DEVE existir a **bateria de conformidade de oito provas** (RN-C6), cada uma com o caso feliz e o adversário, corrida no **ambiente de teste** do venue, e o resultado DEVE ser registado **por versão** do conector e data (RN-C7).
- **FR-026**: Uma prova que não puder correr DEVE deixar o resultado **incompleto**, nunca «passou» (RN-C7).
- **FR-027**: Onde a documentação oficial do venue não for conclusiva, o comportamento DEVE ser **medido** pela bateria e o resultado **escrito no manifesto** — o código nunca decide por conta própria.
- **FR-028**: A passagem do ambiente de teste para **dinheiro real** DEVE ser decisão declarada do dono, com o resultado da bateria à frente (RN-H17).

### Key Entities

- **Manifesto**: o que o venue oferece àquela conta; sondado a cada arranque; nomeia a versão do contrato e a forma da referência.
- **Boleta**: o pedido em unidades neutras, como o contrato o define.
- **Resolução**: o que vai ser enviado, com números, **antes** do envio.
- **Desfecho**: o que aconteceu, numa das quatro classificações, com motivo e números do venue.
- **Leitura**: posição, equity, marcas e os cinco números do resumo, com a origem nomeada.
- **Registo da bateria**: por versão do conector e data, prova a prova, com o que mediu.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Mudar um limite **no venue** (alavancagem máxima de um instrumento) muda o manifesto seguinte **sem uma linha de código nosso mudar** — medido por dois manifestos consecutivos.
- **SC-002**: Numa série de boletas que **não cabem** (fora do passo, abaixo do mínimo, preço com casas a mais, alavancagem fora do intervalo), **0** ordens são enviadas e **100%** das respostas trazem o motivo — medido pela contagem no venue.
- **SC-003**: A mesma referência enviada duas vezes produz **uma** ordem no venue, e as duas respostas concordam no desfecho.
- **SC-004**: A bateria de conformidade corre **8 de 8** em ambiente de teste, com o resultado registado por versão; e **0** provas podem dar «passou» sem ter corrido.
- **SC-005**: Nenhum `desconhecido` se transforma em `aceite` sem uma leitura do venue: **0** transições de sucesso sem leitura, medido pelo registo.
- **SC-006**: Uma ordem abaixo do mínimo do venue devolve a **recusa do venue** (a palavra dele), não uma recusa inventada por nós.
- **SC-007**: Os cinco números do resumo batem com o que o venue mostra, para a mesma posição, no mesmo instante — **5 de 5**.
- **SC-008**: O conector não decide: **0** divergências entre o que o conector responde e o que os casos do contrato esperam, nos mesmos casos.

## Assumptions

- O venue é a **Hyperliquid**, em **ambiente de teste** (a conta de teste já existe e tem histórico de uso), e a biblioteca oficial em TypeScript é a que o outro projeto já usa em produção — a **linguagem do plugin** é decisão do plano (RN-E16), não desta spec.
- A **credencial** entra por referência, fora do repositório, e o nome dela vem do inventário de chaves; nenhum valor entra em `/config`, ledger, log ou mensagem.
- O **prazo** do silêncio (o que separa `espera` de `desconhecido`) é **do dono**, declarado na configuração — não um número do conector.
- A **mesa** já sabe ler a resolução e o desfecho: o contrato está provado nas duas linguagens desde o recorte 003.
  *Nota medida (29/09/2026, 20:07): «sabe ler» aqui significa que a **mensagem** existe e tem forma provada — não
  que o `core` a leia. Medido: `grep -rn 'resolucao' core --include=*.ts | wc -l` → **1**, e essa única ocorrência
  é texto de uma mensagem (`core/ciclo/arranque.ts:150`), não código que leia números. A conferência da banda
  (**D-001**) continua aberta, e é do lado da mesa (ver a premissa seguinte).*
- O **mínimo nocional** do venue, as taxas e o funding são lidos/sondados; os valores da documentação oficial são premissas **datadas**, a confirmar pela bateria.
- O recorte **não** corrige o **D-001** (a conferência de banda): o conector entrega os números e a mesa confere-os — o defeito fecha-se do lado da mesa.
