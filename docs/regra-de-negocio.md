# Regra de negócio — MesaCore

| | |
|---|---|
| Documento | Regra de negócio do terminal de execução (a mesa) e dos seus dois plugins |
| Versão | v1 (rascunho para revisão do dono) |
| Data | 27 set 2026 |
| Papel | **Fonte da verdade das regras.** As especificações do Spec Kit derivam daqui, uma por recorte, e cada uma referencia as regras `RN-*` citadas. |

Convenção de leitura: cada regra é uma afirmação **verificável** (dá para escrever um teste que a
recusa). `DEVE` = não negociável. `NUNCA` = proibido, e a violação é defeito. Onde a regra depende de
uma decisão do dono ainda não tomada, está marcada `ABERTA`.

---

## 1. O que o sistema é

1.1. O sistema é um **terminal de execução**. Recebe de um *setup* uma proposta de lado — um de quatro
valores: **buy, sell, hold, caixa** —, transforma-a numa *boleta* e leva-a a uma corretora, sob um
*mandato* declarado pelo dono, e registra tudo o que se passou.

1.2. O sistema **NÃO** decide estratégia, **NÃO** calcula sinal nem indicador, **NÃO** guarda posição
própria (a posição verdadeira é a que a corretora reporta) e **NÃO** é a corretora.

1.3. A divisão de trabalho é absoluta, e cada anel só faz o que lhe pertence:

| Anel | Decide | NUNCA faz |
|---|---|---|
| **Mandato** (o dono) | instrumento, risco, tamanho, stop, janela de operação | nada em tempo real |
| **Mesa** (o terminal) | nada de estratégia: normaliza o mercado, preenche a boleta, envia, reconcilia, registra, executa o mandato | não escolhe lado, tamanho nem risco |
| **Setup** (plugin) | o lado: buy / sell / hold / caixa | não vê tamanho, risco, execução nem a corretora |
| **Boleta** | — | não é decisão de ninguém: é documento |
| **Conector** (plugin) | nada: traduz e transporta | não altera lado, quantidade, preço nem momento |

1.4. **A mesa pensa como um operador humano** (tamanho, risco, papel, registro); **o lado vem de
fora**. O setup pode ser uma regra de cruzamento de médias ou um modelo de linguagem — a mesa não
sabe nem precisa de saber.

---

## 2. Vocabulário

- **Mandato** — o que o dono declara: instrumento, limites de risco, tamanho, stop, janela.
- **Setup** — o plugin que propõe lado. Tem nome e versão.
- **Mesa** — este sistema: o terminal.
- **Ciclo** — uma passagem da mesa: ler mercado, (eventualmente) consultar o setup, agir, registrar.
  Tem identificador próprio.
- **Proposta** — o que o setup devolve: `buy`, `sell`, `hold` ou `caixa`.
- **Boleta** — o documento de ordem: o que a mesa quer que a corretora faça.
- **Desfecho** — o que a corretora responde: **aceite**, **parcial**, **desconhecido** ou **recusado**.
- **Conector** — o plugin que fala com a corretora. Tem nome e versão.
- **Instrumento** — símbolo + unidade + mínimo + passo + tick, conforme declarados pela corretora.
- **Ledger** — o registro append-only dos ciclos.

---

## 3. Fronteiras: o que cruza cada uma

| De → Para | O que cruza | Quem pode recusar |
|---|---|---|
| Dono → Mesa | mandato (arquivo de configuração) | a mesa, no arranque (valor fora de banda) |
| Corretora → Conector → Mesa | factos de mercado e conta, normalizados | o conector (falha) e a mesa (dado velho) |
| Mesa → Setup | o objecto normalizado de mercado e conta | ninguém: o setup recebe sempre o mesmo objecto |
| Setup → Mesa | a proposta (um de quatro valores) | a mesa (proposta inválida = hold registrado) |
| Mesa → Conector | a boleta | a mesa (sem capacidade declarada) e o conector (recusa da corretora) |
| Mesa → Ledger | snapshot, proposta, boleta, desfecho | ninguém |

3.1. **Uma normalização só.** A mesa normaliza uma vez e entrega **o mesmo objecto** ao setup e ao
humano. Duas contas para o mesmo número (PnL, velas, posição) são defeito, não otimização.

---

## 4. Regras do mandato (o dono fala)

- **RN-M1.** O mandato declara o instrumento, a corretora e a conta. A mesa DEVE recusar arrancar se o
  conector não declarar aquele instrumento.
- **RN-M2.** O mandato vive em arquivo de configuração do dono, versionado. O valor em vigor e a sua
  **origem** (arquivo ou ambiente) DEVEM ser registrados no arranque, para que a divergência entre o
  que se quis e o que corre nunca seja silenciosa.
- **RN-M3.** O mandato declara a **perda máxima** (drawdown) **e a janela da sua medição** (do pico de
  equity da sessão, do equity inicial do dia, ou outra `ABERTA`). Sem a janela declarada, a regra não
  entra em vigor.
  - **RN-M3.1.** Ao atingir o limite, a mesa DEVE liquidar a posição e entrar em estado de inibição:
    não abre nada novo até intervenção explícita do dono. O evento é registrado.
  - **RN-M3.2.** A verificação do limite é da mesa, **em cada ciclo**, e não depende do setup nem da
    sua proposta.
- **RN-M4.** O tamanho vem do mandato: base de capital, fatia por instrumento (com `n` instrumentos a
  base é dividida por `n`), alavancagem máxima e teto de nocional. Nocional = (base / n) × alavancagem,
  limitado pelo teto.
  - **RN-M4.1.** O setup NUNCA vê nem influencia o tamanho.
  - **RN-M4.2.** Tamanho que não caiba no instrumento (mínimo ou passo) DEVE ser recusado pela mesa,
    com registro. NUNCA se arredonda em silêncio.
- **RN-M5.** O mandato declara **stop**: existe ou não existe; se existe, a distância (`ABERTA`:
  percentagem do nocional ou preço absoluto). O stop é **campo da boleta**, não lógica do setup.
- **RN-M6.** O mandato declara a **janela de operação**. Fora dela a mesa não **abre**; fechar e
  reduzir são sempre permitidos, a qualquer hora.
- **RN-M7.** O mandato declara o **inventário máximo** por instrumento e se é permitido aumentar
  posição já aberta no mesmo sentido (`ABERTA`).
- **RN-M8.** O mandato em vigor é gravado no ledger. Ciclo sem mandato conhecido NUNCA abre posição.
- **RN-M9.** Valor de mandato fora de banda (zero, negativo, absurdo) DEVE fazer a mesa **recusar o
  arranque**. Validação é alarme que recusa, nunca autocorreção.

---

## 5. Regras da mesa (o terminal)

- **RN-T1.** A mesa recebe o mercado **do conector** e normaliza-o numa única representação: preços,
  livro, posição e equity, funding, tempo e idade do dado.
- **RN-T2.** A mesa entrega **factos**. NUNCA calcula indicadores, médias, classificações ou
  adjectivos para o setup. O setup calcula o que quiser sobre os factos.
- **RN-T3.** Todo ciclo tem identificador, que acompanha a proposta, a boleta, o desfecho e o registro.
- **RN-T4.** A mesa aceita da proposta exactamente quatro valores: `buy`, `sell`, `hold`, `caixa`.
  Qualquer outro valor (ou ausência) é **inválido**: a mesa trata como `hold` e registra a invalidade
  (`ABERTA`: quantos inválidos seguidos inibem a mesa até intervenção).
- **RN-T5.** **Quem decide quando o setup é consultado é o setup**: ele declara o seu relógio. Nos
  ciclos em que o setup não quer ser consultado, a mesa mantém a posição e NÃO re-cotiza.
- **RN-T6.** A mesa transforma a proposta em boleta **respeitando o mandato** (tamanho, stop, janela,
  inventário). Se o mandato proíbe, a mesa NÃO envia e registra o motivo.
- **RN-T7.** O desfecho tem quatro estados, e são tratados de forma diferente:
  - **aceite** — a ordem vive na corretora;
  - **parcial** — executou parte; o que fazer com o resto é campo da boleta;
  - **desconhecido** — sem confirmação (prazo esgotado, ligação caída);
  - **recusado** — a corretora devolveu motivo, que é normalizado e registrado.
  - **RN-T7.1.** **Desconhecido NUNCA é sucesso nem falha.** A mesa DEVE reconciliar antes de qualquer
    ordem nova; enquanto não reconciliar, não envia.
  - **RN-T7.2.** No máximo **uma ordem por ciclo**.
- **RN-T8.** Em cada ciclo a mesa **reconcilia** com a corretora: a posição verdadeira é a da
  corretora. A mesa não mantém posição própria como fonte de verdade.
- **RN-T9.** A mesa executa o mandato **à risca, mesmo contra o setup**: o setup propõe, o mandato
  dispõe.
- **RN-T10.** Falha de comunicação com o setup: a mesa **congela** — não envia ordem nova e não cancela
  o que já serve — e registra o motivo. Congelar é a resposta, nunca continuar com o último valor.
- **RN-T11.** A mesa NUNCA abre posição sem ciclo válido, mandato em vigor e instrumento declarado.
- **RN-T12.** A mesa NUNCA deixa de registrar um ciclo, inclusive os que não geram ordem.

---

## 6. Regras do contrato de dados (corretora → mesa → setup)

- **RN-D1.** O objecto normalizado contém apenas factos: preço (bid, ask, último), livro quando a
  corretora o der (com a profundidade declarada), posição e equity, funding quando existir, o tempo do
  venue e a **idade** do dado.
- **RN-D2.** Unidades normalizadas: unidade base do instrumento, USD e tempo em UTC (ms). Quem converte
  é o conector, e ele **declara o arredondamento** que aplica.
- **RN-D3.** Dado com idade acima do limite declarado **invalida o ciclo**: a mesa pode fechar e
  reduzir, NUNCA abrir com dado velho.
- **RN-D4.** Nada é inventado: feature que a corretora não dá vem como **ausente**, nunca como valor
  neutro calculado pela mesa. É o setup que decide o que fazer com a ausência.
- **RN-D5.** O setup e o humano vêem o mesmo objecto, no mesmo instante lógico (ver 3.1).

---

## 7. Regras da boleta

Campos: ciclo, instrumento, lado, tipo, quantidade (na unidade do instrumento), preço (quando
limite), política de execução parcial, desvio máximo, reduce-only, stop (quando o mandato manda),
referência do cliente.

- **RN-B1.** A boleta é o documento; **a execução é do conector**.
- **RN-B2.** A boleta vai para o ledger **integral**, junto com a resposta da corretora. É o que
  permite re-correr o setup e comparar **boletas**, em vez de comparar código.
- **RN-B3.** Antes de enviar, a mesa verifica a boleta contra o **manifesto do conector** (RN-C1). Sem
  capacidade declarada para o que a boleta pede, a mesa **recusa** — não adapta.
- **RN-B4.** A quantidade DEVE ser honrada dentro do erro declarado pelo conector, ou a boleta é
  recusada. NUNCA há arredondamento silencioso: arredondar para baixo pode dar zero (ordem que nunca
  existe, mesa a pensar que entrou) e para cima dá posição maior do que o mandato autorizou.
- **RN-B5.** `reduce-only` é **intenção**. Onde a corretora não a garante nativamente, a garantia é da
  mesa: nunca enviar mais do que a posição e reconciliar depois.
- **RN-B6.** A política de execução parcial (tudo-ou-nada / o-que-der) é campo obrigatório da boleta,
  porque altera o desfecho da entrada. Sem ela declarada, a boleta não sai.

---

## 8. Regras do conector (a corretora)

- **RN-C1.** O conector declara um **manifesto mínimo**, **sondado** no arranque (nunca constante de
  código): instrumentos e unidades (mínimo, passo, tick); tipos de ordem disponíveis; política de
  execução parcial suportada; desvio máximo; se garante `reduce-only` nativamente; se aceita stop
  anexado à ordem; profundidade de livro; funding; relógio do fecho de barra; e se tem idempotência.
- **RN-C2.** O conector devolve SEMPRE um desfecho normalizado; a recusa traz motivo.
- **RN-C3.** O conector NUNCA adapta uma boleta em silêncio.
- **RN-C4.** Reenvio com a mesma referência de cliente não duplica ordem. Quando a corretora não tiver
  idempotência, a mesa NUNCA reenvia sem reconciliar antes.
- **RN-C5.** O conector não decide nada: não altera lado, quantidade, preço nem momento.
- **RN-C6.** Cada conector DEVE passar a **bateria de conformidade**, por corretora e por versão:
  1. ordem passiva no toque assenta e **não cruza** (ou a corretora recusa, por não ter essa capacidade);
  2. prazo esgotado → o resto chega numa única ordem agressiva, dentro do desvio declarado;
  3. **fechar é fechar**: nunca vira posição;
  4. recusa explícita (abaixo do mínimo, margem insuficiente) — nunca silêncio;
  5. reenvio com a mesma referência não duplica;
  6. reconexão com posição aberta → a mesa retoma a posição que a corretora reporta;
  7. o **relógio de fecho de barra** da corretora é conferido contra UTC e o desvio é publicado.
- **RN-C7.** O resultado da bateria é registrado por versão. Mudança de condições na corretora tem de
  ser **detectada**, não sofrida.

---

## 9. Regras do ledger

- **RN-L1.** Envelope comum a todas as linhas: ciclo, instante, instrumento, tipo de linha, mandato em
  vigor, versão da mesa, nome e versão do conector, nome e versão do setup.
- **RN-L2.** Por ciclo grava-se: **snapshot normalizado, proposta do setup, boleta e desfecho**. Nada
  mais.
- **RN-L3.** O que é privado do setup vive dentro de um campo próprio (`payload`), NUNCA no envelope.
  O envelope não conhece o vocabulário de nenhum setup.
- **RN-L4.** As linhas são de acréscimo (append-only). O desfecho de um ciclo pode ser escrito mais
  tarde e a escrita é **idempotente**.
- **RN-L5.** O ledger é a base de reprodutibilidade: re-correr o setup sobre o snapshot DEVE produzir a
  mesma proposta.

---

## 10. O que fica de fora (por decisão, não por esquecimento)

- A regra do sinal, os indicadores, as médias, a classificação e os adjectivos — são do **setup**.
- Circuit breaker, veto de pavio, limiares de confiança e hostilidade — são do **setup** que os
  declarar; a mesa não os conhece por nome.
- Escolha de corretora, instrumento e conta — é do **mandato**.
- Hedge, correlação e gestão de carteira — não existem nesta versão.
- Hipóteses já enterradas no projeto de referência (decisão a cada 5 minutos, canal `u`, famílias
  derivadas) — não se reabrem.

---

## 11. Como se sabe que está cumprida

- Cada regra `RN-*` DEVE ter um teste que a **recusa quando falhada**. Regra sem teste não está em
  vigor.
- Dois arneses de aceite:
  1. **replay** sobre o material gravado do motor de referência (snapshot + boleta + desfecho),
     comparando propostas e boletas;
  2. **bateria de conformidade** por conector (RN-C6), corrida em ambiente de teste da corretora.
- A mesa nova só substitui o motor que roda a conta quando os dois arneses passarem.

---

## 12. Rastreabilidade e referência

- O motor que roda hoje (`~/Projects/jev-trade-fusao`, repo `hl-jev`) é **fonte de consulta** para o
  que só se sabe por ter corrido contra a corretora de verdade: a mecânica de ordem passiva seguida de
  agressiva, a forma do estado da conta, a conversão de tamanho para o tick do instrumento, o
  comportamento em queda de ligação, e as unidades. Citado por `arquivo:linha` quando uma spec
  precisar do caso concreto.
- Os números de ensaio do motor de referência (fills, ciclos, custos) pertencem ao **setup** que os
  produziu: são vectores do replay, não regra da mesa.
- Este documento é a primeira peça. A constituição do projeto e as especificações vêm depois, com o
  Spec Kit, e não podem contradizer nenhuma regra `RN-*` daqui.

---

## 13. Perguntas abertas para o dono

1. **Janela da perda máxima** (RN-M3): do pico da sessão, do equity do início do dia, ou outra.
2. **Stop** (RN-M5): existe? em percentagem do nocional ou em preço absoluto? quem o move, se o preço
   andar a favor?
3. **Aumentar posição** no mesmo sentido (RN-M7): permitido ou proibido.
4. **Propostas inválidas** (RN-T4): quantas seguidas inibem a mesa até intervenção.
5. **Mandato por instrumento ou por processo?** (afeta a fatia de capital de RN-M4).
6. **Funding/swap** (RN-D1): entra no cálculo do resultado do ciclo ou é apenas registrado?
