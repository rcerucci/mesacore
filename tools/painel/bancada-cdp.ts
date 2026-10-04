#!/usr/bin/env bun
// A BANCADA CDP — o Chrome headless e o cliente do protocolo, num só sítio.
//
// PORQUE EXISTE: as provas do painel (`prova-do-recolhido.ts`, `prova-do-catalogo.ts`) medem o DOM a sério, no
// mesmo motor que o dono usa — não o olho e não um `grep`. Duas cópias deste arranque seriam duas contas da
// mesma coisa (a segunda a divergir da primeira, como sempre). Aqui é uma só.
//
// O QUE ELA NÃO É: não é produto. Não faz parte da tela, não corre com o sistema, e ninguém a serve a um
// utilizador. É bancada — e o Chrome e a pasta temporária morrem com ela.
//
// Uso (nas provas):
//   const b = await abrirBancada({ url, largura: 1440, altura: 900 });
//   const n = await b.avaliar("document.querySelectorAll('[data-recolhivel]').length");
//   b.fechar();

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CHROME = process.env.CHROME ?? "google-chrome";

export type Bancada = {
  porto: number;
  largura: number;
  altura: number;
  /** Avalia uma expressão na página e devolve o valor (lança se a página rebentar na expressão). */
  avaliar: (expr: string) => Promise<any>;
  /** Envia um método cru do protocolo (Page.*, Emulation.*, …). */
  mandar: (metodo: string, params?: Record<string, unknown>) => Promise<any>;
  /** Navega e espera que a página assente. */
  ir: (url: string) => Promise<void>;
  /** Fecha o Chrome e limpa o perfil temporário. */
  fechar: () => void;
};

export const sono = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sobe um Chrome headless com uma porta de depuração própria (porta 0 = o sistema escolhe, e não colide com
 * outro Chrome que esteja a ser usado por outra prova ou pelo dono).
 */
export function subirChrome(): { processo: Bun.Subprocess; perfil: string; porto: Promise<number> } {
  const perfil = mkdtempSync(join(tmpdir(), "mesacore-bancada-chrome-"));
  const processo = Bun.spawn([
    CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-extensions",
    "--remote-debugging-port=0", `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdout: "ignore", stderr: "pipe" });
  const porto = (async () => {
    const leitor = (processo.stderr as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let bruto = "";
    const limite = Date.now() + 25000;
    while (Date.now() < limite) {
      const { value, done } = await leitor.read();
      if (done) break;
      bruto += dec.decode(value);
      const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(bruto);
      if (m) return Number(m[1]);
    }
    throw new Error("o Chrome não publicou a porta de depuração em 25 s");
  })();
  return { processo, perfil, porto };
}

/** Abre uma página nova na bancada e liga-se ao protocolo por WebSocket. */
export async function abrirBancada(opcoes: { url: string; largura?: number; altura?: number; espera_ms?: number; limparStorage?: boolean }): Promise<Bancada> {
  const largura = opcoes.largura ?? 1440;
  const altura = opcoes.altura ?? 900;
  const { processo, perfil, porto } = subirChrome();
  const p = await porto;
  const alvo = (await (await fetch(`http://127.0.0.1:${p}/json/new?${encodeURIComponent(opcoes.url)}`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map<number, (m: any) => void>();
  ws.onmessage = (ev: MessageEvent) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pend.has(m.id)) { pend.get(m.id)!(m); pend.delete(m.id); }
  };
  await new Promise<void>((r) => { ws.onopen = () => r(); });
  const mandar = (metodo: string, params: Record<string, unknown> = {}) =>
    new Promise<any>((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: metodo, params })); });
  const avaliar = async (expr: string) => {
    const r = await mandar("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(`na página: ${r.result.exceptionDetails.text} ${r.result.exceptionDetails.exception?.description ?? ""}`);
    return r.result?.result?.value;
  };
  const ir = async (url: string) => {
    await mandar("Emulation.setDeviceMetricsOverride", { width: largura, height: altura, deviceScaleFactor: 1, mobile: largura < 700 });
    await mandar("Page.navigate", { url });
    await sono(opcoes.espera_ms ?? 3500);
  };
  await mandar("Runtime.enable");
  await mandar("Page.enable");
  await mandar("Page.bringToFront");
  // O estado do que recolhe vive no `localStorage`: uma bancada que herda o do dono media outra tela.
  if (opcoes.limparStorage !== false) await mandar("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.clear()}catch(e){}" });
  await ir(opcoes.url);
  return {
    porto: p, largura, altura, avaliar, mandar, ir,
    fechar() {
      try { ws.close(); } catch { /* já fechado */ }
      try { processo.kill(); } catch { /* já morreu */ }
      rmSync(perfil, { recursive: true, force: true });
    },
  };
}
