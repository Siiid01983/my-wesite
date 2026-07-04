/*
 * booking-config.verify.js — CMS-driven booking-form config sanity checks.
 * Run: node tests/booking-config.verify.js
 *
 * Guards:
 *   1. index.html: BA overlay reads hm_booking_config (hosts + renderers +
 *      BA_DEFAULT_CFG present; no static item-card markup left behind).
 *   2. Defaults parity: item ids / cats / filters / time-slot count in the
 *      WMC editor (bookingConfig.js BC_DEFAULTS) match index.html
 *      (BA_DEFAULT_CFG) — the two literals must not drift.
 *   3. Booking pipeline unchanged: BookingService.createBooking appears
 *      exactly once in index.html (arch-lock parity).
 *   4. Wiring: Adapter helpers + WMC registration + ContentLoader snapshot
 *      mechanism intact.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ✓ ' + name); }
  else { failures++; console.error('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const indexHtml = read('index.html');
const moduleJs  = read('js/modules/booking-config/bookingConfig.js');
const adapterJs = read('js/services/apiAdapter.js');
const wmcHtml   = read('websiteManagement.html');
const loaderJs  = read('js/services/contentLoader.js');

console.log('── index.html (BA overlay reads config)');
check('ba-items-host container exists', indexHtml.includes('id="ba-items-host"'));
check('ba-time-host container exists', indexHtml.includes('id="ba-time-host"'));
check('ba-filter-host container exists', indexHtml.includes('id="ba-filter-host"'));
check('BA_DEFAULT_CFG defined', indexHtml.includes('var BA_DEFAULT_CFG = {'));
check('BA_ITEM_SVG icon map defined (with _default)',
  indexHtml.includes('var BA_ITEM_SVG = {') && indexHtml.includes('_default:'));
check('_baCfg reads hm_booking_config', /_baReadJSON\('hm_booking_config'\)/.test(indexHtml));
check('baRenderItems / baRenderTimeSlots / baRenderFilters defined',
  ['function baRenderItems()', 'function baRenderTimeSlots()', 'function baRenderFilters()']
    .every((s) => indexHtml.includes(s)));
check('baRenderBookingConfig wired into Init + openBookingApp',
  (indexHtml.match(/baRenderBookingConfig\(\);/g) || []).length >= 2);
check('no static item-card markup left', !/id="ba-card-tv-s"><div class="ba-item-name">/.test(indexHtml));
check('no static time-slot radios left', !/<input type="radio" name="ba-time" value="午前/.test(indexHtml));
check('no static filter checkboxes left', !/<input type="checkbox" id="ba-f-same-day">/.test(indexHtml));

console.log('── booking pipeline (arch parity)');
check('BookingService.createBooking called exactly once in index.html',
  (indexHtml.match(/BookingService\.createBooking\s*\(/g) || []).length === 1);

console.log('── defaults parity (index.html BA_DEFAULT_CFG ↔ editor BC_DEFAULTS)');
function idsFrom(src, blockStart, blockEnd, re) {
  const start = src.indexOf(blockStart);
  if (start < 0) return null;
  const end = src.indexOf(blockEnd, start);
  const block = src.slice(start, end < 0 ? start + 8000 : end);
  const out = []; let m;
  while ((m = re.exec(block)) !== null) out.push(m[1]);
  return out;
}
// items arrays only — both literals list items between `items: [` and `timeSlots:`
const idxItemIds = idsFrom(indexHtml, 'var BA_DEFAULT_CFG = {', 'timeSlots:', /\{"id":"([\w-]+)","name"/g);
const modItemIds = idsFrom(moduleJs, 'var BC_DEFAULTS = {', 'timeSlots:', /\{ id: '([\w-]+)',\s*name:/g);
check('16 default items in index.html', idxItemIds && idxItemIds.length === 16, 'got ' + (idxItemIds || []).length);
check('item ids identical in editor defaults',
  JSON.stringify(idxItemIds) === JSON.stringify(modItemIds),
  (modItemIds || []).join(','));
['living', 'water', 'storage'].forEach((c) =>
  check("category '" + c + "' in both", indexHtml.includes('"id":"' + c + '"') && moduleJs.includes("id: '" + c + "'")));
['same-day', 'english', 'insurance', 'disposal'].forEach((f) =>
  check("filter '" + f + "' in both", indexHtml.includes('"id":"' + f + '"') && moduleJs.includes("id: '" + f + "'")));
const idxSlots = (indexHtml.match(/\{"label":"[^"]+","value":"[^"]+"\}/g) || []).length;
check('5 default time slots in index.html', idxSlots === 5, 'got ' + idxSlots);

console.log('── wiring (Adapter / WMC / ContentLoader)');
check('Adapter.getBookingConfig / saveBookingConfig exist',
  adapterJs.includes("getBookingConfig: () => _ls('hm_booking_config', null)")
  && adapterJs.includes('saveBookingConfig(v)')
  && adapterJs.includes("upsert({ key: 'hm_booking_config'"));
// WAF regression: an authenticated body containing "value":null gets 403'd by
// the host's mod_security before reaching rest.php — resets must send {}.
check('reset never sends a null value over the wire',
  !moduleJs.includes('saveBookingConfig(null)')
  && adapterJs.includes("(v && typeof v === 'object') ? v : {}"));
check('editor reports true save status (awaits API result)',
  moduleJs.includes('_bcPersist') && moduleJs.includes('保存に失敗しました'));
check('WMC nav + view + script + dispatch registered',
  wmcHtml.includes('data-view="booking-config"')
  && wmcHtml.includes('id="wmc-view-booking-config"')
  && wmcHtml.includes('js/modules/booking-config/bookingConfig.js')
  && wmcHtml.includes("view === 'booking-config'"));
check('editor module exposes renderBookingConfig', moduleJs.includes('window.renderBookingConfig = renderBookingConfig'));
// ContentLoader writes EVERY hm_data key to localStorage — that line is the
// public-page delivery path for hm_booking_config. If it changes, the overlay
// stops seeing admin edits.
check('ContentLoader snapshots all hm_data keys to localStorage',
  /kv\[key\]\s*=\s*value;\s*_ls\(key,\s*value\);/.test(loaderJs));

console.log('');
if (failures) { console.error(failures + ' check(s) FAILED'); process.exit(1); }
console.log('All booking-config checks passed ✓');
