# As fichas — uma PASTA POR CONTA, um ficheiro por par

    fichas/<CONTA>/<PAR>-<setup>.json

**A chave de uma ficha é (CONTA, PAR, SETUP)** — e é a conta que traz a corretora. Sem a conta no caminho,
`SOL-sigma` no Hyperliquid e `SOL-sigma` no cTrader seriam o mesmo nome para duas coisas diferentes:

    fichas/hl-real-sol/SOL-sigma.json         conta hl-real-sol (hyperliquid)
    fichas/ctrader-real-sol/SOL-sigma.json    conta ctrader-real-sol (ctrader)

**Cabeçalho padrão, igual em qualquer setup**: `conta`, `corretora`, `ambiente`, `endereco`, `instrumento`,
`setup`, `relogio`, `run`, `ao_desligar`, `saldo_pct`, `alavancagem`, `bandas`, `prazo_de_resposta_ms`.
Depois, **as constantes daquele indicador**.

- **`run`** — é o plugin (por via do operador) que o lê: percorre as fichas da conta e só calcula as que estão
  ligadas. Desligar um par é editar uma linha, não mexer em código.
- **`ao_desligar`** — `fechar` (decisão do dono): par desligado **com posição viva** ⇒ o setup propõe `caixa`,
  a mesa fecha com `reduce_only`. Se o dono já fechou à mão e desligou, não há nada a fazer — e o sistema não
  grita por isso.
- **`relogio`** — é a ficha que o decide, por par: o mesmo setup corre a 1h no BTC e a 30m no ETH.
- **A credencial não mora aqui**: vive em `config/contas/<conta>.json`, fora do git.

## O limite que fica dito

Numa **mesma conta**, um par tem **uma ficha** (RN-M6), e é por isso que a operação do ciclo é indexada pelo
instrumento. Correr **dois setups no mesmo par da mesma conta** não é um segundo ficheiro: é **outra sessão**
(RN-V10 — "mudar ficha ou setup exige sessão nova; é isso que permite comparar o resultado de dois setups em
vez de os somar"). Entre contas diferentes, não há conflito nenhum.
