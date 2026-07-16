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

  function timeoutLabel(min) { return min === 0 ? '無効（自動ログアウトしない）' : min + ' 分'; }

  function render() {
    var el = document.getElementById('ops-content');
    var s = S.get();
    var user = Ops.Auth.user() || {};

    var opts = S.TIMEOUT_CHOICES.map(function (m) {
      return '<option value="' + m + '"' + (m === s.sessionTimeoutMin ? ' selected' : '') + '>' + timeoutLabel(m) + '</option>';
    }).join('');

    el.innerHTML =
      '<div class="ops-section-title" style="margin-top:2px">セッション</div>' +
      '<div class="ops-card">' +
        '<div class="ops-field">' +
          '<div class="ops-field-main">' +
            '<div class="ops-field-label">自動ログアウト</div>' +
            '<div class="ops-field-sub">操作がないまま経過するとログアウトします</div>' +
          '</div>' +
          '<select class="ops-select" id="ops-set-timeout" aria-label="自動ログアウト時間">' + opts + '</select>' +
        '</div>' +
        '<div class="ops-field">' +
          '<div class="ops-field-main">' +
            '<div class="ops-field-label">事前に警告を表示</div>' +
            '<div class="ops-field-sub">ログアウトの約1分前に通知します</div>' +
          '</div>' +
          '<label class="ops-switch">' +
            '<input type="checkbox" id="ops-set-warn"' + (s.warnEnabled ? ' checked' : '') + (s.sessionTimeoutMin === 0 ? ' disabled' : '') + ' />' +
            '<span class="ops-switch-track"></span>' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<p class="ops-muted" style="font-size:.76rem;margin:2px 4px 0">この設定はこの端末にのみ保存されます。</p>' +

      '<div class="ops-section-title">アカウント</div>' +
      '<div class="ops-card" style="padding:12px 14px">' +
        '<div class="ops-row-title" style="font-size:.92rem">' + U.esc(user.name || user.email || 'スタッフ') + '</div>' +
        (user.email ? '<div class="ops-row-sub" style="margin-bottom:12px">' + U.esc(user.email) + '</div>' : '<div style="height:12px"></div>') +
        '<button class="ops-btn ghost" id="ops-set-logout">' + UI.icon('logout') + 'ログアウト</button>' +
      '</div>' +

      '<div class="ops-section-title">アプリ情報</div>' +
      '<div class="ops-card" style="padding:4px 14px">' +
        '<div class="ops-kv"><span class="k">アプリ</span><span class="v">Hello Moving Ops</span></div>' +
        '<div class="ops-kv"><span class="k">API</span><span class="v" style="font-size:.78rem;word-break:break-all">' + U.esc(Ops.cfg.base) + '</span></div>' +
      '</div>';

    var sel = document.getElementById('ops-set-timeout');
    var warn = document.getElementById('ops-set-warn');

    sel.addEventListener('change', function () {
      var min = parseInt(sel.value, 10) || 0;
      S.save({ sessionTimeoutMin: min });
      Ops.Auth._lastAct = Date.now();   // don't let a shorter value log the user out mid-edit
      warn.disabled = (min === 0);
      UI.toast(min === 0 ? '自動ログアウトを無効にしました' : '自動ログアウトを ' + min + ' 分に設定しました');
    });

    warn.addEventListener('change', function () {
      S.save({ warnEnabled: warn.checked });
      UI.toast(warn.checked ? '警告を有効にしました' : '警告を無効にしました');
    });

    document.getElementById('ops-set-logout').addEventListener('click', function () {
      if (confirm('ログアウトしますか？')) { this.disabled = true; this.innerHTML = '<span class="ops-spin"></span>'; Ops.Auth.logout(); }
    });
  }

  Ops.ready(function () {
    UI.mountChrome({ active: '', title: '設定', back: true });
    render();
  });
})();
