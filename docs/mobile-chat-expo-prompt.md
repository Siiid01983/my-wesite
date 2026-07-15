# Mobile Chat — Expo Implementation Handoff

> This repo is the **backend + website + admin panel**. The mobile app is a
> **separate Expo/React Native project** (not in this workspace). This doc is the
> API contract (verified against the live PHP) + a ready-to-run Claude Code prompt
> to implement the chat booking experience **in the Expo repo**.

---

## A. Verified API integration layer (what the mobile app calls)

Base: `API_BASE` (e.g. `https://hello-moving.com/hm-api`). All requests send
`X-API-KEY: <API_KEY>`. Admin-only actions also send `X-ADMIN-TOKEN: <token>`.

### 1. Image upload — `storage.php?action=upload` (multipart)
- **Method:** `POST`
- **Fields:** `bucket` (string), `path` (string), `file` (the binary file part)
- **Headers:** `X-API-KEY` only. **Do NOT set `Content-Type`** — the runtime must
  add the multipart boundary itself.
- **Response:** `{ "data": { "path": "<bucket-relative path>" }, "error": null }`
- **Read back:** bucket `media` is public via `?action=get&bucket=media&path=…`;
  other buckets need `?action=sign` → `{ data:{ signedUrl } }`.
- **Limits:** `upload_max_bytes` (15 MB default); MIME allowlist (jpeg/png/webp/gif/heic/pdf…).

### 2. Booking confirm / reject — `confirm-request.php` (admin)
- `POST { action:"confirm", booking_id, start_time, end_time }` → sets final
  `start_at/end_at` + `status:"confirmed"` (409 `slot_taken` on overlap).
- `POST { action:"reject", booking_id }` → `status:"rejected"`.
- Needs `X-ADMIN-TOKEN`. `booking_id` = the DB id (`_dbId`), not the `HM-…` ref.

### 3. Generic status update — `rest.php` (admin)
- `POST { table:"bookings", action:"update", values:{ status:"cancelled" }, filters:{ id:{ eq:"<dbId>" } } }`
  with `X-ADMIN-TOKEN`. Allowed status strings: `pending, checking, confirmed,
  completed, cancelled, rejected` (+ `needs_revision` once added — see gap below).

### 4. Booking object shape (from `apiAdapter.rowToBooking`)
```
{ _dbId, id (HM-ref), name, email, phone, date, fromAddr, toAddr, service,
  status (JP label), notes, items[], time, start_at, end_at,
  preferred_start_1, preferred_start_2 }
```

### ⚠️ Backend gap (recommended before wiring actions)
A unified **`booking-status.php`** (Accept / Cancel / Request-Changes → the 5
statuses `pending|confirmed|needs_revision|cancelled|completed` + an auto
`inbox_messages` customer-notification row) does **not** exist yet. Two options:
- **Interim:** Accept → `confirm-request.php confirm`; Cancel → `rest.php` update
  `status:"cancelled"`; Request-Changes → `rest.php` update `status:"needs_revision"`.
- **Clean (recommended):** ask the backend team (this repo) to add `booking-status.php`
  — then the mobile card calls one endpoint. *This is a ~1-file backend slice.*

---

## B. THE FIX — "Unsupported FormDataPart" (React Native upload)

**Cause:** In RN, `FormData.append('file', value)` must receive a **file object**
`{ uri, name, type }`. The error appears when `value` is a `Blob`, a base64
string, a raw byte array, or an object missing `uri`/`name`/`type` — or when you
set `Content-Type: multipart/form-data` manually (kills the boundary).

**Correct implementation (drop-in):**
```ts
// api/upload.ts
export async function uploadChatImage(opts: {
  apiBase: string; apiKey: string;
  localUri: string;          // e.g. from expo-image-picker: asset.uri (file:// or content://)
  fileName?: string;
  mimeType?: string;         // asset.mimeType
  bucket?: string;           // default 'media' (publicly readable) — or a private chat bucket
  threadId: string;
  onProgress?: (pct: number) => void;
}): Promise<{ path: string }> {
  const {
    apiBase, apiKey, localUri, bucket = 'media', threadId,
    fileName = `img_${Date.now()}.jpg`,
    mimeType = 'image/jpeg',
  } = opts;

  const form = new FormData();
  form.append('bucket', bucket);
  form.append('path', `chat/${threadId}/${Date.now()}_${fileName}`);
  // ✅ RN file part — object with uri/name/type. NOT a Blob, NOT base64.
  form.append('file', { uri: localUri, name: fileName, type: mimeType } as any);

  // Use XMLHttpRequest for real upload progress (fetch has no progress in RN).
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}/storage.php?action=upload`);
    xhr.setRequestHeader('X-API-KEY', apiKey);
    // ❌ Do NOT set Content-Type — RN adds "multipart/form-data; boundary=…".
    if (xhr.upload && opts.onProgress) {
      xhr.upload.onprogress = (e) =>
        e.lengthComputable && opts.onProgress!(Math.round((e.loaded / e.total) * 100));
    }
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && j?.data?.path) resolve({ path: j.data.path });
        else reject(new Error(j?.error?.message || j?.error || `HTTP ${xhr.status}`));
      } catch { reject(new Error(`Bad response: ${xhr.responseText?.slice(0, 120)}`)); }
    };
    xhr.onerror = () => reject(new Error('Network request failed'));
    xhr.send(form);
  });
}
```
**iOS note:** if `localUri` is `ph://` or `content://`, copy it to a real file
first (`expo-file-system` `copyAsync` / `getInfoAsync`) so `uri` is a readable
`file://` path. **Android note:** keep the `type` accurate (`asset.mimeType`).

Store the returned `path` (build a display URL with `?action=get&bucket=…&path=…`
for `media`, or a signed URL otherwise) in the chat message object.

---

## C. Claude Code prompt to run IN the Expo repo

Paste the following into Claude Code inside your Expo project:

> Implement a chat-centered booking experience. Requirements:
>
> 1. **Upload service** — create `api/upload.ts` exactly as specified (multipart via
>    `XMLHttpRequest`; file part `{uri,name,type}`; header `X-API-KEY`; NEVER set
>    `Content-Type`; `onProgress`). Fixes "Unsupported FormDataPart". Endpoint:
>    `POST {API_BASE}/storage.php?action=upload`, fields `bucket`,`path`,`file`,
>    response `{data:{path}}`.
> 2. **`BookingCard` component** (`components/BookingCard.tsx`) — a reusable,
>    prop-driven card rendering `Booking #{ref}`, client name, `from → to` address,
>    date, time, and a **status pill** (Pending=amber, Confirmed=green,
>    NeedsRevision=blue, Cancelled=grey). Props: `booking`, `role: 'admin'|'customer'`,
>    `onAction(action, booking)`. No business logic inside the card.
> 3. **Actions** — admin cards render `Accept` / `Request Changes` / `Cancel`;
>    each calls the booking-status API (see contract), then **optimistically** updates
>    local state (status pill + disable buttons) and rolls back on failure. Customer
>    cards are read-only.
> 4. **Notification template** — `format/bookingMessage.ts` producing clean chat
>    text (see below) for confirmed/cancelled/needs-revision, including name,
>    booking number, and address.
> 5. Keep it **modular**: `api/` (integration), `components/` (UI), `format/`
>    (templates). Add a small `useBookingActions` hook for the optimistic update.
>
> Use these API contracts: [paste section A].

---

## D. Notification message template (shared shape)
```ts
// format/bookingMessage.ts
export function bookingMessage(b: {
  ref: string; name: string; from: string; to: string;
  date: string; time: string; status: string; reason?: string;
}) {
  const route = b.to ? `${b.from} → ${b.to}` : b.from;
  const head = {
    confirmed: '✅ ご予約が確定しました',
    cancelled: '❌ ご予約がキャンセルされました',
    needs_revision: '✏️ ご予約の確認が必要です',
  }[b.status] ?? 'ご予約の更新';
  return [
    head, '',
    `予約番号: ${b.ref}`,
    `お名前: ${b.name}`,
    `ルート: ${route}`,
    `希望日: ${b.date}`,
    b.time ? `時間: ${b.time}` : '',
    `状態: ${b.status}`,
    b.reason ? `理由: ${b.reason}` : '',
  ].filter(Boolean).join('\n');
}
```

---

## E. Verification checklist (in the Expo app + against this backend)
- [ ] Upload a photo → no "Unsupported FormDataPart"; progress 0→100; `data.path` returned; image renders from the built URL.
- [ ] `BookingCard` renders every field + correct status color for each status.
- [ ] Admin Accept/Cancel/Request-Changes → API 2xx → pill/buttons update; failure rolls back.
- [ ] Notification text is clean and includes name + booking number + address.
- [ ] Customer never leaves the chat screen for any of the above.
