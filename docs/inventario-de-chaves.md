# Inventário de chaves — v0 (rascunho)

| | |
|---|---|
| Papel | A lista de **toda grandeza ajustável** do sistema: nome, tipo, dono, omissão e **quem lê**. |
| Regra-mãe | **RN-A1** (nenhum número no código), **RN-A2** (a mesa valida o inventário no arranque), **RN-A3** (spec que precise de número inventa a chave primeiro). |
| Estado | **v0, extraído à mão das regras.** A versão final é **gerada dos schemas** e este ficheiro passa a ser a conferência de que a geração concorda com as regras. |
| Como se lê | `[falta]` = a regra implica a chave e ninguém a declarou — **é uma lacuna, não um esquecimento de escrita**. `[novo]` = chave criada nesta passagem, sem regra anterior que a nomeasse. |

Critério de sanidade, e é ele que faz este documento útil: **chave que ninguém lê é lixo; valor lido sem
chave é defeito.** Por isso a última coluna não é decoração — é a prova.

---

## 1. `conta.*` — o macro (dono, `/config`)

| Chave | Tipo / unidade | Exemplo de omissão | Quem lê |
|---|---|---|---|
| `conta.corretora` | nome do conector | — | mesa no arranque (RN-M1) |
| `conta.identificador` | texto | — | mesa e conector |
| `conta.instrumentos[]` | lista de símbolos | — | mesa (RN-M1) |
| `conta.perda_maxima_pct` | % do equity da corretora, com não realizado | `5` | mesa, **em cada ciclo** (RN-M3) |
| `conta.perda_maxima_janela` | enum `corrida_da_mesa` \| `dia_de_calendario` | `corrida_da_mesa` | mesa (RN-M3 a RN-M3.4) |
| `conta.margem_total_maxima_pct` | % do saldo | `100` | arranque e cada ciclo (RN-M4) |
| `conta.risco_maximo_por_ordem_pct` | % do saldo | `2` | mesa, antes de enviar (RN-M4.12) |
| `conta.contencao` | enum `recusar` \| `espera` | ausente = recusa | arranque (RN-M4.7) |
| `conta.ordem_de_atendimento[]` | lista de símbolos | vazio = alfabética | mesa no ciclo de contenda (RN-M4.9) |
| `conta.eventos_que_avisam[]` | lista de eventos | CB, encerramento, desconhecido, recusa, divergência, falha de leitura, contenda | avisos (RN-E15) |
| `conta.arranque_apos_cb` | enum `exige_decisao` | `exige_decisao` | arranque (RN-M3.3) |
| `conta.credencial` | **referência**, nunca o valor | — | conector (RN-E14) |
| `conta.idade_maxima_do_dado_ms` | ms | **`[falta]`** — RN-D3 diz "limite declarado" e ninguém o declarou | mesa, cada ciclo (RN-D3) |
| `conta.retencao_ledger` | `{dias_integral, depois}` | **`[falta]`** — RN-L6 manda declarar | ledger (RN-L6) |

## 2. `fichas/<instrumento>.risco.*` — a posição (forma fixa, do core)

| Chave | Tipo / unidade | Exemplo de omissão | Quem lê |
|---|---|---|---|
| `saldo_pct` | % do saldo | — | boleta (RN-M4.3) |
| `alavancagem` | múltiplo | `1` | boleta (RN-M4.3) |
| `distancia_minima_liquidacao_pct` | % de movimento, **opcional** | ausente = ordem livre | porteiro na abertura (RN-M4.13) |
| `janela` | da posição (do setup) | — | mesa (RN-M5, RN-S3) |
| `estudo` | referência + data | ausente | validação (RN-E13) |
| `tolera_posicao_manual` | booleano | **`[novo][falta]`** — RN-T16 exige e a chave não tinha nome | mesa (RN-T16) |
| `bandas.saldo_pct` | `[min, max]` | **`[falta]`** — RN-M6.2 fala de banda e não a enumera para este item | validação (RN-M6.2) |
| `bandas.alavancagem` | `[min, max]` | **`[falta]`** | validação (RN-M6.2, RN-M4.4) |
| `bandas.stop_pct` | `[min, max]` | **`[falta]`** | mesa e validação (RN-S11, RN-M4.12) |
| `bandas.tp_pct` | `[min, max]` | **`[falta]`** | idem |
| `bandas.tempo_maximo_em_posicao` | duração | **`[falta]`** | mesa (RN-S11) |

## 3. `fichas/<instrumento>.setup.*` — a estratégia (forma publicada pelo setup)

| Chave | Tipo / unidade | Quem declara | Quem lê |
|---|---|---|---|
| `setup.nome` / `setup.variante` | texto | dono escolhe | mesa (RN-M6) |
| `setup.politica_de_execucao` | enum `passiva_no_toque_com_escalada` \| `mercado` \| … | **setup (template)** | mesa ao montar a boleta — **`[novo]`**: a boleta tem `tipo` e **nenhuma regra dizia quem o escolhe** |
| `setup.prazo_da_passiva_ms` | ms | **setup** | mesa (RN-B8) |
| `setup.destino_do_resto` | enum `agressivo` \| `cancelar` | **setup** | mesa (RN-B8) |
| `setup.prazo_de_resposta_ms` | ms | **setup** | **`[falta]`** — RN-S8 fala de "silêncio além do prazo" e o prazo não tinha chave; num **setup manual** é prazo humano (RN-T15.1) |
| `setup.parcial` | enum (tudo-ou-nada / o-que-der) | setup | boleta (RN-B6) |
| `setup.desvio_maximo` | % de movimento | setup | boleta, conferido no manifesto (RN-B3) |
| `setup.<itens do template>` | conforme o template (`ema_fast`, `ema_slow`, `stop_pct`, limiares…) | **forma**: setup · **valores**: dono | mesa **pelo template**, nunca por nome (RN-S3, RN-S4) |

## 4. A boleta — documento, não configuração: **cada campo tem de vir de um sítio**

| Campo | Vem de | Nota |
|---|---|---|
| ciclo, instrumento | mesa | identidade (RN-T3) |
| lado | setup | um dos quatro valores (RN-S1) |
| tipo de ordem | **`setup.politica_de_execucao`** | **`[novo]`** — não tinha dono declarado |
| saldo_pct, alavancagem | `fichas/<i>.risco` | RN-M4.3 |
| stop_pct, tp_pct | setup, **limitado pela banda** | RN-B7, RN-S11 |
| parcial | setup | RN-B6 |
| desvio_maximo | setup | RN-B8 |
| prazo_da_passiva_ms | **`setup.prazo_da_passiva_ms`** | **`[novo]`** — RN-B8 manda e a chave não existia |
| destino_do_resto | **`setup.destino_do_resto`** | **`[novo]`** — idem |
| reduce_only | mesa (saída) | RN-B5 |
| referência do cliente | mesa | RN-C4 |
| versão do contrato | a ponta | RN-E18 |

## 5. Manifesto do conector — **sondado, não configurado**

Instrumentos e unidades (mínimo, passo, tick) · alavancagem máxima por instrumento e por escalão de valor ·
se sabe ajustar alavancagem e em que modos · teto de valor por ordem · modelo de posição (netting/hedging) ·
tipos de ordem disponíveis · política de parcial suportada · desvio máximo · `reduce-only` nativo ·
stop anexo · profundidade de livro · funding · relógio de fecho de barra · idempotência ·
**estado do mercado** (aberto/fechado, RN-D8) · **versão do contrato** (RN-E18) — todos por RN-C1.

---

## 6. Lacunas que o inventário revelou

Aritméticas, não interpretativas — é por isso que esta vista apanha o que a leitura não apanha:

1. **`conta.idade_maxima_do_dado_ms`** — RN-D3 manda invalidar o ciclo por "dado acima do limite
   declarado" e **ninguém declarou o limite**. Regra sem chave é regra que não corre.
2. **`setup.prazo_de_resposta_ms`** — RN-S8 congela por "silêncio além do prazo" e o prazo não tem chave.
   Num **setup manual** isto deixa de ser detalhe: sem prazo humano, a mesa congela porque o dono foi
   almoçar (RN-T15.1).
3. **`setup.politica_de_execucao`** — a boleta tem `tipo` e **nenhuma regra diz quem o escolhe**. No motor
   de referência é sempre passiva no toque com escalada para agressiva; isso é política de execução, e
   política de execução é do setup. Sem esta chave, a mecânica mais bem provada que temos ficaria no
   código.
4. **`setup.prazo_da_passiva_ms`** e **`setup.destino_do_resto`** — RN-B8 manda a boleta declará-los e as
   chaves não existem.
5. **`tolera_posicao_manual`** — RN-T16 exige e não tinha nome.
6. **As bandas não estão enumeradas** — e falta a do próprio `saldo_pct`, sem a qual o RN-M6.2 ("valor fora
   da banda é recusado") não tem contra o que comparar.
7. **`conta.retencao_ledger`** — RN-L6 manda declarar e não há chave.
8. **`estudo`** — RN-E13 manda registrar o estudo que sustenta o número e não há campo.
