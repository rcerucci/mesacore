# setups

Um diretório por setup: `setups/<nome>/`.

Cada setup entrega:

- a **regra**: o lado (buy, sell, hold, caixa) e o seu **relógio** (RN-S1, RN-S2);
- o **template de configuração**: um item por parâmetro (nome, tipo, unidade, omissão, significado) —
  toda a estratégia vive aí, inclusive se há stop ou não (RN-S3);
- **os dois arquivos de configuração por instrumento**: o de **risco**, de forma fixa (schema do core:
  percentagem do saldo, alavancagem, distância mínima de liquidação, janela, bandas) e o **seu**, cuja
  forma publica no template (RN-S10, RN-S11);
- o **schema do seu próprio estado**, com namespace e versão `estado/<setup>/<versão>/<instrumento>`
  (RN-S6);
- os seus **testes**.

Regras que estes diretórios DEVEM cumprir:

- importam `contracts`; NUNCA `core` (RN-E1);
- **a linguagem do plugin é decisão da spec deste setup** (RN-E16): ele fala a mensagem do contrato e
  declara a versão que fala (RN-E18). Nenhum setup é obrigado à linguagem do core;
- não vêem tamanho, risco, execução nem a corretora (RN-S1, RN-M4.1);
- não mandam na boleta: quem a preenche é a mesa (RN-S9);
- variantes são **fichas** do mesmo plugin, não plugins novos (RN-S5).

O primeiro a entrar aqui é o setup de referência (sigma), que passa a ser uma fonte de consulta e de
vectores de replay — não código a copiar.
