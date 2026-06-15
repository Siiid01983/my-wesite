'use strict';

/* ════════════════════════════════════════════════════════
   AUDIT LOG — Phase 22C
   Records admin actions (booking CRUD, content saves, login/logout)
   to a localStorage ring buffer.  Provides a filterable view and
   CSV export.

   Storage key : hm_audit_log  →  { version, entries: [...] }
   Max entries : 500 (ring buffer — oldest discarded first)
   Auto-logging: patches Adapter write methods after init
   ════════════════════════════════════════════════════════ */

window.AuditLog = (function () {

  var STORAGE_KEY = 'hm_audit_log';
  var MAX_ENTRIES = 500;

  /* In-memory cache of audit entries (UI shape). Filled from Supabase via
     AuditService on every render; the canonical store is Supabase, not
     localStorage. */
  var _cache = [];

  /* ── Storage (legacy localStorage — kept only for backward compatibility) ── */

  function _load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (d && d.version === 1 && Array.isArray(d.entries)) return d;
    } catch (_) {}
    return { version: 1, entries: [] };
  }

  function _persist(d) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (_) {}
  }

  /* Pull the latest entries from the Supabase-backed AuditService into _cache.
     Falls back to legacy localStorage only when AuditService is unavailable. */
  function _refresh() {
    if (!window.AuditService) { _cache = _load().entries; return Promise.resolve(_cache); }
    return AuditService.query({ limit: MAX_ENTRIES }).then(function (entries) {
      _cache = entries || [];
      return _cache;
    });
  }

  /* ── Public record API ── */

  /* action : 'add'|'update'|'delete'|'save'|'login'|'logout'|'export'|'other'
     entity : 'booking'|'quote'|'review'|'price'|'service'|'hero'|'faq'|…
     entityId: string identifier (booking ref, service name, etc.)
     detail  : human-readable description                                       */
  function record(action, entity, entityId, detail) {
    var actor = 'admin';
    if (window.Auth && typeof Auth.getCurrentUser === 'function') {
      actor = Auth.getCurrentUser() || actor;
    } else if (window.Auth && typeof Auth.getRole === 'function') {
      actor = Auth.getRole() || actor;
    }

    var entry = {
      id:       (window.genId ? genId() : Date.now().toString(36)),
      ts:       Date.now(),
      actor:    actor,
      action:   action  || 'other',
      entity:   entity  || '—',
      entityId: entityId || '—',
      detail:   detail  || '',
    };

    /* Optimistic in-memory update so the live 監査ログ view reflects the action
       immediately; the canonical row is persisted to Supabase below. */
    _cache.unshift(entry);
    if (_cache.length > MAX_ENTRIES) _cache = _cache.slice(0, MAX_ENTRIES);

    if (window.AuditService) {
      AuditService.record({
        actor:      actor,
        action:     entry.action,
        targetType: entry.entity,
        targetId:   entry.entityId,
        details:    entry.detail,
      });
    } else {
      /* Legacy fallback (AuditService not loaded) — preserve old behavior. */
      var store = _load();
      store.entries.unshift(entry);
      if (store.entries.length > MAX_ENTRIES) store.entries = store.entries.slice(0, MAX_ENTRIES);
      _persist(store);
    }
  }

  function getAll() { return window.AuditService ? _cache : _load().entries; }

  /* The Supabase audit_log is append-only (immutable). "Clear" drops only the
     legacy localStorage entries + the in-memory cache; Supabase rows survive
     and reappear on the next refresh. */
  function clear() {
    _persist({ version: 1, entries: [] });
    _cache = [];
  }

  /* ── CSV export ── */

  function exportCSV() {
    var rows = [['日時', 'ユーザー', 'アクション', 'エンティティ', 'ID', '詳細']];
    getAll().forEach(function (e) {
      var d = new Date(e.ts);
      var ts = d.getFullYear() + '/' + pad2(d.getMonth()+1) + '/' + pad2(d.getDate()) +
               ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      rows.push([ts, e.actor, e.action, e.entity, e.entityId, e.detail]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (v) { return '"' + String(v||'').replace(/"/g,'""') + '"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a    = document.createElement('a');
    a.href   = URL.createObjectURL(blob);
    a.download = '監査ログ_' + _today() + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function pad2(n) { return String(n).padStart(2,'0'); }
  function _today() { var d = new Date(); return d.getFullYear()+pad2(d.getMonth()+1)+pad2(d.getDate()); }

  /* ── View render ── */

  var _filterState = { action: '', entity: '', query: '' };

  function renderAuditLog() {
    var el = document.getElementById('view-audit-log');
    if (!el) return;
    el.innerHTML =
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<span class="panel-title">監査ログ</span>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<span style="font-size:12px;color:var(--gray-1)" id="auditCount"></span>' +
            '<button class="btn btn-ghost btn-sm" onclick="AuditLog.exportCSV()" style="gap:5px">' +
              '<svg viewBox="0 0 24 24" width="12" height="12">' +
                '<path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>' +
              '</svg>CSV' +
            '</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="AuditLog._confirmClear()">クリア</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="AuditLog.renderAuditLog()">更新</button>' +
          '</div>' +
        '</div>' +

        /* Filter bar */
        '<div style="display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line-2);flex-wrap:wrap">' +
          '<input class="m-input" id="auditSearchInput" placeholder="キーワード検索…" ' +
            'style="flex:1;min-width:160px;padding:6px 10px;font-size:13px" ' +
            'oninput="AuditLog._onFilterChange()" />' +
          '<select class="sel" id="auditActionFilter" onchange="AuditLog._onFilterChange()" ' +
            'style="font-size:13px">' +
            '<option value="">全アクション</option>' +
            '<option value="add">追加</option>' +
            '<option value="update">更新</option>' +
            '<option value="delete">削除</option>' +
            '<option value="save">保存</option>' +
            '<option value="login">ログイン</option>' +
            '<option value="logout">ログアウト</option>' +
            '<option value="export">エクスポート</option>' +
          '</select>' +
          '<select class="sel" id="auditEntityFilter" onchange="AuditLog._onFilterChange()" ' +
            'style="font-size:13px">' +
            '<option value="">全エンティティ</option>' +
            '<option value="booking">予約</option>' +
            '<option value="quote">見積り</option>' +
            '<option value="review">レビュー</option>' +
            '<option value="price">料金</option>' +
            '<option value="service">サービス</option>' +
            '<option value="auth">認証</option>' +
          '</select>' +
        '</div>' +

        '<div class="table-wrap">' +
          '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
            '<thead><tr style="border-bottom:1px solid var(--line)">' +
              '<th style="text-align:left;padding:8px 12px;font-weight:600;color:var(--gray-1);white-space:nowrap">日時</th>' +
              '<th style="text-align:left;padding:8px 12px;font-weight:600;color:var(--gray-1)">ユーザー</th>' +
              '<th style="text-align:left;padding:8px 12px;font-weight:600;color:var(--gray-1)">アクション</th>' +
              '<th style="text-align:left;padding:8px 12px;font-weight:600;color:var(--gray-1)">対象</th>' +
              '<th style="text-align:left;padding:8px 12px;font-weight:600;color:var(--gray-1)">ID / 詳細</th>' +
            '</tr></thead>' +
            '<tbody id="auditTableBody"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    _renderTable();                 /* immediate paint from cache (may be empty) */
    _refresh().then(_renderTable);  /* then pull the latest from Supabase */
  }

  function _renderTable() {
    var body = document.getElementById('auditTableBody');
    var countEl = document.getElementById('auditCount');
    if (!body) return;

    var q      = (_filterState.query || '').toLowerCase();
    var action = _filterState.action;
    var entity = _filterState.entity;

    var entries = getAll().filter(function (e) {
      if (action && e.action !== action) return false;
      if (entity && e.entity !== entity) return false;
      if (q) {
        var haystack = (e.actor + e.action + e.entity + e.entityId + e.detail).toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (countEl) countEl.textContent = entries.length + '件';

    if (!entries.length) {
      body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--gray-1)">ログエントリがありません</td></tr>';
      return;
    }

    var ACTION_LABELS = { add:'追加', update:'更新', delete:'削除', save:'保存', login:'ログイン', logout:'ログアウト', export:'エクスポート', other:'その他' };
    var ACTION_COLORS = { add:'var(--green)', update:'var(--blue)', delete:'var(--red)', save:'var(--blue)', login:'var(--green)', logout:'var(--gray-1)', export:'var(--yellow)', other:'var(--gray-2)' };

    body.innerHTML = entries.slice(0, 200).map(function (e) {
      var d  = new Date(e.ts);
      var ts = d.getFullYear() + '/' + pad2(d.getMonth()+1) + '/' + pad2(d.getDate()) +
               '<br><span style="font-size:11px;color:var(--gray-2)">' +
               pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + '</span>';
      var actionLabel = ACTION_LABELS[e.action] || e.action;
      var actionColor = ACTION_COLORS[e.action] || 'var(--gray-1)';
      return '<tr style="border-bottom:1px solid var(--line-2)">' +
        '<td style="padding:8px 12px;white-space:nowrap">' + ts + '</td>' +
        '<td style="padding:8px 12px;font-size:12px;color:var(--gray-1)">' + _escHTML(e.actor) + '</td>' +
        '<td style="padding:8px 12px"><span style="font-size:11px;font-weight:600;color:' + actionColor + '">' + actionLabel + '</span></td>' +
        '<td style="padding:8px 12px;font-size:12px">' + _escHTML(e.entity) + '</td>' +
        '<td style="padding:8px 12px;font-size:12px;color:var(--gray-1);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          _escHTML(e.entityId + (e.detail ? ' — ' + e.detail : '')) + '</td>' +
      '</tr>';
    }).join('');
  }

  function _escHTML(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function _onFilterChange() {
    _filterState.query  = (document.getElementById('auditSearchInput')  || {}).value || '';
    _filterState.action = (document.getElementById('auditActionFilter') || {}).value || '';
    _filterState.entity = (document.getElementById('auditEntityFilter') || {}).value || '';
    _renderTable();
  }

  function _confirmClear() {
    if (confirm('ローカルの旧監査ログを削除します。Supabaseの監査記録（正本）は保持されます。よろしいですか？')) {
      clear();
      renderAuditLog();
      if (typeof toast === 'function') toast('ローカル監査ログをクリアしました');
    }
  }

  /* ── Auto-logging via Adapter patches ── */

  var _BOOKING_PATCH = [
    ['addBooking',    'add',    'booking',  function (a) { return a[0] ? (a[0].id || '新規') : ''; },  '予約を追加'],
    ['updateBooking', 'update', 'booking',  function (a) { return a[0] || ''; },                      '予約を更新'],
    ['deleteBooking', 'delete', 'booking',  function (a) { return a[0] || ''; },                      '予約を削除'],
    ['addQuote',      'add',    'quote',    function (a) { return a[0] ? (a[0].id || '新規') : ''; },  '見積りを追加'],
    ['deleteQuote',   'delete', 'quote',    function (a) { return a[0] || ''; },                      '見積りを削除'],
    ['savePrices',    'save',   'price',    function ()  { return '料金マスタ'; },                     '料金を保存'],
    ['saveServices',  'save',   'service',  function ()  { return 'サービス設定'; },                   'サービスを保存'],
    ['saveHero',      'save',   'hero',     function ()  { return 'ヒーロー'; },                       'ヒーローを保存'],
    ['saveFaq',       'save',   'faq',      function ()  { return 'FAQ'; },                           'FAQを保存'],
    ['saveFooter',    'save',   'footer',   function ()  { return 'フッター'; },                       'フッターを保存'],
    ['saveCompany',   'save',   'company',  function ()  { return '会社情報'; },                       '会社情報を保存'],
  ];

  function _patchAdapter() {
    if (!window.Adapter) return;

    _BOOKING_PATCH.forEach(function (spec) {
      var method = spec[0], action = spec[1], entity = spec[2], getId = spec[3], detail = spec[4];
      var orig   = Adapter[method];
      if (typeof orig !== 'function') return;

      Adapter[method] = function () {
        var args   = arguments;
        var result = orig.apply(Adapter, args);
        /* Log after call — handle both sync and async returns */
        if (result && typeof result.then === 'function') {
          result.then(function (r) {
            if (!r || r.success !== false) record(action, entity, getId(args), detail);
          });
        } else {
          record(action, entity, getId(args), detail);
        }
        return result;
      };
    });
  }

  /* ── Init ── */

  function init() {
    /* Patch Adapter once all services are loaded */
    if (window.Adapter) {
      _patchAdapter();
    } else {
      /* Adapter may not be defined yet at module load time — retry after a tick */
      setTimeout(function () {
        if (window.Adapter) _patchAdapter();
      }, 0);
    }
  }

  return {
    record:          record,
    getAll:          getAll,
    clear:           clear,
    exportCSV:       exportCSV,
    renderAuditLog:  renderAuditLog,
    _onFilterChange: _onFilterChange,
    _confirmClear:   _confirmClear,
    init:            init,
  };

}());

AuditLog.init();
