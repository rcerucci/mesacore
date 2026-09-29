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

## D-004 — A constante de destino não cabe no contrato de hoje

**O que devia acontecer.** A ordem diz **para que conta** vai: o plugin serve várias, carrega as constantes
de todas no arranque, e a escolha tem de vir nomeada — um alias que ele resolve na tabela que carregou.

**O que há.** Medido em 28 set 2026, e a medição é o defeito:

```
$ python3 -c "import json;print(list(json.load(open('contracts/boleta.schema.json'))['properties']))"
14 campos — nenhum nomeia conta, corretora ou constante
$ python3 -c "import json;p=json.load(open('contracts/proposta.schema.json'));print(p['required'],list(p['properties']))"
['setup', 'lado'] ['setup', 'lado', 'relogio']
```

O **setup** não pode escolher a conta: a proposta tem três campos e é fechada — uma constante vinda dele
seria recusada com `campo_desconhecido`. (Isto é a fronteira a funcionar, não um defeito.) E a **boleta**,
que é onde a constante teria de viajar, não tem campo para ela — o esquema é fechado, logo acrescentar campo
é **subir a versão do contrato**.

**A consequência.** Hoje o destino só pode ser **implícito**: ou o processo serve uma conta (o que a mesa
declara em `conta.corretora`/`conta.identificador`), ou o plugin adivinha. Um plugin multi-conta sem
constante nomeada teria de escolher a conta por conta própria — e escolher a conta é decidir risco, que é
exactamente o que o plugin não faz.

**Onde se conserta.** No recorte do **conector**, e a decisão é do dono (`docs/regra-de-negocio.md`,
«Emenda do dono — o plugin da corretora e a constante do destino»): **(A)** a constante viaja na boleta
(campo novo, versão nova, e a mensagem diz para que conta foi) ou **(B)** a ligação é a conta (nada muda no
contrato, e a atribuição por conta fica presa ao processo que escreveu a linha).

**Como se saberá que está fechado.** Com o par de controle: (a) uma boleta com a constante de uma conta e o
plugin a executar **naquela** conta (e não noutra que também tem o instrumento); (b) a mesma ordem com a
constante de outra conta, e o resultado a ir para a outra. Sem a metade (b), "foi para a conta certa" podia
ser coincidência de haver só uma conta ligada.
