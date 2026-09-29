# brokers/hyperliquid

O primeiro conector **a serio**: fala o contrato neutro da mesa de um lado, e o venue (Hyperliquid) do outro.
Em **ambiente de teste** ate o dono declarar a passagem a producao (RN-H17).

O que ele entrega, e onde:

| Peca | Ficheiro | O que faz |
|---|---|---|
| A sonda e o manifesto | `manifesto.ts` | le do venue, a cada arranque, o que ele oferece — sem nenhum desses valores constante no codigo (FR-001) |
| A traducao | `traducao.ts` | boleta em unidades neutras → quantidade e preco na unidade do instrumento, com recusa nomeada para tudo o que nao cabe (FR-006 a FR-011) |
| O desfecho | `desfecho.ts` | normaliza nas quatro classificacoes, reconcilia o desconhecido (FR-012 a FR-015) |
| As leituras | `leituras.ts` | posicao, equity, marcas e os cinco numeros do resumo do encerramento (FR-016 a FR-018) |
| A ligacao | `ligacao.ts` | uma ligacao, uma chave, um processo; o estado vem do protocolo do venue (FR-019 a FR-023) |
| A porta de processo | `processos.ts` | o vigia arranca-o; ele fala o contrato por stdio |
| Os casos | `casos/*.casos.json` | em dado, e correm nos DOIS lados: aqui e no duble do conector do recorte 001 — divergencia e falha |
| A conformidade | `conformidade/<versao>.txt` | o resultado da bateria de oito provas, por versao do conector e data |

Regras que este conector cumpre (e que se verificam por comando):

- importa `contracts`, **NUNCA** o `core` (RN-E1) — ha uma prova na bateria que o confirma;
- nao decide nada: nao escolhe lado, tamanho, preco nem momento; nao le estrategia, mandato nem fichas; nao
  julga risco (RN-C5, RN-C15);
- nada se ajusta em silencio: o que nao cabe e **recusado com motivo** (RN-C3);
- a credencial entra por **referencia** e o valor vive **fora** do repositorio (RN-C20, RN-E14).

O que este diretorio **nao** contem, de proposito: nenhuma versao de venue escrita em codigo (tudo se sonda),
nenhum numero de risco, nenhuma credencial — nem um valor de exemplo.
