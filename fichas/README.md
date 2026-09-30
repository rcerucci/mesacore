# As fichas — UM ficheiro por par (decisão do dono, 30/09/2026)

    fichas/<PAR>.json

**Cabeçalho padrão, igual em qualquer setup**: `conta`, `corretora`, `ambiente`, `endereco`, `instrumento`,
`relogio`, `saldo_pct`, `alavancagem`, `bandas`, `prazo_de_resposta_ms`. Depois, **as constantes daquele
indicador** (`ma_len`, `ma_tipo`, `src_ma`, `src_sinal`, `usar_banda`, `banda_atr`, `usar_zz`, `zz_atr`, `atr_len`).

Quem decide o relógio é esta ficha, por par: o mesmo setup corre em `fichas/BTC.json` (1h) e em
`fichas/ETH.json` (30m) sem uma linha de código mudar.

**A credencial não mora aqui.** Vive em `config/contas/<conta>.json`, fora do git — a ficha diz o NOME da
conta, o ficheiro da conta diz a chave.

> Nota (30/09/2026): a espec (`docs/regra-de-negocio.md`, RN-M6) dizia "dois arquivos, um de risco e um do
> setup". O dono decidiu **um ficheiro só, com cabeçalho padrão + as constantes do indicador** — e o código
> do arranque (`core/ciclo/arranque.ts`) já lia a ficha como um objecto só. A espec leva emenda datada.
