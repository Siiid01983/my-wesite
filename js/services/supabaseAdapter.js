/* ════════════════════════════════════════════════════════
   SUPABASE ADAPTER  —  write-through cache over localStorage
   ════════════════════════════════════════════════════════
   Load order (all plain <script> tags, in order):
     1. Supabase UMD  (sets window.supabase)
     2. js/config/env.js  (sets window.SUPABASE_URL / ANON_KEY)
     3. this file  (sets window.Adapter)

   Strategy: reads always return from localStorage (sync, zero
   latency). Every write goes to localStorage first, then fires
   an async upsert to Supabase (fire-and-forget). On init,
   Adapter.syncFromSupabase() pulls the full dataset from
   Supabase into localStorage so the device is up to date.

   Supabase table: hm_data  (key TEXT PK, value JSONB, updated_at TIMESTAMPTZ)
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Supabase client ──────────────────────────────────── */
  const _sb = (function () {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('<') || key.includes('<')) return null;
    if (!window.supabase) { console.warn('[Adapter] Supabase UMD not loaded'); return null; }
    try { return window.supabase.createClient(url, key); }
    catch (e) { console.warn('[Adapter] createClient failed:', e); return null; }
  })();

  const TABLE = 'hm_data';

  /* ── Storage helpers ──────────────────────────────────── */
  const _ls  = (k, def) => { try { return JSON.parse(localStorage.getItem(k) ?? JSON.stringify(def)); } catch { return def; } };
  const _set = (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* no-op */ } };

  function _push(key, value) {
    if (!_sb) return;
    _sb.from(TABLE)
      .upsert({ key, value, updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.warn('[Adapter] write error', key, error.message); });
  }

  /* Write-through: localStorage first (sync) then Supabase (async) */
  function wt(key, value) { _set(key, value); _push(key, value); }

  /* ── Key map (mirrors original Adapter) ──────────────── */
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
  };

  /* ── Adapter ──────────────────────────────────────────── */
  window.Adapter = {

    /** True when the Supabase client is initialised. */
    supabaseReady: !!_sb,

    /**
     * Pull all rows from Supabase into localStorage.
     * Call once during app init (before rendering) to ensure
     * the local cache is up to date.
     */
    async syncFromSupabase() {
      if (!_sb) return;
      const { data, error } = await _sb.from(TABLE).select('key, value');
      if (error) throw error;
      (data || []).forEach(({ key, value }) => _set(key, value));
    },

    /* ── Bookings ─────────────────────────────────────── */
    getBookings: () => _ls(K.bk, []),
    addBooking(b)        { const a = this.getBookings(); a.unshift(b); wt(K.bk, a); },
    updateBooking(id, p) { wt(K.bk, this.getBookings().map(b => b.id === id ? { ...b, ...p } : b)); },
    deleteBooking(id)    { wt(K.bk, this.getBookings().filter(b => b.id !== id)); },

    /* ── Availability ─────────────────────────────────── */
    getAvail: () => _ls(K.av, {}),
    setDate(date, status) {
      const a = this.getAvail();
      if (status === 'available') delete a[date]; else a[date] = status;
      wt(K.av, a);
      let booked = _ls(K.booked, []);
      booked = booked.filter(d => d !== date);
      if (status === 'booked') booked.push(date);
      wt(K.booked, booked);
    },
    clearAvail() {
      localStorage.removeItem(K.av);
      localStorage.removeItem(K.booked);
      localStorage.removeItem(K.counts);
      _push(K.av, {}); _push(K.booked, []); _push(K.counts, {});
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
      wt('hm_services', defaults);
      return defaults;
    },
    addService(s)        { const a = this.getServices(); a.push(s); wt('hm_services', a); },
    updateService(id, p) { wt('hm_services', this.getServices().map(s => s.id === id ? { ...s, ...p } : s)); },
    deleteService(id)    { wt('hm_services', this.getServices().filter(s => s.id !== id)); },
    saveServices: (svcs) => wt('hm_services', svcs),
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
      if (dirty) wt('hm_reviews', reviews);
      return reviews;
    },
    addReview(r)        { const a = this.getReviews(); a.unshift(r); wt('hm_reviews', a); },
    updateReview(id, p) { wt('hm_reviews', this.getReviews().map(r => r.id === id ? { ...r, ...p } : r)); },
    deleteReview(id)    { wt('hm_reviews', this.getReviews().filter(r => r.id !== id)); },
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
            { text:'Live Chat',                   href:'#' },
            { text:'受付：8:00 – 20:00',           href:'' },
            { text:'対応エリア：日本全国',         href:'' },
            { text:'対応言語：日本語 / English',   href:'' }] },
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

    /* ── Customers ────────────────────────────────────── */
    getCustomers: () => _ls(K.cust, []),
    saveCustomers: (v) => wt(K.cust, v),

    /* ── Migration ────────────────────────────────────── */
    migrate() {
      const booked = _ls(K.booked, []);
      const avail  = this.getAvail();
      booked.forEach(d => { if (!avail[d]) avail[d] = 'booked'; });
      wt(K.av, avail);
    },
  };
})();
