# Quickstart — o conector cTrader

Como se prova este recorte, do mais barato ao mais caro. **A bancada offline corre sempre**; a bateria de
demonstração **ainda não existe** (§2 diz porquê, e quem a fecha). Quando as duas existirem e discordarem, o
defeito é da bancada offline.

## 0. Pré-requisitos

| O quê | Quem providencia | Nota |
|---|---|---|
| `Python 3.12+` e `uv` | **já está no host** (3.14.7, medido) | nada a instalar no sistema |
| Ambiente do plugin | criado pela tarefa da costura | `brokers/ctrader/.venv` (ignorado pelo git) |
| App registada na cTrader Open API | **o dono** | dá `client_id`/`client_secret` |
| Conta de **demonstração** (NETTED) | **o dono** | ver `data-model.md` §7 achado 3 |
| Par de tokens (access + refresh) | **o dono**, uma vez (Playground serve) | `ctrader_mesa_access_token.key` e `ctrader_mesa_refresh_token.key`, fora do repositório, modo 600 |
| Credenciais da aplicação (client_id + client_secret) | **o dono** | `ctrader_mesa_client_id.key` e `ctrader_mesa_client_secret.key` — **fixas** (só o venue as roda) |
| Ficheiro da conta | este recorte | referências, **nunca valores** (FR-050) + o `ctid_trader_account_id` |

**Se faltar token**: a bancada offline corre na mesma (é o que ela serve para provar); a bateria de demonstração
**ainda não existe** (§2) — hoje não há, contra o venue, o que correr.

## 1. A bancada offline (sem rede)

O que prova: a tradução (unidades, recusas), a classificação do desfecho, o fecho por posição, o silêncio, e os
portões. Casos em dado, com os payloads do venue **gravados como fixture** — nenhum caso depende de mercado.

```
# 1. o portão da casa — um comando, uma saída; inclui as cinco bancadas deste conector
bash tools/verificar-maquina/provar.sh

# 2. a bancada deste conector, offline e em dado — tem de correr da PASTA DO CONECTOR
#    (da raiz, o `python` do sistema não tem o `jsonschema`: é a venv do conector que o traz)
cd brokers/ctrader && .venv/bin/python casos/correr.py

# 3. os casos do contrato nos DOIS lados (o dublê da mesa + este conector) — T047
cd brokers/ctrader && .venv/bin/python casos/correr-duble.py
```

**Saída crua (as três corridas medidas a 05/10/2026, `rc=0`):**

```
$ bash tools/verificar-maquina/provar.sh
ctrader: boleta e fecho (109 casos)        OK   ctrader: 109 casos · 109 ok · 0 divergentes
ctrader: envio e reconciliacao (36)        OK   ctrader/prova-envio: 36 provas · 36 ok · 0 divergentes
ctrader: ritmo do venue (6 provas)         OK   ctrader/prova-ritmo: 6 provas · 6 ok · 0 divergentes
ctrader: leitura do mercado (7 provas)     OK   ctrader/prova-leitura: 7 provas · 7 ok · 0 divergentes
ctrader: contrato nos dois lados (19 casos) OK   ctrader/duble: 19 casos · 0 divergentes · duble 19/19 · conector 19/19
…
provar: 57 de 57 passaram — a maquina decide o que devia, e explica o que nao fez

$ cd brokers/ctrader && .venv/bin/python casos/correr.py
ctrader: 109 casos · 109 ok · 0 divergentes

$ cd brokers/ctrader && .venv/bin/python casos/correr-duble.py
lado DUBLE (mesa, --papel conector): 19 casos · 19 ok · 0 divergentes
lado CONECTOR (framing.py, o motor do desfecho): 19 casos · 19 ok · 0 divergentes
conector offline (correr.py, os casos em dado deste venue): ctrader: 109 casos · 109 ok · 0 divergentes
ctrader/duble: 19 casos · 0 divergentes · duble 19/19 · conector 19/19
```

**Esperado**: **57 de 57** no portão (`rc=0`) e as cinco bancadas deste conector a verde com a contagem escrita
— boleta e fecho **109**, envio e reconciliação **36**, ritmo **6**, leitura do mercado **7** e os casos do
contrato nos **dois lados** **19** (não «tudo ok»). A bancada offline imprime, no próprio `stdout` e **sem contar
como caso**, a linha `{"negativa": …}` de **nove** provas negativas — identidade divergente aceite, direitos
aceitos, `passo` fixo no código, fecho do inexistente a mandar ordem, `tradingMode` a sair como ENUM cru,
`moneyDigits` não lido do venue, `_nome_do_proto` sem ler o INTEIRO, o desvio a arredondar para cima e a
**virada sem posição aceite**: cada uma
injecta o defeito e exige o caso **VERMELHO** a nomeá-lo; se ele não ficar vermelho, a bancada sai `rc=1`. O total
verde (**109**) não muda com elas.

A bancada dos **dois lados** (T047) faz o mesmo: corre os 19 casos pelo **dublê da mesa**
(`contracts/mocks/mesa/main.py --papel conector`) E pelo **motor do contrato** (`contracts/esqueleto/framing.py`,
o lado do conector), compara os veredictos **caso a caso** e **registra as duas contagens lado a lado** —
**divergência é FALHA NOMEADA** (qual caso, o que o dublê disse, o que o conector disse). Os 11 casos **válidos**
não trazem o desfecho escrito: a bancada **monta-o** por `desfecho_do_evento`/`desfecho_do_silencio` a partir de
`desfecho.casos.json`, de modo que o que atravessa a fronteira é o que o conector **produz**. A negativa dela
estraga **de propósito** um veredicto do conector e exige o **VERMELHO** a nomear o caso (`{"negativa":
"veredicto-estragado-do-conector", …}`); com a negativa **vacuosa** o `rc` vira **1**. E há o modo explícito:

```
$ cd brokers/ctrader && .venv/bin/python casos/correr-duble.py --prova-negativa   # rc=1
*** PROVA NEGATIVA: o veredicto do CONECTOR do caso `ctrader/desfecho-preenchimento-total` estragado de proposito ***
  DIVERGE ctrader/desfecho-preenchimento-total                 duble aceite/None · conector recusado/campo_desconhecido
          -> ctrader/desfecho-preenchimento-total: o DUBLE disse aceite/None e o CONECTOR disse recusado/campo_desconhecido
ctrader/duble: 19 casos · 1 DIVERGENTES
```

Sem credencial, sem rede, sem ordem ao venue — `contracts/` intocado.

> **O que ela NÃO cobre, e di-lo.** Só o lado **`desfecho`**: é o único tipo que o dublê confere no papel
> `conector` (ficha, identidade, leitura, ordens e sonda não são mensagens de um conector para a mesa). E o caso
> da mensagem com o `tipo` errado fica **fora**: o dublê confere o **papel** (um conector responde `desfecho`) e o
> motor confere o **envelope** — os dois medem coisas diferentes de propósito, e compará-los ali seria uma
> divergência que não é defeito de nenhum.

> **O que NÃO corre hoje, e porquê.**
> - `bash tools/verificar-conector/provas-offline.sh --conector ctrader` **não faz o que o nome promete**: o
>   `--conector` **não é lido** (`grep -c -- '--conector' tools/verificar-conector/provas-offline.sh` → **0**), e
>   o script corre a bateria do **hyperliquid** (credencial, manifesto, ordens, leitura, histórico,
>   `posse-do-preenchimento`, `porta-das-dependencias`, `conformidade`) — dá **verde sem tocar neste venue**. Não
>   a correr como se cobrisse o ctrader: um verde enganador é pior que um erro. *(É o defeito **A-15** da
>   auditoria de 05/10/2026.)*
> - Os casos do contrato nos **dois** lados (o **dublê da mesa** + este conector) eram a **T047** e estão
>   **fechados** (05/10/2026, o desenho): a bancada `casos/correr-duble.py` corre-os nos dois lados, com a
>   contagem lado a lado e a negativa dentro; a porta única passou a **57 de 57** (ver o comando 3, em §1). É
>   bancada — não toca no venue, não usa credencial.

## 2. A bateria de conformidade (demonstração) — **ainda não existe: a lacuna dita, não prometida**

O que há-de provar: o que não se pode simular — identidade, direitos, as duas camadas, o fecho por posição, a
marca reenviada. **Doze provas**: as oito da casa + as quatro deste venue.

**Este bloco não tem comando para correr hoje, e prova-o por medição** (o script não está no repositório):

```
$ ls tools/verificar-conector/bateria.sh brokers/ctrader/conformidade
ls: cannot access 'tools/verificar-conector/bateria.sh': No such file or directory
ls: cannot access 'brokers/ctrader/conformidade': No such file or directory
```

O que falta, e quem o fecha: a **bateria das doze provas** é a **T049/T050**, e fecha-a **o dono** (o OAuth foi
autorizado a 05/10/2026 — falta a corrida contra a demonstração); e as **fixtures reais** do venue são a **T046**
(dono). Os casos do contrato nos **dois lados** (T047) já **não** são uma lacuna: a `casos/correr-duble.py`
corre-os contra o dublê da mesa e contra o conector, e a contagem está em §1.
Quando existir, o comando há-de ser `bash tools/verificar-conector/bateria.sh --conector ctrader --ambiente
demonstracao` — hoje isso é **desenho, não instrução**. *(É o defeito **A-15** da auditoria de 05/10/2026: o
quickstart mandava correr este comando como se o script existisse.)*

O que ela há-de medir, com os números crus no relatório (em `brokers/ctrader/conformidade/<versao>-<data>.json`):

1. arranque: os oito portões + identidade, direitos e duas camadas;
2. **identidade recusada** com `ctidTraderAccountId` que não é o do ficheiro;
3. sonda e manifesto: instrumentos com deslistados, e os números do venue;
4. **duas camadas**: sessão derrubada (rotação de token), transporte vivo → **zero envios**;
5. re-autenticação → **lê a conta antes** de aceitar pedido;
6. boleta ao **padrão do dono** (`saldo_pct: 10`, `alavancagem: 1`) cujo volume **não cai no passo**: o volume **desce ao degrau admissível** e a linha **declara o ajuste** (volume pedido, efectivo, regra `volume_ajustado_ao_passo`, nocionais) — **reescrita em 06/10/2026, era «boleta fora do passo → recusa nomeada, zero ordens»** (decisão do dono);
7. stop abaixo de `slDistance` → recusa nomeada, **zero ordens**;
8. ordem a mercado no tamanho mínimo → resolução + desfecho com preço/volume/comissão **do venue**;
9. **marca reenviada** → uma ordem, uma posição;
10. fecho por `positionId` → o negócio de fecho com o detalhe;
11. fechar o que não existe → `nada` com motivo, **zero ordens**;
12. três aberturas e fechos → **zero posições** no fim, três fechos no histórico.

Cada prova escreve o que fez e o que viu; uma prova que precisaria de mercado favorável **abre-a ela mesma** no
tamanho mínimo (o ensaio é de conformidade, não de estratégia).

## 3. Onde ler o resultado

| Artefacto | Onde | O que tem |
|---|---|---|
| relatório da bateria | `brokers/ctrader/conformidade/` (fora do git) — **por existir: T049/T050** | prova a prova: comando, saída crua, veredicto; **por versão**, sem reescrever as anteriores |
| casos nos **dois lados** (T047) | `brokers/ctrader/casos/casos-duble.json` + `casos/correr-duble.py` | os 19 casos do contrato corridos pelo **dublê da mesa** E pelo conector, com a contagem lado a lado e a negativa dentro |
| linha de base | `specs/005-conector-ctrader/relatorios/linha-de-base.txt` | o estado do portão e do contrato **antes** da implementação |
| registo da corrida | `scratch/corrida-<conector>/registo.jsonl` | as linhas do contrato que o conector entregou (para o `tools/relatar-corrida.sh`) |

## 4. O que fazer quando falha

- **A bateria (quando existir, §2) recusa correr** → falta token, ou a conta não é de demonstração, ou o id não
  confere. Ler o motivo: ele diz **qual** dos três.
- **Uma prova discorda da bancada offline** → a offline está errada (é a que lê fixtures gravados): corrigir o
  caso, nunca a prova do venue.
- **`desconhecida` a mais** → olhar o prazo declarado (research R9) antes de olhar o código: um prazo curto numa
  rede má produz dúvidas legítimas.
