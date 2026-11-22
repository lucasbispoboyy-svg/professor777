// Tela do admin: lê o index.html enviado, encontra textos/preços/imagens/links
// e deixa marcar o que o cliente pode editar.
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var dados = JSON.parse($('#tpl-data').textContent);
  var doc = null, cands = [];
  var assetsKey = dados.assets || null;
  var assetsBase = dados.assets_base || '';
  var LIMITE = 100e6;
  var LIXO = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$|(^|\/)__MACOSX\//i;
  // Atributos que nunca são caminhos de arquivo
  var PULAR = /^(class|id|style|alt|title|name|type|value|placeholder|lang|dir|role|for|target|rel|method|action|charset|http-equiv|width|height|media|sizes|crossorigin|integrity|loading|decoding|async|defer|tabindex|colspan|rowspan|data-sf|data-sf-link)$|^(on|aria-)/i;
  var RE_IMG_META = /image|url|icon|logo|video|audio/i;

  // Lê texto em qualquer codificação (UTF-8, UTF-16, ISO-8859-1, Windows-1252...)
  async function lerTexto(blob) {
    var b = new Uint8Array(await blob.arrayBuffer());
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) {}
    var cabeca = new TextDecoder('latin1').decode(b.subarray(0, 4096));
    var m = cabeca.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i) || cabeca.match(/@charset\s+["']([\w-]+)/i);
    try { return new TextDecoder(m ? m[1].toLowerCase() : 'windows-1252').decode(b); } catch (e) { return new TextDecoder('windows-1252').decode(b); }
  }

  function tamanho(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

  // Envia uma lista de arquivos ({file, caminho}) para a pasta do template, 4 de cada vez
  async function enviarLista(key, itens, rotulo) {
    var total = itens.reduce(function (a, it) { return a + it.file.size; }, 0);
    var enviados = 0, feitos = 0, i = 0, falhas = [];
    async function trabalhador() {
      while (i < itens.length) {
        var it = itens[i++];
        try {
          await pedirJson('/admin/assets/' + key + '/' + caminhoUrl(it.caminho), { method: 'PUT', body: it.file });
        } catch (e) { falhas.push(it.caminho + ' (' + e.message + ')'); }
        feitos++;
        enviados += it.file.size;
        status(rotulo + ' ' + feitos + ' de ' + itens.length + ' · ' + tamanho(enviados) + ' de ' + tamanho(total), total ? Math.round((enviados / total) * 100) : 100);
      }
    }
    await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
    if (falhas.length) alert('Alguns arquivos não foram enviados:\n\n' + falhas.slice(0, 15).join('\n') + (falhas.length > 15 ? '\n...' : ''));
    return itens.filter(function (it) { return !falhas.some(function (f) { return f.indexOf(it.caminho + ' (') === 0; }); }).map(function (it) { return it.caminho; });
  }

  // ---------------------------------------------------------------- arquivos do site (pasta / ZIP)
  function status(txt, pct) {
    var box = $('#envio');
    box.hidden = !txt;
    $('#envio-txt').textContent = txt || '';
    $('#envio-barra').style.width = (pct == null ? 0 : pct) + '%';
    $('#envio-barra').parentNode.hidden = pct == null;
  }

  async function pedirJson(url, opts) {
    var r = await fetch(url, opts);
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.erro || 'Falha (HTTP ' + r.status + ')');
    return j;
  }

  function caminhoUrl(p) { return p.split('/').map(encodeURIComponent).join('/'); }

  // Troca caminhos relativos (css/estilo.css, index_files/img.png...) pelos arquivos enviados
  function reescrever(d, ctx) {
    var mapa = {};
    ctx.arquivos.forEach(function (a) { mapa[a.toLowerCase()] = a; });
    var lista = Object.keys(mapa);
    var base = ctx.base ? ctx.base.split('/').filter(Boolean) : [];
    var ligados = 0;
    function resolver(url) {
      if (!url) return null;
      var u = url.trim();
      if (/^(#|[a-z][a-z0-9+.-]*:|\/\/|\/a\/)/i.test(u)) return null;
      var p = u.split('#')[0].split('?')[0];
      var resto = u.slice(p.length);
      try { p = decodeURIComponent(p); } catch (e) {}
      var partes = base.slice();
      var limpo = [];
      p.split('/').forEach(function (s) {
        if (!s || s === '.') return;
        if (s === '..') { partes.pop(); return; }
        partes.push(s); limpo.push(s);
      });
      var real = mapa[partes.join('/').toLowerCase()];
      if (!real && limpo.length) {
        var fim = '/' + limpo.join('/').toLowerCase();
        var achados = lista.filter(function (a) { return ('/' + a).slice(-fim.length) === fim; });
        if (achados.length === 1) real = mapa[achados[0]];
      }
      if (!real) return null;
      ligados++;
      return '/a/' + ctx.key + '/' + caminhoUrl(real) + resto;
    }
    function trocarCss(txt) {
      return txt
        .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, q, u) { var n = resolver(u); return n ? 'url(' + q + n + q + ')' : m; })
        .replace(/@import\s+(['"])([^'"]+)\1/gi, function (m, q, u) { var n = resolver(u); return n ? '@import ' + q + n + q : m; });
    }
    function trocarSrcset(v) {
      return v.split(',').map(function (parte) {
        var t = parte.trim().split(/\s+/);
        var n = resolver(t[0]);
        if (n) t[0] = n;
        return t.join(' ');
      }).join(', ');
    }
    // Qualquer atributo cujo valor seja um arquivo enviado (src, href, poster, data-*, xlink:href, etc.)
    d.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (at) {
        var nome = at.name;
        if (nome === 'content') {
          var tipoMeta = (el.getAttribute('property') || el.getAttribute('name') || el.getAttribute('itemprop') || '');
          if (el.tagName !== 'META' || !RE_IMG_META.test(tipoMeta)) return;
        } else if (PULAR.test(nome)) return;
        if (/srcset$/i.test(nome)) { el.setAttribute(nome, trocarSrcset(at.value)); return; }
        var n = resolver(at.value);
        if (n) el.setAttribute(nome, n);
      });
    });
    d.querySelectorAll('[style]').forEach(function (el) { el.setAttribute('style', trocarCss(el.getAttribute('style'))); });
    d.querySelectorAll('style').forEach(function (el) { el.textContent = trocarCss(el.textContent); });
    return ligados;
  }

  function usarHtml(html, ctx, nomeArquivo) {
    var d = new DOMParser().parseFromString(html, 'text/html');
    var ligados = ctx ? reescrever(d, ctx) : 0;
    if (nomeArquivo && !$('#nome').value) {
      var partes = nomeArquivo.split('/');
      var arq = partes.pop().replace(/\.html?$/i, '');
      $('#nome').value = /^index$/i.test(arq) && partes.length ? partes.pop() : arq;
    }
    analisar('<!DOCTYPE html>' + d.documentElement.outerHTML);
    status('', null);
    mostrarInfo(ctx ? ctx.arquivos : [], ligados);
  }

  // Resumo do que foi enviado, separado por tipo
  function mostrarInfo(arquivos, ligados) {
    carregarArquivos().catch(function () {});
    var box = $('#info-arquivos');
    if (!arquivos.length) {
      box.textContent = 'Somente o HTML (sem arquivos extras). Use "Adicionar arquivos" se faltar alguma imagem ou arquivo.';
      box.hidden = false;
      return;
    }
    var grupos = { 'Imagens': /\.(png|jpe?g|jfif|pjpeg|pjp|webp|gif|svg|avif|bmp|ico|cur|apng|tiff?|heic|heif|jxl)$/i, 'Vídeos': /\.(mp4|webm|mov|m4v|ogv|avi|mkv|3gp)$/i,
      'Áudios': /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i, 'Fontes': /\.(woff2?|ttf|otf|eot)$/i, 'CSS': /\.css$/i, 'JavaScript': /\.(m?js|map)$/i, 'Páginas': /\.(html?|xhtml)$/i };
    var cont = {}, outros = 0;
    arquivos.forEach(function (a) {
      var g = Object.keys(grupos).filter(function (k) { return grupos[k].test(a); })[0];
      if (g) cont[g] = (cont[g] || 0) + 1; else outros++;
    });
    var partes = Object.keys(cont).map(function (k) { return k + ': ' + cont[k]; });
    if (outros) partes.push('Outros: ' + outros);
    box.textContent = arquivos.length + ' arquivo(s) na pasta do site (' + partes.join(' · ') + ')' + (ligados != null ? ' · ' + ligados + ' ligação(ões) feitas no HTML' : '');
    box.hidden = false;
  }

  async function enviarPasta(files) {
    var lista = Array.prototype.slice.call(files).filter(function (f) { return !LIXO.test(f.webkitRelativePath || f.name); });
    var htmls = lista.filter(function (f) { return /\.(html?|xhtml)$/i.test(f.name); });
    if (!htmls.length) { alert('A pasta não tem nenhum arquivo .html.'); return; }
    htmls.sort(function (a, b) {
      var ia = /^index\.html?$/i.test(a.name) ? 0 : 1, ib = /^index\.html?$/i.test(b.name) ? 0 : 1;
      return ia - ib || a.webkitRelativePath.split('/').length - b.webkitRelativePath.split('/').length;
    });
    var index = htmls[0];
    // Todos os arquivos da pasta (imagens, vídeos, fontes, CSS, JS, outras páginas...), menos a página principal
    var outros = lista.filter(function (f) { return f !== index; });
    var grandes = outros.filter(function (f) { return f.size > LIMITE; });
    if (grandes.length) {
      alert('Estes arquivos passam de 100 MB e não serão enviados:\n\n' + grandes.map(function (f) { return f.webkitRelativePath + ' (' + tamanho(f.size) + ')'; }).join('\n'));
      outros = outros.filter(function (f) { return f.size <= LIMITE; });
    }
    status('Preparando envio...', 0);
    var key = (await pedirJson('/admin/assets', { method: 'POST' })).key;
    var enviados = await enviarLista(key, outros.map(function (f) { return { file: f, caminho: f.webkitRelativePath }; }), 'Enviando arquivos...');
    assetsKey = key;
    var caminho = index.webkitRelativePath;
    assetsBase = caminho.split('/').slice(0, -1).join('/');
    usarHtml(await lerTexto(index), { key: key, arquivos: enviados, base: assetsBase }, caminho);
  }

  async function enviarZip(f) {
    if (f.size > 300e6) { alert('O ZIP passa de 300 MB. Use "Enviar pasta" (envia arquivo por arquivo, sem esse limite).'); return; }
    status('Enviando o ZIP (' + tamanho(f.size) + ')...', 30);
    var key = (await pedirJson('/admin/assets', { method: 'POST' })).key;
    var j = await pedirJson('/admin/assets/' + key + '/zip', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: f });
    status('Lendo o site...', 90);
    assetsKey = key;
    assetsBase = j.index.nome.split('/').slice(0, -1).join('/');
    usarHtml(j.index.html, { key: key, arquivos: j.arquivos, base: assetsBase }, j.index.nome);
  }

  async function enviarHtmlSolto(f) {
    var html = await lerTexto(f);
    var ctx = null;
    if (assetsKey) {
      // Trocando só o HTML: tenta ligar aos arquivos que já foram enviados antes
      var j = await pedirJson('/admin/assets/' + assetsKey).catch(function () { return { arquivos: [] }; });
      if (j.arquivos.length) ctx = { key: assetsKey, arquivos: j.arquivos, base: assetsBase };
    }
    usarHtml(html, ctx, f.name);
  }

  // Adiciona arquivos soltos (qualquer tipo) à pasta do site e religa os caminhos
  async function enviarExtras(files) {
    if (!doc) { alert('Envie primeiro a pasta, o ZIP ou o index.html do site.'); return; }
    var lista = Array.prototype.slice.call(files).filter(function (f) { return !LIXO.test(f.name) && f.size <= LIMITE; });
    if (lista.length < files.length) alert('Arquivos acima de 100 MB foram ignorados.');
    if (!lista.length) return;
    if (!assetsKey) assetsKey = (await pedirJson('/admin/assets', { method: 'POST' })).key;
    await enviarLista(assetsKey, lista.map(function (f) { return { file: f, caminho: (assetsBase ? assetsBase + '/' : '') + f.name }; }), 'Adicionando arquivos...');
    var j = await pedirJson('/admin/assets/' + assetsKey);
    var ligados = reescrever(doc, { key: assetsKey, arquivos: j.arquivos, base: assetsBase });
    $('#previa').srcdoc = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    status('', null);
    mostrarInfo(j.arquivos, ligados);
  }

  function erroEnvio(e) { status('', null); alert(e.message || 'Falha no envio.'); }

  // ---------------------------------------------------------------- gerenciador de arquivos
  var ARQ = [];
  var sel = {};
  var TIPOS_ARQ = {
    img: /\.(png|jpe?g|jfif|pjpeg|pjp|webp|gif|svg|avif|bmp|ico|cur|apng|tiff?|heic|heif|jxl)$/i,
    css: /\.(css|scss|less)$/i,
    js: /\.(m?js|map|ts)$/i,
    html: /\.(html?|xhtml)$/i,
    fonte: /\.(woff2?|ttf|otf|eot)$/i,
    midia: /\.(mp4|webm|mov|m4v|ogv|avi|mkv|3gp|mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i,
  };
  var EDITAVEL = /\.(css|scss|less|m?js|ts|json|html?|xhtml|txt|svg|xml|md|csv|map|webmanifest|vtt|srt|ini|yml|yaml)$|(^|\/)\.htaccess$/i;
  var ICONE_TIPO = { img: '🖼️', css: '🎨', js: '⚙️', html: '📄', fonte: '🔤', midia: '🎬', outro: '📦' };

  function tipoDe(p) { for (var k in TIPOS_ARQ) if (TIPOS_ARQ[k].test(p)) return k; return 'outro'; }
  function urlPublica(p) { return '/a/' + assetsKey + '/' + caminhoUrl(p); }
  function urlRaw(p, baixar) { return '/admin/assets/' + assetsKey + '/raw?p=' + encodeURIComponent(p) + (baixar ? '&baixar=1' : ''); }
  function recarregarPrevia() { if (doc) $('#previa').srcdoc = '<!DOCTYPE html>' + doc.documentElement.outerHTML; }

  async function carregarArquivos() {
    if (!doc && !assetsKey) { $('#gerenciador').hidden = true; return; }
    ARQ = assetsKey ? (await pedirJson('/admin/assets/' + assetsKey)).detalhes || [] : [];
    sel = {};
    $('#gerenciador').hidden = false;
    desenharArquivos();
  }

  function arquivosVisiveis() {
    var b = $('#arq-busca').value.toLowerCase(), t = $('#arq-tipo').value;
    return ARQ.filter(function (a) { return (!b || a.caminho.toLowerCase().indexOf(b) >= 0) && (!t || tipoDe(a.caminho) === t); });
  }

  function botao(txt, fn, cls) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn sm ' + (cls || 'sec'); b.textContent = txt; b.onclick = fn;
    return b;
  }

  function desenharArquivos() {
    var lista = arquivosVisiveis(), corpo = $('#arq-lista');
    corpo.innerHTML = '';
    lista.forEach(function (a) {
      var tr = document.createElement('tr');
      var td0 = document.createElement('td');
      var ck = document.createElement('input');
      ck.type = 'checkbox'; ck.checked = !!sel[a.caminho]; ck.setAttribute('aria-label', 'Selecionar ' + a.caminho);
      ck.onchange = function () { if (ck.checked) sel[a.caminho] = 1; else delete sel[a.caminho]; atualizarSel(); };
      td0.appendChild(ck);
      var td1 = document.createElement('td');
      var tipo = tipoDe(a.caminho);
      var nome = document.createElement('div');
      nome.className = 'arq-nome';
      if (tipo === 'img') { var im = document.createElement('img'); im.src = urlPublica(a.caminho); im.loading = 'lazy'; im.alt = ''; im.className = 'arq-th'; nome.appendChild(im); }
      else { var ic = document.createElement('span'); ic.className = 'arq-ic'; ic.textContent = ICONE_TIPO[tipo]; nome.appendChild(ic); }
      var tx = document.createElement('span'); tx.textContent = a.caminho; nome.appendChild(tx);
      td1.appendChild(nome);
      var td2 = document.createElement('td'); td2.textContent = tamanho(a.tamanho); td2.className = 'mut';
      var td3 = document.createElement('td');
      var ac = document.createElement('div'); ac.className = 'acoes';
      ac.appendChild(botao(EDITAVEL.test(a.caminho) ? 'Editar' : 'Ver', function () { abrirArquivo(a.caminho).catch(erroEnvio); }, ''));
      var troca = document.createElement('label'); troca.className = 'btn sm sec'; troca.textContent = 'Trocar';
      var inp = document.createElement('input'); inp.type = 'file'; inp.hidden = true;
      inp.onchange = function () { if (inp.files[0]) trocarArquivo(a.caminho, inp.files[0]); };
      troca.appendChild(inp); ac.appendChild(troca);
      var bx = document.createElement('a'); bx.className = 'btn sm sec'; bx.textContent = 'Baixar'; bx.href = urlRaw(a.caminho, true); ac.appendChild(bx);
      ac.appendChild(botao('Excluir', function () { if (confirm('Excluir ' + a.caminho + '?')) excluirArquivos([a.caminho]); }, 'perigo'));
      td3.appendChild(ac);
      tr.append(td0, td1, td2, td3);
      corpo.appendChild(tr);
    });
    if (!lista.length) corpo.innerHTML = '<tr><td colspan="4" class="vazio">' + (ARQ.length ? 'Nenhum arquivo com esse filtro.' : 'Nenhum arquivo extra (só o index.html). Use "Adicionar arquivos" acima.') + '</td></tr>';
    atualizarSel();
  }

  function atualizarSel() {
    var vis = arquivosVisiveis(), n = Object.keys(sel).length;
    $('#arq-excluir').disabled = !n;
    $('#arq-excluir').textContent = n ? 'Excluir selecionados (' + n + ')' : 'Excluir selecionados';
    $('#arq-todos').checked = vis.length > 0 && vis.every(function (a) { return sel[a.caminho]; });
    $('#arq-todos').disabled = !vis.length;
    var total = ARQ.reduce(function (s, a) { return s + a.tamanho; }, 0);
    $('#arq-resumo').textContent = ARQ.length + ' arquivo(s) · ' + tamanho(total);
  }

  async function excluirArquivos(ps) {
    try {
      await pedirJson('/admin/assets/' + assetsKey + '/excluir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caminhos: ps }) });
    } catch (e) { erroEnvio(e); }
    await carregarArquivos();
    recarregarPrevia();
  }

  async function trocarArquivo(p, f) {
    if (f.size > LIMITE) { alert('Arquivo acima de 100 MB.'); return; }
    status('Enviando ' + f.name + '...', 50);
    try {
      await pedirJson('/admin/assets/' + assetsKey + '/' + caminhoUrl(p), { method: 'PUT', body: f });
      status('', null);
      await carregarArquivos();
      recarregarPrevia();
    } catch (e) { erroEnvio(e); }
  }

  // Janela de edição/visualização
  var dlg = $('#dlg'), aoSalvar = null;
  function abrirDialogo(titulo, corpoEl, info, salvar, textoSalvar) {
    $('#dlg-titulo').textContent = titulo;
    var c = $('#dlg-corpo'); c.innerHTML = ''; c.appendChild(corpoEl);
    $('#dlg-info').textContent = info || '';
    aoSalvar = salvar;
    $('#dlg-salvar').hidden = !salvar;
    $('#dlg-salvar').textContent = textoSalvar || 'Salvar';
    dlg.showModal();
  }
  $('#dlg-cancelar').addEventListener('click', function () { dlg.close(); });
  $('#dlg-salvar').addEventListener('click', async function () {
    if (!aoSalvar) return;
    var b = this, txt = b.textContent;
    b.disabled = true; b.textContent = 'Salvando...';
    try { await aoSalvar(); dlg.close(); } catch (e) { alert(e.message); }
    b.disabled = false; b.textContent = txt;
  });

  function editorCodigo(valor) {
    var ta = document.createElement('textarea');
    ta.className = 'codigo'; ta.value = valor; ta.spellcheck = false; ta.setAttribute('aria-label', 'Código');
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#dlg-salvar').click(); }
    });
    setTimeout(function () { ta.focus(); }, 60);
    return ta;
  }

  async function abrirArquivo(p) {
    if (EDITAVEL.test(p)) {
      var r = await fetch(urlRaw(p));
      if (!r.ok) throw new Error('Não foi possível abrir o arquivo.');
      var ta = editorCodigo(await lerTexto(await r.blob()));
      abrirDialogo(p, ta, 'Tab indenta · Ctrl+S salva', async function () {
        await pedirJson('/admin/assets/' + assetsKey + '/' + caminhoUrl(p), { method: 'PUT', body: new Blob([ta.value], { type: 'text/plain;charset=utf-8' }) });
        await carregarArquivos();
        recarregarPrevia();
      });
      return;
    }
    var box = document.createElement('div');
    box.className = 'dlg-midia';
    var u = urlPublica(p);
    if (tipoDe(p) === 'img') { var im = document.createElement('img'); im.src = u; im.alt = p; box.appendChild(im); }
    else if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(p)) { var v = document.createElement('video'); v.src = u; v.controls = true; box.appendChild(v); }
    else if (/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i.test(p)) { var au = document.createElement('audio'); au.src = u; au.controls = true; box.appendChild(au); }
    else { var pp = document.createElement('p'); pp.className = 'dica'; pp.textContent = 'Este tipo de arquivo não tem visualização. Use Baixar ou Trocar.'; box.appendChild(pp); }
    abrirDialogo(p, box, 'Para alterar, use o botão Trocar na lista.', null);
  }

  // HTML atual com as marcações só nos campos marcados
  function htmlMarcado() {
    var marc = {};
    cands.forEach(function (c) { if (c.marcado) marc[c.attr + '|' + c.id] = 1; });
    var cl = doc.cloneNode(true);
    ['data-sf', 'data-sf-link'].forEach(function (a) {
      cl.querySelectorAll('[' + a + ']').forEach(function (el) { if (!marc[a + '|' + el.getAttribute(a)]) el.removeAttribute(a); });
    });
    return '<!DOCTYPE html>\n' + cl.documentElement.outerHTML;
  }

  $('#editar-index').addEventListener('click', function () {
    if (!doc) { alert('Envie o site primeiro.'); return; }
    var ta = editorCodigo(htmlMarcado());
    abrirDialogo('index.html (página principal)', ta, 'Os atributos data-sf marcam os campos editáveis. Depois clique em "Salvar template".', async function () {
      cands.forEach(function (c) { SALVO[c.id] = { tipo: c.tipo, rotulo: c.rotulo }; });
      analisar(ta.value);
    }, 'Aplicar');
  });

  $('#arq-todos').addEventListener('change', function () {
    var v = this.checked;
    arquivosVisiveis().forEach(function (a) { if (v) sel[a.caminho] = 1; else delete sel[a.caminho]; });
    desenharArquivos();
  });
  $('#arq-busca').addEventListener('input', desenharArquivos);
  $('#arq-tipo').addEventListener('change', desenharArquivos);
  $('#arq-excluir').addEventListener('click', function () {
    var ps = Object.keys(sel);
    if (!ps.length) return;
    if (confirm('Excluir ' + ps.length + ' arquivo(s)? Não dá para desfazer.')) excluirArquivos(ps);
  });
  var RE_PRECO = /R\$\s*\d|\d+[.,]\d{2}\b/;
  var RE_CHECKOUT = /compr|checkout|finaliz|pedido|carrinho|buy|quero|garantir|garanta/i;
  var SALVO = {};
  (dados.campos || []).forEach(function (c) { SALVO[c.id] = c; });

  function textoDireto(el) {
    var s = '';
    el.childNodes.forEach(function (n) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeName === 'BR') s += '\n';
    });
    return s.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).join('\n').replace(/^\n+|\n+$/g, '');
  }
  function soTexto(el) {
    for (var i = 0; i < el.children.length; i++) if (el.children[i].tagName !== 'BR') return false;
    return true;
  }
  function curto(t, n) { t = String(t).replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function rotuloAuto(tipo, t, tag) {
    if (tipo === 'preco') return 'Preço: ' + curto(t, 30);
    if (tipo === 'link') return 'Link do botão "' + curto(t || 'sem texto', 30) + '"';
    if (/^H[1-6]$/.test(tag)) return 'Título: ' + curto(t, 40);
    return 'Texto: ' + curto(t, 40);
  }

  function analisar(html) {
    doc = new DOMParser().parseFromString(html, 'text/html');
    cands = [];
    var usados = {}, vistos = {}, n = 0, temMarc = false, imgs = 0;
    doc.querySelectorAll('[data-sf],[data-sf-link]').forEach(function (el) {
      ['data-sf', 'data-sf-link'].forEach(function (a) {
        var v = el.getAttribute(a);
        if (v) { usados[v] = 1; temMarc = true; }
      });
    });
    function novoId(p) { var id; do { id = p + (++n); } while (usados[id]); usados[id] = 1; return id; }
    function add(el, attr, prefixo, tipo, padrao, heuristica, rotulo) {
      var ex = el.getAttribute(attr);
      if (ex && !/^[a-z0-9_]{1,24}$/i.test(ex)) ex = null;
      var id = ex || novoId(prefixo);
      el.setAttribute(attr, id);
      if (vistos[id]) return; // mesmo campo usado em mais de um lugar
      vistos[id] = 1;
      var s = SALVO[id];
      cands.push({
        id: id, attr: attr,
        tipo: (s && s.tipo) || tipo,
        rotulo: (s && s.rotulo) || rotulo,
        padrao: padrao,
        marcado: ex ? true : (temMarc ? false : heuristica),
      });
    }
    doc.body.querySelectorAll('*').forEach(function (el) {
      if (el.closest('script,style,noscript,template,svg,iframe,select,head')) return;
      var tag = el.tagName;
      if (tag === 'IMG') {
        imgs++;
        var src = el.getAttribute('src') || '';
        if (/^data:/.test(src) && src.length > 5000) src = '';
        add(el, 'data-sf', 'c', 'imagem', src, true, 'Imagem ' + imgs);
        return;
      }
      if (soTexto(el)) {
        var t = textoDireto(el);
        if (t && t.length <= 2000) {
          var preco = RE_PRECO.test(t) && t.length <= 40;
          add(el, 'data-sf', 'c', preco ? 'preco' : 'texto', t, preco || /^H[1-3]$/.test(tag), rotuloAuto(preco ? 'preco' : 'texto', t, tag));
        }
      }
      if (tag === 'A' || tag === 'BUTTON') {
        var txt = el.textContent.trim(), href = el.getAttribute('href') || '';
        add(el, 'data-sf-link', 'l', 'link', href, RE_CHECKOUT.test(txt + ' ' + href), rotuloAuto('link', txt, tag));
      }
    });
    $('#area').hidden = false;
    desenhar();
    $('#previa').srcdoc = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  }

  function contar() {
    $('#contagem').textContent = cands.filter(function (c) { return c.marcado; }).length + ' de ' + cands.length + ' marcados';
  }

  function visivel(c) {
    var f = $('#filtro').value.toLowerCase();
    if ($('#soMarcados').checked && !c.marcado) return false;
    return !f || (c.rotulo + ' ' + c.padrao).toLowerCase().indexOf(f) >= 0;
  }

  // Marca/desmarca de uma vez (respeita o filtro, se houver)
  function marcarVarios(valor, tipo) {
    var n = 0;
    cands.forEach(function (c) {
      if (!visivel(c)) return;
      if (tipo && c.tipo !== tipo) return;
      if (c.marcado !== valor) n++;
      c.marcado = valor;
    });
    desenhar();
    return n;
  }

  function desenhar() {
    var box = $('#campos');
    box.innerHTML = '';
    var vis = 0;
    cands.forEach(function (c) {
      if (!visivel(c)) return;
      vis++;
      var row = document.createElement('div');
      row.className = 'campo' + (c.marcado ? ' on' : '');
      var chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = c.marcado; chk.title = 'Cliente pode editar';
      chk.onchange = function () { c.marcado = chk.checked; row.classList.toggle('on', c.marcado); contar(); };
      var tipo;
      if (c.tipo === 'texto' || c.tipo === 'preco') {
        tipo = document.createElement('select');
        [['texto', 'Texto'], ['preco', 'Preço']].forEach(function (t) {
          var o = document.createElement('option'); o.value = t[0]; o.textContent = t[1]; tipo.appendChild(o);
        });
        tipo.value = c.tipo;
        tipo.onchange = function () { c.tipo = tipo.value; };
      } else {
        tipo = document.createElement('span');
        tipo.className = 'badge ' + (c.tipo === 'link' ? 'b-warn' : 'b-mut');
        tipo.textContent = c.tipo === 'link' ? 'Link' : 'Imagem';
      }
      var rot = document.createElement('input');
      rot.className = 'rot'; rot.value = c.rotulo; rot.placeholder = 'Nome do campo para o cliente';
      rot.oninput = function () { c.rotulo = rot.value; };
      var ver = document.createElement('button');
      ver.type = 'button'; ver.className = 'btn sm sec'; ver.textContent = 'Ver';
      ver.onclick = function () { destacar(c); };
      var linha = document.createElement('div');
      linha.className = 'linha';
      linha.append(chk, tipo, rot, ver);
      var val = document.createElement('div');
      val.className = 'val';
      if (c.tipo === 'imagem' && c.padrao) { var im = document.createElement('img'); im.src = c.padrao; im.alt = ''; val.appendChild(im); }
      else val.textContent = curto(c.padrao || (c.tipo === 'imagem' ? '(imagem embutida)' : '(vazio)'), 110);
      row.append(linha, val);
      box.appendChild(row);
    });
    if (!vis) box.innerHTML = '<div class="vazio">Nenhum campo encontrado.</div>';
    contar();
  }

  function destacar(c) {
    var fd = $('#previa').contentDocument;
    if (!fd) return;
    var el = fd.querySelector('[' + c.attr + '="' + c.id + '"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    var antes = el.style.outline;
    el.style.outline = '4px solid #f43f5e';
    el.style.outlineOffset = '2px';
    setTimeout(function () { el.style.outline = antes; }, 1600);
  }

  $('#arquivo').addEventListener('change', function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    (/\.zip$/i.test(f.name) ? enviarZip(f) : enviarHtmlSolto(f)).catch(erroEnvio);
  });
  $('#pasta').addEventListener('change', function (e) {
    var fs = e.target.files;
    if (!fs || !fs.length) return;
    enviarPasta(fs).catch(erroEnvio).finally(function () { e.target.value = ''; });
  });
  $('#extras').addEventListener('change', function (e) {
    var fs = e.target.files;
    if (!fs || !fs.length) return;
    enviarExtras(fs).catch(erroEnvio).finally(function () { e.target.value = ''; });
  });
  $('#marcar-todos').addEventListener('click', function () { marcarVarios(true); });
  $('#desmarcar-todos').addEventListener('click', function () { marcarVarios(false); });
  $('#marcar-tipo').addEventListener('change', function () {
    if (this.value) marcarVarios(true, this.value);
    this.value = '';
  });
  $('#filtro').addEventListener('input', desenhar);
  $('#soMarcados').addEventListener('change', desenhar);

  $('#salvar').addEventListener('click', async function () {
    var btn = this;
    var nome = $('#nome').value.trim();
    if (!nome) { alert('Dê um nome ao template.'); $('#nome').focus(); return; }
    var marc = {};
    cands.forEach(function (c) { if (c.marcado) marc[c.attr + '|' + c.id] = 1; });
    if (!Object.keys(marc).length) { alert('Marque pelo menos um campo que o cliente pode editar.'); return; }
    var cl = doc.cloneNode(true);
    ['data-sf', 'data-sf-link'].forEach(function (a) {
      cl.querySelectorAll('[' + a + ']').forEach(function (el) {
        if (!marc[a + '|' + el.getAttribute(a)]) el.removeAttribute(a);
      });
    });
    var campos = cands.filter(function (c) { return c.marcado; }).map(function (c) {
      return { id: c.id, tipo: c.tipo, rotulo: (c.rotulo || c.id).slice(0, 120), padrao: String(c.padrao || '').slice(0, 5000) };
    });
    var html = '<!DOCTYPE html>\n' + cl.documentElement.outerHTML;
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      var r = await fetch(dados.id ? '/admin/templates/' + dados.id : '/admin/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome, descricao: $('#descricao').value, ativo: $('#ativo').checked, html: html, campos: campos, assets: assetsKey, assetsBase: assetsBase }),
      });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(j.erro || 'Erro ao salvar.');
      location.href = '/admin/templates?ok=' + encodeURIComponent('Template salvo!');
    } catch (e) {
      alert(e.message);
      btn.disabled = false; btn.textContent = 'Salvar template';
    }
  });

  if (dados.html) {
    analisar(dados.html);
    if (assetsKey) pedirJson('/admin/assets/' + assetsKey).then(function (j) { mostrarInfo(j.arquivos, null); }).catch(function () {});
    else mostrarInfo([], null);
  }
})();
