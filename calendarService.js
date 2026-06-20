// ── Storage adapter ────────────────────────────────────────────────────────────
// Swap _store for a APIAdapter that implements the same interface.
// Promote all methods to async when migrating.
//
// Storage keys (shared with admin.html Adapter):
//   hm_counts      — bookings_count per date; sole source of truth for auto-status
//   hm_capacity    — { max, limited } thresholds
//   hm_admin_avail — manual admin overrides (more restrictive than counts wins)
//   hm_booked      — public-facing booked-date array read by index.html

let _store = (() => {
  function ls(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* no-op */ }
  }
  return {
    getCounts:     ()  => ls('hm_counts',      {}),
    saveCounts:    (v) => save('hm_counts',      v),
    getCapacity:   ()  => ls('hm_capacity',    { max: 5, limited: 3 }),
    saveCapacity:  (v) => save('hm_capacity',    v),
    getOverrides:  ()  => ls('hm_admin_avail', {}),
    saveOverrides: (v) => save('hm_admin_avail', v),
    getBooked:     ()  => ls('hm_booked',      []),
    saveBooked:    (v) => save('hm_booked',      v),
  };
})();

// ── Service ────────────────────────────────────────────────────────────────────

const CalendarService = (() => {

  // ── Private helpers ──────────────────────────────────────────────────────────

  function _computeStatus(date) {
    const { max, limited } = _store.getCapacity();
    const count = _store.getCounts()[date] || 0;
    if (count >= max)     return 'booked';
    if (count >= limited) return 'limited';
    return 'available';
  }

  function _adjustCount(date, delta) {
    if (!date) return;
    const counts = _store.getCounts();
    counts[date] = Math.max(0, (counts[date] || 0) + delta);
    if (counts[date] === 0) delete counts[date];
    _store.saveCounts(counts);
  }

  // Keeps hm_booked (public calendar) in sync with the effective status.
  function _syncPublicCalendar(date, status) {
    const booked = new Set(_store.getBooked());
    if (status === 'booked') booked.add(date); else booked.delete(date);
    _store.saveBooked([...booked]);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  // Returns the merged availability map { [YYYY-MM-DD]: 'available'|'limited'|'booked' }.
  // Count-based status and manual overrides are reconciled; more restrictive wins.
  function getAvailability() {
    const overrides = _store.getOverrides();
    const counts    = _store.getCounts();
    const cap       = _store.getCapacity();
    const rank      = { available: 0, limited: 1, booked: 2 };
    const allDates  = new Set([...Object.keys(overrides), ...Object.keys(counts)]);
    const result    = {};

    allDates.forEach(date => {
      const count       = counts[date] || 0;
      const countStatus = count >= cap.max ? 'booked' : count >= cap.limited ? 'limited' : null;
      const manual      = overrides[date] || null;
      // Manual override wins only if it is equally or more restrictive than the count-based status.
      const effective   = (!countStatus || (manual && rank[manual] >= rank[countStatus]))
        ? manual : countStatus;
      if (effective) result[date] = effective;
    });

    return result;
  }

  // Applies a computed status to a date: syncs the public calendar and
  // broadcasts calendar:updated. Does NOT write to hm_admin_avail so
  // manual admin overrides are never clobbered by booking-driven calls.
  function updateAvailability(date, status) {
    _syncPublicCalendar(date, status);
    document.dispatchEvent(new CustomEvent('calendar:updated', {
      detail: { date, status, availability: getAvailability() },
    }));
  }

  // Saves an explicit admin override and re-broadcasts via updateAvailability.
  function setManualOverride(date, status) {
    const overrides = _store.getOverrides();
    if (status === 'available') delete overrides[date]; else overrides[date] = status;
    _store.saveOverrides(overrides);
    // Effective status after merging override with current counts.
    updateAvailability(date, getAvailability()[date] || 'available');
  }

  // Updates capacity thresholds and re-syncs the public calendar for all
  // dates that have bookings_count entries.
  function setCapacity(max, limited) {
    _store.saveCapacity({ max, limited });
    const counts = _store.getCounts();
    Object.keys(counts).forEach(date => _syncPublicCalendar(date, _computeStatus(date)));
    document.dispatchEvent(new CustomEvent('calendar:capacity-changed', {
      detail: { max, limited, availability: getAvailability() },
    }));
  }

  // Swap the storage adapter at runtime (e.g., for API).
  function setAdapter(adapter) {
    _store = adapter;
  }

  // ── BookingService integration ────────────────────────────────────────────────

  document.addEventListener('booking:created', ({ detail }) => {
    const { move_date } = detail;
    if (!move_date) return;
    _adjustCount(move_date, 1);
    updateAvailability(move_date, _computeStatus(move_date));
  });

  document.addEventListener('booking:cancelled', ({ detail }) => {
    const { move_date } = detail;
    if (!move_date) return;
    _adjustCount(move_date, -1);
    updateAvailability(move_date, _computeStatus(move_date));
  });

  return { getAvailability, updateAvailability, setManualOverride, setCapacity, setAdapter };
})();
