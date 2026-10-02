import { esc, montar, $ } from '../ui.js';
import { telaInicio } from './inicio.js';

export function telaObrigado(ctx) {
  const primeiro = String(ctx.nome || '').trim().split(/\s+/)[0];
  montar(`
    <section class="obrigado">
      <div class="visto" aria-hidden="true">✓</div>
      <h1>${ctx.atualizado ? 'Dados atualizados' : 'Obrigado'}, ${esc(primeiro)}!</h1>
      <p style="color:var(--suave);margin:0 0 28px">${ctx.atualizado
        ? 'A tua família está em dia no censo.'
        : 'A tua família já conta no Censo da Família ADMVC.'}</p>
      <div class="cartao">
        <p class="versiculo">“Eu e a minha casa serviremos ao Senhor.”</p>
        <span class="referencia">Josué 24:15</span>
      </div>
      <div class="acoes">
        <button class="botao secundario" id="outro">Responder por outra família</button>
      </div>
      <p class="rodape">Se precisares de corrigir alguma coisa, volta a ler o QR code com o mesmo número.</p>
    </section>
  `);
  $('#outro').addEventListener('click', () => telaInicio({ config: ctx.config }));
}
