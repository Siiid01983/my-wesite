'use strict';

/* ════════════════════════════════════════════════════════
   DASHBOARD CUSTOMIZER — Phase 21B
   Widget visibility: settings button → modal → persist via DashboardLayout.
   Patches window.renderDash to gate hidden widgets after every render.
   ════════════════════════════════════════════════════════ */

window.DashboardCustomizer = (function () {

  var WIDGET_LABELS = {
    'stats':           'KPI統計',
    'quick-actions':   'クイックアクション',
    'observability':   'システム監視',
    'bi-revenue':      '売上分析',
    'bi-trend':        '予約トレンド',
    'bi-service':      'サービス人気度',
    'bi-customer':     '顧客分析',
    'bi-operational':  '稼働状況',
    'bi-export':       'データエクスポート',
    'recent-bookings': '最近の予約',
    'activity':        '最近のアクティビティ',
  };

  /* Return the visual root element to show/hide for a given widget descriptor.
     Once DashboardReorder creates slot wrappers, prefer the slot so that visibility
     hides the whole draggable unit, not just the inner element.
     Also clears any prior inline display set directly on the inner element so that
     a newly-slotted widget doesn't remain hidden inside a visible slot. */
  function _container(widget) {
    var slot = document.querySelector('.dash-slot[data-slot="' + widget.id + '"]');
    if (slot) {
      var inner = document.getElementById(widget.elementId);
      if (inner) inner.style.display = '';
      return slot;
    }
    var el = document.getElementById(widget.elementId);
    if (!el) return null;
    if (widget.id === 'recent-bookings' || widget.id === 'activity') {
      return el.closest('.panel') || el;
    }
    return el;
  }

  /* Apply visibility for every widget in the persisted layout.
     Then sync wrapper rows so empty flex rows don't leave blank gaps. */
  function applyLayout() {
    var layout = DashboardLayout.get();
    layout.widgets.forEach(function (w) {
      var el = _container(w);
      if (!el) return;
      el.style.display = w.visible ? '' : 'none';
    });
    _syncWrappers();
  }

  /* Hide a row/group container when ALL its direct panel children are hidden.
     Once DashboardReorder is active those wrapper divs are already empty and hidden;
     skip this logic to avoid accidentally un-hiding them. */
  function _syncWrappers() {
    if (document.getElementById('dashOrderContainer')) return;

    ['biRow1', 'biRow2'].forEach(function (id) {
      var row = document.getElementById(id);
      if (!row) return;
      var anyVisible = false;
      for (var i = 0; i < row.children.length; i++) {
        if (row.children[i].style.display !== 'none') { anyVisible = true; break; }
      }
      row.style.display = anyVisible ? '' : 'none';
    });

    var dashPanels = document.querySelector('#view-dashboard .dash-panels');
    if (dashPanels) {
      var anyVisible = false;
      for (var i = 0; i < dashPanels.children.length; i++) {
        if (dashPanels.children[i].style.display !== 'none') { anyVisible = true; break; }
      }
      dashPanels.style.display = anyVisible ? '' : 'none';
    }
  }

  /* Inject a settings toolbar above statGrid (idempotent). */
  function _injectSettingsBtn() {
    if (document.getElementById('dashCustomizerBar')) return;
    var view = document.getElementById('view-dashboard');
    if (!view) return;

    var bar = document.createElement('div');
    bar.id = 'dashCustomizerBar';
    bar.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:12px';
    bar.innerHTML =
      '<button class="btn btn-ghost btn-sm" onclick="DashboardCustomizer.openModal()" ' +
      'style="display:inline-flex;align-items:center;gap:6px">' +
        '<svg viewBox="0 0 24 24" width="13" height="13" style="flex-shrink:0">' +
          '<path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81C14.36 2.57 14.16 2.4 13.92 2.4H10.08c-.24 0-.43.17-.47.41L9.25 5.35c-.59.24-1.13.56-1.62.94L5.24 5.33c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58C4.84 11.36 4.8 11.69 4.8 12s.02.64.07.94L2.84 14.52c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>' +
        '</svg>' +
        'ダッシュボード設定' +
      '</button>';
    view.insertBefore(bar, view.firstChild);
  }

  /* Build and display the settings modal. */
  function openModal() {
    var existing = document.getElementById('dashCustomizerModal');
    if (existing) existing.remove();

    var layout = DashboardLayout.get();
    var rows = layout.widgets.map(function (w) {
      var label = WIDGET_LABELS[w.id] || w.id;
      var checked = w.visible ? ' checked' : '';
      return '<div style="display:flex;align-items:center;justify-content:space-between;' +
             'padding:11px 0;border-bottom:1px solid var(--line-2)">' +
        '<span style="font-size:14px;color:var(--ink)">' + label + '</span>' +
        '<label class="toggle">' +
          '<input type="checkbox" data-widget-id="' + w.id + '"' + checked + '>' +
          '<div class="toggle-track"></div>' +
          '<div class="toggle-thumb"></div>' +
        '</label>' +
      '</div>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.id    = 'dashCustomizerModal';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML =
      '<div class="modal" style="max-width:420px">' +
        '<div class="modal-title">ダッシュボード設定</div>' +
        '<p style="font-size:13px;color:var(--gray-1);margin:-8px 0 16px">表示するウィジェットを選択してください</p>' +
        '<div style="margin-bottom:4px">' + rows + '</div>' +
        '<div class="m-actions">' +
          '<button class="btn btn-ghost" onclick="DashboardCustomizer.closeModal()">キャンセル</button>' +
          '<button class="btn btn-primary" onclick="DashboardCustomizer.saveSettings()">保存</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) DashboardCustomizer.closeModal();
    });
  }

  function closeModal() {
    var el = document.getElementById('dashCustomizerModal');
    if (el) el.remove();
  }

  /* Read toggle states → persist → close → re-apply visibility. */
  function saveSettings() {
    var overlay = document.getElementById('dashCustomizerModal');
    if (!overlay) return;

    var layout = DashboardLayout.get();
    overlay.querySelectorAll('input[data-widget-id]').forEach(function (inp) {
      var widget = layout.widgets.find(function (w) { return w.id === inp.dataset.widgetId; });
      if (widget) widget.visible = inp.checked;
    });

    DashboardLayout.save(layout);
    closeModal();
    applyLayout();

    if (typeof toast === 'function') toast('ダッシュボードを更新しました');
  }

  /* Patch window.renderDash once so every call re-injects the button
     and applies the persisted layout without touching dashboard.js. */
  function init() {
    var _orig = window.renderDash;
    if (typeof _orig !== 'function') return;
    window.renderDash = function () {
      _orig.apply(this, arguments);
      _injectSettingsBtn();
      applyLayout();
    };
  }

  return {
    init:        init,
    openModal:   openModal,
    closeModal:  closeModal,
    saveSettings: saveSettings,
    applyLayout: applyLayout,
  };

}());

/* Boot immediately — renderDash is already defined when this script loads
   (dashboardCustomizer.js loads after dashboard.js per admin.html order). */
DashboardCustomizer.init();
