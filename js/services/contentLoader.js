/* ════════════════════════════════════════════════════════
   CONTENT LOADER — Phase 11 public-site rendering engine
   Single source of truth: Supabase ui_content table.
   Reads localStorage cache first, then refreshes from
   Supabase in the background on every page load.

   Load order: supabaseClient.js → this file
   ════════════════════════════════════════════════════════ */
window.ContentLoader = (function () {
  'use strict';

  const LS_KEY = 'hm_ui_content';
  const TABLE  = 'ui_content';

  /* ── Declarative binding configuration ──────────────────
     Each entry maps one Supabase {section, key} to a DOM
     target via a named type handler.  Adding a new content
     field requires only a new entry here — no other code
     changes needed.
     ─────────────────────────────────────────────────────── */
  const BINDINGS = [
    // ── Hero ─────────────────────────────────────────────
    { s: 'hero', k: 'headline_ja',    t: 'text',         id: 'heroTitleJa' },
    { s: 'hero', k: 'headline_en',    t: 'text',         id: 'heroTitleEn' },
    { s: 'hero', k: 'sub_primary',    t: 'text',         id: 'heroSubPrimary' },
    { s: 'hero', k: 'sub_secondary',  t: 'text',         id: 'heroSubSecondary' },
    { s: 'hero', k: 'cta_book',       t: 'text',         id: 'heroCtaBookLbl' },
    { s: 'hero', k: 'cta_quote',      t: 'text',         id: 'heroCtaQuoteLbl' },
    { s: 'hero', k: 'cta_line',       t: 'text',         id: 'heroCtaLine' },

    // ── Services section ──────────────────────────────────
    { s: 'services', k: 'eyebrow',    t: 'text',         id: 'svcEyebrowEl' },
    { s: 'services', k: 'title',      t: 'text',         id: 'svcTitleEl' },
    { s: 'services', k: 'subtitle',   t: 'text',         id: 'svcLeadEl' },

    // ── Testimonials section ──────────────────────────────
    { s: 'testimonials', k: 'eyebrow',t: 'text',         id: 'revEyebrowEl' },
    { s: 'testimonials', k: 'title',  t: 'text',         id: 'revTitleEl' },
    { s: 'testimonials', k: 'subtitle',t: 'text',        id: 'revLeadEl' },

    // ── Header ────────────────────────────────────────────
    { s: 'header', k: 'company_name', t: 'text',         id: 'headerBrandNameEl' },
    { s: 'header', k: 'cta_text',     t: 'text',         id: 'headerCtaBtnEl' },
    { s: 'header', k: 'nav_home',     t: 'nav',          anchor: '#booking' },
    { s: 'header', k: 'nav_services', t: 'nav',          anchor: '#services' },
    { s: 'header', k: 'nav_about',    t: 'nav',          anchor: '#company' },
    { s: 'header', k: 'nav_faq',      t: 'nav',          anchor: '#faq' },

    // ── Footer ────────────────────────────────────────────
    { s: 'footer', k: 'copyright',    t: 'text',         id: 'footerCopyrightEl' },
    { s: 'footer', k: 'address',      t: 'show-text',    id: 'footerAddressEl' },
    { s: 'footer', k: 'phone',        t: 'show-tel',     id: 'footerPhoneEl',    reveal: 'footerContactLineEl' },
    { s: 'footer', k: 'email',        t: 'show-mailto',  id: 'footerEmailEl',    reveal: 'footerContactLineEl' },

    // ── Contact ───────────────────────────────────────────
    { s: 'contact', k: 'email',          t: 'contact-email' },
    { s: 'contact', k: 'phone',          t: 'all-tel' },
    { s: 'contact', k: 'whatsapp',       t: 'wa',         id: 'contactWhatsappEl' },
    { s: 'contact', k: 'hours_weekday',  t: 'text',       id: 'footerHoursWeekdayEl' },
    { s: 'contact', k: 'hours_weekend',  t: 'show-text',  id: 'footerHoursWeekendEl' },
    { s: 'contact', k: 'hours_note',     t: 'show-text',  id: 'footerHoursNoteEl' },

    // ── SEO meta ─────────────────────────────────────────
    { s: 'seo', k: 'page_title',      t: 'title' },
    { s: 'seo', k: 'description',     t: 'meta',         sel: 'meta[name="description"]' },
    { s: 'seo', k: 'og_title',        t: 'meta',         sel: 'meta[property="og:title"]' },
    { s: 'seo', k: 'og_description',  t: 'meta',         sel: 'meta[property="og:description"]' },
    { s: 'seo', k: 'og_image',        t: 'og-image' },
  ];

  /* ── Type handlers ────────────────────────────────────── */
  const HANDLERS = {
    // Simple textContent update
    'text': (b, val) => {
      const el = document.getElementById(b.id);
      if (el) el.textContent = val;
    },

    // textContent + make visible
    'show-text': (b, val) => {
      const el = document.getElementById(b.id);
      if (el) { el.textContent = val; el.style.display = ''; }
    },

    // meta[content] attribute
    'meta': (b, val) => {
      const el = document.querySelector(b.sel);
      if (el) el.setAttribute('content', val);
    },

    // document.title
    'title': (b, val) => { document.title = val; },

    // Nav links — update both .nav and .mobile-nav anchors
    'nav': (b, val) => {
      document.querySelectorAll(
        `.nav a[href="${b.anchor}"], .mobile-nav a[href="${b.anchor}"]`
      ).forEach(a => { a.textContent = val; });
    },

    // Footer phone link: show + set href
    'show-tel': (b, val) => {
      const el = document.getElementById(b.id);
      if (!el) return;
      el.textContent = val;
      el.href = 'tel:' + val.replace(/[^\d+]/g, '');
      el.style.display = '';
      if (b.reveal) {
        const parent = document.getElementById(b.reveal);
        if (parent) parent.style.display = '';
      }
    },

    // Footer email link: show + set href
    'show-mailto': (b, val) => {
      const el = document.getElementById(b.id);
      if (!el) return;
      el.textContent = val;
      el.href = 'mailto:' + val;
      el.style.display = '';
      if (b.reveal) {
        const parent = document.getElementById(b.reveal);
        if (parent) parent.style.display = '';
      }
    },

    // Contact section email: CTA card + header link + topbar link
    'contact-email': (b, val) => {
      const cta = document.getElementById('contactEmailLinkEl');
      if (cta) {
        cta.href = 'mailto:' + val;
        const small = cta.querySelector('small');
        if (small) small.textContent = val;
      }
      const hdr = document.querySelector('.header-contact-link[href^="mailto:"]');
      if (hdr) hdr.href = 'mailto:' + val;
      const tb = document.querySelector('.topbar-link[href^="mailto:"]');
      if (tb) tb.href = 'mailto:' + val;
    },

    // Update every tel: link on the page
    'all-tel': (b, val) => {
      const tel = 'tel:' + val.replace(/[^\d+]/g, '');
      document.querySelectorAll('a[href^="tel:"]').forEach(a => { a.href = tel; });
    },

    // WhatsApp deep-link
    'wa': (b, val) => {
      const el = document.getElementById(b.id);
      if (el) el.href = 'https://wa.me/' + val.replace(/[^\d+]/g, '');
    },

    // og:image — create tag if absent
    'og-image': (b, val) => {
      let el = document.querySelector('meta[property="og:image"]');
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute('property', 'og:image');
        document.head.appendChild(el);
      }
      el.setAttribute('content', val);
    },
  };

  /* ── localStorage helpers ─────────────────────────────── */
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

  /* ── Supabase fetch ───────────────────────────────────── */
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

  /* ── Core apply: iterate BINDINGS, dispatch to handlers ── */
  function apply(map) {
    if (!map) return;
    BINDINGS.forEach(b => {
      const val = (map[b.s] || {})[b.k];
      if (!val) return;
      const handler = HANDLERS[b.t];
      if (handler) handler(b, val);
    });
  }

  /* ── Init: apply cache immediately, refresh from Supabase ─ */
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
