'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   closedDayCalendar.js — paint manually CLOSED days RED on the Ops month calendar
   (with the closure reason visible to the admin).

   PURELY ADDITIVE. It does NOT touch calendar.js: it observes the rendered month
   grid (each cell already carries data-goto="YYYY-MM-DD"), reads the fully-closed
   days for the visible span from slot-capacity.php (action=closed-days), and
   decorates matching cells. A "closed day" = every band closed (the state written
   by the 全日休止 / close-day admin action); partial band closures are NOT painted.

   Auth + transport are reused from ops-core.js (Ops.Api.getJSON → adds X-API-KEY /
   X-ADMIN-TOKEN). If Ops.Api is unavailable, or nothing is closed, this no-ops.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  var HOST_ID    = 'ops-content';
  var CELL_SEL   = '.cal-cell[data-goto]';
  var CACHE_TTL  = 45000;            // ms — closed-day map is cheap but stable
  var _cache     = {};               // 'from|to' → { at, map }
  var _debounce  = null;
  var _applying  = false;

  function _api() { return (window.Ops && window.Ops.Api) || null; }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* one-time scoped styles (light + dark aware, brand red) */
  function _injectStyles() {
    if (document.getElementById('hmClosedDayStyle')) return;
    var s = document.createElement('style');
    s.id = 'hmClosedDayStyle';
    s.textContent =
      '.cal-cell.hm-closed{background:repeating-linear-gradient(135deg,rgba(220,38,38,.10),rgba(220,38,38,.10) 8px,rgba(220,38,38,.16) 8px,rgba(220,38,38,.16) 16px);outline:1px solid rgba(220,38,38,.45);outline-offset:-1px}' +
      '.cal-cell.hm-closed .cal-cell-d{color:#b91c1c;font-weight:800}' +
      '.cal-cell .hm-closed-tag{display:block;margin-top:2px;font-size:10px;line-height:1.25;font-weight:700;color:#b91c1c;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cal-cell .hm-closed-tag .hm-x{display:inline-block;margin-right:2px}' +
      '@media (prefers-color-scheme: dark){.cal-cell.hm-closed .cal-cell-d,.cal-cell .hm-closed-tag{color:#fca5a5}}';
    document.head.appendChild(s);
  }

  /* collect the visible month span from the rendered cells */
  function _visibleRange(cells) {
    var min = null, max = null;
    for (var i = 0; i < cells.length; i++) {
      var d = cells[i].getAttribute('data-goto');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (min === null || d < min) min = d;
      if (max === null || d > max) max = d;
    }
    return (min && max) ? { from: min, to: max } : null;
  }

  function _fetchClosed(range) {
    var key = range.from + '|' + range.to;
    var hit = _cache[key];
    if (hit && (Date.now() - hit.at) < CACHE_TTL) return Promise.resolve(hit.map);
    var api = _api();
    if (!api || !api.getJSON) return Promise.resolve({});
    return api.getJSON('slot-capacity.php', { action: 'closed-days', from: range.from, to: range.to })
      .then(function (out) {
        var map = (out && out.ok && out.closed && typeof out.closed === 'object') ? out.closed : {};
        _cache[key] = { at: Date.now(), map: map };
        return map;
      })
      .catch(function () { return {}; });
  }

  /* paint the closed cells; observer is paused around the DOM writes */
  function _paint(host, closedMap, observer) {
    _applying = true;
    if (observer) observer.disconnect();
    try {
      var cells = host.querySelectorAll(CELL_SEL);
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var date = cell.getAttribute('data-goto');
        var reason = Object.prototype.hasOwnProperty.call(closedMap, date) ? closedMap[date] : null;
        var already = cell.querySelector('.hm-closed-tag');
        if (reason !== null && reason !== undefined) {
          cell.classList.add('hm-closed');
          var label = reason ? String(reason) : '休止 Closed';
          cell.setAttribute('title', '休止 Closed' + (reason ? ' — ' + reason : ''));
          if (!already) {
            var tag = document.createElement('span');
            tag.className = 'hm-closed-tag';
            tag.innerHTML = '<span class="hm-x">✕</span>' + _esc(label);
            cell.appendChild(tag);
          } else {
            already.innerHTML = '<span class="hm-x">✕</span>' + _esc(label);
          }
        } else if (cell.classList.contains('hm-closed')) {
          // reopened since last paint → clean up
          cell.classList.remove('hm-closed');
          cell.removeAttribute('title');
          if (already) already.remove();
        }
      }
    } finally {
      var h2 = document.getElementById(HOST_ID);
      if (observer && h2) observer.observe(h2, { childList: true, subtree: true });
      _applying = false;
    }
  }

  function _decorate(observer) {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    var cells = host.querySelectorAll(CELL_SEL);
    if (!cells.length) return;                 // not the month view → nothing to do
    var range = _visibleRange(cells);
    if (!range) return;
    _fetchClosed(range).then(function (map) {
      var h = document.getElementById(HOST_ID);
      if (h) _paint(h, map, observer);
    });
  }

  function _schedule(observer) {
    if (_applying) return;                     // ignore our own DOM writes
    clearTimeout(_debounce);
    _debounce = setTimeout(function () { _decorate(observer); }, 120);
  }

  function _boot() {
    var host = document.getElementById(HOST_ID);
    if (!host) { setTimeout(_boot, 300); return; }
    _injectStyles();
    var observer = new MutationObserver(function () { _schedule(observer); });
    observer.observe(host, { childList: true, subtree: true });
    _decorate(observer);                        // first paint for whatever is rendered now
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
  else _boot();
})();
