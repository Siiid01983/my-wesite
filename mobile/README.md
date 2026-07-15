# Mobile chat integration — HANDOFF BUNDLE (copy into your Expo app)

> ⚠️ These are **React Native / Expo** source files. This repository is the
> **backend + website + admin panel** — there is no RN runtime here, so these
> files **cannot be built or run in this repo**. Copy them into your Expo project
> and verify there (`tsc`, `expo start`). This folder exists only as a versioned,
> API-accurate handoff (it is excluded from web deploys).

## Files
```
mobile/
  api/upload.ts            FormDataPart-safe multipart upload (XHR progress)
  api/bookingStatus.ts     calls booking-status.php (Accept/Cancel/Request Changes)
  components/StatusPill.tsx status → color/label pill
  components/BookingCard.tsx dynamic booking card + admin actions
  hooks/useBookingActions.ts optimistic status updates + rollback
  format/bookingMessage.ts  JP customer-notification formatter
```

## Wiring in the Expo app
1. Copy the folders under your app's source root (e.g. `src/`). Adjust import paths.
2. Provide config (env / expo constants):
   - `API_BASE`  = `https://hello-moving.com/hm-api`
   - `API_KEY`   = the value of `api_key` in the server `_config.php`
   - `ADMIN_TOKEN` (admin builds only) = the session token from `admin-session.php`
3. Pass those into the api functions / hook (they take an `auth` object — no globals).

## Backend contracts used (verified against this repo)
- **Upload**: `POST {API_BASE}/storage.php?action=upload` multipart `bucket`,`path`,`file`;
  header `X-API-KEY`; response `{data:{path}}`. Read `media` via `?action=get`.
- **Status**: `POST {API_BASE}/booking-status.php` `{booking_id, status, note?}`,
  headers `X-API-KEY` + `X-ADMIN-TOKEN`; `status ∈ Accepted|Cancelled|Needs_Revision|Pending`;
  response `{ok, booking_id, status:"confirmed|cancelled|needs_revision|pending", notified}`.
