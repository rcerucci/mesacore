# tools

Os **estudos do dono**: ferramentas que medem um instrumento **sem operar** (RN-E13).

Servem para escolher números de risco com medição, em vez de palpite — é delas que saem a distância
mínima de liquidação, a percentagem do saldo e as bandas de stop de cada ficha.

Exemplos do que um estudo responde:

- volatilidade por sessão e amplitude típica do par (a base para decidir `distancia_minima_liquidacao`);
- faixa histórica de variação por sessão (a base para decidir se faz sentido empenhar 100% do saldo a
  1x num par calmo);
- **custo de carregar posição**: funding/swap ao longo do tempo, que é o que decide a viabilidade de um
  setup de várias sessões — e para isso o funding tem de aparecer **separado** no histórico (RN-D6).

Regras que este diretório DEVE cumprir:

- **não opera**: não recebe chaves de execução, não manda ordem, não toca em posição. Lê dados pelo
  contrato de dados (RN-D1) e escreve relatório;
- **não é plugin de broker nem setup**: não entra no caminho da operação; se estiver parado, a mesa
  opera igual;
- todo relatório é **datado**; um número de risco escolhido a partir dele **registra qual estudo o
  sustentou** — estudo sem data não sustenta número nenhum;
- o histórico que consome vem da corretora ou do ledger, **nunca reconstruído** por nós (RN-D6).
