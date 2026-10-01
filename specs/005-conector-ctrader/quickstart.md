# Quickstart — o conector cTrader

Como se prova este recorte, do mais barato ao mais caro. Duas bancadas, e a ordem importa: **a offline corre
sempre**; a de demonstração só quando há tokens. Se as duas discordarem, o defeito é da bancada offline.

## 0. Pré-requisitos

| O quê | Quem providencia | Nota |
|---|---|---|
| `Python 3.12+` e `uv` | **já está no host** (3.14.7, medido) | nada a instalar no sistema |
| Ambiente do plugin | criado pela tarefa da costura | `brokers/ctrader/.venv` (ignorado pelo git) |
| App registada na cTrader Open API | **o dono** | dá `client_id`/`client_secret` |
| Conta de **demonstração** (NETTED) | **o dono** | ver `data-model.md` §7 achado 3 |
| Par de tokens (access + refresh) | **o dono**, uma vez (Playground serve) | guardado em ficheiro **fora do repositório** |
| Ficheiro da conta | este recorte | referências, **nunca valores** (FR-050) |

**Se faltar token**: a bancada offline corre na mesma (é o que ela serve para provar); a bateria de demonstração
recusa correr e **diz o que falta** — não falha em silêncio.

## 1. A bancada offline (sem rede)

O que prova: a tradução (unidades, recusas), a classificação do desfecho, o fecho por posição, o silêncio, e os
portões. Casos em dado, com os payloads do venue **gravados como fixture** — nenhum caso depende de mercado.

```
# 1. os tipos e a fronteira (o portão da casa continua a valer)
bash tools/verificar-maquina/provar.sh

# 2. os casos do contrato nos DOIS lados (dublê e conector) — divergência é falha
bash tools/verificar-conector/provas-offline.sh --conector ctrader

# 3. as provas próprias deste venue, offline
#    (unidades, mapeamentos de vocabulário, recusas nomeadas, classificação do desfecho)
python brokers/ctrader/casos/correr.py
```

**Esperado**: 33 de 33 no portão, casos do contrato sem divergência, e as provas do venue a verde com a
contagem escrita (não «tudo ok»).

## 2. A bateria de conformidade (demonstração)

O que prova: o que não se pode simular — identidade, direitos, as duas camadas, o fecho por posição, a marca
reenviada. **Doze provas**: as oito da casa + as quatro deste venue.

```
# pré-requisito: tokens válidos no ficheiro referenciado pela conta
bash tools/verificar-conector/bateria.sh --conector ctrader --ambiente demonstracao
```

**Esperado**, com os números crus no relatório (em `brokers/ctrader/conformidade/<versao>-<data>.json`):

1. arranque: os oito portões + identidade, direitos e duas camadas;
2. **identidade recusada** com `ctidTraderAccountId` que não é o do ficheiro;
3. sonda e manifesto: instrumentos com deslistados, e os números do venue;
4. **duas camadas**: sessão derrubada (rotação de token), transporte vivo → **zero envios**;
5. re-autenticação → **lê a conta antes** de aceitar pedido;
6. boleta fora do passo → recusa nomeada, **zero ordens** no venue;
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
| relatório da bateria | `brokers/ctrader/conformidade/` (fora do git) | prova a prova: comando, saída crua, veredicto; **por versão**, sem reescrever as anteriores |
| linha de base | `specs/005-conector-ctrader/relatorios/linha-de-base.txt` | o estado do portão e do contrato **antes** da implementação |
| registo da corrida | `scratch/corrida-<conector>/registo.jsonl` | as linhas do contrato que o conector entregou (para o `tools/relatar-corrida.sh`) |

## 4. O que fazer quando falha

- **A bateria recusa correr** → falta token, ou a conta não é de demonstração, ou o id não confere. Ler o motivo:
  ele diz **qual** dos três.
- **Uma prova discorda da bancada offline** → a offline está errada (é a que lê fixtures gravados): corrigir o
  caso, nunca a prova do venue.
- **`desconhecida` a mais** → olhar o prazo declarado (research R9) antes de olhar o código: um prazo curto numa
  rede má produz dúvidas legítimas.
