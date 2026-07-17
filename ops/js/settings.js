/* ════════════════════════════════════════════════════════════════════════════
   settings.js — Settings (/ops/settings.html)

   Device-local operator preferences. Currently: session (inactivity) timeout and
   the pre-logout warning toggle. Changes persist via Ops.Settings (localStorage)
   and apply immediately to the live session watcher (Ops.cfg is updated in place,
   so the next tick honors the new value — no reload needed).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var U = Ops.util, UI = Ops.UI, S = Ops.Settings;

  function timeoutLabel(min) { return min === 0 ? t('settings.timeoutOffLong') : t('settings.minutes', { n: min }); }

  function render() {
    var el = document.getElementById('ops-content');
    var s = S.get();
    var user = Ops.Auth.user() || {};

    var opts = S.TIMEOUT_CHOICES.map(function (m) {
      return '<option value="' + m + '"' + (m === s.sessionTimeoutMin ? ' selected' : '') + '>' + timeoutLabel(m) + '</option>';
    }).join('');

    el.innerHTML =
      '<div class="ops-section-title" style="margin-top:2px">' + t('settings.session') + '</div>' +
      '<div class="ops-card">' +
        '<div class="ops-field">' +
          '<div class="ops-field-main">' +
            '<div class="ops-field-label">' + t('settings.autoLogout') + '</div>' +
            '<div class="ops-field-sub">' + t('settings.autoLogoutSub') + '</div>' +
          '</div>' +
          '<select class="ops-select" id="ops-set-timeout" aria-label="' + t('settings.autoLogoutAria') + '">' + opts + '</select>' +
        '</div>' +
        '<div class="ops-field">' +
          '<div class="ops-field-main">' +
            '<div class="ops-field-label">' + t('settings.warnLabel') + '</div>' +
            '<div class="ops-field-sub">' + t('settings.warnSub') + '</div>' +
          '</div>' +
          '<label class="ops-switch">' +
            '<input type="checkbox" id="ops-set-warn"' + (s.warnEnabled ? ' checked' : '') + (s.sessionTimeoutMin === 0 ? ' disabled' : '') + ' />' +
            '<span class="ops-switch-track"></span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<p class="ops-muted" style="font-size:.76rem;margin:2px 4px 0">' + t('settings.deviceOnly') + '</p>' +

      '<div class="ops-section-title">' + t('settings.account') + '</div>' +
      '<div class="ops-card" style="padding:12px 14px">' +
        '<div class="ops-row-title" style="font-size:.92rem">' + U.esc(user.name || user.email || t('common.staff')) + '</div>' +
        (user.email ? '<div class="ops-row-sub" style="margin-bottom:12px">' + U.esc(user.email) + '</div>' : '<div style="height:12px"></div>') +
        '<button class="ops-btn ghost" id="ops-set-logout">' + UI.icon('logout') + t('chrome.logout') + '</button>' +
      '</div>' +

      '<div class="ops-section-title">' + t('settings.appInfo') + '</div>' +
      '<div class="ops-card" style="padding:4px 14px">' +
        '<div class="ops-kv"><span class="k">' + t('settings.appLabel') + '</span><span class="v">Hello Moving Ops</span></div>' +
        '<div class="ops-kv"><span class="k">API</span><span class="v" style="font-size:.78rem;word-break:break-all">' + U.esc(Ops.cfg.base) + '</span></div>' +
      '</div>';

    var sel = document.getElementById('ops-set-timeout');
    var warn = document.getElementById('ops-set-warn');

    sel.addEventListener('change', function () {
      var min = parseInt(sel.value, 10) || 0;
      S.save({ sessionTimeoutMin: min });
      Ops.Auth._lastAct = Date.now();   // don't let a shorter value log the user out mid-edit
      warn.disabled = (min === 0);
      UI.toast(min === 0 ? t('settings.timeoutDisabled') : t('settings.timeoutSet', { n: min }));
    });

    warn.addEventListener('change', function () {
      S.save({ warnEnabled: warn.checked });
      UI.toast(warn.checked ? t('settings.warnOn') : t('settings.warnOff'));
    });

    document.getElementById('ops-set-logout').addEventListener('click', function () {
      if (confirm(t('chrome.logoutConfirm'))) { this.disabled = true; this.innerHTML = '<span class="ops-spin"></span>'; Ops.Auth.logout(); }
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: '', title: t('settings.title'), back: true });
    render();
  });
})();
