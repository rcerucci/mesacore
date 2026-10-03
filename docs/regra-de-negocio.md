# Regra de negócio — MesaCore

| | |
|---|---|
| Documento | Regra de negócio do terminal de execução (a mesa) e dos seus dois plugins |
| Versão | v3 (revisão de lacunas — §16) |
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
- **Setup manual** — um setup cujo lado vem de uma **pessoa** (uma interface que ela preenche), não de um
  cálculo. É um setup como qualquer outro: o core não sabe a diferença nem precisa de saber (RN-T15).
- **Marca de posse** — o identificador curto que a mesa põe em cada ordem e que diz que aquela ordem é
  dela e daquela ficha. É o que permite reencontrar as **suas** posições pelos registros da corretora, sem
  base de dados própria (RN-B10, RN-T16.1).
> **EMENDA — 30/09/2026 (decisão do dono).** A ficha passa a ser **UM ficheiro por par**, com um
> **cabeçalho padrão** (conta, corretora, ambiente, endereço, instrumento, relógio, saldo_pct, alavancagem,
> bandas, prazo) seguido das **constantes daquele indicador**. Motivo declarado: *"acho que não faz sentido [dois
> arquivos]; pode ser um único que no início põe o nome da conta e o restante correspondente, seria uma espécie
> de cabeçalho padrão para qualquer setup, posteriormente as constantes personalizadas para cada indicador"*.
> O código do arranque (`core/ciclo/arranque.ts`) já lia a ficha como um objecto só, e é este lado que passa a
> valer. **O texto original fica abaixo, como registo do que a espec dizia.**

- **Ficha** — a configuração concreta de um instrumento: **dois arquivos**, um de risco e um do setup,
  mais o nome do setup e da variante. *(texto original, substituído pela emenda de 30/09/2026)*
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
| Vigia → Mesa | os cinco verbos: start, stop, pause, reset, nova_sessao | a mesa (mandato fora de banda: o start falha; sessão inibida pelo CB: o start falha) |
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
  - **RN-M3.4.** O **início da sessão é gravado** — instante e equity de partida — e **sobrevive ao
    processo**: reinício, queda ou `reset` **retomam a sessão em curso**, não abrem uma nova. Sem isto, o
    `reset` (que existe para destravar, não para alterar, RN-V3) limparia o circuit breaker, e o alerta
    grave passaria a depender de quem carrega no botão. Sessão nova, só por decisão explícita do dono,
    registrada.
  - **RN-M3.5.** A sessão é a **unidade de comparação**: grava, além do instante e do equity de partida, a
    **configuração em vigor** — ficha, versão do setup, versão do mandato. Mudar ficha ou setup exige
    **sessão nova** (RN-V10): é isso que permite comparar o resultado de dois setups em vez de os somar.
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
  Antes de enviar, a mesa recusa a ordem cuja **EXPOSIÇÃO** exceda esse teto, mesmo que o setup a peça e
  mesmo que a ficha a permita. É o travão que nenhuma ordem de corretora nenhuma atravessa.
  > **EMENDA DATADA — 03/10/2026.** A redacção que aqui estava dizia «a mesa calcula a **perda implícita** —
  > **distância do stop × exposição** — e recusa a ordem». Isso **punha a MESA a medir o stop**, e o stop é da
  > **estratégia** (o arquivo do SETUP, **RN-S3**, duas linhas abaixo) — não do mandato nem da mesa. As duas
  > redacções da MESMA regra conviveram sem data, e foi isso que fez cada leitura nova desta regra concluir que a
  > mesa decide o stop: **três auditorias seguidas caíram neste caso**. O que vale, e é o que a regra sempre quis
  > dizer: o travão da mesa é o **teto de EXPOSIÇÃO do mandato** — `saldo_pct × alavancagem`, em % do saldo,
  > contra o tecto que a **CONTA** declara (`conta.risco_maximo_por_ordem_pct`). A mesa **não lê o stop**: não o
  > mede, não o corrige e não o inventa. O **stop e o tp** viajam na boleta porque o **plugin** os declarou
  > (RN-S3), e a mesa só os transporta — recusando a boleta se o conector os não souber honrar (D-011), nunca
  > deixando-os cair em silêncio. A **distância mínima de liquidação** é travão **opcional** da config de risco
  > (RN-M4.13). A redacção vigente com a decisão do dono está na **emenda de 02/10/2026**, no fim deste documento
  > (procurada por «RN-M4.12 (risco por ordem)»), com a prova em `core/ciclo/provar.ts` e o fecho do **D-015**.
  >
  > *Texto original, mantido por baixo para auditoria:* «Antes de enviar, a mesa calcula a perda implícita —
  > distância do stop × exposição — e **recusa** a ordem que a exceda, mesmo que o setup a peça e mesmo que a
  > ficha a permita. É o travão que nenhuma ordem de corretora nenhuma atravessa. Dentro dele, o **stop e o
  > circuit breaker de cada operação** são definidos na ficha conforme a necessidade — uma operação de várias
  > sessões pode querer outro valor, desde que caiba no teto.» (Também esta última frase cai: o **stop** não é
  > definido na ficha — a ficha tem as **bandas** que o limitam, e o valor é do **setup**, RN-S3/RN-M6.1.)
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
  Qualquer outro valor (ou ausência) é **inválido**: a mesa trata como `hold` e registra a invalidade.
  Inválidos **seguidos** acima do limite declarado inibem a mesa até intervenção — o número é **valor do
  dono** (`conta.invalidos_seguidos_para_inibir`, RN-A1), e é **inibição**, como a do circuit breaker,
  nunca uma fila.
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
  - **RN-T7.3.** **Recusa ao FECHAR é alarme grave**: a mesa registra, alarmiza e volta a tentar. NUNCA
    trata uma recusa de saída como tentativa falhada sem consequência — é a corretora a dizer que a
    posição continua lá.
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
  > **EMENDA DATADA — 03/10/2026.** «Metade da mesa» enumera os campos que a **boleta** leva — e não diz quem
  > lhes dá o **valor**, que era a confusão: o **stop** e o **tp** são escritos na boleta pela mesa, mas o valor
  > é do **SETUP** (o template, RN-S3) — a mesa **transporta-os** e não os lê, não os mede e não os inventa.
  > (O que a mesa confere do lado do dono é a **banda** da ficha, `core/ciclo/ciclo.ts` 3.6 — o valor do setup
  > dentro da banda; e a RN-M4.12, no §7, passou a ser só o teto de exposição.)
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

- **RN-B10.** Toda ordem leva **marca de posse**: um identificador curto, **numérico e determinístico**,
  gerado pela mesa, que diz que aquela ordem é desta mesa e desta ficha. A marca tem de **caber na forma
  mais restrita** dos venues que a transportam (inteiro no MT5, hexadecimal na HL, texto no cTrader) —
  quem a resolve é o conector (RN-C9) e quem declara a forma é o manifesto (RN-C1). É ela que permite à
  mesa reconhecer as **suas** posições sem base de dados própria de posições (RN-T16.1).

---

## 9. Regras do conector (a corretora)

- **RN-C1.** O conector declara um **manifesto mínimo**, **sondado** no arranque (nunca constante de
  código): instrumentos e unidades (mínimo, passo, tick); **alavancagem máxima por instrumento e por
  escalão de valor da posição**, e se o conector sabe **ajustar** a alavancagem (e em que modos, cruzado
  ou isolado); teto de valor por ordem; modelo de posição (netting ou hedging); tipos de ordem
  disponíveis; política de execução parcial suportada; desvio máximo; se garante `reduce-only`
  nativamente; se aceita stop anexado à ordem; profundidade de livro; funding; relógio do fecho de
  barra; **marca de posse**: em que forma a aceita (`cloid`, `clientOrderId`, `magic`, `comment` ou
  `nenhuma`) e se a corretora **liga ordem a posição** nos seus próprios registros; e se tem idempotência.
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
  7. o **relógio de fecho de barra** da corretora é conferido contra UTC e o desvio é publicado;
  8. **marcar, reiniciar, reencontrar**: uma ordem marcada é reconhecida como nossa depois de a mesa
     reiniciar, **pelos registros da própria corretora** (RN-B10, RN-T16.1).
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
- **RN-C10.** O conector devolve a **resolução** (quantidade, nocional, margem, alavancagem efectiva, preço
  de liquidação). É ela que a mesa confere contra a banda (RN-M4.5, e **RN-E20** para os **dois momentos**:
  a pré-conferência só existe onde a corretora deixar perguntar; numa ordem **a mercado** o venue calcula ao
  executar, e a resposta da mesa a uma resolução fora da banda é **reduzir e registar**) e grava no ledger
  (RN-B2). A resolução faz parte do desfecho, e é ela que torna o replay possível quando o cálculo é da
  corretora.
- **RN-C12.** O conector reporta o **estado da ligação pelo protocolo** da corretora — nunca por silêncio de
  tick, nunca por limiar de idade de preço. Se a corretora não tiver esse estado, o conector **declara-o no
  manifesto** (recurso ausente, declarado) e o estado passa a ser desconhecido para a mesa — limitação
  visível, nunca descoberta em produção. É este estado que faz a mesa **não abrir risco novo** enquanto
  está cega, mantendo a defesa.
- **RN-C13.** No momento de enviar, o conector **relê o preço** e é essa releitura que serve de **régua** ao
  desvio (RN-B11). A régua que a mesa pediu e a régua usada no envio são registradas ambas quando diferirem:
  um desvio medido a partir de régua velha pode **autorizar** um preenchimento longe do mercado.
- **RN-C14.** A **resolução** que o conector devolve traz **números** — quantidade na unidade da corretora,
  margem exigida, alavancagem efectiva, preço de liquidação — e **não um veredicto**. «Executou» não se
  confere: sem os números, quem garante a banda é o conector. A resolução vai ao ledger junto da boleta
  (RN-C10, RN-E20).
- **RN-C15.** Os cálculos do conector são de **conversão**, nunca de risco: ele traduz percentagem do saldo e
  alavancagem em quantidade pelas **constantes daquela conta e daquele instrumento**, e nada mais. Não
  escolhe lado, tamanho, preço nem momento (RN-C5), não julga o mandato e não lê a estratégia.
- **RN-C16.** O conector conhece **uma só conta**: uma ligação, uma chave, um processo (RN-E3). Um pedido que
  não seja da **sua** conta é **recusado com motivo** — nunca executado por semelhança de instrumento. O
  encaminhamento é da mesa: se a boleta foi escrita a este conector, é porque a ficha pertence a esta conta.
- **RN-C17.** A **tabela de acções por motivo** chega à ponta: o conector **repete com atraso** apenas o que
  **provadamente não saiu**, e é ele que **declara a fase** (antes de enviar / depois de enviar) de que a
  decisão depende. `sem confirmação` nunca é repetido pelo conector: vai para **reconciliação**, que é da
  mesa.
- **RN-C18.** O **silêncio é estado**: dentro do prazo declarado é espera; além dele, o desfecho é
  `desconhecido` — nunca sucesso nem falha. E o desconhecido é **dívida da mesa** (RN-T12): o conector não o
  resolve por conta própria nem o esconde atrás de um `aceite` otimista.
- **RN-C19.** O **manifesto é declarado por conta** (uma entrada por corretora+conta, com os instrumentos,
  escalões de alavancagem e mínimos **daquela** conta). Um mesmo instrumento pode ter constantes diferentes
  em contas diferentes, e a porta do manifesto do arranque confere as **da conta daquela ficha**.
- **RN-C20.** A credencial entra por **referência** e vive fora da mensagem, do ledger e do log (RN-E14). O
  conector lê-a do ambiente ou de cofre, e o registro diz **qual** credencial foi usada, nunca o valor. **Uma
  chave por processo** (RN-E3) — duas contas no mesmo processo é exactamente o que a RN-E5 proíbe.
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
- **RN-L7.** A linha diz **de que conta fala** (a constante da conta, que é um nome e não uma credencial).
  Com mais de uma conta na mesma mesa, sem isto não há atribuição: nem o CB (que se mede sobre o equity
  daquela conta), nem a sessão (unidade de comparação), nem a reconciliação (que pergunta à **aquela**
  corretora). A atribuição **não** vem de «qual processo escreveu a linha» — essa é a única informação que se
  perde quando alguém reorganiza a implantação.

---

## 11. Estrutura do projeto, topologia e superfície

### 11.1. Diretórios

```
/contracts      o schema neutro das portas (boleta, resolução, desfecho, objecto, ficha) e o que cada linguagem gera dele
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

**O contrato entre linguagens** — o core é TypeScript e o `/tools` é Python; a linguagem de cada plugin
  é decisão da **spec daquele plugin**, tomada quando ele se constrói. Para que isso seja verdade:

- **RN-E16.** O **contrato é neutro de linguagem**: o que cruza uma fronteira é **mensagem**, descrita
  por um **schema próprio** em `/contracts`, e cada linguagem **gera** dele o que precisar (tipos em TS,
  modelos em Python). Nenhuma ponta depende dos tipos internos de outra, e nenhum plugin é obrigado à
  linguagem do core.
- **RN-E17.** A prova do contrato é feita com **mocks dos dois lados** — um setup falso e um conector
  falso — e a neutralidade só fica provada com **pelo menos um mock escrito noutra linguagem** que não a
  do core: um mock na mesma linguagem prova a lógica, não prova a fronteira.
- **RN-E18.** Cada ponta declara **a versão do contrato** que fala, e a mesa verifica-a no arranque.
  Versão incompatível **recusa**, não tenta.
- **RN-E19.** No contrato, **dinheiro e percentagem nunca viajam como número de vírgula flutuante**:
  viajam como **decimal textual com precisão declarada**, para que duas linguagens cheguem ao mesmo
  número. Vale para todas as mensagens — boleta, resolução, desfecho e objecto normalizado.

### 11.2. Topologia de processos

- **RN-E3.** A unidade de execução é **uma conta**: uma corretora, uma conta, `n` instrumentos. Uma
  ligação e uma chave por processo; um escritor por ledger; falha isolada por conta.
  **Precisão (28 set 2026):** o processo que segura a ligação e a chave é o **conector** — um por conta. A
  **mesa** pode servir várias contas sem segurar chave nenhuma: ela **encaminha** cada ficha ao conector da
  conta dela (o destino resolve-se no encaminhamento, e não num campo da mensagem).
- **RN-E4.** NÃO um processo por instrumento: multiplica ligações, chaves e processos sem ganho de
  isolamento que interesse — a correlação entre instrumentos da mesma conta é governada pelo mandato,
  não pelo processo.
- **RN-E5.** NÃO um processo com várias corretoras: juntaria chaves e ligações de corretoras diferentes
  e faria a falha de uma derrubar as outras.
- **RN-E6.** O core DEVE ser **indiferente à topologia**: nada nele pode saber quantos processos
  existem nem onde corre cada instrumento. A topologia é decisão de implantação, não de código.
- **RN-E7.** O ledger é escrito por (mesa, instrumento, dia); processos diferentes NUNCA escrevem no
  mesmo ficheiro.
- **RN-E21.** Quem **arranca os conectores** é a **camada de operação** (o vigia, §11.4), nunca o core: o
  core **não arranca processos**. A mesa é lançada com os conectores que a sua configuração nomeia; se um
  conector não estiver de pé, a porta do manifesto **recusa o arranque** e diz qual — a mesa não sobe meio
  cega. (A montagem de processos é decisão de implantação, RN-E6.)
- **RN-E22.** Numa mesa com várias contas, o alcance dos verbos é este: **`start`/`stop`/`pause`/`reset` são
  da MESA** (valem para todas as contas que ela serve, incluindo o encerramento gracioso), e **`nova_sessao`
  é POR CONTA** — a sessão é a unidade de comparação do CB, e o CB mede-se sobre o equity **daquela** conta
  (RN-M3, RN-V10). Um `nova_sessao` da mesa inteira seria abrir sessão na conta que não bateu no limite.

### 11.3. Superfície (a web)

- **RN-E8.** A web fala com um **registo de mesas** — uma lista de identidades e endereços —, NUNCA com
  um endereço único. Cada mesa publica a sua identidade num caminho fixo, para o registo poder ser
  descoberto em vez de mantido à mão.
- **RN-E9.** A web reúne as mesas e apresenta-as como **uma só superfície**; não calcula nada que a
  mesa já saiba (resultado, velas, posição) nem mostra a topologia.
- **RN-E23.** No registo da web (RN-E8), **«uma mesa» é a instalação** — a identidade que publica o seu
  endereço —, e as contas são **vistas dela**. A superfície mostra «uma mesa com três instrumentos» e «três
  mesas com um instrumento» iguais (RN-E10), e agora também não muda de forma por a mesa servir uma ou três
  contas. A conta aparece onde é informação (atribuição, resumo, CB), nunca como uma segunda identidade.
- **RN-E10.** Uma mesa com três instrumentos e três mesas com um instrumento cada DEVEM parecer iguais
  na web. É esta propriedade que mantém a topologia no campo da operação.

---

### 11.4. O vigia (start, stop, pause, reset, nova_sessao e encerramento gracioso)

O servidor é **puro** e não há agente administrador: na inicialização sobe um processo pequeno e
determinístico que só obedece a cinco verbos. Não sabe de estratégia, de mercado nem de ledger.

- **RN-V1.** Os verbos são **cinco** e determinísticos: **start** (põe uma mesa a correr), **stop**
  (termina a mesa), **pause** (a mesa continua viva, para de abrir, continua a reconciliar),
  **reset** (reinício sem mexer em nada, RN-V3) e **nova_sessao** (RN-V10).
- **RN-V2.** **Pause não é stop.** Terminar o processo com posição aberta deixaria a posição sem
  governo: em `pause` a mesa mantém-se a reconciliar e apenas NÃO abre — é a mesma inibição do
  RN-M3.1.
- **RN-V2.1.** Em `pause` a **reconciliação** e a **verificação do circuit breaker** CONTINUAM: `pause`
  suspende **abertura**, nunca **defesa**. Se a posição aberta caminhar para o limite com a mesa
  pausada, quem fecha é o CB.
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
- **RN-V9.1.** `encerrando` **sem resposta** volta ao normal: a mesa volta a operar, abre incluído, e o
  pedido de `stop` fica registrado como **pendente**. Um pedido ignorado não paralisa a mesa.
- **RN-V10.** **`nova_sessao`** é o único verbo que abre sessão: limpa a inibição do circuit breaker
  (RN-M3.3) e grava instante, equity de partida, autor e **motivo**. É também o verbo que **fecha uma
  unidade de comparação** — uma sessão tem uma configuração em vigor (ficha, versão do setup, versão do
  mandato), e mudar ficha ou setup exige sessão nova, senão os resultados de dois setups ficam somados no
  mesmo número (RN-M3.5). `reset` NUNCA limpa a inibição: ele não altera nada (RN-V3).

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
   start, stop, pause, reset e nova_sessao (RN-V1 a RN-V10). `pause` não é `stop`; `reset` nunca apaga o
   ledger nem limpa inibição; `nova_sessao` é o único verbo que abre sessão — e é ele que fecha uma
   unidade de comparação.
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

18. **Linguagem:** **TypeScript** no core e na superfície, **Python no `/tools`**; a linguagem de cada
    **plugin** é decisão da **spec daquele plugin**, tomada na hora de o construir. Para isso o contrato
    é **neutro de linguagem** — o schema é a fonte e cada linguagem gera dele (RN-E16 a RN-E19).
19. **Mocks de setup e de conector** para prova de contrato, com **pelo menos um escrito noutra
    linguagem** que não a do core: um mock na mesma linguagem prova a lógica, não prova a fronteira
    (RN-E17).

20. **A sessão do circuit breaker é a corrida da mesa** — desde o arranque, não a do instrumento. A ideia
    inicial era a sessão do instrumento; o dono corrigiu: o sistema opera no automático, logo a janela é
    a da mesa (RN-M3).
21. **Um setup pode ser manual.** O desenho de plugins admite — sem mudar o core — um **setup cujo lado
    vem de uma pessoa** (uma interface que ela preenche), e não de um cálculo. É a imagem inicial do dono
    ("o humano preenche a boleta"), recuperada **por composição** em vez de por excepção: o humano ganha
    as mesmas travas e a mesma auditoria (RN-T15, RN-T15.1, §2).

22. **`nova_sessao` existe** — e é mais do que a saída da inibição: é o que **fecha uma unidade de
    comparação**. Uma sessão tem uma configuração em vigor, e trocar de setup exige sessão nova, para dois
    setups não somarem o resultado no mesmo número (RN-V10, RN-M3.5).
23. **`encerrando` sem resposta volta ao normal** — abre incluído, com o pedido de `stop` registrado como
    pendente: um pedido ignorado não paralisa a mesa (RN-V9.1).
24. **A posse de uma posição é da corretora, não nossa.** A ordem leva **marca de posse** e a mesa
    reencontra as suas posições pelos registros do venue — **sem base de dados própria de posições**
    (RN-B10, RN-T16.1). Verificado nos três venues: MT5 tem `POSITION_MAGIC` e `POSITION_COMMENT` **na
    própria posição** (e `POSITION_IDENTIFIER` liga-a a ordens e negócios); no cTrader o `clientOrderId`
    (texto, até 50) viaja na ordem e o vínculo à posição vem do `positionId` de cada negócio; a HL usa
    `cloid` (hex de 128 bits) e permite **consultar e cancelar por cloid**. Por isso a marca é desenhada
    para **caber na forma mais restrita** — o inteiro do MT5 —, não para o venue mais generoso.

**Confirmadas pelo dono (28 set 2026) — e a lista fechou-se aqui**

25. **Topologia confirmada e precisada:** **uma conta por processo** com `n` instrumentos (RN-E3), e a web a
    falar com um registo de mesas (RN-E8). A precisão que faltava é *onde* vive a multiplicidade: o
    **conector** é um processo por (corretora, conta), a **mesa** é um só processo e **encaminha** (RN-E21).
    Fundamento: RN-E5, e a retratação registada na emenda do plugin.
26. **Confirmada na intenção, corrigida no tempo.** A mesa recebe a **resolução** do conector (quantidade,
    nocional, margem, alavancagem efectiva, liquidação) e confere-a contra as bandas (RN-M4.5, RN-C10) —
    mas **não «antes de mandar executar» em geral**: são **dois momentos** (RN-E20). Onde a corretora
    deixar perguntar, confere-se antes e a recusa é da mesa; numa ordem **a mercado** o venue calcula **ao
    executar**, e fora da banda a resposta é **reduzir e registar**. A intenção original («impede uma ordem
    maior do que o autorizado quando o cálculo é de fora») mantém-se inteira — muda só o sítio onde se pode
    dizer não.
27. **A web pode editar fichas e config macro** (validado, versionado, assinado) e **pedir** arranque; quem
    lança o processo é o vigia, não a web (RN-E21). É o mesmo princípio que governa os **conectores**: quem
    monta um processo é a camada de operação, e o core — mesa e web — não arranca processos.

**Fechado por estas confirmações:** as três perguntas que ficaram abertas na emenda do plugin têm resposta
em regra — quem arranca os conectores (RN-E21), o alcance dos verbos numa mesa com várias contas (RN-E22) e
o que «uma mesa» é no registo (RN-E23).

**Abertas — o que depende de ti (não são números: são chaves)**

28. **O inventário de chaves**: fechar a lista das chaves e as suas omissões (`docs/inventario-de-chaves.md`,
    em rascunho). Os valores — 5%, 2%, 0,5% — são exemplos, mudam com o dono e com a conta (RN-A1 a RN-A3).
29. As **bandas** de cada item limitável (stop, tp, alavancagem, tempo máximo em posição) e a
    **tolerância de posição manual** por instrumento (RN-T16).
30. Instrumento a instrumento: a **distância mínima de liquidação**, quando um estudo a justificar.

---

## 16. Lacunas encontradas na revisão (27 set 2026)

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

**O humano na operação (a tua imagem inicial, que o desenho tinha perdido)**

- **RN-T15.** **Não há caminho especial para o dono**: o que existe é um **setup manual** — um plugin de
  setup cujo lado vem de uma **pessoa** (uma interface que ela preenche) em vez de um cálculo. É um setup
  por contrato, e por isso a proposta dele entra pelo **mesmo caminho**: mandato, bandas, boleta,
  resolução, ledger. A boleta NÃO ganha campo de origem — quem propôs é o setup, e o ledger já registra
  o nome e a versão dele (RN-L1). O mandato não abre excepção, e é isso que o torna útil: o humano ganha
  **as mesmas travas** que o automático — CB, margem total, risco por ordem, bandas, auditoria.
  - **RN-T15.1.** Um setup manual DEVE declarar um **prazo de resposta generoso** — quem responde é uma
    pessoa. Prazo de máquina num setup humano faria a mesa congelar à espera (RN-S8), que é punir o
    humano por ser humano.
- **RN-T16.** A mesa **não governa o que não abriu**: posição que apareça sem ter sido a mesa a abri-la —
  aberta na aplicação da corretora, por exemplo — é vista, dita e **não gerida** (nem stop, nem fecho).
  A ficha declara se aquele instrumento **tolera** posição manual; se não tolerar, a mesa fica em pausa
  nesse instrumento em vez de a gerir. Note-se que a operação manual do dono **não** cai aqui quando é
  feita por um setup manual (RN-T15): essa é da mesa, e é governada como qualquer outra.
- **RN-T16.1.** A posse de uma posição **lê-se da corretora**, pela **marca de posse** que a ordem levou
  (RN-B10): o conector declara no manifesto em que forma ela viaja, e a mesa reencontra as suas posições
  **pelos registros do venue** — sem base de dados própria de posições. O ledger guarda o **mapa**
  marca → ciclo/ficha, que é o detalhe legível; a corretora guarda a **prova**. Onde o venue não tiver
  marca, o manifesto declara `nenhuma` e a mesa cai para o registro do ledger: limitação **declarada**,
  nunca descoberta em produção.

**Segurança e operação**

- **RN-E14.** **Credenciais NUNCA em `/config`** (que a web edita e que é versionado), NUNCA no ledger,
  NUNCA no log. O conector lê-as do ambiente ou de um cofre, e o registro diz **qual** credencial foi
  usada, nunca o seu valor.
- **RN-M10.** **A config em vigor é a do arranque.** Alteração a quente NÃO tem efeito — a mesa diz que
  vale no próximo arranque. Sem isto, um risco muda a meio da sessão sem ninguém saber.
- **RN-E15.** A lista de **eventos que exigem aviso ao dono** é declarada (circuit breaker, encerramento,
  desfecho desconhecido, recusa, **recusa ao fechar**, **congelamento por falha do setup**, divergência,
  falha de leitura, contenda). Um alarme escolhido pelo programador é um alarme que falta quando importa.

**Um instrumento, um setup**

- **RN-M11.** Um instrumento tem **uma** ficha por conta. Dois setups no mesmo instrumento só com modelo
  de posição *hedging* e colisão declarada; em *netting* é fisicamente impossível — um instrumento, uma
  posição — e duas fichas seriam dois governos sobre a mesma posição, a anularem-se.

**O ledger no tempo**

- **RN-L6.** O ledger **nunca se reescreve**, mas a **retenção é declarada**: o que fica integral (o que
  se pode reexecutar), por quanto tempo, e o que passa a agregado. Sem regra escrita, um dia alguém
  apaga "para limpar" e perde-se o arquivo de túmulos.

### Reveladas pela máquina de estados (`docs/maquina-de-estados.md`)

- **RN-V2.1.** Em `pause` a reconciliação e a verificação do circuit breaker CONTINUAM: `pause` suspende
  **abertura**, nunca **defesa**.
- **RN-T7.3.** Recusa ao **fechar** é alarme grave: registra, alarmiza e volta a tentar.
- **RN-T16.1.** A **posse de uma posição lê-se da corretora**, pela **marca de posse** que a ordem levou
  — não do nosso registro, que guarda apenas o mapa marca → ciclo/ficha. (Correcção do dono: o
  comentário da ordem já marca o proprietário, e é isso que dispensa base de dados própria de posições.)
  Ver o RN-T16.1 em vigor na §11; esta linha registra como a lacuna apareceu.
- `RN-E15` passou a incluir o **congelamento** e a **recusa ao fechar** na lista de eventos que avisam.
- **Fechada por RN-V10 — o verbo da sessão nova.** Depois do circuit breaker o `start` recusa (RN-M3.3) e
  o `reset` não mexe em nada (RN-V3): não havia forma legal de abrir sessão nova. Decidido pelo dono: o
  **quinto verbo `nova_sessao`**, com autor, instante e motivo, único caminho fora da inibição.
- **Fechada por RN-V9.1 — `encerrando` sem resposta.** A mesa volta ao normal, com o pedido de stop
  registrado como pendente: um pedido ignorado não paralisa a mesa.
- **Achada depois, ao reconferir este documento** (o `ABERTA` da RN-T4 fez de cortina): o limite de
  inválidos seguidos e a **marca de posse** na lista de campos da boleta — ver
  `docs/inventario-de-chaves.md`, §6, itens 9 e 10.

---

## Emendas do dono — 28 set 2026

Substituem, a partir desta data, o que diziam as regras citadas. A regra antiga fica como **história**; o
que vale é o parágrafo abaixo de cada uma.

- **RN-D3 (relógio e idade do dado)** — a idade do dado deixa de ser limiar de operação. «Estou ligado?»
  vem do **protocolo da ligação**; a frescura do preço no envio resolve-se por **releitura + desvio da
  corretora**; a idade da **barra** é regra do **setup**, que recebe o OHLCV com o carimbo da corretora.
  Fica a regra: **sem ligação, não se abre risco novo — e a defesa continua**.
- **RN-T4 (proposta inválida)** — mantém-se: proposta ausente ou inválida é tratada como *hold*, com a
  razão do contrato registada ao lado da razão da casa. **Cai** o «N inválidos seguidos inibem a mesa».
  Entra: o **motivo decide a acção** (*repetir com atraso* · *recusar e registar* · *parar e
  reconciliar*), e **só se repete o que provadamente não foi feito**. Sem confirmação dentro do prazo,
  reconcilia-se **antes** de repetir — repetir às cegas abre uma segunda posição.
- **RN-M4.9 (contenda e ordem de atendimento)** — a ordem é **FIFO pela hora de chegada à mesa**, no relógio
  da **mesa** (não o do venue: esta fila é de intenções que chegaram a nós, e o venue nunca as viu; o instante
  que o pedido traga de fora **não se usa**, senão quem chama escolhe o lugar na fila). Empate resolve-se por
  ordem **alfabética** do símbolo (comparação simples de caracteres). A soma das parcelas é feita em
  **inteiros escalados**, nunca em vírgula flutuante. A ordem
  decide **quem fica de fora**, nunca a ordem de execução; havendo lugar para todos, entram todos.
- **RN-M4.12 (risco por ordem)** — o limite por ordem **não** é número da mesa. O mandato limita
  **exposição (nocional)** e **distância mínima até à liquidação**; a alavancagem é **facto do
  instrumento**, declarada pelo conector; o limite da conta é da corretora.
  > **NOTA DATADA — 02/10/2026.** O *travão* desta regra passou a existir, e a última frase é corrigida pela
  > decisão do dono no **D-015**: o limite por ordem **é aplicado pela MESA**, com o tecto que a **CONTA**
  > declara (`conta.risco_maximo_por_ordem_pct`), comparado com a exposição da ordem (`saldo_pct × alavancagem`,
  > em % do saldo — a equity cancela nos dois lados, porque a boleta não leva quantidade). Declarado, morde;
  > **ausente, a ordem é livre** — e a ausência fica dita no registo. A **distância mínima de liquidação**
  > continua a ser travão opcional, e nesta vaga o seu único leitor é a conferência da resolução
  > (`core/ciclo/banda.ts`): a mesa decidiu não a inventar sem preço de liquidação. Prova: `core/ciclo/provar.ts`
  > (47 casos de ciclo) e o fecho do D-015.
- **RN-B11 (nova) — o preço que serve de régua** — o preço enviado à corretora como referência do desvio é
  **relido no momento do envio**, pelo conector. Régua velha desloca a janela do desvio: o desvio medido a
  partir de uma régua velha pode **autorizar** um preenchimento longe do mercado — não protege nada.
- **RN-E20 (nova, corrigida em 28 set 2026) — a conferência da conta da corretora tem DOIS momentos.** Não
  se confundem, e confundi-los foi o erro da primeira versão desta regra:
  - **antes de enviar**, e só onde o venue deixar perguntar (cotação/estimativa): a mesa confere a
    estimativa contra a banda e **não envia** se não couber — a recusa é dela;
  - **sobre a resolução**, que é o caso geral de uma ordem **a mercado**: o venue calcula quantidade e
    margem **ao executar**, logo não há nada para conferir antes. Se os números caírem **fora** da banda, a
    resposta da mesa não é «recusar» (já está executado): é **reduzir** (reduzir é sempre permitido, mesmo
    sem leitura e sem ligação) e **registar a divergência**, sem abrir risco novo naquele instrumento até ela
    estar explicada.
  Para isto ser conferível, a **resolução tem de trazer números** (quantidade na unidade da corretora, margem
  exigida, alavancagem efectiva, preço de liquidação) e não um veredicto: «executou» não se confere. Se o
  plugin devolver só o veredicto, quem garante a banda passa a ser ele — e isso é uma decisão diferente, que
  transfere interpretação para quem existe para **traduzir e transportar**.

## Emenda do dono — o plugin da corretora e a constante do destino (28 set 2026)

Registado a partir das palavras do dono, sem as corrigir:

> «Plugin do cTrader: ele carrega constantes de todas as corretoras e contas no arranque; setup X manda a
> ordem e a constante que o plugin deve escolher. Ele consulta essa conta, faz os cálculos e executa
> devolvendo o resultado.»

### O que isto decide

1. **O plugin carrega as constantes das corretoras e das contas no arranque.** Não é configuração do dono: é
   **sondagem** — o que é da corretora é dela (§5 do inventário: manifesto *sondado, não configurado*).
2. **O destino é escolhido por uma constante nomeada, não por uma ligação implícita.** O mesmo plugin serve
   várias contas, e quem diz para onde vai a ordem é a constante.
3. **O plugin consulta a conta, faz as contas e executa, devolvendo o resultado.** É o desenho já decidido: o
   plugin **traduz** (percentagem do saldo → quantidade, pelas constantes daquele instrumento), o **venue
   calcula** (margem, alavancagem efectiva, liquidação) e **executa ou recusa com motivo**, e a **mesa
   confere** contra a banda (RN-E20).

### As duas fronteiras que esta emenda NÃO move

- **A constante é um nome, nunca uma credencial.** O que a mensagem leva é o alias que o plugin resolve na
  sua tabela carregada; a referência à credencial fica onde sempre esteve — fora da mensagem, do ledger e
  do log (RN-E14).
- **As constantes que o plugin carrega são FACTOS DO VENUE; os limites são do dono e não migram.** As
  constantes dizem o que a corretora permite (mínimo, passo, escalões de alavancagem, modelo de margem,
  regra de liquidação). O **teto de margem**, a **perda máxima** (CB) e o **risco por ordem** continuam a
  ser valores do dono, na configuração da mesa. Se as duas coisas se confundirem, o limite da conta passa a
  ser lido da corretora — e o dono fica a governar um número que não escreveu.

### O que a emenda deixa por decidir (e o que se mediu)

**a) De onde vem a constante — e por onde viaja.** Medido em 28 set 2026:

- `contracts/proposta.schema.json` tem **três** campos (`setup`, `lado`, `relogio`) e é fechado:
  `additionalProperties: false`. **O setup não pode escolher a conta** — se mandasse a constante, o contrato
  recusá-la-ia com `campo_desconhecido`. É a fronteira a funcionar, e é bom que assim seja: quem propõe o
  lado não escolhe o destino.
- `contracts/boleta.schema.json` tem **14** campos e **nenhum** nomeia conta ou corretora. Logo a constante
  — se tiver de viajar — **não cabe no contrato de hoje**: exige campo novo na boleta e **subida de versão**
  (o esquema é fechado; acrescentar campo é mudar contrato, e mudar contrato é acto declarado).

**A forma decidida pelo dono (e é a RN-E5 que já a mandava):**

> «multipar e uma corretora é um processo, e duas corretoras é 2 processos. mas não precisa ser 2 processos
> na mesa, e sim do plugin: 1 sobe amarrado a uma conta e o segundo à outra. Aí a mesa direciona para a
> conta certa de acordo com o config do setup.»

- **Mesa (core): UM processo**, e indiferente à topologia (RN-E6). Não tem ligação nem chave nenhuma.
- **Conector: UM processo por (corretora, conta)** — uma ligação, uma chave cada, falha isolada (RN-E3,
  RN-E5). Vários instrumentos da mesma conta vivem no mesmo processo (RN-E4: nada de um processo por
  instrumento).
- **A mesa encaminha**: a ficha diz de que conta é, e a mesa escreve a boleta ao conector **daquela**
  conta. A conta é resolvida no **encaminhamento**, não viaja na mensagem.

**Retratação (era eu que estava a propor contra a RN-E5).** A minha recomendação anterior — *uma* instância
do plugin a carregar as constantes de várias contas, com a constante na boleta — é precisamente «um processo
com várias corretoras», que a **RN-E5** proíbe desde o recorte 001: juntaria chaves e ligações de corretoras
diferentes e faria a falha de uma derrubar as outras. A regra já estava escrita; a proposta é que estava mal.
Consequência boa: **não é preciso campo novo na boleta nem versão nova do contrato** para o destino — quem
encaminha já sabe para onde encaminha.

**A configuração passa a ser por conta**, e é isso que dá à mesa o que encaminhar (as chaves de §1 do
inventário passam a `contas.<constante>.*`):

```
contas:
  <constante>:                     # o alias da (corretora, conta) - nome, nunca credencial
    identificador: ...             # qual conta na corretora
    margem_total_maxima_pct: ...   # o TECTO é da conta (a soma das fichas compara-se com ele)
    perda_maxima_pct: ...          # o CB é da conta (mede-se sobre o equity DELA)
    fichas: { <instrumento>: { risco: ..., setup: ... } }
```

Três agregados deixam de ser «da mesa» e passam a ser **da conta**: o **tecto de margem**, o **CB** e a
**fila da contenda** (o lugar disputado é margem daquela conta). O **manifesto** passa a ser declarado por
conta (cada conector declara a sua), e a atribuição no registo tem de dizer de que conta fala.

**Uma condição, e não é retórica:** os conectores têm de ser **processos**, não duas ligações dentro do
processo da mesa. Se as duas corretoras viverem dentro da mesa, o processo passa a segurar duas chaves e a
falha de uma derruba a outra — e a RN-E3 («uma ligação e uma chave por processo») fica decorativa. Com
processos, a costura é a que já existe (uma mensagem JSON por linha) e cada conector segura **uma** chave.

**b) O manifesto passa a ser por conta.** Hoje `manifesto.conector` é `{nome, versao}` e `instrumentos` é
uma lista só: um conector = uma conta. Um plugin que carrega constantes de várias contas tem de o declarar
**por conta** (cada conta com os seus instrumentos, escalões e mínimo), senão a porta do manifesto aprova
uma mesa que não sabe o que está a aprovar. Fica registado em `specs/002-maquina-de-estados/relatorios/DEFEITOS.md`
(D-002 ampliado).

## Emenda do dono — os plugins são sob demanda, e esta fase corre contra dublês (28 set 2026)

> «Plugins de corretora e setup são necessários a esta fase? Não pode ser mock? Como são plugins não há risco
> de ficar perdidos como lixo no código. Garantir o vigia e a mesa sem erro é primordial; um teste ponta a
> ponta com plugins reais pode ser exaustivo se falhar e é necessário correr atrás das falhas em mais de um
> projeto, e a construção e especificações deles pode ser sob demanda.»

**Decidido: sim.** Esta fase — **o vigia e a mesa** — corre contra **dublês** (mocks), e a construção dos
plugins reais é **sob demanda**, cada um na sua altura. Não é desvio do desenho: é o **RN-E17** em vigor
(«mocks de setup e de conector para prova de contrato, com pelo menos um escrito noutra linguagem»). Já
existem (`contracts/mocks/setup/main.ts` em TypeScript, `contracts/mocks/conector/*.py` em Python) e já
correm sem corretora e sem chave por `tools/verificar-contrato/ponta-a-ponta.sh`.

**Por que isto é o caminho, e não uma economia.** Com dublês, uma falha tem **um só pai possível**: o core.
Com plugins reais, a mesma falha tem três (mesa, plugin, venue) e o tempo vai-se no diagnóstico em vez de na
correcção — «correr atrás das falhas em mais de um projeto». E o risco de lixo que o dono levanta **não
existe aqui por construção**: um plugin não é resto de código, é uma **ponta de contrato** — e o contrato está
fechado desde o recorte 001 (9 schemas, vocabulário, envelope). É por isso que a spec de um plugin pode
esperar: **a fronteira já não se move quando ele chegar**.

**O que o dublê prova — e o que ele não prova.** Prova tudo o que é **da mesa e do vigia**: o mandato, as
portas do arranque, a contenda, o CB, a pausa, o encerramento gracioso, o ledger, os motivos e as acções. Não
prova **a conformidade da corretora** (RN-C6): a passiva no toque que assenta sem cruzar, o prazo esgotado a
virar resto agressivo, fechar-é-fechar, as recusas, a reconexão, o relógio de barra, a marcação. Isso só o
venue responde — e fica **declarado como pendência por venue**, não como surpresa. Adiar isto é legítimo;
esquecer não era.

**A condição que mantém o dublê honesto** (o risco real desta decisão): o dublê tem de ser **adversário** —
recusa, atrasa, cala-se, devolve números **fora da banda**, perde a ligação e volta. E os casos são **dado**
(`*.casos.json`, `*.decisoes.json`, `*.conformidade.json`), nunca `if` dentro do dublê. Um dublê que diz
sempre sim prova a fiação, não o comportamento. O `ponta-a-ponta.sh` já aprendeu isto à sua custa: o venue
simulado tem de começar **limpo**, senão a idempotência responde pela corrida anterior e o caso da recusa
passa **sem recusar** — o verde era do estado, não do código (está escrito no cabeçalho do script).

**Simetria (decisão do dono, mesmo dia): a tática vale nos dois sentidos.**

> «Para plugins a tática pode ser a mesma, sem usar a mesa real e sim um dublê de mesa para teste neles.»

- **RN-E24.** Cada ponta constrói-se contra um **dublê da outra ponta**, e o real só entra quando a
  **bateria de conformidade daquela ponta** correr. Nunca se põe meia operação de pé para provar a outra
  metade:

  | O que se está a provar | O que é real | O que é dublê |
  |---|---|---|
  | a **mesa** e o **vigia** | mesa, vigia | dublê de setup · dublê de conector |
  | um **setup** (plugin) | o setup | **dublê de mesa** |
  | um **conector** (plugin) | o conector | **dublê de mesa** (+ o venue de teste, RN-C6) |

  - O dublê de mesa vive **com o contrato** (`contracts/mocks/mesa/`), é escrito **do contrato** e nunca da
    implementação do core: um dublê copiado do core prova compatibilidade com a **nossa implementação**, não
    com o **contrato** — e esconde o defeito dos dois lados ao mesmo tempo. É o mesmo motivo do RN-E17 (um
    mock na mesma linguagem do core prova a lógica, não a fronteira).
  - O dublê é **adversário** (recusa, atrasa, cala-se, devolve fora da banda) e os seus casos são **dado**.
  - **O que esta regra não dispensa:** a **bateria de conformidade por venue** (RN-C6) e a ponta-a-ponta com
    as duas pontas **reais**, que continuam a ser o **aceite** de cada plugin. O dublê é ferramenta de
    construção; o aceite é contra o real.

**O que isto faz ao recorte seguinte.** O recorte 003 deixa de ser «o conector» e passa a ser **o vigia e a
mesa, ponta-a-ponta, contra dublês**. O primeiro conector real (cTrader) passa a recorte próprio, com a
bateria de conformidade (RN-C6) a correr no ambiente de teste do venue. E, ao pôr o vigia no ar, abre-se a
**única fronteira que ainda não tem mensagem contratada** — ver `DEFEITOS.md`, D-005.
