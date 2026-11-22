
'use strict';
const cfg = require('./config');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const S = require('./settings');
const auth = require('./auth');
const billing = require('./billing');
const cripto = require('./cripto');
const pix = require('./pix');
const checkout = require('./checkout');
const { renderProtegido, paginaIndisponivel } = require('./protect');
const V = require('./views');


const PUB = path.join(__dirname, 'public');
const UP = path.join(cfg.DATA_DIR, 'uploads');
const COMP = path.join(cfg.DATA_DIR, 'comprovantes');
const ASSETS = path.join(cfg.DATA_DIR, 'assets');
fs.mkdirSync(UP, { recursive: true });
fs.mkdirSync(COMP, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });
const { lerZip } = require('./zip');
const RE_KEY = /^[a-f0-9]{16}$/;
// Arquivos de sistema que não servem para nada no site
const LIXO = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$|^__MACOSX\//i;
// Guardados, mas entregues só como download (nunca executados no navegador)
const SO_DOWNLOAD = /\.(php\d?|phtml|exe|msi|bat|cmd|sh|ps1|com|scr|jar|dll|vbs)$/i;
const RE_HTML = /\.(html?|xhtml)$/i;
const LIMITE_ARQUIVO = 100e6;
const LIMITE_ZIP = 300e6;

const { DIA, HORA } = billing;
const RESERVADOS = new Set(['www', 'admin', 'app', 'api', 'painel', 'static', 'uploads', 'mail', 'loja', 'pagar', 'checkout']);
const TIPOS = new Set(['texto', 'preco', 'imagem', 'link']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.mjs': 'application/javascript; charset=utf-8',
  // imagens
  '.jfif': 'image/jpeg', '.pjpeg': 'image/jpeg', '.pjp': 'image/jpeg', '.apng': 'image/apng', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.heic': 'image/heic', '.heif': 'image/heif', '.jxl': 'image/jxl', '.cur': 'image/x-icon',
  // vídeo e áudio
  '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.ogv': 'video/ogg', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.3gp': 'video/3gpp',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/opus', '.weba': 'audio/webm',
  // documentos e dados
  '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml', '.md': 'text/markdown; charset=utf-8', '.rtf': 'application/rtf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar', '.7z': 'application/x-7z-compressed',
  // web
  '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.vtt': 'text/vtt; charset=utf-8', '.srt': 'text/plain; charset=utf-8', '.lottie': 'application/zip',
};

// Caminho relativo seguro dentro de uma pasta (sem "..")
function caminhoSeguro(rel) {
  const partes = String(rel).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (!partes.length || partes.some((p) => p === '..' || /[\0<>:"|?*]/.test(p))) return null;
  return partes.join('/');
}

// Acha o arquivo mesmo se o site pedir com maiúsculas/minúsculas diferentes (servidor Linux diferencia)
function acharCaminho(base, rel) {
  const exato = path.join(base, rel);
  try { if (fs.statSync(exato).isFile()) return rel; } catch (_) {}
  let atual = base;
  const reais = [];
  for (const seg of rel.split('/')) {
    let nomes;
    try { nomes = fs.readdirSync(atual); } catch (_) { return null; }
    const achou = nomes.find((n) => n.toLowerCase() === seg.toLowerCase());
    if (!achou) return null;
    reais.push(achou);
    atual = path.join(atual, achou);
  }
  try { return fs.statSync(atual).isFile() ? reais.join('/') : null; } catch (_) { return null; }
}

// Lê HTML em qualquer codificação (UTF-8, UTF-16, ISO-8859-1, Windows-1252...)
function decodificar(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) {}
  const cabeca = buf.subarray(0, 4096).toString('latin1');
  const m = cabeca.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i);
  try { return new TextDecoder(m ? m[1].toLowerCase() : 'windows-1252').decode(buf); } catch (_) { return new TextDecoder('windows-1252').decode(buf); }
}

function listarArquivos(dir, base = '') {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out = out.concat(listarArquivos(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

// Apaga pastas de arquivos que nenhum template usa (uploads abandonados), após 1 dia
function limparAssets() {
  try {
    const usados = new Set(db.prepare('SELECT assets FROM templates WHERE assets IS NOT NULL').all().map((r) => r.assets));
    for (const k of fs.readdirSync(ASSETS)) {
      const p = path.join(ASSETS, k);
      if (!usados.has(k) && Date.now() - fs.statSync(p).mtimeMs > 24 * 3600e3) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('Limpeza de arquivos:', e.message);
  }
}

// ------------------------------------------------------------------ dados iniciais
function seed() {
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
    db.prepare('INSERT INTO users (email, nome, senha_hash, role, criado_em) VALUES (?, ?, ?, ?, ?)').run(
      cfg.ADMIN_EMAIL.toLowerCase(), 'Administrador', auth.hash(cfg.ADMIN_PASSWORD), 'admin', Date.now()
    );
    console.log(`Admin criado: ${cfg.ADMIN_EMAIL} (senha na variável ADMIN_PASSWORD: arquivo .env ou ${path.join(cfg.DATA_DIR, 'segredos.json')})`);
  }
    if (!db.prepare('SELECT 1 FROM templates').get()) {
    const dir = path.join(__dirname, 'exemplos');
    const arquivoHtml = path.join(dir, 'loja-fone.html');
    const arquivoCampos = path.join(dir, 'loja-fone.campos.json');

    if (fs.existsSync(arquivoHtml) && fs.existsSync(arquivoCampos)) {
      const html = fs.readFileSync(arquivoHtml, 'utf8');
      const campos = fs.readFileSync(arquivoCampos, 'utf8');

      db.prepare(`
        INSERT INTO templates
        (nome, descricao, html, campos, ativo, criado_em)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(
        'Pulse — Produto único',
        'Página de produto único para dropshipping, com contador de oferta, benefícios, avaliações e FAQ.',
        html,
        JSON.stringify(JSON.parse(campos)),
        Date.now()
      );

      console.log('Template de demonstração instalado.');
    } else {
      console.warn('Template de demonstração não encontrado. O servidor continuará sem ele. Adicione um template pelo painel administrativo.');
    }
  }
}

// ------------------------------------------------------------------ utilitários
function enviar(res, status, corpo, headers = {}) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }, headers));
  res.end(corpo);
}
const json = (res, status, obj) => enviar(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
const redir = (res, url) => { res.writeHead(303, { Location: url }); res.end(); };
const q = encodeURIComponent;

function servirArquivo(res, base, rel, extra = {}) {
  let p;
  try { p = path.join(base, decodeURIComponent(rel)); } catch (_) { return enviar(res, 400, 'Requisição inválida'); }
  if (!p.startsWith(base + path.sep)) return enviar(res, 404, 'Não encontrado');
  fs.readFile(p, (e, buf) => {
    if (e) return enviar(res, 404, 'Não encontrado');
    enviar(res, 200, buf, Object.assign({ 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' }, extra));
  });
}

async function lerCorpo(req, max) {
  return (await lerBuffer(req, max)).toString('utf8');
}

function lerBuffer(req, max) {
  return new Promise((ok, falha) => {
    let n = 0;
    const partes = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > max) {
        const e = new Error('Conteúdo grande demais');
        e.status = 413;
        falha(e);
        req.destroy();
      } else partes.push(c);
    });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', falha);
  });
}
const form = async (req, max = 1e6) => Object.fromEntries(new URLSearchParams(await lerCorpo(req, max)));
const corpoJson = async (req, max) => JSON.parse((await lerCorpo(req, max)) || '{}');

function mesmaOrigem(req) {
  const o = req.headers.origin || req.headers.referer;
  if (!o) return false;
  try { return new URL(o).host === req.headers.host; } catch (_) { return false; }
}

function precisa(c, res, role) {
  if (!c.user) { redir(res, '/entrar'); return false; }
  if (role && c.user.role !== role) { enviar(res, 403, V.simples({ user: c.user, titulo: 'Sem permissão', texto: 'Esta área não está disponível para a sua conta.' })); return false; }
  return true;
}
const msgs = (c) => ({ ok: c.query.get('ok'), erro: c.query.get('erro') });
const planosAtivos = () => db.prepare('SELECT * FROM planos WHERE ativo = 1 ORDER BY dias').all();
const todosPlanos = () => db.prepare('SELECT * FROM planos ORDER BY dias').all();
const ehAdmin = (c) => c.user && c.user.role === 'admin';

function centavos(s) {
  let t = String(s || '').trim().replace(/[R$\s]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
const soDigitos = (s) => String(s || '').replace(/\D/g, '');
function whats(s) {
  const d = soDigitos(s);
  if (!d) return '';
  return d.length === 10 || d.length === 11 ? '55' + d : d;
}
const senhaAleatoria = () => crypto.randomBytes(6).toString('base64url');
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_SLUG = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const RE_URL = /^https?:\/\/[^\s"'<>]+$/i;
const RE_UPLOAD = /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp|gif)$/;
const RE_LINK_EXTRA = /^(#[\w-]*|mailto:[^\s"'<>]+|tel:[+\d\s()-]+)$/i;

function hostname(req) {
  const h = (req.headers.host || '').toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
}

// Valores finais da loja, trocando "@checkout:N" pelo endereço do checkout da loja
function valoresRender(loja) {
  const v = JSON.parse(loja.valores || '{}');
  const ck = JSON.parse(loja.checkout || '{}');
  const base = cfg.urlCheckout(loja.slug);
  for (const c of JSON.parse(loja.campos)) {
    if (c.tipo !== 'link') continue;
    let x = v[c.id];
    if ((x === undefined || x === '') && ck.gateway) x = '@checkout:0';
    if (typeof x === 'string' && x.startsWith('@checkout')) {
      const n = parseInt(x.split(':')[1] || '0', 10) || 0;
      v[c.id] = base + (n ? '?p=' + n : '');
    }
  }
  return v;
}

// Páginas públicas da plataforma (início, entrar, cadastro): mesmo código cifrado e bloqueios das lojas
function publico(req, res, status, html) {
  const pagina = renderProtegido({ html, campos: [], valores: {}, marca: 'site', hostname: hostname(req) });
  enviar(res, status, pagina, { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
}

// Arquivos dos templates só podem ser carregados PELO site (imagem na página, CSS, fonte...).
// Abrir o link direto na barra do navegador, em outra aba ou a partir de outro site é bloqueado.
function assetPermitido(req) {
  const dest = req.headers['sec-fetch-dest'];
  const modo = req.headers['sec-fetch-mode'];
  const site = req.headers['sec-fetch-site'];
  if (modo === 'navigate' || dest === 'document') return false;
  if (site) return site === 'same-origin' || site === 'same-site';
  const ref = req.headers.referer;
  if (!ref) return false;
  try {
    const h = new URL(ref).hostname.toLowerCase();
    return h === cfg.BASE_DOMAIN || h.endsWith('.' + cfg.BASE_DOMAIN);
  } catch (_) {
    return false;
  }
}

function enviarLoja(req, res, html, campos, valores, marca, frame) {
  const pagina = renderProtegido({ html, campos, valores, marca, hostname: hostname(req) });
  enviar(res, 200, pagina, { 'Cache-Control': 'no-store', 'X-Frame-Options': frame, 'Referrer-Policy': 'same-origin' });
}

function lojaPublica(slug) {
  const loja = db
    .prepare('SELECT l.*, t.html, t.campos, t.assets, t.assets_base, u.bloqueado FROM lojas l JOIN templates t ON t.id = l.template_id JOIN users u ON u.id = l.user_id WHERE l.slug = ?')
    .get(slug);
  if (!loja) return { erro: 'Loja não encontrada', status: 404 };
  if (loja.suspensa || loja.bloqueado || loja.vence_em < Date.now()) return { erro: 'Esta loja está temporariamente indisponível', status: 200 };
  return { loja };
}

// Entrega um arquivo da pasta de um template.
// Páginas .html extras do site vão protegidas (cifradas), igual à página principal.
function servirAsset(req, res, key, relPedido) {
  const base = path.join(ASSETS, key);
  const rel = acharCaminho(base, relPedido);
  if (!rel) return enviar(res, 404, 'Não encontrado');
  const arquivo = path.join(base, rel);
  if (!arquivo.startsWith(base + path.sep)) return enviar(res, 404, 'Não encontrado');
  if (RE_HTML.test(rel)) {
    fs.readFile(arquivo, (e, buf) => {
      if (e) return enviar(res, 404, paginaIndisponivel('Página não encontrada'));
      enviarLoja(req, res, decodificar(buf), [], {}, 'p' + key.slice(0, 6), 'SAMEORIGIN');
    });
    return;
  }
  // Bloqueia abrir/baixar o arquivo pelo link direto: só o próprio site pode carregá-lo
  if (!assetPermitido(req) || SO_DOWNLOAD.test(rel)) {
    return enviar(res, 403, paginaIndisponivel('Acesso direto a arquivos não é permitido'));
  }
  // Revalida sempre (ETag): se o arquivo for editado, o navegador pega a versão nova na hora
  let st;
  try { st = fs.statSync(arquivo); } catch (_) { return enviar(res, 404, 'Não encontrado'); }
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const cab = {
    'Content-Type': MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'private, no-cache',
    ETag: etag,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Content-Disposition': 'inline',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, cab);
    return res.end();
  }
  // Vídeos e áudios pedem pedaços do arquivo (Range) — necessário para tocar e avançar no iPhone/Safari
  const range = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] !== '' || range[2] !== '')) {
    let ini, fim;
    if (range[1] === '') { ini = Math.max(0, st.size - Number(range[2])); fim = st.size - 1; }
    else { ini = Number(range[1]); fim = range[2] === '' ? st.size - 1 : Math.min(Number(range[2]), st.size - 1); }
    if (ini > fim || ini >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, Object.assign(cab, { 'Content-Range': `bytes ${ini}-${fim}/${st.size}`, 'Content-Length': fim - ini + 1 }));
    return fs.createReadStream(arquivo, { start: ini, end: fim }).pipe(res);
  }
  res.writeHead(200, Object.assign(cab, { 'Content-Length': st.size }));
  fs.createReadStream(arquivo).pipe(res);
}

// Arquivos pedidos pelo próprio site da loja (ex.: JS que carrega "img/foto.png") vêm da pasta do template
function servirArquivoLoja(req, res, slug, pathname, raiz) {
  const r = lojaPublica(slug);
  if (!r.erro && r.loja.assets) {
    let rel = null;
    try { rel = caminhoSeguro(decodeURIComponent(pathname)); } catch (_) {}
    if (rel && /^index\.html?$/i.test(rel)) return redir(res, raiz);
    if (rel) {
      const completo = r.loja.assets_base ? r.loja.assets_base + '/' + rel : rel;
      if (acharCaminho(path.join(ASSETS, r.loja.assets), completo)) return servirAsset(req, res, r.loja.assets, completo);
    }
  }
  return enviar(res, 404, paginaIndisponivel('Página não encontrada'));
}

function servirLoja(req, res, slug) {
  const r = lojaPublica(slug);
  if (r.erro) return enviar(res, r.status, paginaIndisponivel(r.erro));
  enviarLoja(req, res, r.loja.html, JSON.parse(r.loja.campos), valoresRender(r.loja), r.loja.marca, 'DENY');
}

async function servirCheckout(req, res, slug, query) {
  const r = lojaPublica(slug);
  if (r.erro) return enviar(res, r.status, paginaIndisponivel(r.erro));
  const ck = JSON.parse(r.loja.checkout || '{}');
  const idx = Math.max(0, parseInt(query.get('p') || '0', 10) || 0);
  const out = await checkout.iniciar(ck, idx, cfg.urlLoja(r.loja.slug));
  if (out.url) return redir(res, out.url);
  if (out.pix) return enviar(res, 200, V.pixCheckout({ pix: out.pix, loja: r.loja }), { 'Cache-Control': 'no-store' });
  enviar(res, 200, paginaIndisponivel(out.erro || 'Checkout indisponível'));
}

// ------------------------------------------------------------------ rotas
const rotas = [];
function rota(metodo, padrao, handler) {
  rotas.push({ metodo, re: new RegExp('^' + padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '/?$'), handler });
}

// --- público / login
rota('GET', '/', (req, res, c) => {
  if (c.user) return redir(res, ehAdmin(c) ? '/admin' : '/painel');
  const templates = db.prepare('SELECT id, nome, descricao FROM templates WHERE ativo = 1 ORDER BY id DESC').all();
  publico(req, res, 200, V.inicio({ templates, planos: planosAtivos() }));
});

rota('GET', '/entrar', (req, res, c) => (c.user ? redir(res, '/') : publico(req, res, 200, V.entrar({}))));

function logar(res, u, destino) {
  db.prepare('UPDATE users SET ultimo_login = ? WHERE id = ?').run(Date.now(), u.id);
  res.writeHead(303, { 'Set-Cookie': auth.cookie(auth.criarSessao(u.id)), Location: destino });
  res.end();
}

rota('POST', '/entrar', async (req, res) => {
  // Atrás do Cloudflare/Caddy o IP real vem nos cabeçalhos (TRUST_PROXY=1 no .env)
  const ip = process.env.TRUST_PROXY === '1'
    ? req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
    : req.socket.remoteAddress;
  if (auth.bloqueado(ip)) return publico(req, res, 429, V.entrar({ erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' }));
  const f = await form(req);
  const email = String(f.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !auth.verify(String(f.senha || ''), u.senha_hash)) {
    auth.falhou(ip);
    return publico(req, res, 401, V.entrar({ erro: 'E-mail ou senha incorretos.', email }));
  }
  if (u.bloqueado) return publico(req, res, 403, V.entrar({ erro: 'Seu acesso está bloqueado. Fale com o suporte.', email }));
  logar(res, u, u.role === 'admin' ? '/admin' : '/painel');
});

rota('GET', '/cadastrar', (req, res, c) => (c.user ? redir(res, '/') : publico(req, res, 200, V.cadastrar({}))));

rota('POST', '/cadastrar', async (req, res) => {
  if (S.get('cadastro_aberto') !== '1') return publico(req, res, 403, V.cadastrar({}));
  const f = await form(req);
  const v = { nome: String(f.nome || '').trim().slice(0, 80), email: String(f.email || '').trim().toLowerCase(), telefone: String(f.telefone || '').trim().slice(0, 20) };
  const erro = (m) => publico(req, res, 400, V.cadastrar({ erro: m, v }));
  if (v.nome.length < 2) return erro('Informe seu nome.');
  if (!RE_EMAIL.test(v.email)) return erro('E-mail inválido.');
  if (String(f.senha || '').length < 8) return erro('A senha precisa ter pelo menos 8 caracteres.');
  if (f.senha !== f.senha2) return erro('As senhas não conferem.');
  if (f.termos !== '1') return erro('É preciso aceitar os termos de uso.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(v.email)) return erro('Já existe uma conta com esse e-mail.');
  const r = db.prepare('INSERT INTO users (email, nome, telefone, senha_hash, role, criado_em) VALUES (?, ?, ?, ?, ?, ?)').run(
    v.email, v.nome, v.telefone, auth.hash(f.senha), 'cliente', Date.now()
  );
  logar(res, { id: Number(r.lastInsertRowid) }, '/painel/alugar');
});

rota('POST', '/sair', (req, res) => {
  auth.encerrar(req);
  res.writeHead(303, { 'Set-Cookie': auth.cookie('', 0), Location: '/' });
  res.end();
});

rota('GET', '/templates/:id/preview', (req, res, c) => {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(+c.params.id);
  if (!t || (!t.ativo && !ehAdmin(c))) return enviar(res, 404, paginaIndisponivel('Modelo não encontrado'));
  enviarLoja(req, res, t.html, JSON.parse(t.campos), {}, 'demo' + t.id, 'SAMEORIGIN');
});


// --- admin: visão geral
const SQL_LOJAS = 'SELECT l.*, u.email, u.nome AS cliente, t.nome AS template FROM lojas l JOIN users u ON u.id = l.user_id JOIN templates t ON t.id = l.template_id';

rota('GET', '/admin', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const agora = Date.now();
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const stats = {
    ativas: db.prepare("SELECT COUNT(*) AS n FROM lojas WHERE suspensa = 0 AND vence_em > ? AND plano_id <> 'trial'").get(agora).n,
    teste: db.prepare("SELECT COUNT(*) AS n FROM lojas WHERE suspensa = 0 AND vence_em > ? AND plano_id = 'trial'").get(agora).n,
    membros: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'cliente'").get().n,
    mes: db.prepare("SELECT COALESCE(SUM(valor_centavos), 0) AS n FROM pagamentos WHERE status = 'pago' AND pago_em >= ?").get(inicioMes).n,
    aguardando: db.prepare("SELECT COUNT(*) AS n FROM pagamentos WHERE status = 'pendente' AND informado_em IS NOT NULL").get().n,
  };
  const vencendo = db.prepare(SQL_LOJAS + ' WHERE l.suspensa = 0 AND l.vence_em > ? AND l.vence_em < ? ORDER BY l.vence_em').all(agora, agora + 48 * HORA);
  const aguardando = db.prepare(
    "SELECT p.*, u.nome AS cliente, l.nome AS loja FROM pagamentos p JOIN lojas l ON l.id = p.loja_id JOIN users u ON u.id = l.user_id WHERE p.status = 'pendente' AND p.informado_em IS NOT NULL ORDER BY p.informado_em DESC LIMIT 8"
  ).all();
  const novos = db.prepare("SELECT id, nome, email, criado_em FROM users WHERE role = 'cliente' ORDER BY id DESC LIMIT 6").all();
  // Receita por dia (últimos 14 dias)
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const serie = [];
  for (let i = 13; i >= 0; i--) {
    const ini = new Date(hoje);
    ini.setDate(hoje.getDate() - i);
    const fim = new Date(ini);
    fim.setDate(ini.getDate() + 1);
    const v = db.prepare("SELECT COALESCE(SUM(valor_centavos), 0) AS n FROM pagamentos WHERE status = 'pago' AND pago_em >= ? AND pago_em < ?").get(ini.getTime(), fim.getTime()).n;
    serie.push({ dia: ini.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), v });
  }
  const situacao = {
    ativas: stats.ativas,
    teste: stats.teste,
    vencidas: db.prepare('SELECT COUNT(*) AS n FROM lojas WHERE suspensa = 0 AND vence_em <= ?').get(agora).n,
    suspensas: db.prepare('SELECT COUNT(*) AS n FROM lojas WHERE suspensa = 1').get().n,
  };
  enviar(res, 200, V.adminInicio({ user: c.user, stats, vencendo, aguardando, novos, serie, situacao, msg: msgs(c) }));
});

// --- admin: lojas
rota('GET', '/admin/lojas', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const f = c.query.get('f') || '';
  const agora = Date.now();
  const filtros = {
    ativas: ["WHERE l.suspensa = 0 AND l.vence_em > ? AND l.plano_id <> 'trial'", [agora]],
    teste: ["WHERE l.suspensa = 0 AND l.vence_em > ? AND l.plano_id = 'trial'", [agora]],
    vencidas: ['WHERE l.suspensa = 0 AND l.vence_em <= ?', [agora]],
    suspensas: ['WHERE l.suspensa = 1', []],
  };
  const [w, p] = filtros[f] || ['', []];
  const lojas = db.prepare(`${SQL_LOJAS} ${w} ORDER BY l.id DESC`).all(...p);
  enviar(res, 200, V.adminLojas({ user: c.user, lojas, filtro: filtros[f] ? f : '', msg: msgs(c) }));
});

rota('POST', '/admin/lojas/:id/acao', async (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const f = await form(req);
  const volta = /^\/admin[\w/?=&-]*$/.test(f.volta || '') ? f.volta : '/admin/lojas';
  const sep = volta.includes('?') ? '&' : '?';
  const l = db.prepare('SELECT * FROM lojas WHERE id = ?').get(+c.params.id);
  if (!l) return redir(res, volta + sep + 'erro=' + q('Loja não encontrada.'));
  let msg = `Loja ${l.slug} atualizada.`;
  if (f.acao === 'liberar') {
    const n = parseInt(f.qtd, 10);
    if (!(n >= 1 && n <= 3650)) return redir(res, volta + sep + 'erro=' + q('Quantidade inválida.'));
    const horas = f.unidade === 'horas';
    billing.estender(l.id, n * (horas ? HORA : DIA));
    if (l.plano_id === 'trial') db.prepare("UPDATE lojas SET plano_id = 'manual' WHERE id = ?").run(l.id);
    msg = `Liberado +${n} ${horas ? 'hora(s)' : 'dia(s)'} para ${l.slug}.`;
  } else if (f.acao === 'suspender') db.prepare('UPDATE lojas SET suspensa = 1 WHERE id = ?').run(l.id);
  else if (f.acao === 'reativar') db.prepare('UPDATE lojas SET suspensa = 0 WHERE id = ?').run(l.id);
  redir(res, volta + sep + 'ok=' + q(msg));
});

// --- admin: membros
rota('GET', '/admin/membros', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const busca = String(c.query.get('q') || '').trim();
  const filtro = c.query.get('f') || '';
  const like = '%' + busca + '%';
  let membros = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM lojas l WHERE l.user_id = u.id) AS n_lojas,
       (SELECT COUNT(*) FROM lojas l WHERE l.user_id = u.id AND l.suspensa = 0 AND l.vence_em > ?) AS n_ativas
       FROM users u WHERE u.role = 'cliente' AND (u.nome LIKE ? OR u.email LIKE ? OR IFNULL(u.telefone, '') LIKE ?) ORDER BY u.id DESC`
    )
    .all(Date.now(), like, like, like);
  if (filtro === 'ativos') membros = membros.filter((m) => m.n_ativas > 0 && !m.bloqueado);
  else if (filtro === 'inativos') membros = membros.filter((m) => !m.n_ativas && !m.bloqueado);
  else if (filtro === 'bloqueados') membros = membros.filter((m) => m.bloqueado);
  enviar(res, 200, V.adminMembros({ user: c.user, membros, q: busca, filtro, msg: msgs(c) }));
});

function paginaMembro(c, res, id, msg) {
  const m = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'cliente'").get(id);
  if (!m) return redir(res, '/admin/membros?erro=' + q('Membro não encontrado.'));
  const lojas = db.prepare(SQL_LOJAS + ' WHERE l.user_id = ? ORDER BY l.id DESC').all(id);
  const pagamentos = db.prepare('SELECT p.*, l.nome AS loja FROM pagamentos p JOIN lojas l ON l.id = p.loja_id WHERE l.user_id = ? ORDER BY p.id DESC LIMIT 50').all(id);
  const templates = db.prepare('SELECT id, nome FROM templates ORDER BY ativo DESC, id DESC').all();
  enviar(res, 200, V.adminMembro({ user: c.user, m, lojas, pagamentos, templates, msg }));
}

rota('GET', '/admin/membros/:id', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  paginaMembro(c, res, +c.params.id, msgs(c));
});

rota('POST', '/admin/membros', async (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const f = await form(req);
  const nome = String(f.nome || '').trim().slice(0, 80);
  const email = String(f.email || '').trim().toLowerCase();
  const telefone = String(f.telefone || '').trim().slice(0, 20);
  if (nome.length < 2 || !RE_EMAIL.test(email)) return redir(res, '/admin/membros?erro=' + q('Informe nome e e-mail válidos.'));
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return redir(res, '/admin/membros?erro=' + q('Já existe uma conta com esse e-mail.'));
  const gerada = !String(f.senha || '').trim();
  const senha = gerada ? senhaAleatoria() : String(f.senha);
  if (senha.length < 6) return redir(res, '/admin/membros?erro=' + q('A senha precisa ter pelo menos 6 caracteres.'));
  const r = db.prepare('INSERT INTO users (email, nome, telefone, senha_hash, role, criado_em) VALUES (?, ?, ?, ?, ?, ?)').run(
    email, nome, telefone, auth.hash(senha), 'cliente', Date.now()
  );
  paginaMembro(c, res, Number(r.lastInsertRowid), {
    ok: `Login criado! Envie para o membro → Site: ${cfg.urlPainel}/entrar · E-mail: ${email}` + (gerada ? ` · Senha: ${senha}` : ''),
  });
});

rota('POST', '/admin/membros/:id', async (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const id = +c.params.id;
  const m = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'cliente'").get(id);
  if (!m) return redir(res, '/admin/membros?erro=' + q('Membro não encontrado.'));
  const f = await form(req);
  const volta = (tipo, texto) => redir(res, `/admin/membros/${id}?${tipo}=${q(texto)}`);
  switch (f.acao) {
    case 'dados': {
      const nome = String(f.nome || '').trim().slice(0, 80);
      const email = String(f.email || '').trim().toLowerCase();
      if (nome.length < 2 || !RE_EMAIL.test(email)) return volta('erro', 'Nome ou e-mail inválido.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, id)) return volta('erro', 'Esse e-mail já é usado por outra conta.');
      db.prepare('UPDATE users SET nome = ?, email = ?, telefone = ?, obs = ? WHERE id = ?').run(nome, email, String(f.telefone || '').trim().slice(0, 20), String(f.obs || '').slice(0, 2000), id);
      return volta('ok', 'Dados salvos.');
    }
    case 'senha': {
      const gerada = !String(f.senha || '').trim();
      const senha = gerada ? senhaAleatoria() : String(f.senha);
      if (senha.length < 6) return volta('erro', 'A senha precisa ter pelo menos 6 caracteres.');
      db.prepare('UPDATE users SET senha_hash = ? WHERE id = ?').run(auth.hash(senha), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      return paginaMembro(c, res, id, { ok: 'Senha alterada.' + (gerada ? ` Nova senha: ${senha}` : '') });
    }
    case 'bloquear':
      db.prepare('UPDATE users SET bloqueado = 1 WHERE id = ?').run(id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      return volta('ok', 'Acesso bloqueado. As lojas deste membro saíram do ar.');
    case 'desbloquear':
      db.prepare('UPDATE users SET bloqueado = 0 WHERE id = ?').run(id);
      return volta('ok', 'Acesso liberado.');
    case 'trial':
      db.prepare('UPDATE users SET trial_usado = 0 WHERE id = ?').run(id);
      return volta('ok', 'O membro pode fazer um novo teste grátis.');
    case 'excluir':
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return redir(res, '/admin/membros?ok=' + q(`Conta de ${m.nome} excluída.`));
    case 'criar_loja': {
      const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(+f.template);
      const nome = String(f.nome || '').trim().slice(0, 60);
      const slug = String(f.slug || '').trim().toLowerCase();
      const dias = Math.max(0, Math.min(3650, parseInt(f.dias, 10) || 0));
      if (!t) return volta('erro', 'Escolha um modelo.');
      if (nome.length < 2) return volta('erro', 'Dê um nome para a loja.');
      if (!RE_SLUG.test(slug) || RESERVADOS.has(slug) || db.prepare('SELECT 1 FROM lojas WHERE slug = ?').get(slug)) return volta('erro', 'Endereço inválido ou já em uso.');
      db.prepare('INSERT INTO lojas (user_id, template_id, slug, nome, valores, plano_id, vence_em, suspensa, marca, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)').run(
        id, t.id, slug, nome, '{}', 'manual', dias ? Date.now() + dias * DIA : 0, crypto.randomBytes(4).toString('hex'), Date.now()
      );
      return volta('ok', `Loja ${slug} criada${dias ? ` e liberada por ${dias} dia(s)` : ''}.`);
    }
  }
  volta('erro', 'Ação desconhecida.');
});

// --- admin: pagamentos
rota('GET', '/admin/pagamentos', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const base = 'SELECT p.*, l.nome AS loja, l.slug, l.user_id, u.nome AS cliente, u.email, pl.nome AS plano_nome FROM pagamentos p JOIN lojas l ON l.id = p.loja_id JOIN users u ON u.id = l.user_id LEFT JOIN planos pl ON pl.id = p.plano_id';
  const pendentes = db.prepare(base + " WHERE p.status = 'pendente' ORDER BY p.informado_em IS NULL, p.informado_em DESC, p.id DESC").all();
  const historico = db.prepare(base + " WHERE p.status <> 'pendente' ORDER BY COALESCE(p.pago_em, p.criado_em) DESC LIMIT 100").all();
  enviar(res, 200, V.adminPagamentos({ user: c.user, pendentes, historico, msg: msgs(c) }));
});

rota('POST', '/admin/pagamentos/:id', async (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const f = await form(req);
  const id = +c.params.id;
  if (f.acao === 'confirmar') {
    const ok = billing.confirmar(id);
    return redir(res, '/admin/pagamentos?' + (ok ? 'ok=' + q('Pagamento confirmado. Loja liberada!') : 'erro=' + q('Este pagamento já estava confirmado.')));
  }
  if (f.acao === 'recusar') {
    billing.recusar(id);
    return redir(res, '/admin/pagamentos?ok=' + q('Pagamento recusado.'));
  }
  redir(res, '/admin/pagamentos');
});

rota('GET', '/admin/comprovantes/:id', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const p = db.prepare('SELECT comprovante FROM pagamentos WHERE id = ?').get(+c.params.id);
  if (!p || !p.comprovante) return enviar(res, 404, 'Sem comprovante.');
  servirArquivo(res, COMP, p.comprovante, { 'Cache-Control': 'private, no-store' });
});

// --- admin: templates
rota('GET', '/admin/templates', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const templates = db.prepare(
    'SELECT t.id, t.nome, t.descricao, t.ativo, (SELECT COUNT(*) FROM lojas l WHERE l.template_id = t.id) AS lojas FROM templates t ORDER BY t.id DESC'
  ).all();
  enviar(res, 200, V.adminTemplates({ user: c.user, templates, msg: msgs(c) }));
});

rota('GET', '/admin/templates/novo', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  enviar(res, 200, V.adminMapper({ user: c.user, tpl: null }));
});

rota('GET', '/admin/templates/:id/editar', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(+c.params.id);
  if (!t) return redir(res, '/admin/templates?erro=' + q('Template não encontrado.'));
  t.campos = JSON.parse(t.campos);
  enviar(res, 200, V.adminMapper({ user: c.user, tpl: t }));
});

async function salvarTemplate(req, res, c, id) {
  if (!precisa(c, res, 'admin')) return;
  let b;
  try { b = await corpoJson(req, 80e6); } catch (e) { return json(res, 400, { erro: 'O HTML ficou grande demais (máx. 80 MB) ou é inválido. Deixe as imagens como arquivos na pasta em vez de embutidas no HTML.' }); }
  const nome = String(b.nome || '').trim().slice(0, 80);
  if (!nome) return json(res, 400, { erro: 'Dê um nome ao template.' });
  const html = String(b.html || '');
  if (html.length < 20) return json(res, 400, { erro: 'HTML vazio ou inválido.' });
  if (!Array.isArray(b.campos) || !b.campos.length) return json(res, 400, { erro: 'Marque pelo menos um campo editável.' });
  const campos = [];
  const ids = new Set();
  for (const x of b.campos) {
    const cid = String((x && x.id) || '');
    if (!/^[a-z0-9_]{1,24}$/i.test(cid) || ids.has(cid) || !TIPOS.has(x.tipo)) return json(res, 400, { erro: 'Campo inválido: ' + cid });
    ids.add(cid);
    campos.push({ id: cid, tipo: x.tipo, rotulo: String(x.rotulo || cid).slice(0, 120), padrao: String(x.padrao || '').slice(0, 5000) });
  }
  const desc = String(b.descricao || '').slice(0, 300);
  const ativo = b.ativo ? 1 : 0;
  const assets = RE_KEY.test(b.assets || '') && fs.existsSync(path.join(ASSETS, b.assets)) ? b.assets : null;
  const assetsBase = (assets && caminhoSeguro(b.assetsBase || '')) || '';
  if (id) {
    const antigo = db.prepare('SELECT assets FROM templates WHERE id = ?').get(id);
    if (!antigo) return json(res, 404, { erro: 'Template não encontrado.' });
    db.prepare('UPDATE templates SET nome = ?, descricao = ?, html = ?, campos = ?, ativo = ?, assets = ?, assets_base = ? WHERE id = ?').run(nome, desc, html, JSON.stringify(campos), ativo, assets, assetsBase, id);
    if (antigo.assets && antigo.assets !== assets && !db.prepare('SELECT 1 FROM templates WHERE assets = ?').get(antigo.assets)) {
      fs.rmSync(path.join(ASSETS, antigo.assets), { recursive: true, force: true });
    }
    return json(res, 200, { ok: true, id });
  }
  const r = db.prepare('INSERT INTO templates (nome, descricao, html, campos, ativo, assets, assets_base, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(nome, desc, html, JSON.stringify(campos), ativo, assets, assetsBase, Date.now());
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
}

// Envio dos arquivos do template (pasta ou ZIP)
rota('POST', '/admin/assets', (req, res, c) => {
  if (!ehAdmin(c)) return json(res, 403, { erro: 'Sem permissão.' });
  const key = crypto.randomBytes(8).toString('hex');
  fs.mkdirSync(path.join(ASSETS, key), { recursive: true });
  json(res, 200, { key });
});

rota('GET', '/admin/assets/:key', (req, res, c) => {
  if (!ehAdmin(c)) return json(res, 403, { erro: 'Sem permissão.' });
  if (!RE_KEY.test(c.params.key)) return json(res, 404, { erro: 'Não encontrado.' });
  const dir = path.join(ASSETS, c.params.key);
  const arquivos = listarArquivos(dir).sort((a, b) => a.localeCompare(b));
  const detalhes = arquivos.map((a) => {
    let tamanho = 0;
    try { tamanho = fs.statSync(path.join(dir, a)).size; } catch (_) {}
    return { caminho: a, tamanho };
  });
  json(res, 200, { arquivos, detalhes });
});

// Conteúdo original de um arquivo (para editar ou baixar) — só o dono
rota('GET', '/admin/assets/:key/raw', (req, res, c) => {
  if (!ehAdmin(c)) return json(res, 403, { erro: 'Sem permissão.' });
  let rel = null;
  try { rel = caminhoSeguro(c.query.get('p') || ''); } catch (_) {}
  if (!RE_KEY.test(c.params.key) || !rel) return json(res, 404, { erro: 'Não encontrado.' });
  const extra = { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (c.query.get('baixar')) extra['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(rel.split('/').pop())}`;
  servirArquivo(res, path.join(ASSETS, c.params.key), rel, extra);
});

rota('POST', '/admin/assets/:key/excluir', async (req, res, c) => {
  if (!ehAdmin(c)) return json(res, 403, { erro: 'Sem permissão.' });
  const dir = path.join(ASSETS, c.params.key);
  if (!RE_KEY.test(c.params.key) || !fs.existsSync(dir)) return json(res, 404, { erro: 'Não encontrado.' });
  let b;
  try { b = await corpoJson(req, 2e6); } catch (_) { return json(res, 400, { erro: 'Pedido inválido.' }); }
  let n = 0;
  for (const p of Array.isArray(b.caminhos) ? b.caminhos : []) {
    const rel = caminhoSeguro(p);
    if (!rel) continue;
    const alvo = path.join(dir, rel);
    if (!alvo.startsWith(dir + path.sep)) continue;
    try { fs.unlinkSync(alvo); n++; } catch (_) {}
  }
  json(res, 200, { ok: true, excluidos: n });
});

rota('POST', '/admin/assets/:key/zip', async (req, res, c) => {
  if (!ehAdmin(c)) return json(res, 403, { erro: 'Sem permissão.' });
  const dir = path.join(ASSETS, c.params.key);
  if (!RE_KEY.test(c.params.key) || !fs.existsSync(dir)) return json(res, 404, { erro: 'Envio expirado. Tente de novo.' });
  let buf;
  try { buf = await lerBuffer(req, LIMITE_ZIP); } catch (e) { return json(res, 413, { erro: 'ZIP grande demais (máx. 300 MB). Envie a pasta em vez do ZIP.' }); }
  let itens;
  try { itens = lerZip(buf); } catch (e) { return json(res, 400, { erro: e.message }); }
  const htmls = [];
  const arquivos = [];
  for (const it of itens) {
    const rel = caminhoSeguro(it.nome);
    if (!rel || LIXO.test(rel)) continue;
    if (RE_HTML.test(rel)) htmls.push({ nome: rel, html: decodificar(it.conteudo) });
    const destino = path.join(dir, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, it.conteudo);
    arquivos.push(rel);
  }
  if (!htmls.length) return json(res, 400, { erro: 'Não achei nenhum arquivo .html dentro do ZIP.' });
  htmls.sort((a, b) => (/(^|\/)index\.html?$/i.test(b.nome) - /(^|\/)index\.html?$/i.test(a.nome)) || a.nome.split('/').length - b.nome.split('/').length);
  // a página principal vira o template; não fica como arquivo solto
  fs.rmSync(path.join(dir, htmls[0].nome), { force: true });
  json(res, 200, { index: htmls[0], arquivos: arquivos.filter((a) => a !== htmls[0].nome) });
});

async function receberAsset(req, res, user, pathname) {
  if (!user || user.role !== 'admin' || !mesmaOrigem(req)) return json(res, 403, { erro: 'Sem permissão.' });
  const m = pathname.match(/^\/admin\/assets\/([a-f0-9]{16})\/(.+)$/);
  if (!m) return json(res, 404, { erro: 'Não encontrado.' });
  const dir = path.join(ASSETS, m[1]);
  let rel;
  try { rel = caminhoSeguro(decodeURIComponent(m[2])); } catch (_) { rel = null; }
  if (!rel || !fs.existsSync(dir)) return json(res, 400, { erro: 'Caminho inválido.' });
  if (LIXO.test(rel)) return json(res, 200, { ignorado: true });
  let buf;
  try { buf = await lerBuffer(req, LIMITE_ARQUIVO); } catch (e) { return json(res, 413, { erro: `"${rel}" é grande demais (máx. 100 MB).` }); }
  const destino = path.join(dir, rel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, buf);
  json(res, 200, { ok: true });
}
rota('POST', '/admin/templates', (req, res, c) => salvarTemplate(req, res, c, null));
rota('POST', '/admin/templates/:id', (req, res, c) => salvarTemplate(req, res, c, +c.params.id));

rota('POST', '/admin/templates/:id/excluir', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const id = +c.params.id;
  const usados = db.prepare('SELECT COUNT(*) AS n FROM lojas WHERE template_id = ?').get(id).n;
  if (usados) {
    db.prepare('UPDATE templates SET ativo = 0 WHERE id = ?').run(id);
    return redir(res, '/admin/templates?ok=' + q(`Este template tem ${usados} loja(s) usando, então foi só desativado (não aparece mais para novos aluguéis).`));
  }
  const t = db.prepare('SELECT assets FROM templates WHERE id = ?').get(id);
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  if (t && t.assets && !db.prepare('SELECT 1 FROM templates WHERE assets = ?').get(t.assets)) {
    fs.rmSync(path.join(ASSETS, t.assets), { recursive: true, force: true });
  }
  redir(res, '/admin/templates?ok=' + q('Template excluído.'));
});

// --- admin: planos
rota('GET', '/admin/planos', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  enviar(res, 200, V.adminPlanos({ user: c.user, planos: todosPlanos(), msg: msgs(c) }));
});

rota('POST', '/admin/planos', async (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const f = await form(req);
  const volta = (t, m) => redir(res, `/admin/planos?${t}=${q(m)}`);
  const nome = String(f.nome || '').trim().slice(0, 40);
  const dias = parseInt(f.dias, 10);
  const preco = centavos(f.preco);
  if (f.acao === 'excluir') {
    const usado = db.prepare('SELECT 1 FROM lojas WHERE plano_id = ?').get(f.id) || db.prepare("SELECT 1 FROM pagamentos WHERE plano_id = ? AND status = 'pendente'").get(f.id);
    if (usado) {
      db.prepare('UPDATE planos SET ativo = 0 WHERE id = ?').run(f.id);
      return volta('ok', 'O plano está em uso, então foi desativado em vez de excluído.');
    }
    db.prepare('DELETE FROM planos WHERE id = ?').run(f.id);
    return volta('ok', 'Plano excluído.');
  }
  if (nome.length < 2 || !(dias >= 1 && dias <= 3650) || !preco) return volta('erro', 'Preencha nome, dias (1 a 3650) e preço.');
  if (f.acao === 'salvar') {
    db.prepare('UPDATE planos SET nome = ?, dias = ?, preco_centavos = ?, ativo = ? WHERE id = ?').run(nome, dias, preco, f.ativo === '1' ? 1 : 0, f.id);
    return volta('ok', `Plano ${nome} salvo.`);
  }
  let id = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'plano';
  if (id === 'trial' || id === 'manual') id += '-1';
  while (db.prepare('SELECT 1 FROM planos WHERE id = ?').get(id)) id += '-1';
  db.prepare('INSERT INTO planos (id, nome, dias, preco_centavos, ativo) VALUES (?, ?, ?, ?, 1)').run(id, nome, dias, preco);
  volta('ok', `Plano ${nome} criado.`);
});

// --- admin: configurações
rota('GET', '/admin/config', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const nomes = { pix: 'Pix com confirmação manual', asaas: 'Asaas', teste: 'Teste (simulação)' };
  enviar(res, 200, V.adminConfig({ user: c.user, s: S.all(), modoAtivo: nomes[billing.modo()], asaas: billing.asaasConfigurado(), msg: msgs(c) }));
});

rota('POST', '/admin/config', async (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const f = await form(req, 2e6);
  const t = (k, n) => String(f[k] || '').trim().slice(0, n);
  if (!t('nome_saas', 40)) return redir(res, '/admin/config?erro=' + q('Dê um nome ao site.'));
  S.set({
    nome_saas: t('nome_saas', 40),
    cor: /^#[0-9a-f]{6}$/i.test(f.cor || '') ? f.cor : S.get('cor'),
    termos: t('termos', 3000),
    whatsapp: whats(f.whatsapp),
    horario: t('horario', 80),
    aviso_painel: t('aviso_painel', 500),
    cadastro_aberto: f.cadastro_aberto === '1' ? '1' : '0',
    trial_horas: String(Math.max(0, Math.min(8760, parseInt(f.trial_horas, 10) || 0))),
    cobranca: ['pix', 'asaas', 'teste'].includes(f.cobranca) ? f.cobranca : 'pix',
    pix_chave: t('pix_chave', 77),
    pix_nome: t('pix_nome', 25),
    pix_cidade: t('pix_cidade', 15),
    pix_instrucoes: t('pix_instrucoes', 500),
  });
  redir(res, '/admin/config?ok=' + q('Configurações salvas.'));
});

// --- admin: página inicial
const CAMPOS_HOME = {
  home_selo: 80, home_titulo: 120, home_subtitulo: 400, home_cta: 60, home_cta2: 40, home_vitrine: 12, home_banner: 500,
  rec1_t: 60, rec1_d: 200, rec2_t: 60, rec2_d: 200, rec3_t: 60, rec3_d: 200,
  modelos_titulo: 80, modelos_sub: 200, passos_titulo: 80,
  passo1_t: 60, passo1_d: 200, passo2_t: 60, passo2_d: 200, passo3_t: 60, passo3_d: 200,
  planos_titulo: 80, planos_sub: 200, cta_titulo: 100, cta_texto: 200, rodape_texto: 200,
};
const LIGA_DESLIGA_HOME = ['mostrar_provas', 'mostrar_recursos', 'mostrar_passos', 'mostrar_cta'];

rota('GET', '/admin/home', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const templates = db.prepare('SELECT id, nome FROM templates WHERE ativo = 1 ORDER BY id DESC').all();
  enviar(res, 200, V.adminHome({ user: c.user, s: S.all(), templates, msg: msgs(c) }));
});

rota('GET', '/admin/home/preview', (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const templates = db.prepare('SELECT id, nome, descricao FROM templates WHERE ativo = 1 ORDER BY id DESC').all();
  enviar(res, 200, V.inicio({ templates, planos: planosAtivos() }), { 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' });
});

rota('POST', '/admin/home', async (req, res, c) => {
  if (!precisa(c, res, 'admin')) return;
  const f = await form(req, 1e6);
  const novo = {};
  for (const [k, max] of Object.entries(CAMPOS_HOME)) novo[k] = String(f[k] || '').replace(/\r\n/g, '\n').trim().slice(0, max);
  for (const k of LIGA_DESLIGA_HOME) novo[k] = f[k] === '1' ? '1' : '0';
  if (!novo.home_titulo) return redir(res, '/admin/home?erro=' + q('O título principal não pode ficar vazio.'));
  if (novo.home_banner && !RE_URL.test(novo.home_banner) && !RE_UPLOAD.test(novo.home_banner)) {
    return redir(res, '/admin/home?erro=' + q('Imagem do topo inválida: use o botão Enviar imagem ou um link https://'));
  }
  if (novo.home_vitrine && !/^\d+$/.test(novo.home_vitrine)) novo.home_vitrine = '';
  S.set(novo);
  redir(res, '/admin/home?ok=' + q('Página inicial salva!'));
});

// --- membro: painel e aluguel
rota('GET', '/painel', (req, res, c) => {
  if (!precisa(c, res)) return;
  if (ehAdmin(c)) return redir(res, '/admin');
  const lojas = db.prepare('SELECT l.*, t.nome AS template FROM lojas l JOIN templates t ON t.id = l.template_id WHERE l.user_id = ? ORDER BY l.id DESC').all(c.user.id);
  const pendentes = {};
  for (const p of db.prepare("SELECT p.* FROM pagamentos p JOIN lojas l ON l.id = p.loja_id WHERE l.user_id = ? AND p.status = 'pendente' ORDER BY p.id ASC").all(c.user.id)) {
    pendentes[p.loja_id] = p;
  }
  enviar(res, 200, V.painel({ user: c.user, lojas, pendentes, planos: planosAtivos(), msg: msgs(c), precisaCpf: billing.modo() === 'asaas' && !c.user.cpf }));
});

const templatesAtivos = () => db.prepare('SELECT id, nome, descricao FROM templates WHERE ativo = 1 ORDER BY id DESC').all();
const trialDisponivel = (u) => (!u.trial_usado && parseInt(S.get('trial_horas'), 10)) || 0;

rota('GET', '/painel/alugar', (req, res, c) => {
  if (!precisa(c, res)) return;
  if (ehAdmin(c)) return redir(res, '/admin');
  enviar(res, 200, V.alugar({
    user: c.user, templates: templatesAtivos(), planos: planosAtivos(), trialHoras: trialDisponivel(c.user),
    precisaCpf: billing.modo() === 'asaas' && !c.user.cpf, v: { template: c.query.get('t') },
  }));
});

function salvarCpf(user, f) {
  if (billing.modo() !== 'asaas' || user.cpf) return null;
  const cpf = soDigitos(f.cpf);
  if (cpf.length !== 11 && cpf.length !== 14) return 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.';
  db.prepare('UPDATE users SET cpf = ? WHERE id = ?').run(cpf, user.id);
  user.cpf = cpf;
  return null;
}

rota('POST', '/painel/alugar', async (req, res, c) => {
  if (!precisa(c, res)) return;
  if (ehAdmin(c)) return redir(res, '/admin');
  const f = await form(req);
  const v = { template: f.template, nome: String(f.nome || '').trim().slice(0, 60), slug: String(f.slug || '').trim().toLowerCase(), plano: f.plano, cpf: f.cpf };
  const trialHoras = trialDisponivel(c.user);
  const erro = (m) => enviar(res, 400, V.alugar({ user: c.user, templates: templatesAtivos(), planos: planosAtivos(), trialHoras, precisaCpf: billing.modo() === 'asaas' && !c.user.cpf, erro: m, v }));
  const t = db.prepare('SELECT * FROM templates WHERE id = ? AND ativo = 1').get(+v.template);
  if (!t) return erro('Escolha um modelo.');
  if (v.nome.length < 2) return erro('Dê um nome para a loja.');
  if (!RE_SLUG.test(v.slug)) return erro('Endereço inválido: use de 3 a 30 letras minúsculas, números ou hífen.');
  if (RESERVADOS.has(v.slug) || db.prepare('SELECT 1 FROM lojas WHERE slug = ?').get(v.slug)) return erro('Esse endereço já está em uso. Escolha outro.');
  const marca = crypto.randomBytes(4).toString('hex');
  const inserir = (planoId, vence) =>
    db.prepare('INSERT INTO lojas (user_id, template_id, slug, nome, valores, plano_id, vence_em, suspensa, marca, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .run(c.user.id, t.id, v.slug, v.nome, '{}', planoId, vence, marca, Date.now());

  if (v.plano === 'trial') {
    if (!trialHoras) return erro('Você já usou o seu teste grátis. Escolha um plano.');
    inserir('trial', Date.now() + trialHoras * HORA);
    db.prepare('UPDATE users SET trial_usado = 1 WHERE id = ?').run(c.user.id);
    return redir(res, '/painel?ok=' + q(`Teste grátis ativado por ${trialHoras} horas! Configure o conteúdo e o checkout da sua loja.`));
  }
  const plano = db.prepare('SELECT * FROM planos WHERE id = ? AND ativo = 1').get(v.plano);
  if (!plano) return erro('Escolha um plano.');
  const eCpf = salvarCpf(c.user, f);
  if (eCpf) return erro(eCpf);
  const r = inserir(plano.id, 0);
  const loja = db.prepare('SELECT * FROM lojas WHERE id = ?').get(Number(r.lastInsertRowid));
  try {
    redir(res, await billing.criarCobranca(c.user, loja, plano));
  } catch (e) {
    console.error('Cobrança falhou:', e.message);
    redir(res, '/painel?erro=' + q('Loja criada, mas não foi possível gerar a cobrança: ' + e.message));
  }
});

// Loja do próprio membro, ou qualquer loja se for o dono
function lojaAcessivel(c, id) {
  const sql = 'SELECT l.*, t.html, t.campos, t.nome AS template, u.nome AS dono FROM lojas l JOIN templates t ON t.id = l.template_id JOIN users u ON u.id = l.user_id WHERE l.id = ?';
  return ehAdmin(c) ? db.prepare(sql).get(id) : db.prepare(sql + ' AND l.user_id = ?').get(id, c.user.id);
}
const voltaPainel = (c) => (ehAdmin(c) ? '/admin/lojas' : '/painel');

rota('GET', '/painel/lojas/:id', (req, res, c) => {
  if (!precisa(c, res)) return;
  const loja = lojaAcessivel(c, +c.params.id);
  if (!loja) return redir(res, voltaPainel(c) + '?erro=' + q('Loja não encontrada.'));
  enviar(res, 200, V.editor({ user: c.user, loja, campos: JSON.parse(loja.campos), valores: JSON.parse(loja.valores), msg: msgs(c) }));
});

rota('POST', '/painel/lojas/:id', async (req, res, c) => {
  if (!precisa(c, res)) return;
  const loja = lojaAcessivel(c, +c.params.id);
  if (!loja) return redir(res, voltaPainel(c) + '?erro=' + q('Loja não encontrada.'));
  const f = await form(req, 3e6);
  const campos = JSON.parse(loja.campos);
  const valores = JSON.parse(loja.valores);
  const erros = [];
  for (const cp of campos) {
    if (cp.tipo === 'link') {
      const modo = f['m_' + cp.id];
      if (/^@checkout:\d$/.test(modo || '')) { valores[cp.id] = modo; continue; }
    }
    const bruto = f['f_' + cp.id];
    if (bruto === undefined) continue;
    const v = String(bruto).replace(/\r\n/g, '\n').trim().slice(0, 5000);
    if (v === '' || v === cp.padrao) {
      if (cp.tipo === 'link' && f['m_' + cp.id] === 'url') valores[cp.id] = cp.padrao || '#';
      else delete valores[cp.id];
      continue;
    }
    if (cp.tipo === 'link' && !RE_URL.test(v) && !RE_LINK_EXTRA.test(v)) { erros.push(`"${cp.rotulo}": o link precisa começar com https://`); continue; }
    if (cp.tipo === 'imagem' && !RE_URL.test(v) && !RE_UPLOAD.test(v)) { erros.push(`"${cp.rotulo}": use o botão Enviar foto ou um link https://`); continue; }
    valores[cp.id] = v;
  }
  const nome = String(f.nome_loja || '').trim().slice(0, 60) || loja.nome;
  db.prepare('UPDATE lojas SET valores = ?, nome = ? WHERE id = ?').run(JSON.stringify(valores), nome, loja.id);
  const base = `/painel/lojas/${loja.id}?`;
  redir(res, erros.length ? base + 'erro=' + q('Salvo, mas alguns campos foram ignorados: ' + erros.join(' · ')) : base + 'ok=' + q('Alterações salvas!'));
});

rota('GET', '/painel/lojas/:id/preview', (req, res, c) => {
  if (!precisa(c, res)) return;
  const loja = lojaAcessivel(c, +c.params.id);
  if (!loja) return enviar(res, 404, paginaIndisponivel('Loja não encontrada'));
  enviarLoja(req, res, loja.html, JSON.parse(loja.campos), valoresRender(loja), loja.marca, 'SAMEORIGIN');
});

rota('GET', '/painel/lojas/:id/checkout', (req, res, c) => {
  if (!precisa(c, res)) return;
  const loja = lojaAcessivel(c, +c.params.id);
  if (!loja) return redir(res, voltaPainel(c) + '?erro=' + q('Loja não encontrada.'));
  enviar(res, 200, V.checkoutLoja({ user: c.user, loja, msg: msgs(c) }));
});

rota('POST', '/painel/lojas/:id/checkout', async (req, res, c) => {
  if (!precisa(c, res)) return;
  const loja = lojaAcessivel(c, +c.params.id);
  if (!loja) return redir(res, voltaPainel(c) + '?erro=' + q('Loja não encontrada.'));
  const f = await form(req);
  const volta = (t, m) => redir(res, `/painel/lojas/${loja.id}/checkout?${t}=${q(m)}`);
  const antigo = JSON.parse(loja.checkout || '{}');
  const g = f.gateway || '';
  if (g && !checkout.GATEWAYS[g]) return volta('erro', 'Escolha um tipo de checkout.');

  const produtos = [];
  for (let i = 0; i < 10; i++) {
    const nome = String(f['p_nome_' + i] || '').trim().slice(0, 120);
    if (!nome) continue;
    const valor = centavos(f['p_valor_' + i]);
    const link = String(f['p_link_' + i] || '').trim();
    if (g !== 'link' && g !== 'whatsapp' && !valor) return volta('erro', `Informe o valor do produto "${nome}".`);
    if (link && !RE_URL.test(link)) return volta('erro', `O link do produto "${nome}" precisa começar com https://`);
    produtos.push({ nome, valor_centavos: valor || 0, link: g === 'link' ? link : '' });
  }
  const ck = { gateway: g, produtos, mp_token: antigo.mp_token || '', stripe_key: antigo.stripe_key || '' };
  ck.link = String(f.link || '').trim();
  if (ck.link && !RE_URL.test(ck.link)) return volta('erro', 'O link do checkout precisa começar com https://');

  const mp = String(f.mp_token || '').trim();
  if (mp) {
    if (!/^(APP_USR|TEST)-[\w-]{20,}$/.test(mp)) return volta('erro', 'Access Token do Mercado Pago inválido. Ele começa com APP_USR-');
    ck.mp_token = cripto.cifrar(mp);
  }
  const sk = String(f.stripe_key || '').trim();
  if (sk) {
    if (!/^(sk|rk)_(live|test)_\w{10,}$/.test(sk)) return volta('erro', 'Chave do Stripe inválida. Ela começa com sk_live_ ou sk_test_');
    ck.stripe_key = cripto.cifrar(sk);
  }
  ck.pix_chave = String(f.pix_chave || '').trim().slice(0, 77);
  ck.pix_nome = String(f.pix_nome || '').trim().slice(0, 25);
  ck.pix_cidade = String(f.pix_cidade || '').trim().slice(0, 15);
  ck.whats_msg = String(f.whats_msg || '').trim().slice(0, 300);
  ck.whats_numero = whats(g === 'pix' ? f.whats_pix : f.whats_numero);

  if (g === 'link' && !ck.link && !produtos.some((p) => p.link)) return volta('erro', 'Informe o link do checkout.');
  if (g === 'mercadopago' && !ck.mp_token) return volta('erro', 'Informe o Access Token do Mercado Pago.');
  if (g === 'stripe' && !ck.stripe_key) return volta('erro', 'Informe a chave secreta do Stripe.');
  if (g === 'pix' && (!ck.pix_chave || !ck.pix_nome)) return volta('erro', 'Informe a chave Pix e o nome do recebedor.');
  if (g === 'whatsapp' && ck.whats_numero.length < 12) return volta('erro', 'Informe o número de WhatsApp com DDD.');
  if ((g === 'mercadopago' || g === 'stripe' || g === 'pix') && !produtos.length) return volta('erro', 'Cadastre pelo menos um produto com nome e valor.');

  db.prepare('UPDATE lojas SET checkout = ? WHERE id = ?').run(JSON.stringify(ck), loja.id);
  volta('ok', 'Checkout salvo! Os botões de compra da loja já usam este checkout.');
});

rota('POST', '/painel/lojas/:id/renovar', async (req, res, c) => {
  if (!precisa(c, res)) return;
  const loja = db.prepare('SELECT * FROM lojas WHERE id = ? AND user_id = ?').get(+c.params.id, c.user.id);
  if (!loja) return redir(res, '/painel?erro=' + q('Loja não encontrada.'));
  const f = await form(req);
  const plano = db.prepare('SELECT * FROM planos WHERE id = ? AND ativo = 1').get(f.plano);
  if (!plano) return redir(res, '/painel?erro=' + q('Escolha um plano.'));
  const eCpf = salvarCpf(c.user, f);
  if (eCpf) return redir(res, '/painel?erro=' + q(eCpf));
  try {
    redir(res, await billing.criarCobranca(c.user, loja, plano));
  } catch (e) {
    console.error('Cobrança falhou:', e.message);
    redir(res, '/painel?erro=' + q('Não foi possível gerar a cobrança: ' + e.message));
  }
});

rota('POST', '/painel/upload', async (req, res, c) => {
  if (!c.user) return json(res, 401, { erro: 'Faça login novamente.' });
  let b;
  try { b = await corpoJson(req, 8e6); } catch (e) { return json(res, 413, { erro: 'Imagem grande demais (máx. 5 MB).' }); }
  const m = String(b.data || '').match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return json(res, 400, { erro: 'Formato não suportado. Use PNG, JPG, WEBP ou GIF.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) return json(res, 413, { erro: 'Imagem grande demais (máx. 5 MB).' });
  const nome = crypto.randomBytes(12).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(UP, nome), buf);
  json(res, 200, { url: '/uploads/' + nome });
});

// --- pagamento do aluguel
const meuPagamento = (c, id) =>
  db.prepare('SELECT p.* FROM pagamentos p JOIN lojas l ON l.id = p.loja_id WHERE p.id = ? AND l.user_id = ?').get(id, c.user.id);

rota('GET', '/pagar/:id', (req, res, c) => {
  if (!precisa(c, res)) return;
  const pg = meuPagamento(c, +c.params.id);
  if (!pg) return redir(res, '/painel?erro=' + q('Pagamento não encontrado.'));
  if (pg.gateway === 'asaas') return redir(res, pg.link || '/painel');
  const loja = db.prepare('SELECT * FROM lojas WHERE id = ?').get(pg.loja_id);
  const plano = db.prepare('SELECT * FROM planos WHERE id = ?').get(pg.plano_id);
  const s = S.all();
  const pixPayload = pg.gateway === 'pix' && s.pix_chave && pg.status === 'pendente'
    ? pix.payload({ chave: s.pix_chave, nome: s.pix_nome, cidade: s.pix_cidade, valor: pg.valor_centavos / 100, txid: 'ALUGUEL' + pg.id })
    : null;
  enviar(res, 200, V.pagar({ user: c.user, pg, loja, plano, modo: pg.gateway, pixPayload }));
});

rota('POST', '/pagar/:id/simular', (req, res, c) => {
  if (!precisa(c, res)) return;
  const pg = meuPagamento(c, +c.params.id);
  if (!pg || pg.gateway !== 'teste' || billing.modo() !== 'teste') return redir(res, '/painel?erro=' + q('Simulação indisponível.'));
  billing.confirmar(pg.id);
  redir(res, '/painel?ok=' + q('Pagamento aprovado (modo teste). Sua loja está no ar!'));
});

rota('POST', '/pagar/:id/informar', async (req, res, c) => {
  if (!c.user) return json(res, 401, { erro: 'Faça login novamente.' });
  const pg = meuPagamento(c, +c.params.id);
  if (!pg || pg.status !== 'pendente') return json(res, 404, { erro: 'Pagamento não encontrado.' });
  let b;
  try { b = await corpoJson(req, 8e6); } catch (e) { return json(res, 413, { erro: 'Arquivo grande demais (máx. 5 MB).' }); }
  let arquivo = pg.comprovante;
  if (b.comprovante) {
    const m = String(b.comprovante).match(/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return json(res, 400, { erro: 'Envie uma imagem (PNG, JPG, WEBP) ou PDF.' });
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 5 * 1024 * 1024) return json(res, 413, { erro: 'Arquivo grande demais (máx. 5 MB).' });
    const ext = m[1] === 'application/pdf' ? 'pdf' : m[2] === 'jpeg' ? 'jpg' : m[2];
    arquivo = `${pg.id}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(COMP, arquivo), buf);
  }
  db.prepare('UPDATE pagamentos SET informado_em = ?, comprovante = ? WHERE id = ?').run(Date.now(), arquivo, pg.id);
  json(res, 200, { ok: true });
});

rota('POST', '/webhooks/asaas', async (req, res) => {
  const token = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!token) return json(res, 503, { erro: 'Defina ASAAS_WEBHOOK_TOKEN no .env' });
  if (req.headers['asaas-access-token'] !== token) return json(res, 401, { erro: 'token inválido' });
  let b;
  try { b = await corpoJson(req, 1e6); } catch (_) { return json(res, 400, { erro: 'json inválido' }); }
  if (b.event === 'PAYMENT_RECEIVED' || b.event === 'PAYMENT_CONFIRMED') {
    const p = b.payment || {};
    const pg = db.prepare('SELECT * FROM pagamentos WHERE id = ? AND gateway_id = ?').get(+p.externalReference, String(p.id || ''));
    if (pg && billing.confirmar(pg.id)) console.log(`Pagamento ${pg.id} confirmado pelo Asaas.`);
  }
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ servidor
if (process.env.VERCEL) {
  console.error(
    'ATENÇÃO: a Vercel não serve para este sistema. Ele precisa de um servidor sempre ligado e de disco para guardar ' +
      'banco, fotos e arquivos (a Vercel apaga tudo). Use Railway, Render, Fly.io ou uma VPS — veja o README.'
  );
}
seed();
limparAssets();
setInterval(limparAssets, 6 * 3600e3).unref();

http
  .createServer(async (req, res) => {
    try {
      const host = hostname(req);
      const url = new URL(req.url, 'http://local');

      if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
        if (!assetPermitido(req)) return enviar(res, 403, paginaIndisponivel('Acesso direto a arquivos não é permitido'));
        return servirArquivo(res, UP, url.pathname.slice(9), { 'Cache-Control': 'private, max-age=3600' });
      }
      // Arquivos dos templates (CSS, JS, imagens, fontes, vídeos...) — em qualquer domínio
      if (req.method === 'GET' && url.pathname.startsWith('/a/')) {
        const m = url.pathname.match(/^\/a\/([a-f0-9]{16})\/(.+)$/);
        let rel = null;
        try { rel = m && caminhoSeguro(decodeURIComponent(m[2])); } catch (_) {}
        if (!rel) return enviar(res, 404, 'Não encontrado');
        return servirAsset(req, res, m[1], rel);
      }
      if (req.method === 'PUT' && url.pathname.startsWith('/admin/assets/')) return await receberAsset(req, res, auth.getUser(req), url.pathname);

      // Subdomínio = loja pública (ex.: minhaloja.seudominio.com)
      if (host !== cfg.BASE_DOMAIN && host.endsWith('.' + cfg.BASE_DOMAIN)) {
        const slug = host.slice(0, -(cfg.BASE_DOMAIN.length + 1));
        if (url.pathname === '/') return servirLoja(req, res, slug);
        if (url.pathname === '/checkout') return await servirCheckout(req, res, slug, url.searchParams);
        if (url.pathname.startsWith('/static/')) return servirArquivo(res, PUB, url.pathname.slice(8));
        return servirArquivoLoja(req, res, slug, url.pathname, '/');
      }

      // Loja pelo caminho (ex.: seudominio.com/loja/minhaloja/) — usado nos domínios gratuitos das hospedagens
      const ml = url.pathname.match(/^\/loja\/([a-z0-9-]+)(\/.*)?$/i);
      if (req.method === 'GET' && ml) {
        const slug = ml[1].toLowerCase();
        const resto = ml[2] || '';
        if (!resto) return redir(res, `/loja/${slug}/${url.search}`);
        if (resto === '/') return servirLoja(req, res, slug);
        if (resto === '/checkout') return await servirCheckout(req, res, slug, url.searchParams);
        return servirArquivoLoja(req, res, slug, resto, `/loja/${slug}/`);
      }

      if (req.method === 'GET' && url.pathname.startsWith('/static/')) return servirArquivo(res, PUB, url.pathname.slice(8));

      const user = auth.getUser(req);
      for (const r of rotas) {
        if (r.metodo !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        if (req.method === 'POST' && !url.pathname.startsWith('/webhooks/') && !mesmaOrigem(req)) {
          return enviar(res, 403, 'Origem da requisição inválida.');
        }
        return await r.handler(req, res, { user: user && !user.bloqueado ? user : null, params: m.groups || {}, query: url.searchParams });
      }
      enviar(res, 404, V.simples({ user, titulo: 'Página não encontrada', texto: 'O endereço que você abriu não existe.' }));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) enviar(res, e.status || 500, e.status === 413 ? 'Conteúdo grande demais.' : 'Erro interno.');
    }
  })
  .listen(cfg.PORT, () => {
    console.log(`\n${S.get('nome_saas')} rodando`);
    console.log(`  Painel:          ${cfg.urlPainel}`);
    console.log(`  Loja de exemplo: ${cfg.urlLoja('nomedaloja')}`);
    console.log(`  Aluguel:         ${billing.modo()}\n`);
  });
