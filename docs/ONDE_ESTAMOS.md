# ONDE ESTAMOS — o retrato medido do MesaCore

medido em **03/10/2026 (madrugada), 01:3x (-03)** · contrato vigente **1.11.0** · portão **38 de 38** · árvore **limpa** · o feed de mercado tem a agregação corrigida (ver a secção desta vaga, no fim)

> **Nota de rigor:** este cabeçalho dizia `HEAD 08d13d3` e «contrato 1.7.0» durante cinco emendas — um número
> escrito à mão num documento envelhece sozinho e passa a mentir. O `HEAD` lê-se do `git log`; o que este
> documento tem de garantir é a **data** da medição e o **contrato vigente**, que são o que muda o sentido dos
> números. (O mesmo erro esteve no `tools/operar-em-observacao.sh`, que carimbava a versão do contrato à mão
> e foi corrigido a 30/09/2026: a versão lê-se do `contracts/versao.json`, nunca se escreve.)

> **A árvore, medida agora.** `git status --short` mostra **um** ficheiro sujo:
> `config/contas/hl-teste-plugin.json`, que guarda os três pares da conta (SOL, BTC, ETH). Ele **não entra no
> repo** — o `.gitignore` diz, com todas as letras, que `config/contas/` «é ESTADO e não se versiona» — mas o
> ficheiro **está rastreado** (`git ls-files` mostra-o), e por isso o git continua a mostrá-lo como alterado.
> É uma contradição entre o `.gitignore` e o índice, e eu **não** a resolvo sozinho: tirá-lo do índice (`git rm
> --cached`) é uma remoção do repositório, e decidir se a config das contas é versionada é do dono. O que é do
> repo — as fichas do σ (BTC, SOL e a nova do ETH) e este documento — está commitado.
>
> **RESOLVIDO — 02/10/2026 (noite, 2ª parte), por decisão do dono: a via é a (b) — a config das contas passa a ser
> VERSIONADA.** O parágrafo acima fica como retrato da contradição (e da razão por que ela não era minha para
> resolver); o que mudou: a linha `config/contas/` **saiu** do `.gitignore`, com nota datada, e a config da conta
> (com os três pares: SOL, BTC, ETH) passou a ser **conteúdo versionado e conferido** — a árvore fica **limpa**
> (`git status --short` sem uma linha), e o `git log --oneline origin/master..HEAD` vazio.
>
> Porque é que isto é seguro, e o que o sustenta: a config da conta guarda a **REFERÊNCIA** da credencial
> (`conta.credencial`) e o **CAMINHO** onde o valor mora (`conexao.credencial.valor_em`) — **nunca o valor**.
> Medido antes de decidir, sem imprimir valores nenhuns: nenhum campo do ficheiro é segredo; o que mudou face ao
> `HEAD` foi só `conta.instrumentos` (`["SOL"]` → `["SOL","BTC","ETH"]`); o caminho da chave
> (`~/.config/mesacore/credenciais/...`) já estava publicado neste repositório (`config/README.md`, que é
> versionado). E a rede continua montada: o `.gitignore` mantém `*.chave`/`*.key`/`*credencia*`, e o carregador
> **recusa** um valor que apareça num ficheiro versionado (`credencial/valor-que-esta-no-repositorio-recusa`).
> Nota de honestidade sobre o alcance: versionar **não** reescreve a história — o ficheiro já lá estava nos
> commits anteriores; o que a decisão muda é o que o repositório diz que deve estar lá.

## 0. O que mudou por último (02/10/2026) — a aquisição de mercado sai do caminho da decisão

O operador puxava as velas **dentro do laço que decide** (`await garantirVelas` antes de pedir a proposta ao
setup): 1,2-1,5 s de bloqueio por puxão, um processo `bun` **novo** por puxão (80 MB de pico) e um pedido ao
venue por par. Quando o ritmo da volta subiu para 1 s, o venue respondeu **253× `429 Too Many Requests`** em menos
de dois minutos.

Medido no venue: ele **empurra** — `bbo` (melhor bid/ask) a **~0,5 s**, `candle` no fecho de cada barra,
`allMids` a 5 s. Por stream **não há pedidos**, e uma ligação serve 3 ou 20 pares.

**O que existe agora:** `brokers/hyperliquid/feed.ts` — um processo por venue, lançado pelo operador ao lado do
conector, que escreve **os mesmos ficheiros que os consumidores já liam** (`velas-<PAR>-<RELOGO>.jsonl` e um
`precos-vivos.json`). Por isso **nada mais mudou**: o setup, a sobreposição/painel, o contrato e a mesa não
sabem que ele existe. A barra **em curso** é **agregada do `bbo`** e vai declarada (`agregada_do_bbo: true`); o
venue, quando manda a barra do mesmo período, **substitui-a**. O `v`/`n` ficam a zero — o livro não os diz, e
inventá-los seria fingir uma medida que não foi feita.

**Medido ao vivo** (corrida de risco, 3 pares): ficheiros com **0,6-19 s** de idade, `precos-vivos.json` a
**0,6 s**, **0 puxões** ao venue, e o custo do processo em **~7 MB em regime** (contra 80 MB de pico *por puxão*).

**O que ainda não está feito:** o feed **não tem bancada própria** (as provas acima são de execução ao vivo, não
do portão), e o **orçamento de pedidos ao venue** continua **por medir** em produção.

> **NOTA DATADA — 02/10/2026 (noite, 2ª parte).** A primeira metade desta frase deixou de ser verdade e fica
> corrigida onde a raiz foi fechada: **o feed TEM bancada** e ela entrou no portão (`37 → 38`). O que ela mede é o
> **núcleo puro** (extraído para `feed-barras.ts`, um módulo SEM efeitos ao carregar — o `feed.ts` liga-se ao venue
> no arranque, e quem o importasse abria uma ligação a sério); a **ligação ao venue** continua a ser prova de
> execução ao vivo, e isso está dito no cabeçalho da bancada. O **orçamento de pedidos** continua por medir — essa
> metade segue válida. O detalhe todo está na secção desta vaga, no fim do documento.

Este é o documento que se abre primeiro. Cada número aqui foi medido nesta hora — o comando vem ao lado — e o
que não foi medido diz-se **não medido**, com a razão. Nenhum adjectivo substitui um número.

## 1. O que existe hoje — e o que você consegue abrir

| O que | Onde está | Você consegue abrir? |
|---|---|---|
| A regra de negócio (149), a máquina de estados, o inventário de chaves, o diagrama | `docs/` | Sim — leitura, no computador |
| O conector Hyperliquid: lê o venue, traduz, recusa, lê o histórico | `brokers/hyperliquid/` | **Não tem tela** — é peça de máquina, provada por comandos |
| A mesa e o vigia (o ciclo, a boleta, o ledger, a operação) | `core/`, `vigia/` | **Não tem tela** |
| A superfície web | `web/` | **Não existe**: o diretório tem só o `README.md` com as regras que ela deve cumprir |
| A conta de teste no venue | `config/contas/hl-teste-plugin.json` (versionada desde 02/10/2026, por decisão do dono) | Sim, no broker |

**Nada disto se abre no telefone.** Não há uma tela construída. O que existe é máquina e prova.

## 2. O que está feito e medido (bancadas corridas agora)

> **Nota datada — 03/10/2026.** Esta é uma tabela **VIVA** (o cabeçalho da coluna diz «corrido agora»), e por isso
> foi **re-medida** nesta hora — o portão inteiro mais os comandos de cada linha. O que ela dizia antes
> («29/09, 19:39–21:2x», com «29 de 29», «1.7.0 · 131 casos», «livro 50 · 24 ficam», «ordens+cloid 40»,
> «17.895+ linhas») **envelheceu em cinco emendas** e passou a mentir: um número escrito à mão numa tabela viva
> envelhece sozinho. O retrato antigo fica alcançável no histórico (`git show <commit>^:docs/ONDE_ESTAMOS.md`) —
> não se reescreve o passado, corrige-se o presente.

| Bancada | Comando | Número medido (03/10/2026) |
|---|---|---|
| A porta única da máquina | `bash tools/verificar-maquina/provar.sh` | **38 de 38 passaram** (o número lê-se sempre na última linha da própria porta) |
| O **ciclo** e as bandas (D-001 e D-008) | `bun run core/ciclo/provar.ts` | **118 verificações · 0 divergentes** — 12 de condição · **47 de ciclo** · 10 de desfecho · 15 de banda · 6 de reconciliação |
| A **tabela de transições** (D-006) | `bun run core/estados/provar.ts` + `bun run tools/verificar-maquina/tabela.ts` | **38 casos · 13 aceites · 25 recusados · 0 divergentes** + **36 linhas · 0 falhas nos 7 invariantes** |
| A **fronteira** vigia ↔ mesa (motivos) | `uv run python tools/verificar-contrato/py/fronteira.py --motivos` | **0 falhas** — livro **56** motivos · **26** cruzam · **30** ficam · **1** excepção da porta |
| A **retenção do ledger** (RN-L6) | `bun run core/estado/retencao.prova.ts` | **14 casos · 7 declarações aceites · 7 recusadas · 0 divergentes** |
| A **conta na linha do registo** (D-004) | `bun run tools/verificar-maquina/registo.ts` | **16 verificações · 0 divergentes** — duas contas, reconstrução **por conta**, e a troca como controle |
| **A porta do MERCADO** (velas + livro, para as features e para o estudo) | `bun run brokers/hyperliquid/mercado.ts --velas BTC --intervalo 1h --dias 7` · `--livro BTC` · `--intervalos` | **169 velas** de BTC 1h (7 dias) lidas na TESTE e na producao · livro **20/20 niveis** (o manifesto declara 20) · **14 intervalos** medidos na fonte do SDK · CSV para estudo: **721 velas** (30 dias) |
| O conector, offline | `bash tools/verificar-conector/provas-offline.sh` | **0 falhas** — credencial 9 · manifesto **24** · ordens+cloid **50** · leitura 14 · histórico **26** · posse do preenchimento **17 de 17** |
| **O caminho do envio** (tradutor + processo) | `bun run brokers/hyperliquid/processo.ts --bancada` | **38 casos · 38 ok · 0 divergentes · 262 verificações · 8 portas** |
| **A bancada do FEED de mercado** (núcleo puro, sem rede) | `bun run brokers/hyperliquid/casos/correr-feed.ts` | **15 provas · 15 ok · 0 divergentes** — com as duas regras de 03/10/2026 (a agregação só toca em barra NOSSA; a lista fica ordenada por `t`) e a prova negativa de **10 de 10** nomes de caso (`casos/prova-negativa-do-feed.sh`) |
| **A bateria de TESTE do venue** (SC-004, a que envia) | `bun tools/testar-venue/bateria.ts --ate 8 --registar` | **21 provas · 20 passaram · 1 reprovou** — e é **D-009** (a idempotência). O **D-010** (a alavancagem nunca era pedida ao venue) foi **fechado nesta vaga**: o conector pede-a (`updateLeverage`) e confirma-a pela leitura antes de a resolução sair — medido ao vivo, o venue passou de 40 para os 2 que a boleta pede. **O D-013** (o lado oposto a uma posição nossa não era distinguido de «abrir») também ficou **fechado**: passa a `fechar` com `reduce_only`, nunca abre do outro lado, com par de controle e espelho no `core/ciclo/provar.ts` (**102 verificações · 0 divergentes**). O **D-011** (a boleta pedia stop e o stop não saía) foi fechado na varredura do vocabulário — passou a **recusa nomeada**, e deixou de ser silêncio. A varredura cobre os **15 valores** que um setup pode usar (6 aceites, 9 recusas nomeadas) e está em `specs/004-conector-hyperliquid/relatorios/cobertura-do-vocabulario.md`; dela saíram ainda **D-012** (o `limite` inalcançável) e **D-013** (o lado oposto à nossa posição não é distinguido de «abrir»). Corre contra a TESTNET e move dinheiro: **não** entra no `provar.sh` |
| A conformidade do conector (offline) | `bun tools/verificar-conector/conformidade.ts` | **9 de 9 · 241 verificações · 0 divergentes** (a linha do venue diz `INCOMPLETO` — nunca `passou`) |
| O contrato nas duas linguagens | `bun tools/verificar-conector/porta-do-contrato.ts` | **0 falhas** — contrato **1.11.0** · **136 casos** nos dois motores · **22 motivos** fechados nas duas direcções · 23 sondas da emenda |
| As tarefas dos recortes | `grep -c '^- \[x\]' specs/*/tasks.md` | 001 **59/59** · 002 **67/67** · 003 **63/63** · 004 **74/74 medidas** · 005 **13/52** — as três últimas do 004 (T042/T048/T057) foram medidas na testnet e **dois critérios não se cumprem**: SC-003 (D-009) e SC-004 (11 de 12) |
| O tamanho do que é nosso | `git ls-files` + `wc -l` | **28.408** linhas de TypeScript (com o gerado) · **9.959** de Python · **4.554** de shell |

## 3. O que NÃO existe (e não é «espera» — é falta)

> **NOTA DATADA — 29/09/2026 (a porta do mercado existe; a LIGAÇÃO ainda não).** O `brokers/hyperliquid/mercado.ts`
> dá as velas e o livro, com prova (`169 velas`, `20/20 níveis`, CSV para estudo). O que **não** existe é quem
> **escreva o ficheiro de operação** a cada volta — e é por ele que a leitura chega ao ciclo e o setup calcula as
> suas features. Medido: o vigia escreve só o ficheiro das portas, o servidor não escreve nada, e o único produtor
> do ficheiro de operação é a bancada (`tools/verificar-maquina/vigia.ts`). Por isso o setup **ainda não tem dados
> de mercado em operação**, apesar de a porta existir. Cartão aberto com o desenho e o critério de aceite.
>
> **NOTA DATADA — 29/09/2026**: duas linhas desta secção caíram por medição. (a) O **registador
> automático** da bateria existe: a Bateria de Teste do Venue escreve
> `specs/004-conector-hyperliquid/relatorios/registos-do-venue/<versão>-teste.txt` sozinha. (b) O **envio ao vivo** existe e foi
> usado: o conector assinou e submeteu na testnet (ordens `61429208395`, `61429223297`, `61429239313`).
> O que continua por fazer é a **idempotência** (D-009) e o **mapa de posse** (RN-T16.1).

- **Uma regra que não corre: D-007** (declarado hoje, ao fechar o D-006). A recusa `liquidacao_em_curso`
  (FR-013) está escrita na tabela e **funciona quando o contexto a declara** — mas **ninguém a declara**:
  medido por grep, **0 atribuições** desse campo em todo o repositório. Numa corrida a sério, `encerrando +
  start` cai sempre na linha `sempre` e volta a `em_operacao`. A decisão (trazer o estado da liquidação ao
  contexto, ou assumir que `start` durante `encerrando` é sempre «não feche») é do desenho.
- **As bandas do mandato — meio fechado hoje (D-008).** As **duas que existiam e não mordiam**
  (`bandas.stop_pct` e `bandas.tp_pct`) passaram a **morder**: o valor do setup é conferido no ciclo
  (`core/ciclo/ciclo.ts` 3.6 + `cabeNaBanda`, aritmética exacta) e **não abre** fora da banda nem com um valor
  que não se leia — com **8 casos** novos, incluindo dois que provam que a aritmética exacta é carga (um
  valor de 19 algarismos que a vírgula flutuante arredonda e diria «cabe»). Resta **aberto**: as duas chaves
  que as regras exigem e **não existem em ficheiro nenhum** (`tolera_posicao_manual`,
  `bandas.tempo_maximo_em_posicao`) — as duas dependem do **mapa de posse** (RN-T16.1), que não existe.
- **A medição do envio contra o venue.** O envio **existe** desde hoje — o conector assina e submete (T072), com
  a régua conferida e a porta `identidade` a travar quem não é agente desta conta (T073) — e está provado em
  bancada: **38 casos · 0 divergentes** (eram 36 antes da emenda 1.7.0). O que **não** existe é uma ordem a sério: nenhuma foi enviada, e a
  conta continua sem posição (ver §6). Enviar é **decisão sua**, um de cada vez.
- **A superfície web** — só o `README.md` com as regras.
- **O registador automático da bateria** — o `conformidade.sh` que o `plan.md` §D3 e o `quickstart.md` nomeiam
  não existe; o registo `brokers/hyperliquid/conformidade/1.4.0.txt` foi escrito **à mão**.
- **A bateria de TESTE do venue** (as 8 provas do SC-004) — a que existe é offline e declara-se incompleta.

## 4. O que mudou nesta vaga — os três itens (medido, e o terceiro gravado agora)

1. **A conferência da banda** (defeito **D-001**) passou a existir: `core/ciclo/banda.ts` confere a resolução
   contra a banda do mandato, em três comparações, e liga-a nos dois sítios onde a resolução e a acção vivem.
   O que **não se consegue conferir** não vira «cabe»: é `nao_conferivel` e **trava a abertura**. **FECHADO.**
2. **O envio passou a existir** (`brokers/hyperliquid/ordens.ts` deriva o preço de envio do desvio declarado,
   com a régua (a marca) conferida **antes** de o preço ser quantizado — a ordem do defeito estava trocada, e
   era isso que deixava uma marca estragada ir ao envio; `processo.ts` assina e submete; `identidade.ts` é a
   8ª porta do arranque, que trava quem não é agente desta conta). **FECHADO.**
3. **As três obrigações do conector** (defeito **D-002**) passaram de prosa a **contrato 1.7.0**: o manifesto
   declara `ligacao_por_protocolo`, `releitura_de_preco_ao_enviar` e `devolve_a_resolucao`, cada uma **medida**
   pela sonda no arranque, e a mesa **não arranca** sem elas — ausente recusa o contrato, presente e `false`
   recusa a porta `manifesto` da mesa **nomeando qual**. **FECHADO** (`relatorios/emenda-1.7.0.txt`).
4. **A tabela deixou de tratar «não sei» como «não há»** (defeito **D-006**): as guardas da posição viva e das
   portas do arranque passaram a distinguir os **três** casos, cada desconhecido tem guarda e linha próprias, e
   a mesa **recusa** (`posicao_desconhecida`, `porta_do_arranque_falhou` nomeando `(nao conferidas)`) em vez de
   parar sem perguntar ou arrancar sem conferir. **FECHADO** — e um chamador que **dependia** do defeito foi
   apanhado pela bancada (o dia do `registo.ts`).‌
5. **A retenção do ledger ganhou leitor** (`core/estado/retencao.ts`, RN-L6 — era uma das chaves sem leitor): lê
   a declaração, recusa a que está ilegível e diz de que lado da fronteira cai cada linha, com a borda
   **inclusiva** do lado do integral. **Sem declaração nada passa** — o que se perde por não haver regra é a
   distinção, nunca o arquivo de túmulos.
6. **A conta passou a estar na linha do registo** (o que sobrava do **D-004**): a mesa carimba
   `conta.identificador` em cada linha que escreve, e a reconstrução passa a fechar **por conta** — com o par
   de controle medido (duas contas no mesmo registo: cada uma reconstrói o seu dia; juntas, a cadeia **parte-se**;
   e trocadas as contas, as mesmas operações mudam de conta).
7. **A contradição da `idade_maxima_do_dado_ms` ficou reconciliada nos documentos** (`specs/002/data-model.md`,
   o inventário §1 e `contracts/origem-das-grandezas.json` diziam que `sem_ligacao` vinha de um limiar de idade
   do dono; o código diz, desde a emenda de 28 set, que vem do **protocolo**). O que **não** se fechou — as
   bandas `stop_pct`/`tp_pct` sem conferência e as duas chaves que não existem — está declarado como **D-008**.
8. A banda da moeda passou a ser a medida (contrato 1.6.0, `^[A-Za-z0-9]{1,11}$`) — e o número `1400 trazem
   dígito`, que estava no esquema, na porta e no `versao.json`, foi **corrigido para 72** (contava também nomes
   de *pares* de spot, que não são moedas).
9. O *stash* que estava parado foi **aplicado** e não há nada em stash: o trabalho vinha com **3 casos
   divergentes**, e um deles era sério (o do ponto 2).
10. **As bandas `stop_pct`/`tp_pct` passaram a morder** (a correcção do que o ponto 7 declarou): o valor que o
    setup pede é conferido **no ciclo**, contra a banda do mandato, com aritmética **exacta** — e não abre
    fora da banda nem com um valor que não se leia. **8 casos** novos, incluindo o **par de controle** das duas
    bordas e **dois casos que provam a aritmética** (`1.0000000000000000001` contra o máximo `1`: a vírgula
    flutuante arredonda-o e diria «cabe»). Fechar/reduzir continua a passar — o outro lado, também em caso.

Os dois primeiros itens estão no commit `af70d46`; o terceiro no `905fc03`; o quarto no `e08e6d3`; o quinto e o
sexto nas duas vagas de hoje. `provar.sh` dá **29 de 29** com a árvore **gravada** — no repositório, a única porta que fica
vermelha antes de gravar é a **prova negativa da frescura**, e por uma razão mecânica e dita: ela exige
`contracts/gerado` **limpo em git** antes de correr.

As três tarefas abertas do recorte 004 pedem todas **enviar** ao venue: **T042** (SC-003, a contagem de
idempotência lá), **T048** (SC-007, os cinco números com posição viva), **T057** (SC-004, as 8 provas no
ambiente de TESTE). A passagem a produção (`conexao.ambiente: producao`) é decisão sua.

## 5. Contradições achadas nos documentos duráveis (medidas, e corrigidas aqui)

| Documento | O que ele dizia | O que se mede agora | O que foi feito |
|---|---|---|---|
| `README.md` §«O que existe hoje» | descreve só os recortes 001–002 | 003 fechado e 004 medido | nota datada no próprio README |
| `specs/004/relatorios/RESULTADO.md` | «contrato: **1.4.0**» e «o **FR-018 não está implementado**» | contrato **1.5.0**; o leitor do histórico **existe** e o contrato **aceita** a carga real (**26 casos ok**) | correcção datada no topo, com o original por baixo |
| `specs/004/tasks.md` §«O que fica aberto» | «o CONTRATO recusa a carga» / «não se remenda por aqui» / «histórico: 24 casos» | a emenda **foi feita** (`3b730ec`) e a carga é **aceite**; **26** casos | correcção datada na própria secção |
| `specs/002/data-model.md` §`sem_ligacao` | «`idade_do_dado_ms` ≥ `conta.idade_maxima_do_dado_ms`» | o código (`core/ciclo/condicoes.ts`) diz desde 28 set que a ligação vem do **protocolo** — e a chave **saiu** | nota datada sob a tabela, com a linha original mantida |
| `docs/inventario-de-chaves.md` §1 · `contracts/origem-das-grandezas.json` | a chave `conta.idade_maxima_do_dado_ms` como `[falta]` / «o limite é do dono» | idem: a chave não existe, e nada tem de a ler | linha riscada + **nota datada**; a regra da grandeza reescrita |
| `docs/inventario-de-chaves.md` §2 (bandas) | `bandas.stop_pct`/`tp_pct` com leitor «mesa e validação» | **nenhum leitor** — medido: nada conferia a banda do stop/tp do setup | **nota datada** + **D-008** declarado, e **corrigido no mesmo dia**: as duas passaram a ter leitor nomeado (`core/ciclo/ciclo.ts` 3.6) com 8 casos e 6 provas negativas |

## 6. O venue, medido agora (só leitura, sem chave)

`clearinghouseState` da conta `0xF87138D298E338962E1a2e0ff23267Dc32c15621`, **29/09 19:42**, pelo endpoint
público `info`:

```
{"accountValue":"998.46","totalNtlPos":"0.0","totalMarginUsed":"0.0","assetPositions":[],"time":1790721777963}
```

`openOrders` → `[]` · `frontendOpenOrders` → `[]`. **Nenhuma ordem foi enviada; não há posição aberta.** O
histórico de execuções que existe na conta (56 execuções, `userFills`, 17.988 bytes) é **anterior** a esta
entrega — a data da última é a da sonda de 30/09, e nenhuma tem `cloid` (415 de 415 nulos).

> **NOTA DATADA — 29/09/2026, mais tarde: o parágrafo acima deixou de ser verdade, e por acção nossa.** A
> Bateria de Teste do Venue (`tools/testar-venue/bateria.ts`) correu contra a testnet **e enviou**, com o dono
> a autorizar o teste. Medido em `clearinghouseState`/`historicalOrders`/`userFills` depois da corrida:
>
> - **equity `998.409456`** (eram 998.46: a diferença são as **taxas** — 0.006009 + 0.00864 + 0.01728);
> - **posição: nenhuma** (a bateria abre e fecha na mesma corrida; a limpeza fecha o que sobra de corridas
>   anteriores, e o fecho é sempre com `reduce_only`);
> - **425 ordens na conta, 10 com `cloid`** — e as 10 são as nossas; as outras 415 são do motor antigo. Ou
>   seja: **as ordens desta mesa passam a trazer marca**, e é por aí que o mapa de posse (RN-T16.1) pode ligar
>   uma ordem a uma ficha;
> - **63 execuções**, 7 com `cloid` (as nossas), com taxa e resultado realizado por execução
>   (`closedPnl 0.00322` no fecho).
>
> O número antigo (415 de 415) fica por cima porque o registo é auditável — e porque é ele que mostra que a
> conta só passou a ter marcas quando **esta** mesa passou a enviar.

## 7. As armadilhas que não se vêem na tela

- **O repositório não tem remoto** (`git remote -v` → vazio): não existe cópia fora deste disco. O histórico,
  os quatro recortes e as 257 tarefas fechadas vivem num só sítio.
- **O trabalho do envio está num stash**, não num ramo: um `git stash drop` distraído apaga-o (e os 2 ficheiros
  novos só existem lá dentro).
- **A chave da conta passa por ficheiro** (`config/contas/` aponta para
  `~/.config/mesacore/credenciais/hl-teste-plugin.key`): quem assinar tem de sair **do carregador por
  referência**, e o valor nunca entra em log nem no repositório (RN-E14) — o stash foi escrito com essa regra
  escrita no cabeçalho do `identidade.ts`, mas isso é **alegação até a bateria de varredura correr sobre ele**.

- **Duas sessões na mesma árvore: quem a limpa é quem trabalha nela (protocolo escrito em 30/09/2026, e armado).**
  Medido: às 19:25:39 de 30/09 uma **sessão-irmã deste profile** («Auditar estado atual do MesaCore», sessão
  `20260929_193900_d185d7`, `cwd` este repositório) guardou em `stash` um lote de 30 ficheiros do produto que
  estavam por committar, porque o leu como restos de corridas mortas — a outra sessão estava a trabalhar neles
  desde 19:16:57. O `git reflog` guarda o rasto (`HEAD@{2026-09-30 19:25:39 -0300}: reset: moving to HEAD`), e nada
  se perdeu porque um `stash` guarda em vez de apagar. Regra, agora com guarda na porta
  (`~/.hermes/agent-hooks/guardiao-arvore-alheia.py`, `pre_tool_call`, nos 5 homes), **em duas camadas desde 30/09/2026
  20:1x (-03)** — `matcher` passou a `terminal|write_file|patch`: o `terminal` **recusa/aprova** como antes, e o
  `write_file`/`patch` **não é travado — é REGISTADO** em `~/.hermes/logs/guardiao-arvore.jsonl` (`raiz_git`,
  `arvore_alheia`, `trabalho_vivo`). Recusar a escrita directa foi medido e recusado (o worker de kanban nasce com
  workspace `scratch`, **fora do repo**: travaria todas as escritas de worker para o repositório). E o aviso de
  leitura obsoleta do editor **não impede a escrita** — avisa e aplica. A regra que fica:
  **árvore suja e precisas dela limpa → parar e reportar** (`git status --short` no corpo do cartão; `kanban_block`
  quando a decisão não for tua); **nunca** `stash`/`checkout`/`switch`/`restore`/`clean`/`reset --hard` numa árvore
  que não é a da tua sessão ou que outra sessão tem aberta. Para medir contra um estado limpo usa-se uma **cópia
  dentro do próprio workspace**; excepção a uma guarda vai **por cartão ao `default`**, com comando e saída, nunca
  por contorno.
- **Duas colisões provadas entre sessões deste profile (30/09/2026), e o remédio estrutural.** O árbitro do cartão
  `t_00cf9896` mediu **574 pares colidentes** (mesmo ficheiro, **sessões diferentes**, ≤1800 s) em `~/Projects` —
  2157 chamadas `patch`/`write_file` em 300 ficheiros, 12 ficheiros e 16 sessões, **todos no home `appbuilder`**; e
  ao vivo um worker de cartão e uma sessão desktop escreveram o **mesmo** `docs/AUDITORIA-PONTA-A-PONTA.md` entre
  20:01:57 e 20:05:15. Remédio (já disponível, sem guarda nenhuma): **cartão criado com `project=mesacore`** dá ao
  worker `<repo>/.worktrees/<task-id>` (git worktree) e acaba com o trunk partilhado — `MesaCore` é projecto
  registado (`p_8fac7eec`) no store do `appbuilder`. Quem cria cartões cujo worker escreve neste repo usa o
  `project=mesacore`.

## 8. A ação que depende de você (uma só)

**Autorizar (ou não) o primeiro envio a sério — um só, com você a conferir no broker.** O que existe hoje é
um conector que **sabe mandar** e está provado contra o dublê; o que falta é a ordem real, e essa é sua.

O que eu proporia, pela ordem que combinou a 29/09 (do menos capital ao mais, **um envio de cada vez**):

1. **um** envio a mercado de nocional mínimo no instrumento de **maior liquidez** entre BTC/SOL/ETH (medido, não
   suposto) — e eu paro aí, com a saída crua na mão: o pedido (sem a chave), a resposta inteira do venue, o
   `order_id`, o `cloid`, o preenchimento e a leitura da conta depois;
2. depois disso, **a sua conferência no broker** — e só então se decide o resto (idempotência com a mesma
   referência, as recusas do venue que não custam capital, o limite `post-only` e o cancelamento, os cinco
   números com a posição aberta, e o fecho com `reduceOnly`, que **só** com sinal explícito seu).

Ficam **de fora**, como decidiu: as ordens dimensionadas por percentagem de saldo e as que mexem em alavancagem.

E há uma coisa que continua pendente e não é do conector: **nada deste trabalho está gravado em git** — 2
ficheiros novos e ~55 modificados, com o `provar.sh` a fechar 28 de 28 só numa cópia onde a árvore está gravada.
> (E o portão passou a **29 de 29** quando o caminho do envio entrou nele — a linha acima é o retrato de 19:52.)
Diga-me se gravo, e o repositório fica com a vaga inteira num commit.

> **Nota de 29/09/2026, 21:5x — GRAVADO.** O parágrafo acima é o retrato de 19:52 e fica por ser auditável. A
> vaga está em git: `af70d46` (o envio + a banda), `905fc03` (emenda 1.7.0), `e08e6d3` (D-006) e o commit desta
> vaga (o D-004, a retenção e a reconciliação da `idade_maxima_do_dado_ms`). No repositório, com a árvore
> limpa, o `provar.sh` fecha **28 de 28** — a porta vermelha era só a prova negativa da frescura, que exige
> `contracts/gerado` limpo.

Não faço o envio sem a sua palavra: mexe em ordens na sua conta.

---

## EM CURSO — 30/09/2026, 02:55: o sistema em OBSERVAÇÃO na conta de teste

Corre (persistente, sobrevive ao fim da sessão):

* `tools/operar-em-observacao.sh hl-teste-plugin` — o OPERADOR (le as fichas ligadas, puxa as velas no relogio
  de cada uma, arranca o conector ao vivo, corre o SETUP `sigma` e escreve a operacao);
* a MESA (`core/servidor.ts --tick 60000`), a decidir cada volta, com `start` dado e as portas conferidas;
* o CONECTOR (`--ao-vivo --leitura-a-cada 60000`), que agora PRODUZ a leitura de mercado em ciclo (era o D-020).

Ficheiros: `<dir>/operador.log`, `<dir>/mesa.log`, `<dir>/operacao.json`, `<dir>/registo.jsonl`,
`<dir>/operacao-em-observacao.pid` — com `<dir>=~/.hermes/profiles/appbuilder/cache/scratch/observacao`.

**O QUE ISTO NAO FAZ, e e' a primeira coisa a ler:** nenhuma ordem sai para o venue. A decisao e' tomada e
registada, e a boleta nao e' enviada — o caminho mesa -> conector (a mao que aperta o gatilho) ainda nao esta
fechado, e um gatilho a meio nao se improvisa (P16: uma ordem de ~400x o equity encheu na testnet).

Parar: `kill $(cat <dir>/operacao-em-observacao.pid)` e, se sobrar, matar os filhos por nome.


## 30/09/2026 — o lado do PLUGIN esta' fechado e provado; falta a mao

### Fechado hoje, com o numero que o prova

| O que | Como se prova |
|---|---|
| A conta le **SOL** (e so' SOL), 4 voltas seguidas | `operador.log`: 4 leituras, todas `SOL`; o `["BTC"]` por omissao **morreu** |
| O plugin propoe **uma vez por barra** | 1 proposta em 4 voltas, com o preco a mexer-se |
| A mesa **trava a segunda entrada na mesma barra** (D-021) | registo: `CICLO SOL: abrir x1` + `nada (entrada_ja_feita_nesta_barra) x2` |
| Sem o relogio da ficha a mesa **recusa** | `a operacao nao declara o relogio de SOL (veio undefined)` |
| Sem fallbacks no que decide | `fallbacks (nenhum novo) OK` — linha de base **173**, so' desce |
| A catraca morde o proprio autor | reprovou um fallback meu (`?? ""`, 174 contra 173) minutos depois de nascer |
| Portao | **30 de 30** · tipos 0 erros em 6 directorios · fronteira 0 falhas |

### O que falta para o dinheiro andar: A MAO (mesa -> conector)

O **plugin** nao precisa de mais nada para operar: calcula o sinal, propoe uma vez por barra, respeita o
relogio da ficha e recusa quando lhe falta ambiente. Quem nao esta' fechado e' a **mao** — e ela e' da mesa,
nao do plugin. Desenho fixado (para nao se improvisar, P16):

1. a mesa **emite a boleta** numa linha do registo (`tipo: "boleta"`, forma `PedidoDeBoleta`,
   `core/ciclo/decisao.ts:44`) — hoje compoe-a e **deita-a fora** (medido: a linha do ciclo nao tem boleta);
2. um **carteiro** (no operador, que ja' tem o `stdin` do conector) le a linha, entrega a boleta ao conector,
   que assina e submete (essa parte esta' provada: a bateria do venue correu 21 passos);
3. o conector devolve a `resolucao`; o carteiro escreve a linha `desfecho` (forma `DesfechoDaOrdem`) e a
   **marca** que seguiu na boleta;
4. as marcas passam a viajar na operacao (`marcas_nossas_conhecidas`), e com isso uma posicao que apareca na
   conta e' reconhecida como NOSSA (D-008/RN-T16.1) — sem isto, a mesa trata-a como alheia e nao a gere;
5. so' entao a viragem de mao (RN-B5: fechar e abrir, em dois passos) fica possivel.

Ordem de risco: testnet primeiro, tamanho minimo, e o registo a dizer o que saiu antes de sair. Na conta real
de pequeno valor so' depois de a mao estar fechada em testnet e o desfecho classificado.


## 30/09/2026 (noite) — os pontos que faltavam, fechados por ordem

Ordem do dono: "vamos fechar os pontos que faltam. quando for tudo resolvido me avise, aí vamos rodar, mas só
depois da minha permissão." Estado a cada momento, com o numero que o prova:

| # | Ponto | Estado | A prova |
|---|---|---|---|
| 1 | A mesa relê a operação em cada volta (era um retrato congelado: 44 ciclos sobre a MESMA barra) | ✅ | `core/servidor.ts` — leitura dentro do relógio; portão 30/30 |
| 2 | A proposta diz de que barra é, e a mesa só age nessa barra (contrato **1.8.0**) | ✅ | `proposta.barra_ms` obrigatória; casos `proposta/sem-a-barra-do-sinal` (REPROVA) e `proposta-de-barra-antiga-nao-abre-outra-vez`; o operador guarda a última proposta por instrumento |
| 3a | As ordens vivas da conta (contrato **1.9.0**) | ✅ | `mercado.ordens_abertas` obrigatória; `mercado/ordem-viva-com-lado-inventado` REPROVA; o produtor lê `openOrders` do venue e RECUSA a leitura se não conseguir perguntar |
| 3b | O mapa de marcas marca→ficha (RN-T16.1, **D-008**) | ⬜ | desenho: a marca viaja no `cloid`; o mapa constrói-se do que NÓS enviamos (a boleta + a resolução) e do que o venue publica (as ordens vivas trazem agora `marca_de_posse`) — sem ele, uma posição nossa lê-se como ALHEIA e não é gerida |
| 4 | A MÃO: mesa → conector (a boleta sai) | ⬜ | desenho em quatro passos mais abaixo; é o passo que move dinheiro, e só se toca na testnet, com tamanho mínimo |

**O que NÃO se fez, de propósito:** nenhuma ordem saiu, nenhuma mão foi fechada e nada foi armado. O sistema
está a observar (lê, decide, regista) e o gatilho continua no lugar. A corrida a sério espera pela permissão
do dono — e antes dela, os pontos 3b e 4.

**Lições que a noite pagou, e que ficam escritas:**
* uma bancada que acusa a mesa pode estar a acusar-se a si: a do vigia calculava `instante - 1h` (que cai
  DENTRO da barra anterior, e não na abertura dela) e recusava com razão o que ela própria escrevia errado;
* o CONTRATO apanha antes da mesa: uma proposta sem barra nunca chega ao ciclo (é recusada na ponte), e por
  isso o motivo `proposta_sem_a_barra` saiu do livro — um motivo sem produtor é ruído num conjunto fechado;
* a frescura e as provas em Python podem dar vermelho intermitente quando o gerado está sujo ou quando o
  `uv run` apanha o venv do ambiente: o verde confirma-se correndo de novo, e o que se commita é o gerado.


## 30/09/2026 (madrugada) — 3b e a mão: fechados

| # | Ponto | Estado | A prova |
|---|---|---|---|
| 3b | O mapa de marcas marca→ficha (RN-T16.1, D-008) | ✅ | `marcas-<conta>.jsonl` (append-only, ao lado da operação) escrito quando o venue aceita uma ordem; a operação publica `marcas_nossas_conhecidas` por instrumento; a LEITURA atribui a posse cruzando as execuções da conta (`userFills`) com o mapa, e a marca entra DENTRO de `posicao`; sem cloid conhecido a posição vai sem dono e a mesa trata-a como alheia |
| 4 | A mão: mesa → conector (a boleta sai) | ✅ | o CARTEIRO, no operador (que já tem o `stdin` do conector): lê a boleta da linha do ciclo do registo, leva-a ao conector, e o conector assina e submete (provado antes pela bateria). O desfecho que volta vai para `desfechos-<conta>.jsonl` e alimenta o mapa |
| 4b | **Multipar e início a quente** | ✅ | `tools/observar-multipar.sh` (6 configurações, conta de teste, `enviar: false`): é multipar; ligar um par a quente faz o conector lê-lo, o operador pedir-lhe o setup e a mesa GOVERNA-LO — com a mudança no registo (`mandato`); desligar um par a quente tira-o da operação e do mandato, sem a mesa morrer |

**O INTERRUPTOR — é a única coisa que falta, e é tua:** o cabeçalho de cada ficha tem agora
`enviar: true|false`, campo **obrigatório** (as duas fichas de hoje — SOL e BTC, da conta de teste — dizem
`false`). Com `false`, a boleta fica no registo e o operador **regista por que não saiu** — nada sai por omissão
e nada se esconde. Para rodar a sério: pôr `enviar: true` na ficha do par, e aí a mão fecha-se.

Provado até aqui, sem disparar nada: portão **33 de 33**, tipos 0 erros, fallbacks **0** (a catraca apanhou
dois meus hoje, ambos corrigidos), a leitura AO VIVO na testnet a passar o contrato com as ordens vivas e as
execuções incluídas, o início a quente medido nas duas direções (ligar e desligar um par a meio da corrida), e o
registo da observação a mostrar o travão da barra (`abrir x1` + `nada (entrada_ja_feita_nesta_barra)`).
**Nenhuma ordem foi enviada e nenhum processo ficou a correr.**


## 02/10/2026 — um ramo publicado por um agente: o que se aplicou, e o que fica registado

Um agente publicou no GitHub o ramo `fix/recusa-em-vez-de-presumir` (13 commits, `rcerucci` como autor) com
trabalho bom colado a ficheiros TRUNCADOS: `core/estados/motivos.json` passou de **55 motivos para 4** (o
próprio ficheiro confessa o corte — `"_livro": "58 motivos no disco; ... o corpo completo segue no mesmo commit
se a chamada o aceitar"`), e `core/ciclo/ciclo.ts` foi gravado uma vez com **0 linhas**, «reposto» a seguir com
238 de 424. O ramo **não se aceita** (com o livro em 4, `motivoConhecido` lança «motivo de recusa fora do
conjunto fechado» no arranque), mas tinha lá dentro duas correções reais. Foram extraídas e reaplicadas à mão.

**Aplicado, com caso de bancada e prova negativa:**

| O que | Onde | A prova |
|---|---|---|
| O registo do vigia distingue **ausente** de **ilegível**: ausente é registo novo; ilegível RECUSA, e a gravação seguinte não passa por cima do ficheiro | `vigia/registro.ts` | bancada nova `tools/verificar-maquina/registo-do-vigia.ts` (**7 verificações**) **dentro da porta única**; contra o código de antes: **5 divergentes**, e o registo era reescrito por cima (medido: `lerRegisto` devolvia `transicoes: []` de um ficheiro com uma transição dentro) |
| O setup RECUSA a linha ilegível no stdin em vez de a descartar em silêncio | `setups/sigma/plugin.ts` | `sigma-casos.py` casos I e J (passou de 8 para **10 casos**); contra o plugin de antes, o caso J **propõe `lado=sell`** com lixo no stdin — decidia-se sobre uma leitura corrompida |

O registo do vigia era ainda o **único** ficheiro do vigia que lia o ilegível como ausente — os desfechos e o
mapa de marcas já recusavam (`vigia/arranque.ts`). A incoerência é o que a correção fecha.

**Registado, e NÃO aplicado — cada um com o que falta, medido:**

- **`tolera_posicao_manual` (RN-T16).** O agente escreveu a chave nas fichas e o leitor no ciclo, mas **faltou a
  perna que liga a ficha ao mandato**: `vigia/operador.ts` monta a vista `fichasParaAMesa` com uma lista
  **explícita** de campos (`saldo_pct`, `alavancagem`, `bandas`, `versao_do_mandato`, `setup`) e a chave não está
  nela. Com a guarda do ciclo a exigir booleano e o mandato sem o campo, a mesa **rebentava em todos os ciclos**.
  Decidir antes de fechar: a ausência da chave **recusa** (o estilo da casa) ou tem sentido declarado; e onde se
  exige — a **porta do mandato** (`core/ciclo/arranque.ts`), que é o sítio arquitectural, e não o ciclo a cada
  volta (é o que obriga a mexer em todos os construtores de mandato das bancadas).
- **`bandas.tempo_maximo_em_posicao` (RN-S11).** O leitor que o agente escreveu **não confere** o «sem instante
  de abertura» que o motivo dele próprio nomeia — dispara sempre que a chave está preenchida — e **o instante de
  abertura não existe em parte nenhuma do repositório** (0 ocorrências). Assim, um prazo preenchido bloquearia a
  gestão da posição e mentiria no motivo. Falta decidir **de onde vem o instante** (da posição do venue?).
- **O reenvio da boleta sem desfecho.** O agente exportou `intencoesSemDesfecho` e **ninguém a chama**, e o
  ficheiro `intencoes-<conta>.jsonl` que ela lê **ninguém o escreve**. O master reenvia sem desfecho de propósito,
  com o `cloid` derivado da referência (idempotente, RN-H9); trocar isso exige a pergunta ao venue pelo `cloid`,
  que o comentário do próprio agente admite faltar. Sem essa perna, a guarda é código morto — e se fosse ligada,
  mataria em silêncio uma ordem que ainda pode chegar.

Portão, com esta vaga gravada: **34 de 34** (era 33 — entrou a bancada do registo do vigia).

### O que mais havia no ramo, e porque se pode descartar

Varridos os **8 ficheiros** do ramo (nenhum ficheiro novo, nenhum apagado — todos modificações), o resto está
classificado. O que tem valor é **texto**, e guarda-se aqui para não se perder com o ramo:

| O que | Veredicto |
|---|---|
| Motivo `posicao_manual_tolerada_nao_gerida` (RN-T16): «Tolerar não é adoptar. A posição relata-se e não se gere.» | **guardado aqui** para o dia em que a RN-T16 fechar. **Não entra no livro agora**: um motivo sem produtor é ruído num conjunto fechado (a própria casa já o decidiu — `proposta_sem_a_barra` saiu por isso) |
| Motivo `tempo_maximo_sem_instante_de_abertura` (RN-S11): «Vazio é sem limite. Um prazo preenchido não se ignora, e não se fecha por um relógio que a leitura não trouxe.» | idem |
| Motivo `ciclo_rebentou`: «Uma excepção que se apanha e se segue decide a bem do silêncio. A volta fica registada e, a seguir, a mesa para.» | **discordância de desenho, e não trabalho**: `core/servidor.ts` apanha a excepção do ciclo e **continua de propósito** («parar o relogio deixaria a posicao sem defesa por causa de um erro de codigo»). O agente propôs a política oposta e **não escreveu a alteração**. É decisão sua, com os dois argumentos à frente |
| `bandas?: Record<string, {minimo?,maximo?} \| string>` (`core/ciclo/decisao.ts`) | alargamento de tipo **sem caso que o justifique** — medido: **0 ocorrências** de `bandas` como string em todo o repositório. Descartável |
| `join(RAIZ, "contracts/vocabulario.json")` (`decisao.ts`) | cosmético — o mesmo caminho noutra forma. Descartável |
| Remoção dos comentários «porquê» em `ciclo.ts`, `plugin.ts`, `arranque.ts` e `registro.ts` | perda, não ganho — o registo de decisões é o que o repositório tem de mais caro. Descartável |

Com isto, **o ramo não tem mais nada**: nada lá dentro falta ao produto depois de o registo acima existir.

## 02/10/2026 (tarde) — «controle total pelas fichas»: o par ligado a quente passa a poder ORDENAR

O dono pediu: *«controle total do sistema somente controlando qualquer ficha de setup, sem necessidade de
alterar à mão qualquer outro arquivo»*. Medi: faltavam dois elos — e o teste do ETH (ficha nova, relógio `1m`,
em testnet) mostrou-os a acontecer ao vivo.

**O que o hot-plug já fazia, e o que faltava:**

| Elo | Antes de hoje | Agora |
|---|---|---|
| Leitura do par | fichas relidas a cada volta | ✅ (era o único elo fechado) |
| Setup, proposta, mandato, mesa decidir | ficha | ✅ |
| Velas (relógio da ficha) | puxadas por ficha | ✅ |
| **Unidades do manifesto** (o que a tradução confere antes de enviar) | pedidas no **arranque** → a ordem do ETH foi **recusada** com `instrumento_desconhecido_no_manifesto` (nada saiu: a recusa é nomeada e não envia) | ✅ `manifestoParaInstrumento`: reconstruído da sonda guardada (o universo já lá está) — função **pura**, sem rede e sem reiniciar o conector |
| **Lista de pares da conta** | `conta.instrumentos` **obrigatória** na config | ✅ derivada das fichas (`run: true`), e a config **acrescenta**; sem config e sem fichas → **recusa** (o default `["BTC"]` escrito à mão é que foi o defeito antigo, não a derivação) |

**Bancada nova, dentro da porta:** `tools/verificar-conector/manifesto-acompanha-as-fichas.ts` — 8 verificações,
com o **CONTROLO** que prova o defeito (a mesma boleta do ETH contra o manifesto do arranque é **recusada**). O
caso nunca esteve em bancada nenhuma porque só aparece com a mão **aberta** — as provas do hot-plug corriam com
`enviar: false`, e o defeito vive exactamente no passo que só existe a enviar.

**Os relógios do operador são DOIS, e o primeiro teste provou-o à nossa custa:**

- **volta: 1 s** (era 60 s) — a proposta chega à mesa quase de imediato; com 60 s, **2 propostas do ETH a 1 m
  perderam-se** por `proposta_de_barra_antiga`;
- **leitura do venue: 10 s, valor PRÓPRIO** (`--leitura-a-cada`): o conector faz **quatro** leituras por par por
  volta (livro, estado, ordens, execuções) e, com a leitura no ritmo da volta, o venue respondeu **253 ×
  `429 Too Many Requests` em menos de dois minutos** (medido). Com a leitura a falhar, o par entra em
  `sem_leitura` — onde a mesa **não abre e não fecha** —, e a seguir o venue **ainda nos limitou no arranque
  seguinte** (a porta `sonda_e_manifesto` recusou por um campo que a sonda não conseguiu medir; 3 min de
  silêncio resolveram). Com a leitura a **10 s**: 0 respostas 429, os três pares lidos, e as duas posições vivas
  reconhecidas como nossas. **A volta curta não pode encurtar o ritmo com que se bate à porta do venue** — são
  dois números, com donos diferentes;
- **validade da leitura: 10 s, com número PRÓPRIO** (era `= tickMs`): amarrada ao ritmo, um `tick` de 1 s fazia
  uma leitura valer 1 s, e um atraso do venue punha o par em `sem_leitura` (RN-D7). Baixar o ritmo não pode ser
  baixar a defesa;
- **`LEITURAS_INUTEIS`** passa a ler-se do prazo (e nunca menos de 3), em vez do `3` solto que valia 3 minutos
  com a volta em 60 s e passaria a valer 3 segundos;
- **carteiro: 5 s** (já era).

**Custo do setup, medido:** uma chamada custa **0,08 s** a frio (3 execuções); com 3 pares, ~0,24 s de cada 1 s.
**Fica por fazer, de propósito:** correr o setup **só quando a barra do relógio muda** (a mesma resposta 60×) —
mexe no caminho que decide ordens, e faz-se com o teste a correr para medir o efeito.

Portão: **35 de 35** (era 34 — entrou a bancada do manifesto).

## 02/10/2026 (noite) — a virada existia em DOIS PASSOS, e os dois passos não cabem no tempo da mesa

**O defeito, medido ao vivo (não em bancada):** o ETH abriu comprado às 16:02 (aceite), o indicador virou, e às
16:08 a mesa **fechou** (aceite) — e **não abriu** o lado novo. Ficou plano, e de 16:09 em diante o registo só
diz `proposta_de_barra_antiga`. O dono reparou: «não obedeceu o flip».

**A causa é de relógios.** A virada estava desenhada em **dois actos** — `caixa` (fecha) e depois o lado inverso —
e o próprio código o declarava («o vocabulário não tem verbo para ela», D-013). Só que:

- a **mesa decide UMA vez por barra** (o relógio dela é o da barra: 60 s = 1 m);
- o primeiro acto gastou essa decisão (16:08:35 → fechou);
- o segundo caiu na barra seguinte, onde o **setup já não autoriza entrada** («não abro no meio da perna»).

Resultado: **uma perna perdida em cada duas viragens**, com o par fora do mercado contra o indicador. Não era do
ETH: era de todos os pares com relógio igual ao da mesa.

**O que a emenda 1.10.0 fez** (contrato `1.10.0`, e a nota inteira em `contracts/versao.json`):

| peça | o que passou a ser |
|---|---|
| **a acção da mesa** | cinco (`abrir · fechar · reverse · adoptar · nada`), declaradas no `contracts/vocabulario.json` (`acoes_da_mesa`) — era a última lista que vivia só no código |
| **a regra** | proposta do lado OPOSTO a uma posição nossa → **`reverse`** (era `fechar` em `reduce_only`) |
| **a boleta** | ganha **`reverter`** (obrigatório, D4) — e `reverter: true` com `reduce_only: true` **RECUSA** |
| **quem executa** | o **conector**: soma a posição viva à quantidade nova e manda **uma só ordem** (netting), recusando a nomear quando não há o que virar |
| **o segundo venue** | o ctrader **recusa a nomear** (`capacidade_nao_declarada`): não faz a inversão numa ordem, e meia virada é pior que nenhuma |
| **o setup** | **não mudou** — continua a propor o lado; quem sabe se isso é uma virada é a mesa |

**As provas, todas por execução:** `ordens: 44 casos · 44 ok` (4 novos: a virada soma a posição — `0.00833 + 0.00833 = 0.01666`, nocional `1004.598` —, e as três recusas); os **3 casos do D-013** da bateria do ciclo mudaram de veredicto de propósito e provam `reverse` + `reverter: true` numa só decisão; a bancada do ciclo fecha em **104 verificações · 0 divergentes**. E o **porteiro fez o seu trabalho duas vezes**: recusou-me um motivo inventado no código (`reversao_sem_posicao_a_reverter` teve de ser declarado no vocabulário) e um motivo sem tradução para o vigia.

**Fica por fazer, declarado:** a **redução parcial** continua sem verbo próprio (nenhum setup do repositório a emite — o σ emite `caixa` ou um lado).

**E a PROVA AO VIVO, com a emenda a correr** (mesa reiniciada às 16:51 UTC, conta de teste, as mesmas fichas):

| instante | o que aconteceu |
|---|---|
| 16:54:32 | a mesa decidiu **`reverse`** no ETH — boleta `lado: sell`, `reduce_only: false`, **`reverter: true`** (ciclo 3) |
| 16:54:37 | desfecho **aceite**, marca **3**, **quantidade `0.008`** = a posição viva (`0.004`) **somada** à nova (`0.004`) |
| depois | a posição do ETH é **`sell` 0.004**, com a marca 3 no mapa das nossas |

O conector declarou `"veredicto":"aceite","preenchido":"0.008","origem_dos_numeros":"posicao_lida_depois_do_envio"`.
**A virada que hoje fechou e não abriu passou a fechar e abrir numa só ordem** — e o registo diz `reverse`, em vez de
esconder a inversão atrás de um `fechar`. O ETH, que ficou plano durante 46 minutos com o defeito, virou na
primeira barra em que o setup propôs depois do reinício.

## 02/10/2026 (noite) — as duas pendências do core fecharam: o travão de risco por ordem e a redução parcial

**Contrato 1.10.0 → 1.11.0** (a emenda inteira está em `contracts/versao.json`). As duas tarefas que o retrato
anterior deixou declaradas, fechadas com números:

| # | O que | Estado | A prova |
|---|---|---|---|
| 1 | **O travão de risco por ordem** (RN-M4.12, **D-015**): a exposição da ordem (`saldo_pct` × `alavancagem`, em % do saldo) contra o tecto que a **CONTA** declara (`conta.risco_maximo_por_ordem_pct`) | ✅ | `core/ciclo/ciclo.ts` antes do ponto 5, para `abrir` **e** `reverse`, com o comparador exacto das bandas (`cabeNaBanda`) sobre o produto `produtoDeDecimais`; motivo novo `risco_por_ordem_excedido` no **livro** (`cruzam_a_fronteira: false` — sem emenda ao vocabulário); **6 casos** novos com os dois controles; bancada do travão com **8 verificações** (a vírgula flutuante diria «cabe» nos dois casos dos 19 algarismos) |
| 2 | **A redução parcial** (D-013, via (b)): a boleta ganha `posicao_pct` — o tamanho relativo à **POSIÇÃO VIVA**, obrigatório (D4) | ✅ | contrato **1.11.0** (12 schemas → 15 TS + 15 Python); a porta do `hyperliquid` calcula `posicao_pct × posicao_viva` (a posição vem do venue), ajusta ao passo **por baixo** e recusa com dois nomes novos; o `ctrader` confere a mesma declaração e recusa a fração; **6 casos** no `hyperliquid` (com o par de controle em `posicao_pct: 1`) e **2** no `ctrader` |

**Medido nesta vaga:** `bun run core/ciclo/provar.ts` → **118 verificações · 0 divergentes** (**47 de ciclo**,
eram 41) · `bun brokers/hyperliquid/casos/correr-ordens.ts` → **50 casos · 50 ok · 0 divergentes** · o `ctrader`
(`uv run python casos/correr.py`) → **63 casos · 63 ok · 0 divergentes** · o contrato → **136 casos** nos dois
motores · `porta-do-contrato.ts` → **0 falhas** (**22 motivos** fechados nas duas direções) · `tipos.sh` → **0
erros em 6 directórios** · `fallbacks` → **0 sítios em 0 ficheiros** · `bash tools/preparar-contas/provas.sh` →
**13 provas · 0 falhas** (a 13ª é nova).

**As ordens do conector entraram no PORTÃO** (`provar.sh`: **35 → 36**) — **e a porta do contrato também**
(**36 → 37**). A tradução de ordens decide a quantidade
que vai para o mercado e é o único sítio onde uma redução parcial se vira em número — e só corria à mão. Um
caminho que mexe em dinheiro fora do portão é um caminho que pode regredir sem ninguém dar por isso (a lição de
29/09, paga com o envio). A porta do contrato é o outro lado da mesma lição: ela É a rede do vocabulário fechado,
e estava fora.

**Duas decisões que não são minhas, e ficam ditas:**

- **A distância mínima de liquidação NÃO entra nesta vaga.** O desenho dizia «usa o campo
  `distancia_minima_liquidacao_pct` … opcional na mesma medida», mas a boleta não leva preço nem quantidade —
  **contra que grandeza a distância se compara não estava fixado**. Perguntado, o dono decidiu que **nesta vaga
  só o tecto da conta entra no ciclo**; o campo fica declarado e o seu único leitor continua a ser a conferência
  da resolução (`core/ciclo/banda.ts`), onde há preço de liquidação e marca. Inventar a comparação seria pior do
  que não a ter.
- **O tecto passou a CHEGAR à mesa.** Medido: a vista que o operador escreve (`vigia/operador.ts`,
  `escreverConfig`) levava `eventos_que_avisam`, `arranque_apos_cb` e `fichas` — e **não** o tecto. Sem uma linha
  lá, a chave era declarada na conta e **nunca chegava a quem a lê**. Passa a entrar quando a conta o declara;
  ausente, a chave não entra, e a mesa **di-lo no registo** («risco por ordem sem tecto declarado na conta»).

**O que fica declarado (e não fechado):**

- **A `porta-do-contrato.ts` estava FORA do portão — e entrou (36 → 37).** Foi ela que apanhou a deriva que
  ninguém via: o espelho do vocabulário (`_defs/forma.schema.json#/$defs/motivo`) **faltava-lhe os dois motivos da
  emenda 1.10.0** (`reversao_com_reduce_only`, `reversao_sem_posicao_a_reverter`). Fechado aqui (com os quatro da
  1.11.0) **e conferido no dia a partir de agora**: um conferidor que só corre à mão encontra o defeito uma vaga
  depois de ele entrar.
- **A CLASSE do defeito que passou por baixo da catraca, decidida por medição.** O ambiente da conta vinha de um
  ternário com valor por omissão (`... ? "producao" : "teste"`), que a catraca dos fallbacks (que procura
  `??`/`||`) não vê. Corrigido no sítio (a conta que não declara o ambiente **não arranca**, e o registo diz de
  onde ele veio), e a classe medida: **114** ternários com literal por omissão no produto, **23** deles a
  mencionar sequer a ausência — e a amostra desses 23 é o idioma legítimo da casa, logo um padrão que os
  reprovasse matava o portão à fome de falsos positivos. Fica **declarado e contado** (`--ternarios`): o buraco é
  um número que desce, não uma frase. A recusa ficou **provada com duas contas de prova** (sem o campo → «veio
  undefined»; com `"producao "` → «veio "producao "»), apagadas depois — a árvore voltou ao que estava.
- **A contradição do `config/contas/hl-teste-plugin.json` continua a NÃO ser minha** (o `.gitignore` diz que
  `config/contas/` não se versiona; o ficheiro está rastreado): a árvore fica com esse **um** ficheiro sujo, como
  estava. Não a resolvi.
  > **RESOLVIDA no mesmo dia, na 2ª parte da noite, por decisão do dono (a via (b): versionar).** A linha
  > `config/contas/` saiu do `.gitignore`, com nota datada; a config da conta passou a conteúdo versionado e a
  > árvore fica **limpa**. O «não a resolvi» acima era a leitura certa **naquele momento** (a decisão é do dono),
  > e fica como registo de que ela foi pedida em vez de tomada.
- **O sistema em observação não foi tocado** (mesa, operador, conector e feed continuam como estavam): nenhuma
  ordem saiu, e o gatilho segue no lugar.
- **Os documentos duráveis ficaram com as notas datadas** onde diziam o contrário do que passou a valer: a
  RN-M4.12 (`docs/regra-de-negocio.md`) e a linha do `conta.risco_maximo_por_ordem_pct`
  (`docs/inventario-de-chaves.md` §8), que declarava a chave «sai da mesa».

## 02/10/2026 (noite, 2ª parte) — o feed de mercado tem bancada, e ela está no portão (37 → 38)

**O que faltava, e o que o fecho mudou.** O `brokers/hyperliquid/feed.ts` é o processo que serve o mercado a
**todos** os setups, e a única prova que existia dele era **execução ao vivo** — o próprio §0 deste documento o
dizia por escrito. Agora há bancada, e ela corre no `provar.sh`:

```
bash tools/verificar-maquina/provar.sh          → 38 de 38 (era 37)
bun run brokers/hyperliquid/casos/correr-feed.ts → feed: 11 provas · 11 ok · 0 divergentes
bash brokers/hyperliquid/casos/prova-negativa-do-feed.sh → PROVA NEGATIVA: 6 de 6 nomes de caso conferidos
```

**O NÚCLEO PURO saiu do `feed.ts` para o `feed-barras.ts`, e por uma razão medida:** o `feed.ts` **liga-se ao venue
ao carregar** (cria o `SubscriptionClient` e chama o `main()` no fim do módulo) — quem o importasse para o medir
abria uma ligação a sério. Um ajudante partilhado vive em módulo **sem efeitos ao carregar** (a mesma regra que
põe a fusão das fichas em `fundir.ts` e não em `arranque.ts`). O que ficou no `feed.ts` é o que precisa do venue:
as subscrições, o relógio do processo e o canal de diagnóstico.

**As cinco regras que a bancada mede, cada uma com o seu controle** (e o que fica por provar, dito):

| # | A regra | O controle |
|---|---|---|
| 1 | A barra em curso **agregada do `bbo`** leva `agregada_do_bbo: true` e o `v`/`n` ficam a **ZERO** (o livro não os diz: não se inventam) | uma barra **do venue** não é zerada por nós (a marca é do que é NOSSO); e num relógio que não se alinha por divisão do dia (`1d`) **não se agrega nada** (fail-closed) |
| 2 | A barra **do venue com o mesmo `t`** SUBSTITUI a agregada — e a marca `agregada_do_bbo` **desaparece** com ela | `t` maior **acrescenta**; `t` menor é **ignorado** (andar para trás no histórico seria inventar) |
| 3 | O **stream não tem memória**: o buraco é **NOMEADO** (`buraco_no_historico`, com quantas faltam) e a lista cresce **um só** (a barra que chegou) | duas barras seguidas **não avisam** de buraco nenhum — sem este par, o aviso podia sair sempre |
| 4 | O ficheiro escreve-se **ATÓMICO** (ficheiro novo + `rename`) e o **histórico fica intacto** — o **inode MUDA** entre duas escritas (reescrever no sítio mantinha-o) e as linhas antigas ficam byte a byte iguais | uma **linha partida** no ficheiro não se adivinha: perde-se ela, e as boas ficam |
| 5 | A **primeira barra de um par NOVO** não se deita fora (lista vazia = a barra do venue é o dado) | depois dela, a ordem continua a mandar: um `t` menor é ignorado (a lista vazia não virou «acrescenta tudo») |

**A regra 5 não estava escrita por ninguém: foi a bancada que a mediu.** Ao montar o controle da regra 1, a
bancada apanhou o `encaixarVela` a **sair sem guardar nada** com o histórico vazio — a primeira barra de um par
novo **perdia-se em silêncio**, e o ficheiro ficava vazio até à barra seguinte (até **um período inteiro**, num
relógio de 1h/4h, e sem uma linha a dizê-lo). Corrigido na raiz, com o caso que o prova. É o mesmo padrão de
sempre: um dado do venue que se deita fora sem nome é pior do que uma recusa.

**A PROVA NEGATIVA, e porque ela existe fora do portão.** Uma bancada que nunca reprovou não mediu nada, e a única
maneira de saber se esta mede o produto é **estragar o produto de propósito** e ver o vermelho **com o nome do caso
dentro**. `brokers/hyperliquid/casos/prova-negativa-do-feed.sh` injecta seis defeitos (um a um), exige o nome do
caso no vermelho, repõe da cópia e confere o **`sha256`** — nunca «já não se queixa». Medido: **6 de 6** nomeados,
incluindo o da atomicidade, que o **inode** apanhou. Corre-se à mão (é lento: injecta, corre, repõe, seis vezes) e
não é passo do portão — o portão mede a bancada.

**O que a bancada NÃO prova, e por isso fica dito no cabeçalho dela:** a **ligação ao venue** (o
`SubscriptionClient`, o `candle` e o `bbo` a sério). Isso continua a ser prova de execução ao vivo. A casa prefere
a prova declarada mais fraca a uma prova que finge ser do portão.

**O `feed.ts` continua a arrancar** com o núcleo extraído (medido, numa corrida de rascunho que não toca na
observação): `{"etapa":"feed","arranque":"ligado",...,"ambiente":"teste","fonte_do_ambiente":"ausente: o ambiente
de TESTE, por decisao de quem nao o declarou","precos":false}`.

**A RAZÃO que faltava no D-015**, agora escrita no `DEFEITOS.md` (a distância mínima de liquidação ficou fora do
ciclo, e a vaga seguinte não deve reabrir a pergunta): o **preço de liquidação é um FACTO DO VENUE** — o
`liquidationPx` que ele devolve na posição — e a mesa **não o lê**; quem o lê é o **conector**, na leitura da
posição, e é por ali que ele chega à resolução (onde a conferência 3 o compara com o piso). Aproximá-lo por
`100/alavancagem` seria uma **aproximação não declarada a decidir risco real** (um piso de risco comparado com uma
aproximação ou recusa o que a corretora não liquidaria, ou **deixa passar** o que ela liquida). E a casa já tem
esse cálculo num sítio só e **declarado** — `precoDeLiquidacaoProjectado`, para a resolução que sai antes do
envio, onde o **venue manda** quando publica o número.

**Os números vigentes (varridos, não deixados a envelhecer):** o `README.md` dizia «35 de 35» (verdade quando foi
escrito) → **38 de 38**, com a data; o cabeçalho deste documento passa a **38** e à hora desta medição. As secções
**datadas** deste retrato (o §2 mede «29/09, 19:39–21:2x») ficam com os números que tinham — são a auditoria
daquele momento, e um número datado que se reescreve deixa de servir para auditar nada.

## 03/10/2026 (madrugada) — o feed MUTAVA a barra do venue, e três `.d.ts` obsoletos passavam por frescos

Duas correcções de raiz, uma decisão que **não é minha** (e vai medida), e a reparação do ficheiro que o σ lê.
Esta secção é o registo do que foi medido — e o que fica por fazer depende de uma palavra do dono (religar o feed).

### 1. A agregação do `bbo` mutava a barra do venue (o defeito mais grave — corrompia o ficheiro que o setup lê)

**O que se mediu, no ficheiro da corrida de risco** (`mercado/velas-*.jsonl`) às 01:3x desta madrugada:

| ficheiro | linhas | barras com a marca `agregada_do_bbo` | **mutadas** (marca + o `v`/`n` do VENUE) |
|---|---|---|---|
| `velas-ETH-1m.jsonl` | 5.767 | 356 | **331** |
| `velas-BTC-1h.jsonl` | 553 | 7 | **7** |
| `velas-SOL-1h.jsonl` | 553 | 6 | **6** |

Uma barra com `agregada_do_bbo: true` **e** o `v`/`n` do venue é a assinatura do defeito: o venue manda a barra do
período (com volume e trades), ela substitui a nossa agregada — e o `bbo` **seguinte** volta a mexer nela. O ramo
`ultima.t === inicio` do `agregarDoBbo` não distinguia **de quem** era a barra: punha-lhe o mid no `o`/`h`/`l`/`c`
e carimbava-lhe a marca da agregação **por cima da barra de quem tinha mandado o período**. Reproduzido por
execução antes de mexer (sonda que importa o módulo real):

```
1. depois do bbo (agregada):                      {...,"v":"0","n":0,"agregada_do_bbo":true}
2. depois do venue (substituiu):                  {...,"v":"3","n":2}            <- o venue manda
3. depois do bbo POSTERIOR a substituicao:        {...,"h":"105","c":"105","v":"3","n":2,"agregada_do_bbo":true}   <- DEFEITO
```

**A segunda consequência, também medida (o «achado 2»): 23 barras** do ETH-1m em que o venue **já tinha
publicado** o período e a nossa agregada (`v`/`n` a zero, preços do mid) tinha ficado no lugar dela — porque a
barra do venue chegou **depois** de o primeiro `bbo` da volta nova ter aberto o período seguinte, e o ramo
`else { return; }` deitava-a fora **em silêncio**.

**A regra (decidida, não reaberta): o venue manda no período dele, e a agregação só toca em barra NOSSA.**

| # | O que passou a valer | Onde |
|---|---|---|
| (a) | a agregação só actua em barra com a marca `agregada_do_bbo` — nunca na do venue, que a faz **calar-se** nesse período | `feed-barras.ts`, `agregarDoBbo` |
| (b) | a barra do venue substitui a agregada do mesmo período (já era assim no ramo do `t` igual) | `encaixarVela` |
| (c) | a lista fica **ORDENADA** por `t`: a barra atrasada que casa com uma que já lá está toma o **lugar** dela; a que preenche um buraco **insere-se** ordenada; e a que é **anterior à última FECHADA** é **NOMEADA** (`barra_atrasada_descartada`), nunca ignorada | `encaixarVela` |

**A bancada cresceu de 11 para 15 provas**, e as quatro novas são as que faltavam: a sequência inteira
(agregar → o venue substitui → **chega outro `bbo`**), a barra atrasada a tomar o lugar da nossa agregada, a que
insere num buraco, e o **controlo negativo** (a anterior à última fechada é nomeada e **não** entra).

```
bun run brokers/hyperliquid/casos/correr-feed.ts   -> feed: 15 provas · 15 ok · 0 divergentes
bash brokers/hyperliquid/casos/prova-negativa-do-feed.sh -> PROVA NEGATIVA: 10 de 10 nomes de caso conferidos
```

**A prova negativa é 10 de 10** (eram 6): os quatro defeitos novos foram injectados um a um — a guarda da marca
sai, a barra atrasada deixa de tomar o lugar dela, o `splice` da inserção sai, e o nome da barra descartada sai —
e **cada um** põe a bancada vermelha **com o nome do caso dentro**, com o ficheiro reposto e conferido por
`sha256`. E a bancada NOVA contra o código de ANTES fica vermelha **exactamente nos quatro casos novos**
(11 ok · 4 divergentes) — é a medida de que ela mede o defeito, e não a si própria.

### 2. O feed em execução continua a corromper (e o conserto do código só vale ao religar)

**Medido:** o `feed.ts` da corrida de risco corre desde as 16:12 de 02/10 (`bun run feed.ts --corrida …`) e **tem
o código antigo em memória** — o defeito continua a acontecer **enquanto isto se escreve** (três barras novas
ficaram mutadas entre a leitura do ficheiro e a reconstrução, minutos depois). Nada foi tocado no operador, na
mesa, no conector nem no feed: **religar o feed é decisão do dono**, e a ordem é: parar o feed → gravar a
correcção → reparar o ficheiro → religar (ao arrancar, o `estadoDoPar` relê o ficheiro, e a partir daí as barras
saem certas).

**A reparação do ficheiro, medida (antes/depois).** `mercado.ts --actualizar` **não repara**: ele só
**acrescenta** o que vem depois da última barra (`novas: 0` medido com o descritor no lugar — as barras já
gravadas ninguém as toca), e sem descritor reescreve o ficheiro inteiro com a série do venue — o que **perde** as
barras mais antigas que a janela dele já não cobre (o `candleSnapshot` devolveu 5.163 velas de 1m; o ficheiro tem
5.767). O que repara é a **substituição por `t`**: puxar a série do venue e, para cada barra do ficheiro com
período no venue, ficar com a **do venue**; o resto (a barra em curso) fica como está.

| ficheiro | antes (marca / mutadas) | depois (marca / mutadas) | linhas substituídas |
|---|---|---|---|
| `velas-ETH-1m.jsonl` | 356 / **331** | 1 / **0** | 446 |
| `velas-BTC-1h.jsonl` | 7 / **7** | 0 / **0** | 27 |
| `velas-SOL-1h.jsonl` | 6 / **6** | 0 / **0** | 21 |

Exemplo (ETH-1m, 1790946720000): antes `c: "2753.2", v: "0.0242", n: 2` (mutada por nós) → depois
`c: "2752.9", v: "0.0423", n: 5` (a do venue). A reconstrução correu **numa cópia** (o feed vivo reescreve o
ficheiro a cada segundo); o ficheiro reparado está em
`~/.hermes/profiles/appbuilder/cache/scratch/velas-ETH-1m.reconstruido.jsonl` e o procedimento é este.

### 3. A frescura do contrato deixava passar três `.d.ts` obsoletos (e um deles mentia)

**O mecanismo, confirmado antes de mexer — e a auditoria dava-o ao contrário:** o `gerar.sh` **produz** os
`.d.ts` (`bun x json-schema-to-typescript`); o que havia era **restos** de quando os schemas se chamavam
`decisao-do-encerramento.schema.json` (com hífen). O gerador escreve `decisao_do_encerramento.d.ts` e **nunca
toca** nos antigos — e a frescura comparava **duas cópias do mesmo directório**: o obsoleto estava nos **dois**
lados, idêntico, logo invisível. Medido: a frescura dava `0 divergencias (30 ficheiros)` com os três lá dentro,
rastreados em git desde 28/09, e o `resposta-de-comando.d.ts` a carregar **contrato velho** («15 dos 42 motivos»
contra os vigentes «22 dos 50»; `grep` mostrou **0** importadores).

**O conserto é na raiz: o gerador passou a ser DONO do que produz** — gera numa pasta própria, verifica a
completude e só então **substitui** `gerado/ts` e `gerado/py`. Um ficheiro que ele não produz deixa de existir, e
o `diff` passa a vê-lo. Se a geração falhar, os ficheiros velhos ficam onde estavam.

```
1a corrida: frescura: o gerado NAO corresponde aos schemas
            Somente em <guardado>/gerado/ts: decisao-do-encerramento.d.ts
            Somente em <guardado>/gerado/ts: pergunta-do-encerramento.d.ts
            Somente em <guardado>/gerado/ts: resposta-de-comando.d.ts      -> e a cura apaga-os
2a corrida: frescura: 0 divergencias — o gerado corresponde aos schemas (27 ficheiros)
```

**A prova negativa cobre agora as DUAS classes** (`frescura.sh --prova-negativa`): o gerado atrasado **à mão**
(T057, o que já existia) e um `.d.ts` **obsoleto que o gerador não produz** — este último tem de **reprovar** e a
cura tem de o **apagar**. O `diff` passou também a excluir `__pycache__` (deriva dos `.py`, não é gerado — sem
isso, um cache deixado por um import fazia a frescura mentir).

### 4. DECISÃO PENDENTE (do dono): `posicao_pct: "1"` num FECHO

**Não se tocou em código.** A boleta diz `posicao_pct: "1"` em **todo** fecho (`core/ciclo/ciclo.ts`, que declara
nunca emitir redução parcial) e o contrato diz, na mesma frase, **duas** coisas: «`1` **é a posição INTEIRA**» e
«`1` é o valor de uma ordem que **não** é uma redução parcial». Na tradução de hoje vale a **segunda** leitura: com
`posicao_pct: "1"` a quantidade sai do **`saldo_pct`** e a **posição viva não é lida**. Se valer a **primeira**, o
fecho passa a fechar **tudo o que está aberto** (a quantidade é a posição lida do venue).

**A medição (o tradutor REAL, importado; a posição e o equity lidos do ficheiro da operação — equity
991,99):**

| instrumento | posição viva | qtd que o fecho emite **hoje** (`saldo_pct`) | resíduo | a ½ (`posicao_pct: 0.5`, o caminho da fracção) |
|---|---|---|---|---|
| BTC (10% · passo 0,00001) | 0,00116 | 0,00116 | 0,000000 (**0,00%**) | 0,00058 |
| ETH (1,1% · passo 0,0001) | 0,004 | 0,004 | 0,000000 (**0,00%**) | **RECUSA** `minimo_do_instrumento_acima_da_banda` |
| SOL (10% · passo 0,01) | 0,82 | 0,82 | 0,000000 (**0,00%**) | 0,41 |

**Hoje as duas leituras coincidem nas três posições vivas** — e é preciso dizê-lo, porque é o que torna a decisão
menos urgente e mais traiçoeira: elas coincidem porque as posições foram abertas pela **mesma fórmula**, ao mesmo
equity e a um preço vizinho. **Divergem assim que o preço andar** (medido com o código real, à volta da posição
viva):

| instrumento | o fecho deixa de fechar tudo (sobra resíduo) | o fecho **passa** a posição → o venue **recusa** o reduce-only |
|---|---|---|
| BTC | a partir de **+0,65%** de preço (0,00115, sobra 0,00001) | a partir de **−0,22%** (0,00117 > 0,00116) |
| ETH | a partir de **+1,96%** (0,0039, sobra 0,0001) | a partir de **−0,54%** (0,0041 > 0,004) |
| SOL | a partir de **+1,06%** (0,81, sobra 0,01) | a partir de **−0,17%** (0,83 > 0,82) |

Ou seja: o custo de hoje é **1 passo** de quantidade (o resíduo) ou **a ordem recusada** (quando a fatia excede a
posição — com `reduce_only`, o venue não deixa reduzir mais do que existe, e o fecho **não acontece**). E é maior
nos relógios longos (1h/4h), onde o preço anda muito entre a abertura e o fecho. **A decisão é do dono** e está
declarada como **D-022** em `specs/002-maquina-de-estados/relatorios/DEFEITOS.md`, com esta medição. Nada muda de
comportamento enquanto ele não decidir.

### 5. Os números dos documentos que tinham envelhecido

O §2 deste retrato foi **re-medido** (era o de 29/09) e as quatro linhas que o portão cobre estavam erradas:
contrato **1.7.0 · 131 casos** → **1.11.0 · 136**; a fronteira **livro 50 · 24 ficam** → **livro 56 · 30 ficam**;
as provas offline **ordens+cloid 40** → **50**; o tamanho do código **17.895+ linhas** → **28.408** de TypeScript.
No `README.md`: «**136** regras» → **149** `RN-*` (10 famílias, contadas por `grep -oE 'RN-[A-Z][0-9]+(\.[0-9]+)*'
docs/regra-de-negocio.md | sort -u | wc -l`), «**9 schemas** · **81 casos**» → **12 · 136**, e a regra de negócio
«(136)» → «(149)». E o buraco declarado dos ternários passou a **115** (era **114** na medição de 02/10; um
ternário novo fá-lo subir — o número lê-se da corrida, `--ternarios`).


