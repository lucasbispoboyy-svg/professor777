'use strict';
const fs = require('fs');
const path = require('path');

const arquivo = path.join(__dirname, '..', '.env');
let carregado = false;

function load() {
  if (carregado) return;
  carregado = true;
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// Grava no .env. Em hospedagens sem disco gravável devolve false (sem quebrar o sistema).
function append(chave, valor) {
  process.env[chave] = valor;
  try {
    fs.appendFileSync(arquivo, `\n${chave}=${valor}`);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { load, append, arquivo };
