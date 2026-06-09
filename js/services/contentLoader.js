/* ════════════════════════════════════════════════════════
   CONTENT LOADER
   Fetches live content from Supabase on every public page
   load and applies it to the DOM, replacing the static
   defaults in index.html.

   Sources:
     hm_data table  → hero, services meta, reviews meta,
                       FAQ items, company rows, footer
     services table → service card titles / descriptions
     reviews table  → approved + published review cards
     calendar_availability → booked dates for public calendar

   Load order: supabaseClient.js → this file (end of <body>)
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
    _set('heroCtaQuoteSup',  h.cta_quote_sup);
    _set('heroCtaQuoteLbl',  h.cta_quote_lbl);
    _set('heroCtaLine',      h.cta_line);
  }

  /* ── Services ─────────────────────────────────────────── */
  function _applyServicesMeta(m) {
    if (!m) return;
    _set('svcEyebrowEl', m.eyebrow);
    _set('svcTitleEl',   m.title);
    _set('svcLeadEl',    m.lead);
  }

  function _applyServiceCards(svcs) {
    if (!svcs || !svcs.length) return;
    // Match by title — DB display_order differs from HTML card positions
    const byTitle = {};
    document.querySelectorAll('#svcGridEl .service-card').forEach(card => {
      const h3 = card.querySelector('h3');
      if (h3) byTitle[h3.textContent.trim()] = card;
    });
    svcs.forEach(svc => {
      const card = byTitle[svc.title];
      if (!card) return;
      const featured = card.classList.contains('service-card-featured');
      const p = card.querySelector(featured ? '.service-featured-body p' : 'p');
      if (p && svc.description)
        p.textContent = svc.description;
      const badge = card.querySelector(featured ? '.service-featured-eyebrow' : '.svc-pop-badge');
      if (badge && svc.badge)
        badge.textContent = svc.badge;
      const cta = card.querySelector('.service-card-cta');
      if (cta && svc.cta_text)
        cta.textContent = svc.cta_text;
    });
  }

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

  /* ── Footer ───────────────────────────────────────────── */
  function _applyFooter(f) {
    if (!f) return;
    _set('footerDescEl',      f.brand_desc);
    _set('footerCopyrightEl', f.copyright);
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

  /* ── Calendar availability ────────────────────────────── */
  function _applyCalendar(rows) {
    if (!rows || !rows.length) return;
    const booked = rows
      .filter(r => r.status === 'full' || r.status === 'booked')
      .map(r => r.date);
    _ls('hm_booked', booked);
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
    if (!window.ENV || !window.ENV.ready) {
      console.error('[ContentLoader] Aborting: window.ENV not ready — env.js failed to load');
      return;
    }
    const sb = window.SupabaseClient;
    if (!sb) {
      console.warn('[ContentLoader] SupabaseClient not available — displaying static defaults');
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

        /* Fallbacks if dedicated tables returned nothing */
        if (!svcRes.data || !svcRes.data.length)
          _applyServiceCards(kv.hm_services);
        if (!revRes.data || !revRes.data.length)
          _applyRevCards(kv.hm_reviews);
      } else if (kvRes.error) {
        console.warn('[ContentLoader] hm_data read error:', kvRes.error.message);
      }

      /* services table ─────────────────────────────────── */
      if (svcRes.data && svcRes.data.length) {
        const svcs = svcRes.data.map(_mapService);
        _ls('hm_services', svcs);
        _applyServiceCards(svcs);
      } else if (svcRes.error) {
        console.warn('[ContentLoader] services read error:', svcRes.error.message);
      }

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
  if (!window.ENV || !window.ENV.ready) {
    console.error('[ContentLoader] FATAL: window.ENV not ready — env.js did not execute. Check FTP deploy and server logs.');
    return;
  }
  if (!window.supabase) {
    console.error('[ContentLoader] FATAL: Supabase UMD not loaded — js/lib/supabase.js missing');
    return;
  }
  if (!window.SupabaseClient) {
    console.error('[ContentLoader] FATAL: SupabaseClient is null — createClient() failed', {
      ENV_ready:    window.ENV.ready,
      supabaseLib:  !!window.supabase,
    });
    return;
  }
  console.debug('[ContentLoader] bootstrap OK — ENV ready, SupabaseClient initialized');
})();

/* DOM is ready — scripts load at end of <body> */
window.ContentLoader.init();
