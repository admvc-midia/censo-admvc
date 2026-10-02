// /admin — painel da equipa. A senha é conferida no servidor a cada pedido;
// aqui fica só no sessionStorage (fecha o separador, pede de novo).

import { esc, $, montar, caixaErro, ocupado, enderecoCompleto } from '../ui.js';
import { api } from '../api.js';

const CHAVE_SESSAO = 'censo-admvc/senha';

function lerSenha() { try { return sessionStorage.getItem(CHAVE_SESSAO) || ''; } catch (e) { return ''; } }
function guardarSenha(s) { try { if (s) sessionStorage.setItem(CHAVE_SESSAO, s); else sessionStorage.removeItem(CHAVE_SESSAO); } catch (e) { /* sem storage: pede de novo */ } }

export async function telaAdmin() {
  const senha = lerSenha();
  if (!senha) return telaEntrar();
  try {
    telaPainel(senha, await api('admin-listar', { senha }));
  } catch (e) {
    if (e.estado === 401) guardarSenha('');
    telaEntrar(e.message);
  }
}

function telaEntrar(mensagem) {
  montar(`
    <div style="max-width:420px;margin:10vh auto 0">
      <header class="topo">
        <img src="/img/igreja-admvc.png" alt="">
        <h1>Painel do <em>Censo</em></h1>
        <p>Só para a equipa da Igreja ADMVC.</p>
      </header>
      <form class="cartao" id="form">
        <div id="erro">${caixaErro(mensagem)}</div>
        <label class="campo"><span>Senha</span><input id="senha" type="password" autocomplete="current-password"></label>
        <div class="acoes"><button class="botao" id="entrar">Entrar</button></div>
      </form>
    </div>
  `);
  $('#senha').focus();
  $('#form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const senha = $('#senha').value;
    const botao = $('#entrar');
    ocupado(botao, true, 'A entrar…');
    try {
      const dados = await api('admin-listar', { senha });
      guardarSenha(senha);
      telaPainel(senha, dados);
    } catch (e) {
      $('#erro').innerHTML = caixaErro(e.message);
      ocupado(botao, false);
    }
  });
}

/* ── Contas ───────────────────────────────────────────────── */

const ORDEM = { Titular: 0, 'Cônjuge': 1, 'Filho(a)': 2, Outro: 3 };
const dataPt = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('pt-PT') : '');
function idade(iso) {
  if (!iso) return null;
  const n = new Date(iso + 'T00:00:00');
  const h = new Date();
  let a = h.getFullYear() - n.getFullYear();
  if (h < new Date(h.getFullYear(), n.getMonth(), n.getDate())) a--;
  return a;
}
const apelido = (p) => (p ? String(p.last_name || p.nome_completo || '').trim().split(/\s+/).pop() : '');

function telaPainel(senha, dados) {
  let familias = [];
  let pessoas = [];
  let pre = [];
  let bairros = [];
  let regioes = [];
  let nacionalidades = [];
  let regiaoDoBairro = new Map();
  let membrosDe = new Map();
  let familiaPorId = new Map();

  function carregar(d) {
    familias = d.familias || [];
    pessoas = d.pessoas || [];
    pre = d.pre || [];
    bairros = d.bairros || [];
    regioes = d.regioes || [];
    nacionalidades = d.nacionalidades || [];
    regiaoDoBairro = new Map();
    regioes.forEach((r) => r.bairros.forEach((b) => regiaoDoBairro.set(b.toLowerCase(), r)));
    membrosDe = new Map(familias.map((f) => [f.id, []]));
    pessoas.forEach((p) => { if (membrosDe.has(p.familia_id)) membrosDe.get(p.familia_id).push(p); });
    membrosDe.forEach((l) => l.sort((a, b) => (ORDEM[a.parentesco] - ORDEM[b.parentesco]) || String(a.birthdate).localeCompare(String(b.birthdate))));
    familiaPorId = new Map(familias.map((f) => [f.id, f]));
  }
  carregar(dados);

  /* ── Formulários do painel (pessoa e morada) ──────────────── */

  /** Lista de escolha com "Outro…": escolher Outro mostra uma caixa de texto.
   *  Um valor guardado que já não está na lista continua a aparecer. */
  function escolhaComOutro(campo, lista, atual) {
    const valor = atual || '';
    const naLista = !valor || lista.some((x) => x.toLowerCase() === valor.toLowerCase());
    return `
      <select data-f="${campo}" data-com-outro onchange="this.nextElementSibling.classList.toggle('oculto', this.value !== '__outro__')">
        <option value=""></option>
        ${lista.map((x) => `<option ${x.toLowerCase() === valor.toLowerCase() ? 'selected' : ''}>${esc(x)}</option>`).join('')}
        <option value="__outro__" ${naLista ? '' : 'selected'}>Outro…</option>
      </select>
      <input data-outro="${campo}" class="${naLista ? 'oculto' : ''}" value="${naLista ? '' : esc(valor)}" placeholder="Escreve qual" style="margin-top:8px">`;
  }

  const opcoes = (lista, atual, vazio = true) => (vazio ? '<option value=""></option>' : '') +
    lista.map((x) => `<option ${x === atual ? 'selected' : ''}>${esc(x)}</option>`).join('');

  function formPessoaHtml(d, o = {}) {
    return `
      <div class="linha">
        <label class="campo"><span>Nome completo</span><input data-f="nome" value="${esc(d.nome)}"></label>
        <label class="campo"><span>Telemóvel</span><input data-f="telefone" type="tel" value="${esc(d.telefone)}" placeholder="+351 912 345 678"></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Data de nascimento</span><input data-f="birthdate" type="date" value="${esc(d.birthdate)}"></label>
        <label class="campo"><span>Sexo</span><select data-f="gender">${opcoes(['Masculino', 'Feminino'], d.gender)}</select></label>
      </div>
      <div class="linha">
        <label class="campo"><span>Tipo</span><select data-f="church_role">${opcoes(o.tipos || ['Membro', 'Congregado', 'Visitante', 'Não frequenta'], d.church_role)}</select></label>
        ${o.parentesco ? `<label class="campo"><span>Parentesco</span><select data-f="parentesco">${opcoes(['Titular', 'Cônjuge', 'Filho(a)', 'Outro'], d.parentesco, false)}</select></label>` : ''}
      </div>
      <div class="linha">
        <label class="campo"><span>E-mail</span><input data-f="email" type="email" value="${esc(d.email)}"></label>
        <label class="campo"><span>Nacionalidade</span>${escolhaComOutro('nationality', nacionalidades, d.nationality)}</label>
      </div>`;
  }

  /** Morada = endereço completo (opcional) + bairro (obrigatório), como no
   *  formulário do irmão. */
  function formMoradaHtml(d, o = {}) {
    return `
      <label class="campo"><span>Endereço completo</span><input data-f="address_1" value="${esc(enderecoCompleto(d))}" placeholder="Rua, número, andar, código postal, localidade"></label>
      <label class="campo"><span>Bairro <b class="obrig">*</b></span>${escolhaComOutro('neighborhood', bairros, d.neighborhood)}</label>
      ${o.culto ? `<label class="campo"><span>Culto no lar</span><select data-f="culto_no_lar">${opcoes(['Sim', 'Talvez', 'Não'], d.culto_no_lar)}</select></label>` : ''}`;
  }

  const lerFormulario = (caixa) => Object.fromEntries([...caixa.querySelectorAll('[data-f]')].map((el) => {
    if (el.value === '__outro__') return [el.dataset.f, caixa.querySelector(`[data-outro="${el.dataset.f}"]`).value];
    return [el.dataset.f, el.value];
  }));

  const titular = (f) => (membrosDe.get(f.id) || [])[0];
  const nomeFamilia = (f) => 'Família ' + (apelido(titular(f)) || '?');
  const filtro = { texto: '', bairro: '', tipo: '', culto: '' };
  const filtroPre = { texto: '', estado: 'faltam' };
  const selecionados = new Set();
  let aba = 'familias';

  montar(`
    <div class="barra">
      <h1>Censo da Família ADMVC</h1>
      <div class="abas">
        <button class="botao pequeno" data-aba="familias">Famílias</button>
        <button class="botao secundario pequeno" data-aba="pre">Pré-cadastro</button>
        <button class="botao secundario pequeno" data-aba="mapa">Mapa</button>
        <button class="botao secundario pequeno" data-aba="bairros">Listas</button>
        <button class="botao secundario pequeno" id="sair">Sair</button>
      </div>
    </div>
    <div id="conteudo"></div>
  `);
  document.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => {
    aba = b.dataset.aba;
    document.querySelectorAll('[data-aba]').forEach((x) => x.classList.toggle('secundario', x !== b));
    desenhar();
  }));
  $('#sair').addEventListener('click', () => { guardarSenha(''); telaEntrar(); });

  async function recarregar() {
    carregar(await api('admin-listar', { senha }));
    desenhar();
  }

  function desenhar() {
    if (aba === 'bairros') return desenharBairros();
    if (aba === 'pre') return desenharPre();
    if (aba === 'mapa') return desenharMapa().catch(erro);
    return desenharFamilias();
  }

  const erro = (e) => { const c = $('#erro'); if (c) { c.innerHTML = caixaErro(e.message); c.scrollIntoView({ block: 'center' }); } };

  /* ── Famílias ─────────────────────────────────────────────── */

  function filtradas() {
    const t = filtro.texto.trim().toLowerCase();
    return familias.filter((f) => {
      const m = membrosDe.get(f.id) || [];
      return (!filtro.bairro || f.neighborhood === filtro.bairro) &&
        (!filtro.culto || f.culto_no_lar === filtro.culto) &&
        (!filtro.tipo || m.some((p) => p.church_role === filtro.tipo)) &&
        (!t || m.map((p) => [p.nome_completo, p.phone_1, p.email].join(' ')).concat(f.address_1).join(' ').toLowerCase().includes(t));
    });
  }

  function desenharFamilias() {
    const lista = filtradas();
    const daLista = lista.flatMap((f) => membrosDe.get(f.id) || []);
    const porBairro = {};
    familias.forEach((f) => { porBairro[f.neighborhood] = (porBairro[f.neighborhood] || 0) + 1; });
    const ordemBairros = Object.keys(porBairro).sort((a, b) => porBairro[b] - porBairro[a] || a.localeCompare(b));

    $('#conteudo').innerHTML = `
      <div class="numeros">
        <div class="numero"><b>${lista.length}</b><span>famílias${lista.length !== familias.length ? ` (de ${familias.length})` : ''}</span></div>
        <div class="numero"><b>${daLista.length}</b><span>pessoas</span></div>
        <div class="numero"><b>${daLista.filter((p) => { const i = idade(p.birthdate); return i !== null && i < 18; }).length}</b><span>menores de 18</span></div>
        <div class="numero"><b>${lista.filter((f) => f.culto_no_lar === 'Sim').length}</b><span>aceitam culto no lar</span></div>
        <div class="numero"><b>${daLista.filter((p) => p.church_role === 'Visitante').length}</b><span>visitantes</span></div>
      </div>

      <div class="por-bairro">
        ${ordemBairros.map((b) => `<button data-bairro="${esc(b)}" class="${filtro.bairro === b ? 'on' : ''}">${esc(b)}<b>${porBairro[b]}</b></button>`).join('')}
      </div>

      <div class="filtros">
        <input id="f-texto" placeholder="Procurar nome, telemóvel, rua…" value="${esc(filtro.texto)}">
        <select id="f-bairro"><option value="">Todos os bairros</option>${ordemBairros.map((b) => `<option ${filtro.bairro === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
        <select id="f-tipo"><option value="">Todos os tipos</option>${['Membro', 'Congregado', 'Visitante', 'Não frequenta'].map((t) => `<option ${filtro.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <select id="f-culto"><option value="">Culto no lar: todos</option>${['Sim', 'Talvez', 'Não'].map((t) => `<option ${filtro.culto === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <button class="botao secundario pequeno" id="csv-completo">⬇ CSV completo (Excel)</button>
        <button class="botao secundario pequeno" id="csv-admvc">⬇ CSV para o admvc-site</button>
        <button class="botao secundario pequeno" data-copia>💾 Cópia de segurança</button>
        <button class="botao secundario pequeno" id="recarregar">↻ Recarregar</button>
      </div>
      <div id="erro"></div>

      ${lista.length ? lista.map(cartaoFamilia).join('') : '<p class="vazio">Nenhuma família com estes filtros.</p>'}
    `;

    const ligarFiltro = (id, campo, evento) => $(id).addEventListener(evento, (e) => {
      filtro[campo] = e.target.value;
      const pos = e.target.selectionStart;
      desenharFamilias();
      if (campo === 'texto') { const i = $('#f-texto'); i.focus(); i.setSelectionRange(pos, pos); }
    });
    ligarFiltro('#f-texto', 'texto', 'input');
    ligarFiltro('#f-bairro', 'bairro', 'change');
    ligarFiltro('#f-tipo', 'tipo', 'change');
    ligarFiltro('#f-culto', 'culto', 'change');
    document.querySelectorAll('[data-bairro]').forEach((b) => b.addEventListener('click', () => {
      filtro.bairro = filtro.bairro === b.dataset.bairro ? '' : b.dataset.bairro;
      desenharFamilias();
    }));
    $('#csv-completo').addEventListener('click', () => baixar('censo-completo', csvCompleto(lista), true));
    $('#csv-admvc').addEventListener('click', () => baixar('censo-para-admvc-site', csvAdmvc(lista), false));
    $('#recarregar').addEventListener('click', () => recarregar().catch(erro));
    ligarCopia();

    document.querySelectorAll('[data-apagar-familia]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Apagar a ${b.dataset.nome} e todas as pessoas dela? Não dá para desfazer.`)) return;
      try { await api('admin-apagar-familia', { senha, id: b.dataset.apagarFamilia }); await recarregar(); } catch (e) { erro(e); }
    }));
    document.querySelectorAll('[data-mover]').forEach((b) => b.addEventListener('click', () => abrirMover(b.dataset.mover)));
    document.querySelectorAll('[data-editar-pessoa]').forEach((b) => b.addEventListener('click', () => abrirEditarPessoa(b.dataset.editarPessoa)));
    document.querySelectorAll('[data-nova-pessoa]').forEach((b) => b.addEventListener('click', () => abrirEditarPessoa(null, b.dataset.novaPessoa)));
    document.querySelectorAll('[data-editar-familia]').forEach((b) => b.addEventListener('click', () => abrirEditarFamilia(b.dataset.editarFamilia)));
  }

  /** Recarrega e volta a abrir a família onde se estava a trabalhar. */
  async function recarregarAberta(familiaId) {
    await recarregar();
    const det = document.querySelector(`[data-editar-familia="${familiaId}"]`);
    if (det) det.closest('details').open = true;
  }

  function abrirEditarPessoa(id, familiaNova) {
    const p = id ? pessoas.find((x) => x.id === id) : null;
    const famId = p ? p.familia_id : familiaNova;
    const caixa = p ? $('#editar-p-' + id) : $('#editar-f-' + famId);
    if (p && !caixa.classList.contains('oculto')) { caixa.classList.add('oculto'); return; }
    caixa.classList.remove('oculto');
    const d = p ? { nome: p.nome_completo, telefone: p.phone_1, birthdate: p.birthdate, gender: p.gender, church_role: p.church_role, email: p.email, nationality: p.nationality, parentesco: p.parentesco }
      : { parentesco: 'Filho(a)' };
    caixa.innerHTML = `
      <div class="pessoa" style="width:100%;margin:0 0 6px">
        <p class="pessoa-titulo">${p ? 'Editar ' + esc(p.nome_completo) : 'Adicionar pessoa à família'}</p>
        <div data-erro></div>
        ${formPessoaHtml(d, { parentesco: true })}
        <p class="nota" style="margin:-4px 0 10px">Quem tem telemóvel precisa de data de nascimento. Escolher outro titular faz o atual passar a cônjuge.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="botao pequeno" data-guardar>${p ? 'Guardar' : 'Adicionar'}</button>
          ${p ? '<button class="botao perigo pequeno" data-apagar-p>Apagar pessoa</button>' : '<button class="botao secundario pequeno" data-cancelar>Cancelar</button>'}
        </div>
      </div>`;
    const mostrarErro = (e) => { caixa.querySelector('[data-erro]').innerHTML = caixaErro(e.message); };
    caixa.querySelector('[data-guardar]').addEventListener('click', async (ev) => {
      ocupado(ev.target, true, 'A guardar…');
      try {
        await api('admin-editar-pessoa', { senha, id: p ? p.id : undefined, familia: famId, dados: lerFormulario(caixa) });
        await recarregarAberta(famId);
      } catch (e) { mostrarErro(e); ocupado(ev.target, false); }
    });
    const cancelar = caixa.querySelector('[data-cancelar]');
    if (cancelar) cancelar.addEventListener('click', () => { caixa.innerHTML = ''; });
    const apagarP = caixa.querySelector('[data-apagar-p]');
    if (apagarP) apagarP.addEventListener('click', async () => {
      if (!confirm(`Apagar ${p.nome_completo}? Não dá para desfazer.`)) return;
      try { await api('admin-apagar-pessoa', { senha, id: p.id }); await recarregarAberta(famId); } catch (e) { mostrarErro(e); }
    });
  }

  function abrirEditarFamilia(famId) {
    const f = familiaPorId.get(famId);
    const caixa = $('#editar-f-' + famId);
    caixa.innerHTML = `
      <div class="pessoa">
        <p class="pessoa-titulo">Morada da ${esc(nomeFamilia(f))}</p>
        <div data-erro></div>
        ${formMoradaHtml(f, { culto: true })}
        <div style="display:flex;gap:8px">
          <button class="botao pequeno" data-guardar>Guardar</button>
          <button class="botao secundario pequeno" data-cancelar>Cancelar</button>
        </div>
      </div>`;
    caixa.querySelector('[data-cancelar]').addEventListener('click', () => { caixa.innerHTML = ''; });
    caixa.querySelector('[data-guardar]').addEventListener('click', async (ev) => {
      ocupado(ev.target, true, 'A guardar…');
      try {
        await api('admin-editar-familia', { senha, id: famId, dados: lerFormulario(caixa) });
        await recarregarAberta(famId);
      } catch (e) { caixa.querySelector('[data-erro]').innerHTML = caixaErro(e.message); ocupado(ev.target, false); }
    });
  }

  function cartaoFamilia(f) {
    const m = membrosDe.get(f.id) || [];
    const morada = enderecoCompleto(f);
    const mapa = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([morada, f.neighborhood, 'Figueira da Foz'].filter(Boolean).join(', '))}`;
    const avisos = m.filter((p) => p.data_diferente_pre).map((p) => `⚠ ${esc(p.first_name)}: data de nascimento diferente da do pré-cadastro`);
    return `
      <details class="familia">
        <summary>
          <div class="quem">
            <b>${esc(nomeFamilia(f))}</b>
            <span>${esc(f.neighborhood)} · ${m.length} ${m.length === 1 ? 'pessoa' : 'pessoas'} · ${esc(m.map((p) => p.first_name).join(', '))}</span>
          </div>
          ${avisos.length ? '<span class="etiqueta" style="color:var(--dourado)">⚠ ver</span>' : ''}
          ${f.gdpr_aceite === false ? '<span class="etiqueta" title="Montada pela equipa: o titular ou o cônjuge ainda não entrou para confirmar">Consentimento por confirmar</span>' : ''}
          ${f.culto_no_lar === 'Sim' ? '<span class="etiqueta verde">Culto no lar</span>' : ''}
        </summary>
        <div style="padding:0 16px 16px">
          ${avisos.length ? `<div class="aviso">${avisos.join('<br>')}</div>` : ''}
          <ul class="membros">
            ${m.map((p) => {
              const i = idade(p.birthdate);
              return `
              <li>
                <span class="etiqueta ${p.is_family_admin ? 'verde' : ''}">${esc(p.parentesco)}</span>
                <b>${esc(p.nome_completo)}</b>
                <span style="color:var(--suave);font-size:14px">
                  ${i !== null ? i + ' anos' : ''}${p.gender ? ' · ' + esc(p.gender) : ''}${p.church_role ? ' · ' + esc(p.church_role) : ''}
                  ${p.phone_1 ? ` · <a href="https://wa.me/${esc(p.telefone_chave)}" target="_blank" rel="noopener" style="color:var(--verde)">${esc(p.phone_1)}</a>` : ''}
                  ${p.email ? ' · ' + esc(p.email) : ''}${p.nationality ? ' · ' + esc(p.nationality) : ''}
                </span>
                <span class="mover" style="display:flex;gap:6px">
                  <button class="botao secundario pequeno" data-editar-pessoa="${esc(p.id)}">Editar</button>
                  <button class="botao secundario pequeno" data-mover="${esc(p.id)}">Mover</button>
                </span>
              </li>
              <li id="editar-p-${esc(p.id)}" class="oculto"></li>
              <li id="mover-${esc(p.id)}" class="oculto"></li>`;
            }).join('')}
          </ul>
          <dl class="detalhe" style="padding:10px 0 0">
            <div><dt>Morada</dt><dd>${esc(morada || '—')} · <a href="${mapa}" target="_blank" rel="noopener" style="color:var(--verde)">mapa</a></dd></div>
            <div><dt>Bairro / freguesia</dt><dd>${esc(f.neighborhood)}${f.bairro_fora_lista ? ' <span class="etiqueta">fora da lista</span>' : ''}${f.freguesia ? '<br>' + esc(f.freguesia) : ''}</dd></div>
            <div><dt>Estado civil (titular)</dt><dd>${esc((m[0] && m[0].marital_status) || '—')}</dd></div>
            <div><dt>Culto no lar</dt><dd>${esc(f.culto_no_lar)}</dd></div>
            <div><dt>Registo</dt><dd>${dataPt(f.criado_em)}${f.atualizado_em !== f.criado_em ? ' · atualizado ' + dataPt(f.atualizado_em) : ''}</dd></div>
            <div class="acoes-linha">
              <button class="botao secundario pequeno" data-editar-familia="${esc(f.id)}">Editar morada</button>
              <button class="botao secundario pequeno" data-nova-pessoa="${esc(f.id)}">+ Adicionar pessoa</button>
              <button class="botao perigo pequeno" data-apagar-familia="${esc(f.id)}" data-nome="${esc(nomeFamilia(f))}">Apagar família</button>
            </div>
          </dl>
          <div id="editar-f-${esc(f.id)}"></div>
        </div>
      </details>`;
  }

  function abrirMover(pessoaId) {
    const caixa = $('#mover-' + pessoaId);
    if (!caixa.classList.contains('oculto')) { caixa.classList.add('oculto'); return; }
    const p = pessoas.find((x) => x.id === pessoaId);
    const outras = familias.filter((f) => f.id !== p.familia_id)
      .map((f) => ({ id: f.id, nome: nomeFamilia(f) + ' — ' + (membrosDe.get(f.id) || []).map((x) => x.first_name).join(', ') }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    caixa.classList.remove('oculto');
    caixa.innerHTML = `
      <div class="pessoa" style="width:100%;margin:0 0 6px">
        <p class="pessoa-titulo">Mover ${esc(p.nome_completo)}</p>
        <div class="linha">
          <label class="campo"><span>Para</span><select data-destino>
            <option value="nova">Uma família nova, só dele(a)</option>
            ${outras.map((f) => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join('')}
          </select></label>
          <label class="campo"><span>Como</span><select data-papel>
            ${['Filho(a)', 'Cônjuge', 'Titular', 'Outro'].map((x) => `<option>${x}</option>`).join('')}
          </select></label>
        </div>
        <button class="botao pequeno" data-confirmar>Mover</button>
      </div>`;
    caixa.querySelector('[data-confirmar]').addEventListener('click', async (ev) => {
      ocupado(ev.target, true, 'A mover…');
      try {
        await api('admin-mover', { senha, pessoa: pessoaId, destino: caixa.querySelector('[data-destino]').value, parentesco: caixa.querySelector('[data-papel]').value });
        await recarregar();
      } catch (e) { erro(e); ocupado(ev.target, false); }
    });
  }

  /* ── Pré-cadastro ─────────────────────────────────────────── */

  function desenharPre() {
    const comConta = new Set(pessoas.filter((p) => p.telefone_chave).map((p) => p.telefone_chave));
    const responderam = pre.filter((p) => comConta.has(p.telefone_chave)).length;
    const t = filtroPre.texto.trim().toLowerCase();
    const lista = pre.filter((p) => {
      const ok = comConta.has(p.telefone_chave);
      if (filtroPre.estado === 'faltam' && ok) return false;
      if (filtroPre.estado === 'responderam' && !ok) return false;
      return !t || [p.nome, p.phone_1, p.neighborhood, p.address_1].join(' ').toLowerCase().includes(t);
    });
    const link = location.origin + '/';
    const zap = (p) => 'https://wa.me/' + p.telefone_chave + '?text=' + encodeURIComponent(
      `Olá ${String(p.nome).split(' ')[0]}! A Igreja ADMVC está a fazer o Censo da Família. Responde em dois minutos: ${link}`);
    const pessoaDe = new Map(pessoas.map((p) => [p.telefone_chave, p]));

    $('#conteudo').innerHTML = `
      <div class="numeros">
        <div class="numero"><b>${pre.length}</b><span>no pré-cadastro</span></div>
        <div class="numero"><b>${pre.filter((p) => p.birthdate).length}</b><span>com data de nascimento</span></div>
        <div class="numero"><b>${responderam}</b><span>já responderam</span></div>
        <div class="numero"><b>${pre.length - responderam}</b><span>faltam responder</span></div>
      </div>

      <div class="cartao">
        <h2>Importar lista</h2>
        <p class="ajuda">Copia as colunas do Excel e cola aqui (com a linha de títulos), ou escolhe um ficheiro CSV.
          Obrigatórias: <b>Nome completo</b> e <b>Telemóvel</b>. Com <b>Data de nascimento</b>, quem digitar o número
          confirma a data e recebe o formulário já preenchido com morada, e-mail, etc. Outras colunas que o painel
          não conheça ficam nas observações (só a equipa vê). Importar de novo atualiza quem já está na lista.</p>
        <div id="erro"></div>
        <textarea id="planilha" rows="6" placeholder="Nome completo&#9;Telemóvel&#9;Data de nascimento&#9;Morada&#10;Maria José Silva&#9;+351 912 345 678&#9;12/04/1985&#9;Rua Doutor Calado 12"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="botao pequeno" id="importar">Importar</button>
          <label class="botao secundario pequeno" style="cursor:pointer">📄 Escolher CSV<input type="file" id="ficheiro" accept=".csv,.txt,text/csv" hidden></label>
          <button class="botao secundario pequeno" id="modelo">⬇ Modelo da planilha</button>
        </div>
        <div id="relatorio"></div>
      </div>

      <details class="cartao" id="caixa-um">
        <summary style="cursor:pointer;font-weight:800">＋ Adicionar uma pessoa</summary>
        <form id="form-um" style="margin-top:14px" novalidate>
          <div class="linha">
            <label class="campo"><span>Nome completo</span><input id="um-nome"></label>
            <label class="campo"><span>Telemóvel</span><input id="um-tel" type="tel" placeholder="+351 912 345 678"></label>
          </div>
          <div class="linha">
            <label class="campo"><span>Data de nascimento</span><input id="um-data" type="date"></label>
            <label class="campo"><span>Bairro (opcional)</span><select id="um-bairro"><option value=""></option>${bairros.map((b) => `<option>${esc(b)}</option>`).join('')}</select></label>
          </div>
          <div id="relatorio-um"></div>
          <button class="botao pequeno" id="um-gravar">Adicionar</button>
        </form>
      </details>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:18px 0 12px">
        <div class="por-bairro" style="margin:0">
          ${[['faltam', 'Faltam responder'], ['responderam', 'Responderam'], ['todos', 'Todos']].map(([v, r]) =>
            `<button data-estado="${v}" class="${filtroPre.estado === v ? 'on' : ''}">${r}</button>`).join('')}
        </div>
        <input id="pre-texto" placeholder="Procurar…" value="${esc(filtroPre.texto)}" style="flex:1;min-width:180px">
      </div>

      <div class="aviso ${selecionados.size ? '' : 'oculto'}" id="barra-sel" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;position:sticky;top:8px;z-index:2">
        <b style="margin-right:auto">${selecionados.size} ${selecionados.size === 1 ? 'pessoa selecionada' : 'pessoas selecionadas'}</b>
        <button class="botao pequeno" id="sel-criar">👪 Criar família</button>
        <button class="botao secundario pequeno" id="sel-juntar" ${familias.length ? '' : 'disabled'}>➕ Juntar a uma família</button>
        <button class="botao secundario pequeno" id="sel-limpar">Limpar seleção</button>
      </div>
      <div id="montar"></div>
      ${!selecionados.size && lista.some((p) => !pessoaDe.has(p.telefone_chave))
        ? '<p class="nota" style="margin:0 0 10px">Para montar uma família, marca as pessoas da mesma casa (☐ à esquerda) e carrega em "Criar família".</p>' : ''}

      ${lista.length ? lista.map((p) => {
        const r = pessoaDe.get(p.telefone_chave);
        const fam = r && familiaPorId.get(r.familia_id);
        return `
        <div class="familia" style="display:flex;gap:12px;align-items:center;padding:12px 16px;flex-wrap:wrap">
          ${r ? '' : `<input type="checkbox" data-sel="${esc(p.telefone_chave)}" ${selecionados.has(p.telefone_chave) ? 'checked' : ''} aria-label="Selecionar ${esc(p.nome)}" style="width:22px;height:22px;accent-color:var(--verde)">`}
          <div class="quem">
            <b>${esc(p.nome)}</b>
            <span>${esc(p.phone_1)}${p.birthdate ? ' · 🎂 ' + dataPt(p.birthdate) : ' · <span style="color:var(--dourado)">sem data</span>'}${p.address_1 ? ' · ' + esc(p.address_1) : ''}${p.neighborhood ? ' · ' + esc(p.neighborhood) : ''}${p.notas ? ' · ' + esc(p.notas) : ''}</span>
            ${p.aviso ? `<span style="color:var(--dourado)">⚠ ${esc(p.aviso)}</span>` : ''}
          </div>
          ${r
            ? `<span class="etiqueta verde">Na ${esc(fam ? nomeFamilia(fam) : 'família')} (${esc(r.parentesco)})</span>`
            : `<a class="botao secundario pequeno" href="${zap(p)}" target="_blank" rel="noopener">💬 Lembrar</a>`}
          <button class="botao secundario pequeno" data-pre-editar="${esc(p.telefone_chave)}">Editar</button>
          <button class="botao perigo pequeno" data-pre-apagar="${esc(p.telefone_chave)}" data-nome="${esc(p.nome)}" aria-label="Tirar do pré-cadastro">✕</button>
          <div id="editar-pre-${esc(p.telefone_chave)}" class="oculto" style="flex-basis:100%"></div>
        </div>`;
      }).join('') : `<p class="vazio">${pre.length ? 'Ninguém nesta lista.' : 'O pré-cadastro está vazio. Importa a planilha acima.'}</p>`}

      ${pre.length ? '<div style="margin-top:18px"><button class="botao perigo pequeno" id="pre-limpar">Apagar o pré-cadastro todo</button></div>' : ''}
    `;

    $('#ficheiro').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) $('#planilha').value = await lerFicheiro(f);
    });
    $('#modelo').addEventListener('click', () => baixar('modelo-pre-cadastro', MODELO_PRE, true));
    $('#importar').addEventListener('click', async () => {
      const linhas = lerPlanilha($('#planilha').value);
      if (!linhas.length) { $('#erro').innerHTML = caixaErro('Cola a planilha (com a linha de títulos) ou escolhe um ficheiro.'); return; }
      await importar(linhas, $('#importar'), '#relatorio');
    });
    $('#form-um').addEventListener('submit', async (e) => {
      e.preventDefault();
      await importar([{ linha: 1, nome: $('#um-nome').value, telefone: $('#um-tel').value, birthdate: $('#um-data').value, neighborhood: $('#um-bairro').value }],
        $('#um-gravar'), '#relatorio-um');
    });
    document.querySelectorAll('[data-sel]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) selecionados.add(c.dataset.sel); else selecionados.delete(c.dataset.sel);
      const barra = $('#barra-sel');
      barra.classList.toggle('oculto', !selecionados.size);
      barra.querySelector('b').textContent = `${selecionados.size} ${selecionados.size === 1 ? 'pessoa selecionada' : 'pessoas selecionadas'}`;
    }));
    $('#sel-criar').addEventListener('click', () => abrirMontar('nova'));
    $('#sel-juntar').addEventListener('click', () => abrirMontar('existente'));
    $('#sel-limpar').addEventListener('click', () => { selecionados.clear(); desenharPre(); });
    document.querySelectorAll('[data-pre-editar]').forEach((b) => b.addEventListener('click', () => abrirEditarPre(b.dataset.preEditar)));
    document.querySelectorAll('[data-estado]').forEach((b) => b.addEventListener('click', () => { filtroPre.estado = b.dataset.estado; desenharPre(); }));
    $('#pre-texto').addEventListener('input', (e) => {
      filtroPre.texto = e.target.value;
      const pos = e.target.selectionStart;
      desenharPre();
      const i = $('#pre-texto'); i.focus(); i.setSelectionRange(pos, pos);
    });
    document.querySelectorAll('[data-pre-apagar]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Tirar ${b.dataset.nome} do pré-cadastro?`)) return;
      try {
        await api('admin-pre-apagar', { senha, chave: b.dataset.preApagar });
        pre = pre.filter((p) => p.telefone_chave !== b.dataset.preApagar);
        desenharPre();
      } catch (e) { erro(e); }
    }));
    const limpar = $('#pre-limpar');
    if (limpar) limpar.addEventListener('click', async () => {
      if (!confirm(`Apagar as ${pre.length} pessoas do pré-cadastro? As respostas ao censo não são afetadas.`)) return;
      try { await api('admin-pre-apagar', { senha, todos: true }); pre = []; desenharPre(); } catch (e) { erro(e); }
    });
  }

  /** Junta as pessoas selecionadas numa família nova ou numa existente. */
  function abrirMontar(modoMontar) {
    const escolhidas = pre.filter((p) => selecionados.has(p.telefone_chave))
      .sort((a, b) => String(a.birthdate || '9999').localeCompare(String(b.birthdate || '9999')));
    const nova = modoMontar === 'nova';
    // Palpite inicial: o mais velho é titular, o 2.º adulto é cônjuge, o resto filhos.
    const palpite = (p, i) => {
      if (!nova) return 'Filho(a)';
      if (i === 0) return 'Titular';
      const ida = idade(p.birthdate);
      return i === 1 && (ida === null || ida >= 18) ? 'Cônjuge' : 'Filho(a)';
    };
    const opcoesFamilias = familias
      .map((f) => ({ id: f.id, nome: nomeFamilia(f) + ' — ' + (membrosDe.get(f.id) || []).map((x) => x.first_name).join(', ') }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    const papeis = (sel) => ['Titular', 'Cônjuge', 'Filho(a)', 'Outro']
      .filter((x) => nova || x !== 'Titular')
      .map((x) => `<option ${x === sel ? 'selected' : ''}>${x}</option>`).join('');
    const linhaPessoa = (p, i) => `
      <div class="linha-montar" data-chave="${p ? esc(p.telefone_chave) : ''}">
        <input data-m="nome" value="${esc(p ? p.nome : '')}" placeholder="Nome completo" aria-label="Nome">
        <span class="m-tel">${p ? esc(p.phone_1) : 'sem telemóvel'}</span>
        <input data-m="birthdate" type="date" value="${esc(p ? p.birthdate : '')}" aria-label="Data de nascimento">
        <select data-m="parentesco" aria-label="Parentesco">${papeis(p ? palpite(p, i) : 'Filho(a)')}</select>
        ${p ? '' : '<button type="button" class="botao perigo pequeno" data-m-tirar>✕</button>'}
      </div>`;

    const caixa = $('#montar');
    caixa.innerHTML = `
      <div class="cartao" style="border-color:rgba(47,182,90,.5)">
        <h2>${nova ? '👪 Criar família' : '➕ Juntar a uma família'}</h2>
        <div id="erro-montar"></div>
        ${nova ? '' : `<label class="campo"><span>Família</span><select id="m-destino">${opcoesFamilias.map((f) => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join('')}</select></label>`}
        <p class="nota" style="margin:0 0 8px">Quem tem telemóvel precisa de data de nascimento — é com ela que vai entrar no censo. Filhos sem telemóvel podem ficar sem data: o titular completa quando entrar.</p>
        <div id="m-pessoas">${escolhidas.map(linhaPessoa).join('')}</div>
        <button type="button" class="botao secundario pequeno" id="m-mais" style="margin-top:8px">+ Filho(a) sem telemóvel</button>
        ${nova ? `<div class="linha" style="margin-top:14px">
          <label class="campo"><span>Morada da família</span><select id="m-morada">
            ${escolhidas.map((p, i) => `<option value="${esc(p.telefone_chave)}" ${i === 0 ? 'selected' : ''}>A de ${esc(p.nome)}${p.address_1 ? ' — ' + esc(p.address_1) : ' (sem morada)'}</option>`).join('')}
          </select></label>
          <label class="campo" id="m-bairro"><span>Bairro</span>${escolhaComOutro('neighborhood', bairros, escolhidas[0] && escolhidas[0].neighborhood)}</label>
        </div>` : ''}
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="botao pequeno" id="m-gravar">${nova ? 'Criar família' : 'Juntar'}</button>
          <button class="botao secundario pequeno" id="m-cancelar">Cancelar</button>
        </div>
      </div>`;
    caixa.scrollIntoView({ behavior: 'smooth', block: 'start' });

    $('#m-mais').addEventListener('click', () => {
      $('#m-pessoas').insertAdjacentHTML('beforeend', linhaPessoa(null));
      const l = $('#m-pessoas').lastElementChild;
      l.querySelector('[data-m-tirar]').addEventListener('click', () => l.remove());
      l.querySelector('[data-m="nome"]').focus();
    });
    $('#m-cancelar').addEventListener('click', () => { caixa.innerHTML = ''; });
    // Trocar de quem vem a morada traz também o bairro dessa linha.
    if (nova) $('#m-morada').addEventListener('change', (e) => {
      const p = pre.find((x) => x.telefone_chave === e.target.value);
      $('#m-bairro').innerHTML = `<span>Bairro</span>${escolhaComOutro('neighborhood', bairros, p && p.neighborhood)}`;
    });
    $('#m-gravar').addEventListener('click', async (ev) => {
      const pessoasEnvio = [...caixa.querySelectorAll('.linha-montar')].map((l) => {
        const v = (k) => l.querySelector(`[data-m="${k}"]`).value;
        return { chave: l.dataset.chave || undefined, nome: v('nome'), birthdate: v('birthdate'), parentesco: v('parentesco') };
      });
      ocupado(ev.target, true, 'A gravar…');
      try {
        await api('admin-criar-familia', {
          senha,
          destino: nova ? 'nova' : $('#m-destino').value,
          morada_de: nova ? $('#m-morada').value : undefined,
          bairro: nova ? lerFormulario($('#m-bairro')).neighborhood : undefined,
          pessoas: pessoasEnvio,
        });
        selecionados.clear();
        carregar(await api('admin-listar', { senha }));
        desenharPre();
        $('#montar').innerHTML = `<div class="aviso">✓ ${nova ? 'Família criada' : 'Pessoas juntadas à família'}. Está na aba <b>Famílias</b>; quando cada um ler o QR, entra com o número e a data de nascimento.</div>`;
      } catch (e) {
        $('#erro-montar').innerHTML = caixaErro(e.message);
        ocupado(ev.target, false);
      }
    });
  }

  function abrirEditarPre(chave) {
    const caixa = $('#editar-pre-' + chave);
    if (!caixa.classList.contains('oculto')) { caixa.classList.add('oculto'); return; }
    const p = pre.find((x) => x.telefone_chave === chave);
    caixa.classList.remove('oculto');
    caixa.innerHTML = `
      <div class="pessoa" style="margin-top:4px">
        <div id="erro-pre-${esc(chave)}"></div>
        ${formPessoaHtml({ nome: p.nome, telefone: p.phone_1, birthdate: p.birthdate, email: p.email, gender: p.gender, nationality: p.nationality, church_role: p.church_role }, { tipos: ['Membro', 'Congregado', 'Visitante'] })}
        ${formMoradaHtml(p)}
        <label class="campo"><span>Observações (só a equipa vê)</span><input data-f="notas" value="${esc(p.notas)}"></label>
        <button class="botao pequeno" data-guardar>Guardar</button>
      </div>`;
    caixa.querySelector('[data-guardar]').addEventListener('click', async (ev) => {
      ocupado(ev.target, true, 'A guardar…');
      try {
        await api('admin-pre-editar', { senha, chave, dados: lerFormulario(caixa) });
        carregar(await api('admin-listar', { senha }));
        desenharPre();
      } catch (e) {
        $('#erro-pre-' + chave).innerHTML = caixaErro(e.message);
        ocupado(ev.target, false);
      }
    });
  }

  async function importar(linhas, botao, ondeRelatorio) {
    ocupado(botao, true, 'A gravar…');
    try {
      const r = await api('admin-pre-importar', { senha, linhas });
      carregar(await api('admin-listar', { senha }));
      desenharPre();
      const deUmEmUm = ondeRelatorio === '#relatorio-um';
      if (deUmEmUm) $('#caixa-um').open = true;
      const recusados = r.recusados || [];
      $(ondeRelatorio).innerHTML = `
        <div class="aviso" style="margin:12px 0">
          ${r.gravados ? `✓ ${r.gravados} ${r.gravados === 1 ? 'pessoa gravada' : 'pessoas gravadas'} (${r.com_data} com data de nascimento)` : 'Nada gravado'}${recusados.length ? `, ${recusados.length} ${recusados.length === 1 ? 'recusada' : 'recusadas'}:` : '.'}
          ${recusados.length ? `<ul style="margin:6px 0 0;padding-left:18px">${recusados.map((x) => `<li>${deUmEmUm ? '' : 'Linha ' + x.linha + ': '}${esc(x.motivo)}</li>`).join('')}</ul>` : ''}
        </div>`;
    } catch (e) {
      erro(e);
      ocupado(botao, false);
    }
  }

  /* ── Bairros ──────────────────────────────────────────────── */

  /** Liga todos os botões [data-copia] da tela: descarrega a cópia em JSON. */
  function ligarCopia() {
    document.querySelectorAll('[data-copia]').forEach((b) => b.addEventListener('click', async () => {
      ocupado(b, true, 'A preparar…');
      try {
        const copia = await api('admin-copia', { senha });
        const blob = new Blob([JSON.stringify(copia, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `censo-admvc-copia-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch (e) { erro(e); }
      ocupado(b, false);
    }));
  }

  /* ── Regiões e bairros ────────────────────────────────────── */

  function desenharBairros() {
    const nasRegioes = new Set(regioes.flatMap((r) => r.bairros.map((b) => b.toLowerCase())));
    const soltos = bairros.filter((b) => !nasRegioes.has(b.toLowerCase()));
    // Bairros que as famílias escreveram em "Outro" e não estão em lado nenhum.
    const conhecidos = new Set(bairros.map((b) => b.toLowerCase()));
    const escritos = {};
    familias.forEach((f) => { if (f.neighborhood && !conhecidos.has(f.neighborhood.toLowerCase())) escritos[f.neighborhood] = (escritos[f.neighborhood] || 0) + 1; });
    const cores = ['#2fb65a', '#3b82f6', '#d9a441', '#a855f7', '#ef4444', '#14b8a6', '#f97316', '#ec4899'];

    const cartaoRegiao = (r) => `
      <div class="pessoa regiao-editar">
        <div class="linha" style="align-items:flex-end">
          <label class="campo"><span>Nome da região</span><input data-r="nome" value="${esc(r.nome)}"></label>
          <label class="campo" style="flex:0 0 90px"><span>Cor</span><input data-r="cor" type="color" value="${esc(r.cor)}" style="height:50px;padding:4px"></label>
          <button type="button" class="botao perigo pequeno" data-r-tirar style="flex:0 0 auto;margin-bottom:14px">Apagar</button>
        </div>
        <label class="campo"><span>Bairros desta região (um por linha)</span><textarea data-r="bairros" rows="${Math.max(3, r.bairros.length + 1)}">${esc(r.bairros.join('\n'))}</textarea></label>
      </div>`;

    $('#conteudo').innerHTML = `
      <div class="cartao">
        <h2>Regiões e bairros</h2>
        <p class="ajuda">Cada região junta vários bairros e tem uma cor no mapa. Os bairros aparecem no formulário pela
          ordem desta página. Quem não encontrar o seu escolhe "Outro" e escreve — esses aparecem em baixo para os pores numa região.
          As regiões iniciais são um palpite: ajusta à vontade.</p>
        <div id="erro"></div>
        <div id="lista-regioes">${regioes.map(cartaoRegiao).join('')}</div>
        <button type="button" class="botao secundario pequeno" id="nova-regiao" style="margin-top:12px">+ Nova região</button>
        <label class="campo" style="margin-top:18px"><span>Bairros sem região (aparecem no formulário, mas não contam para nenhuma região)</span>
          <textarea id="soltos" rows="${Math.max(3, soltos.length + 1)}">${esc(soltos.join('\n'))}</textarea></label>
        ${Object.keys(escritos).length ? `<div class="aviso">Escritos pelas famílias em "Outro" (copia para uma região se fizer sentido):<br>
          ${Object.entries(escritos).sort((a, b) => b[1] - a[1]).map(([b, n]) => `<span class="etiqueta" style="margin:4px 4px 0 0;display:inline-block">${esc(b)} · ${n}</span>`).join('')}</div>` : ''}
        <div class="acoes"><button class="botao" id="gravar">Guardar regiões e bairros</button></div>
      </div>

      <div class="cartao">
        <h2>Nacionalidades</h2>
        <p class="ajuda">Uma por linha, pela ordem em que aparecem no formulário. "Outra" é acrescentada sozinha no fim,
          para quem não encontrar a sua.</p>
        <div id="erro-nac"></div>
        <textarea id="nacionalidades" rows="${Math.max(6, nacionalidades.length + 1)}">${esc(nacionalidades.join('\n'))}</textarea>
        ${(() => {
          // Nacionalidades escritas em "Outra" que ainda não estão na lista.
          const conhecidas = new Set(nacionalidades.map((n) => n.toLowerCase()));
          const outras = {};
          pessoas.forEach((p) => { if (p.nationality && !conhecidas.has(p.nationality.toLowerCase())) outras[p.nationality] = (outras[p.nationality] || 0) + 1; });
          return Object.keys(outras).length ? `<div class="aviso" style="margin-top:10px">Escritas em "Outra":<br>
            ${Object.entries(outras).sort((a, b) => b[1] - a[1]).map(([n, q]) => `<span class="etiqueta" style="margin:4px 4px 0 0;display:inline-block">${esc(n)} · ${q}</span>`).join('')}</div>` : '';
        })()}
        <div class="acoes"><button class="botao" id="gravar-nac">Guardar nacionalidades</button></div>
      </div>

      <div class="cartao">
        <h2>💾 Cópia de segurança</h2>
        <p class="ajuda">Descarrega tudo (famílias, pessoas, pré-cadastro e listas) num ficheiro. Guarda-o no computador
          ou no Drive — de preferência uma vez por semana durante o censo. <b>Restaurar substitui tudo</b> o que está no
          censo pelo conteúdo do ficheiro.</p>
        <div id="erro-copia"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="botao pequeno" data-copia>⬇ Descarregar cópia</button>
          <label class="botao perigo pequeno" style="cursor:pointer">⬆ Restaurar de um ficheiro<input type="file" id="restaurar" accept=".json,application/json" hidden></label>
        </div>
      </div>`;

    const ligarTirar = (el) => el.querySelector('[data-r-tirar]').addEventListener('click', () => {
      const n = el.querySelector('[data-r="bairros"]').value.trim();
      if (n && !confirm('Apagar esta região? Os bairros dela passam para "sem região".')) return;
      $('#soltos').value = [$('#soltos').value.trim(), n].filter(Boolean).join('\n');
      el.remove();
    });
    document.querySelectorAll('.regiao-editar').forEach(ligarTirar);
    $('#nova-regiao').addEventListener('click', () => {
      const n = document.querySelectorAll('.regiao-editar').length;
      $('#lista-regioes').insertAdjacentHTML('beforeend', cartaoRegiao({ nome: '', cor: cores[n % cores.length], bairros: [] }));
      const el = $('#lista-regioes').lastElementChild;
      ligarTirar(el);
      el.querySelector('[data-r="nome"]').focus();
    });
    ligarCopia();
    $('#restaurar').addEventListener('change', async (ev) => {
      const ficheiro = ev.target.files[0];
      ev.target.value = '';
      if (!ficheiro) return;
      const caixa = $('#erro-copia');
      let copia;
      try { copia = JSON.parse(await ficheiro.text()); } catch (e) { caixa.innerHTML = caixaErro('Este ficheiro não é uma cópia de segurança do censo.'); return; }
      const d = (copia && copia.dados) || {};
      const n = (k) => Object.keys(d[k] || {}).length;
      const quando = copia && copia.feita_em ? new Date(copia.feita_em).toLocaleString('pt-PT') : '?';
      const palavra = prompt(`Restaurar a cópia de ${quando}?\n\n${n('familias')} famílias, ${n('pessoas')} pessoas, ${n('pre')} no pré-cadastro.\n\nTUDO o que está agora no censo será substituído. Escreve RESTAURAR para confirmar.`);
      if (palavra === null) return;
      try {
        const r = await api('admin-restaurar', { senha, copia, confirmar: String(palavra).trim().toUpperCase() });
        carregar(await api('admin-listar', { senha }));
        desenharBairros();
        $('#erro-copia').innerHTML = `<div class="aviso">✓ Restaurado: ${r.familias} famílias, ${r.pessoas} pessoas, ${r.pre} no pré-cadastro.</div>`;
      } catch (e) { $('#erro-copia').innerHTML = caixaErro(e.message); }
    });
    $('#gravar-nac').addEventListener('click', async () => {
      const botao = $('#gravar-nac');
      ocupado(botao, true, 'A guardar…');
      try {
        const r = await api('admin-nacionalidades', { senha, nacionalidades: $('#nacionalidades').value.split('\n') });
        nacionalidades = r.nacionalidades;
        $('#nacionalidades').value = nacionalidades.join('\n');
        $('#erro-nac').innerHTML = '<div class="aviso">Guardado. Já aparece no formulário.</div>';
      } catch (e) { $('#erro-nac').innerHTML = caixaErro(e.message); }
      ocupado(botao, false);
    });
    $('#gravar').addEventListener('click', async () => {
      const botao = $('#gravar');
      const lista = [...document.querySelectorAll('.regiao-editar')].map((el) => ({
        nome: el.querySelector('[data-r="nome"]').value,
        cor: el.querySelector('[data-r="cor"]').value,
        bairros: el.querySelector('[data-r="bairros"]').value.split('\n'),
      }));
      ocupado(botao, true, 'A guardar…');
      try {
        await api('admin-regioes', { senha, regioes: lista, soltos: $('#soltos').value.split('\n') });
        carregar(await api('admin-listar', { senha }));
        desenharBairros();
        $('#erro').innerHTML = '<div class="aviso">Guardado. O formulário e o mapa já usam esta lista.</div>';
      } catch (e) { erro(e); ocupado(botao, false); }
    });
  }

  /* ── Mapa ─────────────────────────────────────────────────── */

  const SEM_REGIAO = { nome: 'Sem região', cor: '#8a8d86', bairros: [] };
  const regiaoDe = (f) => regiaoDoBairro.get(String(f.neighborhood || '').toLowerCase()) || SEM_REGIAO;
  const filtroMapa = { regiao: '', soCulto: false, pintar: true };
  let mapa = null;

  function carregarLeaflet() {
    if (window.L) return Promise.resolve();
    const base = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = base + 'leaflet.min.css';
    document.head.appendChild(css);
    return new Promise((ok, falha) => {
      const js = document.createElement('script');
      js.src = base + 'leaflet.min.js';
      js.onload = ok;
      js.onerror = () => falha(new Error('Não foi possível carregar o mapa (sem internet?).'));
      document.head.appendChild(js);
    });
  }

  async function desenharMapa() {
    const comPos = familias.filter((f) => f.lat != null && f.lon != null);
    const semPos = familias.filter((f) => f.lat == null || f.lon == null);
    const pendentes = semPos.filter((f) => !f.geo_falhou);
    const falhadas = semPos.filter((f) => f.geo_falhou);
    const contas = new Map();
    [...regioes, SEM_REGIAO].forEach((r) => contas.set(r.nome, { r, familias: 0, pessoas: 0, criancas: 0, culto: 0, bairros: {} }));
    familias.forEach((f) => {
      const c = contas.get(regiaoDe(f).nome);
      const m = membrosDe.get(f.id) || [];
      const criancas = m.filter((p) => { const i = idade(p.birthdate); return i !== null && i < 18; }).length;
      c.familias++; c.pessoas += m.length; c.criancas += criancas; if (f.culto_no_lar === 'Sim') c.culto++;
      const nomeB = f.neighborhood || '—';
      const b = c.bairros[nomeB] || (c.bairros[nomeB] = { familias: 0, pessoas: 0, culto: 0 });
      b.familias++; b.pessoas += m.length; if (f.culto_no_lar === 'Sim') b.culto++;
    });
    const linhas = [...contas.values()].filter((c) => c.familias || c.r !== SEM_REGIAO);
    const soma = (k) => linhas.reduce((s, c) => s + c[k], 0);

    $('#conteudo').innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <span style="color:var(--suave);margin-right:auto">${comPos.length} de ${familias.length} famílias no mapa${semPos.length ? ` · ${semPos.length} sem localização` : ''}</span>
        <label class="consentir" style="align-items:center"><input type="checkbox" id="pintar" ${filtroMapa.pintar ? 'checked' : ''}> Pintar regiões</label>
        <label class="consentir" style="align-items:center"><input type="checkbox" id="so-culto" ${filtroMapa.soCulto ? 'checked' : ''}> Só casas que aceitam culto no lar 🏠</label>
        ${pendentes.length ? `<button class="botao pequeno" id="localizar">📍 Localizar ${pendentes.length} ${pendentes.length === 1 ? 'família' : 'famílias'}</button>` : ''}
      </div>
      <div id="erro"></div>
      <div id="progresso"></div>
      <div class="mapa-grade">
        <div>
          <div id="mapa" class="mapa"></div>
          <p class="nota">Cada pin é uma família, na cor da região, com o número de pessoas dentro. 🏠 e contorno dourado = aceita culto no lar.
            A posição é a do código postal ou da rua, não a porta exata.</p>
        </div>
        <div class="cartao" style="padding:12px">
          <table class="tabela-regioes">
            <thead><tr><th>Região</th><th title="Famílias">Fam.</th><th title="Pessoas">Pess.</th><th title="Menores de 18">Crian.</th><th title="Aceitam culto no lar">🏠</th></tr></thead>
            <tbody>
              <tr class="${filtroMapa.regiao ? '' : 'on'}" data-regiao=""><td><b>Todas</b></td><td>${soma('familias')}</td><td>${soma('pessoas')}</td><td>${soma('criancas')}</td><td>${soma('culto')}</td></tr>
              ${linhas.map((c) => `
                <tr class="${filtroMapa.regiao === c.r.nome ? 'on' : ''}" data-regiao="${esc(c.r.nome)}">
                  <td><span class="ponto" style="background:${esc(c.r.cor)}"></span>${esc(c.r.nome)}</td>
                  <td>${c.familias}</td><td>${c.pessoas}</td><td>${c.criancas}</td><td>${c.culto}</td>
                </tr>
                ${filtroMapa.regiao === c.r.nome ? Object.entries(c.bairros).sort((a, b) => b[1].pessoas - a[1].pessoas).map(([b, v]) => `
                  <tr class="sub"><td>${esc(b)}</td><td>${v.familias}</td><td>${v.pessoas}</td><td></td><td>${v.culto}</td></tr>`).join('') : ''}`).join('')}
            </tbody>
          </table>
          <p class="nota" style="margin-top:10px">Toca numa região para a ver no mapa e abrir os bairros dela.</p>
        </div>
      </div>
      ${falhadas.length ? `
        <details class="cartao" style="margin-top:14px">
          <summary style="cursor:pointer;font-weight:800">⚠ ${falhadas.length} ${falhadas.length === 1 ? 'família que não foi possível localizar' : 'famílias que não foi possível localizar'}</summary>
          <p class="nota">Corrige a morada ou o código postal na aba Famílias (Editar morada) e volta a localizar.</p>
          <ul>${falhadas.map((f) => `<li>${esc(nomeFamilia(f))} — ${esc(enderecoCompleto(f) || 'sem morada')}</li>`).join('')}</ul>
          <button class="botao secundario pequeno" id="relocalizar">Tentar outra vez</button>
        </details>` : ''}
    `;

    $('#pintar').addEventListener('change', (e) => { filtroMapa.pintar = e.target.checked; desenharMapa().catch(erro); });
    $('#so-culto').addEventListener('change', (e) => { filtroMapa.soCulto = e.target.checked; desenharMapa().catch(erro); });
    document.querySelectorAll('[data-regiao]').forEach((tr) => tr.addEventListener('click', () => {
      filtroMapa.regiao = filtroMapa.regiao === tr.dataset.regiao ? '' : tr.dataset.regiao;
      desenharMapa().catch(erro);
    }));
    const botaoLoc = $('#localizar');
    if (botaoLoc) botaoLoc.addEventListener('click', () => localizarTodas(false));
    const botaoRe = $('#relocalizar');
    if (botaoRe) botaoRe.addEventListener('click', () => localizarTodas(true));

    await carregarLeaflet();
    const L = window.L;
    if (mapa) { mapa.remove(); mapa = null; }
    mapa = L.map('mapa', { scrollWheelZoom: true }).setView([40.15, -8.86], 12);
    // O OpenStreetMap exige saber de que site vem cada pedido (regra de uso dos
    // mapas deles) e bloqueia quem não o diz: por isso o referrerPolicy aqui e
    // o Referrer-Policy do vercel.json não podem cortar a origem.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);

    // Regiões pintadas: uma mancha que cobre as famílias de cada região (o
    // contorno convexo dos pontos, com uma margem de ~250 m à volta de cada um,
    // para uma família sozinha também ter a sua mancha).
    if (filtroMapa.pintar) {
      const porRegiao = new Map();
      comPos.forEach((f) => {
        const r = regiaoDe(f);
        if (filtroMapa.regiao && r.nome !== filtroMapa.regiao) return;
        if (!porRegiao.has(r.nome)) porRegiao.set(r.nome, { r, pontos: [], familias: 0, pessoas: 0 });
        const g = porRegiao.get(r.nome);
        g.familias++;
        g.pessoas += (membrosDe.get(f.id) || []).length;
        const d = 0.004;
        for (let a = 0; a < 8; a++) g.pontos.push([f.lon + d * Math.cos(a * Math.PI / 4), f.lat + d * 0.77 * Math.sin(a * Math.PI / 4)]);
      });
      porRegiao.forEach((g) => {
        const casca = contornoConvexo(g.pontos).map(([lon, lat]) => [lat, lon]);
        L.polygon(casca, { color: g.r.cor, weight: 3, opacity: 0.9, fillColor: g.r.cor, fillOpacity: 0.28, interactive: false }).addTo(mapa);
        // O rótulo vai por cima da mancha (no ponto mais a norte), para não
        // tapar os pins, que ficam no meio dela.
        const topo = casca.reduce((a, p) => (p[0] > a[0] ? p : a), casca[0]);
        L.marker(topo, {
          interactive: false, keyboard: false,
          icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="rotulo-regiao">${esc(g.r.nome)}<br><small>${g.familias} fam. · ${g.pessoas} pess.</small></div>` }),
        }).addTo(mapa);
      });
    }

    // Famílias no mesmo código postal caem no mesmo ponto: afasta-as um pouco
    // em espiral para todas ficarem visíveis.
    const noPonto = {};
    const visiveis = comPos.filter((f) => (!filtroMapa.regiao || regiaoDe(f).nome === filtroMapa.regiao) && (!filtroMapa.soCulto || f.culto_no_lar === 'Sim'));
    const marcas = visiveis.map((f) => {
      const k = f.lat.toFixed(5) + ',' + f.lon.toFixed(5);
      const n = noPonto[k] = (noPonto[k] || 0) + 1;
      const raio = n > 1 ? 0.00018 * Math.sqrt(n) : 0;
      const pos = [f.lat + raio * Math.sin(n * 2.4), f.lon + raio * Math.cos(n * 2.4)];
      const m = membrosDe.get(f.id) || [];
      const r = regiaoDe(f);
      const t = m[0];
      const culto = f.culto_no_lar === 'Sim';
      // Pin na cor da região, com o número de pessoas dentro; quem aceita
      // culto no lar leva contorno dourado e uma casinha.
      const icone = L.divIcon({
        className: '',
        html: `<div class="pin ${culto ? 'pin-culto' : ''}" style="--cor:${esc(r.cor)}"><span>${m.length}</span></div>${culto ? '<div class="pin-casa">🏠</div>' : ''}`,
        iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -36],
      });
      return L.marker(pos, { icon: icone, title: nomeFamilia(f) }).bindPopup(`
        <b>${esc(nomeFamilia(f))}</b> · ${esc(f.neighborhood || '')} <span style="color:${esc(r.cor)}">● ${esc(r.nome)}</span><br>
        ${m.map((p) => `${esc(p.nome_completo)} <small>(${esc(p.parentesco)}${idade(p.birthdate) !== null ? ', ' + idade(p.birthdate) : ''})</small>`).join('<br>')}<br>
        <small>${esc(enderecoCompleto(f))}</small>
        ${f.geo_fonte === 'bairro' ? '<br><small style="color:#b7791f">⚠ posição aproximada (centro do bairro) — corrige a morada para ficar exata</small>' : ''}<br>
        Culto no lar: <b>${esc(f.culto_no_lar || '—')}</b>
        ${t && t.telefone_chave ? `<br><a href="https://wa.me/${esc(t.telefone_chave)}" target="_blank" rel="noopener">WhatsApp ${esc(t.first_name)}</a>` : ''}`).addTo(mapa);
    });
    // Margem maior em cima: os rótulos das regiões ficam acima dos pins.
    if (marcas.length) mapa.fitBounds(L.featureGroup(marcas).getBounds(), { maxZoom: 15, paddingTopLeft: [40, 90], paddingBottomRight: [40, 30] });
  }

  async function localizarTodas(tentarDeNovo) {
    let feitas = 0;
    let falharam = 0;
    document.querySelectorAll('#localizar, #relocalizar').forEach((b) => { b.disabled = true; });
    try {
      for (let volta = 0; volta < 500; volta++) {
        const r = await api('admin-localizar', { senha, tentar_de_novo: tentarDeNovo && volta === 0 });
        feitas += r.localizadas;
        falharam += r.falharam;
        $('#progresso').innerHTML = `<div class="aviso">📍 A localizar… ${feitas} no mapa${falharam ? `, ${falharam} sem sucesso` : ''}${r.restantes ? ` · faltam ${r.restantes}` : ''}</div>`;
        if (!r.restantes || (!r.localizadas && !r.falharam)) break;
      }
      carregar(await api('admin-listar', { senha }));
      await desenharMapa();
      $('#progresso').innerHTML = `<div class="aviso">✓ ${feitas} ${feitas === 1 ? 'família localizada' : 'famílias localizadas'}${falharam ? `; ${falharam} não foi possível (ver lista em baixo)` : ''}.</div>`;
    } catch (e) { erro(e); }
  }

  /* ── CSV (uma linha por pessoa) ───────────────────────────── */

  function linhasPorPessoa(lista) {
    return lista.flatMap((f) => {
      const m = membrosDe.get(f.id) || [];
      return m.map((p) => ({ p, f, m }));
    });
  }

  /** Mesmo cabeçalho, pela mesma ordem, de exportarMembrosCSV no admvc-site — é
   *  o que o importador dele (analisarCSV) lê. A família e o parentesco não têm
   *  coluna no importador, por isso vão para `notes`.
   *  Atenção: o importador recusa linhas sem e-mail. */
  function csvAdmvc(lista) {
    const linhas = linhasPorPessoa(lista).map(({ p, f, m }) => {
      const par = p.parentesco === 'Titular' ? m.find((x) => x.parentesco === 'Cônjuge')
        : p.parentesco === 'Cônjuge' ? m.find((x) => x.parentesco === 'Titular') : null;
      const notas = [
        'Censo ADMVC ' + String(p.criado_em || f.criado_em || '').slice(0, 10),
        nomeFamilia(f) + ' (' + f.id + ') · ' + p.parentesco,
        f.freguesia ? 'Freguesia: ' + f.freguesia : '',
        'Culto no lar: ' + f.culto_no_lar,
      ].filter(Boolean).join(' | ');
      const v = {
        first_name: p.first_name, last_name: p.last_name, email: p.email, phone_1: p.phone_1,
        gender: p.gender, birthdate: p.birthdate, marital_status: p.marital_status, nationality: p.nationality,
        address_1: f.address_1, address_number: f.address_number, address_2: f.address_2, postal_code: f.postal_code,
        neighborhood: f.neighborhood, id_city: f.id_city, state: f.state, country: 'Portugal',
        entry_date: String(p.criado_em || f.criado_em || '').slice(0, 10), church_role: p.church_role === 'Não frequenta' ? '' : p.church_role,
        status: 'PENDENTE', role: 'USER', spouse_name: par ? par.nome_completo : '', notes: notas,
      };
      return CABECALHO_ADMVC.map((c) => limpo(v[c])).join(';');
    });
    return [CABECALHO_ADMVC.join(';')].concat(linhas).join('\r\n');
  }

  function csvCompleto(lista) {
    const colunas = [
      ['Família', ({ f }) => nomeFamilia(f)], ['ID família', ({ f }) => f.id], ['Parentesco', ({ p }) => p.parentesco],
      ['Nome completo', ({ p }) => p.nome_completo], ['Telemóvel', ({ p }) => p.phone_1],
      ['Nascimento', ({ p }) => p.birthdate], ['Idade', ({ p }) => idade(p.birthdate)], ['Sexo', ({ p }) => p.gender],
      ['Nacionalidade', ({ p }) => p.nationality], ['E-mail', ({ p }) => p.email], ['Tipo', ({ p }) => p.church_role],
      ['Estado civil', ({ p }) => p.marital_status],
      ['Endereço', ({ f }) => enderecoCompleto(f)], ['Código postal', ({ f }) => f.postal_code],
      ['Bairro', ({ f }) => f.neighborhood], ['Freguesia', ({ f }) => f.freguesia],
      ['Latitude', ({ f }) => f.lat], ['Longitude', ({ f }) => f.lon], ['Culto no lar', ({ f }) => f.culto_no_lar],
      ['Registado em', ({ p, f }) => String(p.criado_em || f.criado_em || '').slice(0, 10)],
      ['Atualizado em', ({ p }) => String(p.atualizado_em || '').slice(0, 10)],
      ['Aviso', ({ p }) => (p.data_diferente_pre ? 'data diferente do pré-cadastro' : '')],
    ];
    const linhas = linhasPorPessoa(lista).map((x) => colunas.map(([, fn]) => limpo(fn(x))).join(';'));
    return [colunas.map(([t]) => t).join(';')].concat(linhas).join('\r\n');
  }

  desenhar();
}

/** Contorno convexo (cadeia monótona de Andrew) de pontos [x, y]. */
function contornoConvexo(pontos) {
  const p = pontos.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cruz = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo = [];
  for (const q of p) { while (baixo.length >= 2 && cruz(baixo[baixo.length - 2], baixo[baixo.length - 1], q) <= 0) baixo.pop(); baixo.push(q); }
  const cima = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (cima.length >= 2 && cruz(cima[cima.length - 2], cima[cima.length - 1], q) <= 0) cima.pop(); cima.push(q); }
  return baixo.slice(0, -1).concat(cima.slice(0, -1));
}

const limpo = (v) => String(v == null ? '' : v).replace(/[;\r\n]+/g, ', ').trim();

const CABECALHO_ADMVC = [
  'first_name', 'last_name', 'email', 'phone_1', 'gender', 'birthdate', 'marital_status', 'nationality',
  'profession', 'tax_id', 'id_card_number', 'address_1', 'address_number', 'address_2', 'postal_code',
  'neighborhood', 'id_city', 'state', 'country', 'baptism_status', 'baptism_date', 'conversion_date', 'entry_date',
  'church_role', 'ministry', 'previous_church', 'status', 'role', 'spouse_name', 'wedding_date',
  'father_name', 'mother_name', 'notes', 'avatar_file',
];

/** O completo leva BOM para o Excel abrir os acentos certos. O do admvc-site
 *  NÃO: o importador lê o primeiro cabeçalho como "﻿first_name" e perde a coluna. */
function baixar(nome, conteudo, comBom) {
  const blob = new Blob([(comBom ? '﻿' : '') + conteudo], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ── Ler a planilha do pré-cadastro ───────────────────────── */

export const MODELO_PRE = [
  'Nome completo;Telemóvel;Data de nascimento;Morada;Número;Código postal;Localidade;Bairro;E-mail;Sexo;Nacionalidade;Tipo;Observações',
  'Maria José Silva;+351 912 345 678;12/04/1985;Rua Doutor Calado;12;3080-153;Figueira da Foz;Buarcos;maria@exemplo.pt;F;Brasileira;Membro;',
  'João Pereira Santos;+55 11 91234 5678;03/02/1990;Av. Saraiva de Carvalho;10 2º Esq.;3080-055;Figueira da Foz;Centro da Figueira;;M;Brasileira;Visitante;Veio pela primeira vez em setembro',
].join('\r\n');

const semAcentos = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Títulos que o painel reconhece (sem acentos, espaços nem pontuação). */
const COLUNAS = {
  nome: ['nomecompleto', 'nome', 'name', 'fullname'],
  first_name: ['firstname', 'primeironome'],
  last_name: ['lastname', 'apelido', 'apelidos', 'sobrenome'],
  telefone: ['telemovel', 'telefone', 'celular', 'phone1', 'phone', 'whatsapp', 'contacto', 'contato', 'tlm'],
  birthdate: ['datadenascimento', 'datanascimento', 'nascimento', 'aniversario', 'datadeaniversario', 'birthdate', 'datanasc', 'dtnascimento'],
  address_1: ['morada', 'endereco', 'rua', 'address1', 'address'],
  address_number: ['numero', 'n', 'no', 'nporta', 'addressnumber', 'porta'],
  address_2: ['complemento', 'andar', 'address2'],
  postal_code: ['codigopostal', 'cp', 'postalcode'],
  id_city: ['localidade', 'cidade', 'idcity', 'city', 'concelho'],
  neighborhood: ['bairro', 'neighborhood', 'zona', 'freguesia'],
  email: ['email', 'mail', 'correioeletronico'],
  gender: ['sexo', 'genero', 'gender'],
  nationality: ['nacionalidade', 'nationality', 'pais'],
  church_role: ['tipo', 'churchrole', 'situacao'],
  notas: ['observacoes', 'observacao', 'obs', 'notas', 'notes'],
};

/** Divide uma linha respeitando aspas — o Excel põe entre aspas os campos que
 *  têm o separador dentro. */
function partir(linha, sep) {
  const campos = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') { atual += '"'; i++; }
      else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { campos.push(atual.trim()); atual = ''; }
    else atual += c;
  }
  campos.push(atual.trim());
  return campos;
}

/** Aceita o que vier colado do Excel (tabs), CSV com ; ou , e o CSV exportado
 *  do admvc-site. Colunas que não reconhece não se perdem: vão para as
 *  observações como "Título: valor". Sem linha de títulos reconhecível,
 *  assume 1.ª coluna = nome, 2.ª = telemóvel. */
export function lerPlanilha(textoBruto) {
  const linhas = String(textoBruto || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];
  const topo = linhas[0];
  const sep = topo.includes('\t') ? '\t' : (topo.split(';').length >= topo.split(',').length ? ';' : ',');
  const brutos = partir(topo, sep);
  const titulos = brutos.map(semAcentos);
  const idx = {};
  const usados = new Set();
  Object.keys(COLUNAS).forEach((k) => {
    idx[k] = titulos.findIndex((t, i) => !usados.has(i) && COLUNAS[k].includes(t));
    if (idx[k] >= 0) usados.add(idx[k]);
  });
  const temTitulos = idx.telefone >= 0 && (idx.nome >= 0 || idx.first_name >= 0);
  if (!temTitulos) {
    Object.keys(idx).forEach((k) => { idx[k] = k === 'nome' ? 0 : k === 'telefone' ? 1 : -1; });
    usados.clear(); usados.add(0); usados.add(1);
  }
  const extras = temTitulos ? brutos.map((t, i) => (usados.has(i) || !t ? null : { i, t })).filter(Boolean) : [];
  const tipos = { membro: 'Membro', congregado: 'Congregado', visitante: 'Visitante' };
  const sexos = { m: 'Masculino', masculino: 'Masculino', h: 'Masculino', homem: 'Masculino', f: 'Feminino', feminino: 'Feminino', mulher: 'Feminino' };

  return linhas.slice(temTitulos ? 1 : 0).map((l, n) => {
    const c = partir(l, sep);
    const v = (k) => (idx[k] >= 0 ? c[idx[k]] || '' : '');
    const nome = v('nome') || [v('first_name'), v('last_name')].filter(Boolean).join(' ');
    const notas = [v('notas')].concat(extras.map(({ i, t }) => (c[i] ? t + ': ' + c[i] : ''))).filter(Boolean).join(' · ');
    return {
      linha: n + (temTitulos ? 2 : 1),
      nome,
      telefone: v('telefone'),
      birthdate: v('birthdate'),
      address_1: v('address_1'),
      address_number: v('address_number'),
      address_2: v('address_2'),
      postal_code: v('postal_code'),
      id_city: v('id_city'),
      neighborhood: v('neighborhood'),
      email: v('email'),
      gender: sexos[semAcentos(v('gender'))] || '',
      nationality: v('nationality'),
      church_role: tipos[semAcentos(v('church_role'))] || '',
      notas,
    };
  }).filter((r) => r.nome || r.telefone);
}

/** CSV do Excel português vem muitas vezes em Windows-1252, não UTF-8: se o
 *  UTF-8 der caracteres de substituição, lê de novo como 1252. */
async function lerFicheiro(f) {
  const bytes = await f.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}
