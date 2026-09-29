// Carrega a credencial do conector — do sitio que a config declarar, e so de la.
//
// O valor NUNCA vive no repositorio (RN-E14, RN-C20): o que a config traz e uma REFERENCIA. Este ficheiro
// resolve-a em dois sitios e mais nenhum:
//   "env:NOME_DA_VARIAVEL"            -> a variavel de ambiente
//   "ficheiro:/caminho/para/x.key"    -> um ficheiro FORA do repositorio, modo 0600
//
// E recusa em quatro casos, todos nomeados:
//   * a referencia nao diz de onde vem (formato_invalido);
//   * o que ela aponta nao existe ou esta vazio (campo_obrigatorio_ausente / valor_nulo_nao_permitido);
//   * o ficheiro e legivel por OUTROS (valor_fora_da_banda): a chave esta protegida, mas nao pela banda
//     que se exige — grupo ou mundo com leitura e um segredo partilhado com quem passar;
//   * o VALOR aparece num ficheiro VERSIONADO do repositorio (valor_fora_da_banda): um vazamento
//     acidental passa a ser um arranque RECUSADO, e nao um commit que ninguem ve.
//
// A varredura do repositorio faz-se em memoria, ficheiro a ficheiro: o valor nao entra em linha de
// comando nenhuma (nem no `ps`, nem no historico).

import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const RAIZ = join(import.meta.dir, "..", "..");

export type Feito = { ok: true; valor: string; de: string; protegido: string };
export type Recusa = { ok: false; motivo: string; porque: string };
export type Resultado = Feito | Recusa;

function recusa(motivo: string, porque: string): Recusa {
  return { ok: false, motivo, porque };
}

/** O valor aparece em algum ficheiro VERSIONADO? Comparado em memoria — nunca por linha de comando. */
export function estaNoRepositorio(valor: string, raiz = RAIZ): string | null {
  let ficheiros: string[] = [];
  try {
    ficheiros = execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8" })
      .split("\n")
      .filter((f) => f.length > 0);
  } catch {
    return null; // sem git a responder, nao se afirma nada (quem decide e quem chamou)
  }
  for (const relativo of ficheiros) {
    const caminho = join(raiz, relativo);
    try {
      if (statSync(caminho).size > 5_000_000) continue;
      if (readFileSync(caminho, "utf8").includes(valor)) return relativo;
    } catch {
      continue; // binario ou ilegivel: nao conta como prova de ausencia, mas tambem nao trava a leitura
    }
  }
  return null;
}

export function carregarCredencial(referencia: string, valorEm: string, raiz = RAIZ): Resultado {
  if (typeof referencia !== "string" || referencia.trim() === "") {
    return recusa("campo_obrigatorio_ausente", "a config nao declara `conta.credencial` (o NOME da credencial)");
  }
  if (typeof valorEm !== "string" || !/^(env|ficheiro):.+/.test(valorEm)) {
    return recusa(
      "formato_invalido",
      `credencial.valor_em tem de ser "env:NOME" ou "ficheiro:CAMINHO", e veio ${JSON.stringify(valorEm)}`,
    );
  }

  let valor: string;
  let de: string;
  let protegido: string;

  if (valorEm.startsWith("env:")) {
    const nome = valorEm.slice(4);
    const bruto = process.env[nome];
    if (bruto === undefined) {
      return recusa("campo_obrigatorio_ausente", `a variavel de ambiente ${nome} nao esta definida neste processo`);
    }
    valor = bruto.trim();
    de = `env:${nome}`;
    protegido = "ambiente do processo (a variavel nao entra na linha de comando)";
  } else {
    const caminhoBruto = valorEm.slice("ficheiro:".length);
    const caminho = caminhoBruto.startsWith("~") ? join(homedir(), caminhoBruto.slice(1)) : caminhoBruto;
    if (!isAbsolute(caminho) && !existsSync(join(raiz, caminho))) {
      return recusa("campo_obrigatorio_ausente", `o ficheiro da credencial nao existe: ${caminhoBruto}`);
    }
    const alvo = isAbsolute(caminho) ? caminho : join(raiz, caminho);
    if (!existsSync(alvo)) {
      return recusa("campo_obrigatorio_ausente", `o ficheiro da credencial nao existe: ${caminhoBruto}`);
    }
    const s = statSync(alvo);
    if (!s.isFile()) return recusa("formato_invalido", `o caminho da credencial nao e um ficheiro: ${caminhoBruto}`);
    if ((s.mode & 0o077) !== 0) {
      return recusa(
        "valor_fora_da_banda",
        `o ficheiro da credencial e legivel por grupo ou por outros (modo ${(s.mode & 0o777).toString(8)}); ` +
          `exige-se 600 — a chave esta protegida, mas nao pela banda que se exige`,
      );
    }
    valor = readFileSync(alvo, "utf8").trim();
    de = `ficheiro:${caminhoBruto}`;
    protegido = `ficheiro fora do repositorio, modo ${(s.mode & 0o777).toString(8)}`;
  }

  if (valor === "") {
    return recusa("valor_nulo_nao_permitido", `a credencial ${referencia} veio vazia de ${de}`);
  }

  const onde = estaNoRepositorio(valor, raiz);
  if (onde !== null) {
    return recusa(
      "valor_fora_da_banda",
      `o VALOR da credencial aparece no ficheiro versionado ${onde}: a chave esta escrita no repositorio ` +
        `(RN-E14) — troque-a no venue e apague-a do historico antes de continuar`,
    );
  }

  return { ok: true, valor, de, protegido };
}
