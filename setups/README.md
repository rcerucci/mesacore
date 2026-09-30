# setups

Um diretório por setup: `setups/<nome>/`.

Cada setup entrega:

- a **regra**: o lado (buy, sell, hold, caixa) e o seu **relógio** (RN-S1, RN-S2);
- o **template de configuração**: um item por parâmetro (nome, tipo, unidade, omissão, significado) —
  toda a estratégia vive aí, inclusive se há stop ou não (RN-S3);
- **os dois arquivos de configuração por instrumento**: o de **risco**, de forma fixa (schema do core:
  percentagem do saldo, alavancagem, distância mínima de liquidação, janela, bandas) e o **seu**, cuja
  forma publica no template (RN-S10, RN-S11);
- o **schema do seu próprio estado**, com namespace e versão `estado/<setup>/<versão>/<instrumento>`
  (RN-S6);
- os seus **testes**.

Regras que estes diretórios DEVEM cumprir:

- importam `contracts`; NUNCA `core` (RN-E1);
- **a linguagem do plugin é decisão da spec deste setup** (RN-E16): ele fala a mensagem do contrato e
  declara a versão que fala (RN-E18). Nenhum setup é obrigado à linguagem do core;
- não vêem tamanho, risco, execução nem a corretora (RN-S1, RN-M4.1);
- não mandam na boleta: quem a preenche é a mesa (RN-S9);
- variantes são **fichas** do mesmo plugin, não plugins novos (RN-S5).

> **NOTA DATADA — 30/09/2026: o `sigma` é o ÚNICO setup do repositório, e é ele que manda.** A pedido do dono,
> os dois directórios de exemplo foram **retirados** — `cruzamento_de_media/` (o molde em TypeScript e Python) e
> `exemplo-cruzamento-de-media/` (que só tinha o `questionario.json`) —, com as fichas deles
> (`fichas/cruzamento_de_media/`) e a bancada que os corria (`tools/verificar-setup/exemplos.sh`). O setup que
> existe é **`setups/sigma/`**: o `sign(mid - MA) + ZZ` do Pine, com o motor em `sinal.ts`, o script do dono em
> `pine/sign-mid-ma-zz.pine` e a regra da entrada («entrada só na barra do flip») provada em
> `tools/verificar-setup/sigma-casos.py`. Quem escrever o PRÓXIMO setup tem, como referência viva, aquele
> directório, este documento, e as duas bancadas do portão (`Pine x motor` e `sigma: entrada so' no flip`) —
> que são o exemplo de como um setup se prova. **O registo dos exemplos retirados fica no histórico do git**
> (`git show 3cd4a29^:setups/cruzamento_de_media/plugin.ts`).
>
> **NOTA DATADA — 29/09/2026, duas correcções medidas.** (1) O nome do setup **não admite hífen**:
> `contracts/_defs/forma.schema.json` exige `^[a-z][a-z0-9_]{1,31}$` — o directório de exemplo que já está aqui
> (`exemplo-cruzamento-de-media/`) **violaria o contrato do próprio repositório**. O primeiro plugin a sério
> chama-se, por exemplo, `cruzamento_de_media`, e o exemplo muda de nome quando for usado a sério. (2) O
> «setup de referência (sigma)» que este parágrafo anuncia **não existe no repositório** — o que existe é
> `exemplo-cruzamento-de-media/`, e dentro dele só o `questionario.json`. O que o primeiro setup precisa de
> saber para ser escrito — o que recebe, em que formato, e o que entrega — está em
> `setups/O-QUE-UM-SETUP-RECEBE-E-ENTREGA.md`.
>
> **Texto original, mantido por baixo (o registo é auditável):** *«O primeiro a entrar aqui é o setup de
> referência (sigma), que passa a ser uma fonte de consulta e de vectores de replay — não código a copiar.»*
