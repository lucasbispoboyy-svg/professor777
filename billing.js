'use strict';
// Cobrança do aluguel das lojas.
// Modos (Configurações no admin):
//  - pix:   Pix na chave do dono (CNPJ). Cliente avisa "Já paguei" + comprovante; o dono confirma no admin.
//  - asaas: cobrança automática pelo Asaas (precisa ASAAS_API_KEY no .env).
//  - teste: botão de simulação, para testar o sistema.
const db = require('./db');
const S = require('./settings');

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;

function asaasConfigurado() {
  return !!process.env.ASAAS_API_KEY;
}

function modo() {
  const m = S.get('cobranca');
  if (m === 'asaas') return asaasConfigurado() ? 'asaas' : 'teste';
  return m === 'teste' ? 'teste' : 'pix';
}

function baseUrl() {
  return process.env.ASAAS_ENV === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
}

async function api(caminho, corpo) {
  const r = await fetch(baseUrl() + caminho, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', access_token: process.env.ASAAS_API_KEY, 'User-Agent': 'saas-lojas' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.errors && j.errors[0] && j.errors[0].description) || 'Asaas respondeu HTTP ' + r.status);
  return j;
}

// Cria (ou reaproveita) a cobrança de um período e devolve a URL de pagamento
async function criarCobranca(user, loja, plano) {
  const gateway = modo();
  const agora = Date.now();
  const aberta = db
    .prepare("SELECT * FROM pagamentos WHERE loja_id = ? AND plano_id = ? AND gateway = ? AND status = 'pendente' AND criado_em > ? ORDER BY id DESC")
    .get(loja.id, plano.id, gateway, agora - 3 * DIA);
  if (aberta && (gateway !== 'asaas' || aberta.link)) return gateway === 'asaas' ? aberta.link : '/pagar/' + aberta.id;

  const r = db
    .prepare('INSERT INTO pagamentos (loja_id, plano_id, valor_centavos, status, gateway, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
    .run(loja.id, plano.id, plano.preco_centavos, 'pendente', gateway, agora);
  const pid = Number(r.lastInsertRowid);
  if (gateway !== 'asaas') return '/pagar/' + pid;

  let cliente = user.asaas_customer;
  if (!cliente) {
    const c = await api('/customers', { name: user.nome, email: user.email, cpfCnpj: user.cpf, externalReference: String(user.id) });
    cliente = c.id;
    db.prepare('UPDATE users SET asaas_customer = ? WHERE id = ?').run(cliente, user.id);
  }
  const p = await api('/payments', {
    customer: cliente,
    billingType: 'UNDEFINED',
    value: plano.preco_centavos / 100,
    dueDate: new Date(agora + DIA).toISOString().slice(0, 10),
    description: `Aluguel ${plano.nome} da loja ${loja.slug}`,
    externalReference: String(pid),
  });
  db.prepare('UPDATE pagamentos SET gateway_id = ?, link = ? WHERE id = ?').run(p.id, p.invoiceUrl, pid);
  return p.invoiceUrl;
}

// Soma tempo ao prazo da loja (a partir de agora ou do vencimento atual, o que for maior)
function estender(lojaId, ms) {
  const loja = db.prepare('SELECT * FROM lojas WHERE id = ?').get(lojaId);
  if (!loja) return;
  const inicio = Math.max(Date.now(), loja.vence_em);
  db.prepare('UPDATE lojas SET vence_em = ? WHERE id = ?').run(inicio + ms, lojaId);
}

// Marca como pago e estende o prazo. Retorna true se aplicou agora.
function confirmar(pagamentoId) {
  db.exec('BEGIN');
  try {
    const pg = db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(pagamentoId);
    if (!pg || pg.status === 'pago') {
      db.exec('COMMIT');
      return false;
    }
    const plano = db.prepare('SELECT * FROM planos WHERE id = ?').get(pg.plano_id);
    const dias = plano ? plano.dias : 30;
    estender(pg.loja_id, dias * DIA);
    if (plano) db.prepare('UPDATE lojas SET plano_id = ? WHERE id = ?').run(plano.id, pg.loja_id);
    db.prepare("UPDATE pagamentos SET status = 'pago', pago_em = ? WHERE id = ?").run(Date.now(), pg.id);
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function recusar(pagamentoId) {
  db.prepare("UPDATE pagamentos SET status = 'recusado' WHERE id = ? AND status = 'pendente'").run(pagamentoId);
}

module.exports = { modo, asaasConfigurado, criarCobranca, confirmar, recusar, estender, DIA, HORA };
