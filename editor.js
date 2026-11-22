// Painel do cliente: envio de fotos e miniaturas
(function () {
  'use strict';
  document.querySelectorAll('input[type=file][data-alvo]').forEach(function (inp) {
    inp.addEventListener('change', async function () {
      var f = inp.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { alert('A imagem deve ter até 5 MB.'); inp.value = ''; return; }
      var bloco = inp.closest('.img-campo');
      bloco.classList.add('carregando');
      try {
        var data = await new Promise(function (ok, falha) {
          var fr = new FileReader();
          fr.onload = function () { ok(fr.result); };
          fr.onerror = falha;
          fr.readAsDataURL(f);
        });
        var r = await fetch('/painel/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: data }),
        });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(j.erro || 'Falha ao enviar a imagem.');
        document.getElementById(inp.dataset.alvo).value = j.url;
        var th = document.getElementById(inp.dataset.alvo + '_th');
        if (th) th.src = j.url;
      } catch (e) {
        alert(e.message);
      } finally {
        bloco.classList.remove('carregando');
        inp.value = '';
      }
    });
  });
  document.querySelectorAll('select[data-modo]').forEach(function (s) {
    s.addEventListener('change', function () {
      var inp = document.getElementById('f_' + s.id.slice(2));
      inp.hidden = s.value !== 'url';
      if (!inp.hidden) inp.focus();
    });
  });
  document.querySelectorAll('input[data-thumb]').forEach(function (i) {
    i.addEventListener('change', function () {
      var th = document.getElementById(i.id + '_th');
      if (th && i.value) th.src = i.value;
    });
  });
})();
