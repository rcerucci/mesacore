# Feature Specification: O vigia e a mesa, ponta-a-ponta contra dublês

**Feature Branch**: `003-vigia-e-mesa`

**Created**: 28 set 2026

**Status**: Draft

**Input**: Decisão do dono: *«Garantir o vigia e a mesa sem erro é primordial; um teste ponta a ponta com
plugins reais pode ser exaustivo se falhar... a construção e especificações deles pode ser sob demanda»* e
*«para plugins a tática pode ser a mesma, sem usar a mesa real e sim um dublê de mesa para teste neles»*.

## O que este recorte é, e o que ele não é

**É** o **vigia** a existir como **processo** (hoje existe só como *comando* interno — `core/estados/comando.ts`
com os cinco verbos — e como a máquina que o obedece), a **mesa** a ser governada por ele **ponta-a-ponta**, e
a **fronteira entre os dois a ser contratada** (é a única fronteira do sistema que ainda não tem mensagem no
contrato — `DEFEITOS.md`, D-005). É também o **dublê de mesa**, para que os plugins — setup e conector — se
construam **sem a mesa real** (RN-E24).

**Não é**: nenhum plugin real (setup ou conector), nenhuma corretora, nenhuma bateria de conformidade de
venue (RN-C6), nem a superfície web. O primeiro conector real (cTrader) e o primeiro setup real são recortes
próprios, cada um com o seu aceite.

**Ponto de partida medido:** `provar.sh` **16 de 16**; `chaves.ts` **3 verificações · 0 divergentes · 7
chaves**; o recorte 002 fechou **67 de 67**; o motor antigo (`~/Projects/jev-trade-fusao`) continua intocado
a operar a conta.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O dono pede arranque e a mesa só arranca se puder (Priority: P1)

O dono manda `start`. A mesa passa pelas **seis portas** do arranque (RN-M9) e, se uma delas recusar, a mesa
**não arranca** — e o que volta ao vigia é a **recusa com o motivo dela**, como mensagem do contrato, não um
silêncio, não um processo morto e não uma excepção. Se todas as portas passarem, a mesa fica **em operação** e
o vigia registra a transição.

**Why this priority**: é a razão de o vigia existir. Sem isto, «pôr a mesa a correr» é lançar um processo e
esperar pelo melhor — e uma mesa que sobe com o mandato inválido é uma mesa a operar uma conta com regras que
ninguém validou.

**Independent Test**: arrancar a mesa com uma ficha que falha **uma** porta (por exemplo, uma chave sem valor
no inventário) e ver a recusa com o nome daquela porta; arrancar com tudo válido e ver a mesa em operação.

**Acceptance Scenarios**:

1. **Given** uma configuração válida e um vigia vivo, **When** o dono manda `start`, **Then** a mesa fica `em_operacao` e a transição fica registrada com autor, instante, verbo e estado anterior e posterior.
2. **Given** uma configuração que falha a porta do inventário, **When** o dono manda `start`, **Then** a mesa **não** arranca e o motivo que volta é **o daquela porta**, e não um motivo genérico.
3. **Given** uma mesa já `em_operacao`, **When** o dono manda `start` outra vez, **Then** a resposta é uma recusa com motivo (`mesa_ja_em_operacao`), nunca um segundo arranque nem um silêncio.

---

### User Story 2 - A mesa sobrevive à morte do vigia (Priority: P1)

O vigia morre a meio da sessão. A mesa **em operação continua a operar e a reconciliar** (RN-V6): posição
aberta continua defendida, o CB continua conferido, o ledger continua escrito. Quando o vigia volta, encontra
a mesa **pelo estado que ela própria tem**, não pela memória dele.

**Why this priority**: é o que prova que a fronteira é **real**. Se o vigia fosse um pedaço dentro do processo
da mesa, metade das garantias desta spec seriam falsas — e a primeira vítima seria a defesa da posição.

**Independent Test**: matar o processo do vigia com a mesa a operar, correr ciclos e verificar que o ledger
recebe linhas novas e que a reconciliação continua; subir o vigia outra vez e ver a mesa reconhecida pelo
estado.

**Acceptance Scenarios**:

1. **Given** a mesa em operação com posição aberta, **When** o processo do vigia é morto, **Then** a mesa continua a reconciliar e a escrever no ledger, e o CB continua a poder fechar.
2. **Given** o vigia morto e a mesa a operar, **When** o vigia volta, **Then** ele lê o estado da mesa e não tenta arrancar nada por conta própria.
3. **Given** a mesa em operação, **When** o vigia tenta mandar comandos por um **segundo** canal, **Then** o segundo canal é recusado — uma costura tem **um** escritor.

---

### User Story 3 - O encerramento é gracioso e não deixa posição sem governo (Priority: P1)

O dono manda `stop` com posição aberta. A mesa **não sai**: para de abrir, apresenta o **resumo com os números
da corretora** (posição, nocional, margem, distância de liquidação, resultado não realizado) e **pergunta** se
se fecha a preço de mercado. Sem decisão, a mesa **volta a operar, abrir incluído**, e o pedido de `stop` fica
**arquivado como pendente** (RN-V9.1).

**Why this priority**: é o único caminho legítimo para terminar com posição viva. Um `stop` que mata o processo
deixa a posição sem governo — e a spec do recorte 002 já decidiu que o pior estado é a posição sem defesa.

**Independent Test**: com posição aberta, mandar `stop`, não responder, e verificar que a mesa volta ao normal
com o pedido pendente; repetir respondendo «fechar» e ver a posição fechada a mercado com o desfecho no ledger;
repetir respondendo «manter» e ver o resumo dizer que a única protecção que resta é a ordem de stop que estiver
na corretora.

**Acceptance Scenarios**:

1. **Given** posição aberta e `stop` pedido, **When** ninguém responde dentro do prazo do dono, **Then** a mesa volta a `em_operacao` (a abrir incluído) e o pedido de `stop` fica pendente nas marcas.
2. **Given** posição aberta e `stop` pedido, **When** a resposta é «fechar a mercado», **Then** a posição é fechada, o desfecho é registrado e a mesa termina o encerramento.
3. **Given** posição aberta e `stop` pedido, **When** a resposta é «manter», **Then** o resumo diz que a única defesa que resta é a ordem de stop que estiver na corretora e que, sem ela, a posição fica a descoberto.
4. **Given** a mesa `encerrando`, **When** o dono manda `reset`, **Then** a mesa volta ao normal **sem** fechar posição, **sem** apagar ledger e **sem** limpar o desconhecido.

---

### User Story 4 - `pause` não é `stop`, e `reset` não altera nada (Priority: P2)

O dono manda `pause`: a mesa **para de abrir** e **continua a defender** (reconciliação e circuit breaker
continuam — RN-V2.1). Manda `reset`: a mesa reinicia **sem mexer em nada** — mesmo estado, mesmas fichas, mesmo
ledger, e a inibição do CB **não** se limpa. Manda `nova_sessao`: é o **único** caminho fora da inibição, e
exige **autor e motivo**, que ficam registrados.

**Why this priority**: são os três verbos em que uma confusão custa dinheiro. `pause` tomado por `stop` deixa a
posição sem ninguém; `reset` tomado por `nova_sessao` apaga a memória de um limite batido.

**Independent Test**: com a mesa pausada e posição aberta, provocar a condição do CB e ver o CB fechar; com a
mesa inibida, mandar `reset` e ver a inibição intacta; mandar `nova_sessao` sem motivo e ver a recusa; com
motivo, ver a sessão nova gravada com instante, equity de partida e autor.

**Acceptance Scenarios**:

1. **Given** a mesa `pausada` com posição aberta, **When** o preço caminha para o limite, **Then** o CB fecha — `pause` suspende abertura, nunca defesa.
2. **Given** a mesa inibida pelo CB, **When** o dono manda `reset`, **Then** a inibição continua e a mesa di-lo, sem limpar marcas.
3. **Given** a mesa inibida pelo CB, **When** o dono manda `nova_sessao` **sem** motivo, **Then** a recusa nomeia o motivo em falta.
4. **Given** a mesa inibida pelo CB, **When** o dono manda `nova_sessao` com autor e motivo, **Then** a inibição sai e a sessão nova fica gravada.

---

### User Story 5 - A fronteira entre o vigia e a mesa é contrato (Priority: P2)

O comando do vigia atravessa como **mensagem do contrato**: envelope de sempre, tipo próprio, verbo, autor,
motivo e versão. Os **motivos de recusa da mesa** — hoje internos (`core/estados/motivos.json`) — passam a
estar no **vocabulário do contrato**, porque passaram a cruzar a fronteira. E a **versão do contrato sobe**:
acrescentar mensagem é mudar contrato, e mudar contrato é acto declarado.

**Why this priority**: é a dívida que a spec nomeia antes de a pagar. Sem isto, o vigia e a mesa falam por um
acordo tácito — e um acordo tácito entre dois processos é um defeito que só aparece quando um dos dois é
actualizado sozinho.

**Independent Test**: enviar um comando com a versão do contrato igual e ver a transição; enviar com versão
diferente e ver a recusa por igualdade exacta (D7); conferir que o vocabulário do contrato contém os motivos da
mesa e que nenhum motivo em uso ficou de fora (conferência nas duas direcções).

**Acceptance Scenarios**:

1. **Given** o contrato na versão nova, **When** o vigia manda um comando, **Then** a mensagem passa o esquema (envelope, tipo, verbo, autor, motivo) e a mesa responde no mesmo contrato.
2. **Given** um comando com versão diferente da da mesa, **When** chega, **Then** é recusado por igualdade exacta de versão — nunca adaptado.
3. **Given** o vocabulário do contrato, **When** se procura um motivo que a mesa possa devolver, **Then** ele está lá — e nenhum motivo do vocabulário ficou sem quem o produza (conferência nas duas direcções).
4. **Given** a mensagem do comando, **When** se procura um campo que ninguém lê, **Then** não há nenhum: campo sem leitor é defeito, não reserva.

---

### User Story 6 - O dublê de mesa, para os plugins se construírem sem a mesa real (Priority: P2)

Existe um **dublê de mesa** (`contracts/mocks/mesa/`) que fala a costura: entrega o **snapshot de mercado** a
um setup e confere a **proposta**; entrega a **boleta** a um conector e confere o **desfecho**. O dublê é
escrito **do contrato**, numa linguagem **que não a do core**, e é **adversário** — recusa, atrasa, cala-se,
devolve números fora da banda. Assim, quem construir o primeiro setup ou o primeiro conector **não precisa da
mesa real** (RN-E24), e o que ele prova é compatibilidade com o **contrato**, não com a nossa implementação.

**Why this priority**: é a simetria que o dono decidiu. Sem o dublê, construir um plugin obriga a pôr meia
operação de pé — que é exactamente o que se quer evitar.

**Independent Test**: correr o dublê de mesa contra o mock de setup e contra o mock de conector que já existem,
com os casos declarados, e ver aceites e recusas nas duas direcções; correr o **mesmo** conjunto de casos contra
a mesa real e ver o mesmo veredicto.

**Acceptance Scenarios**:

1. **Given** o dublê de mesa, **When** corre os casos do contrato contra o mock de conector, **Then** os veredictos são os declarados (aceite, parcial, desconhecido, recusado) — incluindo as recusas.
2. **Given** o mesmo conjunto de casos, **When** corre contra a **mesa real**, **Then** o veredicto é o mesmo do dublê: uma divergência entre os dois é defeito de um deles, e é declarada.
3. **Given** um caso com o venue mudo (dentro do prazo), **When** o dublê corre, **Then** o veredicto é **espera**, e passado o prazo é `desconhecido` — nunca sucesso.

---

### User Story 7 - O que já corria não se perde (Priority: P3)

O recorte novo não muda o comportamento já provado. A bateria do recorte 002 continua verde, a do recorte 001
continua verde, e a mesa governada pelo vigia comporta-se como a mesa governada pelo comando interno — porque é
a mesma mesa, com a mesma máquina.

**Why this priority**: é o que impede que «pôr o vigia no ar» reabra o que já estava fechado. Vale P3 porque não
acrescenta comportamento: só o guarda.

**Independent Test**: correr a porta única antes e depois e comparar; correr a bateria do contrato do recorte
001 e ver a mesma contagem.

**Acceptance Scenarios**:

1. **Given** a porta única, **When** corre depois deste recorte, **Then** todas as verificações do 002 continuam a passar.
2. **Given** a bateria do contrato, **When** corre depois deste recorte, **Then** a contagem de aceites e recusas mantém-se, e as mensagens novas entram com os seus próprios casos.
3. **Given** uma mudança de contrato (versão nova), **When** a bateria corre, **Then** a frescura do gerado é conferida e um gerado atrasado é recusado.

---

### Edge Cases

- **Vigia e mesa com versões diferentes do contrato:** recusa por igualdade exacta, nunca adaptação (D7); a
  recusa nomeia as duas versões.
- **O vigia morre a meio de um encerramento:** a mesa fica no estado em que estava, com o pedido registrado
  nas marcas; quando o vigia volta, o pedido é reencontrado no estado da mesa, não na memória dele.
- **Dois vigias vivos:** o segundo canal é recusado — uma costura tem um escritor (mesmo princípio do RN-E7).
- **`stop` numa mesa já parada:** recusa com motivo, e o motivo é da mesa (não do vigia).
- **`nova_sessao` numa mesa com mais de uma conta:** o verbo é **por conta** (RN-E22). Neste recorte a mesa
  serve uma conta, e a mensagem **não** ganha o campo da conta ainda — um campo sem leitor é exactamente o
  defeito dos falsos botões. Fica registado como o que a mensagem ganha no dia em que a segunda conta existir.
- **O vigia tenta validar o mandato:** não valida (RN-V5). Se o arranque for recusado, a recusa **é** o
  resultado, e o vigia não a substitui nem a reinterpreta.
- **O ledger cheio ou indisponível no arranque:** a mesa recusa arrancar (a porta do ledger), e a recusa sobe
  ao vigia pelo mesmo caminho.

## Requirements *(mandatory)*

### Functional Requirements

**O vigia como processo**

- **FR-001**: O vigia DEVE existir como **processo separado** da mesa, e a mesa DEVE poder operar **sem ele vivo**.
- **FR-002**: O vigia DEVE obedecer a **cinco** verbos determinísticos: `start`, `stop`, `pause`, `reset`, `nova_sessao` — e a nenhum outro.
- **FR-003**: Cada transição DEVE ser registrada com **autor, instante, verbo** e **estado anterior e posterior**, de modo que o vigia seja auditável por leitura do seu registro.
- **FR-004**: O vigia **NÃO** DEVE validar mandato nem substituir o porteiro: se o arranque for recusado, a **recusa é o resultado** (RN-V5).
- **FR-005**: O vigia **NÃO** DEVE arrancar os conectores nem os setups (RN-E21): quem os monta é a camada de operação, e a mesa recusa arrancar se um conector que a sua configuração nomeia não estiver de pé — dizendo qual.
- **FR-006**: Uma mesa em operação **NUNCA** DEVE depender de o vigia estar vivo (RN-V6).
- **FR-007**: O `start` numa mesa já em operação, e o `stop` numa mesa já parada, DEVEM ser recusados com o motivo da mesa, nunca em silêncio.
- **FR-008**: A costura vigia↔mesa DEVE ter **um só escritor**: um segundo canal é recusado.

**Os verbos, um a um**

- **FR-009**: `start` DEVE submeter a mesa às **seis portas** do arranque e recusar com o motivo da **primeira** que falhar.
- **FR-010**: `pause` DEVE suspender **abertura** e **NÃO** DEVE suspender reconciliação nem a verificação do circuit breaker (RN-V2.1).
- **FR-011**: `reset` DEVE reiniciar a mesa **sem alterar nada**: nem ledger, nem fichas, nem marcas; e **NUNCA** DEVE limpar a inibição do CB nem a marca de desfecho `desconhecido` (RN-V3).
- **FR-012**: `nova_sessao` DEVE ser o **único** caminho fora da inibição do CB, e DEVE exigir **autor** e **motivo**, gravando instante e equity de partida (RN-V10).
- **FR-013**: `stop` com posição aberta **NÃO** DEVE terminar o processo: DEVE entrar no **encerramento gracioso** (FR-014 a FR-018).
- **FR-014**: O encerramento DEVE apresentar um **resumo com números da corretora** (posição, nocional, margem, distância de liquidação, resultado não realizado) — nunca estimativas (RN-V8).
- **FR-015**: O encerramento DEVE **perguntar** se se fecha a preço de mercado, com a pergunta e o resumo juntos.
- **FR-016**: Sem resposta dentro do prazo do dono, a mesa DEVE **voltar a `em_operacao`, abrir incluído**, com o pedido de `stop` **arquivado nas marcas como pendente** (RN-V9.1).
- **FR-017**: Com resposta «fechar», a mesa DEVE fechar a mercado e registrar o desfecho; com resposta «manter», DEVE dizer que a única defesa que resta é a ordem de stop que estiver na corretora (RN-V8).
- **FR-018**: O encerramento NUNCA DEVE fechar por prazo nem sair em silêncio: a decisão é registrada com autor e instante (RN-V9).

**Alcance dos verbos**

- **FR-019**: `start`, `stop`, `pause`, `reset` DEVEM ter por alcance a **mesa**; `nova_sessao` DEVE ter por alcance a **conta** (RN-E22).
- **FR-020**: A mensagem do comando **NÃO** DEVE ganhar, neste recorte, nenhum campo que ninguém leia: o campo da conta entra no dia em que a mesa servir mais do que uma conta, e esse dia fica declarado.

**A fronteira é contrato**

- **FR-021**: O comando DEVE atravessar como **mensagem do contrato**, com o envelope de sempre (versão, tipo, correlação, carga).
- **FR-022**: Os **motivos de recusa da mesa** DEVEM entrar no **vocabulário do contrato**, porque passaram a cruzar a fronteira.
- **FR-023**: A **versão do contrato DEVE subir**, e a mudança DEVE ser declarada (esquema novo, casos novos, gerados novos nas duas linguagens).
- **FR-024**: A versão DEVE ser comparada por **igualdade exacta**: mensagem de versão diferente é recusada, nunca adaptada (D7).
- **FR-025**: A conferência do vocabulário DEVE correr nas **duas direcções**: motivo produzido pela mesa e ausente do vocabulário é falha; motivo do vocabulário sem quem o produza também.
- **FR-026**: O gerado DEVE continuar versionado e a sua **frescura** conferida: gerado atrasado em relação ao esquema é recusado.

**O dublê de mesa**

- **FR-027**: DEVE existir um **dublê de mesa** que fala a costura nas duas direcções: entrega snapshot e confere proposta; entrega boleta e confere desfecho.
- **FR-028**: O dublê DEVE ser escrito **do contrato** e em linguagem **que não a do core**, para provar a fronteira e não a nossa implementação (RN-E17, RN-E24).
- **FR-029**: O dublê DEVE ser **adversário**: recusar, atrasar, calar-se e devolver números fora da banda, com os casos em **dado** (`*.casos.json`), nunca em ramos de código.
- **FR-030**: Os casos do dublê e da mesa real DEVEM ser os **mesmos**, e uma divergência entre os dois DEVE ser declarada como defeito de um deles.
- **FR-031**: Os dublês que já existem (setup e conector) DEVEM ser **estendidos**, não substituídos: o que provaram no recorte 001 continua provado.

**Regressão e rastreabilidade**

- **FR-032**: A porta única DEVE continuar a passar todas as verificações do recorte 002 depois deste recorte.
- **FR-033**: A bateria do contrato DEVE continuar a correr e a contabilizar aceites e recusas, com os casos novos somados.
- **FR-034**: Cada requisito desta spec DEVE ter, no fim, o comando que o mede e a saída que o prova, registados em `relatorios/`.
- **FR-035**: Nenhum ficheiro de `~/Projects/jev-trade-fusao` DEVE ser tocado: o motor antigo continua a ser oráculo de aceite e a operar a conta.

### Key Entities

- **Vigia**: processo separado; cinco verbos; registro de transições (autor, instante, verbo, estado anterior e posterior); não valida nada da operação.
- **Comando**: mensagem do contrato; envelope (versão, tipo, correlação); carga com verbo, autor e — no `nova_sessao` — motivo.
- **Sessão do vigia**: o par mesa + conta a que o verbo se aplica, com o alcance da FR-019.
- **Resumo de encerramento**: números da corretora; pergunta; decisão com autor e instante; o que fica em aberto.
- **Dublê de mesa**: programa que fala a costura; casos em dado; adversário; escrito do contrato noutra linguagem.
- **Registro do vigia**: as transições, para auditoria por leitura.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Com o vigia morto a meio da sessão, a mesa continua a **reconciliar e a escrever no ledger** em todos os ciclos seguintes — medido por linhas novas no ledger depois da morte do vigia (o valor tem de ser **igual** ao número de ciclos corridos, não «algumas»).
- **SC-002**: **Zero** encerramentos terminam com posição aberta sem decisão registrada, e **zero** decisões de não-fazer ficam sem motivo (contiguidade da cadeia de transições).
- **SC-003**: **Zero** campos na mensagem do comando sem quem os leia, e **zero** motivos em uso fora do vocabulário do contrato (conferência nas duas direcções).
- **SC-004**: O dublê de mesa e a mesa real dão o **mesmo veredicto** em **todos** os casos declarados; uma divergência aparece como falha, nunca como aviso.
- **SC-005**: A porta única do recorte 002 continua com **todas** as verificações a passar, e a bateria do contrato mantém a contagem de aceites e recusas (as mensagens novas somam-se, não substituem).
- **SC-006**: Um `start` com uma porta falhada devolve **o motivo daquela porta** em 100% dos casos, e nunca um motivo genérico nem um silêncio.
- **SC-007**: Um comando de versão diferente é recusado em 100% dos casos, sem adaptação.
- **SC-008**: O dublê de mesa devolve «espera» enquanto o venue está mudo dentro do prazo e `desconhecido` depois dele, em 100% dos casos declarados — nunca sucesso.

## Assumptions

- **Os plugins são sob demanda** (decisão do dono): esta fase corre contra dublês, e a **bateria de
  conformidade por venue** (RN-C6) é o aceite de cada plugin, no recorte dele.
- **A simetria dos dublês vale nos dois sentidos** (RN-E24): a mesa e o vigia provam-se contra dublês de setup
  e de conector; cada plugin prova-se contra o dublê de mesa.
- **A mesa serve uma conta** neste recorte; a dimensão por conta (RN-E22) entra com a segunda conta, e o campo
  correspondente na mensagem entra **com ela**, não antes (FR-020).
- **A superfície web** (registo de mesas, RN-E8/RN-E23) fica fora: este recorte põe o vigia a governar **um**
  processo, com a costura contratada, e é isso que a web vai depois consumir.
- **O motor antigo é oráculo**, não base: nada em `~/Projects/jev-trade-fusao` é tocado (FR-035).
- **Nenhum número ajustável nasce no código** (RN-A1): o que este recorte precisa — o prazo de resposta do
  encerramento, por exemplo — entra como chave declarada no inventário, e continua a ser valor do dono.
- **O ledger e a sua retenção** (RN-L6) ficam como estão: este recorte escreve nele, não o redesenha.
