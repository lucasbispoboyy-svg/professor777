'use strict';
const crypto = require('crypto');
const db = require('./db');
const cfg = require('./config');

const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;

function hash(senha) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}

function verify(senha, salvo) {
  const [salt, h] = String(salvo).split(':');
  if (!salt || !h) return false;
  const calc = crypto.scryptSync(senha, Buffer.from(salt, 'hex'), 64);
  const esperado = Buffer.from(h, 'hex');
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}

function parseCookies(req) {
  const out = {};
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) {
      try {
        out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
      } catch (_) {}
    }
  }
  return out;
}

function criarSessao(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expira_em) VALUES (?, ?, ?)').run(token, userId, Date.now() + TRINTA_DIAS);
  return token;
}

function getUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expira_em > ?')
    .get(token, Date.now()) || null;
}

function encerrar(req) {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function cookie(token, maxAge = TRINTA_DIAS / 1000) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.cookieSeguro ? '; Secure' : ''}`;
}

// Limite simples de tentativas de login por IP
const tentativas = new Map();
function bloqueado(ip) {
  const t = tentativas.get(ip);
  if (!t) return false;
  if (Date.now() - t.inicio > 15 * 60 * 1000) {
    tentativas.delete(ip);
    return false;
  }
  return t.n >= 10;
}
function falhou(ip) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.inicio > 15 * 60 * 1000) tentativas.set(ip, { n: 1, inicio: Date.now() });
  else t.n++;
}

module.exports = { hash, verify, criarSessao, getUser, encerrar, cookie, bloqueado, falhou };
