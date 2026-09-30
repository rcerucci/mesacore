# As fichas — uma pasta por par, DOIS arquivos (RN-M6)

    fichas/<PAR>/risco.json   ARQUIVO DE RISCO  — do dono, forma fixa (RN-S10): percentagem do saldo,
                              alavancagem, distancia minima de liquidacao, e as BANDAS onde os itens do
                              setup tem de caber. O setup SERVE-O; nao o inventa.
    fichas/<PAR>/setup.json   ARQUIVO DO SETUP  — os parametros de estrategia DAQUELE par, na forma que o
                              setup publica (RN-S3). Inclui a JANELA: o relogio e' decisao da ficha de
                              parametros, por par.

O mesmo setup corre em pares diferentes com relogios diferentes (BTC 1h, ETH 30m): so muda a ficha.
