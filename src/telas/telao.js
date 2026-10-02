// /telao — para projetar no culto. O QR aponta para a página inicial deste
// mesmo site (ou para ?url=… se for preciso apontar para outro endereço).
// A contagem atualiza a cada 15 s, só com a página visível: a quota do Upstash
// é partilhada com o inscreva e o volta-admvc.

import { esc, montar } from '../ui.js';
import { apiGet } from '../api.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

function carregarLib() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = QR_LIB;
    s.onload = ok;
    s.onerror = () => falha(new Error('não carregou o gerador de QR'));
    document.head.appendChild(s);
  });
}

/** Desenha o QR como SVG com viewBox, para escalar ao tamanho do ecrã sem
 *  ficar desfocado. */
function svgQr(texto) {
  const qr = window.qrcode(0, 'M');
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  let caminho = '';
  for (let l = 0; l < n; l++) {
    for (let c = 0; c < n; c++) if (qr.isDark(l, c)) caminho += `M${c} ${l}h1v1h-1z`;
  }
  return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code do censo"><path d="${caminho}" fill="#121412"/></svg>`;
}

export async function telaTelao() {
  const destino = new URLSearchParams(location.search).get('url') || (location.origin + '/');
  const legivel = destino.replace(/^https?:\/\//, '').replace(/\/$/, '');

  montar(`
    <div class="palco">
      <div>
        <img class="logo" src="/img/igreja-admvc.png" alt="Igreja ADMVC">
        <h1>Censo da<br><em>Família</em> ADMVC</h1>
        <p class="lema">Cada família conta.</p>
        <ol class="passos">
          <li><b>1</b> Aponta a câmara do telemóvel para o QR code</li>
          <li><b>2</b> Escreve o teu número de telemóvel</li>
          <li><b>3</b> Conta-nos quem vive contigo</li>
        </ol>
        <p class="contagem" id="contagem"></p>
      </div>
      <div>
        <div class="qr" id="qr"></div>
        <p class="qr-legenda">ou abre <strong>${esc(legivel)}</strong></p>
      </div>
    </div>
  `);

  try {
    await carregarLib();
    document.getElementById('qr').innerHTML = svgQr(destino);
  } catch (e) {
    document.getElementById('qr').innerHTML = `<p style="color:#121412;text-align:center;font-size:2vw">Sem internet para gerar o QR.<br>${esc(legivel)}</p>`;
  }

  const contagem = document.getElementById('contagem');
  async function atualizar() {
    if (document.hidden) return;
    try {
      const r = await apiGet({ acao: 'contagem' });
      contagem.innerHTML = r.familias
        ? `<strong>${r.familias}</strong> ${r.familias === 1 ? 'família já conta' : 'famílias já contam'}`
        : 'Sê a primeira família a responder!';
    } catch (e) { /* mantém o último número */ }
  }
  atualizar();
  setInterval(atualizar, 15000);
  document.addEventListener('visibilitychange', atualizar);
}
