# Defeitos declarados do recorte 002

Um defeito declarado é uma coisa que se sabe que falta, com o número que prova que falta. Não é uma
lista de desejos nem um "TODO": é o registo de uma promessa que ainda não tem quem a cumpra — para que
a próxima sessão não tenha de descobri-la por acidente, e para que ninguém a possa ler como já feita.

Nasceu aqui a **D-001**: a revisão de 28 set 2026 tirou o cálculo do risco da mesa (passou a ser da
corretora) e, ao fazê-lo, abriu o passo que faltava — a conferência da resposta da corretora contra a
banda do mandato. Sem esse passo, passar o cálculo para o plugin passa também o **limite**: o plugin
decide o tamanho e ninguém verifica. O dono não pediu esse passo; ele é a consequência do pedido dele,
e é por isso que fica escrito.

---

## D-001 — A banda do mandato não é conferida em lado nenhum — **FECHADO** (29/09/2026: a conferência existe e está medida)

> **Estado confirmado NO CÓDIGO a 03/10/2026** (o título parecia aberto e não estava — foi assim que uma
> auditoria inteira o tratou como vivo). Os comandos, agora:
> `bun run core/ciclo/provar.ts` → **118 verificações · 0 divergentes · 15 de banda** (as três comparações que o
> contrato permite emparelhar, com o par de controle `dentro → seguir` / `fora → reduzir_e_registar`); a
> conferência é pura e vive em `core/ciclo/banda.ts`, ligada nos dois sítios onde a resolução e a acção
> vivem (`core/ciclo/desfecho.ts`, `core/ciclo/ciclo.ts`); a aritmética é exacta (inteiros escalados) e os
> 15 casos estão declarados em `core/ciclo/banda.casos.json`.


> **FECHADO — 29/09/2026.** A conferência existe, é pura e está medida. O que a fecha:
> `core/ciclo/banda.ts` (a conferência) + a ligação nos dois sítios onde a resolução e a acção vivem
> (`core/ciclo/desfecho.ts`, `core/ciclo/ciclo.ts`), com **15 casos** em `core/ciclo/banda.casos.json` e o
> **par de controle** que o defeito exigia: `fora → reduzir_e_registar` (**0 de 6** seguiram sem reduzir) e
> `dentro → seguir` (**0 de 8** reduziram). O lado que o defeito não nomeava também ficou medido: o que
> **não se consegue conferir** (banda não declarada, valor ilegível, equity ou marca ausentes) não vira
> «cabe» — é `nao_conferivel` e **para e explica** (**0 de 1** seguiu).
>
> Comando: `bun run core/ciclo/provar.ts` → **90 verificações · 0 divergentes** (12 de condição · 27 de
> ciclo · 10 de desfecho · **15 de banda** · 6 de reconciliação), dentro de `bash
> tools/verificar-maquina/provar.sh` → **27 de 27**. As três comparações são só as que o contrato permite
> emparelhar — `alavancagem_efectiva` × `bandas.alavancagem`, o nocional sobre o equity × `bandas.saldo_pct`
> (convertida a nocional absoluto, sem divisão que não feche) e a distância à liquidação ×
> `distancia_minima_liquidacao_pct` — e toda a aritmética é exacta (inteiros escalados).
>
> **Prova negativa sobre o artefacto** (numa cópia do repositório, com a reposição conferida por `sha256`
> nos 7 ficheiros da vaga): uma conferência que **aceita sempre** reprova **8** verificações; uma que
> **reduz sempre** reprova **11** (é o controle, e é ele que mostra que «reduziu» não pode ser o código a
> reduzir tudo); tirar a **trava da abertura** do ciclo reprova **1** (o caso nomeado); e fazer o
> desconhecido virar `dentro` reprova **3**.
>
> O que **continua** verdade do texto abaixo (e por isso ele fica escrito): a conferência **não recusa** o
> que já está executado (reduz e registra), e o **segundo** momento — a conferência *antes* de enviar, onde
> o venue deixa perguntar — não se aplica a ordem a mercado, pela razão que o defeito já tinha corrigido.
> **O que ainda não está ligado:** o `desfecho` e o ciclo da mesa não são chamados pelo servidor
> (`core/servidor.ts` corre comandos e as sete portas, não voltas de ciclo) — a conferência entra onde a
> resolução entra, e quem liga o ciclo ao processo é o passo seguinte, não este defeito.

**O que devia acontecer — e são DOIS momentos, que não se podem confundir:**

1. **Antes de enviar**, e só quando o venue deixa perguntar: quando há cotação/estimativa (ou um modo de
   ordem que a devolva antes de executar), a mesa confere a estimativa contra a banda e **não envia** se
   não couber. Aqui a conferência é mesmo antes, e a recusa é dela.
2. **Depois de o venue responder**, que é o caso geral de uma ordem **a mercado**: o venue calcula
   quantidade e margem **ao executar** — antes de executar não há número nenhum para conferir, porque quem
   calcula é ele. A conferência é então sobre a **resolução**: quantidade na unidade da corretora, margem
   exigida, alavancagem efectiva, preço de liquidação. E, se os números caírem **fora** da banda, a
   resposta da mesa não é "recusar" (já está executado): é **reduzir** — fechar/reduzir é sempre permitido,
   mesmo sem leitura e mesmo sem ligação — e **registrar a divergência**, sem abrir risco novo naquele
   instrumento até ela estar explicada.

A primeira versão deste defeito dizia só "antes de mandar executar". Estava errada para ordem a mercado, e
é a vossa pergunta que a corrige: `antes` só existe onde o venue deixa perguntar.

**O que a resolução tem de trazer para isto ser possível.** Números, não veredicto. Se o plugin devolver
apenas «executou» ou «falhou + motivo», **não há nada para a mesa conferir** — e então quem passa a
garantir a banda é o plugin, o que é uma decisão diferente e mais fraca: as duas pontas existem para
traduzir e transportar, não para interpretar. A obrigação 3 (§8.1 do inventário) nomeia os quatro números
por essa razão exacta.

**O que há.** O contrato tem a mensagem (`contracts/resolucao.schema.json`, com 9 casos em
`contracts/casos/resolucao.casos.json`) e a bateria do recorte 001 valida-lhe a forma nas duas
linguagens. **Nenhuma linha de código do core lê a resolução:** medido em 28 set 2026 —

```
$ grep -rn 'resolucao' core --include=*.ts | wc -l
1
```

E essa única ocorrência é **texto de uma mensagem** (`core/ciclo/arranque.ts:128`, sobre unidades de
instrumento), não código que leia coisa nenhuma. Confirmado por leitura da linha.

**A consequência.** O `saldo_pct`/nocional sai da mesa e o tamanho passa a ser calculado do outro lado.
Quem calcula é quem decide, e não há quem confira: uma corretora que arredonde para cima, que aplique
outra alavancagem, ou que liquide mais perto do que o mandato permite, transforma a banda declarada numa
intenção — e a mesa continuaria a achar que mandou dentro do mandato. É exactamente o modo de falha que
esta arquitectura existe para não ter: o número que decide não está onde o dono o escreveu.

**Onde se conserta.** No recorte do **conector** (a volta: envio → desfecho → resolução → conferência).
Não é trabalho do 002: o 002 pára na boleta (R5 — a máquina decide, não envia).

**Como se saberá que está fechado.** Com o par de controle, na bateria do conector: (a) resolução com
nocional **acima** da banda → a mesa reduz e registra a divergência, com o motivo dela; (b) o mesmo com a
resolução **dentro** da banda → segue, e **não** reduz. Sem a metade (b), "reduziu" podia ser o código a
reduzir tudo; sem a metade (a), a conferência podia estar a aceitar tudo.

## D-002 — As três obrigações do conector não têm casa no manifesto — **FECHADO** (29/09/2026: as três são campos OBRIGATÓRIOS)

> **Estado confirmado NO CÓDIGO a 03/10/2026.** `ligacao_por_protocolo`, `releitura_de_preco_ao_enviar` e
> `devolve_a_resolucao` estão as três no `required` do `contracts/manifesto.schema.json` (o esquema é fechado:
> ausente é o CONTRATO que recusa) e a porta `manifesto` do arranque da mesa verifica cada uma e **nomeia-a**
> quando vale `false` (`core/ciclo/arranque.ts`, as três em sequência: `ligacao_por_protocolo`,
> `releitura_de_preco_ao_enviar`, `devolve_a_resolucao`). A sonda não inventa declaração: sem conseguir medir,
> o manifesto não sai.
>
> Comando: `bun tools/verificar-conector/porta-do-contrato.ts` → **0 falhas · 23 motivos fechados nas duas
> direções**; `bun run brokers/hyperliquid/processo.ts --bancada` → **41 casos · 0 divergentes · 8 portas do
> arranque**.


> **FECHADO — 29/09/2026** (contrato **1.6.0 → 1.7.0**, emenda `emenda-1.7.0.txt`). As três são agora
> **três campos OBRIGATÓRIOS do manifesto**, e cada uma **medida** — não prometida: `ligacao_por_protocolo`
> (o venue respondeu o **próprio** estado, `exchangeStatus`), `releitura_de_preco_ao_enviar` (a marca do
> activo está publicada, `activeAssetData.markPx` — é ela a régua relida ao enviar) e `devolve_a_resolucao`
> (o venue publica os números da execução, `userFills`). Nenhuma leitura nova foi precisa: as três saem das
> leituras que a sonda já fazia no arranque.
>
> **A recusa tem duas metades, e as duas estão fixadas:** campo **ausente** → é o **contrato** que recusa
> (`campo_obrigatorio_ausente`; o esquema é fechado, os três entraram em `required`); campo presente e
> **`false`** → é a **porta do arranque da mesa** que recusa (`core/ciclo/arranque.ts`, porta `manifesto`,
> `porta_do_arranque_falhou`) e o `porque` **nomeia qual** — porque um conector que declara não cumprir é
> pior do que um conector que não arranca. E se a **sonda não conseguiu medir**, o manifesto **não sai**
> (`capacidade_nao_declarada`): a mesa não inventa a declaração pelo conector.
>
> Comandos e números desta vaga: `bun tools/verificar-conector/porta-do-contrato.ts` → **0 falhas** (contrato
> **1.7.0** · **131 casos** nos dois motores); `bun run brokers/hyperliquid/processo.ts --bancada` → **38
> casos · 38 ok · 0 divergentes · 262 verificações · 8 portas**; `bun brokers/hyperliquid/casos/correr.ts` →
> **24 casos · 24 ok**; `bash tools/verificar-maquina/provar.sh` → **27 de 27** (com a árvore gravada).
>
> **Casos novos:** 4 no contrato (3 ausências + 1 não-booleana), **4** na mesa (uma obrigação a `false` para
> cada uma das três, com o caso `todas-as-portas-passam` como **controle**, + a ausente recusada pelo
> contrato), **3** no conector (sonda sem medição) e **2** no processo (o venue cala o **próprio estado**; o
> venue cala o **histórico de execução**).
>
> **Prova negativa sobre o artefacto** (cópia do repositório; reposição dos 6 ficheiros da vaga conferida por
> `sha256`): a porta **deixa de conferir** as três → **4 divergentes**; a porta **só recusa a ausente** (aceita
> `false`) → **4 divergentes**; o esquema **deixa de exigir** `devolve_a_resolucao` → **183 falhas** na porta
> do contrato nos dois motores; a sonda **deixa de medir** `devolve_a_resolucao` → **21 divergentes** no
> processo; e a sonda **deixa de recusar o estado calado** → **21 divergentes** (era um defeito sem caso: a
> prova não reprovava nada antes desta vaga).
>
> **Nota de honestidade:** o fail-closed da obrigação **3** ao nível do *processo* é nomeado por outro motivo
> — um venue que cala `userFills` tira primeiro o `parcial_suportada` (que também se mede por esse histórico),
> e o processo nomeia a primeira falta. Fica dito no caso e em `emenda-1.7.0.txt`.

**As obrigações** (emenda do dono, 28 set 2026 — `docs/inventario-de-chaves.md` §8.1):

1. reportar a ligação **pelo protocolo** (não por silêncio de tick, nem por limiar de idade);
2. **reler o preço ao enviar** e aplicar o desvio a partir da régua relida;
3. **devolver a resolução** (a conta da corretora) para a mesa conferir contra a sua banda.

**O que há.** O manifesto do contrato 1.0.0 declara **19** campos de capacidades e factos da corretora
(`reduce_only_suportado`, `modelo_de_posicao`, `teto_de_valor_por_ordem`, `estado_do_mercado`,
`relogio_de_fecho_de_barra`, …) e **nenhum** deles nomeia as três obrigações acima. Medido:

```
$ python3 -c "import json;print(list(json.load(open('contracts/manifesto.schema.json'))['properties']))"
```

**A consequência.** Uma obrigação escrita em prosa não é conferida por ninguém: a mesa não pode recusar
um conector que não reporte a ligação, porque não há onde perguntar. Ficaria tudo a depender de boa
vontade do plugin — e o desenho desta casa é o contrário disso.

**Onde se conserta.** No recorte do conector, com **subida de versão do contrato** (o esquema é fechado,
`additionalProperties: false`: acrescentar campo é mudar contrato, e mudar contrato é acto declarado).

**Ampliado em 28 set 2026 (plugin do cTrader).** O dono descreveu o plugin como quem **carrega as constantes
de todas as corretoras e contas no arranque** e é escolhido por uma **constante de destino**. Nesse desenho o
manifesto não pode continuar a ser de uma conta: `manifesto.conector` é `{nome, versao}` e `instrumentos` é
**uma** lista. Tem de passar a declarar **por conta** (instrumentos, escalões de alavancagem, mínimos daquela
conta) — senão a porta do manifesto aprova uma mesa que não sabe o que está a aprovar, e o instrumento de uma
conta passa a valer para a outra.

**Como se saberá que está fechado.** Com um caso que faz falhar a **porta do manifesto** quando uma das
três não está declarada, e um caso de controle em que as três estão e o arranque passa.

---

## D-003 — A fila da contenda não tem hora de chegada no arranque  *(BLOQUEADO na superfície — 03/10/2026)*

> **ESTADO EM 03/10/2026 — NAO fechado, e o que falta tem nome.** A varredura da documentacao do stop/limite (5-E)
> relê isto e confirma o que ja' estava dito: **nao ha pedido nenhum** que o arranque possa carimbar. O arranque e'
> disparado pela **configuracao** (as fichas com `run: true`), e um ficheiro de configuracao nao pede nada — nao tem
> hora de chegada. O ramo FIFO existe e esta' medido (`tools/verificar-maquina/contenda.ts`, 7 casos, com o par de
> controle dos instantes trocados), e o arranque **diz que usou o desempate** (`criterio:
> "fifo_desempatado_por_simbolo"`) em vez de se chamar FIFO. Fechar isto exige a **superficie** (a web a ligar um
> instrumento, o dono a carregar num botao), que nao existe nesta vaga — e **nao se inventa um pedido** para a fila
> ter ordem. NAO e' um defeito do conector nem da mesa: e' trabalho que ainda nao tem quem o dispare.

> **A PORTA, confirmada a 03/10/2026, e o que a bloqueia.** A porta é a **`contenda`** — uma das seis do arranque
> da mesa (`core/ciclo/arranque.ts`: manifesto, mandato, **contenda**, inventário de chaves, versão do contrato,
> sessão). Quem a alimenta é `resolverContenda(pedidos, ...)`, e os `pedidos` são montados
> **das fichas da CONFIGURAÇÃO** (`Object.entries(fichas).map(...)`, com o comentário a dizê-lo no próprio
> código: «As fichas vêm da CONFIGURAÇÃO: ninguém as pediu, logo não têm hora de chegada»). Só quando todos os
> pedidos trouxerem um instante é que o critério é `fifo` (`core/ciclo/contenda.ts`, `decididoPeloInstante`); sem
> ele, o critério registado é `fifo_desempatado_por_simbolo` — o arranque **diz que desempatou**, em vez de se
> chamar FIFO. **O que a bloqueia:** a **superfície** (a web a ligar um instrumento, o dono a carregar num botão)
> — no sistema de hoje ninguém pede: as fichas estão no ficheiro. A fila e o desempate estão medidos
> (`bun run tools/verificar-maquina/contenda.ts` → **35 verificações · 0 divergentes · 7 casos**, com o par de
> controle dos instantes trocados), e o que falta é **quem peça**. Nada aqui é decisão de desenho por tomar.
>
> *O diagnóstico original fica por baixo, para auditoria.*

**O que devia acontecer.** A fila ordena pela **hora de chegada à mesa** (o relógio é o da mesa: o venue
nunca viu estas intenções, e o instante que o pedido traga de fora não é usado — quem escolhe o lugar na
fila é quem recebe, não quem pede). O símbolo só desempata.

**O que há.** No arranque de hoje as fichas vêm da **configuração**: ninguém as pediu, logo não têm hora
de chegada nenhuma. O ramo FIFO está implementado e **medido** (`tools/verificar-maquina/contenda.ts`, 7
casos, incluindo o par de controle com os instantes trocados), mas quem o alimenta ainda não existe: o
arranque usa sempre o desempate por símbolo, e **diz que o usou** (`criterio:
"fifo_desempatado_por_simbolo"`) em vez de se chamar FIFO.

**A consequência.** Nenhuma ordem errada acontece — mas a fila não sabe quem pediu primeiro porque ninguém
lhe disse. Não é um número inventado; é um pedido que não existiu.

**Onde se conserta.** Quando o arranque for disparado por **pedidos** (a web a ligar um instrumento, o dono
a carregar num botão) em vez de por um ficheiro de configuração: nesse momento a mesa carimba a hora de
chegada no seu próprio relógio e a fila passa a ter ordem. Não é trabalho do conector — é da superfície.

**Como se saberá que está fechado.** Um caso em que dois pedidos com horas de chegada distintas disparam o
arranque e **o primeiro a chegar fica com o lugar** — com a metade de controle: os mesmos dois com as horas
trocadas, e o lugar vai para o outro.

---

## D-004 — **RETRATADO** (o destino resolve-se no encaminhamento; o contrato fica como está)

**A primeira versão deste defeito dizia:** «a constante de destino não cabe no contrato de hoje», e propunha
um campo novo na boleta (com subida de versão) para o destino viajar na mensagem.

**Estava errado, e a decisão do dono mostrou por quê:** a multiplicidade é do **conector** (um processo por
corretora+conta, RN-E3/RN-E5) e a **mesa encaminha** cada ficha ao conector da conta dela. Se é a mesa que
encaminha, ela já sabe para onde encaminha — o destino resolve-se no **encaminhamento**, não num campo. Logo:
**nenhum campo novo na boleta, nenhuma subida de versão**. A medição que eu usei (14 campos na boleta, 3 na
proposta) continua verdadeira; o que ela não sustentava era a conclusão.

**Nota que fica, porque não era eu quem tinha razão:** a minha proposta de uma instância única a carregar as
constantes de várias contas era «um processo com várias corretoras» — proibido pela **RN-E5** desde o recorte
001. A regra já estava escrita e a proposta é que estava mal.

**O que sobra deste defeito, e é outra coisa:** a **atribuição por conta no registo**. A mesa precisa de
saber — e de escrever na linha — de que conta fala, senão a perda máxima (CB), a sessão e a reconciliação não
são atribuíveis quando houver mais de uma conta. Isso é matéria do **registo/ledger** (R8, aberto), não da
boleta: a linha do registo ganha a conta; a boleta não muda.

**Como se saberá que está fechado.** Com o par de controle na bateria do ledger: (a) duas contas na mesma
mesa, e a reconstrução do dia a fechar **por conta**; (b) a mesma operação com a conta trocada, e a linha a
mudar de conta. Sem a metade (b), "atribuiu certo" podia ser coincidência de haver uma conta só.

---

## D-005 — A fronteira vigia ↔ mesa não tem mensagem no contrato — **FECHADO pelo recorte 003** (29 set 2026)

O recorte 003 pôs a fronteira no contrato: quatro tipos (`comando`, `resposta_de_comando`,
`pergunta_do_encerramento`, `decisao_do_encerramento`), com casos próprios em `contracts/casos/vigia.casos.json`,
o contrato em 1.3.0, e a conferência dos **motivos nas duas direções** (`tools/verificar-contrato/fronteira.sh`,
0 falhas, com prova negativa). O texto do defeito fica abaixo, como estava.

**O que devia acontecer.** O vigia é um **processo separado** que só obedece a cinco verbos (RN-V1 a RN-V10),
e uma mesa em operação **nunca depende de ele estar vivo** (RN-V6) — as duas coisas só são verdade se houver
uma fronteira real entre eles. Pela decisão de contrato (D2: a costura é um processo com JSON texto, uma
mensagem por linha), o que cruza essa fronteira é **contrato**, e o que é contrato está fechado e versionado
(D5, D7).

**O que há, medido em 28 set 2026.** O *comando* existe, e está bem feito — mas é **interface interna**:

```
$ grep -rn "Verbo" core/estados/maquina.ts
17: export type Verbo = "start" | "pause" | "stop" | "reset" | "nova_sessao";
$ ls contracts/*.schema.json | tr '\n' ' '
boleta.json desfecho.json envelope.json manifesto.json mercado.json origem.json proposta.json ...
```

Não há tipo de mensagem para o comando. E o próprio repositório já o tinha escrito, antes desta conversa —
`core/estados/motivos.json`, na nota do conjunto fechado:

> «No dia em que o vigia for processo separado (RN-E8), estes motivos passam a cruzar a fronteira e terão de
> entrar no contrato — e uma mensagem nova volta ao recorte 001.»

**A consequência.** Pôr o vigia no ar (e é isso que o recorte 003 faz) obriga a: (a) contratar a mensagem do
comando — tipo novo, com verbo, autor, motivo e o envelope de sempre; (b) trazer para o contrato os motivos
de recusa da mesa, que hoje vivem em `core/estados/motivos.json` porque ainda não cruzam nada; e (c) **subir a
versão do contrato**, que é acto declarado e não efeito colateral. Isso não é um obstáculo: é o desenho a
funcionar — a fronteira nova pede contrato antes de pedir código.

**O que NÃO se faz para fugir a isto.** Meter o vigia dentro do processo da mesa para não ter de contratar
nada. Isso destruiria a RN-V6 (o vigia passa a ser caminho crítico), juntaria numa só morte o vigia e todas as
mesas que ele vigia, e deixaria a superfície (a web, RN-E8) a falar com um processo que também opera. O
contrato sobe de versão; o desenho não se dobra.

**Como se saberá que está fechado.** Com os casos declarados: (a) um comando do vigia aceito e a mesa a
transitar, com o motivo no registro; (b) um comando recusado e o **motivo da mesa** a voltar como mensagem do
contrato (é a metade que prova que a fronteira existe); (c) o vigia morto a meio e a mesa a continuar a
reconciliar (RN-V6), com a transição registrada.

---

## D-006 — A tabela trata «não sei» como «não há» — **FECHADO** (29/09/2026: o desconhecido tem linha própria)

> **Estado confirmado NO CÓDIGO a 03/10/2026** (o estado estava POR MEDIR, e mediu-se). As duas guardas
> disjuntas existem em `core/estados/transicoes.json`: `portas_do_arranque_nao_conferidas` (`=== undefined`, uma
> linha) e `posicao_viva_desconhecida` (`=== undefined`, duas linhas — `stop` em `em_operacao` e `pausada`),
> e o motivo `posicao_desconhecida` é do **livro** da mesa, não excepção da porta.
>
> Comandos e casos: `bun run core/estados/provar.ts` → **38 casos · 13 aceites · 25 recusados · 0 divergentes ·
> 0 recusas sem motivo**, com as três letras do «como se saberá» declaradas —
> `start-em-parada-com-as-portas-nao-conferidas-recusa`, `stop-sem-posicao-sabida-recusa-e-nao-para-a-mesa` e
> `stop-da-pausa-com-posicao-nao-sabida-recusa`; `bun run tools/verificar-maquina/tabela.ts` → invariantes da
> tabela, 0 falhas.


> **FECHADO — 29/09/2026.** As duas guardas passam a distinguir os **três** casos, e o desconhecido ganha
> linha própria de recusa na tabela:
>
> - `sem_posicao_viva` passou a `posicao_viva === false` (só o que se **sabe** não haver), e nasceu
>   `posicao_viva_desconhecida` (`=== undefined`) — guarda **disjunta**, para o significado das duas linhas
>   não depender da ordem em que estão escritas;
> - `portas_do_arranque_falham` (que já exigia `passam === false`) ganhou a irmã
>   `portas_do_arranque_nao_conferidas` (`=== undefined`).
>
> Linhas novas: `parada + start` (portas não conferidas → recusa `porta_do_arranque_falhou`, e a resposta
> **nomeia a porta «(nao conferidas)»** com o motivo `não saber que passaram não é passar`),
> `em_operacao + stop` e `pausada + stop` (posição desconhecida → recusa `posicao_desconhecida`). O motivo
> `posicao_desconhecida` **deixou de ser excepção da porta** e passou a motivo do **livro**
> (`core/estados/motivos.json`), porque quem o produz agora é uma linha da tabela; a lista
> `conjuntos_do_vigia.excecoes_da_porta` do contrato foi de **2 para 1** (`versao_do_contrato_divergente`).
> O livro passou de 49 para **50** motivos, e a fronteira de 25 para **26** nomes que cruzam.
>
> Comandos e números: `bun run core/estados/provar.ts` → **38 casos · 13 aceites · 25 recusados · 0
> divergentes** (eram 35); `bun run tools/verificar-maquina/tabela.ts` → **36 linhas · 0 falhas nos 7
> invariantes**; `uv run python tools/verificar-contrato/py/fronteira.py --motivos` → **0 falhas** (livro 50 ·
> 26 cruzam · 24 ficam); `bash tools/verificar-maquina/provar.sh` → **27 de 27** com a árvore gravada.
>
> **Casos (as três letras do «como se saberá»):** (a) três casos novos — `start-em-parada-com-as-portas-nao-
> conferidas-recusa`, `stop-sem-posicao-sabida-recusa-e-nao-para-a-mesa`, `stop-da-pausa-com-posicao-nao-
> sabida-recusa` — e os **CONTROLES**: `start-em-parada-arranca` (o MESMO contexto vazio, agora com as portas
> declaradas `passam: true`), `stop-sem-posicao-vai-direto-a-parada` (`false` → para) e
> `stop-com-posicao-vai-a-encerrando` (`true` → `encerrando`); (b) idem; (c) as provas negativas abaixo.
>
> **Um chamador DEPENDIA do defeito** — e foi a bancada que o apanhou: `tools/verificar-maquina/registo.ts`
> corria o dia com o contexto calado, e a mesa parava sem ninguém ter ido ver se havia posição. Com a tabela
> corrigida, esse dia passou a **recusar** (`posicao_desconhecida`) e a bancada ficou vermelha; o dia
> declara agora `posicao_viva: false`. É a medida de que o defeito **não era teórico**: havia, no
> repositório, um dia que andava por cima dele.
>
> **Provas negativas** (cópia; reposição dos 7 ficheiros da vaga conferida por `sha256` — todos iguais, e a
> cópia reposta volta a `38 · 0` e `0 falhas nos 7 invariantes`):
> (1) repor a guarda antiga (`!== true`) → **2 divergentes** (os dois casos novos do `stop`);
> (2) arrancar a linha `posicao_viva_desconhecida` da tabela → **2 divergentes** (o desconhecido cai na linha
> de baixo e recusa pelo motivo errado — é a diferença entre recusar por saber e recusar por acaso);
> (3) arrancar a linha `portas_do_arranque_nao_conferidas` → **1 divergente**: com o contexto vazio a mesa
> **arranca sem conferir as portas** (é o defeito original, de volta);
> (4) tirar `posicao_desconhecida` do livro → o intérprete **levanta** («motivo de recusa fora do conjunto
> fechado») e nenhum caso corre;
> (5) deixar de preencher a porta «(nao conferidas)» → **1 divergente**, com as duas linhas da resposta que
> faltam;
> (6) uma linha com guarda não declarada → o conferidor da tabela reprova no invariante 0 **e** no 6.
>
> **O que ficou deliberadamente como estava, e por quê.** Ficaram três guardas que também decidem por
> ausência: `com_inibicao`, `com_liquidacao_em_curso` e `com_posicao_viva`. A distinção não é de gosto:
> a **inibição** e a **liquidação** são factos **da mesa sobre si mesma**, e a mesa lê-os do seu próprio
> livro de marcas antes de consultar a tabela (`core/mesa.ts:243`); nas duas, ausência é ausência
> **declarada**, não desconhecimento. A **posição** e as **portas** são factos **do mundo** que ninguém
> local lê — e é por isso que são estas duas, e não as outras, que tinham de mudar. No par
> `parada + nova_sessao`, o desconhecido da posição cai na guarda seguinte (`equity_de_partida_nao_lido`),
> que recusa com o nome dela: fica **fail-closed**, ainda que com outro nome — e isso está dito aqui para
> não se ler como descuido.

**Encontrado a construir a porta de processo da mesa** (recorte 003, T014). Não é um defeito novo do código:
é um **buraco na tabela**, que ninguém tinha exercido porque as bancadas sempre passaram o contexto inteiro.

Duas guardas decidem por ausência:

```ts
case "sem_posicao_viva":          return contexto.posicao_viva !== true;               // não sei → "não há posição"
case "portas_do_arranque_falham": return contexto.portas_do_arranque?.passam === false; // não sei → "as portas passaram"
```

Consequência medida: uma porta (ou qualquer chamador) que passe o contexto vazio **arranca a mesa sem
conferir as seis portas** (`parada --start--> em_operacao`) e **para a mesa sem perguntar** (`em_operacao
--stop--> parada`), porque é essa a linha que casa primeiro. O comentário da própria tabela diz o contrário
do que a guarda faz: «com posição, apresenta o resumo e PERGUNTA».

**Por que ficou assim.** A tabela foi escrita para um chamador que *sabe* — as bancadas do recorte 002
montam o contexto à mão e sempre com os dois campos. O desconhecido nunca foi testado, e por isso a
ausência passou a valer como negativa.

**Como está fechado hoje (paliativo declarado).** A porta de processo **recusa** o que não sabe: `start`
sem as portas devolve `porta_do_arranque_falhou` com a porta `(não conferidas)`, e `stop` sem a posição
devolve `posicao_desconhecida` — um nome que existe no conjunto fechado e **vem da porta, não do livro**
(declarado em `contracts/vocabulario.json`). O desconhecido não vira «sim» por omissão, mas a correcção
vive **na porta**, e quem chamar a tabela directamente continua exposto.

**Como se fecha de verdade.** As duas guardas passam a distinguir os três casos (verdadeiro, falso,
**desconhecido**), e o desconhecido ganha linha própria de recusa na tabela — em vez de cair na linha
`sempre`. É trabalho do **US3** (o encerramento), porque é lá que a pergunta «fecho a mercado?» obriga a
saber se há posição viva: `--posicao-viva` deixa de ser argumento da porta e passa a ser leitura da
corretora, pela marca de posse (RN-T16.1).

**Como se saberá que está fechado.** (a) um caso de tabela com `posicao_viva` **ausente** que recusa, e o
mesmo caso com `false` que para — os dois na bateria `tabela.ts`, não só na porta; (b) o `stop` com posição
declarada a entrar em `encerrando` com o resumo apresentado; (c) a prova negativa: repor a guarda antiga e
exigir o vermelho.

<!-- FIM DO FICHEIRO — o defeito abaixo foi declarado ao fechar o D-006, e não é o mesmo defeito. -->

## D-007 — A recusa por liquidação em curso não é alcançável pela porta — **FECHADO** (03/10/2026, com prova no portão)

> **FECHADO — 03/10/2026, pela saida (i): a verdade chega ao contexto.** Quem sabe que a liquidacao comecou e' o
> **registo**, e e' a mesma verdade que o servidor ja' lia dele para mandar liquidar: a ultima entrada em
> `encerrando` traz o motivo da decisao do dono, e `liquidacao_em_curso` e' ele a escolher fechar a mercado
> (`core/ciclo/encerramento.ts`). O contexto do verbo (`core/mesa.ts`, `receber`) passa a trazer
> `liquidacao_em_curso` — e so' **dentro** de `encerrando`, para nao ser memoria velha de uma liquidacao acabada.
> Com isso a linha da tabela (`encerrando` + `start`, guarda `com_liquidacao_em_curso` -> recusa
> `liquidacao_em_curso`, FR-013) **passa a governar**: uma regra declarada que nunca disparava deixa de ser papel.
>
> **A PROVA, e ela e' a que o proprio defeito pedia (os dois lados):**
> `bash tools/verificar-maquina/vigia.sh --encerramento` — cenario `liquidacao-em-curso` (o dono responde
> `fechar_a_mercado`, a liquidacao corre, e o `start` a meio e' **recusado nomeado**: `motivo=liquidacao_em_curso`,
> zero transicoes de reabertura, e a recusa escrita no registo) e o **controle** `nao-fechar` (o MESMO `start`,
> com a liquidacao por comecar, **reabre** — o caminho do US7 continua a existir).
> **Prova negativa:** `bash tools/verificar-maquina/prova-negativa-do-encerramento.sh` — tira-se o campo do contexto
> (o defeito reposto, byte a byte o medido) e a bancada fica **vermelha a NOMEAR o caso**
> (`liquidacao-em-curso/D-007 ... motivo=undefined`); o ficheiro volta pelo `sha256`.
>
> *O diagnostico original fica por baixo, para auditoria.*

**Encontrado ao fechar o D-006** — a mesma família, mas é outro defeito, e por isso fica declarado em vez de
resolvido à socapa.

**O que existe.** A tabela tem a linha `encerrando + start` com a guarda `com_liquidacao_em_curso`
(`=== true`) → recusa `liquidacao_em_curso` (FR-013: «uma vez começada a liquidação, não se interrompe a
meio»). A linha **funciona**: o caso `start-durante-liquidacao-recusa` declara `liquidacao_em_curso: true` e
recebe a recusa certa.

**A medida.** Ninguém **põe** esse campo num contexto. Medido com
`grep -rn 'liquidacao_em_curso\s*:' --include=*.ts --include=*.json core vigia tools brokers` →
**0 atribuições** em todo o repositório. As cinco ocorrências que existem são outras coisas: a declaração do
campo e a leitura da guarda (`core/estados/maquina.ts:41,102`), o **efeito** que a decisão do dono produz
(`core/ciclo/encerramento.ts:156`), a leitura do motivo de uma linha do registo
(`core/servidor.ts:454`) e uma conferência do efeito na bancada do vigia.

**A consequência.** Numa corrida a sério, `encerrando + start` cai **sempre** na linha `sempre` → volta a
`em_operacao`. Isto é o caminho querido do US7 («o dono responde “não feche” com `start`») **enquanto a
liquidação não começou**; depois de ter começado, a mesa não tem como saber, e a regra do FR-013 fica escrita
numa linha que já não corre. Uma regra que só existe no papel é pior do que uma regra ausente: quem lê a
tabela julga-a cumprida.

**As duas saídas** (a decisão é do desenho, não de quem fecha isto): **(i)** o estado da liquidação passa a
chegar ao contexto — é o mesmo caminho do `--posicao-viva`, uma verdade que a mesa não tira de si e que o
vigia/registo tem de trazer (T021 é a porta por onde essas verdades entram); **(ii)** assume-se que o
`start` durante `encerrando` é sempre «não feche», apaga-se a linha e a guarda, e o FR-013 passa a estar
cumprido por outra via (a liquidação, uma vez começada, fecha as ordens antes de qualquer `start`; nesse caso
tem de haver onde isso esteja medido).

**Como se saberá que está fechado.** Um caso, na porta (não só na tabela), em que a mesa está `encerrando`
**com a liquidação a correr** e o `start` é recusado — e a prova negativa de que, sem a liquidação declarada,
o mesmo `start` cancela a pergunta (o caminho do US7 continua a existir).

---

## D-008 — As bandas do mandato têm leitores a menos, e duas chaves das regras não existem — **(2) FECHADO 29/09/2026: as duas BANDAS têm leitor; (1) MEDIDO 03/10/2026: as duas CHAVES não têm leitor nem comportamento**

> **ESTADO EM 03/10/2026 — a metade (2) esta' fechada desde 29/09 (as duas BANDAS do stop/tp morrem no ciclo, com 8
> casos e 6 provas negativas). O que resta e' a metade (1): as DUAS CHAVES que governariam comportamento que nao
> existe.** Medido hoje outra vez, por `grep -rn 'tolera_posicao_manual|tempo_maximo_em_posicao'` em todo o
> repositorio (fora dos documentos): **0 leitores, 0 fichas, 0 validadores**.
>
> - **`tolera_posicao_manual` (RN-T16)** — a dependencia que a travava (**o mapa de posse**, RN-T16.1) **ja' existe**
>   desde o recorte do ledger: `mercado.posicao.marca_de_posse` + `marcas-<conta>.jsonl`, e o comportamento «vista,
>   dita e **nao gerida**» tambem ja' existe (`posicao_alheia_relatada_nao_gerida`, medido em
>   `tools/verificar-conector/posse-do-preenchimento.ts`). O que **nao existe** e' o ramo `false` da regra — «se a
>   ficha nao tolerar, a mesa fica em **pausa** nesse instrumento». **Pausar um instrumento e' comportamento novo**
>   sobre dinheiro: nao se inventa sem a palavra do dono;
> - **`bandas.tempo_maximo_em_posicao`** — fechar por tempo exige saber **quando a posicao abriu**, e
>   `mercado.posicao` traz lado, unidades, preco medio e marca de posse — **nao traz instante de abertura**. A chave
>   nem consta da lista de bandas que o arranque confere. **Sem o instante de abertura nao ha' onde ler o tempo** —
>   e' um dado que falta, nao uma linha de codigo que falta (ha' que medir se o venue o publica).
>
> *Nada se inventou: a doutrina da casa para chave sem comportamento e' esta' — declara-se com a dependencia que
> falta, em vez de se criar a chave para o inventario parecer completo. As duas perguntas vao ao dono em
> `docs/ONDE_ESTAMOS.md` (nota de vaga, 03/10/2026).*

**Encontrado ao fechar o item das chaves sem leitor.** Três coisas medidas, e a terceira não estava na lista.

**(1) Duas chaves que as regras exigem não existem em ficheiro nenhum.** Medido com
`grep -rn 'tolera_posicao_manual|tempo_maximo_em_posicao'` em todo o repositório: **as duas só aparecem no
inventário** — nenhuma configuração, nenhuma ficha, nenhum validador, nenhum leitor. E as duas governariam
comportamento que **também** não existe:

- `tolera_posicao_manual` (RN-T16): a regra é «posição que apareça sem ter sido a mesa a abri-la é vista,
  dita e **não gerida**; se a ficha não tolerar, a mesa fica **em pausa** nesse instrumento». Para isso a mesa
  tem de saber **quais posições são dela** — e isso é o **mapa marca → ciclo/ficha** (RN-T16.1), que não
  existe. Sem o mapa, a chave não teria o que decidir;
- `bandas.tempo_maximo_em_posicao` (a banda que o inventário §2 lista): fechar por tempo exige saber **quando
  a posição abriu**, e o registo dessa abertura é a mesma coisa que falta — `mercado.posicao` traz lado,
  unidades, preço médio e marca de posse, e **não** traz o instante de abertura. Nota: a chave nem sequer
  está na lista de bandas que o arranque confere («saldo_pct», «alavancagem»).

**(2) Duas bandas que EXISTEM e ninguém confere — estas são piores, porque parecem cumpridas.** O inventário
dá-lhes «mesa e validação (RN-S11, RN-M4.12)» como leitor; medido, é falso:

> **FECHADO — 29/09/2026 (as duas bandas).** `bandas.stop_pct` e `bandas.tp_pct` passaram a **morder**. O
> valor do setup é conferido **onde ele aparece** — no ciclo, quando a boleta se compõe (`core/ciclo/ciclo.ts`,
> bloco 3.6) — contra a banda do mandato (`Mandato.bandas`, `core/ciclo/decisao.ts`), pela função
> **`cabeNaBanda`** (`core/ciclo/banda.ts`), que usa a **mesma aritmética exacta** (inteiros escalados) do
> `conferirBanda` do D-001. Fora da banda → `nada` com o motivo **`parametro_do_setup_fora_da_banda`**;
> banda declarada e valor ilegível → **`parametro_do_setup_nao_conferivel`** (não saber que cabe não é caber);
> **fechar/reduzir continua a passar** (o stop não viaja numa ordem que só fecha). Dois motivos novos, no
> **livro** da mesa e a **não cruzar** a fronteira (é decisão de ciclo, não resposta a comando) — logo **sem
> emenda**: o conjunto fechado do contrato não se toca. O livro vai de 50 para **52** motivos (26 cruzam,
> 26 ficam), contagens conferidas pelo próprio conferidor da fronteira.
>
> **Medido:** `bun run core/ciclo/provar.ts` → **99 verificações · 0 divergentes · 36 de ciclo** (eram 27);
> `bash tools/verificar-maquina/provar.sh` → **28 de 28**; `fronteira.py --motivos` → **0 falhas**.
>
> **Casos (8 novos, com o par de controle e as duas bordas):** `stop-na-borda-maxima-cabe`
> (**o máximo é dentro**) + `stop-um-passo-acima-da-borda-recusa` (**o par**); `tp-fora-da-banda-recusa`
> (o tp é conferido tanto como o stop); `a-banda-so-tem-minimo-e-o-valor-esta-abaixo`; `valor-ilegivel-nao-e-
> passe-livre` (`0,3` com vírgula); `setup-sem-stop-e-banda-declarada-passa` (não há valor a limitar, e a
> boleta prova que **não leva stop inventado**); `fechar-com-a-banda-violada-continua-a-passar` (o outro
> lado da regra); e **dois casos que provam que a aritmética exacta é carga e não enfeite** —
> `1.0000000000000000001` contra o máximo `1`, e `1` contra o mínimo `1.0000000000000000001`: a vírgula
> flutuante de JavaScript arredonda os dois e diria «cabe» nos dois.
>
> **Provas negativas** (cópia; reposição por `sha256`): a trava sai do ciclo → **5 divergentes**; o ilegível
> passa a valer como «cabe» → a boleta sai com um valor que o **contrato** recusa (`formato_invalido`,
> segunda linha de defesa, e o processo **grita** em vez de seguir); a comparação volta a `Number()` no
> máximo → **1 divergente** (o caso dos 19 algarismos); idem no mínimo → **1** (o caso simétrico); a trava
> passa a valer para o fecho → **1** (o caso do fecho); o motivo sai do livro → **1** (o conferidor da
> bateria reprova «os 21 motivos produzidos constam do livro»).

| Chave | Leitor medido |
|---|---|
| `bandas.saldo_pct` | `core/ciclo/arranque.ts` (porta do mandato) ✓ |
| `bandas.alavancagem` | idem + `core/ciclo/banda.ts` (D-001) ✓ |
| `bandas.distancia_minima_liquidacao_pct` | `core/ciclo/banda.ts` ✓ |
| ~~**`bandas.stop_pct`**~~ | ~~nenhum~~ → **`core/ciclo/ciclo.ts` (3.6) + `cabeNaBanda`** ✓ (fechado 29/09) |
| ~~**`bandas.tp_pct`**~~ | ~~nenhum~~ → idem ✓ (fechado 29/09) |

A consequência é a que o RN-M6.2 existe para impedir: **um setup pode declarar um stop fora da banda do
mandato e a mesa aceita-o**. Não é um número inventado — é um limite que existe escrito e não morde.

> **Nota de 29/09/2026:** esta consequência **deixou de ser verdade** no mesmo dia (ver o FECHO acima). Fica
> escrita porque era o retrato medido antes da correcção.

**Porque não se fechou isto aqui.** A correcção é pequena, mas não cabe numa linha e não é só de código:
(a) a comparação tem de ser **exacta** (inteiros escalados, como o `banda.ts` do D-001 — vírgula flutuante num
limite de risco é o defeito seguinte); (b) um valor do setup fora da banda é uma **recusa nomeada**, e um
motivo novo que cruze a fronteira é **contrato novo** (o conjunto é fechado — `conjuntos_do_vigia`), logo é
uma emenda com subida de versão; (c) a (1) depende do **mapa de posse**, que é trabalho do ledger (R8).

> **Nota de 29/09/2026 — o que este parágrafo acertou e o que errou.** Acertou no (a): a comparação é exacta,
> e há dois casos que o provam (o da vírgula flutuante, que arredonda 19 algarismos, e a prova negativa que
> o apanha). Errou no (b): **não foi precisa emenda nenhuma** — o motivo é de **ciclo**, não de resposta a
> comando, e o conjunto fechado do contrato só governa o que **cruza** a fronteira (`motivos_de_comando`).
> O que resta desta declaração é o **(1)**: as duas chaves que dependem do mapa de posse (RN-T16.1) e o
> comportamento que as leria.

**Como se saberá que está fechado.** (i) Para as duas bandas: um par de controle no arranque — o mesmo setup
com o stop **dentro** da banda (passa) e **um passo fora** (recusa nomeada, e o valor não é corrigido);
(ii) para as duas chaves: uma ficha com `tolera_posicao_manual` declarado e uma posição **não nossa** no
venue, com a mesa a dizer que a viu e a **não a gerir** (e, no caso `false`, a pausar o instrumento);
(iii) para o tempo em posição: a posição aberta há mais do que a banda, e o fecho a acontecer — com o par de
controle de uma posição **dentro** do tempo, que fica.

## D-009 — A idempotência declarada no manifesto não é a do venue — **FECHADO pela via (a)** (03/10/2026)

> **FECHADO — 03/10/2026, pela saida (a): a idempotencia passou a ser NOSSA.** Antes de tocar no venue — e antes de a
> `resolucao` sair — o conector **le' o registo de ordens da conta** (`historicalOrders`) e procura o `cloid` que a
> traducao derivou desta referencia. Achado, **NAO MANDA**: responde `recusado` com o motivo novo
> **`referencia_ja_enviada_ao_venue`** (emenda **1.12.0**) e leva a ordem que existe inteira em `resposta_do_venue`.
> A leitura nao se fez (venue calado, erro ou fora do prazo)? **`desconhecido`**, e tambem nao se envia: sem saber
> se a ordem la' esta', mandar e' uma aposta.
>
> **A RECONCILIACAO E' INCONDICIONAL, e e' isso que a torna uma guarda a serio:** o manifesto continua a declarar
> `idempotencia: true` (le'-se da bateria, e a P6 mediu o contrario) — **uma declaracao que mente nao pode ser a
> unica guarda do dinheiro**. Por isso ela corre em TODO o envio, e nao so' quando a declaracao diz «nao». O custo
> e' UMA leitura do registo de ordens por ordem enviada (ordens sao raras; o orcamento de leituras ao venue nao e'
> tocado — e o limiar de 429 continua fora desta medicao, por decisao da auditoria).
>
> **A PROVA (no portao):** `bun run brokers/hyperliquid/processo.ts --bancada` -> **41 casos, 0 divergentes**, com
> tres casos novos: `processo/reconciliacao-a-referencia-ja-produziu-ordem` (a ordem esta' no registo: RECUSA
> nomeada, UMA linha, e a resposta do ENVIO nem esta' declarada no duble — se o caso chegasse ao venue, a bancada
> rebentava), `processo/reconciliacao-com-ordem-de-outra-referencia` (**o controle**: o registo tem uma ordem, mas de
> OUTRA referencia — nao encontrar a nossa, ENVIA) e `processo/reconciliacao-nao-se-leu-nao-envia` (`desconhecido`
> com `reconciliacao_nao_lida`, sem envio).
> **Prova negativa:** `bash tools/verificar-conector/provas-offline.sh --prova-negativa` — injecta-se o defeito (a
> leitura deixa de encontrar a ordem), a bancada fica **vermelha a NOMEAR** o caso, e o ficheiro volta pelo `sha256`.
>
> **O que fica declarado, e nao escondido:** o **manifesto continua a mentir** (`idempotencia: true`) porque o campo
> vem do registo da bateria de teste, e gerar um novo registo exige uma corrida ao venue **a mover dinheiro** — que
> nao se faz nesta vaga. A guarda protege o dinheiro sem depender da declaracao; a declaracao continua a ser o que a
> bateria mediu. Trabalho de casa: derivar `idempotencia` da **P6** (e nao das notas de documentacao do venue).

**Encontrado na primeira corrida da bateria de TESTE contra a testnet** — a primeira vez que este conector
falou com a corretora a sério para **enviar**. O manifesto declara `idempotencia: true`; medido, é **falso do
lado do venue**: a mesma boleta (mesma referência de cliente → mesmo `cloid`) enviada duas vezes produziu
**duas ordens**.

| envio | ordem no venue | `cloid` enviado | estado | execuções na conta |
|---|---|---|---|---|
| abertura | `61429208395` | `0x0be22c2ea5af902098493496b48978f9` | filled 0.00023 @ 83469.0 | 61 |
| **a mesma boleta outra vez** | `61429223297` | `0x0be22c2ea5af902098493496b48978f9` | filled 0.00023 @ 83483.0 | 62 |

Medido no `historicalOrders` da conta: as duas ordens estão lá, com o **mesmo** `cloid` e `oid` diferentes; a
posição passou de `0.00023` para `0.00046`. E o `cloid` **chega** ao venue — 10 das 425 ordens da conta têm
`cloid`, e são exactamente as nossas (as 415 restantes são do motor antigo, que não marcava nada). Ou seja: não
é um defeito de transporte. **O `cloid` não é um mecanismo de deduplicação neste venue.**

**Porque é que isto importa.** A idempotência não é uma conveniência: é o que permite ao dono repetir um
comando, ou à mesa reenviar depois de um silêncio, sem abrir duas vezes o mesmo risco. Com o manifesto a
declarar `true` e o venue a aceitar duplicados, quem confiar na declaração **duplica posição** — foi o que
esta corrida fez, de propósito, para o medir.

**As duas saídas — decisão de desenho, e não a tomar aqui:**

- **(a) a idempotência passa a ser nossa**: antes de enviar, o conector consulta o histórico da conta (já o lê:
  `historicalOrders`/`userFills`, ver `historico.ts`) e, se aquela referência já produziu ordem, **recusa** e
  devolve o que já existe em vez de mandar outra. O venue não ajuda, mas também não impede: a informação está
  do nosso lado;
- **(b) a declaração corrige-se**: `idempotencia: false` no manifesto, e o contrato passa a dizer ao dono o que
  é verdade — que repetir a referência pode criar segunda ordem, e que a protecção tem de vir de fora.

Enquanto nenhuma delas for feita, o `SC-004` **não está cumprido**: a bateria registou 11 de 12, e a que falha
é a que promete ao dono que a mesma referência não cria segunda ordem (RN-H11/FR-011).

**Prova.** `specs/004-conector-hyperliquid/relatorios/registos-do-venue/1.7.0-teste.txt` (P6, com a saída crua das duas respostas e do
histórico) e `specs/004-conector-hyperliquid/relatorios/bateria-de-teste-1.7.0.txt`.

## D-010 — A alavancagem que a boleta pede nunca é pedida ao venue — **FECHADO** (declarado e fechado 29/09/2026)

> **FECHADO — 29/09/2026.** O conector passou a **pedir** a alavancagem ao venue e a **confirmá-la pela
> leitura**, antes de a `resolução` sair (a ordem importa: se a resolução saísse primeiro, declararia a
> alavancagem pedida enquanto o venue tinha outra, e a conferência da banda — D-001 — estaria a conferir uma
> alavancagem que não vigora). Medido ao vivo na TESTE, na mesma corrida da bateria:
>
> ```
> P11  a boleta pede 2 · o venue tem 2 ({"type":"cross","value":2}) · a posicao le-se com leverage=null
> ```
>
> **Antes desta correcção o venue tinha 40** (medido na corrida anterior, com o mesmo pedido de 2). O verbo
> usado é o do próprio venue (`updateLeverage`, com `isCross` lido da conta — o conector não escolhe o modo de
> margem, só pede a alavancagem). Três recusas nomeadas ficaram no caminho, todas `capacidade_nao_declarada`:
> a porta não tem verbo de ajuste; o venue recusou o ajuste; ou o venue disse «sim» e a releitura continua com
> outro valor — em nenhum dos três se abre com uma alavancagem diferente da declarada (FR-007).
> Prova: `specs/004-.../relatorios/registos-do-venue/1.7.0-teste.txt` (P11) e o `diag` da etapa `alavancagem`.

**Encontrado na bateria de teste, ao ler os cinco números da posição viva.** A boleta do teste pede
`alavancagem: "2"`; o venue responde `activeAssetData.leverage = {"type":"cross","value":1}` — e a posição lê-se
com a alavancagem que **já lá estava**, não a que a mesa pediu.

```
P11  a boleta pede 2 · o venue tem 1 ({"type":"cross","value":1}) · a posicao le-se com leverage=null
```

Medido também no código: **0 chamadas de ajuste de alavancagem** em `brokers/` (o `updateLeverage` do SDK não
é usado em sítio nenhum). O campo viaja na tradução (a `accao` sai com `alavancagem: "2"`) e **morre ali**.

**Porque é que isto não é cosmético.** FR-008: «A alavancagem DEVE ser pedida ao venue quando houver esse
verbo». O manifesto declara `sabe_ajustar_alavancagem: true` — a capacidade existe, não é usada. E a
**resolução** que a mesa confere contra a banda (D-001) traz a alavancagem **pedida**, não a que vigora: os
números com que o dono autoriza risco saem de uma alavancagem que não está lá. Foi exactamente isto que fez a
P5 medir «1 de 5 coincidem» com a leitura do venue.

**O que fecharia:** pedir a alavancagem ao venue antes de abrir (o verbo existe no SDK deste venue) e, quando
ele recusar, **recusar a boleta** em vez de seguir com outra alavancagem — o silêncio é que não serve.

## D-011 — A boleta pede stop e o stop não sai — **FECHADO** (03/10/2026: recusa nomeada COM CASO; a ordem `trigger` fica declarada)

> **FECHADO — 03/10/2026.** Este defeito tem duas metades, e as duas ficam ditas com o seu nome. **(1) O SILENCIO
> ACABOU** (29/09/2026): a boleta com `stop_pct`/`tp_pct` e' **RECUSADA COM NOME** (`capacidade_nao_declarada`),
> porque este conector ainda nao manda a ordem `trigger` — a unica saida proibida era «aceitar e ignorar», que era
> o que acontecia (P10: payload identico com e sem stop). **(2) O CASO FALTAVA**, e entrou hoje: na varredura dos 44
> casos de `ordens.casos.json` **nao havia UM unico caso com `stop_pct` ou `tp_pct`** — a recusa existia no codigo e
> nao tinha prova no portao. Agora tem dois:
> `ordens/stop-pedido-nao-sai-recusa-nomeada` e `ordens/tp-pedido-nao-sai-recusa-nomeada`
> (`bun brokers/hyperliquid/casos/correr-ordens.ts` -> **53 casos, 0 divergentes**).
>
> **O QUE FICA EM ABERTO, declarado como capacidade e nao como defeito fechado:** o venue **TEM** o verbo (medido
> nos tipos do SDK: `t: { trigger: { tpsl, triggerPx, isMarket } }`; o manifesto declara `stop_anexo: false`, logo
> o stop e' entregavel como ordem `trigger` separada). Implementa-lo exige, junto, o **cancelamento** que impede a
> trigger de descansar depois de a posicao fechar (D-012). Enquanto isso nao existir, a resposta honesta e' a que
> esta': recusar nomeando, em vez de entregar uma posicao desprotegida a quem pediu proteccao (FR-007).
>
> **Porque e' que isto NAO e' decisao da mesa:** o stop e' do **SETUP** (RN-S3/RN-S11) e a mesa so' o transporta —
> quem nao o sabe honrar e' a **ponta** (o conector), e e' por isso que a resposta sai la'.

> **ESTADO EM 29/09/2026, ao fechar a varredura do vocabulário: o SILÊNCIO acabou; o stop ainda não sai.**
> O tradutor passou a **recusar com nome** (`capacidade_nao_declarada`) qualquer boleta que traga `stop_pct`
> ou `tp_pct` — a posição já não sai desprotegida em silêncio, e o setup com stop falha alto em vez de falhar
> calado. Medido nos tipos do SDK instalado: o venue **tem** o verbo (`t: { trigger: { tpsl: "tp"|"sl",
> triggerPx, isMarket } }`), e o manifesto declara `stop_anexo: false` (não prende o stop à ordem de entrada).
> Ou seja: o stop é **entregável** como ordem `trigger` separada — falta implementá-lo, e com ele o
> cancelamento (D-012) que impede deixar a trigger a descansar depois de a posição fechar. Prova viva: P10/P12
> da bateria de teste (`specs/004-.../relatorios/registos-do-venue/1.7.0-teste.txt`).

**Encontrado ao medir, com o tradutor a correr, o que os campos da boleta mudam no que sai.** A mesma boleta
enviada **com** `stop_pct: "2"` e `tp_pct: "4"` e **sem** eles produz um payload **idêntico** — mesma
quantidade, mesmo preço, mesmo `cloid`:

```
com stop_pct/tp_pct vs sem: payload IDENTICO
campos que saem: ["alavancagem","cloid","desvio_maximo","instrumento","lado","nocional","preco",
                  "preco_de_referencia","quantidade","reduce_only","tif","tipo"]   <- nenhum é stop
o venue declara stop_anexo=false
```

Medido no código: `stop_pct` e `tp_pct` têm **0 ocorrências** em `brokers/`; `prazo_da_passiva_ms` e
`destino_do_resto` só aparecem na **declaração do tipo** da boleta, nunca numa leitura. (Para o par
`prazo`/`destino` a medição directa com preço válido deu também payload idêntico; na bateria os dois casos
`limite` morreram antes, pela razão do D-012 — e isso fica dito em vez de se contar como prova.)

**Porque é que isto é grave.** O stop **vem do setup** (`core/ciclo/decisao.ts` copia `setup.stop_pct` para a
boleta, RN-S11) e é o que o dono autoriza como protecção. O conector recebe-o, o contrato exige-o na boleta, o
manifesto diz que **este venue não prende stops** (`stop_anexo: false`) — e ninguém recusa: a ordem sai sem
stop e **a mesa fica a acreditar numa protecção que não existe**. É o FR-007 outra vez («o conector NUNCA
adapta uma boleta em silêncio»), agora com o risco do lado do dinheiro.

**O que fecharia:** quando a boleta traz `stop_pct`/`tp_pct` e o manifesto não declara capacidade de os
prender, **recusar nomeando** (`capacidade_nao_declarada`); e, para o `prazo`/`destino`, ou se implementam
(verbo de cancelamento, D-012) ou saem do contrato.

## D-012 — O tipo `limite` é inalcançável neste venue (e o `destino_do_resto: cancelar` não tem verbo) — **(b) FECHADO 03/10/2026; (a) FICA declarado: o `limite` continua no conjunto declarado, e tirá-lo é decisão do dono**

> **ESTADO EM 03/10/2026 — a metade (b) fechou, a metade (a) nao e' nossa.**
>
> **(b) O `destino_do_resto: cancelar` — FECHADO, e a leitura e' a que ja' estava no codigo, agora com prova.** O
> verbo de cancelar **nao e' preciso nesta ponta**: para o UNICO tipo alcancavel depois do D-012 (`mercado`, tif
> `Ioc`), quem cancela o que nao encheu e' o **proprio venue**, por construcao — o `Ioc` e' um cancelamento
> imediato do resto. O caso novo `ordens/resto-a-cancelar-honrado-pelo-ioc` prova-o: o campo nao chega ao payload e
> o `tif` que sai e' `Ioc`. Nao ha accao nenhuma para a mesa decidir (logo, nada a acrescentar a `acoes_da_mesa`).
>
> **(a) O `limite` — NAO fechado, e a decisao e' do DONO.** Medido: `limite` **e' alcancavel** (ha' um caso a
> provar: `ordens/limite-post-only-aceite-e-preco-exacto`, `preco 1234.5` -> `Alo`), mas **nao com o preco que a
> mesa tem**: no tipo `limite` o preco vai **caractere a caractere** da marca (`ordens.ts`), e a marca que este
> venue publica para o BTC tem **6 algarismos significativos** (`83554.0`) contra os **5** que o proprio venue aceita
> — recusa nomeada `valor_fora_da_banda` (caso `ordens/preco-com-6-algarismos-significativos-recusa`). As duas
> saidas sao as que o defeito ja' dizia: **executar** o `limite` (derivar da marca com a quantizacao da regra, em vez
> de a usar crua) — o que **muda o preco a que uma ordem de limite sai**, e por isso nao e' decisao de quem escreve
> o codigo — ou **retirar o tipo** do que o manifesto declara, o que e' uma **perda de capacidade** e e' o dono que
> a aceita. **Vai ao dono com a medicao na mao** (ver a nota de vaga em `docs/ONDE_ESTAMOS.md`).
>
> **O QUE FICA, em uma linha (03/10/2026):** o `limite` **continua declarado** no manifesto (`tipos_de_ordem`) e
> a decisao continua **em aberto e sua** — (A) executar com o preco derivado/quantizado, ou (B) retirar o tipo.
> Nao se retirou nada por conta propria, porque tirar o tipo e' **perda de capacidade**, e uma perda de capacidade
> nao se decide por omissao: **fica declarado como o que falta**, com a medicao ao lado.

**Encontrado ao tentar exercer o outro tipo de ordem que o manifesto declara.** O manifesto diz
`tipos_de_ordem: ["mercado","limite"]`; medido, **toda** a boleta `limite` morre antes de sair:

```
limite -> {"ok": false, "motivo": "valor_fora_da_banda",
           "porque": "o preco 83554.0 nao cabe na regra do venue: o venue aceita no maximo 5 algarismos
                      significativos no preco e o preco 83554.0 tem 6 — recusa, nao arredonda"}
mercado (o par de controle, mesma marca) -> passa, com o preco quantizado a 83971
```

A raiz: no tipo `limite` o preço que vai para o venue é **a marca, carácter a carácter**
(`ordens.ts`: `par.tipo === "limite" ? preco : precoAgressivo(...)`), e a marca que este venue publica para o
BTC tem **6 algarismos significativos** (`83554.0`) — acima dos 5 que o próprio venue aceita no preço de uma
ordem. No `mercado` o preço é derivado e sai sempre quantizado, e por isso passa. **A recusa é nomeada (não é
silêncio)**, mas o resultado é o mesmo: o `limite` não é utilizável no BTC.

Junto com isto, e pela mesma medição de código: o `destino_do_resto: "cancelar"` **não tem verbo** — não
existe cancelamento em `brokers/` (0 ocorrências), e o `limite` é enviado `Alo` (post-only), ou seja, uma
ordem que descansa no livro e **não pode ser retirada por nós**. Uma boleta que peça `cancelar` comporta-se
como `agressivo`.

**O que fecharia:** (a) um preço de limite que caiba na regra do venue (derivar da marca com a quantização da
regra, em vez de a usar crua) — ou declarar no manifesto que o `limite` não é utilizável; (b) o verbo de
cancelamento, sem o qual `destino_do_resto` não tem sentido.

## D-013 — O lado oposto à NOSSA posição não é distinguido de «abrir» — **FECHADO** (declarado e fechado 29/09/2026)

> **FECHADO — 29/09/2026.** O ciclo passou a distinguir o caso: proposta do lado **oposto** a uma posição que é
> NOSSA → `acao: "fechar"` com `reduce_only: true` na boleta. `reduce_only` é a única forma honesta de dizer
> «reduz, nunca inverte» sem a mesa calcular unidades (RN-B0): o venue corta no tamanho da posição, e a boleta
> pode ir por cima sem risco. Prova, no `core/ciclo/provar.ts` — **102 verificações · 0 divergentes** (eram 99),
> com os 3 casos novos:
>
> ```
> ok  ciclo/d013-lado-oposto-a-nossa-posicao-fecha-em-reduce-only    (buy nosso + proposta sell -> fechar, sell/ro)
> ok  ciclo/d013-o-par-de-controle-mesmo-lado-aumenta-a-posicao      (buy nosso + proposta buy  -> abrir,  buy, ro=false)
> ok  ciclo/d013-posicao-vendida-e-proposta-buy-fecha-em-reduce-only (sell nosso + proposta buy -> fechar, buy/ro)
> ```
>
> O par de controle existe de propósito: se os DOIS lados fechassem, a correcção teria ido longe de mais — o
> mesmo lado da nossa posição é um **aumento**, e continua a sair com `reduce_only: false`.
>
> **O que fica por fechar, e fica dito:** uma **redução PARCIAL** continua sem nome próprio. O vocabulário da
> decisão é `abrir | fechar | adoptar | nada` (medido em `core/ciclo/decisao.ts`), o tamanho da boleta vem da
> percentagem do saldo do mandato, e não há verbo para «reduz metade». Acrescentar um verbo mexe no registo e,
> se o `acao` cruzar a fronteira, no contrato — é decisão de desenho, com a prova já feita à frente. A prova
> viva (a bateria a mandar o lado oposto ao venue) fica para quando o trabalho em curso no conector aterrar.

**Encontrado ao provar a virada de mão** (o dono pediu-a, e o vocabulário não a tem). Medido na bateria (P15),
com posição nossa aberta de `0.00023 BTC`:

```
a mesa decidiu      abrir/null        <- o ciclo trata `sell` como abrir
a boleta saiu       sell  reduce_only=false
o venue respondeu   aceite
a posicao depois    nenhuma           <- o venue ZEROU a posicao (netting)
```

O registo fica a dizer **`abrir`** e o que aconteceu foi uma **redução**. E o agravante está a uma linha de
distância: se a boleta fosse **maior** que a posição, o mesmo caminho entrega uma **virada numa só ordem** — que é
exactamente o que a virada de mão em dois passos existe para não deixar acontecer (P14 mede a via correcta:
`buy -> sell/ro -> sell -> buy/ro`).

**Porque é que isto importa.** O vocabulário só tem `buy`/`sell`/`hold`/`caixa`: não há verbo para *reduzir
parcialmente* nem para *virar*. O tamanho da boleta é a percentagem do saldo do mandato (`montarBoleta`), logo
uma redução parcial não se exprime pela via do ciclo. Consequência: a mesa tem uma acção (`reduzir_e_registar`, a
4ª da tabela de razões) que **não tem boleta correspondente** — sabe que deve reduzir e não tem como o dizer.

**O que fecharia** (decisão de desenho, e não a tomar por aqui): (a) o ciclo passa a distinguir a proposta cujo
lado é oposto ao da nossa posição — nomeia-a `reduzir` (reduce_only, tamanho explícito) e **recusa** uma boleta
que aumentaria além da posição; ou (b) o vocabulário ganha o que lhe falta — um tamanho neutro na boleta
(percentagem da POSIÇÃO, não do saldo), que é o que permite dizer «reduz metade» sem tocar no mandato.

**Desenho FECHADO (02/10/2026).** Vale a via **(b)** — e a razão é de desenho, não de gosto: o `saldo_pct`
continua a ser a régua da **abertura** (é do dono, e é o que a contenda soma), enquanto a **redução** mede-se
contra o que existe — a posição. Com um tamanho relativo à posição, a mesa diz «reduz metade» **sem tocar no
mandato**. A outra metade deste problema já foi fechada pelo **`reverse`** (contrato 1.10.0): o lado oposto à
posição é **uma** decisão com verbo próprio, e não dois passos no tempo da mesa — que foi o que deixou o ETH
plano 46 minutos a 02/10/2026.

**O que falta:** o campo na boleta (emenda **1.11.0**, pelo procedimento do `reverter` — campo obrigatório, D4),
o `reduce_only` com o tamanho parcial na porta do `brokers/hyperliquid/ordens.ts` (hoje ela só sabe fechar tudo),
e os casos com controlo. Nenhum setup do repositório emite redução parcial (o σ emite `caixa` ou um lado), logo
**a emenda precede qualquer uso** — não há caminho em que isto saia sem estar declarado.

> **FECHADO — 02/10/2026 (o que faltava, e o que sobra do defeito).** O caminho (b) está escrito no contrato e
> medido nas duas pontas:
>
> **O campo** — `boleta.posicao_pct` (decimal textual, **OBRIGATÓRIO**): `1` é a posição INTEIRA, e é o valor de
> uma ordem que **não** é uma redução parcial («não é parcial» é um valor DECLARADO, como o `reverter: false`;
> a ausência diria «não foi declarado», D4). Abaixo de `1` é uma **redução parcial** — essa fracção do que está
> aberto («reduz metade» = `0.5`) —, e exige `reduce_only: true`: quem reduz nunca inverte. O contrato vai a
> **1.11.0** (`contracts/versao.json`, com a emenda inteira escrita lá), o gerador correu (**12 schemas → 15 TS
> + 15 Python**) e as duas provas negativas estão nos casos do contrato
> (`boleta/sem-o-tamanho-relativo-a-posicao` → `campo_obrigatorio_ausente`;
> `boleta/tamanho-relativo-a-posicao-em-virgula-flutuante` → `tipo_invalido`).
>
> **A porta do conector passou a saber o PARCIAL.** Medido em `brokers/hyperliquid/ordens.ts`: a quantidade da
> fracção é `posicao_pct × posicao_viva` (a posição é lida do VENUE e entra na tradução como o `saldo` e o
> `preco` — a mesa não calcula unidades, RN-B0), ajustada ao passo **por baixo** (reduz menos, nunca mais do que
> foi pedido), com o mínimo do instrumento e o mínimo de valor por ordem conferidos sobre a quantidade que sai.
> Duas recusas novas, nomeadas: `reducao_parcial_sem_reduce_only` (contradição declarada) e
> `reducao_parcial_sem_posicao_viva` (uma fracção de nada não é uma ordem) — e `posicao_pct` acima de `1`
> RECUSA por `valor_fora_da_banda`. O `ctrader` confere a MESMA declaração e recusa a fraccao por
> `capacidade_nao_declarada` (não tem `reduce_only`, RN-CT34): nada de meias reduções disfarçadas.
>
> **Casos com controlo:** 6 na bancada das ordens do `hyperliquid` (a fracção pedida → `0.005` de `0.01`; o
> **par de controle** com `posicao_pct: 1` a sair exactamente como saía antes — quantidade vinda do `saldo_pct`,
> posição viva não lida; e as quatro recusas) e 2 no `ctrader`. As ordens do conector entraram **no portão**
> (estavam só a correr à mão): `bash tools/verificar-maquina/provar.sh` → **36 de 36** — e depois **37 de 37**,
> com a porta do contrato dentro (o mesmo dia, a segunda metade da lição; ver o fecho do D-015).
>
> **Medido:** `ordens: 50 casos · 50 ok · 0 divergentes` (`bun brokers/hyperliquid/casos/correr-ordens.ts`) ·
> `ctrader: 63 casos · 63 ok · 0 divergentes` (`uv run python casos/correr.py`) · contrato **136 casos** nos
> dois motores e a `porta-do-contrato.ts` → **0 falhas** · bancada do ciclo **118 verificações · 0 divergentes**.
>
> **O que continua aberto, e fica dito:** nenhum setup do repositório emite redução parcial — a mesa declara
> SEMPRE `posicao_pct: "1"` (`core/ciclo/ciclo.ts`, com o sítio nomeado onde o tamanho entraria). O campo existe
> para o dia em que um setup peça «reduz metade», e nesse dia não há contrato novo a fazer: já está declarado.
> E o `_defs/forma.schema.json#/$defs/motivo` (o espelho do vocabulário) **faltava-lhe dois motivos desde a
> 1.10.0** — medido pela `porta-do-contrato.ts`, que estava fora do portão; ficou fechado aqui, com os quatro.

## D-014 — a ficha é lida como UM objecto, e a espec dizia DOIS arquivos  *(RESOLVIDO POR DECISÃO, 30/09/2026)*

**Declarado em 30/09/2026.** Medido: `core/servidor.ts` (via `core/ciclo/relogio.ts`, `conferirMandatos`) lê a
configuração com `fichas.<instrumento>.{saldo_pct, alavancagem, ...}` — o risco e o setup **no mesmo objecto**.
A espec é explícita em contrário: "**Ficha** — a configuração concreta de um instrumento: **dois arquivos**, um
de risco e um do setup, mais o nome do setup e da variante" (RN-M6), e separa as responsabilidades em RN-M5
(risco: percentagem do saldo, alavancagem, distância de liquidação, bandas; setup: stop, tp, limiares, janela,
parcial, aumentos).

**Porque importa, e não é estilo:** com as duas coisas num ficheiro só, o setup *serve-se* do risco em vez de o
cumprir, e ninguém consegue provar que os itens do setup cabem nas bandas do risco — que é precisamente o que
o arquivo de risco existe para garantir.

**O que fica feito agora:** o layout existe e é usado pelo operador — `fichas/<PAR>/risco.json` e
`fichas/<PAR>/setup.json`, uma pasta por par (BTC a 1h, ETH a 30m: o mesmo setup, dois relógios). A operação
escrita pelo operador leva os dois, separados, em `parametros` e `risco`.

**O que falta:** o leitor do core passar a ler os dois arquivos (e a conferir as bandas), em vez de ler um
objecto único. Enquanto não for feito, a config que se dá ao `--config` é uma vista juntada — e uma vista
juntada pode esconder uma banda violada.

**Fecho (30/09/2026).** O dono decidiu: **um ficheiro por par**, com cabeçalho padrão + as constantes do
indicador. A espec levou emenda datada (mesma data, `docs/regra-de-negocio.md`, RN-M6). Fica alinhado: o código
lia um objecto, a decisão é um ficheiro, e o `fichas/README.md` diz a forma. *Não* fica pendente código nenhum.

---

## D-015 — a RN-M4.12 não existe no código: o travão de risco por ordem não está lá — **FECHADO** (02/10/2026: o travão existe e está medido)

> **Estado confirmado NO CÓDIGO a 03/10/2026** (o título parecia aberto). O travão existe: o motivo
> `risco_por_ordem_excedido` está no **livro** (`core/estados/motivos.json`, 56 motivos, `cruzam_a_fronteira:
> false` — nasce e morre dentro do ciclo) e o ciclo produz-o em `core/ciclo/ciclo.ts` antes de montar a boleta,
> para `abrir` **e** `reverse` (os dois que AUMENTAM exposição). A comparação é a mesma aritmética exacta das
> bandas, contra o tecto que a **conta** declara (`conta.risco_maximo_por_ordem_pct`) — e uma conta que o não
> declara **não tem travão, e a mesa di-lo no registo**.
>
> Comandos e casos: `bun run core/ciclo/provar.ts` → **118 verificações · 0 divergentes**; os **seis casos**
> `d015-*` em `core/ciclo/ciclo.casos.json` (acima do tecto recusa, dentro abre, na borda é dentro, sem tecto na
> conta não há travão, a **virada** acima do tecto recusa e a virada dentro do tecto vira numa só decisão).


> **FECHADO — 02/10/2026.** O travão existe, é uma comparação **PURA**, e está medido. O que o fecha:
>
> **O motivo novo** — `risco_por_ordem_excedido` — entrou no **livro da mesa** (`core/estados/motivos.json`)
> com `cruzam_a_fronteira: false`: nasce e morre dentro de um ciclo, logo **não exige emenda ao
> `vocabulario.json`** (o conjunto fechado do contrato só governa o que **cruza** a fronteira). O livro vai de
> 55 para **56** motivos (26 cruzam, **30** ficam), e o conferidor da fronteira confere as duas contagens.
>
> **Onde entrou, e por onde o tecto chega.** No `core/ciclo/ciclo.ts`, imediatamente antes do ponto 5 (que monta
> a boleta), para **`abrir` E `reverse`** — os dois AUMENTAM exposição na mesma ordem. A comparação é
> `cabeNaBanda(exposicao, { maximo: tecto })` com a exposição montada por `produtoDeDecimais`
> (`core/ciclo/banda.ts`), na **mesma aritmética exacta** das bandas (inteiros escalados). O tecto lê-se da
> **config que a mesa já lê** (`conta.risco_maximo_por_ordem_pct`).
>
> **A CONTA QUE NÃO O DECLARA NÃO TEM TRAVÃO — e isso DIZ-SE.** O veredicto viaja na decisão
> (`risco_por_ordem.conferido: false`, `tecto: null`) e o **registo** escreve-o na linha do ciclo («risco por
> ordem sem tecto declarado na conta»). A ausência é uma decisão de quem não declarou, nunca um valor por
> omissão — e um tecto declarado e **ilegível** (`2%`, um número de vírgula flutuante) **GRITA**: um limite
> escrito que não morde é pior do que um limite ausente, e não saber não é caber.
>
> **O tecto passou a CHEGAR à mesa.** Medido: a vista que o operador escreve para a mesa
> (`vigia/operador.ts`, `escreverConfig`) levava `eventos_que_avisam`, `arranque_apos_cb` e `fichas` — e **não**
> o tecto. Sem uma linha lá, a chave era declarada na conta e **nunca chegava a quem a lê** (o travão ficava no
> papel). Passa a entrar quando a conta o declara; ausente, a chave não entra e a mesa di-lo no registo.
>
> **A DISTÂNCIA MÍNIMA DE LIQUIDAÇÃO (RN-M4.13) NÃO ENTRA NESTA VAGA — decisão do dono, tomada aqui, e esta é a
> RAZÃO por escrito (para a próxima sessão não reabrir a pergunta).** O desenho dizia «usa o campo
> `distancia_minima_liquidacao_pct` … opcional na mesma medida», mas a boleta **não leva preço nem quantidade**:
> contra que grandeza a distância se compara **não estava fixado**. A decisão: **nesta vaga só o tecto da conta
> entra no ciclo**; o campo fica declarado, e o seu único leitor continua a ser a conferência da resolução
> (`core/ciclo/banda.ts`, comparação 3). O PORQUÊ, que é o que evita a reabertura:
>
> * o **preço de liquidação é um FACTO DO VENUE** — o `liquidationPx` que ele devolve na posição. A mesa **não o
>   lê**: quem o lê é o CONECTOR, na leitura da posição (`brokers/hyperliquid/leitura.ts`: «|marca − liquidationPx| /
>   marca, [C] NOSSA» sobre dois números do venue, e `preco_de_liquidacao` como **[V], nunca recalculado**), e é
>   por ali que ele chega à resolução — onde a conferência 3 o compara. No CICLO não há posição lida nem preço de
>   liquidação: só o mandato, a leitura e a proposta;
> * **aproximá-lo seria uma aproximação não declarada a decidir risco real.** `100/alavancagem` (ou o equivalente
>   `preco × (1 − 1/alavancagem)`) ignora a margem, o preço de entrada e o que a corretora realmente usa — e uma
>   distância mínima é um PISO de risco: comparada contra uma aproximação, ou recusa uma posição que a corretora
>   nunca liquidaria ali, ou **deixa passar** uma que ela liquida. Não saber não é caber (a regra da casa);
> * **e a casa já tem este cálculo, num sítio só e DECLARADO**: `precoDeLiquidacaoProjectado`
>   (`brokers/hyperliquid/conector.ts`), para a resolução que sai **antes** do envio, escrita como [C] sobre um
>   número do venue **[V]** — e **o venue manda quando o publica** (posição lida depois do envio: o cálculo não é
>   usado). Aí a projecção é legítima porque está NOMEADA e porque o dono do número (o venue) pode sobrepor-se
>   a ela. No ciclo, sem venue, nenhuma dessas duas coisas existe.
>
> Enquanto não se decidir de onde vem o preço de liquidação no momento da decisão, o travão da distância fica no
> sítio onde ele TEM o número — e escrever aqui esta razão é o que impede a vaga seguinte de o inventar.
>
> **Casos (6 novos na bancada do ciclo, com os dois controles):** `d015-risco-por-ordem-acima-do-tecto-recusa`
> (exposição 10% contra um tecto de 2% → `nada` com o motivo) com o **par de controle**
> `d015-o-par-de-controle-dentro-do-tecto-abre`; `d015-o-tecto-na-borda-e-dentro-e-abre` (o valor IGUAL ao
> tecto cabe); `d015-sem-tecto-na-conta-nao-ha-travao-e-abre` (a MESMA ordem de 10% que o primeiro recusa abre
> numa conta sem tecto); e o par da **virada** (`d015-virada-acima-do-tecto-recusa` +
> `d015-virada-dentro-do-tecto-vira-numa-so-decisao`).
>
> **Na bancada do travão (8 verificações, dentro do `core/ciclo/provar.ts`):** a comparação é CARGA e não
> enfeite — `1.0000000000000000001` × 1 **passa** o tecto `1` (a vírgula flutuante diria «cabe»), e `0.1` × `3`
> dá exactamente `0.3` (a vírgula flutuante daria `0.30000000000000004`, que recusaria contra um tecto `0.3`); a
> borda é inclusiva; e os **três GRITOS** (tecto ilegível, tecto em número, exposição ilegível) são medidos, não
> afirmados.
>
> **Medido:** `bun run core/ciclo/provar.ts` → **118 verificações · 0 divergentes** (eram 110; **47 de ciclo**,
> eram 41) · `bash tools/preparar-contas/provas.sh` → **13 provas · 0 falhas** (a 13ª é nova: o tecto declarado
> em TEXTO aprova, e um número sem aspas RECUSA com o nome da chave) · `bash tools/verificar-maquina/provar.sh`
> → **37 de 37** (a porta do contrato entrou no mesmo dia: ver abaixo).
>
> **A contradição dos documentos duráveis, corrigida com data.** A tabela da emenda de 28 set
> (`docs/inventario-de-chaves.md` §8) dizia que o `conta.risco_maximo_por_ordem_pct` **sai da mesa** («o limite
> da conta é da corretora»), e o `tools/verificar-config/conferir-config.ts` listava-o entre as **quatro chaves
> retiradas**. O desenho do D-015 decidiu o contrário — o travão é da MESA e o tecto é grandeza da CONTA — e é
> essa a decisão que vale: a chave volta ao conferidor como **opcional** (ausente é legítimo) e com
> `decimal_textual` (o limite não se escreve como número), e a linha do inventário fica com nota datada.
>
> **E UMA SEGUNDA CLASSE DO MESMO DEFEITO, apanhada no caminho e fechada aqui: o valor por omissão escrito como
> TERNÁRIO.** A linha que levava o ambiente à conta — `configDaConta.conexao?.ambiente === "producao" ? "producao"
> : "teste"` (`vigia/operador.ts`) — é a `?? "teste"` do princípio, escrita de outra maneira: uma conta que não
> declarasse o ambiente virava testnet **sem ninguém o decidir**, no sítio que decide a que venue se fala (livro
> da testnet contra velas da produção dá um `mid` contra um preço que não é o do venue onde se opera). Passa a
> ser o que o `mercado.ts` já fazia com a ficha: **a conta que não declara o ambiente NÃO ARRANCA** (morre com o
> valor que veio), e **o registo diz de onde o ambiente veio** (`arranque: "ambiente_declarado"`, com o caminho
> da conta) — o valor sozinho não diz se veio da conta ou de uma omissão nossa.
> **Medido** (contas de prova no sítio da conta, apagadas depois; a árvore voltou ao que estava):
> a conta sem `conexao.ambiente` → `recusado: ... veio undefined — o ambiente viaja em TEXTO e é um de
> teste|producao`; a conta com o ambiente `"producao "` (uma gralha) → `recusado: ... veio "producao "`. As duas
> **antes** de qualquer ordem, de qualquer spawn e de qualquer leitura da chave.
>
> **A CLASSE, decidida por medição (e a catraca dos fallbacks fica a saber-se).** A catraca procura `??`/`||`
> (e, em Python, `or`/`get(k, literal)`) — um ternário com literal por omissão passava por baixo dela. Medido
> sobre o produto inteiro, para decidir se a catraca passa a vê-los: **114** ternários com um literal na ponta
> falsa, dos quais **23** mencionam sequer a ausência (`?.`/`undefined`/`null`) — e a amostra desses 23 é o
> idioma legítimo da casa (`...(x !== undefined ? { campo } : {})`, o objecto que só entra quando há valor). Um
> padrão que reprovasse esses 23 obrigaria a escrever de outra forma código certo — e um portão que grita com
> código certo deixa de ser lido (a mesma razão por que o `or` do Python ficou restrito). **Decisão: o ternário
> não entra na catraca, mas passa a ser CONTADO e LISTÁVEL em cada corrida** (`--ternarios`): o buraco é um
> número que desce (114), não uma frase. E a medição vai ao lado da decisão, no cabeçalho do próprio conferidor.
> **Nota datada — 03/10/2026:** o número moveu-se para **115** (um ternário novo com literal por omissão entrou
> no produto depois desta medição, e é isso que o buraco declarado faz — sobe quando alguém o escreve). O 114
> fica como o que aqui se mediu; o número que vale é sempre o da corrida, `--ternarios`.
> Medido também o `?? null`/`?? undefined` (58 sítios): não é buraco — um `x ?? null` **nomeia** a ausência em vez
> de a substituir por um valor, que é o que a regra pede.
>
> **A PORTA DO CONTRATO ENTROU NO PORTÃO (35 → 36 → 37).** Era ela que comparava o vocabulário fechado nas duas
> direcções e os dois motores caso a caso, e só corria à mão — foi por isso que a deriva do espelho dos motivos
> atravessou uma entrega inteira. Um conferidor que só corre à mão encontra o defeito uma vaga depois de ele
> entrar; dentro do portão, encontra-o no dia. `bash tools/verificar-maquina/provar.sh` → **37 de 37**.

**Declarado em 30/09/2026.** A espec, RN-M4.12: *"O mandato declara também o **risco máximo por ordem**, em
percentagem do saldo (ex.: 2%). Antes de enviar, a mesa calcula a perda implícita — distância do stop ×
exposição — e **recusa** a ordem que a exceda, mesmo que o setup a peça e mesmo que a ficha a permita. É o
travão que nenhuma ordem de corretora nenhuma atravessa."*

**Medido:** em `core/` não existe `risco_maximo_por_ordem`, `perda_implicita` nem `distancia_do_stop` (busca =
0 resultados). O que existe é `core/ciclo/arranque.ts`, que confere `saldo_pct`, `alavancagem` e as `bandas` da
ficha — dimensão, não perda. **Não há, portanto, travão de perda implícita na abertura.**

**Porque isto importa agora, e não é teoria:** o setup do Pine **não tem stop** (a única saída é a viragem), e
o venue **não trava por saldo** — foi medido a 29/09/2026 na testnet: uma ordem mal dimensionada de ~400× o
equity **não foi recusada** e encheu (~10 000 USDC contra ~992 de equity). Sem RN-M4.12, o único travão entre a
mesa e uma posição enorme é o **tamanho** — `saldo_pct × alavancagem`, que a ficha declara.

**Consequência prática, declarada:** na conta real, `saldo_pct` baixo (10%) e `alavancagem` 1 são o travão
inteiro. Não há segundo. Enquanto RN-M4.12 não estiver implementada, isto tem de ser dito ao dono em cada
abertura em conta real — não uma vez.

**Desenho FECHADO (02/10/2026) — e o que falta é código, não decisão.** A espec tinha **duas redacções** desta
regra e elas contradiziam-se: uma exige «perda implícita = **distância do stop** × exposição», e o setup é
**virada de mão pura, sem stop nenhum** — era inimplementável, não era preferência. O dono decidiu: vale a
redacção que **não** usa stop — o mandato limita **exposição (nocional)**, e a **distância mínima até à
liquidação** é travão **opcional da config de risco da ordem** (RN-M4.13: declarada, trava; **ausente é livre**,
porque a ausência é uma decisão de quem não a declarou — e fica **dita**, não presumida).

E o travão é uma **comparação pura** — sem preço, sem equity, sem quantidade. Isto não é um atalho: é o que a
arquitectura dita. A boleta **não leva quantidade** (leva `saldo_pct` e `alavancagem`; quem sabe o volume é o
conector, RN-B5), logo a exposição nocional da ordem é **`saldo_pct × alavancagem`, em % do saldo** — e o tecto
`conta.risco_maximo_por_ordem_pct` está **na mesma unidade**. A equity cancela nos dois lados. Medido: com
`saldo_pct=10` e `alavancagem=1` a ordem pede **10% do saldo** contra um tecto de **2%** → **não abre**. É a
mesma ordem mal dimensionada que encheu ~10 000 USDC contra ~992 de equity, a 29/09.

**Onde entra, e por onde o tecto chega.** No `core/ciclo/ciclo.ts`, junto das outras recusas (antes do ponto 5,
que monta a boleta), com um motivo novo em **`core/estados/motivos.json`** — que é o conjunto **interno** dos
motivos da mesa (`cruzam_a_fronteira: false`, «nasce e morre dentro de um ciclo») e portanto **não exige emenda
ao `vocabulario.json`**. O tecto é grandeza **da conta**, e chega ao ciclo pela **config que a mesa já lê**
(`--config`); **não** pela operação, que cruzaria a fronteira e obrigaria a mexer no `operacao.schema.json` sem
necessidade nenhuma.

**O que falta:** o motivo, o travão no ciclo (abrir **e** `reverse`, que aumentam exposição na mesma ordem), os
casos com controlo na bancada do ciclo (o caso de ~400× o equity tem de ser recusado; o mesmo mandato dentro do
tecto tem de abrir), e a prova no portão.

**O ENCAIXE, medido a 02/10/2026 — para o código entrar sem uma única descoberta nova:**

1. **Metade do campo já existe.** O tipo `Mandato` (`core/ciclo/decisao.ts:21`) **já declara**
   `distancia_minima_liquidacao_pct?: string` — opcional, que é exactamente o estatuto que o dono decidiu
   (declarada trava; ausente é livre). **Ninguém o lê.** Do lado da exposição não há campo nenhum: a
   comparação é contra o tecto da CONTA.
2. **A comparação reutiliza o comparador da banda.** `cabeNaBanda(valor, {maximo})` (`core/ciclo/banda.ts:156`)
   já compara em decimais escalados **e já devolve `dentro` quando a banda não está declarada** — «ausente =
   não há limite a aplicar», que é o princípio do dono. Não se escreve comparador novo.
3. **A config está em mão onde a entrada do ciclo nasce.** `core/ciclo/relogio.ts:191` já faz
   `const mandato = (config.fichas as Record<string, Mandato>)[instrumento]!` e `:240` chama o
   `decidirInstrumento`. O tecto lê-se do mesmo `config`, à maneira do `margem_total_maxima_pct` (que o
   `arranque.ts:278` lê como `config.margem_total_maxima_pct`, embutido do `conta.*` pela configuração) — e
   passa na `EntradaDoInstrumento` (`core/ciclo/ciclo.ts:20`), que é **interna ao processo da mesa** e por isso
   **não** cruza fronteira nenhuma.
4. **A conta real NÃO declara o tecto.** Medido em `config/contas/hl-teste-plugin.json`:
   `risco_maximo_por_ordem_pct` **AUSENTE**. Consequência imediata e prevista pela decisão do dono: nesta
   corrida o travão **não actua** — e isso tem de ficar **dito** (é o mesmo estatuto da distância de liquidação:
   a ausência é uma decisão de quem não declarou, não um valor por omissão). Quem quiser o travão declara-o na
   conta; quem não o declarar está a dizer, com a ausência, que aceita a exposição.
5. **O formato dos casos** (`core/ciclo/ciclo.casos.json`, 41 casos): `{nome, leitura:{instrumento,
   idade_do_dado_ms, estado_do_mercado, equity, ordens_abertas}, proposta:{lado,...}, ficha:"3232", ciclo,
   decisao_esperada:{acao, motivo, condicao, avisa, boleta}, historico}`. O controlo negativo é o par: o mesmo
   mandato **dentro** do tecto tem de continuar a abrir (`acao: "abrir"`), senão o travão estaria a travar tudo.

---

## D-016 — a leitura ao vivo nao traz a posicao (e sem ela o setup do Pine nao abre)  *(RETRATADO, 30/09/2026)*

> **RETRATACAO — 30/09/2026, medida.** Este defeito era FALSO e a culpa e' minha: escrevi-o a partir de
> leituras onde a posicao nao aparecia, sem medir **porque**. Medido agora: `brokers/hyperliquid/leitura-do-mercado.ts:276`
> e' o **unico** sitio que emite `mercado`, e **publica a posicao** quando ela existe. A razao de nao a ver era a
> mais simples de todas: **a conta de teste estava PLANA**. Nao havia posicao para publicar. E o contrato di-lo
> sem margem: `mercado.posicao` — *"Ausente = sem posicao"*. Nao ha nada a ligar; ha um plugin a corrigir — e
> foi corrigido (o setup tratava a ausencia como duvida e agora trata-a como plano).
>
> O que **sobra** e' verdadeiro e fica dito: quando ha posicao, ela vai **sem marca** (a marca vive no `cloid`
> da ordem), e e' isso que o mapa de posse (RN-T16.1, D-008) tem de resolver. O texto original fica abaixo.

**Declarado em 30/09/2026.** O contrato TEM o campo (`mercado.posicao`: lado, unidades, preco_medio,
marca_de_posse) e o produtor `brokers/hyperliquid/leitura-do-mercado.ts` **ja' o publica**. Mas o caminho
**ao vivo** (`brokers/hyperliquid/processo.ts`, que e' o que o operador consome) **nao o emite**: as leituras
medidas trazem instrumento, tempo, idade, estado, equity, bid, ask, ultimo — e mais nada.

**Porque e' bloqueante para o primeiro setup:** o indicador do dono nao tem estado plano nem aumentos. Para
propor um lado e' preciso saber se ja' estamos nesse lado; sem a posicao, o setup `sigma` propoe `hold` e di-lo
("sem saber se ja' estou dentro, abrir seria empilhar"). E' deliberado: abrir as cegas por cima de uma posicao
viva e' empilhar, e a alternativa — adivinhar — era pior. **Enquanto este campo nao viajar ao vivo, o plugin
do Pine nunca abre.**

**O que falta:** ligar a posicao da conta a' mensagem `mercado` do modo ao vivo, reutilizando
`leitura-do-mercado.ts` (que ja' a sabe montar) em vez de a reescrever.

---

## D-017 — o operador espera para sempre por uma leitura que nao vem — **FECHADO** (03/10/2026: com caso no portão e prova negativa)

> **FECHADO — 03/10/2026.** O limite de espera **existe** (`LEITURAS_INUTEIS` voltas sem leitura para os pares
> ligados → a operação é **escrita** com o que existe, os pares sem leitura entram `sem_leitura` com o motivo no
> `erro_do_setup`, e o processo **termina**) e passou a ter **prova no portão**.
>
> **A costura que faltava, e que foi feita com nome:** o operador **fixava o comando do conector no código**, e
> não havia conector de mentira que se lhe apontasse — a prova só contra a conta de teste depende da rede e gasta
> o orçamento de leituras ao venue para medir uma regra que é deste lado. Passou a existir
> **`--conector <ficheiro>`** (`vigia/operador.ts`), usado **só pela bancada** e **dito em voz alta** quando é
> usado (`veredicto: "conector_substituto"`), para nenhuma corrida a sério se poder ler como se tivesse falado
> com o venue.
>
> **Prova:** `bun tools/verificar-maquina/operador-nao-espera.ts` → **6 verificações · 0 divergentes**, dentro do
> `provar.sh` ("operador: o prazo por leitura que nao vem (D-017)"). A bancada escreve um conector falso que lê
> **outro** instrumento (o `ADA`, que a conta não tem) e uma ficha **ligada** de `SOL` — a cena exacta do defeito
> — e exige: o processo **termina sozinho** (257 ms, não os 25 s do limite), o veredicto é `prazo` com o número
> das leituras inúteis, e a operação fica escrita, `ligacao: "sem_leitura"`, com o `SOL` presente e **sem**
> `leitura`. Sem rede, sem venue, sem chave.
> **Prova negativa:** `bash tools/verificar-maquina/prova-negativa-do-operador.sh` — reposto o defeito (a guarda
> do prazo morta), a bancada fica **vermelha a NOMEAR o caso** (`D-017: o operador TERMINA sozinho …
> terminou_sozinho=false · 25025 ms`) e o ficheiro volta pelo `sha256`.
>
> **O que a bancada NÃO prova, dito no cabeçalho dela:** que o operador corre contra o venue a sério. Essa metade
> é da corrida viva — a de 03/10/2026 entregou leitura dos **três** pares em **7173 voltas** e nunca chegou ao
> prazo (é a retratação do D-020, logo abaixo).

**Declarado em 30/09/2026.** Medido: com uma ficha ligada (`run: true`) cujo instrumento a conta do conector
nao le — o caso do SOL na conta de teste, que declarava so' BTC — o operador fica a' espera
**indefinidamente** e nao escreve operacao nenhuma. Duas corridas de 240 s cada, sem ficheiro.

**Porque e' um defeito e nao uma espera legitima:** os outros pares ficam sem operacao escrita por causa de um,
e o dono nao distingue "ainda nao chegou dado" de "nunca vai chegar". A leitura em falta tem nome no contrato
(`sem_leitura`, RN-D7) — o operador devia escreve-la, com o motivo, em vez de silencio.

**O que falta:** um limite de espera por par ligado; passado ele, a operacao e' escrita com os pares que tem
leitura e os outros entram sem `leitura` (o mesmo caminho do ETH na prova do multipar).

---

## D-018 — o conector nao pega um instrumento acrescentado ao mandato — **FECHADO** (03/10/2026: o manifesto acompanha as fichas)

> **FECHADO — 03/10/2026.** A causa estava no manifesto publicado no arranque: um instrumento acrescentado ao
> mandato **depois** de o processo nascer não tinha unidade declarada, e a leitura dele morria em
> `unidadeDo(manifesto, ...)`. Passou a haver `manifestoParaInstrumento` (`brokers/hyperliquid/manifesto.ts`),
> que devolve o do arranque **ou um reconstruído** do mandato em vigor — o conector deixou de precisar de
> reiniciar para pegar um par novo.
>
> **A prova, e ela está no portão:** `bun run tools/verificar-conector/manifesto-acompanha-as-fichas.ts` →
> **8 verificações · 0 divergentes · 1 instrumento ligado a quente traduzido** (dentro do `provar.sh`, "manifesto
> acompanha as fichas (quente)"). E a corrida viva confirma-o do lado de fora: a operação de 03/10/2026 traz
> leitura dos **três** pares (BTC, ETH, SOL — ver a retratação do D-020 logo abaixo).


**Declarado em 30/09/2026, com o sintoma exacto.** A ficha da conta de teste foi editada de
`conta.instrumentos = ["BTC"]` para `["BTC","SOL"]` (para o setup do Pine poder decidir sobre SOL ao vivo), e a
ficha foi lida: `conta.instrumentos = ['BTC','SOL']` (conferido). Mas o arranque do conector continua a
reportar **`1 instrumento(s) com unidade declarada`** e **nao emite leitura nenhuma de SOL**: duas corridas ao
vivo do operador (240 s e 260 s) terminaram sem operacao escrita, e o processo, corrido a' mao, fecha com
`{"etapa":"fim","atendidas":0}`.

**O que ja' se sabe:** a unidade do instrumento vem do **manifesto da sonda** (`unidadeDo(manifesto, ...)`,
`conector.ts:801`), e o manifesto e' publicado no arranque a partir da lista do mandato — logo ou a lista nao
chega ao manifesto, ou o instrumento e' filtrado por nao ter unidade. `SOL` nao aparece declarado em
`contracts/gerado/` nem nos exemplos do conector.

**O que falta:** medir qual dos dois e' (um `grep` no manifesto publicado resolve), e por o SOL a viajar.

**Porque isto bloqueia o primeiro setup:** o plugin do Pine corre em SOL. Sem leitura de SOL, o circuito ao vivo
nao fecha neste par — e' a ultima peca entre o plugin provado e a primeira ordem.

---

## D-019 — o operador engolia o diagnostico do conector (e foi por isso que fiquei cego)  *(FECHADO, 30/09/2026)*

**Declarado e fechado no mesmo dia.** O operador recolhia as linhas de porta do conector (para escrever o
ficheiro das portas) e **descartava todas as outras**: o `catch` do handler dizia, textualmente, *"linha que
nao e' do diagnostico: nao se imprime (o operador nao e' o log do conector)"*. Com o conector a arrancar (as 8
portas passam, medido) e a **nao entregar leitura nenhuma**, o log do operador ficava com uma linha so' — e a
razao, que o conector provavelmente disse, era deitada fora no mesmo processo.

**O que custou:** uma noite de tentativas cegas — a ficha da conta, o instrumento, o venue, as velas e as
portas foram todos medidos e estao bons; o motivo de nao haver leitura nao se soube, porque ninguem o guardou.

**Correcao:** o handler passa a imprimir tudo o que o conector diz e nao e' porta, com o prefixo `[conector]`.
Uma peca que fala e nao e' ouvida nao e' uma peca de um sistema: e' uma caixa.

---

## D-020 — o modo ao vivo do conector arranca e nao entrega leitura — **RETRATADO** (03/10/2026: medido, entrega)

> **RETRATADO — 03/10/2026, com a medição na mão.** O sintoma **morreu**: o conector entrega leitura, e os
> **três** pares são lidos na corrida de observação da conta de teste. Medido no que a corrida deixou:
>
> - `mercado/velas-*.jsonl` — a operação escrita pelo operador `operacao.json`, `ligacao: "ligada"`, com os
>   **três** instrumentos e cada um com a sua `leitura` e o seu `tempo_do_venue_ms` (BTC, ETH, SOL);
> - o registo do operador (`operador.log`, 7173 voltas): **1085 linhas de BTC, 1085 de ETH e 1095 de SOL**, com
>   `bid`/`ask` reais em cada uma (ex.: BTC `84808.0/84810.0`, ETH `2677.2/2677.3`, SOL `119.89/120.14`), e o
>   setup a falar em cada leitura;
> - o fim da corrida é `{"etapa":"operador","veredicto":"fim","voltas":7173}` — o processo **terminou por
>   limite de voltas**, não por ausência de leitura.
>
> **O que isto NÃO diz:** que o sintoma nunca existiu — existiu, e o retrato dele fica por baixo, com a data em
> que foi medido (30/09/2026, 02:10). O que mudou entre os dois é o que o **D-019** fechou (o operador passou a
> ouvir o conector) e a correcção do `--leitura-a-cada` para 10 s. **Um defeito retratado não é um defeito
> esquecido**: fica escrito o que o fechou.
>
> **Nota de 03/10/2026, medida agora:** a corrida em observação **já terminou** (o último `operacao.json` é das
> 08:36 UTC e o registo fecha em `fim`). Em execução está só o painel. O trabalho desta vaga não tocou em nenhum
> deles.


**Declarado em 30/09/2026, 02:10.** Medido, com tudo o resto confirmado bom:

* o venue responde: conta (`accountValue 989.822633`), livro do BTC (`levels` com precos reais) e velas (a
  `candleSnapshot` devolve barras) — os tres, por `curl` directo;
* o arranque do conector passa as 8 portas e escreve `{"passam":true,"porta":null,"motivo":null}`;
* as velas existem onde o setup as procura (`velas-BTC-1h.jsonl`, 505 barras; idem SOL);
* e o conector **nao emite uma unica linha `mercado`** — nem com `--leitura-a-cada 6000`, nem com 60000, nem
  com o stdin aberto por um `sleep` ao lado. O arranque de ha' uma hora, nas mesmas condicoes, entregava
  leitura (equity 989.822633, bid, ask — medido e usado em varias provas desta sessao).

**O que muda daqui para a frente:** com o D-019 fechado, o conector passa a ser ouvido. O primeiro passo e'
repetir a corrida e **ler o que ele diz** — e nao voltar a tentar as cegas.

---

## D-021 — a mesa le a operacao UMA VEZ, e por isso o relogio da ficha nao a trava — **FECHADO** (03/10/2026, com caso no portao)

> **FECHADO — 03/10/2026, no portao.** O codigo ja' tinha as duas metades: (a) a mesa **rele^ a operacao a cada
> volta** do relogio (`core/servidor.ts`, `lerOperacao` dentro do `setInterval`) e (b) o **travao da barra** do lado
> de quem aperta o gatilho (`entrada_ja_feita_nesta_barra`, semeado do registo no arranque). O que faltava era a
> prova de que a (a) e' verdadeira **em processo** — e ela entrou na bancada da orfandade: com a mesa orfa e a ciclar,
> **tira-se a `leitura` do ficheiro de operacao** e as voltas seguintes passam a decidir `nada` pelo motivo
> `leitura_ausente_no_ciclo`. Uma mesa que lesse a operacao uma so' vez (o defeito medido: 44 ciclos sobre o MESMO
> retrato) continuaria a decidir sobre a leitura que ja' nao esta' no ficheiro, e a prova reprovava.
> **Como se corre:** `bash tools/verificar-maquina/vigia.sh --orfandade` (a verificacao chama-se
> `orfandade/D-021: a mesa RELE^ a operacao - tirar a leitura do ficheiro muda a decisao seguinte`).

**Declarado em 30/09/2026, medido em operacao.** O setup passou a propor **uma vez por barra fechada** (o
relogio da ficha manda na entrada) — e isso esta' provado: em 4 voltas do operador, **1 proposta**. Mas o
registo mostra a mesa a decidir `abrir` **em todos os ciclos**: `CICLO SOL: abrir x3` em 3 ciclos.

**A causa, lida no codigo:** `relogio.ts` le a operacao **uma vez**, no arranque (`lerOperacao(...)`, com o
comentario a dize-lo: "a operacao nao muda debaixo dos pes do processo (e lida uma vez)"). O ficheiro e' reescrito
pelo operador a cada volta, mas a mesa fica com o primeiro — o que tinha a proposta. O silencio do setup nas
voltas seguintes nao chega a' mesa, e o travao por barra nao existe do lado de quem decide.

**Porque isto e' grave se a mao fechar:** com o envio ligado, `abrir` a cada ciclo e' uma posicao nova a cada
minuto — exactamente as 731 de ontem, agora com nome. A regra "uma entrada por barra" tem de existir **na mesa**,
que e' quem aperta o gatilho, e nao so' no setup.

**O que falta:** a mesa (a) reler a operacao a cada volta, ou (b) guardar o instante da ultima entrada por
instrumento e recusar uma segunda na mesma barra. A (b) e' a que não depende do ficheiro estar fresco — e e' a
que fica: o travao do lado de quem manda.

---

## D-022 — `posicao_pct: "1"` num FECHO — **FECHADO pela via (A)**, 03/10/2026

**Encontrado na auditoria de 03/10/2026. O dono mandou avançar e a via escolhida foi a (A) — o FECHO lê a
posição VIVA.** A contradição era real e vale a pena guardá-la: o campo `posicao_pct`, no contrato, dizia duas
coisas ao mesmo tempo — «`1` é a posição INTEIRA» e «é o valor de uma ordem que NÃO é uma redução parcial». O achado tem o número que
o torna real — e o número diz também que, hoje, **não há dano nas posições que existem**, o que é precisamente o
que faz o defeito passar despercebido.

**A contradição, dentro do próprio contrato.** `contracts/boleta.schema.json`, no campo `posicao_pct` (1.11.0):
«*`1` e' a posicao INTEIRA, e e' o valor de uma ordem que NAO e' uma reducao parcial*». As duas metades desta
frase pedem coisas diferentes quando a ordem é um **fecho**:

- **(A) «a posição INTEIRA»** ⇒ a quantidade do fecho é a **posição viva** (lida do venue), como no caminho da
  fracção — `posicao_pct × posicao_viva` com `posicao_pct = 1` dá exactamente a posição;
- **(B) «não é parcial»** ⇒ é o caminho de hoje: a quantidade sai do **`saldo_pct`**
  (`saldo_pct% × equity × alavancagem / preço`, ajustada ao passo por baixo) e a **posição viva não é lida**.

Medido no código: `core/ciclo/ciclo.ts` declara **`const posicao_pct = "1"`** para **todo** fecho (nenhum setup
emite redução parcial), e `brokers/hyperliquid/ordens.ts` trata `posicao_pct === "1"` como **não-parcial** — o
ramo que lê `pedido.posicao_viva` só corre com `posicao_pct < 1`. Logo hoje vale **(B)**, e o fecho de um
`caixa` fecha uma fatia do saldo, **não** o que está aberto.

**A medição (o tradutor real, importado por caminho absoluto; posição e equity lidos do ficheiro da operação da
corrida de risco, equity `991,99`):**

| instrumento | posição viva | qtd que o fecho emite **hoje** | resíduo | a ½ (`posicao_pct: 0.5`) |
|---|---|---|---|---|
| BTC — `saldo_pct` 10 · passo 0,00001 | 0,00116 | 0,00116 | **0,000000 (0,00%)** | 0,00058 |
| ETH — `saldo_pct` 1,1 · passo 0,0001 | 0,004 | 0,004 | **0,000000 (0,00%)** | **RECUSA** `minimo_do_instrumento_acima_da_banda` |
| SOL — `saldo_pct` 10 · passo 0,01 | 0,82 | 0,82 | **0,000000 (0,00%)** | 0,41 |

**As duas leituras coincidem hoje nas três posições** — porque todas foram abertas pela mesma fórmula, ao mesmo
equity e a um preço vizinho. **Divergem assim que o preço andar** (varrendo o preço com o código real):

| instrumento | sobra resíduo (o fecho não fecha tudo) | **o fecho excede a posição** → o venue recusa o `reduce_only` |
|---|---|---|
| BTC | a partir de **+0,65%** (0,00115; sobra 0,00001) | a partir de **−0,22%** (0,00117 > 0,00116) |
| ETH | a partir de **+1,96%** (0,0039; sobra 0,0001) | a partir de **−0,54%** (0,0041 > 0,004) |
| SOL | a partir de **+1,06%** (0,81; sobra 0,01) | a partir de **−0,17%** (0,83 > 0,82) |

**A consequência, dita nos dois sentidos.** A fatia a menos deixa **resíduo aberto** — o par não fica plano, o
setup acha que está fora e a mesa fica com uma posição que ninguém decidiu manter. A fatia a mais é o caso caro:
com `reduce_only`, o venue **não deixa reduzir mais do que existe** e a ordem é **recusada** — o fecho **não
acontece**, e a posição fica toda aberta. É maior nos relógios longos (1h/4h), onde o preço anda muito entre a
abertura e o fecho.

**As duas saídas — e o dono escolhe:**

- **(A) `1` = a posição inteira.** O fecho passa a exigir a posição viva (como a fracção) e a quantidade é
  `posicao_pct × posicao_viva`. Fecha tudo, sempre; e o `saldo_pct` deixa de mandar em qualquer fecho. Custo: o
  caminho do fecho passa a depender de uma leitura do venue (sem ela, recusa — o que já é o comportamento da
  fracção, `reducao_parcial_sem_posicao_viva`);
- **(B) `1` = «não é parcial» (como hoje).** O fecho continua a ser um pedaço dimensionado pelo `saldo_pct`, e a
  letra do contrato corrige-se («`1` é o valor de uma ordem que não é redução parcial» — e nada mais). Custo: um
  `caixa` deixa de garantir plano, e num `reduce_only` acima da posição a ordem é recusada.

**O que fecha este defeito.** A decisão do dono, escrita — e, com ela, o caso que a mede: um fecho com
`posicao_pct: "1"`, **posição viva diferente da fatia do saldo**, com o par de controlo (`posicao_pct: "0.5"` a
sair pela posição viva, que já é o comportamento de hoje) e a prova negativa do lado que se estragar. Não se toca
em código antes disso: **mudar isto muda o volume dos fechos**, e isso não é de quem audita.

