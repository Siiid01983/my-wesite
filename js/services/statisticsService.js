/* ════════════════════════════════════════════════════════
   STATISTICS SERVICE
   ════════════════════════════════════════════════════════
   Fetches dashboard metrics directly from Supabase using
   aggregated COUNT() queries — never loads full row sets.

   Publishes: document 'dashboard:stats-updated' { detail: stats }

   Load order: Supabase UMD → env.js → this file
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const _sb = (function () {
    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('<') || key.includes('<')) return null;
    if (!window.supabase) { console.warn('[StatisticsService] Supabase UMD not loaded'); return null; }
    try { return window.supabase.createClient(url, key); }
    catch (e) { console.warn('[StatisticsService] createClient failed:', e); return null; }
  })();

  /* ── Date helpers ─────────────────────────────────────── */
  const _pad = n => String(n).padStart(2, '0');

  function _iso(d) {
    return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
  }

  function _todayISO() {
    return _iso(new Date());
  }

  function _weekStartISO() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return _iso(d);
  }

  function _monthStartISO() {
    const d = new Date();
    return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-01`;
  }

  function _monthEndISO() {
    const d = new Date();
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return _iso(last);
  }

  function _daysInMonth() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }

  function _thirtyDaysAgoISO() {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return _iso(d);
  }

  /* ── Aggregated query helpers ─────────────────────────── */
  async function _count(table, filters) {
    if (!_sb) return 0;
    let q = _sb.from(table).select('*', { count: 'exact', head: true });
    filters.forEach(([method, ...args]) => { q = q[method](...args); });
    const { count, error } = await q;
    if (error) { console.warn(`[StatisticsService] ${table} count error:`, error.message); return 0; }
    return count || 0;
  }

  /* ── Public metric functions ──────────────────────────── */
  async function getTodayBookings() {
    return _count('bookings', [['eq', 'move_date', _todayISO()]]);
  }

  async function getWeeklyBookings() {
    return _count('bookings', [['gte', 'move_date', _weekStartISO()]]);
  }

  async function getMonthlyBookings() {
    return _count('bookings', [['gte', 'move_date', _monthStartISO()]]);
  }

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

    const [today, weekly, monthly, pending, confirmed, cancelled, occupancy, last30] =
      await Promise.all([
        getTodayBookings(),
        getWeeklyBookings(),
        getMonthlyBookings(),
        _count('bookings', [['eq', 'status', 'pending']]),
        _count('bookings', [['eq', 'status', 'confirmed']]),
        _count('bookings', [['eq', 'status', 'cancelled']]),
        getOccupancyRate(),
        _count('bookings', [['gte', 'move_date', _thirtyDaysAgoISO()]]),
      ]);

    const avgDaily = Math.round((last30 / 30) * 10) / 10;

    return { today, weekly, monthly, pending, confirmed, cancelled, occupancy, avgDaily };
  }

  /* ── Internal: fetch and dispatch ────────────────────── */
  function _dispatch(stats) {
    document.dispatchEvent(new CustomEvent('dashboard:stats-updated', { detail: stats }));
  }

  async function _refresh() {
    const stats = await getDashboardStats();
    if (stats) _dispatch(stats);
  }

  /* ── Realtime channels ────────────────────────────────── */
  let _bookingsChannel = null;
  let _availChannel    = null;

  function initializeRealtime() {
    if (!_sb) return;

    if (!_bookingsChannel) {
      _bookingsChannel = _sb
        .channel('stats-bookings')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, _refresh)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, _refresh)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'bookings' }, _refresh)
        .subscribe();
    }

    if (!_availChannel) {
      _availChannel = _sb
        .channel('stats-availability')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calendar_availability' }, _refresh)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calendar_availability' }, _refresh)
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'calendar_availability' }, _refresh)
        .subscribe();
    }
  }

  function destroyRealtime() {
    if (!_sb) return;
    if (_bookingsChannel) { _sb.removeChannel(_bookingsChannel); _bookingsChannel = null; }
    if (_availChannel)    { _sb.removeChannel(_availChannel);    _availChannel    = null; }
  }

  /* ── Analytics: lean projection for period ───────────── */
  const _STATUS_LOCAL = { pending: '新規', confirmed: '確定', completed: '完了', cancelled: 'キャンセル' };

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

  window.StatisticsService = {
    getDashboardStats,
    getTodayBookings,
    getWeeklyBookings,
    getMonthlyBookings,
    getOccupancyRate,
    getAnalyticsData,
    initializeRealtime,
    destroyRealtime,
    supabaseReady: !!_sb,
  };
})();
