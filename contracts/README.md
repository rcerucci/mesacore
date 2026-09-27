# contracts

As portas do sistema, e só isso:

- a porta do **setup** (o que a mesa lhe entrega e o que ela aceita de volta: a proposta e o template);
- a porta do **conector** (a boleta, o desfecho, o manifesto de capacidades, as leituras de conta);
- o **objecto normalizado** de mercado e conta (RN-D1 a RN-D5);
- a **boleta** (RN-B1 a RN-B6) e os seus campos.

Nada aqui conhece as tripas da mesa, o nome de um setup ou o nome de uma corretora. Quem importa:
`core`, `setups/<nome>` e `brokers/<nome>`. Quem é importado por este diretório: ninguém (RN-E1).
