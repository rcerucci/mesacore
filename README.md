# MesaCore

A mesa de operações: um terminal de execução com duas pontas de plugin.

- **O que faz:** recebe do *setup* uma proposta de lado (buy, sell, hold, caixa), transforma-a numa
  *boleta* e leva-a à corretora, sob um *mandato* declarado pelo dono. Reconcilia a posição, registra
  tudo e trata os desfechos (aceite, parcial, desconhecido, recusado).
- **O que não faz:** não decide estratégia, não calcula sinal nem indicador, não guarda posição, não é
  a corretora. A mesa pensa como um operador: tamanho, risco, papel, registro. O lado vem de fora.

## Os cinco anéis

| Anel | Decide | Fala com |
|---|---|---|
| Mandato (o dono) | instrumento, risco, tamanho, stop, janela | a mesa, por arquivo de configuração |
| Mesa (este projeto) | nada de estratégia: normaliza, preenche a boleta, envia, reconcilia, registra | setup e conector |
| Setup (plugin) | o lado: buy / sell / hold / caixa | só a mesa |
| Boleta | — | é o documento que atravessa mesa → conector |
| Conector (plugin) | nada: traduz e transporta | a corretora |

## Estado

- `docs/regra-de-negocio.md` — a regra detalhada (fonte da verdade das regras). **Rascunho v1 para
  revisão do dono.**
- As especificações são escritas depois, com o Spec Kit (`.specify/`), uma por recorte, e cada uma
  referencia as regras `RN-*` deste documento.

## Ordem de trabalho

1. Regra de negócio detalhada (este repositório, `docs/`).
2. Constituição do projeto (Spec Kit) — deriva da regra.
3. Especificações por recorte: mandato, contrato de dados, mesa, boleta, conector, ledger.
4. Implementação.

## Referência

O motor que roda hoje (`~/Projects/jev-trade-fusao`, repo `hl-jev`) é fonte de **consulta** — não é
base de código. Serve para os casos que só se sabem por ter corrido contra a corretora de verdade, e
continua a operar a conta até este terminal passar nos vectores de aceite.
