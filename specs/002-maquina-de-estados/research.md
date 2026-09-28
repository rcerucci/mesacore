# Research — o que foi decidido, e com o que se decidiu

**Fase 0** do plano de `specs/002-maquina-de-estados`. Cada decisão tem a razão, as alternativas
rejeitadas e — quando existe — **o facto medido** que a sustenta. Decisão sem medição fica escrita como
escolha de desenho, não como conclusão.

---

## R1. As transições são **dado** (`core/estados/transicoes.json`)

**Decisão**: a tabela de transições é um ficheiro legível, com uma linha por (estado, verbo) e, quando
o verbo não é legal, o **motivo da recusa**. O código limita-se a procurar, aplicar e registar.

**Razão**: `docs/maquina-de-estados.md` enuncia a regra de leitura — *"um estado sem saída declarada é
lacuna; um evento que não muda nada é ruído; um evento sem estado onde caiba é lacuna"*. Essa frase é
verificável **por programa** se as transições forem dado, e só por leitura humana se estiverem em
código. A história deste projeto diz qual das duas falha: foi a leitura humana que deixou passar o
`ABERTA` sem chave e a marca de posse fora da lista da boleta.

**Alternativas**:

- **`switch`/`if` em código** — a tabela deixa de ser conferível; o motivo de recusa esconde-se no meio
  da lógica, e uma transição em falta não se distingue de uma esquecida no `default`.
- **Biblioteca de máquinas de estados (XState e afins)** — resolve estados aninhados, atores e efeitos;
  aqui o problema é uma tabela de ~30 linhas, e o produto principal são **as recusas**, que uma
  biblioteca trata como erro de programação e não como resultado legítimo. Trazer uma dependência
  grande para esconder o que interessa é a troca errada.
- **Gerar a tabela a partir do diagrama** — o diagrama é a vista; a fonte não pode ser um formato que
  ninguém escreve à mão nem revê num *diff*.

**Não medido**: não se comparou o custo de arranque de nenhuma biblioteca (não chegou a ser candidata).
A rejeição é de **encaixe**, e está escrita como tal.

---

## R2. As marcas vivem num ficheiro do runtime, **nunca** no ledger

**Decisão**: `core/estado/.marcas.json` (estado, não versionado), escrito de forma atómica:
ficheiro temporário + `rename`. Guarda `sessao`, `inibicao_cb` e os `desconhecido`.

**Razão**: as marcas têm de ser lidas **antes** de tudo no arranque e rescritas a cada ciclo; o ledger é
o registo do que aconteceu, com política de retenção (RN-L6) e sem escrita destrutiva. Juntar os dois
parte duas coisas ao mesmo tempo: a **retenção apagaria a inibição do CB** — e a mesa voltaria a operar
por expiração de prazo, que é o pior desfecho possível — e o ledger passaria a ser mutável, deixando de
poder afirmar o que aconteceu.

**Alternativas**: (a) guardar as marcas no ledger — a retenção apaga o que não pode ser apagado;
(b) só em memória — morre com o processo, que é exactamente o defeito que as marcas existem para
evitar, e o SC-010 (reiniciar e reencontrar) deixaria de ter como passar; (c) base de dados — não há
nenhuma no host (medido em 18/09/2026: sem `docker`, `podman` ou `nerdctl`) e uma marca são três
linhas de JSON.

**Limite explícito, e é o mais importante desta decisão**: o ficheiro de marcas **nunca** ganha um mapa
instrumento → posição. A posse de uma posição lê-se da **corretora**, pela marca que a ordem levou
(RN-T16.1, já medido no recorte 001 com `reinicio.sh`). O porteiro do estado reprova se esse campo
aparecer: a diferença entre *lembrar-se do que aconteceu* e *achar que sabe o que tem* é o que separa
uma mesa que se reinstala de uma que se engana.

---

## R3. O estado da mesa **não** persiste; as marcas persistem

**Decisão**: ao arrancar, a mesa está sempre `parada`. O que sobrevive ao processo são as três marcas.

**Razão**: é a distinção que o documento de estados já faz ("é a única razão de as marcas serem marcas
e não estados: um estado morreria com o processo"). Persistir `em_operacao` obrigaria a decidir o que
fazer com uma posição que ficou a meio de um ciclo — e a resposta honesta é: a mesa volta, reconcilia e
só então opera. Persistir o estado seria guardar uma intenção envelhecida; a marca de inibição é o que
impede que a mesa volte a operar sozinha depois de um evento grave.

**Consequência testável**: o SC-010 mede exactamente isto — reiniciar não perde marcas, e não
ressuscita estados.

---

## R4. As leituras vêm de **fixtures** neste recorte

**Decisão**: `core/leitura/fixtures.ts` é a porta de leitura; nos testes lê ficheiros com mensagens do
contrato (as do recorte 001). No recorte da conformidade, a mesma porta passa a falar com o processo do
conector (o seam já está provado: uma mensagem por linha em texto).

**Razão**: ligar o ciclo a uma corretora a sério obrigaria a chave, conta e rede — e o recorte deixaria
de ser medível neste host, contra o SC-009 do recorte 001, que continua a valer. Com fixtures, os 41
cenários da spec são executáveis hoje.

**O que isto não é**: um mock do conector dentro do core. O que entra pela porta são **mensagens do
contrato**, validadas antes de a máquina decidir — uma fixture inválida faz o teste falhar **antes** de
a decisão existir, em vez de produzir uma decisão sobre dado inválido.

---

## R5. A máquina **decide**; quem executa é o processo que a liga

**Decisão**: o ciclo devolve, por instrumento, uma decisão — `abrir` (com a boleta), `fechar`,
`adoptar`, `nada` — cada uma com o motivo. Nenhuma decisão sai do core como mensagem para a corretora.

**Razão**: dois problemas resolvidos de uma vez. Primeiro, o SC-002 passa a ser medido por **contagem
de decisões de abrir**, e não por inspecção de código. Segundo, a fronteira que a constituição pede
("I/O nas pontas, interpretação no core") fica onde deve: o core não tem socket, não tem chave, e o
teste não precisa de nada disso.

**Alternativa rejeitada**: o core enviar directamente (chamando o conector em processo). Torna cada
teste de decisão dependente de um conector, e mistura a peça que decide com a que transporta — que é
exactamente o que a separação core/ponta existe para evitar.

---

## R6. A prova negativa de cada instrumento é guardada no repositório

**Decisão**: cada conferidor deste recorte (a tabela, o porteiro, o inventário) traz um script que
**altera o dado, corre, exige o vermelho e repõe** — no mesmo padrão do
`tools/verificar-contrato/py/prova-negativa-inventario.py` do recorte 001.

**Razão**: três dos quatro defeitos da passagem anterior do recorte 001 foram instrumentos que não
conseguiam medir e não o diziam (frescura com verde falso, prova que arrastava estado, conferidor que
procurava um nome inexistente). Um instrumento sem prova negativa é uma promessa com sintaxe.

**Consequência para a implementação**: a ordem das tarefas inverte-se em relação ao hábito — o
**caso** que recusa vem antes da tabela que ele recusa, e a prova negativa vem antes do verde.

---

## R7. Os motivos de recusa da **mesa** são um conjunto próprio do core (achado da implementação)

**O que se mediu**: `contracts/vocabulario.json` tem **16 motivos**, e todos falam de validade de
mensagem (`enquadramento_invalido`, `campo_obrigatorio_ausente`, `valor_fora_da_banda`,
`versao_do_contrato_divergente`…). **Nenhum** serve para a máquina de estados: "verbo ilegal no estado
em que a mesa está", "sessão inibida", "posição viva impede sessão nova" não são defeitos de uma
mensagem do contrato — são recusas de um **comando**.

**Decisão**: os motivos de recusa da mesa vivem em `core/estados/motivos.json` — conjunto fechado,
lido pelo intérprete, nunca escrito em código (FR-044, RN-A1). O conferidor de invariantes valida as
recusas contra **esse** ficheiro, não contra o vocabulário do contrato.

**Porquê não no contrato**: o contrato é a língua que **cruza a fronteira** entre processos e
linguagens. Um comando `start` e a sua recusa são uma interface **interna** (a mesma peça que decide é
a que responde). Pôr estes motivos no contrato alargaria o vocabulário normativo durante um recorte que
prometeu não o tocar — e o contrato é do recorte 001, com provas a correr em duas linguagens.

**Quando isto muda**: no dia em que o **vigia** for processo separado (RN-E8), a recusa passa a cruzar a
fronteira e estes motivos têm de entrar no contrato. Fica escrito aqui para não ser surpresa: nesse dia
é uma mensagem nova, e uma mensagem nova **volta ao recorte 001** — como a própria spec manda.

---

## R8. Os tipos de linha do registo da mesa são um conjunto próprio (achado da implementação)

**O que se mediu**: o contrato (recorte 001) declara
`tipos_de_linha_do_registo = [snapshot, proposta, boleta, desfecho]` — quatro tipos que são **quatro
mensagens do contrato**. Uma transição de estado, uma recusa de comando ou uma marca não são mensagens
do contrato: não cruzam fronteira nenhuma e nenhuma ponta as troca.

**Decisão**: o registo da mesa usa um conjunto fechado próprio
(`transicao`, `recusa`, `ciclo`, `marca`), declarado em `core/estado/registo.ts` e conferido na
escrita: um tipo fora do conjunto **grita** em vez de ser gravado. O registo **exige** motivo em toda a
linha de recusa — é o que o SC-011 conta.

**A questão que fica aberta, e fica escrita**: quando o **ledger** tiver o seu recorte, as duas listas
têm de ser reconciliadas — **uma delas ganha**. Duas listas de tipos de linha para o mesmo registo
seriam duas verdades sobre a mesma linha, e a segunda só serviria para divergir. Não se resolve agora
porque o ledger ainda não tem spec, e decidir por antecipação seria inventar.

---

## Resumo das decisões

| # | Decisão | O que a fecha |
|---|---|---|
| R1 | Transições em dado | `core/estados/transicoes.json` + conferidor de invariantes |
| R2 | Marcas em ficheiro próprio, atómico | `core/estado/.marcas.json` (sem posições) |
| R3 | Estado não persiste; marcas persistem | SC-010 |
| R4 | Leituras por fixtures neste recorte | `core/leitura/fixtures.ts` |
| R5 | A máquina decide, não envia | `Decisao` como dado observável |
| R6 | Prova negativa guardada por instrumento | `tools/verificar-maquina/` |
| R7 | Motivos da mesa em conjunto próprio do core | `core/estados/motivos.json` (achado da implementação) |
| R8 | Tipos de linha do registo da mesa em conjunto próprio | `core/estado/registo.ts` (achado da implementação; reconciliar com o ledger) |
