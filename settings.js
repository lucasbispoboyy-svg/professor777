'use strict';
// Configurações do site editáveis pelo dono no painel admin
const db = require('./db');

const PADRAO = {
  nome_saas: 'AlugaLoja',
  cor: '#6d28d9',
  home_titulo: 'Alugue uma loja pronta e comece a vender hoje',
  home_subtitulo: 'Escolha um modelo, coloque seus produtos, preços e o seu checkout. Sem programar, sem esperar.',
  whatsapp: '',
  horario: 'Seg a Sex, das 9h às 18h',
  aviso_painel: '',
  termos: 'É proibido copiar, baixar ou reproduzir os modelos fora da plataforma. O acesso pode ser cancelado em caso de violação.',
  cadastro_aberto: '1',
  trial_horas: '0',
  cobranca: 'pix',
  pix_chave: '',
  pix_nome: '',
  pix_cidade: '',
  pix_instrucoes: 'Depois de pagar, clique em "Já paguei" e envie o comprovante. A liberação é feita no horário de atendimento.',

  // Página inicial (editável em Admin → Página inicial)
  home_selo: 'Lojas prontas para dropshipping',
  home_cta: '',
  home_cta2: 'Ver modelos',
  home_vitrine: '',
  home_banner: '',
  mostrar_provas: '1',
  mostrar_recursos: '1',
  rec1_t: 'No ar em minutos',
  rec1_d: 'Escolha o modelo, troque textos, fotos e preços. Sem programar.',
  rec2_t: 'Seu checkout',
  rec2_d: 'Pix, Mercado Pago, Stripe, Yampi, CartPanda ou WhatsApp. O dinheiro vai direto para você.',
  rec3_t: 'Protegida contra cópia',
  rec3_d: 'Código cifrado e bloqueio de ferramentas de cópia. Seu modelo fica só seu.',
  modelos_titulo: 'Modelos disponíveis',
  modelos_sub: 'Veja ao vivo e escolha o que combina com o seu produto.',
  mostrar_passos: '1',
  passos_titulo: 'Como funciona',
  passo1_t: 'Escolha o modelo',
  passo1_d: 'Crie sua conta e escolha a loja que mais combina com o seu produto.',
  passo2_t: 'Personalize',
  passo2_d: 'Troque textos, preços e fotos e conecte o seu checkout.',
  passo3_t: 'Comece a vender',
  passo3_d: 'Sua loja fica no ar no seu endereço e você divulga onde quiser.',
  planos_titulo: 'Planos',
  planos_sub: 'Sem fidelidade. Renove quando quiser.',
  mostrar_cta: '1',
  cta_titulo: 'Pronto para colocar sua loja no ar?',
  cta_texto: '',
  rodape_texto: 'Lojas prontas para alugar, com seu checkout e proteção contra cópia.',
};

let cache = null;

function all() {
  if (!cache) {
    cache = { ...PADRAO };
    for (const r of db.prepare('SELECT chave, valor FROM config').all()) cache[r.chave] = r.valor;
  }
  return cache;
}

const get = (k) => all()[k];

function set(obj) {
  const st = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
  for (const [k, v] of Object.entries(obj)) if (k in PADRAO) st.run(k, String(v));
  cache = null;
}

module.exports = { all, get, set, PADRAO };
