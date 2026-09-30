# Inventário de chaves — v0 (rascunho)

| | |
|---|---|
| Papel | A lista de **toda grandeza ajustável** do sistema: nome, tipo, dono, omissão e **quem lê**. |
| Regra-mãe | **RN-A1** (nenhum número no código), **RN-A2** (a mesa valida o inventário no arranque), **RN-A3** (spec que precise de número inventa a chave primeiro). |
| Estado | **v0, extraído à mão das regras** (reconferido contra a regra v3 em 27 set 2026 — achou os itens 9 e 10). A versão final é **gerada dos schemas** e este ficheiro passa a ser a conferência de que a geração concorda com as regras. |
| Como se lê | `[falta]` = a regra implica a chave e ninguém a declarou — **é uma lacuna, não um esquecimento de escrita**. `[novo]` = chave criada nesta passagem, sem regra anterior que a nomeasse. |

Critério de sanidade, e é ele que faz este documento útil: **chave que ninguém lê é lixo; valor lido sem
chave é defeito.** Por isso a última coluna não é decoração — é a prova.

---

## 1. `conta.*` — o macro (dono, `/config`)

> **Por conta (28 set 2026).** Com mais de uma conta na mesma mesa, o macro passa a ser uma **tabela de
> contas**: `contas.<constante>.*`, onde a constante é o alias da (corretora, conta). O **tecto de margem**
> e a **perda máxima (CB)** são **da conta** — a soma das fichas compara-se com o tecto daquela conta, e o CB
> mede-se sobre o equity dela. As linhas abaixo mantêm os nomes por serem os que o código lê hoje; a migração
> para a tabela é trabalho do recorte que abrir a segunda conta.

| Chave | Tipo / unidade | Exemplo de omissão | Quem lê |
|---|---|---|---|
| `conta.corretora` | nome do conector | — | mesa no arranque (RN-M1) |
| `conta.identificador` | texto | — | mesa e conector |
| `conta.instrumentos[]` | lista de símbolos | — | mesa (RN-M1) |
| `conta.perda_maxima_pct` | % do equity da corretora, com não realizado | `5` | mesa, **em cada ciclo** (RN-M3) |
| `conta.perda_maxima_janela` | enum `corrida_da_mesa` \| `dia_de_calendario` | `corrida_da_mesa` | mesa (RN-M3 a RN-M3.4) |
| `conta.margem_total_maxima_pct` | % do saldo | `100` | arranque e cada ciclo (RN-M4) |
| `conta.risco_maximo_por_ordem_pct` | % do saldo | `2` | mesa, antes de enviar (RN-M4.12) |
| `conta.contencao` | enum `recusar` \| `espera` | ausente = recusa | arranque (RN-M4.7) |
| `conta.ordem_de_atendimento[]` | lista de símbolos | vazio = alfabética | mesa no ciclo de contenda (RN-M4.9) |
| `conta.eventos_que_avisam[]` | lista de eventos | CB, encerramento, desconhecido, recusa, divergência, falha de leitura, contenda | avisos (RN-E15) |
| `conta.arranque_apos_cb` | enum `exige_decisao` | `exige_decisao` | arranque (RN-M3.3) |
| `conta.conectores[]` | lista de **nomes** de conector | ausente = recusa; nome sem dublê/plugin = não está de pé | arranque, porta dos conectores (T027, RN-E21) |
| `conta.invalidos_seguidos_para_inibir` | contagem | **`[novo]`** — RN-T4 dizia `ABERTA` e a chave não existia | mesa, ao contar inválidos seguidos (RN-T4) |
| `conta.credencial` | **referência**, nunca o valor | — | conector (RN-E14) |
| ~~`conta.idade_maxima_do_dado_ms`~~ | ms | **SAIU** na emenda do dono de 28 set 2026: o limite deixou de existir por inteiro — quem diz que a mesa está cega é o estado da ligação (`sem_ligacao`, §8), e a idade da barra é regra do setup (RN-D3 revisto). O `[falta]` que aqui esteve era o mais antigo do inventário: RN-D3 mandava invalidar «acima do limite declarado» e o limite não estava declarado em lado nenhum. Ver §6.1 | — (nada a lê, e não há nada a ler) |
| `conta.retencao_ledger` | `{dias_integral, depois}` | **LEITOR DESDE 29/09/2026**: `core/estado/retencao.ts` (bateria `core/estado/retencao.prova.ts`, 14 casos) — lê a declaração (aceita o inteiro e a sua forma textual, recusa o resto) e diz de que lado da fronteira cai cada linha, com a borda **inclusiva** do lado do integral. **Sem declaração nada passa**: o que se perde por não haver regra é a distinção, nunca o arquivo de túmulos. A **compactação em si** (agregar o que passou) é acto operacional, fora da mesa — o leitor diz a fronteira e o destino a quem a corre (RN-L6) |

## 2. `fichas/<instrumento>.risco.*` — a posição (forma fixa, do core)

| Chave | Tipo / unidade | Exemplo de omissão | Quem lê |
|---|---|---|---|
| `saldo_pct` | % do saldo | — | boleta (RN-M4.3) |
| `alavancagem` | múltiplo | `1` | boleta (RN-M4.3) |
| `distancia_minima_liquidacao_pct` | % de movimento, **opcional** | ausente = ordem livre | porteiro na abertura (RN-M4.13) **e** a conferência da resolução (`core/ciclo/banda.ts`, D-001 fechado a 29/09) |
| `janela` | da posição (do setup) | — | mesa (RN-M5, RN-S3) |
| `estudo` | referência + data | ausente | validação (RN-E13) |
| `tolera_posicao_manual` | booleano | **`[novo][falta]`** — RN-T16 exige e a chave não tinha nome. **Nota de 29/09/2026:** medido, a chave **não existe em ficheiro nenhum** (só aqui) e o comportamento que a leria também não: «não gerir o que não abrimos» precisa de saber **quais posições são nossas**, o que é o mapa marca → ciclo/ficha do RN-T16.1 (D-008) | **nada** — a chave e o comportamento estão por fazer (D-008) |
| `bandas.saldo_pct` | `[min, max]` | **`[falta]`** — RN-M6.2 fala de banda e não a enumera para este item (o **valor** é do dono; o **leitor** existe desde 29/09: `core/ciclo/banda.ts` confere a exposição da posição contra esta banda, D-001) | validação (RN-M6.2) **e** conferência da resolução |
| `bandas.alavancagem` | `[min, max]` | **`[falta]`** (o **valor**; o **leitor**: `core/ciclo/banda.ts`, que confere a alavancagem EFECTIVA que a corretora aplicou — D-001) | validação (RN-M6.2, RN-M4.4) **e** conferência da resolução |
| `bandas.stop_pct` | `[min, max]` | **`[falta]`** no **valor**. **Nota de 29/09/2026:** o leitor que aqui estava escrito **não existe** — medido, o `setup.stop_pct` é copiado para a boleta (`core/ciclo/decisao.ts:118`) e a banda nunca é conferida (D-008) | **nenhum** — um setup pode declarar um stop fora da banda e a mesa aceita-o (D-008) |
| `bandas.tp_pct` | `[min, max]` | **`[falta]`** no **valor**. **Nota de 29/09/2026:** idem ao `stop_pct` — a banda existe escrito e não morde (D-008) | **nenhum** (D-008) |
| `bandas.tempo_maximo_em_posicao` | duração | **`[falta]`** — e **a chave não existe em ficheiro nenhum** (medido 29/09/2026: só aqui, e fora da lista de bandas que o arranque confere). Fechar por tempo precisa do **instante de abertura** da posição, que `mercado.posicao` não traz (D-008) | **nada** (D-008) |
| `versao_do_mandato` | texto não vazio | — | **o dono versona o seu mandato**; a mesa lê-a para fechar a **unidade de comparação** da sessão (`ficha`, `versao_do_setup`, `versao_do_mandato` — FR-034). Sem ela o `nova_sessao` **recusa** (`unidade_de_comparacao_nao_declarada`): dois números da mesma mesa sem unidade não se comparam entre si |

## 3. `fichas/<instrumento>.setup.*` — a estratégia (forma publicada pelo setup)

| Chave | Tipo / unidade | Quem declara | Quem lê |
|---|---|---|---|
| `setup.nome` / `setup.variante` | texto | dono escolhe | mesa (RN-M6) |
| `setup.politica_de_execucao` | enum `passiva_no_toque_com_escalada` \| `mercado` \| … | **setup (template)** | mesa ao montar a boleta — **`[novo]`**: a boleta tem `tipo` e **nenhuma regra dizia quem o escolhe** |
| `setup.prazo_da_passiva_ms` | ms | **setup** | mesa (RN-B8) |
| `setup.destino_do_resto` | enum `agressivo` \| `cancelar` | **setup** | mesa (RN-B8) |
| `setup.prazo_de_resposta_ms` | ms | **setup** | **`[falta]`** — RN-S8 fala de "silêncio além do prazo" e o prazo não tinha chave; num **setup manual** é prazo humano (RN-T15.1) |
| `setup.parcial` | enum (tudo-ou-nada / o-que-der) | setup | boleta (RN-B6) |
| `setup.desvio_maximo` | % de movimento | setup | boleta, conferido no manifesto (RN-B3) |
| `setup.stop_pct` | % de movimento | setup | boleta, **limitado pela banda** `bandas.stop_pct` (RN-B7, RN-S11) |
| `setup.tp_pct` | % de movimento | setup | boleta, **limitado pela banda** `bandas.tp_pct` (RN-B7, RN-S11) |
| `setup.relogio.proxima_consulta_ms` | ms | **setup** (declaração) | mesa: quando voltar a consultar este setup (RN-S2, RN-T5) |
| `setup.<itens do template>` | conforme o template (`ema_fast`, `ema_slow`, limiares…) | **forma**: setup · **valores**: dono | mesa **pelo template**, nunca por nome (RN-S3, RN-S4) |

## 4. A boleta — documento, não configuração: **cada campo tem de vir de um sítio**

| Campo | Vem de | Nota |
|---|---|---|
| ciclo, instrumento | mesa | identidade (RN-T3) |
| lado | setup | um dos quatro valores (RN-S1) |
| tipo de ordem | **`setup.politica_de_execucao`** | **`[novo]`** — não tinha dono declarado |
| saldo_pct, alavancagem | `fichas/<i>.risco` | RN-M4.3 |
| stop_pct, tp_pct | setup, **limitado pela banda** | RN-B7, RN-S11 |
| parcial | setup | RN-B6 |
| desvio_maximo | setup | RN-B8 |
| prazo_da_passiva_ms | **`setup.prazo_da_passiva_ms`** | **`[novo]`** — RN-B8 manda e a chave não existia |
| destino_do_resto | **`setup.destino_do_resto`** | **`[novo]`** — idem |
| reduce_only | mesa (saída) | RN-B5 |
| referência do cliente | mesa | RN-C4 |
| **marca de posse** | mesa (RN-B10) | **`[novo]`** — RN-B10 existe desde a decisão do dono e o campo não estava nesta lista; a **forma** é declarada no manifesto (RN-C1) |
| versão do contrato | a ponta | RN-E18 |

## 5. Manifesto do conector — **sondado, não configurado**

Instrumentos e unidades (mínimo, passo, tick) · alavancagem máxima por instrumento e por escalão de valor ·
se sabe ajustar alavancagem e em que modos · teto de valor por ordem · modelo de posição (netting/hedging) ·
tipos de ordem disponíveis · política de parcial suportada · desvio máximo · `reduce-only` **suportado**
(nativo ou emulado pelo conector — é a **capacidade** que se declara, não o mecanismo) ·
stop anexo · profundidade de livro · funding · relógio de fecho de barra · idempotência ·
**marca de posse**: em que forma a aceita (`cloid`, `clientOrderId`, `magic`, `comment` ou `nenhuma`) e se
liga ordem a posição nos seus próprios registros · **estado do mercado** (aberto/fechado, RN-D8) ·
**versão do contrato** (RN-E18) — todos por RN-C1.

**Por conta, quando o plugin serve várias** (emenda do dono, 28 set 2026): um plugin que carregue as
constantes de **várias corretoras e contas** no arranque tem de declarar o manifesto **por conta** — cada
conta com os seus instrumentos, escalões e mínimos. Hoje `manifesto.conector` é `{nome, versao}` e
`instrumentos` é uma lista só: um conector = uma conta. E a **constante de destino é um nome, nunca uma
credencial** (RN-E14): o alias é que viaja, a referência fica na tabela que o plugin carrega.

---

## 6. Lacunas que o inventário revelou

Aritméticas, não interpretativas — é por isso que esta vista apanha o que a leitura não apanha:

1. ~~**`conta.idade_maxima_do_dado_ms`**~~ — **fechada pela emenda do dono (28 set 2026)**: o limite
   deixou de existir por inteiro; quem diz que a mesa está cega é o **estado da ligação** (condição
   `sem_ligacao`, §8), e a idade da barra é regra do **setup** (que recebe o carimbo da corretora no
   dataframe, e sabe se a barra está fechada). A lição fica: uma regra que manda «invalidar acima do
   limite declarado» sem o limite declarado em lado nenhum é uma regra que **não corre** — e que só se
   descobre se alguém a for procurar.
2. **`setup.prazo_de_resposta_ms`** — RN-S8 congela por "silêncio além do prazo" e o prazo não tem chave.
   Num **setup manual** isto deixa de ser detalhe: sem prazo humano, a mesa congela porque o dono foi
   almoçar (RN-T15.1).
3. **`setup.politica_de_execucao`** — a boleta tem `tipo` e **nenhuma regra diz quem o escolhe**. No motor
   de referência é sempre passiva no toque com escalada para agressiva; isso é política de execução, e
   política de execução é do setup. Sem esta chave, a mecânica mais bem provada que temos ficaria no
   código.
4. **`setup.prazo_da_passiva_ms`** e **`setup.destino_do_resto`** — RN-B8 manda a boleta declará-los e as
   chaves não existem.
5. **`tolera_posicao_manual`** — RN-T16 exige e não tinha nome.
6. **As bandas não estão enumeradas** — e falta a do próprio `saldo_pct`, sem a qual o RN-M6.2 ("valor fora
   da banda é recusado") não tem contra o que comparar.
7. **`conta.retencao_ledger`** — RN-L6 manda declarar e não há chave.
8. **`estudo`** — RN-E13 manda registrar o estudo que sustenta o número e não há campo.

### Achadas na reconferência (27 set 2026, contra a regra v3)

9. **`conta.invalidos_seguidos_para_inibir`** — a própria RN-T4 confessava a lacuna ("`ABERTA`: quantos
   inválidos seguidos…") e **a chave não apareceu nesta lista na primeira passagem**: a palavra `ABERTA`
   fez de cortina. Regra que se diz aberta continua a precisar de **chave** — o que é do dono é o
   **valor**, nunca a existência da chave.
10. **`marca de posse` na boleta** — RN-B10 entrou depois de este inventário ser escrito, e o campo foi
   acrescentado ao manifesto (§5) sem ser acrescentado à lista de campos da boleta (§4): metade da
   decisão ficou registrada. Campo que atravessa a fronteira aparece **nas duas listas**.

## 7. As chaves que o recorte 002 passou a usar

A maquina de estados nao inventou chaves novas para alem das que o inventario ja declarava — mas passou a
**ler** algumas, e a lê-las em sitios que nao existiam (o CB, o arranque, o encerramento). Fica escrito
quem as le, porque uma chave que o codigo le e que ninguem declarou e um valor ajustavel que ninguem sabe
onde ajustar (RN-A1).

| Chave | Quem a le agora | Para que |
|---|---|---|
| `conta.eventos_que_avisam[]` | `core/config/configuracao.ts` | decide **se** um evento avisa (FR-042). Sem a lista, ou com um nome fora do conjunto fechado, a mesa **grita** — nao avisa por omissao |
| `conta.perda_maxima_pct` | `core/ciclo/cb.ts` | o limite da corrida. Comparado por multiplicacao cruzada, sem arredondar (FR-035) |
| `conta.perda_maxima_janela` | `core/ciclo/cb.ts` | desde quando se mede: `corrida_da_mesa` (equity de partida da sessao) ou `dia_de_calendario` (equity de abertura do dia) |
| `conta.contencao` | `core/ciclo/arranque.ts` (porta da contenda) | resolve a contenda entre fichas: `recusar` ou `espera`. **Ausente = recusa** (RN-M4.7) |
| `conta.margem_total_maxima_pct` | `core/ciclo/arranque.ts` (porta da contenda) | o tecto que as fichas somadas nao podem passar |
| `conta.arranque_apos_cb` | `core/ciclo/arranque.ts` (porta da sessao) | `exige_decisao`: depois do CB, o `start` recusa ate haver sessao nova (FR-037) |
| `conta.conectores[]` | `core/ciclo/arranque.ts` (porta dos conectores) + `vigia/vigia.ts` (quem os arranca) | os **nomes** dos conectores que a mesa precisa de ter de pé. A mesa recusa arrancar sem eles e **diz qual**; o vigia arranca-os, e onde/como correr cada um é do host — os nomes resolvem-se no mapa de dublês (`vigia/vigia.ts`) até existir o registo de plugins |
| `fichas/<i>.risco.*`, `fichas/<i>.setup.*` | `core/ciclo/arranque.ts`, `core/ciclo/decisao.ts` | o que a mesa le para montar a boleta (bandas, parcial, desvio, stop, tp, relogio) |

**A lacuna que o recorte 003 fecha: o prazo de resposta do encerramento.** Em `encerrando` a mesa pergunta e
espera — e o prazo nao existia como chave (entrava como parametro do pedido, que e o mesmo que dizer que quem
chama e que sabe). Numa mesa manual este prazo e do **dono**. A chave passa a existir, com forma declarada
(RN-A3: a spec inventa a chave primeiro, e **o valor continua a ser do dono**):

| Chave | Tipo | Unidade | Omissao | Significado |
|---|---|---|---|---|
| `corretora.posicao` · `corretora.nocional` · `corretora.margem` · `corretora.distancia_de_liquidacao` · `corretora.resultado_nao_realizado` | decimal textual | unidade do instrumento / moeda da conta | **venue** (o CONECTOR relata; a mesa não recalcula nenhum — RN-V8) | os cinco números do resumo do encerramento. Sem eles a mesa **recusa** o `stop` com posição viva (`numeros_da_corretora_ausentes`): um número estimado apresentado como facto é pior do que não perguntar |
| `setup.prazo_de_resposta_ms` | inteiro positivo | milissegundos | **a ficha declara** (a omissao vai aqui quando o dono disser o valor; ate la, uma ficha sem ela **recusa**, nao adivinha) | quanto tempo a mesa espera pela resposta ao «fecho a mercado?» antes de voltar a operar com o `stop` pendente (RN-V9.1) |

**A linha na tabela de cima entra na mesma tarefa que traz o leitor** (T036 do recorte 003), e nao antes: uma
chave na tabela sem quem a leia e exactamente o que a conferencia recusa, e essa forca **nao** se relaxa para
acomodar uma tarefa.

**O que a conferencia apanhou (2):** a porta da sessao recusava por inibicao **sem ler**
`conta.arranque_apos_cb`: a politica estava num `if` (RN-A1). Passou a ler a chave, e a mesa **grita** se
ela faltar ou trouxer um nome nao declarado - uma mesa inibida que arranca por omissao e uma mesa que
ignora o CB que ela propria disparou.

**O que a conferencia apanhou:** o codigo lia `conta.politica_de_contencao` e o documento declara
`conta.contencao`. Duas coisas diferentes com o mesmo sentido — e o tipo de divergencia que so aparece
quando alguem as poe lado a lado. O codigo passou a ler o nome declarado; o conferidor
(`tools/verificar-maquina/chaves.ts`) confere exactamente isto: que o nome que o **codigo** usa e o nome
que o **documento** declara.

## 8. Emendas do dono — 28 set 2026

Decididas na revisão dos quatro botões que este recorte declarava e **não ligava**. Nenhuma delas é
«afrouxar um número»: três chaves **saem** (não fica limiar nenhum para o dono adivinhar) e uma **entra**
(um prazo humano). O desenho fica **menor** do que estava.

| Chave | O que era | O que passa a ser | Porque (palavras do dono) |
|---|---|---|---|
| `conta.idade_maxima_do_dado_ms` | limiar de idade do dado que travava a abertura | **sai.** «Estou ligado?» passa a vir do **protocolo da ligação**; a frescura do preço que vai para a corretora resolve-se **ao enviar** (releitura + desvio do venue); a idade da barra é regra do **setup**, que tem o OHLCV com o carimbo da corretora | em varejo o silêncio do tick **não** distingue mercado calmo de ligação morta — «por tick jamais é viável, tem de ser por protocolo próprio» |
| `conta.invalidos_seguidos_para_inibir` | N inválidos seguidos inibem a mesa | **sai.** O **motivo de cada erro** decide a acção, numa tabela por motivo: *repetir com atraso* · *recusar e registar* · *parar e reconciliar*. **Só se repete o que provadamente não foi feito**; sem confirmação, reconcilia-se primeiro | «é muito vago, depende do erro» — contar três erros diferentes como três do mesmo é o que torna o número sem sentido |
| `conta.risco_maximo_por_ordem_pct` | risco máximo por ordem, conferido pela mesa | **sai da mesa.** No mandato fica o que é comparável entre corretoras — **exposição (nocional)** e **distância mínima até à liquidação**; o limite da conta é da corretora, que calcula e aceita ou rejeita | «o plugin manda valores universais e o broker é que calcula e executa ou rejeita» |
| `conta.ordem_de_atendimento[]` | lista declarada de quem é atendido primeiro | **sai.** A contenda é **FIFO**, com desempate **alfabético pelo símbolo** quando dois pedidos trazem o mesmo instante. Decide **quem fica de fora** quando não há lugar para todos, nunca a ordem de execução de quem cabe | «ordem de atendimento FIFO» |
| `setup.prazo_de_resposta_ms` | **não existia** — o prazo entrava como parâmetro de quem chama | **entra.** Em `encerrando`, o tempo que a mesa espera pela resposta é valor do dono, declarado no template do setup | numa mesa manual esse prazo é do dono, não de quem chama |

### 8.1 O que passa a ser obrigação declarada do conector (manifesto)

> **CUMPRIDO — 29/09/2026** (contrato **1.6.0 → 1.7.0**; relatório `specs/004-conector-hyperliquid/
> relatorios/emenda-1.7.0.txt`; defeito **D-002 FECHADO** em `specs/002-maquina-de-estados/relatorios/
> DEFEITOS.md`). Os itens **1, 2 e 3** abaixo deixaram de ser prosa e são **campos obrigatórios** do
> manifesto — `ligacao_por_protocolo`, `releitura_de_preco_ao_enviar`, `devolve_a_resolucao` — e cada um é
> **medido** pela sonda no arranque (o `exchangeStatus` que o venue responde; a marca `activeAssetData.markPx`
> que é a régua relida ao enviar; o `userFills` com os números da execução). Ausente quem recusa é o contrato;
> presente e `false`, quem recusa é a **porta do arranque da mesa** e ela **nomeia qual**. O item **4** (a
> forma da marca de posse) já era campo obrigatório desde a 1.0.0.

Deixou de ser trabalho da mesa e passou a ser **capacidade que o conector declara** — e o manifesto é lido
uma vez, ao carregar:

1. **Reportar o estado da ligação pelo protocolo** da corretora. Se não puder, **dizê-lo** (recurso
   declarado, nunca descoberto em produção);
2. **Reler o preço no momento de enviar** e usá-lo como referência do desvio;
3. **Devolver a resolução** (quantidade na unidade da corretora, margem exigida, alavancagem efectiva,
   preço de liquidação) **antes de executar**, para a mesa a conferir contra a banda do mandato;
4. Declarar em que forma transporta a **marca de posse**.

### 8.2 O passo que faltava (achado desta revisão)

A mesa **não pode ficar sem conferir a conta que a corretora devolve contra a banda do mandato**. Sem esse
passo, passar o cálculo para o plugin passa também o **limite**: o plugin decide tamanho e ninguém verifica.

São **dois momentos**, e não se confundem (corrigido em 28 set 2026, a partir da pergunta do dono): **antes
de enviar**, onde o venue deixar perguntar (cotação/estimativa) a mesa confere e não envia; e **sobre a
resolução**, no caso geral de uma ordem **a mercado**, em que o venue calcula ao executar — aí não há nada
para conferir antes, e a resposta da mesa é **reduzir** (reduzir é sempre permitido) e **registrar a
divergência**. Para isto ser possível, a resolução tem de trazer **números** (quantidade na unidade dele,
margem exigida, alavancagem efectiva, preço de liquidação) e não um veredicto — «executou» não se confere.
Fica registado como obrigação do recorte do conector — e como **defeito declarado** enquanto não existir.

### 8.4 O que a emenda do plugin escreveu em regra (28 set 2026) — a base do recorte do conector

Da emenda do plugin e da confirmação da topologia saíram regras, e **nenhuma chave nova**: as que faltam na
§7 continuam a ser as mesmas (o prazo de resposta do encerramento e as bandas de cada item limitável).

- **RN-C12** (estado da ligação pelo protocolo) · **RN-C13** (releitura do preço no envio) · **RN-C14** (a
  resolução traz números, não veredicto) · **RN-C15** (cálculo é conversão, nunca risco) · **RN-C16** (o
  conector conhece uma só conta) · **RN-C17** (a tabela de acções chega à ponta) · **RN-C18** (o silêncio é
  estado) · **RN-C19** (manifesto por conta) · **RN-C20** (credencial por referência, uma chave por
  processo).
- **RN-L7** (a linha diz de que conta fala — e a atribuição não vem de qual processo escreveu).
- **RN-E21** (quem arranca os conectores é a camada de operação; o core não arranca processos) ·
  **RN-E22** (o alcance dos verbos: mesa, excepto `nova_sessao`, que é por conta) · **RN-E23** («uma mesa»
  no registo é a instalação).
- E o **manifesto por conta** (RN-C19) fica registado como alteração ao contrato na versão seguinte —
  ver `specs/002-maquina-de-estados/relatorios/DEFEITOS.md` (D-002).
### 8.5 O que o recorte 003 (o vigia e a mesa) passou a ler — 29 set 2026

O recorte 003 não inventou chaves de risco: passou a **ler** as que já estavam declaradas, e acrescentou uma
que faltava. Fica escrito **quem as lê**, porque uma chave que o código lê e que ninguém declarou é um valor
ajustável que ninguém sabe onde ajustar (RN-A1) — e uma que ninguém lê é um botão falso.

| Chave | Quem a lê agora | Para que |
|---|---|---|
| `fichas/<i>.risco.versao_do_mandato` (**nova**, §2) | `core/mesa.ts` (`novaSessao`) | fecha a **unidade de comparação** da sessão (`ficha`, `versao_do_setup`, `versao_do_mandato` — FR-034). O dono versona o mandato; a mesa **lê**, não decide. Sem ela o `nova_sessao` recusa `unidade_de_comparacao_nao_declarada` |
| `fichas/<i>.setup.prazo_de_resposta_ms` (§7) | `core/servidor.ts` (`lerPrazoDoDono`) | quanto a mesa espera pela resposta ao «fecho a mercado?» antes de voltar a operar com o `stop` pendente (RN-V9.1). Sem ela a mesa **recusa** o `stop` com posição viva |
| `corretora.posicao` · `nocional` · `margem` · `distancia_de_liquidacao` · `resultado_nao_realizado` (§7) | `core/servidor.ts` (`lerNumerosDaCorretora`), `core/ciclo/encerramento.ts` | os cinco números do resumo do encerramento, **relatados pelo conector**: a mesa não recalcula nenhum (RN-V8). Faltando um, recusa `numeros_da_corretora_ausentes` |
| `mercado.equity` (grandeza do **venue**, `origem-das-grandezas.json`) | `core/servidor.ts` (`lerEquityDePartida`) | o ponto de partida da sessão. Sem ele — ausente, fora da forma decimal, ou em **desacordo** entre instrumentos — o `nova_sessao` recusa `equity_de_partida_nao_lido`: uma base vazia faz o CB medir a perda contra o nada |
| `conta.conectores[]` (§7) | `vigia/vigia.ts` (quem os arranca), `core/ciclo/arranque.ts` (porta dos conectores) | os nomes dos conectores que têm de estar de pé antes do `start`. A porta `conectores` corre **na frente** das outras seis (FR-009) |

**Os três números que o código novo tem, e por que nenhum é ajustável pelo dono.** Corrido o varrimento sobre
os ficheiros de decisão do recorte (`vigia/*.ts`, `core/ciclo/encerramento.ts`, `core/ciclo/relogio.ts`,
`core/estado/sessao.ts`, `core/servidor.ts`), fora de comentários, aparecem **três** números de dois ou mais
dígitos — todos **esperas do próprio mecanismo**, nenhum deles do risco ou do dinheiro:

| Onde | Número | O que é |
|---|---|---|
| `vigia/vigia.ts` | `JANELA_DE_PROVA_MS = 400` | quanto se espera por um conector antes de o dar por **não de pé** (sondagem, não decisão: quem decide é a porta `conectores`) |
| `vigia/vigia.ts` | `proxima(ms = 60000)` | a espera máxima por uma linha da mesa: uma mesa muda não pode pendurar o vigia |
| `vigia/vigia.ts` | `mesa.proxima(10000)` | a espera pela **segunda** linha de um `stop` (a pergunta do encerramento). Não é o prazo do dono: esse vem da ficha e é ele que decide se a mesa volta a operar (§7) |

(O `core/estado/sessao.ts` e o `core/servidor.ts` acusam `039`, `006` e `63` — são pedaços de padrões de forma,
`[0-9]{2,}` e `{0,63}`, e não valores.)

### 8.3 Estado desta emenda (28 set 2026, mesmo dia)

As quatro decisões estão **implementadas e medidas** — é a **fase 10** do recorte 002, tarefas T064 a
T067, e o recorte voltou a fechar (**67 de 67**):

| Decisão | Onde ficou | Como se mede |
|---|---|---|
| a idade sai, a ligação fica | `core/ciclo/condicoes.json` (condição `sem_ligacao`) e `EntradaDoInstrumento.ligacao` | `bun run core/ciclo/provar.ts` — par de controle com o **mesmo dado** e a ligação trocada |
| o contador de erros sai, a tabela fica | `core/ciclo/acoes.json` + `acoes.ts` | idem — 21 motivos com acção, os 16 do contrato cobertos, prova negativa da repetição |
| a fila é FIFO | `core/ciclo/contenda.ts` (hora de chegada à mesa; soma em `BigInt`) | `bun run tools/verificar-maquina/contenda.ts` — 7 casos, com os instantes trocados |
| o prazo de resposta do encerramento | `setup.prazo_de_resposta_ms` (entra na §3) | par de casos em `pausa.casos.json` (US6/US7) |

**Porta única:** `bash tools/verificar-maquina/provar.sh` → **16 de 16**. Os três defeitos que esta
emenda deixa declarados (a conferência da resolução contra a banda, a casa das obrigações no manifesto,
e a hora de chegada na fila) estão em
`specs/002-maquina-de-estados/relatorios/DEFEITOS.md`, cada um com o número que prova que falta.

## 9. As chaves que o recorte 004 (o conector) passou a ler — 29 set 2026

O conector real (Hyperliquid) **não inventou chave nenhuma** e **não lê valor de credencial nenhum**: lê a
**referência** e vai buscar o valor a um sítio declarado **fora do repositório**. Fica escrito **quem as lê**,
porque uma chave que o código lê e que ninguém declarou é um valor ajustável que ninguém sabe onde ajustar
(RN-A1) — a mesma regra do §7.

| Chave | Quem a lê agora | Para que |
|---|---|---|
| `conta.credencial` | `brokers/hyperliquid/processo.ts` (`resolverFicha`, com `--ficha @config/contas/*.json`) e `brokers/hyperliquid/credencial.ts` | o **nome** da credencial. O valor nunca entra na ficha, na mensagem, no log nem no registo (FR-023, RN-E14); faltando ela, a recusa é **nomeada** |
| `conexao.credencial.valor_em` | idem (`credencial.ts`) | **de onde o valor entra**: `ficheiro:<caminho>` (exige modo 600) ou `env:<VARIAVEL>` — nunca um valor escrito no repositório |
| `conexao.ambiente` | `brokers/hyperliquid/processo.ts` (porta `ambiente_e_rede`) | `teste` ou `producao`. **Produção recusa**: a passagem a dinheiro real é decisão declarada do dono (RN-H17) |
| `conexao.url_da_api` | idem (porta `ambiente_e_rede`) | o endereço do venue, conferido contra o ambiente declarado |
| `conta.identificador` | idem (ficha → leituras da conta e sonda) | o endereço **master** da conta (a armadilha da documentação: com o endereço do agente o venue devolve vazio). Uma ligação, uma chave, uma conta |
| `conta.corretora` | idem (ficha) | o nome do venue falado (`hyperliquid`) |
| `conta.conectores[]` | idem (ficha: o primeiro nome) | o nome do conector do processo — o mesmo que a configuração declara |

Nenhuma destas chaves é nova: todas já estavam declaradas neste inventário (§1). O que é novo é **quem as lê**
e **em que momento** (o arranque do processo, antes de qualquer ordem).

### 9.1 Lacunas que a leitura do conector revelou

1. **`instrumentos` (raiz da config) ≠ `conta.instrumentos[]`.** O `resolverFicha` do conector lê
   `c.instrumentos` — uma chave de **raiz** — e, quando ela falta, usa **`["BTC"]` escrito no código**; o §1
   deste inventário declara `conta.instrumentos[]` como a chave do mandato. Consequências, medidas: (a) uma
   configuração do dono **sem** `instrumentos` faz o conector conferir o mandato errado (BTC) sem o dizer; (b)
   é um **valor por omissão dentro do código** (RN-A1). Não se corrigiu nesta vaga — fica declarado.
2. **O prazo do silêncio (`--prazo-do-venue-ms`).** A spec diz que o prazo que separa `espera` de
   `desconhecido` é **do dono, declarado na configuração**; hoje ele entra como **parâmetro da linha de
   comando**, com omissão `3000` ms escrita em `brokers/hyperliquid/conector.ts`. **`[falta]`** no inventário:
   a chave tem de existir antes de o valor poder ser do dono (RN-A3) — e o valor continua a ser dele.
3. **A cadência da re-sondagem.** O §9 de `docs/regra-de-negocio-conector.md` ainda a chama **proposta**. O que
   está medido é que a sonda lê o venue **a cada arranque** (FR-001) e que o manifesto segue a sonda **sem uma
   linha de código mudar** (caso `manifesto/mudanca-no-venue-muda-o-manifesto`). Fica dito como lacuna, não
   tapado com um número inventado.
