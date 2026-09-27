# core

A mesa: o que não muda com o setup nem com a corretora.

- o **ciclo** (ler mercado, eventualmente consultar o setup, agir, registrar);
- a **normalização** do mercado e da conta num objecto único (RN-T1, RN-T3);
- o **mandato da conta** e a sua execução: perda máxima, percentagem do saldo, alavancagem máxima,
  distância mínima de liquidação, inibição (RN-M*);
- a **boleta**: preenchimento em unidades neutras (percentagem do saldo, alavancagem, % de movimento),
  verificação contra o manifesto, envio e desfecho (RN-B*, RN-T6, RN-T7);
- a **conferência da resolução** do conector contra a banda, antes de executar (RN-M4.5);
- a **reconciliação** com a corretora (RN-T8);
- o **ledger** (RN-L*);
- o **servidor de leitura** para a web e a publicação da identidade da mesa (RN-E8);
- o **vigia** (segundo ponto de entrada): start, stop, pause e reset (RN-V1 a RN-V6).

Este diretório NUNCA converte nada para unidades de corretora — quantidade, contrato, lote, ponto,
tick ou preço absoluto são do conector (RN-B0). Se aparecer aritmética de corretora aqui, o desenho
está errado.

Regras que este diretório DEVE cumprir:

- importa `contracts` e **nada mais** do projeto: NUNCA um setup nem um broker (RN-E2);
- não conhece nenhum parâmetro de estratégia por nome — só o template que o setup publica (RN-S4);
- não faz nenhuma conta que a web faria outra vez (RN-E9);
- é indiferente à topologia: não sabe quantos processos existem (RN-E6).
