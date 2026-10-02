// Passo 1: o telemóvel. O servidor diz em que caso estamos:
//   novo       → cadastro vazio
//   pre        → pré-cadastro sem data: cadastro com o primeiro nome
//   pre_data   → pré-cadastro com data: pede a data; se conferir, abre com os
//                dados da equipa; se não, segue com o formulário vazio
//   registado  → já respondeu: pede a data para abrir (família ou perfil)

import { esc, $, montar, topo, caixaErro, ocupado, ajudaMidia, htmlCampoData, atualizarCampoData } from '../ui.js';
import { api } from '../api.js';
import { PAISES } from '../dados.js';
import { validarTelefone } from '../telefone.js';
import { telaCadastro } from './cadastro.js';

export function telaInicio(ctx) {
  const { config } = ctx;
  const ultimo = ctx.telefone || { pais: '351', numero: '' };
  const paisConhecido = PAISES.some((p) => p.cod === ultimo.pais);

  let aviso = '';
  if (config.semRede) aviso = '<div class="aviso">Não conseguimos falar com o servidor. Verifica a internet antes de começar.</div>';
  else if (!config.armazenamento) aviso = '<div class="aviso">Modo de demonstração: a base de dados não está ligada e o envio vai falhar.</div>';

  montar(`
    ${topo('Cada família conta. Responde em dois minutos.')}
    ${aviso}
    <form class="cartao" id="form" novalidate>
      <h2><span class="num">1</span> Começa pelo teu telemóvel</h2>
      <p class="ajuda">É ele que identifica a tua família no censo.</p>
      <div id="erro"></div>
      <div class="telefone">
        <select id="pais" aria-label="Indicativo do país">
          ${PAISES.map((p) => `<option value="${p.cod}" ${(paisConhecido ? p.cod === ultimo.pais : p.cod === '') ? 'selected' : ''}>${p.bandeira} ${p.cod ? '+' + p.cod : p.nome}</option>`).join('')}
        </select>
        <input id="numero" type="tel" inputmode="tel" autocomplete="tel-national"
               value="${esc(ultimo.numero)}" placeholder="912 345 678" aria-label="Número de telemóvel">
      </div>
      <label class="campo ${paisConhecido ? 'oculto' : ''}" id="caixa-outro" style="margin-top:10px">
        <span>Indicativo do país</span>
        <input id="outro" inputmode="numeric" placeholder="ex.: 33" value="${paisConhecido ? '' : esc(ultimo.pais)}">
      </label>
      <div class="acoes"><button class="botao" id="seguir">Continuar</button></div>
    </form>
    <p class="rodape">Os teus dados ficam só com a Igreja ADMVC e servem para organizar a vida da igreja (RGPD).
      <a href="/privacidade" style="color:inherit">Política de privacidade</a></p>
  `);

  const pais = $('#pais');
  const numero = $('#numero');
  const outro = $('#caixa-outro');
  const atualizarExemplo = () => {
    const p = PAISES.find((x) => x.cod === pais.value);
    numero.placeholder = p ? p.exemplo : '';
    outro.classList.toggle('oculto', pais.value !== '');
  };
  pais.addEventListener('change', atualizarExemplo);
  atualizarExemplo();
  if (!numero.value) numero.focus();

  $('#form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const botao = $('#seguir');
    const t = validarTelefone(pais.value || $('#outro').value, numero.value);
    if (t.erro) {
      $('#erro').innerHTML = caixaErro(t.erro);
      numero.classList.add('invalido');
      return;
    }
    numero.classList.remove('invalido');
    ocupado(botao, true, 'A verificar…');
    try {
      const r = await api('verificar', { telefone: t });
      const base = { config, telefone: r.telefone };
      if (r.estado === 'registado') telaData({ ...base, registado: true, nome: r.nome });
      else if (r.estado === 'pre_data') telaData({ ...base, registado: false });
      else telaCadastro({ ...base, modo: 'novo', primeiroNome: r.primeiro_nome || '' });
    } catch (e) {
      $('#erro').innerHTML = caixaErro(e.message);
      ocupado(botao, false);
    }
  });
}

/** Confirmar com a data de nascimento. Para quem já respondeu, a data é a do
 *  seu cadastro; para o pré-cadastro, a da planilha da igreja. */
// Depois de errar a data uma vez e mais duas, o pré-cadastro deixa de
// insistir: o botão passa a "Continuar assim mesmo" (formulário vazio, e a
// equipa vê o aviso).
const ERROS_ATE_CONTINUAR = 3;

function telaData(ctx) {
  const { config, telefone, registado, nome } = ctx;
  let erros = 0;
  montar(`
    ${topo()}
    <div class="cartao" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span>📱 <b>${esc(telefone.formatado)}</b></span>
      <button type="button" class="botao secundario pequeno" id="trocar">Trocar</button>
    </div>
    <form class="cartao" id="form" novalidate>
      <h2>${registado ? `Olá, ${esc(nome)}! 👋` : 'Que bom ter-te aqui! 👋'}</h2>
      <p class="ajuda">${registado
        ? 'Este número já está no censo. Para ver e atualizar, confirma a tua data de nascimento.'
        : 'A igreja já tem alguns dados teus. Para os vermos juntos, confirma a tua data de nascimento.'}</p>
      <div id="erro"></div>
      <label class="campo">
        <span>Data de nascimento</span>
        ${htmlCampoData('id="nascimento"', '')}
      </label>
      <div class="acoes">
        <button class="botao" id="abrir">Confirmar</button>
        <button class="botao secundario" type="button" id="voltar">Não sou eu / outro número</button>
      </div>
    </form>
    <div id="ajuda"></div>
  `);

  const botao = $('#abrir');
  const campoData = $('#nascimento');
  campoData.addEventListener('input', () => { atualizarCampoData(campoData); campoData.classList.remove('invalido'); });
  campoData.addEventListener('blur', () => atualizarCampoData(campoData, true));
  campoData.focus();
  const desistiu = () => !registado && erros >= ERROS_ATE_CONTINUAR;
  const voltar = () => telaInicio({ config, telefone });
  $('#trocar').addEventListener('click', voltar);
  $('#voltar').addEventListener('click', voltar);

  $('#form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (desistiu()) { telaCadastro({ config, telefone, modo: 'novo' }); return; }
    const prova = atualizarCampoData(campoData, true);
    if (!prova) {
      $('#erro').innerHTML = caixaErro('Escreve a data de nascimento completa: dia, mês e ano (ex.: 12041950).');
      campoData.classList.add('invalido');
      campoData.focus();
      return;
    }
    ocupado(botao, true, 'A confirmar…');
    try {
      const r = await api('abrir', { telefone, prova });
      if (r.modo === 'pre') telaCadastro({ config, telefone, modo: 'novo', pre: r.pre });
      else telaCadastro({ config, telefone, prova, ...r });
    } catch (e) {
      ocupado(botao, false);
      if (e.estado !== 403 && e.estado !== 429) { $('#erro').innerHTML = caixaErro(e.message); return; }
      erros = e.estado === 429 ? Math.max(erros + 1, ERROS_ATE_CONTINUAR) : erros + 1;
      if (desistiu()) {
        // Pré-cadastro: não trava a pessoa no culto — segue com o formulário
        // vazio, e a equipa vê o aviso "data diferente" no painel.
        $('#erro').innerHTML = caixaErro('A data continua a não conferir. Podes continuar e preencher tudo — a equipa confere depois.');
        botao.textContent = 'Continuar assim mesmo';
        botao.dataset.rotulo = 'Continuar assim mesmo';
      } else if (!registado) {
        const faltam = ERROS_ATE_CONTINUAR - erros;
        $('#erro').innerHTML = caixaErro(`${e.message} Confere o dia, o mês e o ano${faltam ? ' e tenta outra vez' : ''}.`);
      } else {
        $('#erro').innerHTML = caixaErro(e.message);
      }
      // Quem errou já precisa de ajuda: a caixinha da mídia aparece.
      $('#ajuda').innerHTML = ajudaMidia('não consigo confirmar a data de nascimento do número ' + telefone.formatado);
    }
  });
}
