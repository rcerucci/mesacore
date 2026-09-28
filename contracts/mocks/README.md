# contracts/mocks

Um **setup falso** e um **conector falso** (RN-E17). Não operam: existem para **provar a fronteira**, e é
aqui que a prova de contrato acontece — a prova contra a corretora de verdade é a bateria de conformidade
em `brokers/<nome>/` (RN-C6).

O que cada mock tem de exercer:

- **setup falso** — devolve os quatro valores (`buy`, `sell`, `hold`, `caixa`), publica um template com
  itens de tipos diferentes, e sabe ser **inválido** de propósito (quinto valor, silêncio, excepção) para
  que a mesa seja testada no congelamento (RN-S8, RN-T10);
- **conector falso** — declara um manifesto, traduz a boleta, devolve **resolução antes de executar** e
  produz os quatro desfechos (aceite, parcial, desconhecido, recusado), incluindo a resposta que **não
  chega** (RN-T7.1).

O que o torna uma prova e não uma encenação:

- **pelo menos um dos mocks é escrito noutra linguagem** que não a do core — é isso que prova que o
  contrato é neutro (RN-E16), em vez de o afirmar;
- cada mock **declara a versão do contrato** que fala, e a mesa confere-a no arranque (RN-E18) — há um
  mock que declara uma versão **incompatível**, para a recusa ser testada;
- dinheiro e percentagem atravessam como **decimal textual** (RN-E19), com um caso que falharia se
  alguém os passasse a vírgula flutuante.
