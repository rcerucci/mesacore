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
| ordem `desconhecida` | leitura da conta (`ProtoOAReconcileReq`) | `em_dia` | reconciliar pelos **negócios** (`ProtoOADeal` por `positionId`/`orderId` e pelo `clientOrderId`) → desfecho **verdadeiro** |
| ordem `desconhecida` | pedido novo no mesmo instrumento | `desconhecida` | **recusar** (`desconhecido_por_reconciliar`); **fechar/reduzir continua permitido** |
| ordem `nenhuma` | eco do **mesmo `clientOrderId`** | `nenhuma` | não duplicar; devolver o desfecho da **mesma** ordem (por consulta ao venue, nunca por memória) |
| qualquer | pedido que nomeia outra conta | (igual) | recusar (`pedido_de_outra_conta`) |
| fecho `nenhuma` | pedido de fecho (`caixa`) | `a_enviar` | `ProtoOANewOrderReq` com **`positionId`** e lado contrário — o venue fecha; **não é `reduce_only`** porque este venue não o tem (RN-CT34) |
| fecho `nenhuma` | fecho sem posição | `nenhuma` | `nada` + motivo (`sem_posicao_para_fechar`), nunca uma ordem nova |
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

## Declare as perguntas que ficaram abertas

1. **Onde pára a sessão antiga quando o token roda** — se o venue a derruba logo ou a deixa morrer: decide se a
   linha `token_rodou` precisa de um `em_duvida` intermédio.
2. **O que a conta responde a um pedido histórico durante o ritmo esgotado** — um erro nomeado ou um silêncio:
   decide se o limite de 5/s é uma transição ou um `[?]` na tabela.
3. **O `equity` derivado** (fórmula) — a conta não o publica; a forma entra na spec depois de medida em demo.
4. **A parcial por símbolo** e o que «a mercado» significa em cada modo de execução: o mesmo `[?]` que a
   `parcial_suportada` do manifesto.
5. **O mínimo nocional** — declarado em algum campo, ou é a recusa do venue que o ensina (caso de bateria).
