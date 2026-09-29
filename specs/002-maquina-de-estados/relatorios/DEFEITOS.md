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

## D-005 — A fronteira vigia ↔ mesa não tem mensagem no contrato

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
