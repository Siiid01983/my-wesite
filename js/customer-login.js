/* ════════════════════════════════════════════════════════════════════════════
 *  customer-login.js — "My Booking" customer lookup (FRONTEND ONLY)
 *
 *  Self-contained module: injects the entry points (header + mobile nav + footer)
 *  and a #customer-login modal, then looks a booking up through the EXISTING
 *  portal login API (hm-api/auth.php) with { email, reference }.
 *
 *  No backend changes. No new endpoints. Reuses bookingService._rowToBooking()
 *  to decode the row (service/from/to are packed into `notes`).
 *
 *  Add to a page with exactly one tag:  <script src="js/customer-login.js"></script>
 * ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__HM_CUSTOMER_LOGIN__) return;      // guard against double-include
  window.__HM_CUSTOMER_LOGIN__ = true;

  var LS_EMAIL = 'hm_cl_email';
  var LS_REF   = 'hm_cl_ref';
  // One-time, same-origin handoff to login.html. The verified email+reference are
  // placed here (NOT in the URL/history/logs); login.html consumes it once to
  // silently establish the portal session. Mirrors PortalAuth's session model.
  var SS_HANDOFF = 'hm_portal_handoff';

  // ── tiny helpers ───────────────────────────────────────────────────────────
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // Decode a raw booking row via the existing formatter, with a safe fallback so
  // the card still works if bookingService.js has not finished loading.
  function decodeBooking(row) {
    if (typeof _rowToBooking === 'function') { try { return _rowToBooking(row); } catch (e) {} }
    var extra = {};
    var notes = String(row.notes || '');
    var idx = notes.indexOf('[HM_EXTRAS]');
    if (idx >= 0) {
      notes.slice(idx + 11).split('\n').forEach(function (line) {
        var c = line.indexOf(':');
        if (c > 0) extra[line.slice(0, c).trim()] = line.slice(c + 1).trim();
      });
    }
    return {
      id:       extra.ref || String(row.id || ''),
      service:  row.service_id || extra.service || '',
      date:     row.booking_date || '',
      fromAddr: extra.from || '',
      toAddr:   extra.to || '',
      status:   row.status || '',
    };
  }

  // ── styles (scoped, brand palette) ──────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('cl-styles')) return;
    var css = ''
      + '#customer-login{position:fixed;inset:0;z-index:9500;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(20,24,18,.55);font-family:system-ui,-apple-system,"Helvetica Neue",sans-serif}'
      + '#customer-login.cl-open{display:flex;animation:clFade .2s ease}'
      + '@keyframes clFade{from{opacity:0}to{opacity:1}}'
      + '.cl-card{background:#F9F9F6;width:100%;max-width:420px;max-height:92vh;overflow-y:auto;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.28);animation:clUp .24s ease}'
      + '@keyframes clUp{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}'
      + '.cl-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 6px}'
      + '.cl-title{font-size:18px;font-weight:800;color:#2C3626;margin:0}'
      + '.cl-x{background:none;border:none;cursor:pointer;color:#7a7f74;font-size:22px;line-height:1;padding:4px 6px;border-radius:8px}'
      + '.cl-x:hover{background:#ececE6}'
      + '.cl-body{padding:6px 20px 22px}'
      + '.cl-sub{font-size:13px;color:#6f756a;margin:0 0 16px}'
      + '.cl-field{margin-bottom:13px}'
      + '.cl-label{display:block;font-size:12.5px;font-weight:700;color:#2C3626;margin-bottom:6px}'
      + '.cl-input{width:100%;box-sizing:border-box;border:1px solid #d9dad2;border-radius:9px;padding:13px 14px;font-size:15px;color:#2C3626;background:#fff;outline:none;font-family:inherit;transition:border-color .15s}'
      + '.cl-input:focus{border-color:#9AB57A;box-shadow:0 0 0 3px rgba(154,181,122,.25)}'
      + '.cl-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#2C3626;color:#fff;border:none;border-radius:10px;padding:15px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;transition:background .2s,transform .1s;margin-top:4px}'
      + '.cl-btn:hover{background:#3a4a32}.cl-btn:active{transform:scale(.98)}'
      + '.cl-btn:disabled{opacity:.65;cursor:default}'
      + '.cl-spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;animation:clSpin .7s linear infinite;display:inline-block}'
      + '@keyframes clSpin{to{transform:rotate(360deg)}}'
      + '.cl-err{display:none;background:#fdecea;border:1px solid #f5c2bc;color:#b3261e;font-size:13px;border-radius:9px;padding:10px 12px;margin-top:12px}'
      + '.cl-err.cl-show{display:block}'
      + '.cl-link{display:block;width:100%;text-align:center;background:none;border:none;color:#6f756a;font-size:13px;cursor:pointer;font-family:inherit;padding:14px 0 2px;text-decoration:underline}'
      + '.cl-result{margin-top:4px}'
      + '.cl-bk{background:#fff;border:1px solid #e3e3de;border-radius:12px;overflow:hidden}'
      + '.cl-bk-top{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px;background:#2C3626;color:#fff}'
      + '.cl-bk-ref{font-size:15px;font-weight:800;letter-spacing:.03em}'
      + '.cl-bk-badge{font-size:11px;font-weight:800;background:#9AB57A;color:#1c2417;border-radius:20px;padding:4px 10px;white-space:nowrap}'
      + '.cl-bk-rows{padding:6px 16px 14px}'
      + '.cl-bk-row{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f0f0ec;font-size:14px}'
      + '.cl-bk-row:last-child{border-bottom:none}'
      + '.cl-bk-k{width:88px;flex-shrink:0;color:#8a8f82;font-weight:600;font-size:12.5px}'
      + '.cl-bk-v{flex:1;color:#2C3626;word-break:break-word}'
      + '.cl-ok{font-size:12.5px;color:#3f7a4f;margin:12px 0 0;text-align:center}'
      /* entry points */
      + '.cl-ft-btn{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:11px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none}'
      + '.cl-ft-btn:hover{background:rgba(255,255,255,.2)}';
    var st = document.createElement('style');
    st.id = 'cl-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ── modal markup ────────────────────────────────────────────────────────────
  function buildModal() {
    if (document.getElementById('customer-login')) return;
    var wrap = document.createElement('div');
    wrap.id = 'customer-login';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', '予約確認 / My Booking');
    wrap.innerHTML = ''
      + '<div class="cl-card" role="document">'
      + '  <div class="cl-head"><h2 class="cl-title">予約確認 / My Booking</h2>'
      + '    <button type="button" class="cl-x" id="clClose" aria-label="閉じる">&times;</button></div>'
      + '  <div class="cl-body">'
      + '    <form id="clForm" novalidate>'
      + '      <p class="cl-sub">ご予約時のメールアドレスと予約番号でご確認いただけます。</p>'
      + '      <div class="cl-field"><label class="cl-label" for="clEmail">メールアドレス / Email</label>'
      + '        <input class="cl-input" id="clEmail" type="email" inputmode="email" autocomplete="email" placeholder="taro@example.com"></div>'
      + '      <div class="cl-field"><label class="cl-label" for="clRef">予約番号 / Booking Reference</label>'
      + '        <input class="cl-input" id="clRef" type="text" autocomplete="off" placeholder="HM-XXXXXXXX-XXXX"></div>'
      + '      <div class="cl-err" id="clErr"></div>'
      + '      <button type="submit" class="cl-btn" id="clSubmit">予約を確認する / View My Booking</button>'
      + '    </form>'
      + '    <div class="cl-result" id="clResult"></div>'
      + '    <button type="button" class="cl-link" id="clHome">← ホームに戻る / Back to Home</button>'
      + '  </div>'
      + '</div>';
    document.body.appendChild(wrap);

    // close interactions
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeModal(); });
    document.getElementById('clClose').addEventListener('click', closeModal);
    document.getElementById('clHome').addEventListener('click', closeModal);
    document.getElementById('clForm').addEventListener('submit', onSubmit);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && wrap.classList.contains('cl-open')) closeModal();
    });
  }

  // ── open / close ────────────────────────────────────────────────────────────
  function openModal() {
    buildModal();
    var wrap = document.getElementById('customer-login');
    // reset transient state, keep prefilled email
    document.getElementById('clErr').classList.remove('cl-show');
    document.getElementById('clResult').innerHTML = '';
    var emailEl = document.getElementById('clEmail');
    var refEl = document.getElementById('clRef');
    if (!emailEl.value) emailEl.value = lsGet(LS_EMAIL);
    if (!refEl.value)   refEl.value = lsGet(LS_REF);
    wrap.classList.add('cl-open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { (emailEl.value ? refEl : emailEl).focus(); }, 60);
  }
  function closeModal() {
    var wrap = document.getElementById('customer-login');
    if (!wrap) return;
    wrap.classList.remove('cl-open');
    document.body.style.overflow = '';
  }
  window.openCustomerLogin = openModal;   // public hook (optional external use)

  // ── submit → existing auth.php ──────────────────────────────────────────────
  function showError(msg) {
    var el = document.getElementById('clErr');
    el.textContent = msg;
    el.classList.add('cl-show');
  }
  async function onSubmit(e) {
    e.preventDefault();
    var emailEl = document.getElementById('clEmail');
    var refEl   = document.getElementById('clRef');
    var btn     = document.getElementById('clSubmit');
    var errEl   = document.getElementById('clErr');
    var resEl   = document.getElementById('clResult');
    var email = (emailEl.value || '').trim();
    var ref   = (refEl.value || '').trim();
    errEl.classList.remove('cl-show');
    resEl.innerHTML = '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !ref) {
      showError('メールアドレスと予約番号をご入力ください。/ Please enter your email and booking reference.');
      return;
    }

    var base = (window.API_BASE || '').replace(/\/+$/, '');
    if (!base) { showError('Booking not found. Please check your details.'); return; }

    var label = btn.innerHTML;
    var navigating = false;
    btn.disabled = true;
    btn.innerHTML = '<span class="cl-spin"></span>確認中... / Checking...';

    try {
      var res = await fetch(base + '/auth.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
        body: JSON.stringify({ email: email, reference: ref }),
      });
      var out = await res.json().catch(function () { return null; });
      if (out && out.ok && out.booking) {
        lsSet(LS_EMAIL, email);
        lsSet(LS_REF, ref);
        // Booking verified → hand off to the customer portal login, which
        // establishes the real session and enters portal.html. The verified
        // pair travels via sessionStorage; only the booking id is in the URL.
        var bookingId = decodeBooking(out.booking).id || ref;
        try {
          sessionStorage.setItem(SS_HANDOFF, JSON.stringify({
            email: email, ref: ref, bookingId: bookingId, ts: Date.now(),
          }));
        } catch (e) {}
        navigating = true;
        btn.innerHTML = '<span class="cl-spin"></span>移動中... / Redirecting...';
        window.location.href = 'login.html?booking=' + encodeURIComponent(bookingId);
        return;
      }
      // Invalid lookup → stay on the page and surface the error in the modal.
      showError('Booking not found. Please check your details. / 予約が見つかりませんでした。');
    } catch (err) {
      showError('Booking not found. Please check your details. / 予約が見つかりませんでした。');
    } finally {
      // Leave the loading state intact while the browser navigates away.
      if (!navigating) {
        btn.disabled = false;
        btn.innerHTML = label;
      }
    }
  }

  // Booking results are no longer rendered inline: a verified lookup now hands
  // off to login.html (see onSubmit), which establishes the portal session.

  // ── entry points (header + mobile nav + footer) ─────────────────────────────
  function bindEntry(el) {
    if (!el) return;
    el.addEventListener('click', function (e) { e.preventDefault(); openModal(); });
  }
  function injectEntryPoints() {
    // Desktop header nav
    var navUl = document.querySelector('header.site-header nav.nav ul');
    if (navUl && !navUl.querySelector('.cl-nav-link')) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#customer-login'; a.className = 'cl-nav-link'; a.textContent = '予約確認';
      li.appendChild(a); navUl.appendChild(li); bindEntry(a);
    }
    // Mobile drawer nav
    var mUl = document.querySelector('#mobileNav ul');
    if (mUl && !mUl.querySelector('.cl-mnav-link')) {
      var mli = document.createElement('li');
      var ma = document.createElement('a');
      ma.href = '#customer-login'; ma.className = 'cl-mnav-link'; ma.textContent = '予約確認 / My Booking';
      mli.appendChild(ma); mUl.insertBefore(mli, mUl.querySelector('.mobile-contacts') || null); bindEntry(ma);
    }
    // Footer CTA strip
    var ftBtns = document.querySelector('.hm-ft__cta-btns');
    if (ftBtns && !ftBtns.querySelector('.cl-ft-btn')) {
      var fa = document.createElement('a');
      fa.href = '#customer-login'; fa.className = 'cl-ft-btn';
      fa.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h5"/></svg>予約確認 / My Booking';
      ftBtns.appendChild(fa); bindEntry(fa);
    }
  }

  // ── init ────────────────────────────────────────────────────────────────────
  function init() {
    injectCSS();
    injectEntryPoints();
    // If the page is navigated to #customer-login directly, open the modal.
    if (location.hash === '#customer-login') openModal();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
