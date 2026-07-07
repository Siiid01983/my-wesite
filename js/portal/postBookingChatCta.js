'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   postBookingChatCta.js — inject a「チャットを開く」CTA on the BA booking
   success screen, WITHOUT touching the locked booking flow markup or logic.

   The booking success screen (index.html, class .ba-success) shows the new
   reservation's reference in #ba-ref-num. This standalone enhancer watches for
   that screen to appear, then injects one CTA that carries the customer toward
   their chat room: it stashes the intent + reference and navigates to the portal
   login (reference prefilled). After login, portal.html reads the stashed intent
   and opens the Chat tab. Purely additive: if the success markup ever changes or
   is absent, this simply never injects and does nothing.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  var INJECTED_ID = 'ba-chat-cta';
  var VIEW_KEY    = 'hm_after_login_view';   // read by portal.html init()
  var REF_KEY     = 'hm_after_login_ref';

  function _ref() {
    var el = document.getElementById('ba-ref-num');
    return el ? (el.textContent || '').trim() : '';
  }
  function _successVisible() {
    var s = document.querySelector('.ba-success');
    return s && s.offsetParent !== null;   // rendered AND displayed
  }

  function _inject() {
    if (document.getElementById(INJECTED_ID)) return;   // once
    if (!_successVisible()) return;
    var ref = _ref();
    if (!ref) return;                                    // wait until populated

    var refEl  = document.getElementById('ba-ref-num');
    var anchor = (refEl && (refEl.closest('.ba-card') || refEl.parentNode)) || null;
    var host   = document.querySelector('.ba-success');
    if (!host) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = INJECTED_ID;
    btn.textContent = '💬 チャットで相談する';
    btn.setAttribute('style',
      'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;' +
      'margin:16px 0 4px;padding:14px 18px;border:none;border-radius:10px;cursor:pointer;' +
      'background:#06C755;color:#fff;font-size:15px;font-weight:700;font-family:inherit;' +
      'box-shadow:0 6px 16px rgba(6,199,85,.28)');
    btn.addEventListener('click', function () {
      try {
        sessionStorage.setItem(VIEW_KEY, 'chat');
        sessionStorage.setItem(REF_KEY, ref);
      } catch (_) {}
      window.location.href = 'login.html?ref=' + encodeURIComponent(ref);
    });

    // Place it right below the reference card when we can; else append.
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    else host.appendChild(btn);
  }

  // The success screen is shown/populated by the booking app after submit. Watch
  // the DOM for it (cheap; disconnects nothing — booking is a one-shot per page).
  function _start() {
    _inject();   // in case it's already visible
    var obs = new MutationObserver(function () { _inject(); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _start);
  } else {
    _start();
  }
})();
