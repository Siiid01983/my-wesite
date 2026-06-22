/* ════════════════════════════════════════════════════════════════════════════
   adminReauth.js — window.AdminReauth

   The ONE centralized guard that makes admin-auth enforcement safe to enable.
   Without it, the admin write pattern is "optimistic localStorage first, then
   fire-and-forget API call" — so a rest.php 401 (admin_required) would leave the
   UI showing a save that never persisted (silent divergence). This module:

     1. Lets apiClient PRE-FLIGHT block a protected admin write when enforcement
        is active but no admin token exists (never even attempts the write).
     2. DETECTS a real admin_required response centrally (also via apiClient).
     3. ROLLS BACK optimistic local state by re-syncing server truth
        (Adapter.syncFromApi() — reads are not admin-gated, and the server still
        holds the prior value because it rejected the write).
     4. Shows ONE blocking, bilingual (JP+EN) re-login prompt with no technical
        detail, whose only action re-authenticates.

   Inert unless enforcement is active (window.__HM_ADMIN_ENFORCED) or the server
   actually returns admin_required — so it is a no-op while admin_auth_enabled is
   off. Loaded only on the admin surfaces (admin.html / websiteManagement.html);
   apiClient guards every call with `window.AdminReauth && …`.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.AdminReauth) return;

  // Must match $ADMIN_WRITE_TABLES in hm-api/rest.php.
  var ADMIN_TABLES = ['hm_data', 'services', 'calendar_availability', 'inbox_messages'];
  var _shown = false;

  function isEnforced() { return !!window.__HM_ADMIN_ENFORCED; }
  function hasToken()   { return !!window.__HM_ADMIN_TOKEN; }

  // Mirrors the server gate: any delete, or a write to an admin-only table.
  function isProtectedWrite(spec) {
    if (!spec) return false;
    if (spec.action === 'delete') return true;
    return (spec.action === 'insert' || spec.action === 'upsert' || spec.action === 'update')
      && ADMIN_TABLES.indexOf(spec.table) !== -1;
  }

  // Block ONLY when we positively know enforcement is on and we have no token.
  // (Expired/invalid tokens still have a token value → they go to the server and
  // are caught by the response-side handler instead.)
  function shouldBlock(spec) {
    return isEnforced() && !hasToken() && isProtectedWrite(spec);
  }

  // Roll back optimistic local state: pull authoritative rows back from the
  // server. The rejected write never landed, so the server still holds the
  // previous value — re-reading restores it across services / calendar / all
  // hm_data keys. Reads are not admin-gated, so this works without a token.
  function reconcile() {
    try {
      if (window.DataProvider) ADMIN_TABLES.forEach(function (t) { DataProvider.invalidate(t); });
    } catch (_) {}
    try {
      if (window.Adapter && typeof Adapter.syncFromApi === 'function') {
        Promise.resolve(Adapter.syncFromApi()).catch(function () {});
      }
    } catch (_) {}
    try { document.dispatchEvent(new CustomEvent('hm:admin-reauth')); } catch (_) {}
  }

  function _renderModal() {
    if (document.getElementById('hmReauthOverlay')) return;
    var o = document.createElement('div');
    o.id = 'hmReauthOverlay';
    o.setAttribute('role', 'alertdialog');
    o.setAttribute('aria-modal', 'true');
    o.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(10,15,8,.80);display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,sans-serif';
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;max-width:430px;width:100%;border-radius:16px;padding:30px 26px;box-shadow:0 24px 70px rgba(0,0,0,.45);text-align:center';
    // No technical detail — just "session expired, last change not saved, log in again".
    card.innerHTML =
      '<div style="font-size:36px;line-height:1;margin-bottom:10px">🔒</div>' +
      '<h2 style="margin:0 0 6px;font-size:18px;color:#2C3626">管理者セッションの有効期限が切れました</h2>' +
      '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#444">セキュリティのため、もう一度ログインしてください。<br>直前の変更は保存されていません。</p>' +
      '<div style="height:1px;background:#eee;margin:14px 0"></div>' +
      '<h3 style="margin:0 0 4px;font-size:14px;color:#2C3626">Admin session expired</h3>' +
      '<p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#666">For your security, please log in again.<br>Your last change was not saved.</p>';
    var btn = document.createElement('button');
    btn.textContent = '再ログイン / Log in again';
    btn.style.cssText = 'background:#2C3626;color:#fff;border:none;border-radius:10px;padding:13px 22px;font-size:14px;font-weight:700;cursor:pointer;width:100%';
    btn.onmouseenter = function () { btn.style.background = '#3a4733'; };
    btn.onmouseleave = function () { btn.style.background = '#2C3626'; };
    btn.onclick = function () {
      try { if (window.Auth && typeof Auth.logout === 'function') { Auth.logout(); return; } } catch (_) {}
      location.reload();
    };
    card.appendChild(btn);
    o.appendChild(card);
    (document.body || document.documentElement).appendChild(o);
  }

  // Show the prompt once (debounced) and roll back optimistic state.
  function notify() {
    if (_shown) return;
    _shown = true;
    reconcile();
    try { _renderModal(); } catch (_) {}
  }

  // Called by apiClient for any admin_required response (pre-flight or real 401).
  function handle(error) {
    if (error && error.code === 'admin_required') { notify(); return true; }
    return false;
  }

  window.AdminReauth = {
    ADMIN_TABLES:     ADMIN_TABLES,
    isProtectedWrite: isProtectedWrite,
    shouldBlock:      shouldBlock,
    handle:           handle,
    notify:           notify,
    reconcile:        reconcile,
  };
})();
