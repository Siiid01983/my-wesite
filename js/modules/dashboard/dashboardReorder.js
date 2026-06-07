'use strict';

/* ════════════════════════════════════════════════════════
   DASHBOARD REORDER — Phase 21C
   HTML5 native drag-and-drop widget reordering.

   Strategy
   ─────────
   On first renderDash(), each widget element is lifted out of its
   original container (biRow1/biRow2/.dash-panels) into a flat
   #dashOrderContainer whose direct children are .dash-slot divs.
   Slots are sorted by DashboardLayout.getWidgetOrder() and are
   draggable="true".  On drop, the new DOM order is persisted via
   DashboardLayout.setWidgetOrder().

   Patch chain (load order: layout → dashboard → customizer → reorder)
   ─────────────────────────────────────────────────────────────────────
   window.renderDash
     → reorder wrapper  (applies slot order, calls customizer via _orig)
       → customizer wrapper (injects settings btn, applies visibility)
         → original renderDash (renders all widget content)
   ════════════════════════════════════════════════════════ */

window.DashboardReorder = (function () {

  /* BI panel containers have margin-bottom:0 on their injected inner .panel.
     Their slot wrapper supplies the spacing that biRow's margin-bottom used to. */
  var BI_IDS = ['bi-revenue', 'bi-trend', 'bi-service', 'bi-customer'];

  var _dragSrc = null;

  /* ── CSS (injected once into <head>) ── */
  function _injectCSS() {
    if (document.getElementById('dashReorderCSS')) return;
    var s = document.createElement('style');
    s.id = 'dashReorderCSS';
    s.textContent =
      '.dash-slot{position:relative;cursor:grab}' +
      '.dash-slot:active{cursor:grabbing}' +
      /* restore pointer cursor on all interactive children */
      '.dash-slot button,.dash-slot a,.dash-slot input,' +
      '.dash-slot select,.dash-slot textarea{cursor:pointer}' +
      '.dash-slot-dragging{opacity:.35;pointer-events:none}' +
      /* drop-position hairlines */
      '.dash-slot-over-above::before{content:"";display:block;height:3px;' +
        'border-radius:2px;background:var(--blue);margin-bottom:8px}' +
      '.dash-slot-over-below::after{content:"";display:block;height:3px;' +
        'border-radius:2px;background:var(--blue);margin-top:8px}' +
      /* grip handle — visible on slot hover */
      '.dash-slot-handle{display:flex;justify-content:center;align-items:center;' +
        'height:20px;opacity:0;transition:opacity .15s;color:var(--gray-2);' +
        'cursor:grab;user-select:none;padding-bottom:2px}' +
      '.dash-slot:hover .dash-slot-handle{opacity:1}';
    document.head.appendChild(s);
  }

  /* ── Visual root of a widget (mirrors DashboardCustomizer logic pre-slot) ── */
  function _widgetElement(widgetId) {
    var layout = DashboardLayout.get();
    var w = layout.widgets.find(function (x) { return x.id === widgetId; });
    if (!w) return null;
    var el = document.getElementById(w.elementId);
    if (!el) return null;
    if (widgetId === 'recent-bookings' || widgetId === 'activity') {
      return el.closest('.panel') || el;
    }
    return el;
  }

  /* ── Build one draggable slot and move the widget element into it ── */
  function _createSlot(widgetId) {
    var slot = document.createElement('div');
    slot.className    = 'dash-slot';
    slot.dataset.slot = widgetId;
    slot.draggable    = true;

    /* BI panels declare margin-bottom:0 on their inner .panel;
       the slot compensates so spacing matches the rest of the page. */
    if (BI_IDS.indexOf(widgetId) !== -1) slot.style.marginBottom = '20px';

    /* Grip dots — appear on hover to hint draggability */
    var handle = document.createElement('div');
    handle.className = 'dash-slot-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML =
      '<svg viewBox="0 0 32 4" width="32" height="4">' +
        '<circle cx="4"  cy="2" r="1.5" fill="currentColor"/>' +
        '<circle cx="11" cy="2" r="1.5" fill="currentColor"/>' +
        '<circle cx="18" cy="2" r="1.5" fill="currentColor"/>' +
        '<circle cx="25" cy="2" r="1.5" fill="currentColor"/>' +
      '</svg>';
    slot.appendChild(handle);

    /* Move the widget's visual root into the slot */
    var el = _widgetElement(widgetId);
    if (el) slot.appendChild(el);

    /* Drag events bound directly on the slot */
    slot.addEventListener('dragstart', _onDragStart);
    slot.addEventListener('dragover',  _onDragOver);
    slot.addEventListener('dragleave', _onDragLeave);
    slot.addEventListener('drop',      _onDrop);
    slot.addEventListener('dragend',   _onDragEnd);

    return slot;
  }

  /* ── Drag event handlers ── */

  function _onDragStart(e) {
    _dragSrc = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.slot); /* required by Firefox */
    /* Defer opacity so the drag ghost image captures the full card */
    var src = this;
    setTimeout(function () { src.classList.add('dash-slot-dragging'); }, 0);
  }

  function _onDragOver(e) {
    if (this === _dragSrc) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    _clearIndicators();
    var rect = this.getBoundingClientRect();
    this.classList.add(
      e.clientY < rect.top + rect.height / 2
        ? 'dash-slot-over-above'
        : 'dash-slot-over-below'
    );
  }

  function _onDragLeave() {
    this.classList.remove('dash-slot-over-above', 'dash-slot-over-below');
  }

  function _onDrop(e) {
    e.preventDefault();
    if (!_dragSrc || this === _dragSrc) return;
    var rect   = this.getBoundingClientRect();
    var before = e.clientY < rect.top + rect.height / 2;
    this.classList.remove('dash-slot-over-above', 'dash-slot-over-below');
    if (before) {
      this.parentNode.insertBefore(_dragSrc, this);
    } else {
      this.parentNode.insertBefore(_dragSrc, this.nextSibling);
    }
    _persistOrder();
    /* Re-apply visibility so hidden-slot state stays correct after move */
    if (window.DashboardCustomizer) DashboardCustomizer.applyLayout();
  }

  function _onDragEnd() {
    if (_dragSrc) _dragSrc.classList.remove('dash-slot-dragging');
    _clearIndicators();
    _dragSrc = null;
  }

  function _clearIndicators() {
    document.querySelectorAll('.dash-slot-over-above, .dash-slot-over-below')
      .forEach(function (el) {
        el.classList.remove('dash-slot-over-above', 'dash-slot-over-below');
      });
  }

  /* Read current DOM slot order → DashboardLayout */
  function _persistOrder() {
    var ids = [];
    document.querySelectorAll('#dashOrderContainer .dash-slot').forEach(function (s) {
      ids.push(s.dataset.slot);
    });
    DashboardLayout.setWidgetOrder(ids);
  }

  /* ── First-time setup: build flat container and all slots ── */
  function _setup() {
    var view = document.getElementById('view-dashboard');
    if (!view) return;

    _injectCSS();

    var container = document.createElement('div');
    container.id = 'dashOrderContainer';

    /* Insert after the settings bar when it exists, otherwise as first child */
    var bar = document.getElementById('dashCustomizerBar');
    view.insertBefore(container, bar ? bar.nextSibling : view.firstChild);

    /* Populate slots in saved order */
    DashboardLayout.getWidgetOrder().forEach(function (id) {
      container.appendChild(_createSlot(id));
    });

    /* Hide the now-empty original wrapper containers */
    ['biRow1', 'biRow2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    var dp = view.querySelector('.dash-panels');
    if (dp) dp.style.display = 'none';
  }

  /* ── Re-sort existing slots to match persisted order (idempotent) ── */
  function _sortSlots() {
    var container = document.getElementById('dashOrderContainer');
    if (!container) return;
    DashboardLayout.getWidgetOrder().forEach(function (id) {
      var slot = container.querySelector('.dash-slot[data-slot="' + id + '"]');
      if (slot) container.appendChild(slot); /* moves to correct position */
    });
  }

  /* ── Public: apply order (called after every renderDash) ── */
  function applyOrder() {
    if (!document.getElementById('dashOrderContainer')) {
      _setup();
    } else {
      _sortSlots();
    }
    /* Visibility must run after order so _container() resolves to slots */
    if (window.DashboardCustomizer) DashboardCustomizer.applyLayout();
  }

  /* ── Patch window.renderDash (wraps the customizer's existing wrapper) ── */
  function init() {
    var _orig = window.renderDash;
    if (typeof _orig !== 'function') return;
    window.renderDash = function () {
      _orig.apply(this, arguments);
      applyOrder();
    };
  }

  return { init: init, applyOrder: applyOrder };

}());

/* Boot — executes after dashboard.js and dashboardCustomizer.js are both loaded */
DashboardReorder.init();
