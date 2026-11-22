'use strict';
// Gera o "Pix copia e cola" (BR Code estático, padrão do Banco Central) com valor
function campo(id, v) {
  v = String(v);
  return id + String(v.length).padStart(2, '0') + v;
}

function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      c = c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1;
      c &= 0xffff;
    }
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}

function limpar(s, n) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,-]/g, '')
    .trim()
    .slice(0, n);
}

function normalizarChave(k) {
  k = String(k || '').trim();
  if (k.includes('@')) return k.toLowerCase();
  const d = k.replace(/\D/g, '');
  if (k.startsWith('+')) return '+' + d;
  if (/^[\d.\-\/\s]+$/.test(k) && (d.length === 11 || d.length === 14)) return d; // CPF ou CNPJ
  return k; // chave aleatória
}

function payload({ chave, nome, cidade, valor, txid }) {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', normalizarChave(chave));
  let p =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    (valor ? campo('54', Number(valor).toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', limpar(nome, 25) || 'RECEBEDOR') +
    campo('60', limpar(cidade, 15) || 'BRASIL') +
    campo('62', campo('05', String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'));
  p += '6304';
  return p + crc16(p);
}

module.exports = { payload, normalizarChave };
