# ONDE ESTAMOS — o retrato medido do MesaCore

medido em **29/09/2026, 22:10 (-03)** · `HEAD 08d13d3` · árvore **limpa** · contrato vigente **1.7.0**

Este é o documento que se abre primeiro. Cada número aqui foi medido nesta hora — o comando vem ao lado — e o
que não foi medido diz-se **não medido**, com a razão. Nenhum adjectivo substitui um número.

## 1. O que existe hoje — e o que você consegue abrir

| O que | Onde está | Você consegue abrir? |
|---|---|---|
| A regra de negócio (136), a máquina de estados, o inventário de chaves, o diagrama | `docs/` | Sim — leitura, no computador |
| O conector Hyperliquid: lê o venue, traduz, recusa, lê o histórico | `brokers/hyperliquid/` | **Não tem tela** — é peça de máquina, provada por comandos |
| A mesa e o vigia (o ciclo, a boleta, o ledger, a operação) | `core/`, `vigia/` | **Não tem tela** |
| A superfície web | `web/` | **Não existe**: o diretório tem só o `README.md` com as regras que ela deve cumprir |
| A conta de teste no venue | `config/contas/hl-teste-plugin.json` (fora do git) | Sim, no broker |

**Nada disto se abre no telefone.** Não há uma tela construída. O que existe é máquina e prova.

## 2. O que está feito e medido (bancadas corridas agora)

| Bancada | Comando | Número medido (29/09, 19:39–21:2x) |
|---|---|---|
| A porta única da máquina | `bash tools/verificar-maquina/provar.sh` | **29 de 29 passaram** (o envio do conector entrou hoje na porta — ver §4) |
| O **ciclo** e as bandas (D-001 e D-008) | `bun run core/ciclo/provar.ts` | **99 verificações · 0 divergentes** — 12 de condição · **36 de ciclo** (eram 27) · 10 de desfecho · 15 de banda · 6 de reconciliação |
| A **tabela de transições** (D-006, fechado hoje) | `bun run core/estados/provar.ts` + `bun run tools/verificar-maquina/tabela.ts` | **38 casos · 13 aceites · 25 recusados · 0 divergentes** (eram 35) + **36 linhas · 0 falhas nos 7 invariantes** |
| A **fronteira** vigia ↔ mesa (motivos) | `uv run python tools/verificar-contrato/py/fronteira.py --motivos` | **0 falhas** — livro **50** motivos · **26** cruzam · 24 ficam · **1** excepção da porta |
| A **retenção do ledger** (RN-L6, leitor novo) | `bun run core/estado/retencao.prova.ts` | **14 casos · 7 declarações aceites · 7 recusadas · 0 divergentes** |
| A **conta na linha do registo** (D-004, fechado hoje) | `bun run tools/verificar-maquina/registo.ts` | **12 verificações · 0 divergentes** — duas contas, reconstrução **por conta**, e a troca como controle |
| **A porta do MERCADO** (velas + livro, para as features e para o estudo) | `bun run brokers/hyperliquid/mercado.ts --velas BTC --intervalo 1h --dias 7` · `--livro BTC` · `--intervalos` | **169 velas** de BTC 1h (7 dias) lidas na TESTE e na producao · livro **20/20 niveis** (o manifesto declara 20) · **14 intervalos** medidos na fonte do SDK · CSV para estudo: **73 velas** |
| O conector, offline | `bash tools/verificar-conector/provas-offline.sh` | **0 falhas** — credencial 9 · manifesto **24** · ordens+cloid **40** · leitura 14 · histórico **26** |
| **O caminho do envio** (tradutor + processo) | `bun run brokers/hyperliquid/processo.ts --bancada` | **38 casos · 38 ok · 0 divergentes · 262 verificações · 8 portas** — **dentro da porta única desde hoje** (antes só corria à mão) |
| **A bateria de TESTE do venue** (SC-004, a que envia) | `bun tools/testar-venue/bateria.ts --ate 8 --registar` | **21 provas · 20 passaram · 1 reprovou** — e é **D-009** (a idempotência). O **D-010** (a alavancagem nunca era pedida ao venue) foi **fechado nesta vaga**: o conector pede-a (`updateLeverage`) e confirma-a pela leitura antes de a resolução sair — medido ao vivo, o venue passou de 40 para os 2 que a boleta pede. O **D-011** (a boleta pedia stop e o stop não saía) foi fechado na varredura do vocabulário — passou a **recusa nomeada**, e deixou de ser silêncio. A varredura cobre os **15 valores** que um setup pode usar (6 aceites, 9 recusas nomeadas) e está em `specs/004-conector-hyperliquid/relatorios/cobertura-do-vocabulario.md`; dela saíram ainda **D-012** (o `limite` inalcançável) e **D-013** (o lado oposto à nossa posição não é distinguido de «abrir»). Corre contra a TESTNET e move dinheiro: **não** entra no `provar.sh` |
| A conformidade do conector (offline) | `bun tools/verificar-conector/conformidade.ts` | **9 de 9 · 241 verificações · 0 divergentes** (a linha do venue diz `INCOMPLETO` — nunca `passou`) |
| O contrato nas duas linguagens | `bun tools/verificar-conector/porta-do-contrato.ts` | **0 falhas** — contrato **1.7.0** · **131 casos** nos dois motores · 23 sondas da emenda |
| As tarefas dos recortes | `grep -c '^- \[x\]' specs/*/tasks.md` | 001 **59/59** · 002 **67/67** · 003 **63/63** · 004 **74/74 medidas** — as três últimas (T042/T048/T057) foram medidas na testnet e **dois critérios não se cumprem**: SC-003 (D-009) e SC-004 (11 de 12) |
| O tamanho do que é nosso | `git ls-files` + `wc -l` | **17.895+** linhas de TypeScript · 2.980 de Python · 3.499 de shell |

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
