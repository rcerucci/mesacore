# MesaCore

A mesa de operações: um terminal de execução com duas pontas de plugin.

- **O que faz:** recebe do *setup* uma proposta de lado (buy, sell, hold, caixa), transforma-a numa
  *boleta* e leva-a à corretora, sob um *mandato* declarado pelo dono. Reconcilia a posição, registra
  tudo e trata os desfechos (aceite, parcial, desconhecido, recusado).
- **O que não faz:** não decide estratégia, não calcula sinal nem indicador, não guarda posição, não é
  a corretora. A mesa pensa como um operador: tamanho, risco, papel, registro. O lado vem de fora.

## Os cinco anéis

| Anel | Decide | NUNCA faz |
|---|---|---|
| Mandato (o dono) | instrumentos, conta, perda máxima, capital, teto de nocional | não decide estratégia nem stop |
| Mesa (este projeto) | normaliza, preenche a boleta, envia, reconcilia, registra, executa o mandato | não escolhe lado, tamanho nem risco |
| Setup (plugin) | o lado, **e a estratégia pelo seu template** (stop, janela, limiares) | não vê tamanho, risco, execução nem a corretora |
| Boleta | — | é documento, não decisão |
| Conector (plugin) | nada de estratégia: traduz a boleta (percentagem do saldo, alavancagem, % de movimento) em quantidade, preço e pontos da **sua** corretora | não altera lado nem momento; nunca arredonda em silêncio |

**O core não conhece nenhum parâmetro de estratégia por nome.** Um setup com stop e um setup sem stop
são o mesmo tipo de plugin: o que a mesa lê é o **template** que cada um publica. É isto que impede o
core de engessar os setups — e é por isso que as variantes de um setup são apenas **fichas**.

## Estrutura

```
/contracts      as portas: setup, conector, objecto normalizado, boleta, desfecho
/core           a mesa (ciclo, boleta, ledger, mandato, servidor) e o vigia (start/stop/pause/reset/nova_sessao)
/setups/<nome>  o plugin, o template de configuração, o schema do seu estado, os testes
/brokers/<nome> o conector, o manifesto, a bateria de conformidade, as fixtures
/config         os arquivos do dono: config macro da conta e fichas (risco + setup)
/tools          os estudos do dono sobre um instrumento, sem operar
/web            a superfície
/docs           a regra de negócio e as especificações
```

**Dois trilhos, dois donos.** O trilho das **decisões** é o nosso ledger (snapshot, proposta, boleta,
resolução, desfecho) — é o que permite re-correr o setup e comparar boletas. O trilho do **dinheiro**
(execuções, taxas, funding, resultado realizado) é o da **corretora**, que já o faz por ofício: a mesa
lê e mostra, nunca reconstrói.

Regra de dependência: setups e brokers importam `contracts`; `core` importa `contracts`; **ninguém
importa `core`** (verificado por teste).

## Estado

- `docs/regra-de-negocio.md` — **v2**, a regra detalhada (fonte da verdade). Regras `RN-M*` (mandato),
  `RN-S*` (setup), `RN-T*` (mesa), `RN-D*` (dados), `RN-B*` (boleta), `RN-C*` (conector), `RN-L*`
  (ledger) e `RN-E*` (estrutura e topologia).
- Especificações: ainda não escritas. Serão feitas com o Spec Kit (`.specify/`), uma por recorte, cada
  uma referenciando as regras `RN-*`.

## Ordem de trabalho

1. Regra de negócio detalhada (este repositório, `docs/`).
2. Constituição do projeto (Spec Kit) — deriva da regra.
3. Especificações por recorte: mandato, contrato de dados, setup, mesa, boleta, conector, ledger.
4. Implementação.

## Referência

O motor que roda hoje (`~/Projects/jev-trade-fusao`, repo `hl-jev`) é fonte de **consulta** — não é
base de código. Serve para os casos que só se sabem por ter corrido contra a corretora de verdade, e
continua a operar a conta até este terminal passar nos vectores de aceite.
