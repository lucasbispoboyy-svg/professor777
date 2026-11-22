'use strict';
const path = require('path');
const fs = require('fs');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('Este projeto precisa do Node.js 22.13 ou mais novo (de preferência a versão LTS 24).');
  process.exit(1);
}

const { DATA_DIR } = require('./config');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'saas.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cliente',
  cpf TEXT,
  asaas_customer TEXT,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  html TEXT NOT NULL,
  campos TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS planos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  dias INTEGER NOT NULL,
  preco_centavos INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lojas (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  slug TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  valores TEXT NOT NULL DEFAULT '{}',
  plano_id TEXT NOT NULL,
  vence_em INTEGER NOT NULL DEFAULT 0,
  suspensa INTEGER NOT NULL DEFAULT 0,
  marca TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  plano_id TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  gateway TEXT NOT NULL,
  gateway_id TEXT,
  link TEXT,
  criado_em INTEGER NOT NULL,
  pago_em INTEGER
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);
`);

// Migrações (colunas novas em bancos já existentes)
function addCol(tabela, coluna, def) {
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
  if (!cols.includes(coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${def}`);
}
addCol('users', 'telefone', 'TEXT');
addCol('users', 'bloqueado', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'ultimo_login', 'INTEGER');
addCol('users', 'trial_usado', 'INTEGER NOT NULL DEFAULT 0');
addCol('users', 'obs', 'TEXT');
addCol('lojas', 'checkout', "TEXT NOT NULL DEFAULT '{}'");
addCol('pagamentos', 'comprovante', 'TEXT');
addCol('pagamentos', 'informado_em', 'INTEGER');
addCol('planos', 'ativo', 'INTEGER NOT NULL DEFAULT 1');
addCol('templates', 'assets', 'TEXT');
addCol('templates', 'assets_base', "TEXT NOT NULL DEFAULT ''");

if (!db.prepare('SELECT 1 FROM planos').get()) {
  db.exec(`INSERT INTO planos (id, nome, dias, preco_centavos) VALUES ('semanal', 'Semanal', 7, 2990), ('mensal', 'Mensal', 30, 8990)`);
}

module.exports = db;
