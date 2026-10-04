/* ============================================================================================
 * A BARRA DO TELEFONE — o gesto que muda o estado, sem rolagem.
 *
 * O gesto está aqui, nomeado, mas quem o executa é a linha de comando que ESPECIFICA o contrato — e a
 * tela di-lo em vez de escrever a ficha por baixo do pano (RN-E12: a escrita exige validação e assinatura).
 * ========================================================================================== */
import { escapar, instrumentoAtual, redesenho } from "./nucleo.js";

export function desenharBarraDoTelefone() {
  const i = instrumentoAtual();
  const barra = document.getElementById("barra-do-telefone");
  if (!i) { barra.innerHTML = ""; return; }
  barra.innerHTML = `
    <span class="quem mono fraco" title="rodar ${i.ficha?.run ? "sim" : "não"} · enviar ${i.ficha?.enviar ? "sim" : "não"}">${escapar(i.instrumento)} · rodar <b class="${i.ficha?.run ? "compra-txt" : "fraco"}">${i.ficha?.run ? "●" : "○"}</b> · enviar <b class="${i.ficha?.enviar ? "compra-txt" : "fraco"}">${i.ficha?.enviar ? "●" : "○"}</b></span>
    <button class="botao" id="bt-par">${i.ficha?.run ? "Retirar" : "Ligar"}</button>
    <a class="botao" href="#configuracao">Config.</a>
    <button class="botao" id="bt-rec">Actualizar</button>`;
  document.getElementById("bt-par").onclick = () => {
    const cmd = `bash tools/ligar-par.sh ${i.instrumento} ${i.ficha?.run ? "nao" : "sim"}`;
    navigator.clipboard?.writeText(cmd);
    alert(`O gesto do dono é uma linha (copiada):\n\n${cmd}\n\nA tela ainda NÃO escreve a ficha: a edição exige validação e assinatura (RN-M2).`);
  };
  document.getElementById("bt-rec").onclick = () => redesenho.recarregar();
}
