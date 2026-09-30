# As fichas — `fichas/<SETUP>/<PAR>-<CONTA>.json`

    fichas/sigma/SOL-hl-real-sol.json          conta hl-real-sol    (hyperliquid)
    fichas/sigma/SOL-hl-real-sol-2.json        conta hl-real-sol-2  (hyperliquid) ← 2ª conta, mesma corretora
    fichas/sigma/SOL-ctrader-real-sol.json     conta ctrader-real-sol (ctrader)

**O `setup` agrupa; a `CONTA` nomeia.** Sem pasta por conta: duas contas na mesma corretora são dois nomes de
ficheiro, não duas árvores. A conta é o nome do ficheiro de credencial (`config/contas/<conta>.json`), e é o
mesmo nome aqui, no nome do ficheiro e no cabeçalho.

**O cabeçalho é a verdade; o nome é para o olho.** Se a conta do nome e a do cabeçalho não baterem, o operador
**recusa** — um ficheiro renomeado passaria a mentir em silêncio.

**O setup vive no cabeçalho** (`cabecalho.setup`), não na linha de comandos. É isso que permite um operador só
servir setups diferentes por par na mesma conta.

## O que o operador lê

Cabeçalho padrão: `conta`, `corretora`, `ambiente`, `endereco`, `instrumento`, `setup`, `relogio`, `run`,
`ao_desligar`, `saldo_pct`, `alavancagem`, `bandas`, `prazo_de_resposta_ms`. Depois, as **constantes do
indicador**.

- **`run`** — só as fichas ligadas se calculam. Desligar um par é editar uma linha.
- **`ao_desligar`** — `fechar` (decisão do dono): par desligado com posição viva ⇒ o setup propõe `caixa`.
- **`relogio`** — é a ficha que decide, por par: o mesmo setup a 1h num par e a 30m noutro.

## Ao setup vai só isto

`constantes` e `relogio`, com o instrumento. **Nunca** o `saldo_pct`, a `alavancagem` nem as bandas (RN-M4.1).
