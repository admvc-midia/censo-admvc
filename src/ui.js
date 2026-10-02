// Utilidades de ecrã partilhadas pelas telas. Sem framework: cada tela monta o
// seu HTML numa string (sempre com esc() nos valores) e liga os eventos depois.

import { MIDIA } from './dados.js';

const app = document.getElementById('app');

export function esc(valor) {
  return String(valor == null ? '' : valor).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function $(seletor, raiz) {
  return (raiz || document).querySelector(seletor);
}

export function montar(html) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
  return app;
}

export function topo(subtitulo) {
  return `
    <header class="topo">
      <img src="/img/igreja-admvc.png" alt="Igreja ADMVC">
      <div><span class="selo">Censo ${new Date().getFullYear()}</span></div>
      <h1>Censo da <em>Família</em> ADMVC</h1>
      <p>${esc(subtitulo || 'Cada família conta.')}</p>
    </header>`;
}

/** Caixinha "Dúvidas? Fala com o irmão da mídia" — abre o WhatsApp direto. */
export function ajudaMidia(contexto) {
  const texto = 'Olá! Estou a preencher o Censo da Família ADMVC e tenho uma dúvida' + (contexto ? ' (' + contexto + ')' : '') + '.';
  return `
    <a class="cartao ajuda-midia" href="https://wa.me/${MIDIA.numero}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">
      <span class="ajuda-icone" aria-hidden="true">💬</span>
      <span><b>Dúvidas? Fala com o irmão da mídia</b><br><span>${MIDIA.formatado} · toca para abrir o WhatsApp</span></span>
    </a>`;
}

export function caixaErro(mensagem, lista) {
  if (!mensagem && !(lista && lista.length)) return '';
  const itens = lista && lista.length > 1
    ? `<ul>${lista.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '';
  return `<div class="erro" role="alert">${esc(mensagem || lista[0])}${itens}</div>`;
}

export function ocupado(botao, sim, rotulo) {
  if (!botao) return;
  if (sim) { botao.dataset.rotulo = botao.textContent; botao.textContent = rotulo || 'Um momento…'; }
  else if (botao.dataset.rotulo) botao.textContent = botao.dataset.rotulo;
  botao.disabled = sim;
}

/** Espelho de enderecoCompleto em api/censo.js: moradas antigas ou da
 *  planilha podem ter número, código postal e localidade à parte. */
export function enderecoCompleto(o) {
  const base = String((o && o.address_1) || '').trim();
  const partes = [o && o.address_number, o && o.address_2, o && o.postal_code, o && o.id_city]
    .map((x) => String(x || '').trim())
    .filter((x) => x && !base.toLowerCase().includes(x.toLowerCase()));
  return [base].concat(partes).filter(Boolean).join(', ');
}

/* ── Campo de data para todos (inclusive os mais velhos) ─────────────────
 * Em vez do seletor do telemóvel (que abre em 2026 e obriga a recuar décadas),
 * um campo de texto com teclado numérico: escreve-se 12041950 e as barras
 * aparecem sozinhas. Por baixo, a data por extenso confirma o que se escreveu.
 * O estado guarda sempre AAAA-MM-DD (ou '' enquanto não estiver completa). */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function mascaraData(valor) {
  const d = String(valor || '').replace(/\D+/g, '').slice(0, 8);
  if (d.length > 4) return d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
  if (d.length > 2) return d.slice(0, 2) + '/' + d.slice(2);
  return d;
}

/** "12/04/50" → "12/04/1950": ano com 2 dígitos, completado ao sair do campo. */
export function completarAno(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(texto || '');
  if (!m) return texto;
  const aa = Number(m[3]);
  return `${m[1]}/${m[2]}/${aa > new Date().getFullYear() % 100 ? 1900 + aa : 2000 + aa}`;
}

export function isoDaData(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto || '');
  if (!m) return '';
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== iso || iso < '1900-01-01' || d > new Date()) return '';
  return iso;
}

export function dataDoIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function porExtenso(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

const AJUDA_DATA = 'Escreve só os números: dia, mês e ano (ex.: 12041950).';

/** O <input> e a nota por baixo. `atributos` leva o data-campo ou o id. */
export function htmlCampoData(atributos, iso) {
  return `<input ${atributos} data-data type="text" inputmode="numeric" autocomplete="bday" placeholder="dd/mm/aaaa" maxlength="10" class="data-grande" value="${esc(dataDoIso(iso))}">
    <div class="nota ${iso ? 'ok' : ''}" data-nota-data>${iso ? '✓ ' + porExtenso(iso) : AJUDA_DATA}</div>`;
}

/** Chamado a cada tecla (e ao sair do campo, com `aoSair`): formata, mostra
 *  a data por extenso ou o que está errado, e devolve a data AAAA-MM-DD. */
export function atualizarCampoData(input, aoSair) {
  let texto = mascaraData(input.value);
  if (aoSair) texto = completarAno(texto);
  if (texto !== input.value) input.value = texto;
  const iso = isoDaData(texto);
  const nota = input.parentElement.querySelector('[data-nota-data]');
  if (nota) {
    const completa = texto.replace(/\D+/g, '').length === 8;
    nota.className = 'nota' + (iso ? ' ok' : completa ? ' erro-data' : '');
    nota.textContent = iso ? '✓ ' + porExtenso(iso) : completa ? 'Esta data não existe — confere o dia, o mês e o ano.' : AJUDA_DATA;
  }
  input.classList.toggle('invalido', !iso && texto.replace(/\D+/g, '').length === 8);
  return iso;
}
