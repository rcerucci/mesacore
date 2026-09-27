# config

Os arquivos do **dono**. A mesa lê-os e valida-os e **nunca os escreve** (RN-E12); a web edita-os com
validação e assinatura (RN-M2). Três famílias, e só três:

| Arquivo | É de | Traz |
|---|---|---|
| `conta.*` — **macro** | a conta | instrumentos, corretora e conta, perda máxima e a janela da sua medição, margem total máxima, política de contenção de margem, ordem de atendimento |
| `fichas/<instrumento>.risco.*` | a posição (forma **fixa**, do core) | percentagem do saldo, alavancagem, distância mínima de liquidação, janela, e as bandas onde os itens do setup têm de caber |
| `fichas/<instrumento>.setup.*` | a estratégia (forma publicada pelo **setup**) | os itens que o template daquele setup declarou (ema_fast, ema_slow, stop, limiares) |

## A conta e a contenda — por que o macro existe

Uma ficha não vê as outras: três instrumentos com 50% do saldo cada **não cabem** ao mesmo tempo. Isso
não é erro de nenhuma ficha — é decisão de conta:

- no arranque, a mesa compara a **soma** das fichas com o teto e **avisa** (RN-M4.7);
- o dono **corrige** os números ou **declara** a política de contenção — sem declaração, o arranque
  **recusa**, porque contenda não se resolve por omissão;
- com a política `espera`, o instrumento sem margem fica **à espera de saldo** e entra quando houver
  lugar. Esperar **não** é uma ordem em fila: registra-se o motivo (`sem_margem`) e o ciclo seguinte
  corre o seu caminho normal — sinal velho não é sinal (RN-M4.8);
- quando dois instrumentos disputam o mesmo lugar, vale a **ordem declarada** (RN-M4.9): a mesa não
  escolhe quem cede.
