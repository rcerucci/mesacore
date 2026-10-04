# A web do MesaCore — plano e resultado (medido, 03/10/2026)

## O que estava medido, antes de tocar em nada

| facto | medido |
|---|---|
| a unit servia a corrida ERRADA | `servir.sh:26` tinha por omissão `scratch/corrida-de-risco` (parou às 05:36); o teste vive em `scratch/teste-de-auditoria` |
| prova | o `vivo.json` dizia `corrida: …/corrida-de-risco`, equity **992,32**, `relógio 1h`; a corrida viva tem equity **991,58** e relógios **30m/30m/1m** |
| a tela era um ficheiro | `web/painel/index.html` = **1784 linhas**, 108 KB |
| o retrato era de UMA corrida | `retrato.ts` recebia `--corrida <dir>` (uma) e construía **1 mesa / 1 conta** — embora o fio já fosse uma LISTA (`registo_de_mesas: []`, `mesas: []`) |
| o registo da corrida viva | 97 linhas · 96 ciclos · 24 ciclos do ETH em `proposta_sem_lado_a_executar` |

## O que ficou feito, e como se prova

### 1. O painel deixa de servir a corrida errada — e diz qual serve, e há quanto tempo

`retrato.ts` aceita **N `--corrida`** (repetível) e, sem nenhuma, **descobre** as corridas VIVAS sob a raiz
(`operacao.json` reescrita há ≤ 300 s; sem nenhuma viva, cai na mais recente). A fita passou a mostrar a
**instalação**, a **corrida**, a **idade da operação** e a **idade do retrato**, com um **seletor** (Geral + uma
entrada por instalação).

**Medido** (descoberta, sem `--corrida`):

```
instalacoes (descobertas vivas: operacao.json escrito ha' <= 300 s):
  teste-de-auditoria · hl-teste-plugin · …/teste-de-auditoria
    mesa: estado em_operacao · 99 ciclos em 100 linhas · operacao lida ha' 0 s
```
e a fita, lida do DOM: `Corrida: teste-de-auditoria · Operação: há 10 min · Equity 991,58 USDC`.

### 2. Posições e ordens vivas no topo, e o que está PARADO
<!-- REVISTO NA §8: os blocos com frase foram substituídos por TABELAS e por uma MATRIZ DE ESTADO; o `#vivas`
     agrega hoje as duas tabelas (posições, ordens) e a coluna TRAVA da matriz. O `selo de urgência` deu lugar à
     `atenção` calculada na barra. O que se mantém: a ORDEM de urgência e o motivo traduzido no `title`. -->

Um bloco novo (`#vivas`, `js/posicoes.js`) mostra, por ordem de urgência: **posições vivas** (lado, unidades,
preço de entrada, marca de posse, e a decisão da mesa), **ordens em aberto** (lado, tamanho, preço, oid) e **o que
está parado** — com o motivo EM PORTUGUÊS e há quantos ciclos/desde quando. A cabeça do bloco leva um **selo de
urgência** («há algo vivo» / «nada exige atenção» / «mesa parada»), para responder aos 5 segundos mesmo recolhida.

**Medido** (DOM, corrida viva): `1 pos · 0 ord · 3 parados` ·
`COMPRADO ETH 0.004 @ 2675.3 · marca 28 · decisão: nada (o setup propôs, mas sem lado a executar)` ·
`BTC: o setup não propôs nada nesta volta (espera) — há 33 ciclos · desde 10:56:55 (46 min)`.
O motivo cru (`proposta_ausente_tratada_como_hold`) viaja no `title` — a tradução não esconde a prova.

### 3. N plugins — a tela do SISTEMA, e não a do sigma
<!-- REVISTO NA §8: em «Geral» a bancada deixou de ser ESCONDIDA (isso era resto de landing page): as tabelas
     agregam TODAS as instalações (a linha passa a `instalação · par`) e o gráfico continua no par escolhido. -->

O fio ganhou `instalacao` em cada mesa, `plugins[]` (um por setup, com as instalações e os pares onde corre) e
`geral` (posições/ordens/parados agregados). O front ganhou o seletor; em **Geral** a bancada dá lugar à vista
geral (instalações + plugins + tudo o que está vivo).

**Medido** (modo Geral, DOM): `HÁ ALGO VIVO 4 POS · 0 ORD · 5 PARADOS`, 2 cartões de instalação + 1 de plugin
(`sigma 0.1.0 · typescript · publica série · 6 pares`), a bancada escondida (`display: none`).

### 4. A estrutura: um módulo por responsabilidade

`index.html` passou de **1784 linhas de HTML+CSS+JS** para **HTML+CSS** com um `<script type="module">`, e nove
módulos em `web/painel/js/` (zero pedido externo — tudo servido do mesmo sítio):

| módulo | responsabilidade |
|---|---|
| `nucleo.js` | a cor (do tema, com o normalizador do `color-mix`), os formatos, o ESTADO, o que recolhe, os motivos ditos |
| `fita.js` | a fita do topo: instalação/corrida/idades/seletor |
| `posicoes.js` | o que está vivo: posições, ordens, o que trava, a vista geral |
| `pares.js` | a lista de pares (principal + detalhe, recolhíveis) |
| `grafico.js` | as velas × a série, as marcas, a leitura do setup, a janela visível |
| `dentro.js` | posição/mercado, risco em vigor, decisões do par |
| `registo.js` | o ledger: ciclos, mandato, carteiro, o que saiu, as faltas |
| `configuracao.js` | a vista da ficha (leitura) e o caminho de escrita (compor→validar→escrever) |
| `telefone.js` | a barra fixa do telefone |
| `arranque.js` | os dois relógios, as vistas, o layout, o ponto de encontro (`redesenho`) |

### 5. O gráfico: o spike (números medidos)

| | `lightweight-charts` (o nosso) | `@luxalgo/vela` 0.8.1 |
|---|---|---|
| ficheiro de browser | `lightweight-charts.standalone.production.js` | `dist/vela.global.min.js` |
| **peso bruto** | **197 922 B** | **980 356 B** (4,95×) |
| **peso gzip −9** | **62 150 B** | **276 522 B** (4,45×) |
| formato das barras | `{time, open, high, low, close}` | `{time, open, high, low, close, volume?}` |
| **obriga a mudar o NOSSO formato?** | **não** — adaptador de 1 linha de `{t,o,h,l,c,v}` (segundos) | **não** — o MESMO adaptador, com `time` em ms |
| desenhou as nossas barras? | **sim** — medido: canvas 734×399 com **292 866 px opacos** (desktop) e 304×157 com **47 728** (telefone); velas visíveis nas duas capturas | **não** — montou (`market.data`, 1010 barras), WebGL2 disponível, mas `ready()` **nunca resolve** e a área fica VAZIA (só a barra de ferramentas e o logomark) |
| licença | Apache-2.0 | core Apache-2.0, mas o motor PINE (`@luxalgo/vela-pinets` + `pinets`) é **AGPL-3.0-only**, e o `NOTICE` **exige atribuição visível em cada ecrã** |

**Peso na LAN, medido por CDP** (`Network.loadingFinished`, o que passa pelo fio na abertura do painel):

```
painel — total 6 379 822 B
   5 859 493  painel.json
     198 073  lightweight-charts.standalone.production.js
      55 174  vivo.json (×3, o ciclo de 2 s)
      30 706  index.html   + 9 módulos (~99 KB somados)  + 4 KB de tema
spike Vela — total 1 096 398 B
     980 507  vela.global.min.js
     113 150  bars.json  (as MESMAS 1010 barras)
```

**A conclusão que os números dizem:** a biblioteca NÃO é o gargalo da LAN — o NOSSO fio é (5,86 MB num retrato).
A diferença entre as duas bibliotecas (783 KB brutos) é **7,5× menor** do que o `painel.json` sozinho. Trocar de
biblioteca (a) não melhora o peso de forma que se note, (b) custa um projeto de integração (o caminho offline do
Vela não pintou no spike), (c) traz uma obrigação de atribuição em cada ecrã e, para o PINE, uma licença AGPL.
**Recomendação: ficar com o `lightweight-charts`** — e, se o peso incomodar, atacar o fio (a série e as velas
repetidas no `painel.json`), que é onde estão 92% dos bytes.

### 6. A verificação

- **`provar.sh`: 39 de 39 passaram** (a web não quebrou o portão).
- **DOM medido no Chrome headless** (CDP, aba visível): **0 erros**, **0 excepções**, **0 `console.error`**;
  gráfico **pintado** (px opacos > 0) nos dois ecrãs; **nenhum transbordo horizontal** (fora da faixa de pares
  do telefone, que é um *scroller* por desenho); **nenhum alvo de toque < 44 px** no telefone.
- **Capturas lidas com visão** (desktop, telefone, Geral), antes de declarar fechado — foi essa leitura que
  apanhou a ordem dos blocos no telefone e os parágrafos em maiúsculas.
- Defeitos apanhados a medir e corrigidos nesta fatia: a fita a transbordar 36 px no telefone; a fita pegajosa
  a ocupar 354 px (42% do ecrã) e a empurrar o gráfico para fora da dobra; o painel «lado de dentro» a alargar
  27 px (motivo longo numa coluna estreita); as velas a colapsarem numa linha (1009 barras em 372 px — a janela
  visível passou a ~70 no telefone e ~160 no computador); a cabeça do «o que está vivo» sem o par.

### 7. O que continua de fora (dito, e não escondido)

- **A unit do painel tem de ser reiniciada** para o `servir.sh` novo (a descoberta) entrar em vigor: o processo
  que corre carregou o `servir.sh` velho e continua a pedir `--corrida corrida-de-risco`. É mudança de host →
  vai ao `sysadmin` com a especificação, e a prova é `systemctl --user is-active` + a fita a dizer
  `teste-de-auditoria`.
- **O sistema em observação MORREU** (a máquina reiniciou a meio desta sessão: a sessão GNOME tinha 3 min de vida
  e os processos operador/conector/feed/mesa já não existiam). Não foi esta sessão. A tela diz a idade, e é por
  isso que ela agora mostra `operação: há 20 min` em vez de fingir que é agora.
- **`web/painel/painel.json` e `vivo.json` não são versionados** (estão no `.gitignore`) — o spike correu sobre
  uma cópia em `scratch/painel-teste/`, com o servidor próprio na porta 8799, para não escrever no fio da unit.

## 8. O REDESENHO — a crítica do dono (03/10/2026)

> «isso não é um dash board, é uma landug page, ta uma bosta»

A crítica era justa e tinha número: a primeira entrega gastava o ecrã em **8 cabeçalhos de secção com slogan** e em
parágrafos («o livro não aparece aqui, e é uma falta com nome: …»), e o que é vivo — o gráfico e as posições —
ficava em segundo plano. Foi refeita com olhos de terminal: **uma barra de estado, três colunas densas e a matriz a
substituir as frases.**

### O que mudou, e o que se ganhou

| antes | agora |
|---|---|
| 8 cabeçalhos de secção + parágrafos de explicação | **4 cabeçalhos de tabela** (9,5 px, caixa alta); o que era parágrafo virou **coluna** (`TRAVA` com o código e o texto no `title`) |
| cartões de par com título, frase e três camadas | **matriz de pares**: uma linha de 21 px por par (par · preço · lado) |
| «o que está parado, e porquê» em blocos de 3 linhas | **matriz de estado** no rodapé: par · lado · rodar · enviar · **trava** · ciclos · travado desde |
| posições/ordens em blocos com frase | **duas tabelas densas** (par · lado · tam · entrada · marca · decisão) |
| a corrida era um número entre outros | a corrida é **o título** da barra (13,5 px) e o produto virou etiqueta |
| «mesa parada» / «há algo vivo» (selo de urgência) | **`atenção` calculada**: `sem dados há X` (vermelho) › `N falta(s)` (vermelho) › `N travado(s)` (neutro — num sistema em observação travar é o estado NORMAL, e gritar sempre é o mesmo que não gritar) |
| bandas de risco em 4 linhas | `bandas · N definidas`, com os valores no `title` |
| «ciclos por par» no registo (duplicava a matriz) | removido |

**Medido no Chrome headless (CDP), 1440×757 e 390×844 emulados:**

```
desktop   viewport 1440x757 · página NÃO rola (altura do documento = 757) · palco do gráfico 942x372 (49% da altura)
          transbordos laterais: 0 · erros/excepções de consola: 0 · alvos de toque <30 px: 0
telefone  viewport 390x844 · documento 390 de largura (SEM rolagem horizontal) · palco 390x250
          barra de estado: 116 px em 4 linhas (14% do ecrã) · o gráfico aparece inteiro dentro da dobra
          transbordos laterais: 0 · erros: 0
```

**Defeitos apanhados a medir e corrigidos nesta passagem:** o `SPAN.estado` da matriz a transbordar 10 px (coluna de
22 px para uma pílula de 32); o motivo longo (`nada:proposta_ausente_tratada_como_hold`) com `nowrap` a empurrar a
tabela **351 > 306 px** (nova classe `.quebra`); no telefone, o rodapé com `overflow: visible` a alargar a **PÁGINA
inteira (624 > 500 px)** — a tabela da leitura tem 7 colunas `nowrap`; as caixas de seleção do gráfico com 12 px de
alvo (agora em `<label>` de 30 px); e o estado declarado («em operação», a verde) ao lado de «sem dados há 3 h» a
vermelho — que se lia como erro do painel: o selo passou a perder a cor viva quando a operação está velha, com o
`title` a explicar porquê.

**E o que continua igual, de propósito:** «Geral» já não esconde a bancada — agrega nas tabelas (par → `instalação ·
par`) e o gráfico continua no par escolhido. Esconder o gráfico para mostrar cartões era, ele próprio, um resto da
lógica de landing page.

### A verificação, depois do redesenho

- **`provar.sh`: 39 de 39 passaram**, exit 0 (a web não quebrou o portão).
- **0 transbordos, 0 erros, 0 excepções**; página sem rolagem no computador; sem rolagem horizontal no telefone.
- **Capturas lidas com visão** em três passagens (uma delas para criticar o primeiro resultado) — foi essa leitura
  que mandou promover a corrida a título, pôr a atenção no topo, agrupar as bandas e tirar a frase do rodapé.

## 9. O que a segunda revisão do dono apanhou (03/10/2026, mais tarde)

> «há um painel escondido no topo que não dá para identificar no modo pc … as infos precisam ser as corretas»

Três defeitos, todos medidos no DOM antes de tocar em nada:

**(a) Um painel INVISÍVEL de 1440×16 logo abaixo da barra.** Medido: `#vista-de-config` com `hidden: true` e
`display: flex`, `y=53, h=16`. A regra de classe (`.vista-de-config { display: flex }`) ganha ao atributo `hidden` —
a mesma armadilha que já estava escrita na skill e que voltou a aparecer. Correção: `.vista-de-config[hidden] { display: none }`.

**(b) A barra de estado com DUAS linhas e 417 px de vazio.** Medido: `#fita` com 53 px de altura (janela 757), a
linha 1 com 512 px (a identidade) e a linha 2 a começar em **x=417** — o `margin-left: auto` que empurrava os
números para a direita. Resultado: uma faixa que parecia um painel sem identificação. Correção: duas linhas
**decididas**, ambas a começar à esquerda e com a largura toda (a 1.ª a identidade, a 2.ª os números), e o rótulo
órfão `sigma` saiu da barra (vive no cabeçalho do gráfico, onde se chama `sigma 0.1.0 · 30m`).

**(c) A IDADE DO DADO não viajava com os preços.** A barra dizia `operação há 3,4 h` e a matriz de pares mostrava
`85165.0` com a mesma cara de um preço vivo — **infos erradas por omissão do contexto**. Correção: o cabeçalho da
coluna diz `3 · dado há 3,4 h` (a vermelho quando velho), cada preço perde a cor quando a operação está velha e
leva a idade no `title`, e o cabeçalho do gráfico passou a `último 85165.0 … leitura há 3,4 h`.

**(d) O pior: uma DESCOBERTA que servia o corredor de bancada do portão.** Medido por acidente, e é o defeito que
responde ao «as infos precisam ser as corretas»: com o painel a descobrir as corridas vivas, a tela passou a
mostrar uma «instalação» chamada **`vigia-orfandade-wInDt8`** — equity `—`, 1 par, parada. Não era uma corrida do
dono: era o fixture que o **`provar.sh`** cria (`tools/verificar-maquina/vigia.ts` → `mkdtemp($TMPDIR/vigia-orfandade-…)`),
e nesta máquina o `TMPDIR` **é** a raiz das corridas. A regra antiga (`existe operacao.json`) aceitava um duble como
instalação.

A correção é pelo critério da **declaração**, não do nome: uma instalação publica a **sua configuração** ao lado da
operação (`operacao.json.config.json`); um corredor de bancada escreve só `operacao.json`. As pastas sem a
configuração ficam de fora e são **contadas e ditas** no critério da tela — medido:

```
descoberta: nenhuma viva: a mais recente · 1 corredor(es) de bancada ignorado(s): sem operacao.json.config.json (bancada-de-prova-xyz)
instalacoes: ['teste-de-auditoria']
```

Prova viva: com o `provar.sh` a correr (a criar fixtures), a tela **manteve-se** em `teste-de-auditoria`.

## 10. A vista de configuração como DASH, os comandos e a CRIAÇÃO (03/10/2026)

A configuração era **quatro blocos empilhados com parágrafos** («o segredo não passa por aqui…», três parágrafos a
explicar a porta de escrita) — a mesma doença da landing page, noutra vista. Refêita com a mesma medicina:

| antes | agora |
|---|---|
| 4 blocos empilhados, cada ficha com `h3` e uma lista de campos | **três colunas**: o que existe (fichas + contas) · a ficha escolhida · o conferidor e a escrita |
| parágrafos de explicação | `title`, coluna, ou saída da tela (`segredo · por caminho, não se abre`) |
| o relatório do conferidor em prosa, aberto | `<details>` de **1 linha** («o relatório dele (8 linhas)»), com o texto a um clique |
| campos em `.item-de-config` (divs) | **tabelas densas** `chave | valor`, com o valor alinhado à direita |

E duas coisas NOVAS, que era o que faltava:

**A faixa de COMANDOS** (mandato · ciclo de vida · pedidos), sempre no ecrã:
- **o mandato, por par**: `rodar` / `enviar` — escreve a FICHA pela porta que já existe (`POST /api/ficha`), com o
  candidato validado pelo conferidor antes de tocar no ficheiro. É o `bash tools/ligar-par.sh <PAR> sim|nao` com
  validação e registo;
- **o ciclo de vida**: `iniciar` / `parar` a observação — o painel **PEDE** (`POST /api/verbo` → uma fila em
  `~/.config/mesacore/pedidos-de-verbo.jsonl`), e quem executa é a camada de operação. **Nenhum processo arranca
  do painel**: não há lá um `spawn` nem um `kill`, pelo mesmo princípio que proíbe um formulário de ordem. O pedido
  leva o comando que o executa, e a tela mostra-o;
- **os pedidos à espera**: criar (pedir), ler (a lista) e cancelar (apagar) — o CRUD completo da fila.

**A CRIAÇÃO** (`+ ficha de par`, `+ conta`, `+ setup`): uma capacidade nova do escritor (`criar()`, em
`tools/escrever-ficha`), com a guarda que substitui a impressão — **o ficheiro não existir**. Duas famílias, dois
conferidores (fichas → `fichas.py`; contas → `verificar-config`), candidato validado numa cópia temporária, escrita
atómica e registo com `"criado": true`. Um **setup** não se cria num formulário: é um plugin (manifesto + código), e
a tela diz isso em vez de fingir.

**Medido** (porta real, na 8790):

```
criar ficha (candidato incompleto)   → RECUSADO: o conferidor REPROVOU o candidato — nada foi criado
criar ficha (composto como a tela)   → SIMULAR: ok, aprovou, nada escrito
                                     → CRIAR:   ok, escrito, «ficha 4 conferidas · 0 falhas» e linha no registo
                                     → outra vez: RECUSADO («já existe … criar não é sobrepor»)
verbo desconhecido                   → RECUSADO: «verbo desconhecido («rebentar»): os que existem são iniciar, parar»
conta com «hl; rm -rf /»             → RECUSADO: «a conta não tem forma de nome de conta»
pedir o MESMO verbo duas vezes       → a fila fica em 1 (um gesto repetido não é dois pedidos)
o GET da fila sem o cabeçalho        → 403 (403 também sem origem, nas escritas)
```

Defeito apanhado a medir nesta fatia: o `GET /api/verbo` levava **403 vindo da própria página** — o browser só põe
`Origin` em pedidos que MUDAM, e o guarda exigia-o em todos. A guarda passou a ser sobre a escrita (POST/DELETE);
a leitura da fila pede o cabeçalho da própria tela. E um erro no `conferirCandidato`: uma primeira versão corria o
conferidor **sem o argumento da pasta**, e o veredicto saía sobre a árvore VERDADEIRA (3 fichas — e o candidato sem
linha nenhuma). A leitura passou a ser explícita: `fichas.py <pasta-da-cópia>`.

## 11. O recolhido, o formulário pelo conector, a escrita e a FONTE (03/10/2026)

Quatro pedidos, e cada um com a sua prova — as três provas abrem o painel num **Chrome headless** (o mesmo motor
do dono) e duas delas falam com o `servidor.ts` **a sério**, pela porta que o gesto do dono usa.

### (a) O recolhido que desaparecia — o invariante passa a comportamento

A regra estava escrita num comentário do CSS («a secção recolhida conserva a cabeça»), e as três secções do «lado
de dentro» nasciam com `<h3>` — recolhiam e **desapareciam com o botão dentro**. A raiz não é a regra: é a
promessa só viver num comentário. O `nucleo.js` ganhou `podeRecolher(el)` e o gesto **recusa recolher** uma secção
cujo `[data-alternar]` não viva num filho que o CSS conserva (`.cabeca`/`header`/`h4`) — ficar aberta é feio,
ficar sem forma de reabrir é perder a tela — e o defeito fica **dito** em `window.__erros`.

**Medido** (`prova-do-recolhido.ts`, uma passagem no DOM real + uma provocação):

```
as secções da tela (o DOM real): 7 de 7 recolheram e CONSERVARAM o botão que as abre
   vivas · dentro:mercado · dentro:risco · dentro:decisoes · matriz · leitura · registo
a provocação (cabeça sem .cabeca, botão fora dela):
   FALHA prova:mal-formada     recolheu=false · botão visível=true · (o guarda recusou)
   recolher à força (sem o guarda) perdia mesmo o botão? sim — o defeito era real
   o guarda DIZ o defeito? sim
```

O critério é **duplo** (recolheu E o botão continua visível): é isso que faz uma secção nova, mal formada, deixar
o teste **vermelho** em vez de passar em silêncio. E a provocação prova que o teste não é cego.

### (b) Criar conta: o formulário nasce do que o CONECTOR declara

O formulário era fixo em HTML (4 campos) e clonava a conta existente — servia o Hyperliquid e mais nada. Agora o
**`questionario.json` de cada plugin** (o MESMO ficheiro que a entrevista de linha de comando segue) é a fonte:
o fio publica o `catalogo` e a vista só o segue. **O cTrader passou a declarar os seus 17 campos**
(`brokers/ctrader/questionario.json`, novo), e o Hyperliquid já declarava 14.

**Medido** (`prova-do-catalogo.ts`, pela porta a sério):

```
o catálogo vem dos questionários dos conectores (3 conectores publicam campos)
   ctrader              brokers/ctrader/questionario.json · 17 campos · 4 sensível(is)
   hyperliquid          brokers/hyperliquid/questionario.json · 14 campos · 1 sensível(is)
   zz_prova_catalogo    … (criado pela prova e apagado no fim — o conector que ainda não existia)
cada questionário publicado entrou no catálogo (3 de 3)
o formulário pede exactamente os campos declarados (16 de 16) + o nome do ficheiro
sem os obrigatórios que o conector não traz por omissão, RECUSA (não presume)
   a tela nomeia o campo que falta: «Qual o ID da conta no cTrader (ctidTraderAccountId)? …»
ctrader: com as omissões declaradas + os obrigatórios, o conferidor APROVOU
hyperliquid: idem
o campo de SEGREDO (chave_privada) NÃO é um campo de digitação
o documento leva a REFERÊNCIA (ficheiro:…<conta>.key), nunca o valor do segredo
a conta foi criada pela tela: config/contas/zz-prova-do-catalogo.json existe
criar duas vezes RECUSA (criar não é sobrepor)
o fio não leva nenhum valor com cara de chave privada fora das impressões (0 encontrados)
```

**Acrescentar um conector novo = acrescentar um ficheiro.** A prova criou um conector de bancada
(`brokers/zz_prova_catalogo/questionario.json`), verificou que o seletor e o formulário nasceram dele **sem se
tocar em `web/`**, e apagou-o. E um defeito real ficou corrigido pelo caminho: **trocar de conector mantinha o
nome do ficheiro do conector anterior** — um formulário trocado criava um ficheiro com o nome de exemplo do
primeiro.

### (c) Escrever ficha pela tela (o `POST /api/ficha`, com os guardas do portão)

Já existia o caminho; o que faltava era a prova. **Medido** (`prova-da-escrita.ts`, com o `servidor.ts` a sério e
uma ficha de bancada criada e apagada pela prova — com uma **trava** que a impede de escrever numa ficha do dono):

```
a ficha de bancada foi criada: fichas/sigma/ZZPROVA-hl-teste-plugin.json
um valor dentro da banda valida e oferece escrever — VALIDADO: NADA FOI ESCRITO | 1.1 → 12
um valor fora da banda é RECUSADO com os números: «ficava ACIMA da banda da própria ficha (1–20)»
o candidato que o conferidor reprova NÃO é escrito — e o RELATÓRIO dele é mostrado tal e qual
uma página velha (impressão diferente) não passa por cima: «a ficha mudou desde que a abriste»
o ficheiro passou a ter o valor que o dono compôs: cabecalho.saldo_pct=12 (tipo string, D4)
```

### (d) O que a tela dizia sem se saber de onde vinha — agora diz a FONTE e a IDADE

**A resposta à pergunta** («a secção MERCADO mostra `lido: ha' 7,6 h` … de que corrida é isto?»), medida:

| o que | medido |
|---|---|
| a unit serve, hoje | `corrida-de-risco` (`descoberta: explicita (--corrida)`) |
| a operação dessa corrida | escrita às **05:36:26** — parada desde o reinício da máquina (≈14,5 h de idade) |
| a de `teste-de-auditoria` (a viva de hoje) | escrita às **11:29:34** (≈8,6 h) |
| o `lido: há 7,6 h` da imagem | corresponde a uma operação de ~11:26 — **a `teste-de-auditoria`**, a corrida certa |
| `livro: não publicado` | **não é do venue**: é uma ausência declarada no contrato (o operador não publica `mercado.livro`) |
| os dados do bloco | do venue, mas **VELHOS** — a máquina reiniciou e matou o operador; o ficheiro ficou congelado |

E a correção, para a pergunta não voltar a existir: **cada bloco passou a dizer a sua fonte e a sua idade**. O fio
traz `fontes` (caminho + `em_ms`) por mesa (`operacao.json`, `registo.jsonl`, `operador.log`) e por par
(`velas-<PAR>-<relogio>.jsonl`, a ficha), e a tela mostra-as nas cabeças com o `fonteEIdade` — a idade é calculada
**do instante absoluto**, para envelhecer com o ciclo de 2 s em vez de envelhecer com o fio.

**Medido** (Chrome headless, 1440×900 e 390×844; fio real, cópia própria da tela):

```
#fonte-das-vivas    operacao.json · 8.5 h
#fonte-da-matriz    registo.jsonl · 8.5 h
#fonte-da-leitura   velas-BTC-30m.jsonl · 8.5 h · BTC-hl-teste-plugin.json · 9.1 h
#fonte-do-registo   registo.jsonl · 8.5 h · operador.log · 8.5 h
dentro:mercado  MERCADO | operacao.json · 8.5 h
dentro:risco    RISCO EM VIGOR | BTC-hl-teste-plugin.json · 9.1 h
dentro:decisoes DECISÕES DESTE PAR | registo.jsonl · 8.5 h
```

**Defeitos apanhados a medir nesta passagem** (todos corrigidos): o `grafico.js` rebentava quando o fio não trazia
a série (o `painel.json` a ficar leve) e deixava a tela desenhada a MEIO; a `fonte` transbordava a cabeça de
306 px (a idade é que era cortada — passou a mostrar o nome do ficheiro, com o caminho no `title`); a pílula do
lado transbordava a coluna da matriz em 2 px (30 → 34).

### A verificação desta fatia

- **`provar.sh`: 42 de 42** — a porta COMPLETA (com as três provas da tela somadas às bancadas de operação);
  na `--rapido`, **27 de 27**. O portão continua a decidir o que devia, e explica o que não fez.
- **`tipos.sh`: 0 erros em 6 directórios** (o tsc confere o produto e as bancadas novas).
- **0 erros na página** em todas as passagens; **0 transbordos** fora dos scrollers por desenho (a tabela da
  leitura e a matriz, que rolam dentro do bloco); **página sem rolagem** no computador e **sem rolagem
  horizontal** no telefone.
- **A árvore termina declarada**: o que a bancada cria (um conector, uma conta, uma ficha) é apagado por ela; o
  que fica sujo é o trabalho desta fatia (e o do dono, que já lá estava).

### E o que fica para o dono decidir (não é desta sessão)

- **A unit do painel tem de ser reiniciada** para o `servir.sh` novo (a descoberta) entrar em vigor — é a razão
  por que a tela mostra a corrida de ontem. É mudança de host → vai ao `sysadmin` com a especificação.

## 12. A AUDITORIA — duas fontes de verdade, e as três raízes (04/10/2026)

Três defeitos medidos no mesmo dia, todos com a mesma raiz: **DUAS FONTES DE VERDADE** para a mesma tela. A
correcção é da raiz, não do sintoma.

### (A) Uma fonte de verdade — UMA pasta servida, UM gerador

O que estava medido: o código do painel vive em `web/painel/`, mas um servidor servia
`~/.hermes/…/scratch/painel-v2/` — uma **CÓPIA editável à mão** de horas antes, sem as correcções. O dono via o
recolhimento partido (o fix existia em `web/painel/` e não na cópia) e a tela a dizer «SEM DADOS HÁ 17,2 H» com o
sistema a correr. Havia também a metade do servidor: o `servir.sh` corria dois laços `while` a gerar o fio e o
`servidor.ts` só servia — a tela dependia de os dois coexistirem.

**Correcção:** a cópia à mão saiu do caminho (`scratch/painel-v2` e `scratch/painel-teste`); o **servidor passou a
ser o gerador** (`--intervalo`/`--intervalo-vivo` dentro do `servidor.ts`, com o `--para` do retrato **sempre
dentro da `--pasta` que ele serve**), e o `servir.sh` passou a **lançador** (com `exec` — a unit vê um só processo,
e os ciclos morrem com ele).

**Prova (`prova-da-fonte.ts`, no portão):** arranca o servidor com os argumentos da unit e mede, ficheiro a
ficheiro, que o que a tela serve é **byte a byte** o do repositório —

```
cada ficheiro servido é byte a byte o do repositório (16 de 16)
o painel.json servido é o mesmo ficheiro que está em web/painel/ (o gerador e o servidor são o mesmo processo)
o mesacore-painel.service NÃO passa --pasta · o servir.sh NÃO passa --pasta ao servidor
nenhuma cópia servível da tela no scratch (nenhuma)
a provocação: uma pasta divergente é APANHADA (sha da cópia ≠ sha do repo)
```

### (B) O sistema inteiro visível — o que está vivo, o que está parado, e as horas

**Medido no DOM** (fio de bancada, `prova-do-vivo.ts`): `1 pos · 1 ord` com a posição (BTC · buy · 0.004) e a
ordem (`oid-9`); a matriz `trava` + `ciclos` + `há 1.7 h`; a última barra com o dia e a hora (`barra 04/10,
04:00`) e a leitura a viajar com o preço; as três secções do «lado de dentro» a dizer a fonte+idade e a
**sobreviverem ao recolhido**. O que faltava e foi acrescentado: **o ciclo mais recente passou a trazer a HORA**
(a linha `última` da secção DECISÕES DESTE PAR).

### (C) O log e o retrato — o log do operador é MISTO

A tela mostrava «FALTAS DO RETRATO — linha ilegível em operador.log: nao e' JSON: linha truncada». Mediu-se o
`operador.log` da corrida viva: **297 linhas, 0 inválidas** na altura — as linhas contadas eram **história**
(das corridas anteriores, já truncadas no arranque seguinte). Mas a raiz existia em dois sítios:

1. **o eco do operador partia linhas**: o handler do `conector.stderr` partia por `\n` **sem guardar o resíduo** —
   um `data` que caísse a meio de uma linha JSON fabricava, deste lado, duas linhas ilegíveis. Corrigido com o
   buffer (`vigia/linhas.ts`, provado em bancada);
2. **o leitor do log era estrito**: o `operador.log` é um log MISTO por desenho (as linhas do operador são JSON; o
   conector fala em PROSA, reemitida intacta; mais o marcador `[<data>] fim` do lançador) e o `retrato` tratava
   toda a prosa como falta. Passou a reportar só o que **tem cara de JSON partido** (começa por `{`).

**Prova (`prova-do-log.ts`, no portão):** o buffer junta o resíduo e a linha sai inteira (sem ele, viraria duas
ilegíveis); contra uma cópia de uma corrida real, a prosa dá **0 faltas** e um `{` que não fecha dá **1 falta
nomeada** — com o par de controlo (o leitor estrito antigo contava 3).

### A verificação desta fatia

- **`provar.sh`: 45 de 45** — a porta COMPLETA (as três provas novas somadas às 42); `tipos.sh`: **0 erros em 6
  directórios**.
- **A árvore termina declarada**, e a unit do painel **continua a correr o código antigo em memória** até ser
  reiniciada (é mudança de host: vai ao `sysadmin`), pelo que a correcção do `servidor.ts` só vale no religar.

### O que a auditoria NÃO tocou, dito

- **O sistema em observação não foi tocado** (operador + mesa + conector + feed, posições na conta de teste): as
  provas novas medem contra fios de bancada e cópias em scratch, e o `prova-da-fonte` arranca o servidor com
  `--intervalo 0` (não escreve fio nenhum).

## 13. AS FALHAS DE CONSTRUÇÃO E O ARRANQUE DE PRIMEIRA VEZ (04/10/2026)

O estado de partida era o de **primeira execução**: host limpo, sistema parado (nenhum processo do MesaCore,
nada a ouvir em `192.168.15.24:8788`, a unit `inactive (dead)` e **`disabled`**, o scratch a **zero** directorios,
o venue plano — 991,63 USDC, 0 posições, 0 ordens). Sete frentes, por ordem de risco (dinheiro primeiro), cada
uma com a prova que a mede.

**`provar.sh`: 50 de 50** (era **45**) · `tipos.sh`: **0 erros em 6 directórios** · fallbacks **0** · a contagem
do portão corrigida onde era repetida (o `provar.sh`, este plano, o `ONDE_ESTAMOS.md`, o `README.md`).

### A. O arranque de primeira vez — um caminho só, e o arranque não cala

**O que faltava, medido:** nenhum caminho documentado levantava o sistema do zero; a unit estava `disabled` (não
voltava sozinha depois de um reinício) e o lançador **prometia o que não cumpria** («nenhuma ficha do repositório
diz `enviar: true`» — e as três fichas dizem, desde 02/10/2026).

**O que ficou:** um caminho no `tools/painel/README.md` (secção **O arranque de primeira vez**), e a verificação
extraída para um comando próprio — `tools/checar-o-arranque.sh` — que o lançador corre ANTES de levantar processo
nenhum. Ele diz **pelo nome** o que falta (a conta, a credencial por referência, as fichas ligadas) e **conta as
fichas ARMADAS ao venue** (`enviar: true`), em voz alta. A unit ficou **`enabled`**.

**Medido agora (o arranque real, não a intenção):**

```
systemctl --user is-enabled mesacore-painel.service   -> enabled
systemctl --user is-active  mesacore-painel.service   -> active (MainPID 1001579, e 1003522 depois de um restart)
GET http://192.168.15.24:8788/index.html               -> 200    ·   painel.json -> 200
fio: mesas ['observacao'] · estado em_operacao · descoberta «operacao.json escrito ha' <= 300 s»
venue: equity 991,62 · 0 posicoes · 0 ordens (no arranque)
```

**Prova no portão:** `prova-do-arranque.ts` — contra repositórios de bancada, exige que cada falta seja dita pelo
nome e que o arranque RECUSE; e prova que o aviso das fichas armadas **não sai sempre** (o controle de uma ficha
ligada e desarmada). O `prova-do-log` foi tornado **auto-suficiente**: ele dependia de uma corrida em
`scratch/teste-de-auditoria` que a limpeza apagou (era a ÚNICA prova vermelha no portão do arranque de primeira
vez — `ENOENT`), e passou a construir a sua própria corrida.

### B. A colisão de referências — com a cronologia, e uma decisão do dono

**Cronologia medida (a régua, sem adjectivos):**

| quando | o que | cru |
|---|---|---|
| 09:15:05 | o ETH mandou a referência `mesa-sigma_v0-000007` | `classificacao: recusado · motivo: referencia_ja_enviada_ao_venue` — o `cloid` derivado já existia no venue, de uma corrida anterior; **nada foi enviado** |
| 09:37:10 | a `mesa-sigma_v0-000029` saiu | `classificacao: aceite · oid 61809804678` · a posição ETH **sell 0.004 @ 2695,7** abriu (marca 29) |

A referência é `mesa-<setup>_v<major>-<ciclo>` e o `cloid` é `sha256(domínio + conta + instrumento + referência)`.
O **tratamento do venue está certo** (a P6 mediu que o mesmo `cloid` duplicava a ordem); o que estava errado era a
**referência repetir**: o contador `ciclo` **começava em 0 em cada arranque** da mesa (`core/servidor.ts`).

**Decisão do dono (04/10/2026):** *persistir o contador de ciclos entre arranques* — a mesa passa a **continuar de
onde o registo ficou** (`ultimoCicloDoRegisto`), sem mudar a forma da referência. Prova no portão:
`ciclo-continua.ts` (mesa a sério com o registo a 47 → a volta nova sai em **48**; o controle, registo vazio, em
**1**; **reprova** com o defeito reposto).

**O LIMITE, medido e DITO (não escondido):** continuar o contador só conta se o **registo sobreviver**. O scratch é
podado; numa pasta de corrida nova o contador volta a 1 e pode colidir outra vez — foi o que aconteceu acima (a
corrida começou vazia, o contador voltou a 1, e a 7 colidiu). E o risco não é um atraso: a regra é «a entrada só
acontece na **barra do flip**», logo uma referência recusada nessa barra **perde a entrada** (salvou-se aqui por o
ETH ter voltado a propor na 29). Fica declarado no código (`core/estado/registo.ts`) e aqui: a via para o corrigir
(o conector a devolver a recusa e a mesa a re-emitir com referência NOVA) é decisão do dono e **não** se inventa.

### C. O gráfico e o vão — marcado e nomeado

O vão era **REAL** (0 duplicados nos três pares e 0 no fio), e o feed **já o nomeava** (`buraco_no_historico`),
mas nunca chegava ao ecrã. Agora o produtor calcula os vãos das velas (`buracos.ts`, passo medido do próprio dado)
e a tela **marca-os** (um marcador na barra seguinte, com `↔N`) e **nomeia-os** no cabeçalho do gráfico:
`vão 03/10, 14:00→04/10, 07:30 · faltam 34`. Nunca se inventa a barra que faltou. Prova no portão:
`prova-dos-buracos.ts` — os **dois** vãos medidos (1 barra e 17,5 h / 34 barras) e o controle (sem vão, nenhum
aviso).

### D. O dash de configuração — os quatro números do dono

| | antes | depois |
|---|---|---|
| alvos de toque < 44 px **no telefone** (390×844) | **13 de 13** (30 px) | **0** (44 px) |
| campos de formulário na vista (a ler) | 0 | 0 (a edição vive na vista, não num diálogo) |
| chaves do documento em **mais de um sítio** | **6** (conta/setup/relógio/ao_desligar × procedências; run/enviar × faixa) | **0** |
| o **diálogo legado** (segunda porta, só leitura) | presente (`#dialogo`) | **removido** — o botão `config` do gráfico passou a `<a href="#configuracao">` |

O gesto principal de editar a ficha («mudar esta ficha») e os dois interruptores estão **à vista**, na vista. Prova
no portão: `prova-do-dash.ts`, com **provocação** (a mesma chave injectada noutro sítio faz a contagem subir) e o
fio **vazio** medido (sem fichas, a vista diz que não há ficha — não fica em branco). No computador os botões ficam
a 21 px de propósito: 21 px é a densidade do terminal (a régua dos 44 px é a do **toque**, no telefone).

### E. A porta de credencial pela tela

**O que faltava:** o valor da Hyperliquid vivia num ficheiro que **nenhuma ferramenta escrevia**; a tela dizia
«segredo · por caminho · não se abre» e não tinha caminho de escrita. **O que ficou:** a MESMA porta de escrita
(`tools/guardar-credencial.sh`), estendida com um modo que lê o valor **pelo stdin** (`gravar-de-stdin`), e o
`POST /api/credencial` no servidor, com as guardas da porta das fichas (origem + cabeçalho próprio). O campo nasce
do `questionario.json` do conector (`tipo: segredo`); a conta continua a apontar por **referência**.

**Medido** (`prova-da-credencial.ts`, com o servidor a sério e uma pasta de credenciais de **bancada**):

```
gravado: 600 <pasta>/zz-bancada.key · conteudo == o valor colado
resposta: forma {comprimento, primeiros} + impressao sha256 — o VALOR nao aparece (busca literal)
registo : instante, ficheiro, ORIGEM («vista de configuração»), impressao — o VALOR nao esta' la'
guardas : sem cabecalho -> 403 · origem diferente -> 403 · ficheiro fora da pasta -> 400
          derivar a conta do dono (fora da pasta) -> 400 · valor curto -> 409, e nada e' criado
limpeza : o ficheiro que a bancada criou e' apagado no fim
```

### F. Duplicados/contaminação do feed — a prova da classe

A bancada do feed (**16 provas**, era 15) ganhou a **troca de dono inteira**: derivado → fonte → derivado outra
vez (a agregação tem de se calar quando a barra do venue chega e **voltar** a compor no período seguinte). E a
**prova negativa** — `bash brokers/hyperliquid/casos/prova-negativa-do-feed.sh` — **reprovou 10 de 10** com os
defeitos repostos, incluindo o que o dono nomeou (a agregação a **mutar a barra do venue**), e a bancada voltou ao
verde com o ficheiro restaurado (selo por `sha256`).

### G. A verificação

- **`provar.sh`: 50 de 50**, exit 0 (as cinco provas novas somadas às 45).
- **`tipos.sh`: 0 erros em 6 directórios**; **fallbacks 0**; a árvore termina declarada (o que as bancadas criam,
  apagam).

### H. UMA SESSÃO SÓ, E A TELA NUNCA VELHA (a exigência do dono, medida)

**O que estava por trás do que o dono viu.** O painel que ele abria **era** o novo (o botão `recarregar` e o bloco
da credencial são desta vaga) — mas a **aba aberta antes** do restart continuava a desenhar o código antigo: a página
é um `<script type="module">`, e a renovação de 2 s/60 s só a redesenha com o módulo **que ela já carregou**. Duas
abas abertas em momentos diferentes = **duas telas diferentes**. E o «cheio de erros», medido, eram três coisas:
(i) abrir **«+ conta»** abria uma **parede vermelha** («campo(s) obrigatório(s) em falta — …») antes de o dono
escrever nada, e num formulário de **cTrader** (17 campos) quando a conta dele é da Hyperliquid; (ii) um **Chrome de
bancada órfão**, deixado por uma bateria que morreu a meio, ficou **6 h** a bater no painel — uma segunda sessão.

| garantia | como se cumpre | prova |
|---|---|---|
| **nunca duas sessões do dash** | uma tela, um servidor, uma pasta (a unit + `prova-da-fonte.ts`); e o `provar.sh` **varre os clientes-fantasma órfãos** (ppid=1) antes e depois de cada bateria | `prova-da-fonte.ts` · a varredura no `provar.sh` |
| **nunca desatualizada** | o fio leva `tela_em_ms` — a versão dos ficheiros da tela, medida no **disco** (não escrita à mão); a página compara-a em cada leitura (2 s) e **recarrega-se sozinha** | `prova-do-dash.ts` — cargas `1 → 2`, versão `1000 → 2000`; **reprova** (`1 → 1`) sem a comparação |
| **criar conta sem parede de erros** | o que **falta preencher** vai em tom **neutro** («por preencher (N): …»); o vermelho fica para a **RECUSA** a sério. E o formulário abre no conector **que já se usa** | `prova-do-dash.ts` — `por preencher (1): qual a conta (endereço)?` neutro, **0** recusas no arranque, conector **`hyperliquid`** |

**Medido ao vivo (04/10/2026, 1440×900, painel da unit):** o fio e a página com a **mesma** versão
(`1791129781181`); o `+ conta` abre no **`hyperliquid`** com `por preencher (3): Qual o ENDEREÇO (master) da conta na
Hyperliquid? · Quantos dias do ledger ficam integrais? · E depois desses dias, o que fica do l…` em tom neutro e
**zero** recusas vermelhas; **0 erros** na página (excepções, promessas rejeitadas e `console.error` apanhados antes
de cada documento).


