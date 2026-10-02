// Servidor de desenvolvimento: `node servidor-local.js` e abrir
// http://localhost:3000. Serve a pasta como a Vercel e passa /api/censo
// à mesma função que corre em produção, com as variáveis do `.env.local`.
//
// Sem dependências e sem `vercel dev` (que pede login e conta). Não vai para
// produção: a Vercel só executa o que está em `api/`.

const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const PORTA = Number(process.env.PORT) || 3000;

// .env.local → process.env, sem sobrescrever o que já veio do shell.
try {
  fs.readFileSync(path.join(RAIZ, '.env.local'), 'utf8').split(/\r?\n/).forEach((linha) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  });
} catch (e) { /* sem .env.local: a API responde armazenamento:false */ }

// Em modo memória, guarda tudo num ficheiro para reiniciar sem perder dados.
if (process.env.CENSO_MEMORIA === '1' && !process.env.CENSO_MEMORIA_FICHEIRO) {
  process.env.CENSO_MEMORIA_FICHEIRO = path.join(RAIZ, '.censo-memoria.json');
}

const api = require('./api/censo.js');
const vercel = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

function comoVercel(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
  res.send = (b) => { res.end(b); return res; };
  return res;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/censo') {
    const partes = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => {
      req.query = Object.fromEntries(url.searchParams);
      const texto = Buffer.concat(partes).toString('utf8');
      if (texto) { try { req.body = JSON.parse(texto); } catch (e) { req.body = texto; } }
      Promise.resolve(api(req, comoVercel(res))).catch((e) => {
        console.error(e); res.statusCode = 500; res.end(String(e));
      });
    });
    return;
  }

  let caminho = decodeURIComponent(url.pathname);
  const rw = (vercel.rewrites || []).find((r) => r.source === caminho);
  if (rw) caminho = rw.destination;
  if (caminho.endsWith('/')) caminho += 'index.html';
  const arquivo = path.join(RAIZ, path.normalize(caminho));
  if (!arquivo.startsWith(RAIZ)) { res.statusCode = 403; return res.end(); }

  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) { res.statusCode = 404; return res.end('404'); }
    res.setHeader('Content-Type', TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(conteudo);
  });
}).listen(PORTA, () => {
  console.log('Censo da Família ADMVC em http://localhost:' + PORTA +
    (process.env.CENSO_MEMORIA === '1' ? '  (sem Upstash: dados em ' + path.basename(process.env.CENSO_MEMORIA_FICHEIRO) + ')'
      : process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
        ? '  (com Upstash' + (process.env.CENSO_PREFIXO ? ', prefixo ' + process.env.CENSO_PREFIXO : '') + ')'
        : '  (sem Upstash: o envio vai falhar)'));
});
