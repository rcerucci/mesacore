# Feature Specification: A máquina de estados da mesa

**Feature Branch**: `002-maquina-de-estados`

**Created**: 2026-09-28

**Status**: Draft

**Input**: `/speckit-specify` a partir de `docs/maquina-de-estados.md` (v1) e das 136 regras de
`docs/regra-de-negocio.md`, sobre o contrato neutro já implementado no recorte 001.

## O que este recorte é, e o que ele não é

O recorte 001 entregou a **língua**: as mensagens que as pontas trocam, validadas nas duas linguagens.
Este recorte entrega o **governo dessa língua**: em que estados a mesa pode estar, o que ela pode fazer
em cada um, o que ela **tem** de recusar, e o que sobrevive ao processo morrer.

Não é estratégia (o setup decide o lado), não é tradução (o conector traduz) e não é a web (que manda
verbos e desenha estado). É a peça do meio, e é onde estão os defeitos caros: fechar às cegas, reabrir
sem nada mudar, esquecer o que ficou sem confirmação.

Duas frases delimitam o âmbito, e vale escrevê-las porque são a tentação natural:

- a mesa **nunca corrige nada para conseguir entrar** num estado: ou passa, ou recusa com motivo;
- a mesa **não guarda posições**. Guarda marcas (sessão, inibição, desconhecido) e lê a posse da
  corretora pela marca que a ordem levou — o que a deixa reinstalar-se sem história e ainda saber o que
  é dela.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A mesa só faz o que pode fazer, e di-lo quando não pode (Priority: P1)

O dono (pela web, ou pelo vigia) manda verbos ao longo do dia: `start`, `pause`, `stop`, `reset` — e
`nova_sessao` quando é preciso abrir sessão nova. A mesa aceita os legais, recusa os ilegais **com
motivo**, e nunca muda de estado em silêncio. Quem manda um verbo recebe uma resposta que diz o que
aconteceu ou por que não aconteceu.

**Why this priority**: é a base de tudo o resto. Sem transições legais declaradas, os outros estados
não têm por onde ser alcançados, e cada verbo vira uma surpresa. É também o que torna a mesa
operável por quem não lê código.

**Independent Test**: uma bateria de pares (estado, verbo) cobrindo **todas** as combinações, legais e
ilegais; as legais mudam de estado e as ilegais são recusadas com motivo — e o estado **não muda** em
nenhuma recusa. Entrega valor sozinho: dá para operar a mesa (e ser-se recusado de forma
compreensível) sem que nada mais deste recorte exista.

**Acceptance Scenarios**:

1. **Given** a mesa `parada` sem inibição e a validação a passar, **When** chega `start`, **Then** a
   mesa vai a `em_operacao` e registra o instante de arranque.
2. **Given** a mesa `em_operacao`, **When** chega `pause`, **Then** vai a `pausada` e **para de
   abrir** — sem fechar nada que esteja aberto.
3. **Given** a mesa `parada`, **When** chega `pause`, **Then** **recusa** com motivo, e o estado
   permanece `parada`.
4. **Given** a mesa `em_operacao` **sem** posição viva, **When** chega `stop`, **Then** vai
   directamente a `parada`.
5. **Given** a mesa `em_operacao` **com** posição viva, **When** chega `stop`, **Then** vai a
   `encerrando`, apresenta o resumo e **pergunta** se fecha a mercado.
6. **Given** a mesa em qualquer estado, **When** chega `reset`, **Then** nada do que é marca
   persistida se apaga, e o resultado diz explicitamente o que **não** foi tocado.
7. **Given** a mesa `em_operacao`, **When** chega `start` outra vez, **Then** recusa com motivo
   (já está em operação) e não reinicia contadores.

---

### User Story 2 - O instrumento que não está em condições não abre (Priority: P1)

Para cada instrumento, a mesa sabe em que **condição** ele está e o que pode fazer nessa condição. O
erro que isto evita é o mais caro de todos: **fechar às cegas** — mandar fechar quando não se sabe o
que existe, ou quando o que existe não bate com o que se esperava.

**Why this priority**: é a diferença entre uma mesa que perde dinheiro por não saber o que tem e uma
que não mexe quando não sabe. Depende só de leituras do conector (do recorte 001) e não precisa de
nada dos outros estados.

**Independent Test**: a mesma proposta submetida em cada uma das cinco condições (e no caso do dado
velho), conferindo abrir/não abrir, fechar/não fechar, motivo e alarme. Entrega valor sozinho: o
instrumento deixa de abrir quando não deve.

**Acceptance Scenarios**:

1. **Given** um instrumento em `normal` com proposta válida, **When** corre o ciclo, **Then** a boleta
   é montada e enviada (respeitando mandato e template).
2. **Given** um instrumento `sem_leitura` (a leitura da posição falhou), **When** corre o ciclo,
   **Then** **não abre** e **não fecha** — e o motivo registrado diz que fechar sem saber o que existe
   é adivinhar.
3. **Given** um instrumento `divergente` (o que a mesa espera ≠ o que a corretora reporta), **When**
   corre o ciclo, **Then** não abre, não fecha por iniciativa própria, e a divergência é alarme.
4. **Given** um instrumento `congelada` (o setup falhou, calou-se ou devolveu um valor fora dos
   quatro), **When** corre o ciclo, **Then** não abre, **não cancela o que serve**, e o estado é
   alarmado.
5. **Given** um instrumento `mercado_fechado` (declarado pelo conector), **When** corre o ciclo,
   **Then** **não abre** e não fecha.
6. **Given** um instrumento com **dado velho** (leu-se, mas o dado envelheceu além do limite
   declarado), **When** corre o ciclo, **Then** **pode fechar e reduzir** e **não pode abrir**.
7. **Given** um instrumento `sem_margem` no ciclo (não coube no teto da conta), **When** o ciclo
   termina, **Then** o instrumento **não fica num estado novo**: o motivo fica registrado e o ciclo
   seguinte corre o seu caminho.
8. **Given** um instrumento em `congelada` e o setup a voltar a responder, **When** corre o ciclo,
   **Then** a condição volta a `normal` e a mesa retoma sem intervenção.
9. **Given** um instrumento `aberta` e uma ordem de fecho **recusada** pela corretora, **When** o ciclo
   termina, **Then** o instrumento volta a `aberta`, o caso é **alarmado como grave** e a nova
   tentativa fica declarada (uma recusa de fechar não é uma tentativa falhada sem consequência).

---

### User Story 3 - O desfecho desconhecido fica desconhecido (Priority: P1)

O venue ficou em silêncio: não se sabe se a ordem entrou. A mesa **não escolhe** entre sucesso e
falha — marca o instrumento como desconhecido, bloqueia ordem nova nesse instrumento, e só sai desse
bloqueio quando uma **reconciliação** decidir o que aconteceu. `reset` não limpa esta marca.

**Why this priority**: é o furo mais perigoso do sistema — um desconhecido tratado como sucesso manda
uma segunda ordem, e tratado como falha deixa uma posição órfã. Fecha o critério SC-007 que ficou por
medir no recorte 001 (o lado do conector já está medido: ele cala-se e não inventa desfecho).

**Independent Test**: com o conector em silêncio, o ciclo termina com o instrumento marcado
desconhecido; uma nova proposta para esse instrumento é recusada com motivo; uma reconciliação que
declara a ordem preenchida devolve o instrumento a `aberta`; uma que declara não preenchida devolve a
`nenhuma`; e um `reset` no meio não muda nada.

**Acceptance Scenarios**:

1. **Given** uma ordem enviada e o venue em silêncio além do prazo de resposta, **When** o ciclo
   termina, **Then** o desfecho é **desconhecido**, não "aceite" e não "recusado".
2. **Given** um instrumento com a marca `desconhecido`, **When** chega uma proposta nova para esse
   instrumento, **Then** **não abre** e o motivo registrado aponta para o desconhecido.
3. **Given** um instrumento com a marca `desconhecido`, **When** chega `reset`, **Then** a marca
   **continua lá**.
4. **Given** um instrumento com a marca `desconhecido`, **When** a reconciliação decide que a ordem
   foi preenchida, **Then** o instrumento vai a `aberta` (com o que a corretora reporta).
5. **Given** um instrumento com a marca `desconhecido`, **When** a reconciliação decide que a ordem
   não existe na corretora, **Then** o instrumento volta a `nenhuma`.
6. **Given** a marca `desconhecido` e uma reconciliação que **não consegue** decidir, **When** o ciclo
   termina, **Then** o instrumento **permanece desconhecido** e o motivo é alarmado.

---

### User Story 4 - O arranque passa por seis portas (Priority: P2)

O `start` não é um botão: é uma verificação. Manifesto, mandato, contenda, inventário de chaves,
versão do contrato e sessão — **todas** têm de passar, e a que falhar dá o motivo. A mesa **não
corrige nada** para conseguir entrar.

**Why this priority**: é o que separa "ligou" de "ligou em condições de operar". Não bloqueia as
outras histórias (uma mesa já em operação não passa por aqui), mas é a primeira coisa que dói quando
falta.

**Independent Test**: uma bateria em que cada porta é falhada de propósito, uma de cada vez, conferindo
que o arranque é recusado com o motivo **daquela** porta e que o estado não muda.

**Acceptance Scenarios**:

1. **Given** um manifesto que não declara as unidades de um instrumento configurado, **When** chega
   `start`, **Then** o arranque é recusado com o motivo da porta do manifesto.
2. **Given** um mandato com valor zero, negativo ou fora das bandas declaradas, **When** chega
   `start`, **Then** o arranque é recusado e **nada é ajustado** para tentar passar.
3. **Given** a soma das fichas acima do teto da conta **sem** política de contenção declarada,
   **When** chega `start`, **Then** o arranque é recusado (contenda não se resolve por omissão).
4. **Given** uma chave em uso que não consta do inventário, **When** chega `start`, **Then** o
   arranque é recusado.
5. **Given** uma ponta com versão de contrato incompatível, **When** chega `start`, **Then** o
   arranque é recusado **antes** de qualquer mensagem de operação.
6. **Given** uma sessão inibida ou um registro que não foi possível retomar, **When** chega `start`,
   **Then** o arranque é recusado.
7. **Given** uma porta falhada, **When** o arranque é recusado, **Then** a mesa permanece `parada` com
   o motivo da porta registrado.

---

### User Story 5 - A sessão é a unidade de comparação (Priority: P2)

Uma sessão tem começo (instante, equity de partida, autor e motivo) e **uma configuração em vigor**
(ficha, versão do setup, versão do mandato). O circuit breaker corre **por sessão**, sobre o equity
com não realizado: quando dispara, a mesa encerra, liquida o que houver e fica inibida. `start`
**recusa** enquanto a inibição estiver lá; o único caminho fora dela é `nova_sessao`.

**Why this priority**: é o que impede duas coisas más — comparar números de configurações diferentes e
voltar a operar por acidente depois de um evento grave. Depende do arranque (US4) e da defesa (US6).

**Independent Test**: um ciclo em que a perda da corrida atinge o limite declarado, conferindo que a
mesa vai a `encerrando`, liquida, fica `parada` com a inibição marcada e o motivo, que `start` recusa,
e que `nova_sessao` grava a nova configuração em vigor e levanta a inibição.

**Acceptance Scenarios**:

1. **Given** uma sessão em curso e o CB a disparar, **When** corre o ciclo, **Then** a mesa vai a
   `encerrando`, o motivo do disparo é registrado **e o aviso sai**, porque o CB está na lista de
   eventos que avisam (a lista é do dono, não do código).
2. **Given** a mesa a encerrar por CB, **When** a liquidação termina, **Then** a mesa fica `parada`
   **com a inibição marcada** e o motivo.
3. **Given** uma sessão inibida, **When** chega `start`, **Then** **recusa** — e a recusa diz que é
   preciso decidir.
4. **Given** uma sessão inibida, **When** chega `nova_sessao`, **Then** a inibição é levantada e são
   gravados instante, equity de partida, autor, motivo e a **configuração em vigor**.
5. **Given** a configuração em vigor de uma sessão, **When** o dono troca o setup **sem** abrir sessão
   nova, **Then** a mesa recusa a troca (duas configurações no mesmo número não se comparam).
6. **Given** a perda medida sobre o equity da corretora **com não realizado**, **When** a posição
   aberta caminha para o limite, **Then** o CB dispara **mesmo com a mesa pausada**.

---

### User Story 6 - A mesa pausada continua a defender (Priority: P2)

`pause` suspende **abrir**, nunca **defender**. Com a mesa pausada, o CB continua a correr, as ordens
vivas são adoptadas e reconciliadas, e a posição continua a ser vigiada. Retomar não é começar de novo.

**Why this priority**: separa "não quero ordens novas" de "não quero nada". É o que torna o `pause`
utilizável a meio de uma posição aberta, e é uma distinção que, faltando, faz o dono hesitar em pausar.

**Independent Test**: com uma posição aberta e a mesa pausada, um movimento que atinja o limite dispara
o CB e fecha; e nenhuma proposta produz ordem enquanto estiver pausada.

**Acceptance Scenarios**:

1. **Given** a mesa `pausada`, **When** o setup propõe abrir, **Then** **nada é enviado** e o motivo
   registrado é a pausa (não a estratégia).
2. **Given** a mesa `pausada` com posição aberta, **When** a perda atinge o limite declarado, **Then**
   o CB dispara e a posição é fechada.
3. **Given** a mesa `pausada` com uma ordem viva que a mesa não conhecia, **When** corre o ciclo,
   **Then** a ordem é adoptada e reconciliada, e o instrumento fica `divergente` até a reconciliação
   explicar.
4. **Given** a mesa `pausada`, **When** chega `start` (retomar), **Then** volta a `em_operacao` **sem**
   reiniciar contadores nem esquecer marcas.

---

### User Story 7 - Um pedido ignorado não paralisa a mesa (Priority: P3)

Em `encerrando`, a mesa apresenta o resumo e pergunta se fecha a mercado. Se a resposta **não chegar**,
a mesa **volta ao normal** — abre incluído — e o pedido de `stop` fica registrado como **pendente**. Um
pedido ignorado não é motivo para deixar de operar nem para operar como se nada tivesse sido pedido.

**Why this priority**: é o comportamento que evita o pior dos dois mundos (mesa congelada à espera de
uma resposta que não vem). Depende do encerramento (US1).

**Independent Test**: com a mesa em `encerrando`, deixar o prazo de resposta passar sem resposta e
conferir que a mesa voltou a `em_operacao`, que continua a abrir, e que o `stop` pendente aparece no
registo.

**Acceptance Scenarios**:

1. **Given** a mesa `encerrando` e a pergunta sem resposta dentro do prazo declarado, **When** o prazo
   passa, **Then** a mesa volta a `em_operacao` e continua a operar.
2. **Given** o `stop` ficou pendente, **When** a mesa volta ao normal, **Then** o pedido aparece
   registrado como pendente (e não como cumprido).

---

### Edge Cases

- **`stop` recebido duas vezes durante o encerramento**: a segunda não reabre a pergunta nem muda o
  estado; é registrada como repetição.
- **`reset` durante `encerrando`**: não apaga a marca de inibição nem interrompe a liquidação.
- **Queda do processo com a marca `desconhecido`**: ao voltar, a marca continua lá, e o instrumento só
  sai dela por reconciliação.
- **`sem_leitura` com posição aberta e o mercado a fechar**: a mesa **não fecha** (não sabe o que
  existe) e alarma; o instrumento fica como está.
- **`mercado_fechado` com posição aberta**: não abre e não fecha; a posição fica como está e a condição
  sai quando o conector declarar aberto.
- **Ordem viva desconhecida encontrada no arranque**: `divergente` e alarme; **cancelar só com decisão
  do dono** — a mesa não cancela o que não reconhece como seu.
- **Setup a responder fora do prazo**: o instrumento congela; a resposta tardia **não** é usada para
  abrir (chega a um instrumento congelado) e fica no registo.
- **Proposta inválida (um quinto valor, ou ausente)**: tratada como `hold`, com a invalidade
  registrada; contam para os inválidos seguidos que inibem o instrumento.
- **Divergência que a reconciliação explica** (a corretora reporta exactamente o que a mesa esperava):
  o instrumento volta a `normal` sem intervenção.
- **Contenda no arranque com a política de espera declarada**: o instrumento sem margem fica à espera
  de saldo e entra quando houver — sem virar estado próprio.
- **`nova_sessao` com posição viva**: a mesa recusa enquanto houver posição que ela reconheça como sua;
  a sessão nova não serve para "limpar" uma posição.
- **`parada` com posição viva** (o dono respondeu "manter" no encerramento): a mesa está parada e
  **nada defende** aquela posição — não há processo a correr. É a decisão do dono, e o resumo do
  encerramento tem de o dizer **antes** de ele escolher, não depois.

## Requirements *(mandatory)*

### Functional Requirements

**Estados e transições**

- **FR-001**: O estado da mesa MUST ser exactamente um de `parada`, `em_operacao`, `pausada`,
  `encerrando` (RN-V1).
- **FR-002**: A condição de cada instrumento MUST ser exactamente uma de `normal`, `sem_leitura`,
  `divergente`, `congelada`, `mercado_fechado` (RN-D7, RN-D8, RN-S8, RN-T13).
- **FR-003**: A posição de cada instrumento MUST ser exactamente uma de `nenhuma`, `abrindo`, `aberta`,
  `fechando` (RN-T7).
- **FR-004**: A mesa MUST recusar qualquer verbo que não tenha transição legal declarada a partir do
  estado em que está, registrando o motivo — e MUST NOT alterar o estado nessa recusa (RN-V1).
- **FR-005**: `reset` MUST NOT apagar nenhuma marca persistida (`sessao`, `inibicao_cb`,
  `desconhecido`) e MUST declarar o que não foi tocado (RN-V3).
- **FR-006**: `sem_margem` MUST NOT ser um estado: MUST ser motivo registrado no ciclo (RN-M4.8).
- **FR-007**: A mesa MUST registrar, por ciclo e por instrumento, o motivo de cada decisão de não
  fazer (não abrir, não fechar, não cancelar) — um motivo declarado, nunca uma omissão.

**Estados da mesa**

- **FR-008**: `parada` MUST NOT operar nada, e MUST permanecer em `parada` quando um `start` for
  recusado, com o motivo registrado (RN-V1).
- **FR-009**: `em_operacao` MUST ler, consultar o setup pelo relógio **dele**, montar a boleta, enviar,
  reconciliar e registrar (RN-T1 a RN-T12).
- **FR-010**: `pausada` MUST suspender a **abertura** e MUST manter a **defesa**: o CB corre, ordens
  vivas são adoptadas e a posição é reconciliada (RN-V2, RN-V2.1).
- **FR-011**: `encerrando` MUST parar de abrir, apresentar o resumo do que está aberto e **perguntar**
  se fecha a mercado (RN-V7, RN-V8).
- **FR-012**: `stop` MUST levar a `parada` quando não há posição viva, e a `encerrando` quando há
  (RN-V7).
- **FR-013**: A resposta "fechar a mercado" MUST liquidar antes de a mesa chegar a `parada`; a resposta
  "manter" MUST levar a `parada` **com a posição viva** e o motivo registrado.
- **FR-014**: Sem resposta dentro do prazo declarado, a mesa MUST voltar a `em_operacao` — a abrir
  incluído — e MUST registrar o pedido de `stop` como **pendente** (RN-V9.1).

**Condição e posição do instrumento**

- **FR-015**: Qualquer condição diferente de `normal` MUST impedir a abertura (RN-D3, RN-D7, RN-D8,
  RN-S8, RN-T13).
- **FR-016**: `sem_leitura` MUST impedir **fechar** por iniciativa da mesa: fechar sem saber o que
  existe é adivinhar (RN-D7).
- **FR-017**: `divergente` MUST impedir fechar por iniciativa própria e MUST alarmar; a saída MUST ser
  uma reconciliação que explique o que a corretora reporta (RN-T13).
- **FR-018**: `congelada` MUST impedir abrir **e** cancelar o que serve, e MUST alarmar; a saída MUST
  ser o setup voltar a responder dentro do prazo (RN-S8, RN-T10, RN-E15).
- **FR-019**: `mercado_fechado` MUST impedir abrir e fechar, e a saída MUST ser a declaração de aberto
  pelo conector (RN-D8).
- **FR-020**: Com **dado velho** (idade acima do limite declarado), a mesa MUST permitir fechar e
  reduzir, MUST impedir abrir, e MUST alarmar (RN-D3).
- **FR-021**: Uma ordem viva que a mesa não reconheça como sua MUST levar o instrumento a `divergente`
  com alarme, e MUST NOT ser cancelada sem decisão do dono (RN-T14).
- **FR-022**: A posse de uma posição MUST ser lida da **corretora**, pela marca de posse que a ordem
  levou, e MUST NOT depender de um registo próprio de posições (RN-T16.1).
- **FR-023**: `abrindo` MUST ir a `aberta` no aceite, e tratar o resto da parcial pela política
  declarada na boleta (RN-B6, RN-B8).
- **FR-024**: `abrindo` com recusa MUST voltar a `nenhuma` com o motivo registrado.
- **FR-025**: `aberta` MUST ir a `fechando` por proposta de saída, stop no venue, CB ou encerramento a
  mercado (RN-T7, RN-M3.1).
- **FR-026**: `fechando` com recusa de fechar MUST alarmar como caso grave, com nova tentativa
  declarada — nunca como tentativa falhada sem consequência (RN-T7.3).

**Desfecho desconhecido**

- **FR-027**: Um desfecho sem confirmação dentro do prazo MUST ser classificado `desconhecido` — nunca
  promovido a `aceite` nem rebaixado a `recusado` (RN-T7.1, RN-V3).
- **FR-028**: A marca `desconhecido` MUST bloquear ordem nova **naquele instrumento** (RN-T7.1).
- **FR-029**: A saída da marca `desconhecido` MUST ser exclusivamente uma reconciliação que decida,
  indo a `aberta` ou a `nenhuma`; `reset` MUST NOT a remover (RN-V3).
- **FR-030**: Enquanto a reconciliação não conseguir decidir, o instrumento MUST permanecer
  `desconhecido` e o motivo MUST alarmar.

**Arranque**

- **FR-031**: `start` MUST passar por seis portas — manifesto, mandato, contenda, inventário de chaves,
  versão do contrato e sessão — e MUST recusar o arranque se **qualquer** uma falhar, registrando o
  motivo daquela porta (RN-M1, RN-M9, RN-M4.7, RN-A2, RN-E18, RN-M3.3, RN-M3.4).
- **FR-032**: A mesa MUST NOT corrigir, ajustar ou completar nada para conseguir entrar em `em_operacao`
  (RN-M9).
- **FR-033**: A contenda entre fichas (soma acima do teto da conta) MUST ser resolvida por configuração
  explícita do dono; sem declaração, o arranque MUST recusar (RN-M4.7).

**Sessão, circuit breaker e inibição**

- **FR-034**: Uma sessão MUST ter instante, equity de partida, autor, motivo e **configuração em vigor**
  (ficha, versão do setup, versão do mandato) — e é a configuração em vigor que fecha a unidade de
  comparação (RN-M3.4, RN-M3.5).
- **FR-035**: O CB MUST correr **por sessão**, sobre a perda medida no equity da corretora **com não
  realizado**, contra o limite declarado (RN-M3, RN-M3.1).
- **FR-036**: O CB a disparar MUST levar a mesa a `encerrando`, liquidar o que houver e deixá-la
  `parada` com a inibição marcada e o motivo (RN-M3.1).
- **FR-037**: Com a inibição marcada, `start` MUST recusar **em qualquer hipótese** (RN-M3.3).
- **FR-038**: `nova_sessao` MUST ser o **único** caminho fora da inibição, e MUST gravar a nova
  configuração em vigor (RN-V1, RN-V10).
- **FR-039**: A mesa MUST recusar trocar setup ou ficha sem `nova_sessao` (RN-M3.5).
- **FR-040**: O CB MUST continuar a correr com a mesa `pausada` (RN-V2.1).

**Registo e alarme**

- **FR-041**: Toda transição de estado, toda recusa e todo desfecho MUST ficar registrado com
  instante, instrumento (quando aplicável) e motivo (RN-L1 a RN-L6).
- **FR-042**: Os eventos de alarme declarados na configuração (CB, encerramento, desconhecido, recusa,
  divergência, falha de leitura, contenda, congelamento) MUST produzir aviso, e a lista dos que avisam
  MUST ser do dono, não do código (RN-E15).
- **FR-043**: As marcas persistidas MUST sobreviver a reinício do processo e MUST ser legíveis sem
  interpretação do código (RN-M3.4, RN-T7.1).
- **FR-044**: Nenhum valor ajustável deste recorte (prazos, limites, listas de eventos) MUST estar
  escrito no código: MUST vir do inventário de chaves (RN-A1, RN-A2).

### Key Entities

- **Estado da mesa**: o ciclo de vida do processo (`parada`, `em_operacao`, `pausada`, `encerrando`);
  um por mesa.
- **Condição do instrumento**: o que se sabe sobre aquele instrumento agora (`normal`, `sem_leitura`,
  `divergente`, `congelada`, `mercado_fechado`); uma por instrumento configurado.
- **Posição do instrumento**: o ciclo de vida da posição (`nenhuma`, `abrindo`, `aberta`, `fechando`);
  uma por instrumento.
- **Marca persistida**: o que sobrevive ao processo (`sessao`, `inibicao_cb`, `desconhecido`), cada uma
  com o motivo que a criou e a data.
- **Configuração em vigor**: a ficha, a versão do setup e a versão do mandato que valem naquela
  sessão — a fronteira entre duas configurações comparadas.
- **Transição**: (estado, evento) → (estado, motivo); legal ou recusada, e sempre registrada.
- **Pedido pendente**: um `stop` pedido que não foi cumprido nem esquecido.
- **Ciclo**: a passagem por todos os instrumentos, com os motivos de cada decisão de não fazer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **100%** dos pares (estado, verbo) da bateria produzem transição legal ou recusa **com
  motivo** — zero mudanças de estado silenciosas, e zero recusas sem motivo.
- **SC-002**: Com o instrumento em qualquer condição diferente de `normal` (e com dado velho), **zero**
  ordens de abertura são enviadas — medido por contagem de enviadas, não por inspecção de código.
- **SC-003**: Com dado velho, **100%** dos pedidos legítimos de fechar/reduzir são permitidos e
  **zero** aberturas passam; os dois lados contados.
- **SC-004**: Um desfecho sem confirmação nunca aparece como `aceite` nem como `recusado` — **zero**
  promoções nos casos que cobrem silêncio —, e a marca resultante é `desconhecido` em **100%** deles.
- **SC-005**: Com a marca `desconhecido`, **zero** ordens novas são enviadas para aquele instrumento, e
  **zero** marcas são removidas por `reset`.
- **SC-006**: Falhando uma das seis portas do arranque, **zero** arranques acontecem, e **100%** deles
  ficam com o motivo da porta que falhou.
- **SC-007**: Depois de o CB disparar, **zero** `start` são aceites e **100%** das sessões novas gravam
  a configuração em vigor antes de a mesa voltar a `em_operacao`.
- **SC-008**: Com a mesa `pausada`, **zero** ordens de abertura são enviadas e o CB continua a
  disparar em **100%** dos casos em que o limite é atingido.
- **SC-009**: Em `encerrando` sem resposta, **100%** dos casos voltam a `em_operacao` com o `stop`
  registrado como pendente — zero casos em que a mesa fica parada à espera.
- **SC-010**: Reiniciando o processo, **zero** marcas persistidas se perdem: **100%** das marcas
  presentes antes do reinício são legíveis depois dele, com o motivo e a data.
- **SC-011**: **100%** das transições, recusas e desfechos de um dia de operação são reconstruíveis a
  partir do registo, sem ler código — e cada linha traz o motivo da decisão de **não** fazer.
- **SC-012**: **100%** das decisões deste recorte que dependem de um valor (prazos, limites, listas de
  eventos que avisam) apontam a **chave** que as governa, e **zero** desses valores aparecem escritos
  no código — medido pela conferência do inventário, nas duas direções (valor sem chave, chave sem
  quem a leia).

## Assumptions

- O **contrato do recorte 001** é a fonte das mensagens; este recorte não muda nenhum schema nem
  acrescenta mensagem nova. Se precisar de uma, é defeito do desenho e volta ao recorte 001.
- O **relógio é o do venue** (o tempo da mesa é o do conector, RN-D3) e o **prazo do setup** é
  declarado pelo próprio setup no template dele.
- **Valores concretos** (limites, prazos, listas de eventos que avisam) são do dono: existem como
  **chaves** no inventário, e o que este recorte tem de provar é que as chaves existem e são lidas —
  não quais são os números.
- A **mesa é uma só**, com `n` instrumentos (RN-E3); a máquina aqui descrita é do processo, não de um
  instrumento isolado.
- A **web** manda verbos e desenha estado; o que ela mostra não é medido por este recorte.
- O **ledger** é a memória do que aconteceu (recorte próprio): aqui assume-se que existe e que aceita
  registo de transição, recusa e desfecho sem perda de motivos.
- A **estratégia** não é deste recorte: o setup decide o lado, e a mesa obedece ao mandato — inclusive
  dizendo não.
