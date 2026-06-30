/* ════════════════════════════════════════════════════════
   API ADAPTER
   ════════════════════════════════════════════════════════
   Wired tables (proper schema):
     bookings              ← admin bookings
     calendar_availability ← availability overrides
     reviews               ← customer reviews
     services              ← service listings

   Key-value store (hm_data):
     everything else — prices, hero, FAQ, footer, etc.

   Strategy: reads return from localStorage (sync). Every write
   goes to localStorage first (instant), then fires an async
   upsert/delete to API. syncFromApi() pulls the full
   dataset on login so all devices stay in sync.

   Load order (plain <script> tags, in order):
     1. apiClient.js       → window.ApiClient (self-hosted PHP + MySQL client)
     2. js/config/env.js   → window.API_BASE
     3. dataClient.js  → window.api (shared client handle)
     4. this file          → window.Adapter
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Shared API client (single instance for the whole app) ─── */
  const _api = window.api || null;
  if (!_api) {
    console.error('[Adapter] CRITICAL: ApiClient is null at Adapter init — ALL writes will be silently dropped. Check env.js (window.ENV.ready must be true) and dataClient.js.');
  } else {
    console.log('[Adapter] ApiClient captured OK —', _api.apiBase || 'client ready');
  }

  /* ── localStorage helpers ─────────────────────────────── */
  const _ls  = (k, def) => { try { return JSON.parse(localStorage.getItem(k) ?? JSON.stringify(def)); } catch { return def; } };
  const _set = (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* no-op */ } };

  /* ── Read-only guard ─────────────────────────────────── */
  let _roToastPending = false;
  function _checkCanWrite() {
    if (window.Auth && typeof Auth.getRole === 'function' && Auth.getRole() === 'read-only') {
      if (!_roToastPending) {
        _roToastPending = true;
        setTimeout(() => { _roToastPending = false; }, 1500);
        if (typeof toast === 'function') toast('読み取り専用モードです');
      }
      return false;
    }
    return true;
  }

  /* ── API write helpers ───────────────────────────── */
  function _upsert(table, data, matchCol) {
    if (window.Auth && typeof Auth.getRole === 'function' && Auth.getRole() === 'read-only') return;
    if (!_api) {
      console.warn(`[Adapter] _upsert: ApiClient is null — write to "${table}" dropped`);
      return;
    }
    console.log('[SAVE]', table, 'upsert', matchCol, data);
    _api.from(table)
      .upsert(data, { onConflict: matchCol })
      .then(({ error }) => {
        if (error) console.error(`[API ERROR] ${table} upsert failed:`, error.message, error);
        else        console.log(`[API RESPONSE] ${table} upsert ok`);
      });
  }

  function _del(table, col, val) {
    if (window.Auth && typeof Auth.getRole === 'function' && Auth.getRole() === 'read-only') return;
    if (!_api) {
      console.warn(`[Adapter] _del: ApiClient is null — delete from "${table}" dropped`);
      return;
    }
    _api.from(table).delete().eq(col, val)
      .then(({ error }) => { if (error) console.error(`[API ERROR] ${table} delete failed:`, error.message); });
  }

  /* hm_data key-value writes */
  function _kv(key, value) {
    if (!_api) {
      console.warn(`[Adapter] _kv: ApiClient is null — hm_data write dropped. key: "${key}"`);
      return;
    }
    console.log('[SAVE] hm_data upsert key:', key);
    _api.from('hm_data')
      .upsert({ key, value, updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) console.error(`[API ERROR] hm_data upsert failed. key: "${key}"`, error.message, error);
        else        console.log(`[API RESPONSE] hm_data upsert ok. key: "${key}"`);
      });
  }

  /* Write-through: localStorage first, then API hm_data */
  function wt(key, value) {
    if (!_checkCanWrite()) return;
    _set(key, value);
    _kv(key, value);
    if (window.DataProvider) DataProvider.invalidate('hm_data');
  }

  /* ── Key map ──────────────────────────────────────────── */
  const K = {
    bk:      'hm_admin_bookings',
    av:      'hm_admin_avail',
    booked:  'hm_booked',
    counts:  'hm_counts',
    cap:     'hm_capacity',
    prices:  'hm_prices',
    disposal:'hm_disposal',
    cust:    'hm_customers',
    line:    'hm_line',
    linelog: 'hm_linelog',
    email:   'hm_email',
    emaillog:'hm_emaillog',
    gcal:         'hm_gcal',
    followup:     'hm_followup',
    followupSent: 'hm_followup_sent',
    followupLog:  'hm_followup_log',
  };

  /* ── Status maps ──────────────────────────────────────── */
  // Admin panel uses Japanese; API schema uses English.
  const BK_TO_DB = {
    '新規': 'pending', '確認中': 'checking',
    '確定': 'confirmed', '完了': 'completed', 'キャンセル': 'cancelled',
  };
  const BK_TO_LOCAL = {
    pending: '新規', checking: '確認中', confirmed: '確定', completed: '完了', cancelled: 'キャンセル',
  };
  // Calendar: admin uses 'booked'; API schema uses 'full'.
  const CAL_TO_DB    = { booked: 'full' };
  const CAL_TO_LOCAL = { full: 'booked' };

  /* ── Notes encoding — fields not in DB schema are packed into notes ─── */
  const _HM_SEP = '\n[HM_EXTRAS]\n';

  function _packBookingNotes(b) {
    const extras = [];
    if (b.id)       extras.push(`ref:${b.id}`);
    if (b.fromAddr) extras.push(`from:${b.fromAddr}`);
    if (b.toAddr)   extras.push(`to:${b.toAddr}`);
    if (b.service)  extras.push(`service:${b.service}`);
    if (b.time)     extras.push(`time:${b.time}`);
    if (b.items && b.items.length) extras.push(`items:${b.items.join('|')}`);
    if (b.workers)  extras.push(`workers:${b.workers}`);
    const block = extras.join('\n');
    const user  = b.notes || '';
    if (!block) return user || null;
    return user ? `${user}${_HM_SEP}${block}` : block;
  }

  function _unpackBookingNotes(raw) {
    const idx = (raw || '').indexOf(_HM_SEP);
    const userNotes  = idx >= 0 ? raw.slice(0, idx) : (raw || '');
    const extraBlock = idx >= 0 ? raw.slice(idx + _HM_SEP.length) : '';
    const extra = {};
    extraBlock.split('\n').forEach(line => {
      const c = line.indexOf(':');
      if (c > 0) extra[line.slice(0, c).trim()] = line.slice(c + 1).trim();
    });
    return { userNotes, extra };
  }

  /* Parse furniture items and worker count from the booking-overlay's
     human-readable notes pattern: "荷物: A・B / 作業員: 1名 / ..."  */
  function _parseBookingItems(raw) {
    if (!raw) return { items: [], workers: null, cleanNotes: '' };
    const segs = raw.split(' / ');
    const items = [];
    let workers = null;
    const kept = [];
    segs.forEach(s => {
      const t = s.trim();
      if (t.startsWith('荷物: ')) {
        const v = t.slice(4).trim();
        if (v && v !== '荷物を選択') v.split('・').filter(Boolean).forEach(i => items.push(i.trim()));
      } else if (t.startsWith('作業員: ')) {
        workers = t.slice(4).trim();
      } else if (t) {
        kept.push(t);
      }
    });
    return { items, workers, cleanNotes: kept.join(' / ') };
  }

  /* ── Data mappers ─────────────────────────────────────── */
  function bookingToRow(b) {
    return {
      customer_name:  b.name      || '',
      customer_email: b.email     || null,
      customer_phone: b.phone     || null,
      booking_date:   b.date      || null,
      service_id:     null,
      status:         BK_TO_DB[b.status] || 'pending',
      notes:          _packBookingNotes(b),
      created_at:     b.createdAt || new Date().toISOString(),
    };
  }

  function rowToBooking(r) {
    const { userNotes, extra } = _unpackBookingNotes(r.notes);
    // Items: prefer dedicated `items` DB column (if added), then packed extras, then notes parsing
    const extraItems = extra.items ? extra.items.split('|').filter(Boolean) : null;
    const { items: parsedItems, workers: parsedWorkers, cleanNotes } = _parseBookingItems(userNotes);
    return {
      _dbId:     r.id,
      id:        extra.ref     || String(r.id),
      name:      r.customer_name  || '',
      email:     r.customer_email || '',
      phone:     r.customer_phone || '',
      date:      r.booking_date   || '',
      fromAddr:  extra.from    || '',
      toAddr:    extra.to      || '',
      service:   r.service_id   || extra.service || '',
      status:    BK_TO_LOCAL[r.status] || '新規',
      notes:     cleanNotes,
      items:     (Array.isArray(r.items) && r.items.length ? r.items : null)
                 || extraItems
                 || parsedItems,
      workers:   extra.workers || parsedWorkers,
      time:      extra.time    || '',
      createdAt: r.created_at  || new Date().toISOString(),
    };
  }

  function reviewToRow(r) {
    return {
      reference_id:      r.id,
      customer_name:     r.name       || '',
      rating:            r.rating     || null,
      review_text:       r.text       || null,
      approved:          r.status === 'approved',
      published:         r.published  || false,
      headline:          r.headline   || null,
      service:           r.service    || null,
      date_label:        r.date_label || null,
      location:          r.location   || null,
      source:            r.source     || 'admin',
      booking_reference: r.bookingId  || null,
      created_at:        r.createdAt  || new Date().toISOString(),
    };
  }

  function rowToReview(r) {
    return {
      id:         r.reference_id || r.id,
      name:       r.customer_name || '',
      rating:     r.rating,
      text:       r.review_text || '',
      status:     r.approved ? 'approved' : 'pending',
      published:  r.published  || false,
      headline:   r.headline   || '',
      service:    r.service    || '',
      date_label: r.date_label || '',
      location:   r.location   || '',
      source:     r.source     || 'admin',
      bookingId:  r.booking_reference || null,
      createdAt:  r.created_at || new Date().toISOString(),
    };
  }

  function serviceToRow(s, order) {
    return {
      reference_id:  s.id,
      title:         s.title       || '',
      description:   s.description || null,
      display_order: order !== undefined ? order : (s.display_order || 0),
      active:        s.active !== false,
      badge:         s.badge    || null,
      cta_text:      s.cta_text || null,
    };
  }

  function rowToService(r) {
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

  /* ── Adapter ──────────────────────────────────────────── */
  window.Adapter = {

    apiReady: !!_api,

    /* Pull all remote data into localStorage — called once at login.
       Order: hm_data first (config baseline), then proper tables
       (these overwrite the same keys so transactional data wins). */
    async syncFromApi() {
      if (!_api) return;

      const [bkRes, calRes, revRes, svcRes, kvRes] = await Promise.all([
        _api.from('bookings').select('*').order('created_at', { ascending: false }),
        _api.from('calendar_availability').select('*'),
        _api.from('reviews').select('*').order('created_at', { ascending: false }),
        _api.from('services').select('*').order('display_order'),
        _api.from('hm_data').select('key, value'),
      ]);

      // Config baseline
      if (kvRes.data) kvRes.data.forEach(({ key, value }) => _set(key, value));

      // Bookings
      if (bkRes.data) {
        _set(K.bk, bkRes.data.map(rowToBooking));
        if (window.DataProvider) DataProvider.seed('bookings', bkRes.data);
      } else if (bkRes.error) console.warn('[Adapter] bookings sync:', bkRes.error.message);

      // Calendar overrides
      if (calRes.data) {
        const avail = {};
        calRes.data.forEach(row => {
          const local = CAL_TO_LOCAL[row.status] || row.status;
          if (local !== 'available') avail[row.date] = local;
        });
        _set(K.av, avail);
        if (window.DataProvider) DataProvider.seed('calendar_availability', calRes.data);
      }

      // Reviews
      if (revRes.data) {
        _set('hm_reviews', revRes.data.map(rowToReview));
        if (window.DataProvider) DataProvider.seed('reviews', revRes.data);
      } else if (revRes.error) console.warn('[Adapter] reviews sync:', revRes.error.message);

      // Services (only overwrite if the table has rows)
      if (svcRes.data && svcRes.data.length) {
        _set('hm_services', svcRes.data.map(rowToService));
        if (window.DataProvider) DataProvider.seed('services', svcRes.data);
      } else if (svcRes.error) console.warn('[Adapter] services sync:', svcRes.error.message);
    },

    /* ── Bookings ─────────────────────────────────────── */
    getBookings: () => _ls(K.bk, []),

    addBooking(b) {
      if (!_checkCanWrite()) return;
      const a = this.getBookings(); a.unshift(b); _set(K.bk, a);
      if (window.DataProvider) DataProvider.invalidate('bookings');
      if (!_api) { console.warn('[Adapter] addBooking: ApiClient null'); return; }
      _api.from('bookings').insert(bookingToRow(b))
        .then(({ error }) => {
          if (error) console.error('[API ERROR] bookings insert failed:', error.message);
          else        console.log('[API RESPONSE] bookings insert ok');
        });
    },

    updateBooking(id, p) {
      if (!_checkCanWrite()) return;
      const list = this.getBookings().map(b => b.id === id ? { ...b, ...p } : b);
      _set(K.bk, list);
      if (window.DataProvider) DataProvider.invalidate('bookings');
      const updated = list.find(b => b.id === id);
      if (updated && updated._dbId && _api) {
        const { created_at, ...fields } = bookingToRow(updated);
        const row = { ...fields, updated_at: new Date().toISOString() };
        _api.from('bookings').update(row).eq('id', updated._dbId)
          .then(({ error }) => { if (error) console.error('[API ERROR] bookings update failed:', error.message); });
      }
    },

    deleteBooking(id) {
      if (!_checkCanWrite()) return;
      const bk = this.getBookings().find(b => b.id === id);
      const dbId = bk && bk._dbId;
      _set(K.bk, this.getBookings().filter(b => b.id !== id));
      if (window.DataProvider) DataProvider.invalidate('bookings');
      if (dbId) _del('bookings', 'id', dbId);
    },

    /* ── Availability ─────────────────────────────────── */
    getAvail: () => _ls(K.av, {}),

    setDate(date, status) { if (!_checkCanWrite()) return;
      const a = this.getAvail();
      if (status === 'available') delete a[date]; else a[date] = status;
      _set(K.av, a);
      if (window.DataProvider) DataProvider.invalidate('calendar_availability');
      // Keep hm_booked in sync for the public calendar
      let booked = _ls(K.booked, []);
      booked = booked.filter(d => d !== date);
      if (status === 'booked') booked.push(date);
      _set(K.booked, booked);
      // API
      const dbStatus = CAL_TO_DB[status] || status;
      if (status === 'available') {
        _del('calendar_availability', 'date', date);
      } else {
        _upsert('calendar_availability',
          { date, status: dbStatus, updated_at: new Date().toISOString() }, 'date');
      }
    },

    clearAvail() {
      if (!_checkCanWrite()) return;
      localStorage.removeItem(K.av);
      localStorage.removeItem(K.booked);
      localStorage.removeItem(K.counts);
      if (window.DataProvider) DataProvider.invalidate('calendar_availability');
      if (_api) {
        _api.from('calendar_availability').delete().not('date', 'is', null)
          .then(({ error }) => { if (error) console.warn('[Adapter] clearAvail error:', error.message); });
      }
    },

    /* ── Capacity ─────────────────────────────────────── */
    getCapacity: () => _ls(K.cap, { max: 5, limited: 3 }),
    saveCapacity: (v) => wt(K.cap, v),

    /* ── Prices ───────────────────────────────────────── */
    getPrices() {
      const DEFAULTS = {
        '単身引越し':               { base: 25000, distPerKm: 150, floorFee: 2000, weekend: 5000,  sameday: 10000 },
        'カップル・ご夫婦引越し':   { base: 45000, distPerKm: 150, floorFee: 2000, weekend: 8000,  sameday: 15000 },
        '学生・新生活引越し':       { base: 22000, distPerKm: 150, floorFee: 2000, weekend: 4000,  sameday:  8000 },
        '不用品回収・処分サービス': { base: 18000, distPerKm: 150, floorFee: 2000, weekend: 3000,  sameday:  5000 },
      };
      const stored = _ls(K.prices, null);
      if (!stored) return DEFAULTS;
      if (typeof Object.values(stored)[0] === 'number') return DEFAULTS;
      return { ...DEFAULTS, ...stored };
    },
    savePrices: (v) => wt(K.prices, v),

    /* ── Quotes ───────────────────────────────────────── */
    getQuotes: () => _ls('hm_quotes', []),
    addQuote(q)     { const a = this.getQuotes(); a.unshift(q); wt('hm_quotes', a); },
    deleteQuote(id) { wt('hm_quotes', this.getQuotes().filter(q => q.id !== id)); },

    /* ── Services ─────────────────────────────────────── */
    getServices() {
      const defaults = [
        { id:'SVC-1', title:'単身引越し',             description:'1人分の荷物に最適化。必要な分だけコンパクトに対応。',           badge:'人気サービス', cta_text:'無料お見積り →' },
        { id:'SVC-2', title:'カップル・ご夫婦引越し', description:'養生から家具配置まで。二人の新生活をスムーズに。',               badge:'人気サービス', cta_text:'無料お見積り →' },
        { id:'SVC-3', title:'学生・新生活引越し',     description:'初めての引越しも段取りから設置まで対応。',                       badge:'人気サービス', cta_text:'無料お見積り →' },
        { id:'SVC-4', title:'当日・お急ぎ引越しプラン',description:'急な引越しも当日対応。最短2時間でご返信します。',               badge:'緊急対応',   cta_text:'' },
        { id:'SVC-5', title:'不用品回収・処分',       description:'回収・処分・搬出まで一括。手続き不要。',                         badge:'',           cta_text:'無料お見積り →' },
        { id:'SVC-6', title:'家具組立・分解',         description:'IKEA・大型家具の組立・分解に対応。',                             badge:'',           cta_text:'無料お見積り →' },
      ];
      const v = _ls('hm_services', null);
      if (v) return v.map(s => ({ cta_text: '無料お見積り →', ...s }));
      _set('hm_services', defaults);
      return defaults;
    },

    addService(s) {
      if (!_checkCanWrite()) return;
      const a = this.getServices(); a.push(s); _set('hm_services', a);
      if (window.DataProvider) DataProvider.invalidate('services');
      _upsert('services', serviceToRow(s, a.length - 1), 'reference_id');
    },

    updateService(id, p) {
      if (!_checkCanWrite()) return;
      const svcs = this.getServices().map(s => s.id === id ? { ...s, ...p } : s);
      _set('hm_services', svcs);
      if (window.DataProvider) DataProvider.invalidate('services');
      const updated = svcs.find(s => s.id === id);
      if (updated) _upsert('services', serviceToRow(updated, svcs.indexOf(updated)), 'reference_id');
    },

    deleteService(id) {
      if (!_checkCanWrite()) return;
      _set('hm_services', this.getServices().filter(s => s.id !== id));
      if (window.DataProvider) DataProvider.invalidate('services');
      _del('services', 'reference_id', id);
    },

    saveServices(svcs) {
      if (!_checkCanWrite()) return;
      _set('hm_services', svcs);
      if (window.DataProvider) DataProvider.invalidate('services');
      if (!_api || !svcs.length) return;
      _api.from('services')
        .upsert(svcs.map((s, i) => serviceToRow(s, i)), { onConflict: 'reference_id' })
        .then(({ error }) => { if (error) console.warn('[Adapter] saveServices error:', error.message); });
    },

    getSvcMeta: () => _ls('hm_services_section', { eyebrow:'Services', title:'承っている引越し', lead:'単身・カップル・学生・当日引越しまで対応。' }),
    saveSvcMeta: (v) => wt('hm_services_section', v),
    getSvcHistory: () => { try { return JSON.parse(localStorage.getItem('hm_svc_history') || '[]'); } catch { return []; } },
    pushSvcHistory(snap) {
      const hist = this.getSvcHistory();
      hist.unshift({ ts: Date.now(), meta: snap.meta, services: snap.services });
      try { localStorage.setItem('hm_svc_history', JSON.stringify(hist.slice(0, 10))); } catch { /* no-op */ }
    },

    /* ── Hero ─────────────────────────────────────────── */
    getHero() {
      const defaults = {
        headline_ja: 'ていねいに、運びます。',  headline_en: 'Same-day moving. Careful, always.',
        sub_primary: 'オンライン予約・無料見積り対応', sub_secondary: '料金確認から予約までオンライン完結',
        cta_book_sup: 'オンライン予約', cta_book_lbl: '今すぐ予約する',
        cta_quote_sup: '無料見積り',   cta_quote_lbl: '料金を確認する',
        cta_line: 'LINE相談', trust_badges: ['最短2時間でご返信', 'オンライン予約対応'], bg_image: '',
      };
      const saved = _ls('hm_hero', defaults);
      if (saved.headline     && !saved.headline_ja)    saved.headline_ja   = saved.headline;
      if (saved.subtitle     && !saved.sub_primary)    saved.sub_primary   = saved.subtitle;
      if (saved.ctaPrimary   && !saved.cta_book_lbl)   saved.cta_book_lbl  = saved.ctaPrimary;
      if (saved.ctaSecondary && !saved.cta_quote_lbl)  saved.cta_quote_lbl = saved.ctaSecondary;
      return Object.assign({}, defaults, saved);
    },
    saveHero: (v) => wt('hm_hero', v),
    getHeroHistory: () => { try { return JSON.parse(localStorage.getItem('hm_hero_history') || '[]'); } catch { return []; } },
    pushHeroHistory(v) {
      const hist = this.getHeroHistory();
      hist.unshift({ ts: Date.now(), data: v });
      try { localStorage.setItem('hm_hero_history', JSON.stringify(hist.slice(0, 10))); } catch { /* no-op */ }
    },

    /* ── Reviews ──────────────────────────────────────── */
    getReviews() {
      const reviews = _ls('hm_reviews', []);
      let dirty = false;
      reviews.forEach(r => {
        if (!r.status) { r.status = 'approved'; r.published = true; r.source = 'admin'; dirty = true; }
      });
      if (dirty) _set('hm_reviews', reviews);
      return reviews;
    },

    addReview(r) {
      if (!_checkCanWrite()) return;
      const a = this.getReviews(); a.unshift(r); _set('hm_reviews', a);
      if (window.DataProvider) DataProvider.invalidate('reviews');
      _upsert('reviews', reviewToRow(r), 'reference_id');
    },

    updateReview(id, p) {
      if (!_checkCanWrite()) return;
      const list = this.getReviews().map(r => r.id === id ? { ...r, ...p } : r);
      _set('hm_reviews', list);
      if (window.DataProvider) DataProvider.invalidate('reviews');
      const updated = list.find(r => r.id === id);
      if (updated) _upsert('reviews', reviewToRow(updated), 'reference_id');
    },

    deleteReview(id) {
      if (!_checkCanWrite()) return;
      _set('hm_reviews', this.getReviews().filter(r => r.id !== id));
      if (window.DataProvider) DataProvider.invalidate('reviews');
      _del('reviews', 'reference_id', id);
    },

    getRevMeta: () => _ls('hm_reviews_section', { eyebrow:'Customer Voices', title:'お客様からの、お声', lead:'これまでにご利用いただいたお客様より頂戴したご感想を、一部ご紹介いたします。', gmb_score:'4.9', gmb_count:'38件の口コミ' }),
    saveRevMeta: (v) => wt('hm_reviews_section', v),
    getRevHistory: () => { try { return JSON.parse(localStorage.getItem('hm_rev_history') || '[]'); } catch { return []; } },
    pushRevHistory(snap) {
      const hist = this.getRevHistory();
      hist.unshift({ ts: Date.now(), meta: snap.meta });
      try { localStorage.setItem('hm_rev_history', JSON.stringify(hist.slice(0, 10))); } catch { /* no-op */ }
    },

    /* ── FAQ ──────────────────────────────────────────── */
    getFaq() {
      const defaults = [
        { id:'FAQ-1', question:'お見積りは無料ですか?',              answer:'はい、お見積りは完全無料です。訪問でのお見積り、オンラインでのお見積り、どちらにも対応しております。' },
        { id:'FAQ-2', question:'当日のご依頼でも対応していただけますか?', answer:'スケジュール状況により対応可能な場合がございます。お急ぎの際は、LINEまたはチャットにてご連絡くださいませ。' },
        { id:'FAQ-3', question:'英語での対応は可能ですか?',          answer:'はい、日本語・英語の両方に対応しております。Yes, our team can assist you in English. ご遠慮なくご相談ください。' },
        { id:'FAQ-4', question:'お支払い方法を教えてください',        answer:'現金、銀行振込、主要クレジットカードに対応しております。法人のお客様には、請求書でのお支払いも承っております。' },
        { id:'FAQ-5', question:'家具の組立・分解だけのご依頼も可能ですか?', answer:'はい、家具の組立・分解のみのご依頼も承っております。お見積りの際にご相談くださいませ。' },
        { id:'FAQ-6', question:'キャンセル料はかかりますか?',         answer:'引越し日の3日前までは無料でキャンセルいただけます。それ以降は、国土交通省が定める標準引越運送約款に基づきキャンセル料を頂戴いたします。' },
        { id:'FAQ-7', question:'万が一、お荷物が破損した場合はどうなりますか?', answer:'当社は損害補償保険に加入しております。万が一作業中の事故が発生した場合は、速やかに状況をご確認のうえ、誠実にご対応させていただきます。' },
        { id:'FAQ-8', question:'梱包資材は用意してもらえますか?',     answer:'はい、ダンボール・ガムテープ・緩衝材などをご用意しております。プランにより無料でご提供できる場合もございますので、お見積り時にご相談ください。' },
      ];
      const v = _ls('hm_faq', null);
      if (v) return v;
      wt('hm_faq', defaults);
      return defaults;
    },
    saveFaq: (v) => wt('hm_faq', v),
    getFaqMeta: () => _ls('hm_faq_section', { eyebrow:'FAQ', title:'よくあるご質問', lead:'ご不明な点がございましたら、お気軽にお問い合わせください。' }),
    saveFaqMeta: (v) => wt('hm_faq_section', v),
    getFaqHistory: () => { try { return JSON.parse(localStorage.getItem('hm_faq_history') || '[]'); } catch { return []; } },
    pushFaqHistory(snap) {
      const hist = this.getFaqHistory();
      hist.unshift({ ts: Date.now(), meta: snap.meta, items: snap.items });
      try { localStorage.setItem('hm_faq_history', JSON.stringify(hist.slice(0, 10))); } catch { /* no-op */ }
    },

    /* ── Company ──────────────────────────────────────── */
    getCompanyRows() {
      const defaults = [
        { id:'CR-1',  label:'会社名',     value:'Hello Moving' },
        { id:'CR-2',  label:'創業',       value:'2012年' },
        { id:'CR-3',  label:'事業内容',   value:'引越し運送業（単身・カップル・学生・当日対応）／家具組立・設置' },
        { id:'CR-4',  label:'所在地',     value:'東京都' },
        { id:'CR-5',  label:'対応エリア', value:'東京・神奈川・埼玉・千葉を中心に、日本全国' },
        { id:'CR-6',  label:'営業時間',   value:'8:00 – 20:00（年中無休）' },
        { id:'CR-7',  label:'許認可',     value:'国土交通省 認可運送事業者 — 第 431320058126 号' },
        { id:'CR-8',  label:'保険',       value:'引越業者向け 損害補償保険 加入済' },
        { id:'CR-9',  label:'対応言語',   value:'日本語 ／ English' },
        { id:'CR-10', label:'お支払い',   value:'現金 ／ 銀行振込 ／ クレジットカード ／ 請求書払い（法人）' },
      ];
      const v = _ls('hm_company_rows', null);
      if (v) return v;
      wt('hm_company_rows', defaults);
      return defaults;
    },
    saveCompanyRows: (v) => wt('hm_company_rows', v),
    getCompanyMeta: () => _ls('hm_company_section', { eyebrow:'Company', title:'会社情報' }),
    saveCompanyMeta: (v) => wt('hm_company_section', v),
    getCompanyHistory: () => { try { return JSON.parse(localStorage.getItem('hm_company_history') || '[]'); } catch { return []; } },
    pushCompanyHistory(snap) {
      const hist = this.getCompanyHistory();
      hist.unshift({ ts: Date.now(), meta: snap.meta, rows: snap.rows });
      try { localStorage.setItem('hm_company_history', JSON.stringify(hist.slice(0, 10))); } catch { /* no-op */ }
    },

    /* ── Footer ───────────────────────────────────────── */
    getFooter() {
      return _ls('hm_footer', {
        brand_desc: '東京を拠点に、丁寧で安心の引越しを承っております。日本語・英語対応。',
        cols: [
          { title:'サービス', links:[
            { text:'当日・お急ぎ引越しプラン', href:'#services' },
            { text:'単身引越し',               href:'#services' },
            { text:'カップル・ご夫婦引越し',   href:'#services' },
            { text:'学生・新生活引越し',       href:'#services' },
            { text:'不用品回収・処分サービス', href:'#services' },
            { text:'家具組立・分解',           href:'#services' }] },
          { title:'会社', links:[
            { text:'私たちのお約束',   href:'#commitments' },
            { text:'引越しの流れ',     href:'#flow' },
            { text:'お客様の声',       href:'#reviews' },
            { text:'よくある質問',     href:'#faq' },
            { text:'会社情報',         href:'#company' }] },
          { title:'お問い合わせ', links:[
            { text:'Live Chat',                 href:'#' },
            { text:'受付：8:00 – 20:00',         href:'' },
            { text:'対応エリア：日本全国',       href:'' },
            { text:'対応言語：日本語 / English', href:'' }] },
        ],
        copyright: '© 2026 Hello Moving. All Rights Reserved.',
        license:   '国土交通省 認可運送事業者 第 431320058126 号 ／ Licensed Moving Company in Japan',
      });
    },
    saveFooter: (v) => wt('hm_footer', v),
    getFooterHistory: () => { try { return JSON.parse(localStorage.getItem('hm_footer_history') || '[]'); } catch { return []; } },
    pushFooterHistory(snap) {
      const hist = this.getFooterHistory();
      hist.unshift({ ts: Date.now(), data: snap });
      try { localStorage.setItem('hm_footer_history', JSON.stringify(hist.slice(0, 10))); } catch { /* no-op */ }
    },

    /* ── Disposal ─────────────────────────────────────── */
    getDisposal() {
      const DEFAULTS = { categories: [
        { id:'cat_furniture',   name:'家具',     items:[
          { id:'itm_bed',   name:'ベッド・マットレス', fee:5000, enabled:true },
          { id:'itm_sofa',  name:'ソファ・チェア',     fee:4000, enabled:true },
          { id:'itm_table', name:'テーブル・棚',       fee:3000, enabled:true },
        ]},
        { id:'cat_appliances',  name:'家電',     items:[
          { id:'itm_fridge', name:'冷蔵庫', fee:6000, enabled:true },
          { id:'itm_washer', name:'洗濯機', fee:5000, enabled:true },
        ]},
        { id:'cat_electronics', name:'電子機器', items:[
          { id:'itm_tv', name:'テレビ',   fee:2500, enabled:true },
          { id:'itm_pc', name:'パソコン', fee:2000, enabled:true },
        ]},
        { id:'cat_misc', name:'その他', items:[
          { id:'itm_other', name:'その他大型ゴミ', fee:3000, enabled:true },
        ]},
      ]};
      const stored = _ls(K.disposal, null);
      if (!stored || !stored.categories) return JSON.parse(JSON.stringify(DEFAULTS));
      return stored;
    },
    saveDisposal: (v) => wt(K.disposal, v),

    /* ── LINE Notify ──────────────────────────────────── */
    getLineSettings: () => _ls(K.line, { token:'', enabled:false, proxyUrl:'', triggers:{ newBooking:true, statusConfirmed:true, statusComplete:true, newQuote:false } }),
    saveLineSettings: (v) => wt(K.line, v),
    getLineLog: () => _ls(K.linelog, []),
    pushLineLog(entry) { const log = this.getLineLog(); log.unshift(entry); wt(K.linelog, log.slice(0, 20)); },
    clearLineLog() { wt(K.linelog, []); },

    /* ── Email Notify ─────────────────────────────────── */
    getEmailSettings: () => _ls(K.email, { enabled:false, adminEmail:'', serviceId:'', templateId:'', publicKey:'', triggers:{ newBooking:true, statusConfirmed:true, statusComplete:true, newQuote:false } }),
    saveEmailSettings: (v) => wt(K.email, v),
    getEmailLog: () => _ls(K.emaillog, []),
    pushEmailLog(entry) { const log = this.getEmailLog(); log.unshift(entry); wt(K.emaillog, log.slice(0, 20)); },
    clearEmailLog() { wt(K.emaillog, []); },

    /* ── Google Calendar ─────────────────────────────── */
    getGcalSettings: () => _ls(K.gcal, { enabled:false, clientId:'', calendarId:'primary', syncDir:'both', lastSync:null }),
    saveGcalSettings: (v) => wt(K.gcal, v),

    /* ── Follow-up emails ────────────────────────────── */
    getFollowUpSettings: () => _ls(K.followup, { enabled:false, delayDays:3, templateId:'' }),
    saveFollowUpSettings: (v) => wt(K.followup, v),
    getFollowUpSent: () => _ls(K.followupSent, {}),
    markFollowUpSent(refId, info) { const s = this.getFollowUpSent(); s[refId] = info; wt(K.followupSent, s); },
    getFollowUpLog: () => _ls(K.followupLog, []),
    pushFollowUpLog(entry) { const log = this.getFollowUpLog(); log.unshift(entry); wt(K.followupLog, log.slice(0, 30)); },
    clearFollowUpLog() { wt(K.followupLog, []); },

    /* ── Customers ────────────────────────────────────── */
    getCustomers: () => _ls(K.cust, []),
    saveCustomers: (v) => wt(K.cust, v),

    /* ── Migration ────────────────────────────────────── */
    migrate() {
      const booked = _ls(K.booked, []);
      const avail  = this.getAvail();
      booked.forEach(d => { if (!avail[d]) avail[d] = 'booked'; });
      _set(K.av, avail);
    },

    /* ── Realtime ─────────────────────────────────────── */
    _bookingsChannel:     null,
    _availabilityChannel: null,

    /* Subscribe to API Realtime for bookings and calendar_availability.
       Idempotent — safe to call multiple times; duplicate channels are skipped. */
    initializeRealtime() {
      if (!_api) return;

      // ── Reservation Management: bookings table ───────────
      if (!this._bookingsChannel) {
        this._bookingsChannel = _api
          .channel('admin-bookings-realtime')
          .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'bookings' },
            (payload) => {
              console.log('[Realtime] Booking inserted', payload.new);
              const bk   = rowToBooking(payload.new);
              const list = this.getBookings();
              if (!list.find(b => b.id === bk.id)) {
                list.unshift(bk);
                _set(K.bk, list);
              }
              document.dispatchEvent(new CustomEvent('booking:created', {
                detail: { booking: bk }
              }));
            })
          .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'bookings' },
            (payload) => {
              console.log('[Realtime] Booking updated', payload.new);
              const bk   = rowToBooking(payload.new);
              const list = this.getBookings().map(b => b.id === bk.id ? bk : b);
              _set(K.bk, list);
              document.dispatchEvent(new CustomEvent('booking:updated', {
                detail: { bookingId: bk.id, booking: bk, status: bk.status }
              }));
            })
          .on('postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'bookings' },
            (payload) => {
              console.log('[Realtime] Booking deleted', payload.old);
              const dbId = payload.old?.id;
              if (dbId) {
                _set(K.bk, this.getBookings().filter(b => b._dbId !== dbId));
              } else {
                // REPLICA IDENTITY not FULL — payload.old has no id.
                // Do NOT re-fetch here: an eager fetch can race with other in-flight
                // requests and return [] transiently, wiping all local bookings.
                // Instead, mark the DataProvider cache as stale so the next navigation
                // to the bookings view fetches a verified fresh copy via _dpSync.
                if (window.DataProvider) DataProvider.invalidate('bookings');
              }
              document.dispatchEvent(new CustomEvent('booking:updated', {
                detail: { bookingId: dbId }
              }));
            })
          .subscribe();
      }

      // ── Calendar Management: calendar_availability table ─
      if (!this._availabilityChannel) {
        this._availabilityChannel = _api
          .channel('admin-availability-realtime')
          .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'calendar_availability' },
            (payload) => {
              console.log('[Realtime] Availability updated', payload.new);
              const { date, status } = payload.new;
              const localStatus = CAL_TO_LOCAL[status] || status;
              const avail = this.getAvail();
              if (localStatus === 'available') delete avail[date]; else avail[date] = localStatus;
              _set(K.av, avail);
              document.dispatchEvent(new CustomEvent('calendar:updated', {
                detail: { date, status: localStatus, source: 'realtime' }
              }));
            })
          .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'calendar_availability' },
            (payload) => {
              console.log('[Realtime] Availability updated', payload.new);
              const { date, status } = payload.new;
              const localStatus = CAL_TO_LOCAL[status] || status;
              const avail = this.getAvail();
              if (localStatus === 'available') delete avail[date]; else avail[date] = localStatus;
              _set(K.av, avail);
              document.dispatchEvent(new CustomEvent('calendar:updated', {
                detail: { date, status: localStatus, source: 'realtime' }
              }));
            })
          .on('postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'calendar_availability' },
            (payload) => {
              console.log('[Realtime] Availability updated', payload.old);
              const date = payload.old?.date;
              if (date) {
                const avail = this.getAvail();
                delete avail[date];
                _set(K.av, avail);
              }
              document.dispatchEvent(new CustomEvent('calendar:updated', {
                detail: { date, source: 'realtime' }
              }));
            })
          .subscribe();
      }
    },

    /* Pull only the bookings table from API and refresh localStorage.
       Lighter than syncFromApi() — use when bookings view is opened. */
    async syncBookings() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('bookings')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) { console.warn('[Adapter] syncBookings error:', error.message); return false; }
      if (data) _set(K.bk, data.map(rowToBooking));
      return true;
    },

    /* Pull hm_quotes from the hm_data KV table and refresh localStorage.
       Lighter than syncFromApi() — use when quotes view is opened. */
    async syncQuotes() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('value')
        .eq('key', 'hm_quotes')
        .maybeSingle();
      if (error) { console.warn('[Adapter] syncQuotes error:', error.message); return false; }
      if (data?.value) _set('hm_quotes', data.value);
      return true;
    },

    /* Pull only the services table from API and refresh localStorage.
       Lighter than syncFromApi() — use when services view is opened. */
    async syncServices() {
      if (!_api) return false;
      const { data, error } = await _api.from('services').select('*').order('display_order');
      if (error) { console.warn('[Adapter] syncServices error:', error.message); return false; }
      if (data && data.length) _set('hm_services', data.map(rowToService));
      return true;
    },

    /* Pull hm_customers from the hm_data KV table and refresh localStorage.
       Lighter than syncFromApi() — use when customers view is opened. */
    async syncCustomers() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('value')
        .eq('key', 'hm_customers')
        .maybeSingle();
      if (error) { console.warn('[Adapter] syncCustomers error:', error.message); return false; }
      if (data?.value) _set('hm_customers', data.value);
      return true;
    },

    /* Pull hm_faq and hm_faq_section from hm_data KV and refresh localStorage.
       Lighter than syncFromApi() — use when FAQ view is opened. */
    async syncFaq() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('key,value')
        .in('key', ['hm_faq', 'hm_faq_section']);
      if (error) { console.warn('[Adapter] syncFaq error:', error.message); return false; }
      if (data) data.forEach(({ key, value }) => { if (value) _set(key, value); });
      return true;
    },

    /* Pull hm_hero from hm_data KV and refresh localStorage.
       Lighter than syncFromApi() — use when hero view is opened. */
    async syncHero() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('value')
        .eq('key', 'hm_hero')
        .maybeSingle();
      if (error) { console.warn('[Adapter] syncHero error:', error.message); return false; }
      if (data?.value) _set('hm_hero', data.value);
      return true;
    },

    /* Generic KV write/read for modules that store a single hm_data key
       (siteSettings.js → 'hm_settings', seoCenter.js → 'hm_seo'). These were
       being CALLED but never existed, so every such save threw and was swallowed
       by the caller's try/catch — the value never reached the server. */
    /* Returns a Promise: the caller (siteSettings.js) chains `.catch(...)`, so a
       non-thenable return would itself throw and be swallowed — keeping the bug. */
    saveData(key, value) { try { wt(key, value); return Promise.resolve(true); } catch (e) { return Promise.reject(e); } },

    async syncData(apiKey, lsKey) {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('value')
        .eq('key', apiKey)
        .maybeSingle();
      if (error) { console.warn('[Adapter] syncData error:', apiKey, error.message); return false; }
      if (data?.value != null) _set(lsKey || apiKey, data.value);
      return true;
    },

    /* Pull hm_company_rows and hm_company_section from hm_data KV.
       Lighter than syncFromApi() — use when company view is opened. */
    async syncCompany() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('key,value')
        .in('key', ['hm_company_rows', 'hm_company_section']);
      if (error) { console.warn('[Adapter] syncCompany error:', error.message); return false; }
      if (data) data.forEach(({ key, value }) => { if (value) _set(key, value); });
      return true;
    },

    /* Pull hm_footer from hm_data KV and refresh localStorage.
       Lighter than syncFromApi() — use when footer view is opened. */
    async syncFooter() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('value')
        .eq('key', 'hm_footer')
        .maybeSingle();
      if (error) { console.warn('[Adapter] syncFooter error:', error.message); return false; }
      if (data?.value) _set('hm_footer', data.value);
      return true;
    },

    /* Pull hm_prices from hm_data KV and refresh localStorage.
       Lighter than syncFromApi() — use when pricing view is opened. */
    async syncPrices() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('value')
        .eq('key', 'hm_prices')
        .maybeSingle();
      if (error) { console.warn('[Adapter] syncPrices error:', error.message); return false; }
      if (data?.value) _set('hm_prices', data.value);
      return true;
    },

    /* Pull hm_disposal from hm_data KV and refresh localStorage.
       Lighter than syncFromApi() — use when disposal view is opened. */
    async syncDisposal() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('value')
        .eq('key', 'hm_disposal')
        .maybeSingle();
      if (error) { console.warn('[Adapter] syncDisposal error:', error.message); return false; }
      if (data?.value) _set('hm_disposal', data.value);
      return true;
    },

    /* Pull hm_capacity from hm_data KV and refresh localStorage.
       Lighter than syncFromApi() — use when capacity view is opened. */
    async syncCapacity() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('hm_data')
        .select('value')
        .eq('key', 'hm_capacity')
        .maybeSingle();
      if (error) { console.warn('[Adapter] syncCapacity error:', error.message); return false; }
      if (data?.value) _set('hm_capacity', data.value);
      return true;
    },

    /* Pull only the reviews table from API and refresh localStorage.
       Lighter than syncFromApi() — use when reviews view is opened. */
    async syncReviews() {
      if (!_api) return false;
      const { data, error } = await _api
        .from('reviews')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) { console.warn('[Adapter] syncReviews error:', error.message); return false; }
      if (data) _set('hm_reviews', data.map(rowToReview));
      return true;
    },

    /* Pull only calendar_availability from API and refresh localStorage.
       Lighter than syncFromApi() — use when calendar view is opened. */
    async syncAvailability() {
      if (!_api) return false;
      const { data, error } = await _api.from('calendar_availability').select('*');
      if (error) { console.warn('[Adapter] syncAvailability error:', error.message); return false; }
      if (data) {
        const avail = {};
        data.forEach(row => {
          const local = CAL_TO_LOCAL[row.status] || row.status;
          if (local !== 'available') avail[row.date] = local;
        });
        _set(K.av, avail);
      }
      return true;
    },

    /* Remove all active Realtime channels. Call on logout. */
    destroyRealtime() {
      if (!_api) return;
      if (this._bookingsChannel) {
        _api.removeChannel(this._bookingsChannel);
        this._bookingsChannel = null;
      }
      if (this._availabilityChannel) {
        _api.removeChannel(this._availabilityChannel);
        this._availabilityChannel = null;
      }
    },
  };
})();
