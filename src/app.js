// Entrada: escolhe a tela pelo caminho. /telao e /admin vão para o mesmo
// index.html pelos rewrites do vercel.json.

import { apiGet } from './api.js';
import { telaInicio } from './telas/inicio.js';

const caminho = location.pathname.replace(/\/+$/, '') || '/';

async function iniciar() {
  if (caminho === '/telao') {
    document.body.classList.add('telao');
    (await import('./telas/telao.js')).telaTelao();
    return;
  }
  if (caminho === '/privacidade') {
    (await import('./telas/privacidade.js')).telaPrivacidade();
    return;
  }
  if (caminho === '/admin') {
    document.body.classList.add('painel');
    (await import('./telas/admin.js')).telaAdmin();
    return;
  }

  let config = { armazenamento: false, bairros: [] };
  try { config = await apiGet({ acao: 'config' }); } catch (e) { config.semRede = true; }
  telaInicio({ config: config });
}

iniciar();
