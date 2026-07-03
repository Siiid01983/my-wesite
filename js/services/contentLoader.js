/* ════════════════════════════════════════════════════════
   CONTENT LOADER
   Fetches live content from API on every public page
   load and applies it to the DOM, replacing the static
   defaults in index.html.

   Sources:
     hm_data table  → hero, services meta, reviews meta,
                       FAQ items, company rows, footer
     services table → service card titles / descriptions
     reviews table  → approved + published review cards
     calendar_availability → booked dates for public calendar

   Load order: dataClient.js → this file (end of <body>)
   ════════════════════════════════════════════════════════ */
window.ContentLoader = (function () {
  'use strict';

  /* ── DOM / XSS helpers ────────────────────────────────── */
  function esc(s) {
    return String(s || '').replace(/[<>&"]/g,
      c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }
  function _el(id)       { return document.getElementById(id); }
  function _set(id, val) { const e = _el(id); if (e && val != null && val !== '') e.textContent = val; }
  function _ls(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

  /* ── Hero ─────────────────────────────────────────────── */
  function _applyHero(h) {
    if (!h) return;
    _set('heroTitleJa',      h.headline_ja);
    _set('heroTitleEn',      h.headline_en);
    _set('heroSubPrimary',   h.sub_primary);
    _set('heroSubSecondary', h.sub_secondary);
    _set('heroCtaBookSup',   h.cta_book_sup);
    _set('heroCtaBookLbl',   h.cta_book_lbl);
    _set('heroCtaLine',      h.cta_line);
  }

  /* ── Services ─────────────────────────────────────────── */
  function _applyServicesMeta(m) {
    if (!m) return;
    _set('svcEyebrowEl', m.eyebrow);
    _set('svcTitleEl',   m.title);
    _set('svcLeadEl',    m.lead);
  }

  /* (Service cards are now rendered via _applyServicesToGrid →
     window.HM_renderServiceCards, keyed by a stable slug. The old title-match
     renderer that targeted the non-existent #svcGridEl has been removed.) */

  /* ── Reviews ──────────────────────────────────────────── */
  function _applyRevsMeta(m) {
    if (!m) return;
    _set('revEyebrowEl', m.eyebrow);
    _set('revTitleEl',   m.title);
    _set('revLeadEl',    m.lead);
    _set('revGmbScore',  m.gmb_score);
    _set('revGmbCount',  m.gmb_count);
  }

  function _applyRevCards(revs) {
    if (!revs || !revs.length) return;
    const published = revs.filter(r => r.status === 'approved' && r.published);
    if (!published.length) return;
    const grid = _el('revGridEl');
    if (!grid) return;
    grid.innerHTML = published.map(r => {
      const stars    = '★'.repeat(r.rating || 5) + '☆'.repeat(5 - (r.rating || 5));
      const headline = esc(r.headline || (r.text || '').substring(0, 30) + ((r.text || '').length > 30 ? '…' : ''));
      const meta     = [r.service, r.date_label ? 'ご利用日：' + r.date_label : ''].filter(Boolean).join(' • ');
      const avatar   = esc((r.name || '?').charAt(0));
      const loc      = esc(r.location || r.service || '');
      return `<article class="review-card">` +
        `<div class="review-meta-line"><span class="review-stars">${stars}</span>` +
        (meta ? `<span>${esc(meta)}</span>` : '') + `</div>` +
        `<h3>${headline}</h3>` +
        `<p>${esc(r.text || '')}</p>` +
        `<footer><span class="avatar" aria-hidden="true">${avatar}</span>` +
        `<span class="meta"><strong>${esc(r.name || '')}</strong>` +
        (loc ? `<em>${loc}</em>` : '') + `</span></footer>` +
        `</article>`;
    }).join('');
  }

  /* ── FAQ ──────────────────────────────────────────────── */
  function _applyFaqMeta(m) {
    if (!m) return;
    _set('faqEyebrowEl', m.eyebrow);
    _set('faqTitleEl',   m.title);
    _set('faqLeadEl',    m.lead);
  }

  function _applyFaqItems(items) {
    if (!items || !items.length) return;
    const list = _el('faqListEl');
    if (!list) return;
    list.innerHTML = items.map(f =>
      `<details class="faq-item"><summary>${esc(f.question || '')}</summary>` +
      `<p>${esc(f.answer || '')}</p></details>`
    ).join('');
  }

  /* ── Company ──────────────────────────────────────────── */
  function _applyCompanyMeta(m) {
    if (!m) return;
    _set('compEyebrowEl', m.eyebrow);
    _set('compTitleEl',   m.title);
  }

  function _applyCompanyRows(rows) {
    if (!rows || !rows.length) return;
    const tbl = _el('companyTableEl');
    if (!tbl) return;
    tbl.innerHTML = rows.map(r =>
      `<div class="company-row"><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`
    ).join('');
  }

  /* ── Header nav (desktop <ul id="headerNavEl">) ─────────
     Single source: hm_data['hm_header'] → Website Management → Header module.
     Rebuilds the desktop nav <li> list from the admin-ordered links. Each link
     is HTML-escaped (stored-XSS guard). A link flagged booking:true re-emits the
     inline openBookingApp() handler so the "料金見積り" behaviour survives the
     rebuild (openBookingApp is a global). The mobile menu (#mobileNav) is left
     untouched — it keeps its own list and the close-on-tap listeners bound in
     script.js. Empty/absent value leaves the static markup in place. */
  function _applyHeader(h) {
    if (!h || !Array.isArray(h.links) || !h.links.length) return;
    var ul = _el('headerNavEl');
    if (!ul) return;
    ul.innerHTML = h.links.map(function (l) {
      var text    = esc(l.text || '');
      if (!text) return '';
      var href    = esc(l.href || '#');
      var onclick = l.booking ? ' onclick="openBookingApp();return false;"' : '';
      return '<li><a href="' + href + '"' + onclick + '>' + text + '</a></li>';
    }).join('');
  }

  /* ── Footer ───────────────────────────────────────────── */
  function _applyFooter(f) {
    if (!f) return;
    _set('footerDescEl',      f.brand_desc);
    _set('footerCopyrightEl', f.copyright);
    _set('footerLicenseEl',   f.license);
    if (!Array.isArray(f.cols)) return;
    f.cols.forEach((col, i) => {
      _set('footerCol' + i + 'TitleEl', col.title);
      const colEl = _el('footerCol' + i + 'El');
      if (!colEl || !Array.isArray(col.links)) return;
      const ul = colEl.querySelector('ul');
      if (!ul) return;
      ul.innerHTML = col.links.map(lk =>
        lk.href
          ? `<li><a href="${esc(lk.href)}">${esc(lk.text)}</a></li>`
          : `<li><span>${esc(lk.text)}</span></li>`
      ).join('');
    });
  }

  /* ── Site Settings (single source of truth: hm_data['hm_settings']) ────────
     Brand-identity overrides from the Website Management → Site Settings module.
     Applied ONLY when the admin has set a value; otherwise the static defaults
     (/icons/icon.svg, --navy) stand. Logo/favicon are set as element attributes
     (safe); brand.color is hex-validated before being injected as CSS. */
  function _applySiteSettings(s) {
    if (!s || typeof s !== 'object') return;
    var brand = s.brand || {};

    /* Logo → swap the unified header/footer logo when a custom URL is provided;
       revert to the canonical asset if that URL fails to load. */
    if (brand.logo) {
      document.querySelectorAll('img.brand-mark').forEach(function (img) {
        img.onerror = function () { this.onerror = null; this.src = '/icons/icon.svg'; };
        img.src = brand.logo;
      });
    }

    /* Favicon */
    if (brand.favicon) {
      var link = document.querySelector('link[rel="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = brand.favicon;
    }

    /* Brand main color → override the navy brand vars (brand.color default IS
       --navy). Hex-validated to prevent CSS injection. Injected last so this
       single-source value wins over the Theme Customizer's hm_custom_theme_css. */
    if (brand.color && /^#[0-9a-fA-F]{3,8}$/.test(brand.color)) {
      var el = document.getElementById('hm-settings-style');
      if (!el) { el = document.createElement('style'); el.id = 'hm-settings-style'; document.head.appendChild(el); }
      el.textContent = ':root{--navy:' + brand.color + ';--navy-2:' + brand.color + ';--navy-3:' + brand.color + ';}';
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', brand.color);
    }

    /* Logo size → one CMS field drives every /icons/icon.svg mark (via
       js/utils/brandSize.js). Absent value reverts to each mark's default size. */
    if (typeof window.HM_applyLogoSize === 'function') window.HM_applyLogoSize(brand.logoSize);

    /* ── Company / contact / social (single source) ──────────────────────────
       Mapped only to unambiguous public targets, applied when set. Twitter/FB/
       IG/YouTube have no markup on the public site (skipped); address fields stay
       with the Company section to avoid two sources for the same table. */
    var company = s.company || {}, contact = s.contact || {}, social = s.social || {};

    /* Wordmark → header + footer brand name (English wordmark preferred). */
    var wordmark = company.nameEn || company.name;
    if (wordmark) {
      document.querySelectorAll('.brand-name').forEach(function (el) { el.textContent = wordmark; });
    }

    /* LINE → every line.me CTA on the page. */
    if (social.line) {
      document.querySelectorAll('a[href*="line.me"]').forEach(function (a) { a.href = social.line; });
    }

    /* Email → mailto links (href + visible address when the text is the address).
       EXCLUDES the footer department cards (.hm-ft__email-card): those are fixed
       per-department routes (booking@ / support@ / contact@), NOT the single CMS
       "contact email", so the site-settings value must never overwrite them.
       (Bug fix: a placeholder contact.email='test' was replacing all three.) */
    if (contact.email) {
      document.querySelectorAll('a[href^="mailto:"]:not(.hm-ft__email-card)').forEach(function (a) {
        a.href = 'mailto:' + contact.email;
        if ((a.textContent || '').indexOf('@') > -1) a.textContent = contact.email;
      });
    }

    /* Phone → tel links (href normalised to digits/+; visible number updated when
       the link text is itself a number, not a label). */
    if (contact.phone) {
      var telHref = 'tel:' + String(contact.phone).replace(/[^\d+]/g, '');
      document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
        a.href = telHref;
        if (/^[\d\s+()\-]+$/.test((a.textContent || '').trim())) a.textContent = contact.phone;
      });
    }
  }

  /* ── SEO (single source: hm_data['hm_seo'] → SEO Center) ──────────────────
     hm_seo is a page-map { home:{…}, services:{…}, … } keyed by SEO_PAGES id.
     Only the 'home' entry maps to this real page (index.html). Applied by
     UPDATING the existing <head> tags (or creating them when absent) — index.html
     markup is never edited. Empty CMS fields fall back to the static <head>. */
  function _metaByName(name) {
    var m = document.querySelector('meta[name="' + name + '"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', name); document.head.appendChild(m); }
    return m;
  }
  function _metaByProp(prop) {
    var m = document.querySelector('meta[property="' + prop + '"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('property', prop); document.head.appendChild(m); }
    return m;
  }
  function _applySeo(seoMap) {
    /* Home-page SEO only. Secondary pages (e.g. blog.html / article.html) set
       window.__HM_SUPPRESS_HOME_SEO__ so this never overwrites their own
       <title>/description with the home values. */
    if (window.__HM_SUPPRESS_HOME_SEO__) return;
    if (!seoMap || typeof seoMap !== 'object') return;
    var s = seoMap.home;
    if (!s || typeof s !== 'object') return;

    if (s.title)       document.title = s.title;
    if (s.description) _metaByName('description').setAttribute('content', s.description);

    /* Canonical */
    if (s.canonical) {
      var link = document.querySelector('link[rel="canonical"]');
      if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link); }
      link.href = s.canonical;
    }

    /* Open Graph — OG title/description fall back to the page title/description. */
    var ogTitle = s.ogTitle || s.title;
    var ogDesc  = s.ogDescription || s.description;
    if (ogTitle) _metaByProp('og:title').setAttribute('content', ogTitle);
    if (ogDesc)  _metaByProp('og:description').setAttribute('content', ogDesc);
    if (s.ogImage) _metaByProp('og:image').setAttribute('content', s.ogImage);

    /* Twitter Card */
    if (s.twitterCard) _metaByName('twitter:card').setAttribute('content', s.twitterCard);
    if (ogTitle)  _metaByName('twitter:title').setAttribute('content', ogTitle);
    if (ogDesc)   _metaByName('twitter:description').setAttribute('content', ogDesc);
    if (s.ogImage) _metaByName('twitter:image').setAttribute('content', s.ogImage);

    /* JSON-LD schema — inject as a dedicated, CMS-owned <script> (id keeps it
       idempotent so reloads replace rather than stack). Validated as JSON before
       injection; invalid JSON is ignored so a typo never breaks the page. */
    if (s.schema && String(s.schema).trim()) {
      try {
        JSON.parse(s.schema);
        var tag = document.getElementById('hm-seo-jsonld');
        if (!tag) {
          tag = document.createElement('script');
          tag.type = 'application/ld+json';
          tag.id = 'hm-seo-jsonld';
          document.head.appendChild(tag);
        }
        tag.textContent = String(s.schema);
      } catch (_) { /* invalid JSON — leave static schema in place */ }
    }
  }

  /* ── Calendar availability ────────────────────────────── */
  function _applyCalendar(rows) {
    if (!rows || !rows.length) return;
    const booked = rows
      .filter(r => r.status === 'full' || r.status === 'booked')
      .map(r => r.date);
    _ls('hm_booked', booked);
  }

  /* (Service images are now folded into _applyServicesToGrid below, keyed by the
     same stable slug; the old #svcGridEl/title-based image applier was removed.) */

  /* ── Stable service identity (RC-A) ───────────────────────
     The homepage service cards are keyed by a stable SLUG (index.html
     SERVICE_CONFIG.id), NOT by title — so renaming a service no longer breaks
     rendering. The `services` table is keyed by reference_id; map it here. */
  var _REF_TO_SLUG = {
    'SVC-1': 'single', 'SVC-2': 'couple', 'SVC-3': 'student',
    'SVC-4': 'sameday', 'SVC-5': 'disposal', 'SVC-6': 'furniture',
  };
  /* Legacy slug reconciliation: the CMS image manager historically keyed the
     same-day service as 'emergency'; the homepage canonical slug is 'sameday'. */
  var _SLUG_ALIAS = { 'emergency': 'sameday' };
  function _canonSlug(s) { return _SLUG_ALIAS[s] || s; }

  /* Build the per-slug override map from live CMS data and hand it to the
     homepage renderer (window.HM_renderServiceCards). Falls back silently on a
     page that does not expose the renderer. */
  function _applyServicesToGrid(svcs, imageCfg) {
    if (typeof window.HM_renderServiceCards !== 'function') return;
    var overrides = {};
    (svcs || []).forEach(function (s) {
      if (s.active === false) return;
      var slug = _REF_TO_SLUG[s.id] || _canonSlug(s.slug);
      if (!slug) return;
      overrides[slug] = overrides[slug] || {};
      if (s.title)       overrides[slug].title       = s.title;
      if (s.description) overrides[slug].description = s.description;
      if (s.badge != null) overrides[slug].badge     = s.badge;
    });
    if (imageCfg && typeof imageCfg === 'object') {
      Object.keys(imageCfg).forEach(function (k) {
        var cfg  = imageCfg[k];
        var slug = _canonSlug(k);
        /* Apply the image whenever an image_url (URL or data-URI) is set —
           regardless of the admin's svg/image toggle. Requiring display_mode
           ==='image' was a trap: admins set a URL but left the mode on 'svg',
           so the image was silently ignored. To show the default SVG icon
           again, clear the URL. */
        if (cfg && cfg.image_url) {
          overrides[slug] = overrides[slug] || {};
          overrides[slug].image = cfg.image_url;
        }
      });
    }
    try { window.HM_renderServiceCards(overrides); }
    catch (e) { console.warn('[ContentLoader] service render failed:', e && e.message); }
  }

  /* ── Map services table row → local shape ─────────────── */
  function _mapService(r) {
    return {
      id:            r.reference_id || r.id,
      title:         r.title        || '',
      description:   r.description  || '',
      badge:         r.badge        || '',
      cta_text:      r.cta_text     || '無料お見積り →',
      display_order: r.display_order || 0,
      active:        r.active !== false,
    };
  }

  /* ── Map reviews table row → local shape ──────────────── */
  function _mapReview(r) {
    return {
      id:         r.reference_id  || r.id,
      name:       r.customer_name || '',
      rating:     r.rating,
      text:       r.review_text   || '',
      status:     r.approved ? 'approved' : 'pending',
      published:  r.published     || false,
      headline:   r.headline      || '',
      service:    r.service       || '',
      date_label: r.date_label    || '',
      location:   r.location      || '',
    };
  }

  /* ── Main init ─────────────────────────────────────────── */
  async function init() {
    if (!window.__APP_READY__) {
      console.error('[ContentLoader] Aborting: window.__APP_READY__ is not set — bootstrap did not complete');
      return;
    }
    const sb = window.api;
    if (!sb) {
      console.warn('[ContentLoader] ApiClient not available — displaying static defaults');
      return;
    }

    /* Retry once after 2 s on any network/timeout failure */
    for (let _attempt = 0; _attempt < 2; _attempt++) {
      if (_attempt > 0) {
        await new Promise(r => setTimeout(r, 2000));
        console.debug('[ContentLoader] retrying after transient failure…');
      }
      try {
        await _load(sb);
        return;
      } catch (e) {
        if (_attempt === 1) console.warn('[ContentLoader] init error:', e.message || e);
      }
    }
  }

  async function _load(sb) {
      const [kvRes, svcRes, revRes, calRes] = await Promise.all([
        sb.from('hm_data').select('key,value'),
        sb.from('services').select('*').order('display_order'),
        sb.from('reviews').select('*').eq('approved', true).eq('published', true)
          .order('created_at', { ascending: false }),
        sb.from('calendar_availability').select('date,status'),
      ]);

      /* hm_data KV ─────────────────────────────────────── */
      if (kvRes.data && kvRes.data.length) {
        const kv = {};
        kvRes.data.forEach(({ key, value }) => { kv[key] = value; _ls(key, value); });

        _applyHero(kv.hm_hero);
        _applyServicesMeta(kv.hm_services_section);
        _applyRevsMeta(kv.hm_reviews_section);
        _applyFaqMeta(kv.hm_faq_section);
        _applyFaqItems(kv.hm_faq);
        _applyCompanyMeta(kv.hm_company_section);
        _applyCompanyRows(kv.hm_company_rows);
        _applyHeader(kv.hm_header);
        _applyFooter(kv.hm_footer);

        /* Theme CSS — overwrite localStorage and inject for all visitors */
        if (kv.hm_custom_theme_css) {
          const css = String(kv.hm_custom_theme_css);
          _ls('hm_custom_theme_css', css);
          let themeEl = document.getElementById('hm-theme-override');
          if (!themeEl) {
            themeEl = document.createElement('style');
            themeEl.id = 'hm-theme-override';
            document.head.appendChild(themeEl);
          }
          themeEl.textContent = css;
        }

        /* Site Settings — single source of truth for brand identity (logo,
           favicon, main color). Applied AFTER the theme CSS so it wins. */
        _applySiteSettings(kv.hm_settings);

        /* SEO — single source of truth for the home page's title/meta/OG/schema.
           Applied after Site Settings (which may set theme-color from brand). */
        _applySeo(kv.hm_seo);

        /* Reviews fallback if the dedicated table returned nothing.
           (Services render below via the unified _applyServicesToGrid.) */
        if (!revRes.data || !revRes.data.length)
          _applyRevCards(kv.hm_reviews);
      } else if (kvRes.error) {
        console.warn('[ContentLoader] hm_data read error:', kvRes.error.message);
      }

      /* services (RC-A) ─────────────────────────────────────
         Render the homepage service cards from the `services` table — keyed by a
         STABLE slug, not title — falling back to the hm_services KV snapshot, and
         fold in the hm_service_images config in ONE grid render so titles,
         descriptions, badges and images all update together. */
      const _kvVal = (k) => (kvRes.data && kvRes.data.length)
        ? (() => { const row = kvRes.data.find(d => d.key === k); return row ? row.value : null; })()
        : null;
      const imgCfg = _kvVal('hm_service_images');
      let svcsForGrid;
      if (svcRes.data && svcRes.data.length) {
        svcsForGrid = svcRes.data.map(_mapService);
        _ls('hm_services', svcsForGrid);
      } else {
        if (svcRes.error) console.warn('[ContentLoader] services read error:', svcRes.error.message);
        svcsForGrid = _kvVal('hm_services');   // KV/local fallback snapshot
      }
      _applyServicesToGrid(svcsForGrid, imgCfg);

      /* reviews table ──────────────────────────────────── */
      if (revRes.data && revRes.data.length) {
        const revs = revRes.data.map(_mapReview);
        _ls('hm_reviews', revs);
        _applyRevCards(revs);
      } else if (revRes.error) {
        console.warn('[ContentLoader] reviews read error:', revRes.error.message);
      }

      /* calendar_availability ──────────────────────────── */
      if (calRes.data) {
        _applyCalendar(calRes.data);
      } else if (calRes.error) {
        console.warn('[ContentLoader] calendar read error:', calRes.error.message);
      }
  }

  return { init };
})();

/* Lowercase alias — window.contentLoader === window.ContentLoader */
window.contentLoader = window.ContentLoader;

/* Startup diagnostics — surface exact failure layer before init() runs */
(function () {
  'use strict';
  if (!window.__APP_READY__) {
    console.error('[ContentLoader] FATAL: window.__APP_READY__ is false — bootstrap.js did not complete. Check bootstrap stage:', window.__BOOTSTRAP__ && window.__BOOTSTRAP__.stage);
    return;
  }
  if (!window.api) {
    console.warn('[ContentLoader] ApiClient is null — static defaults will be shown. Check env.js credentials and dataClient.js.');
    return;
  }
  console.debug('[ContentLoader] OK — __APP_READY__ true, stage:', window.__BOOTSTRAP__ && window.__BOOTSTRAP__.stage);
})();

/* DOM is ready — scripts load at end of <body> */
window.ContentLoader.init();
