// Listas fixas do formulário. Os valores de TIPOS, SEXOS, ESTADOS_CIVIS e CULTO
// são conferidos em api/censo.js — mudar aqui obriga a mudar lá.

// Quem atende as dúvidas do censo (equipa da mídia). O link abre o WhatsApp
// direto nesta conversa.
export const MIDIA = { numero: '351924005955', formatado: '+351 924 005 955' };

export const PAISES = [
  { cod: '351', nome: 'Portugal', bandeira: '🇵🇹', exemplo: '912 345 678' },
  { cod: '55', nome: 'Brasil', bandeira: '🇧🇷', exemplo: '11 91234 5678' },
  { cod: '244', nome: 'Angola', bandeira: '🇦🇴', exemplo: '923 456 789' },
  { cod: '238', nome: 'Cabo Verde', bandeira: '🇨🇻', exemplo: '991 2345' },
  { cod: '', nome: 'Outro', bandeira: '🌍', exemplo: 'número' },
];

export const TIPOS = ['Membro', 'Congregado', 'Visitante'];
export const TIPOS_OUTROS = TIPOS.concat('Não frequenta');
export const SEXOS = ['Masculino', 'Feminino'];
export const ESTADOS_CIVIS = ['Solteiro(a)', 'Casado(a)', 'União de facto', 'Divorciado(a)', 'Viúvo(a)'];
export const COM_CONJUGE = ['Casado(a)', 'União de facto'];
export const CULTO = ['Sim', 'Talvez', 'Não'];

export const NACIONALIDADES = [
  'Brasileira', 'Portuguesa', 'Angolana', 'Cabo-verdiana', 'Guineense',
  'Moçambicana', 'São-tomense', 'Venezuelana', 'Ucraniana',
];
export const OUTRA = 'Outra';
export const OUTRO_BAIRRO = '__outro__';
