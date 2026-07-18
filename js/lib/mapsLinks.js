/* ════════════════════════════════════════════════════════════════════════════
   mapsLinks.js — keyless Google Maps navigation buttons (window.HMMaps)

   Uses STANDARD Google Maps URLs only — NO Maps/Places API, NO API key. Opens the
   Google Maps app on mobile (or maps.google.com on desktop) in a new tab.

   HMMaps.buttons(fromAddr, toAddr, lang?) → HTML for up to 5 buttons:
     1. Customer location        search ?query=<from>
     2. Destination location     search ?query=<to>
     3. Drive to customer        dir ?destination=<from>
     4. Drive to destination     dir ?destination=<to>
     5. Customer → Destination   dir ?origin=<from>&destination=<to>
   Destination/route buttons are omitted when there is no destination address
   (single-location services). Addresses are URL-encoded. Self-injecting mobile-
   friendly CSS. Caller decides WHEN to render (e.g. only after 確定, so the full
   address privacy rule is preserved).
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.HMMaps) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function lang(override) {
    if (override === 'en' || override === 'ja') return override;
    var l = '';
    try { l = localStorage.getItem('hm_lang') || ''; } catch (_) {}
    l = l || (document.documentElement && document.documentElement.lang) || (navigator.language || 'ja');
    return String(l).slice(0, 2).toLowerCase() === 'en' ? 'en' : 'ja';
  }
  var Q = function (a) { return encodeURIComponent(String(a == null ? '' : a).trim()); };
  var SEARCH = 'https://www.google.com/maps/search/?api=1&query=';
  var DIR    = 'https://www.google.com/maps/dir/?api=1&';

  function btn(href, label, cls) {
    return '<a class="hm-map-btn' + (cls ? ' ' + cls : '') + '" href="' + href + '" target="_blank" rel="noopener noreferrer">'
         + '<span class="hm-map-ic" aria-hidden="true">📍</span>' + esc(label) + '</a>';
  }

  function buttons(fromAddr, toAddr, l) {
    ensureCss();
    var f = String(fromAddr == null ? '' : fromAddr).trim();
    var t = String(toAddr == null ? '' : toAddr).trim();
    if (!f && !t) return '';
    var en = lang(l) === 'en';
    var L = en
      ? { cust: 'Customer location', dest: 'Destination', driveC: 'Drive to customer', driveD: 'Drive to destination', route: 'Customer → Destination' }
      : { cust: '現住所を地図で',      dest: '引越し先を地図で',  driveC: '現住所へ経路案内',   driveD: '引越し先へ経路案内',   route: '現住所→引越し先の経路' };
    var out = [];
    if (f) out.push(btn(SEARCH + Q(f), L.cust));                              // 1
    if (t) out.push(btn(SEARCH + Q(t), L.dest));                              // 2
    if (f) out.push(btn(DIR + 'destination=' + Q(f), L.driveC, 'drive'));     // 3
    if (t) out.push(btn(DIR + 'destination=' + Q(t), L.driveD, 'drive'));     // 4
    if (f && t) out.push(btn(DIR + 'origin=' + Q(f) + '&destination=' + Q(t), L.route, 'route'));  // 5
    return '<div class="hm-map-btns">' + out.join('') + '</div>';
  }

  var _cssDone = false;
  function ensureCss() {
    if (_cssDone) return; _cssDone = true;
    if (typeof document === 'undefined') return;
    var css =
      '.hm-map-btns{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 2px}' +
      '.hm-map-btn{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:8px 12px;border:1px solid #cdd7c4;border-radius:10px;' +
        'background:#fff;color:#2C3626;font-size:13px;font-weight:600;text-decoration:none;line-height:1.2;-webkit-tap-highlight-color:transparent}' +
      '.hm-map-btn:hover{background:#f2f6ec;border-color:#9AB57A}' +
      '.hm-map-btn.drive{border-color:#9AB57A;background:rgba(154,181,122,.14)}' +
      '.hm-map-btn.route{border-color:#2C3626;background:#2C3626;color:#fff}' +
      '.hm-map-ic{font-size:15px;line-height:1}' +
      '@media (prefers-color-scheme:dark){.hm-map-btn{background:#20241d;border-color:#3a4a32;color:#e8ede0}.hm-map-btn.route{background:#3a4a32;color:#fff}}';
    var st = document.createElement('style');
    st.id = 'hm-maps-css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  window.HMMaps = { buttons: buttons };
})();
