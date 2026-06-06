/* ════════════════════════════════════════════════════════
   STATISTICS SERVICE  — Phase 13 BI Dashboard
   ════════════════════════════════════════════════════════
   Provides all Business Intelligence metrics for the admin
   dashboard. Uses direct Supabase COUNT queries for aggregates
   (DataProvider doesn't support gte/lte filters) and an
   in-memory cache with two TTL tiers:

     KPI / revenue / trend / service / customer / ops : 5 min
     Recent activity feed                            : 1 min

   Cache is invalidated when Adapter dispatches domain events:
     booking:created, booking:updated → KPI + activity
     review:* events                  → activity

   Load order: supabase UMD → env.js → supabaseClient.js → this
   Publishes: document 'dashboard:stats-updated' { detail: stats }
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const _sb = window.SupabaseClient || null;

  /* ── In-memory cache ───────────────────────────────────── */
  const _mem = {};
  const _TTL_KPI = 5 * 60 * 1000;
  const _TTL_ACT = 60 * 1000;
  const _TTL_RAW = 30 * 1000; // shared raw bookings fetch — covers one renderDash cycle

  function _cGet(k)         { const c = _mem[k]; return (c && Date.now() < c.e) ? c.d : null; }
  function _cSet(k, d, ttl) { _mem[k] = { d, e: Date.now() + ttl }; }
  function _cDel(...keys)   { keys.forEach(k => delete _mem[k]); }

  function _invalidateKPI() {
    _cDel('growth', 'revenue', 'customers', 'operational', 'raw_bk');
    _cDel('trend_7', 'trend_30', 'trend_90');
    // Key must match getServicePopularity()'s default: _nDaysAgoISO(30) / _todayISO()
    _cDel(`svp_${_nDaysAgoISO(30)}_${_todayISO()}`);
  }

  function _invalidateActivity() { _cDel('activity'); }

  /* ── Shared raw bookings fetch (30 s TTL) ──────────────────
     All row-level BI functions (revenue, trend, service, customer)
     share this single fetch per renderDash cycle, cutting parallel
     Supabase round-trips from 4+ down to 1.
     ─────────────────────────────────────────────────────────── */
  let _rawBkInflight = null; // deduplicate concurrent callers

  async function _getBookingsRaw() {
    const cached = _cGet('raw_bk');
    if (cached) return cached;
    if (!_sb) return [];

    // If a fetch is already in flight, wait for it instead of launching another
    if (_rawBkInflight) return _rawBkInflight;

    _rawBkInflight = (async () => {
      const { data, error } = await _sb
        .from('bookings')
        .select('reference_id,move_date,service_type,status,email,customer_name,created_at')
        .order('created_at', { ascending: false });
      _rawBkInflight = null;
      if (error || !data) return [];
      _cSet('raw_bk', data, _TTL_RAW);
      return data;
    })();

    return _rawBkInflight;
  }

  /* ── Date helpers ──────────────────────────────────────── */
  const _pad = n => String(n).padStart(2, '0');

  function _iso(d) {
    return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`;
  }

  function _todayISO() { return _iso(new Date()); }

  function _nDaysAgoISO(n) {
    const d = new Date(); d.setDate(d.getDate() - n); return _iso(d);
  }

  function _yesterdayISO() { return _nDaysAgoISO(1); }

  function _weekStartISO() {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay());
    return _iso(d);
  }

  function _lastWeekStartISO() {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - d.getDay() - 7);
    return _iso(d);
  }

  function _monthStartISO() {
    const d = new Date();
    return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-01`;
  }

  function _lastMonthStartISO() {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    return _iso(d);
  }

  function _monthEndISO() {
    const d = new Date();
    const last = new Date(d.getFullYear(), d.getMonth()+1, 0);
    return _iso(last);
  }

  function _daysInMonth() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  }

  /* ── Aggregate COUNT helper ────────────────────────────── */
  async function _count(table, filters) {
    if (!_sb) return 0;
    let q = _sb.from(table).select('*', { count: 'exact', head: true });
    filters.forEach(([method, ...args]) => { q = q[method](...args); });
    const { count, error } = await q;
    if (error) { console.warn(`[StatisticsService] ${table} count error:`, error.message); return 0; }
    return count || 0;
  }

  /* ── Growth percentage helper ──────────────────────────── */
  function _pct(cur, prev) {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  }

  /* ════════════════════════════════════════════════════════
     1. ORIGINAL DASHBOARD STATS (preserved + extended)
     ════════════════════════════════════════════════════════ */
  async function getTodayBookings()  { return _count('bookings', [['eq', 'move_date', _todayISO()]]); }
  async function getWeeklyBookings() { return _count('bookings', [['gte', 'move_date', _weekStartISO()]]); }
  async function getMonthlyBookings(){ return _count('bookings', [['gte', 'move_date', _monthStartISO()]]); }

  async function getOccupancyRate() {
    const bookedDays = await _count('calendar_availability', [
      ['eq', 'status', 'full'],
      ['gte', 'date', _monthStartISO()],
      ['lte', 'date', _monthEndISO()],
    ]);
    const total = _daysInMonth();
    return total > 0 ? Math.round((bookedDays / total) * 100) : 0;
  }

  async function getDashboardStats() {
    if (!_sb) return null;

    // Fire bookings (shared), occupancy, and reviews in parallel.
    // _getBookingsRaw() is deduplicated across all concurrent BI callers via _rawBkInflight.
    const [data, occupancy, approvedReviews] = await Promise.all([
      _getBookingsRaw(),
      getOccupancyRate(),
      _count('reviews', [['eq', 'approved', true]]),
    ]);

    const today      = _todayISO();
    const weekStart  = _weekStartISO();
    const monthStart = _monthStartISO();
    const last30From = _nDaysAgoISO(30);

    // replaces: getTodayBookings()  → COUNT bookings WHERE move_date = today
    const todayCount     = data.filter(r => r.move_date === today).length;
    // replaces: getWeeklyBookings() → COUNT bookings WHERE move_date >= weekStart
    const weeklyCount    = data.filter(r => r.move_date >= weekStart).length;
    // replaces: getMonthlyBookings()→ COUNT bookings WHERE move_date >= monthStart
    const monthlyCount   = data.filter(r => r.move_date >= monthStart).length;
    // replaces: COUNT bookings WHERE status = 'pending'
    const pendingCount   = data.filter(r => r.status === 'pending').length;
    // replaces: COUNT bookings WHERE status = 'confirmed'
    const confirmedCount = data.filter(r => r.status === 'confirmed').length;
    // replaces: COUNT bookings WHERE status = 'cancelled'
    const cancelledCount = data.filter(r => r.status === 'cancelled').length;
    // replaces: COUNT bookings WHERE move_date >= 30 days ago
    const last30Count    = data.filter(r => r.move_date >= last30From).length;
    // replaces: _countDistinctCustomers() → COUNT DISTINCT email
    const totalCustomers = new Set(data.map(r => r.email).filter(Boolean)).size;

    const avgDaily = Math.round((last30Count / 30) * 10) / 10;
    return {
      today: todayCount, weekly: weeklyCount, monthly: monthlyCount,
      pending: pendingCount, confirmed: confirmedCount, cancelled: cancelledCount,
      occupancy, avgDaily, totalCustomers, approvedReviews,
    };
  }

  /* ════════════════════════════════════════════════════════
     2. GROWTH STATS — KPI period comparisons
     ════════════════════════════════════════════════════════ */
  async function getGrowthStats() {
    const cached = _cGet('growth');
    if (cached) return cached;
    if (!_sb) return null;

    // Single shared fetch — covers all six period counts below
    const data = await _getBookingsRaw();

    const today         = _todayISO();
    const yesterday     = _yesterdayISO();
    const weekStart     = _weekStartISO();
    const lastWeekStart = _lastWeekStartISO();
    const monthStart    = _monthStartISO();
    const lastMonthStart= _lastMonthStartISO();

    // replaces: COUNT bookings WHERE move_date = today
    const todayN     = data.filter(r => r.move_date === today).length;
    // replaces: COUNT bookings WHERE move_date = yesterday
    const yestN      = data.filter(r => r.move_date === yesterday).length;
    // replaces: COUNT bookings WHERE move_date >= weekStart
    const weekN      = data.filter(r => r.move_date >= weekStart).length;
    // replaces: COUNT bookings WHERE move_date >= lastWeekStart AND move_date < weekStart
    const lastWeekN  = data.filter(r => r.move_date >= lastWeekStart && r.move_date < weekStart).length;
    // replaces: COUNT bookings WHERE move_date >= monthStart
    const monthN     = data.filter(r => r.move_date >= monthStart).length;
    // replaces: COUNT bookings WHERE move_date >= lastMonthStart AND move_date < monthStart
    const lastMonthN = data.filter(r => r.move_date >= lastMonthStart && r.move_date < monthStart).length;

    const result = {
      today: { val: todayN, prev: yestN,     pct: _pct(todayN, yestN),     label: '昨日比' },
      week:  { val: weekN,  prev: lastWeekN,  pct: _pct(weekN, lastWeekN),  label: '先週比' },
      month: { val: monthN, prev: lastMonthN, pct: _pct(monthN, lastMonthN),label: '先月比' },
    };

    _cSet('growth', result, _TTL_KPI);
    return result;
  }

  /* ════════════════════════════════════════════════════════
     3. REVENUE ANALYTICS
     ════════════════════════════════════════════════════════ */
  async function getRevenueStats() {
    const cached = _cGet('revenue');
    if (cached) return cached;
    if (!_sb) return null;

    const data = await _getBookingsRaw();
    if (!data.length && !_cGet('raw_bk')) return null; // error during fetch

    const prices     = window.Adapter ? window.Adapter.getPrices() : {};
    const today      = _todayISO();
    const weekStart  = _weekStartISO();
    const monthStart = _monthStartISO();
    const dayOfMonth = new Date().getDate();
    const dIM        = _daysInMonth();

    const priceFor = svc => {
      const p = prices[svc];
      return typeof p === 'number' ? p : ((p && p.base) || 0);
    };

    const active = data.filter(r => r.status !== 'cancelled');

    const todayRev   = active.filter(r => r.move_date === today).reduce((s, r) => s + priceFor(r.service_type), 0);
    const weeklyRev  = active.filter(r => r.move_date >= weekStart).reduce((s, r) => s + priceFor(r.service_type), 0);
    const monthlyRev = active.filter(r => r.move_date >= monthStart).reduce((s, r) => s + priceFor(r.service_type), 0);
    const totalRev   = active.reduce((s, r) => s + priceFor(r.service_type), 0);
    const avgBkValue = active.length > 0 ? Math.round(totalRev / active.length) : 0;
    const projected  = dayOfMonth > 0 ? Math.round((monthlyRev / dayOfMonth) * dIM) : 0;

    const result = {
      todayRevenue:            todayRev,
      weeklyRevenue:           weeklyRev,
      monthlyRevenue:          monthlyRev,
      totalRevenue:            totalRev,
      averageBookingValue:     avgBkValue,
      projectedMonthlyRevenue: projected,
    };
    _cSet('revenue', result, _TTL_KPI);
    return result;
  }

  /* ════════════════════════════════════════════════════════
     4. BOOKING TREND — daily counts for N-day window
     ════════════════════════════════════════════════════════ */
  async function getTrendData(days) {
    const key = 'trend_' + days;
    const cached = _cGet(key);
    if (cached) return cached;
    if (!_sb) return null;

    const from = _nDaysAgoISO(days - 1);
    const data = await _getBookingsRaw();

    // Filter to window in JS — no extra Supabase round-trip
    const inWindow = data.filter(r => r.move_date >= from);

    const trend = [];
    for (let i = days - 1; i >= 0; i--) {
      const d   = new Date(); d.setDate(d.getDate() - i);
      const iso = _iso(d);
      trend.push({ date: iso, count: inWindow.filter(r => r.move_date === iso).length });
    }

    const total  = trend.reduce((s, r) => s + r.count, 0);
    const avgDay = trend.length > 0 ? Math.round((total / trend.length) * 10) / 10 : 0;
    const first  = trend.length > 1 ? trend[0].count : 0;
    const last   = trend.length > 1 ? trend[trend.length - 1].count : 0;
    const growth = _pct(last, first);

    const result = { days, trend, total, avgDay, growth };
    _cSet(key, result, _TTL_KPI);
    return result;
  }

  /* ════════════════════════════════════════════════════════
     5. SERVICE POPULARITY
     ════════════════════════════════════════════════════════ */
  async function getServicePopularity(from, to) {
    const f   = from || _nDaysAgoISO(30);
    const t   = to   || _todayISO();
    const key = `svp_${f}_${t}`;
    const cached = _cGet(key);
    if (cached) return cached;
    if (!_sb) return [];

    const data = await _getBookingsRaw();

    const counts = {};
    data
      .filter(r => r.move_date >= f && r.move_date <= t && r.status !== 'cancelled')
      .forEach(r => {
        const s = r.service_type || 'その他';
        counts[s] = (counts[s] || 0) + 1;
      });
    const total = Object.values(counts).reduce((s, n) => s + n, 0);

    const result = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([service, count]) => ({
        service,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      }));

    _cSet(key, result, _TTL_KPI);
    return result;
  }

  /* ════════════════════════════════════════════════════════
     6. CUSTOMER ANALYTICS
     ════════════════════════════════════════════════════════ */
  async function getCustomerStats() {
    const cached = _cGet('customers');
    if (cached) return cached;
    if (!_sb) return null;

    const today      = _todayISO();
    const monthStart = _monthStartISO();

    // Raw cache is already ordered by created_at DESC
    const data = await _getBookingsRaw();

    const byEmail = {};
    data.forEach(b => {
      const key = (b.email || '').trim().toLowerCase() || ('__' + (b.customer_name || ''));
      if (!byEmail[key]) byEmail[key] = { email: b.email, name: b.customer_name, bookings: 0, firstAt: b.created_at };
      byEmail[key].bookings++;
      if ((b.created_at || '') < (byEmail[key].firstAt || '')) byEmail[key].firstAt = b.created_at;
    });

    const customers       = Object.values(byEmail);
    const totalCustomers  = customers.length;
    const returning       = customers.filter(c => c.bookings > 1).length;
    const newToday        = customers.filter(c => (c.firstAt || '').slice(0, 10) === today).length;
    const newThisMonth    = customers.filter(c => (c.firstAt || '').slice(0, 10) >= monthStart).length;
    const retentionRate   = totalCustomers > 0 ? Math.round((returning / totalCustomers) * 100) : 0;

    const topCustomers = [...customers]
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 5)
      .map(c => ({ name: c.name, email: c.email, bookings: c.bookings, firstAt: c.firstAt }));

    const recentCustomers = [...customers]
      .sort((a, b) => ((b.firstAt || '') > (a.firstAt || '') ? 1 : -1))
      .slice(0, 5)
      .map(c => ({ name: c.name, email: c.email, bookings: c.bookings, firstAt: c.firstAt }));

    const result = {
      totalCustomers, newToday, newThisMonth,
      returningCustomers: returning, retentionRate,
      topCustomers, recentCustomers,
    };
    _cSet('customers', result, _TTL_KPI);
    return result;
  }

  /* ════════════════════════════════════════════════════════
     7. OPERATIONAL ANALYTICS — calendar utilisation
     ════════════════════════════════════════════════════════ */
  async function getOperationalStats() {
    const cached = _cGet('operational');
    if (cached) return cached;
    if (!_sb) return null;

    const monthStart = _monthStartISO();
    const monthEnd   = _monthEndISO();
    const dIM        = _daysInMonth();

    const [avail, limited, booked, totalBkMonth] = await Promise.all([
      _count('calendar_availability', [['gte','date',monthStart],['lte','date',monthEnd],['eq','status','available']]),
      _count('calendar_availability', [['gte','date',monthStart],['lte','date',monthEnd],['eq','status','limited']]),
      _count('calendar_availability', [['gte','date',monthStart],['lte','date',monthEnd],['eq','status','full']]),
      _count('bookings', [['gte','move_date',monthStart],['lte','move_date',monthEnd]]),
    ]);

    const utilisationRate = dIM > 0 ? Math.round((booked / dIM) * 100) : 0;

    const result = {
      availableDays: avail, limitedDays: limited, bookedDays: booked,
      utilisationRate, daysInMonth: dIM, totalBookingsMonth: totalBkMonth,
    };
    _cSet('operational', result, _TTL_KPI);
    return result;
  }

  /* ════════════════════════════════════════════════════════
     8. RECENT ACTIVITY FEED — live from Supabase
     ════════════════════════════════════════════════════════ */
  async function getRecentActivity(limit) {
    const cached = _cGet('activity');
    if (cached) return cached;
    if (!_sb) return [];

    const n = limit || 10;

    // Bookings leg: use raw cache (already ordered by created_at DESC) — no extra fetch
    const rawBk = await _getBookingsRaw();
    const revRes = await _sb
      .from('reviews')
      .select('reference_id,customer_name,rating,approved,created_at')
      .order('created_at', { ascending: false }).limit(5);

    const items = [];

    rawBk.slice(0, n).forEach(b => items.push({
      type:   'booking',
      id:     b.reference_id,
      name:   b.customer_name || '—',
      action: '予約追加',
      detail: b.service_type || '',
      status: b.status,
      ts:     b.created_at,
    }));

    ((revRes && revRes.data) || []).forEach(r => items.push({
      type:   'review',
      id:     r.reference_id,
      name:   r.customer_name || '—',
      action: r.approved ? 'レビュー承認' : 'レビュー受信',
      detail: '★'.repeat(Math.min(r.rating || 5, 5)),
      status: r.approved ? 'approved' : 'pending',
      ts:     r.created_at,
    }));

    items.sort((a, b) => ((b.ts || '') > (a.ts || '') ? 1 : -1));
    const result = items.slice(0, n);
    _cSet('activity', result, _TTL_ACT);
    return result;
  }

  /* ════════════════════════════════════════════════════════
     9. ANALYTICS DATA  (existing, preserved)
     ════════════════════════════════════════════════════════ */
  const _STATUS_LOCAL = { pending:'新規', confirmed:'確定', completed:'完了', cancelled:'キャンセル' };

  async function getAnalyticsData(from, to) {
    if (!_sb) return null;
    const { data, error } = await _sb
      .from('bookings')
      .select('move_date,service_type,status')
      .gte('move_date', from)
      .lte('move_date', to);
    if (error) { console.warn('[StatisticsService] getAnalyticsData error:', error.message); return null; }
    return (data || []).map(r => ({
      date:    r.move_date    || '',
      service: r.service_type || '',
      status:  _STATUS_LOCAL[r.status] || r.status || '新規',
    }));
  }

  /* ════════════════════════════════════════════════════════
     INTERNAL: dispatch + refresh
     ════════════════════════════════════════════════════════ */
  function _dispatch(stats) {
    document.dispatchEvent(new CustomEvent('dashboard:stats-updated', { detail: stats }));
  }

  async function _refresh() {
    const stats = await getDashboardStats();
    if (stats) _dispatch(stats);
  }

  /* ════════════════════════════════════════════════════════
     REALTIME SUBSCRIPTIONS
     bookings + calendar_availability + reviews
     ════════════════════════════════════════════════════════ */
  let _bookingsChannel  = null;
  let _availChannel     = null;
  let _reviewsChannel   = null;

  function initializeRealtime() {
    if (!_sb) return;

    if (!_bookingsChannel) {
      _bookingsChannel = _sb.channel('stats-bookings')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, () => { _invalidateKPI(); _invalidateActivity(); _refresh(); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, () => { _invalidateKPI(); _invalidateActivity(); _refresh(); })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bookings' }, () => { _invalidateKPI(); _invalidateActivity(); _refresh(); })
        .subscribe();
    }

    if (!_availChannel) {
      _availChannel = _sb.channel('stats-availability')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calendar_availability' }, () => { _cDel('operational'); _refresh(); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calendar_availability' }, () => { _cDel('operational'); _refresh(); })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'calendar_availability' }, () => { _cDel('operational'); _refresh(); })
        .subscribe();
    }

    if (!_reviewsChannel) {
      _reviewsChannel = _sb.channel('stats-reviews')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, () => { _invalidateActivity(); _refresh(); })
        .subscribe();
    }
  }

  function destroyRealtime() {
    if (!_sb) return;
    if (_bookingsChannel) { _sb.removeChannel(_bookingsChannel); _bookingsChannel = null; }
    if (_availChannel)    { _sb.removeChannel(_availChannel);    _availChannel    = null; }
    if (_reviewsChannel)  { _sb.removeChannel(_reviewsChannel);  _reviewsChannel  = null; }
  }

  /* ── Cache invalidation via domain events ──────────────── */
  document.addEventListener('booking:created',   () => { _invalidateKPI(); _invalidateActivity(); });
  document.addEventListener('booking:updated',   () => { _invalidateKPI(); _invalidateActivity(); });
  document.addEventListener('booking:cancelled', () => { _invalidateKPI(); _invalidateActivity(); });
  document.addEventListener('calendar:updated',  () => { _cDel('operational'); });

  /* ════════════════════════════════════════════════════════
     PUBLIC API
     ════════════════════════════════════════════════════════ */
  window.StatisticsService = {
    /* Original */
    getDashboardStats,
    getTodayBookings,
    getWeeklyBookings,
    getMonthlyBookings,
    getOccupancyRate,
    getAnalyticsData,
    initializeRealtime,
    destroyRealtime,
    supabaseReady: !!_sb,

    /* Phase 13 BI */
    getGrowthStats,
    getRevenueStats,
    getTrendData,
    getServicePopularity,
    getCustomerStats,
    getOperationalStats,
    getRecentActivity,

    /* Cache control */
    invalidateKPI:      _invalidateKPI,
    invalidateActivity: _invalidateActivity,
  };
})();
