# AUDITORIA PONTA A PONTA — o MesaCore, do sinal à mão

medido em **30/09/2026, 19:3x–19:5x (-03)** · `HEAD 1445ddf` · contrato vigente **1.9.0** · árvore **com 34 entradas por gravar** (33 de código + este documento)

Este documento responde a três perguntas, com números e não com adjectivos:

1. **os fallbacks saíram** — quantos eram, quantos saíram, e como é que o portão passou a impedir que voltem;
2. **a máquina funciona ponta a ponta com o `sigma`** — do cálculo do sinal à boleta entregue ao conector, com as
   linhas cruas da corrida de hoje;
3. **o que a auditoria apanhou** — dez defeitos corrigidos nesta vaga (com o sintoma medido de cada um) e o que
   fica aberto, por ordem de gravidade.

O que **não** foi medido diz-se não medido. Nenhum número aqui é estimado.

---

## 1. Os fallbacks: 167 → 0, e o portão passou a exigir zero

**O que se contava.** O conferidor (`tools/verificar-contrato/py/fallbacks.py`) contava `?? literal` e
`|| literal` em `core/`, `vigia/`, `brokers/` e `setups/` — 167 sítios em 23 ficheiros.

**Primeiro, a medição foi corrigida.** Quatro dessas 167 eram **prosa**: `?? "ligada"` escrito *dentro* de um
comentário de bloco, a explicar o fallback que já tinha sido retirado. O conferidor cortava a linha no primeiro
`//` e não sabia ler um `/** … */` — e ainda partia um `"https://…"` ao meio. Passou a ler o código a sério
(comentário de linha e de bloco fora; strings intactas). Medido: **167 → 163 reais**.

**Depois, os 163.** Por onde estavam:

| Onde | Sítios | O que eram |
|---|---|---|
| `brokers/` (conector, processo, mercado, sonda, leitura-do-mercado, histórico, manifesto) | 68 | decisões do caminho que move dinheiro |
| bancadas (`core/ciclo/provar.ts`, `core/estados/provar.ts`, `brokers/hyperliquid/casos/*`) | 52 | fichas de caso e valores de bancada |
| `core/` (servidor, arranque, ciclo, relógio, condições, contenda, máquina) | 26 | decisões da mesa |
| `vigia/` (vigia, operador) | 19 | o que passa entre o dono e a mesa |
| `setups/` | 2 | o plugin |
| **total** | **163** | |

**Como saíram, e não é tudo a mesma coisa** — três famílias, e a diferença importa:

1. **Decisão: passa a exigir-se, e falha.** É a família que o dono nomeou. Exemplos do que estava lá dentro:
   `config.fichas ?? {}` (uma config sem fichas passava as portas do mandato e da contenda — não havia nada para
   conferir — e chegava a `em_operacao`); `ambiente ?? "teste"` no `mercado.ts` (uma ficha de **produção** sem o
   campo lia-se como testnet); `unidade?.tick ?? "1"` no conector (um instrumento fora do manifesto compunha a
   resolução com um **tick inventado**, e é essa resolução que a mesa confere contra a banda); `prazo_do_venue_ms
   ?? 3000` (o número que decide se o silêncio do venue vira `desconhecido`); `decisao.motivo ?? "capacidade_nao_declarada"`
   (o conector **inventava o motivo** da recusa do contrato); `estado ?? "parada"` no vigia (uma resposta com
   `parada->parada` numa mesa cujo estado não se leu). Todas passaram a `exigir*` — **41 chamadas** de exigência
   no produto.
2. **Mensagem: um formatador com nome, uma vez.** Doze sítios eram `lista.join(", ") || "nenhum"` **dentro de
   uma mensagem**. Uma mensagem com a lista vazia precisa de uma palavra; isso não é um valor por omissão a tapar
   um campo — é texto. Passou a `contracts/esqueleto/texto.ts` (`lista`, `listaCom`, `ouAusente`), **50 usos**, e
   o operador de fallback desapareceu de onde estava.
3. **Bancada: o bloco que o caso não declara.** Nas fichas de caso, um bloco ausente (`conferir`, `respostas`,
   `remover`) era lido como bloco vazio. Passou a `brokers/hyperliquid/casos/blocos.ts` (`entradas`, `itens`),
   **28 usos**, e onde o caso devia declarar passou a `exigirDeclarado` — **34 das 38 fichas da tabela de
   transições passaram a declarar `marcas_presentes`**, que antes era omitido e valia «nenhuma marca».

**O portão mudou de catraca para zero.** Era «nenhum novo» (comparação com uma linha de base que só podia
descer). Agora é `--exigir-zero`: **um único sítio reprova o portão**, e a linha de base ficou vazia (`{}`).

```
$ cd contracts && uv run python ../tools/verificar-contrato/py/fallbacks.py --exigir-zero
fallbacks no produto: 0 sitios em 0 ficheiros
ok    zero fallbacks no produto (todos os ficheiros a zero)
```

---

## 2. A cadeia, do sinal à mão — medido agora, com o `sigma`

Corrida de hoje, 19:30–19:33 (-03), com o sistema a observar na conta de **teste** (`enviar: false`):
`DIR_DE_OBSERVACAO=…/observacao2 bash tools/operar-em-observacao.sh hl-teste-plugin SOL`.

| # | Etapa | O que se mediu (linha crua) |
|---|---|---|
| 1 | **O sinal** | `diagnostico 2026-09-30T21:00:00.000Z · ma=119.0788 · atr=1.1987 · mid=118.1150 · mid-ma=-0.9638 · sig=-1 · virada=0` — o motor calculou, sobre a última barra fechada |
| 2 | **A proposta** | `lado_da_proposta: "sell"` · `"plano, e o indicador esta' sell: entrada da barra 2026-09-30T21:00:00.000Z"` — e a **auto-conferência** do plugin contra o contrato 1.9.0 passou |
| 3 | **A operação** | `operacao.json`: leitura (SOL, `bid 118.21/ask 118.27`, `equity 989.822633`, `ordens_abertas: []`), `relogio: "1h"`, `marcas_nossas_conhecidas: []`, `falhas: {leitura: false, setup_respondeu: true}`, o template do setup |
| 4 | **A decisão da mesa** | `19:31:42 · ciclo 1 · SOL · acao: "abrir" · nota: "ciclo 1, condicao normal, com boleta"` — com a **boleta inteira** no registo (lado `sell`, `saldo_pct "10"`, `alavancagem "1"`, `desvio_maximo "0.5"`, `referencia_do_cliente: "mesa-sigma_v0-000001"`, `marca_de_posse: 1`) |
| 5 | **A trava da barra (D-021)** | `19:32:42 · ciclo 2 · nada · entrada_ja_feita_nesta_barra` (e o mesmo no ciclo 3) — uma entrada por barra fechada |
| 6 | **A mão** | `{"etapa":"carteiro","instrumento":"SOL","referencia":"mesa-sigma_v0-000001","enviei":false,"porque":"a ficha de SOL diz `enviar: false`: a boleta fica no registo"}` |

**A cadeia está fechada até ao último passo.** O que falta é o **interruptor**: `enviar: true` na ficha do par —
decisão do dono, e a única coisa entre este sistema e uma ordem a sério.

> **Nota de honestidade sobre o passo 1.** O motor é a tradução do `sign(mid − MA) + ZZ` (o indicador que o dono
> mandou), e essa tradução foi confrontada com a transcrição do Pine **em todas as combinações de `input`**: 68
> corridas, 0 divergências, sobre 505 + 73 barras. O que **não** está provado é o último elo — a transcrição é a
> minha leitura do Pine, e a semente do `ta.ema`/`ta.rma` é assunção. Isso fecha-se com dois números lidos da
> janela de dados do gráfico (§4, **P2**).

---

## 3. O que fica provado, etapa por etapa (e com que número)

| Etapa da operação | Onde vive | A prova | Número medido (hoje) |
|---|---|---|---|
| **Cálculo do sinal** | `setups/sigma/sinal.ts` (função pura) + `plugin.ts` | **a transcrição do indicador** (`pine-sigma.py`, escrita a partir de `setups/sigma/pine/sign-mid-ma-zz.pine`) × o motor, barra a barra, em **todas** as combinações de `input` | **68 corridas · 68 sem divergência · 0 barras divergentes** (505 barras de SOL H1 + 73 de BTC H1; `ma`, `atr`, `sig` e `virada` iguais) · **no portão**: `Pine x motor (todas as opcoes)` |
| **Uma entrada por barra** | `plugin.ts` (estado do setup) + `core/ciclo/relogio.ts` (trava) | observação: 1 proposta em 3 ciclos, e o travão nomeado | `abrir x1` + `nada (entrada_ja_feita_nesta_barra) x2` |
| **A proposta passa o contrato** | `plugin.ts` (auto-conferência) | `validar` antes de publicar; o plugin prefere **não propor** a propor mal | barra 21:00Z, `sell`, contrato 1.9.0 aceite |
| **A operação que a mesa lê** | `vigia/operador.ts` | campos obrigatórios: leitura, `relogio`, `marcas_nossas_conhecidas`, `falhas` | 1 instrumento, 1 leitura, `ligacao: ligada` |
| **A decisão da mesa** | `core/ciclo/*` + `core/estados/*` | bancada do ciclo (condições, ciclo, desfecho, banda, reconciliação) | **104 verificações · 0 divergentes · 12 casos de condição · 41 de ciclo · 10 de desfecho · 15 de banda · 6 de reconciliação** |
| **A tabela de transições** | `core/estados/{maquina.ts,transicoes.json}` | bateria de casos + invariantes | **38 casos · 13 aceites · 25 recusados · 0 divergentes · 0 recusas sem motivo** · 36 linhas · 0 falhas nos 7 invariantes |
| **A banda do mandato (D-001)** | `core/ciclo/banda.ts` | 15 casos + par de controle | dentro dos 104 acima · `nao_conferivel` trava a abertura |
| **A boleta** | `core/ciclo/decisao.ts` | a linha do ciclo com a boleta (observação) | `mesa-sigma_v0-000001`, `marca_de_posse: 1` |
| **A mão (mesa → conector)** | `brokers/hyperliquid/processo.ts` + `conector.ts` | 38 casos do caminho do envio + a bateria do venue | **38 casos · 38 ok · 0 divergentes · 262 verificações · 8 portas** |
| **O mapa de marcas (RN-T16.1, D-008)** | `marcas-<conta>.jsonl` + `leitura.ts` | append-only; a leitura atribui a posse cruzando as execuções | `marcas_nossas_conhecidas` viaja na operação (observação de hoje) |
| **Recuperação: reinício** | `core/estado/marcas.ts` | marcas sobrevivem ao reinício | **3 processos + 1 leitura externa · 0 falhas** |
| **Recuperação: vigia morto** | `core/servidor.ts` (relógio próprio) | a mesa continua a decidir sem o vigia | **10 voltas com o vigia morto · 10 voltas contadas × 10 linhas** |
| **Recuperação: encerramento** | `core/ciclo/encerramento.ts` | 7 cenários (prazo, manter, fechar, decisão-sem-pergunta, sem-números, sem-prazo, liquidação-cumprida) | **15 verificações · 0 divergentes** |
| **Recuperação: CB e sessão** | `core/ciclo/cb.ts` + `sessao.ts` | 13 casos, 7 disparos | **27 verificações · 0 divergentes** |
| **Recuperação: pausa/verbos** | `core/estados/transicoes.json` | 9 cenários (pausa-abrir, pausa-fechar, reset, sem-motivo, sem-equity, sem-unidade, completa, posicao-viva, campo-a-mais) | **12 verificações · 0 divergentes** |
| **Recuperação: pausa/encerramento (US6/US7)** | `core/ciclo/pausa.casos.json` | 5 + 7 casos | **21 verificações · 0 divergentes** |
| **Retenção do ledger (RN-L6)** | `core/estado/retencao.ts` | 14 casos, 7 aceites / 7 recusadas | **14 casos · 0 divergentes** |
| **A conta na linha do registo (D-004)** | `core/estado/registo.ts` | duas contas, reconstrução por conta, troca como controle | **12 verificações · 0 divergentes** |
| **A fronteira vigia ↔ mesa** | livro de motivos | 0 falhas nas duas direções | livro **55** motivos · **26** cruzam · **29** ficam · conjunto fechado com 27 nomes · 1 declarado na porta · `cruzam (26) = verdade (26)` |
| **O contrato nas duas linguagens** | `contracts/` | porta do contrato + conformidade | **134 casos em cada motor** (46 aceites + 88 recusados, os dois totais iguais) · **conformidade 9 de 9 · 241 verificações · 0 divergentes** · frescura: 30 ficheiros gerados batem com os schemas |
| **A porta única** | `tools/verificar-maquina/provar.sh` | **30 de 30** (e agora 31 com a bancada dos exemplos) | ver §5 |

---

## 4. O que a auditoria apanhou

### 4.1 Corrigido nesta vaga (com o sintoma medido)

| # | Defeito | Como se mediu | Correção |
|---|---|---|---|
| **A1** | O plugin `sigma` **carimbava a versão do contrato à mão** (`1.8.0`), e o contrato vigente é `1.9.0`: a proposta era recusada por `versao_do_contrato_divergente` e a auto-conferência do plugin calava-o. **O portão fez o que devia; o dono é que não soube.** | observação das 19:21: `"a minha propria proposta nao passa o contrato (versao_do_contrato_divergente) — prefiro nao propor a propor mal"`, volta após volta | a versão **lê-se** de `contracts/versao.json` (`versaoVigente()`), nos dois plugins e no exemplo Python. Prova: às 19:37 o mesmo sistema propôs `sell` |
| **A2** | O operador traduzia «o setup respondeu e **não propôs**» como `setup_respondeu: false` — o que põe o instrumento em `congelada`: **não abre, NÃO FECHA** (uma posição viva ficaria sem defesa) **e avisa o dono**. O `sigma` cala-se de propósito em todas as voltas menos uma por barra | observação de 18:08–18:19: **11 voltas seguidas** `ciclo … condicao congelada` com o plugin a funcionar como devia | `respondeu` = **o processo do setup correu até ao fim** (código de saída + validade da resposta). Prova: hoje, `falhas: {leitura: false, setup_respondeu: true}` com o setup calado, e a condição `normal` |
| **A3** | O vigia respondia **`comando_com_tipo_invalido`** a um comando com campo a mais (o motivo verdadeiro perdia-se num `?? ""`), e escrevia `parada->parada` numa resposta em que **não tinha lido** o estado da mesa | bancada dos verbos: `campo-a-mais · resposta="undefined"` e `52 verificações · 1 divergente` | `traduzirMotivoDoContrato` (grita em vez de inventar), `estadoParaAResposta` (não se responde por um estado que não se leu) e **o vigia confere a própria resposta contra o contrato** antes de a emitir. Prova: `campo-a-mais · resposta="comando_com_campo_a_mais"` |
| **A4** | `unidade?.tick ?? "1"` no conector: um instrumento fora do manifesto compunha a resolução com um **tick inventado** — e é essa resolução que a mesa confere contra a banda | `?? "1"` no caminho do envio (medido pelo conferidor) | instrumento fora do manifesto → **recusa nomeada** (`instrumento_desconhecido_no_manifesto`) |
| **A5** | `decisao.motivo ?? "capacidade_nao_declarada"` e `?? "campo_obrigatorio_ausente"` (3 sítios): o conector **inventava o motivo** de uma recusa do contrato | idem | motivo do contrato exigido; sem ele, grita |
| **A6** | `prazo_do_venue_ms ?? 3000` (2 sítios): o número que decide se o silêncio do venue vira `desconhecido` estava dentro de um `??` | idem | o conector **exige** o prazo; `processo.ts` declara-o uma vez, com nome |
| **A7** | `config.fichas ?? {}` (4 sítios no arranque): uma config **sem fichas** passava as portas do mandato e da contenda — não havia nada para conferir — e chegava a `em_operacao` | idem | `exigirFichas`: sem fichas (ou com zero) a mesa **não arranca** |
| **A8** | `ambiente ?? "teste"` (mercado e leitura-do-mercado) e `--ambiente X` sem conferência: uma ficha de **produção** sem o campo lia-se como testnet; um `--ambiente producaoo` valia teste | idem | ambiente exigido na ficha e conferido contra o conjunto |
| **A9** | O plugin podia correr **sem pasta de estado** (o registo da barra era opcional) e um **estado ilegível** contava como «ainda não entrei» — as duas portas para repetir a entrada | `PASTA_DE_ESTADO ?? ""` e o `catch` que devolvia «não» | a pasta é obrigatória; estado ilegível → **não propõe**; se não conseguir registar a barra, **não propõe** |
| **A10** | Os **dois setups de exemplo** (os moldes que se copiam) não estavam em bancada nenhuma — e tinham apodrecido: versão à mão e o Python **sem a `barra_ms`**, obrigatória desde a 1.8.0 | leitura + a bancada nova: antes, a proposta do Python não passaria o contrato | bancada nova `tools/verificar-setup/exemplos.sh`, **dentro do portão**: corre os dois moldes e julga a proposta deles com o contrato. **Nota de 30/09/2026: esta bancada já não existe.** O dono mandou reter **só o `sigma`** e retirar os outros setups, e com os moldes foi a bancada que os corria — o registo fica no git (`3cd4a29^`). A lição que ela deixou, essa fica: **bancada que não está no portão apodrece em silêncio** |
| **A11** | **O motor calava-se nas barras de arranque.** O Pine **não** exige ATR para decidir: a prontidão dele é `mid`/MA/tempo, e sem ATR a `banda` é **0** (sem zona morta) e o zigzag não trava. O nosso `calcular` tinha a barra inteira debaixo de `if (ma !== null && atr !== null)`: ficava `sig=0` nas primeiras `atr_len − 1` barras onde o gráfico **já tinha lado** | o confronto com a transcrição do Pine, pedido pelo dono: **13 barras de 505** com `sig` diferente (as #1..#13) e **5** com a `virada` diferente (#1, #9, #10, #11, #14) — a virada que o Pine marca na #1 saía-nos na #14 | `if (ma !== null)` e o ATR exigido só onde o Pine o exige (`atr !== null && atr > 0` no travão do zigzag). Depois: **0 barras divergentes em 505** e **0 em 68 corridas** de todas as opções. Retirado também o `espelho.py` — ele **não espelhava o Pine**: copiava a estrutura do nosso TypeScript e por isso nunca podia apanhar isto |

| **A12** | **A entrada acontecia sem flip.** O dono decidiu (30/09/2026): «um flip de sinal tem que fechar a ordem aberta e inverter»; «na inicialização a primeira operação só no primeiro flip»; «não pode abrir ordem no meio da perna»; «se foi fechada à mão só pode ser aberta no próximo flip». O plugin decidia pelo **lado** (`ponto.sig`), logo abria em qualquer barra em que estivesse plano e o indicador tivesse lado: no arranque (o histórico já tem lado) e depois de uma ordem fechada à mão | com as barras reais, o motor estava em `sig=-1` desde a viragem da **barra #501** e a última barra fechada (#505) tinha `virada=0` — e o plugin propunha entrada; a observação das 19:31 abriu por isso | a entrada passou a ser autorizada pela **`virada` da última barra fechada** (o triângulo), não pelo lado: `setups/sigma/plugin.ts` (`ladoDoFlip`) + bancada nova `tools/verificar-setup/sigma-casos.py` (**8 casos · 8 ok**, com as barras truncadas para que a última seja/não seja a barra do flip) e **no portão** |

### 4.2 Em aberto (não corrigido — precisa de decisão ou de desenho)

| # | O que está aberto | O número que o prova | De quem é a decisão |
|---|---|---|---|
| **P1** | **D-007**: a recusa `liquidacao_em_curso` (FR-013) existe na tabela e a máquina **lê-a** (`core/estados/maquina.ts:41,102`, `core/servidor.ts:538`) — mas **ninguém a produz**: fora das fichas da bancada, o campo **nunca é atribuído** (`grep 'liquidacao_em_curso:' core vigia brokers` → só `core/estados/transicoes.casos.json:409,422`). Numa corrida a sério, `encerrando + start` cai na linha `sempre` e volta a `em_operacao` | 0 produtores no código de produção; só a bancada declara o campo | desenho (trazer o estado da liquidação ao contexto, ou assumir que `start` durante `encerrando` é sempre «não feche») |
| **P2** | **A tradução está provada contra a *transcrição*, ainda não contra o gráfico.** O dono mandou o `sign(mid − MA) + ZZ` e a tradução bate com ele **em todas as opções** (68 corridas, 0 divergências) — mas a transcrição é a *minha leitura* do Pine, e a semente do `ta.ema`/`ta.rma` é **assunção** (documentada, não medida no gráfico). O indicador plots `mid - MA` e `sig` na janela de dados: **PRONTO do que falta** = ler no gráfico, numa barra fechada, o `mid-MA` e o `sig` (com o instante) e confrontá-los com os nossos — dois números fecham a semente e o alinhamento ao mesmo tempo | o nosso motor × a transcrição: `ma`, `atr`, `sig` e `virada` iguais em **505 + 73** barras e em 68 combinações; contra o gráfico: **não medido** | dono (ler dois números da janela de dados) — e, se algum dos outros dois Pines tem de mandar, também é dele |
| **P3** | As duas chaves que as regras exigem e **não existem em ficheiro nenhum**: `tolera_posicao_manual` e `bandas.tempo_maximo_em_posicao` | declaradas no `inventario-de-chaves.md` como falta; dependiam do mapa de posse (que hoje existe) | dono (o valor é dele) |
| **P4** | **O interruptor**: `enviar: true|false` no cabeçalho da ficha. As sete fichas do repositório dizem `false` | `grep '"enviar"' fichas/*/*.json` | **dono** |
| **P5** | A **superfície web** não existe (só o `README.md` com as regras) | `web/` | recorte por abrir |
| **P6** | **D-009 (idempotência)** e SC-004 (11 de 12 na bateria do venue) — provas que correm contra a testnet e movem dinheiro | `tools/testar-venue/bateria.ts` (fora do portão, de propósito) | dono (autorizar a corrida) |
| **P7** | O `docs/ONDE_ESTAMOS.md` **contradiz-se a si mesmo**: a narrativa (`:220`) diz que «o caminho mesa -> conector (a mao que aperta o gatilho) ainda nao esta'» fechado, e a lista de estado do mesmo ficheiro (`:291`) diz **✅** para «A mão: mesa → conector» — e o mapa de marcas (`:270` ⬜ e `:290` ✅) tem a mesma contradição. Medido hoje, o ✅ é o certo: a mão fechou (ficha `enviar: false`) e o mapa existe (`marcas-<conta>.jsonl`) | `grep -n "mesa -> conector" docs/ONDE_ESTAMOS.md` → `:220` (stale) e `:291` (✅) | eu (mas é um documento do dono: pedido) |
| **P8** | ✅ **DECIDIDO E FEITO (30/09/2026): manda o TRIÂNGULO.** O dono: «um flip de sinal tem que fechar a ordem aberta e inverter», «na inicialização a primeira operação só no primeiro flip», «nao pode abrir ordem no meio da perna», «se foi fechada à mão só pode ser aberta no próximo flip». O plugin passou a autorizar a entrada pela `virada` da última barra fechada (`ladoDoFlip`) e não pelo lado; o que fica **proibido** é abrir sem flip — fechar uma posição contra o indicador continua a ser proposto (é redução de risco), e a abertura do lado novo espera o flip seguinte. Provado em `sigma-casos.py` (8 casos, no portão) | caso **A** (plano, última barra sem flip) → **silêncio** com o motivo nomeado; caso **B** (a última barra É o flip) → proposta no lado do flip; **F** (posição contra, sem flip) → proposta de fecho; **G** (posição contra na barra do flip) → fecha e inverte | feito (era do dono decidir; decidiu) |

---

## 5. O portão, medido agora

```
$ bash tools/verificar-maquina/provar.sh
…
provar: 32 de 32 passaram — a maquina decide o que devia, e explica o que nao fez
```

Duas linhas nasceram nesta vaga, e as duas são o ponto:

* `Pine x motor (todas as opcoes)` — a tradução do indicador passou a ser confrontada com o Pine em todo o espaço
  dos `input` (era o A11: sem esta bancada, o motor e o gráfico discordavam nas barras de arranque e nada o dizia);
* `sigma: entrada so' no flip (8 casos)` — a regra da entrada (a decisão do dono, A12/P8) passou a ter casos próprios.

Uma terceira nasceu e saiu dentro da mesma vaga — `setups de exemplo (contrato)`, que corria os dois moldes de
setup: o dono mandou reter **só o `sigma`**, os moldes foram retirados, e a bancada foi com eles. A catraca dos
fallbacks (`fallbacks (ZERO exigido)`) já existia e continua a exigir zero.

As restantes 30 são as de sempre: tabela de transições, porteiro do estado, a mesa, a máquina de estados, as
condições/o ciclo/o desfecho, o arranque (sete portas), tipos, sessão e CB, pausa e encerramento, registo,
retenção do ledger, contenda, chaves do core, marcas sobrevivem ao reinício, porta da mesa, preparar contas,
conector offline, envio do conector, vigia + mesa, orfandade, encerramento, verbos, contrato neutro, frescura,
fronteira, dublê de mesa, inventário de chaves.

---

## 6. A máquina de estados: está completa?

Os quatro eixos (`docs/maquina-de-estados.md`) e onde cada um é decidido **hoje**:

| Eixo | Estados | Onde é decidido | Cobertura medida |
|---|---|---|---|
| **Mesa** (ciclo de vida) | `parada` · `em_operacao` · `pausada` · `encerrando` | `core/estados/maquina.ts` + `transicoes.json` | 38 casos · 0 divergentes · 0 recusas sem motivo |
| **Condição do instrumento** | `normal` · `sem_leitura` · `divergente` · `congelada` · `mercado_fechado` | `core/ciclo/condicoes.ts` | 12 casos de condição + as três confusões (§5 do documento da máquina) nos 41 de ciclo |
| **Posição do instrumento** | `nenhuma` · `abrindo` · `aberta` · `fechando` | `core/ciclo/{ciclo,desfecho,reconciliacao}.ts` | 10 de desfecho + 6 de reconciliação · `desconhecido` como estado de primeira classe |
| **Marcas persistidas** | `sessao` · `inibicao_cb` · `desconhecido` · (mapa marca → ficha) | `core/estado/marcas.ts` + `marcas-<conta>.jsonl` | reinício: 3 processos + 1 leitura externa · 0 falhas; CB: 7 disparos |

**A resposta curta: a máquina está completa nos quatro eixos e nas transições — com uma linha que nunca corre
(P1, `liquidacao_em_curso`) e uma etapa cuja fonte não está provada (P2, o sinal).** Tudo o resto do percurso
— condição, decisão, banda, boleta, mão, posse, reinício, CB, encerramento, retenção — tem prova medida nesta
corrida ou nas bancadas que o portão corre.

---

## 7. As três coisas que dependem do dono, por ordem

1. **O interruptor** (`enviar: true` na ficha do par) — é o que falta para a mão fechar a sério. Enquanto
   estiver `false`, o carteiro entrega a boleta ao conector e **regista que não a enviou, com a razão**;
   nada sai por omissão e nada se esconde.
2. **O `sigma` que manda** (P2): o motor do MesaCore e os dois Pines do projeto antigo são três regras
   diferentes. Antes de o dinheiro andar, alguém tem de dizer qual é a regra — e a partir daí a bancada que a
   compara com o gráfico.
3. **O commit** (ver §8): a árvore tem 33 entradas por gravar, com 1.616 linhas adicionadas e 786 removidas.

---

## 8. Incidente registado: uma sessão-irmã do meu próprio profile pôs a minha árvore em `stash`

> **NOTA DATADA — 30/09/2026, 20:0x (-03) — a ATRIBUIÇÃO deste § estava errada, e é ela que decide o remédio.**
> O texto original dizia «um worker alheio» (título) e «um processo de outro perfil» (fecho). Medido, agora, e não
> inferido: quem guardou foi uma **sessão-irmã deste mesmo profile** — desktop «Auditar estado atual do MesaCore»,
> sessão `20260929_193900_d185d7`, `cwd /home/cerucci/Projects/MesaCore`:
>
> ```
> 30/09 19:25:38 (-03) [Auditar estado atual do MesaCore] assistant: … o portão correu *sobre esta árvore suja*.
>                      Guardo o lote sem o perder e re-meço o trunk limpo.
>                      tool call: cd /home/cerucci/Projects/MesaCore && git stash push -u -m "lote de limpeza de
>                      fallbacks (30 ficheiros) que estava na arvore sem commit em 30/09 - guardado para nao sujar
>                      o trunk; …"
> 30/09 19:27:41        tool output: "Saved working directory and index state On master: lote de limpeza de fallbacks …"
>
> $ git reflog --date=iso | head -3
> 1cfe787 HEAD@{2026-09-30 19:29:04 -0300}: commit: os plugins LEEM a versao do contrato …
> 1445ddf HEAD@{2026-09-30 19:25:39 -0300}: reset: moving to HEAD      <- o `stash` interno (é um `reset --hard`)
> 1445ddf HEAD@{2026-09-30 18:29:54 -0300}: commit: ONDE_ESTAMOS: 3b e a mao fechados …
> ```
>
> Não houve worker nenhum naquela janela: os logs do kanban têm um vazio entre 29/09 13:03 e 30/09 19:40, os
> `task_runs` de **todas** as boards não têm corrida entre 18:26 e 21:00, e o cron teve **0** execuções em 30/09.
> A atribuição do cartão veio do **autor do commit** — e o autor não identifica o processo: `~/.gitconfig` é
> `user.name = DevOpsBot`, **global**, para qualquer processo desta máquina.
>
> **A lição verdadeira muda a regra:** o risco não é «outro profile a entrar» — é **duas sessões do MESMO profile na
> mesma árvore**. Este documento tinha mexido na árvore 8 m 42 s antes do `stash` (19:16:57 contra 19:25:39), e a
> sessão que guardou leu **30 ficheiros do produto como restos de corridas mortas**, não como trabalho vivo.
>
> **O remédio passou a estar armado.** Guarda que recusa, executada pelo `default` e provada em
> `PROVA-guardiao-arvore.md` (anexo do cartão `t_d7c901b3`); medida por mim às 20:00 de 30/09:
> `~/.hermes/agent-hooks/guardiao-arvore-alheia.py` (11 037 bytes), registado em `pre_tool_call` com
> matcher `terminal` e `doctor` verde nos **5** homes (`hermes -p appbuilder hooks list/doctor`). Worker que
> reescreva árvore fora do seu workspace → **recusa dura**; sessão do dono com outra sessão viva naquela árvore
> (actividade ≤ 30 min) ou fora da árvore dela → **pedido de aprovação** (em não-assistido vira recusa). Verbos
> guardados: `stash push/save/pop/apply`, `checkout`, `switch`, `restore`, `clean`, `reset --hard/--merge/--keep`.
>
> **O protocolo que fica escrito** (é o pedido 2 do cartão `t_0b6264b2`, e vale para qualquer sessão desta casa):
> se precisares da árvore limpa e ela está suja → **parar e reportar**, com `git status --short` no corpo do cartão,
> e `kanban_block` quando a decisão não for tua. **Ninguém limpa a árvore por conta própria:** quem decide se o
> `trunk` fica limpo é quem trabalha lá, não quem passa por lá. Precisa-se de um estado limpo para medir? Mede-se
> numa **cópia dentro do próprio workspace** (`cp -a` ou `git worktree add`), nunca com um `stash` na árvore
> partilhada — e uma excepção a uma guarda **vai por cartão ao `default`**, com comando e saída, nunca por contorno.
>
> **Estado à hora desta correcção:** `HEAD 1cfe787` · `git status --short | wc -l` → **42** entradas por gravar
> (as 34 de então cresceram) · e o `stash` daquele lote **já não existe** (foi aplicado; em `git stash list` fica só
> o do subagente de 29/09).
>
> **NOTA DATADA — 30/09/2026, 20:2x (-03) — o que a arbitragem do cartão `t_00cf9896` confirmou, e o que ela muda no
> parágrafo acima.** (Decisão do árbitro, opção 3; pedido meu, registado aqui porque é aqui que uma sessão lê.)
>
> 1. **A guarda passou a ter duas camadas, e o texto acima descrevia uma só.** `terminal` continua a
>    **recusar/aprovar** (medido pelo árbitro: `git stash push` com `HERMES_KANBAN_WORKSPACE` → `block`, nomeando a
>    sessão viva; sem a variável → `approve`). `write_file`/`patch` **não são travados — são REGISTADOS** em
>    `~/.hermes/logs/guardiao-arvore.jsonl` com `raiz_git`, `arvore_alheia` e `trabalho_vivo`. O `matcher` é agora
>    `terminal|write_file|patch` nos **5** homes. Conferido por mim, 30/09 20:1x: `hermes -p appbuilder hooks list`
>    → `matcher='terminal|write_file|patch'`; `hooks doctor` → *All shell hooks look healthy*; `md5sum` do hook →
>    `b7eacd1af58ec7a8d9c918f31e382275` (cópia pré-mudança: `.bak-escrita-20260930-2010`).
> 2. **Recusar a escrita directa foi recusado, com contraprova:** o worker de kanban nasce com workspace `scratch`,
>    **fora do repo** — logo «fora da minha árvore» dispararia em **todas** as escritas de um worker para o
>    repositório, incluindo o fluxo que este próprio repo já usou. Travar ali trocaria colisão rara por bloqueio
>    diário. O que a decisão acrescenta ao que já havia é o **número**, não a recusa.
> 3. **Correcção de uma frase minha, com o número do árbitro:** o `patch`/`write_file` **não recusa** leitura
>    obsoleta — emite `_warning: "... was modified since you last read it on disk ..."` **e aplica**
>    (`"success": true`). Ele mediu **12** ocorrências em `~/Projects` (última 30/09 19:27:21, `setups/sigma/plugin.ts`).
>    Não é «o editor avisou e as âncoras casaram»: é «o editor avisou e a escrita passou».
> 4. **A causa-raiz que a guarda não resolve — e o remédio estrutural, que já existe.** O risco não é «outro
>    profile»: são **duas sessões do MESMO profile na mesma árvore** (o worker de um cartão + uma sessão desktop).
>    Medido pelo árbitro: **574 pares colidentes** (mesmo ficheiro, **sessões diferentes**, ≤1800 s) em `~/Projects`
>    — 12 ficheiros, 16 sessões, tudo no home `appbuilder`; 2157 chamadas `patch`/`write_file` em 300 ficheiros.
>    Remédio: **cartão criado com `project=mesacore`** deixa o worker em `<repo>/.worktrees/<task-id>` (git
>    worktree) — não há trunk partilhado para colidir, e a classe desaparece **sem guarda nenhuma**. `MesaCore` já é
>    projecto registado no store do `appbuilder` (`p_8fac7eec`, `primary_path=/home/cerucci/Projects/MesaCore`,
>    `active_id` — conferido por mim no `projects.db`). Quem cria cartões cujo worker escreve neste repo **usa
>    `project=mesacore`**; a regra ficou também na skill `field-defect-triage`.
> 5. **Gatilho de escalada (fica dito; nada a decidir hoje):** se o registo mostrar escrita sobre ficheiro que a
>    outra sessão mudou desde a última leitura do autor — a classe que hoje só é avisada — ou a contagem subir acima
>    do que a casa aceita, o desenho da recusa dirigida vai ao dono **com o número à frente**. E as linhas **141, 142,
>    145, 157-159** (e 170) do log são provas de laboratório, não escritas reais: excluir de qualquer contagem.
>
> **Observação desta sessão, para quem trabalha nesta árvore (não committei nem limpei nada por conta própria):** no
> instante em que escrevi esta nota o ficheiro era **não rastreado** (`git status --short` → `??`) e a árvore tinha
> **44** entradas por gravar (`HEAD` então `1cfe787`). Às **20:17:36** a árvore foi gravada em **`3cd4a29`**
> (45 ficheiros, +3277/−898): medido, foi o dono que mandou («comita tudo», na sessão-irmã do desktop) — e não o
> autor do commit, que é `DevOpsBot` para **qualquer** processo desta máquina. As duas notas desta arbitragem (esta e
> o §7 do `ONDE_ESTAMOS`) **ficaram por gravar**: `git status --short` → ` M docs/AUDITORIA-PONTA-A-PONTA.md` e
> ` M docs/ONDE_ESTAMOS.md`, e o diff dessas duas entradas é **só o texto desta nota** (`git diff --numstat -- docs/`;
> não se transcreve o total aqui porque esta própria linha o mudaria). A regra
> da casa é «trabalho longo grava-se em git» — quem grava é quem
> trabalha nesta árvore, e esta sessão (worker de cartão, workspace `scratch`) **não** grava nem limpa nada aqui:
> fica o estado exacto, a decisão fica com quem lá trabalha.
>
> *Texto original, preservado (o registo é auditável):* título «um worker alheio pôs a minha árvore em `stash`»;
> fecho «um processo de outro perfil entrou no directório de trabalho desta sessão e guardou em `stash` trabalho por
> gravar, sem o dizer».

Enquanto esta vaga corria, **às 19:25:39**, o repositório apareceu-me **sem nenhuma das alterações de hoje**
(`git status` com dois ficheiros) e o `tools/verificar-setup/exemplos.sh` tinha desaparecido. Medi:

```
$ git stash list
stash@{0}: On master: lote de limpeza de fallbacks (30 ficheiros) que estava na arvore sem commit em 30/09 -
  guardado para nao sujar o trunk; contem o fallbacks-baseline e o provar.sh alterados, e mudancas de
  assinatura em brokers/ e vigia/
$ git show --stat stash@{0}^3
Author: DevOpsBot <devops@example.com>   Date: Wed Sep 30 19:25:39 2026
 brokers/hyperliquid/casos/blocos.ts | 36 +++
 contracts/esqueleto/texto.ts        | 38 +++
 tools/verificar-setup/exemplos.sh   | 70 +++
```

**O que fiz:** guardei a diferença que tinha na mão, revertí os dois ficheiros que colidiriam, `git stash pop`
(30 modificados + 3 novos, todos de volta), re-apliquei as duas correcções e voltei a medir tudo:
`tipos 0 erros`, `fallbacks 0`, os dois exemplos a passar, e a cadeia ponta a ponta outra vez observada.
**Nada se perdeu.**

**O que fica dito, e não é para mim** (frase corrigida — o texto original está citado na nota datada no topo deste
§): a árvore **não tinha um dono exclusivo**, e quem a guardou foi uma sessão-irmã deste próprio profile — não um
worker, não outro profile. O nome diz «para não sujar o trunk», e o efeito foi **tirar a árvore debaixo dos pés de
quem estava a trabalhar nela** — a meio de uma vaga com 90 ficheiros tocados. Uma vaga destas, sem o `stash`,
ter-se-ia perdido inteira: só não se perdeu porque o `stash` guardou em vez de apagar. O remédio é o de sempre
nesta casa — **trabalho longo grava-se em git** — e agora tem guarda: quem entra num directório que não é o seu, ou
que outra sessão tem aberto, **não reescreve a árvore: para e reporta** (`git status --short` no corpo do cartão,
`kanban_block` quando a decisão não é sua).
