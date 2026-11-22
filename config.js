'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const env = require('./env');

env.load();

// ------------------------------------------------------------------ pasta de dados
// Banco, fotos, comprovantes e arquivos dos templates. Em Railway/Render/Fly aponte para o volume (ex.: /data).
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

// Segredos gerados sozinhos: vão para o .env; se não der para gravar nele, ficam em DATA_DIR/segredos.json
const ARQ_SEGREDOS = path.join(DATA_DIR, 'segredos.json');
let segredos = {};
try { segredos = JSON.parse(fs.readFileSync(ARQ_SEGREDOS, 'utf8')); } catch (_) {}
for (const [k, v] of Object.entries(segredos)) if (process.env[k] === undefined) process.env[k] = v;

function garantir(nome, gerar) {
  if (process.env[nome]) return;
  const valor = gerar();
  if (env.append(nome, valor)) return;
  segredos[nome] = valor;
  try {
    fs.writeFileSync(ARQ_SEGREDOS, JSON.stringify(segredos, null, 2), { mode: 0o600 });
    console.log(`${nome} gerado e salvo em ${ARQ_SEGREDOS}`);
  } catch (e) {
    console.warn(`Não foi possível salvar ${nome}. Defina essa variável nas configurações da hospedagem.`);
  }
}
garantir('ADMIN_EMAIL', () => 'admin@painel.local');
garantir('ADMIN_PASSWORD', () => crypto.randomBytes(9).toString('base64url'));
garantir('APP_SECRET', () => crypto.randomBytes(32).toString('hex'));

// ------------------------------------------------------------------ endereço público
// Detecta sozinho Railway, Render e Fly.io
const PLATAFORMA =
  process.env.RAILWAY_PUBLIC_DOMAIN ||
  process.env.RENDER_EXTERNAL_HOSTNAME ||
  (process.env.FLY_APP_NAME ? process.env.FLY_APP_NAME + '.fly.dev' : '') ||
  '';
if (PLATAFORMA && process.env.TRUST_PROXY === undefined) process.env.TRUST_PROXY = '1';

const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_DOMAIN = (process.env.BASE_DOMAIN || PLATAFORMA || 'localhost').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const PROTO = process.env.PUBLIC_PROTO || (BASE_DOMAIN === 'localhost' ? 'http' : 'https');
const PUBLIC_PORT = process.env.PUBLIC_PORT !== undefined ? process.env.PUBLIC_PORT : PROTO === 'https' ? '' : String(PORT);
const sufixoPorta =
  PUBLIC_PORT === '' || (PUBLIC_PORT === '80' && PROTO === 'http') || (PUBLIC_PORT === '443' && PROTO === 'https') ? '' : ':' + PUBLIC_PORT;

// Lojas no endereço "dominio.com/loja/nome/" em vez de "nome.dominio.com".
// Automático nos domínios gratuitos das hospedagens (não aceitam subdomínio por loja).
const DOMINIO_GRATIS = /\.(railway\.app|onrender\.com|fly\.dev|vercel\.app|herokuapp\.com|netlify\.app)$/i;
const LOJA_POR_CAMINHO =
  process.env.LOJA_POR_CAMINHO !== undefined ? process.env.LOJA_POR_CAMINHO === '1' : DOMINIO_GRATIS.test(BASE_DOMAIN);

const urlPainel = `${PROTO}://${BASE_DOMAIN}${sufixoPorta}`;
const urlLoja = (slug) => (LOJA_POR_CAMINHO ? `${urlPainel}/loja/${slug}/` : `${PROTO}://${slug}.${BASE_DOMAIN}${sufixoPorta}`);
const urlCheckout = (slug) => (LOJA_POR_CAMINHO ? `${urlLoja(slug)}checkout` : `${urlLoja(slug)}/checkout`);
const dominioLoja = (slug) => (LOJA_POR_CAMINHO ? `${BASE_DOMAIN}/loja/${slug}` : `${slug}.${BASE_DOMAIN}`);

module.exports = {
  PORT,
  BASE_DOMAIN,
  PROTO,
  DATA_DIR,
  LOJA_POR_CAMINHO,
  NOME: process.env.NOME_SAAS || 'AlugaLoja',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  cookieSeguro: PROTO === 'https',
  urlPainel,
  urlLoja,
  urlCheckout,
  dominioLoja,
};
