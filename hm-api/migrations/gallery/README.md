# Works Gallery (作業事例ギャラリー) — Backend

DB-driven photo gallery for the public homepage carousel + admin CRUD.
**Additive** — no existing booking/CMS/admin flow reads or writes this table.

## Files
| File | Purpose |
|------|---------|
| `migrations/gallery/001_create_website_gallery.sql` | Creates `website_gallery` (idempotent) |
| `migrations/gallery/001_rollback.sql` | Drops `website_gallery` |
| `gallery.php` | **Public** feed (GET only) |
| `admin/gallery.php` | **Admin** CRUD (staff token required) |

## Apply the migration
On the cPanel host (phpMyAdmin → SQL, or `mysql` CLI), run
`001_create_website_gallery.sql` against the app database. Re-runnable.
Rollback with `001_rollback.sql` (drops the table + its rows; image files on
disk are left untouched).

## Image storage
Uploads are re-encoded and written to the **public `media` bucket** under
`gallery/` (`storage_dir/media/gallery/`), served by `storage.php?action=get`.
`hm-api/_uploads/.htaccess` already denies PHP execution there.

Per upload the admin endpoint produces up to three files and records real
dimensions:
- `<rand>.<ext>` — re-encoded original → `image_url`
- `<rand>.webp` — full-size WebP → `image_webp`
- `<rand>_400.webp` — 400px thumbnail (admin list) → `thumb_url`

> **GD dependency.** Re-encode + WebP + thumbnail need the PHP **GD** extension.
> If GD is absent the endpoint degrades gracefully: it stores the validated raw
> upload (still MIME-checked via finfo, ≤5 MB, randomized name), leaves
> `image_webp`/`thumb_url` NULL, reads dimensions via `getimagesize()` when
> possible, and logs a warning. Re-encoding resumes automatically once GD is
> installed. Confirm GD on the host if you want WebP/thumbnails.

---

## Public endpoint — `GET <API_BASE>/gallery.php`
- **GET only.** Any other verb → `405`.
- Auth: API-key gate only (send `X-API-KEY: <window.API_KEY>`). No staff token.
- Returns `is_active = 1` rows, `ORDER BY display_order ASC, id ASC`.
- Header: `Cache-Control: public, max-age=300`.
- Never exposes `is_active`, `thumb_url`, or timestamps.
- Fails soft: on any server error returns `{ "data": [], "count": 0 }` (200) so
  the public carousel can hide itself rather than show an error.

**Response**
```json
{
  "data": [
    {
      "id": 1,
      "title": "…",
      "description": "… | null",
      "alt_text": "…",
      "image_url": "https://api-host/hm-api/storage.php?action=get&bucket=media&path=gallery%2Fg_ab12.jpg",
      "image_webp": "… | null",
      "width": 1600,
      "height": 1067,
      "category": "general",
      "is_featured": false
    }
  ],
  "count": 1
}
```

---

## Admin endpoint — `<API_BASE>/admin/gallery.php`
Auth on **every** request: API-key gate **+ staff gate** (valid, non-revoked
`X-ADMIN-TOKEN`, role admin/manager). The custom `X-ADMIN-TOKEN` header is the
CSRF defense (unattachable cross-site without a CORS grant). Unauthenticated →
`401` JSON.

Handler errors use the shape `{ "error": "<message>", "code": <httpStatus> }`.

### `GET` — list
All rows (active + inactive), `ORDER BY display_order ASC, id ASC`.
→ `{ "data": [ <full row>… ], "count": n }`
Full row adds `thumb_url`, `display_order`, `is_active`, `created_at`,
`updated_at` on top of the public fields.

### `POST` (multipart/form-data) — create
Image **required**.

| field | required | notes |
|-------|----------|-------|
| `image` | ✅ | file part; jpg/jpeg/png/webp; ≤ 5 MB; real MIME verified |
| `title` | ✅ | ≤ 120 |
| `alt_text` | ✅ | ≤ 200 (SEO + screen readers) |
| `description` | — | ≤ 400 |
| `category` | — | ≤ 40, default `general` |
| `display_order` | — | int; default = `MAX(display_order)+1` |
| `is_active` | — | `1`/`0`/`true`/`false`; default `1` |
| `is_featured` | — | default `0` |

→ `201 { "data": { <full row> } }`

### `PUT` (application/json) — update
Metadata/flags; **image optional**. Only the keys you send are changed.

```json
{
  "id": 1,
  "title": "…",
  "alt_text": "…",
  "description": "… | \"\" to clear",
  "category": "…",
  "display_order": 3,
  "is_active": true,
  "is_featured": false,
  "image_base64": "data:image/jpeg;base64,…   (optional — replaces the image)"
}
```
When `image_base64` is present it is validated + re-encoded like an upload, new
variants are generated, and the **old files are deleted** after the row updates.
→ `{ "data": { <full row> } }`

### `DELETE` — delete
`id` via query (`?id=`) or JSON body. Removes the DB row **and all three files**
from disk.
→ `{ "data": { "deleted": <id> } }`

### `POST ?action=reorder` — reorder
Body: `{ "items": [ { "id": 1, "display_order": 0 }, … ] }` (a bare array is also
accepted). Applied in **one transaction** (all or nothing).
→ `{ "data": { "updated": n } }`

### Error codes
`400` bad JSON/upload · `401` unauthenticated (gate) · `404` not found ·
`405` method not allowed · `413` too large (>5 MB) · `415` unsupported type ·
`422` validation (missing id/title/alt_text) · `500` server error.
