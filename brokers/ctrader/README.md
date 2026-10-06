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
| O limitador de ritmo | `transporte.py` (`_vez_geral`/`_vez_historica`) | **50/s** nos pedidos gerais e **5/s** nos historicos (RN-CT2), por espacamento minimo; a espera e' ESTADO DECLARADO (`estado_de_ritmo`), nunca «sem dados» (FR-071) |
| O eixo da sessao | `transporte.py` (`estado_da_sessao`/`seguir_a_sessao_da_conta`) | escuta os eventos do venue (`TokenInvalidatedEvent`, `AccountDisconnectEvent`, `ClientDisconnectEvent`, `ReadyEvent`) e guarda `nao_autorizada`·`autorizada`·`invalidada` (FR-070); **enviar exige as DUAS camadas** (`conferir_as_duas_camadas`, FR-048) |
| A ficha e as portas | `ficha.py` | le' `*.conector.json`, e as portas do arranque com motivo nomeado |
| A credencial | `credencial.py` | resolve a REFERENCIA (`env:` ou `ficheiro:`, modo 600) e RECUSA se o valor estiver versionado |
| A identidade | `identidade.py` | o `ctidTraderAccountId` do venue contra o do ficheiro da conta, e os direitos (`accessRights`) |
| A sonda e o manifesto | `sonda.py` | le' do venue, a cada arranque, o que ele oferece — sem nenhum desses valores constante no codigo |
| A traducao | `ordens.py` | boleta neutra -> `volume` em 0,01 e distancias relativas em 1/100000, com recusa nomeada para tudo o que nao cabe |
| O desfecho | `desfecho.py` | normaliza nas quatro classificacoes (CLASSIFICA — nao reconcilia: quem rele' o venue e' o `processo.py`) |
| O fecho | `fecho.py` | fecha POR POSICAO (`positionId`) — e fecha sem abrir |
| As leituras | `leitura.py` | conta (com o expoente), posicoes, ordens vivas, REGISTO de ordens (`ordens_do_registo`) |
| A leitura do mercado | `leitura.py` | o ULTIMO retrato por simbolo: cotacao com `bid`/`ask` OPCIONAIS (o lado que o venue nao manda fica AUSENTE, nunca zero — RN-CT29), livro por DELTAS (`newQuotes`/`deletedQuotes`), e a idade do dado do INSTANTE do venue; sem retrato, a regua DECLARADA (a ultima vela) |
| Os casos | `casos/*.casos.json` | em dado, e correm no runner offline do conector (`casos/correr.py`); o que o contrato recebe e' conferido caso a caso |
| A conformidade | `conformidade/<versao>.txt` | o resultado da bateria de DOZE provas, por versao |

> **O que esta' MEDIDO hoje (05/10/2026 — cada numero com o comando que o mediu).** A porta unica da casa,
> `bash tools/verificar-maquina/provar.sh`, da' **57 de 57 passaram, rc=0** — e dentro dela correm as **cinco**
> bancadas deste conector: `casos/correr.py` (**105 casos · 105 ok**), `casos/prova-envio.py` (**32 provas · 32 ok**),
> `casos/prova-ritmo.py` (**6 · 6**), `casos/prova-leitura.py` (**7 · 7**) e `casos/correr-duble.py`
> (**19 casos · duble 19/19 · conector 19/19** — os casos do contrato nos **dois lados**, T047). O contrato **nao
> cresceu**: `git status --short contracts/` da' **vazio** (SC-015). *(Este ficheiro nao trazia contador nenhum
> antes; este entra agora, medido — um numero escrito a mao envelhece, e o comando ao lado e' o que o mantem
> honesto.)* A bateria das **doze provas** ja' correu ao vivo contra a demonstracao (T049/T050, registos
> `conformidade/1.12.0-2026-10-05*.txt`), e a **tabela comparativa** com a bateria do irmao esta' na seccao
> «SC-014, lado a lado» abaixo (T052). Fica **por medir**, e e' do **dono**: as fixtures reais do venue (T046), o
> arranque do conector pelo operador (A-4 — nada o arranca hoje) e a **decisao do SC-014** (a paridade que o
> criterio exige **nao** se cumpre hoje — ver a seccao, com o custo de cada caminho).

## SC-014, lado a lado — as duas baterias comparadas (T052, medido a 05/10/2026)

O SC-014 (`specs/005-conector-ctrader/spec.md`) exige «os **dois** conectores passam a **mesma** bateria de
conformidade no ambiente de teste do seu venue — **doze provas** cada». Abaixo esta' o confronto dos **dois
registos** que existem hoje, numero a numero, cada um com a linha de onde saiu. **A conclusao e' que a exigencia,
hoje, NAO se cumpre** — e a diferenca diz-se por inteiro.

### Cabecalho — de onde saem os numeros

| | ctrader | hyperliquid |
|---|---|---|
| Registo | `brokers/ctrader/conformidade/1.12.0-2026-10-05-r10.txt` (o `-r9` da' o mesmo resumo) | `brokers/hyperliquid/conformidade/1.4.0.txt` |
| Versao do conector | **1.12.0** (a do manifesto) — r10:3 | **0.1.0** (a do plugin) — h:3 |
| Versao do CONTRATO | **1.12.0** — r10:4 | **1.4.0** — h:4 |
| Data da corrida | **2026-10-05T20:21:54.736176+00:00** — r10:5 | **2026-09-29T15:46:28-03:00** — h:5 |
| Comando | `cd brokers/ctrader && .venv/bin/python conformidade/bateria.py --ficha …/ficha-demo-real.conector.json` — r10:6 | `bun tools/verificar-conector/conformidade.ts` — h:6 |
| Como corre | **AO VIVO** — contra a conta de demonstracao `45292558` (EURUSD) — r10:11 | **OFFLINE** — «offline, com duble de mesa», `casos-duble.json` — h:12 |
| O que prova | o conector **contra o venue** (rede + chave + conta autorizada) | a **forma** do conector contra o **duble**, sem rede nem chave |
| Numero de provas | **12** — r10:140 | **9** (mais a linha do venue, `INCOMPLETO`) — h:16-41 / h:55 |
| Veredictos | **10 `passou` · 2 `nao_forcavel`** — r10:140 | **9 de 9 passaram · 238 verificacoes · 0 divergentes** (`rc=0`) — h:57-58 |
| Linha do venue (SC-004) | — (a bateria ja' E' ao vivo) | `INCOMPLETO` — «nao corre offline; esta bateria nao tem rede nem chave» — h:55 |

*(legenda das linhas: `r10` = `1.12.0-2026-10-05-r10.txt`, `h` = `1.4.0.txt`. O registo `r10`, no seu proprio
fecho, apanhou a porta da casa ocupada — `provar.sh: rc=1 · RECUSADO — outra bateria esta a correr` (r10:136);
o `-r9`, a corrida anterior deste mesmo dia, fechou com `rc=0 · 57 de 57 passaram` (r9:136) — os dois deram o
mesmo resumo, `12 provas · 2 nao_forcavel, 10 passou`.)*

### ctrader — as doze provas (AO VIVO, contra a demonstracao)

| # | O que mede | Veredicto | Linha |
|---|---|---|---|
| 1 | arranque: os oito portoes + identidade + direitos + as duas camadas | `passou` | r10:14,25 |
| 2 | identidade recusada: `ctidTraderAccountId` que nao e' o do ficheiro | `passou` | r10:27,32 |
| 3 | sonda e manifesto: instrumentos e os numeros do venue | `passou` | r10:34,41 |
| 4 | duas camadas com a sessao derrubada -> zero envios | **`nao_forcavel`** | r10:43,53 |
| 5 | re-autenticacao: a conta LIDA antes de aceitar pedido novo | **`nao_forcavel`** | r10:55,65 |
| 6 | boleta ao PADRAO DO DONO (`saldo_pct 10`, `alavancagem 1`) -> volume ao degrau com o ajuste DECLARADO (**reescrita a 06/10/2026**; era «boleta fora do passo -> recusa nomeada, zero ordens») | `passou` | r10:67,73 |
| 7 | stop fora da grelha relativa do venue -> recusa nomeada, zero ordens | `passou` | r10:75,81 |
| 8 | ordem a mercado no minimo -> resolucao + desfecho com os numeros do VENUE | `passou` | r10:83,92 |
| 9 | marca reenviada -> a dedup trava a segunda, UMA posicao | `passou` | r10:94,103 |
| 10 | fecho por `positionId` — o negocio de fecho com o detalhe | `passou` | r10:105,111 |
| 11 | fechar o que nao existe -> `nada` com motivo, zero ordens | `passou` | r10:113,120 |
| 12 | tres aberturas e fechos -> zero posicoes no fim | `passou` | r10:122,129 |

As duas `nao_forcavel` (4 e 5) o proprio registo explica porque: nao se revoga um token nem se mata a sessao a'
forca ao vivo — medem-se OFFLINE, ao EVENTO do venue, na bancada `casos/prova-envio.py` US6 (r10:44-65).

### hyperliquid — as nove provas (OFFLINE, com duble de mesa)

| # | O que mede | Veredicto | Linha |
|---|---|---|---|
| 1 | a forma: toda mensagem do conector contra o envelope e o esquema do seu tipo | `passou` | h:16 |
| 2 | as SETE portas do arranque: a ordem, a primeira que falha, o motivo | `passou` | h:19 |
| 3 | as duas versoes: `versao`=CONTRATO e `conector.versao`=PLUGIN | `passou` | h:22 |
| 4 | o vocabulario fechado: quatro veredictos, motivos lidos da FONTE | `passou` | h:25 |
| 5 | o manifesto e' FUNCAO PURA da sonda; capacidade ausente RECUSA | `passou` | h:28 |
| 6 | a mesa NAO SAI quando a costura fecha (FR-006): conta-se o ledger | `passou` | h:31 |
| 7 | a volta que ESPERA nao e' acontecimento; a recusa de comando transita X->X | `passou` | h:35 |
| 8 | nenhum valor de credencial no repositorio (RN-E14), com os dois controlos | `passou` | h:38 |
| 9 | instrumento que nao existe no manifesto: recusa NOMEADA, dos dois lados | `passou` | h:41 |

A outra linha do registo **nao** e' uma prova: e' a linha do VENUE (as oito provas de SC-004), `INCOMPLETO` —
«nao corre offline; esta bateria nao tem rede nem chave, e esse aceite e' outra bateria (RN-C6, FR-025)» (h:55).

### O que isto quer dizer para o SC-014

O SC-014 pede a **mesma** bateria, com **doze** provas, no **ambiente de teste do venue**. Hoje:

- **Nao e' a mesma bateria.** A do ctrader e' **ao vivo** (fala com a demonstracao pelo fio, conta `45292558`
  autorizada); a do hyperliquid e' **offline** e mede a **forma** contra o **duble de mesa**, sem rede nem chave.
  As provas nem se chamam o mesmo: de um lado «boleta fora do passo», «fecho por `positionId`»; do outro «a
  forma», «as sete portas», «as duas versoes».
- **Nao e' o mesmo numero de provas.** 12 contra 9.
- **Nao e' a mesma versao de contrato.** O registo do hyperliquid e' do contrato **1.4.0** (plugin 0.1.0), escrito
  a 29/09/2026; o do ctrader e' do contrato **1.12.0**, escrito a 05/10/2026. Sao medicoes de **epocas diferentes**
  do contrato, e nao um par da mesma corrida.
- **A linha do venue so' existe de um lado.** No hyperliquid, a prova contra o venue fica `INCOMPLETO` por
  declaracao da propria bateria; no ctrader, o venue e' o que a corrida toda mede.

Ou seja: o **SC-014 escrito ao contrario** — a exigencia de paridade descreve um estado que os dois registos
**nao** mostram. O que mostram e' um conector com prova **ao vivo** e outro com prova **estrutural**.

### A decisao — e' do dono (com o custo de cada lado)

Nao se decide aqui.

**(a) Levar a bateria ao vivo ao hyperliquid.** Construir no irmao uma bateria ao vivo, espelhando as doze do
ctrader, contra a conta de teste do venue.
- *Custo:* exige chave e rede, e **ASSINAR e ENVIAR** ordens a' conta de teste — precisamente o que o registo do
  hyperliquid declara nao ter hoje (h:55). E' trabalho de sessao propria (bateria nova, nao edicao) e exige a
  autorizacao do dono para as corridas contra venue (o mesmo genero de autorizacao que a T049/T050 tiveram do lado
  do ctrader).
- *Ganha:* a paridade literal do SC-014 — as duas baterias passam a medir o mesmo (o conector contra o venue).

**(b) Mudar a redacao do SC-014 para o que as duas provas de facto sao.** Reescrever o criterio para dizer que
cada conector tem a SUA bateria — uma ao vivo contra o venue, outra estrutural/offline — e que a «mesma bateria»
e' o **vocabulario de provas da casa**, nao o mesmo ficheiro nem a mesma contagem.
- *Custo:* e' mexer num criterio de aceite (`specs/005-conector-ctrader/spec.md`), e a disciplina da casa manda
  que uma mudanca de criterio nasca de **medicao** — o que aqui esta' medido e' justamente que a paridade nao
  existe.
- *Ganha:* o criterio passa a descrever o que os dois registos ja' provam; nao obriga a correr nada novo contra
  venue nenhum.

**(c) Outra.** Duas variantes ficam **nomeadas**, sem serem decididas — como (a) e (b), a escolha e' do dono:
(c1) exigir dos **dois** a bateria **offline/estrutural** (que ambos podem correr hoje sem chave nem rede) e manter
a linha do venue como `INCOMPLETO` declarado em cada um — e' o que o hyperliquid ja' faz; (c2) aceitar **duas
contagens**, uma por conector, com a paridade reduzida a «cada conector tem a sua bateria documentada por versao».

### O que fica POR MEDIR (e quem fecha)

| Por medir | Quem fecha |
|---|---|
| A decisao (a)/(b)/(c) do SC-014 acima | **o dono** |
| As fixtures reais do venue (payloads gravados em demonstracao) — **T046** | **o dono** (conta autorizada) |
| O arranque do conector pelo operador — **A-4** (nada o arranca hoje) | **o dono / o outro recorte** |
| Se a decisao for (a): a corrida da bateria do hyperliquid contra o venue do irmao | **o dono** (autoriza a corrida) |

Regras que este conector cumpre (e que se verificam por comando):

- importa `contracts`, **NUNCA** o `core` (RN-E1);
- nao decide nada: nao escolhe lado, tamanho, preco nem momento (RN-C5, RN-C15);
- nada se ajusta em silencio: o que nao cabe e' **recusado com motivo** (RN-C3);
  - **NOTA 06/10/2026** — decisao do dono, textual: «a ficha do eurusd pode ser igual ao btc, **10% notional e 1x
    alavacagema** … **padrao independente do venue, riscos igual ao hl**». O `volume` que **nao cai no passo** do
    venue agora **desce ao maior degrau ≤ pedido** (nunca sobe: o risco nunca excede o declarado) e o ajuste **sai
    DECLARADO** na linha (`conversao`: volume pedido, efectivo, regra `volume_ajustado_ao_passo`, nocionais) —
    **nao e' um ajuste silencioso**. A recusa continua, pelo nome que ja' existia
    (`minimo_do_instrumento_acima_da_banda`), so' para o pedido **abaixo do minimo** do instrumento (nao ha' degrau
    admissivel abaixo). Era isto que impedia a σ de operar EURUSD neste venue. FR-055/FR-056, com a nota datada;
- a credencial entra por **referencia** e o valor vive **fora** do repositorio (RN-C20, RN-E14) — aqui sao QUATRO
  valores (client_id, client_secret, access_token, refresh_token), **um ficheiro `.key` por valor** e em modo
  600, porque o venue **reescreve dois deles** quando roda o par de tokens (com tudo num ficheiro so', a rotacao
  mexia no segredo da aplicacao). O `ctid_trader_account_id` nao e' segredo: e' a identidade da conta, declarada
  na ficha, e e' contra ela que o conector compara o que o venue devolve.

> **NOTA DATADA — 05/10/2026: um QUINTO `.key` passa a existir, e NAO e' segredo.** Alem dos quatro valores que o
> dono poe a mao, o conector passou a gravar o **prazo** que o venue declara na rotacao (`expires_at`), em
> `~/.config/mesacore/credenciais/ctrader_mesa_expira_em.key` (modo 600), **derivado do caminho do access token**
> — a ficha **nao** o declara, e `ficha.py` nao se toca. E **ESTADO**, nao segredo: sem ele o conector rodava o
> par em CADA arranque (A-9, medido a 05/10/2026 nos mtimes dos dois tokens), e essa rotacao matava o token que a
> porta da identidade ia usar (A-8) — a porta `identidade` nunca passava. Com o prazo gravado, um arranque com
> prazo valido **nao** refresca; um token ausente ou mesmo expirado continua a refrescar (o comportamento
> automatico preserva-se). A regra «quatro valores» acima continua a valer para o que o DONO escreve: o quinto
> nasce sozinho, do lado do conector.

## De quem e' a credencial (e porque o nome e' da APLICACAO, nao da conta)

**Onde os valores vivem, e como se poem la', esta' em `config/README.md`** (seccao «O cTrader: quatro ficheiros,
o MESMO sítio») — o sítio e' o mesmo de sempre (`~/.config/mesacore/credenciais/`) e o que muda e' o nome. Nao se
duplica aqui: uma casa para a regra.

Os tokens deste venue sao do **utilizador (cTID)**, e nao da conta: depois do `ApplicationAuth` (client_id +
client_secret), a lista de contas **vem do token** (`ProtoOAGetAccountListByAccessTokenReq`), e a conta escolhe-se
pelo `ctidTraderAccountId`. Consequencia pratica, e e' a razao dos nomes `ctrader_mesa_*`: **um conjunto de
credenciais serve contas de demonstracao e contas reais**, e trocar de conta e' trocar o
`ctid_trader_account_id` da ficha — coisa que nao se faz por um ficheiro de token, faz-se por um numero declarado.
(Na Hyperliquid e' ao contrario: a chave e' de UMA conta, e por isso o ficheiro la' tem o nome da conta.)

O padrao de armazenamento e' o da casa, e foi medido no conector 1 antes de ser copiado: um `.key` por valor,
**texto simples**, modo 600, fora do repositorio, lido **cru** pelo carregador — o ficheiro da Hyperliquid tem
`0x` + 64 hexadecimais, uma linha, e nao tem cifra nenhuma (nem cabecalho, nem base64). Nao ha encriptacao nesta
casa **hoje**, e nao se acrescenta por conta propria: cifrar aqui so' mudaria a chave de sitio, e a chave dessa
cifra teria de viver na mesma maquina. O que protege e' o modo, o sitio, e as recusas do carregador (modo
diferente de 600, valor ausente, ou valor que apareca num ficheiro versionado). A decisao do cifrado, se vier, e'
do dono e declarada na passagem a producao — como `config/README.md` ja' diz.

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
