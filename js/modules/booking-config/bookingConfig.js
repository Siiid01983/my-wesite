/* ══════════════════════════════════════════════════════════════
   Booking Form Config (WMC) — 予約フォーム設定

   Edits hm_booking_config (hm_data KV) which drives the BA overlay's
   item list / time slots / filter options / service badges / drawer
   titles on the public site (index.html → _baCfg()).

   View:      #wmc-view-booking-config → renders into #view-booking-config
   Data flow: UI → Adapter.saveBookingConfig → hm_data KV (rest.php);
              public pages pick it up via the ContentLoader snapshot.
   Invariant: a missing/blank section = the overlay's built-in defaults,
              so "デフォルトに戻す" (save null) is always safe.
   BC_DEFAULTS below MUST mirror BA_DEFAULT_CFG in index.html —
   tests/booking-config.verify.js enforces the item-id/slot/filter parity.
   ══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var BC_DEFAULTS = {
    cats: [
      { id: 'living',  label: 'リビング・寝室' },
      { id: 'water',   label: '水回り' },
      { id: 'storage', label: '収納・家具' },
    ],
    items: [
      { id: 'tv-s',     name: 'テレビ 40型未満',   short: 'テレビ 小',     cat: 'living' },
      { id: 'tv-l',     name: 'テレビ 40型以上',   short: 'テレビ 大',     cat: 'living' },
      { id: 'bed-s',    name: 'ベッド シングル',   short: 'ベッド S',      cat: 'living' },
      { id: 'bed-d',    name: 'ベッド ダブル',     short: 'ベッド D',      cat: 'living' },
      { id: 'sofa1',    name: 'ソファ 1人',        short: 'ソファ 1人',    cat: 'living' },
      { id: 'sofa3',    name: 'ソファ 3人',        short: 'ソファ 3人',    cat: 'living' },
      { id: 'fridge-s', name: '冷蔵庫 2ドア',      short: '冷蔵庫 2ドア',  cat: 'water' },
      { id: 'fridge-l', name: '冷蔵庫 3ドア',      short: '冷蔵庫 3ドア',  cat: 'water' },
      { id: 'wash-v',   name: '洗濯機 縦型',       short: '洗濯機 縦型',   cat: 'water' },
      { id: 'wash-d',   name: '洗濯機 ドラム',     short: '洗濯機 ドラム', cat: 'water' },
      { id: 'shelf-s',  name: '棚 小',             short: '棚 小',         cat: 'storage' },
      { id: 'shelf-l',  name: '棚 大',             short: '棚 大',         cat: 'storage' },
      { id: 'table',    name: 'ダイニングテーブル', short: 'テーブル',     cat: 'storage' },
      { id: 'chest',    name: 'チェスト',          short: 'チェスト',      cat: 'storage' },
      { id: 'bike',     name: '自転車',            short: '自転車',        cat: 'storage' },
      { id: 'box',      name: 'ダンボール',        short: 'ダンボール',    cat: 'storage' },
    ],
    timeSlots: [
      { label: '午前（9:00〜12:00）',  value: '午前（9:00〜12:00）' },
      { label: '午後（12:00〜15:00）', value: '午後（12:00〜15:00）' },
      { label: '夕方（15:00〜18:00）', value: '夕方（15:00〜18:00）' },
      { label: '夜間（18:00〜21:00）', value: '夜間（18:00〜21:00）' },
      { label: '時間指定なし（当日調整）', value: '時間指定なし' },
    ],
    filters: [
      { id: 'same-day',  label: '当日・翌日対応可', short: '当日対応' },
      { id: 'english',   label: '英語対応可',       short: '英語対応' },
      { id: 'insurance', label: '保険加入済',       short: '保険加入' },
      { id: 'disposal',  label: '不用品回収対応',   short: '不用品回収' },
    ],
    badges: {
      tansin:  { text: '人気',     color: '#9AB57A' },
      couple:  { text: '人気',     color: '#9AB57A' },
      student: { text: '人気',     color: '#9AB57A' },
      sameday: { text: '当日対応', color: '#c0392b' },
    },
    labels: { furnitureTitle: '', dateTitle: '', timeTitle: '', filterTitle: '' },
  };

  /* Booking-picker services (badge editor rows). Names are display hints only —
     the actual service titles are CMS-managed in サービス管理 (hm_services). */
  var BC_SERVICES = [
    { id: 'tansin',   name: '単身引越し' },
    { id: 'couple',   name: 'カップル・ご夫婦引越し' },
    { id: 'student',  name: '学生・新生活引越し' },
    { id: 'sameday',  name: '当日・お急ぎ引越しプラン' },
    { id: 'disposal', name: '不用品回収・処分' },
    { id: 'assembly', name: '家具組立・分解' },
  ];

  var BC_LABEL_FIELDS = [
    ['furnitureTitle', '荷物ドロワーのタイトル', '荷物を選択'],
    ['dateTitle',      '日付ドロワーのタイトル', '引越し希望日'],
    ['timeTitle',      '時間帯ドロワーのタイトル', '希望時間帯'],
    ['filterTitle',    '絞り込みドロワーのタイトル', '絞り込み条件'],
  ];

  var _bc = null;   // working copy

  function _deep(v) { return JSON.parse(JSON.stringify(v)); }

  function _bcLoad() {
    var saved = (window.Adapter && Adapter.getBookingConfig) ? Adapter.getBookingConfig() : null;
    var d = _deep(BC_DEFAULTS);
    if (saved && typeof saved === 'object') {
      ['cats', 'items', 'timeSlots', 'filters'].forEach(function (k) {
        if (Array.isArray(saved[k]) && saved[k].length) d[k] = _deep(saved[k]);
      });
      if (saved.badges && typeof saved.badges === 'object') d.badges = _deep(saved.badges);
      if (saved.labels && typeof saved.labels === 'object') {
        Object.keys(d.labels).forEach(function (k) { if (saved.labels[k] != null) d.labels[k] = String(saved.labels[k]); });
      }
    }
    // Normalize time slots to {label, value}
    d.timeSlots = d.timeSlots.map(function (s) {
      if (s && typeof s === 'object') return { label: String(s.label || ''), value: String(s.value || s.label || '') };
      return { label: String(s || ''), value: String(s || '') };
    });
    // Badge rows for every picker service (missing → no badge)
    BC_SERVICES.forEach(function (s) {
      if (!d.badges[s.id]) d.badges[s.id] = { text: '', color: '#9AB57A' };
    });
    _bc = d;
  }

  /* ── Render ──────────────────────────────────────────────── */
  function renderBookingConfig() {
    var host = document.getElementById('view-booking-config');
    if (!host) return;
    if (!_bc) _bcLoad();

    var inp = 'padding:7px 9px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:transparent;color:inherit;box-sizing:border-box';

    var catOptions = function (sel) {
      return _bc.cats.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.label) + '</option>';
      }).join('');
    };

    var itemRows = _bc.items.map(function (it, i) {
      return '<tr style="border-bottom:1px solid var(--line)' + (it.active === false ? ';opacity:.45' : '') + '">'
        + '<td style="padding:7px 6px"><input data-bc="items.' + i + '.name" style="' + inp + ';width:100%" value="' + esc(it.name || '') + '"></td>'
        + '<td style="padding:7px 6px"><input data-bc="items.' + i + '.short" style="' + inp + ';width:100%" value="' + esc(it.short || '') + '" placeholder="一覧・予約データ用"></td>'
        + '<td style="padding:7px 6px"><select data-bc="items.' + i + '.cat" style="' + inp + '">' + catOptions(it.cat) + '</select></td>'
        + '<td style="padding:7px 6px;white-space:nowrap;text-align:right">'
        +   '<button class="btn btn-ghost btn-sm" data-bc-act="item-toggle" data-i="' + i + '">' + (it.active === false ? '表示する' : '非表示') + '</button> '
        +   '<button class="btn btn-ghost btn-sm" style="color:var(--red)" data-bc-act="item-del" data-i="' + i + '">削除</button>'
        + '</td></tr>';
    }).join('');

    var catRows = _bc.cats.map(function (c, i) {
      return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">'
        + '<code style="font-size:11px;color:var(--gray-1);min-width:60px">' + esc(c.id) + '</code>'
        + '<input data-bc="cats.' + i + '.label" style="' + inp + ';flex:1" value="' + esc(c.label || '') + '">'
        + '</div>';
    }).join('');

    var slotRows = _bc.timeSlots.map(function (s, i) {
      return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">'
        + '<input data-bc="timeSlots.' + i + '.label" style="' + inp + ';flex:1" value="' + esc(s.label || '') + '">'
        + '<button class="btn btn-ghost btn-sm" data-bc-act="slot-up" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>'
        + '<button class="btn btn-ghost btn-sm" style="color:var(--red)" data-bc-act="slot-del" data-i="' + i + '">削除</button>'
        + '</div>';
    }).join('');

    var filterRows = _bc.filters.map(function (f, i) {
      return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">'
        + '<input data-bc="filters.' + i + '.label" style="' + inp + ';flex:2;min-width:160px" value="' + esc(f.label || '') + '" placeholder="表示ラベル">'
        + '<input data-bc="filters.' + i + '.short" style="' + inp + ';flex:1;min-width:100px" value="' + esc(f.short || '') + '" placeholder="短縮名（予約データ用）">'
        + '<button class="btn btn-ghost btn-sm" style="color:var(--red)" data-bc-act="filter-del" data-i="' + i + '">削除</button>'
        + '</div>';
    }).join('');

    var badgeRows = BC_SERVICES.map(function (s) {
      var b = _bc.badges[s.id] || { text: '', color: '#9AB57A' };
      return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">'
        + '<span style="min-width:170px;font-size:13px">' + esc(s.name) + '</span>'
        + '<input data-bc="badges.' + s.id + '.text" style="' + inp + ';width:120px" value="' + esc(b.text || '') + '" placeholder="バッジなし">'
        + '<input type="color" data-bc="badges.' + s.id + '.color" value="' + esc(b.color || '#9AB57A') + '" style="width:36px;height:32px;padding:2px;border:1px solid var(--line);border-radius:6px;background:transparent">'
        + '</div>';
    }).join('');

    var labelRows = BC_LABEL_FIELDS.map(function (f) {
      return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">'
        + '<span style="min-width:190px;font-size:13px">' + esc(f[1]) + '</span>'
        + '<input data-bc="labels.' + f[0] + '" style="' + inp + ';flex:1" value="' + esc(_bc.labels[f[0]] || '') + '" placeholder="' + esc(f[2]) + '（空欄 = 既定）">'
        + '</div>';
    }).join('');

    function panel(title, body, foot) {
      return '<div class="panel"><div class="panel-head"><span class="panel-title">' + title + '</span>' + (foot || '') + '</div>'
        + '<div class="panel-body">' + body + '</div></div>';
    }

    host.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">'
      + '<button class="btn btn-primary" data-bc-act="save"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>変更を保存</button>'
      + '<button class="btn btn-ghost" data-bc-act="reset">デフォルトに戻す</button>'
      + '<span style="font-size:12px;color:var(--gray-1)">空欄・削除済みセクションは公開ページの既定値に戻ります。保存後、公開ページは再読み込みで反映されます。</span>'
      + '</div>'
      + panel('荷物リスト（' + _bc.items.filter(function (i) { return i.active !== false; }).length + ' 点表示中）',
          '<div class="table-wrap" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
          + '<thead><tr style="border-bottom:2px solid var(--line)">'
          + ['表示名', '短縮名', 'カテゴリ', ''].map(function (h) { return '<th style="text-align:left;padding:6px;font-size:11px;color:var(--gray-1)">' + h + '</th>'; }).join('')
          + '</tr></thead><tbody>' + itemRows + '</tbody></table></div>'
          + '<p style="font-size:12px;color:var(--gray-1);margin:10px 0 0">追加した荷物には汎用アイコン（ダンボール）が使われます。</p>',
          '<button class="btn btn-ghost btn-sm" data-bc-act="item-add">＋ 荷物を追加</button>')
      + panel('カテゴリ名', catRows)
      + panel('希望時間帯', slotRows, '<button class="btn btn-ghost btn-sm" data-bc-act="slot-add">＋ 時間帯を追加</button>')
      + panel('絞り込み条件', filterRows, '<button class="btn btn-ghost btn-sm" data-bc-act="filter-add">＋ 条件を追加</button>')
      + panel('サービスバッジ（予約ピッカー）', badgeRows
          + '<p style="font-size:12px;color:var(--gray-1);margin:6px 0 0">バッジ名を空欄にするとバッジ非表示。サービス名自体は「サービス管理」で編集します。</p>')
      + panel('ドロワータイトル', labelRows);

    _bcWire(host);
  }

  /* ── Events ──────────────────────────────────────────────── */
  function _bcSetPath(path, value) {
    var seg = path.split('.');
    var o = _bc;
    for (var i = 0; i < seg.length - 1; i++) { if (o == null) return; o = o[seg[i]]; }
    if (o != null) o[seg[seg.length - 1]] = value;
  }

  function _bcWire(host) {
    if (host._bcWired) return;
    host._bcWired = true;

    host.addEventListener('input', function (e) {
      var path = e.target && e.target.getAttribute && e.target.getAttribute('data-bc');
      if (!path) return;
      _bcSetPath(path, e.target.value);
      // Keep time-slot value in lockstep with its label (custom slots)
      var m = /^timeSlots\.(\d+)\.label$/.exec(path);
      if (m) _bc.timeSlots[+m[1]].value = e.target.value;
    });

    host.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-bc-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-bc-act');
      var i = parseInt(btn.getAttribute('data-i') || '-1', 10);

      if (act === 'save') { _bcSave(); return; }
      if (act === 'reset') {
        if (!confirm('予約フォーム設定をすべて既定値に戻しますか？（保存済みのカスタマイズは削除されます）')) return;
        if (window.Adapter && Adapter.saveBookingConfig) Adapter.saveBookingConfig(null);
        _bc = null; _bcLoad(); renderBookingConfig();
        if (typeof toast === 'function') toast('既定値に戻しました');
        return;
      }
      if (act === 'item-add') {
        _bc.items.push({ id: 'item-' + Date.now().toString(36), name: '', short: '', cat: _bc.cats[0] ? _bc.cats[0].id : 'living' });
      } else if (act === 'item-del' && i >= 0) {
        if (!confirm('この荷物を削除しますか？')) return;
        _bc.items.splice(i, 1);
      } else if (act === 'item-toggle' && i >= 0) {
        _bc.items[i].active = _bc.items[i].active === false;
      } else if (act === 'slot-add') {
        _bc.timeSlots.push({ label: '', value: '' });
      } else if (act === 'slot-del' && i >= 0) {
        _bc.timeSlots.splice(i, 1);
      } else if (act === 'slot-up' && i > 0) {
        var s = _bc.timeSlots.splice(i, 1)[0]; _bc.timeSlots.splice(i - 1, 0, s);
      } else if (act === 'filter-add') {
        _bc.filters.push({ id: 'f-' + Date.now().toString(36), label: '', short: '' });
      } else if (act === 'filter-del' && i >= 0) {
        _bc.filters.splice(i, 1);
      } else {
        return;
      }
      renderBookingConfig();
    });
  }

  function _bcSave() {
    var cfg = _deep(_bc);
    cfg.items = cfg.items.filter(function (it) { return it && ((it.name || '').trim() || (it.short || '').trim()); });
    cfg.items.forEach(function (it) {
      it.name = (it.name || '').trim(); it.short = (it.short || '').trim() || it.name;
    });
    cfg.timeSlots = cfg.timeSlots.filter(function (s) { return (s.label || '').trim(); });
    cfg.timeSlots.forEach(function (s) { s.label = s.label.trim(); s.value = (s.value || '').trim() || s.label; });
    cfg.filters = cfg.filters.filter(function (f) { return (f.label || '').trim(); });
    cfg.filters.forEach(function (f) { f.label = f.label.trim(); f.short = (f.short || '').trim() || f.label; });
    Object.keys(cfg.badges).forEach(function (k) {
      cfg.badges[k].text = (cfg.badges[k].text || '').trim();
    });
    Object.keys(cfg.labels).forEach(function (k) { cfg.labels[k] = (cfg.labels[k] || '').trim(); });

    if (!cfg.items.length) { if (typeof toast === 'function') toast('荷物リストが空です — 最低1点は必要です'); return; }
    if (!cfg.timeSlots.length) { if (typeof toast === 'function') toast('時間帯が空です — 最低1件は必要です'); return; }

    if (window.Adapter && Adapter.saveBookingConfig) {
      Adapter.saveBookingConfig(cfg);
      _bc = null; _bcLoad(); renderBookingConfig();
      if (typeof toast === 'function') toast('予約フォーム設定を保存しました');
    } else if (typeof toast === 'function') {
      toast('保存できません（Adapter 未接続）');
    }
  }

  window.renderBookingConfig = renderBookingConfig;
}());
