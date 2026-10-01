# brokers/ctrader

O SEGUNDO conector a serio: fala o contrato neutro da mesa de um lado, e a Open API do cTrader do outro.
Em **conta de demonstracao** ate o dono declarar a passagem a real. Recorte: `specs/005-conector-ctrader/`.

Porque e' que ele existe, para alem de ligar mais um venue: com dois venues que nao se parecem — perpetuais
descentralizados de um lado, CFDs com contas HEDGED/NETTED, OAuth com rotacao e fecho por posicao do outro — o
contrato neutro tem de aguentar **sem crescer**. Isso e' requisito verificado (FR-046, SC-015), e mede-se com
`git status contracts/`.

O que ele entrega, e onde:

| Peca | Ficheiro | O que faz |
|---|---|---|
| A costura | `processo.py` | le' o `stdin` linha a linha, valida pelo contrato e responde; e' o que o operador arranca |
| O transporte | `transporte.py` | a biblioteca `ctrader-api-client` EMBRULHADA (sessao, protobuf, OAuth, reconexao) — nenhum tipo dela atravessa a fronteira |
| A ficha e as portas | `ficha.py` | le' `*.conector.json`, e as portas do arranque com motivo nomeado |
| A credencial | `credencial.py` | resolve a REFERENCIA (`env:` ou `ficheiro:`, modo 600) e RECUSA se o valor estiver versionado |
| A identidade | `identidade.py` | o `ctidTraderAccountId` do venue contra o do ficheiro da conta, e os direitos (`accessRights`) |
| A sonda e o manifesto | `sonda.py` | le' do venue, a cada arranque, o que ele oferece — sem nenhum desses valores constante no codigo |
| A traducao | `ordens.py` | boleta neutra -> `volume` em 0,01 e distancias relativas em 1/100000, com recusa nomeada para tudo o que nao cabe |
| O desfecho | `desfecho.py` | normaliza nas quatro classificacoes; reconcilia o desconhecido |
| O fecho | `fecho.py` | fecha POR POSICAO (`positionId`) — e fecha sem abrir |
| As leituras | `leitura.py` | conta (com o expoente), posicoes, ordens vivas, mercado |
| Os casos | `casos/*.casos.json` | em dado, e correm nos DOIS lados: aqui e no duble do conector do recorte 001 — divergencia e' falha |
| A conformidade | `conformidade/<versao>.txt` | o resultado da bateria de DOZE provas, por versao |

Regras que este conector cumpre (e que se verificam por comando):

- importa `contracts`, **NUNCA** o `core` (RN-E1);
- nao decide nada: nao escolhe lado, tamanho, preco nem momento (RN-C5, RN-C15);
- nada se ajusta em silencio: o que nao cabe e' **recusado com motivo** (RN-C3);
- a credencial entra por **referencia** e o valor vive **fora** do repositorio (RN-C20, RN-E14) — aqui sao QUATRO
  valores (client_id, client_secret, access_token, refresh_token), **um ficheiro `.key` por valor** e em modo
  600, porque o venue **reescreve dois deles** quando roda o par de tokens (com tudo num ficheiro so', a rotacao
  mexia no segredo da aplicacao). O `ctid_trader_account_id` nao e' segredo: e' a identidade da conta, declarada
  na ficha, e e' contra ela que o conector compara o que o venue devolve.

## O que este venue obrigou a decidir (e que fica declarado)

1. **O `equity` e' DERIVADO.** A conta nao publica o total; publica as parcelas (`balance` e o nao realizado por
   posicao, `ProtoOAGetPositionUnrealizedPnLRes`). A leitura publica a SOMA e di-lo: nenhuma taxa nossa entra,
   mas a soma e' nossa — e um numero derivado nunca se apresenta como numero do venue.
2. **A ligacao tem DUAS camadas** (transporte vivo != sessao da conta autorizada). Nao ha campo para as duas no
   contrato, e nao precisa de haver: **enviar exige as duas prontas**, e o porque vai no motivo da recusa.
3. **A conta do ensaio e' NETTED.** O contrato ja' declara `modelo_de_posicao: hedging`, mas a leitura so' sabe
   ler UMA posicao por instrumento. Numa conta HEDGED com duas, este conector **RECUSA** a leitura com motivo
   nomeado (`duas_posicoes_no_mesmo_instrumento`) em vez de escolher uma. Alargar o contrato (`posicao` -> lista)
   esta' NOMEADO e ADIADO para outro recorte.
4. **Os dois modos de «fechar sim, abrir nao»** (`accessRights = CLOSE_ONLY` na conta, `tradingMode =
   CLOSE_ONLY_MODE` no simbolo) sao LIDOS, nunca adivinhados.
5. **A rotacao do token DERRUBA a sessao** (`ProtoOAAccountsTokenInvalidatedEvent`, razao `token was refreshed`):
   e' acontecimento da maquina de estados, nao detalhe do cliente HTTP.

O que este diretorio **nao** contem, de proposito: nenhuma versao de venue escrita em codigo (tudo se sonda),
nenhum numero de risco, nenhuma credencial — nem um valor de exemplo.
