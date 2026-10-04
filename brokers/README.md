# brokers

Um diretório por corretora: `brokers/<nome>/`.

Cada conector entrega:

- o **manifesto de capacidades**, sondado no arranque e nunca constante de código: instrumentos e
  unidades (mínimo, passo, tick), tipos de ordem, política de parcial, desvio máximo, reduce-only
  nativo ou não, stop anexo ou não, profundidade de livro, funding, relógio de fecho de barra,
  idempotência (RN-C1);
- o **`questionario.json`** — os campos da CONTA deste venue, declarados pelo próprio conector: id, chave, tipo,
  se é obrigatório, o que aceita (opções), a omissão e a explicação. É a fonte da entrevista de linha de comando
  (`tools/preparar-contas`) **e** do formulário de criar conta da tela — acrescentar um conector é acrescentar um
  ficheiro, sem se tocar na tela. Um campo de tipo `segredo` declara só o campo (o valor vive fora do repositório,
  em ficheiro protegido); um campo `sensivel: true` é um CAMINHO para esse valor (a declaração viaja, o valor não);
- a **tradução** da boleta e o **transporte**: a mesa manda percentagem do saldo, alavancagem e
  percentagens de movimento; o conector resolve em quantidade da sua unidade, atende à especificação
  de ordem da sua corretora e cuida dos cálculos dela (RN-C9);
- a **resolução** que devolve antes de executar: quantidade, nocional, margem, alavancagem efectiva e
  preço de liquidação (RN-C10) — é ela que a mesa confere contra a banda e grava no ledger;
- o **desfecho normalizado** (aceite, parcial, desconhecido, recusado) com motivo na recusa (RN-C2);
- as **leituras** de posição, equity e marcas;
- a **bateria de conformidade** de **oito** provas (RN-C6) e as suas fixtures.

Regras que estes diretórios DEVEM cumprir:

- importam `contracts`; NUNCA `core` (RN-E1);
- **a linguagem do plugin é decisão da spec deste conector** (RN-E16): ele fala a mensagem do contrato e
  declara a versão que fala (RN-E18). É esta liberdade que permite um conector de MT5 correr onde o MT5
  corre, sem arrastar o core atrás;
- nunca adaptam uma boleta em silêncio (RN-C3) e não decidem nada: não alteram lado, quantidade,
  preço nem momento (RN-C5);
- sem estado em disco próprio: a posição lê-se da corretora, a durabilidade mora no ledger (RN-T8);
- o primeiro a entrar aqui é o conector da Hyperliquid, que já sabemos fazer — fonte de consulta para
  o que só se aprende correndo contra o venue.
