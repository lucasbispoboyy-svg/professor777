'use strict';
const cfg = require('./config');
const S = require('./settings');
const db = require('./db');
const { GATEWAYS, mascarar } = require('./checkout');
const { scriptProtecao } = require('./protect');

// Muda a cada reinício: força o navegador a baixar CSS/JS novos
const VERSAO = Date.now().toString(36);

const esc = (s) =>
  String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = (c) => (c / 100).toFixed(2).replace('.', ',');
const dt = (ms) =>
  ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const jsonSeguro = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const dominio = (slug) => cfg.dominioLoja(slug);
const periodo = (dias) => (dias === 1 ? 'dia' : dias === 7 ? 'semana' : dias === 30 ? 'mês' : dias + ' dias');
const waLink = (num, txt) => `https://wa.me/${String(num).replace(/\D/g, '')}${txt ? '?text=' + encodeURIComponent(txt) : ''}`;

function estado(l) {
  if (l.suspensa) return ['Suspensa', 'err'];
  if (!l.vence_em) return ['Aguardando pagamento', 'warn'];
  if (l.vence_em < Date.now()) return ['Vencida', 'err'];
  if (l.plano_id === 'trial') return ['Teste grátis', 'info'];
  return ['Ativa', 'ok'];
}
const badge = ([t, k]) => `<span class="badge b-${k}">${esc(t)}</span>`;
const avisos = (m) =>
  (m && m.ok ? `<div class="msg ok">${esc(m.ok)}</div>` : '') + (m && m.erro ? `<div class="msg erro">${esc(m.erro)}</div>` : '');

function restante(ms) {
  const d = ms - Date.now();
  if (d <= 0) return 'vencida';
  const h = Math.floor(d / 3600e3);
  return h >= 48 ? `${Math.floor(h / 24)} dias` : h >= 1 ? `${h} h` : `${Math.max(1, Math.floor(d / 60e3))} min`;
}

// ------------------------------------------------------------------ layout
function pagina({ titulo, user, ativo = '', corpo, scripts = '', largo = false }) {
  const s = S.all();
  let nav = [];
  if (user && user.role === 'admin') {
    const n = db.prepare("SELECT COUNT(*) AS n FROM pagamentos WHERE status = 'pendente' AND informado_em IS NOT NULL").get().n;
    nav = [
      ['/admin', 'Visão geral', 'inicio'],
      ['/admin/membros', 'Membros', 'membros'],
      ['/admin/lojas', 'Lojas', 'lojas'],
      ['/admin/pagamentos', 'Pagamentos' + (n ? ` <span class="pill">${n}</span>` : ''), 'pagamentos'],
      ['/admin/home', 'Página inicial', 'home'],
      ['/admin/templates', 'Templates', 'templates'],
      ['/admin/planos', 'Planos', 'planos'],
      ['/admin/config', 'Configurações', 'config'],
    ];
  } else if (user) nav = [['/painel', 'Minhas lojas', 'painel'], ['/painel/alugar', 'Alugar loja', 'alugar']];
  const cor = /^#[0-9a-f]{6}$/i.test(s.cor) ? s.cor : '#6d28d9';
  const head = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · ${esc(s.nome_saas)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/app.css?v=${VERSAO}"><style>:root{--pri:${cor}}</style></head>`;
  const marca = `<a class="marca" href="/"><span class="logo">${esc(String(s.nome_saas).trim().charAt(0).toUpperCase() || 'A')}</span><span>${esc(s.nome_saas)}</span></a>`;

  // Páginas públicas (início, login, cadastro)
  if (!user) {
    return `${head}<body class="pub"><header class="topo-pub">${marca}
<nav class="pub-nav"><a href="/#modelos">Modelos</a><a href="/#como">Como funciona</a><a href="/#planos">Planos</a></nav>
<div class="dir"><a class="btn sm fantasma" href="/entrar">Entrar</a>${s.cadastro_aberto === '1' ? '<a class="btn sm" href="/cadastrar">Começar agora</a>' : ''}</div></header>
<main class="pub-main">${corpo}</main>
<footer class="rodape-pub"><div>${marca}<p>${esc(s.rodape_texto)}</p></div>
<div><strong>Atendimento</strong><p>${s.whatsapp ? `<a href="${esc(waLink(s.whatsapp))}" target="_blank" rel="noopener">WhatsApp</a><br>` : ''}${esc(s.horario || '')}</p></div>
<div class="copy">© ${new Date().getFullYear()} ${esc(s.nome_saas)}</div></footer>${scripts}</body></html>`;
  }

  const admin = user.role === 'admin';
  const itens = nav
    .map(([h, t, k]) => `<a href="${h}" class="${k === ativo ? 'at' : ''}">${icone(k)}<span>${t}</span></a>`)
    .join('');
  const suporte =
    !admin && s.whatsapp
      ? `<a class="lat-suporte" href="${esc(waLink(s.whatsapp))}" target="_blank" rel="noopener">${icone('whats')}<span><strong>Precisa de ajuda?</strong><small>${esc(s.horario || 'Fale com o suporte')}</small></span></a>`
      : '';
  const iniciais = esc(iniciaisDe(user.nome));
  // Membros: mesmos bloqueios das lojas (F12, Ctrl+U, botão direito, DevTools...). O dono fica livre.
  const cabeca = admin ? head : head.replace('</head>', `<script>${scriptProtecao()}</script></head>`);
  return `${cabeca}<body class="app${admin ? '' : ' protegido'}"><input type="checkbox" id="menu-t" class="menu-t" aria-hidden="true">
<aside class="lateral">${marca}<div class="lat-titulo">${admin ? 'Gestão' : 'Minha conta'}</div><nav>${itens}</nav>${suporte}
<div class="eu"><span class="avatar">${iniciais}</span><div class="eu-txt"><strong>${esc(user.nome)}</strong><small>${admin ? 'Dono' : 'Membro'}</small></div>
<form method="post" action="/sair"><button class="icone-btn" title="Sair" aria-label="Sair">${icone('sair')}</button></form></div></aside>
<label for="menu-t" class="veu" aria-hidden="true"></label>
<div class="conteudo"><header class="barra-m"><label for="menu-t" class="hamb" aria-label="Abrir menu">${icone('menu')}</label>${marca}</header>
<main class="main${largo ? ' largo' : ''}">${corpo}</main></div>${scripts}</body></html>`;
}

function iniciaisDe(nome) {
  const p = String(nome || '?').trim().split(/\s+/);
  return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
}

// Ícones (traço simples, herdam a cor do texto)
const IC = {
  home: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><path d="M7 13h6M7 16.5h10"/>',
  inicio: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  membros: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.2 14.8c1.7.8 2.8 2.5 3.3 5.2"/>',
  lojas: '<path d="M4 9.5 5.6 4h12.8L20 9.5"/><path d="M4 9.5h16v1.2a2.8 2.8 0 0 1-5.3 1.2 2.8 2.8 0 0 1-5.4 0 2.8 2.8 0 0 1-5.3-1.2z"/><path d="M5.5 13v7h13v-7"/>',
  painel: '<path d="M4 9.5 5.6 4h12.8L20 9.5"/><path d="M4 9.5h16v1.2a2.8 2.8 0 0 1-5.3 1.2 2.8 2.8 0 0 1-5.4 0 2.8 2.8 0 0 1-5.3-1.2z"/><path d="M5.5 13v7h13v-7"/>',
  pagamentos: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 15h4"/>',
  templates: '<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M3 9h18"/><path d="M9 20.5V9"/>',
  planos: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  config: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  alugar: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  sair: '<path d="M9 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2H9"/><path d="m16 16.5 4.5-4.5L16 7.5"/><path d="M20.5 12H9"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  whats: '<path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.4-4.2a8.5 8.5 0 1 1 15.6-4.7z"/><path d="M9 9.2c.3 2.6 2.4 4.9 5.6 5.6l1-1.3-1.9-.9-.8.7c-1-.4-2-1.4-2.4-2.4l.7-.8-.9-1.9z"/>',
  dinheiro: '<path d="M12 2.5v19"/><path d="M16.5 6H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H6.5"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  raio: '<path d="M13 2.5 4 13.5h7.5L10.5 21.5 20 10h-7.5z"/>',
  escudo: '<path d="M12 21.5s7.5-3.6 7.5-9.6V5.5L12 2.5 4.5 5.5v6.4c0 6 7.5 9.6 7.5 9.6z"/><path d="m9 12 2 2 4-4"/>',
  cartao: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>',
  alerta: '<path d="M12 9v4.5M12 17.2v.1"/><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  upload: '<path d="M20.5 15v3.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V15"/><path d="m16.5 8-4.5-4.5L7.5 8"/><path d="M12 3.5v12"/>',
  pasta: '<path d="M21.5 18.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h5l2 3h8a2 2 0 0 1 2 2z"/>',
  arquivo: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5"/>',
  zip: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5"/><path d="M10 4v2M10 8v2M10 12v2"/>',
  editar: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  grafico: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
};
const icone = (n, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;

// Cabeçalho padrão das páginas internas
const cabecalho = (titulo, sub, acoes = '') =>
  `<div class="cab"><div><h1>${titulo}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${acoes ? `<div class="cab-acoes">${acoes}</div>` : ''}</div>`;

function cardTemplate(t, acoes) {
  return `<div class="card tpl"><div class="thumb"><iframe src="/templates/${t.id}/preview" loading="lazy" tabindex="-1" title="Prévia de ${esc(t.nome)}"></iframe></div>
<div class="tpl-info"><strong>${esc(t.nome)}</strong><p>${esc(t.descricao || '')}</p><div class="flex">
<a class="btn sm sec" href="/templates/${t.id}/preview" target="_blank" rel="noopener">Ver ao vivo</a>${acoes}</div></div></div>`;
}

// ------------------------------------------------------------------ público
function inicio({ templates, planos }) {
  const s = S.all();
  const aberto = s.cadastro_aberto === '1';
  const trial = parseInt(s.trial_horas, 10) || 0;
  const textoCta = s.home_cta || (aberto ? (trial ? `Testar grátis por ${trial} horas` : 'Criar minha loja') : 'Quero alugar (WhatsApp)');
  const cta = aberto
    ? `<a class="btn grande" href="/cadastrar">${esc(textoCta)}</a>`
    : s.whatsapp
    ? `<a class="btn grande" href="${esc(waLink(s.whatsapp, 'Olá! Quero alugar uma loja.'))}" target="_blank" rel="noopener">${esc(textoCta)}</a>`
    : '';
  const on = (k) => s[k] === '1';
  const maisLongo = planos.reduce((a, p) => (!a || p.dias > a.dias ? p : a), null);
  const pl = planos
    .map((p) => {
      const top = maisLongo && planos.length > 1 && p.id === maisLongo.id;
      return `<div class="card plano${top ? ' top' : ''}">${top ? '<span class="fita">Mais vantajoso</span>' : ''}<div class="pn">${esc(p.nome)}</div>
<div class="pv">${brl(p.preco_centavos)}<small>/${periodo(p.dias)}</small></div>
<ul class="checks"><li>${icone('check')}Loja no ar por ${p.dias} dia(s)</li><li>${icone('check')}Textos, preços e fotos ilimitados</li>
<li>${icone('check')}Seu checkout (Pix, Mercado Pago, Stripe…)</li><li>${icone('check')}Proteção contra cópia</li></ul>
${aberto ? `<a class="btn cheio${top ? '' : ' sec'}" href="/cadastrar">Escolher ${esc(p.nome)}</a>` : cta.replace('grande', 'cheio')}</div>`;
    })
    .join('');
  const ts = templates.length
    ? templates.map((t) => cardTemplate(t, aberto ? `<a class="btn sm" href="/painel/alugar?t=${t.id}">Alugar este</a>` : '')).join('')
    : '<div class="card vazio">Nenhum modelo disponível ainda.</div>';
  const tplVitrine = templates.find((t) => String(t.id) === String(s.home_vitrine)) || templates[0];
  const vitrine = s.home_banner
    ? `<img class="banner-hero" src="${esc(s.home_banner)}" alt="">`
    : tplVitrine
    ? `<div class="janela"><div class="janela-barra"><i></i><i></i><i></i><span>${esc(cfg.dominioLoja('sualoja'))}</span></div>
<div class="janela-tela"><iframe src="/templates/${tplVitrine.id}/preview" tabindex="-1" title="Exemplo de loja"></iframe></div></div>`
    : '';
  const p = (t) => esc(t).replace(/\n/g, '<br>');
  return pagina({
    titulo: 'Lojas prontas para alugar',
    user: null,
    corpo: `<section class="hero"><div class="hero-txt">${s.home_selo ? `<span class="selo-hero">${icone('raio')} ${esc(s.home_selo)}</span>` : ''}
<h1>${esc(s.home_titulo)}</h1><p>${p(s.home_subtitulo)}</p>
<div class="flex">${cta}${s.home_cta2 ? `<a class="btn grande fantasma" href="#modelos">${esc(s.home_cta2)} ${icone('seta')}</a>` : ''}</div>
${on('mostrar_provas') ? `<div class="provas"><div><strong>${templates.length}</strong><span>modelo(s) prontos</span></div><div><strong>5</strong><span>formas de checkout</span></div>
<div><strong>${trial ? trial + 'h' : '100%'}</strong><span>${trial ? 'de teste grátis' : 'protegido contra cópia'}</span></div></div>` : ''}</div>
<div class="hero-visual">${vitrine}</div></section>
${on('mostrar_recursos') ? `<section class="recursos"><div class="recurso">${icone('raio')}<h3>${esc(s.rec1_t)}</h3><p>${p(s.rec1_d)}</p></div>
<div class="recurso">${icone('cartao')}<h3>${esc(s.rec2_t)}</h3><p>${p(s.rec2_d)}</p></div>
<div class="recurso">${icone('escudo')}<h3>${esc(s.rec3_t)}</h3><p>${p(s.rec3_d)}</p></div></section>` : ''}
<div class="sec-cab" id="modelos"><h2>${esc(s.modelos_titulo)}</h2>${s.modelos_sub ? `<p>${p(s.modelos_sub)}</p>` : ''}</div><div class="grid">${ts}</div>
${on('mostrar_passos') ? `<div class="sec-cab" id="como"><h2>${esc(s.passos_titulo)}</h2></div>
<section class="passos"><div><span>1</span><h3>${esc(s.passo1_t)}</h3><p>${p(s.passo1_d)}</p></div>
<div><span>2</span><h3>${esc(s.passo2_t)}</h3><p>${p(s.passo2_d)}</p></div>
<div><span>3</span><h3>${esc(s.passo3_t)}</h3><p>${p(s.passo3_d)}</p></div></section>` : ''}
${planos.length ? `<div class="sec-cab" id="planos"><h2>${esc(s.planos_titulo)}</h2>${s.planos_sub ? `<p>${p(s.planos_sub)}</p>` : ''}</div><div class="grid planos">${pl}</div>` : ''}
${cta && on('mostrar_cta') ? `<section class="cta-final"><h2>${esc(s.cta_titulo)}</h2><p>${p(s.cta_texto || (trial ? `Teste grátis por ${trial} horas, sem cartão.` : 'Leva poucos minutos.'))}</p>${cta}</section>` : ''}`,
  });
}

// Editor da página inicial (painel do dono)
function adminHome({ user, s, templates, msg }) {
  const txt = (k, rotulo, max = 120, dica = '') =>
    `<label for="h_${k}">${rotulo}</label><input id="h_${k}" name="${k}" maxlength="${max}" value="${esc(s[k])}">${dica ? `<p class="dica">${dica}</p>` : ''}`;
  const area = (k, rotulo, max = 400) => `<label for="h_${k}">${rotulo}</label><textarea id="h_${k}" name="${k}" rows="2" maxlength="${max}">${esc(s[k])}</textarea>`;
  const chk = (k, rotulo) => `<label class="chk"><input type="checkbox" name="${k}" value="1" ${s[k] === '1' ? 'checked' : ''}> ${rotulo}</label>`;
  return pagina({
    titulo: 'Página inicial',
    user,
    ativo: 'home',
    largo: true,
    corpo: `${cabecalho('Página inicial', 'Edite a página que as pessoas veem ao chegar no site para alugar uma loja.', `<a class="btn sec" href="/admin/home/preview" target="_blank" rel="noopener">${icone('olho')} Abrir em nova aba</a>`)}${avisos(msg)}
<div class="editor"><form method="post" action="/admin/home" id="form-home">
<div class="card"><h2 class="mt0">Topo (primeira tela)</h2>
${txt('home_selo', 'Selo acima do título (deixe vazio para esconder)', 80)}
${txt('home_titulo', 'Título principal', 120)}
${area('home_subtitulo', 'Texto abaixo do título', 400)}
<div class="duas"><div>${txt('home_cta', 'Texto do botão principal', 60, 'Vazio = automático (ex.: "Testar grátis por 24 horas")')}</div><div>${txt('home_cta2', 'Texto do segundo botão (vazio esconde)', 40)}</div></div>
<label for="h_home_vitrine">Loja de exemplo mostrada ao lado</label><select id="h_home_vitrine" name="home_vitrine"><option value="">O modelo mais recente</option>${templates.map((t) => `<option value="${t.id}" ${String(t.id) === String(s.home_vitrine) ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select>
<div class="img-campo"><label for="h_home_banner">Ou uma imagem própria no lugar da loja de exemplo</label><div class="flex">
<img class="th" id="h_home_banner_th" ${s.home_banner ? `src="${esc(s.home_banner)}"` : ''} alt="">
<div class="cresce"><input id="h_home_banner" name="home_banner" value="${esc(s.home_banner)}" placeholder="Vazio = mostra a loja de exemplo" data-thumb>
<label class="btn sm sec up">Enviar imagem<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-alvo="h_home_banner" hidden></label></div></div></div>
${chk('mostrar_provas', 'Mostrar os números de destaque (modelos, formas de checkout, teste grátis)')}</div>
<div class="card"><h2 class="mt0">Vantagens (3 quadros)</h2>${chk('mostrar_recursos', 'Mostrar esta seção')}
<div class="duas"><div>${txt('rec1_t', 'Vantagem 1 — título', 60)}</div><div>${area('rec1_d', 'Vantagem 1 — texto', 200)}</div>
<div>${txt('rec2_t', 'Vantagem 2 — título', 60)}</div><div>${area('rec2_d', 'Vantagem 2 — texto', 200)}</div>
<div>${txt('rec3_t', 'Vantagem 3 — título', 60)}</div><div>${area('rec3_d', 'Vantagem 3 — texto', 200)}</div></div></div>
<div class="card"><h2 class="mt0">Modelos</h2>${txt('modelos_titulo', 'Título da seção', 80)}${area('modelos_sub', 'Texto da seção', 200)}</div>
<div class="card"><h2 class="mt0">Como funciona (3 passos)</h2>${chk('mostrar_passos', 'Mostrar esta seção')}${txt('passos_titulo', 'Título da seção', 80)}
<div class="duas"><div>${txt('passo1_t', 'Passo 1 — título', 60)}</div><div>${area('passo1_d', 'Passo 1 — texto', 200)}</div>
<div>${txt('passo2_t', 'Passo 2 — título', 60)}</div><div>${area('passo2_d', 'Passo 2 — texto', 200)}</div>
<div>${txt('passo3_t', 'Passo 3 — título', 60)}</div><div>${area('passo3_d', 'Passo 3 — texto', 200)}</div></div></div>
<div class="card"><h2 class="mt0">Planos</h2>${txt('planos_titulo', 'Título da seção', 80)}${area('planos_sub', 'Texto da seção', 200)}
<p class="dica">Os planos e preços são editados em <a href="/admin/planos">Planos</a>.</p></div>
<div class="card"><h2 class="mt0">Chamada final e rodapé</h2>${chk('mostrar_cta', 'Mostrar a faixa de chamada final')}
${txt('cta_titulo', 'Título da chamada final', 100)}${area('cta_texto', 'Texto da chamada final (vazio = automático)', 200)}${area('rodape_texto', 'Texto do rodapé', 200)}
<p class="dica">Nome do site, cor, WhatsApp e horário ficam em <a href="/admin/config">Configurações</a>.</p></div>
<div class="barra fixa"><button class="btn grande">Salvar página inicial</button></div></form>
<div class="prev"><div class="flex entre"><strong>Prévia</strong><small class="mut">Atualiza ao salvar</small></div><iframe src="/admin/home/preview" title="Prévia da página inicial"></iframe></div></div>`,
    scripts: `<script src="/static/editor.js?v=${VERSAO}"></script>`,
  });
}

function ladoAuth() {
  return `<div class="auth-lado"><h2>Sua loja profissional no ar hoje.</h2>
<ul class="checks claro"><li>${icone('check')}Modelos prontos e testados para vender</li><li>${icone('check')}Seu checkout: Pix, Mercado Pago, Stripe e mais</li>
<li>${icone('check')}Edite preços, textos e fotos em minutos</li><li>${icone('check')}Proteção contra cópia do seu site</li></ul></div>`;
}

function entrar({ erro, email }) {
  const s = S.all();
  return pagina({
    titulo: 'Entrar',
    user: null,
    corpo: `<div class="auth-wrap">${ladoAuth()}<div class="auth card"><h1>Bem-vindo de volta</h1><p class="sub">Entre para acessar o seu painel.</p>${avisos({ erro })}
<form method="post" action="/entrar"><label for="email">E-mail</label><input id="email" name="email" type="email" required autocomplete="email" value="${esc(email)}" placeholder="voce@email.com">
<label for="senha">Senha</label><input id="senha" name="senha" type="password" required autocomplete="current-password" placeholder="••••••••">
<button class="btn cheio grande">Entrar</button></form>
<p class="rodape">${s.cadastro_aberto === '1' ? 'Não tem conta? <a href="/cadastrar">Criar conta</a>' : s.whatsapp ? `Ainda não tem acesso? <a href="${esc(waLink(s.whatsapp, 'Olá! Quero alugar uma loja.'))}" target="_blank" rel="noopener">Fale com a gente</a>` : ''}</p></div></div>`,
  });
}

function cadastrar({ erro, v = {} }) {
  const s = S.all();
  if (s.cadastro_aberto !== '1') {
    return pagina({
      titulo: 'Criar conta',
      user: null,
      corpo: `<div class="auth-wrap">${ladoAuth()}<div class="auth card"><h1>Cadastro fechado</h1><p class="sub">O acesso é liberado após o pagamento do aluguel.</p>
${s.whatsapp ? `<a class="btn cheio grande" href="${esc(waLink(s.whatsapp, 'Olá! Quero alugar uma loja.'))}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : ''}
<p class="rodape">Já tem acesso? <a href="/entrar">Entrar</a></p></div></div>`,
    });
  }
  return pagina({
    titulo: 'Criar conta',
    user: null,
    corpo: `<div class="auth-wrap">${ladoAuth()}<div class="auth card"><h1>Criar conta</h1><p class="sub">Em 1 minuto você escolhe o modelo e coloca sua loja no ar.</p>${avisos({ erro })}
<form method="post" action="/cadastrar"><label for="nome">Seu nome</label><input id="nome" name="nome" required maxlength="80" value="${esc(v.nome)}">
<label for="email">E-mail</label><input id="email" name="email" type="email" required autocomplete="email" value="${esc(v.email)}">
<label for="telefone">WhatsApp</label><input id="telefone" name="telefone" inputmode="tel" maxlength="20" placeholder="(11) 90000-0000" value="${esc(v.telefone)}">
<label for="senha">Senha (mínimo 8 caracteres)</label><input id="senha" name="senha" type="password" minlength="8" required autocomplete="new-password">
<label for="senha2">Repita a senha</label><input id="senha2" name="senha2" type="password" minlength="8" required autocomplete="new-password">
<label class="chk"><input type="checkbox" name="termos" value="1" required> <span>Li e aceito os termos de uso: ${esc(s.termos)}</span></label>
<button class="btn cheio grande">Criar conta</button></form><p class="rodape">Já tem conta? <a href="/entrar">Entrar</a></p></div></div>`,
  });
}

// ------------------------------------------------------------------ admin
function linhaLoja(l, volta, comCliente = true) {
  return `<tr><td><strong>${esc(l.nome)}</strong><br><a href="${esc(cfg.urlLoja(l.slug))}" target="_blank" rel="noopener">${esc(dominio(l.slug))}</a></td>
${comCliente ? `<td><a href="/admin/membros/${l.user_id}">${esc(l.cliente)}</a><br><small>${esc(l.email)}</small></td>` : ''}
<td>${esc(l.template)}</td><td>${badge(estado(l))}</td><td>${dt(l.vence_em)}${l.vence_em > Date.now() ? `<br><small>faltam ${restante(l.vence_em)}</small>` : ''}</td>
<td><form method="post" action="/admin/lojas/${l.id}/acao" class="acoes"><input type="hidden" name="volta" value="${esc(volta)}">
<input name="qtd" type="number" min="1" max="3650" value="30" aria-label="Quantidade" class="qtd"><select name="unidade" aria-label="Unidade"><option value="dias">dias</option><option value="horas">horas</option></select>
<button name="acao" value="liberar" class="btn sm">Liberar</button>
${l.suspensa ? '<button name="acao" value="reativar" class="btn sm sec">Reativar</button>' : '<button name="acao" value="suspender" class="btn sm perigo">Suspender</button>'}
<a class="btn sm sec" href="/painel/lojas/${l.id}">Gerenciar</a></form></td></tr>`;
}

function tabelaLojas(lojas, volta, comCliente = true) {
  const cab = `<tr><th>Loja</th>${comCliente ? '<th>Membro</th>' : ''}<th>Modelo</th><th>Status</th><th>Vence em</th><th>Ações</th></tr>`;
  const corpo = lojas.length ? lojas.map((l) => linhaLoja(l, volta, comCliente)).join('') : `<tr><td colspan="6" class="vazio">Nenhuma loja.</td></tr>`;
  return `<div class="tabela"><table><thead>${cab}</thead><tbody>${corpo}</tbody></table></div>`;
}

function adminInicio({ user, stats, vencendo, aguardando, novos, serie, situacao, msg }) {
  const ag = aguardando.length
    ? aguardando
        .map(
          (p) => `<tr><td>${esc(p.cliente)}<br><small>${esc(p.loja)}</small></td><td>${brl(p.valor_centavos)}</td><td>${dt(p.informado_em)}</td>
<td><a class="btn sm" href="/admin/pagamentos">Conferir</a></td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="vazio">Nenhum pagamento aguardando.</td></tr>';
  const stat = (ic, cor, n, l, extra = '') =>
    `<div class="card stat ${extra}"><span class="stat-ic ${cor}">${icone(ic)}</span><div><div class="n">${n}</div><div class="l">${l}</div></div></div>`;
  const totalSituacao = Object.values(situacao).reduce((a, b) => a + b, 0) || 1;
  const sit = [
    ['Pagas no ar', situacao.ativas],
    ['Em teste grátis', situacao.teste],
    ['Vencidas / aguardando', situacao.vencidas],
    ['Suspensas', situacao.suspensas],
  ]
    .map(([t, n]) => `<div class="sit"><div class="flex entre"><span>${t}</span><strong>${n}</strong></div><div class="sit-trilho"><i style="width:${Math.round((n / totalSituacao) * 100)}%"></i></div></div>`)
    .join('');
  const totalSerie = serie.reduce((a, d) => a + d.v, 0);
  return pagina({
    titulo: 'Visão geral',
    user,
    ativo: 'inicio',
    corpo: `${cabecalho(`Olá, ${esc(String(user.nome).split(' ')[0])}`, 'Aqui está o resumo do seu negócio de aluguel de lojas.', '<a class="btn" href="/admin/membros">+ Criar membro</a>')}${avisos(msg)}
${stats.aguardando ? `<a class="alerta-faixa" href="/admin/pagamentos">${icone('alerta')}<span><strong>${stats.aguardando} pagamento(s) para conferir.</strong> Membros avisaram que pagaram o Pix.</span>${icone('seta')}</a>` : ''}
<div class="stats">${stat('lojas', 'c1', stats.ativas, 'Lojas pagas no ar')}${stat('relogio', 'c2', stats.teste, 'Em teste grátis')}
${stat('membros', 'c3', stats.membros, 'Membros')}${stat('dinheiro', 'c4', brl(stats.mes), 'Recebido este mês')}</div>
<div class="grade-dash"><div class="card"><div class="flex entre"><div><h2 class="mt0">Recebido nos últimos 14 dias</h2><p class="dica">Pagamentos de aluguel confirmados</p></div><div class="total-mini">${brl(totalSerie)}</div></div>
${graficoBarras(serie)}</div>
<div class="card"><h2 class="mt0">Situação das lojas</h2>${sit}</div></div>
<div class="duas-cards"><div class="card"><div class="flex entre"><h2 class="mt0">Avisaram que pagaram</h2><a href="/admin/pagamentos">Ver todos</a></div>
<div class="tabela"><table><thead><tr><th>Membro</th><th>Valor</th><th>Avisou em</th><th></th></tr></thead><tbody>${ag}</tbody></table></div></div>
<div class="card"><div class="flex entre"><h2 class="mt0">Novos membros</h2><a href="/admin/membros">Ver todos</a></div>
<div class="tabela"><table><thead><tr><th>Nome</th><th>Cadastro</th></tr></thead><tbody>${
      novos.length ? novos.map((m) => `<tr><td><div class="pessoa"><span class="avatar sm">${esc(iniciaisDe(m.nome))}</span><div><a href="/admin/membros/${m.id}">${esc(m.nome)}</a><small>${esc(m.email)}</small></div></div></td><td>${dt(m.criado_em)}</td></tr>`).join('') : '<tr><td colspan="2" class="vazio">Nenhum ainda.</td></tr>'
    }</tbody></table></div></div></div>
<div class="card"><h2 class="mt0">Vencendo nas próximas 48 horas</h2>${tabelaLojas(vencendo, '/admin')}</div>`,
  });
}

// Gráfico de barras simples (uma série): receita por dia
function graficoBarras(serie) {
  const W = 640, H = 210, pl = 6, pr = 6, pt = 22, pb = 26;
  const bruto = Math.max(...serie.map((d) => d.v), 0);
  const passo = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000].find((p) => p * 2 >= bruto) || Math.ceil(bruto / 2);
  const max = passo * 2;
  const larg = (W - pl - pr) / serie.length;
  const bw = Math.min(22, larg * 0.56);
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  const grade = [0, passo, max]
    .map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" class="g-linha"/><text x="${W - pr}" y="${y(v) - 5}" class="g-rot" text-anchor="end">${v ? brl(v).replace(',00', '') : ''}</text>`)
    .join('');
  const barras = serie
    .map((d, i) => {
      const cx = pl + larg * i + larg / 2;
      const x = cx - bw / 2;
      const h = (H - pt - pb) * (d.v / max);
      const r = Math.min(4, bw / 2, h);
      const topo = H - pb - h;
      const barra = h > 0
        ? `<path class="g-barra" d="M${x},${H - pb} V${topo + r} Q${x},${topo} ${x + r},${topo} H${x + bw - r} Q${x + bw},${topo} ${x + bw},${topo + r} V${H - pb} Z"/>`
        : '';
      const rot = i % 2 === serie.length % 2 ? '' : `<text x="${cx}" y="${H - 8}" class="g-rot" text-anchor="middle">${d.dia}</text>`;
      return `<g class="g-col"><title>${d.dia}: ${brl(d.v)}</title><rect x="${pl + larg * i}" y="${pt}" width="${larg}" height="${H - pt - pb}" class="g-alvo"/>${barra}${rot}</g>`;
    })
    .join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Recebido por dia nos últimos 14 dias">${grade}${barras}</svg>
<details class="tabela-grafico"><summary>Ver em tabela</summary><table><tbody>${serie.map((d) => `<tr><td>${d.dia}</td><td>${brl(d.v)}</td></tr>`).join('')}</tbody></table></details>`;
}

function adminLojas({ user, lojas, filtro, msg }) {
  const f = (v, t) => `<a class="chip ${filtro === v ? 'at' : ''}" href="/admin/lojas${v ? '?f=' + v : ''}">${t}</a>`;
  return pagina({
    titulo: 'Lojas',
    user,
    ativo: 'lojas',
    corpo: `<h1>Lojas</h1><p class="sub">Libere tempo (em dias ou horas), suspenda ou gerencie o conteúdo e o checkout de qualquer loja.</p>${avisos(msg)}
<div class="flex chips">${f('', 'Todas')}${f('ativas', 'No ar')}${f('teste', 'Teste grátis')}${f('vencidas', 'Vencidas / aguardando')}${f('suspensas', 'Suspensas')}</div>
<div class="card">${tabelaLojas(lojas, '/admin/lojas' + (filtro ? '?f=' + filtro : ''))}</div>`,
  });
}

function adminMembros({ user, membros, q, filtro, msg }) {
  const f = (v, t) => `<a class="chip ${filtro === v ? 'at' : ''}" href="/admin/membros?${v ? 'f=' + v + '&' : ''}q=${encodeURIComponent(q || '')}">${t}</a>`;
  const linhas = membros.length
    ? membros
        .map(
          (m) => `<tr><td><div class="pessoa"><span class="avatar sm">${esc(iniciaisDe(m.nome))}</span><div><a href="/admin/membros/${m.id}"><strong>${esc(m.nome)}</strong></a><small>${esc(m.email)}</small></div></div></td>
<td>${m.telefone ? `<a href="${esc(waLink(m.telefone))}" target="_blank" rel="noopener">${esc(m.telefone)}</a>` : '—'}</td>
<td>${m.n_ativas}/${m.n_lojas}</td><td>${m.bloqueado ? badge(['Bloqueado', 'err']) : m.n_ativas ? badge(['Com loja no ar', 'ok']) : badge(['Sem loja no ar', 'mut'])}</td>
<td>${dt(m.criado_em)}</td><td>${dt(m.ultimo_login)}</td><td><a class="btn sm sec" href="/admin/membros/${m.id}">Abrir</a></td></tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="vazio">Nenhum membro encontrado.</td></tr>';
  return pagina({
    titulo: 'Membros',
    user,
    ativo: 'membros',
    corpo: `<div class="flex entre"><div><h1>Membros</h1><p class="sub">Quem tem acesso ao painel. Crie logins para quem já pagou, bloqueie ou libere acesso.</p></div></div>${avisos(msg)}
<details class="card" ${membros.length ? '' : 'open'}><summary class="btn">+ Criar membro</summary>
<form method="post" action="/admin/membros" class="mt"><div class="duas"><div><label for="n_nome">Nome</label><input id="n_nome" name="nome" required maxlength="80"></div>
<div><label for="n_email">E-mail (login)</label><input id="n_email" name="email" type="email" required></div>
<div><label for="n_tel">WhatsApp</label><input id="n_tel" name="telefone" maxlength="20"></div>
<div><label for="n_senha">Senha</label><input id="n_senha" name="senha" minlength="6" placeholder="Em branco = gerar automática"></div></div>
<button class="btn mt">Criar login</button></form></details>
<form class="flex busca" method="get" action="/admin/membros"><input name="q" value="${esc(q)}" placeholder="Buscar por nome, e-mail ou WhatsApp">${filtro ? `<input type="hidden" name="f" value="${esc(filtro)}">` : ''}<button class="btn sec">Buscar</button></form>
<div class="flex chips">${f('', 'Todos')}${f('ativos', 'Com loja no ar')}${f('inativos', 'Sem loja no ar')}${f('bloqueados', 'Bloqueados')}</div>
<div class="card"><div class="tabela"><table><thead><tr><th>Membro</th><th>WhatsApp</th><th>Lojas no ar</th><th>Situação</th><th>Cadastro</th><th>Último acesso</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div></div>`,
  });
}

function adminMembro({ user, m, lojas, pagamentos, templates, msg }) {
  const pgs = pagamentos.length
    ? pagamentos
        .map(
          (p) => `<tr><td>${dt(p.criado_em)}</td><td>${esc(p.loja)}</td><td>${esc(p.plano_id)}</td><td>${brl(p.valor_centavos)}</td>
<td>${p.status === 'pago' ? badge(['Pago', 'ok']) : p.status === 'recusado' ? badge(['Recusado', 'err']) : p.informado_em ? badge(['Avisou que pagou', 'warn']) : badge(['Pendente', 'mut'])}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="vazio">Nenhum pagamento.</td></tr>';
  const acao = (a, t, cls = 'sec', conf = '') =>
    `<form method="post" action="/admin/membros/${m.id}" ${conf ? `onsubmit="return confirm('${conf}')"` : ''}><input type="hidden" name="acao" value="${a}"><button class="btn sm ${cls}">${t}</button></form>`;
  return pagina({
    titulo: m.nome,
    user,
    ativo: 'membros',
    corpo: `<div class="flex entre"><div><h1>${esc(m.nome)} ${m.bloqueado ? badge(['Bloqueado', 'err']) : ''}</h1>
<p class="sub">${esc(m.email)}${m.telefone ? ` · <a href="${esc(waLink(m.telefone))}" target="_blank" rel="noopener">WhatsApp ${esc(m.telefone)}</a>` : ''} · cadastro ${dt(m.criado_em)} · último acesso ${dt(m.ultimo_login)}</p></div>
<a class="btn sec" href="/admin/membros">← Membros</a></div>${avisos(msg)}
<div class="flex acoes-topo">${m.bloqueado ? acao('desbloquear', 'Desbloquear acesso', '') : acao('bloquear', 'Bloquear acesso', 'perigo', 'Bloquear este membro? Ele perde o acesso ao painel e as lojas saem do ar.')}
${m.trial_usado ? acao('trial', 'Permitir novo teste grátis') : ''}${acao('excluir', 'Excluir conta', 'perigo', 'Excluir a conta, as lojas e o histórico deste membro? Não dá para desfazer.')}</div>
<div class="card"><h2 class="mt0">Lojas</h2>${tabelaLojas(lojas, '/admin/membros/' + m.id, false)}
<details class="mt"><summary class="btn sm sec">+ Criar loja para este membro</summary>
<form method="post" action="/admin/membros/${m.id}" class="mt"><input type="hidden" name="acao" value="criar_loja"><div class="duas">
<div><label for="cl_t">Modelo</label><select id="cl_t" name="template">${templates.map((t) => `<option value="${t.id}">${esc(t.nome)}</option>`).join('')}</select></div>
<div><label for="cl_n">Nome da loja</label><input id="cl_n" name="nome" required maxlength="60"></div>
<div><label for="cl_s">Endereço</label><div class="slug"><input id="cl_s" name="slug" required pattern="[a-z0-9][a-z0-9\\-]{1,28}[a-z0-9]" maxlength="30">${cfg.LOJA_POR_CAMINHO ? '' : `<span>.${esc(cfg.BASE_DOMAIN)}</span>`}</div>${cfg.LOJA_POR_CAMINHO ? `<p class="dica">A loja fica em ${esc(cfg.BASE_DOMAIN)}/loja/<b>endereço</b></p>` : ''}</div>
<div><label for="cl_d">Liberar por quantos dias</label><input id="cl_d" name="dias" type="number" min="0" max="3650" value="30"></div></div>
<button class="btn mt">Criar loja</button></form></details></div>
<div class="duas-cards"><div class="card"><h2 class="mt0">Dados</h2><form method="post" action="/admin/membros/${m.id}"><input type="hidden" name="acao" value="dados">
<label for="m_nome">Nome</label><input id="m_nome" name="nome" required maxlength="80" value="${esc(m.nome)}">
<label for="m_email">E-mail (login)</label><input id="m_email" name="email" type="email" required value="${esc(m.email)}">
<label for="m_tel">WhatsApp</label><input id="m_tel" name="telefone" maxlength="20" value="${esc(m.telefone)}">
<label for="m_obs">Anotações (só você vê)</label><textarea id="m_obs" name="obs" rows="3">${esc(m.obs)}</textarea>
<button class="btn mt">Salvar dados</button></form></div>
<div class="card"><h2 class="mt0">Trocar senha</h2><form method="post" action="/admin/membros/${m.id}"><input type="hidden" name="acao" value="senha">
<label for="m_senha">Nova senha</label><input id="m_senha" name="senha" minlength="6" placeholder="Em branco = gerar automática">
<p class="dica">O membro é desconectado e precisa entrar com a nova senha.</p><button class="btn mt">Definir senha</button></form></div></div>
<div class="card"><h2 class="mt0">Pagamentos</h2><div class="tabela"><table><thead><tr><th>Data</th><th>Loja</th><th>Plano</th><th>Valor</th><th>Status</th></tr></thead><tbody>${pgs}</tbody></table></div></div>`,
  });
}

function adminPagamentos({ user, pendentes, historico, msg }) {
  const linhaPend = (p) => `<tr class="${p.informado_em ? 'realce' : ''}"><td><a href="/admin/membros/${p.user_id}">${esc(p.cliente)}</a><br><small>${esc(p.email)}</small></td>
<td>${esc(p.loja)}<br><small>${esc(dominio(p.slug))}</small></td><td>${esc(p.plano_nome || p.plano_id)}</td><td><strong>${brl(p.valor_centavos)}</strong></td>
<td>${dt(p.criado_em)}</td><td>${p.informado_em ? badge(['Avisou que pagou', 'warn']) + `<br><small>${dt(p.informado_em)}</small>` : badge(['Ainda não avisou', 'mut'])}
${p.comprovante ? `<br><a href="/admin/comprovantes/${p.id}" target="_blank" rel="noopener">Ver comprovante</a>` : ''}</td>
<td><form method="post" action="/admin/pagamentos/${p.id}" class="acoes"><button name="acao" value="confirmar" class="btn sm">Confirmar e liberar</button>
<button name="acao" value="recusar" class="btn sm perigo" onclick="return confirm('Recusar este pagamento?')">Recusar</button></form></td></tr>`;
  const hist = historico.length
    ? historico
        .map(
          (p) => `<tr><td>${esc(p.cliente)}</td><td>${esc(p.loja)}</td><td>${brl(p.valor_centavos)}</td><td>${p.status === 'pago' ? badge(['Pago', 'ok']) : badge(['Recusado', 'err'])}</td><td>${dt(p.pago_em || p.criado_em)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="vazio">Nada ainda.</td></tr>';
  return pagina({
    titulo: 'Pagamentos',
    user,
    ativo: 'pagamentos',
    corpo: `<h1>Pagamentos do aluguel</h1><p class="sub">Confira o Pix no seu banco e clique em <b>Confirmar e liberar</b>. O prazo da loja é estendido na hora.</p>${avisos(msg)}
<div class="card"><h2 class="mt0">Aguardando confirmação</h2><div class="tabela"><table><thead><tr><th>Membro</th><th>Loja</th><th>Plano</th><th>Valor</th><th>Gerado em</th><th>Situação</th><th></th></tr></thead>
<tbody>${pendentes.length ? pendentes.map(linhaPend).join('') : '<tr><td colspan="7" class="vazio">Nenhum pagamento pendente.</td></tr>'}</tbody></table></div></div>
<div class="card"><h2 class="mt0">Histórico</h2><div class="tabela"><table><thead><tr><th>Membro</th><th>Loja</th><th>Valor</th><th>Status</th><th>Data</th></tr></thead><tbody>${hist}</tbody></table></div></div>`,
  });
}

function adminTemplates({ user, templates, msg }) {
  const cards = templates.length
    ? templates
        .map((t) =>
          cardTemplate(
            t,
            `<a class="btn sm" href="/admin/templates/${t.id}/editar">Editar campos</a>
<form method="post" action="/admin/templates/${t.id}/excluir" onsubmit="return confirm('Excluir este template? Se houver lojas usando, ele será apenas desativado.')"><button class="btn sm perigo">Excluir</button></form>
<div class="tpl-meta">${t.ativo ? badge(['Disponível', 'ok']) : badge(['Desativado', 'mut'])} <small>${t.lojas} loja(s)</small></div>`
          )
        )
        .join('')
    : '<div class="card vazio">Nenhum template ainda. Envie o index.html do seu primeiro site.</div>';
  return pagina({
    titulo: 'Templates',
    user,
    ativo: 'templates',
    corpo: `<div class="flex entre"><div><h1>Templates</h1><p class="sub">Seus sites prontos que os membros podem alugar.</p></div>
<a class="btn" href="/admin/templates/novo">+ Enviar novo template</a></div>${avisos(msg)}<div class="grid">${cards}</div>`,
  });
}

function adminMapper({ user, tpl }) {
  const dados = tpl
    ? { id: tpl.id, html: tpl.html, campos: tpl.campos, assets: tpl.assets || null, assets_base: tpl.assets_base || '' }
    : { id: null, html: null, campos: [], assets: null, assets_base: '' };
  return pagina({
    titulo: tpl ? 'Editar template' : 'Novo template',
    user,
    ativo: 'templates',
    largo: true,
    corpo: `${cabecalho(tpl ? 'Editar template' : 'Novo template', 'Envie o site e marque o que o membro poderá editar. Todo o resto (layout, cores, estrutura) fica travado.', '<a class="btn sec" href="/admin/templates">← Templates</a>')}
<div class="card"><div class="duas"><div><label for="nome" class="mt0">Nome do template</label><input id="nome" maxlength="80" value="${esc(tpl ? tpl.nome : '')}" placeholder="Ex.: Loja de fones — produto único"></div>
<div><label for="descricao" class="mt0">Descrição curta</label><input id="descricao" maxlength="300" value="${esc(tpl ? tpl.descricao : '')}" placeholder="Aparece para quem vai alugar"></div></div>
<label class="chk"><input type="checkbox" id="ativo" ${!tpl || tpl.ativo ? 'checked' : ''}> Disponível para aluguel</label></div>
<div class="card"><h2 class="mt0">${tpl ? 'Trocar os arquivos do site (opcional)' : 'Arquivos do site'}</h2>
<p class="dica">Envie a <b>pasta inteira</b> do site ou um <b>.zip</b> dela. <b>Todos os arquivos</b> vão junto, em todas as subpastas:
imagens (png, jpg, jpeg, webp, gif, svg, avif, ico…), vídeos (mp4, webm, mov…), áudios, fontes (woff, woff2, ttf, otf), CSS, JavaScript, outras páginas .html, PDFs e qualquer outro tipo.
Os caminhos são ligados sozinhos. Até 100 MB por arquivo.</p>
<div class="envio-opcoes">
<label class="envio-op">${icone('pasta', 'ic grande')}<strong>Enviar pasta</strong><small>A pasta do site, com tudo dentro</small><input type="file" id="pasta" webkitdirectory directory multiple hidden></label>
<label class="envio-op">${icone('zip', 'ic grande')}<strong>Enviar .zip ou .html</strong><small>ZIP da pasta (até 300 MB) ou só o index.html</small><input type="file" id="arquivo" accept=".zip,.html,.htm,application/zip,text/html" hidden></label>
<label class="envio-op">${icone('upload', 'ic grande')}<strong>Adicionar arquivos</strong><small>Faltou algum? Envie arquivos soltos de qualquer tipo</small><input type="file" id="extras" multiple hidden></label></div>
<div id="envio" class="envio-status" hidden><span id="envio-txt"></span><div class="envio-trilho"><i id="envio-barra"></i></div></div>
<p id="info-arquivos" class="msg info mt" hidden></p>
<p class="dica">Dica: na janela de escolher arquivos, aperte <b>Ctrl + A</b> para selecionar todos de uma vez.</p></div>

<div id="gerenciador" class="card" hidden><div class="flex entre"><div><h2 class="mt0">Arquivos do site</h2>
<p class="dica">Veja, edite, troque ou exclua qualquer arquivo. As mudanças valem na hora para todas as lojas que usam este template.</p></div>
<button type="button" class="btn sec" id="editar-index">${icone('editar')} Editar código do index.html</button></div>
<div class="flex ger-barra"><label class="chk inline"><input type="checkbox" id="arq-todos"> Selecionar todos</label>
<input id="arq-busca" placeholder="Buscar arquivo..."><select id="arq-tipo" aria-label="Tipo"><option value="">Todos os tipos</option><option value="img">Imagens</option><option value="css">CSS</option><option value="js">JavaScript</option><option value="html">Páginas</option><option value="fonte">Fontes</option><option value="midia">Vídeos e áudios</option><option value="outro">Outros</option></select>
<button type="button" class="btn sm perigo" id="arq-excluir" disabled>Excluir selecionados</button><span id="arq-resumo" class="mut"></span></div>
<div class="tabela arq-tabela"><table><thead><tr><th></th><th>Arquivo</th><th>Tamanho</th><th></th></tr></thead><tbody id="arq-lista"></tbody></table></div></div>

<dialog id="dlg" class="dlg"><form method="dialog" class="dlg-cab"><strong id="dlg-titulo"></strong><button class="icone-btn escuro" aria-label="Fechar">✕</button></form>
<div id="dlg-corpo" class="dlg-corpo"></div><div class="dlg-pe"><span id="dlg-info" class="mut"></span><button type="button" class="btn sec" id="dlg-cancelar">Cancelar</button><button type="button" class="btn" id="dlg-salvar">Salvar</button></div></dialog>

<div id="area" hidden><div class="mapper"><div class="card lista"><div class="flex entre"><strong>Campos encontrados</strong><span id="contagem" class="mut"></span></div>
<p class="dica">Marque o que o membro pode mudar e dê um nome claro (ex.: "Preço à vista", "Botão comprar"). Clique em <b>Ver</b> para achar o item na prévia. Botões marcados como <b>Link</b> podem ser ligados ao checkout da loja.</p>
<div class="flex marcar-barra"><button type="button" class="btn sm" id="marcar-todos">${icone('check')} Marcar todos</button><button type="button" class="btn sm sec" id="desmarcar-todos">Desmarcar todos</button>
<select id="marcar-tipo" aria-label="Marcar por tipo"><option value="">Marcar só um tipo…</option><option value="texto">Todos os textos</option><option value="preco">Todos os preços</option><option value="imagem">Todas as imagens</option><option value="link">Todos os links/botões</option></select></div>
<div class="flex"><input id="filtro" placeholder="Filtrar campos..."><label class="chk inline"><input type="checkbox" id="soMarcados"> Só marcados</label></div>
<div id="campos"></div></div><div class="prev"><iframe id="previa" sandbox="allow-same-origin" title="Prévia do template"></iframe></div></div>
<div class="barra"><a class="btn sec" href="/admin/templates">Cancelar</a><button class="btn" id="salvar">Salvar template</button></div></div>
<script type="application/json" id="tpl-data">${jsonSeguro(dados)}</script>`,
    scripts: `<script src="/static/mapper.js?v=${VERSAO}"></script>`,
  });
}

function adminPlanos({ user, planos, msg }) {
  const linhas = planos
    .map(
      (p) => `<tr><td colspan="6"><form method="post" action="/admin/planos" class="linha-plano"><input type="hidden" name="id" value="${esc(p.id)}">
<input name="nome" value="${esc(p.nome)}" required maxlength="40" aria-label="Nome">
<input name="dias" type="number" min="1" max="3650" value="${p.dias}" required aria-label="Dias">
<input name="preco" value="${reais(p.preco_centavos)}" required inputmode="decimal" aria-label="Preço">
<label class="chk inline"><input type="checkbox" name="ativo" value="1" ${p.ativo ? 'checked' : ''}> Ativo</label>
<button name="acao" value="salvar" class="btn sm">Salvar</button><button name="acao" value="excluir" class="btn sm perigo" onclick="return confirm('Excluir este plano?')">Excluir</button></form></td></tr>`
    )
    .join('');
  return pagina({
    titulo: 'Planos',
    user,
    ativo: 'planos',
    corpo: `<h1>Planos de aluguel</h1><p class="sub">Crie quantos planos quiser (diário, semanal, quinzenal, mensal...). Planos inativos não aparecem para novos aluguéis.</p>${avisos(msg)}
<div class="card"><div class="cab-plano"><span>Nome</span><span>Dias</span><span>Preço (R$)</span><span></span></div><table class="sem-borda"><tbody>${linhas}</tbody></table></div>
<form class="card" method="post" action="/admin/planos"><h2 class="mt0">Novo plano</h2><input type="hidden" name="acao" value="novo">
<div class="tres"><div><label for="np_n">Nome</label><input id="np_n" name="nome" required maxlength="40" placeholder="Ex.: Quinzenal"></div>
<div><label for="np_d">Duração (dias)</label><input id="np_d" name="dias" type="number" min="1" max="3650" required value="15"></div>
<div><label for="np_p">Preço (R$)</label><input id="np_p" name="preco" required inputmode="decimal" placeholder="49,90"></div></div>
<button class="btn mt">Criar plano</button></form>`,
  });
}

function adminConfig({ user, s, modoAtivo, asaas, msg }) {
  const opt = (v, t) => `<option value="${v}" ${s.cobranca === v ? 'selected' : ''}>${t}</option>`;
  return pagina({
    titulo: 'Configurações',
    user,
    ativo: 'config',
    corpo: `<h1>Configurações</h1><p class="sub">Tudo o que aparece para os membros e como você recebe o aluguel.</p>${avisos(msg)}
<form method="post" action="/admin/config">
<div class="card"><h2 class="mt0">Recebimento do aluguel</h2>
<label for="cobranca">Como os membros pagam</label><select id="cobranca" name="cobranca">${opt('pix', 'Pix na minha chave (eu confirmo manualmente)')}${opt('asaas', 'Asaas (automático)')}${opt('teste', 'Modo teste (botão de simular)')}</select>
${s.cobranca === 'asaas' && !asaas ? '<p class="dica erro-txt">O Asaas precisa da ASAAS_API_KEY no arquivo .env. Enquanto isso, o sistema usa o modo teste.</p>' : ''}
<div class="duas"><div><label for="pix_chave">Chave Pix (CNPJ, e-mail, telefone ou aleatória)</label><input id="pix_chave" name="pix_chave" value="${esc(s.pix_chave)}" placeholder="00.000.000/0001-00"></div>
<div><label for="pix_nome">Nome do recebedor (como está no banco)</label><input id="pix_nome" name="pix_nome" maxlength="25" value="${esc(s.pix_nome)}" placeholder="MINHA EMPRESA LTDA"></div>
<div><label for="pix_cidade">Cidade do recebedor</label><input id="pix_cidade" name="pix_cidade" maxlength="15" value="${esc(s.pix_cidade)}" placeholder="SAO PAULO"></div></div>
<label for="pix_instrucoes">Instruções na tela de pagamento</label><textarea id="pix_instrucoes" name="pix_instrucoes" rows="2">${esc(s.pix_instrucoes)}</textarea>
<p class="dica">Modo atual: <b>${esc(modoAtivo)}</b></p></div>
<div class="card"><h2 class="mt0">Cadastro e teste grátis</h2>
<label class="chk"><input type="checkbox" name="cadastro_aberto" value="1" ${s.cadastro_aberto === '1' ? 'checked' : ''}> <span>Cadastro aberto: qualquer pessoa pode criar conta no site. Desmarque para só você criar os logins (em Membros).</span></label>
<label for="trial_horas">Teste grátis (em horas, 0 = desligado)</label><input id="trial_horas" name="trial_horas" type="number" min="0" max="8760" value="${esc(s.trial_horas)}">
<p class="dica">Ex.: 24 = um dia, 72 = três dias. Cada membro pode fazer um teste (você pode liberar outro na página dele).</p></div>
<div class="card"><h2 class="mt0">Site e marca</h2><div class="duas">
<div><label for="nome_saas">Nome do site</label><input id="nome_saas" name="nome_saas" maxlength="40" required value="${esc(s.nome_saas)}"></div>
<div><label for="cor">Cor principal</label><input id="cor" name="cor" type="color" value="${esc(s.cor)}"></div></div>
<label for="termos">Termos de uso (aceitos no cadastro)</label><textarea id="termos" name="termos" rows="3">${esc(s.termos)}</textarea></div>
<div class="card"><h2 class="mt0">Atendimento</h2><div class="duas">
<div><label for="whatsapp">WhatsApp de suporte</label><input id="whatsapp" name="whatsapp" maxlength="20" value="${esc(s.whatsapp)}" placeholder="5511900000000"></div>
<div><label for="horario">Horário de atendimento</label><input id="horario" name="horario" maxlength="80" value="${esc(s.horario)}"></div></div>
<label for="aviso_painel">Aviso no painel dos membros (opcional)</label><textarea id="aviso_painel" name="aviso_painel" rows="2" placeholder="Ex.: Novo modelo disponível! Confira em Alugar loja.">${esc(s.aviso_painel)}</textarea></div>
<div class="barra fixa"><button class="btn grande">Salvar configurações</button></div></form>`,
  });
}

// ------------------------------------------------------------------ membro
function painel({ user, lojas, pendentes, planos, msg, precisaCpf }) {
  const s = S.all();
  const opts = planos.map((p) => `<option value="${p.id}">${esc(p.nome)} — ${brl(p.preco_centavos)}</option>`).join('');
  const cards = lojas.length
    ? lojas
        .map((l) => {
          const pg = pendentes[l.id];
          const linkPg = pg ? (pg.gateway === 'asaas' ? pg.link || '' : `/pagar/${pg.id}`) : '';
          const ck = JSON.parse(l.checkout || '{}');
          const prazo = l.vence_em
            ? (l.vence_em < Date.now() ? 'Venceu em ' : 'No ar até ') + dt(l.vence_em) + (l.vence_em > Date.now() ? ` (faltam ${restante(l.vence_em)})` : '')
            : 'Aguardando o primeiro pagamento';
          return `<div class="card loja"><div class="flex entre"><strong class="lnome">${esc(l.nome)}</strong>${badge(estado(l))}</div>
<a class="url" href="${esc(cfg.urlLoja(l.slug))}" target="_blank" rel="noopener">${esc(dominio(l.slug))}</a>
<div class="meta">Modelo: ${esc(l.template)} · ${prazo}</div>
<div class="meta">Checkout: ${ck.gateway ? badge([GATEWAYS[ck.gateway].nome, 'ok']) : badge(['Não configurado', 'warn'])}</div>
${pg && linkPg ? `<div class="msg aviso">${pg.informado_em ? `Pagamento de ${brl(pg.valor_centavos)} em análise.` : `Pagamento pendente de ${brl(pg.valor_centavos)}.`} <a class="btn sm" href="${esc(linkPg)}">${pg.informado_em ? 'Ver' : 'Pagar agora'}</a></div>` : ''}
<div class="flex"><a class="btn sm" href="/painel/lojas/${l.id}">Editar loja</a><a class="btn sm sec" href="/painel/lojas/${l.id}/checkout">Checkout</a><a class="btn sm sec" href="${esc(cfg.urlLoja(l.slug))}" target="_blank" rel="noopener">Ver loja</a></div>
${planos.length ? `<form method="post" action="/painel/lojas/${l.id}/renovar" class="renovar flex"><select name="plano" aria-label="Plano">${opts}</select>
${precisaCpf ? '<input name="cpf" placeholder="CPF ou CNPJ" required inputmode="numeric">' : ''}<button class="btn sm sec">${l.vence_em ? 'Renovar' : 'Pagar'}</button></form>` : ''}</div>`;
        })
        .join('')
    : `<div class="card vazio"><p>Você ainda não tem nenhuma loja.</p><a class="btn" href="/painel/alugar">Alugar minha primeira loja</a></div>`;
  return pagina({
    titulo: 'Minhas lojas',
    user,
    ativo: 'painel',
    corpo: `<div class="flex entre"><div><h1>Minhas lojas</h1><p class="sub">Edite produtos, preços e checkout, e acompanhe o prazo do aluguel.</p></div>
<a class="btn" href="/painel/alugar">+ Alugar nova loja</a></div>${s.aviso_painel ? `<div class="msg info">${esc(s.aviso_painel)}</div>` : ''}${avisos(msg)}<div class="grid">${cards}</div>`,
  });
}

function alugar({ user, templates, planos, precisaCpf, trialHoras, erro, v = {} }) {
  const tsel = String(v.template || (templates[0] && templates[0].id) || '');
  const psel = v.plano || (trialHoras ? 'trial' : planos[planos.length - 1] && planos[planos.length - 1].id);
  const ts = templates.length
    ? templates
        .map(
          (t) => `<label class="opcao"><input type="radio" name="template" value="${t.id}" ${String(t.id) === tsel ? 'checked' : ''} required>
<div class="thumb mini"><iframe src="/templates/${t.id}/preview" loading="lazy" tabindex="-1" title="Prévia"></iframe></div>
<strong>${esc(t.nome)}</strong><small>${esc(t.descricao || '')}</small><a href="/templates/${t.id}/preview" target="_blank" rel="noopener">Ver ao vivo ↗</a></label>`
        )
        .join('')
    : '<div class="vazio">Nenhum modelo disponível no momento.</div>';
  const trial = trialHoras
    ? `<label class="opcao plano-op destaque"><input type="radio" name="plano" value="trial" ${psel === 'trial' ? 'checked' : ''} required>
<strong>Teste grátis</strong><span class="pv">${trialHoras} horas<small> sem pagar</small></span></label>`
    : '';
  const ps =
    trial +
    planos
      .map(
        (p) => `<label class="opcao plano-op"><input type="radio" name="plano" value="${p.id}" ${p.id === psel ? 'checked' : ''} required>
<strong>${esc(p.nome)}</strong><span class="pv">${brl(p.preco_centavos)}<small>/${periodo(p.dias)}</small></span></label>`
      )
      .join('');
  return pagina({
    titulo: 'Alugar loja',
    user,
    ativo: 'alugar',
    corpo: `<h1>Alugar uma loja</h1><p class="sub">Escolha o modelo, o endereço e o plano. Depois do pagamento a loja entra no ar.</p>${avisos({ erro })}
<form method="post" action="/painel/alugar"><div class="card"><h2 class="mt0">1. Escolha o modelo</h2><div class="grid">${ts}</div></div>
<div class="card"><h2 class="mt0">2. Dados da loja</h2><div class="duas"><div><label for="nome">Nome da loja</label><input id="nome" name="nome" required maxlength="60" value="${esc(v.nome)}" placeholder="Ex.: Pulse Store"></div>
<div><label for="slug">Endereço da loja</label><div class="slug"><input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9\\-]{1,28}[a-z0-9]" maxlength="30" value="${esc(v.slug)}" placeholder="minhaloja">${cfg.LOJA_POR_CAMINHO ? '' : `<span>.${esc(cfg.BASE_DOMAIN)}</span>`}</div>${cfg.LOJA_POR_CAMINHO ? `<p class="dica">A loja fica em ${esc(cfg.BASE_DOMAIN)}/loja/<b>endereço</b></p>` : ''}
<p class="dica">Só letras minúsculas, números e hífen (3 a 30 caracteres).</p></div></div>
${precisaCpf ? `<label for="cpf">CPF ou CNPJ (para emitir a cobrança)</label><input id="cpf" name="cpf" inputmode="numeric" value="${esc(v.cpf)}">` : ''}</div>
<div class="card"><h2 class="mt0">3. Plano</h2><div class="grid planos">${ps}</div></div>
<div class="barra"><button class="btn grande">Continuar</button></div></form>`,
    scripts: `<script>(function(){var n=document.getElementById('nome'),s=document.getElementById('slug'),mexeu=!!s.value;
s.addEventListener('input',function(){mexeu=true;});n.addEventListener('input',function(){if(mexeu)return;
s.value=n.value.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30);});})();</script>`,
  });
}

const GRUPOS = [
  ['link', 'Botões de compra e links', 'Escolha para onde cada botão leva. "Meu checkout" usa o que você configurou na aba Checkout.'],
  ['preco', 'Preços', 'Escreva do jeito que deve aparecer, ex.: R$ 189,90. O valor cobrado no checkout é definido na aba Checkout.'],
  ['texto', 'Textos e informações', 'Deixe em branco para voltar ao texto original do modelo.'],
  ['imagem', 'Imagens', 'Envie uma foto do seu computador ou cole o link de uma imagem.'],
];

function voltaLoja(user) {
  return user.role === 'admin' ? ['/admin/lojas', '← Lojas'] : ['/painel', '← Minhas lojas'];
}

function abasLoja(loja, aba) {
  return `<div class="abas"><a href="/painel/lojas/${loja.id}" class="${aba === 'conteudo' ? 'at' : ''}">Conteúdo</a><a href="/painel/lojas/${loja.id}/checkout" class="${aba === 'checkout' ? 'at' : ''}">Checkout</a></div>`;
}

function editor({ user, loja, campos, valores, msg }) {
  const ck = JSON.parse(loja.checkout || '{}');
  const prods = ck.produtos || [];
  const valorDe = (c) =>
    valores[c.id] !== undefined ? valores[c.id] : c.tipo === 'imagem' && String(c.padrao).startsWith('data:') ? '' : c.padrao;
  const campoHtml = (c) => {
    const id = 'f_' + c.id;
    if (c.tipo === 'imagem') {
      const thumb = valores[c.id] || c.padrao;
      return `<div class="img-campo"><label for="${id}">${esc(c.rotulo)}</label><div class="flex">
<img class="th" id="${id}_th" ${thumb ? `src="${esc(thumb)}"` : ''} alt="">
<div class="cresce"><input id="${id}" name="${id}" value="${esc(valorDe(c))}" placeholder="Imagem original do modelo" data-thumb>
<label class="btn sm sec up">Enviar foto<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-alvo="${id}" hidden></label></div></div></div>`;
    }
    if (c.tipo === 'link') {
      const atual = valores[c.id];
      const modo = atual === undefined || atual === '' ? (ck.gateway ? '@checkout:0' : 'url') : String(atual).startsWith('@checkout') ? atual : 'url';
      const opcoes =
        (prods.length
          ? prods.map((p, i) => `<option value="@checkout:${i}" ${modo === '@checkout:' + i ? 'selected' : ''}>Meu checkout — ${esc(p.nome)} (${brl(p.valor_centavos || 0)})</option>`).join('')
          : `<option value="@checkout:0" ${modo.startsWith('@checkout') ? 'selected' : ''}>Meu checkout${ck.gateway ? '' : ' (configure na aba Checkout)'}</option>`) +
        `<option value="url" ${modo === 'url' ? 'selected' : ''}>Outro link</option>`;
      const url = modo === 'url' ? (atual !== undefined && atual !== '' ? atual : c.padrao) : '';
      return `<label for="m_${c.id}">${esc(c.rotulo)}</label><div class="link-campo"><select id="m_${c.id}" name="m_${c.id}" data-modo>${opcoes}</select>
<input id="${id}" name="${id}" value="${esc(url)}" placeholder="https://..." ${modo === 'url' ? '' : 'hidden'}></div>`;
    }
    const s = String(valorDe(c));
    if (s.length > 70 || s.includes('\n')) {
      return `<label for="${id}">${esc(c.rotulo)}</label><textarea id="${id}" name="${id}" rows="${Math.min(10, Math.max(3, Math.ceil(s.length / 70)))}">${esc(s)}</textarea>`;
    }
    return `<label for="${id}">${esc(c.rotulo)}</label><input id="${id}" name="${id}" value="${esc(s)}">`;
  };
  const secoes = GRUPOS.map(([tipo, titulo, dica]) => {
    const cs = campos.filter((c) => c.tipo === tipo);
    if (!cs.length) return '';
    return `<div class="card"><h2 class="mt0">${titulo}</h2><p class="dica">${dica}</p>${cs.map(campoHtml).join('')}</div>`;
  }).join('');
  const [vh, vt] = voltaLoja(user);
  return pagina({
    titulo: 'Editar ' + loja.nome,
    user,
    ativo: user.role === 'admin' ? 'lojas' : 'painel',
    largo: true,
    corpo: `<div class="flex entre"><div><h1>${esc(loja.nome)}</h1><p class="sub">${badge(estado(loja))} <a href="${esc(cfg.urlLoja(loja.slug))}" target="_blank" rel="noopener">${esc(dominio(loja.slug))} ↗</a>${user.role === 'admin' && loja.dono ? ` · membro: <a href="/admin/membros/${loja.user_id}">${esc(loja.dono)}</a>` : ''}</p></div>
<a class="btn sec" href="${vh}">${vt}</a></div>${abasLoja(loja, 'conteudo')}${avisos(msg)}
<div class="editor"><form method="post" action="/painel/lojas/${loja.id}" id="form-editor">
<div class="card"><label for="nome_loja" class="mt0">Nome da loja (aparece só no painel)</label><input id="nome_loja" name="nome_loja" maxlength="60" value="${esc(loja.nome)}"></div>
${secoes}<div class="barra fixa"><button class="btn grande">Salvar alterações</button></div></form>
<div class="prev"><div class="flex entre"><strong>Prévia</strong><small class="mut">Atualiza ao salvar</small></div><iframe src="/painel/lojas/${loja.id}/preview" title="Prévia da loja"></iframe></div></div>`,
    scripts: `<script src="/static/editor.js?v=${VERSAO}"></script>`,
  });
}

function checkoutLoja({ user, loja, msg }) {
  const ck = JSON.parse(loja.checkout || '{}');
  const g = ck.gateway || '';
  const prods = (ck.produtos || []).slice();
  while (prods.length < 3) prods.push({ nome: '', valor_centavos: 0, link: '' });
  const radios = Object.entries(GATEWAYS)
    .map(([k, v]) => `<label class="opcao gw"><input type="radio" name="gateway" value="${k}" ${g === k ? 'checked' : ''}><strong>${v.nome}</strong><small>${v.desc}</small></label>`)
    .join('');
  const linhasProd = prods
    .map(
      (p, i) => `<div class="prod"><input name="p_nome_${i}" value="${esc(p.nome)}" placeholder="Nome do produto ${i + 1}" maxlength="120" aria-label="Nome do produto ${i + 1}">
<input name="p_valor_${i}" value="${p.valor_centavos ? reais(p.valor_centavos) : ''}" placeholder="Valor (ex.: 189,90)" inputmode="decimal" aria-label="Valor do produto ${i + 1}">
<input name="p_link_${i}" value="${esc(p.link || '')}" placeholder="Link de checkout deste produto" class="so-link" aria-label="Link do produto ${i + 1}"></div>`
    )
    .join('');
  const [vh, vt] = voltaLoja(user);
  const mp = mascarar(ck.mp_token);
  const st = mascarar(ck.stripe_key);
  return pagina({
    titulo: 'Checkout — ' + loja.nome,
    user,
    ativo: user.role === 'admin' ? 'lojas' : 'painel',
    corpo: `<div class="flex entre"><div><h1>${esc(loja.nome)}</h1><p class="sub">${badge(estado(loja))} <a href="${esc(cfg.urlLoja(loja.slug))}" target="_blank" rel="noopener">${esc(dominio(loja.slug))} ↗</a></p></div>
<a class="btn sec" href="${vh}">${vt}</a></div>${abasLoja(loja, 'checkout')}${avisos(msg)}
<form method="post" action="/painel/lojas/${loja.id}/checkout" id="form-checkout">
<div class="card"><h2 class="mt0">1. Onde seus clientes vão pagar</h2><p class="dica">O dinheiro das vendas cai direto na sua conta. Os botões de compra da loja passam a abrir este checkout.</p>
<div class="grid gws">${radios}</div></div>
<div class="card"><h2 class="mt0">2. Produtos</h2><p class="dica">Nome e valor cobrado. O primeiro é o principal (usado pelos botões de compra). Deixe em branco o que não usar.</p>
<div id="prods">${linhasProd}</div><button type="button" class="btn sm sec mt" id="mais-prod">+ Adicionar produto</button></div>
<div class="card gw-sec" data-gw="link"><h2 class="mt0">3. Link externo</h2><label for="link">Link geral do checkout (usado quando o produto não tem link próprio)</label>
<input id="link" name="link" value="${esc(ck.link || '')}" placeholder="https://seuloja.yampi.com.br/checkout/...">
<p class="dica">Funciona com Yampi, CartPanda, Kiwify, Hotmart, Appmax, Shopify, Pagar.me e qualquer outro link de pagamento.</p></div>
<div class="card gw-sec" data-gw="mercadopago"><h2 class="mt0">3. Mercado Pago</h2><label for="mp_token">Access Token de produção</label>
<input id="mp_token" name="mp_token" autocomplete="off" placeholder="${mp ? 'Salvo: ' + esc(mp) + ' (deixe em branco para manter)' : 'APP_USR-...'}">
<p class="dica">Mercado Pago → Seu negócio → Configurações → Credenciais → Credenciais de produção. Fica guardado cifrado.</p></div>
<div class="card gw-sec" data-gw="stripe"><h2 class="mt0">3. Stripe</h2><label for="stripe_key">Chave secreta</label>
<input id="stripe_key" name="stripe_key" autocomplete="off" placeholder="${st ? 'Salva: ' + esc(st) + ' (deixe em branco para manter)' : 'sk_live_...'}">
<p class="dica">Stripe → Desenvolvedores → Chaves de API. Fica guardada cifrada.</p></div>
<div class="card gw-sec" data-gw="pix"><h2 class="mt0">3. Pix direto</h2><div class="duas">
<div><label for="ck_pix_chave">Sua chave Pix</label><input id="ck_pix_chave" name="pix_chave" value="${esc(ck.pix_chave || '')}"></div>
<div><label for="ck_pix_nome">Nome do recebedor</label><input id="ck_pix_nome" name="pix_nome" maxlength="25" value="${esc(ck.pix_nome || '')}"></div>
<div><label for="ck_pix_cidade">Cidade</label><input id="ck_pix_cidade" name="pix_cidade" maxlength="15" value="${esc(ck.pix_cidade || '')}"></div>
<div><label for="ck_whats_pix">WhatsApp para receber comprovantes (opcional)</label><input id="ck_whats_pix" name="whats_pix" maxlength="20" value="${esc(g === 'pix' ? ck.whats_numero || '' : '')}"></div></div></div>
<div class="card gw-sec" data-gw="whatsapp"><h2 class="mt0">3. WhatsApp</h2><div class="duas">
<div><label for="ck_whats">Número com DDD</label><input id="ck_whats" name="whats_numero" maxlength="20" value="${esc(g === 'whatsapp' ? ck.whats_numero || '' : '')}" placeholder="11900000000"></div>
<div><label for="ck_msg">Mensagem inicial</label><input id="ck_msg" name="whats_msg" maxlength="300" value="${esc(ck.whats_msg || 'Olá! Quero comprar {produto} ({valor}).')}"></div></div>
<p class="dica">Use {produto} e {valor} para preencher automaticamente.</p></div>
<div class="barra"><a class="btn sec" href="${esc(cfg.urlCheckout(loja.slug))}" target="_blank" rel="noopener">Testar checkout ↗</a><button class="btn grande">Salvar checkout</button></div></form>`,
    scripts: `<script src="/static/checkout.js?v=${VERSAO}"></script>`,
  });
}

function pagar({ user, pg, loja, plano, modo, pixPayload }) {
  const s = S.all();
  let corpo;
  if (pg.status === 'pago') corpo = '<div class="msg ok">Este pagamento já foi confirmado. Sua loja está liberada!</div><a class="btn cheio" href="/painel">Ir para o painel</a>';
  else if (pg.status === 'recusado') corpo = `<div class="msg erro">Este pagamento foi recusado. Gere um novo no painel ou fale com o suporte.</div><a class="btn cheio" href="/painel">Voltar</a>`;
  else if (modo === 'teste')
    corpo = `<div class="msg aviso">Modo de teste: use o botão abaixo para simular a aprovação.</div>
<form method="post" action="/pagar/${pg.id}/simular"><button class="btn cheio">Simular pagamento aprovado</button></form>`;
  else if (!pixPayload)
    corpo = `<div class="msg aviso">O pagamento ainda não está disponível. Fale com o suporte.</div>${s.whatsapp ? `<a class="btn cheio" href="${esc(waLink(s.whatsapp))}" target="_blank" rel="noopener">Falar no WhatsApp</a>` : ''}`;
  else
    corpo = `<div class="pix"><div id="qr" class="qr" data-p="${esc(pixPayload)}"></div>
<p class="dica">Abra o app do seu banco, escolha <b>Pix → Ler QR Code</b> ou use o copia e cola:</p>
<textarea id="copia" readonly rows="3">${esc(pixPayload)}</textarea><button type="button" class="btn sec cheio" id="copiar">Copiar código Pix</button>
<p class="dica">Recebedor: <b>${esc(s.pix_nome)}</b> · Chave: ${esc(s.pix_chave)}</p>
${s.pix_instrucoes ? `<div class="msg info">${esc(s.pix_instrucoes)}</div>` : ''}
${pg.informado_em ? `<div class="msg ok">Recebemos seu aviso em ${dt(pg.informado_em)}. Assim que confirmarmos o Pix, sua loja é liberada.</div>` : ''}
<form id="informar" data-id="${pg.id}"><label for="comprovante">Comprovante (imagem ou PDF, opcional)</label><input type="file" id="comprovante" accept="image/png,image/jpeg,image/webp,application/pdf">
<button class="btn cheio">${pg.informado_em ? 'Enviar de novo' : 'Já paguei'}</button></form></div>`;
  return pagina({
    titulo: 'Pagamento',
    user,
    corpo: `<div class="auth card"><h1>Pagamento do aluguel</h1><p class="sub">Loja <b>${esc(loja.nome)}</b> · Plano ${esc(plano ? plano.nome : pg.plano_id)}${plano ? ` (${plano.dias} dias)` : ''}</p>
<div class="total">${brl(pg.valor_centavos)}</div>${corpo}</div>`,
    scripts: pixPayload
      ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script><script src="/static/pagar.js?v=${VERSAO}"></script>`
      : '',
  });
}

// Página de Pix que o cliente final da loja vê (checkout "Pix direto")
function pixCheckout({ pix, loja }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pagamento via Pix</title>
<link rel="stylesheet" href="/static/app.css?v=${VERSAO}"></head><body class="fundo-pix"><main class="main"><div class="auth card"><h1>Pagamento via Pix</h1>
<p class="sub">${esc(pix.produto || loja.nome)}</p>${pix.valor ? `<div class="total">${brl(pix.valor)}</div>` : ''}
<div class="pix"><div id="qr" class="qr" data-p="${esc(pix.payload)}"></div><p class="dica">Abra o app do seu banco e escolha <b>Pix → Ler QR Code</b>, ou copie o código:</p>
<textarea id="copia" readonly rows="3">${esc(pix.payload)}</textarea><button type="button" class="btn cheio" id="copiar">Copiar código Pix</button>
${pix.recebedor ? `<p class="dica">Recebedor: <b>${esc(pix.recebedor)}</b></p>` : ''}
${pix.whats ? `<a class="btn sec cheio" href="${esc(waLink(pix.whats, 'Olá! Fiz o Pix de ' + (pix.produto || 'meu pedido') + '. Segue o comprovante:'))}" target="_blank" rel="noopener">Enviar comprovante no WhatsApp</a>` : ''}
</div></div></main><script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script><script src="/static/pagar.js?v=${VERSAO}"></script></body></html>`;
}

function simples({ user, titulo, texto }) {
  return pagina({ titulo, user, corpo: `<div class="card vazio"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p><a class="btn" href="/">Voltar</a></div>` });
}

module.exports = {
  inicio, adminHome, entrar, cadastrar, adminInicio, adminLojas, adminMembros, adminMembro, adminPagamentos, adminTemplates, adminMapper,
  adminPlanos, adminConfig, painel, alugar, editor, checkoutLoja, pagar, pixCheckout, simples,
};
