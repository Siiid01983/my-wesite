// hooks/useBookingActions.ts — optimistic booking status updates with rollback.
import { useCallback, useState } from 'react';
import { ACTION_LABEL, setBookingStatus, type BookingStatus, type StatusAuth } from '../api/bookingStatus';

export type ActionKey = 'accept' | 'cancel' | 'request_changes';

// UI action → the canonical status we optimistically show before the server replies.
const OPTIMISTIC: Record<ActionKey, BookingStatus> = {
  accept: 'confirmed',
  cancel: 'cancelled',
  request_changes: 'needs_revision',
};

export function useBookingActions(auth: StatusAuth, opts?: {
  onChanged?: (bookingId: string, status: BookingStatus) => void;
}) {
  // Local status overrides keyed by bookingId (drives immediate UI updates).
  const [statuses, setStatuses] = useState<Record<string, BookingStatus>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (
    bookingId: string,
    action: ActionKey,
    opts2?: { note?: string; prevStatus?: BookingStatus }
  ) => {
    setError(null);
    const optimistic = OPTIMISTIC[action];
    const prev = opts2?.prevStatus ?? statuses[bookingId];

    // 1) optimistic: reflect the change immediately + disable buttons.
    setStatuses((m) => ({ ...m, [bookingId]: optimistic }));
    setPending((m) => ({ ...m, [bookingId]: true }));

    try {
      const res = await setBookingStatus(auth, {
        bookingId,
        status: ACTION_LABEL[action],
        note: opts2?.note,
      });
      // 2) reconcile with the server's canonical status.
      setStatuses((m) => ({ ...m, [bookingId]: res.status }));
      opts?.onChanged?.(bookingId, res.status);
      return res;
    } catch (e: any) {
      // 3) rollback on failure.
      setStatuses((m) => ({ ...m, [bookingId]: (prev as BookingStatus) }));
      setError(e?.message || 'Update failed');
      throw e;
    } finally {
      setPending((m) => ({ ...m, [bookingId]: false }));
    }
  }, [auth, statuses, opts]);

  return {
    statusOf: (bookingId: string, fallback: BookingStatus) => statuses[bookingId] ?? fallback,
    isPending: (bookingId: string) => !!pending[bookingId],
    error,
    accept: (id: string, note?: string, prevStatus?: BookingStatus) => run(id, 'accept', { note, prevStatus }),
    cancel: (id: string, note?: string, prevStatus?: BookingStatus) => run(id, 'cancel', { note, prevStatus }),
    requestChanges: (id: string, note: string, prevStatus?: BookingStatus) => run(id, 'request_changes', { note, prevStatus }),
  };
}
