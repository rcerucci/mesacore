# Regra de negócio — MesaCore

| | |
|---|---|
| Documento | Regra de negócio do terminal de execução (a mesa) e dos seus dois plugins |
| Versão | v2 (rascunho para revisão do dono) |
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
| **Mandato** (o dono) | instrumentos, conta e corretora, perda máxima, capital base, teto de nocional | não decide estratégia, stop nem limiares de setup |
| **Mesa** (o terminal) | nada de estratégia: normaliza o mercado, preenche a boleta, envia, reconcilia, registra, executa o mandato | não escolhe lado, tamanho nem risco |
| **Setup** (plugin) | o lado (buy / sell / hold / caixa) **e todo o parâmetro de estratégia, pelo seu template**: stop sim/não, distância, janela, limiares, parcial, aumentos | não vê tamanho, risco, execução nem a corretora |
| **Boleta** | — | não é decisão de ninguém: é documento |
| **Conector** (plugin) | nada: traduz e transporta | não altera lado, quantidade, preço nem momento |

1.4. **A mesa pensa como um operador humano** (tamanho, risco, papel, registro); **o lado vem de
fora**. O setup pode ser uma regra de cruzamento de médias ou um modelo de linguagem — a mesa não
sabe nem precisa de saber.

1.5. **O core não conhece nenhum parâmetro de estratégia por nome.** Um setup que usa stop e um setup
que nunca usa stop são o mesmo tipo de plugin: o que a mesa lê é o **template** que cada um publica
(§5). É esta indiferença que impede o core de engessar os setups.

---

## 2. Vocabulário

- **Mandato** — o que o dono declara: instrumentos, conta, limites de risco e capital.
- **Setup** — o plugin que propõe lado e publica o seu template de configuração. Tem nome e versão.
- **Ficha** — uma configuração concreta de um setup (o mesmo plugin com parâmetros diferentes).
- **Mesa** — este sistema: o terminal. Uma mesa corre uma conta.
- **Ciclo** — uma passagem da mesa: ler mercado, (eventualmente) consultar o setup, agir, registrar.
  Tem identificador próprio.
- **Proposta** — o que o setup devolve: `buy`, `sell`, `hold` ou `caixa`.
- **Boleta** — o documento de ordem: o que a mesa quer que a corretora faça.
- **Desfecho** — o que a corretora responde: **aceite**, **parcial**, **desconhecido** ou **recusado**.
- **Conector** — o plugin que fala com a corretora. Tem nome e versão.
- **Instrumento** — símbolo + unidade + mínimo + passo + tick, conforme declarados pela corretora.
- **Nocional** — o valor de exposição da posição (quantidade × preço). É isto que o mandato limita.
- **Distância de liquidação** — quanto o preço tem de andar contra a posição para a corretora a
  liquidar. Resulta da alavancagem que a corretora aplica, não de uma escolha nossa.
- **Ledger** — o registro append-only dos ciclos.

---

## 3. Fronteiras: o que cruza cada uma

| De → Para | O que cruza | Quem pode recusar |
|---|---|---|
| Dono → Mesa | mandato (arquivo de configuração) | a mesa, no arranque (valor fora de banda) |
| Setup → Mesa | o template de configuração e a proposta | a mesa (template inválido; proposta fora dos quatro valores) |
| Corretora → Conector → Mesa | factos de mercado e conta, normalizados | o conector (falha) e a mesa (dado velho) |
| Mesa → Setup | o objecto normalizado de mercado e conta | ninguém: o setup recebe sempre o mesmo objecto |
| Mesa → Conector | a boleta | a mesa (sem capacidade declarada) e o conector (recusa da corretora) |
| Mesa → Web | a leitura (posição, ciclos, resultado, ledger) | ninguém |
| Mesa → Ledger | snapshot, proposta, boleta, desfecho | ninguém |

3.1. **Uma normalização só.** A mesa normaliza uma vez e entrega **o mesmo objecto** ao setup e ao
humano. Duas contas para o mesmo número (resultado, velas, posição) são defeito, não otimização.

3.2. **As duas pontas não participam na operação de forma ativa.** O setup propõe; o conector
transporta. Quem decide é a mesa, dentro do mandato.

---

## 4. Mandato da conta (o dono fala)

- **RN-M1.** O mandato declara os instrumentos, a conta e a corretora. A mesa DEVE recusar arrancar se
  o conector não declarar aquele instrumento.
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
- **RN-M4.** O mandato declara o **nocional máximo** por instrumento, em moeda. Nocional é
  **exposição** — o valor que a posição move quando o preço anda —, não margem e não alavancagem: é
  assim que o número se compara entre corretoras.
  - **RN-M4.1.** O setup NUNCA vê nem influencia o tamanho.
  - **RN-M4.2.** Tamanho que não caiba no instrumento (mínimo ou passo) DEVE ser recusado pela mesa,
    com registro. NUNCA se arredonda em silêncio.
- **RN-M4.3.** O capital vem do mandato: base de capital da conta e fatia por instrumento (com `n`
  instrumentos, a base é dividida por `n`). O tamanho da posição é derivado do **nocional máximo
  autorizado** e do preço — nunca de um número de alavancagem escolhido pelo dono.
- **RN-M4.4.** A **alavancagem NÃO é parâmetro do dono**: é facto do instrumento, declarado pelo
  conector (RN-C1) e variável com o valor da posição. O que o mandato protege é outra coisa — a
  **distância mínima até à liquidação** (o movimento adverso, em %, que a posição tem de suportar).
- **RN-M4.5.** Antes de enviar, a mesa DEVE calcular a distância até à liquidação com a alavancagem
  que a corretora aplica àquele tamanho. Se ficar mais perto do que o mandato exige, a mesa **baixa a
  alavancagem na corretora** (RN-C8) ou **reduz o tamanho**; se nenhum dos dois couber, **recusa** e
  registra.
- **RN-M4.6.** A alavancagem efectiva e o preço de liquidação são **observados na corretora** em cada
  ciclo e gravados no ledger. São facto da corretora: a mesa NUNCA os estima nem os presume.
- **RN-M5.** O mandato da conta é o **único limite global**: perda máxima (RN-M3) e teto de nocional
  (RN-M4). Nada de estratégia entra aqui. Stop, janela de operação, aumentos de posição, limiares e
  política de parcial são **do setup**, declarados no template dele (RN-S3).
- **RN-M6.** O mandato declara a **ficha de cada instrumento**: que setup corre em que instrumento e
  com que fatia do capital da conta. Um instrumento sem ficha não é operado.
- **RN-M7.** A mesa só conhece parâmetros de estratégia **pelo template** do setup (RN-S4). Um item de
  estratégia que precise de aparecer no mandato é sinal de que o desenho se enganou de anel.
- **RN-M8.** O mandato em vigor é gravado no ledger. Ciclo sem mandato conhecido NUNCA abre posição.
- **RN-M9.** Valor de mandato fora de banda (zero, negativo, absurdo) DEVE fazer a mesa **recusar o
  arranque**. Validação é alarme que recusa, nunca autocorreção.

---

## 5. Regras do setup (o plugin)

O setup é a parte inteligente e é **variável por natureza**: há setups que usam stop e setups que não
usam, setups que operam janelas e setups que operam sempre, e cada setup tem muitas variantes. Por
isso o core NÃO conhece nenhum parâmetro de estratégia por nome — ele conhece o **template** que o
setup publica.

- **RN-S1.** O setup entrega uma proposta com um de quatro valores: `buy`, `sell`, `hold`, `caixa`.
  Nada mais: não vê tamanho, risco, execução nem a corretora.
- **RN-S2.** O setup declara o seu **relógio** (quando quer ser consultado). Nos ciclos em que não quer,
  a mesa mantém a posição (RN-T5).
- **RN-S3.** O setup publica um **template de configuração**: um item por parâmetro, com nome, tipo,
  unidade, valor por omissão e significado. **Toda** decisão de estratégia vive aí — inclusive se há
  stop (e a distância), a janela de operação do setup, a política de execução parcial, se aumenta
  posição no mesmo sentido, e os próprios limiares.
- **RN-S4.** O template é a **única** fonte da verdade desses itens: a mesa valida e a web apresenta a
  configuração **a partir do template**, e nenhuma das duas conhece os itens por nome. Um setup novo
  entra no sistema sem tocar no core nem na web.
- **RN-S5.** **Variantes são fichas**: a mesma regra com configurações diferentes são duas fichas do
  mesmo plugin, e cada ficha tem identidade própria e vai assinada no ledger (RN-L1).
- **RN-S6.** O setup persiste o **seu próprio estado**, com namespace e versão
  (`estado/<setup>/<versão>/<instrumento>`) e schema declarado. A mesa não lê nem interpreta esse
  estado.
- **RN-S7.** O setup declara nome e versão; a proposta entra no ledger com essa assinatura.
- **RN-S8.** Falha do setup (excepção, resposta fora dos quatro valores, silêncio além do prazo): a mesa
  **congela** (RN-T10) e registra. NUNCA se substitui a proposta por um valor por omissão.
- **RN-S9.** O template declara **política**, não execução: quem preenche a boleta é a mesa. O setup
  NUNCA manda na boleta, e uma proposta pode ser recusada pelo mandato sem que o setup saiba porquê.

---

## 6. Regras da mesa (o terminal)

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
- **RN-T6.** A mesa transforma a proposta em boleta **respeitando o mandato** (tamanho, teto, perda
  máxima, ficha do instrumento) e o template do setup (stop, parcial). Se algum dos dois proíbe, a
  mesa NÃO envia e registra o motivo.
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

## 7. Regras do contrato de dados (corretora → mesa → setup)

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

## 8. Regras da boleta

Campos: ciclo, instrumento, lado, tipo, quantidade (na unidade do instrumento), preço (quando
limite), política de execução parcial, desvio máximo, reduce-only, stop (quando o template o pedir),
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

## 9. Regras do conector (a corretora)

- **RN-C1.** O conector declara um **manifesto mínimo**, **sondado** no arranque (nunca constante de
  código): instrumentos e unidades (mínimo, passo, tick); **alavancagem máxima por instrumento e por
  escalão de valor da posição**, e se o conector sabe **ajustar** a alavancagem (e em que modos, cruzado
  ou isolado); teto de valor por ordem; modelo de posição (netting ou hedging); tipos de ordem
  disponíveis; política de execução parcial suportada; desvio máximo; se garante `reduce-only`
  nativamente; se aceita stop anexado à ordem; profundidade de livro; funding; relógio do fecho de
  barra; e se tem idempotência.
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
- **RN-C8.** Onde o conector tiver verbo para **ajustar a alavancagem** de um instrumento (a HL tem:
  `updateLeverage`, de 1x até ao máximo do activo, em modo cruzado ou isolado), a mesa usa-o para
  levar a posição à distância de liquidação que o mandato exige, e registra a mudança. Onde o verbo
  não existir, a mesa **reduz o tamanho** em vez de aceitar menos distância do que o mandato manda.

---

## 10. Regras do ledger

- **RN-L1.** Envelope comum a todas as linhas: ciclo, instante, instrumento, tipo de linha, ficha e
  versão do setup, versão do mandato, versão da mesa, nome e versão do conector.
- **RN-L2.** Por ciclo grava-se: **snapshot normalizado, proposta do setup, boleta e desfecho**. Nada
  mais.
- **RN-L3.** O que é privado do setup vive dentro de um campo próprio (`payload`), NUNCA no envelope.
  O envelope não conhece o vocabulário de nenhum setup.
- **RN-L4.** As linhas são de acréscimo (append-only). O desfecho de um ciclo pode ser escrito mais
  tarde e a escrita é **idempotente**.
- **RN-L5.** O ledger é a base de reprodutibilidade: re-correr o setup sobre o snapshot DEVE produzir a
  mesma proposta.

---

## 11. Estrutura do projeto, topologia e superfície

### 11.1. Diretórios

```
/contracts      as portas: setup, conector, objecto normalizado, boleta, desfecho
/core           a mesa: ciclo, normalização, boleta, ledger, mandato da conta, servidor de leitura
/setups/<nome>  o plugin, o seu template de configuração, o schema do seu estado, os seus testes
/brokers/<nome> o conector, o seu manifesto, a bateria de conformidade, as suas fixtures
/web            a superfície: sem cálculo próprio e sem conhecer a topologia
/docs           a regra de negócio e as especificações
```

- **RN-E1.** A direcção das dependências é fixa: `/setups/<nome>` e `/brokers/<nome>` importam
  `/contracts`; `/core` importa `/contracts`; **ninguém importa `/core`**. O invariante é verificado
  por teste (alarme que recusa), e o próprio teste é testado contra uma cópia corrompida.
- **RN-E2.** Nada no core conhece o nome de um setup nem de uma corretora. Nada num setup ou num
  conector conhece as tripas da mesa.

### 11.2. Topologia de processos

- **RN-E3.** A unidade de execução é **uma conta**: uma corretora, uma conta, `n` instrumentos. Uma
  ligação e uma chave por processo; um escritor por ledger; falha isolada por conta.
- **RN-E4.** NÃO um processo por instrumento: multiplica ligações, chaves e processos sem ganho de
  isolamento que interesse — a correlação entre instrumentos da mesma conta é governada pelo mandato,
  não pelo processo.
- **RN-E5.** NÃO um processo com várias corretoras: juntaria chaves e ligações de corretoras diferentes
  e faria a falha de uma derrubar as outras.
- **RN-E6.** O core DEVE ser **indiferente à topologia**: nada nele pode saber quantos processos
  existem nem onde corre cada instrumento. A topologia é decisão de implantação, não de código.
- **RN-E7.** O ledger é escrito por (mesa, instrumento, dia); processos diferentes NUNCA escrevem no
  mesmo ficheiro.

### 11.3. Superfície (a web)

- **RN-E8.** A web fala com um **registo de mesas** — uma lista de identidades e endereços —, NUNCA com
  um endereço único. Cada mesa publica a sua identidade num caminho fixo, para o registo poder ser
  descoberto em vez de mantido à mão.
- **RN-E9.** A web reúne as mesas e apresenta-as como **uma só superfície**; não calcula nada que a
  mesa já saiba (resultado, velas, posição) nem mostra a topologia.
- **RN-E10.** Uma mesa com três instrumentos e três mesas com um instrumento cada DEVEM parecer iguais
  na web. É esta propriedade que mantém a topologia no campo da operação.

---

## 12. O que fica de fora (por decisão, não por esquecimento)

- A regra do sinal, os indicadores, as médias, a classificação e os adjectivos — são do **setup**.
- Circuit breaker, veto de pavio, limiares de confiança e hostilidade — são do **setup** que os
  declarar; a mesa não os conhece por nome.
- Escolha de corretora, instrumento e conta — é do **mandato**.
- Hedge, correlação e gestão de carteira — não existem nesta versão.
- Hipóteses já enterradas no projeto de referência (decisão a cada 5 minutos, canal `u`, famílias
  derivadas) — não se reabrem.

---

## 13. Como se sabe que está cumprida

- Cada regra `RN-*` DEVE ter um teste que a **recusa quando falhada**. Regra sem teste não está em
  vigor.
- Dois arneses de aceite:
  1. **replay** sobre o material gravado do motor de referência (snapshot + boleta + desfecho),
     comparando propostas e boletas;
  2. **bateria de conformidade** por conector (RN-C6), corrida em ambiente de teste da corretora.
- A mesa nova só substitui o motor que roda a conta quando os dois arneses passarem.

---

## 14. Rastreabilidade e referência

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

## 15. Decisões: confirmadas e abertas

**Confirmadas pelo dono (27 set 2026)**

1. As regras de estratégia que eu tinha posto no mandato — stop ou não, janela de operação, aumentos de
   posição, limiares — vivem no **config do setup**, e cada setup publica um **template com um item por
   parâmetro** (RN-S3/S4). O core não as conhece por nome.
2. Variantes de um setup são **fichas** do mesmo plugin (RN-S5).
3. Estrutura de diretórios `/core`, `/setups`, `/brokers`, `/web` (mais `/contracts` e `/docs`).

**Proposta minha, à espera da tua palavra**

4. Topologia: **uma conta por processo** com `n` instrumentos (RN-E3), e a web a falar com um registo de
   mesas (RN-E8), para a topologia não aparecer na superfície.
5. Nocional e alavancagem: o mandato limita **exposição (nocional)** e **distância mínima até à
   liquidação**; a alavancagem passa a ser facto do instrumento (RN-M4.3 a RN-M4.6). É o que resolve o
   caso HL (3x a 40x, com degraus por valor de posição) contra o caso FX (até 500x), onde o **mesmo
   nocional** significa uma liquidação muito mais perto.
6. A web pode editar fichas e mandato (validado, versionado, assinado) e **pedir** arranque; quem
   lança o processo é o supervisor do host, não a web.

**Abertas**

7. Janela da perda máxima (RN-M3): do pico da sessão, do equity do início do dia, ou outra.
8. Nocional: por conta ou por instrumento — e qual a **distância mínima de liquidação** (sem ela a
   mesa não abre posição).
9. Funding/swap entra no resultado do ciclo ou é apenas registrado (RN-D1).
