# brokers

Um diretório por corretora: `brokers/<nome>/`.

Cada conector entrega:

- o **manifesto de capacidades**, sondado no arranque e nunca constante de código: instrumentos e
  unidades (mínimo, passo, tick), tipos de ordem, política de parcial, desvio máximo, reduce-only
  nativo ou não, stop anexo ou não, profundidade de livro, funding, relógio de fecho de barra,
  idempotência (RN-C1);
- a **tradução** da boleta e o **transporte**;
- o **desfecho normalizado** (aceite, parcial, desconhecido, recusado) com motivo na recusa (RN-C2);
- as **leituras** de posição, equity e marcas;
- a **bateria de conformidade** de sete provas (RN-C6) e as suas fixtures.

Regras que estes diretórios DEVEM cumprir:

- importam `contracts`; NUNCA `core` (RN-E1);
- nunca adaptam uma boleta em silêncio (RN-C3) e não decidem nada: não alteram lado, quantidade,
  preço nem momento (RN-C5);
- sem estado em disco próprio: a posição lê-se da corretora, a durabilidade mora no ledger (RN-T8);
- o primeiro a entrar aqui é o conector da Hyperliquid, que já sabemos fazer — fonte de consulta para
  o que só se aprende correndo contra o venue.
