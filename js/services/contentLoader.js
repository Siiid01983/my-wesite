/* ════════════════════════════════════════════════════════
   CONTENT LOADER — Phase 11 public-site bridge
   Reads hm_ui_content from localStorage (written by admin
   ContentService) and patches live DOM elements in index.html.
   Falls back to a direct Supabase fetch on first visit when
   localStorage is empty.

   Load order: supabaseClient.js → this file
   Auto-inits at the bottom of the file (DOM is ready because
   scripts are loaded at the end of <body>).
   ════════════════════════════════════════════════════════ */
window.ContentLoader = (function () {
  'use strict';

  const LS_KEY = 'hm_ui_content';
  const TABLE  = 'ui_content';

  /* ── localStorage ─────────────────────────────────────── */
  function _getLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function _setLocal(map) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
  }

  /* ── Row array → { section: { key: value } } ─────────── */
  function _rowsToMap(rows) {
    const map = {};
    rows.forEach(r => {
      if (!map[r.section]) map[r.section] = {};
      map[r.section][r.content_key] = r.content_value ?? '';
    });
    return map;
  }

  /* ── Supabase fetch (background refresh on first visit) ── */
  async function _fetchFromSupabase() {
    const sb = window.SupabaseClient;
    if (!sb) return null;
    try {
      const { data, error } = await sb
        .from(TABLE)
        .select('section, content_key, content_value');
      if (error || !data || !data.length) return null;
      const map = _rowsToMap(data);
      _setLocal(map);
      return map;
    } catch { return null; }
  }

  /* ── DOM helpers ──────────────────────────────────────── */
  function _el(id) { return document.getElementById(id); }

  function _setText(id, val) {
    if (!val) return;
    const el = _el(id);
    if (el) el.textContent = val;
  }

  function _setMeta(selector, val) {
    if (!val) return;
    const el = document.querySelector(selector);
    if (el) el.setAttribute('content', val);
  }

  /* ── Core patch ───────────────────────────────────────── */
  function apply(map) {
    if (!map) return;

    /* ── Hero ─────────────────────────────── */
    const h = map.hero || {};
    _setText('heroTitleJa',      h.headline_ja);
    _setText('heroTitleEn',      h.headline_en);
    _setText('heroSubPrimary',   h.sub_primary);
    _setText('heroSubSecondary', h.sub_secondary);
    _setText('heroCtaBookLbl',   h.cta_book);
    _setText('heroCtaQuoteLbl',  h.cta_quote);
    _setText('heroCtaLine',      h.cta_line);

    /* ── Services section ─────────────────── */
    const svc = map.services || {};
    _setText('svcEyebrowEl', svc.eyebrow);
    _setText('svcTitleEl',   svc.title);
    _setText('svcLeadEl',    svc.subtitle);

    /* ── Testimonials section ─────────────── */
    const tst = map.testimonials || {};
    _setText('revEyebrowEl', tst.eyebrow);
    _setText('revTitleEl',   tst.title);
    _setText('revLeadEl',    tst.subtitle);

    /* ── Header ───────────────────────────── */
    const hdr = map.header || {};
    _setText('headerBrandNameEl', hdr.company_name);
    _setText('headerCtaBtnEl',    hdr.cta_text);

    // Nav text labels — update both desktop (.nav) and mobile (.mobile-nav)
    [
      ['nav_home',     '#booking'],
      ['nav_services', '#services'],
      ['nav_about',    '#company'],
      ['nav_faq',      '#faq'],
    ].forEach(([key, anchor]) => {
      if (!hdr[key]) return;
      document.querySelectorAll(
        `.nav a[href="${anchor}"], .mobile-nav a[href="${anchor}"]`
      ).forEach(a => { a.textContent = hdr[key]; });
    });

    /* ── Footer ───────────────────────────── */
    const ftr = map.footer || {};
    _setText('footerCopyrightEl', ftr.copyright);

    if (ftr.address) {
      const el = _el('footerAddressEl');
      if (el) { el.textContent = ftr.address; el.style.display = ''; }
    }
    if (ftr.phone) {
      const el = _el('footerPhoneEl');
      if (el) {
        el.textContent = ftr.phone;
        el.href = 'tel:' + ftr.phone.replace(/[^\d+]/g, '');
        el.style.display = '';
        const line = _el('footerContactLineEl');
        if (line) line.style.display = '';
      }
    }
    if (ftr.email) {
      const el = _el('footerEmailEl');
      if (el) {
        el.textContent = ftr.email;
        el.href = 'mailto:' + ftr.email;
        el.style.display = '';
        const line = _el('footerContactLineEl');
        if (line) line.style.display = '';
      }
    }

    /* ── Contact ──────────────────────────── */
    const cnt = map.contact || {};

    // Email: update CTA channel card + header link + topbar link
    if (cnt.email) {
      const ctaEl = _el('contactEmailLinkEl');
      if (ctaEl) {
        ctaEl.href = 'mailto:' + cnt.email;
        const small = ctaEl.querySelector('small');
        if (small) small.textContent = cnt.email;
      }
      const hdrEmail = document.querySelector('.header-contact-link[href^="mailto:"]');
      if (hdrEmail) hdrEmail.href = 'mailto:' + cnt.email;
      const tbEmail = document.querySelector('.topbar-link[href^="mailto:"]');
      if (tbEmail) tbEmail.href = 'mailto:' + cnt.email;
    }

    // Phone: update all tel: links
    if (cnt.phone) {
      const tel = 'tel:' + cnt.phone.replace(/[^\d+]/g, '');
      document.querySelectorAll('a[href^="tel:"]').forEach(a => { a.href = tel; });
    }

    // WhatsApp
    if (cnt.whatsapp) {
      const el = _el('contactWhatsappEl');
      if (el) el.href = 'https://wa.me/' + cnt.whatsapp.replace(/[^\d+]/g, '');
    }

    // Business hours — footer contact column
    _setText('footerHoursWeekdayEl', cnt.hours_weekday);
    if (cnt.hours_weekend) {
      const el = _el('footerHoursWeekendEl');
      if (el) { el.textContent = cnt.hours_weekend; el.style.display = ''; }
    }
    if (cnt.hours_note) {
      const el = _el('footerHoursNoteEl');
      if (el) { el.textContent = cnt.hours_note; el.style.display = ''; }
    }

    /* ── SEO meta ─────────────────────────── */
    const seo = map.seo || {};
    if (seo.page_title)     document.title = seo.page_title;
    _setMeta('meta[name="description"]',        seo.description);
    _setMeta('meta[property="og:title"]',       seo.og_title);
    _setMeta('meta[property="og:description"]', seo.og_description);

    if (seo.og_image) {
      let ogImg = document.querySelector('meta[property="og:image"]');
      if (!ogImg) {
        ogImg = document.createElement('meta');
        ogImg.setAttribute('property', 'og:image');
        document.head.appendChild(ogImg);
      }
      ogImg.setAttribute('content', seo.og_image);
    }
  }

  /* ── Init: apply local immediately, then refresh from Supabase ─ */
  async function init() {
    const local = _getLocal();
    if (local) apply(local);
    const fresh = await _fetchFromSupabase();
    if (fresh) apply(fresh);
  }

  return { init, apply };
})();

// DOM is ready (script loads at end of <body>) — init immediately
window.ContentLoader.init();
