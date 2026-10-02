// Fala com api/censo.js. Uma resposta de erro vira exceção com a mensagem que o
// servidor escreveu — é ela que aparece no ecrã, por isso o servidor escreve
// para quem está com o telemóvel na mão.

const URL_API = '/api/censo';

async function ler(resposta) {
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok || !corpo) {
    let mensagem = (corpo && corpo.erro) || 'Não foi possível falar com o servidor. Verifica a internet e tenta outra vez.';
    // As páginas vêm sempre na versão nova, mas um servidor local antigo
    // continua com a função antiga carregada — e não conhece as ações novas.
    if (mensagem === 'Ação desconhecida.') mensagem = 'O servidor está numa versão antiga e não conhece esta ação. É preciso reiniciá-lo.';
    const erro = new Error(mensagem);
    erro.erros = corpo && corpo.erros;
    erro.estado = resposta.status;
    throw erro;
  }
  return corpo;
}

export async function apiGet(parametros) {
  let resposta;
  try {
    resposta = await fetch(URL_API + '?' + new URLSearchParams(parametros), { cache: 'no-store' });
  } catch (e) {
    throw new Error('Sem ligação à internet. Tenta outra vez.');
  }
  return ler(resposta);
}

export async function api(acao, dados) {
  let resposta;
  try {
    resposta = await fetch(URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ acao: acao }, dados)),
    });
  } catch (e) {
    throw new Error('Sem ligação à internet. Nada foi enviado — tenta outra vez.');
  }
  return ler(resposta);
}
