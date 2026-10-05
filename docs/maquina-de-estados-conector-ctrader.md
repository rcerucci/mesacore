# A máquina de estados do conector — cTrader (Open API)

Escrito 01/10/2026 · contrato 1.9.0 · companheira da `regra-de-negocio-ctrader.md` (regras `RN-CT*`) e da
`maquina-de-estados-conector.md` (a do primeiro conector, Hyperliquid).

## Porquê uma máquina própria, se o conector «só traduz e transporta»

Porque traduzir e transportar **tem estados**, e é neles que moram os defeitos caros: uma ordem que pode ter sido
aceite e não se sabe; uma ligação que caiu a meio de um envio; um pedido repetido; um `desconhecido` que ficou por
reconciliar. O conector não decide risco — mas decide **o que fazer quando não sabe**, e isso é tabela, não
improviso por ramo de código.

## O que muda neste venue (e por isso esta máquina não é uma cópia)

1. **A ligação tem DUAS camadas.** O transporte (TLS vivo) e a **sessão da conta** (autorizada) são coisas
   separadas: o venue pode ter a ligação de pé e a sessão derrubada — e avisa (`ProtoOAAccountDisconnectEvent`,
   `ProtoOAAccountsTokenInvalidatedEvent`) — ou ter a sessão viva e o transporte cair. Um conector que os junte
   numa bandeira só não sabe se pode enviar. *(RN-CT4)*
2. **Há dois modos de «fechar sim, abrir não»:** `accessRights = CLOSE_ONLY` (a conta) e
   `tradingMode = CLOSE_ONLY_MODE` (o símbolo). *(RN-CT12, RN-CT22)*
3. **O `equity` não existe na conta** — o que a leitura publica é derivado e tem de vir declarado. *(RN-CT15)*
4. **A rotação do token derruba a sessão** — um refresh é acontecimento da máquina, não do cliente HTTP.
   *(RN-CT10)*
5. **Os pedidos históricos têm limite de ritmo próprio** (5/s), separado dos outros (50/s). *(RN-CT2)*

## Os eixos (quatro, e nenhum se adivinha)

| Eixo | Estados | Quem o diz |
|---|---|---|
| **Transporte** | `sem_ligacao` · `a_ligar` · `pronto` · `em_duvida` | o protocolo (heartbeat e prazos), nunca o silêncio |
| **Sessão da conta** | `nao_autorizada` · `autorizada` · `invalidada` (por rotação de token, revogação ou kick do servidor) | o venue, por resposta ou evento |
| **Ordem em curso** (por instrumento) | `nenhuma` · `a_resolver` · `a_enviar` · `enviada` · `fechada_aceite` · `fechada_parcial` · `fechada_recusada` · `desconhecida` | a resposta do venue + o prazo declarado |
| **Reconciliação** (por instrumento) | `em_dia` · `pendente` | o que o venue conta do que aconteceu (posição, ordens, negócios) |

Duas palavras que não podem colapsar: **`em_duvida` não é `caida`** (é «não sei») e **`desconhecida` não é
`falhou`** (é «pode ter acontecido»). E uma terceira, própria deste venue: **`transporte pronto` não é `sessão
autorizada`** — a primeira pergunta é sobre o fio, a segunda é sobre a conta, e só as duas juntas autorizam enviar.

## A tabela

Colunas: estado · acontecimento · passa a · acção · **o que sai** (mensagem/desfecho, com o motivo).

| Estado | Acontecimento | Passa a | Acção / o que sai |
|---|---|---|---|
| transporte `sem_ligacao` | arranque do processo | `a_ligar` | abrir TLS, `ProtoOAApplicationAuthReq`, depois `ProtoOAGetAccountListByAccessTokenReq` |
| transporte `a_ligar` | app autenticada + conta no ficheiro | sessão `nao_autorizada` | `ProtoOAAccountAuthReq(ctidTraderAccountId, accessToken)` |
| sessão `nao_autorizada` | resposta com **outro** `ctidTraderAccountId` | (recusa) | **não arranca**: `identidade_da_conta_divergente` — o id do venue contra o do ficheiro da conta (RN-CT8) |
| sessão `nao_autorizada` | `accessRights = NO_TRADING/NO_LOGIN` | (recusa) | **não arranca**: `sem_direito_de_operar` (RN-CT12) |
| sessão `nao_autorizada` | resposta aceite | `autorizada` | sonda: símbolos (`includeArchivedSymbols`) + conta; escrever o manifesto |
| transporte `pronto` | heartbeat sem resposta dentro do prazo | `em_duvida` | **parar de enviar**; ordem viva vira `desconhecida` |
| sessão `autorizada` | `ProtoOAAccountsTokenInvalidatedEvent` (rotação/revogação) | `invalidada` | re-autenticar com o token **novo**; até lá **nenhuma ordem nova** |
| sessão `invalidada` | re-auth aceite | `autorizada` | **ler a conta antes** de qualquer ordem nova |
| ordem `nenhuma` | pedido (boleta) | `a_resolver` | resolver: nome→`symbolId` na sonda, % do saldo → `volume` em 0,01, `stop_pct`/`tp_pct` → `relativeStopLoss`/`relativeTakeProfit`, e **conferir a banda** |
| ordem `a_resolver` | fora do passo/mínimo/banda, ou símbolo em `CLOSE_ONLY_MODE`, ou conta `CLOSE_ONLY` a tentar abrir | `nenhuma` | **não envia**; `recusado` + motivo (RN-CT21/22) |
| ordem `a_resolver` | resolução calculada | `a_enviar` | enviar `ProtoOANewOrderReq` **com `clientOrderId`** (a marca) |
| ordem `a_enviar` | `ORDER_FILLED` | `fechada_aceite` | desfecho com os **números do venue** (preço, volume, comissão, `positionId`) |
| ordem `a_enviar` | `ORDER_PARTIAL_FILL` | `fechada_parcial` | desfecho parcial + a **marca** para a operação seguinte |
| ordem `a_enviar` | `ORDER_REJECTED` / `ProtoOAErrorRes` | `fechada_recusada` | desfecho com **o `errorCode` e a palavra do venue**, sem tradução (RN-CT42) |
| ordem `a_enviar` | `ORDER_ACCEPTED` (em repouso) | `enviada` | desfecho `aceite`; o preenchimento chega por evento |
| ordem `enviada` | `ORDER_REPLACED`/`ORDER_CANCELLED`/`ORDER_EXPIRED` | `fechada_*` | desfecho com o tipo que o venue deu |
| ordem `a_enviar`/`enviada` | silêncio além do prazo | `desconhecida` | **`desconhecido`** — e **não** reenviar às cegas |
| ordem `desconhecida` | leitura da conta: **posições** (`get_positions`, o `ProtoOAReconcileReq`) **e** o **registo de ordens** (`ordens_do_registo` → `get_orders`/`ProtoOAOrderListReq`) | `em_dia` | reconciliar pelos **dois retratos** — posições + registo de ordens — a achar a NOSSA ordem pela `clientOrderId` ou pelo `positionId` → desfecho **verdadeiro** (os `ProtoOADeal` só se leem para o **detalhe de um fecho**; ver a nota datada de 05/10/2026, A-14) |
| ordem `desconhecida` | pedido novo no mesmo instrumento | `desconhecida` | **recusar** com **`prazo_excedido`** (ver a nota datada de 05/10/2026 — o nome `desconhecido_por_reconciliar` **não é produzido**); **fechar/reduzir continua permitido** |
| ordem `nenhuma` | eco do **mesmo `clientOrderId`** | `nenhuma` | não duplicar; devolver o desfecho da **mesma** ordem (por consulta ao venue, nunca por memória) |
| qualquer | pedido que nomeia outra conta | (igual) | recusar (`pedido_de_outra_conta`) |
| fecho `nenhuma` | pedido de fecho (`caixa`) | `a_enviar` | `ProtoOANewOrderReq` com **`positionId`** e lado contrário — o venue fecha; **não é `reduce_only`** porque este venue não o tem (RN-CT34) |
| fecho `nenhuma` | fecho sem posição | `nenhuma` | `nada` + motivo (`sem_posicao_para_fechar`), nunca uma ordem nova |
| fecho `a_enviar` | silêncio além do prazo | `desconhecida` (só o fecho) | o fecho fica `desconhecido` pelo prazo, mas **NÃO cria pendência** de instrumento — a trava do FR-068 é das **aberturas** (ver a nota datada de 05/10/2026, A-13) |
| qualquer | evento `SWAP`/`DEPOSIT_WITHDRAW`/`BONUS_DEPOSIT_WITHDRAW` | (igual) | **não é desfecho de ordem**: registar como acontecimento de conta (RN-CT38) |

## As três ausências deliberadas (as mesmas da casa, e valem aqui)

- **Não existe transição «esperar mais um pouco».** Uma volta do relógio que nada mudou **não** é acontecimento:
  não reescreve o estado nem reinicia o prazo — um `→` para si mesmo reinicia o prazo para sempre e a espera nunca
  termina.
- **Não existe transição que arredonda para caber.** Fora do passo, abaixo do mínimo, fora da banda ou abaixo de
  `slDistance`/`tpDistance` é `recusado` — e `volume` que não cabe em inteiros de 0,01 é recusado, não truncado.
- **Não existe sucesso por silêncio.** `desconhecida` só sai por **leitura do venue**. Silêncio dentro do prazo é
  espera; além dele, `desconhecido` — e nada de optimismo.

## As invariantes

1. **Enviar exige as duas camadas prontas:** transporte `pronto` **e** sessão `autorizada`. Uma bandeira só não
   chega para decidir um envio (RN-CT4).
2. **A identidade confere-se no arranque e em cada re-autenticação:** o `ctidTraderAccountId` que o venue devolve
   contra o do ficheiro da conta; divergência é recusa, nunca tolerância (RN-CT8).
3. **A resolução precede o envio** onde o venue deixa perguntar; em `MARKET` ele só calcula ao executar, e a
   resolução sai depois **com os números dele**.
4. **Uma ordem em curso por instrumento** — a segunda espera ou é recusada.
5. **Com `desconhecido` pendente não entra ordem nova** naquele instrumento; **sair** (fechar) é sempre permitido.
6. **A credencial nunca entra na máquina** — nem no estado, nem no log, nem na mensagem. Neste venue há **três**
   valores (client secret, access token, refresh token) e os três são **referências a ficheiro**; a rotação
   reescreve o ficheiro de tokens, e o valor nunca passa por aqui (FR-023).
7. **Um processo, uma ligação, uma conta** — e a conta nomeia o processo, como em qualquer venue.

## Dois percursos para conferir a tabela

- **Abertura a mercado, preenchida:** pedido → resolver (`%` do saldo × alavancagem → `volume` em 0,01, conferido
  ao `stepVolume`/`minVolume` do símbolo, e `stop_pct`/`tp_pct` → relativos em 1/100000, conferidos a
  `slDistance`/`tpDistance`) → **resolução sai** → enviar com `clientOrderId` → `ORDER_FILLED` com
  `executionPrice`/`executedVolume` → `fechada_aceite`, com a **marca** a viajar na operação seguinte e o
  `positionId` a ligar ordem a posição.
- **Fecho que o venue não serviu:** pedido `caixa` → enviar com `positionId` → silêncio → `desconhecida` →
  leitura da conta: a posição já não existe → `aceite` com o negócio de fecho (`closePositionDetail`); se existir,
  `parcial`/`recusado` conforme o que o venue contar — nunca por conclusão nossa.

## Como se mede

Como os outros dublês: **casos em dado** (`*.casos.json`), os **mesmos casos** no conector real e no dublê da
mesa, divergência é falha. O que muda é haver um venue a sério do outro lado: a **bateria de conformidade** corre
primeiro em **demonstração**, no tamanho mínimo, e nada nela põe uma chave real dentro do repositório. As provas
desta família que o cTrader obriga a acrescentar às oito da casa:

- **as duas camadas da ligação** — derrubar a sessão com o transporte vivo (o `token was refreshed` reproduz isto)
  e provar que o conector para de enviar e re-autentica;
- **a identidade recusada** — apontar o ficheiro da conta a **outro** `ctidTraderAccountId` e provar a recusa;
- **o fecho por `positionId`** — provar que fechar **não abre** do outro lado (a garantia é do venue, e mede-se);
- **o `clientOrderId` reenviado** — a mesma marca duas vezes, e contar as posições (a idempotência é nossa até o
  venue a desmentir).

## Nota datada — 05/10/2026: o motivo da recusa do FR-068, e a reconciliação por leitura

**O que foi fechado.** O eixo **«Ordem em curso» por instrumento** e o eixo **«Reconciliação» por instrumento**
deixaram de ser papel: `processo.py` passou a guardar `Arranque.pendentes` (um dicionário instrumento → o
*bilhete* de uma ordem que ficou `desconhecida`), a **travar a ordem nova** no mesmo instrumento (FR-068), a
**deixar passar o fecho** (a exposição desmonta-se), e a **reconciliar por leitura** (`processo.reconciliar`,
FR-069): lê as **posições** (`ProtoOAReconcileReq`) e o **registo de ordens** (`ProtoOAOrderListReq`, o novo
`transporte.ordens_do_registo`), procura a NOSSA ordem pela **marca** (`clientOrderId`) ou pelo `positionId`, e
publica o desfecho **verdadeiro** — tirando o instrumento de pendente. **Leitura falhada não produz desfecho
nenhum**: a ordem continua `desconhecida` e a pendência fica (é o cenário 4 do US5).

**O motivo, e porque é este.** O conjunto FECHADO do contrato tem **23** motivos e **nenhum** nomeia «há uma
ordem desconhecida por reconciliar neste instrumento». O nome que a prosa desta máquina dava
(`desconhecido_por_reconciliar`) **nunca foi produzido** — e um documento que o nomeie como se fosse é o
próximo defeito. A **decisão do dono** (05/10/2026) foi **não emendar o contrato** e usar **`prazo_excedido`**,
que já significa exactamente isto no **vocabulário da MESA**: `core/ciclo/acoes.json#por_motivo.prazo_excedido`
mapeia-o para a acção **`parar_e_reconciliar`**, com o porquê *«Desfecho desconhecido: o bilhete pode ter
chegado. Primeiro reconcilia-se.»* — é a mesa que decide o que fazer com o desfecho, e ela já o sabe fazer.

**O que se evitou, e o que fica por decidir.** O custo de um nome **próprio** seria: uma **emenda** ao conjunto
fechado → **subida de versão** do contrato (`contracts/versao.json`) → o **espelho**
`contracts/_defs/forma.schema.json#/$defs/motivo` e o `contracts/vocabulario.json#motivos` → e a **`TRADUCAO`**
da mesa em `core/` (a porta que apanha a tradução em falta). Nada disso se tocou: `contracts/` fica intacto. No
dia em que se quiser o nome próprio, é esse o custo a pagar — e a decisão é do dono.

**Provas (na bancada do envio, com duplo, nada vai ao venue):** `casos/prova-envio.py` → **18 provas · 18 ok**,
com os sete casos novos — (a) silêncio → `desconhecido` + instrumento pendente; (b) ordem nova com pendente →
`recusado`/`prazo_excedido`, **0** mensagens ao protocolo; (c) fecho **passa** com pendente; (d) reconciliação
por leitura acha a ordem → desfecho `aceite` + pendência sai + pedido novo passa; (e) leitura falhada → **sem
linha de desfecho**, pendência fica; (f) controle sem pendente → a ordem passa; (g) reinício → a **primeira
leitura** (o registo do venue) encontra a marca e recusa a segunda ordem (`referencia_ja_enviada_ao_venue`).

**O que continua aberto, e dito:** o **fecho** que fica em silêncio **não** cria pendência nesta vaga — a
pendência é das ordens de ABERTURA (que é o que o FR-068 trava: «nenhuma ordem **nova**»), e o fecho não tem
resolução pré-envio para acompanhar um desfecho verdadeiro. Fica declarado, com a linha própria dele na tabela
acima, para a vaga em que se pegar nele.

## Nota datada — 05/10/2026: o RITMO do venue (FR-071) deixa de ser papel

**O que foi fechado.** O `transporte.py` ganhou o limitador de ritmo (RN-CT2, eixo próprio): **50 pedidos/s** nos
dados **não-históricos** (leitura e envio) e **5/s** nos **históricos** (as velas), aplicado por **espaçamento
mínimo** entre pedidos (`1/50` = 0,02 s; `1/5` = 0,2 s) — o mais conservador dos desenhos, e deixa o intervalo
como um número legível. O único ponto por onde tudo passa é o `transporte.py` — é lá que o limitador vive:
`_vez_geral()` antes dos verbos gerais (contas, trader, símbolos, posições, ordens, não-realizado, negócio de
fecho) e do `_enviar_pedido`; `_vez_historica()` antes de `velas`.

**A espera é ESTADO DECLARADO, nunca «sem dados».** Lê-se em
`Transporte.estado_de_ritmo()["geral" | "historico"]` — os campos `maximo_por_segundo` (50/5),
`intervalo_minimo_s` (0,02/0,2), `pedidos`, `esperas` (quantas vezes o ritmo obrigou a esperar) e
`ultima_espera_s` (a última espera); no topo, `relogio` diz `real` (produção) ou `injectado` (a prova). O
limitador **só atrasa** — não toca no que o venue responde: o pedido que esperou **chega e é servido**, e o único
caminho para um vazio é a **recusa nomeada** (ex. `falha_ao_ler_as_velas`).

**O relógio é injectável** (`agora`/`dormir` no construtor do `Transporte`): a prova offline
(`casos/prova-ritmo.py`, 6 provas) mede o ritmo em segundos do relógio injectado, sem esperar em tempo real e sem
tocar no venue — 50 e 5 pedidos por segundo, as duas classes independentes, a espera declarada, o relógio de
produção, e a **prova negativa**: sem o limitador o mesmo teste dá um **surto de 120 em 1 s (intervalo 0,0 s)** e
o caso fica VERMELHO a nomeá-lo.

**O que NÃO foi medido, e di-lo:** o 50/s e o 5/s são o que a **DOC/spec** declara (RN-CT2, [F]) — **não** foram
medidos contra o venue (não se martela o venue para descobrir o limite; é a mesma rajada que já custou 253×`429`
no outro venue). E a pergunta #2 abaixo **deixa de importar deste lado**: nunca se chega a esgotar o 5/s —
**espera-se**. O `provar.sh` passou a correr as bancadas do conector (A-2) — **eram três** quando esta nota foi
escrita, e o total da porta única era **55** (55 de 55); a **leitura do mercado** (passo 9) somou a quarta
bancada e o total passou a **56 de 56, rc=0** (ver a nota datada da LEITURA DO MERCADO, abaixo).

## Nota datada — 05/10/2026: a SESSÃO da conta (FR-070) e as DUAS camadas no envio (FR-048) deixam de ser papel

**O que foi fechado.** O eixo **«Sessão da conta»** deixou de ser só tabela: o conector passou a **escutar os
eventos** do venue e a guardar o estado **por nome** (`nao_autorizada` · `autorizada` · `invalidada`), e o
**envio** passou a conferir as **duas camadas** (transporte **e** sessão) no próprio momento de mandar. Três
peças, e onde vivem:

1. **Onde se LÊ o estado** — `Transporte.estado_da_sessao(account_id)`
   (`brokers/ctrader/transporte.py`). Devolve o nome do estado. `invalidada` **manda** sobre as outras duas: foi
   um **evento** que o disse, e até a biblioteca re-autenticar não se envia nada. Sem evento, o estado é o que a
   biblioteca diz do lado dela (`is_account_authorized`, via `conta_autorizada`).
2. **Onde se REGISTA o tratador** — `Transporte.seguir_a_sessao_da_conta(account_id)`, chamado no **arranque**,
   dentro de `_abrir_ligacao` (`brokers/ctrader/processo.py`), a seguir a `autorizar_conta()` — **é o degrau que
   dá olhos à máquina**. Liga **quatro** tratadores: `TokenInvalidatedEvent` (rotação/revogação),
   `AccountDisconnectEvent` (conta derrubada — a biblioteca só o publica depois de verificar que foi real),
   `ClientDisconnectEvent` (o **kick** do servidor ao cliente) e `ReadyEvent` (a re-autenticação da biblioteca).
   **Se o registo FALHAR, a porta da ligação NÃO passa**: `seguir_a_sessao_da_conta` recusa por nome
   (`sessao_nao_seguida`) e diz quais tratadores faltaram — um silêncio aqui deixaria a guarda das duas camadas
   **cega**, e um conector cego não sabe se pode enviar. A falha é dita, nunca engolida.
3. **FR-048 no envio** — `Transporte.conferir_as_duas_camadas(account_id)`, chamada **num só sítio**
   (`_enviar_pedido`, dentro do `transporte.py`) **e** à frente de cada pedido (`_porta_da_sessao`, no
   `processo.py`). É a MESMA conferência nos dois pontos: transporte pronto (aplicação autenticada) **e** sessão
   autorizada. «Uma bandeira só nunca decide um envio» — faltando uma, a recusa é nomeada e **não sai mensagem
   nenhuma** ao protocolo.

**Não se reimplementou recuperação nenhuma.** Quem re-autentica é o *maintainer* da biblioteca
(`ctrader_api_client/auth/_maintain.py`: `handle_account_disconnect`, `_recovery_loop`, `_rotate`). O conector
só **observa** o evento e guarda o nome do estado. A recuperação **lê a conta antes**: o `ReadyEvent` marca uma
**releitura pendente** (`Transporte.releitura_pendente`), e a primeira coisa que o pedido seguinte faz é **LER a
conta** (`_carga_da_conta` → `trader`) antes de aceitar ordem nova (US6 cenário 2). E, com uma **pendência** do
US5 em curso no instrumento, **reconcilia-se por leitura ANTES** de aceitar a ordem nova (US6 cenário 3): o
desfecho **verdadeiro** da ordem antiga viaja como linha à frente da ordem nova — reconciliar primeiro, aceitar
depois.

**O motivo, e porquê este.** A recusa da ordem nova (e a do fecho) sai com **`prazo_excedido`** — a **decisão do
dono** (05/10/2026), a MESMA do FR-068: é o nome que a casa já dá a «a credencial/sessão não está válida»
(`brokers/hyperliquid/identidade.ts:116`) e a mesa trata-o
(`core/ciclo/acoes.json#por_motivo.prazo_excedido` → `parar_e_reconciliar`). Não se emendou o contrato:
`contracts/` fica intacto.

**O que se faz ao FECHO quando a sessão caiu — a decisão, e o porquê concreto.** O fecho é **recusado** por
`prazo_excedido`, tal como a abertura: uma **sessão caída não serve pedido nenhum**, e o fecho deste venue é uma
ordem que **referencia a posição** e viaja pelo **mesmo canal** (o protocolo da conta) — tentá-lo seria mandar
uma mensagem por uma sessão que se sabe morta. É **distinto** da **pendência** do FR-068, em que o fecho
**CONTINUA a passar** (aí a sessão está **VIVA**: só há uma ordem `desconhecida` por reconciliar, e a exposição
tem de se poder desmontar, Invariante 5). **Sessão caída = parar; pendência = fechar continua** — duas regras que
não se misturam. *(O teste US5 (c) — «com uma ordem desconhecida pendente, o FECHO continua a passar» — mantém-se
verde: não há aqui sessão caída.)*

**O que NÃO foi medido, e di-lo.** O **evento do VENUE**: a bancada **injeta-o** pelo `EventEmitter` **original**
da biblioteca (é o mesmo mecanismo de produção), mas na vida ele só chega numa **rotação/revogação/kick a
sério** — isso é prova de execução ao vivo, não desta bancada offline. E a **cobertura dos três casos que a spec
nomeia**: a **rotação** e a **revogação** entram as duas por `ProtoOAAccountsTokenInvalidatedEvent` →
`TokenInvalidatedEvent` (a biblioteca encaminha-o); o **kick** por `ProtoOAClientDisconnectEvent` →
`ClientDisconnectEvent` (e, do lado da conta, por `ProtoOAAccountDisconnectEvent` → `AccountDisconnectEvent`). Os
**três** têm tratador ligado — mas a **tradução real de cada proto** não se mede aqui (não se martela o venue).

**Provas (na bancada do envio, com duplo, nada vai ao venue):** `casos/prova-envio.py` → **32 provas · 32 ok**,
com os nove casos novos — (a) o evento de invalidação chega → a sessão fica `invalidada` (lida por nome);
(a-bis) o kick do servidor (que não nomeia conta) → `invalidada`; (b) ordem nova com a sessão invalidada →
`recusado`/`prazo_excedido`, **0** mensagens ao protocolo; (c) o **fecho** com a sessão invalidada → recusado
(a linha crua, com o porquê); (d) re-autenticada → a **leitura da conta ANTES** de qualquer envio (a ordem das
operações, com contadores: leitura, leitura, envio); (e) pendência do US5 + recuperação → **reconcilia antes** de
aceitar a ordem nova (o desfecho `us5/a` da ordem antiga sai à frente do `us6/e` da nova, e a pendência sai); (f)
falta a camada do **transporte** → recusa nomeada, **0** envios; (g) controle: tudo autorizado e sem pendência →
passa (1 mensagem). E a **prova negativa**: tirada a guarda (`conferir_as_duas_camadas` → `None`, o
comportamento de hoje), a ordem com a sessão invalidada **SAI** — e o caso (b) fica **VERMELHO** a nomeá-lo. Sem
esse vermelho a bancada não mede a guarda, mede o duplo. O `provar.sh` continua a correr as bancadas do
conector (A-2).

## Nota datada — 05/10/2026: A-13 — o FECHO que fica em silêncio NÃO cria pendência

**O defeito (A-13), medido.** A vaga do FR-068 deu ao conector a **pendência por instrumento** (`Arranque.pendentes`):
uma ordem que ficou `desconhecida` **trava a ordem NOVA** no mesmo instrumento. Mas essa trava vive na **abertura**
— o **fecho** que fica em silêncio *não* fabrica uma pendência. O texto da máquina não dizia isto de forma que se
pudesse citar: a nota do FR-068 falava de uma «linha própria dele na tabela acima», e essa linha não existia.

**O que passa a estar dito.** Acrescentou-se à tabela a linha do **fecho silencioso**: o fecho fica `desconhecido`
pelo prazo (é um desfecho por si), mas **não** marca o instrumento como pendente. **Porquê:** o FR-068 trava
«nenhuma ordem **nova**», e o que é *nova* é a **abertura**; o fecho **não** abre exposição nenhuma — e a
Invariante 5 manda que a exposição **possa sempre desmontar-se**. Além disso o fecho não tem **resolução
pré-envio** para acompanhar um desfecho verdadeiro (o venue fecha por `positionId`, sem números nossos antes de
executar), logo não há o que a pendência guardasse. **Fica declarado**, para a vaga em que se pegar nele — o que
**não** fica é uma linha de tabela a prometer o que o código não faz.

**Provas:** `casos/prova-envio.py` (**32 · 32**) — US5 (c) «com uma pendência, o fecho continua a passar»
(Invariante 5), e o fecho por `positionId` em `casos/ordens.casos.json` (dentro de **73 · 73**).

## Nota datada — 05/10/2026: A-14 — a RECONCILIAÇÃO como o código a faz (o nome cedeu ao código)

**O defeito (A-14), medido.** A linha da tabela do `desconhecida` dizia que o conector reconciliava «pelos
**negócios** (`ProtoOADeal` por `positionId`/`orderId` e pelo `clientOrderId`)». O código **não** lê negócios para
reconciliar: `processo.reconciliar` lê **dois retratos** — as **posições** (`get_positions`, o que o
`ProtoOAReconcileReq` transporta) e o **registo de ordens** (`transporte.ordens_do_registo` →
`get_orders`/`ProtoOAOrderListReq`, «TODAS as ordens, vivas ou já acabadas») — e procura a NOSSA ordem pela
**marca** (`clientOrderId`) ou pelo `positionId`. Os `ProtoOADeal` só se leem **num** sítio, e não é a
reconciliação: o **detalhe de um fecho** (`negocio_de_fecho` → `get_deals_by_position_id`).

**Quem cedeu, e porquê.** **Cedeu o documento** — o código é o que corre e o que a bancada mede; um pedido que o
conector não usa é a mentira pequena que a auditoria apanhou. A linha da tabela passa a nomear os pedidos que o
código **faz**. O `ProtoOAReconcileReq` continua nomeado (é o que traz as posições), mas a reconciliação passa a
dizer-se pelos **dois retratos**, não pelos negócios.

**Provas:** `casos/prova-envio.py` (**32 · 32**) — US5 (d) «reconciliação por leitura acha a ordem → desfecho
`aceite` + pendência sai» e (e) «leitura falhada não inventa desfecho»; US5 (g) «a **primeira leitura** (o registo
do venue) encontra a marca e recusa a segunda ordem».

## Nota datada — 05/10/2026: a LEITURA DO MERCADO (o último retrato por símbolo) tem leitor

**O que passou a existir (passo 9).** O eixo do **mercado** não estava nesta máquina porque, até aqui, a leitura
caía na última vela fechada — a `transporte.subscrever_spots` existia e **ninguém a chamava** (0 chamadores).
Agora há **um retrato por símbolo**, montado a partir dos eventos do venue:

- **a cotação** vem dos spots (`ProtoOASpotEvent`), com `bid`/`ask` **opcionais um a um** — o lado que o venue não
  manda fica **AUSENTE**, nunca zero (RN-CT29);
- **o livro** (`ProtoOADepthEvent`) é mantido **por deltas** (`newQuotes`/`deletedQuotes`): acrescentar e apagar
  níveis reflecte-se; apagar um id inexistente **não inventa** nada;
- **a idade do dado** sai do `tempo_do_venue_ms` do evento, **não** do relógio local;
- sem retrato, a leitura cai numa **régua declarada** (a última vela fechada) e **di-lo** — não finge um instante.

**Como corre.** `_assinar_o_mercado` subscreve spots e profundidade no **arranque de serviço**, e a leitura
repete-se no relógio de `--leitura-a-cada` (RN-V10): o mandato é a ficha, relida em cada volta.

**Provas (offline, com `EventRouter` original da biblioteca, sem TCP e sem chave):**
`casos/prova-leitura.py` → **7 provas · 7 ok · 0 divergentes** — (a) divisão antes/depois (`venue_bid: 125000` →
`bid: "1.25"` · `ask: "1.25001"`), (b) livro por deltas, (c) um lado só (o outro ausente, nunca zero) e o
controlo, (d) sem retrato → régua declarada, e **as duas negativas** (divisão errada, lado ausente a virar zero)
exigem a bancada **VERMELHA** a nomear o caso. A bancada entrou no `provar.sh` — a porta única passou a
**56 de 56, rc=0**.

**O que NÃO foi medido, e di-lo:** a **subscrição a sério** (o duplo injecta os eventos) — não se confirmou que o
venue aceita `ProtoOASubscribeSpotsReq`/`…DepthQuotesReq`; e, se o venue **omitir** o `timestamp` do spot, a
biblioteca cai para o **seu** relógio (`router.py`) e a idade medir-se-ia contra um carimbo nosso — declarado
[a confirmar em demonstração].

## Declare as perguntas que ficaram abertas

1. **Onde pára a sessão antiga quando o token roda** — se o venue a derruba logo ou a deixa morrer: decide se a
   linha `token_rodou` precisa de um `em_duvida` intermédio.
2. **O que a conta responde a um pedido histórico durante o ritmo esgotado** — um erro nomeado ou um silêncio:
   decide se o limite de 5/s é uma transição ou um `[?]` na tabela.
3. **O `equity` derivado** (fórmula) — a conta não o publica; a forma entra na spec depois de medida em demo.
4. **A parcial por símbolo** e o que «a mercado» significa em cada modo de execução: o mesmo `[?]` que a
   `parcial_suportada` do manifesto.
5. **O mínimo nocional** — declarado em algum campo, ou é a recusa do venue que o ensina (caso de bateria).

---

## Nota datada — 05/10/2026: a T047 (os casos do contrato nos DOIS lados)

**O que foi fechado.** Os casos do contrato deste conector corriam só **offline** (`casos/correr.py`, 85) — pelo
lado da **MESA** (o dublê `contracts/mocks/mesa`, no papel `conector`) nunca tinham corrido. Passaram a correr nos
**dois lados**: a bancada `casos/correr-duble.py` monta o **desfecho** pelo módulo PURO deste conector
(`desfecho_do_evento`/`desfecho_do_silencio`, a partir de `desfecho.casos.json` — payload do venue EM DADO),
corre-o pelo **dublê da mesa** e pelo **motor do contrato** (`contracts/esqueleto/framing.py`, o lado do conector),
compara os veredictos **caso a caso** e registra as duas contagens **lado a lado**. **Divergência é falha
nomeada**: a linha diz qual caso, o que o dublê disse e o que o conector disse. A **negativa** (um veredicto do
conector estragado de propósito) corre dentro da bancada e exige o VERMELHO a nomear o caso; com a negativa
vacuosa, o `rc` vira **1**.

**Medido:** `cd brokers/ctrader && .venv/bin/python casos/correr-duble.py` → **lado DUBLE 19/19 · lado CONECTOR
19/19 · 0 divergentes** (11 payloads deste venue + 8 adversários). Entrou no `provar.sh`: a porta única passou a
**57 de 57, rc=0**. Sem credencial, sem rede, sem ordem ao venue — `contracts/` intocado (SC-015).

**O que NÃO cobre, e di-lo:** só o lado **`desfecho`** (o único tipo que o dublê confere no papel `conector`); o
caso da mensagem com o `tipo` errado fica fora (o dublê confere o **papel** e o motor confere o **envelope** —
medem coisas diferentes de propósito); e as **fixtures gravadas em demonstração** continuam na **T046** (dono).

## Nota datada — 05/10/2026: D6 — o PREENCHIMENTO que chega DEPOIS do ACEITE

**O defeito (D6), medido ao vivo na demonstração** (conta 45292558, EURUSD, registo `-r7`): o venue responde
`ORDER_ACCEPTED` — a ordem **existe**, mas **sem** `executedVolume`/`executionPrice`/`usedMargin` — e o
**preenchimento** chega **depois, por evento próprio**. O conector lia **só o primeiro evento**, montava uma
resolução de **3 de 5 campos**, o contrato recusava-a (`campo_obrigatorio_ausente`) e **nenhuma linha saía** — a
ordem que **preencheu** (posição 246825154) ficava sem desfecho. Foi este o buraco que deixou passar o D1: a prova
8 «falhava» (enviou e encheu, mas não publicou nada) e as provas 10 (fecho por `positionId`) e 12 (três
aberturas/fechos) ficavam **BLOQUEADAS** atrás dela.

**O que passa a estar dito.** O estado `enviada` do desfecho tem agora um passo a mais, e ele tem nome: **seguir o
evento que traz os números**. O `transporte.py` liga um tratador das execuções **cruas** do venue no **protocolo**
(`Protocol.on_event(ProtoOAExecutionEvent, …)` — o mesmo canal por onde o router da biblioteca as vê, e não o
`ExecutionEvent` **achatado**, que perde `order`/`position`/`deal`), guarda-as convertidas na forma do contrato, e
`esperar_o_preenchimento(marca, ordemId, prazo)` devolve o **evento decisivo** desta ordem (preenchimento/parcial/
recusa) **dentro do prazo declarado**. O `processo.py` só segue o preenchimento quando o evento **não traz os
números** e a classificação é `aceite`/`parcial` (o `ORDER_ACCEPTED`); com os números presentes ou com recusa,
publica como sempre. **Se o preenchimento não chegar no prazo, a classificação é a do SILÊNCIO** — `desconhecido`
(FR-067), com o instrumento marcado **PENDENTE** (FR-068) e a marca do aceite na pendência para a reconciliação a
achar (FR-069) — **nunca um sucesso inventado**: preço, volume executado, comissão e `positionId`/`dealId` saem
**do venue** (FR-064), e a resolução completa-se com eles.

**Provas (bancada offline, com duplo, nada vai ao venue):** `casos/prova-envio.py` (**32 · 32**) — o caso
`(D6) seguir o preenchimento` injecta a **SEQUÊNCIA EM DADO** (aceite parcial → preenchimento, este último entregue
pelo tratador de **eventos** do protocolo, o mesmo `on_event` do venue) e exige `aceite` com os números do venue e
a linha no **CONTRATO**; a **negativa** repõe o comportamento antigo (`_precisa_seguir_o_preenchimento` → `False`)
e exige o **VERMELHO** a nomear o caso — e ele cai em `nao_publicado`/`campo_obrigatorio_ausente`, que é a face do
defeito. Ao vivo, as provas **8, 10 e 12** da bateria deixam de «falhar»/ficar «bloqueadas» e passam a medir o que
prometem (novo registo em `conformidade/`, sem reescrever nenhum anterior — FR-073).

## Nota datada — 05/10/2026: D7 — o FECHO também precisa dos cinco campos

**O segundo bloqueio, medido na bancada a seguir ao D6.** O fecho **não** tem resolução pré-envio (`resolucao={}`)
e o `preco_de_liquidacao` não vinha do venue: com a alavancagem da bateria (**30**), a resolução do fecho saía com
**4 dos 5** campos, o contrato recusava-a (`campo_obrigatorio_ausente`) e **nenhuma linha saía** — a prova **10**
(fecho por `positionId`) continuava **bloqueada** mesmo depois de o D6 estar fechado. (A bancada antiga não o
apanhava porque o caso do fecho corria a **alavancagem 1**, em que o campo sai `"0"` sem projeção nenhuma — a
limitação escondia a consequência.)

**O conserto.** O `_resolucao_completa` do `processo.py` completa o `preco_de_liquidacao` pela **mesma regra [C]**
do pré-envio (`preco × (A−1) / A` ao `tick`), a partir do **preço de execução do VENUE** (que o evento do
preenchimento traz) e do `tick` do símbolo (`10^-digitos`) — a leitura do símbolo no fecho é **best-effort**: se
falhar, o fecho **segue** (a exposição tem de poder desmontar-se) e só o campo não se completa. Nenhum número é
inventado; sem preço do venue ou sem `tick`, o campo fica **ausente** e o contrato recusa, como antes.

**Provas:** `casos/prova-envio.py` (**32 · 32**) — `(D7) fecho a alavancagem 30 completa a resolução` exige
`aceite` com os cinco campos e o `preco_de_liquidacao` projectado; a **negativa** (a projeção desligada) exige o
**VERMELHO** a nomear o campo em falta.
