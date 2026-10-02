// Espelho de validarTelefone em api/censo.js — os dois andam juntos. Aqui só
// serve para dar o erro sem esperar pela rede; quem decide é o servidor.

const REGRAS = {
  '351': /^9[1236]\d{7}$/,
  '55': /^[1-9]{2}9\d{8}$/,
  '244': /^9\d{8}$/,
  '238': /^[59]\d{6}$/,
};

export function validarTelefone(pais, numeroDigitado) {
  pais = String(pais || '').replace(/\D+/g, '');
  let numero = String(numeroDigitado || '').replace(/\D+/g, '').replace(/^00/, '');
  if (!/^[1-9]\d{0,3}$/.test(pais)) return { erro: 'Escolhe o indicativo do país.' };
  const regra = REGRAS[pais] || /^\d{6,14}$/;
  if (!regra.test(numero) && numero.startsWith(pais) && regra.test(numero.slice(pais.length))) {
    numero = numero.slice(pais.length);
  }
  if (!numero) return { erro: 'Escreve o teu número de telemóvel.' };
  if (!regra.test(numero)) {
    return { erro: pais === '351'
      ? 'Um telemóvel português tem 9 dígitos e começa por 9.'
      : 'Este número de telemóvel não parece válido.' };
  }
  return { pais: pais, numero: numero };
}
