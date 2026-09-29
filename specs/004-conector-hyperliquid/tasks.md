# Tasks: O primeiro conector real — Hyperliquid, em ambiente de teste

**Input**: `specs/004-conector-hyperliquid/` — `spec.md` (7 histórias, 28 FR, 8 SC), `plan.md` (as cinco
decisões), `research.md` (R1–R9).

**Testes**: incluídos **não por opção** — o portão da constituição diz que o teste que recusa a regra existe
**antes** do código que a cumpre. Aqui, «teste» é a **bancada declarada**: casos em dado, um por regra, e a
contagem no fim. Duas bancadas: a que **não** precisa do venue (corre sempre) e a que corre no **ambiente de
teste** (a bateria de conformidade).

**Formato**: `[ID] [P?] [História] Descrição` — `[P]` = ficheiros diferentes, sem dependência.

**Estado da execução** (medido em 29/09, contrato em **1.4.0**): fechadas a **fase 1**, a **fase 2** (T010
incluído — a porta de processo existe e está medida) e a **fase 10** (a emenda que os dois achados de
`data-model.md` §7 exigiram — `relatorios/emenda-1.4.0.txt`), e com elas a tradução (US2), a derivação da
referência (US5), a leitura das **duas** carteiras (US6, T071) e a bateria de conformidade **offline** (US7).
O que **fica aberto** é o que precisa do venue **com chave**: as provas no ambiente de TESTE (SC-004), o
registo por versão e data, e os relatórios de US2/US3/US4/US7. Este recorte não cria tipo novo (R8): a
emenda 1.4.0 acrescentou campos e motivos ao que já existia, e o conector fala o que já existe. Linha de
base em `relatorios/linha-de-base.txt`.

---

## Fase 1 — Preparação e linha de base (T001–T005)

- [x] T001 Medir a linha de base e escrevê-la em `relatorios/linha-de-base.txt`: `provar.sh` (25 de 25), casos do contrato (100), versão do contrato (1.3.0), e os ficheiros do outro projeto tocados (**0** — o motor antigo é oráculo, não se toca) — **feito:** `relatorios/linha-de-base.txt` (contrato 1.3.0, 12 esquemas, 100 casos iguais nos dois runners (66 recusados · 34 aceites), 47 motivos, `provar` 25 de 25, oráculo 0 modificados)
- [x] T002 [P] Criar `brokers/hyperliquid/` com `README.md` (o que este conector entrega, e o que não) e `.gitignore` (o manifesto do runtime e a `conformidade/` fora do versionamento) — **feito:** `brokers/hyperliquid/{README.md,casos/}` e o `.gitignore` com o manifesto do runtime e a `conformidade/`
- [x] T003 [P] Escrever `data-model.md`: manifesto, boleta, resolução, desfecho, leitura — campo a campo, com a origem de cada número (venue, nossa conversão, ou ausente) — **feito:** `data-model.md`, com os dois achados do contrato (§7)
- [x] T004 [P] Escrever `quickstart.md`: como correr a bateria offline e a do venue, e onde ler o resultado — **feito:** `quickstart.md`
- [x] T005 Pedir ao sysadmin as duas dependências (D1) e registar o pedido; **enquanto não houver resposta**, as tarefas que não precisam do SDK seguem (as de tradução, recusas e derivação da referência correm contra o dublê) — **feito:** cartão `t_20cd5c48` (assignee `sysadmin`) **fechado**: `@nktkas/hyperliquid@0.33.3`, `viem@2.57.0` e `ajv@^8.20.0` declarados na raiz. A terceira dependência entrou **por medição**: os corredores importavam `ajv` sem ele estar declarado (vinha do auto-install global do `bun`) e a bancada passava por acidente — com o manifesto na raiz o fallback desligou e a bateria caiu a 25/26; agora há a porta `tools/verificar-conector/porta-das-dependencias.ts` a trancar a repetição. Commits `ae33a52`, `131fb1d`

## Fase 2 — Fundacional: o conector de pé e o manifesto (T006–T014) — **US1**

- [x] T006 [US1] `brokers/hyperliquid/casos/manifesto.casos.json`: casos da sonda (instrumento existente, instrumento inexistente, limite que muda, venue indisponível) — com `esperadoOk`/`motivo_esperado` — **feito:** 16 casos em dado (9 do manifesto + 7 de capacidade, um por cada booleana)
- [x] T007 [US1] `brokers/hyperliquid/manifesto.ts`: a sonda (instrumentos, `szDecimals` e passo, alavancagem máxima, tipos de ordem, mínimo, taxas da conta, funding) e a publicação do manifesto — **nenhum** destes valores constante no código (FR-001, FR-002) — **feito:** `brokers/hyperliquid/manifesto.ts` (funcao pura: recebe a sonda e devolve o manifesto, ou recusa nomeada) — nenhum valor do venue escrito no codigo
- [x] T008 [US1] Recusa nomeada para instrumento inexistente, dizendo **qual** (FR-003) — **feito:** instrumento inexistente recusa com `valor_fora_do_conjunto` e o nome do instrumento
- [x] T009 [US1] O manifesto declara o que o venue **não** oferece e a forma da referência do venue (FR-004, FR-005) — **feito:** o manifesto declara `stop_anexo`, `reduce_only_suportado`, `estado_do_mercado`, `marca_de_posse` — e ausencia de capacidade e RECUSA (`capacidade_nao_declarada`), nunca `true` por omissao
- [x] T010 [US1] `brokers/hyperliquid/processo.ts` — **o nome REAL é este**: este plano dizia `processos.ts` e o que existe é `processo.ts` (singular); o plano alinha-se ao código, que não se renomeia. A porta de processo (arrancado pelo vigia, uma ligação, uma chave) (FR-019 a FR-024) — **feito e medido:** o executável é o `processo.ts` (é ele que tem o `stdio`; a máquina vive no `conector.ts`), com 10 casos da porta em `casos/processo.casos.json`, a bancada `bun run brokers/hyperliquid/processo.ts --bancada`, e a linha do dublê de mesa na bateria de conformidade. Saídas cruas em `relatorios/processo.txt`
- [x] T011 [US1] `tools/verificar-conector/provas-offline.sh`: correr os casos do manifesto contra o dublê e contra o conector (o que não precisa de rede) — **feito:** `tools/verificar-conector/provas-offline.sh` — 0 falhas, com prova negativa e cura provada por sha256
- [x] T012 [US1] Bancada `tools/verificar-maquina/provar.sh` ganha a linha do conector; medir e escrever em `relatorios/us1.txt` — **feito:** a linha entrou na bateria geral — `provar` **26 de 26**; saidas cruas em `relatorios/us1.txt`
- [x] T013 [US1] O manifesto do runtime entra no `.gitignore` (a **forma** versiona-se, o conteúdo não — D2) — **feito:** `brokers/*/.manifesto.json` e `brokers/*/conformidade/` no `.gitignore`
- [x] T014 [US1] Commit da US1 e resumo ao dono — **feito:** commit e resumo ao dono

## Fase 3 — A tradução e as recusas (T015–T022) — **US2**

- [x] T015 [US2] Casos da tradução: fora do passo, abaixo do mínimo, preço com casas a mais, alavancagem fora do intervalo, post-only que cruza, reduce-only — **feito:** `brokers/hyperliquid/casos/ordens.casos.json` — **32 casos** (26 da tradução + 6 da referência), todos nomeados no caso: `abaixo-do-minimo-de-10-usd`, `quantidade-abaixo-do-passo`, `preco-com-casas-a-mais-do-que-o-tick`, `alavancagem-acima-do-maximo`, `nao-inteira`, `zero`, `limite-post-only-aceite-e-preco-exacto`, `reduce-only-pedido-e-honrado`… Medido: `ordens: 32 casos · 32 ok · 0 divergentes`
- [x] T016 [US2] `brokers/hyperliquid/ordens.ts` — **o nome REAL é este** (este plano dizia `traducao.ts`): percentagem do saldo/alavancagem/percentagens → quantidade e preço na unidade do instrumento (FR-006) — **feito:** a tradução vive no `ordens.ts`, e o corredor é `bun brokers/hyperliquid/casos/correr-ordens.ts`
- [x] T017 [US2] **Nenhum arredondamento silencioso**: cada caso fora de regra é recusa **com motivo**, e nenhuma ordem é enviada (FR-007) — a diferença declarada face ao motor antigo — **feito:** as recusas saem com motivo do vocabulário fechado do contrato (conferido contra `contracts/vocabulario.json`, não contra um literal), e o preço devolvido é, caracter a caracter, o que entrou; o envio só acontece depois da tradução OK (`— e nao se arredonda para caber (RN-C9)` no `conector.ts`)
- [x] T018 [US2] Alavancagem: só inteiro dentro do intervalo aceite; fora disso, recusa com o máximo nomeado (FR-008) — **feito:** casos `alavancagem-acima-do-maximo-recusa-e-nomeia-o-maximo`, `alavancagem-nao-inteira-recusa`, `alavancagem-zero-recusa`, e os aceites 1, 2, no máximo do instrumento e 17 («nao e degrau nenhum»)
- [x] T019 [US2] Post-only: nunca corrigir preço para caber; se cruzar, é recusa (FR-009) — **feito:** `limite-post-only-aceite-e-preco-exacto` (o preço sai exacto) e `preco-com-casas-a-mais-do-que-o-tick-recusa` / `preco-com-6-algarismos-significativos-recusa`
- [x] T020 [US2] Reduce-only: pedido, e a capacidade declarada no manifesto (FR-010) — **feito:** `reduce-only-pedido-e-honrado` e `reduce-only-nao-declarado-no-manifesto-recusa` (capacidade não declarada é RECUSA, nunca `true` por omissão)
- [x] T021 [US2] Casos + bancada medidos; `relatorios/us2.txt` — **fechado com prova:** `bun brokers/hyperliquid/casos/correr-ordens.ts` → `ordens: 32 casos · 32 ok · 0 divergentes · 26 traducoes declaradas`, e a bancada dentro da porta (`provas-offline.sh` → `0 falhas`). Saidas cruas em `relatorios/us2.txt`
- [x] T022 [US2] Commit da US2 e resumo ao dono — **feito:** commit `specs/004: T021/T022 (US2) - as ordens: a traducao contra o contrato, medida caso a caso` (hash em `relatorios/RESULTADO.md` §commit) e resumo ao dono nesta entrega

## Fase 4 — A resolução e o desfecho (T023–T030) — **US3**

- [x] T023 [US3] Casos da resolução e do desfecho (aceite, parcial, recusado com a palavra do venue, e a ordem que produz cada um) — **fechado com prova:** a bancada do processo mede-os um a um — `processo: 31 casos · 31 ok · 0 divergentes · 223 verificacoes` (os 10 `processo/*`: aceite, parcial, recusa com a palavra do venue, silencio, e as recusas). Saidas cruas em `relatorios/us3.txt`
- [x] T024 [US3] Resolução **antes** do envio, com quantidade, nocional, margem, alavancagem e preço de liquidação (FR-006, FR-012) — **fechado com prova:** a linha 1 da costura e `tipo: "resolucao"` com os cinco numeros (`0.00166` · `99.6` · `19.92` · `5` · `48000`) e a linha 2 o `desfecho`; o diagnostico mostra `traducao` ANTES de `envio`. Ver `relatorios/us3.txt`
- [x] T025 [US3] `brokers/hyperliquid/desfecho.ts`: normalização nas quatro classificações, com os números do venue (FR-012) — **fechado com prova, com o NOME resolvido:** `desfecho.ts` NAO existe e o codigo nao se renomeia — a normalizacao das quatro classificacoes vive em `brokers/hyperliquid/conector.ts` (`atender`/`saida`, que passa cada desfecho pelo conferidor do contrato); as quatro linhas cruas (aceite, parcial, recusado, desconhecido) estao em `relatorios/us3.txt`
- [x] T026 [US3] Recusa com o motivo **do venue**, nunca interpretado (FR-012) — **fechado com prova:** `classificacao: recusado` com `motivo: valor_abaixo_do_minimo_do_venue` e `palavra_do_venue: "Order value below $10 minimum"` inteira, nunca interpretada. A palavra do venue REAL e o SC-006 (T057). Ver `relatorios/us3.txt`
- [x] T027 [US3] Nada se deduz por contagem própria: o que não está no venue é `desconhecido` (FR-015) — **fechado com prova:** a ordem em repouso sai `desconhecido` (`estado: resting`, `origem_dos_numeros: calculo_antes_do_envio`), nunca `aceite` nem falha; o silencio idem (`sem_resposta_no_prazo`). Achado registado no caminho: a nota da mensagem ainda diz «o contrato 1.3.0» com o contrato em 1.4.0. Ver `relatorios/us3.txt`
- [x] T028 [US3] Conferência contra o contrato (o envelope e o esquema de cada mensagem) — portão automático — **fechado com prova:** prova 1 da conformidade — `13 mensagens do conector conferidas pelo motor do contrato (TS) e pelo duble de mesa (Python) · 0 falhas` —, mais `porta-do-contrato: 0 falhas — contrato 1.4.0 · 18 motivos fechados nas duas direcoes · 111 casos lidos nos dois motores`. Ver `relatorios/us3.txt`
- [x] T029 [US3] Medições em `relatorios/us3.txt` — **fechado com prova:** `relatorios/us3.txt` (saidas cruas, comando por comando)
- [x] T030 [US3] Commit da US3 e resumo ao dono — **feito:** commit `specs/004: T023-T030 (US3) - a resolucao antes do envio e o desfecho com os numeros do venue` (hash em `relatorios/RESULTADO.md` §commit)

## Fase 5 — Silêncio é estado (T031–T038) — **US4**

- [x] T031 [US4] Casos do silêncio: espera dentro do prazo, desconhecido depois, reconciliação que encontra posição, pedido novo recusado, fecho permitido — **fechado com prova:** 4 casos do conector (`processo/silencio-do-venue`, `arranque/ordem-em-repouso`, `arranque/venue-calado-no-arranque`, `arranque/conta-nao-lida-antes-do-envio`) + 8 do desfecho e 6 da reconciliacao no ciclo da mesa. Ver `relatorios/us4.txt`
- [x] T032 [US4] `espera` dentro do prazo declarado e `desconhecido` depois — nunca sucesso (FR-013) — **fechado com prova:** `desconhecido` com `estado: sem_resposta_no_prazo` e `prazo_ms: 200` (nunca `aceite`); no registo da mesa a volta que espera NAO e acontecimento (`1 -> 1 linhas`) e fora do prazo escreve (`1 -> 2`). Ver `relatorios/us4.txt`
- [x] T033 [US4] Reconciliar antes de agir: posição, ordens abertas e execuções desde o instante (FR-014) — **fechado com prova, e no sitio certo (a MESA):** `grep -rc "reconcilia" brokers/hyperliquid/*.ts` da **1** ocorrencia e e texto, nao leitor — o conector nao decide nem importa o `core` (RN-E1/FR-024); a reconciliacao e `core/ciclo/reconciliacao.ts`, medida em 6 casos `reconciliacao/*`. Ver `relatorios/us4.txt`
- [x] T034 [US4] Com `desconhecido` pendente, **abertura** recusada e **fecho** permitido (FR-014) — **fechado com prova (na MESA, onde a regra vive):** `core/ciclo/ciclo.ts` → `abrir_bloqueado_por_desconhecido`, com os dois lados medidos — `ciclo/com-desconhecido-nao-abre` e `ciclo/com-desconhecido-defender-continua` — e o criterio `SC-005: 0 de 1 tentativas de abrir com a marca desconhecido passaram`. Ver `relatorios/us4.txt`
- [x] T035 [US4] O estado da ligação pelo protocolo do venue; silêncio = `desconhecido` (FR-020) — **fechado com prova:** a porta `ligacao` passa com o venue a responder (`estado da ligacao pelo protocolo do venue: ligada`; o silencio seria `desconhecido`, nunca `ligada` nem `caido`) e, com o venue CALADO, o processo NAO sobe (`rc=2`, STDOUT vazio, porta `ligacao` falhada com `campo_obrigatorio_ausente`). Ver `relatorios/us4.txt`
- [x] T036 [US4] Sem leitura da conta, nenhuma ordem que aumente exposição (FR-021) — **fechado com prova:** `arranque/conta-nao-lida-antes-do-envio` → `recusado`/`campo_obrigatorio_ausente` e **nenhum passo `envio`** no diagnostico (a ordem nao sai); no ciclo, `ciclo/sem-leitura-nao-abre`. Ver `relatorios/us4.txt`
- [x] T037 [US4] Medições em `relatorios/us4.txt` — **fechado com prova:** `relatorios/us4.txt` (saidas cruas, comando por comando)
- [x] T038 [US4] Commit da US4 e resumo ao dono — **feito:** commit `specs/004: T031-T038 (US4) - o silencio, o estado e reconciliar antes de agir` (hash em `relatorios/RESULTADO.md` §commit)

## Fase 6 — A mesma referência não duplica ordem (T039–T043) — **US5**

- [x] T039 [US5] Casos da idempotência (mesma referência duas vezes; referência com forma inválida para o venue) — **feito:** `ordens.casos.json` §`checagens_de_cloid` (3) + §`checagens_de_recusa_do_cloid` (3): `mesma-referencia-da-sempre-o-mesmo-cloid`, `instrumento-diferente-da-cloid-diferente`, `referencia-com-espaco-recusa`, `instrumento-fora-da-forma-recusa`, `conta-nula-recusa`
- [x] T040 [US5] Derivação da referência para a forma do venue, **pura e declarada** (sem instante dentro) (FR-011) — **feito:** `brokers/hyperliquid/cloid.ts`, com a derivação declarada em texto e conferida pela bancada: `sha256("mesacore/cloid/v1" + conta + instrumento + referencia_do_cliente)`, primeiros 16 bytes, `0x` + 32 hexadecimais minúsculos; a mesma boleta dá a MESMA acção (não há relógio nem aleatoriedade dentro)
- [x] T041 [US5] Duas boletas com a mesma referência → **uma** ordem, mesmo desfecho nas duas respostas (FR-011) — **fechado com prova (no duble do venue):** a mesma referencia (`hl-0001`) nos dois casos da o MESMO cloid derivado `0xeab5b6f15977095eac958e351c6472e6` e o MESMO `order_id 8842` — uma ordem, dois desfechos iguais; no caso `arranque/referencia-repetida-a-mesma-ordem`. O SC-003 **no venue** e a T042 (bloqueada). Ver `relatorios/us5.txt`
- [ ] T042 [US5] Medição com contagem no venue (SC-003) em `relatorios/us5.txt` — **BLOQUEADA — decisao do dono (SC-003 exige enviar).** Comando que a correria: `bun run brokers/hyperliquid/processo.ts --casos brokers/hyperliquid/casos/processo.casos.json --ficha @config/contas/hl-teste-plugin.json --ao-vivo` com a MESMA boleta duas vezes, e a contagem no venue por `historicalOrders`/`openOrders`. NAO corrido, e o codigo di-lo por si: a porta de envio AO VIVO responde «o envio AO VIVO nao esta implementado nesta porta de processo: exige ASSINAR, e assinar sem a bateria de conformidade ter medido o venue seria encomendar as cegas» (`brokers/hyperliquid/processo.ts`). Enviar ordem a serio e decisao do dono (RN-H17). Razao completa em `relatorios/us5.txt`
- [x] T043 [US5] Commit da US5 e resumo ao dono — **feito:** commit `specs/004: T041/T043 (US5) - a mesma referencia nao cria segunda ordem (medido no duble); T042 bloqueada` (hash em `relatorios/RESULTADO.md` §commit)

## Fase 7 — As leituras e os cinco números (T044–T049) — **US6**

- [x] T044 [US6] Casos das leituras (posição viva, sem posição, leitura falhada) — **feito:** `brokers/hyperliquid/casos/leitura.casos.json`, **14 casos** (posição viva com e sem liquidação publicada, zero posições ≠ sem leitura, cada carteira a falhar sozinha, as duas a falhar, `equity` a `null`/número/expoente). Medido: `leitura: 14 casos · 14 ok · 0 divergentes`
- [x] T045 [US6] `brokers/hyperliquid/leitura.ts` — **o nome REAL é este** (este plano dizia `leituras.ts`): posição, equity, marcas e os **cinco números** do resumo do encerramento, com a origem nomeada (FR-016) — **feito:** `leitura.ts`, com a origem de cada grandeza declarada, e a leitura passou a caber nos TRÊS padrões de decimal do contrato (`contracts/_defs/forma.schema.json`) por campo, como o contrato os declara
- [x] T046 [US6] Sem posição, a distância de liquidação é **ausente** (nunca zero); leitura falhada é dita como falha (FR-017) — **feito:** `posicao-com-liquidacao-a-null-a-distancia-fica-AUSENTE`, `sem-withdrawable-a-carteira-do-perpetuo-fica-nao_lida`, `perpetuo-falha-recusa-as-posicoes-nao-se-leem`, `as-duas-carteiras-falham-recusa-nomeando-as-duas`
- [ ] T047 [US6] Histórico do venue (execuções, taxas, funding, resultado realizado) sem reconstrução (FR-018) — **NAO FECHADA — razao medida:** nao existe leitor de historico no conector — o `atender` so serve `boleta` (`tipo_nao_servido`) e os unicos usos de `userFills`/`historicalOrders`/`userFees` sao da SONDA (para medir tipos de ordem, reduce-only, marca de posse e parcial no manifesto). Sem comportamento, nao ha prova a citar. Ver `relatorios/us6.txt`
- [ ] T048 [US6] Medição dos cinco números contra o venue, no mesmo instante (SC-007) em `relatorios/us6.txt` — **BLOQUEADA — decisao do dono.** A leitura FOI medida contra o venue agora (comando em `relatorios/us6.txt`): `equity 0.0`, `saldos: []`, `posicoes: []`, 2 carteiras confirmadas, `instante_do_venue_ms 1790707537419`. Mas o SC-007 pede **5 de 5 «para a MESMA POSICAO»** e a conta nao tem posicao nenhuma: abrir uma exige ENVIAR ordem. Comando que a correria: o mesmo `bun -e` com `leitura.ts`/`lerNoVenue` (em `us6.txt`) depois de um envio autorizado. NAO corrido
- [x] T049 [US6] Commit da US6 e resumo ao dono — **feito:** commit `specs/004: T059 (US6) - as bordas de leitura e o historico que nao existe` (hash em `relatorios/RESULTADO.md` §commit)

## Fase 8 — A bateria de conformidade (T050–T058) — **US7**

- [x] T050 [US7] `tools/verificar-conector/conformidade.ts` — **o nome REAL é este** (este plano dizia `conformidade.sh`): a bateria offline, com **NOVE** provas (o plano dizia oito; a nona entrou na emenda), cada uma dizendo o que mediu — **feito:** `bun tools/verificar-conector/conformidade.ts` → **9 de 9 passaram · 238 verificações · 0 divergentes**, e o que ela **não** prova está dito em voz alta no cabeçalho (nada do venue — FR-026)
- [x] T051 [US7] Prova 1: manifesto sondado (o instrumento inventado recusa) e Prova 2: passo e mínimo (recusa, nunca arredonda) — **feito:** prova 1 = a forma de toda mensagem contra o envelope e o esquema do seu tipo; prova 9 = instrumento que não existe no manifesto, recusa NOMEADA dos dois lados
- [x] T052 [US7] Prova 3: degrau de alavancagem (recusa e nomeia o máximo) e Prova 4: post-only não cruza — **feito:** prova 3 = as duas versões (`versao` = do contrato, `conector.versao` = do plugin, com a prova negativa trocada); prova 4 = o vocabulário fechado, com as quatro provocações a terem de reprovar
- [x] T053 [US7] Prova 5: reduce-only não aumenta posição e Prova 6: idempotência (uma ordem) — **feito:** prova 5 = o manifesto é FUNÇÃO PURA da sonda (capacidade não declarada recusa, nunca `true`); prova 6 = a costura fecha e a mesa fica sem vigia
- [x] T054 [US7] Prova 7: desconhecido e reconciliação e Prova 8: histórico bate com o venue — **feito:** prova 7 = as SETE portas do arranque (a ordem, a primeira que falha, e o motivo dela); prova 8 = nenhum valor de credencial no repositório (RN-E14), com os dois controlos do varrimento
- [x] T055 [US7] Registo por **versão e data** em `brokers/hyperliquid/conformidade/<versao>.txt`; prova que não corre deixa o resultado **incompleto** (FR-025, FR-026) — **fechado com prova:** o registo existe — `brokers/hyperliquid/conformidade/1.4.0.txt` (o nome E a versao, lida de `contracts/versao.json`), com a data da corrida e a **saida crua** da bateria; a metade do FR-026 esta na propria bateria (`venue (as OITO provas de SC-004 ...): INCOMPLETO`). **Dito, e nao escondido:** o registo foi escrito a mao nesta vaga — a bateria nao se registra sozinha, e o `conformidade.sh` que o plano §D3 nomeia nao existe. Ver `relatorios/us7.txt`
- [x] T056 [US7] Onde a documentação oficial não for conclusiva, medir e **escrever no manifesto** (FR-027) — os três casos de R9 — **fechado com prova (o MECANISMO, FR-027):** `juntarBateria` + os casos `arranque/bateria-nao-mediu`, `arranque/bateria-mediu-cinco-de-seis` e `arranque/bateria-contradiz-a-sonda` (todos `sonda_e_manifesto:falhou`). Dos tres R9: o da **marca** esta MEDIDO (`marca_para_a_distancia: info.activeAssetData({user,coin}).markPx — [V]`), o das **casas a mais** no venue fica para a T057, e a **cadencia** fica dita como lacuna (nao ha chave). Ver `relatorios/us7.txt`
- [ ] T057 [US7] Correr a bateria no ambiente de teste e medir (SC-004); `relatorios/us7.txt` — **BLOQUEADA — decisao do dono (SC-004 exige ASSINAR e ENVIAR).** Comando que a correria: `bun run brokers/hyperliquid/processo.ts --casos brokers/hyperliquid/casos/processo.casos.json --ficha @config/contas/hl-teste-plugin.json --ao-vivo --bateria bateria_ao_vivo` — e, para o SC-004 como esta escrito, falta a **bateria de TESTE de 8 provas ligada ao envio**: o `conformidade.sh` que o plano §D3 e o `quickstart.md` nomeiam **nao existe**, e o que existe (`conformidade.ts`) e offline e di-lo (`INCOMPLETO`). NAO corrida. Razao completa em `relatorios/us7.txt`
- [x] T058 [US7] Commit da US7 e resumo ao dono — **feito:** commit `specs/004: T055/T056/T058 (US7) - o registo da bateria por versao e o que o venue nao publica` (hash em `relatorios/RESULTADO.md` §commit)

## Fase 9 — Fecho do recorte (T059–T065)

- [x] T059 [US8] Alavancagem e leituras de borda: os casos de `liquidationPx` nulo, pedido de outra conta, credencial ausente (FR-022, FR-023) — **fechado com prova:** 14 casos da leitura (incl. `leitura/posicao-com-liquidacao-a-null-a-distancia-fica-AUSENTE` — ausente, nunca zero) + 9 da credencial (ausente/ilegivel = recusa nomeada) + as portas `ficha`/`uma_conta` para o pedido de outra conta. Ver `relatorios/us6.txt`
- [ ] T060 [US9] Histórico e taxas: casos do histórico sem reconstrução (FR-018) — se não couber na US6, é história própria — **NAO FECHADA — razao medida (a mesma de T047):** nao ha comportamento de historico no conector, logo nao ha caso a escrever — escreve-los seria inventar prova. Ver `relatorios/us6.txt`
- [x] T061 Prova de que o conector **não importa o `core`** (RN-E1), por comando, e de que não contém regra de decisão (FR-024) — **feito:** a porta da própria bateria: `porta: importa contracts, nunca o core (RN-E1)  OK  0 importacoes do core em brokers/hyperliquid` (`tools/verificar-conector/provas-offline.sh`)
- [x] T062 Varredura de credenciais (RN-E14) em `brokers/`, `docs/` e `config/`: **zero** valores — **feito:** é a prova 8 da bateria de conformidade, e ela traz os **dois controlos** (o varrimento tem de saber ENCONTRAR o que existe, senão o zero não mede nada)
- [x] T063 `relatorios/RESULTADO.md`: os 8 SC, cada um com o comando que o mediu e o número que saiu — **feito:** `relatorios/RESULTADO.md` — os 8 SC, cada um com o comando que o mediu e o numero que saiu, e no fim a tabela do que ficou provado / por provar
- [x] T064 Actualizar `docs/inventario-de-chaves.md` (§ do conector: as chaves que ele passou a ler, cada uma com o leitor nomeado) e `docs/diagrama-de-blocos.html` (o conector real ao lado do dublê) — **feito:** `docs/inventario-de-chaves.md` §9 (as 7 chaves que o conector passou a ler, quem as le e para que, mais as 3 lacunas que a leitura revelou) e `docs/diagrama-de-blocos.html` (o cartao «O conector REAL, ao lado do duble (recorte 004)»)
- [x] T065 Resumo ao dono: o que ficou provado, o que ficou por provar, e a decisão de passagem a produção (que é dele) — **fechado com a entrega:** `relatorios/RESULTADO.md` (§«o que ficou provado / por provar») e o resumo desta vaga ao dono, com as TRES tarefas bloqueadas pela decisao dele escritas na linha de cada uma. A passagem a producao continua a ser decisao DELE (RN-H17/FR-028)

## Fase 10 — O contrato aditivo que os dois achados exigem (T066–T070)

*Achados em `data-model.md` §7, ao ler os esquemas do contrato. São **fundacionais** (a leitura da conta vem
antes da US6), por isso esta fase corre **antes** da Fase 4. A numeração é acrescentada no fim em vez de
renumerar 65 tarefas — renumerar reescreveria o ficheiro e não muda nada do que ele diz.*

- [x] T066 [Fase 4] Os quatro números que faltam: `posicao` ganha `nocional`, `margem`, `distancia_de_liquidacao` e `resultado_nao_realizado` (opcionais, e ditos como «do venue, nunca recalculados») — contrato sobe para **1.4.0** — **feito:** `contracts/versao.json` = **1.4.0**, e a emenda inteira (as quatro decisões, com o que o venue real obrigou) está medida em `relatorios/emenda-1.4.0.txt`
- [x] T067 [Fase 4] `distancia_de_liquidacao` **ausente** quando não há posição: caso feliz (com posição) e adversário (sem), com `esperadoOk` nos dois — **feito:** os dois casos nos `contracts/casos/` (os dois runners) e no `leitura.casos.json` do conector, com `esperadoOk` nos dois sentidos
- [x] T068 [Fase 4] `preco_de_liquidacao` passa a admitir um **valor neutro** do conjunto fechado (o precedente é `relogio_de_fecho_de_barra`, com `desconhecido` no enum) — zero continua a significar «1x», nunca «não sei» — **feito:** o valor neutro entrou no conjunto fechado, e a leitura de uma liquidação a `null` **não** a transforma em zero (caso `posicao-com-liquidacao-a-null-a-distancia-fica-AUSENTE`); a distância passa a sair em `porcento_da_marca` com a marca declarada
- [x] T069 [Fase 4] Os mesmos casos novos nos **dois** runners do contrato (a igualdade das duas linguagens é a prova de que a emenda é aditiva e não uma segunda verdade) — **feito:** os casos novos correm nos dois runners e a contagem antes/depois está registada; a conformidade confere a fidelidade das duas linguagens sobre os MESMOS casos (`0 divergentes`)
- [x] T070 [Fase 4] Correr `provar.sh` + a conferência dos casos e registar a contagem antes/depois em `relatorios/us3.txt` (o que já corria não se perde) — **feito:** medido junto da emenda (`relatorios/emenda-1.4.0.txt`); nenhum caso que já corria se perdeu — a bateria fechou a **27 de 27** com a emenda, a conformidade a **9 de 9** e os casos do conector a **0 divergentes**

- [x] T071 Ler o saldo nas DUAS carteiras do venue (perpetuo e spot) — e nunca confundir uma com a outra
      Porque (medido no venue, 29 set): a conta de teste respondeu `clearinghouseState.accountValue = 0.0`
      enquanto tinha **998.464965 USDC no spot** (`spotClearinghouseState`). Quem so le o perpetuo conclui
      «conta sem fundos» e recusa operar — com o dinheiro la dentro. A leitura tem de declarar a carteira de
      cada valor, e o manifesto tem de declarar que este venue tem duas. Sem isto, a porta que julga a margem
      fecha por engano, e um engano que fecha e tao mau como um que abre.
      — **feito e medido:** `brokers/hyperliquid/leitura.ts` lê as duas carteiras, cada valor com a carteira
      nomeada, e a bancada prova-o em 14 casos (incluindo «uma carteira falha e a outra lê-se», e as duas a
      falhar a recusar pelo NOME das duas). A sonda leva as duas ao manifesto. Relatório: `relatorios/sonda-real.txt`

---

## O que fica aberto, no fecho desta contabilidade (medido, não digitado)

Medido em 29/09, com esta vaga: `provar.sh` (**27 de 27**), `provas-offline.sh` (`0 falhas`), a conformidade
(`conformidade: 9 de 9 passaram · 238 verificacoes · 0 divergentes`) e a bancada do processo (`processo: 31
casos · 31 ok · 0 divergentes`). Das **33 tarefas abertas**, **28 fecham com prova** (o comando e o número
estão na linha de cada uma e no relatório do caso de uso) e **5 ficam com `[ ]` de propósito**, todas com a
razão escrita na própria linha — nenhuma em silêncio:

- **Bloqueadas pela decisão do dono** (exigem ASSINAR e ENVIAR ao venue — não é do agente, RN-H17): **T042**
  (SC-003, a contagem de idempotência no venue), **T048** (SC-007, os cinco números no mesmo instante — a conta
  de teste está sem posição: medido `equity 0.0`, `saldos: []`, `posicoes: []`), **T057** (SC-004, as 8 provas no
  ambiente de TESTE). O comando exacto que as correria está na linha de cada uma e em `relatorios/us5.txt`,
  `us6.txt` e `us7.txt`.
- **Sem comportamento no código, logo sem prova a citar**: **T047** e **T060** (o histórico do venue, FR-018 —
  não existe leitor de histórico no conector; medido por `grep` em `relatorios/us6.txt`).
- **Trabalho por fazer, declarado onde foi achado**: o **registador automático** do resultado da bateria (o
  `conformidade.sh` que o plano §D3 e o `quickstart.md` nomeiam não existe — o registo da T055 foi escrito à
  mão), o **envio ao vivo** (a porta recusa de propósito: exige assinar — FR-019, T042, T057), e as **três
  lacunas de inventário** achadas em T064 (`instrumentos` lido da raiz com omissão no código, o prazo do
  silêncio sem chave, a cadência da re-sondagem por decidir).
- **Decisão que continua a ser do dono**: a passagem a produção (`conexao.ambiente: producao` — o conector
  recusa; **T065**), e o resumo desta vaga está em `relatorios/RESULTADO.md`.
