// ── Storage adapter ───────────────────────────────────────────────────────────
// To migrate to Supabase, replace _adapter with a SupabaseAdapter that satisfies:
//   { load(): Booking[], persist(bookings: Booking[]): void }
// Then promote every BookingService method to async and await adapter calls.

let _adapter = (() => {
  const KEY = 'hm_admin_bookings';
  return {
    load()        { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return [];  } },
    persist(data) { try { localStorage.setItem(KEY, JSON.stringify(data));      } catch { /* no-op */ } },
  };
})();

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

  function getBookings() {
    return _adapter.load();
  }

  function saveBookings(bookings) {
    _adapter.persist(bookings);
  }

  function createBooking(fields) {
    const bookingId = generateBookingId();
    const move_date = fields.date   || '';
    const status    = fields.status || '新規';

    const booking = {
      id:        bookingId,
      name:      fields.name     || '',
      email:     fields.email    || '',
      service:   fields.service  || '単身引越し',
      status,
      date:      move_date,
      time:      fields.time     || '',
      fromAddr:  fields.fromAddr || '',
      toAddr:    fields.toAddr   || '',
      notes:     fields.notes    || '',
      createdAt: new Date().toISOString(),
    };

    const all = getBookings();
    all.unshift(booking);
    saveBookings(all);

    document.dispatchEvent(new CustomEvent('booking:created', {
      detail: { bookingId, move_date, status },
    }));

    return booking;
  }

  function getBookingById(id) {
    return getBookings().find(b => b.id === id) || null;
  }

  // Returns the updated booking, or null if not found.
  function updateBooking(id, patch) {
    const safePatch = Object.fromEntries(
      Object.entries(patch).filter(([k]) => !IMMUTABLE_FIELDS.has(k))
    );
    safePatch.updatedAt = new Date().toISOString();

    const all     = getBookings().map(b => b.id === id ? { ...b, ...safePatch } : b);
    const updated = all.find(b => b.id === id) || null;
    saveBookings(all);

    if (updated) {
      document.dispatchEvent(new CustomEvent('booking:updated', {
        detail: { bookingId: id, move_date: updated.date, status: updated.status },
      }));
    }

    return updated;
  }

  // Returns the cancelled booking, or null if not found.
  function cancelBooking(id) {
    const all = getBookings().map(b => b.id === id ? { ...b, status: 'キャンセル' } : b);
    const cancelled = all.find(b => b.id === id) || null;

    if (!cancelled) return null;

    saveBookings(all);

    document.dispatchEvent(new CustomEvent('booking:cancelled', {
      detail: { bookingId: id, move_date: cancelled.date, status: 'キャンセル' },
    }));

    return cancelled;
  }

  // Swap the adapter at runtime (e.g., replacing localStorage with Supabase).
  function setAdapter(adapter) {
    _adapter = adapter;
  }

  return { getBookings, saveBookings, createBooking, getBookingById, updateBooking, cancelBooking, setAdapter };
})();
