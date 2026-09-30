COBERTURA DO VOCABULARIO — o que um plugin de SETUP pode usar, e o que o venue faz com cada valor
contrato 1.7.0 · medido 29/09/2026 na conta de TESTE · 21 provas (19 passaram, 2 reprovaram)

PORQUE ESTE DOCUMENTO EXISTE
----------------------------
Cliente (o dono): «precisa testar alavancagem, limite do saldo, virada de mao, etc., ou seja todos os requisitos
que o venue tem de atender conforme contrato... se nao validarmos todo o vocabulario que um plugin de setup pode
usar nao esta' completo.»

A pergunta nao e' "as ordens passam?" — e' **cada valor do vocabulario tem desfecho NOMEADO?** Um valor que
"passa" e nao muda nada no que sai para o venue e' o pior dos tres desfechos possiveis (aceite com efeito,
recusa nomeada, ou SILENCIO). Foi assim que apareceram o stop (D-011) e o `cancelar`.

O VOCABULARIO, MEDIDO NA FONTE (`contracts/vocabulario.json` + `vocabulario.json`->esquemas)
--------------------------------------------------------------------------------------------
- `lados` (da PROPOSTA do setup): **buy · sell · hold · caixa** — quatro, e nada mais.
- `tipos_de_ordem` (da BOLETA): **mercado · limite · stop · stop_limite · mercado_por_faixa**.
- `politicas_de_parcial`: **tudo_ou_nada · o_que_der**.
- `destinos_do_resto`: **agressivo · cancelar**.
- campos da boleta: `saldo_pct`, `alavancagem`, `desvio_maximo`, `prazo_da_passiva_ms`, `reduce_only`,
  `referencia_do_cliente`, `marca_de_posse` (obrigatorios) + `stop_pct`, `tp_pct` (opcionais).
- **NAO EXISTE "virada de mao"** no vocabulario — confirmado na fonte. Os dois verbos de posicao sao `buy`/`sell`
  (abrir) e `caixa` (fechar). Ver a linha `caixa` na tabela abaixo.

A TABELA — cada valor, com o veredicto MEDIDO
---------------------------------------------
| Valor | O que o venue tem de fazer | Medido | Prova |
|---|---|---|---|
| `lado: buy` | abrir comprado | **aceite** — ordem preenchida | P3 |
| `lado: sell` | abrir vendido | **aceite** — posicao com `szi` NEGATIVO (`-0.00023`) | **P13** |
| `lado: hold` | (e' da proposta: o ciclo decide `nada`) | nao chega a boleta; o conector **recusa** se chegar (`valor_fora_do_conjunto`) | P12 |
| `lado: caixa` | fechar em reduce_only | **aceite** — fecha e a conta fica plana; `caixa` e' o verbo de fechar, e o conector recusa recebe-lo numa boleta (o lado da boleta e' composto pelo ciclo) | P7/P12 |
| **virada de mao** | (nao existe no vocabulario) | **dois passos**: `caixa` fecha, o lado inverso abre — medido: `buy -> sell/ro -> sell -> buy/ro`, e o `szi` passa de `+0.00023` a `-0.00023` | **P14** |
| `tipo: mercado` | ordem a mercado (tif `Ioc`) | **aceite** — preenchida; o resto e' cancelado pelo `Ioc` | P3 |
| `tipo: limite` | ordem post-only que descansa (tif `Alo`) | **recusa nomeada** `valor_fora_da_banda`: no `limite` o preco que sai e' a MARCA crua, e a marca do BTC tem 6 algarismos significativos contra os 5 que o venue aceita | P12 (D-012) |
| `tipo: stop` | ordem trigger | **recusa nomeada** `capacidade_nao_declarada` — o venue nao declara `stop` entre os tipos (a sonda le as ordens que ele registou) | P8/P12 |
| `tipo: stop_limite` | idem | **recusa nomeada** `capacidade_nao_declarada` | P8/P12 |
| `tipo: mercado_por_faixa` | idem | **recusa nomeada** `capacidade_nao_declarada` | P12 |
| `parcial: o_que_der` | aceitar preenchimento parcial | **aceite** — o venue declarou `parcial_suportada: ["o_que_der"]` | P3 |
| `parcial: tudo_ou_nada` | recusar (o venue nao declara) | **recusa nomeada** `capacidade_nao_declarada` | P12 |
| `destino_do_resto: agressivo` | perseguir o resto | **aceite** — e no tipo `mercado` (Ioc) nao ha' resto a perseguir: nao ha nada a fazer, e esta' dito | P12 |
| `destino_do_resto: cancelar` | retirar o que ficou | **aceite** — no tipo `mercado` o `Ioc` cancela o resto POR CONSTRUCAO, logo esta' honrado; no `limite` exigiria um verbo de cancelamento que este conector nao tem (e o `limite` esta' recusado, D-012) | P12 |
| `reduce_only: true` | so reduzir | **aceite** — fechou 0.00046 sem abrir nada | P7 |
| `reduce_only: false` | pode abrir | **aceite** | P3 |
| `stop_pct` / `tp_pct` | prender o stop a' posicao | **recusa nomeada** (29/09/2026): o conector nao manda stop nenhum, e antes RECUSAVA-SE A SI MESMO nao fazer isto — a boleta saia e o stop nao (D-011) | P10/P12 |
| `alavancagem` | pedir a alavancagem ao venue (FR-008) | **REPROVOU** — a boleta pede 2, o venue tem 40 (`{"type":"cross","value":40}`), e ha' 0 chamadas de ajuste em `brokers/` | **P11 (D-010)** |
| `referencia_do_cliente` | idempotencia: a mesma referencia nao cria segunda ordem | **REPROVOU** — a mesma referencia criou DUAS ordens, as duas preenchidas | **P6 (D-009)** |
| `marca_de_posse` | viajar na ordem (cloid) | **aceite** — as ordens desta mesa chegam ao venue com `cloid` (10 das 425 ordens da conta sao nossas e tem marca) | P6 |
| `desvio_maximo` | limitar o desvio do preco | **conferido** — o tradutor recusa desvio acima do declarado pelo venue (`desvio_maximo: 0.5`) e o preco de mercado sai quantizado dentro da banda | P12 + bancada das ordens |
| `prazo_da_passiva_ms` | esperar a parte passiva N ms | **inalcancavel hoje**: so' o tipo `limite` tem parte passiva, e o `limite` esta' recusado (D-012) — fica dito, nao escondido | P12 |
| `saldo_pct` (o limite do saldo) | dimensionar pela percentagem do saldo | **aceite**, e o LIMITE e' NOSSO: um nocional de 1% do equity passa (`dentro/seguir`) e um de 2000% e' `fora/reduzir_e_registar` com os numeros; do lado do venue **nao ha' travaso nenhum** — ver a nota abaixo | **P16** |

AS TRES COISAS QUE ESTA VARREDURA ACHOU, E QUE NAO ESTAVAM DITAS
----------------------------------------------------------------
1. **D-011 — o stop nao saia, e ninguem dizia** (agora: recusa nomeada). A boleta com `stop_pct`/`tp_pct`
   produzia um payload IDENTICO ao de uma boleta sem nada disso. O stop vem do setup (RN-S11) e e' a proteccao
   que o dono autorizou. O venue TEM o verbo (medido nos tipos do SDK: `t: { trigger: { tpsl: "tp"|"sl",
   triggerPx, isMarket } }`); o conector ainda nao o implementa. **Estado de hoje: recusa**, e nao uma posicao
   que sai desprotegida.
2. **D-010 — a alavancagem nunca e' pedida ao venue** (FR-008). O verbo existe no SDK (`updateLeverage`,
   com `isCross` para cruzado/isolado) e o manifesto declara `sabe_ajustar_alavancagem: true`.
3. **D-013 — o lado oposto a' NOSSA posicao nao e' distinguido de "abrir"** (medido na P15): a mesa decidiu
   `abrir`, a boleta saiu `sell` com `reduce_only=false`, e o venue **zerou a posicao** (netting). O registo diz
   `abrir` e o que aconteceu foi uma reducao — e, se a boleta fosse maior do que a posicao, seria uma VIRADA numa
   so' ordem, que e' exactamente o que a virada de mao em dois passos existe para nao deixar acontecer.

NOTA DE CAMPO — o que o VENUE faz quando ninguem trava (e um erro meu, medido)
------------------------------------------------------------------------------
A primeira versao da prova do teto do saldo mandava ao venue, A SERIO, uma ordem de ~400x o equity, a espera de
ser recusada por margem. **Nao foi recusada.** O venue nao recusa por margem: **enche o que cabe** (parcial) —
encheu `0.11956 BTC` (~10.000 USDC) contra ~992 de equity e devolveu a posicao, deixando a conta com posicao
aberta (fechada logo a seguir com `reduce_only`, ordem `61431298417`; custo do acidente ~7 USDC de teste).

Duas licoes, e as duas ficam escritas:

- **do lado do venue nao ha' travão de saldo**: `saldo_pct` mal dimensionado nao vira recusa, vira POSICAO. Quem
  trava e' a banda do mandato (P16), e e' por isso que ela nao pode ser alargada para uma prova passar;
- **eu alarguei a banda de proposito para a prova poder correr** — ou seja, desliguei o travão para testar o
  travão. Esta' corrigido: a prova do teto do saldo e' hoje um par de controle (1% passa, 2000% recusa) e nao
  manda ordem nenhuma ao venue.

O QUE FALTA PARA FECHAR (por ordem, e por onde se mede)
-------------------------------------------------------
1. **FR-008 (alavancagem)** — pedir ao venue antes de abrir e conferir a leitura depois; se nao aplicar, recusar.
   Prova: `activeAssetData.leverage` igual ao pedido, medido antes/depois (P11 fica verde).
2. **Verbo de CANCELAMENTO** (`cancel`/`cancelByCloid` no SDK) — sem ele nao ha' `destino_do_resto: cancelar` no
   `limite`, nem se retira uma ordem trigger que descansa.
3. **Ordem TRIGGER** (`tpsl`) — e' o que entrega `stop_pct`/`tp_pct` (e o tipo `stop`), com o cancelamento acima
   a limpar o que descansa.
4. **`limite` utilizavel (D-012)** — derivar o preco do limite com a quantizacao da regra do venue em vez de usar
   a marca crua.
5. **D-013** — decidir: o lado oposto a' nossa posicao e' `reduzir` (nomeado como reducao) ou e' recusa; hoje e'
   `abrir` e o venue faz outra coisa.
FIM
