'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   BRAND LOGO SIZE — single source: hm_settings.brand.logoSize
   Resizes every /icons/icon.svg logo mark across the site from one CMS field.
   • When logoSize is ABSENT/invalid → nothing is injected; marks keep their
     original CSS (backward compatible).
   • When SET → injects --logo-size + a width/height rule for every mark class.
   • Aspect ratio is preserved (the inner <img> is object-fit:contain) — never
     stretched.
   Public pages call window.HM_applyLogoSize() from contentLoader (API value);
   admin/login/portal pages apply the admin's locally-saved value on load.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  /* Every logo-mark class that wraps /icons/icon.svg, across all pages. */
  var MARKS = ['.brand-mark', '.brand-logo', '.login-mark', '.wmc-mark', '.sb-mark',
               '.ad-login-logo', '.ad-header-mark', '.p-brand-logo', '.rv-mark'];

  function apply(px) {
    px = parseInt(px, 10);
    var root = document.documentElement;
    var el = document.getElementById('hm-logo-size-css');
    if (!px || px < 8 || px > 240) {            // invalid/absent → revert to defaults
      if (el && el.parentNode) el.parentNode.removeChild(el);
      root.style.removeProperty('--logo-size');
      return;
    }
    root.style.setProperty('--logo-size', px + 'px');
    if (!el) { el = document.createElement('style'); el.id = 'hm-logo-size-css'; (document.head || root).appendChild(el); }
    el.textContent = MARKS.map(function (s) {
      return s + '{width:var(--logo-size,' + px + 'px)!important;height:var(--logo-size,' + px + 'px)!important}';
    }).join('');
  }

  window.HM_applyLogoSize = apply;

  /* Initial apply from the admin's saved settings (no flash on admin pages). The
     public site also refreshes this from the API via contentLoader._applySiteSettings. */
  try {
    var s = JSON.parse(localStorage.getItem('hm_site_settings') || 'null');
    if (s && s.brand && s.brand.logoSize) apply(s.brand.logoSize);
  } catch (e) {}
})();
