// Load order: supabase UMD → js/config/env.js → js/services/supabaseClient.js → bookingService.js

// ── Status maps ───────────────────────────────────────────────────────────────

const _BK_TO_SB = {
  '新規': 'pending', '確認中': 'checking',
  '確定': 'confirmed', '完了': 'completed', 'キャンセル': 'cancelled',
};

const _BK_TO_LOCAL = {
  pending: '新規', checking: '確認中', confirmed: '確定', completed: '完了', cancelled: 'キャンセル',
};

// ── Notes encoding — fields not in DB schema are packed into notes ────────────
// Format: {user notes}\n[HM_EXTRAS]\nref:…\nfrom:…\nto:…\nservice:…\ntime:…

const _HM_SEP = '\n[HM_EXTRAS]\n';

function _packNotes(b) {
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

function _unpackNotes(raw) {
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

function _parseItems(raw) {
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

// ── Field mappers ─────────────────────────────────────────────────────────────

function _bookingToRow(b) {
  return {
    customer_name:  b.name      || '',
    customer_email: b.email     || null,
    customer_phone: b.phone     || null,
    booking_date:   b.date      || null,
    service_id:     null,
    status:         _BK_TO_SB[b.status] || 'pending',
    notes:          _packNotes(b),
    created_at:     b.createdAt || new Date().toISOString(),
  };
}

function _rowToBooking(r) {
  const { userNotes, extra } = _unpackNotes(r.notes);
  const extraItems = extra.items ? extra.items.split('|').filter(Boolean) : null;
  const { items: parsedItems, workers: parsedWorkers, cleanNotes } = _parseItems(userNotes);
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
    status:    _BK_TO_LOCAL[r.status] || '新規',
    notes:     cleanNotes,
    items:     (Array.isArray(r.items) && r.items.length ? r.items : null)
               || extraItems
               || parsedItems,
    workers:   extra.workers || parsedWorkers,
    time:      extra.time    || '',
    createdAt: r.created_at  || new Date().toISOString(),
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
    // Numeric DB id — direct lookup
    if (/^\d+$/.test(String(id))) {
      const { data, error } = await sb.from('bookings').select('*').eq('id', id).maybeSingle();
      if (error) { console.error('[BookingService] getBookingById:', error.message); return null; }
      return data ? _rowToBooking(data) : null;
    }
    // Reference ID (HM-xxx) stored in notes
    const { data, error } = await sb
      .from('bookings')
      .select('*')
      .ilike('notes', `%ref:${id}%`)
      .maybeSingle();
    if (error) { console.error('[BookingService] getBookingById:', error.message); return null; }
    return data ? _rowToBooking(data) : null;
  }

  // Bookings belonging to one customer email, newest-first. Used by the Phase 6A
  // authenticated portal: a customer's accessible bookings are resolved from the
  // email Supabase Auth verified, NOT from a typed reference. Scoped server-side
  // (.eq) so the client never pulls unrelated rows. Returns [] on error/no input.
  async function getBookingsByEmail(email) {
    const sb = _sb();
    const norm = (email || '').trim().toLowerCase();
    if (!sb || !norm) return [];
    const { data, error } = await sb
      .from('bookings')
      .select('*')
      .ilike('customer_email', norm)
      .order('created_at', { ascending: false });
    if (error) { console.error('[BookingService] getBookingsByEmail:', error.message); return []; }
    return (data || []).map(_rowToBooking);
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
      const { created_at, ...fields } = _bookingToRow(updated);
      const row = { ...fields, updated_at: updatedAt };
      const { error } = await sb.from('bookings').update(row).eq('id', current._dbId);
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
        .eq('id', current._dbId);
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

  // Customer-facing estimate approval (Phase 5F). Transitions a booking that is
  // awaiting approval (新規 / 確認中 — "Quote Sent") to 確定 ("Quote Approved").
  // Targeted single-column update — mirrors cancelBooking — so the row schema and
  // every other field are preserved (no new status value, no CRM disruption).
  // Returns { ok, from, to, booking } or { ok:false, reason }.
  const _APPROVABLE = new Set(['新規', '確認中']);
  async function approveEstimate(id) {
    const current = await getBookingById(id);
    if (!current) return { ok: false, reason: 'not-found' };
    if (!_APPROVABLE.has(current.status)) {
      return { ok: false, reason: 'not-approvable', from: current.status };
    }

    const updatedAt = new Date().toISOString();
    const sb = _sb();
    if (sb) {
      const { error } = await sb
        .from('bookings')
        .update({ status: 'confirmed', updated_at: updatedAt })
        .eq('id', current._dbId);
      if (error) {
        console.error('[BookingService] approveEstimate:', error.message);
        throw new Error(error.message);
      }
    }

    const approved = { ...current, status: '確定', updatedAt };
    document.dispatchEvent(new CustomEvent('booking:approved', {
      detail: { bookingId: id, move_date: approved.date, status: '確定', from: current.status },
    }));

    return { ok: true, from: current.status, to: '確定', booking: approved };
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

  return { getBookings, saveBookings, createBooking, getBookingById, getBookingsByEmail, updateBooking, cancelBooking, approveEstimate, subscribe, setAdapter };
})();
