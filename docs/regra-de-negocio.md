# Regra de negócio — MesaCore

| | |
|---|---|
| Documento | Regra de negócio do terminal de execução (a mesa) e dos seus dois plugins |
| Versão | v3 (revisão de lacunas — §16) |
| Data | 28 set 2026 |
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
| **Mandato** (o dono) | instrumentos, conta e corretora, circuit breaker da conta, margem total máxima, risco máximo por ordem | não decide estratégia, stop nem limiares de setup |
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

- **Mandato** — o que o dono declara e que é **soma**, não posição: instrumentos, conta, perda máxima da
  conta e margem total máxima.
- **Setup** — o plugin que propõe lado e publica o template do seu arquivo de configuração. Tem nome e
  versão.
- **Ficha** — a configuração concreta de um instrumento: **dois arquivos**, um de risco e um do setup,
  mais o nome do setup e da variante.
- **Arquivo de risco** — o arquivo de forma **fixa** (vem do core, igual em todos os setups):
  percentagem do saldo, alavancagem, distância mínima de liquidação, janela, e as bandas onde os itens
  do setup têm de caber. O setup **serve-o**; não o inventa.
- **Arquivo do setup** — o arquivo cuja forma o **setup** publica (ema_fast, ema_slow, stop, limiares).
  Nem o core nem a web conhecem nenhum destes nomes.
- **Arquivo macro da conta** — o arquivo do que é da **conta**: instrumentos, corretora e conta, perda
  máxima e a janela da sua medição, margem total máxima, e a política de contenção de margem. Mesmo
  padrão dos outros: forma declarada, versionado, origem registrada (RN-M2).
- **Mesa** — este sistema: o terminal. Uma mesa corre uma conta.
- **Ciclo** — uma passagem da mesa: ler mercado, (eventualmente) consultar o setup, agir, registrar.
  Tem identificador próprio.
- **Sessão** — a corrida de uma mesa, desde o seu arranque. É a janela do circuit breaker da conta
  (RN-M3).
- **Estudo** — uma ferramenta do dono (em `/tools`) que mede um instrumento — volatilidade por sessão,
  amplitude típica, funding médio — **sem operar**. Serve para escolher números com medição, não com
  palpite.
- **Proposta** — o que o setup devolve: `buy`, `sell`, `hold` ou `caixa`.
- **Boleta** — o documento de ordem: o que a mesa quer que a corretora faça.
- **Desfecho** — o que a corretora responde: **aceite**, **parcial**, **desconhecido** ou **recusado**.
- **Conector** — o plugin que fala com a corretora. Tem nome e versão.
- **Instrumento** — símbolo + unidade + mínimo + passo + tick, conforme declarados pela corretora.
- **Percentagem do saldo** — quanto do saldo da conta a posição pode empenhar em margem. É o termo em
  que a mesa pede o tamanho, porque vale em qualquer corretora.
- **Resolução** — o que o conector devolve depois de traduzir a boleta: quantidade na unidade da sua
  corretora, nocional, margem, alavancagem efectiva e preço de liquidação.
- **Nocional** — o valor de exposição da posição, resultado da resolução. É o que a mesa confere
  contra a banda do mandato.
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
| Mesa → Conector | a boleta — mensagem padrão (percentagem do saldo, alavancagem, percentagens de movimento) | a mesa (sem capacidade declarada) e o conector (recusa da corretora) |
| Conector → Mesa | a **resolução** (quantidade, nocional, margem, alavancagem efectiva, preço de liquidação) e o desfecho | a mesa (exposição fora da banda do mandato) |
| Vigia → Mesa | os quatro verbos: start, stop, pause, reset | a mesa (mandato fora de banda: o start falha) |
| Mesa → Web | a leitura (posição, ciclos, resultado, ledger) | ninguém |
| Mesa → Ledger | snapshot, proposta, boleta, resolução e desfecho | ninguém |

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
- **RN-M3.** O **circuit breaker da conta** mede-se **por sessão** — a corrida da mesa, desde o arranque —
  e o limite é **5%** de perda, sobre o equity da corretora com resultado não realizado. É o alerta
  grave: um operador que se prese nunca chega perto dele numa única sessão.
  - **RN-M3.1.** Ao atingir o limite, a mesa **liquida** a posição e **encerra o processo da conta** —
    não fica em inibição à espera. O encerramento segue o caminho gracioso (RN-V7) e o **motivo** é
    registrado para revisão.
  - **RN-M3.2.** A verificação é da mesa, **em cada ciclo**, e não depende do setup nem da sua proposta.
  - **RN-M3.3.** Depois de um circuit breaker a mesa NÃO volta sozinha: o arranque seguinte exige decisão
    explícita do dono, que revê o motivo antes de levantar a inibição.
- **RN-M4.** O mandato declara o que é **soma**: a **margem total máxima** da conta, em percentagem do
  saldo — e **100% é um valor legítimo** (a 1x, com um ou dois pares, empenhar o saldo inteiro é uma
  escolha do dono, típica em instrumentos de variação baixa) — e o circuit breaker da conta (RN-M3). As
  bandas **por posição** não moram aqui: vivem no arquivo de risco de cada ficha (RN-S10), porque **uma
  ficha não vê as outras**.
  - **RN-M4.1.** O setup NUNCA vê nem influencia o tamanho, a percentagem, a alavancagem nem a margem
    total.
  - **RN-M4.2.** A **soma** é conferida pela mesa, que é o único sítio que vê todas as fichas. Ficha que
    não couber no que resta da margem total **não abre**: a mesa não reparte, não reduz em silêncio e
    não arredonda para caber.
- **RN-M4.3.** A **percentagem do saldo** e a **alavancagem** (do arquivo de risco) vão na boleta em
  termos que valem em qualquer corretora; quem as converte em quantidade da sua unidade é o conector
  (RN-C9).
- **RN-M4.4.** A alavancagem pedida NUNCA excede o máximo que o instrumento permite, lido no manifesto
  (RN-C1) e variável com o valor da posição.
- **RN-M4.5.** Antes de enviar, a mesa DEVE ter a **resolução** do conector (RN-C10) e conferir
  exposição, distância de liquidação e margem total contra as bandas. Resolução fora da banda NÃO vira
  ordem: registra-se e alarmiza-se como falha de conformidade.
- **RN-M4.6.** Quantidade resolvida, nocional, margem, alavancagem efectiva e preço de liquidação são
  **resolvidos pelo conector** e gravados no ledger. A mesa NUNCA os estima nem os presume.
- **RN-M4.7.** No arranque, a mesa **compara as fichas com o teto da conta** e, quando a soma puder
  exceder o teto — o caso normal, três instrumentos com 50% do saldo cada —, **avisa** e exige que a
  **política de contenção** esteja declarada no arquivo macro. Sem declaração, o arranque **recusa**:
  contenda não se resolve sozinha nem por omissão.
- **RN-M4.8.** Com a política `espera`, o instrumento que não encontra margem fica **à espera de saldo**
  e entra quando houver lugar. Esperar NÃO é uma ordem em fila: a mesa não guarda a intenção pendente,
  registra o motivo (`sem_margem`) e o ciclo seguinte corre o seu caminho normal — sinal velho não é
  sinal.
- **RN-M4.9.** Quando mais do que um instrumento quer o mesmo lugar no mesmo ciclo, a ordem é uma
  **lista declarada** no arquivo macro. Sem lista declarada, a ordem é **alfabética pelo símbolo do
  instrumento** — porque, não havendo critério do dono, os pesos são iguais e não há nada a julgar. A
  mesa NUNCA escolhe, e o registro diz sempre qual critério decidiu: `ordem_declarada` ou
  `alfabetica_sem_criterio`.
- **RN-M4.10.** A ordem só decide **quem fica de fora**, nunca a ordem de execução: havendo lugar para
  todos, entram todos e a lista não é consultada.
- **RN-M4.11.** O desempate alfabético é pelo **símbolo do instrumento**, em comparação simples de
  caracteres (não por regras de idioma), para que a mesma situação dê sempre o mesmo resultado.
- **RN-M4.12.** O mandato declara também o **risco máximo por ordem**, em percentagem do saldo (ex.: 2%).
  Antes de enviar, a mesa calcula a perda implícita — distância do stop × exposição — e **recusa** a
  ordem que a exceda, mesmo que o setup a peça e mesmo que a ficha a permita. É o travão que nenhuma
  ordem de corretora nenhuma atravessa. Dentro dele, o **stop e o circuit breaker de cada operação** são
  definidos na ficha conforme a necessidade — uma operação de várias sessões pode querer outro valor,
  desde que caiba no teto.
- **RN-M4.13.** A **distância mínima de liquidação** é um travão **opcional, da config de risco da
  ordem**. Quem a declara sabe que distância de movimento adverso aceita — normalmente depois de estudar
  o par em `/tools` (volatilidade por sessão, amplitude típica); **sem ela declarada, a ordem é livre**.
  Declarada, é porteiro na abertura e a leitura é registrada em cada ciclo (RN-M4.5).
- **RN-M5.** Repartição de responsabilidade, por escrito: **o que é soma** (perda máxima e margem total
  da conta) é do **mandato**; **o que é da posição** (percentagem do saldo, alavancagem, distância de
  liquidação, janela) é do **arquivo de risco**, de forma fixa, em cada ficha (RN-S10); **o que é da
  estratégia** (stop, tp, limiares, aumentos, parcial) é do **arquivo do setup** (RN-S3). Nada disto
  vive no core por nome.
- **RN-M6.** A **ficha** de cada instrumento são **dois arquivos** — o de risco e o do setup — mais a
  indicação de que setup e que variante correm naquele instrumento. Um instrumento sem ficha não é
  operado.
- **RN-M6.1.** Três coisas que se confundem com facilidade: o **template** é do setup (que itens de
  estratégia existem e o que significam, RN-S3); a **ficha** é do dono (os valores, nos dois arquivos,
  por instrumento); a **banda** é de forma fixa e vive no arquivo de risco (RN-S10).
- **RN-M6.2.** A ficha NUNCA afrouxa a banda. Valor fora da banda é **recusado** na validação (RN-M9),
  nunca corrigido.
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
  posição no mesmo sentido, e os próprios limiares. O template declara **itens**; quem lhes dá
  **valores**, por instrumento, é a ficha (RN-M6.1).
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
- **RN-S10.** Cada setup traz **dois arquivos de configuração por instrumento**: um de **risco**, de
  forma **fixa** (percentagem do saldo, alavancagem, distância mínima de liquidação, janela, e as bandas
  onde os itens do setup têm de caber), e um **seu**, cuja forma ele publica. O de risco tem schema do
  core: um setup pode **recusar-se** a servir um instrumento, mas NUNCA inventa um parâmetro de risco.
- **RN-S11.** A spec do setup DEVE trazer os dois arquivos: o de risco porque faz parte do contrato, e o
  seu porque é ele que o define (itens, tipos, unidades, omissões, significado). Item que o risco tenha
  de limitar tem de aparecer nas bandas do arquivo de risco — senão não é limitável e não entra.
- **RN-S12.** O setup NUNCA escreve no arquivo de risco nem nos valores do dono: lê-os. Escrever, só no
  seu próprio estado (RN-S6).

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
- **RN-D6.** O **histórico e os detalhes das ordens vêm da corretora** — execuções, taxas, funding,
  resultado realizado e o detalhe de cada ordem já existem lá, e a mesa lê-os e mostra-os. A mesa NÃO
  reconstrói resultado a partir de execuções: o **trilho das decisões** é o nosso ledger (snapshot,
  proposta, boleta, resolução, desfecho); o **trilho do dinheiro** é o da corretora, que é quem o faz
  por ofício.

---

## 8. Regras da boleta

A boleta é uma **mensagem padrão**: escrita pela mesa em termos que valem em qualquer corretora —
**percentagem do saldo, alavancagem e percentagens de movimento** —, nunca em quantidades, preços
absolutos ou pontos, que são unidades de uma corretora concreta.

- **Metade da mesa:** ciclo, instrumento, lado, tipo, percentagem do saldo, alavancagem, stop
  (percentagem de movimento, ou ausente), tp (idem), política de execução parcial, desvio máximo,
  reduce-only, referência do cliente.
- **Metade da corretora (a resolução, RN-C10):** quantidade na unidade do instrumento, nocional,
  margem empenhada, alavancagem efectiva, preço de liquidação — e o desfecho.

- **RN-B0.** Nenhum campo da boleta está em unidade de corretora. Quem traduz — quantidade, contrato,
  lote, ponto, tick, preço absoluto — é o **conector**, que atende à especificação de ordem da sua
  corretora e cuida dos cálculos dela.
- **RN-B1.** A boleta é o documento; **a execução é do conector**.
- **RN-B2.** A boleta vai para o ledger **integral**, junto com a **resolução** do conector
  (quantidade, nocional, margem, alavancagem efectiva, preço de liquidação) e a resposta da corretora.
  É o que permite re-correr o setup e comparar **boletas**, em vez de comparar código.
- **RN-B3.** Antes de enviar, a mesa verifica a boleta contra o **manifesto do conector** (RN-C1). Sem
  capacidade declarada para o que a boleta pede, a mesa **recusa** — não adapta.
- **RN-B4.** A quantidade resolvida DEVE caber na banda autorizada (percentagem do saldo ×
  alavancagem). O conector NUNCA a arredonda em silêncio: para baixo pode dar zero (ordem que nunca
  existe, mesa a pensar que entrou) e para cima estoura o mandato. Não cabendo o mínimo do instrumento,
  o conector **recusa** (RN-C9).
- **RN-B5.** `reduce-only` é **intenção**. Onde a corretora não a garante nativamente, a garantia é da
  mesa: nunca enviar mais do que a posição e reconciliar depois.
- **RN-B6.** A política de execução parcial (tudo-ou-nada / o-que-der) é campo obrigatório da boleta,
  porque altera o desfecho da entrada. Sem ela declarada, a boleta não sai.
- **RN-B7.** O stop e o tp são declarados em **percentagem de movimento do preço** da posição. Um stop
  de 1% é o mesmo pedido na HL e em FX: o conector resolve-o para o protocolo do seu venue (preço
  absoluto, pontos, distância em ticks) e recusa quando o instrumento não o permite. É esta unidade que
  impede a salada de configurações — e é a mesma unidade da distância de liquidação (RN-M4.4).

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
  levar a posição à alavancagem pedida, e registra a mudança. Onde o verbo não existir, a mesa ajusta o
  **tamanho** — nunca aceita uma exposição que a banda não permite, nem uma liquidação mais perto do que
  o travão opcional autorizar (RN-M4.13).
- **RN-C9.** O conector **traduz** a boleta — percentagem do saldo, alavancagem e percentagens de
  movimento — em quantidade da sua unidade, atendendo à especificação de ordem da sua corretora. Se o
  mínimo do instrumento exigir mais do que a banda autorizada, **recusa** com motivo. NUNCA arredonda
  em silêncio.
- **RN-C10.** Antes de executar, o conector devolve a **resolução** (quantidade, nocional, margem,
  alavancagem efectiva, preço de liquidação). É ela que a mesa confere contra a banda (RN-M4.5) e grava
  no ledger (RN-B2). A resolução faz parte do desfecho, e é ela que torna o replay possível quando o
  cálculo é da corretora.
- **RN-C11.** O conector expõe o **histórico** da corretora — execuções, taxas, funding, resultado
  realizado, detalhe de cada ordem — numa **vista normalizada** (os campos das corretoras são próximos
  uns dos outros), para que a mesa e a web o mostrem **sem o recalcular** (RN-D6).

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
/core           a mesa (ciclo, normalização, boleta, ledger, mandato, servidor) e o vigia (RN-V*)
/setups/<nome>  o plugin, o seu template de configuração, o schema do seu estado, os seus testes
/brokers/<nome> o conector, o seu manifesto, a bateria de conformidade, as suas fixtures
/config         os arquivos do dono: `conta.*` (macro) e `fichas/<instrumento>.{risco,setup}.*`
/tools          os estudos do dono sobre um instrumento (volatilidade, amplitude, funding), sem operar
/web            a superfície: sem cálculo próprio e sem conhecer a topologia
/docs           a regra de negócio e as especificações
```

- **RN-E1.** A direcção das dependências é fixa: `/setups/<nome>` e `/brokers/<nome>` importam
  `/contracts`; `/core` importa `/contracts`; **ninguém importa `/core`**. O invariante é verificado
  por teste (alarme que recusa), e o próprio teste é testado contra uma cópia corrompida.
- **RN-E2.** Nada no core conhece o nome de um setup nem de uma corretora. Nada num setup ou num
  conector conhece as tripas da mesa.
- **RN-E11.** `/core` tem dois pontos de entrada: a **mesa** (o ciclo de operação) e o **vigia**
  (RN-V1 a RN-V6). O vigia não importa a mesa, nenhum setup e nenhum conector.
- **RN-E12.** `/config` é do **dono**: a mesa lê-o, valida-o e **nunca o escreve**. A web edita-o com
  validação e assinatura (RN-M2). Três famílias de arquivo, e só três: o **macro** da conta, o de
  **risco** por ficha e o do **setup** por ficha.
- **RN-E13.** `/tools` é do **dono** e roda **sem operar**: lê dados da corretora pelo contrato de dados
  e produz relatórios para escolher números de risco com medição. Um número escolhido a partir de um
  estudo registra **qual estudo o sustentou** e quando — estudo sem data não sustenta número nenhum.

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

### 11.4. O vigia (start, stop, pause, reset e encerramento gracioso)

O servidor é **puro** e não há agente administrador: na inicialização sobe um processo pequeno e
determinístico que só obedece a quatro verbos. Não sabe de estratégia, de mercado nem de ledger.

- **RN-V1.** Os verbos são quatro e determinísticos: **start** (põe uma mesa a correr), **stop**
  (termina a mesa), **pause** (a mesa continua viva, para de abrir, continua a reconciliar) e
  **reset** (reinício sem mexer em nada, RN-V3).
- **RN-V2.** **Pause não é stop.** Terminar o processo com posição aberta deixaria a posição sem
  governo: em `pause` a mesa mantém-se a reconciliar e apenas NÃO abre — é a mesma inibição do
  RN-M3.1.
- **RN-V3.** **Reset é um reinício sem mexer em nada**: a mesa volta a subir com o mesmo estado, as
  mesmas fichas e o mesmo ledger. Serve para **destravar** uma mesa quando é preciso, não para alterar.
  NUNCA apaga o ledger, NUNCA repõe fichas, NUNCA limpa a marca de desfecho **desconhecido** — isso
  destrava-se reconciliando (RN-T7.1), que é o que o arranque faz.
- **RN-V4.** Toda transição é registrada com autor, hora, verbo e estado anterior e posterior: o vigia
  é auditável por leitura do seu registro.
- **RN-V5.** O vigia NÃO valida mandato nem substitui o porteiro: se o arranque for recusado, o `start`
  falha e a recusa é o resultado (RN-M9).
- **RN-V6.** Uma mesa em operação NUNCA depende de o vigia estar vivo: se ele morre, as mesas continuam
  a operar e a reconciliar. O vigia é conveniência de operação, não caminho crítico.
- **RN-V7.** **Parar com posição aberta não é um kill.** O encerramento é gracioso: a mesa para de
  abrir, apresenta o **resumo** e **pergunta** se se fecham as posições a preço de mercado. O `stop`
  com posição aberta cai neste mesmo caminho — matar o processo deixaria a posição sem governo.
- **RN-V8.** O resumo traz **números da corretora**, não estimativas: posição, nocional, margem,
  distância de liquidação, resultado não realizado, e o que fica em aberto para cada instrumento. Se a
  decisão for **não fechar**, o resumo diz o que isso significa: a única proteção que resta é a **ordem
  de stop que estiver na corretora**; sem stop, a posição fica a descoberto.
- **RN-V9.** Sem decisão, a mesa **continua a correr e a reconciliar** — nunca fecha por prazo, nunca
  sai em silêncio. A decisão (fechar a mercado ou manter) é registrada com autor e hora, e o
  encerramento com posição aberta é o único caminho legítimo para terminar com posição viva.

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
3. Estrutura de diretórios `/core`, `/setups`, `/brokers`, `/web` (mais `/contracts`, `/config`,
   `/tools` e `/docs`).
4. O servidor é puro e **não há agente administrador**: um processo pequeno e determinístico obedece a
   start, stop, pause e reset (RN-V1 a RN-V6). `pause` não é `stop`; `reset` nunca apaga o ledger.
5. **A tradução é do conector.** A boleta é uma mensagem padrão em percentagem do saldo, alavancagem e
   percentagens de movimento; quem calcula quantidade, unidade, pontos, tick e o protocolo de ordem da
   sua corretora é o plugin (RN-B0, RN-B7, RN-C9). O core deixa de ter aritmética de corretora.
6. **A ficha são dois arquivos**: um de **risco**, de forma fixa e igual em todos os setups, e um do
   **setup** (ema_fast, ema_slow, stop, limiares), cuja forma o setup publica. O formato do plugin de
   setup passa a incluir os dois, e a spec do setup tem de os trazer (RN-S10, RN-S11).
7. **O mandato guarda só o que é soma** — perda máxima da conta e margem total máxima —, porque uma
   ficha não vê as outras (RN-M4). As bandas por posição vivem no arquivo de risco.
8. **Reset é um reinício sem mexer em nada**, para destravar (RN-V3). E o encerramento é **gracioso**:
   pergunta se se fecham as posições a preço de mercado, com o **resumo** à frente; sem decisão, a mesa
   continua a correr (RN-V7 a RN-V9).
9. **A config macro é um arquivo do mesmo padrão**: `conta` traz os parâmetros da conta (instrumentos,
   corretora, perda máxima e janela, margem total máxima) e a **política de contenção**. As três
   famílias de arquivo do dono são: **macro** (conta), **risco** (por ficha) e **setup** (por ficha).
10. **Contenda declarada, não recusada à força.** No arranque a mesa compara as fichas com o teto e
    **avisa**; o dono corrige ou **declara** a política (`espera`), e o instrumento sem margem fica à
    espera de saldo em vez de ser recusado (RN-M4.7, RN-M4.8). Esperar nunca é fila de intenções.
11. **Prioridade de atendimento**: uma **lista declarada** no arquivo macro; sem lista, ordem
    **alfabética pelo símbolo** — quando o dono não tem critério, os pesos são iguais e não há nada a
    julgar. O registro diz qual critério decidiu (RN-M4.9 a RN-M4.11).
12. **O circuit breaker da conta é o 5% por sessão**, sobre o equity da corretora com não realizado. Ao
    bater, a mesa **liquida e encerra o processo da conta** para revisão do motivo, e **não volta
    sozinha** (RN-M3).
13. **Margem total máxima pode ser 100%**: a 1x, com um ou dois pares, empenhar o saldo inteiro é escolha
    legítima — típica em instrumentos de variação baixa (RN-M4).
14. **Risco máximo por ordem no macro** (ex.: 2%): nenhuma ordem, de corretora nenhuma, arrisca mais do
    que isso. Dentro do teto, o stop e o CB de cada operação são definidos na ficha (RN-M4.12).
15. **Distância mínima de liquidação é opcional** e vive na config de risco da ordem: **sem ela, a ordem
    é livre** (RN-M4.13).
16. **`/tools`**: o dono estuda o par (volatilidade por sessão, amplitude típica) e escolhe os números de
    risco com medição; o número registra **qual estudo o sustentou** (RN-E13).
17. **Funding e swap explícitos e separados** no histórico, para análise de viabilidade do setup. E o
    **histórico e o detalhe das ordens vêm da corretora**, que já fez esse trabalho — a mesa lê e mostra,
    não reconstrói resultado a partir de execuções (RN-D6, RN-C11).

**Proposta minha, à espera da tua palavra**

18. Topologia: **uma conta por processo** com `n` instrumentos (RN-E3), e a web a falar com um registo de
    mesas (RN-E8), para a topologia não aparecer na superfície.
19. A mesa recebe a **resolução** do conector (quantidade, nocional, margem, alavancagem efectiva,
    liquidação) **antes** de mandar executar, e confere-a contra as bandas (RN-M4.5, RN-C10). É o que
    impede uma ordem maior do que o autorizado quando o cálculo é de fora.
20. A web pode editar fichas e config macro (validado, versionado, assinado) e **pedir** arranque; quem
    lança o processo é o vigia, não a web.

**Abertas — os números que faltam**

21. Confirmar o **2% de risco máximo por ordem** no macro (ou outro valor).
22. A **sessão** é a corrida da mesa desde o arranque (RN-M3) — confirmar que não é o dia.
23. As **bandas** de cada item limitável: stop, tp, alavancagem, tempo máximo em posição.
24. Instrumento a instrumento: a **distância mínima de liquidação**, quando um estudo a justificar.

---

## 16. Lacunas encontradas na revisão (28 set 2026)

Revisão da regra inteira, à procura do que falta. Cada linha é uma lacuna com a correcção que proponho;
as que dependem de decisão do dono estão marcadas `ABERTA`.

**A regra que rege todas as outras (a tua correcção: os números são exemplos, o que importa é a chave)**

- **RN-A1.** **Nenhum número ajustável vive no código.** Todo valor que se ajusta tem **chave declarada**
  no arquivo certo, com nome, tipo, unidade, valor por omissão e significado. Um número no código é
  defeito, não atalho. `5%` de circuit breaker, `2%` de risco por ordem, `8 s` de prazo da passiva: são
  **valores do dono**, não constantes do programa.
- **RN-A2.** Existe um **inventário de chaves** — gerado dos três schemas e publicado — e a mesa
  valida-o no arranque: chave em uso que não está no inventário **recusa o arranque**; chave do
  inventário sem valor usa a omissão declarada (e a origem vai para o registro, RN-M2).
- **RN-A3.** O inventário é a lista do que uma spec pode tocar: uma spec que precise de um número sem
  chave inventa a chave primeiro, no schema do dono certo.

**A execução (o que faltava na boleta)**

- **RN-B8.** A boleta DEVE declarar **quanto tempo** espera na passiva e **o que fazer com o que sobra**
  (resto agressivo dentro do desvio máximo, ou resto cancelado). Hoje a boleta tem a política de parcial
  e o desvio, mas o prazo e o destino do resto — que é o que o motor de referência faz bem — não têm
  campo nem chave (violação directa de RN-A1).

**Reconciliação e estados que faltavam**

- **RN-T13.** **Divergência** é estado de primeira classe: quando o que a mesa espera e o que a
  corretora reporta não coincidem — posição que devia existir e não existe, margem diferente, ordem
  viva que a mesa não conhece — a mesa **registra, alarmiza e não abre** enquanto não resolver. NUNCA
  corrige sozinha nem presume quem tem razão: quem tem razão é a corretora (RN-T8).
- **RN-T14.** No arranque a mesa **lista as ordens vivas na corretora** e reconcilia-as: o stop que
  ficou lá depois do encerramento gracioso é **adoptado**; o que a mesa não reconhece é **alarmizado**
  (e cancelado só com decisão declarada). Sem isto, um reinício deixa ordens órfãs a disparar sozinhas.
- **RN-D7.** **Leitura falhada ≠ dado velho.** Não conseguindo ler a posição, a mesa NÃO abre e NÃO
  fecha às cegas (fechar sem saber o que existe é adivinhar): alarmiza e espera a leitura voltar.
- **RN-D8.** **Mercado fechado é estado declarado pelo conector**, não erro de dado. Fechado: não abre,
  não alarmiza dado velho, continua a reconciliar. Sem isto, todos os fins de semana de FX viram alarme.

**O humano na operação (a tua imagem inicial, que o desenho tinha perdido)** `ABERTA`

- **RN-T15.** A **proposta manual** — o dono como fonte da decisão, a tua imagem original de "o humano
  preenche a boleta e envia" — entra pelo **mesmo caminho** que a do setup: mandato, bandas, boleta,
  resolução, ledger. Não há caminho paralelo nem excepção de risco. `ABERTA`: existe, ou o dono opera
  pela aplicação da corretora e a mesa só reconcilia?
- **RN-T16.** A mesa **não governa o que não abriu**: posição que apareça sem ter sido a mesa a abri-la
  é vista, dita e **não gerida** (nem stop, nem fecho). A ficha declara se aquele instrumento **tolera**
  posição manual; se não tolerar, a mesa fica em pausa nesse instrumento em vez de a gerir.

**Segurança e operação**

- **RN-E14.** **Credenciais NUNCA em `/config`** (que a web edita e que é versionado), NUNCA no ledger,
  NUNCA no log. O conector lê-as do ambiente ou de um cofre, e o registro diz **qual** credencial foi
  usada, nunca o seu valor.
- **RN-M10.** **A config em vigor é a do arranque.** Alteração a quente NÃO tem efeito — a mesa diz que
  vale no próximo arranque. Sem isto, um risco muda a meio da sessão sem ninguém saber.
- **RN-E15.** A lista de **eventos que exigem aviso ao dono** é declarada (circuit breaker, encerramento,
  desfecho desconhecido, recusa, divergência, falha de leitura, contenda). Um alarme escolhido pelo
  programador é um alarme que falta quando importa.

**Um instrumento, um setup**

- **RN-M11.** Um instrumento tem **uma** ficha por conta. Dois setups no mesmo instrumento só com modelo
  de posição *hedging* e colisão declarada; em *netting* é fisicamente impossível — um instrumento, uma
  posição — e duas fichas seriam dois governos sobre a mesma posição, a anularem-se.

**O ledger no tempo**

- **RN-L6.** O ledger **nunca se reescreve**, mas a **retenção é declarada**: o que fica integral (o que
  se pode reexecutar), por quanto tempo, e o que passa a agregado. Sem regra escrita, um dia alguém
  apaga "para limpar" e perde-se o arquivo de túmulos.
