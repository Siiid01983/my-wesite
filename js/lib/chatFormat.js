/* ════════════════════════════════════════════════════════════════════════════
   chatFormat.js — shared chat/booking DISPLAY helpers (window.HMFmt)

   Phase A of the Chat UX Pack. Pure presentation — NO API calls, NO schema, NO
   permissions, NO booking logic. Loaded on the Customer Portal, Ops app and Admin
   so all three render identically:
     • HMFmt.msgTime(iso)         — T3: one consistent message timestamp
     • HMFmt.furnitureGrid(items) — T4: icon + name + quantity-badge cards
     • HMFmt.preferredOptions(b)  — T5: the two requested date/time-band options
   Grid/notice CSS is injected once so no per-surface stylesheet edits are needed.

   Timezone (T3): timestamps are parsed and formatted in the LOCAL browser
   timezone (Intl-free, deterministic). Historical rows are never mutated — only
   how they display changes. (Migrating stored values to UTC is a backend concern,
   out of scope for this display-only pack.)
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.HMFmt) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function p2(n) { return String(n).padStart(2, '0'); }

  /* Active UI language. Ops/Portal persist a toggle in localStorage('hm_lang');
     otherwise fall back to <html lang> / navigator. Defaults to Japanese. */
  function lang(override) {
    if (override === 'en' || override === 'ja') return override;
    var l = '';
    try { l = localStorage.getItem('hm_lang') || ''; } catch (_) {}
    l = l || document.documentElement.lang || (navigator.language || 'ja');
    return String(l).slice(0, 2).toLowerCase() === 'en' ? 'en' : 'ja';
  }

  /* Parse a DB/ISO timestamp to an absolute instant. Accepts:
       • values carrying 'Z' or a ±HH:MM offset → parsed as the absolute instant;
       • naive 'YYYY-MM-DD HH:MM:SS' / ISO-without-tz → interpreted as JST (the
         server timezone, pinned in hm-api/_lib.php + _db.php), NOT the viewer's
         browser timezone. This is what makes ordering and displayed times
         CONSISTENT across surfaces and independent of where they are viewed —
         previously a naive string was parsed as browser-local, so a tz mismatch
         between the storage clock and the viewer surfaced as wrong/jumbled times.
       Returns a Date, or null when unparseable. */
  function toDate(iso) {
    if (!iso) return null;
    var s = String(iso).trim();
    if (!s) return null;
    var hasTz = /[zZ]$/.test(s) || /[+\-]\d{2}:?\d{2}$/.test(s);
    var norm = s.indexOf('T') > 0 ? s : s.replace(' ', 'T');
    if (!hasTz) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) norm += 'T00:00:00+09:00';        // date-only → JST midnight
      else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(norm)) norm += '+09:00'; // naive datetime → JST
    }
    var d = new Date(norm);
    return isNaN(d.getTime()) ? null : d;
  }

  /* Numeric sort key (epoch ms) for a timestamp — ALWAYS sort chat/message lists
     with this, never a lexical String.localeCompare: the raw values mix formats
     (MySQL 'YYYY-MM-DD HH:MM:SS' vs ISO 'YYYY-MM-DDTHH:MM:SS.sssZ') and the space
     char sorts before 'T', so a string sort orders by FORMAT, not by time.
     Unparseable → 0 (sorts oldest). */
  function tsMs(iso) { var d = toDate(iso); return d ? d.getTime() : 0; }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ── T3: message timestamp ──────────────────────────────────────────────────
     JA → "2026/07/18 14:30"   EN → "2026-07-18 14:30"   (rendered in the viewer's
     local browser timezone; stored value is parsed, historical data never shifted). */
  function msgTime(iso, l) {
    var d = toDate(iso); if (!d) return '';
    var hm = ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    if (lang(l) === 'en') return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + hm;
    return d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + hm;
  }
  /* Date only (for the two preferred options). */
  function dateOnly(d, l) {
    if (lang(l) === 'en') return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    return d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate());
  }

  /* ── T4: furniture grid ─────────────────────────────────────────────────────
     Items are free-text strings, sometimes carrying a count ("ベッド ×1"). Parse
     name + quantity, aggregate duplicates, render icon + name + quantity badge. */
  var ICONS = [
    [/ベッド|bed|布団|マットレス/i, '🛏️'],
    [/ソファ|sofa|カウチ/i, '🛋️'],
    [/(?:デスク|desk|机|テーブル|table|ダイニング)/i, '🪑'],
    [/椅子|チェア|chair|スツール/i, '💺'],
    [/冷蔵庫|refrigerator|fridge/i, '🧊'],
    [/洗濯|washer|washing/i, '🧺'],
    [/(?:テレビ|tv|モニター|monitor)/i, '📺'],
    [/(?:棚|本棚|ラック|shelf|bookcase|収納)/i, '🗄️'],
    [/(?:タンス|箪笥|衣装|wardrobe|dresser|クローゼット)/i, '🚪'],
    [/(?:レンジ|microwave|オーブン|oven)/i, '🍽️'],
    [/エアコン|air\s?con|aircon/i, '❄️'],
    [/(?:段ボール|ダンボール|box|箱|カートン)/i, '📦'],
    [/(?:自転車|bike|bicycle|バイク)/i, '🚲'],
    [/(?:洗面|ドレッサー|鏡|mirror)/i, '🪞'],
    [/(?:ピアノ|piano|楽器)/i, '🎹'],
    [/(?:植物|観葉|plant)/i, '🪴'],
  ];
  function furnIcon(name) {
    for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(name)) return ICONS[i][1];
    return '📦';
  }
  function parseItem(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    var m = s.match(/^(.*?)[\s　]*[×xX✕╳]\s*(\d+)\s*$/);
    return m ? { name: m[1].trim() || s, qty: parseInt(m[2], 10) || 1 } : { name: s, qty: 1 };
  }
  function furnitureGrid(items) {
    ensureCss();
    if (!Array.isArray(items) || !items.length) return '';
    var agg = {}, order = [];
    items.forEach(function (raw) {
      var it = parseItem(raw); if (!it) return;
      if (!(it.name in agg)) { agg[it.name] = 0; order.push(it.name); }
      agg[it.name] += it.qty;
    });
    if (!order.length) return '';
    // Readable LIST (one item per line, full text, wraps) — never truncates JP names.
    return '<div class="hm-furn-list">' + order.map(function (n) {
      return '<div class="hm-furn-row">' +
        '<span class="hm-furn-ic" aria-hidden="true">' + furnIcon(n) + '</span>' +
        '<span class="hm-furn-nm">' + esc(n) + '</span>' +
        '<span class="hm-furn-qty">×' + agg[n] + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ── T5: two preferred (requested) date + time-band options ──────────────────
     Reads existing fields only: preferred_start_1/2 columns (any casing) or a
     packed notes fallback (pref1/pref2). No new columns. Empty → returns ''. */
  function bandLabel(d, l) {
    var h = d.getHours();
    var i = h < 12 ? 0 : h < 15 ? 1 : h < 18 ? 2 : 3;
    // Full time ranges on every surface (Portal / Ops / Admin / Inbox).
    return (lang(l) === 'en')
      ? ['Morning (09:00 - 12:00)', 'Afternoon (12:00 - 15:00)', 'Evening (15:00 - 18:00)', 'Night (18:00 - 21:00)'][i]
      : ['午前（09:00〜12:00）', '午後（12:00〜15:00）', '夕方（15:00〜18:00）', '夜間（18:00〜21:00）'][i];
  }
  function pickPreferred(b) {
    b = b || {};
    var ex = b.extra || b._extra || {};
    return [
      b.preferred_start_1 || b.preferredStart1 || b.preferredStart_1 || ex.pref1 || ex.preferred1 || '',
      b.preferred_start_2 || b.preferredStart2 || b.preferredStart_2 || ex.pref2 || ex.preferred2 || '',
    ];
  }
  /* Returns HTML for a labelled block, or '' when neither option is present. */
  function preferredOptions(b, l) {
    ensureCss();
    var raw = pickPreferred(b);
    var en = lang(l) === 'en';
    var rows = [];
    for (var i = 0; i < 2; i++) {
      var d = toDate(raw[i]); if (!d) continue;
      rows.push(
        '<div class="hm-pref-row">' +
          '<span class="hm-pref-n">' + (en ? 'Option ' : '第') + (i + 1) + (en ? '' : '希望') + '</span>' +
          '<span class="hm-pref-d">' + esc(dateOnly(d, l)) + '</span>' +
          '<span class="hm-pref-b">' + esc(bandLabel(d, l)) + '</span>' +
        '</div>'
      );
    }
    // Fallback when the two preferred_start columns are empty (e.g. pre-migration):
    // show the primary requested date + time slot so the block still carries the
    // date AND the time band. b.time is already a slot label (e.g. 午前（9:00〜12:00）);
    // otherwise derive the band from the date.
    if (!rows.length) {
      var pd = toDate(b.date || b.booking_date);
      var band = String(b.time || b.timeSlot || '').trim();
      if (pd || band) {
        rows.push(
          '<div class="hm-pref-row">' +
            '<span class="hm-pref-n">' + (en ? 'Requested' : 'ご希望') + '</span>' +
            '<span class="hm-pref-d">' + esc(pd ? dateOnly(pd, l) : '—') + '</span>' +
            '<span class="hm-pref-b">' + esc(band || (pd ? bandLabel(pd, l) : '')) + '</span>' +
          '</div>'
        );
      }
    }
    if (!rows.length) return '';
    var title = en ? 'Requested dates & times' : 'ご希望日時';
    return '<div class="hm-pref"><div class="hm-pref-h">' + title + '</div>' + rows.join('') + '</div>';
  }
  function hasPreferred(b) { var r = pickPreferred(b); return !!(toDate(r[0]) || toDate(r[1])); }

  /* ── One-time CSS (self-contained; theme-neutral, brand palette) ───────────── */
  var _cssDone = false;
  function ensureCss() {
    if (_cssDone) return; _cssDone = true;
    if (typeof document === 'undefined') return;
    var css =
      '.hm-furn-list{display:flex;flex-direction:column;gap:6px;margin:4px 0}' +
      '.hm-furn-row{display:flex;align-items:flex-start;gap:9px;padding:8px 11px;background:#fff;border:1px solid #e6e7e2;border-radius:9px}' +
      '.hm-furn-ic{font-size:18px;line-height:1.35;flex:0 0 auto}' +
      /* full text, wraps to multiple lines, never truncated */
      '.hm-furn-nm{flex:1;min-width:0;font-size:14px;font-weight:600;color:#2C3626;white-space:normal;word-break:break-word;line-height:1.35}' +
      '.hm-furn-qty{flex:0 0 auto;font-size:13px;font-weight:800;color:#3a4a32;background:rgba(154,181,122,.22);border-radius:999px;padding:2px 10px;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.hm-pref{margin:6px 0}' +
      '.hm-pref-h{font-size:12px;font-weight:700;color:#6f756a;margin:0 0 6px}' +
      '.hm-pref-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e6e7e2;border-radius:10px;background:#fbfbf9;margin-bottom:6px}' +
      '.hm-pref-n{flex:0 0 auto;font-size:11px;font-weight:800;color:#fff;background:#9AB57A;border-radius:6px;padding:2px 8px}' +
      '.hm-pref-d{flex:1;font-size:13px;font-weight:600;color:#2C3626;font-variant-numeric:tabular-nums}' +
      '.hm-pref-b{flex:0 0 auto;font-size:12px;font-weight:700;color:#3a4a32;background:rgba(154,181,122,.18);border-radius:999px;padding:2px 10px}' +
      '@media (prefers-color-scheme:dark){' +
        '.hm-furn-row{background:#20241d;border-color:#333a2c}.hm-furn-nm{color:#e8ede0}.hm-furn-qty{color:#c8e0a8;background:rgba(154,181,122,.16)}' +
        '.hm-pref-row{background:#20241d;border-color:#333a2c}.hm-pref-d{color:#e8ede0}}';
    var st = document.createElement('style');
    st.id = 'hm-fmt-css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  window.HMFmt = {
    esc: esc,
    msgTime: msgTime,
    tsMs: tsMs,
    toDate: toDate,
    dateOnly: function (iso, l) { var d = toDate(iso); return d ? dateOnly(d, l) : ''; },
    furnitureGrid: furnitureGrid,
    preferredOptions: preferredOptions,
    hasPreferred: hasPreferred,
    _lang: lang,
  };
})();
