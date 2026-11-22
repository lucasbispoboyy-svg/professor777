'use strict';
// Guarda chaves de gateway dos clientes cifradas no banco (AES-256-GCM)
const crypto = require('crypto');
require('./config'); // garante APP_SECRET (no .env ou em DATA_DIR/segredos.json)

const CHAVE = crypto.createHash('sha256').update(process.env.APP_SECRET).digest();

function cifrar(texto) {
  if (!texto) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', CHAVE, iv);
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decifrar(s) {
  if (!s || !String(s).startsWith('v1:')) return '';
  try {
    const b = Buffer.from(String(s).slice(3), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', CHAVE, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

module.exports = { cifrar, decifrar };
