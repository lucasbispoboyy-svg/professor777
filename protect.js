'use strict';
// Entrega da loja pública com proteção contra cópia:
// - o HTML do template nunca vai "aberto": vai cifrado e só é montado no navegador;
// - a chave depende do domínio, então uma página salva/copiada não abre em outro lugar;
// - bloqueia F12, Ctrl+Shift+I/J/C/K, Ctrl+U, Ctrl+S, Ctrl+P e o botão direito;
// - se o DevTools for aberto mesmo assim (pelo menu), a página é apagada;
// - cada loja leva uma marca invisível para identificar quem copiou.
const crypto = require('crypto');

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Precisa ficar idêntico ao trecho equivalente no carregador (navegador)
function cifrar(buf, semente) {
  let x = semente || 1;
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = buf[i] ^ (x & 255);
  }
  return out;
}

// Roda dentro da página final da loja (é convertida em texto e injetada)
function protecao() {
  var w = window, d = document;
  function zera() {
    try { d.open(); d.write(''); d.close(); } catch (e) {}
    try { w.location.replace('about:blank'); } catch (e) {}
  }
  var dev = { KeyI: 1, KeyJ: 1, KeyC: 1, KeyK: 1, KeyE: 1, KeyM: 1 };
  function tecla(e) {
    var c = e.code || '', m = e.ctrlKey || e.metaKey, k = e.keyCode;
    if (
      k === 123 || c === 'F12' ||
      (m && e.shiftKey && dev[c]) ||
      (m && e.altKey && (dev[c] || c === 'KeyU')) ||
      (m && !e.shiftKey && (c === 'KeyU' || c === 'KeyS' || c === 'KeyP'))
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return false;
    }
  }
  w.addEventListener('keydown', tecla, true);
  d.addEventListener('keydown', tecla, true);
  w.addEventListener('contextmenu', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; // deixa colar texto nos campos
    e.preventDefault();
  }, true);
  d.addEventListener('dragstart', function (e) { if (e.target && e.target.tagName === 'IMG') e.preventDefault(); }, true);
  var F = (function () {}).constructor;
  setInterval(function () {
    var t = performance.now();
    F('debugger')();
    if (performance.now() - t > 150) zera();
  }, 700);
}

function nomes(n) {
  const s = new Set();
  while (s.size < n) s.add('_' + crypto.randomBytes(4).toString('hex'));
  return [...s];
}

function renderProtegido({ html, campos, valores, marca, hostname }) {
  const nonce = crypto.randomBytes(6).toString('hex');
  const semente = fnv(hostname + '|' + nonce);
  const dados = Buffer.from(JSON.stringify({ h: html, c: campos, v: valores, m: marca }), 'utf8');
  const b64 = cifrar(dados, semente).toString('base64');

  const partes = [];
  for (let i = 0; i < b64.length; ) {
    const n = 300 + crypto.randomInt(500);
    partes.push(b64.slice(i, i + n));
    i += n;
  }

  const [A, N, T, F, X, B, U, O, D, C, V, M, S, H, G, Z] = nomes(16);
  const scriptProtecao = '(' + protecao.toString() + ')();';

  // Tudo aqui precisa ser ASCII (vai em base64 e é lido com atob)
  const interno = `
function ${G}(){
var ${T}=performance.now();(function(){}).constructor('debugger')();
if(performance.now()-${T}>150){document.documentElement.innerHTML='';return;}
var ${A}=[${partes.map((p) => JSON.stringify(p)).join(',')}].join(''),${N}=${JSON.stringify(nonce)};
function ${F}(s){var h=0x811c9dc5;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return h>>>0}
var ${X}=${F}(location.hostname+'|'+${N})||1,${B}=atob(${A}),${U}=new Uint8Array(${B}.length);
for(var i=0;i<${B}.length;i++){${X}^=${X}<<13;${X}^=${X}>>>17;${X}^=${X}<<5;${U}[i]=${B}.charCodeAt(i)^(${X}&255)}
var ${O};try{${O}=JSON.parse(new TextDecoder().decode(${U}))}catch(e){document.body.innerHTML='';return;}
var ${D}=new DOMParser().parseFromString(${O}.h,'text/html'),${C}={};
${O}.c.forEach(function(f){${C}[f.id]=f});
function ${V}(id){var v=${O}.v[id];return(v===undefined||v===null||v==='')?null:String(v)}
${D}.querySelectorAll('[data-sf]').forEach(function(el){var id=el.getAttribute('data-sf'),f=${C}[id],v=${V}(id);el.removeAttribute('data-sf');if(!f||v===null)return;
if(f.tipo==='imagem'){el.setAttribute('src',v);el.removeAttribute('srcset');}
else{el.textContent='';v.split('\\n').forEach(function(l,i){if(i)el.appendChild(${D}.createElement('br'));el.appendChild(${D}.createTextNode(l))});}});
${D}.querySelectorAll('[data-sf-link]').forEach(function(el){var id=el.getAttribute('data-sf-link'),f=${C}[id],v=${V}(id);el.removeAttribute('data-sf-link');if(!f||v===null)return;
if(el.tagName==='A'){el.setAttribute('href',v);}else{el.setAttribute('onclick','location.href='+JSON.stringify(v)+';return false');}});
var ${M}=String(${O}.m||''),${Z}='';
for(var i=0;i<${M}.length;i++){var b=${M}.charCodeAt(i).toString(2);while(b.length<8)b='0'+b;${Z}+=b.replace(/0/g,'\\u200b').replace(/1/g,'\\u200c');}
var hx=${D}.querySelector('h1,h2,p');if(hx)hx.appendChild(${D}.createTextNode(${Z}));
var hd=${D}.head||${D}.documentElement;
hd.insertBefore(${D}.createComment(' '+${M}+' '),hd.firstChild);
var ${S}=${D}.createElement('script');${S}.textContent=${JSON.stringify(scriptProtecao)};hd.insertBefore(${S},hd.firstChild);
var ${H}='<!DOCTYPE html>'+${D}.documentElement.outerHTML;
document.open();document.write(${H});document.close();
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',${G});}else{${G}();}
`;
  const externo = `(function(){var s=atob(${JSON.stringify(Buffer.from(interno, 'utf8').toString('base64'))});(new Function(s))();})();`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>&#8203;</title><style>html,body{background:#fff}</style></head><body><noscript>Ative o JavaScript para ver esta loja.</noscript><script>${externo}</script></body></html>`;
}

function paginaIndisponivel(mensagem) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loja indisponível</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f6f7fb;color:#0f172a}
.c{text-align:center;padding:40px 24px;max-width:420px}.i{font-size:44px}h1{font-size:22px;margin:12px 0 6px}p{color:#64748b;margin:0}</style></head>
<body><div class="c"><div class="i">&#128274;</div><h1>${esc(mensagem)}</h1><p>Volte mais tarde.</p></div></body></html>`;
}

// Script de bloqueios para as páginas do próprio painel (área do membro)
const scriptProtecao = () => '(' + protecao.toString() + ')();';

module.exports = { renderProtegido, paginaIndisponivel, scriptProtecao };
