// api/bookingStatus.ts — calls the unified booking-status.php endpoint.
//
// Server: POST {apiBase}/booking-status.php  { booking_id, status, note? }
//   headers: X-API-KEY + X-ADMIN-TOKEN (admin action)
//   status ∈ 'Accepted' | 'Cancelled' | 'Needs_Revision' | 'Pending'
//   response: { ok, booking_id, status:'confirmed'|'cancelled'|'needs_revision'|'pending', notified }

export type StatusAuth = { apiBase: string; apiKey: string; adminToken: string };

export type BookingAction = 'Accepted' | 'Cancelled' | 'Needs_Revision' | 'Pending';

// Canonical status stored/returned by the backend.
export type BookingStatus = 'pending' | 'confirmed' | 'needs_revision' | 'cancelled' | 'checking' | 'completed' | 'rejected';

export type BookingStatusResponse = {
  ok: boolean;
  booking_id: string;
  status: BookingStatus;
  notified: boolean;
  error?: string;
};

// UI action → the label booking-status.php accepts.
export const ACTION_LABEL: Record<'accept' | 'cancel' | 'request_changes', BookingAction> = {
  accept: 'Accepted',
  cancel: 'Cancelled',
  request_changes: 'Needs_Revision',
};

export async function setBookingStatus(
  auth: StatusAuth,
  input: { bookingId: string; status: BookingAction; note?: string }
): Promise<BookingStatusResponse> {
  const res = await fetch(`${auth.apiBase.replace(/\/+$/, '')}/booking-status.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': auth.apiKey,
      'X-ADMIN-TOKEN': auth.adminToken,
    },
    body: JSON.stringify({ booking_id: input.bookingId, status: input.status, note: input.note ?? '' }),
  });
  const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as BookingStatusResponse;
  if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
