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

## D-001 — A banda do mandato não é conferida em lado nenhum

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

## D-002 — As três obrigações do conector não têm casa no manifesto

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

## D-003 — A fila da contenda não tem hora de chegada no arranque

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

## D-006 — A tabela trata «não sei» como «não há»

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

## D-007 — A recusa por liquidação em curso não é alcançável pela porta (declarado 29/09/2026)

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

## D-008 — As bandas do mandato têm leitores a menos, e duas chaves das regras não existem (declarado 29/09/2026)

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

## D-009 — A idempotência declarada no manifesto não é a do venue (declarado 29/09/2026)

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

## D-010 — A alavancagem que a boleta pede nunca é pedida ao venue (declarado 29/09/2026)

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

## D-011 — A boleta pede stop e o stop não sai: o conector aceita e não lê (declarado 29/09/2026)

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

## D-012 — O tipo `limite` é inalcançável neste venue (e o `destino_do_resto: cancelar` não tem verbo) (declarado 29/09/2026)

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
