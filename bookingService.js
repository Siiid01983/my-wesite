// Load order: apiClient.js → js/config/env.js → js/services/dataClient.js → bookingService.js

// ── Status maps ───────────────────────────────────────────────────────────────

const _BK_TO_DB = {
  '新規': 'pending', '確認中': 'checking',
  '確定': 'confirmed', '完了': 'completed', 'キャンセル': 'cancelled',
};

const _BK_TO_LOCAL = {
  pending: '新規', checking: '確認中', confirmed: '確定', completed: '完了', cancelled: 'キャンセル',
};

// ── Service-location model ────────────────────────────────────────────────────
// Junk removal (disposal) & furniture assembly (assembly) collect a SINGLE
// service location (作業場所) instead of a current-address + destination pair.
// Kept in sync with the BA overlay's BA_SINGLE_LOC_IDS in index.html. The single
// location maps to the generic primary address field (fromAddr) so admin/CRM/
// invoices/inbox surface it exactly like any other booking address.
const SINGLE_LOCATION_SERVICES = new Set(['disposal', 'assembly']);
function _isSingleLocation(fields) {
  if (fields.locMode) return fields.locMode === 'single';
  if (fields.serviceId) return SINGLE_LOCATION_SERVICES.has(fields.serviceId);
  return /不用品|回収|処分|組立|分解|組み立て/.test(String(fields.service || ''));
}

// ── Notes encoding — fields not in DB schema are packed into notes ────────────
// Format: {user notes}\n[HM_EXTRAS]\nref:…\nfrom:…\nto:…\nservice:…\ntime:…

const _HM_SEP = '\n[HM_EXTRAS]\n';

function _packNotes(b) {
  const extras = [];
  if (b.id)       extras.push(`ref:${b.id}`);
  if (b.fromAddr) extras.push(`from:${b.fromAddr}`);
  if (b.toAddr)   extras.push(`to:${b.toAddr}`);
  if (b.service)  extras.push(`service:${b.service}`);
  if (b.locMode)  extras.push(`locmode:${b.locMode}`);
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
  const row = {
    customer_name:  b.name      || '',
    customer_email: b.email     || null,
    customer_phone: b.phone     || null,
    booking_date:   b.date      || null,
    service_id:     null,
    status:         _BK_TO_DB[b.status] || 'pending',
    notes:          _packNotes(b),
    created_at:     b.createdAt || new Date().toISOString(),
  };
  // CLIENT-REQUEST model: the customer's two preferred appointment datetimes.
  // Sent only when present; create-booking.php stores them (status stays pending)
  // ONLY when hourly is live, and strips them otherwise — so this is safe to send
  // regardless of server mode.
  if (b.preferredStart1) row.preferred_start_1 = b.preferredStart1;
  if (b.preferredStart2) row.preferred_start_2 = b.preferredStart2;
  return row;
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
    locMode:   extra.locmode || '',
    service:   r.service_id   || extra.service || '',
    status:    _BK_TO_LOCAL[r.status] || '新規',
    notes:     cleanNotes,
    items:     (Array.isArray(r.items) && r.items.length ? r.items : null)
               || extraItems
               || parsedItems,
    workers:   extra.workers || parsedWorkers,
    time:      extra.time    || '',
    createdAt: r.created_at  || new Date().toISOString(),
    // T5 — the two requested date/time-band options (existing columns; display only).
    preferred_start_1: r.preferred_start_1 || extra.pref1 || '',
    preferred_start_2: r.preferred_start_2 || extra.pref2 || '',
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

  function _api() { return window.api || null; }
  function _apiBase() { return (window.API_BASE || '').replace(/\/+$/, ''); }

  async function getBookings() {
    const sb = _api();
    if (!sb) { console.warn('[BookingService] API not available'); return []; }
    const { data, error } = await sb
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('[BookingService] getBookings:', error.message); return []; }
    return (data || []).map(_rowToBooking);
  }

  // No-op: full-array persistence is not applicable to API.
  async function saveBookings() {}

  async function createBooking(fields) {
    const bookingId = generateBookingId();
    const move_date = fields.date   || '';
    const status    = fields.status || '新規';

    // Service-aware address requirement (the app's booking-API gate): single-
    // location services need only the 作業場所 (mapped to fromAddr); moving jobs
    // require both current + destination. Guards all callers, not just the UI.
    const single = _isSingleLocation(fields);
    const fromA  = (fields.fromAddr || '').trim();
    const toA    = (fields.toAddr   || '').trim();
    if (!fromA)            throw new Error(single ? '作業場所を入力してください' : '現住所を入力してください');
    if (!single && !toA)   throw new Error('引越し先を入力してください');

    const booking = {
      id:        bookingId,
      name:      fields.name     || '',
      email:     fields.email    || '',
      phone:     fields.phone    || '',
      service:   fields.service  || '単身引越し',
      locMode:   single ? 'single' : 'dual',
      status,
      date:      move_date,
      time:      fields.time     || '',
      preferredStart1: fields.preferredStart1 || '',
      preferredStart2: fields.preferredStart2 || '',
      fromAddr:  fromA,
      toAddr:    single ? '' : toA,
      notes:     fields.notes    || '',
      createdAt: new Date().toISOString(),
    };

    const base = _apiBase();
    if (base) {
      const res = await fetch(base + '/create-booking.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': window.API_KEY || '' },
        body: JSON.stringify(_bookingToRow(booking)),
      });
      const out = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!out.ok) {
        console.error('[BookingService] createBooking:', out.error);
        throw new Error(out.error || 'create-booking failed');
      }
    }

    document.dispatchEvent(new CustomEvent('booking:created', {
      detail: { bookingId, move_date, status },
    }));

    return booking;
  }

  async function getBookingById(id) {
    const base = _apiBase();
    if (!base) { console.warn('[BookingService] API not available'); return null; }
    // UUID primary key → ?id=, otherwise treat as HM-xxx reference → ?ref=
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(id));
    const qs = isUuid ? ('id=' + encodeURIComponent(id)) : ('ref=' + encodeURIComponent(id));
    try {
      const res = await fetch(base + '/get-booking.php?' + qs, { headers: { 'X-API-KEY': window.API_KEY || '' } });
      const out = await res.json();
      if (!out.ok) { console.error('[BookingService] getBookingById:', out.error); return null; }
      return out.data ? _rowToBooking(out.data) : null;
    } catch (err) {
      console.error('[BookingService] getBookingById:', err.message);
      return null;
    }
  }

  // Bookings belonging to one customer email, newest-first. Used by the Phase 6A
  // authenticated portal: a customer's accessible bookings are resolved from the
  // email API Auth verified, NOT from a typed reference. Scoped server-side
  // (.eq) so the client never pulls unrelated rows. Returns [] on error/no input.
  async function getBookingsByEmail(email) {
    const base = _apiBase();
    const norm = (email || '').trim().toLowerCase();
    if (!base || !norm) return [];
    try {
      const res = await fetch(base + '/get-booking.php?email=' + encodeURIComponent(norm), { headers: { 'X-API-KEY': window.API_KEY || '' } });
      const out = await res.json();
      if (!out.ok) { console.error('[BookingService] getBookingsByEmail:', out.error); return []; }
      return (out.data || []).map(_rowToBooking);
    } catch (err) {
      console.error('[BookingService] getBookingsByEmail:', err.message);
      return [];
    }
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

    const sb = _api();
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

    const sb = _api();
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
    const sb = _api();
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
    const sb = _api();
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

  // No-op: adapter pattern replaced by direct API calls.
  function setAdapter() {}

  return { getBookings, saveBookings, createBooking, getBookingById, getBookingsByEmail, updateBooking, cancelBooking, approveEstimate, subscribe, setAdapter };
})();
