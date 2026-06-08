'use strict';

/* ════════════════════════════════════════════════════════
   CRM UI — Phase 25
   Renders the CRM view: split-panel customer list + detail.
   Detail tabs: プロフィール / タイムライン / メモ / 分析

   Depends on: CustomerProfiles, CRMTimeline, CRMTags, CRMNotes,
               CRMInsights, esc, toast, MN (optional)
   ════════════════════════════════════════════════════════ */

window.CRMUI = (function () {

  try { VIEW_TITLES['crm'] = 'CRM 顧客管理'; } catch (_) {}
  try { _ADMIN_ONLY.add('crm'); } catch (_) {}

  var _activeId  = null;
  var _activeTab = 'profile';
  var _search    = '';
  var _filter    = 'all';

  /* ── Helpers ── */

  function _yen(n) {
    return typeof MN === 'function' ? MN(n || 0) : ('¥' + Math.round(n || 0).toLocaleString());
  }

  function _p2(n) { return String(n).padStart(2, '0'); }

  function _fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? (iso || '').slice(0, 10)
      : d.getFullYear() + '/' + _p2(d.getMonth() + 1) + '/' + _p2(d.getDate());
  }

  var STATUS_BADGE = {
    vip:       ['VIP',  'rgba(245,158,11,.12)',  '#92400e', 'rgba(245,158,11,.3)'],
    returning: ['常連', 'rgba(37,99,235,.1)',    '#1d4ed8', 'rgba(37,99,235,.2)'],
    new:       ['新規', 'rgba(16,185,129,.1)',   '#065f46', 'rgba(16,185,129,.2)'],
  };

  function _badge(status) {
    var m = STATUS_BADGE[status] || ['?', 'transparent', 'var(--gray-1)', 'var(--line)'];
    return '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:12px;' +
      'background:' + m[1] + ';color:' + m[2] + ';border:1px solid ' + m[3] + '">' + m[0] + '</span>';
  }

  function _metric(label, value, color) {
    return '<div style="background:var(--bg-soft);border-radius:8px;padding:10px 14px">' +
      '<div style="font-size:11px;color:var(--gray-2)">' + label + '</div>' +
      '<div style="font-size:18px;font-weight:700;color:' + color + ';margin-top:2px">' + value + '</div>' +
    '</div>';
  }

  /* ── Render main CRM view ── */

  function renderCRM() {
    var el = document.getElementById('view-crm');
    if (!el) return;
    var all = CustomerProfiles.build();
    var filtered = all.filter(function (p) {
      if (_filter !== 'all' && p.status !== _filter) return false;
      if (!_search) return true;
      var q = _search.toLowerCase();
      return (p.name  || '').toLowerCase().indexOf(q) !== -1 ||
             (p.email || '').toLowerCase().indexOf(q) !== -1 ||
             (p.phone || '').toLowerCase().indexOf(q) !== -1;
    });
    el.innerHTML =
      '<div style="display:flex;gap:16px;height:calc(100vh - 130px);min-height:500px">' +
        _listPanel(filtered, all) +
        '<div id="crmDetail" style="flex:1;overflow-y:auto">' +
          (_activeId ? _detailPanel(CustomerProfiles.get(_activeId)) : _placeholder()) +
        '</div>' +
      '</div>';
  }

  /* ── Left panel: customer list ── */

  function _listPanel(filtered, all) {
    var counts = { vip: 0, returning: 0, new: 0 };
    all.forEach(function (p) { if (counts[p.status] !== undefined) counts[p.status]++; });

    function _fb(key, label, n) {
      var on = _filter === key;
      return '<button onclick="CRMUI._onFilter(\'' + key + '\')" style="font-size:10px;padding:2px 7px;border-radius:10px;cursor:pointer;border:1px solid;' +
        (on ? 'background:var(--navy);color:#fff;border-color:var(--navy)' : 'background:var(--bg);color:var(--ink);border-color:var(--line)') + '">' +
        label + ' ' + n + '</button>';
    }

    var rows = filtered.map(function (p) {
      var isActive = p.id === _activeId;
      return '<div onclick="CRMUI.select(\'' + p.id + '\')" style="display:flex;flex-direction:column;gap:4px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--line);' +
          (isActive ? 'background:var(--bg-soft-2)' : '') + '">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:13px;font-weight:600;color:var(--ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.name) + '</span>' +
          _badge(p.status) +
        '</div>' +
        '<div style="font-size:11px;color:var(--gray-2);display:flex;gap:8px">' +
          '<span>予約 ' + p.totalBookings + '件</span>' +
          (p.totalRevenue ? '<span>' + _yen(p.totalRevenue) + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    return '<div style="width:260px;flex-shrink:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column">' +
      '<div style="padding:10px 12px;background:var(--bg-soft);border-bottom:1px solid var(--line)">' +
        '<input class="input" type="text" placeholder="名前・メール・電話..." value="' + esc(_search) + '" ' +
          'oninput="CRMUI._onSearch(this.value)" style="width:100%;margin-bottom:8px" />' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap">' +
          _fb('all',       '全員',  all.length) +
          _fb('vip',       'VIP',   counts.vip) +
          _fb('returning', '常連',  counts.returning) +
          _fb('new',       '新規',  counts.new) +
        '</div>' +
      '</div>' +
      '<div style="flex:1;overflow-y:auto">' +
        (rows || '<div style="padding:20px;text-align:center;color:var(--gray-2);font-size:12px">顧客なし</div>') +
      '</div>' +
    '</div>';
  }

  function _placeholder() {
    return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--gray-2)">' +
      '<svg viewBox="0 0 24 24" width="48" height="48" style="margin-bottom:12px;opacity:.25"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>' +
      '<p style="font-size:13px">顧客を選択してください</p>' +
    '</div>';
  }

  /* ── Detail panel ── */

  function _detailPanel(p) {
    if (!p) return _placeholder();
    var TABS = [['profile','プロフィール'],['timeline','タイムライン'],['notes','メモ'],['insights','分析']];
    var tabNav = TABS.map(function (t) {
      var on = _activeTab === t[0];
      return '<button onclick="CRMUI.tab(\'' + t[0] + '\')" style="font-size:12px;padding:8px 12px;background:none;border:none;cursor:pointer;' +
        (on ? 'border-bottom:2px solid var(--navy);color:var(--ink);font-weight:600' : 'border-bottom:2px solid transparent;color:var(--gray-2)') + '">' +
        t[1] + '</button>';
    }).join('');

    var chips = (p.tags || []).map(function (t) {
      return '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:var(--bg-soft-2);color:var(--gray-1);cursor:pointer" ' +
        'onclick="CRMUI._removeTag(\'' + p.id + '\',\'' + esc(t) + '\')">' + esc(t) + ' ✕</span>';
    }).join('');

    var body = _activeTab === 'timeline' ? _tabTimeline(p)
             : _activeTab === 'notes'    ? _tabNotes(p)
             : _activeTab === 'insights' ? _tabInsights(p)
             : _tabProfile(p);

    return '<div class="panel">' +
      '<div class="panel-head" style="flex-wrap:wrap;gap:8px">' +
        '<div style="display:flex;align-items:center;gap:10px;flex:1">' +
          '<div style="width:38px;height:38px;border-radius:50%;background:var(--navy);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px;flex-shrink:0">' +
            esc((p.name || '?').slice(0, 1)) +
          '</div>' +
          '<div>' +
            '<div style="font-size:15px;font-weight:700;color:var(--ink)">' + esc(p.name) + '</div>' +
            '<div style="display:flex;gap:5px;margin-top:3px;flex-wrap:wrap">' + _badge(p.status) + chips + '</div>' +
          '</div>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="CRMUI._promptTag(\'' + p.id + '\')">タグ追加</button>' +
      '</div>' +
      '<div style="border-bottom:1px solid var(--line);display:flex">' + tabNav + '</div>' +
      '<div class="panel-body">' + body + '</div>' +
    '</div>';
  }

  /* ── Profile tab ── */

  function _tabProfile(p) {
    function _row(lbl, val) {
      if (!val) return '';
      return '<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--line-2)">' +
        '<div style="width:110px;font-size:11px;color:var(--gray-2);flex-shrink:0">' + lbl + '</div>' +
        '<div style="font-size:12px;color:var(--ink)">' + esc(String(val)) + '</div>' +
      '</div>';
    }
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div>' +
        _row('メールアドレス', p.email) +
        _row('電話番号',       p.phone) +
        _row('住所',           p.address) +
        _row('初回予約日',     _fmtDate(p.firstBookingDate)) +
        _row('最終予約日',     _fmtDate(p.lastBookingDate)) +
        _row('見積もり数',     p.totalQuotes ? p.totalQuotes + '件' : null) +
        _row('レビュー数',     p.totalReviews ? p.totalReviews + '件' : null) +
        (p.avgRating ? _row('平均評価', '★ ' + p.avgRating.toFixed(1)) : '') +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
        _metric('予約数',  p.totalBookings + '件', 'var(--blue)') +
        _metric('総売上',  _yen(p.totalRevenue),   'var(--green)') +
      '</div>' +
    '</div>';
  }

  /* ── Timeline tab (Phase 25B) — vertical timeline with connecting line ── */

  var _TIMELINE_COLOR = { booking: 'var(--blue)', quote: 'var(--yellow)', review: 'var(--green)', note: 'var(--gray-1)' };

  function _tabTimeline(p) {
    var events = CRMTimeline.get(p);
    if (!events.length) return '<div style="color:var(--gray-2);font-size:12px;padding:12px 0">インタラクションはありません</div>';

    var title = '<div style="font-size:11px;font-weight:700;color:var(--gray-1);text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">顧客タイムライン</div>';

    var items = events.map(function (e, i) {
      var color  = _TIMELINE_COLOR[e.type] || 'var(--gray-1)';
      var isLast = i === events.length - 1;
      return '<div style="display:flex;gap:0">' +
        /* Dot + vertical connector */
        '<div style="display:flex;flex-direction:column;align-items:center;width:22px;flex-shrink:0">' +
          '<div style="width:10px;height:10px;border-radius:50%;background:' + color + ';margin-top:3px;flex-shrink:0;' +
            'box-shadow:0 0 0 3px var(--bg),0 0 0 4px ' + color + ';opacity:.85"></div>' +
          (!isLast ? '<div style="width:2px;flex:1;background:var(--line);margin-top:4px;min-height:20px"></div>' : '') +
        '</div>' +
        /* Content */
        '<div style="flex:1;padding:0 0 18px 10px">' +
          '<div style="font-size:10px;color:var(--gray-2);margin-bottom:1px;font-variant-numeric:tabular-nums">' + esc(e.dateLabel || '—') + '</div>' +
          '<div style="font-size:12px;font-weight:600;color:var(--ink)">' + esc(e.typeLabel || e.label || '—') + '</div>' +
          (e.label ? '<div style="font-size:11px;color:var(--gray-1);margin-top:1px">' + esc(e.label) + '</div>' : '') +
          (e.detail ? '<div style="font-size:11px;color:var(--gray-2);margin-top:2px;line-height:1.4">' + esc(e.detail) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    return title + '<div style="padding-top:2px">' + items + '</div>';
  }

  /* ── Notes tab (Phase 25C) — staff notes with author + timestamp ── */

  function _tabNotes(p) {
    var notes = CRMNotes.get(p.id);
    var rows = notes.map(function (n) {
      var raw = n.timestamp || n.createdAt || '';
      var d   = raw ? new Date(raw) : null;
      var ts  = d && !isNaN(d.getTime())
        ? d.getFullYear() + '/' + _p2(d.getMonth() + 1) + '/' + _p2(d.getDate()) + ' ' + _p2(d.getHours()) + ':' + _p2(d.getMinutes())
        : '—';
      return '<div style="padding:10px 0;border-bottom:1px solid var(--line-2);display:flex;gap:8px;align-items:flex-start">' +
        '<div style="flex:1">' +
          '<div style="font-size:12px;color:var(--ink);line-height:1.5">' + esc(n.text) + '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
            (n.author ? '<span style="font-size:10px;font-weight:600;color:var(--gray-1)">' + esc(n.author) + '</span><span style="font-size:10px;color:var(--gray-2)">·</span>' : '') +
            '<span style="font-size:10px;color:var(--gray-2)">' + ts + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm" style="font-size:11px;flex-shrink:0" ' +
          'onclick="CRMUI._deleteNote(\'' + n.id + '\',\'' + p.id + '\')">削除</button>' +
      '</div>';
    }).join('');

    return '<div style="display:flex;gap:6px;margin-bottom:12px">' +
      '<input class="input" id="crmNoteInput" type="text" placeholder="メモを入力（例: 午後の引越し希望、大型ピアノあり）..." style="flex:1" ' +
        'onkeydown="if(event.key===\'Enter\')CRMUI._addNote(\'' + p.id + '\')" />' +
      '<button class="btn btn-primary btn-sm" onclick="CRMUI._addNote(\'' + p.id + '\')">追加</button>' +
    '</div>' +
    (rows || '<div style="color:var(--gray-2);font-size:12px;padding:8px 0">メモはありません</div>');
  }

  /* ── Insights tab ── */

  function _tabInsights(p) {
    var ins = CRMInsights.compute(p);
    if (!ins) return '<div style="color:var(--gray-2);font-size:12px">データ不足</div>';
    var riskColor = ins.churnRisk === 'high' ? 'var(--red)' : ins.churnRisk === 'medium' ? 'var(--yellow)' : 'var(--green)';
    var riskLabel = { high: '高リスク', medium: '中リスク', low: '低リスク' }[ins.churnRisk] || '';
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      _metric('顧客生涯価値 (CLV)',   _yen(ins.clv),                                              'var(--green)') +
      _metric('平均予約単価',         _yen(ins.avgBookingValue),                                  'var(--blue)') +
      _metric('平均予約頻度',         ins.bookingFrequencyDays ? ins.bookingFrequencyDays + ' 日ごと' : '—', 'var(--navy)') +
      _metric('最終予約からの日数',   ins.daysInactive !== null ? ins.daysInactive + ' 日' : '—', 'var(--gray-1)') +
      _metric('解約リスク',           riskLabel,                                                  riskColor) +
      _metric('よく使うサービス',     ins.preferredService || '—',                                'var(--yellow)') +
      (ins.nextBookingEstimate ? _metric('次回予測日', ins.nextBookingEstimate, 'var(--blue)') : '') +
    '</div>';
  }

  /* ── Public API ── */

  function select(id) {
    _activeId  = id;
    _activeTab = 'profile';
    renderCRM();
  }

  function tab(t) {
    _activeTab = t;
    var detail = document.getElementById('crmDetail');
    if (!detail) return;
    detail.innerHTML = _activeId ? _detailPanel(CustomerProfiles.get(_activeId)) : _placeholder();
  }

  function _onSearch(v) { _search = v; renderCRM(); }
  function _onFilter(v) { _filter = v; renderCRM(); }

  function _promptTag(id) {
    var tag = prompt('タグを入力（例: VIP, 常連, 法人）:');
    if (!tag) return;
    CRMTags.add(id, tag.trim());
    CustomerProfiles.refresh();
    renderCRM();
  }

  function _removeTag(id, tag) {
    CRMTags.remove(id, tag);
    CustomerProfiles.refresh();
    renderCRM();
  }

  function _addNote(id) {
    var inp = document.getElementById('crmNoteInput');
    if (!inp || !(inp.value || '').trim()) return;
    CRMNotes.add(id, inp.value.trim());
    CustomerProfiles.refresh();
    tab('notes');
    toast('メモを追加しました');
  }

  function _deleteNote(noteId, customerId) {
    CRMNotes['delete'](noteId);
    CustomerProfiles.refresh();
    tab('notes');
  }

  /* ── Wrap go() ── */
  var _origGo = window.go;
  if (typeof _origGo === 'function') {
    window.go = function (view) {
      _origGo(view);
      if (view === 'crm') renderCRM();
    };
  }

  window.renderCRM = renderCRM;

  return {
    renderCRM:    renderCRM,
    select:       select,
    tab:          tab,
    _onSearch:    _onSearch,
    _onFilter:    _onFilter,
    _promptTag:   _promptTag,
    _removeTag:   _removeTag,
    _addNote:     _addNote,
    _deleteNote:  _deleteNote,
  };

})();
