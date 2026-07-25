'use strict';

/* ════════════════════════════════════════════════════════════════════════════
   timelineGestures.js — reusable pointer/touch gesture engine for the timeline

   One code path for mouse, pen and touch (Pointer Events). Powers press-&-hold
   create, drag-to-move, resize, and drag-to-reschedule on both the admin desktop
   timeline (Phase B/D) and the mobile calendar (Phase E). No dependencies.

   API (window.TimelineGestures):
     pointerDrag(startEv, opts) → begins a drag session bound to one pointer.
        opts: { onMove(info), onEnd(info), onCancel(), threshold,
                autoScroll: { el, edge, maxSpeed } }
        info: { dx, dy, clientX, clientY, ev }  (dx/dy = px since start)
        Returns a teardown() that ends the session early.
     pressHold(el, opts) → detect a stationary press.
        opts: { ms, moveTol, onHold(ev), onTap(ev) }  → returns detach().
     snap(value, step)     → round to nearest multiple (px or minutes).
     snapFloor(value, step)→ round DOWN to a multiple.

   Design notes:
     • setPointerCapture keeps the gesture alive even if the finger leaves the
       element. Passive:false + touch-action:none (set by the caller's CSS) stop
       the page from scrolling while a create/drag is in progress.
     • Auto-scroll: while dragging within `edge` px of the scroll container's top
       or bottom, scroll it proportionally (rAF loop) so long windows can be drawn
       past the viewport — exactly like Google/Apple Calendar.
   ════════════════════════════════════════════════════════════════════════════ */

window.TimelineGestures = (function () {

  function snap(value, step) { return step > 0 ? Math.round(value / step) * step : value; }
  function snapFloor(value, step) { return step > 0 ? Math.floor(value / step) * step : value; }

  /* ── drag session ─────────────────────────────────────────────────────────── */
  function pointerDrag(startEv, opts) {
    opts = opts || {};
    var threshold = opts.threshold != null ? opts.threshold : 0;
    var target = startEv.currentTarget || startEv.target;
    var pid = startEv.pointerId;
    var sx = startEv.clientX, sy = startEv.clientY;
    var started = threshold <= 0;
    var raf = 0, lastInfo = null;

    try { target.setPointerCapture && target.setPointerCapture(pid); } catch (_) {}

    var as = opts.autoScroll || null;

    function edgeScroll() {
      raf = 0;
      if (!as || !as.el || !lastInfo) return;
      var r = as.el.getBoundingClientRect();
      var edge = as.edge || 48, max = as.maxSpeed || 18;
      var y = lastInfo.clientY, dv = 0;
      if (y < r.top + edge)         dv = -max * (1 - Math.max(0, (y - r.top)) / edge);
      else if (y > r.bottom - edge) dv =  max * (1 - Math.max(0, (r.bottom - y)) / edge);
      if (dv !== 0) {
        var before = as.el.scrollTop;
        as.el.scrollTop += dv;
        // Feed the scroll delta back so the dragged item follows the content.
        if (as.el.scrollTop !== before && opts.onMove) {
          opts.onMove(infoFrom(lastInfo.ev));
        }
        schedule();
      }
    }
    function schedule() { if (!raf && as) raf = requestAnimationFrame(edgeScroll); }

    function infoFrom(ev) {
      return { dx: ev.clientX - sx, dy: ev.clientY - sy, clientX: ev.clientX, clientY: ev.clientY, ev: ev };
    }

    function move(ev) {
      if (ev.pointerId !== pid) return;
      if (!started) {
        if (Math.abs(ev.clientX - sx) < threshold && Math.abs(ev.clientY - sy) < threshold) return;
        started = true;
      }
      ev.preventDefault();
      lastInfo = { clientX: ev.clientX, clientY: ev.clientY, ev: ev };
      if (opts.onMove) opts.onMove(infoFrom(ev));
      schedule();
    }
    function up(ev) {
      if (ev.pointerId !== pid) return;
      teardown();
      if (started && opts.onEnd) opts.onEnd(infoFrom(ev));
      else if (!started && opts.onCancel) opts.onCancel();
    }
    function cancel(ev) {
      if (ev.pointerId !== pid) return;
      teardown();
      if (opts.onCancel) opts.onCancel();
    }
    function teardown() {
      if (raf) cancelAnimationFrame(raf), raf = 0;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      try { target.releasePointerCapture && target.releasePointerCapture(pid); } catch (_) {}
    }

    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    return teardown;
  }

  /* ── press & hold (stationary) ────────────────────────────────────────────── */
  function pressHold(el, opts) {
    opts = opts || {};
    var ms = opts.ms != null ? opts.ms : 240;
    var tol = opts.moveTol != null ? opts.moveTol : 8;

    function down(ev) {
      if (ev.button != null && ev.button !== 0) return;   // primary only
      var sx = ev.clientX, sy = ev.clientY, held = false, fired = false;
      var timer = setTimeout(function () {
        held = true;
        if (opts.onHold) { fired = true; opts.onHold(ev); }
      }, ms);
      function mv(e) { if (Math.abs(e.clientX - sx) > tol || Math.abs(e.clientY - sy) > tol) done(false); }
      function up(e) { done(!held); }
      function done(wasTap) {
        clearTimeout(timer);
        window.removeEventListener('pointermove', mv, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        if (wasTap && !fired && opts.onTap) opts.onTap(ev);
      }
      window.addEventListener('pointermove', mv, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    }
    el.addEventListener('pointerdown', down);
    return function detach() { el.removeEventListener('pointerdown', down); };
  }

  return { pointerDrag: pointerDrag, pressHold: pressHold, snap: snap, snapFloor: snapFloor };
})();
