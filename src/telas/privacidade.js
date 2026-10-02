// /privacidade — o que o censo guarda, para quê e a quem pedir para corrigir
// ou apagar (RGPD). Linguagem simples: quem lê é o irmão no telemóvel.

import { montar, topo, ajudaMidia } from '../ui.js';
import { MIDIA } from '../dados.js';

export function telaPrivacidade() {
  montar(`
    ${topo('Privacidade e os teus dados')}
    <article class="cartao texto-legal">
      <h2>Quem é responsável</h2>
      <p>A <b>Igreja ADMVC</b> (Figueira da Foz) é a responsável pelos dados recolhidos no Censo da Família.
        Para qualquer pedido, fala com a equipa da mídia: <b>${MIDIA.formatado}</b> (WhatsApp).</p>

      <h2>O que guardamos</h2>
      <ul>
        <li>Nome, data de nascimento, sexo, nacionalidade, telemóvel e e-mail (opcional) de quem responde;</li>
        <li>As pessoas da família que nos indicas (cônjuge e filhos) e o parentesco;</li>
        <li>A morada e o bairro da casa, e se aceitam receber um culto no lar.</li>
      </ul>

      <h2>Para quê</h2>
      <p>Só para organizar a vida da igreja: conhecer as famílias, contactar-te, organizar cultos no lar e
        Pequenos Grupos por bairro, e planear o ministério infantil. <b>Não vendemos nem partilhamos</b> os
        teus dados com terceiros.</p>

      <h2>Quem vê</h2>
      <p>Só a equipa da igreja responsável pelo censo, com uma senha. A tua data de nascimento serve também
        para confirmares que és tu quando voltares a abrir o censo com o teu número.</p>

      <h2>Onde ficam e por quanto tempo</h2>
      <p>Num serviço de armazenamento na internet (Upstash), protegido. Guardamos enquanto fizeres parte da
        comunidade da igreja, ou até pedires para apagar.</p>

      <h2>Os teus direitos</h2>
      <p>Podes, a qualquer momento, <b>ver, corrigir ou pedir para apagar</b> os teus dados e os da tua família,
        e retirar a autorização. Para corrigir, volta a ler o QR code e entra com o teu número. Para apagar ou
        retirar a autorização, fala com a equipa da mídia.</p>
    </article>
    ${ajudaMidia('privacidade e os meus dados')}
    <div class="acoes"><a class="botao secundario" href="/">Voltar ao censo</a></div>
  `);
}
