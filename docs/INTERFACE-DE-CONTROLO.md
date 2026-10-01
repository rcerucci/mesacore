# A INTERFACE DE CONTROLO — desenho, decisões e o que ainda falta

escrito 30/09/2026 · contrato 1.9.0 · medido contra a corrida de observação viva
(`~/.hermes/profiles/appbuilder/cache/scratch/corrida-de-risco`, 2 pares, 505 barras cada)

Este documento é o **pensar do layout** antes (e por baixo) do código: o que cada painel mostra, de onde vem
cada número, e onde estão as fronteiras que a tela **não** atravessa. O que aqui está como medido foi medido
nesta sessão, com o comando ao lado; o que não foi medido diz-se **não medido**.

Peças: `web/painel/` (a tela), `tools/painel/retrato.ts` (o leitor que faz o fio), `setups/<nome>/sobreposicao.ts`
(a série que cada setup publica para se desenhar).

---

## 1. O que esta interface é, e o que se recusa a ser

É a superfície de **monitoração, configuração e controle** de uma instalação do MesaCore: ver o que está vivo,
ver o que a mesa decidiu e porquê, ver a configuração em vigor por par, e **pedir** mudanças de estado.

Não é, e não vai ser:

- **não é uma segunda via de execução com dinheiro.** Não há formulário de ordem, nunca. Um botão de "comprar"
  na tela seria uma segunda porta para o venue, fora do portão da mesa — e é a única coisa que este desenho
  proíbe por princípio, não por segurança.
- **não arranca processos.** Quem monta processos é a camada de operação (RN-E21). A tela **pede**; o vigia
  executa.
- **não calcula o que o sistema sabe** (RN-E9). Preço, posição, decisão e **a série do indicador** vêm de quem
  já os calculou. Não há uma segunda conta de nada no browser.
- **não mostra a topologia** (RN-E10): uma mesa com dois instrumentos e duas mesas com um cada parecem iguais.

---

## 2. A paleta — medida na fonte, não copiada a olho

A paleta é a da Hyperliquid, e foi **extraída do CSS que o próprio app serve**:

```bash
curl -sL https://app.hyperliquid.xyz/ -o hl.html                         # acha o bundle
curl -sL https://app.hyperliquid.xyz/assets/config-D_PV_vWJ.css -o hl.css
grep -oE '\-\-[a-zA-Z0-9-]+:[^;]+;' hl.css | sort -u                     # os tokens do tema deles
```

Os tokens que eles **nomeiam** (à esquerda o nome deles, à direita o nosso):

| deles | valor | nosso | para quê |
|---|---|---|---|
| `--hl-surface` | `#0f1a1f` | `--fundo` | o fundo |
| `--hl-surface-inset` | `#273035` | `--painel-alto` | as barras de título |
| `--hl-border` | `#273035` | `--borda` | traços |
| `--hl-text` | `#f6fefd` | `--tinta` | o texto |
| `--hl-text-muted` | `#9aa3a4` | `--tinta-fraca` | rótulos |
| `--hl-accent` | `#97fce4` | `--compra` | o lado comprado |
| `--hl-accent-soft` | `#50d2c1` | `--media` / `--compra-suave` | a média e o corpo da vela |
| `--hl-error` | `#ed7088` | `--venda` | o lado vendido |
| `--hl-accent-text` | `#04060c` | `--tinta-no-acento` | texto **sobre** o acento |
| `#1f2d33` · `#17453f` · `#949e9c` | (no mesmo ficheiro) | `--painel` · `--zona-morta` · `--neutro` | degrau intermédio, fundo do indicador, o "sem lado" |

**Porque é suave aos olhos, e não é impressão:** a tinta nunca é branco puro (é `#f6fefd`, um branco
esverdeado); os dois lados não são verde/vermelho de sinalização (são um menta e um rosa **dessaturados** —
`sat 0.40` e `0.53`); e as superfícies são azul-petróleo, não preto. Num ecrã olhado durante horas é esta a
diferença que se sente.

**O contraste foi medido, não julgado** (`scripts/contraste.py` da skill de tema, sobre `web/painel/tema.css`):

| par | razão | veredicto |
|---|---|---|
| tinta sobre fundo | **17,27:1** | OK |
| tinta-fraca sobre fundo | **6,86:1** | OK |
| compra sobre fundo | **14,61:1** | OK |
| venda sobre fundo | **6,12:1** | OK |
| tinta sobre painel | **13,85:1** | OK |
| tinta-no-acento sobre compra | **16,75:1** | OK |
| neutro sobre zona-morta | **3,89:1** | LIMITE (é figura, não texto: o chão é 3,0) |
| **tinta sobre compra-suave** | **1,81:1** | **FALHA** |

A última linha é a lição que o desenho teve de absorver: **a tinta do texto não serve de fundo de nada**. Um
elemento cheio com o acento (o selo "VENDIDO", o botão) usa `--tinta-no-acento` (#04060c) — e é por isso que os
corpos das velas usam o tom **suave** (`--compra-suave`, `sat 0.62`) e não o acento vivo: num tema escuro, a
tinta clara usada como área grande é a parede mais acesa do ecrã.

Um só sítio de verdade: **toda a cor vive em `web/painel/tema.css`**. O gráfico (canvas) não lê custom
properties — lê-as do documento pela função `cor()`, e é isso que faz o gráfico seguir a paleta em vez de ter
uma segunda.

---

## 3. O desenho da tela

```
┌─ FITA (grudada ao topo, sempre à vista) ──────────────────────────────────────────────────────────┐
│ MesaCore · <identidade da mesa> · [AMBIENTE TESTE] · [EM_OPERACAO]                                 │
│ EQUITY 989,82 USDC · CICLOS 125 · LIGAÇÃO ligada · PARES LIGADOS/ARMADOS 2/2 · RETRATO 23:44 (há…) │
├──────────────┬────────────────────────────────────────────────┬───────────────────────────────────┤
│ PARES        │ O GRÁFICO                                      │ O LADO DE DENTRO                  │
│              │                                                │                                   │
│ ▸ BTC        │ [⚙ configuração] BTC · sigma 0.1.0 · 1h [VEND]  │ POSIÇÃO E MERCADO                 │
│   vendido    │ última barra (a que decidiu): 30/09 22:00      │   bid/ask · último · idade do dado │
│   83557.0    │ ┌────────────────────────────────────────────┐ │   posição · dono · ordens vivas    │
│   pos: —     │ │ velas + média + ZONA MORTA (2 tracejadas)  │ │ RISCO EM VIGOR                    │
│   rodar: sim │ │ + extremo da perna + setas das viradas    │ │   saldo% · alavancagem · bandas    │
│   enviar:sim │ ├────────────────────────────────────────────┤ │ DECISÕES DESTE PAR                │
│              │ │ FAIXA DO SINAL (lado vigente por barra)    │ │   ação:motivo × quantas             │
│ ▸ SOL        │ └────────────────────────────────────────────┘ │                                   │
│   vendido    │ legenda + interruptores do desenho              │ «a configuração abre no botão      │
│   117.89     │ A LEITURA DO SETUP (mid · ma · mid−ma · atr · banda · sig) │  ⚙ ao lado do símbolo»     │
├──────────────┴────────────────────────────────────────────────┴───────────────────────────────────┤
│ REGISTO · o ledger: ciclos por instrumento · mandato (ligar/desligar a quente) · carteiro · desfechos │
│ FALTAS DO RETRATO — nomeadas, quando existem                                                         │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
          ⚙ →  ┌─ configuração · BTC · sigma 0.1.0 ──────────────────[fechar]─┐
               │  OS ITENS DO SETUP · 17 · a partir do template               │
               │   ma_len    inteiro                    24                    │
               │   ma_tipo   escolha                    EMA                   │
               │                                        opções: EMA · SMA     │
               │   usar_banda booleano                  sim                    │
               │   …                                                            │
               │  DE ONDE VEM ESTA CONFIGURAÇÃO                                 │
               │   ficha  fichas/sigma/BTC-hl-teste-plugin.json                  │
               │   setup  sigma 0.1.0 (typescript) · relógio 1h (da ficha)       │
               │  OS DOIS INTERRUPTORES                                          │
               │   rodar  sim    enviar  sim                                     │
               │   bash tools/ligar-par.sh BTC nao                               │
               └─────────────────────────────────────────────────────────────────┘
```

### Porque cada painel está onde está

- **A fita responde à pergunta que se faz ao entrar:** está vivo? em que ambiente? com que equity? há quanto
  tempo é este retrato? Os dois **mostradores de estado** (ligado + armado) ficam aqui porque são a diferença
  entre "a mesa está a olhar" e "a mesa pode mexer dinheiro".
- **Os pares à esquerda, um cartão por instrumento, e cada cartão RECOLHE** (pedido do dono, 01/10/2026). Cada
  cartão tem duas camadas, e a linha entre elas é desenhada de propósito:
  - **o principal, sempre à vista** — símbolo, setup, relógio, preço, **lado vigente** e os dois interruptores.
    É o que se lê de relance quando há muitos pares (medido: **68 px** recolhido contra **166 px** aberto);
  - **o detalhe, só quando se abre** — posição, última decisão, risco e as falhas da leitura.
  Por omissão vêm recolhidos, e a escolha de cada par **fica gravada** (sobrevive ao recarregamento e à renovação
  do retrato, que redesenha a lista a cada minuto — por isso o estado vive numa variável, não no DOM). Há também
  um **«abrir/recolher todos»** na barra da secção, que é o que serve quando os pares forem muitos.
  **No telefone o cartão não abre**, e a medição é a razão: com um cartão aberto a faixa ia a 224 px e empurrava
  o gráfico **21 px** para trás da barra fixa. Aí o detalhe vive no painel «lado de dentro», e o botão e o
  «abrir todos» **saem** — um controle que não muda nada visível é ruído.
- **O botão de abrir/recolher não pode escolher o par.** Ele fica dentro do cartão, que é clicável: o gesto dele
  faz `stopPropagation`, e o `Enter`/espaço no botão não sobe ao cartão. Medido no browser: com o SOL
  selecionado, dar `Enter` no botão do BTC abre o BTC **sem** mudar a seleção.
- **TUDO RECOLHE, E O GRÁFICO NASCE MAXIMIZADO** (pedido do dono, 01/10/2026). O mesmo gesto existe agora em cada
  painel — os **pares**, o **gráfico**, o **card da leitura** (abaixo do gráfico, com cabeça própria), o **lado de
  dentro** (e cada secção lá dentro), o **registo** — e todos guardam a escolha no **mesmo estado**, com a chave a
  dizer que espécie de coisa cada uma é (`par:BTC`, `bloco:grafico`, `bloco:leitura`, `secao:dentro:risco`). O que
  "recolhido" esconde muda de forma para forma (o cartão de um par guarda o principal; um painel guarda só a barra
  de título), mas quem guarda a escolha é um sítio só.
  - **as omissões são uma decisão dita em voz alta**: os cartões dos pares e **o card da leitura** começam
    **recolhidos**, o **gráfico começa maximizado** (é o que se olha), os painéis e as secções começam **abertos**;
  - **um painel recolhido guarda 46–55 px**, contra 189–1005 px aberto — e o gráfico reduzido fica com **47 px**.
    Com os três painéis recolhidos sobra a tela para o gráfico, que é o gesto que isto vem servir quando houver
    muitos pares e muitos setups.
- **O gráfico ao centro, com a estratégia desenhada** (§4) e, por baixo, a **leitura do setup em números** na
  forma exacta em que o motor a fez.
- **O card da leitura tem cabeça própria e recolhe** (pedido do dono, 01/10/2026). Título, **resumo do que está
  lá dentro** e botão vivem no `header`; a matéria (a tabela das barras, o que o setup disse, a última medição que
  ele escreveu) vive no corpo. O resumo é o que faz recolher valer a pena — **sem ele, recolher seria esconder**:
  `5 barras · sig −1 · concorda`. A cabeça fica em **43 px** no computador e **61 px** no telefone, contra **404 px**
  / **538 px** aberta.
  - a **legenda** (média, zona morta, extremo, faixa do sinal) ficou **de fora** do card, à vista: é a chave das
    linhas que o gráfico desenha, e esconder a chave do que se está a ver seria pior do que os 30 px que ela ocupa;
- **A configuração saiu da coluna e passou a diálogo** (30/09/2026, a pedido do dono), aberto pelo botão ao lado
  do nome do símbolo: dezassete campos que se lêem de vez em quando não podem ocupar um terço de um painel que
  se olha sempre. O botão fica **na linha do par que está a ser olhado** — a configuração pertence àquele
  gráfico, não a um canto da tela. Dentro do diálogo: os itens do template, a **proveniência** (que ficha, que
  setup, que relógio) e os **dois interruptores** com o comando exacto que os muda.
  - **Somente leitura, e sem controle que finja.** O valor de um item é **texto**, não um `<input>`/`<select>`
    desactivado: um controle desactivado parece que se muda ali e não se muda. As opções que existem vão ao lado,
    em tom apagado, para se saber o que se estaria a escolher no dia em que a escrita existir (RN-E12/RN-M2).
  - Fecha por **três gestos**: o botão, o `Esc` e o clique fora — e devolve o foco a quem o abriu. No telefone é
    uma **folha de baixo** (no centro do ecrã fica longe do polegar e o teclado tapa-a), com a rolagem do fundo
    travada enquanto está aberta.
- **"O lado de dentro" à direita:** posição (com o dono, vindo da marca), risco em vigor e as decisões daquele
  par — mais um aviso que **aponta a porta da configuração**, porque um controle que existe mas ninguém encontra
  é um controle que não existe.
- **O registo em baixo**, a largura toda: é a fonte de tudo o que está acima e é o que permite cruzar o ecrã com
  a linha gravada.

### O que muda no telefone (medido num ecrã de 390×844)

Três correcções, todas por medição, e nenhuma era visível no computador:

1. **Os pares passam a faixa horizontal.** Uma lista de pares antes do gráfico empurrava-o para fora: sobravam
   **~180 px** de gráfico, o resto atrás da barra.
2. **A altura do gráfico é medida, não estimada em `vh`.** Com `54vh` o gráfico terminava **34 px abaixo** da
   barra fixa — tapava exactamente a faixa do sinal. Agora é `min(visualViewport, documentElement.clientHeight,
   innerHeight) − topo do gráfico − altura da barra`, remedido a 0/250/900 ms (o layout assenta depois de
   desenhar, porque o texto da fita muda de tamanho). Resultado: **gráfico inteiro acima da barra, folga 10 px**.
   *(O `ResizeObserver` sobre o `body` foi tentado e **não** resolve: a especificação não notifica as mudanças
   que acontecem dentro do próprio callback — a correcção morria ali.)*
3. **A barra fixa do rodapé** tem o gesto que muda estado — sem rolagem, alvos de **44 px** (medido), e o
   resumo do par à esquerda.

E o detalhe de cada cartão de par (`última decisão`, `risco`) **sai** no telefone: quem o mostra é o painel
"lado de dentro", e a faixa fica com o essencial.

---

## 4. A dificuldade: replicar a estratégia no gráfico

**O problema, dito sem rodeios.** Um gráfico de corretora mostra velas; a nossa mesa decide com um indicador
(`sigma` = `sign(mid − média) + zigzag de ATR`). Se a tela desenhasse esse indicador por conta própria —
reimplementando a média, a banda e o zigzag em JavaScript — passariam a existir **duas contas do mesmo
indicador no mesmo ecrã**. No dia em que divergissem, o dono veria o gráfico a contradizer a mesa sem saber
qual dos dois mente. E o pior: a divergência aparece devagar, um dia em que ninguém está a olhar.

**A decisão: a série é do SETUP, e o painel só desenha.** O `setups/<nome>/sobreposicao.ts` chama a **mesma
função pura** que o plugin chama em operação (`sinal.ts` → `calcular`) e publica a série barra a barra. Uma
conta, um dono. É a mesma família de regra que já governa o resto (RN-E9: a web não calcula o que o motor sabe).

O que se desenha, e porquê:

| no gráfico | o que é | de onde vem |
|---|---|---|
| velas | o que o **venue** publicou | `mercado/velas-<PAR>-<RELOGO>.jsonl` (o ficheiro que o operador escreve) |
| linha da média | a média do indicador | `sobreposicao` do setup (`ma`) |
| **duas tracejadas** | a **zona morta** (± `banda_atr` × ATR) | `sobreposicao` (`ma ± banda`) |
| linha em degraus | o **extremo da perna** — a memória do zigzag | `sobreposicao` (`extremo`) |
| **setas** | as **viradas** do indicador (o triângulo do Pine) | `sobreposicao` (`virada`) |
| **faixa inferior** | o lado vigente, barra a barra | `sobreposicao` (`sig`) |
| linha de preço | o último do venue / o nosso preço médio | operação (bid/ask) e posição |

**As duas pontas são cruzadas POR TEMPO, nunca por índice** — e isso é uma cicatriz deste repositório: cruzar
dois ficheiros por índice já pôs marcas no lado errado. O leitor junta por `t` e **conta as faltas dos dois
lados** (`velas_sem_ponto_da_serie`, `pontos_sem_vela`), que vão para o fio e aparecem na tela se existirem.

**A barra que decidiu não se confunde com a que está a formar.** O motor decide no **fecho** da barra (o
`barState.isconfirmed` do Pine). A série termina na barra fechada que decidiu — e o cabeçalho do gráfico **diz
qual é** ("última barra (a que decidiu): 30/09, 22:00"). A vela em curso, quando existe, vem separada e sem
lado, para se pintar de outra maneira.

**A virada da regra e a decisão da mesa são marcas diferentes.** A seta é do indicador (a regra virou); o
círculo é da mesa (decidiu abrir). No dia em que não coincidirem, tem de se ver que não coincidiram — e é por
isso que também viajam as decisões de `abrir` lidas do registo.

**Os compromissos, ditos em voz alta** (a biblioteca do gráfico, `lightweight-charts` v5, é a mesma família de
que as corretoras usam, e é ela que decide o que se pode desenhar):

- a biblioteca v5 **só desenha quatro formas de marcador** (`circle`, `square`, `arrowUp`, `arrowDown`): o
  triângulo do Pine virou **seta**, e a direção dela é a do **lado** (comprado/vendido), não a do preço — está
  escrito na legenda para ninguém a ler como "subiu/desceu";
- a zona morta são **duas linhas tracejadas**, não uma faixa preenchida: o preenchimento entre duas linhas não
  é nativo. Lê-se bem (a legenda explica que a virada só acontece fora dali), e fica dito como pendente;
- a **barra em curso não é desenhada como as outras** por uma razão de desenho, não de estilo.

---

## 5. Multi-plugin: nada por nome

O sistema é multiplugin, e essa é a razão de a tela não conhecer o nome de nada:

1. **A configuração vem do template.** `setup.json` → `template` publica um **descritor por item** (tipo,
   opções, omissão, unidade, nota); a ficha do par traz o **valor**. A tela desenha um campo por descritor —
   `escolha` vira lista, `inteiro`/`texto` vira campo, `booleano` vira sim/não — sem conhecer `ma_len` nem
   `zz_atr` (RN-S4). Um setup novo entra com a configuração dele sem se tocar na tela.
2. **A série vem do setup, pelo comando que ele declara.** `setup.json` → `sobreposicao` é o argv que produz a
   série daquele setup. O leitor corre o que estiver declarado; um setup que não declare nada entra na mesma —
   e a tela **diz** que aquele setup não publica série, em vez de inventar uma média.
3. **O agrupamento é por instrumento, com o setup e o relógio à vista**, porque é o par (instrumento × ficha)
   que a mesa governa. Um setup novo com relógio diferente (o mesmo plugin, duas fichas — RN-S5) aparece como
   duas linhas, sem a tela mudar de forma.

**Medido nesta fatia:** um setup só (`sigma`), dois pares (BTC, SOL), dois relógios idênticos (1h). O caminho
multiplugin está **construído e exercitado com um plugin** — não está provado com dois, e isso diz-se.

---

## 6. O controle: fronteira desenhada

| gesto | quem o faz | nesta fatia |
|---|---|---|
| ver o estado, a decisão, a série, o risco | a tela lê o fio | ✅ funciona |
| **ligar/desligar um par** (`run`) | a **ficha** (`tools/ligar-par.sh <PAR> sim\|nao`) | a tela mostra o comando exacto e o estado; **não escreve** |
| **armar o envio** (`enviar: true\|false`) | a **ficha do par** | idem |
| editar risco/configuração | a web, **com validação e assinatura** (RN-E12, RN-M2) | ⬜ não existe |
| `start`/`stop`/`pause`/`reset`/`nova_sessao` | a tela **pede**, o **vigia** executa (RN-E21) | ⬜ não existe |
| compor/enviar ordem | **ninguém, pela tela. Nunca.** | por desenho |

O que a tela **não** faz nesta fatia é escrever. Isso é decisão de desenho, não esquecimento: uma escrita sem
validação e assinatura é uma segunda porta para a configuração do dono — e o sítio onde essa porta se abre tem
de ser o mesmo que o vigia usa, com o registo a dizer quem mudou o quê.

---

## 7. O fio: de onde vem cada número

`tools/painel/retrato.ts` escreve `painel.json`. É um **leitor**: não decide, não escreve na operação, não toca
em ficha.

| no fio | campo | origem |
|---|---|---|
| estado da mesa | `estado_da_mesa` | `registo.jsonl` → última linha `transicao.para` |
| equity | `contas[].equity` | `operacao.json` → `instrumentos.*.leitura.equity` |
| bid/ask/último/idade | `leitura.*` | `operacao.json` (o que o conector leu do venue) |
| posição e **dono** | `leitura.posicao` | `operacao.json` (`marca_de_posse` = RN-T16.1) |
| ordens vivas | `leitura.ordens_abertas` | `operacao.json` (contrato 1.9.0) |
| decisão do ciclo | `ultima_decisao`, `decisao_contagem` | `registo.jsonl` → linhas `ciclo` (`acao`, `motivo`) |
| mandato | `mesas[].registo.mandato` | `registo.jsonl` → linhas `mandato` |
| carteiro | `mesas[].carteiro` | `operador.log` → linhas `etapa: "carteiro"` |
| o que saiu | `saiu_para_o_venue` | `desfechos-*.jsonl` e `marcas-*.jsonl` |
| ficha e interruptores | `ficha`, `risco` | `fichas/<setup>/<PAR>-<CONTA>.json` |
| configuração | `template` (descritor) + `valores_resolvidos` (valores) | `setups/<nome>/setup.json` + `operacao.json` |
| série e janela | `serie_do_setup`, `janela` | `setups/<nome>/sobreposicao.ts` (o comando que o setup declara) |
| velas | `velas` | `mercado/velas-<PAR>-<RELOGO>.jsonl` |
| as palavras do setup | `o_que_o_setup_disse` | `operador.log` → `setup_falou` (o `stderr` do plugin) |

Duas decisões que valem a pena reter, porque as duas nasceram de erro medido:

- **A medição e o veredicto do setup são coisas diferentes, e viajam separadas.** O plugin escreve `diagnostico`
  com números (`ma`, `atr`, `mid`, `sig`, `virada`) **e** veredictos sem número ("plano, e a barra não virou").
  Ler os números da **última** linha dava `sig=null` com o setup a ter dito o lado em palavras; e um número de
  uma volta antiga apresentado como "agora" é uma medição fora de prazo. O fio leva as duas, **cada uma datada
  com a volta em que foi dita** — e a tela mostra "concorda com a série" ou "DIVERGE da série (série diz sig
  −1)".
- **O lado vigente vem da série**, que é a conta do próprio setup sobre a barra que decidiu — e não de um número
  arrancado de um log que pode ser de uma volta antiga.

---

## 8. O que NÃO existe (e é falta, com nome)

| # | falta | consequência hoje | o que falta fazer |
|---|---|---|---|
| 1 | **O livro não viaja na leitura.** `mercado.livro` é opcional no contrato e o operador não o publica | o painel não mostra profundidade; **diz porquê**, em vez de desenhar vazio | publicar `livro` na leitura (emenda aditiva) |
| 2 | **A web não escreve ficha nenhuma.** `run`/`enviar` mudam-se por linha de comando | o controle é de leitura + comando copiado | a escrita com validação e assinatura (RN-E12/RN-M2) |
| 3 | **O registo de mesas não tem endereço** (RN-E8). Hoje o fio traz **uma** instalação, com `endereco: null` | multi-instalação não é possível ainda; a tela já não muda de forma por isso | cada mesa publicar identidade num caminho fixo; a tela descobrir em vez de manter à mão |
| 4 | **`sobreposicao` no `setup.json` é chave nova, sem regra escrita.** É aditiva e nada mais a lê | funciona, mas é convenção minha, não contrato | levar a chave à spec do setup (RN-S12 proposta) e prová-la |
| 5 | **Não há `start`/`stop`/`pause` pela tela** — o pedido ao vigia não existe | o controle de ciclo é por linha de comando | pedido da tela → vigia (RN-E21) |
| 6 | **Um plugin só.** O caminho multiplugin corre com um | o segundo setup é a prova que falta | segundo setup (noutra linguagem, RN-E17) como caso |
| 7 | **O fio é um retrato, não uma ligação viva.** Quem o produz é o leitor (`retrato.ts`), não a mesa | a renovação já não depende de ninguém: a unit `mesacore-painel.service` reescreve-o a cada 60 s (antes era só enquanto alguém corria o retrato) | a **mesa** publicar o fio (o passo que faz a tela ser da mesa, e não de um leitor de fora) |
| 8 | **A zona morta não é preenchida** | duas tracejadas em vez de faixa | série personalizada na biblioteca, se o dono quiser |

---

## 9. Como correr

```bash
# 1) o fio (leitor; não opera, não escreve na operação)
bun run tools/painel/retrato.ts                       # escreve web/painel/painel.json
bun run tools/painel/retrato.ts --corrida <dir> --para <outro.json>

# 2) a tela — abre em qualquer browser, e no telefone pela rede local.
#    Quem a serve é a unit de utilizador `mesacore-painel.service` (do host, não da sessão de ninguém):
#    serve `web/painel/` em 192.168.15.24:8788 e regenera o `painel.json` a cada 60 s.
#      → http://192.168.15.24:8788/index.html
#    Comandos, registo e reinstalação: tools/painel/README.md.
#
#    À mão (só com a unit desligada — senão colide na porta: EADDRINUSE):
#      systemctl --user disable --now mesacore-painel.service
#      cd web/painel && python3 -m http.server 8788 --bind <ip-da-lan>
```

A tela é **um ficheiro + tema + biblioteca do gráfico embutida**: zero pedido externo (verificado: 0 requisições
externas), abre em rede fechada, e não precisa de internet.

---

## 10. As medidas desta fatia

| o que | número | como foi medido |
|---|---|---|
| velas e pontos da série por par | **505 / 505** | `bun run tools/painel/retrato.ts` |
| faltas do cruzamento (velas × série) | **0 e 0** | idem |
| o gráfico pinta (pixels no canvas) | **475 080 opacos · 34 852 fora do fundo** (1284×370) | `getImageData` no browser, depois da primeira pintura |
| erros de consola | **0** | ouvinte `error`/`unhandledrejection` na própria página |
| requisições externas da tela | **0** | `validar_pagina.py` |
| contraste da paleta | 8 pares ≥ 4,5 · 1 limite (3,89, figura) · **1 falha corrigida** (tinta sobre acento, 1,81) | `contraste.py` sobre `web/painel/tema.css` |
| telefone 390×844 | gráfico **inteiro acima da barra**, folga **10 px**; botões **44 px**; transbordo de texto **0** | medidas no DOM (não no olho) |
| o diálogo da configuração | abre pelo botão ao lado do símbolo · **17 itens** do template · fecha por botão, `Esc` e clique fora · rolagem do fundo travada · foco devolvido | clique real no browser, com leitura do DOM |
| a tela sem referências mortas | **28 ids definidos · 27 referenciados (1 é âncora de medição, não referência) · 0 duplicados · 0 requisições externas** | `validar_pagina.py` |
| os cartões que recolhem | **68 px recolhido · 166 px aberto**; abrir um não mexe na selecção nem nos outros; a escolha sobrevive ao recarregamento; **3 gestos** (botão do cartão, `Enter`, «abrir/recolher todos») | clique e teclado reais no browser, com leitura do DOM |
| **todos os painéis recolhem** | do painel aberto ao recolhido: pares **189 → 55 px** · gráfico **1005 → 47 px** · **leitura do setup 404 → 43 px** (telefone **538 → 61 px**) · lado de dentro **796 → 46 px** · registo **223 → 46 px** · cada secção de dentro **300/197/191 → 37 px** | clique real, altura do contentor no DOM |
| **a cabeça da leitura não se corta** | resumo `5 barras · sig −1 · concorda` inteiro em 372 px de telefone (**sem reticências**) e em 1330 px de computador; título com `nowrap` (partido, fazia a cabeça ir a 60 px) | `scrollWidth` vs `clientWidth`, medidas no DOM |
| **alvos de toque (8 botões)** | pares, gráfico, leitura, lado de dentro, 3 secções e registo — **todos 44×44** | `getBoundingClientRect` a 390×844 |
| **o gráfico nasce maximizado** | por omissão `bloco:grafico` **aberto** (`1005 px`), com os cartões dos pares recolhidos — é a omissão gravada, não deduzida | `localStorage` limpo + recarregamento |
| **o gráfico volta a desenhar ao reabrir** | **1262×409 · 35 629 px** fora do fundo, com a **mesma marca de conteúdo** do estado virgem (446679883) — prova de que redesenhou, e não de que ficou o fotograma velho | `getImageData` antes de recolher e depois de reabrir |
| alvos de toque no telefone | config **113×44** · fechar **63×44** · abrir/recolher **44×44** | `getBoundingClientRect` a 390×844 |
| tipos | **0 erros em 6 directórios** | `bash tools/verificar-maquina/tipos.sh` |
| fichas | **2 conferidas · 0 falhas** | `python3 tools/verificar-setup/fichas.py` |

**Os quatro defeitos que a captura apanhou, e que valem como lição** (todos corrigidos, todos medidos):

1. **o gráfico não pintava, e o sintoma era "sem dados".** A causa era uma **cor**: o `color-mix` do tema é
   devolvido pelo browser na forma moderna `color(srgb …)`, e a biblioteca do gráfico recusa essa forma
   (`Failed to parse color`) — a excepção rebentava a meio do desenho. Corrigido com uma conversão explícita
   (`normalizarCor`), com o porquê escrito no código;
2. **o tamanho do gráfico chegava tarde** (`autoSize` + `ResizeObserver`): o bitmap ficava no valor de omissão
   (300×150) e o canvas não pintava. Agora o tamanho é **medido** e reaplicado;
3. **`<dt>`/`<dd>` dentro de um `<button>`** é HTML inválido e o browser desmanchava a grelha dos cartões de par
   — a lista parecia "sem valores". Passou a spans com a mesma grelha;
4. **a regra do telefone estava escrita antes da regra base** e era sobreposta sem dar erro nenhum (a tabela da
   leitura continuava a transbordar com a regra "aplicada"). O bloco do telefone passou para o **fim** do
   ficheiro.

**Mais três, da fatia «tudo recolhe» (01/10/2026) — e o terceiro é o mais importante dos três:**

5. **a regra genérica de recolher apanhava o que não devia.** Escrita como `[data-recolhivel].recolhido >
   :not(header)`, ela servia o cartão de um par (que não tem `header`, tem a linha de cima) e o cartão ficava com
   **18 px** — sem nome, sem preço, vazio —, e o `h3` das secções desaparecia, deixando a secção sem nada onde
   carregar. Cada forma tem agora a **sua** regra (`.bloco[…]`, `.par[…]`, `.secao[…]`); o **estado**, esse,
   continua a ser um só.
6. **o gráfico não se repinta sozinho depois de voltar de `display: none`** (o painel recolhido). Reaplicar o
   tamanho não chegou: o canvas voltava com o bitmap de omissão e sem um pixel. O que repinta de forma
   determinística é **reconstruir** o gráfico — a criação é o caminho já provado (custa reescrever 505 barras, que
   é instantâneo). «Volta a desenhar» foi provado por **marca de conteúdo**: `35 629 px` e o mesmo valor de
   assinatura antes e depois.
7. **COM A ABA ESCONDIDA NÃO HÁ `requestAnimationFrame` — e um gráfico que parecia morto estava só a ser olhado
   por ninguém.** Medido: aba escondida, **0 frames em 1,2 s**, canvas parado em 300×150 e zero pixels. Custou
   três medições erradas seguidas («não pinta», «a reconstrução não acontece») antes de se ler
   `document.visibilityState`. **A lição operacional:** antes de medir pixels, confirmar que a aba está
   **visível** (`Page.bringToFront`); sem isso a medição diz mais sobre a bancada do que sobre a página. E ficou
   do lado do produto, porque é um caso real: ao **trocar de app e voltar**, o dono via o gráfico vazio — hoje a
   volta da aba é tratada como um pedido de desenho (e só reconstrói se o canvas ainda estiver no tamanho de
   omissão).

*(Um quinto, e é o mais traiçoeiro: a primeira medição de "o gráfico não pinta" lia o **primeiro** canvas do
contentor, que é um canvas de **sobreposição** e fica com o tamanho de omissão de propósito. O que desenha é o
maior — medir o canvas errado dá um falso defeito com a mesma cara de um defeito verdadeiro.)*

---

## 11. A configuração das fichas — a vista, e porque não é um diálogo

Pedido do dono (01/10/2026): um sistema de configuração das fichas — a do **setup** e a da **conta** — pela tela,
substituindo a entrevista em `sh` (`tools/preparar-contas/preparar-contas.sh`), que está **desactualizada** face à
ficha que o sistema lê hoje (ela fala de `fichas.<instrumento>.risco.*` e de `versao_do_mandato`; a ficha em uso
tem `cabecalho` + `bandas`). O botão ficou **à direita de «Recarregar»**, na fita.

**A REGRA, e é ela que decide o resto: o que muda um INTERRUPTOR é diálogo; o que muda um DOCUMENTO é vista.**

O diálogo da configuração (§3, na linha do par) fica para o que é um gesto — `rodar` e `enviar`. A ficha é outra
coisa: um documento com regras de identidade, tipos, bandas, um veredicto de um **conferidor que não é esta tela**
e um relatório. Isso não cabe numa caixa, e **cresce com cada plugin** (o questionário é do plugin, não da tela).
Mais três razões, e todas foram medidas nesta casa:

- **a bancada redesenha a cada minuto** (o retrato renova-se e as listas são refeitas): um formulário dentro da
  superfície que se redesenha é uma luta — e já se perdeu uma vez, quando o diálogo aberto mostrava valores de há
  dois minutos. A vista tem endereço próprio e não se repinta por baixo de quem escreve;
- **no telefone** uma folha de baixo com uma ficha inteira (a conta + 54 linhas de ficha) é uma maratona de rolagem;
- **o endereço próprio dá o que a caixa não dá**: o **«voltar» do telefone funciona** e um recarregamento não perde
  o sítio onde se estava.

### O que a vista mostra — e o que ela NÃO faz

| bloco | o que traz |
|---|---|
| **A conta** | `config/contas/<conta>.json` chave a chave, com o **caminho** do segredo e o aviso de que o ficheiro do segredo não é aberto |
| **As fichas dos pares** | uma secção por ficha: o `cabecalho` (as dez chaves que o sistema lê) e as `constantes` (a única parte que vai ao setup) |
| **O que o conferidor diz** | a saída **tal e qual** de `tools/verificar-setup/fichas.py` — o mesmo do portão — com o veredicto |
| **Como isto escreve (e o que o guarda)** | as três guardas e o registo — a porta, dita em português |

- **ESCREVE — por uma porta só, e nunca sem validação.** Quem escreve é `tools/escrever-ficha` (a mesma porta que
  a linha de comando usa), e a ordem não se troca: **compõe** → **valida** (o conferidor do portão corre sobre o
  candidato, numa cópia da árvore das fichas) → **escreve** (atómico) → **regista**. Se o conferidor reprovar, não
  se escreve nada. A tela **pede** — não tem uma segunda conta das regras nem escreve por si;
- **não julga nada.** O veredicto é do conferidor: a tela **corre o que já existe** e carrega a saída dele.
  Reimplementar as regras aqui daria duas contas da mesma regra no mesmo ecrã (RN-E9) — e no dia em que
  divergissem, o ecrã contradizia o portão;
- **não abre o ficheiro do segredo.** A conta aponta para ele por **caminho**, e é o caminho que se mostra. E há
  guarda, porque um guarda vale mais do que uma promessa: um valor com **nome de segredo** ou com **cara de chave
  privada** (hex de 64 ou mais — um endereço tem 40 e **não** é apanhado) sai como *«escondido: parece segredo»*,
  **dito e não em branco**: um buraco silencioso deixa sempre a dúvida de se o campo não existe ou se foi escondido.

### A escrita, em pormenor: três guardas e um registo

O pedido vai por `POST /api/ficha` (o servidor do painel, `tools/painel/servidor.ts`), e passa por três guardas —
nenhuma delas enfeite:

| guarda | o que impede |
|---|---|
| **a origem e um cabeçalho próprio** (`Origin` desta tela + `X-MesaCore: 1`) | outra página aberta na rede escrever fichas em nome de quem tem o painel aberto |
| **a impressão do ficheiro que se viu** (`sha256`, que viaja no fio com cada ficha) | uma página velha passar por cima de uma mudança nova |
| **a validação antes de aplicar** (o conferidor, sobre uma cópia da árvore) | ficar no disco uma ficha que o sistema recusa — e o par parar em silêncio |

E **o registo** (`~/.config/mesacore/historico-de-fichas.jsonl`, uma linha por mudança): instante, ficha, **origem**,
impressão antes e depois, e o que mudou. É isto que `RN-M2` chama **assinatura** — não um nome bonito num campo, mas
o valor em vigor **e a sua origem**, datados, «para que a divergência entre o que se quis e o que corre nunca seja
silenciosa». O registo vive **fora do repositório**: em `/config` há três famílias de ficheiro e só três (RN-E12), e
um histórico lá dentro seria uma quarta.

Uma quarta recusa, que o conferidor **não** faz e que era uma armadilha: **um valor fora da banda que a própria
ficha declara**. O conferidor confere a forma (tipo, bandas presentes, identidade) e não o valor contra a banda —
quem confere o valor é a mesa, na hora da boleta. Escrita assim, a ficha ficaria no disco e o par seria recusado em
tempo de execução, **sem nada aparecer no ecrã**. O escritor recusa e diz os números da banda.

### Medido

| o que | número | como |
|---|---|---|
| o botão, e onde | **105×34** no computador, **à direita** de «Recarregar» (91×34) e na mesma linha; **104×44** no telefone | medidas no DOM |
| a vista | `#configuracao` mostra a configuração e esconde bancada, registo, faltas e barra do telefone (**0 px** de altura) | clique real + leitura do DOM |
| a conta | **16 chaves** do ficheiro, com a credencial mostrada como **caminho** (`ficheiro:…/hl-teste-plugin.key`) e **0 segredos** apanhados pelo guarda | `painel.json` |
| as fichas | **2** (BTC e SOL), com **54 linhas** de cabeçalho + constantes | idem |
| o conferidor | **aprovou** (`ficha.py`, código 0, 2 conferidas · 0 falhas · 2 notas) — a saída dele é o que se mostra | idem |
| a vista recolhe | a secção das fichas vai de **2860 px** a **63 px**; os 4 blocos recolhem como os da bancada | clique real, altura no DOM |
| transbordo na vista | **0** (fora o `<pre>` do relatório, que rola por desenho) | `scrollWidth > clientWidth` em todos os elementos |
| **a escrita recusada não deixa marca** | quatro recusas seguidas (tipo errado, valor fora da banda, caminho fora de `fichas/`, impressão velha) e a ficha **byte a byte igual** — sem `.novo` deixado atrás, sem linha no registo | `sha256sum` antes e depois, e `ls` dos resíduos |
| **a escrita a sério, e a volta** | `prazo_de_resposta_ms` **5000 → 6500 → 5000**, com o ficheiro a voltar ao mesmo `sha256` (`b39d1564…`) — o formato não se perde na escrita | `sha256sum` + `git diff` |
| **as guardas do endpoint, uma a uma** | sem origem → **403**; origem de outra máquina → **403**; sem o cabeçalho da tela → **403**; impressão velha → **409**; valor fora da banda → **409**; simulação → **200** | `curl` com e sem os cabeçalhos |
| **o registo (a "assinatura" do RN-M2)** | **4 linhas** com instante, ficha, origem (`linha de comando` / `vista de configuração`), impressão antes e depois, e o que mudou | `~/.config/mesacore/historico-de-fichas.jsonl` |
| **a tela confirma o que escreveu** | depois de escrever, o valor mostrado era o **antigo** (o fio só se renova no ciclo de 60 s) — corrigido: uma escrita **refaz o retrato**, e o ecrã passa a mostrar o que ficou | medida no browser, e depois do arranjo |
| campos e botões no telefone | **328×44** por campo e **130×44** por botão | `getBoundingClientRect` a 390×844 |
| a tela | **35 ids · 0 duplicados · 0 requisições externas** · **0 erros de consola** · **0 erros de tipo em 6 directórios** | validador, ouvinte de erros, `tipos.sh` |

### O que ainda não está feito (e é falta, com nome)

- **a conta não se escreve por aqui.** A vista mostra-a e o escritor só aceita caminhos dentro de `fichas/` — de
  propósito: mexer na conta muda a credencial e o ambiente, e isso não é a mesma decisão que mudar o `enviar` de um
  par. O fluxo da conta continua na entrevista (`tools/preparar-contas/preparar-contas.sh`);
- **os campos não vêm de um questionário: vêm da ficha como ela é.** O `preparar-contas` pergunta a partir dos
  questionários que os plugins publicam (`brokers/*/questionario.json` existe; `setups/*/questionario.json` ainda
  não). A vista edita o documento real, que é o que a mesa lê — o caminho para gerar perguntas por plugin fica
  aberto, e é o mesmo ficheiro que o forneceria.
