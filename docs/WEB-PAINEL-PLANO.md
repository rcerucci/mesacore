1|# A web do MesaCore — plano e resultado (medido, 03/10/2026)
2|
3|## O que estava medido, antes de tocar em nada
4|
5|| facto | medido |
6||---|---|
7|| a unit servia a corrida ERRADA | `servir.sh:26` tinha por omissão `scratch/corrida-de-risco` (parou às 05:36); o teste vive em `scratch/teste-de-auditoria` |
8|| prova | o `vivo.json` dizia `corrida: …/corrida-de-risco`, equity **992,32**, `relógio 1h`; a corrida viva tem equity **991,58** e relógios **30m/30m/1m** |
9|| a tela era um ficheiro | `web/painel/index.html` = **1784 linhas**, 108 KB |
10|| o retrato era de UMA corrida | `retrato.ts` recebia `--corrida <dir>` (uma) e construía **1 mesa / 1 conta** — embora o fio já fosse uma LISTA (`registo_de_mesas: []`, `mesas: []`) |
11|| o registo da corrida viva | 97 linhas · 96 ciclos · 24 ciclos do ETH em `proposta_sem_lado_a_executar` |
12|
13|## O que ficou feito, e como se prova
14|
15|### 1. O painel deixa de servir a corrida errada — e diz qual serve, e há quanto tempo
16|
17|`retrato.ts` aceita **N `--corrida`** (repetível) e, sem nenhuma, **descobre** as corridas VIVAS sob a raiz
18|(`operacao.json` reescrita há ≤ 300 s; sem nenhuma viva, cai na mais recente). A fita passou a mostrar a
19|**instalação**, a **corrida**, a **idade da operação** e a **idade do retrato**, com um **seletor** (Geral + uma
20|entrada por instalação).
21|
22|**Medido** (descoberta, sem `--corrida`):
23|
24|```
25|instalacoes (descobertas vivas: operacao.json escrito ha' <= 300 s):
26|  teste-de-auditoria · hl-teste-plugin · …/teste-de-auditoria
27|    mesa: estado em_operacao · 99 ciclos em 100 linhas · operacao lida ha' 0 s
28|```
29|e a fita, lida do DOM: `Corrida: teste-de-auditoria · Operação: há 10 min · Equity 991,58 USDC`.
30|
31|### 2. Posições e ordens vivas no topo, e o que está PARADO
32|<!-- REVISTO NA §8: os blocos com frase foram substituídos por TABELAS e por uma MATRIZ DE ESTADO; o `#vivas`
33|     agrega hoje as duas tabelas (posições, ordens) e a coluna TRAVA da matriz. O `selo de urgência` deu lugar à
34|     `atenção` calculada na barra. O que se mantém: a ORDEM de urgência e o motivo traduzido no `title`. -->
35|
36|Um bloco novo (`#vivas`, `js/posicoes.js`) mostra, por ordem de urgência: **posições vivas** (lado, unidades,
37|preço de entrada, marca de posse, e a decisão da mesa), **ordens em aberto** (lado, tamanho, preço, oid) e **o que
38|está parado** — com o motivo EM PORTUGUÊS e há quantos ciclos/desde quando. A cabeça do bloco leva um **selo de
39|urgência** («há algo vivo» / «nada exige atenção» / «mesa parada»), para responder aos 5 segundos mesmo recolhida.
40|
41|**Medido** (DOM, corrida viva): `1 pos · 0 ord · 3 parados` ·
42|`COMPRADO ETH 0.004 @ 2675.3 · marca 28 · decisão: nada (o setup propôs, mas sem lado a executar)` ·
43|`BTC: o setup não propôs nada nesta volta (espera) — há 33 ciclos · desde 10:56:55 (46 min)`.
44|O motivo cru (`proposta_ausente_tratada_como_hold`) viaja no `title` — a tradução não esconde a prova.
45|
46|### 3. N plugins — a tela do SISTEMA, e não a do sigma
47|<!-- REVISTO NA §8: em «Geral» a bancada deixou de ser ESCONDIDA (isso era resto de landing page): as tabelas
48|     agregam TODAS as instalações (a linha passa a `instalação · par`) e o gráfico continua no par escolhido. -->
49|
50|O fio ganhou `instalacao` em cada mesa, `plugins[]` (um por setup, com as instalações e os pares onde corre) e
51|`geral` (posições/ordens/parados agregados). O front ganhou o seletor; em **Geral** a bancada dá lugar à vista
52|geral (instalações + plugins + tudo o que está vivo).
53|
54|**Medido** (modo Geral, DOM): `HÁ ALGO VIVO 4 POS · 0 ORD · 5 PARADOS`, 2 cartões de instalação + 1 de plugin
55|(`sigma 0.1.0 · typescript · publica série · 6 pares`), a bancada escondida (`display: none`).
56|
57|### 4. A estrutura: um módulo por responsabilidade
58|
59|`index.html` passou de **1784 linhas de HTML+CSS+JS** para **HTML+CSS** com um `<script type="module">`, e nove
60|módulos em `web/painel/js/` (zero pedido externo — tudo servido do mesmo sítio):
61|
62|| módulo | responsabilidade |
63||---|---|
64|| `nucleo.js` | a cor (do tema, com o normalizador do `color-mix`), os formatos, o ESTADO, o que recolhe, os motivos ditos |
65|| `fita.js` | a fita do topo: instalação/corrida/idades/seletor |
66|| `posicoes.js` | o que está vivo: posições, ordens, o que trava, a vista geral |
67|| `pares.js` | a lista de pares (principal + detalhe, recolhíveis) |
68|| `grafico.js` | as velas × a série, as marcas, a leitura do setup, a janela visível |
69|| `dentro.js` | posição/mercado, risco em vigor, decisões do par |
70|| `registo.js` | o ledger: ciclos, mandato, carteiro, o que saiu, as faltas |
71|| `configuracao.js` | a vista da ficha (leitura) e o caminho de escrita (compor→validar→escrever) |
72|| `telefone.js` | a barra fixa do telefone |
73|| `arranque.js` | os dois relógios, as vistas, o layout, o ponto de encontro (`redesenho`) |
74|
75|### 5. O gráfico: o spike (números medidos)
76|
77|| | `lightweight-charts` (o nosso) | `@luxalgo/vela` 0.8.1 |
78||---|---|---|
79|| ficheiro de browser | `lightweight-charts.standalone.production.js` | `dist/vela.global.min.js` |
80|| **peso bruto** | **197 922 B** | **980 356 B** (4,95×) |
81|| **peso gzip −9** | **62 150 B** | **276 522 B** (4,45×) |
82|| formato das barras | `{time, open, high, low, close}` | `{time, open, high, low, close, volume?}` |
83|| **obriga a mudar o NOSSO formato?** | **não** — adaptador de 1 linha de `{t,o,h,l,c,v}` (segundos) | **não** — o MESMO adaptador, com `time` em ms |
84|| desenhou as nossas barras? | **sim** — medido: canvas 734×399 com **292 866 px opacos** (desktop) e 304×157 com **47 728** (telefone); velas visíveis nas duas capturas | **não** — montou (`market.data`, 1010 barras), WebGL2 disponível, mas `ready()` **nunca resolve** e a área fica VAZIA (só a barra de ferramentas e o logomark) |
85|| licença | Apache-2.0 | core Apache-2.0, mas o motor PINE (`@luxalgo/vela-pinets` + `pinets`) é **AGPL-3.0-only**, e o `NOTICE` **exige atribuição visível em cada ecrã** |
86|
87|**Peso na LAN, medido por CDP** (`Network.loadingFinished`, o que passa pelo fio na abertura do painel):
88|
89|```
90|painel — total 6 379 822 B
91|   5 859 493  painel.json
92|     198 073  lightweight-charts.standalone.production.js
93|      55 174  vivo.json (×3, o ciclo de 2 s)
94|      30 706  index.html   + 9 módulos (~99 KB somados)  + 4 KB de tema
95|spike Vela — total 1 096 398 B
96|     980 507  vela.global.min.js
97|     113 150  bars.json  (as MESMAS 1010 barras)
98|```
99|
100|**A conclusão que os números dizem:** a biblioteca NÃO é o gargalo da LAN — o NOSSO fio é (5,86 MB num retrato).
101|A diferença entre as duas bibliotecas (783 KB brutos) é **7,5× menor** do que o `painel.json` sozinho. Trocar de
102|biblioteca (a) não melhora o peso de forma que se note, (b) custa um projeto de integração (o caminho offline do
103|Vela não pintou no spike), (c) traz uma obrigação de atribuição em cada ecrã e, para o PINE, uma licença AGPL.
104|**Recomendação: ficar com o `lightweight-charts`** — e, se o peso incomodar, atacar o fio (a série e as velas
105|repetidas no `painel.json`), que é onde estão 92% dos bytes.
106|
107|### 6. A verificação
108|
109|- **`provar.sh`: 39 de 39 passaram** (a web não quebrou o portão).
110|- **DOM medido no Chrome headless** (CDP, aba visível): **0 erros**, **0 excepções**, **0 `console.error`**;
111|  gráfico **pintado** (px opacos > 0) nos dois ecrãs; **nenhum transbordo horizontal** (fora da faixa de pares
112|  do telefone, que é um *scroller* por desenho); **nenhum alvo de toque < 44 px** no telefone.
113|- **Capturas lidas com visão** (desktop, telefone, Geral), antes de declarar fechado — foi essa leitura que
114|  apanhou a ordem dos blocos no telefone e os parágrafos em maiúsculas.
115|- Defeitos apanhados a medir e corrigidos nesta fatia: a fita a transbordar 36 px no telefone; a fita pegajosa
116|  a ocupar 354 px (42% do ecrã) e a empurrar o gráfico para fora da dobra; o painel «lado de dentro» a alargar
117|  27 px (motivo longo numa coluna estreita); as velas a colapsarem numa linha (1009 barras em 372 px — a janela
118|  visível passou a ~70 no telefone e ~160 no computador); a cabeça do «o que está vivo» sem o par.
119|
120|### 7. O que continua de fora (dito, e não escondido)
121|
122|- **A unit do painel tem de ser reiniciada** para o `servir.sh` novo (a descoberta) entrar em vigor: o processo
123|  que corre carregou o `servir.sh` velho e continua a pedir `--corrida corrida-de-risco`. É mudança de host →
124|  vai ao `sysadmin` com a especificação, e a prova é `systemctl --user is-active` + a fita a dizer
125|  `teste-de-auditoria`.
126|- **O sistema em observação MORREU** (a máquina reiniciou a meio desta sessão: a sessão GNOME tinha 3 min de vida
127|  e os processos operador/conector/feed/mesa já não existiam). Não foi esta sessão. A tela diz a idade, e é por
128|  isso que ela agora mostra `operação: há 20 min` em vez de fingir que é agora.
129|- **`web/painel/painel.json` e `vivo.json` não são versionados** (estão no `.gitignore`) — o spike correu sobre
130|  uma cópia em `scratch/painel-teste/`, com o servidor próprio na porta 8799, para não escrever no fio da unit.
131|
132|## 8. O REDESENHO — a crítica do dono (03/10/2026)
133|
134|> «isso não é um dash board, é uma landug page, ta uma bosta»
135|
136|A crítica era justa e tinha número: a primeira entrega gastava o ecrã em **8 cabeçalhos de secção com slogan** e em
137|parágrafos («o livro não aparece aqui, e é uma falta com nome: …»), e o que é vivo — o gráfico e as posições —
138|ficava em segundo plano. Foi refeita com olhos de terminal: **uma barra de estado, três colunas densas e a matriz a
139|substituir as frases.**
140|
141|### O que mudou, e o que se ganhou
142|
143|| antes | agora |
144||---|---|
145|| 8 cabeçalhos de secção + parágrafos de explicação | **4 cabeçalhos de tabela** (9,5 px, caixa alta); o que era parágrafo virou **coluna** (`TRAVA` com o código e o texto no `title`) |
146|| cartões de par com título, frase e três camadas | **matriz de pares**: uma linha de 21 px por par (par · preço · lado) |
147|| «o que está parado, e porquê» em blocos de 3 linhas | **matriz de estado** no rodapé: par · lado · rodar · enviar · **trava** · ciclos · travado desde |
148|| posições/ordens em blocos com frase | **duas tabelas densas** (par · lado · tam · entrada · marca · decisão) |
149|| a corrida era um número entre outros | a corrida é **o título** da barra (13,5 px) e o produto virou etiqueta |
150|| «mesa parada» / «há algo vivo» (selo de urgência) | **`atenção` calculada**: `sem dados há X` (vermelho) › `N falta(s)` (vermelho) › `N travado(s)` (neutro — num sistema em observação travar é o estado NORMAL, e gritar sempre é o mesmo que não gritar) |
151|| bandas de risco em 4 linhas | `bandas · N definidas`, com os valores no `title` |
152|| «ciclos por par» no registo (duplicava a matriz) | removido |
153|
154|**Medido no Chrome headless (CDP), 1440×757 e 390×844 emulados:**
155|
156|```
157|desktop   viewport 1440x757 · página NÃO rola (altura do documento = 757) · palco do gráfico 942x372 (49% da altura)
158|          transbordos laterais: 0 · erros/excepções de consola: 0 · alvos de toque <30 px: 0
159|telefone  viewport 390x844 · documento 390 de largura (SEM rolagem horizontal) · palco 390x250
160|          barra de estado: 116 px em 4 linhas (14% do ecrã) · o gráfico aparece inteiro dentro da dobra
161|          transbordos laterais: 0 · erros: 0
162|```
163|
164|**Defeitos apanhados a medir e corrigidos nesta passagem:** o `SPAN.estado` da matriz a transbordar 10 px (coluna de
165|22 px para uma pílula de 32); o motivo longo (`nada:proposta_ausente_tratada_como_hold`) com `nowrap` a empurrar a
166|tabela **351 > 306 px** (nova classe `.quebra`); no telefone, o rodapé com `overflow: visible` a alargar a **PÁGINA
167|inteira (624 > 500 px)** — a tabela da leitura tem 7 colunas `nowrap`; as caixas de seleção do gráfico com 12 px de
168|alvo (agora em `<label>` de 30 px); e o estado declarado («em operação», a verde) ao lado de «sem dados há 3 h» a
169|vermelho — que se lia como erro do painel: o selo passou a perder a cor viva quando a operação está velha, com o
170|`title` a explicar porquê.
171|
172|**E o que continua igual, de propósito:** «Geral» já não esconde a bancada — agrega nas tabelas (par → `instalação ·
173|par`) e o gráfico continua no par escolhido. Esconder o gráfico para mostrar cartões era, ele próprio, um resto da
174|lógica de landing page.
175|
176|### A verificação, depois do redesenho
177|
178|- **`provar.sh`: 39 de 39 passaram**, exit 0 (a web não quebrou o portão).
179|- **0 transbordos, 0 erros, 0 excepções**; página sem rolagem no computador; sem rolagem horizontal no telefone.
180|- **Capturas lidas com visão** em três passagens (uma delas para criticar o primeiro resultado) — foi essa leitura
181|  que mandou promover a corrida a título, pôr a atenção no topo, agrupar as bandas e tirar a frase do rodapé.
182|
183|## 9. O que a segunda revisão do dono apanhou (03/10/2026, mais tarde)
184|
185|> «há um painel escondido no topo que não dá para identificar no modo pc … as infos precisam ser as corretas»
186|
187|Três defeitos, todos medidos no DOM antes de tocar em nada:
188|
189|**(a) Um painel INVISÍVEL de 1440×16 logo abaixo da barra.** Medido: `#vista-de-config` com `hidden: true` e
190|`display: flex`, `y=53, h=16`. A regra de classe (`.vista-de-config { display: flex }`) ganha ao atributo `hidden` —
191|a mesma armadilha que já estava escrita na skill e que voltou a aparecer. Correção: `.vista-de-config[hidden] { display: none }`.
192|
193|**(b) A barra de estado com DUAS linhas e 417 px de vazio.** Medido: `#fita` com 53 px de altura (janela 757), a
194|linha 1 com 512 px (a identidade) e a linha 2 a começar em **x=417** — o `margin-left: auto` que empurrava os
195|números para a direita. Resultado: uma faixa que parecia um painel sem identificação. Correção: duas linhas
196|**decididas**, ambas a começar à esquerda e com a largura toda (a 1.ª a identidade, a 2.ª os números), e o rótulo
197|órfão `sigma` saiu da barra (vive no cabeçalho do gráfico, onde se chama `sigma 0.1.0 · 30m`).
198|
199|**(c) A IDADE DO DADO não viajava com os preços.** A barra dizia `operação há 3,4 h` e a matriz de pares mostrava
200|`85165.0` com a mesma cara de um preço vivo — **infos erradas por omissão do contexto**. Correção: o cabeçalho da
201|coluna diz `3 · dado há 3,4 h` (a vermelho quando velho), cada preço perde a cor quando a operação está velha e
202|leva a idade no `title`, e o cabeçalho do gráfico passou a `último 85165.0 … leitura há 3,4 h`.
203|
204|**(d) O pior: uma DESCOBERTA que servia o corredor de bancada do portão.** Medido por acidente, e é o defeito que
205|responde ao «as infos precisam ser as corretas»: com o painel a descobrir as corridas vivas, a tela passou a
206|mostrar uma «instalação» chamada **`vigia-orfandade-wInDt8`** — equity `—`, 1 par, parada. Não era uma corrida do
207|dono: era o fixture que o **`provar.sh`** cria (`tools/verificar-maquina/vigia.ts` → `mkdtemp($TMPDIR/vigia-orfandade-…)`),
208|e nesta máquina o `TMPDIR` **é** a raiz das corridas. A regra antiga (`existe operacao.json`) aceitava um duble como
209|instalação.
210|
211|A correção é pelo critério da **declaração**, não do nome: uma instalação publica a **sua configuração** ao lado da
212|operação (`operacao.json.config.json`); um corredor de bancada escreve só `operacao.json`. As pastas sem a
213|configuração ficam de fora e são **contadas e ditas** no critério da tela — medido:
214|
215|```
216|descoberta: nenhuma viva: a mais recente · 1 corredor(es) de bancada ignorado(s): sem operacao.json.config.json (bancada-de-prova-xyz)
217|instalacoes: ['teste-de-auditoria']
218|```
219|
220|Prova viva: com o `provar.sh` a correr (a criar fixtures), a tela **manteve-se** em `teste-de-auditoria`.
221|
222|## 10. A vista de configuração como DASH, os comandos e a CRIAÇÃO (03/10/2026)
223|
224|A configuração era **quatro blocos empilhados com parágrafos** («o segredo não passa por aqui…», três parágrafos a
225|explicar a porta de escrita) — a mesma doença da landing page, noutra vista. Refêita com a mesma medicina:
226|
227|| antes | agora |
228||---|---|
229|| 4 blocos empilhados, cada ficha com `h3` e uma lista de campos | **três colunas**: o que existe (fichas + contas) · a ficha escolhida · o conferidor e a escrita |
230|| parágrafos de explicação | `title`, coluna, ou saída da tela (`segredo · por caminho, não se abre`) |
231|| o relatório do conferidor em prosa, aberto | `<details>` de **1 linha** («o relatório dele (8 linhas)»), com o texto a um clique |
232|| campos em `.item-de-config` (divs) | **tabelas densas** `chave | valor`, com o valor alinhado à direita |
233|
234|E duas coisas NOVAS, que era o que faltava:
235|
236|**A faixa de COMANDOS** (mandato · ciclo de vida · pedidos), sempre no ecrã:
237|- **o mandato, por par**: `rodar` / `enviar` — escreve a FICHA pela porta que já existe (`POST /api/ficha`), com o
238|  candidato validado pelo conferidor antes de tocar no ficheiro. É o `bash tools/ligar-par.sh <PAR> sim|nao` com
239|  validação e registo;
240|- **o ciclo de vida**: `iniciar` / `parar` a observação — o painel **PEDE** (`POST /api/verbo` → uma fila em
241|  `~/.config/mesacore/pedidos-de-verbo.jsonl`), e quem executa é a camada de operação. **Nenhum processo arranca
242|  do painel**: não há lá um `spawn` nem um `kill`, pelo mesmo princípio que proíbe um formulário de ordem. O pedido
243|  leva o comando que o executa, e a tela mostra-o;
244|- **os pedidos à espera**: criar (pedir), ler (a lista) e cancelar (apagar) — o CRUD completo da fila.
245|
246|**A CRIAÇÃO** (`+ ficha de par`, `+ conta`, `+ setup`): uma capacidade nova do escritor (`criar()`, em
247|`tools/escrever-ficha`), com a guarda que substitui a impressão — **o ficheiro não existir**. Duas famílias, dois
248|conferidores (fichas → `fichas.py`; contas → `verificar-config`), candidato validado numa cópia temporária, escrita
249|atómica e registo com `"criado": true`. Um **setup** não se cria num formulário: é um plugin (manifesto + código), e
250|a tela diz isso em vez de fingir.
251|
252|**Medido** (porta real, na 8790):
253|
254|```
255|criar ficha (candidato incompleto)   → RECUSADO: o conferidor REPROVOU o candidato — nada foi criado
256|criar ficha (composto como a tela)   → SIMULAR: ok, aprovou, nada escrito
257|                                     → CRIAR:   ok, escrito, «ficha 4 conferidas · 0 falhas» e linha no registo
258|                                     → outra vez: RECUSADO («já existe … criar não é sobrepor»)
259|verbo desconhecido                   → RECUSADO: «verbo desconhecido («rebentar»): os que existem são iniciar, parar»
260|conta com «hl; rm -rf /»             → RECUSADO: «a conta não tem forma de nome de conta»
261|pedir o MESMO verbo duas vezes       → a fila fica em 1 (um gesto repetido não é dois pedidos)
262|o GET da fila sem o cabeçalho        → 403 (403 também sem origem, nas escritas)
263|```
264|
265|Defeito apanhado a medir nesta fatia: o `GET /api/verbo` levava **403 vindo da própria página** — o browser só põe
266|`Origin` em pedidos que MUDAM, e o guarda exigia-o em todos. A guarda passou a ser sobre a escrita (POST/DELETE);
267|a leitura da fila pede o cabeçalho da própria tela. E um erro no `conferirCandidato`: uma primeira versão corria o
268|conferidor **sem o argumento da pasta**, e o veredicto saía sobre a árvore VERDADEIRA (3 fichas — e o candidato sem
269|linha nenhuma). A leitura passou a ser explícita: `fichas.py <pasta-da-cópia>`.
270|
271|## 11. O recolhido, o formulário pelo conector, a escrita e a FONTE (03/10/2026)
272|
273|Quatro pedidos, e cada um com a sua prova — as três provas abrem o painel num **Chrome headless** (o mesmo motor
274|do dono) e duas delas falam com o `servidor.ts` **a sério**, pela porta que o gesto do dono usa.
275|
276|### (a) O recolhido que desaparecia — o invariante passa a comportamento
277|
278|A regra estava escrita num comentário do CSS («a secção recolhida conserva a cabeça»), e as três secções do «lado
279|de dentro» nasciam com `<h3>` — recolhiam e **desapareciam com o botão dentro**. A raiz não é a regra: é a
280|promessa só viver num comentário. O `nucleo.js` ganhou `podeRecolher(el)` e o gesto **recusa recolher** uma secção
281|cujo `[data-alternar]` não viva num filho que o CSS conserva (`.cabeca`/`header`/`h4`) — ficar aberta é feio,
282|ficar sem forma de reabrir é perder a tela — e o defeito fica **dito** em `window.__erros`.
283|
284|**Medido** (`prova-do-recolhido.ts`, uma passagem no DOM real + uma provocação):
285|
286|```
287|as secções da tela (o DOM real): 7 de 7 recolheram e CONSERVARAM o botão que as abre
288|   vivas · dentro:mercado · dentro:risco · dentro:decisoes · matriz · leitura · registo
289|a provocação (cabeça sem .cabeca, botão fora dela):
290|   FALHA prova:mal-formada     recolheu=false · botão visível=true · (o guarda recusou)
291|   recolher à força (sem o guarda) perdia mesmo o botão? sim — o defeito era real
292|   o guarda DIZ o defeito? sim
293|```
294|
295|O critério é **duplo** (recolheu E o botão continua visível): é isso que faz uma secção nova, mal formada, deixar
296|o teste **vermelho** em vez de passar em silêncio. E a provocação prova que o teste não é cego.
297|
298|### (b) Criar conta: o formulário nasce do que o CONECTOR declara
299|
300|O formulário era fixo em HTML (4 campos) e clonava a conta existente — servia o Hyperliquid e mais nada. Agora o
301|**`questionario.json` de cada plugin** (o MESMO ficheiro que a entrevista de linha de comando segue) é a fonte:
302|o fio publica o `catalogo` e a vista só o segue. **O cTrader passou a declarar os seus 17 campos**
303|(`brokers/ctrader/questionario.json`, novo), e o Hyperliquid já declarava 14.
304|
305|**Medido** (`prova-do-catalogo.ts`, pela porta a sério):
306|
307|```
308|o catálogo vem dos questionários dos conectores (3 conectores publicam campos)
309|   ctrader              brokers/ctrader/questionario.json · 17 campos · 4 sensível(is)
310|   hyperliquid          brokers/hyperliquid/questionario.json · 14 campos · 1 sensível(is)
311|   zz_prova_catalogo    … (criado pela prova e apagado no fim — o conector que ainda não existia)
312|cada questionário publicado entrou no catálogo (3 de 3)
313|o formulário pede exactamente os campos declarados (16 de 16) + o nome do ficheiro
314|sem os obrigatórios que o conector não traz por omissão, RECUSA (não presume)
315|   a tela nomeia o campo que falta: «Qual o ID da conta no cTrader (ctidTraderAccountId)? …»
316|ctrader: com as omissões declaradas + os obrigatórios, o conferidor APROVOU
317|hyperliquid: idem
318|o campo de SEGREDO (chave_privada) NÃO é um campo de digitação
319|o documento leva a REFERÊNCIA (ficheiro:…<conta>.key), nunca o valor do segredo
320|a conta foi criada pela tela: config/contas/zz-prova-do-catalogo.json existe
321|criar duas vezes RECUSA (criar não é sobrepor)
322|o fio não leva nenhum valor com cara de chave privada fora das impressões (0 encontrados)
323|```
324|
325|**Acrescentar um conector novo = acrescentar um ficheiro.** A prova criou um conector de bancada
326|(`brokers/zz_prova_catalogo/questionario.json`), verificou que o seletor e o formulário nasceram dele **sem se
327|tocar em `web/`**, e apagou-o. E um defeito real ficou corrigido pelo caminho: **trocar de conector mantinha o
328|nome do ficheiro do conector anterior** — um formulário trocado criava um ficheiro com o nome de exemplo do
329|primeiro.
330|
331|### (c) Escrever ficha pela tela (o `POST /api/ficha`, com os guardas do portão)
332|
333|Já existia o caminho; o que faltava era a prova. **Medido** (`prova-da-escrita.ts`, com o `servidor.ts` a sério e
334|uma ficha de bancada criada e apagada pela prova — com uma **trava** que a impede de escrever numa ficha do dono):
335|
336|```
337|a ficha de bancada foi criada: fichas/sigma/ZZPROVA-hl-teste-plugin.json
338|um valor dentro da banda valida e oferece escrever — VALIDADO: NADA FOI ESCRITO | 1.1 → 12
339|um valor fora da banda é RECUSADO com os números: «ficava ACIMA da banda da própria ficha (1–20)»
340|o candidato que o conferidor reprova NÃO é escrito — e o RELATÓRIO dele é mostrado tal e qual
341|uma página velha (impressão diferente) não passa por cima: «a ficha mudou desde que a abriste»
342|o ficheiro passou a ter o valor que o dono compôs: cabecalho.saldo_pct=12 (tipo string, D4)
343|```
344|
345|### (d) O que a tela dizia sem se saber de onde vinha — agora diz a FONTE e a IDADE
346|
347|**A resposta à pergunta** («a secção MERCADO mostra `lido: ha' 7,6 h` … de que corrida é isto?»), medida:
348|
349|| o que | medido |
350||---|---|
351|| a unit serve, hoje | `corrida-de-risco` (`descoberta: explicita (--corrida)`) |
352|| a operação dessa corrida | escrita às **05:36:26** — parada desde o reinício da máquina (≈14,5 h de idade) |
353|| a de `teste-de-auditoria` (a viva de hoje) | escrita às **11:29:34** (≈8,6 h) |
354|| o `lido: há 7,6 h` da imagem | corresponde a uma operação de ~11:26 — **a `teste-de-auditoria`**, a corrida certa |
355|| `livro: não publicado` | **não é do venue**: é uma ausência declarada no contrato (o operador não publica `mercado.livro`) |
356|| os dados do bloco | do venue, mas **VELHOS** — a máquina reiniciou e matou o operador; o ficheiro ficou congelado |
357|
358|E a correção, para a pergunta não voltar a existir: **cada bloco passou a dizer a sua fonte e a sua idade**. O fio
359|traz `fontes` (caminho + `em_ms`) por mesa (`operacao.json`, `registo.jsonl`, `operador.log`) e por par
360|(`velas-<PAR>-<relogio>.jsonl`, a ficha), e a tela mostra-as nas cabeças com o `fonteEIdade` — a idade é calculada
361|**do instante absoluto**, para envelhecer com o ciclo de 2 s em vez de envelhecer com o fio.
362|
363|**Medido** (Chrome headless, 1440×900 e 390×844; fio real, cópia própria da tela):
364|
365|```
366|#fonte-das-vivas    operacao.json · 8.5 h
367|#fonte-da-matriz    registo.jsonl · 8.5 h
368|#fonte-da-leitura   velas-BTC-30m.jsonl · 8.5 h · BTC-hl-teste-plugin.json · 9.1 h
369|#fonte-do-registo   registo.jsonl · 8.5 h · operador.log · 8.5 h
370|dentro:mercado  MERCADO | operacao.json · 8.5 h
371|dentro:risco    RISCO EM VIGOR | BTC-hl-teste-plugin.json · 9.1 h
372|dentro:decisoes DECISÕES DESTE PAR | registo.jsonl · 8.5 h
373|```
374|
375|**Defeitos apanhados a medir nesta passagem** (todos corrigidos): o `grafico.js` rebentava quando o fio não trazia
376|a série (o `painel.json` a ficar leve) e deixava a tela desenhada a MEIO; a `fonte` transbordava a cabeça de
377|306 px (a idade é que era cortada — passou a mostrar o nome do ficheiro, com o caminho no `title`); a pílula do
378|lado transbordava a coluna da matriz em 2 px (30 → 34).
379|
380|### A verificação desta fatia
381|
382|- **`provar.sh`: 42 de 42** — a porta COMPLETA (com as três provas da tela somadas às bancadas de operação);
383|  na `--rapido`, **27 de 27**. O portão continua a decidir o que devia, e explica o que não fez.
384|- **`tipos.sh`: 0 erros em 6 directórios** (o tsc confere o produto e as bancadas novas).
385|- **0 erros na página** em todas as passagens; **0 transbordos** fora dos scrollers por desenho (a tabela da
386|  leitura e a matriz, que rolam dentro do bloco); **página sem rolagem** no computador e **sem rolagem
387|  horizontal** no telefone.
388|- **A árvore termina declarada**: o que a bancada cria (um conector, uma conta, uma ficha) é apagado por ela; o
389|  que fica sujo é o trabalho desta fatia (e o do dono, que já lá estava).
390|
391|### E o que fica para o dono decidir (não é desta sessão)
392|
393|- **A unit do painel tem de ser reiniciada** para o `servir.sh` novo (a descoberta) entrar em vigor — é a razão
394|  por que a tela mostra a corrida de ontem. É mudança de host → vai ao `sysadmin` com a especificação.
395|
396|## 12. A AUDITORIA — duas fontes de verdade, e as três raízes (04/10/2026)
397|
398|Três defeitos medidos no mesmo dia, todos com a mesma raiz: **DUAS FONTES DE VERDADE** para a mesma tela. A
399|correcção é da raiz, não do sintoma.
400|
401|### (A) Uma fonte de verdade — UMA pasta servida, UM gerador
402|
403|O que estava medido: o código do painel vive em `web/painel/`, mas um servidor servia
404|`~/.hermes/…/scratch/painel-v2/` — uma **CÓPIA editável à mão** de horas antes, sem as correcções. O dono via o
405|recolhimento partido (o fix existia em `web/painel/` e não na cópia) e a tela a dizer «SEM DADOS HÁ 17,2 H» com o
406|sistema a correr. Havia também a metade do servidor: o `servir.sh` corria dois laços `while` a gerar o fio e o
407|`servidor.ts` só servia — a tela dependia de os dois coexistirem.
408|
409|**Correcção:** a cópia à mão saiu do caminho (`scratch/painel-v2` e `scratch/painel-teste`); o **servidor passou a
410|ser o gerador** (`--intervalo`/`--intervalo-vivo` dentro do `servidor.ts`, com o `--para` do retrato **sempre
411|dentro da `--pasta` que ele serve**), e o `servir.sh` passou a **lançador** (com `exec` — a unit vê um só processo,
412|e os ciclos morrem com ele).
413|
414|**Prova (`prova-da-fonte.ts`, no portão):** arranca o servidor com os argumentos da unit e mede, ficheiro a
415|ficheiro, que o que a tela serve é **byte a byte** o do repositório —
416|
417|```
418|cada ficheiro servido é byte a byte o do repositório (16 de 16)
419|o painel.json servido é o mesmo ficheiro que está em web/painel/ (o gerador e o servidor são o mesmo processo)
420|o mesacore-painel.service NÃO passa --pasta · o servir.sh NÃO passa --pasta ao servidor
421|nenhuma cópia servível da tela no scratch (nenhuma)
422|a provocação: uma pasta divergente é APANHADA (sha da cópia ≠ sha do repo)
423|```
424|
425|### (B) O sistema inteiro visível — o que está vivo, o que está parado, e as horas
426|
427|**Medido no DOM** (fio de bancada, `prova-do-vivo.ts`): `1 pos · 1 ord` com a posição (BTC · buy · 0.004) e a
428|ordem (`oid-9`); a matriz `trava` + `ciclos` + `há 1.7 h`; a última barra com o dia e a hora (`barra 04/10,
429|04:00`) e a leitura a viajar com o preço; as três secções do «lado de dentro» a dizer a fonte+idade e a
430|**sobreviverem ao recolhido**. O que faltava e foi acrescentado: **o ciclo mais recente passou a trazer a HORA**
431|(a linha `última` da secção DECISÕES DESTE PAR).
432|
433|### (C) O log e o retrato — o log do operador é MISTO
434|
435|A tela mostrava «FALTAS DO RETRATO — linha ilegível em operador.log: nao e' JSON: linha truncada». Mediu-se o
436|`operador.log` da corrida viva: **297 linhas, 0 inválidas** na altura — as linhas contadas eram **história**
437|(das corridas anteriores, já truncadas no arranque seguinte). Mas a raiz existia em dois sítios:
438|
439|1. **o eco do operador partia linhas**: o handler do `conector.stderr` partia por `\n` **sem guardar o resíduo** —
440|   um `data` que caísse a meio de uma linha JSON fabricava, deste lado, duas linhas ilegíveis. Corrigido com o
441|   buffer (`vigia/linhas.ts`, provado em bancada);
442|2. **o leitor do log era estrito**: o `operador.log` é um log MISTO por desenho (as linhas do operador são JSON; o
443|   conector fala em PROSA, reemitida intacta; mais o marcador `[<data>] fim` do lançador) e o `retrato` tratava
444|   toda a prosa como falta. Passou a reportar só o que **tem cara de JSON partido** (começa por `{`).
445|
446|**Prova (`prova-do-log.ts`, no portão):** o buffer junta o resíduo e a linha sai inteira (sem ele, viraria duas
447|ilegíveis); contra uma cópia de uma corrida real, a prosa dá **0 faltas** e um `{` que não fecha dá **1 falta
448|nomeada** — com o par de controlo (o leitor estrito antigo contava 3).
449|
450|### A verificação desta fatia
451|
452|- **`provar.sh`: 45 de 45** — a porta COMPLETA (as três provas novas somadas às 42); `tipos.sh`: **0 erros em 6
453|  directórios**.
454|- **A árvore termina declarada**, e a unit do painel **continua a correr o código antigo em memória** até ser
455|  reiniciada (é mudança de host: vai ao `sysadmin`), pelo que a correcção do `servidor.ts` só vale no religar.
456|
457|### O que a auditoria NÃO tocou, dito
458|
459|- **O sistema em observação não foi tocado** (operador + mesa + conector + feed, posições na conta de teste): as
460|  provas novas medem contra fios de bancada e cópias em scratch, e o `prova-da-fonte` arranca o servidor com
461|  `--intervalo 0` (não escreve fio nenhum).
462|
463|## 13. AS FALHAS DE CONSTRUÇÃO E O ARRANQUE DE PRIMEIRA VEZ (04/10/2026)
464|
465|O estado de partida era o de **primeira execução**: host limpo, sistema parado (nenhum processo do MesaCore,
466|nada a ouvir em `192.168.15.24:8788`, a unit `inactive (dead)` e **`disabled`**, o scratch a **zero** directorios,
467|o venue plano — 991,63 USDC, 0 posições, 0 ordens). Sete frentes, por ordem de risco (dinheiro primeiro), cada
468|uma com a prova que a mede.
469|
470|**`provar.sh`: 52 de 52** (era **45**) · `tipos.sh`: **0 erros em 6 directórios** · fallbacks **0** · a contagem
471|do portão corrigida onde era repetida (o `provar.sh`, este plano, o `ONDE_ESTAMOS.md`, o `README.md`).
472|
473|### A. O arranque de primeira vez — um caminho só, e o arranque não cala
474|
475|**O que faltava, medido:** nenhum caminho documentado levantava o sistema do zero; a unit estava `disabled` (não
476|voltava sozinha depois de um reinício) e o lançador **prometia o que não cumpria** («nenhuma ficha do repositório
477|diz `enviar: true`» — e as três fichas dizem, desde 02/10/2026).
478|
479|**O que ficou:** um caminho no `tools/painel/README.md` (secção **O arranque de primeira vez**), e a verificação
480|extraída para um comando próprio — `tools/checar-o-arranque.sh` — que o lançador corre ANTES de levantar processo
481|nenhum. Ele diz **pelo nome** o que falta (a conta, a credencial por referência, as fichas ligadas) e **conta as
482|fichas ARMADAS ao venue** (`enviar: true`), em voz alta. A unit ficou **`enabled`**.
483|
484|**Medido agora (o arranque real, não a intenção):**
485|
486|```
487|systemctl --user is-enabled mesacore-painel.service   -> enabled
488|systemctl --user is-active  mesacore-painel.service   -> active (MainPID 1001579, e 1003522 depois de um restart)
489|GET http://192.168.15.24:8788/index.html               -> 200    ·   painel.json -> 200
490|fio: mesas ['observacao'] · estado em_operacao · descoberta «operacao.json escrito ha' <= 300 s»
491|venue: equity 991,62 · 0 posicoes · 0 ordens (no arranque)
492|```
493|
494|**Prova no portão:** `prova-do-arranque.ts` — contra repositórios de bancada, exige que cada falta seja dita pelo
495|nome e que o arranque RECUSE; e prova que o aviso das fichas armadas **não sai sempre** (o controle de uma ficha
496|ligada e desarmada). O `prova-do-log` foi tornado **auto-suficiente**: ele dependia de uma corrida em
497|`scratch/teste-de-auditoria` que a limpeza apagou (era a ÚNICA prova vermelha no portão do arranque de primeira
498|vez — `ENOENT`), e passou a construir a sua própria corrida.
499|
500|### B. A colisão de referências — com a cronologia, e uma decisão do dono
501|
502|**Cronologia medida (a régua, sem adjectivos):**
503|
504|| quando | o que | cru |
505||---|---|---|
506|| 09:15:05 | o ETH mandou a referência `mesa-sigma_v0-000007` | `classificacao: recusado · motivo: referencia_ja_enviada_ao_venue` — o `cloid` derivado já existia no venue, de uma corrida anterior; **nada foi enviado** |
507|| 09:37:10 | a `mesa-sigma_v0-000029` saiu | `classificacao: aceite · oid 61809804678` · a posição ETH **sell 0.004 @ 2695,7** abriu (marca 29) |
508|
509|A referência é `mesa-<setup>_v<major>-<ciclo>` e o `cloid` é `sha256(domínio + conta + instrumento + referência)`.
510|O **tratamento do venue está certo** (a P6 mediu que o mesmo `cloid` duplicava a ordem); o que estava errado era a
511|**referência repetir**: o contador `ciclo` **começava em 0 em cada arranque** da mesa (`core/servidor.ts`).
512|
513|**Decisão do dono (04/10/2026):** *persistir o contador de ciclos entre arranques* — a mesa passa a **continuar de
514|onde o registo ficou** (`ultimoCicloDoRegisto`), sem mudar a forma da referência. Prova no portão:
515|`ciclo-continua.ts` (mesa a sério com o registo a 47 → a volta nova sai em **48**; o controle, registo vazio, em
516|**1**; **reprova** com o defeito reposto).
517|
518|**O LIMITE, medido e DITO (não escondido):** continuar o contador só conta se o **registo sobreviver**. O scratch é
519|podado; numa pasta de corrida nova o contador volta a 1 e pode colidir outra vez — foi o que aconteceu acima (a
520|corrida começou vazia, o contador voltou a 1, e a 7 colidiu). E o risco não é um atraso: a regra é «a entrada só
521|acontece na **barra do flip**», logo uma referência recusada nessa barra **perde a entrada** (salvou-se aqui por o
522|ETH ter voltado a propor na 29). Fica declarado no código (`core/estado/registo.ts`) e aqui: a via para o corrigir
523|(o conector a devolver a recusa e a mesa a re-emitir com referência NOVA) é decisão do dono e **não** se inventa.
524|
525|### C. O gráfico e o vão — marcado e nomeado
526|
527|O vão era **REAL** (0 duplicados nos três pares e 0 no fio), e o feed **já o nomeava** (`buraco_no_historico`),
528|mas nunca chegava ao ecrã. Agora o produtor calcula os vãos das velas (`buracos.ts`, passo medido do próprio dado)
529|e a tela **marca-os** (um marcador na barra seguinte, com `↔N`) e **nomeia-os** no cabeçalho do gráfico:
530|`vão 03/10, 14:00→04/10, 07:30 · faltam 34`. Nunca se inventa a barra que faltou. Prova no portão:
531|`prova-dos-buracos.ts` — os **dois** vãos medidos (1 barra e 17,5 h / 34 barras) e o controle (sem vão, nenhum
532|aviso).
533|
534|### D. O dash de configuração — os quatro números do dono
535|
536|| | antes | depois |
537||---|---|---|
538|| alvos de toque < 44 px **no telefone** (390×844) | **13 de 13** (30 px) | **0** (44 px) |
539|| campos de formulário na vista (a ler) | 0 | 0 (a edição vive na vista, não num diálogo) |
540|| chaves do documento em **mais de um sítio** | **6** (conta/setup/relógio/ao_desligar × procedências; run/enviar × faixa) | **0** |
541|| o **diálogo legado** (segunda porta, só leitura) | presente (`#dialogo`) | **removido** — o botão `config` do gráfico passou a `<a href="#configuracao">` |
542|
543|O gesto principal de editar a ficha («mudar esta ficha») e os dois interruptores estão **à vista**, na vista. Prova
544|no portão: `prova-do-dash.ts`, com **provocação** (a mesma chave injectada noutro sítio faz a contagem subir) e o
545|fio **vazio** medido (sem fichas, a vista diz que não há ficha — não fica em branco). No computador os botões ficam
546|a 21 px de propósito: 21 px é a densidade do terminal (a régua dos 44 px é a do **toque**, no telefone).
547|
548|### E. A porta de credencial pela tela
549|
550|**O que faltava:** o valor da Hyperliquid vivia num ficheiro que **nenhuma ferramenta escrevia**; a tela dizia
551|«segredo · por caminho · não se abre» e não tinha caminho de escrita. **O que ficou:** a MESMA porta de escrita
552|(`tools/guardar-credencial.sh`), estendida com um modo que lê o valor **pelo stdin** (`gravar-de-stdin`), e o
553|`POST /api/credencial` no servidor, com as guardas da porta das fichas (origem + cabeçalho próprio). O campo nasce
554|do `questionario.json` do conector (`tipo: segredo`); a conta continua a apontar por **referência**.
555|
556|**Medido** (`prova-da-credencial.ts`, com o servidor a sério e uma pasta de credenciais de **bancada**):
557|
558|```
559|gravado: 600 <pasta>/zz-bancada.key · conteudo == o valor colado
560|resposta: forma {comprimento, primeiros} + impressao sha256 — o VALOR nao aparece (busca literal)
561|registo : instante, ficheiro, ORIGEM («vista de configuração»), impressao — o VALOR nao esta' la'
562|guardas : sem cabecalho -> 403 · origem diferente -> 403 · ficheiro fora da pasta -> 400
563|          derivar a conta do dono (fora da pasta) -> 400 · valor curto -> 409, e nada e' criado
564|limpeza : o ficheiro que a bancada criou e' apagado no fim
565|```
566|
567|### F. Duplicados/contaminação do feed — a prova da classe
568|
569|A bancada do feed (**16 provas**, era 15) ganhou a **troca de dono inteira**: derivado → fonte → derivado outra
570|vez (a agregação tem de se calar quando a barra do venue chega e **voltar** a compor no período seguinte). E a
571|**prova negativa** — `bash brokers/hyperliquid/casos/prova-negativa-do-feed.sh` — **reprovou 10 de 10** com os
572|defeitos repostos, incluindo o que o dono nomeou (a agregação a **mutar a barra do venue**), e a bancada voltou ao
573|verde com o ficheiro restaurado (selo por `sha256`).
574|
575|### I. O «TRAVADO» QUE PINTAVA O PAR A OPERAR, E A ORDEM QUE ABRIU A POSIÇÃO (04/10/2026)

**O que se mediu, e o que o dono via.** O painel **batia certo com o venue**: `clearinghouseState` devolvia
`szi: "-0.004"` (**short** 0.004 @ 2692,3) e `frontendOpenOrders` devolvia **0 ordens** — exactamente o que a tela
mostrava (`1 pos · 0 ord`). E o sistema estava a operar: **273 preenchimentos** na corrida, o ETH (1m) a alternar
`Long > Short` / `Short > Long` a cada minuto. O que estava errado era o painel **contradizer-se e chamar «travado»
ao par que operava** — e não deixar casar a posição com a ordem que a abriu.

**A raiz, medida no código (duas correcções, por ordem):**

1. `oQueTrava` devolvia `travado: quantos > 0` — **uma volta** sem ação bastava. O ETH saía `travado, 1 ciclo`, e como
   o `vivo.json` (2 s) e o `painel.json` (60 s) são gerados em instantes diferentes, o contador **oscilava 2↔3**;
2. a correcção seguinte («abstenção de mais de uma barra do próprio par») ainda oscilava num par de 1m — onde «mais
   de uma barra» são **dois minutos** — e ainda **calava um defeito de uma só volta**, o que é pior.

**A régua que ficou** (`tools/painel/travado.ts`, módulo puro): a palavra depende da **natureza do motivo**, não do
tempo. **ESPERA** é abstenção (o setup não tem nada a dizer) — dita como «à espera de sinal», em tom neutro, com a
duração. **ATENÇÃO** é a mesa não ter conseguido (sem leitura, sem margem, desfecho recusado, posição desconhecida…)
— é a única que usa **«travado»**. A lista dos motivos de espera é **fechada**; um motivo fora dela conta como
ATENÇÃO. E a corrente passou a ser a do **motivo vigente** (antes guardava o motivo do *início* da corrente, e um
defeito já passado continuava a ser mostrado como o que trava agora).

| o que | antes | depois (medido no painel da unit) |
|---|---|---|
| a fita | `3 TRAVADO(S)` | `2 à espera de sinal há 8,0 h` |
| a matriz | `3 travado(s)`, ETH com `sem lado` | `2 à espera de sinal`, ETH com `—` |
| as posições vivas | `3 travados` | `2 à espera` |
| o bloco do risco | a ficha (26,5 h) a **vermelho** | cinza — a idade de um **documento** não é alarme |
| os vermelhos da página | 3 | **0** |

**A ordem que abriu a posição (a ligação que já era requisito).** Cada posição passou a trazer, por baixo, a ordem
nossa que a abriu — ligada pela marca de posse: o `oid` do venue, a hora, a referência e o preço médio. Vive em
`tools/painel/desfechos.ts` (`marcadorDosDesfechos` + `ordemDaPosicao`), com o `retrato.ts` só a ler os
`desfechos-<conta>.jsonl`. Uma marca com recusa e reenvio vale pela **última** linha; sem desfecho para a marca,
diz-se o porquê — **nunca um `oid` a fingir**. Ao vivo:

```
ETH   buy   0.004   2698,7   inverteu
      ordem que a abriu · oid 61834639077 · 04/10, 14:07 · mesa-sigma_v0-000479 · aceite · 2698,7
```

**O formulário («considera isto um form organizado?»).** Os campos do questionário passaram a **três linhas**
(pergunta · controle · régua com a chave e a omissão declarada) e a **secções** pela raiz da chave (`conta.*` →
«A conta», `conexao.*` → «A ligação ao venue»). Antes saía tudo colado numa célula — `…?texto ·
obrigatórioconta.identificador` — com a pergunta repetida ao lado do campo. Medido no DOM: **0** linhas em tabela
rasa, 15 campos em 2 secções.

**Prova no portão:** `prova-do-travado.ts` (as naturezas, o defeito de uma volta a NÃO ser calado, o motivo
desconhecido = atenção, e as DUAS réguas antigas a errar na provocação), `prova-da-ordem.ts` (a ligação, a recusa +
reenvio, e o sem-desfecho a dizer-se) e `prova-do-vivo.ts` (no DOM: `1 travado(s)` e `à espera de sinal` ditos em
separado, e a linha da ordem com o `oid`).

### G. A verificação
608|
609|- **`provar.sh`: 52 de 52**, exit 0 (as sete provas novas somadas às 45 — as últimas são as do `travado` e da ordem que abriu a posição).
610|- **`tipos.sh`: 0 erros em 6 directórios**; **fallbacks 0**; a árvore termina declarada (o que as bancadas criam,
611|  apagam).
612|
613|### H. UMA SESSÃO SÓ, E A TELA NUNCA VELHA (a exigência do dono, medida)
614|
615|**O que estava por trás do que o dono viu.** O painel que ele abria **era** o novo (o botão `recarregar` e o bloco
616|da credencial são desta vaga) — mas a **aba aberta antes** do restart continuava a desenhar o código antigo: a página
617|é um `<script type="module">`, e a renovação de 2 s/60 s só a redesenha com o módulo **que ela já carregou**. Duas
618|abas abertas em momentos diferentes = **duas telas diferentes**. E o «cheio de erros», medido, eram três coisas:
619|(i) abrir **«+ conta»** abria uma **parede vermelha** («campo(s) obrigatório(s) em falta — …») antes de o dono
620|escrever nada, e num formulário de **cTrader** (17 campos) quando a conta dele é da Hyperliquid; (ii) um **Chrome de
621|bancada órfão**, deixado por uma bateria que morreu a meio, ficou **6 h** a bater no painel — uma segunda sessão.
622|
623|| garantia | como se cumpre | prova |
624||---|---|---|
625|| **nunca duas sessões do dash** | uma tela, um servidor, uma pasta (a unit + `prova-da-fonte.ts`); e o `provar.sh` **varre os clientes-fantasma órfãos** (ppid=1) antes e depois de cada bateria | `prova-da-fonte.ts` · a varredura no `provar.sh` |
626|| **nunca desatualizada** | o fio leva `tela_em_ms` — a versão dos ficheiros da tela, medida no **disco** (não escrita à mão); a página compara-a em cada leitura (2 s) e **recarrega-se sozinha** | `prova-do-dash.ts` — cargas `1 → 2`, versão `1000 → 2000`; **reprova** (`1 → 1`) sem a comparação |
627|| **criar conta sem parede de erros** | o que **falta preencher** vai em tom **neutro** («por preencher (N): …»); o vermelho fica para a **RECUSA** a sério. E o formulário abre no conector **que já se usa** | `prova-do-dash.ts` — `por preencher (1): qual a conta (endereço)?` neutro, **0** recusas no arranque, conector **`hyperliquid`** |
628|
629|**Medido ao vivo (04/10/2026, 1440×900, painel da unit):** o fio e a página com a **mesma** versão
630|(`1791129781181`); o `+ conta` abre no **`hyperliquid`** com `por preencher (3): Qual o ENDEREÇO (master) da conta na
631|Hyperliquid? · Quantos dias do ledger ficam integrais? · E depois desses dias, o que fica do l…` em tom neutro e
632|**zero** recusas vermelhas; **0 erros** na página (excepções, promessas rejeitadas e `console.error` apanhados antes
633|de cada documento).
634|
635|