# Avaliação — biblioteca `ctrader-api-client`, para o conector cTrader do MesaCore

*(30/09/2026 · sessão `20260930_183913_07925d`, profile `appbuilder`)*

Pedido do dono: «precisamos criar um conector do cTrader; analisa este projeto e verifica se serve algo para o
nosso novo plugin». Este documento é o parecer. **Camadas de evidência**, como manda a casa: **[E]** verificado por
execução · **[C]** lido no código · **[D]** afirmado pela documentação — e o que **não** foi verificado fica dito no
fim.

## Veredicto numa frase

**Serve — como CAMADA DE PROTOCOLO de um conector cTrader escrito em Python; não serve como o conector.** Poupa
todo o trabalho de transporte e de sessão (protobuf sobre TCP/TLS, heartbeat, reconexão com restauro de
subscrições, OAuth com refresh de tokens) e poupa a sondagem de símbolos; tudo o que é a nossa fronteira — a
costura de processo, os oito portões do arranque, o manifesto, as duas metades da boleta, a resolução, a marca de
posse, o desfecho classificado e a recusa no vocabulário do contrato — continua a ser nosso. E é essa a parte que
interessa.

## O que ele dá, medido

| Capacidade | O que a biblioteca expõe | Evidência |
|---|---|---|
| Transporte | protobuf sobre TCP/TLS, `demo.ctraderapi.com` / `live.ctraderapi.com`, porta 5035, heartbeat e prazos declarados | [C] `config.py` |
| Reconexão | reconecta com backoff, re-autentica a app e as contas, **re-aplica as subscrições**, emite `ReadyEvent`/`ReconnectedEvent`; trata também a conta derrubada pelo broker com a ligação de pé | [D] README |
| OAuth | `client_id`/`client_secret` + por conta `access_token`, `refresh_token`, `expires_at`; **refresca antes de expirar** e expõe `TokenRefreshFailedEvent`; token já expirado é refrescado antes de autenticar | [D] README · [E] `TokenStore` importa |
| Tokens rotativos | cada refresh emite par **novo** e invalida o antigo; hook `TokenStore.save` grava-o no momento da emissão (a escrita precede o uso) | [D] README |
| Conta | `accounts.resolve_account_id(token, trader_login)` → `ctidTraderAccountId`; `get_trader`, `list_by_token` | [C] `api/accounts.py` |
| **Sonda** | `symbols.list_all` · `get_by_ids` · `get_by_id` · `search`; o símbolo traz `digits`, `pip_position`, `lot_size`, `min_volume`, `max_volume`, `step_volume`, `trading_mode`, `swap_long/short`, `commission`, `max_exposure`, `leverage_id`, `sl_distance`, `tp_distance` | [C] `api/symbols.py`, `models/symbol.py` |
| Velas | `market_data.subscribe_trendbars` · `get_trendbars(period, from, to)` · `get_tick_data` | [C] `api/market_data.py` |
| Livro | `subscribe_depth` / `unsubscribe_depth` (L2) | [C] `api/market_data.py` |
| **Ordens** | `NewOrderRequest` traz `symbol_id`, `side`, `volume` (em **0,01**), `order_type`, `limit_price`, `stop_price`, `stop_loss`, `take_profit`, **`client_order_id`**, `label`, `comment`, `time_in_force`, `expiration_timestamp`, `position_id`, `base_slippage_price`, **`slippage_in_points`**, **`relative_stop_loss`**, **`relative_take_profit`**, `trailing_stop_loss`, `guaranteed_stop_loss`, `stop_trigger_method` | [E] campos da **versão instalada** (0.11.0) |
| Gestão | `get_open_positions`, `get_orders`, `get_pending_orders`, `amend_order`, `cancel_order`, `amend_position`, `get_deals`, `get_deals_by_position_id`, `get_unrealized_pnl_per_position` | [C] `api/trading.py` |
| **Fecho** | `close_position(position_id, volume)` — fecho **por posição**, não por lado oposto | [E] campos da versão instalada |
| Desfecho | `ExecutionEvent` (por conta) com ordem/negócio/posição | [D] README · [C] `models/deal.py` |

**Três coisas que isto resolve e que são caras de escrever à mão:** (1) o **`client_order_id`** existe na ordem —
é a marca de posse do cTrader, como a casa já tinha na tabela de primitivas; (2) o **`slippage_in_points` +
`base_slippage_price`** é o nosso `desvio_maximo` tal e qual; (3) **`relative_stop_loss`/`relative_take_profit`**
são o `stop_pct`/`tp_pct` da nossa boleta **na unidade deles** (distância), sem conversão para preço absoluto.

## O que não dá — e é nosso (a lista do trabalho real)

| Falta | Por que é nosso |
|---|---|
| A **costura** (processo + uma mensagem JSON por linha, versão conferida por igualdade exacta) | é a fronteira do contrato; a biblioteca é código, não uma ponta |
| Os **oito portões do arranque** (ficha, versão, uma conta, ambiente e rede, chave, ligação, sonda e manifesto, identidade) | política da casa, não do venue |
| O **manifesto** de capacidades (o que o venue declara e o que ele **não** tem) | decisão nossa; a matriz por venue já existe na skill |
| As **duas metades da boleta** | o core manda percentagem do saldo e alavancagem; a biblioteca quer `volume` em 0,01 de unidade — a conversão (com `lot_size`/`min`/`max`/`step` do símbolo) e a conferência da banda são do conector |
| A **resolução** (nocional, margem, alavancagem efectiva, distância de liquidação) | número do venue, montado por nós; sem ele o dono autoriza risco sem ver o número |
| A **marca de posse** como política (forma curta e numérica, mapa marca → ficha, e o que fazer quando não há marca) | a forma mais restrita manda; aqui o `client_order_id` tem 50 caracteres e a posição liga-se pelo `positionId` |
| O **desfecho classificado** e a **reconexão retomando o que o venue reporta** | a biblioteca reconecta; classificar o desfecho é nosso |
| A **recusa com o vocabulário do contrato** | o plugin recusa com os nomes do contrato, lidos do ficheiro do contrato |

## Riscos e lacunas medidas

- **Maturidade.** `MIT` **[E]** (medido pela API do GitHub, não pelo README), 2 estrelas, 0 forks, **0 issues
  abertas**, autor único, criado 2026-04-05, último push 2026-09-27, versão **0.11.0** (o próprio README diz
  «early development»). Consequência: **nenhuma revisão por terceiros** — fixar a versão (a que instalei, 0.11.0) e
  **nunca** seguir o `master`.
- **`equity` não está no modelo `Account`** desta versão (tem `balance`, `leverage_in_cents`, `account_type`,
  `trader_login`). A nossa leitura precisa de `equity`: verificar no proto cru ou compor com
  `get_unrealized_pnl_per_position` — e, se compusermos, dizer que é conta nossa.
- **O símbolo vem partido em dois modelos** nesta versão: `Symbol` tem os números (`digits`, `lot_size`,
  `min/step_volume`, …) e o `name` vive no modelo leve que o `list_all` devolve. A sonda tem de juntar as duas
  chamadas.
- **SDK de Python não tem WebSocket** [F] (irrelevante: usamos TCP/TLS, como a doc do venue permite).
- **O `ctrader-oauth-fetcher`** (o utilitário que faz o fluxo OAuth no browser) é MIT **[E]**, mas está parado
  desde 2026-04-10 — é ferramenta de uma vez, não dependência; se falhar, escrever o fluxo são poucas linhas.

## O que isto muda no plano

1. **O conector cTrader nasce em Python, e isso está previsto:** a costura é mensagem (língua do conector é
   escolha dele), a doc do venue declara a Open API **agnóstica de linguagem** com SDK oficial em Python, e o
   contrato **já tem ligação Python** (`contracts/gerado/py` + `tools/verificar-contrato/py`). O host tem
   Python 3.14.7 e `uv` **[E]** — o requisito do pacote é 3.12+.
2. **A biblioteca entra como dependência fixada** (MIT permite), e o que o MesaCore escreve por cima é
   exactamente o que ele já sabe fazer: os dois documentos do recorte (**regra de negócio do cTrader** +
   **máquina de estados do conector**), a boleta, a resolução, o desfecho e a bateria de conformidade por venue.
3. **O que é do dono, e não é código:** registar a aplicação na cTrader Open API (`client_id`/`client_secret`),
   decidir **demo** primeiro (a bateria de conformidade corre inteira em demo), e autorizar o fluxo OAuth uma vez.
   Os tokens rotativos vivem **fora do repo** e são reescritos pelo próprio conector — a ficha continua a dizer
   **referência**, nunca valor.

## O que NÃO foi verificado (e não é pouco)

- **Nada foi corrido contra o venue.** Sem tokens não há sonda nem bateria: nenhuma subscrição, nenhuma ordem,
  nenhum símbolo real lido. O que está medido é a **forma** (código instalado 0.11.0, importado, campos dos
  modelos) e o que a documentação afirma.
- **Os números do venue** (mínimo/passo por símbolo, modos de preenchimento, `sl_distance`/`tp_distance`, modo de
  execução, modelo de posição por conta, `equity`) só a **sonda** e a **bateria** os dão — e é isso que o recorte
  do conector tem de produzir.
