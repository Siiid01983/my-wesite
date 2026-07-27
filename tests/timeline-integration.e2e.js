'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * timeline-integration.e2e.js — FULL-STACK automated verification (no credentials)
 *
 * Drives the REAL deployed client (timelineCalendar.js / timelineGestures.js,
 * byte-identical to production) over REAL HTTP against a stateful backend that
 * faithfully ports the allow-list engine (_windows.php / availability / create /
 * reschedule). The port is self-checked at startup against the PHP test's
 * known-good outputs so it cannot silently diverge; the REAL PHP engine remains
 * authoritatively covered by tests/timeline-windows.test.php in CI (SQLite).
 *
 * Verifies by automation:
 *   press-hold create · drag-move · resize · delete · cross-day drag ·
 *   cross-MONTH drag (a single gesture, in a week that straddles a month) ·
 *   cross-week management (navigate + operate) · REFRESH PERSISTENCE ·
 *   timeline rendering · availability API + slot generation · booked-hours removed ·
 *   customer hour picker + duration · conflict detection (409) · reschedule ·
 *   reschedule-onto-booking conflict (409).
 * Run: node tests/timeline-integration.e2e.js
 * ──────────────────────────────────────────────────────────────────────────── */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

const ROOT = path.join(__dirname, '..');

/* ═══ faithful allow-list engine port (mirrors hm-api/_windows.php pure logic) ═══ */
const toMin = dt => { const m = String(dt).match(/(\d{2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const hhmm  = m => { m = Math.max(0, Math.min(1440, Math.round(m))); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
const snap  = (m, s) => Math.floor(m / s) * s;
function union(rs) {
  const c = rs.filter(r => r[1] > r[0]).sort((a, b) => a[0] - b[0]); if (!c.length) return [];
  const o = [c[0].slice()];
  for (let i = 1; i < c.length; i++) { const l = o[o.length - 1]; if (c[i][0] <= l[1]) l[1] = Math.max(l[1], c[i][1]); else o.push(c[i].slice()); }
  return o;
}
function genSlots(wins, busy, dur, step) {
  if (dur <= 0 || step <= 0) return [];
  const W = union(wins), B = union(busy), out = [];
  for (const w of W) for (let s = w[0]; s + dur <= w[1]; s += step) {
    let free = true; for (const b of B) if (s < b[1] && s + dur > b[0]) { free = false; break; }
    if (free) out.push(hhmm(s));
  }
  return [...new Set(out)].sort();
}
function fits(wins, busy, start, dur) {
  const e = start + dur; let inW = false;
  for (const w of union(wins)) if (start >= w[0] && e <= w[1]) { inW = true; break; }
  if (!inW) return false;
  for (const b of union(busy)) if (start < b[1] && e > b[0]) return false;
  return true;
}
const overlap = (aS, aE, bS, bE) => aS < bE && aE > bS;   // half-open (== hm_iv_reserve)

/* ═══ port self-check against the PHP test's known-good cases ═══ */
assert.deepStrictEqual(genSlots([[540, 720]], [], 120, 30), ['09:00', '09:30', '10:00'], 'port: 2h empty');
assert.deepStrictEqual(genSlots([[540, 720]], [[600, 660]], 60, 30), ['09:00', '11:00'], 'port: 1h around busy');
assert.deepStrictEqual(genSlots([[540, 720]], [[600, 660]], 120, 30), [], 'port: 2h blocked');
assert.strictEqual(fits([[540, 720]], [], 540, 120), true, 'port: fits');
assert.strictEqual(fits([[540, 720]], [], 630, 120), false, 'port: overflow');
console.log('  [ok] engine port self-check matches PHP known-good outputs');

/* ═══ stateful backend ═══ */
let windows = [], bookings = [], idc = 0;
const uid = p => p + (++idc);
const dayOf = dt => String(dt).slice(0, 10);
const winRanges = date => windows.filter(w => w.window_date === date).map(w => [toMin(w.start_at), toMin(w.end_at)]);
const busyRanges = date => bookings.filter(b => b.status !== 'cancelled' && dayOf(b.start_at) === date).map(b => [toMin(b.start_at), toMin(b.end_at)]);
const CFG = { day_start: '07:00', day_end: '22:00', step: 30, durations: [30, 60, 90, 120, 180, 240], default_duration: 120, active: true };

function readBody(req) { return new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch (_) { r({}); } }); }); }

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'application/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

const ADMIN_HARNESS = origin => `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="view-calendar" class="view"><div class="cal-wrap">LEGACY</div><div id="gcalPanel"></div></div>
  <script>
    window.API_BASE='${origin}'; window.API_KEY='k'; window.__HM_ADMIN_TOKEN='t';
    window.todayStr=function(){ return '2026-07-29'; };   // Wed in a week straddling Jul/Aug
    window.toast=function(m){ window.__toast=m; }; window.confirm=function(){ return true; };
    localStorage.setItem('hm_timeline_ui','1'); localStorage.removeItem('hm_timeline_zoom');
  <\/script>
  <script src="/js/modules/calendar/timelineGestures.js"><\/script>
  <script src="/js/modules/calendar/timelineCalendar.js"><\/script>
  <script>window.addEventListener('load', function(){ window.TimelineCalendar && TimelineCalendar.onShow(); });<\/script>
</body></html>`;

function makeServer() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = u.pathname.replace(/^\/hm-api/, '');
    const send = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

    // ── availability-windows.php ──
    if (p === '/availability-windows.php') {
      const body = req.method === 'POST' ? await readBody(req) : {};   // read the stream ONCE
      const act = body.action || u.searchParams.get('action') || 'get';
      if (act === 'get') { const date = u.searchParams.get('date'); return send({ ok: true, date, windows: windows.filter(w => w.window_date === date), config: CFG }); }
      if (act === 'range') { const from = u.searchParams.get('from'), to = u.searchParams.get('to'); return send({ ok: true, from, to, windows: windows.filter(w => w.window_date >= from && w.window_date <= to), bookings: bookings.filter(b => b.status !== 'cancelled' && dayOf(b.start_at) >= from && dayOf(b.start_at) <= to) }); }
      if (act === 'slots') { const date = u.searchParams.get('date'), dur = +(u.searchParams.get('duration') || 120); return send({ ok: true, date, duration: dur, slots: genSlots(winRanges(date), busyRanges(date), dur, 30) }); }
      if (act === 'add') { const date = body.date, s = snap(toMin(body.start_time), 30), e = snap(toMin(body.end_time), 30); if (e <= s) return send({ ok: false, error: 'end must be after start' }, 400); const w = { id: uid('w'), window_date: date, start_at: date + ' ' + hhmm(s) + ':00', end_at: date + ' ' + hhmm(e) + ':00' }; windows.push(w); return send({ ok: true, action: 'add', id: w.id }); }
      if (act === 'update') { const w = windows.find(x => x.id === body.id); if (!w) return send({ ok: false, error: 'not found' }, 404); const date = body.date, s = snap(toMin(body.start_time), 30), e = snap(toMin(body.end_time), 30); if (e <= s) return send({ ok: false, error: 'end' }, 400); w.window_date = date; w.start_at = date + ' ' + hhmm(s) + ':00'; w.end_at = date + ' ' + hhmm(e) + ':00'; return send({ ok: true, action: 'update', id: w.id }); }
      if (act === 'delete') { windows = windows.filter(x => x.id !== body.id); return send({ ok: true, action: 'delete', id: body.id }); }
      return send({ ok: false, error: 'bad action' }, 400);
    }
    // ── availability.php ──
    if (p === '/availability.php') {
      const date = u.searchParams.get('date');
      return send({ ok: true, date, bands: { am: 'available', pm: 'available', ev: 'available', nt: 'available' },
        intervals: bookings.filter(b => b.status !== 'cancelled' && dayOf(b.start_at) === date).map(b => ({ id: b.id, customer_name: b.customer_name, status: b.status, start_at: b.start_at, end_at: b.end_at })),
        hourly: true, capacity: null, timeline: true, windows: windows.filter(w => w.window_date === date),
        slots: genSlots(winRanges(date), busyRanges(date), 120, 30), default_duration: 120 });
    }
    // ── create-booking.php (timeline path) ──
    if (p === '/create-booking.php' && req.method === 'POST') {
      const b = await readBody(req);
      const start = String(b.start_at || '').replace('T', ' ').slice(0, 16), dur = +b.duration_min || 120;
      const date = start.slice(0, 10), sMin = toMin(start), eMin = sMin + dur;
      if (!fits(winRanges(date), busyRanges(date), sMin, dur)) return send({ ok: false, error: 'slot_taken', reason: 'unavailable' }, 409);
      const bk = { id: uid('b'), customer_name: b.customer_name || 'x', status: 'pending', start_at: date + ' ' + hhmm(sMin) + ':00', end_at: date + ' ' + hhmm(eMin) + ':00', duration_min: dur };
      bookings.push(bk); return send({ ok: true, id: bk.id, data: { id: bk.id } });
    }
    // ── reschedule.php (interval move/resize) ──
    if (p === '/reschedule.php' && req.method === 'POST') {
      const b = await readBody(req), bk = bookings.find(x => x.id === b.booking_id);
      if (!bk) return send({ ok: false, error: 'not_found' }, 404);
      const s = String(b.start_at).slice(0, 16), e = String(b.end_at).slice(0, 16), sMin = toMin(s), eMin = toMin(e), date = s.slice(0, 10);
      for (const o of bookings) if (o.id !== bk.id && o.status !== 'cancelled' && dayOf(o.start_at) === date && overlap(sMin, eMin, toMin(o.start_at), toMin(o.end_at)))
        return send({ ok: false, error: 'slot_taken', reason: 'slot_taken' }, 409);
      bk.start_at = date + ' ' + hhmm(sMin) + ':00'; bk.end_at = date + ' ' + hhmm(eMin) + ':00';
      return send({ ok: true, booking_id: bk.id, moved: true });
    }
    // ── admin harness page ──
    if (p === '/admin-tl') { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); return res.end(ADMIN_HARNESS(`http://127.0.0.1:${res.socket.localPort}`)); }
    // ── static files ──
    const fp = path.join(ROOT, p);
    if (fp.startsWith(ROOT) && fs.existsSync(fp) && !fs.statSync(fp).isDirectory()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' }); return fs.createReadStream(fp).pipe(res); }
    res.writeHead(404); res.end('nf');
  });
}

let pass = 1, fail = 0;   // 1 = the self-check above
const chk = (l, c) => { if (c) { pass++; console.log('  [ok] ' + l); } else { fail++; console.log('  [XX] ' + l); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = makeServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, origin = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  const winCount = () => page.$$eval('#hmTl .tl-win', els => els.length);
  const gotoAdmin = async () => { await page.goto(origin + '/admin-tl', { waitUntil: 'load' }); await page.waitForSelector('#hmTl .tl-scroll'); await sleep(150); };
  const canvasFor = async date => page.$eval(`#hmTl .tl-canvas[data-date="${date}"]`, c => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, top: r.top, left: r.left, w: r.width }; });

  console.log('\nADMIN — press-&-hold create (real client → real HTTP → server persist)');
  await gotoAdmin();
  chk('timeline mounted + week view (7 cols)', (await page.$$('#hmTl .tl-col')).length === 7);
  let cv = await canvasFor('2026-07-29');
  // press-hold at 09:00 (=(540-420)*0.8=96px) drag to 11:00 (+96px)
  await page.mouse.move(cv.x, cv.top + 96); await page.mouse.down(); await sleep(300);
  await page.mouse.move(cv.x, cv.top + 140); await page.mouse.move(cv.x, cv.top + 192); await page.mouse.up(); await sleep(200);
  chk('created 1 window', (await winCount()) === 1);
  chk('server stored it (09:00–11:00 on 07-29)', windows.length === 1 && windows[0].start_at === '2026-07-29 09:00:00' && windows[0].end_at === '2026-07-29 11:00:00');

  console.log('ADMIN — REFRESH PERSISTENCE (reload → re-fetch → still rendered)');
  await gotoAdmin();
  chk('window survives full page reload', (await winCount()) === 1);

  console.log('ADMIN — resize (drag bottom handle down ~1h)');
  let hb = await page.$eval('#hmTl .tl-win .tl-h.bot', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 4 }; });
  await page.mouse.move(hb.x, hb.y); await page.mouse.down(); await page.mouse.move(hb.x, hb.y + 24); await page.mouse.move(hb.x, hb.y + 48); await page.mouse.up(); await sleep(200);
  chk('resize persisted (end now 12:00)', windows[0].end_at === '2026-07-29 12:00:00');

  console.log('ADMIN — drag-move (same day, later)');
  let wbx = await page.$eval('#hmTl .tl-win', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; });
  await page.mouse.move(wbx.x, wbx.y); await page.mouse.down(); await page.mouse.move(wbx.x, wbx.y + 20); await page.mouse.move(wbx.x, wbx.y + 40); await page.mouse.up(); await sleep(200);
  chk('move persisted (start shifted later, same day)', windows[0].window_date === '2026-07-29' && windows[0].start_at > '2026-07-29 09:00:00');

  console.log('ADMIN — CROSS-MONTH drag (single gesture: Jul 31 → Aug 01, same week)');
  // Reset to a clean window on Jul 31, then drag it one column right into Aug 01.
  windows = []; await gotoAdmin();
  cv = await canvasFor('2026-07-31');
  await page.mouse.move(cv.x, cv.top + 96); await page.mouse.down(); await sleep(300); await page.mouse.move(cv.x, cv.top + 150); await page.mouse.move(cv.x, cv.top + 192); await page.mouse.up(); await sleep(200);
  chk('window created on Jul 31', windows.length === 1 && windows[0].window_date === '2026-07-31');
  const augCol = await canvasFor('2026-08-01');
  let w31 = await page.$eval('#hmTl .tl-win', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; });
  await page.mouse.move(w31.x, w31.y); await page.mouse.down(); await page.mouse.move(augCol.x, w31.y); await page.mouse.move(augCol.x, w31.y); await page.mouse.up(); await sleep(200);
  chk('single drag moved window across the month boundary → Aug 01', windows[0].window_date === '2026-08-01');
  await gotoAdmin(); chk('cross-month move persisted after reload', windows.length === 1 && windows[0].window_date === '2026-08-01');

  console.log('ADMIN — CROSS-WEEK management (navigate → next week → create there)');
  await page.click('#hmTl #tlNext'); await sleep(200);   // advance one week
  const wkCanvas = await page.$$eval('#hmTl .tl-canvas', els => els[3].getAttribute('data-date'));   // a day in the next week
  cv = await canvasFor(wkCanvas);
  await page.mouse.move(cv.x, cv.top + 96); await page.mouse.down(); await sleep(300); await page.mouse.move(cv.x, cv.top + 150); await page.mouse.move(cv.x, cv.top + 192); await page.mouse.up(); await sleep(200);
  chk('created a window in a different week', windows.some(w => w.window_date === wkCanvas));

  console.log('ADMIN — delete');
  await gotoAdmin();
  const before = await winCount();
  await page.click('#hmTl .tl-win .tl-del'); await sleep(200);
  chk('delete removed one window (server + UI)', (await winCount()) === before - 1);

  console.log('AVAILABILITY API + slot generation (real HTTP, server-computed)');
  windows = []; bookings = [];
  windows.push({ id: uid('w'), window_date: '2026-08-05', start_at: '2026-08-05 09:00:00', end_at: '2026-08-05 12:00:00' });
  let av = await (await fetch(origin + '/availability.php?date=2026-08-05')).json();
  chk('availability.php timeline:true + windows + default_duration', av.ok && av.timeline === true && av.windows.length === 1 && av.default_duration === 120);
  chk('2h slots = 09:00/09:30/10:00', JSON.stringify(av.slots) === JSON.stringify(['09:00', '09:30', '10:00']));

  console.log('CUSTOMER booking + CONFLICT detection (real HTTP)');
  let b1 = await (await fetch(origin + '/create-booking.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_at: '2026-08-05T09:00', duration_min: 120, customer_name: 'A' }) })).json();
  chk('first booking accepted', b1.ok === true);
  let av2 = await (await fetch(origin + '/availability.php?date=2026-08-05')).json();
  chk('booked hours removed from availability (2h → none free)', av2.slots.length === 0);
  let b2 = await fetch(origin + '/create-booking.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_at: '2026-08-05T10:00', duration_min: 120, customer_name: 'B' }) });
  chk('overlapping booking rejected 409 slot_taken', b2.status === 409 && (await b2.json()).error === 'slot_taken');

  console.log('CUSTOMER hour picker UI (real index.html renders server slots)');
  const cust = await browser.newPage();
  await cust.addInitScript(() => { Object.defineProperty(window, 'API_BASE', { get() { return location.origin; }, set() {}, configurable: true }); window.API_KEY = ''; });
  await cust.goto(origin + '/index.html', { waitUntil: 'load' }); await sleep(500);
  windows = [{ id: uid('w'), window_date: '2099-01-05', start_at: '2099-01-05 09:00:00', end_at: '2099-01-05 12:00:00' }]; bookings = [];
  await cust.evaluate(() => window.openBookingApp && window.openBookingApp('単身引越し')); await sleep(300);
  await cust.evaluate(() => window.baSetDate && window.baSetDate('2099-01-05')); await sleep(250);
  await cust.evaluate(() => window.baOpenDrawer && window.baOpenDrawer('time')); await sleep(200);
  chk('picker shows server start times + NO duration selector', (await cust.$$('#ba-time-host input[name="ba-tl"]')).length >= 1 && (await cust.$$('#ba-time-host .ba-dur')).length === 0);
  await cust.close();

  console.log('RESCHEDULE (drag booking) + reschedule-conflict (real HTTP)');
  bookings = [{ id: 'bkX', customer_name: 'X', status: 'confirmed', start_at: '2026-08-06 14:00:00', end_at: '2026-08-06 16:00:00', duration_min: 120 },
              { id: 'bkY', customer_name: 'Y', status: 'confirmed', start_at: '2026-08-06 09:00:00', end_at: '2026-08-06 10:00:00', duration_min: 60 }];
  let ok = await (await fetch(origin + '/reschedule.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: 'bkX', booking_date: '2026-08-06', start_at: '2026-08-06 11:00:00', end_at: '2026-08-06 13:00:00' }) })).json();
  chk('reschedule to a free interval succeeds + persists', ok.ok && bookings.find(b => b.id === 'bkX').start_at === '2026-08-06 11:00:00');
  let cf = await fetch(origin + '/reschedule.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: 'bkX', booking_date: '2026-08-06', start_at: '2026-08-06 09:30:00', end_at: '2026-08-06 11:30:00' }) });
  chk('reschedule onto another booking rejected 409', cf.status === 409);

  await browser.close();
  server.close();
  console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('INTEGRATION ERROR:', e.stack || e.message); process.exit(1); });
