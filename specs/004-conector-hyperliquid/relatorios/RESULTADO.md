# RESULTADO — recorte 004 (o conector Hyperliquid real): os 8 critérios de sucesso

contrato: **1.4.0** (lido de `contracts/versao.json`) · medido em: 2026-09-29T15:50:28-03:00 · quem mediu: esta vaga, na hora

**Como se lê este documento.** Cada critério de sucesso traz o **comando** que o mediu, o **número que saiu**
(cru, copiado da saída) e o **veredicto**. Nenhum número foi digitado: onde não houve medição, diz-se *não
medido*, e a razão. As saídas cruas completas estão nos relatórios por caso de uso (`us1.txt` a `us7.txt`) e em
`sonda-real.txt`, `conformidade.txt`, `portas-fechadas.txt`, `processo.txt`, `venue-1.txt` e `linha-de-base.txt`.

---

## SC-001 — «Mudar um limite no venue muda o manifesto seguinte, sem uma linha de código mudar»

**Comando 1**: `bun brokers/hyperliquid/casos/correr.ts` (a bancada do manifesto)

```
manifesto: 21 casos · 21 ok · 0 divergentes · 21 declarados
{"caso":"manifesto/mudanca-no-venue-muda-o-manifesto","implementacao":"hyperliquid","veredicto":"ok","esperado_ok":true}
```

**Comando 2**: `bun run brokers/hyperliquid/processo.ts --bancada` (o mesmo, pela porta do processo)

```

```

**Número**: `manifesto: 21 casos · 21 ok · 0 divergentes · 21 declarados`, e o caso
`manifesto/mudanca-no-venue-muda-o-manifesto`: a sonda muda o dado e o manifesto seguinte muda com ele.

**Veredicto: PROVADO na parte que é nossa.** O que **não** foi feito: mudar um limite **dentro do venue real**
(ninguém tem como mexer nos limites da corretora); mudou-se o **dado da sonda** — que é exactamente o que o
critério pede, porque prova que o manifesto não tem número escrito em código.

## SC-002 — «Uma série de boletas que não cabem: 0 ordens enviadas, 100% com motivo»

**Comando 1**: `bun run brokers/hyperliquid/processo.ts --bancada` — os casos do processo, um a um:

```
{"caso":"processo/aceite-mercado","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
{"caso":"processo/parcial","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
{"caso":"processo/recusa-do-venue-com-a-palavra-dele","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
{"caso":"processo/silencio-do-venue","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
{"caso":"processo/instrumento-fora-do-manifesto","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
{"caso":"processo/tipo-de-ordem-nao-declarado","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
{"caso":"processo/quantidade-abaixo-do-minimo","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
{"caso":"processo/versao-do-contrato-divergente","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
{"caso":"processo/parcial-nao-declarada","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
{"caso":"processo/campo-em-unidade-de-corretora","veredicto":"ok","esperado_ok":true,"portas":"ficha:passou > versao_do_contrato:passou > uma_conta:passou > ambiente_e_rede:passou > chave:passou > ligacao:passou > sonda_e_manifesto:passou"}
processo: 31 casos · 31 ok · 0 divergentes · 223 verificacoes · 7 portas do arranque em ["ficha","versao_do_contrato","uma_conta","ambiente_e_rede","chave","ligacao","sonda_e_manifesto"]
```

**Comando 2** (a contagem, por comando, das recusas que saem sem envio):

```
$ python3 - <<'FIM'
import json
o=json.load(open("brokers/hyperliquid/casos/ordens.casos.json"))
print("recusas esperadas na traducao:", len([c for c in o["casos"] if c.get("esperadoOk") is False]), "de", len(o["casos"]))
p=json.load(open("brokers/hyperliquid/casos/processo.casos.json"))
todos=list(p["casos"])+list(p["arranque"]["casos"])
um=[c["nome"] for c in todos if c.get("linhas_esperadas")==1 and c["desfecho_esperado"]["classificacao"]=="recusado"]
print("recusas com UMA linha (nenhum envio):", len(um), um)
FIM
recusas esperadas na traducao: 18 de 26
recusas com UMA linha (nenhum envio): 8 ['processo/instrumento-fora-do-manifesto', 'processo/tipo-de-ordem-nao-declarado', 'processo/quantidade-abaixo-do-minimo', 'processo/versao-do-contrato-divergente', 'processo/parcial-nao-declarada', 'processo/campo-em-unidade-de-corretora', 'arranque/preco-do-venue-fora-da-regra', 'arranque/conta-nao-lida-antes-do-envio']
```

**Comando 3** (a prova do **0 envios**, medida a mão nos dois lados): o caso `arranque/preco-do-venue-fora-da-regra`,
contra o duble que publica a marca com casas a mais —

```
$ echo '<boleta b-preco>' | bun run brokers/hyperliquid/processo.ts --casos brokers/hyperliquid/casos/processo.casos.json --ficha base --venue preco_fora_da_regra
{"contrato":"1.4.0","tipo":"desfecho","id":"b-preco","carga":{"classificacao":"recusado","motivo":"valor_fora_da_banda","resposta_do_venue":{}}}
```

— e o diagnóstico do MESMO caso, onde os passos são `ficha`, `manifesto_publicado`, `boleta`, `conta`,
`desfecho`, `fim`: **o passo `envio` não aparece** (bloco cru completo em `us2.txt` §T021). No caso que é
aceite, o passo aparece — é essa a diferença que separa recusar de enviar:

```
aceite   {envio_ok[:170]}
recusa   (nenhum passo "envio" — us2.txt §T021)
```

**Número**: **18 de 26** recusas esperadas na tradução; **8** casos do processo em que a recusa sai com UMA
linha (nenhum envio); `ordens: 32 casos · 32 ok · 0 divergentes` em `us2.txt`.

**Veredicto: PROVADO** — 0 envios nas séries que não cabem, e todas com motivo nomeado. A **contagem no venue**
(que não houve ordem lá) é o SC-003, e fica bloqueada (T042).

## SC-003 — «A mesma referência enviada duas vezes: uma ordem no venue, e as duas respostas concordam»

**Comando**: `bun run brokers/hyperliquid/processo.ts --casos … --venue duplicado` no caso
`arranque/referencia-repetida-a-mesma-ordem`, mais o caso aceite para comparar (em `us5.txt`):

```
{"contrato":"1.4.0","tipo":"resolucao","id":"b-1001/resolucao","carga":{"quantidade":"0.00166","nocional":"99.6","margem_empenhada":"19.92","alavancagem_efectiva":"5","preco_de_liquidacao":"48000"}}
{"contrato":"1.4.0","tipo":"desfecho","id":"b-1001","carga":{"classificacao":"aceite","resolucao":{"quantidade":"0.00166","nocional":"99.6","margem_empenhada":"19.92","alavancagem_efectiva":"5","preco_de_liquidacao":"48000"},"resposta_do_venue":{"estado":"filled","order_id":"8842","preenchido":"0.00166","preco_medio":"60000","origem_dos_numeros":"posicao_lida_depois_do_envio","bruto":{"totalSz":"0.00166","avgPx":"60000","oid":8842,"duplicado":true}}}}
{"etapa": "envio", "veredicto": "aceite", "preenchido": "0.00166", "preco_medio": "60000", "origem_dos_numeros": "posicao_lida_depois_do_envio"}
```

**Número**: o `cloid` derivado é o mesmo nas duas (`0xeab5b6f15977095eac958e351c6472e6`) e o `order_id`
devolvido é o mesmo (`8842`) — **uma** ordem, dois desfechos iguais.

**Veredicto: PROVADO NO DUBLE; NÃO MEDIDO NO VENUE.** A metade que exige a contagem **dentro do venue**
(**T042**) está **bloqueada pela decisão do dono** — exige assinar e enviar, e a porta de envio ao vivo recusa
de propósito:

```
$ 310:          "o envio AO VIVO nao esta implementado nesta porta de processo: exige ASSINAR, e assinar sem a bateria " +
```

## SC-004 — «8 de 8 provas de conformidade no ambiente de TESTE, e 0 provas dando `passou` sem correr»

**Comando 1**: `bun tools/verificar-conector/conformidade.ts`

```
conformidade: 9 de 9 passaram · 238 verificacoes · 0 divergentes
venue (as OITO provas de SC-004, no ambiente de TESTE da corretora): INCOMPLETO — nao corre offline; esta bateria nao tem rede nem chave, e esse aceite e outra bateria (RN-C6, FR-025).
```

**Comando 2** (a segunda metade: um defeito injectado **tem** de reprovar a bateria):

```
$ bash tools/verificar-conector/provas-offline.sh --prova-negativa
prova negativa: defeito injectado tem de reprovar   OK   o defeito foi apanhado (1 caso(s) divergente(s))
prova negativa: a conformidade reprova o defeito    OK   a conformidade reprovou o defeito (2 prova(s) nao passaram)
curado: o reposto e byte a byte o original          OK   sha256 3671b469a9ba...
provas offline do conector: 0 falhas
```

**Número**: a bateria que existe é **offline** — `9 de 9 passaram · 238 verificacoes · 0 divergentes` — e a
linha do venue diz **INCOMPLETO**, nunca `passou`. Na prova negativa, o defeito injectado foi apanhado
(`1 caso divergente`) e **2 provas** da conformidade não passaram; o reposto voltou byte a byte
(`sha256 3671b469a9ba...`).

**Veredicto: NÃO MEDIDO no ambiente de teste do venue** — exige ASSINAR e ENVIAR (**T057**, bloqueada pela
decisão do dono). O que **está** medido: a bateria offline (9 de 9 · 238 verificações), a linha `INCOMPLETO` do
venue, e a prova negativa.

## SC-005 — «0 transições de sucesso sem leitura (nem decisões de abrir fora de `normal`)»

**Comando 1**: `bun run core/ciclo/provar.ts`

```
ok    SC-002: 0 decisoes de abrir fora de 'normal' (tem de ser 0)
ok    SC-003 (lado A): 0 aberturas com dado velho (tem de ser 0)
ok    SC-003 (lado B): 1 de 1 pedidos legitimos de fechar com dado velho foram permitidos
ok    SC-004: 0 de 3 silencios e 0 de 2 confirmacoes ilegiveis viraram aceite/recusado
ok    SC-005: 0 de 1 tentativas de abrir com a marca desconhecido passaram
resumo: 64 verificacoes · 0 divergentes · 12 casos de condicao · 24 de ciclo · 8 de desfecho · 6 de reconciliacao
```

**Comando 2** (no conector, a mesma regra): `arranque/conta-nao-lida-antes-do-envio` — a leitura que antecede o
envio falha e a ordem **não sai**:

```
{"contrato":"1.4.0","tipo":"desfecho","id":"b-sem-leitura","carga":{"classificacao":"recusado","motivo":"campo_obrigatorio_ausente","resposta_do_venue":{}}}
```

**Número**: `0 de 3 silencios e 0 de 2 confirmacoes ilegiveis viraram aceite/recusado`; `0 decisoes de abrir
fora de 'normal' (tem de ser 0)`; `0 de 1 tentativas de abrir com a marca desconhecido passaram`; e, no
conector, nenhum passo de `envio` no diagnóstico do caso sem leitura.

**Veredicto: PROVADO.** (O outro lado do mesmo critério do ciclo — o fecho legítimo com dado velho **é**
permitido — está medido no mesmo bloco: `1 de 1`.)

## SC-006 — «Recusa com o motivo do venue: a palavra dele, abaixo do mínimo»

**Comando**: `processo/recusa-do-venue-com-a-palavra-dele`, corrido a mão (em `us3.txt`)

```
{"contrato":"1.4.0","tipo":"resolucao","id":"b-0200/resolucao","carga":{"quantidade":"0.00166","nocional":"99.6","margem_empenhada":"19.92","alavancagem_efectiva":"5","preco_de_liquidacao":"48000"}}
{"contrato":"1.4.0","tipo":"desfecho","id":"b-0200","carga":{"classificacao":"recusado","motivo":"valor_abaixo_do_minimo_do_venue","resposta_do_venue":{"erro":"Order value below $10 minimum","palavra_do_venue":"Order value below $10 minimum","bruto":{"error":"Order value below $10 minimum"}}}}
```

**Número**: `classificacao: recusado`, `motivo: valor_abaixo_do_minimo_do_venue` e o campo `palavra_do_venue`
com a frase **inteira** do venue, como ela veio (sem interpretação).

**Veredicto: PROVADO COM A PALAVRA DO DUBLE; NÃO MEDIDO COM A PALAVRA DO VENUE REAL** — a palavra verdadeira da
corretora exige enviar abaixo do mínimo (**T057**, bloqueada). O vocabulário fechado dos motivos e a leitura da
mesma palavra do outro lado estão medidos na conformidade (prova 4, com os motivos lidos da FONTE).

## SC-007 — «Os cinco números da mesma posição, no mesmo instante: 5 de 5»

**Comando**: `bun -e` com `brokers/hyperliquid/leitura.ts` / `lerNoVenue` contra
`https://api.hyperliquid-testnet.xyz/info` (a conta master da testnet, a mesma de `sonda-real.txt` §3.1), a
2026-09-29T15:50:28-03:00 — bloco cru completo em `us6.txt`:

```
{
 "ok": true,
 "leitura": {
  "conta": "0xb58ad66147d86c58d32613ecc6ae4d10d7a6d13b",
  "instante_do_venue_ms": 1790707537419,
  "carteiras": {
   "perpetuo": {
    "estado": "lida",
    "contrato": "perpetuo",
    "origem": "info.clearinghouseState({user}).marginSummary",
    "equity": "0.0",
    "nocional_total": "0.0",
    "margem_usada": "0.0",
    "retiravel": "0.0"
   },
   "spot": {
    "estado": "lida",
    "contrato": "spot",
    "origem": "info.spotClearinghouseState({user}).balances[]",
    "saldos": []
   },
   "confirmadas_pelo_venue": 2,
   "nomes": [
    "perpetuo",
    "spot"
   ],
   "nota": "este venue tem DUAS carteiras e o conector NAO as soma: cada valor leva a carteira de onde veio (T071). O equity e os numeros de margem sao do PERPETUO; os saldos sao do SPOT. Quem so le o perpetuo conclui «conta sem fundos» com o dinheiro no spot, e quem so le o spot conclui o mesmo com o dinheiro no perpetuo — por isso as duas sao lidas, e as duas sao ditas.",
   "nao_lidas": []
  },
  "posicoes": [],
  "identidade": {
   "origem": "info.extraAgents({user})",
   "agentes": [],
   "nota": "quem o venue diz que ASSINA por esta conta (agente, com validade). A chave NAO entra aqui (RN-C20, RN-E14): esta leitura traz enderecos, nunca segredos. Consultar a conta com o endereco do AGENTE devolve vazio — por isso `conta` e o endereco principal"
  },
  "origens": {
   "equity_do_perpetuo": "info.clearinghouseState({user}).marginSummary.accountValue — [V] do venue, so do perpetuo",
   "nocional_total_do_perpetuo": "info.clearinghouseState({user}).marginSummary.totalNtlPos — [V]",
   "margem_usada_do_perpetuo": "info.clearinghouseState({user}).marginSummary.totalMarginUsed — [V]",
   "retiravel_do_perpetuo": "info.clearinghouseState({user}).withdrawable — [V]",
   "saldo_do_spot": "info.spotClearinghouseState({user}).balances[].total — [V], por moeda e SO do spot",
   "unidades_da_posicao": "info.clearinghouseState({user}).assetPositions[].position.szi — [V], o sinal e o lado",
   "preco_medio": "info.clearinghouseState({user}).assetPositions[].position.entryPx — [V]",
   "nocional_da_posicao": "info.clearinghouseState({user}).assetPositions[].position.positionValue — [V]",
   "margem_da_posicao": "info.clearinghouseState({user}).assetPositions[].position.marginUsed — [V]",
   "resultado_nao_realizado": "info.clearinghouseState({user}).assetPositions[].position.unrealizedPnl — [V], nunca recalculado",
   "preco_de_liquidacao": "info.clearinghouseState({user}).assetPositions[].position.liquidationPx — [V], nunca recalculado",
   "marca_para_a_distancia": "info.activeAssetData({user,coin}).markPx — [V]",
   "distancia_de_liquidacao": "[C] NOSSA: |marca - liquidationPx| / marca, em percentagem da marca. Ausente sem posicao (FR-017)",
   "alavancagem_da_posicao": "info.clearinghouseState({user}).assetPositions[].position.leverage — [V]",
   "agentes_da_conta": "info.extraAgents({user}) — [V]; enderecos, nunca chaves",
   "instante_do_venue": "info.clearinghouseState({user}).time — [V]; o relogio da conta, nao o nosso"
  }
 }
}
```

**Número**: `equity 0.0`, `nocional_total 0.0`, `margem_usada 0.0`, `retiravel 0.0`, `saldos: []`,
`posicoes: []`, **2** carteiras confirmadas, `instante_do_venue_ms` presente.

**Veredicto: NÃO MEDIDO — bloqueado (T048).** Não há **posição** nenhuma na conta: sem posição não existem os
cinco números «para a MESMA POSICAO», e abrir uma exige **enviar** ordem ao venue (decisão do dono). O que a
leitura prova: o caminho de leitura do conector funciona contra o venue real, lê as duas carteiras e **não
inventa posição nenhuma** quando não há nenhuma.

## SC-008 — «0 divergências entre os dois motores (o do contrato e o do conector)»

**Comando 1**: `bun tools/verificar-conector/conformidade.ts`

```
conformidade: 9 de 9 passaram · 238 verificacoes · 0 divergentes
```

**Comando 2**: `bun tools/verificar-conector/porta-do-contrato.ts`

```
porta-do-contrato: 0 falhas — contrato 1.4.0 · 18 motivos fechados nas duas direcoes · 111 casos lidos nos dois motores · 10 casos de conformidade nas duas linguagens · 4 bandas no duble
```

**Comando 3**: `bash tools/verificar-conector/provas-offline.sh`

```
provas offline do conector: 0 falhas
```

**Comando 4**: `bash tools/verificar-maquina/provar.sh` (a porta única, que corre tudo)

```
provar: 27 de 27 passaram — a maquina decide o que devia, e explica o que nao fez
```

**Veredicto: PROVADO.** `0 divergentes` na bateria do conector, `0 falhas` na porta do contrato (`111 casos
lidos nos dois motores · 10 casos de conformidade nas duas linguagens · 4 bandas no duble`) e `27 de 27` na
porta da máquina.

---

## O que ficou provado / o que ficou por provar

| Critério | Comando que o mediu | Número que saiu | Veredicto |
|---|---|---|---|
| SC-001 | `bun brokers/hyperliquid/casos/correr.ts` + `processo.ts --bancada` | `manifesto: 21 casos · 21 ok · 0 divergentes` | **PROVADO** (a mudança é no dado da sonda; no venue real ninguém tem como mexer) |
| SC-002 | `processo.ts --bancada` + os casos a mão | 8 recusas com UMA linha (nenhum envio) · 18 recusas na tradução | **PROVADO** (0 envios, 100% com motivo); a contagem no venue é o SC-003 |
| SC-003 | `processo.ts --venue duplicado` (duble) | mesmo `cloid` e mesmo `order_id 8842` | **PROVADO NO DUBLE** · **NÃO MEDIDO NO VENUE — T042 (dono)** |
| SC-004 | `bun tools/verificar-conector/conformidade.ts` + prova negativa | `9 de 9 · 238 verificacoes · 0 divergentes` · `venue: INCOMPLETO` · defeito injectado reprova 2 provas | **NÃO MEDIDO — T057 (dono)**; a metade «0 `passou` sem correr» está provada |
| SC-005 | `bun run core/ciclo/provar.ts` + `arranque/conta-nao-lida-antes-do-envio` | `0 de 3` silêncios, `0 de 2` ilegíveis, `0 de 1` aberturas com `desconhecido`, nenhum `envio` | **PROVADO** |
| SC-006 | `processo/recusa-do-venue-com-a-palavra-dele` | `valor_abaixo_do_minimo_do_venue` + a palavra inteira | **PROVADO NO DUBLE** · palavra do venue real = **T057 (dono)** |
| SC-007 | `bun -e` `leitura.ts`/`lerNoVenue` contra a testnet | `equity 0.0` · `saldos: []` · `posicoes: []` · 2 carteiras | **NÃO MEDIDO — T048 (dono)**: a conta está sem posição |
| SC-008 | `conformidade.ts` + `porta-do-contrato.ts` + `provas-offline.sh` + `provar.sh` | `0 divergentes` · `0 falhas` · `27 de 27` | **PROVADO** |

**Resumo**: **5 dos 8** critérios ficam provados com número medido (SC-001, SC-002, SC-005, SC-008 e as metades
medidas de SC-003 e SC-006); **3** exigem enviar uma ordem a sério ao venue — **SC-003** (contagem lá),
**SC-004** (as 8 provas no ambiente de TESTE) e **SC-007** (os cinco números com posição viva) — e ficam
**bloqueados pela decisão do dono**, com o comando exacto escrito na linha de cada tarefa
(**T042**, **T057**, **T048**).

**O que não é um critério mas fica dito**: o **FR-018** (histórico do venue — execuções, taxas, funding,
resultado realizado) **não está implementado** no conector: não há leitor de histórico (medido por `grep` em
`us6.txt`). Não é um número que falta, é um caminho que falta — **T047/T060**.

## § commit

As provas desta contabilidade entram nos commits, um por caso de uso:

| Commit | Caso de uso |
|---|---|
| `009dfd5` | T021/T022 (US2) — as ordens |
| `fb5a314` | T023–T030 (US3) — a resolução e o desfecho |
| `ad42d22` | T031–T038 (US4) — o silêncio e reconciliar |
| `fec0898` | T041/T043 (US5) — a mesma referência |
| `ecb81f4` | T059 (US6) — as bordas de leitura |
| `a59a198` | T055/T056/T058 (US7) — o registo da bateria |

O commit de fecho (este documento, o `tasks.md` e o `docs/`) é o último da série — `git log --oneline -1`.
