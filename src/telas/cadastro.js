// Passo 2: o cadastro. Três modos, conforme o que o servidor devolveu:
//   novo     → família nova; quem preenche fica Titular. Pode vir com o
//              primeiro nome (pré-cadastro sem data) ou com os dados da
//              equipa (pré-cadastro com a data confirmada).
//   admin    → titular ou cônjuge: edita a família inteira.
//   proprio  → outra pessoa da família com telemóvel (um filho): edita só os
//              seus dados; vê a morada e os nomes da família, sem mexer.
// Os nomes dos campos são os do modelo `Membro` do admvc-site.

import { esc, $, montar, topo, caixaErro, ocupado, ajudaMidia, enderecoCompleto, htmlCampoData, atualizarCampoData } from '../ui.js';
import { api } from '../api.js';
import {
  PAISES, TIPOS, TIPOS_OUTROS, SEXOS, ESTADOS_CIVIS, COM_CONJUGE, CULTO,
  NACIONALIDADES, OUTRA, OUTRO_BAIRRO,
} from '../dados.js';
import { telaInicio } from './inicio.js';
import { telaObrigado } from './obrigado.js';

const MAX_FILHOS = 15;

/** "+351 913 000 111" → { pais: '351', numero: '913000111' } */
function separarTelefone(formatado) {
  const m = String(formatado || '').match(/^\+(\d{1,4})\s(.*)$/);
  return m ? { pais: m[1], numero: m[2].replace(/\D+/g, '') } : { pais: '351', numero: '' };
}

function pessoaDoForm(p) {
  const r = p || {};
  const t = separarTelefone(r.phone_1);
  return {
    id: r.id || null,
    nome_completo: r.nome_completo || '',
    birthdate: r.birthdate || '',
    gender: r.gender || '',
    church_role: r.church_role || '',
    tel_pais: t.pais,
    tel_numero: t.numero,
    tem_conta: !!r.telefone_chave,
  };
}

/** A lista da igreja (Painel → Listas), ou a de dados.js se o servidor não mandar. */
const nacionalidadesDe = (config) => (config && Array.isArray(config.nacionalidades) && config.nacionalidades.length ? config.nacionalidades : NACIONALIDADES);

function estadoInicial(ctx, bairros) {
  const { modo, eu, familia, pessoas, pre, primeiroNome } = ctx;
  const p = eu || {};
  const origem = pre ? { nome_completo: pre.nome, ...pre } : p;
  const nac = origem.nationality || '';
  const naLista = !nac || nacionalidadesDe(ctx.config).includes(nac);
  const fam = familia || pre || {};
  const bairro = fam.neighborhood || '';
  const bairroNaLista = !bairro || bairros.includes(bairro);
  const outros = (pessoas || []).filter((x) => eu && x.id !== eu.id);
  const par = outros.find((x) => x.parentesco === (p.parentesco === 'Cônjuge' ? 'Titular' : 'Cônjuge'));
  return {
    eu: {
      nome_completo: origem.nome_completo || (primeiroNome ? primeiroNome + ' ' : ''),
      birthdate: origem.birthdate || '',
      gender: origem.gender || '',
      email: origem.email || '',
      church_role: origem.church_role || '',
      nacionalidade_escolha: naLista ? nac : OUTRA,
      nacionalidade_outra: naLista ? '' : nac,
    },
    marital_status: p.marital_status || (par ? 'Casado(a)' : ''),
    par: pessoaDoForm(par),
    filhos: outros.filter((x) => x.parentesco === 'Filho(a)').map(pessoaDoForm),
    familia: {
      endereco: enderecoCompleto(fam),
      bairro_escolha: bairroNaLista ? bairro : OUTRO_BAIRRO,
      bairro_outro: bairroNaLista ? '' : bairro,
      culto_no_lar: fam.culto_no_lar || '',
    },
    // Família montada pela equipa ainda não deu o consentimento: a caixa vem
    // desmarcada até o titular ou o cônjuge a marcar.
    gdpr_aceite: modo === 'admin' && !!familia && familia.gdpr_aceite === true,
  };
}

export function telaCadastro(ctx) {
  const { config, telefone, prova, modo, eu: euGuardado, membros, primeiroNome, pre } = ctx;
  const bairros = (config.bairros || []).slice();
  const s = estadoInicial(ctx, bairros);
  const souConjuge = modo === 'admin' && euGuardado.parentesco === 'Cônjuge';

  /* ── Peças de HTML ─────────────────────────────────────────── */

  // `caminho` diz onde o valor mora no estado: "eu.gender", "par.nome_completo",
  // "filhos.2.birthdate", "familia.endereco", "marital_status".
  const ler = (caminho) => caminho.split('.').reduce((o, k) => (o == null ? o : o[k]), s);
  const escrever = (caminho, valor) => {
    const partes = caminho.split('.');
    const ultimo = partes.pop();
    partes.reduce((o, k) => o[k], s)[ultimo] = valor;
  };

  const chips = (caminho, opcoes) => `
    <div class="chips" data-grupo="${caminho}" role="radiogroup">
      ${opcoes.map((o) => `<button type="button" class="chip ${ler(caminho) === o ? 'on' : ''}" data-valor="${esc(o)}" role="radio" aria-checked="${ler(caminho) === o}">${esc(o)}</button>`).join('')}
    </div>`;

  const campo = (caminho, rotulo, o = {}) => `
    <label class="campo ${o.classe || ''}" ${o.id ? `id="${o.id}"` : ''}>
      <span>${rotulo}${o.obrig ? ' <b class="obrig">*</b>' : ''}</span>
      <input data-campo="${caminho}" type="${o.tipo || 'text'}" value="${esc(ler(caminho))}"
        ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''}
        ${o.auto ? `autocomplete="${o.auto}"` : ''} ${o.modo ? `inputmode="${o.modo}"` : ''}
        ${o.max ? `max="${o.max}"` : ''} ${o.lista ? `list="${o.lista}"` : ''}
        ${o.maxlength ? `maxlength="${o.maxlength}"` : ''}>
    </label>`;

  // Data: campo de números com as barras automáticas (ver htmlCampoData).
  const campoData = (caminho, rotulo) => `
    <label class="campo">
      <span>${rotulo} <b class="obrig">*</b></span>
      ${htmlCampoData(`data-campo="${caminho}"`, ler(caminho))}
    </label>`;

  const telefoneDe = (base, rotulo) => `
    <div class="campo">
      <span class="rotulo">${rotulo}</span>
      <div class="telefone">
        <select data-campo="${base}.tel_pais" aria-label="Indicativo">
          ${PAISES.filter((p) => p.cod).map((p) => `<option value="${p.cod}" ${ler(base + '.tel_pais') === p.cod ? 'selected' : ''}>${p.bandeira} +${p.cod}</option>`).join('')}
        </select>
        <input data-campo="${base}.tel_numero" type="tel" inputmode="tel" value="${esc(ler(base + '.tel_numero'))}" placeholder="912 345 678">
      </div>
      <div class="nota">Com telemóvel, pode entrar no censo com o próprio número e a data de nascimento.</div>
    </div>`;

  const selectTipo = (caminho, rotulo) => `
    <label class="campo">
      <span>${rotulo}</span>
      <select data-campo="${caminho}">
        <option value="">—</option>
        ${TIPOS_OUTROS.map((t) => `<option ${ler(caminho) === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
    </label>`;

  const blocoEu = () => `
    <section class="cartao">
      <h2><span class="num">2</span> Sobre ti</h2>
      <div class="campo"><span class="rotulo">Na ADMVC és… <b class="obrig">*</b></span>${chips('eu.church_role', TIPOS)}</div>
      ${campo('eu.nome_completo', 'Nome completo', { obrig: true, auto: 'name', placeholder: 'Nome e apelidos' })}
      ${campoData('eu.birthdate', 'Data de nascimento')}
      <div class="campo"><span class="rotulo">Sexo <b class="obrig">*</b></span>${chips('eu.gender', SEXOS)}</div>
      <label class="campo">
        <span>Nacionalidade <b class="obrig">*</b></span>
        <select data-campo="eu.nacionalidade_escolha">
          <option value="">Escolhe…</option>
          ${nacionalidadesDe(config).concat(OUTRA).map((n) => `<option ${s.eu.nacionalidade_escolha === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
      </label>
      ${campo('eu.nacionalidade_outra', 'Qual?', { id: 'caixa-nac', classe: s.eu.nacionalidade_escolha === OUTRA ? '' : 'oculto', placeholder: 'ex.: Francesa' })}
      ${campo('eu.email', 'E-mail (opcional)', { tipo: 'email', auto: 'email', modo: 'email', placeholder: 'nome@exemplo.com' })}
    </section>`;

  const consentimento = (texto) => `
    <section class="cartao">
      <label class="consentir">
        <input type="checkbox" data-campo="gdpr_aceite" ${s.gdpr_aceite ? 'checked' : ''}>
        <span>${texto} <b class="obrig">*</b> <a href="/privacidade" target="_blank" rel="noopener" style="color:var(--verde)">Política de privacidade</a></span>
      </label>
    </section>`;

  /* ── Modo "próprio": só o perfil ───────────────────────────── */

  if (modo === 'proprio') {
    const f = ctx.familia || {};
    montar(`
      ${topo('Confere e atualiza os teus dados.')}
      <div class="cartao" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span>📱 <b>${esc(telefone.formatado)}</b></span>
        <button type="button" class="botao secundario pequeno" id="trocar">Sair</button>
      </div>
      <form id="form" novalidate>
        <div id="erro"></div>
        ${blocoEu()}
        <section class="cartao">
          <h2>🏠 A tua família no censo</h2>
          <p class="ajuda" style="margin:0 0 8px">${esc(enderecoCompleto(f))}${f.neighborhood ? ' · ' + esc(f.neighborhood) : ''}</p>
          <p style="margin:0">${(membros || []).map((m) => `${esc(m.nome)} <span class="etiqueta">${esc(m.parentesco)}</span>`).join('<br>')}</p>
          <p class="nota" style="margin-top:10px">A morada e as pessoas da família só podem ser alteradas pelo titular ou pelo cônjuge.</p>
        </section>
        ${consentimento('Autorizo a Igreja ADMVC a guardar os meus dados para organizar a vida da igreja. Não serão partilhados com terceiros e posso pedir para os corrigir ou apagar a qualquer momento.')}
        ${ajudaMidia('perfil')}
        <button class="botao" id="enviar">Guardar alterações</button>
      </form>
    `);
    ligar();
    return;
  }

  /* ── Modos "novo" e "admin": a família inteira ─────────────── */

  const saudacao = pre && pre.nome
    ? `<div class="cartao boas-vindas"><p class="ola">Olá, ${esc(String(pre.nome).split(' ')[0])}! 👋</p>
         <p>Já preenchemos o que a igreja sabia. Confere, corrige e completa a tua família.</p></div>`
    : primeiroNome && modo === 'novo'
      ? `<div class="cartao boas-vindas"><p class="ola">Olá, ${esc(primeiroNome)}! 👋</p>
           <p>Que bom ter-te aqui. Completa os dados da tua família — leva dois minutos.</p></div>`
      : '';

  montar(`
    ${topo(modo === 'admin' ? 'Confere e atualiza a tua família.' : 'Conta-nos quem vive contigo.')}
    ${saudacao}
    <div class="cartao" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span>📱 <b>${esc(telefone.formatado)}</b></span>
      <button type="button" class="botao secundario pequeno" id="trocar">${modo === 'admin' ? 'Sair' : 'Não sou eu'}</button>
    </div>
    <form id="form" novalidate>
      <div id="erro"></div>
      ${blocoEu()}

      <section class="cartao">
        <h2><span class="num">3</span> A tua família</h2>
        <div class="campo"><span class="rotulo">Estado civil <b class="obrig">*</b></span>${chips('marital_status', souConjuge ? COM_CONJUGE : ESTADOS_CIVIS)}</div>
        <div id="par"></div>
        <div class="campo">
          <span class="rotulo">Filhos que vivem contigo (ou que queres ligar à família)</span>
          <div class="contador">
            <button type="button" data-acao="menos" aria-label="Menos um filho">−</button>
            <output id="n-filhos">${s.filhos.length}</output>
            <button type="button" data-acao="mais" aria-label="Mais um filho">+</button>
          </div>
          <div id="filhos"></div>
        </div>
      </section>

      <section class="cartao">
        <h2><span class="num">4</span> Onde moram</h2>
        ${campo('familia.endereco', 'Endereço completo', { auto: 'street-address', placeholder: 'Rua, nº, andar, código postal' })}
        <label class="campo">
          <span>Bairro <b class="obrig">*</b></span>
          <select data-campo="familia.bairro_escolha">
            <option value="">Escolhe…</option>
            ${bairros.map((b) => `<option ${s.familia.bairro_escolha === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
            <option value="${OUTRO_BAIRRO}" ${s.familia.bairro_escolha === OUTRO_BAIRRO ? 'selected' : ''}>Outro — não está na lista</option>
          </select>
        </label>
        ${campo('familia.bairro_outro', 'Qual bairro?', { id: 'caixa-bairro', classe: s.familia.bairro_escolha === OUTRO_BAIRRO ? '' : 'oculto' })}
      </section>

      <section class="cartao">
        <h2><span class="num">5</span> Culto no lar</h2>
        <p class="ajuda">A igreja quer levar cultos às casas, bairro a bairro. Aceitam receber um em vossa casa?</p>
        ${chips('familia.culto_no_lar', CULTO)}
      </section>

      ${consentimento('Autorizo a Igreja ADMVC a guardar os dados da minha família para organizar a vida da igreja (contactos, cultos no lar e grupos por bairro). Não serão partilhados com terceiros e posso pedir para os corrigir ou apagar a qualquer momento.')}

      ${ajudaMidia('cadastro da família')}
      <button class="botao" id="enviar">${modo === 'admin' ? 'Guardar alterações' : 'Enviar o censo da família'}</button>
    </form>
    <p class="rodape">Os campos com <b class="obrig">*</b> são obrigatórios.</p>
  `);

  function desenharPar() {
    const caixa = $('#par');
    if (!COM_CONJUGE.includes(s.marital_status)) { caixa.innerHTML = ''; return; }
    caixa.innerHTML = `
      <div class="pessoa">
        <p class="pessoa-titulo">${souConjuge ? 'Titular da família' : 'Cônjuge'}${s.par.tem_conta ? ' <span class="etiqueta verde">tem cadastro</span>' : ''}</p>
        ${campo('par.nome_completo', 'Nome completo', { obrig: true, placeholder: 'Nome e apelidos' })}
        ${campoData('par.birthdate', 'Data de nascimento')}
        <div class="campo"><span class="rotulo">Sexo</span>${chips('par.gender', SEXOS)}</div>
        ${selectTipo('par.church_role', 'Frequenta a ADMVC?')}
        ${telefoneDe('par', 'Telemóvel (opcional)')}
      </div>`;
  }

  function desenharFilhos() {
    $('#n-filhos').textContent = s.filhos.length;
    $('#filhos').innerHTML = s.filhos.map((_, i) => `
      <div class="pessoa">
        <p class="pessoa-titulo">${i + 1}º filho${s.filhos[i].tem_conta ? ' <span class="etiqueta verde">tem cadastro</span>' : ''}</p>
        ${campo(`filhos.${i}.nome_completo`, 'Nome completo', { obrig: true, placeholder: 'Nome e apelidos' })}
        ${campoData(`filhos.${i}.birthdate`, 'Data de nascimento')}
        <div class="campo"><span class="rotulo">Sexo</span>${chips(`filhos.${i}.gender`, SEXOS)}</div>
        ${telefoneDe(`filhos.${i}`, 'Telemóvel próprio (opcional)')}
      </div>`).join('');
  }

  desenharPar();
  desenharFilhos();
  ligar();

  /* ── Eventos ─────────────────────────────────────────────── */

  function ligar() {
    const form = $('#form');

    if (primeiroNome && modo === 'novo' && !pre) {
      // Com o primeiro nome já escrito, o toque no campo pode pôr o cursor
      // antes dele e o apelido entra à frente ("SilvaAna").
      const nome = form.querySelector('[data-campo="eu.nome_completo"]');
      const fim = () => setTimeout(() => nome.setSelectionRange(nome.value.length, nome.value.length), 0);
      nome.addEventListener('focus', fim);
      nome.addEventListener('mouseup', fim, { once: true });
    }

    const aoMudar = (alvo) => {
      const caminho = alvo.dataset.campo;
      if (!caminho) return;
      escrever(caminho, alvo.type === 'checkbox' ? alvo.checked : alvo.value);
      alvo.classList.remove('invalido');
      if (caminho === 'eu.nacionalidade_escolha') $('#caixa-nac').classList.toggle('oculto', alvo.value !== OUTRA);
      if (caminho === 'familia.bairro_escolha') $('#caixa-bairro').classList.toggle('oculto', alvo.value !== OUTRO_BAIRRO);
    };
    form.addEventListener('input', (ev) => {
      if (ev.target.dataset.data !== undefined) { escrever(ev.target.dataset.campo, atualizarCampoData(ev.target)); return; }
      aoMudar(ev.target);
    });
    // Ao sair de uma data, "12/04/50" passa a "12/04/1950".
    form.addEventListener('focusout', (ev) => {
      if (ev.target.dataset.data !== undefined) escrever(ev.target.dataset.campo, atualizarCampoData(ev.target, true));
    });
    // Alguns telemóveis antigos só disparam "change" nos <select>.
    form.addEventListener('change', (ev) => { if (ev.target.tagName === 'SELECT') aoMudar(ev.target); });

    form.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (chip) {
        const grupo = chip.parentElement;
        escrever(grupo.dataset.grupo, chip.dataset.valor);
        grupo.querySelectorAll('.chip').forEach((c) => {
          c.classList.toggle('on', c === chip);
          c.setAttribute('aria-checked', c === chip);
        });
        grupo.classList.remove('invalido-grupo');
        if (grupo.dataset.grupo === 'marital_status') desenharPar();
        return;
      }
      const acao = ev.target.closest('[data-acao]');
      if (!acao) return;
      if (acao.dataset.acao === 'mais' && s.filhos.length < MAX_FILHOS) {
        s.filhos.push(pessoaDoForm(null));
        desenharFilhos();
        form.querySelector(`[data-campo="filhos.${s.filhos.length - 1}.nome_completo"]`).focus();
      }
      if (acao.dataset.acao === 'menos' && s.filhos.length) {
        const ultimo = s.filhos[s.filhos.length - 1];
        if (ultimo.tem_conta && !confirm(`${ultimo.nome_completo || 'Este filho'} tem cadastro próprio. Tirá-lo da família deixa-o numa família só dele. Continuar?`)) return;
        s.filhos.pop();
        desenharFilhos();
      }
    });

    $('#trocar').addEventListener('click', () => telaInicio({ config, telefone }));
    form.addEventListener('submit', (ev) => { ev.preventDefault(); enviar(); });
  }

  /* ── Conferir e enviar ───────────────────────────────────── */

  function conferir() {
    const erros = [];
    let primeiro = null;
    const falta = (msg, seletor) => {
      erros.push(msg);
      const el = $(seletor);
      if (el) { el.classList.add(el.classList.contains('chips') ? 'invalido-grupo' : 'invalido'); primeiro = primeiro || el; }
    };
    const e = s.eu;
    if (!e.church_role) falta('Diz-nos se és membro, congregado ou visitante.', '[data-grupo="eu.church_role"]');
    if (e.nome_completo.trim().split(/\s+/).length < 2) falta('Escreve o teu nome completo (nome e apelido).', '[data-campo="eu.nome_completo"]');
    if (!e.birthdate) falta('Escreve a tua data de nascimento completa (ex.: 12041950).', '[data-campo="eu.birthdate"]');
    if (!e.gender) falta('Escolhe o sexo.', '[data-grupo="eu.gender"]');
    if (!e.nacionalidade_escolha || (e.nacionalidade_escolha === OUTRA && !e.nacionalidade_outra.trim())) falta('Indica a nacionalidade.', '[data-campo="eu.nacionalidade_escolha"]');
    if (e.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email.trim())) falta('O e-mail não é válido.', '[data-campo="eu.email"]');
    if (!s.gdpr_aceite) falta('Para enviar, é preciso autorizar o uso dos dados.', '[data-campo="gdpr_aceite"]');
    if (modo === 'proprio') return { erros, primeiro };

    if (!s.marital_status) falta('Escolhe o estado civil.', '[data-grupo="marital_status"]');
    if (COM_CONJUGE.includes(s.marital_status)) {
      if (!s.par.nome_completo.trim()) falta('Escreve o nome do cônjuge.', '[data-campo="par.nome_completo"]');
      if (!s.par.birthdate) falta('Escreve a data de nascimento completa do cônjuge.', '[data-campo="par.birthdate"]');
    }
    s.filhos.forEach((f, i) => {
      if (!f.nome_completo.trim()) falta(`Escreve o nome do ${i + 1}º filho.`, `[data-campo="filhos.${i}.nome_completo"]`);
      if (!f.birthdate) falta(`Escreve a data de nascimento completa do ${i + 1}º filho.`, `[data-campo="filhos.${i}.birthdate"]`);
    });
    const fam = s.familia;
    if (!fam.bairro_escolha || (fam.bairro_escolha === OUTRO_BAIRRO && !fam.bairro_outro.trim())) falta('Escolhe o bairro.', '[data-campo="familia.bairro_escolha"]');
    if (!fam.culto_no_lar) falta('Responde se aceitam um culto no lar.', '[data-grupo="familia.culto_no_lar"]');
    return { erros, primeiro };
  }

  const paraEnvio = (p) => ({
    id: p.id,
    nome_completo: p.nome_completo,
    birthdate: p.birthdate,
    gender: p.gender,
    church_role: p.church_role,
    telefone: p.tel_numero ? { pais: p.tel_pais, numero: p.tel_numero } : null,
  });

  async function enviar() {
    const form = $('#form');
    form.querySelectorAll('.invalido, .invalido-grupo').forEach((el) => el.classList.remove('invalido', 'invalido-grupo'));
    const { erros, primeiro } = conferir();
    const caixa = $('#erro');
    if (erros.length) {
      caixa.innerHTML = caixaErro(erros.length === 1 ? erros[0] : 'Falta preencher algumas coisas:', erros.length > 1 ? erros : null);
      (primeiro || caixa).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const e = s.eu;
    const eu = {
      nome_completo: e.nome_completo,
      birthdate: e.birthdate,
      gender: e.gender,
      email: e.email,
      church_role: e.church_role,
      nationality: e.nacionalidade_escolha === OUTRA ? e.nacionalidade_outra : e.nacionalidade_escolha,
    };
    const corpo = modo === 'proprio'
      ? { telefone, prova, eu, gdpr_aceite: s.gdpr_aceite === true }
      : {
        telefone,
        prova,
        eu,
        marital_status: s.marital_status,
        par: COM_CONJUGE.includes(s.marital_status) ? paraEnvio(s.par) : null,
        filhos: s.filhos.map(paraEnvio),
        familia: {
          address_1: s.familia.endereco,
          culto_no_lar: s.familia.culto_no_lar,
          neighborhood: s.familia.bairro_escolha === OUTRO_BAIRRO ? s.familia.bairro_outro : s.familia.bairro_escolha,
          gdpr_aceite: s.gdpr_aceite === true,
        },
      };

    const botao = $('#enviar');
    ocupado(botao, true, 'A enviar…');
    try {
      const r = await api('gravar', corpo);
      telaObrigado({ config, nome: e.nome_completo, atualizado: r.atualizado });
    } catch (err) {
      caixa.innerHTML = caixaErro(err.message, err.erros && err.erros.length > 1 ? err.erros : null);
      caixa.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ocupado(botao, false);
    }
  }
}
