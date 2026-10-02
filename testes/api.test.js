// node --test testes/*.test.js — corre a função da Vercel contra o Map em memória.
process.env.CENSO_MEMORIA = '1';
process.env.SENHA_ADMIN = 'segredo-teste';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../api/censo.js');

let ip = 0;
async function chamar(metodo, corpo, query) {
  const res = { codigo: 200, corpo: null };
  res.status = (c) => { res.codigo = c; return res; };
  res.json = (o) => { res.corpo = o; return res; };
  res.setHeader = () => {};
  // IP novo a cada pedido para o limite por IP não interferir nos testes.
  await api({ method: metodo, body: corpo, query: query || {}, headers: { 'x-forwarded-for': '10.0.' + (++ip % 250) + '.1' } }, res);
  return res;
}
const post = (corpo) => chamar('POST', corpo);
const SENHA = 'segredo-teste';
const painel = async () => (await post({ acao: 'admin-listar', senha: SENHA })).corpo;

const tel = (numero, pais = '351') => ({ pais, numero });
const FAMILIA = {
  postal_code: '3080-153', address_1: 'Rua Doutor Calado', address_number: '12', address_2: '',
  neighborhood: 'Buarcos', id_city: 'Figueira da Foz', culto_no_lar: 'Sim', gdpr_aceite: true,
};
const MARIA = {
  church_role: 'Membro', nome_completo: '  Maria   José Silva ', birthdate: '1985-04-12', gender: 'Feminino',
  nationality: 'Brasileira', email: '',
};
function envio(extra) {
  return Object.assign({
    acao: 'gravar', telefone: tel('912345678'), eu: MARIA, marital_status: 'Casado(a)',
    par: { nome_completo: 'João Silva', birthdate: '1983-01-20', church_role: 'Membro', telefone: tel('913000111') },
    filhos: [
      { nome_completo: 'Ana Silva', birthdate: '2015-06-01' },
      { nome_completo: 'Pedro Silva', birthdate: '2008-03-15', telefone: tel('936222333') },
    ],
    familia: FAMILIA,
  }, extra);
}

test('telemóvel: formatos aceites dão a mesma chave', () => {
  const v = api.validarTelefone;
  assert.equal(v({ pais: '351', numero: '+351 912 345 678' }).chave, '351912345678');
  assert.ok(v({ pais: '351', numero: '212345678' }).erro, 'fixo não passa');
  assert.equal(v({ pais: '55', numero: '(11) 91234-5678' }).formatado, '+55 11 91234-5678');
  const n = api.normalizarLivre;
  assert.equal(n('912 345 678').chave, '351912345678');
  assert.equal(n('(11) 91234-5678').chave, '5511912345678');
  assert.equal(n('+33 6 12 34 56 78').chave, v({ pais: '33', numero: '612345678' }).chave);
  assert.ok(n('981855989').erro, '98… não é telemóvel português');
});

test('datas de planilha portuguesa', () => {
  const d = api.normalizarData;
  assert.equal(d('12/04/1985'), '1985-04-12');
  assert.equal(d('2-3-1990'), '1990-03-02');
  assert.equal(d('12.04.85'), '1985-04-12');
  assert.equal(d('1985-04-12'), '1985-04-12');
  assert.equal(d('03/02/10'), '2010-02-03');
  assert.equal(d('31/02/1990'), '', 'dia que não existe');
  assert.equal(d('qualquer'), '');
});

test('família nova: titular, cônjuge e filhos viram pessoas ligadas', async () => {
  let r = await post({ acao: 'verificar', telefone: tel('912345678') });
  assert.equal(r.corpo.estado, 'novo');
  r = await post(envio());
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));

  const p = await painel();
  assert.equal(p.familias.length, 1);
  const fam = p.familias[0];
  const membros = p.pessoas.filter((x) => x.familia_id === fam.id);
  assert.equal(membros.length, 4);
  const papel = (n) => membros.find((x) => x.first_name === n);
  assert.equal(papel('Maria').parentesco, 'Titular');
  assert.equal(papel('Maria').is_family_admin, true);
  assert.equal(papel('Maria').nome_completo, 'Maria José Silva');
  assert.equal(papel('João').parentesco, 'Cônjuge');
  assert.equal(papel('João').is_family_admin, true);
  assert.equal(papel('João').phone_1, '+351 913 000 111');
  assert.equal(papel('Ana').parentesco, 'Filho(a)');
  assert.equal(papel('Ana').telefone_chave, '');
  assert.equal(papel('Pedro').is_family_admin, false);
  assert.equal(fam.address_1, 'Rua Doutor Calado, 12, 3080-153, Figueira da Foz', 'partes juntas num endereço só');
  assert.equal(fam.postal_code, '3080-153', 'código postal guardado à parte para o mapa');

  r = await post(envio());
  assert.equal(r.codigo, 403, 'sem data não reescreve');
});

test('cônjuge entra com o próprio número e edita a família', async () => {
  let r = await post({ acao: 'verificar', telefone: tel('913000111') });
  assert.equal(r.corpo.estado, 'registado');
  assert.equal(r.corpo.nome, 'Joã***');

  r = await post({ acao: 'abrir', telefone: tel('913000111'), prova: '1999-09-09' });
  assert.equal(r.codigo, 403);
  r = await post({ acao: 'abrir', telefone: tel('913000111'), prova: '1983-01-20' });
  assert.equal(r.corpo.modo, 'admin');
  assert.equal(r.corpo.pessoas.length, 4);
  const { pessoas } = r.corpo;
  // Foi cadastrado pela esposa só com nome e data: ao entrar ele próprio,
  // completa o que é obrigatório para quem preenche.
  const eu = { ...r.corpo.eu, gender: 'Masculino', nationality: 'Brasileira' };
  const titular = pessoas.find((x) => x.parentesco === 'Titular');
  const ana = pessoas.find((x) => x.first_name === 'Ana');

  // O cônjuge não pode retirar o titular.
  r = await post({
    acao: 'gravar', telefone: tel('913000111'), prova: '1983-01-20', eu, marital_status: 'Solteiro(a)',
    filhos: [], familia: FAMILIA,
  });
  assert.equal(r.codigo, 400);
  assert.match(r.corpo.erro, /titular/);

  // Acrescenta um filho e tira a Ana (sem telemóvel → apagada); o Pedro
  // (com telemóvel) sai do formulário → vai para uma família só dele.
  r = await post({
    acao: 'gravar', telefone: tel('913000111'), prova: '1983-01-20',
    eu: { ...eu, telefone: undefined }, marital_status: 'Casado(a)',
    par: { ...titular, telefone: tel('912345678') },
    filhos: [{ nome_completo: 'Bebé Silva', birthdate: '2025-01-01' }],
    familia: { ...FAMILIA, culto_no_lar: 'Talvez' },
  });
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  const p = await painel();
  const fam = p.familias.find((f) => f.id === eu.familia_id);
  assert.equal(fam.culto_no_lar, 'Talvez');
  const nomes = p.pessoas.filter((x) => x.familia_id === fam.id).map((x) => x.first_name).sort();
  assert.deepEqual(nomes, ['Bebé', 'João', 'Maria']);
  assert.ok(!p.pessoas.some((x) => x.id === ana.id), 'Ana sem telemóvel foi apagada');
  const pedro = p.pessoas.find((x) => x.first_name === 'Pedro');
  assert.notEqual(pedro.familia_id, fam.id, 'Pedro ficou numa família própria');
  assert.equal(pedro.parentesco, 'Titular');
});

test('filho com telemóvel próprio vê só o seu perfil e edita só os seus dados', async () => {
  // Família nova com um filho com número.
  await post(envio({ telefone: tel('961000001'), eu: { ...MARIA, nome_completo: 'Rosa Lima', birthdate: '1970-01-01' }, marital_status: 'Viúvo(a)', par: null,
    filhos: [{ nome_completo: 'Tiago Lima', birthdate: '2004-05-05', telefone: tel('961000002') }] }));

  let r = await post({ acao: 'abrir', telefone: tel('961000002'), prova: '2004-05-05' });
  assert.equal(r.corpo.modo, 'proprio');
  assert.equal(r.corpo.eu.first_name, 'Tiago');
  assert.deepEqual(r.corpo.membros, [{ nome: 'Rosa Lima', parentesco: 'Titular' }]);
  assert.equal(r.corpo.pessoas, undefined, 'não recebe os dados dos outros');

  r = await post({
    acao: 'gravar', telefone: tel('961000002'), prova: '2004-05-05',
    eu: { nome_completo: 'Tiago Lima Santos', birthdate: '2004-05-05', church_role: 'Membro', gender: 'Masculino', nationality: 'Portuguesa', email: 'tiago@exemplo.pt' },
    gdpr_aceite: true,
    familia: { ...FAMILIA, address_1: 'Tentativa de mudar a morada' },
  });
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  const p = await painel();
  const tiago = p.pessoas.find((x) => x.first_name === 'Tiago');
  assert.equal(tiago.nome_completo, 'Tiago Lima Santos');
  assert.equal(tiago.email, 'tiago@exemplo.pt');
  assert.equal(tiago.parentesco, 'Filho(a)', 'não muda o próprio parentesco');
  const fam = p.familias.find((f) => f.id === tiago.familia_id);
  assert.equal(fam.address_1, 'Rua Doutor Calado, 12, 3080-153, Figueira da Foz', 'filho não mexe na morada da família');
});

test('ligar quem já tem cadastro exige a data de nascimento dessa pessoa', async () => {
  // O Lucas cadastra-se sozinho primeiro.
  await post(envio({ telefone: tel('962000001'), eu: { ...MARIA, nome_completo: 'Lucas Prado', birthdate: '2001-02-02' }, marital_status: 'Solteiro(a)', par: null, filhos: [] }));
  const antes = (await painel()).familias.length;

  // A mãe tenta pô-lo como filho com a data errada.
  const mae = envio({ telefone: tel('962000009'), eu: { ...MARIA, nome_completo: 'Clara Prado', birthdate: '1975-07-07' }, marital_status: 'Divorciado(a)', par: null,
    filhos: [{ nome_completo: 'Lucas', birthdate: '2001-12-12', telefone: tel('962000001') }] });
  let r = await post(mae);
  assert.equal(r.codigo, 409);
  assert.match(r.corpo.erro, /data de nascimento não confere/);
  r = await post({ acao: 'verificar', telefone: tel('962000009') });
  assert.equal(r.corpo.estado, 'novo', 'o envio recusado não deixou o número da mãe preso');

  // Com a data certa, o Lucas muda de casa e a família dele (vazia) desaparece.
  mae.filhos[0].birthdate = '2001-02-02';
  r = await post(mae);
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  const p = await painel();
  const lucas = p.pessoas.find((x) => x.first_name === 'Lucas');
  const clara = p.pessoas.find((x) => x.first_name === 'Clara');
  assert.equal(lucas.familia_id, clara.familia_id);
  assert.equal(lucas.parentesco, 'Filho(a)');
  assert.equal(lucas.nome_completo, 'Lucas Prado', 'mantém o nome que ele próprio escreveu');
  assert.equal(p.familias.length, antes, 'família do Lucas apagada, a da Clara criada');
});

test('pré-cadastro: data confere → dados; não confere → formulário vazio e aviso', async () => {
  let r = await post({ acao: 'admin-pre-importar', senha: SENHA, linhas: [
    { linha: 2, nome: 'Beatriz Nunes Costa', telefone: '921 111 222', birthdate: '03/02/1990', address_1: 'Av. Saraiva de Carvalho 10', id_city: 'Figueira da Foz', neighborhood: 'Centro da Figueira', notas: 'líder de louvor' },
    { linha: 3, nome: 'Repetida', telefone: '+351921111222' },
    { linha: 4, nome: 'Sem Data', telefone: '921 333 444' },
    { linha: 5, nome: 'Inválido', telefone: '981855989' },
    { linha: 6, nome: 'Data Torta', telefone: '921 555 666', birthdate: '1990/99/99' },
  ] });
  assert.equal(r.corpo.gravados, 3);
  assert.equal(r.corpo.com_data, 1);
  assert.deepEqual(r.corpo.recusados.map((x) => x.linha), [3, 5]);

  r = await post({ acao: 'verificar', telefone: tel('921111222') });
  assert.equal(r.corpo.estado, 'pre_data');
  assert.equal(JSON.stringify(r.corpo).includes('Beatriz'), false, 'nem o nome antes da data');

  r = await post({ acao: 'abrir', telefone: tel('921111222'), prova: '1990-02-04' });
  assert.equal(r.codigo, 403);
  assert.equal(r.corpo.pre_falhou, true);
  assert.equal(JSON.stringify(r.corpo).includes('Saraiva'), false);

  r = await post({ acao: 'abrir', telefone: tel('921111222'), prova: '1990-02-03' });
  assert.equal(r.corpo.modo, 'pre');
  assert.equal(r.corpo.pre.nome, 'Beatriz Nunes Costa');
  assert.equal(r.corpo.pre.address_1, 'Av. Saraiva de Carvalho 10, Figueira da Foz');
  assert.equal(r.corpo.pre.notas, undefined, 'notas da equipa nunca saem');

  r = await post({ acao: 'verificar', telefone: tel('921333444') });
  assert.deepEqual([r.corpo.estado, r.corpo.primeiro_nome], ['pre', 'Sem']);

  // Quem falhou a data e preencheu tudo à mão fica marcado para a equipa.
  r = await post(envio({ telefone: tel('921111222'), eu: { ...MARIA, nome_completo: 'Beatriz Costa', birthdate: '1991-01-01' }, marital_status: 'Solteiro(a)', par: null, filhos: [] }));
  assert.equal(r.codigo, 200);
  const bia = (await painel()).pessoas.find((x) => x.first_name === 'Beatriz');
  assert.equal(bia.veio_do_pre, true);
  assert.equal(bia.data_diferente_pre, true);

  const p = await painel();
  assert.ok(p.pre.find((x) => x.nome === 'Data Torta').aviso.includes('ilegível'));
});

test('equipa: editar pré-cadastro, montar família, editar pessoas e morada', async () => {
  await post({ acao: 'admin-pre-importar', senha: SENHA, linhas: [
    { nome: 'Paulo Reis', telefone: '931000001', birthdate: '10/10/1970', address_1: 'Rua das Flores', address_number: '3', id_city: 'Figueira da Foz', neighborhood: 'Tavarede' },
    { nome: 'Sara Reis', telefone: '931000002' },
    { nome: 'Rui Reis', telefone: '931000003', birthdate: '01/01/2005' },
  ] });

  // Editar a linha da Sara: corrige o nome e põe a data.
  let r = await post({ acao: 'admin-pre-editar', senha: SENHA, chave: '351931000002', dados: { nome: 'Sara Lopes Reis', telefone: '931000002', birthdate: '1972-02-02' } });
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.registo.nome, 'Sara Lopes Reis');
  assert.equal(r.corpo.registo.birthdate, '1972-02-02');

  // Quem tem telemóvel precisa de data.
  const montar = (pessoas) => post({ acao: 'admin-criar-familia', senha: SENHA, destino: 'nova', morada_de: '351931000001', pessoas });
  r = await montar([{ chave: '351931000001', parentesco: 'Titular' }, { chave: '351931000003', parentesco: 'Filho(a)', birthdate: '' }]);
  assert.equal(r.codigo, 400);
  assert.match(r.corpo.erro, /precisa de data/);
  r = await montar([{ chave: '351931000001', parentesco: 'Filho(a)' }]);
  assert.match(r.corpo.erro, /titular/);

  // Família: Paulo titular, Sara cônjuge, Rui filho, e a Lia (sem telemóvel, sem data).
  r = await montar([
    { chave: '351931000001', parentesco: 'Titular' },
    { chave: '351931000002', parentesco: 'Cônjuge' },
    { chave: '351931000003', parentesco: 'Filho(a)' },
    { nome: 'Lia Reis', parentesco: 'Filho(a)', birthdate: '' },
  ]);
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  const famId = r.corpo.familia;
  let p = await painel();
  const fam = p.familias.find((f) => f.id === famId);
  assert.equal(fam.address_1, 'Rua das Flores, 3, Figueira da Foz', 'morada da linha do titular');
  assert.equal(fam.gdpr_aceite, false, 'consentimento por confirmar');
  const membros = p.pessoas.filter((x) => x.familia_id === famId);
  assert.equal(membros.length, 4);
  assert.equal(membros.find((x) => x.first_name === 'Sara').nome_completo, 'Sara Lopes Reis');

  // Já no censo: montar de novo com o mesmo telemóvel é recusado.
  r = await montar([{ chave: '351931000001', parentesco: 'Titular' }]);
  assert.equal(r.codigo, 409);

  // O Paulo lê o QR: entra com a data e abre a família montada pela equipa.
  r = await post({ acao: 'verificar', telefone: tel('931000001') });
  assert.equal(r.corpo.estado, 'registado');
  r = await post({ acao: 'abrir', telefone: tel('931000001'), prova: '1970-10-10' });
  assert.equal(r.corpo.modo, 'admin');
  assert.equal(r.corpo.pessoas.length, 4);
  assert.equal(r.corpo.familia.gdpr_aceite, false);
  // O Rui (filho) entra com a data que estava na planilha.
  r = await post({ acao: 'abrir', telefone: tel('931000003'), prova: '2005-01-01' });
  assert.equal(r.corpo.modo, 'proprio');

  // Editar: a Sara passa a titular → o Paulo passa a cônjuge.
  const sara = membros.find((x) => x.first_name === 'Sara');
  r = await post({ acao: 'admin-editar-pessoa', senha: SENHA, id: sara.id, dados: { nome: 'Sara Lopes Reis', telefone: '+351 931 000 002', birthdate: '1972-02-02', parentesco: 'Titular' } });
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  p = await painel();
  assert.equal(p.pessoas.find((x) => x.first_name === 'Paulo').parentesco, 'Cônjuge');
  assert.equal(p.pessoas.find((x) => x.first_name === 'Sara').parentesco, 'Titular');

  // Telemóvel de outra pessoa do censo: recusado.
  const lia = membros.find((x) => x.first_name === 'Lia');
  r = await post({ acao: 'admin-editar-pessoa', senha: SENHA, id: lia.id, dados: { nome: 'Lia Reis', telefone: '931000003', birthdate: '2012-01-01' } });
  assert.equal(r.codigo, 409);
  // Acrescentar uma pessoa e apagar.
  r = await post({ acao: 'admin-editar-pessoa', senha: SENHA, familia: famId, dados: { nome: 'Avó Reis', parentesco: 'Outro' } });
  assert.equal(r.codigo, 200);
  r = await post({ acao: 'admin-apagar-pessoa', senha: SENHA, id: r.corpo.id });
  assert.equal(r.codigo, 200);
  r = await post({ acao: 'admin-apagar-pessoa', senha: SENHA, id: sara.id });
  assert.equal(r.codigo, 400, 'não apaga o titular com mais gente na família');

  // Morada.
  r = await post({ acao: 'admin-editar-familia', senha: SENHA, id: famId, dados: { address_1: 'Rua Nova', address_number: '7', postal_code: '3080-153', id_city: 'Figueira da Foz', neighborhood: 'Buarcos', culto_no_lar: 'Sim' } });
  assert.equal(r.codigo, 200);
  p = await painel();
  const f2 = p.familias.find((f) => f.id === famId);
  assert.deepEqual([f2.address_1, f2.neighborhood, f2.culto_no_lar, f2.postal_code], ['Rua Nova, 7, 3080-153, Figueira da Foz', 'Buarcos', 'Sim', '3080-153']);

  // Quando o titular grava pelo formulário, o consentimento fica dado.
  r = await post({ acao: 'abrir', telefone: tel('931000002'), prova: '1972-02-02' });
  const v = r.corpo;
  const outros = v.pessoas.filter((x) => x.id !== v.eu.id);
  r = await post({
    acao: 'gravar', telefone: tel('931000002'), prova: '1972-02-02',
    eu: { ...v.eu, church_role: 'Membro', gender: 'Feminino', nationality: 'Portuguesa' }, marital_status: 'Casado(a)',
    par: { ...outros.find((x) => x.parentesco === 'Cônjuge'), telefone: tel('931000001') },
    filhos: outros.filter((x) => x.parentesco === 'Filho(a)').map((x) => ({ ...x, birthdate: x.birthdate || '2012-01-01', telefone: x.telefone_chave ? tel(x.telefone_chave.slice(3)) : null })),
    familia: { ...f2, gdpr_aceite: true },
  });
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  p = await painel();
  assert.equal(p.familias.find((f) => f.id === famId).gdpr_aceite, true);
  assert.equal(p.pessoas.filter((x) => x.familia_id === famId).length, 4, 'ninguém se perdeu ao gravar');
});

test('regiões: padrão, gravar, e o formulário usa os bairros delas', async () => {
  let p = await painel();
  assert.ok(p.regioes.length >= 3, 'regiões iniciais');
  assert.ok(p.regioes.some((r) => r.bairros.includes('Buarcos')));

  let r = await post({ acao: 'admin-regioes', senha: SENHA, regioes: [
    { nome: 'Norte', cor: '#3b82f6', bairros: ['Buarcos', 'Quiaios', ''] },
    { nome: 'Sul', cor: 'vermelho', bairros: ['Lavos', 'buarcos'] },
  ], soltos: ['Coimbra'] });
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.regioes[1], { nome: 'Sul', cor: '#6b7280', bairros: ['Lavos'] }, 'cor inválida e bairro repetido limpos');
  assert.deepEqual(r.corpo.bairros, ['Buarcos', 'Quiaios', 'Lavos', 'Coimbra']);
  r = await chamar('GET', null, { acao: 'config' });
  assert.deepEqual(r.corpo.bairros, ['Buarcos', 'Quiaios', 'Lavos', 'Coimbra']);
  r = await post({ acao: 'admin-regioes', senha: SENHA, regioes: [{ nome: 'A', bairros: ['x'] }, { nome: 'a', bairros: ['y'] }] });
  assert.equal(r.codigo, 400, 'nomes repetidos');

  // Localizar: uma família sem morada nenhuma não chega a ir à internet e
  // fica marcada como "não foi possível".
  r = await post({ acao: 'admin-criar-familia', senha: SENHA, destino: 'nova', pessoas: [{ nome: 'Sem Morada', parentesco: 'Titular' }] });
  const famId = r.corpo.familia;
  r = await post({ acao: 'admin-localizar', senha: SENHA, ids: [famId] });
  assert.equal(r.codigo, 200);
  p = await painel();
  const fam = p.familias.find((f) => f.id === famId);
  assert.equal(fam.geo_falhou, true);
  r = await post({ acao: 'admin-localizar', senha: SENHA, ids: [famId] });
  assert.equal(r.corpo.localizadas + r.corpo.falharam, 0, 'não insiste nas que já falharam');
  r = await post({ acao: 'admin-editar-familia', senha: SENHA, id: famId, dados: { address_1: 'Rua Nova, Figueira da Foz', neighborhood: 'Buarcos' } });
  p = await painel();
  assert.equal(p.familias.find((f) => f.id === famId).geo_falhou, false, 'morada corrigida volta a poder ser localizada');
  await post({ acao: 'admin-apagar-familia', senha: SENHA, id: famId });
  await post({ acao: 'admin-regioes', senha: SENHA, regioes: [{ nome: 'Tudo', cor: '#2fb65a', bairros: ['Buarcos', 'Tavarede', 'Centro da Figueira'] }], soltos: [] });
});

test('nacionalidades editáveis e bairro escolhido ao criar família', async () => {
  let r = await chamar('GET', null, { acao: 'config' });
  assert.ok(r.corpo.nacionalidades.includes('Brasileira'), 'lista padrão');
  r = await post({ acao: 'admin-nacionalidades', senha: SENHA, nacionalidades: ['Portuguesa', 'Brasileira', ' brasileira ', 'Outra', '', 'Nepalesa'] });
  assert.deepEqual(r.corpo.nacionalidades, ['Portuguesa', 'Brasileira', 'Nepalesa'], 'sem repetidas, vazias nem "Outra"');
  r = await chamar('GET', null, { acao: 'config' });
  assert.deepEqual(r.corpo.nacionalidades, ['Portuguesa', 'Brasileira', 'Nepalesa']);
  r = await post({ acao: 'admin-nacionalidades', senha: SENHA, nacionalidades: [] });
  assert.equal(r.codigo, 400);

  await post({ acao: 'admin-pre-importar', senha: SENHA, linhas: [{ nome: 'Teresa Bairro', telefone: '931200001', birthdate: '01/01/1960', address_1: 'Rua A', neighborhood: 'Buarcos' }] });
  r = await post({ acao: 'admin-criar-familia', senha: SENHA, destino: 'nova', morada_de: '351931200001', bairro: 'Tavarede', pessoas: [{ chave: '351931200001', parentesco: 'Titular' }] });
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  const p = await painel();
  const fam = p.familias.find((f) => f.id === r.corpo.familia);
  assert.deepEqual([fam.address_1, fam.neighborhood], ['Rua A', 'Tavarede'], 'morada da linha, bairro escolhido no painel');
  await post({ acao: 'admin-apagar-familia', senha: SENHA, id: fam.id });
});

test('morada: só o bairro é obrigatório; endereço num campo só', async () => {
  const j = api.enderecoCompleto;
  assert.equal(j({ address_1: 'Rua A 5', address_number: '5', id_city: 'Buarcos' }), 'Rua A 5, Buarcos', 'não repete o que já está na rua');
  assert.equal(j({ address_1: '', postal_code: '3080-153' }), '3080-153');

  const base = envio({ telefone: tel('968000001'), par: null, marital_status: 'Solteiro(a)', filhos: [] });
  let r = await post({ ...base, familia: { neighborhood: 'Buarcos', culto_no_lar: 'Não', gdpr_aceite: true } });
  assert.equal(r.codigo, 200, 'sem endereço nenhum passa: ' + JSON.stringify(r.corpo));
  r = await post({ ...envio({ telefone: tel('968000002'), par: null, marital_status: 'Solteiro(a)', filhos: [] }),
    familia: { address_1: 'Rua do Sol 4, 2º Dto, 3080 - 299 Figueira da Foz', culto_no_lar: 'Não', gdpr_aceite: true } });
  assert.equal(r.codigo, 400);
  assert.match(r.corpo.erro, /bairro/);
  r = await post({ ...envio({ telefone: tel('968000002'), par: null, marital_status: 'Solteiro(a)', filhos: [] }),
    familia: { address_1: 'Rua do Sol 4, 2º Dto, 3080 - 299 Figueira da Foz', neighborhood: 'Tavarede', culto_no_lar: 'Não', gdpr_aceite: true } });
  assert.equal(r.codigo, 200);
  const p = await painel();
  const dono = p.pessoas.find((x) => x.telefone_chave === '351968000002');
  const fam = p.familias.find((f) => f.id === dono.familia_id);
  assert.equal(fam.postal_code, '3080-299', 'código postal tirado do meio do endereço');

  // Gravar outra vez sem mudar a morada mantém a posição no mapa.
  await post({ acao: 'admin-editar-familia', senha: SENHA, id: fam.id, dados: { address_1: fam.address_1, neighborhood: 'Tavarede', culto_no_lar: 'Sim' } });
  let f2 = (await painel()).familias.find((f) => f.id === fam.id);
  assert.equal(f2.culto_no_lar, 'Sim');
  r = await post({ acao: 'admin-editar-familia', senha: SENHA, id: fam.id, dados: { address_1: 'Outra rua', neighborhood: '' } });
  assert.equal(r.codigo, 400, 'painel também exige bairro');
});

test('cópia de segurança e restauro devolvem tudo como estava', async () => {
  const antes = await painel();
  const copia = (await post({ acao: 'admin-copia', senha: SENHA })).corpo;
  assert.equal(copia.censo_admvc, 1);
  assert.equal(Object.keys(copia.dados.familias).length, antes.familias.length);

  // Estraga: apaga uma família e o pré-cadastro.
  await post({ acao: 'admin-apagar-familia', senha: SENHA, id: antes.familias[0].id });
  await post({ acao: 'admin-pre-apagar', senha: SENHA, todos: true });

  let r = await post({ acao: 'admin-restaurar', senha: SENHA, copia });
  assert.equal(r.codigo, 400, 'sem a palavra RESTAURAR não faz nada');
  r = await post({ acao: 'admin-restaurar', senha: SENHA, copia: { censo_admvc: 1, dados: { familias: 'lixo' } }, confirmar: 'RESTAURAR' });
  assert.equal(r.codigo, 400, 'ficheiro inválido recusado');
  r = await post({ acao: 'admin-restaurar', senha: SENHA, copia, confirmar: 'RESTAURAR' });
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));

  const depois = await painel();
  const ordena = (l, k) => l.map((x) => x[k]).sort();
  assert.deepEqual(ordena(depois.familias, 'id'), ordena(antes.familias, 'id'));
  assert.deepEqual(ordena(depois.pessoas, 'id'), ordena(antes.pessoas, 'id'));
  assert.equal(depois.pre.length, antes.pre.length);
  assert.deepEqual(depois.regioes, antes.regioes);
  // O índice de telemóveis também voltou: quem tem número entra outra vez.
  const comTel = antes.pessoas.find((x) => x.telefone_chave && x.birthdate);
  r = await post({ acao: 'verificar', telefone: tel(comTel.telefone_chave.slice(3)) });
  assert.equal(r.corpo.estado, 'registado');
});

test('na Vercel, sem SENHA_ADMIN o painel fica fechado', async () => {
  const guardada = process.env.SENHA_ADMIN;
  process.env.VERCEL = '1';
  delete process.env.SENHA_ADMIN;
  try {
    let r = await post({ acao: 'admin-listar', senha: 'admin123' });
    assert.equal(r.codigo, 503);
    assert.match(r.corpo.erro, /SENHA_ADMIN/);
    r = await post({ acao: 'admin-listar', senha: '' });
    assert.equal(r.codigo, 503);
  } finally {
    delete process.env.VERCEL;
    process.env.SENHA_ADMIN = guardada;
  }
});

test('validação recusa o que falta', async () => {
  const base = envio({ telefone: tel('969000000') });
  let r = await post({ ...base, familia: { ...FAMILIA, gdpr_aceite: false } });
  assert.match(r.corpo.erro + r.corpo.erros, /autorizar/);
  r = await post({ ...base, eu: { ...MARIA, nome_completo: 'Maria' } });
  assert.match(r.corpo.erro, /nome completo/);
  r = await post({ ...base, filhos: [{ nome_completo: 'Sem Data' }] });
  assert.match(r.corpo.erros.join(' '), /1º filho/);
  r = await post({ ...base, par: { ...base.par, telefone: tel('969000000') } });
  assert.match(r.corpo.erro, /repetido/);
  r = await post({ acao: 'verificar', telefone: tel('969000000') });
  assert.equal(r.corpo.estado, 'novo', 'envios recusados não reservam o número');
});

test('painel: mover pessoa, apagar família, bairros', async () => {
  let r = await post({ acao: 'admin-listar', senha: 'errada' });
  assert.equal(r.codigo, 401);
  let p = await painel();
  const joao = p.pessoas.find((x) => x.first_name === 'João');
  const maria = p.pessoas.find((x) => x.first_name === 'Maria');

  // A Maria (titular) muda-se para uma família nova: o João sobe a titular.
  r = await post({ acao: 'admin-mover', senha: SENHA, pessoa: maria.id, destino: 'nova' });
  assert.equal(r.codigo, 200);
  p = await painel();
  assert.equal(p.pessoas.find((x) => x.id === joao.id).parentesco, 'Titular');
  const mariaDepois = p.pessoas.find((x) => x.id === maria.id);
  assert.notEqual(mariaDepois.familia_id, joao.familia_id);

  // Volta para a família do João como cônjuge.
  r = await post({ acao: 'admin-mover', senha: SENHA, pessoa: maria.id, destino: joao.familia_id, parentesco: 'Cônjuge' });
  p = await painel();
  assert.equal(p.pessoas.find((x) => x.id === maria.id).familia_id, joao.familia_id);
  assert.ok(!p.familias.some((f) => f.id === mariaDepois.familia_id), 'a família vazia foi apagada');

  r = await post({ acao: 'admin-apagar-familia', senha: SENHA, id: joao.familia_id });
  p = await painel();
  assert.ok(!p.pessoas.some((x) => x.familia_id === joao.familia_id));
  r = await post({ acao: 'verificar', telefone: tel('913000111') });
  assert.equal(r.corpo.estado, 'novo', 'apagar a família liberta os telemóveis');

  r = await post({ acao: 'admin-bairros', senha: SENHA, bairros: ['Buarcos', ' buarcos ', '', 'Tavarede'] });
  assert.deepEqual(r.corpo.bairros, ['Buarcos', 'Tavarede']);
});
