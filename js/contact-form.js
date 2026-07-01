'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   Public contact form  →  hm-api/contact.php  (server routes to contact@ via
   EmailService.php). Client-side validation + loading / success / error states.
   Reuses the site's existing .cta-form styles; no new CSS. Mirrors the fetch
   pattern used by admin-bookings.js / customer-login.js (API_BASE + X-API-KEY).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  var form = document.getElementById('hmContactForm');
  if (!form) return;

  var statusEl  = document.getElementById('cfStatus');
  var submitBtn = document.getElementById('cfSubmit');
  var EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent   = msg || '';
    statusEl.style.display = msg ? 'block' : 'none';
    statusEl.style.color =
      kind === 'error'   ? '#c23' :
      kind === 'success' ? '#0a7d33' :
                           'var(--gray-2)';
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? (el.value || '').trim() : '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var name    = val('cfName');
    var email   = val('cfEmail');
    var phone   = val('cfPhone');
    var subject = val('cfSubject');
    var message = val('cfMessage');

    /* ── Client-side validation (server re-validates authoritatively) ── */
    if (!name)                 { setStatus('お名前をご入力ください。', 'error'); document.getElementById('cfName').focus(); return; }
    if (!EMAIL_RE.test(email)) { setStatus('正しいメールアドレスをご入力ください。', 'error'); document.getElementById('cfEmail').focus(); return; }
    if (!message)              { setStatus('メッセージをご入力ください。', 'error'); document.getElementById('cfMessage').focus(); return; }

    var base = (window.API_BASE || '').replace(/\/$/, '');
    if (!base) { setStatus('送信先が設定されていません。お急ぎの場合はLINEよりご連絡ください。', 'error'); return; }

    /* ── Loading state ── */
    var origLabel = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '送信中…'; }
    setStatus('送信しています…', 'info');

    fetch(base + '/contact.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
      body: JSON.stringify({ name: name, email: email, phone: phone, subject: subject, message: message })
    })
      .then(function (res) {
        return res.json().catch(function () { return { ok: false, error: { message: 'HTTP ' + res.status } }; });
      })
      .then(function (result) {
        if (result && result.ok) {
          form.reset();
          setStatus('お問い合わせを送信しました。ご返信までいましばらくお待ちください。', 'success');
        } else {
          var err = result && result.error;
          var msg = (err && (err.message || err)) || '送信に失敗しました。';
          setStatus('送信できませんでした：' + msg + '　お急ぎの場合はLINEよりご連絡ください。', 'error');
        }
      })
      .catch(function () {
        setStatus('通信エラーが発生しました。時間をおいて再度お試しください。', 'error');
      })
      .then(function () {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origLabel; }
      });
  });
})();
