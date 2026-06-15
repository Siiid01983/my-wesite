'use strict';

/* ── DOM Utilities ──
   Convenience helpers for common DOM patterns.
   All existing code continues to use document.getElementById() etc.
   directly — these helpers are additive for new code.
*/

/* Cached querySelector — avoid repeated DOM lookups for stable elements */
const _domCache = {};
function $id(id) {
  if (!_domCache[id]) _domCache[id] = document.getElementById(id);
  return _domCache[id];
}

/* Clear cache when navigating (elements may be re-rendered) */
function $clearCache() {
  Object.keys(_domCache).forEach(k => delete _domCache[k]);
}

/* Show/hide an element by id */
function $show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function $hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

/* Safely set innerHTML with a guard against null elements */
function $html(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/* Safely set textContent */
function $text(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* Add/remove CSS class on an element */
function $addClass(id, cls)    { const el = document.getElementById(id); if (el) el.classList.add(cls); }
function $removeClass(id, cls) { const el = document.getElementById(id); if (el) el.classList.remove(cls); }
function $toggleClass(id, cls, force) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle(cls, force);
}

/* Delegate event from a parent via selector — useful for dynamic lists */
function $delegate(parent, selector, eventType, handler) {
  parent.addEventListener(eventType, function(e) {
    const target = e.target.closest(selector);
    if (target && parent.contains(target)) handler.call(target, e);
  });
}

/* Empty-state placeholder HTML — shared by admin tables and CMS editors.
   Promoted here from admin-bookings.js so the Website CMS (which does not
   load admin-bookings.js) can render empty states for Reviews/Services/FAQ/Company. */
function emptyHTML(msg) {
  return `<div class="empty"><svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg><p>${msg}</p></div>`;
}
