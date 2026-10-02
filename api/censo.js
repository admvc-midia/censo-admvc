// Função serverless da Vercel — Node.js, CommonJS, sem dependências.
//
// Guarda o Censo da Família ADMVC no Upstash Redis pela API REST (a mesma base
// do inscreva e do volta-admvc, com chaves próprias `censo:`).
//
// O modelo segue o do admvc-site (Familia + Membro.familia_id + parentesco):
//   censo:familias   hash — id da família → JSON (morada, bairro, culto no lar)
//   censo:pessoas    hash — id da pessoa → JSON (dados pessoais, familia_id,
//                    parentesco, is_family_admin, telefone_chave se tiver)
//   censo:tel        hash — telemóvel em dígitos com indicativo → id da pessoa.
//                    É o índice único: um telemóvel, uma pessoa.
//   censo:pre        hash — pré-cadastro da equipa, por telemóvel
//   censo:bairros    JSON com a lista de bairros do formulário
//   censo:regioes    JSON [{ nome, cor, bairros: [...] }] — grupos de bairros do mapa
//   censo:nacionalidades  JSON com a lista de nacionalidades do formulário
//   censo:cp:*       códigos postais já consultados (30 dias)
//   censo:rl:*       limite de pedidos por endereço de internet (expira sozinho)
//
// Quem pode o quê:
//   - Titular e Cônjuge (is_family_admin) editam a família inteira.
//   - Qualquer outra pessoa com telemóvel próprio (um filho) edita só os seus
//     dados pessoais.
//   - Abrir um cadastro existente exige telemóvel + data de nascimento dessa
//     pessoa. Sem bloqueio por tentativas erradas (decisão da igreja: não há
//     quem desbloqueie no culto). Ligar à família alguém que já tem cadastro exige a data dela.
//
// Sem as variáveis do Upstash, `config` responde `armazenamento: false` e as
// escritas falham com 503. O cadastro NUNCA cai para o navegador.
//
// CENSO_MEMORIA=1 troca o Upstash por um Map em memória — só para testes.

const crypto = require('crypto');

const PREFIXO = process.env.CENSO_PREFIXO || 'censo:';
const K = {
  familias: PREFIXO + 'familias',
  pessoas: PREFIXO + 'pessoas',
  tel: PREFIXO + 'tel',
  pre: PREFIXO + 'pre',
  bairros: PREFIXO + 'bairros',
  regioes: PREFIXO + 'regioes',
  nacionalidades: PREFIXO + 'nacionalidades',
};

const LIMITE_FAMILIAS = 4000;   // tetos de segurança: ninguém enche a base de graça
const LIMITE_PRE = 5000;
const LIMITE_FILHOS = 15;
// Pedidos por minuto por endereço de internet. Alto de propósito: no Wi-Fi da
// igreja todos os telemóveis saem pelo MESMO endereço, e cada irmão faz uns 3
// pedidos. Isto só trava abuso (um programa a martelar), não o culto.
const LIMITE_POR_IP = 600;

// Lista inicial, usada até a equipa gravar a sua no painel.
const BAIRROS_PADRAO = [
  'Centro da Figueira', 'Buarcos', 'Tavarede', 'São Pedro', 'Gala / Cova',
  'Vila Verde', 'Lavos', 'Paião', 'Alhadas', 'Quiaios', 'Maiorca',
  'Marinha das Ondas', 'Bom Sucesso', 'Moinhos da Gândara', 'Ferreira-a-Nova',
  'Alqueidão',
];

// Espelho de NACIONALIDADES em src/dados.js: é a lista até a equipa gravar a sua.
const NACIONALIDADES_PADRAO = [
  'Brasileira', 'Portuguesa', 'Angolana', 'Cabo-verdiana', 'Guineense',
  'Moçambicana', 'São-tomense', 'Venezuelana', 'Ucraniana',
];

// Regiões iniciais (um palpite pela geografia da Figueira da Foz), usadas até
// a equipa gravar as suas em Painel → Regiões e bairros.
const REGIOES_PADRAO = [
  { nome: 'Centro', cor: '#2fb65a', bairros: ['Centro da Figueira', 'Tavarede', 'Vila Verde'] },
  { nome: 'Buarcos e Norte', cor: '#3b82f6', bairros: ['Buarcos', 'Quiaios', 'Bom Sucesso', 'Moinhos da Gândara'] },
  { nome: 'Margem Sul', cor: '#d9a441', bairros: ['São Pedro', 'Gala / Cova', 'Lavos', 'Paião', 'Marinha das Ondas'] },
  { nome: 'Interior', cor: '#a855f7', bairros: ['Alhadas', 'Maiorca', 'Ferreira-a-Nova', 'Alqueidão'] },
];

const TIPOS = ['Membro', 'Congregado', 'Visitante'];
const TIPOS_OUTROS = TIPOS.concat('Não frequenta');
const SEXOS = ['Masculino', 'Feminino'];
const ESTADOS_CIVIS = ['Solteiro(a)', 'Casado(a)', 'União de facto', 'Divorciado(a)', 'Viúvo(a)'];
const COM_CONJUGE = ['Casado(a)', 'União de facto'];
const CULTO = ['Sim', 'Talvez', 'Não'];
const PARENTESCOS = ['Titular', 'Cônjuge', 'Filho(a)', 'Outro'];

/* ── Upstash ───────────────────────────────────────────────────────────── */

function credenciais() {
  if (process.env.CENSO_MEMORIA === '1') return { memoria: true };
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token: token };
}

const memoria = new Map();

// Com CENSO_MEMORIA_FICHEIRO (o servidor-local.js liga-o), a memória é gravada
// num ficheiro a cada escrita e lida ao arrancar — reiniciar o servidor local
// deixa de apagar o que se fez. Na Vercel nada disto corre: lá é o Upstash.
const FICHEIRO_MEMORIA = process.env.CENSO_MEMORIA === '1' ? process.env.CENSO_MEMORIA_FICHEIRO || '' : '';
if (FICHEIRO_MEMORIA) {
  try {
    const guardado = JSON.parse(require('fs').readFileSync(FICHEIRO_MEMORIA, 'utf8'));
    Object.keys(guardado).forEach((k) => {
      const v = guardado[k];
      memoria.set(k, v && typeof v === 'object' ? new Map(Object.entries(v)) : v);
    });
  } catch (e) { /* ainda não existe: começa vazia */ }
}
const ESCRITAS = new Set(['SET', 'DEL', 'HSET', 'HSETNX', 'HDEL']);
function gravarMemoria() {
  const plano = {};
  memoria.forEach((v, k) => {
    if (/:(rl|tent):/.test(k)) return; // contadores de limite não interessam
    plano[k] = v instanceof Map ? Object.fromEntries(v) : v;
  });
  require('fs').writeFileSync(FICHEIRO_MEMORIA, JSON.stringify(plano));
}

/** Só os comandos que este ficheiro usa, com as mesmas respostas do Redis. */
function comandoEmMemoria(cmd) {
  const [nome, chave, a, b] = cmd;
  const hash = () => {
    if (!memoria.has(chave)) memoria.set(chave, new Map());
    return memoria.get(chave);
  };
  const h = memoria.get(chave);
  switch (String(nome).toUpperCase()) {
    case 'GET': return memoria.has(chave) ? memoria.get(chave) : null;
    case 'SET': memoria.set(chave, String(a)); return 'OK';
    case 'DEL': return memoria.delete(chave) ? 1 : 0;
    case 'INCR': { const n = Number(memoria.get(chave) || 0) + 1; memoria.set(chave, String(n)); return n; }
    case 'EXPIRE': return 1;
    case 'HGET': return h && h.has(a) ? h.get(a) : null;
    case 'HSET': { const x = hash(); const novo = x.has(a) ? 0 : 1; x.set(a, String(b)); return novo; }
    case 'HSETNX': { const x = hash(); if (x.has(a)) return 0; x.set(a, String(b)); return 1; }
    case 'HDEL': return h && h.delete(a) ? 1 : 0;
    case 'HLEN': return h ? h.size : 0;
    case 'HMGET': return cmd.slice(2).map((c) => (h && h.has(c) ? h.get(c) : null));
    case 'HGETALL': { const l = []; if (h) h.forEach((v, k) => l.push(k, v)); return l; }
    default: throw new Error('comando não simulado: ' + nome);
  }
}

async function pedir(cred, caminho, corpo) {
  const resposta = await fetch(cred.url + caminho, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cred.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const r = await resposta.json().catch(() => null);
  if (!resposta.ok || !r || r.error) throw new Error((r && r.error) || 'o armazenamento respondeu ' + resposta.status);
  return r;
}

function emMemoria(cmd) {
  const r = comandoEmMemoria(cmd);
  if (FICHEIRO_MEMORIA && ESCRITAS.has(String(cmd[0]).toUpperCase())) gravarMemoria();
  return r;
}

async function comando(cred, cmd) {
  if (cred.memoria) return emMemoria(cmd);
  return (await pedir(cred, '', cmd)).result;
}

/** Vários comandos de uma vez, tudo-ou-nada (MULTI/EXEC do Upstash). É o que
 *  impede uma família de ficar meio gravada — pessoas sem família, ou o
 *  índice de telemóveis a apontar para quem já não existe. */
async function transacao(cred, cmds) {
  if (!cmds.length) return [];
  if (cred.memoria) {
    const r = cmds.map(comandoEmMemoria);
    if (FICHEIRO_MEMORIA) gravarMemoria();
    return r;
  }
  const r = await pedir(cred, '/multi-exec', cmds);
  if (!Array.isArray(r)) throw new Error('resposta inesperada da transação');
  const falha = r.find((x) => x && x.error);
  if (falha) throw new Error(falha.error);
  return r.map((x) => x.result);
}

/* ── Utilidades ────────────────────────────────────────────────────────── */

function lerCorpo(req) {
  let c;
  try { c = req.body; } catch (e) { return {}; }
  if (typeof c === 'string') {
    try { c = JSON.parse(c); } catch (e) { c = null; }
  }
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
}

function jsonOuNulo(t) {
  if (typeof t !== 'string') return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

function texto(valor, limite) {
  return String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim().slice(0, limite);
}

function soDigitos(valor) {
  return String(valor || '').replace(/\D+/g, '');
}

function novoId(prefixo) {
  return prefixo + crypto.randomBytes(6).toString('hex');
}

/** Na Vercel, sem SENHA_ADMIN o painel fica FECHADO — nunca cai para a senha
 *  de testes, porque o /admin está à vista de todos e guarda moradas e datas
 *  de nascimento de crianças. Fora da Vercel (testes locais) vale admin123. */
function senhaEsperada() {
  if (process.env.SENHA_ADMIN) return process.env.SENHA_ADMIN;
  return process.env.VERCEL ? '' : 'admin123';
}

function senhaCorreta(enviada) {
  const esperada = senhaEsperada();
  return !!esperada && String(enviada || '') === esperada;
}

function ipDe(req) {
  const xff = String((req.headers && req.headers['x-forwarded-for']) || '');
  return xff.split(',')[0].trim() || 'local';
}

/** Conta pedidos numa janela. O EXPIRE só vai no primeiro. */
async function excedeu(cred, chave, maximo, segundos) {
  const n = await comando(cred, ['INCR', PREFIXO + chave]);
  if (n === 1) await comando(cred, ['EXPIRE', PREFIXO + chave, segundos]);
  return n > maximo;
}

async function lerNacionalidades(cred) {
  const lista = jsonOuNulo(await comando(cred, ['GET', K.nacionalidades]));
  return Array.isArray(lista) && lista.length ? lista : NACIONALIDADES_PADRAO;
}

async function lerRegioes(cred) {
  const lista = jsonOuNulo(await comando(cred, ['GET', K.regioes]));
  return Array.isArray(lista) ? lista : REGIOES_PADRAO;
}

async function lerBairros(cred) {
  const lista = jsonOuNulo(await comando(cred, ['GET', K.bairros]));
  return Array.isArray(lista) ? lista : BAIRROS_PADRAO;
}

/** O HGETALL do Upstash volta como lista achatada [campo, valor, …]. */
function valoresDoHash(plano) {
  const lista = [];
  if (Array.isArray(plano)) {
    for (let i = 1; i < plano.length; i += 2) { const r = jsonOuNulo(plano[i]); if (r) lista.push(r); }
  } else if (plano && typeof plano === 'object') {
    Object.keys(plano).forEach((k) => { const r = jsonOuNulo(plano[k]); if (r) lista.push(r); });
  }
  return lista;
}

async function lerHash(cred, chave, campo) {
  return jsonOuNulo(await comando(cred, ['HGET', chave, campo]));
}

/** Todas as pessoas de uma família. Lê o hash inteiro: com algumas centenas
 *  de pessoas é um pedido só, e evita manter outro índice sincronizado. */
async function pessoasDaFamilia(cred, familiaId) {
  const todas = valoresDoHash(await comando(cred, ['HGETALL', K.pessoas]));
  return todas.filter((p) => p.familia_id === familiaId);
}

/* ── Telemóvel ─────────────────────────────────────────────────────────────
 * Espelho de src/telefone.js: os dois ficheiros andam juntos. A chave é o
 * número em dígitos com indicativo, por isso "912 345 678" e "+351912345678"
 * têm de dar exatamente o mesmo resultado nos dois lados. */

const REGRAS = {
  '351': /^9[1236]\d{7}$/,     // Portugal, telemóvel
  '55': /^[1-9]{2}9\d{8}$/,     // Brasil, DDD + 9 + 8 dígitos
  '244': /^9\d{8}$/,            // Angola
  '238': /^[59]\d{6}$/,         // Cabo Verde
};

function validarTelefone(entrada) {
  const pais = soDigitos(entrada && entrada.pais);
  let numero = soDigitos(entrada && entrada.numero);
  if (!/^[1-9]\d{0,3}$/.test(pais)) return { erro: 'Escolhe o indicativo do país.' };
  numero = numero.replace(/^00/, '');
  const regra = REGRAS[pais] || /^\d{6,14}$/;
  if (!regra.test(numero) && numero.startsWith(pais) && regra.test(numero.slice(pais.length))) {
    numero = numero.slice(pais.length);
  }
  if (!regra.test(numero)) return { erro: 'Este número de telemóvel não parece válido.' };
  return { pais: pais, numero: numero, chave: pais + numero, formatado: formatar(pais, numero) };
}

function formatar(pais, n) {
  if (pais === '351' || pais === '244') return '+' + pais + ' ' + n.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  if (pais === '55') return '+55 ' + n.replace(/(\d{2})(\d{5})(\d{4})/, '$1 $2-$3');
  return '+' + pais + ' ' + n;
}

/** Número escrito como vier numa planilha: "+351 912 345 678", "912345678",
 *  "00 55 11 91234-5678", "(11) 91234-5678". Sem indicativo, só se aceita o
 *  que não deixa dúvida: 9 dígitos começando por 9[1236] é Portugal, 11
 *  dígitos com DDD + 9 é Brasil. O resto precisa do "+". */
function normalizarLivre(entrada) {
  const bruto = String(entrada || '').trim();
  const d = soDigitos(bruto);
  if (!d) return { erro: 'sem telemóvel' };
  const comIndicativo = /^(\+|00)/.test(bruto);
  const tudo = comIndicativo ? d.replace(/^00/, '') : d;
  if (comIndicativo || tudo.length > 11) {
    for (const pais of Object.keys(REGRAS)) {
      if (tudo.startsWith(pais) && REGRAS[pais].test(tudo.slice(pais.length))) {
        return validarTelefone({ pais: pais, numero: tudo.slice(pais.length) });
      }
    }
    if (comIndicativo && /^[1-9]\d{7,14}$/.test(tudo)) {
      // Indicativo desconhecido: a chave é "todos os dígitos", e é isso que
      // validarTelefone dá quando a pessoa escolhe "Outro" e digita o mesmo.
      return { chave: tudo, formatado: '+' + tudo };
    }
    return { erro: 'número inválido' };
  }
  if (REGRAS['351'].test(d)) return validarTelefone({ pais: '351', numero: d });
  if (REGRAS['55'].test(d)) return validarTelefone({ pais: '55', numero: d });
  return { erro: 'número inválido ou sem indicativo (ex.: +351)' };
}

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

/** "Maria José Silva" → "Mar***". Quem digita o número de outra pessoa fica a
 *  saber que existe um cadastro, mas não de quem é. */
function nomeMascarado(nome) {
  return primeiroNome(nome).slice(0, 3) + '***';
}

/* ── Datas ─────────────────────────────────────────────────────────────── */

function dataValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s && s >= '1900-01-01' && d <= new Date();
}

/** Datas como vêm de uma planilha portuguesa: 12/04/1985, 12-04-1985,
 *  12.04.85, 1985-04-12. Dia primeiro, sempre (pt-PT). Devolve AAAA-MM-DD ou ''. */
function normalizarData(entrada) {
  const s = String(entrada || '').trim();
  let a, m, d;
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (x) { a = +x[1]; m = +x[2]; d = +x[3]; }
  else {
    x = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
    if (!x) return '';
    d = +x[1]; m = +x[2]; a = +x[3];
    if (x[3].length === 2) a += a > new Date().getFullYear() % 100 ? 1900 : 2000;
  }
  const iso = a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return dataValida(iso) ? iso : '';
}

/* ── Validação ─────────────────────────────────────────────────────────── */

/** Uma pessoa do formulário. `principal` é quem está a preencher: para ela o
 *  nome completo, o sexo, a nacionalidade e o tipo são obrigatórios. Para os
 *  outros, só nome e data de nascimento — a data é o que um filho vai usar
 *  para entrar com o próprio telemóvel. */
function validarPessoa(e, rotulo, principal) {
  const erros = [];
  const p = e || {};
  const nome = texto(p.nome_completo, 120);
  if (principal ? nome.split(' ').length < 2 : !nome) {
    erros.push(principal ? 'Escreve o teu nome completo (nome e apelido).' : 'Escreve o nome ' + rotulo + '.');
  }
  const birthdate = texto(p.birthdate, 10);
  if (!dataValida(birthdate)) erros.push(principal ? 'A tua data de nascimento não é válida.' : 'A data de nascimento ' + rotulo + ' não é válida.');

  const tipos = principal ? TIPOS : TIPOS_OUTROS;
  const tipo = tipos.includes(p.church_role) ? p.church_role : '';
  if (principal && !tipo) erros.push('Diz-nos se és membro, congregado ou visitante.');
  const sexo = SEXOS.includes(p.gender) ? p.gender : '';
  if (principal && !sexo) erros.push('Escolhe o sexo.');
  const nacionalidade = texto(p.nationality, 60);
  if (principal && !nacionalidade) erros.push('Indica a nacionalidade.');
  const email = texto(p.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.push('O e-mail ' + (principal ? '' : rotulo + ' ') + 'não é válido.');

  let tel = null;
  if (soDigitos(p.telefone && p.telefone.numero)) {
    tel = validarTelefone(p.telefone);
    if (tel.erro) { erros.push('O telemóvel ' + rotulo + ' não parece válido.'); tel = null; }
  }

  const partes = nome.split(' ');
  return {
    erros,
    pessoa: {
      id: typeof p.id === 'string' && /^p_[0-9a-f]{12}$/.test(p.id) ? p.id : null,
      nome_completo: nome,
      first_name: partes[0] || '',
      last_name: partes.slice(1).join(' '),
      birthdate,
      gender: sexo,
      nationality: nacionalidade,
      email,
      church_role: tipo,
      telefone_chave: tel ? tel.chave : '',
      phone_1: tel ? tel.formatado : '',
    },
  };
}

/** A morada é um campo só ("Endereço completo"). Moradas antigas ou vindas
 *  da planilha podem ter as partes separadas (número, código postal,
 *  localidade): junta-as sem repetir o que já está escrito na rua. */
function enderecoCompleto(o) {
  const base = texto(o && o.address_1, 250);
  const partes = [o && o.address_number, o && o.address_2, o && o.postal_code, o && o.id_city]
    .map((x) => texto(x, 80))
    .filter((x) => x && !base.toLowerCase().includes(x.toLowerCase()));
  return [base].concat(partes).filter(Boolean).join(', ').slice(0, 250);
}

/** Campos de morada a gravar a partir do endereço completo. O código postal,
 *  se vier escrito no meio, é guardado à parte: é o que põe a família no
 *  mapa com mais precisão. */
function moradaDe(endereco) {
  const cp = /\b(\d{4})\s?-\s?(\d{3})\b/.exec(endereco || '');
  return {
    address_1: endereco,
    address_number: '',
    address_2: '',
    postal_code: cp ? cp[1] + '-' + cp[2] : '',
    id_city: '',
  };
}

/** Só o bairro é obrigatório na morada (pedido da igreja). */
function validarFamilia(e, bairros) {
  const erros = [];
  const f = e || {};
  const bairro = texto(f.neighborhood, 80);
  if (!bairro) erros.push('Escolhe o bairro.');
  const culto = CULTO.includes(f.culto_no_lar) ? f.culto_no_lar : '';
  if (!culto) erros.push('Responde se aceitam um culto no lar.');
  if (f.gdpr_aceite !== true) erros.push('Para enviar, é preciso autorizar o uso dos dados.');
  return {
    erros,
    familia: Object.assign(moradaDe(enderecoCompleto(f)), {
      neighborhood: bairro,
      bairro_fora_lista: !bairros.includes(bairro),
      culto_no_lar: culto,
      gdpr_aceite: true,
    }),
  };
}

/** Mudou a morada ou o bairro: a posição antiga no mapa já não vale. */
function posicaoMudou(antes, depois) {
  return !antes || antes.address_1 !== depois.address_1 || antes.neighborhood !== depois.neighborhood;
}
const SEM_POSICAO = { lat: null, lon: null, freguesia: '', geo_fonte: '', geo_falhou: false };

/** Só os dados pessoais — o que um filho pode mudar no próprio perfil e o que
 *  a família pode mudar em alguém. */
const CAMPOS_PESSOAIS = ['nome_completo', 'first_name', 'last_name', 'birthdate', 'gender', 'nationality', 'email', 'church_role'];

function copiarPessoais(destino, origem) {
  CAMPOS_PESSOAIS.forEach((c) => {
    // Num familiar, campo opcional deixado vazio não apaga o que a própria
    // pessoa já tinha escrito no seu perfil.
    if (origem[c] !== '' || !destino[c]) destino[c] = origem[c];
  });
  return destino;
}

/* ── Código postal (geoapi.pt) ─────────────────────────────────────────────
 * Passa pelo servidor porque a geoapi não deixa o browser chamá-la (CORS). A
 * resposta do CP não traz a freguesia: vem o centro do código postal, e uma
 * segunda consulta por GPS devolve-a. A geoapi grátis limita pedidos por IP
 * — e na Vercel todos os telemóveis saem pelo mesmo IP —, por isso cada
 * código fica 30 dias no Redis, e GEOAPI_KEY, se existir, vai no pedido. */

const CACHE_CP_SEGUNDOS = 30 * 24 * 3600;

async function comPrazo(url, ms) {
  const chave = process.env.GEOAPI_KEY;
  if (chave) url += (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(chave);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CensoADMVC/1.0' }, signal: ctl.signal });
    const corpo = await r.json().catch(() => null);
    // O limite chega como 429 ou como 200 com {"msg": "...limit..."}.
    if (r.status === 429 || (corpo && corpo.msg && /limit/i.test(corpo.msg))) return { limite: true };
    return { estado: r.status, corpo: r.ok ? corpo : null };
  } catch (e) {
    return { falhou: true };
  } finally {
    clearTimeout(t);
  }
}

async function procurarCodigoPostal(cp) {
  const pedido = await comPrazo('https://json.geoapi.pt/cp/' + cp, 6000);
  if (pedido.limite || pedido.falhou) throw new Error('geoapi indisponível');
  const d = Array.isArray(pedido.corpo) ? pedido.corpo[0] : pedido.corpo;
  if (!d || !d.CP) return null;
  const ruas = [];
  (d.partes || []).forEach((p) => { if (p && p['Artéria'] && !ruas.includes(p['Artéria'])) ruas.push(p['Artéria']); });
  if (!ruas.length) (d.ruas || []).forEach((r) => { if (r && !ruas.includes(r)) ruas.push(r); });
  const centro = Array.isArray(d.centro) ? d.centro : Array.isArray(d.centroide) ? d.centroide : null;
  let freguesia = '';
  if (centro) {
    const g = await comPrazo('https://json.geoapi.pt/gps/' + centro[0] + ',' + centro[1], 4000);
    if (g.corpo && g.corpo.freguesia) freguesia = g.corpo.freguesia;
  }
  return {
    ruas: ruas.slice(0, 30),
    localidade: d.Localidade || d.municipio || d.Concelho || '',
    concelho: d.Concelho || d.municipio || '',
    distrito: d.Distrito || '',
    freguesia,
    lat: centro ? centro[0] : null,
    lon: centro ? centro[1] : null,
  };
}

/* ── Localizar uma família no mapa ─────────────────────────────────────── */

async function localizar(cred, f) {
  if (/^\d{4}-\d{3}$/.test(f.postal_code || '')) {
    const chaveCache = PREFIXO + 'cp:' + f.postal_code;
    let r = jsonOuNulo(await comando(cred, ['GET', chaveCache]));
    if (!r) {
      try { r = await procurarCodigoPostal(f.postal_code); } catch (e) { r = null; }
      if (r && r.freguesia) {
        await comando(cred, ['SET', chaveCache, JSON.stringify(r)]);
        await comando(cred, ['EXPIRE', chaveCache, CACHE_CP_SEGUNDOS]);
      }
    }
    if (r && r.lat != null) return { lat: r.lat, lon: r.lon, fonte: 'codigo-postal', freguesia: r.freguesia };
  }
  const endereco = enderecoCompleto(f);
  const morada = [endereco, /figueira/i.test(endereco) ? '' : 'Figueira da Foz', 'Portugal'].filter(Boolean).join(', ');
  if (!f.address_1 && !f.neighborhood) return null;
  const pedir = async (q) => {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pt&q=' + encodeURIComponent(q);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'CensoADMVC/1.0 (censo da Igreja ADMVC, Figueira da Foz)', Accept: 'application/json' }, signal: ctl.signal });
      const l = r.ok ? await r.json() : [];
      return Array.isArray(l) && l[0] ? { lat: Number(l[0].lat), lon: Number(l[0].lon) } : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  };
  const pausa = () => new Promise((ok) => setTimeout(ok, 1100)); // regra do Nominatim: 1 pedido/segundo
  // Morada completa; se não encontrar, só a rua e a localidade; por fim, o
  // centro do bairro — aproximado, mas chega para planear os Pequenos Grupos.
  let pos = f.address_1 ? await pedir(morada) : null;
  // Sem resultado com tudo: tenta só a primeira parte (normalmente a rua).
  const rua = endereco.split(',')[0].replace(/\s+\d+[a-zº°ª]*\s*$/i, '').trim();
  if (!pos && rua && rua !== endereco) {
    await pausa();
    pos = await pedir([rua, 'Figueira da Foz', 'Portugal'].join(', '));
  }
  if (pos) { await pausa(); return Object.assign(pos, { fonte: 'morada' }); }
  if (f.neighborhood) {
    await pausa();
    pos = await pedir([f.neighborhood, 'Figueira da Foz', 'Portugal'].join(', '));
    if (!pos && f.id_city && f.id_city !== 'Figueira da Foz') { await pausa(); pos = await pedir([f.neighborhood, f.id_city, 'Portugal'].join(', ')); }
  }
  await pausa();
  return pos ? Object.assign(pos, { fonte: 'bairro' }) : null;
}

/* ── Quem está a pedir ─────────────────────────────────────────────────── */

/** Confere telemóvel + data de nascimento. Devolve a pessoa, ou um erro com o
 *  código HTTP certo. */
async function autenticar(cred, tel, prova) {
  const id = await comando(cred, ['HGET', K.tel, tel.chave]);
  const pessoa = id ? await lerHash(cred, K.pessoas, id) : null;
  if (!pessoa) return { estado: 404, erro: 'Não há cadastro com este número.' };
  if (String(prova || '') !== pessoa.birthdate) {
    return { estado: 403, erro: 'A data de nascimento não confere com a do cadastro.' };
  }
  return { pessoa };
}

/** O que cada um vê ao abrir: a família inteira para titular/cônjuge; para
 *  os outros, o próprio perfil, a morada da casa e só os nomes da família. */
async function vistaPara(cred, pessoa) {
  const familia = await lerHash(cred, K.familias, pessoa.familia_id);
  const membros = await pessoasDaFamilia(cred, pessoa.familia_id);
  if (pessoa.is_family_admin) return { modo: 'admin', eu: pessoa, familia, pessoas: membros };
  return {
    modo: 'proprio',
    eu: pessoa,
    familia: familia && {
      address_1: familia.address_1, address_number: familia.address_number, id_city: familia.id_city,
      neighborhood: familia.neighborhood,
    },
    membros: membros.filter((m) => m.id !== pessoa.id).map((m) => ({ nome: m.nome_completo, parentesco: m.parentesco })),
  };
}

/* ── Gravar uma família ────────────────────────────────────────────────────
 * Recebe "eu" (quem preenche), "par" (o outro adulto do casal), "filhos" e a
 * morada. Monta o estado final em memória, confere os telemóveis contra o
 * índice e grava tudo numa transação. */

async function gravarFamilia(cred, corpo, tel, eu0, bairros) {
  const erros = [];
  const vEu = validarPessoa(corpo.eu, '', true);
  erros.push(...vEu.erros);
  const estado = ESTADOS_CIVIS.includes(corpo.marital_status) ? corpo.marital_status : '';
  if (!estado) erros.push('Escolhe o estado civil.');
  const comPar = COM_CONJUGE.includes(estado);
  const vPar = comPar ? validarPessoa(corpo.par, 'do cônjuge', false) : null;
  if (vPar) erros.push(...vPar.erros);
  const filhosEntrada = Array.isArray(corpo.filhos) ? corpo.filhos.slice(0, LIMITE_FILHOS) : [];
  const vFilhos = filhosEntrada.map((f, i) => validarPessoa(f, 'do ' + (i + 1) + 'º filho', false));
  vFilhos.forEach((v) => erros.push(...v.erros));
  const vFam = validarFamilia(corpo.familia, bairros);
  erros.push(...vFam.erros);
  if (erros.length) return { estado: 400, erros };

  const agora = new Date().toISOString();
  const familiaId = eu0 ? eu0.familia_id : novoId('f_');
  const existentes = eu0 ? await pessoasDaFamilia(cred, familiaId) : [];
  const porId = new Map(existentes.map((p) => [p.id, p]));

  // Papel de cada um. Quem preenche é Titular numa família nova; numa
  // existente, mantém o seu. Se for o Cônjuge, o "par" é o Titular — e o
  // Titular não pode ser retirado por ele.
  const meuPapel = eu0 ? eu0.parentesco : 'Titular';
  if (meuPapel === 'Cônjuge' && !comPar) {
    return { estado: 400, erros: ['O titular da família não pode ser retirado por aqui. Fala com a equipa.'] };
  }
  const papelPar = meuPapel === 'Cônjuge' ? 'Titular' : 'Cônjuge';

  const final = [];
  const eu = Object.assign({}, eu0 || {}, vEu.pessoa, {
    id: eu0 ? eu0.id : novoId('p_'),
    familia_id: familiaId,
    parentesco: meuPapel,
    is_family_admin: true,
    marital_status: estado,
    telefone_chave: tel.chave,
    phone_1: tel.formatado,
  });
  final.push(eu);

  const entradas = [];
  if (vPar) entradas.push({ v: vPar.pessoa, papel: papelPar, rotulo: 'do cônjuge' });
  vFilhos.forEach((v, i) => entradas.push({ v: v.pessoa, papel: 'Filho(a)', rotulo: 'do ' + (i + 1) + 'º filho' }));

  // Telemóveis repetidos no próprio formulário.
  const vistos = new Set([tel.chave]);
  for (const en of entradas) {
    if (!en.v.telefone_chave) continue;
    if (vistos.has(en.v.telefone_chave)) return { estado: 400, erros: ['O telemóvel ' + en.rotulo + ' está repetido.'] };
    vistos.add(en.v.telefone_chave);
  }

  const cmds = [];
  const outrasFamilias = []; // famílias de onde alguém foi trazido e ficaram vazias

  for (const en of entradas) {
    const v = en.v;
    let pessoa = v.id && porId.has(v.id) ? Object.assign({}, porId.get(v.id)) : null;

    if (v.telefone_chave) {
      const dono = await comando(cred, ['HGET', K.tel, v.telefone_chave]);
      if (dono && (!pessoa || dono !== pessoa.id)) {
        const outro = await lerHash(cred, K.pessoas, dono);
        if (outro && outro.familia_id === familiaId) {
          pessoa = Object.assign({}, outro);
        } else if (outro) {
          // Já tem cadastro noutra família. Só se liga a esta se a data de
          // nascimento escrita aqui for a dela — senão qualquer um "adotava"
          // o número de outra pessoa e passava a ver os dados dela.
          if (outro.birthdate !== v.birthdate) {
            return { estado: 409, erros: ['O telemóvel ' + en.rotulo + ' já tem cadastro, e a data de nascimento não confere com a dessa pessoa.'] };
          }
          const restantes = (await pessoasDaFamilia(cred, outro.familia_id)).filter((p) => p.id !== outro.id);
          if (restantes.length) {
            return { estado: 409, erros: ['O telemóvel ' + en.rotulo + ' pertence a alguém que já está noutra família. Fala com a equipa para juntar as famílias.'] };
          }
          outrasFamilias.push(outro.familia_id);
          // Mantém os dados que a própria pessoa escreveu; só muda de casa.
          pessoa = Object.assign({}, outro);
          final.push(Object.assign(pessoa, { familia_id: familiaId, parentesco: en.papel, is_family_admin: en.papel !== 'Filho(a)', atualizado_em: agora }));
          continue;
        }
      }
    }

    if (!pessoa) pessoa = { id: novoId('p_'), criado_em: agora };
    copiarPessoais(pessoa, v);
    if (pessoa.telefone_chave && pessoa.telefone_chave !== v.telefone_chave) {
      cmds.push(['HDEL', K.tel, pessoa.telefone_chave]);
    }
    pessoa.telefone_chave = v.telefone_chave;
    pessoa.phone_1 = v.phone_1;
    pessoa.familia_id = familiaId;
    pessoa.parentesco = en.papel;
    pessoa.is_family_admin = en.papel !== 'Filho(a)';
    if (en.papel !== 'Filho(a)') pessoa.marital_status = estado;
    pessoa.atualizado_em = agora;
    final.push(pessoa);
  }

  if (meuPapel === 'Cônjuge') {
    const titular = existentes.find((p) => p.parentesco === 'Titular');
    if (titular && !final.some((p) => p.id === titular.id)) {
      return { estado: 400, erros: ['O titular da família não pode ser retirado por aqui. Fala com a equipa.'] };
    }
  }

  // Quem estava na família e saiu do formulário: com telemóvel próprio, vai
  // para uma família só sua (não se perde o cadastro de um filho que já tem
  // conta); sem telemóvel, é apagado.
  const ficam = new Set(final.map((p) => p.id));
  for (const p of existentes) {
    if (ficam.has(p.id)) continue;
    if (p.parentesco === 'Outro') { final.push(p); continue; } // só o painel mexe nestes
    if (p.telefone_chave) {
      const nova = novoId('f_');
      const fam0 = await lerHash(cred, K.familias, familiaId);
      cmds.push(['HSET', K.familias, nova, JSON.stringify(Object.assign({}, fam0 || {}, { id: nova, criado_em: agora, atualizado_em: agora, separada_de: familiaId }))]);
      cmds.push(['HSET', K.pessoas, p.id, JSON.stringify(Object.assign({}, p, { familia_id: nova, parentesco: 'Titular', is_family_admin: true, atualizado_em: agora }))]);
    } else {
      cmds.push(['HDEL', K.pessoas, p.id]);
    }
  }

  const fam0 = eu0 ? await lerHash(cred, K.familias, familiaId) : null;
  const familia = Object.assign({}, fam0 || {}, vFam.familia, posicaoMudou(fam0, vFam.familia) ? SEM_POSICAO : {}, {
    id: familiaId,
    criado_em: fam0 ? fam0.criado_em : agora,
    atualizado_em: agora,
    gdpr_data: (fam0 && fam0.gdpr_data) || agora,
  });

  // Pré-cadastro com data diferente da que a pessoa escreveu: a equipa vê.
  if (!eu0) {
    const pre = await lerHash(cred, K.pre, tel.chave);
    if (pre) {
      eu.veio_do_pre = true;
      if (pre.birthdate && pre.birthdate !== eu.birthdate) eu.data_diferente_pre = true;
    }
    eu.criado_em = agora;
  }
  eu.atualizado_em = agora;

  cmds.push(['HSET', K.familias, familiaId, JSON.stringify(familia)]);
  for (const p of final) {
    cmds.push(['HSET', K.pessoas, p.id, JSON.stringify(p)]);
    if (p.telefone_chave) cmds.push(['HSET', K.tel, p.telefone_chave, p.id]);
  }
  for (const f of outrasFamilias) cmds.push(['HDEL', K.familias, f]);
  await transacao(cred, cmds);
  return { estado: 200, familiaId };
}

/* ── Ações públicas ────────────────────────────────────────────────────── */

async function tratarGet(req, res, cred) {
  const acao = String((req.query && req.query.acao) || 'config');

  if (acao === 'cp') {
    const cp = String(req.query.cp || '');
    if (!/^\d{4}-\d{3}$/.test(cp)) return res.status(400).json({ erro: 'Código postal inválido.' });
    if (cred && await excedeu(cred, 'rl:cp:' + ipDe(req), LIMITE_POR_IP, 60)) {
      return res.status(429).json({ erro: 'Demasiados pedidos. Espera um minuto.' });
    }
    const chaveCache = PREFIXO + 'cp:' + cp;
    const guardado = cred ? jsonOuNulo(await comando(cred, ['GET', chaveCache])) : null;
    if (guardado) return res.status(200).json(guardado);
    let r;
    try {
      r = await procurarCodigoPostal(cp);
    } catch (e) {
      return res.status(503).json({ erro: 'Não deu para procurar o código postal agora.' });
    }
    if (!r) return res.status(404).json({ erro: 'Código postal não encontrado.' });
    // Sem freguesia (a 2.ª consulta falhou) não guarda: na próxima tenta de novo.
    if (cred && r.freguesia) {
      await comando(cred, ['SET', chaveCache, JSON.stringify(r)]);
      await comando(cred, ['EXPIRE', chaveCache, CACHE_CP_SEGUNDOS]);
    }
    return res.status(200).json(r);
  }

  if (!cred) return res.status(200).json({ armazenamento: false, bairros: BAIRROS_PADRAO, nacionalidades: NACIONALIDADES_PADRAO, familias: 0 });
  if (acao === 'contagem') return res.status(200).json({ familias: await comando(cred, ['HLEN', K.familias]) });
  return res.status(200).json({ armazenamento: true, bairros: await lerBairros(cred), nacionalidades: await lerNacionalidades(cred) });
}

async function tratarPost(req, res, cred) {
  const corpo = lerCorpo(req);
  const acao = String(corpo.acao || '');
  if (!cred) return res.status(503).json({ erro: 'O armazenamento não está configurado. O cadastro não foi gravado.' });

  if (acao.startsWith('admin-')) return tratarAdmin(corpo, acao, res, cred);

  if (await excedeu(cred, 'rl:' + ipDe(req), LIMITE_POR_IP, 60)) {
    return res.status(429).json({ erro: 'Demasiados pedidos. Espera um minuto e tenta outra vez.' });
  }

  const tel = validarTelefone(corpo.telefone);
  if (tel.erro) return res.status(400).json({ erro: tel.erro });
  const telefone = { pais: tel.pais, numero: tel.numero, formatado: tel.formatado };
  const idDono = await comando(cred, ['HGET', K.tel, tel.chave]);
  const dono = idDono ? await lerHash(cred, K.pessoas, idDono) : null;

  if (acao === 'verificar') {
    if (dono) return res.status(200).json({ telefone, estado: 'registado', nome: nomeMascarado(dono.nome_completo) });
    const pre = await lerHash(cred, K.pre, tel.chave);
    // Pré-cadastro com data: não diz nada antes de a data conferir. Sem data:
    // só o primeiro nome. Apelido, morada e notas da equipa nunca saem daqui
    // sem a data certa — quem digita um número pode não ser o dono dele.
    if (pre && pre.birthdate) return res.status(200).json({ telefone, estado: 'pre_data' });
    if (pre) return res.status(200).json({ telefone, estado: 'pre', primeiro_nome: primeiroNome(pre.nome) });
    return res.status(200).json({ telefone, estado: 'novo' });
  }

  if (acao === 'abrir') {
    if (dono) {
      const a = await autenticar(cred, tel, corpo.prova);
      if (a.erro) return res.status(a.estado).json({ erro: a.erro });
      return res.status(200).json(await vistaPara(cred, a.pessoa));
    }
    const pre = await lerHash(cred, K.pre, tel.chave);
    if (!pre || !pre.birthdate) return res.status(404).json({ erro: 'Não há cadastro com este número.' });
    if (String(corpo.prova || '') !== pre.birthdate) {
      return res.status(403).json({ erro: 'A data não confere com a que a igreja tem.', pre_falhou: true });
    }
    const dados = {};
    ['nome', 'birthdate', 'email', 'gender', 'nationality', 'church_role', 'address_1', 'address_number',
      'address_2', 'postal_code', 'id_city', 'neighborhood'].forEach((c) => { if (pre[c]) dados[c] = pre[c]; });
    return res.status(200).json({ modo: 'pre', pre: dados });
  }

  if (acao === 'gravar') {
    const bairros = await lerBairros(cred);

    if (dono) {
      const a = await autenticar(cred, tel, corpo.prova);
      if (a.erro) {
        return res.status(a.estado).json({ erro: a.estado === 403 ? 'Este número já tem cadastro. Volta ao início para o atualizar.' : a.erro });
      }
      if (!a.pessoa.is_family_admin) {
        // Um filho com conta própria: só os seus dados pessoais.
        const v = validarPessoa(corpo.eu, '', true);
        if (corpo.gdpr_aceite !== true) v.erros.push('Para enviar, é preciso autorizar o uso dos dados.');
        if (v.erros.length) return res.status(400).json({ erro: v.erros[0], erros: v.erros });
        const p = copiarPessoais(Object.assign({}, a.pessoa), v.pessoa);
        p.atualizado_em = new Date().toISOString();
        p.gdpr_data = p.gdpr_data || p.atualizado_em;
        await comando(cred, ['HSET', K.pessoas, p.id, JSON.stringify(p)]);
        return res.status(200).json({ ok: true, atualizado: true });
      }
      const r = await gravarFamilia(cred, corpo, tel, a.pessoa, bairros);
      if (r.erros) return res.status(r.estado).json({ erro: r.erros[0], erros: r.erros });
      return res.status(200).json({ ok: true, atualizado: true });
    }

    if (await comando(cred, ['HLEN', K.familias]) >= LIMITE_FAMILIAS) {
      return res.status(507).json({ erro: 'O censo atingiu o limite de registos. Fala com a equipa.' });
    }
    // Reserva o telemóvel antes de gravar: se dois envios do mesmo número
    // chegarem juntos, só um passa daqui.
    const reserva = await comando(cred, ['HSETNX', K.tel, tel.chave, 'reservado']);
    if (!reserva) return res.status(409).json({ erro: 'Este número acabou de ser cadastrado. Volta ao início para o atualizar.' });
    try {
      const r = await gravarFamilia(cred, corpo, tel, null, bairros);
      if (r.erros) {
        await comando(cred, ['HDEL', K.tel, tel.chave]);
        return res.status(r.estado).json({ erro: r.erros[0], erros: r.erros });
      }
      return res.status(200).json({ ok: true, atualizado: false });
    } catch (e) {
      await comando(cred, ['HDEL', K.tel, tel.chave]).catch(() => {});
      throw e;
    }
  }

  return res.status(400).json({ erro: 'Ação desconhecida.' });
}

/* ── Painel ────────────────────────────────────────────────────────────── */

const COPIA = { versao: 1, hashes: ['familias', 'pessoas', 'tel', 'pre'], textos: ['bairros', 'regioes', 'nacionalidades'] };

const CAMPOS_PRE = {
  nome: 120, birthdate: 10, email: 120, gender: 20, nationality: 60, church_role: 20,
  address_1: 160, address_number: 20, address_2: 60, postal_code: 8, id_city: 80, neighborhood: 80, notas: 600,
};

const SEXOS_LIVRES = { m: 'Masculino', masculino: 'Masculino', f: 'Feminino', feminino: 'Feminino' };
const sexoLivre = (v) => (SEXOS.includes(v) ? v : SEXOS_LIVRES[String(v || '').trim().toLowerCase()] || '');

/** Uma linha do pré-cadastro, venha da planilha ou do botão Editar. */
function limparPre(l) {
  const nome = texto(l.nome, 120);
  if (!nome) return { erro: 'sem nome' };
  const t = normalizarLivre(l.telefone);
  if (t.erro) return { erro: t.erro + (l.telefone ? ' (' + texto(l.telefone, 30) + ')' : '') };
  const r = { telefone_chave: t.chave, phone_1: t.formatado };
  Object.keys(CAMPOS_PRE).forEach((c) => { r[c] = texto(l[c], CAMPOS_PRE[c]); });
  r.nome = nome;
  r.birthdate = normalizarData(l.birthdate);
  if (l.birthdate && !r.birthdate) r.aviso = 'data de nascimento ilegível: ' + texto(l.birthdate, 20);
  r.church_role = TIPOS.includes(r.church_role) ? r.church_role : '';
  r.gender = sexoLivre(r.gender);
  if (r.postal_code && !/^\d{4}-\d{3}$/.test(r.postal_code)) r.postal_code = '';
  Object.assign(r, moradaDe(enderecoCompleto(r)));
  return { registo: r };
}

/** Só os campos que o painel pode mandar para uma pessoa, e só os que vieram
 *  — o que não vier fica com o valor do pré-cadastro. */
function limparCampos(e) {
  const r = {};
  ['nome', 'nome_completo', 'telefone', 'birthdate', 'email', 'gender', 'nationality', 'church_role']
    .forEach((c) => { if (e[c] !== undefined && e[c] !== null) r[c] = e[c]; });
  if (r.nome_completo !== undefined && r.nome === undefined) r.nome = r.nome_completo;
  return r;
}

/** Uma pessoa criada ou corrigida pela equipa. Mais tolerante que o
 *  formulário (um filho pequeno pode ficar sem data, o titular completa),
 *  com uma exceção: quem tem telemóvel precisa de data — é com ela que vai
 *  entrar no censo. */
async function pessoaDaEquipa(cred, d, atual, rotulo) {
  const nome = texto(d.nome, 120);
  if (!nome) return { erro: 'Falta o nome de ' + rotulo + '.' };
  let tel = null;
  if (soDigitos(d.telefone)) {
    tel = normalizarLivre(d.telefone);
    if (tel.erro) return { erro: 'O telemóvel de ' + nome + ' não é válido (' + tel.erro + ').' };
  }
  const birthdate = d.birthdate ? normalizarData(d.birthdate) : '';
  if (d.birthdate && !birthdate) return { erro: 'A data de nascimento de ' + nome + ' não é válida.' };
  if (tel && !birthdate) return { erro: nome + ' tem telemóvel e por isso precisa de data de nascimento — é com ela que vai entrar no censo.' };
  const email = texto(d.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { erro: 'O e-mail de ' + nome + ' não é válido.' };
  if (tel) {
    const dono = await comando(cred, ['HGET', K.tel, tel.chave]);
    if (dono && (!atual || dono !== atual.id)) {
      const outro = await lerHash(cred, K.pessoas, dono);
      return { estado: 409, erro: 'O telemóvel ' + tel.formatado + ' já está no censo' + (outro ? ' (' + outro.nome_completo + ')' : '') + '. Usa "Mover" para a trazer para esta família.' };
    }
  }
  const partes = nome.split(' ');
  return {
    pessoa: {
      nome_completo: nome, first_name: partes[0], last_name: partes.slice(1).join(' '),
      birthdate, gender: sexoLivre(d.gender), nationality: texto(d.nationality, 60), email,
      church_role: TIPOS_OUTROS.includes(d.church_role) ? d.church_role : '',
      telefone_chave: tel ? tel.chave : '', phone_1: tel ? tel.formatado : '',
    },
  };
}

async function tratarAdmin(corpo, acao, res, cred) {
  if (!senhaEsperada()) return res.status(503).json({ erro: 'Painel fechado: falta definir a SENHA_ADMIN nas variáveis da Vercel.' });
  if (await excedeu(cred, 'rl:admin', 120, 60)) return res.status(429).json({ erro: 'Demasiados pedidos.' });
  if (!senhaCorreta(corpo.senha)) return res.status(401).json({ erro: 'Senha incorreta.' });

  if (acao === 'admin-listar') {
    const [familias, pessoas, pre] = await Promise.all([K.familias, K.pessoas, K.pre]
      .map(async (k) => valoresDoHash(await comando(cred, ['HGETALL', k]))));
    familias.sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)));
    pre.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt'));
    return res.status(200).json({ familias, pessoas, pre, bairros: await lerBairros(cred), regioes: await lerRegioes(cred), nacionalidades: await lerNacionalidades(cred) });
  }

  if (acao === 'admin-regioes') {
    // Regiões (cada uma com os seus bairros) + bairros sem região. A lista do
    // formulário é a junção, pela ordem: primeiro os das regiões, depois os soltos.
    const vistos = new Set();
    const limparLista = (l) => (Array.isArray(l) ? l : [])
      .map((b) => texto(b, 80))
      .filter((b) => b && !vistos.has(b.toLowerCase()) && vistos.add(b.toLowerCase()))
      .slice(0, 200);
    const nomes = new Set();
    const regioes = [];
    for (const r of (Array.isArray(corpo.regioes) ? corpo.regioes : []).slice(0, 30)) {
      const nome = texto(r && r.nome, 40);
      if (!nome) continue;
      if (nomes.has(nome.toLowerCase())) return res.status(400).json({ erro: 'Há duas regiões com o nome "' + nome + '".' });
      nomes.add(nome.toLowerCase());
      const cor = /^#[0-9a-f]{6}$/i.test(r.cor) ? r.cor : '#6b7280';
      regioes.push({ nome, cor, bairros: limparLista(r.bairros) });
    }
    const soltos = limparLista(corpo.soltos);
    const bairros = regioes.flatMap((r) => r.bairros).concat(soltos);
    if (!bairros.length) return res.status(400).json({ erro: 'É preciso pelo menos um bairro.' });
    await transacao(cred, [['SET', K.regioes, JSON.stringify(regioes)], ['SET', K.bairros, JSON.stringify(bairros)]]);
    return res.status(200).json({ ok: true, regioes, bairros });
  }

  if (acao === 'admin-nacionalidades') {
    const vistos = new Set();
    const lista = (Array.isArray(corpo.nacionalidades) ? corpo.nacionalidades : [])
      .map((n) => texto(n, 60))
      .filter((n) => n && n.toLowerCase() !== 'outra' && !vistos.has(n.toLowerCase()) && vistos.add(n.toLowerCase()))
      .slice(0, 100);
    if (!lista.length) return res.status(400).json({ erro: 'A lista precisa de pelo menos uma nacionalidade.' });
    await comando(cred, ['SET', K.nacionalidades, JSON.stringify(lista)]);
    return res.status(200).json({ ok: true, nacionalidades: lista });
  }

  if (acao === 'admin-localizar') {
    // Põe no mapa as famílias sem coordenadas, poucas de cada vez (o painel
    // repete o pedido até acabar): uma função da Vercel tem poucos segundos.
    // 1.º pelo código postal (geoapi.pt, com cache); sem ele, pela morada no
    // OpenStreetMap (Nominatim), que pede no máximo 1 pedido por segundo.
    const tentarDeNovo = corpo.tentar_de_novo === true;
    const so = Array.isArray(corpo.ids) ? new Set(corpo.ids.map(String)) : null;
    const familias = valoresDoHash(await comando(cred, ['HGETALL', K.familias]))
      .filter((f) => (!so || so.has(f.id)) && (f.lat == null || f.lon == null) && (tentarDeNovo || !f.geo_falhou));
    const lote = familias.slice(0, 4);
    const resultado = { localizadas: 0, falharam: 0, restantes: Math.max(0, familias.length - lote.length) };
    for (const f of lote) {
      const pos = await localizar(cred, f);
      const nova = Object.assign({}, f, pos
        ? { lat: pos.lat, lon: pos.lon, geo_fonte: pos.fonte, geo_falhou: false, freguesia: f.freguesia || pos.freguesia || '' }
        : { geo_falhou: true });
      await comando(cred, ['HSET', K.familias, f.id, JSON.stringify(nova)]);
      if (pos) resultado.localizadas++; else resultado.falharam++;
    }
    return res.status(200).json(resultado);
  }

  if (acao === 'admin-bairros') {
    const vistos = new Set();
    const lista = (Array.isArray(corpo.bairros) ? corpo.bairros : [])
      .map((b) => texto(b, 80))
      .filter((b) => b && !vistos.has(b.toLowerCase()) && vistos.add(b.toLowerCase()))
      .slice(0, 200);
    if (!lista.length) return res.status(400).json({ erro: 'A lista precisa de pelo menos um bairro.' });
    await comando(cred, ['SET', K.bairros, JSON.stringify(lista)]);
    return res.status(200).json({ ok: true, bairros: lista });
  }

  if (acao === 'admin-apagar-familia') {
    const id = texto(corpo.id, 20);
    const membros = await pessoasDaFamilia(cred, id);
    const cmds = [['HDEL', K.familias, id]];
    membros.forEach((p) => {
      cmds.push(['HDEL', K.pessoas, p.id]);
      if (p.telefone_chave) cmds.push(['HDEL', K.tel, p.telefone_chave]);
    });
    await transacao(cred, cmds);
    return res.status(200).json({ ok: true });
  }

  if (acao === 'admin-mover') {
    // Mudar alguém de família: um filho que casou e saiu de casa, ou duas
    // famílias que se cadastraram separadas e são uma só.
    const p = await lerHash(cred, K.pessoas, texto(corpo.pessoa, 20));
    if (!p) return res.status(404).json({ erro: 'Pessoa não encontrada.' });
    const papel = PARENTESCOS.includes(corpo.parentesco) ? corpo.parentesco : 'Outro';
    const agora = new Date().toISOString();
    const cmds = [];
    let destino = texto(corpo.destino, 20);
    if (destino === 'nova') {
      destino = novoId('f_');
      const origem = await lerHash(cred, K.familias, p.familia_id);
      cmds.push(['HSET', K.familias, destino, JSON.stringify(Object.assign({}, origem || {}, { id: destino, criado_em: agora, atualizado_em: agora, separada_de: p.familia_id }))]);
    } else if (!(await lerHash(cred, K.familias, destino))) {
      return res.status(404).json({ erro: 'Família de destino não encontrada.' });
    }
    const papelFinal = destino !== p.familia_id && corpo.destino === 'nova' ? 'Titular' : papel;
    const restantes = (await pessoasDaFamilia(cred, p.familia_id)).filter((x) => x.id !== p.id);
    cmds.push(['HSET', K.pessoas, p.id, JSON.stringify(Object.assign({}, p, {
      familia_id: destino, parentesco: papelFinal, is_family_admin: papelFinal === 'Titular' || papelFinal === 'Cônjuge', atualizado_em: agora,
    }))]);
    if (!restantes.length && destino !== p.familia_id) cmds.push(['HDEL', K.familias, p.familia_id]);
    else if (p.parentesco === 'Titular' && destino !== p.familia_id) {
      // A família de origem fica sem titular: sobe o cônjuge, ou o primeiro adulto.
      const novo = restantes.find((x) => x.parentesco === 'Cônjuge') || restantes.slice().sort((a, b) => String(a.birthdate).localeCompare(String(b.birthdate)))[0];
      cmds.push(['HSET', K.pessoas, novo.id, JSON.stringify(Object.assign({}, novo, { parentesco: 'Titular', is_family_admin: true, atualizado_em: agora }))]);
    }
    await transacao(cred, cmds);
    return res.status(200).json({ ok: true });
  }

  if (acao === 'admin-pre-editar') {
    const antiga = soDigitos(corpo.chave);
    const atual = await lerHash(cred, K.pre, antiga);
    if (!atual) return res.status(404).json({ erro: 'Essa pessoa já não está no pré-cadastro.' });
    const r = limparPre(corpo.dados || {});
    if (r.erro) return res.status(400).json({ erro: r.erro });
    if (r.registo.telefone_chave !== antiga && await comando(cred, ['HGET', K.pre, r.registo.telefone_chave])) {
      return res.status(409).json({ erro: 'Esse telemóvel já está noutra linha do pré-cadastro.' });
    }
    r.registo.importado_em = atual.importado_em;
    r.registo.editado_em = new Date().toISOString();
    const cmds = [['HSET', K.pre, r.registo.telefone_chave, JSON.stringify(r.registo)]];
    if (r.registo.telefone_chave !== antiga) cmds.unshift(['HDEL', K.pre, antiga]);
    await transacao(cred, cmds);
    return res.status(200).json({ ok: true, registo: r.registo });
  }

  if (acao === 'admin-criar-familia') {
    // A equipa junta pessoas do pré-cadastro (e filhos sem telemóvel) numa
    // família — nova, ou uma que já existe. Quando cada uma ler o QR, entra
    // com o número e a data, e encontra a família já montada.
    const entradas = Array.isArray(corpo.pessoas) ? corpo.pessoas.slice(0, 25) : [];
    if (!entradas.length) return res.status(400).json({ erro: 'Escolhe pelo menos uma pessoa.' });
    const agora = new Date().toISOString();
    let familiaId = texto(corpo.destino, 20);
    let familia = null;
    let existentes = [];
    if (familiaId && familiaId !== 'nova') {
      familia = await lerHash(cred, K.familias, familiaId);
      if (!familia) return res.status(404).json({ erro: 'Família não encontrada.' });
      existentes = await pessoasDaFamilia(cred, familiaId);
    } else {
      familiaId = novoId('f_');
    }

    const novas = [];
    const vistos = new Set();
    for (let i = 0; i < entradas.length; i++) {
      const e = entradas[i] || {};
      const base = e.chave ? await lerHash(cred, K.pre, soDigitos(e.chave)) : null;
      if (e.chave && !base) return res.status(404).json({ erro: 'Uma das pessoas já não está no pré-cadastro. Recarrega a página.' });
      const dados = Object.assign({}, base ? { nome: base.nome, telefone: base.phone_1, birthdate: base.birthdate, email: base.email, gender: base.gender, nationality: base.nationality, church_role: base.church_role } : {}, limparCampos(e));
      const v = await pessoaDaEquipa(cred, dados, null, (i + 1) + 'ª pessoa');
      if (v.erro) return res.status(v.estado || 400).json({ erro: v.erro });
      if (v.pessoa.telefone_chave) {
        if (vistos.has(v.pessoa.telefone_chave)) return res.status(400).json({ erro: 'O telemóvel de ' + v.pessoa.first_name + ' está repetido.' });
        vistos.add(v.pessoa.telefone_chave);
      }
      const papel = PARENTESCOS.includes(e.parentesco) ? e.parentesco : 'Filho(a)';
      novas.push(Object.assign(v.pessoa, {
        id: novoId('p_'), familia_id: familiaId, parentesco: papel, is_family_admin: papel === 'Titular' || papel === 'Cônjuge',
        criado_pela_equipa: true, veio_do_pre: !!base, criado_em: agora, atualizado_em: agora,
      }));
    }
    const titulares = existentes.concat(novas).filter((p) => p.parentesco === 'Titular').length;
    if (titulares !== 1) {
      return res.status(400).json({ erro: titulares ? 'A família só pode ter um titular.' : 'Escolhe quem é o titular da família.' });
    }
    if (existentes.concat(novas).filter((p) => p.parentesco === 'Cônjuge').length > 1) {
      return res.status(400).json({ erro: 'A família só pode ter um cônjuge.' });
    }

    const cmds = [];
    if (!familia) {
      // Morada da linha do pré-cadastro escolhida (normalmente a do titular).
      const fonte = corpo.morada_de ? await lerHash(cred, K.pre, soDigitos(corpo.morada_de)) : null;
      const f = Object.assign({}, fonte || {});
      if (corpo.bairro !== undefined) f.neighborhood = texto(corpo.bairro, 80);
      familia = Object.assign(moradaDe(enderecoCompleto(f)), {
        id: familiaId, neighborhood: f.neighborhood || '', freguesia: '',
        bairro_fora_lista: !!f.neighborhood && !(await lerBairros(cred)).includes(f.neighborhood),
        culto_no_lar: '', lat: null, lon: null,
        // Montada pela equipa: a família ainda não deu o consentimento dela.
        // Fica por confirmar até o titular ou o cônjuge entrar e marcar.
        gdpr_aceite: false, criado_pela_equipa: true, criado_em: agora, atualizado_em: agora,
      });
    } else {
      familia = Object.assign({}, familia, { atualizado_em: agora });
    }
    cmds.push(['HSET', K.familias, familiaId, JSON.stringify(familia)]);
    novas.forEach((p) => {
      cmds.push(['HSET', K.pessoas, p.id, JSON.stringify(p)]);
      if (p.telefone_chave) cmds.push(['HSET', K.tel, p.telefone_chave, p.id]);
    });
    await transacao(cred, cmds);
    return res.status(200).json({ ok: true, familia: familiaId });
  }

  if (acao === 'admin-editar-pessoa') {
    // Com `id`: corrige uma pessoa. Sem `id` e com `familia`: acrescenta.
    const agora = new Date().toISOString();
    const atual = corpo.id ? await lerHash(cred, K.pessoas, texto(corpo.id, 20)) : null;
    if (corpo.id && !atual) return res.status(404).json({ erro: 'Pessoa não encontrada.' });
    const familiaId = atual ? atual.familia_id : texto(corpo.familia, 20);
    if (!(await lerHash(cred, K.familias, familiaId))) return res.status(404).json({ erro: 'Família não encontrada.' });
    const v = await pessoaDaEquipa(cred, limparCampos(corpo.dados || {}), atual, 'esta pessoa');
    if (v.erro) return res.status(v.estado || 400).json({ erro: v.erro });
    const papel = PARENTESCOS.includes(corpo.dados && corpo.dados.parentesco) ? corpo.dados.parentesco : (atual ? atual.parentesco : 'Filho(a)');
    const membros = await pessoasDaFamilia(cred, familiaId);
    const cmds = [];
    // Novo titular: o anterior passa a cônjuge. Um cônjuge só.
    if (papel === 'Titular') {
      membros.filter((m) => m.parentesco === 'Titular' && (!atual || m.id !== atual.id)).forEach((m) => {
        cmds.push(['HSET', K.pessoas, m.id, JSON.stringify(Object.assign({}, m, { parentesco: 'Cônjuge', is_family_admin: true, atualizado_em: agora }))]);
      });
    }
    if (atual && atual.parentesco === 'Titular' && papel !== 'Titular') {
      return res.status(400).json({ erro: 'Para tirar o titular, escolhe primeiro outra pessoa como titular.' });
    }
    const conjuges = membros.filter((m) => m.parentesco === 'Cônjuge' && (!atual || m.id !== atual.id)).length
      + (papel === 'Cônjuge' ? 1 : 0) + (papel === 'Titular' ? membros.filter((m) => m.parentesco === 'Titular' && (!atual || m.id !== atual.id)).length : 0);
    if (conjuges > 1) return res.status(400).json({ erro: 'A família só pode ter um cônjuge.' });

    const p = Object.assign({}, atual || { id: novoId('p_'), criado_em: agora, criado_pela_equipa: true }, v.pessoa, {
      familia_id: familiaId, parentesco: papel, is_family_admin: papel === 'Titular' || papel === 'Cônjuge', atualizado_em: agora,
    });
    if (atual && atual.telefone_chave && atual.telefone_chave !== p.telefone_chave) cmds.push(['HDEL', K.tel, atual.telefone_chave]);
    cmds.push(['HSET', K.pessoas, p.id, JSON.stringify(p)]);
    if (p.telefone_chave) cmds.push(['HSET', K.tel, p.telefone_chave, p.id]);
    await transacao(cred, cmds);
    return res.status(200).json({ ok: true, id: p.id });
  }

  if (acao === 'admin-apagar-pessoa') {
    const p = await lerHash(cred, K.pessoas, texto(corpo.id, 20));
    if (!p) return res.status(404).json({ erro: 'Pessoa não encontrada.' });
    const restantes = (await pessoasDaFamilia(cred, p.familia_id)).filter((x) => x.id !== p.id);
    if (p.parentesco === 'Titular' && restantes.length) {
      return res.status(400).json({ erro: 'Escolhe primeiro outra pessoa como titular (Editar → Parentesco).' });
    }
    const cmds = [['HDEL', K.pessoas, p.id]];
    if (p.telefone_chave) cmds.push(['HDEL', K.tel, p.telefone_chave]);
    if (!restantes.length) cmds.push(['HDEL', K.familias, p.familia_id]);
    await transacao(cred, cmds);
    return res.status(200).json({ ok: true });
  }

  if (acao === 'admin-editar-familia') {
    const atual = await lerHash(cred, K.familias, texto(corpo.id, 20));
    if (!atual) return res.status(404).json({ erro: 'Família não encontrada.' });
    const d = corpo.dados || {};
    const bairro = texto(d.neighborhood, 80);
    if (!bairro) return res.status(400).json({ erro: 'Escolhe o bairro.' });
    const f = Object.assign({}, atual, moradaDe(enderecoCompleto(d)), {
      neighborhood: bairro,
      bairro_fora_lista: !(await lerBairros(cred)).includes(bairro),
      culto_no_lar: CULTO.includes(d.culto_no_lar) ? d.culto_no_lar : atual.culto_no_lar || '',
      atualizado_em: new Date().toISOString(),
    });
    if (posicaoMudou(atual, f)) Object.assign(f, SEM_POSICAO);
    await comando(cred, ['HSET', K.familias, f.id, JSON.stringify(f)]);
    return res.status(200).json({ ok: true });
  }

  if (acao === 'admin-copia') {
    // Tudo o que é do censo, num ficheiro: famílias, pessoas, índice de
    // telemóveis, pré-cadastro e listas. Os contadores e a cache ficam de fora.
    const dados = {};
    for (const k of COPIA.hashes) {
      const plano = await comando(cred, ['HGETALL', K[k]]);
      const obj = {};
      if (Array.isArray(plano)) for (let i = 0; i < plano.length; i += 2) obj[plano[i]] = k === 'tel' ? plano[i + 1] : jsonOuNulo(plano[i + 1]);
      dados[k] = obj;
    }
    for (const k of COPIA.textos) dados[k] = jsonOuNulo(await comando(cred, ['GET', K[k]]));
    return res.status(200).json({ censo_admvc: COPIA.versao, feita_em: new Date().toISOString(), dados });
  }

  if (acao === 'admin-restaurar') {
    // Substitui TUDO pelo conteúdo da cópia. Pede a palavra RESTAURAR para
    // ninguém o fazer sem querer.
    if (corpo.confirmar !== 'RESTAURAR') return res.status(400).json({ erro: 'Para restaurar, escreve RESTAURAR.' });
    const c = corpo.copia || {};
    const d = c.dados || {};
    if (c.censo_admvc !== COPIA.versao || COPIA.hashes.some((k) => d[k] && typeof d[k] !== 'object')) {
      return res.status(400).json({ erro: 'Este ficheiro não é uma cópia de segurança do censo.' });
    }
    const cmds = COPIA.hashes.map((k) => ['DEL', K[k]]);
    for (const k of COPIA.hashes) {
      Object.keys(d[k] || {}).forEach((campo) => {
        const v = d[k][campo];
        if (v == null) return;
        cmds.push(['HSET', K[k], String(campo), k === 'tel' ? String(v) : JSON.stringify(v)]);
      });
    }
    COPIA.textos.forEach((k) => cmds.push(Array.isArray(d[k]) ? ['SET', K[k], JSON.stringify(d[k])] : ['DEL', K[k]]));
    // Em blocos: o Upstash limita o tamanho de cada pedido.
    for (let i = 0; i < cmds.length; i += 250) await transacao(cred, cmds.slice(i, i + 250));
    const conta = (k) => Object.keys(d[k] || {}).length;
    return res.status(200).json({ ok: true, familias: conta('familias'), pessoas: conta('pessoas'), pre: conta('pre') });
  }

  if (acao === 'admin-pre-importar') {
    const linhas = Array.isArray(corpo.linhas) ? corpo.linhas.slice(0, LIMITE_PRE) : [];
    const atuais = await comando(cred, ['HLEN', K.pre]);
    const recusados = [];
    const vistos = new Set();
    const cmds = [];
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i] || {};
      const linha = l.linha || i + 1;
      const v = limparPre(l);
      if (v.erro) { recusados.push({ linha, motivo: v.erro }); continue; }
      const r = v.registo;
      if (vistos.has(r.telefone_chave)) { recusados.push({ linha, motivo: 'telemóvel repetido na lista (' + r.phone_1 + ')' }); continue; }
      if (atuais + cmds.length >= LIMITE_PRE) { recusados.push({ linha, motivo: 'limite do pré-cadastro atingido' }); continue; }
      vistos.add(r.telefone_chave);
      r.importado_em = new Date().toISOString();
      // HSET por cima: reimportar a planilha corrigida atualiza quem já lá está.
      cmds.push(['HSET', K.pre, r.telefone_chave, JSON.stringify(r)]);
    }
    for (let i = 0; i < cmds.length; i += 200) await transacao(cred, cmds.slice(i, i + 200));
    const comData = cmds.filter((c) => jsonOuNulo(c[3]).birthdate).length;
    return res.status(200).json({ ok: true, gravados: cmds.length, com_data: comData, recusados });
  }

  if (acao === 'admin-pre-apagar') {
    if (corpo.todos === true) {
      await comando(cred, ['DEL', K.pre]);
      return res.status(200).json({ ok: true });
    }
    const chave = soDigitos(corpo.chave);
    if (!chave) return res.status(400).json({ erro: 'Registo inválido.' });
    await comando(cred, ['HDEL', K.pre, chave]);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ erro: 'Ação desconhecida.' });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const cred = credenciais();
  try {
    if (req.method === 'GET') return await tratarGet(req, res, cred);
    if (req.method === 'POST') return await tratarPost(req, res, cred);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (e) {
    console.error('[censo]', e);
    return res.status(500).json({ erro: 'Falha ao falar com o armazenamento. Nada foi gravado — tenta outra vez.' });
  }
};

// Para os testes.
module.exports.validarTelefone = validarTelefone;
module.exports.normalizarLivre = normalizarLivre;
module.exports.normalizarData = normalizarData;
module.exports.enderecoCompleto = enderecoCompleto;
