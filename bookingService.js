// Load order: supabase UMD → js/config/env.js → js/services/supabaseClient.js → bookingService.js

// ── Status maps ───────────────────────────────────────────────────────────────

const _BK_TO_SB = {
  '新規': 'pending', '確認中': 'pending',
  '確定': 'confirmed', '完了': 'completed', 'キャンセル': 'cancelled',
};

const _BK_TO_LOCAL = {
  pending: '新規', confirmed: '確定', completed: '完了', cancelled: 'キャンセル',
};

// ── Field mappers ─────────────────────────────────────────────────────────────

function _bookingToRow(b) {
  return {
    reference_id:  b.id,
    customer_name: b.name      || '',
    email:         b.email     || null,
    phone:         b.phone     || null,
    move_date:     b.date      || null,
    move_from:     b.fromAddr  || null,
    move_to:       b.toAddr    || null,
    service_type:  b.service   || null,
    status:        _BK_TO_SB[b.status] || 'pending',
    notes:         b.notes     || null,
    time_slot:     b.time      || null,
    created_at:    b.createdAt || new Date().toISOString(),
  };
}

function _rowToBooking(r) {
  return {
    id:        r.reference_id || r.id,
    name:      r.customer_name || '',
    email:     r.email         || '',
    phone:     r.phone         || '',
    date:      r.move_date     || '',
    fromAddr:  r.move_from     || '',
    toAddr:    r.move_to       || '',
    service:   r.service_type  || '',
    status:    _BK_TO_LOCAL[r.status] || '新規',
    notes:     r.notes         || '',
    time:      r.time_slot     || '',
    createdAt: r.created_at    || new Date().toISOString(),
  };
}

// ── ID generation ─────────────────────────────────────────────────────────────

function generateBookingId() {
  const d   = new Date();
  const pad = n => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `HM-${date}-${rand}`;
}

// ── Immutable fields — never overwritten by updateBooking ─────────────────────

const IMMUTABLE_FIELDS = new Set(['id', 'createdAt']);

// ── Service ───────────────────────────────────────────────────────────────────

const BookingService = (() => {
  'use strict';

  function _sb() { return window.SupabaseClient || null; }

  async function getBookings() {
    const sb = _sb();
    if (!sb) { console.warn('[BookingService] Supabase not available'); return []; }
    const { data, error } = await sb
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('[BookingService] getBookings:', error.message); return []; }
    return (data || []).map(_rowToBooking);
  }

  // No-op: full-array persistence is not applicable to Supabase.
  async function saveBookings() {}

  async function createBooking(fields) {
    const bookingId = generateBookingId();
    const move_date = fields.date   || '';
    const status    = fields.status || '新規';

    const booking = {
      id:        bookingId,
      name:      fields.name     || '',
      email:     fields.email    || '',
      phone:     fields.phone    || '',
      service:   fields.service  || '単身引越し',
      status,
      date:      move_date,
      time:      fields.time     || '',
      fromAddr:  fields.fromAddr || '',
      toAddr:    fields.toAddr   || '',
      notes:     fields.notes    || '',
      createdAt: new Date().toISOString(),
    };

    const sb = _sb();
    if (sb) {
      const { error } = await sb.from('bookings').insert(_bookingToRow(booking));
      if (error) {
        console.error('[BookingService] createBooking:', error.message);
        throw new Error(error.message);
      }
    }

    document.dispatchEvent(new CustomEvent('booking:created', {
      detail: { bookingId, move_date, status },
    }));

    return booking;
  }

  async function getBookingById(id) {
    const sb = _sb();
    if (!sb) { console.warn('[BookingService] Supabase not available'); return null; }
    const { data, error } = await sb
      .from('bookings')
      .select('*')
      .eq('reference_id', id)
      .maybeSingle();
    if (error) { console.error('[BookingService] getBookingById:', error.message); return null; }
    return data ? _rowToBooking(data) : null;
  }

  // Returns the updated booking, or null if not found.
  async function updateBooking(id, patch) {
    const safePatch = Object.fromEntries(
      Object.entries(patch).filter(([k]) => !IMMUTABLE_FIELDS.has(k))
    );

    const current = await getBookingById(id);
    if (!current) return null;

    const updated   = { ...current, ...safePatch };
    const updatedAt = new Date().toISOString();

    const sb = _sb();
    if (sb) {
      // eslint-disable-next-line no-unused-vars
      const { created_at, ...fields } = _bookingToRow(updated);
      const row = { ...fields, updated_at: updatedAt };
      const { error } = await sb.from('bookings').update(row).eq('reference_id', id);
      if (error) {
        console.error('[BookingService] updateBooking:', error.message);
        throw new Error(error.message);
      }
    }

    document.dispatchEvent(new CustomEvent('booking:updated', {
      detail: { bookingId: id, move_date: updated.date, status: updated.status },
    }));

    return { ...updated, updatedAt };
  }

  // Returns the cancelled booking, or null if not found.
  async function cancelBooking(id) {
    const current = await getBookingById(id);
    if (!current) return null;

    const cancelled = { ...current, status: 'キャンセル' };
    const updatedAt = new Date().toISOString();

    const sb = _sb();
    if (sb) {
      const { error } = await sb
        .from('bookings')
        .update({ status: 'cancelled', updated_at: updatedAt })
        .eq('reference_id', id);
      if (error) {
        console.error('[BookingService] cancelBooking:', error.message);
        throw new Error(error.message);
      }
    }

    document.dispatchEvent(new CustomEvent('booking:cancelled', {
      detail: { bookingId: id, move_date: cancelled.date, status: 'キャンセル' },
    }));

    return cancelled;
  }

  // Realtime subscription — returns an unsubscribe function.
  function subscribe(callback) {
    const sb = _sb();
    if (!sb) return () => {};
    const channel = sb
      .channel('bookings:changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, payload => {
        const booking = payload.new && Object.keys(payload.new).length
          ? _rowToBooking(payload.new)
          : null;
        callback(payload.eventType, booking, payload.old || null);
      })
      .subscribe();
    return () => sb.removeChannel(channel);
  }

  // No-op: adapter pattern replaced by direct Supabase calls.
  function setAdapter() {}

  return { getBookings, saveBookings, createBooking, getBookingById, updateBooking, cancelBooking, subscribe, setAdapter };
})();
