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
| `conta.invalidos_seguidos_para_inibir` | contagem | **`[novo]`** — RN-T4 dizia `ABERTA` e a chave não existia | mesa, ao contar inválidos seguidos (RN-T4) |
| `conta.credencial` | **referência**, nunca o valor | — | conector (RN-E14) |
| `conta.idade_maxima_do_dado_ms` | ms | **`[falta]`** — RN-D3 diz "limite declarado" e ninguém o declarou | mesa, cada ciclo (RN-D3) |
| `conta.retencao_ledger` | `{dias_integral, depois}` | **`[falta]`** — RN-L6 manda declarar | ledger (RN-L6) |

## 2. `fichas/<instrumento>.risco.*` — a posição (forma fixa, do core)

| Chave | Tipo / unidade | Exemplo de omissão | Quem lê |
|---|---|---|---|
| `saldo_pct` | % do saldo | — | boleta (RN-M4.3) |
| `alavancagem` | múltiplo | `1` | boleta (RN-M4.3) |
| `distancia_minima_liquidacao_pct` | % de movimento, **opcional** | ausente = ordem livre | porteiro na abertura (RN-M4.13) |
| `janela` | da posição (do setup) | — | mesa (RN-M5, RN-S3) |
| `estudo` | referência + data | ausente | validação (RN-E13) |
| `tolera_posicao_manual` | booleano | **`[novo][falta]`** — RN-T16 exige e a chave não tinha nome | mesa (RN-T16) |
| `bandas.saldo_pct` | `[min, max]` | **`[falta]`** — RN-M6.2 fala de banda e não a enumera para este item | validação (RN-M6.2) |
| `bandas.alavancagem` | `[min, max]` | **`[falta]`** | validação (RN-M6.2, RN-M4.4) |
| `bandas.stop_pct` | `[min, max]` | **`[falta]`** | mesa e validação (RN-S11, RN-M4.12) |
| `bandas.tp_pct` | `[min, max]` | **`[falta]`** | idem |
| `bandas.tempo_maximo_em_posicao` | duração | **`[falta]`** | mesa (RN-S11) |

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
| `fichas/<i>.risco.*`, `fichas/<i>.setup.*` | `core/ciclo/arranque.ts`, `core/ciclo/decisao.ts` | o que a mesa le para montar a boleta (bandas, parcial, desvio, stop, tp, relogio) |

**O que este recorte NAO declarou, e devia:** o **prazo de resposta do encerramento** (em `encerrando`, a
mesa pergunta e espera — `setup.prazo_de_resposta_ms` nao existe no inventario). Hoje ele entra como
parametro do pedido, que e o mesmo que dizer que quem chama e que sabe. Numa mesa manual este prazo e do
dono, e por isso fica aqui registrado como **lacuna**, e nao como decisao.

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
