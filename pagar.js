// QR Code do Pix, botão copiar e aviso de "Já paguei"
(function () {
  'use strict';
  var qr = document.getElementById('qr');
  if (qr && window.qrcode) {
    var q = window.qrcode(0, 'M');
    q.addData(qr.dataset.p);
    q.make();
    qr.innerHTML = q.createSvgTag(6, 8);
  }
  var copiar = document.getElementById('copiar');
  if (copiar) {
    copiar.addEventListener('click', function () {
      var t = document.getElementById('copia');
      var ok = function () { copiar.textContent = 'Código copiado!'; setTimeout(function () { copiar.textContent = 'Copiar código Pix'; }, 2000); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t.value).then(ok);
      else { t.select(); document.execCommand('copy'); ok(); }
    });
  }
  var form = document.getElementById('informar');
  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button');
      var f = document.getElementById('comprovante').files[0];
      if (f && f.size > 5 * 1024 * 1024) { alert('O comprovante deve ter até 5 MB.'); return; }
      btn.disabled = true; btn.textContent = 'Enviando...';
      try {
        var data = null;
        if (f) {
          data = await new Promise(function (ok, falha) {
            var fr = new FileReader();
            fr.onload = function () { ok(fr.result); };
            fr.onerror = falha;
            fr.readAsDataURL(f);
          });
        }
        var r = await fetch('/pagar/' + form.dataset.id + '/informar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comprovante: data }),
        });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(j.erro || 'Não foi possível enviar.');
        location.reload();
      } catch (err) {
        alert(err.message);
        btn.disabled = false; btn.textContent = 'Já paguei';
      }
    });
  }
})();
