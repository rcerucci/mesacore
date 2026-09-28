# contracts

As portas do sistema, e só isso — e o **schema** delas é **neutro de linguagem** (RN-E16):

- a porta do **setup** (o que a mesa lhe entrega e o que ela aceita de volta: a proposta e o template);
- a porta do **conector** (a boleta, a resolução, o desfecho, o manifesto de capacidades, as leituras);
- o **objecto normalizado** de mercado e conta (RN-D1 a RN-D5);
- a **boleta** (RN-B1 a RN-B8) e os seus campos, com o prazo da passiva e o destino do resto;
- a **versão do contrato**, que cada ponta declara e a mesa confere no arranque (RN-E18).

O schema é a **fonte**: o core (TypeScript) e o `/tools` (Python) geram dele o que precisam, e um plugin
pode ser escrito em qualquer linguagem que fale a mensagem — a linguagem decide-se na **spec daquele
plugin** (RN-E16). No contrato, dinheiro e percentagem viajam como **decimal textual**, nunca como
vírgula flutuante (RN-E19), para que duas linguagens cheguem ao mesmo número.

`mocks/` traz um **setup falso** e um **conector falso** que provam as fronteiras (RN-E17). Pelo menos um
deles é escrito **noutra linguagem** que não a do core: é isso que prova a neutralidade, em vez de a
afirmar. A prova de contrato é aqui; a prova contra a corretora de verdade é a bateria de conformidade
(RN-C6), em `brokers/<nome>/`.

Nada aqui conhece as tripas da mesa, o nome de um setup ou o nome de uma corretora. Quem importa:
`core`, `setups/<nome>` e `brokers/<nome>`. Quem é importado por este diretório: ninguém (RN-E1).
