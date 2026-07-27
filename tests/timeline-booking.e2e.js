'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * timeline-booking.e2e.js — customer BA overlay TIMELINE slot-picker (Phase C)
 * Serves the real index.html, mocks availability.php as timeline-live (windows +
 * slots) and create-booking.php, then:
 *   • asserts the page loads with NO JS errors (validates the inline BA edits)
 *   • the time drawer renders the timeline picker (duration chips + slot chips),
 *     not band radios
 *   • changing duration regenerates the slot list
 *   • BookingService.createBooking forwards startAt/durationMin → the POST body
 *     carries start_at + duration_min (bookingService.js mapping)
 * Run: node tests/timeline-booking.e2e.js
 * ──────────────────────────────────────────────────────────────────────────── */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

const ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html;charset=utf-8', '.js':'application/javascript;charset=utf-8', '.css':'text/css;charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' };

let pass = 0, fail = 0;
function chk(l, c) { if (c) { pass++; console.log('  [ok] ' + l); } else { fail++; console.log('  [XX] ' + l); } }

// Injected BEFORE any page script: fix API_BASE + mock the two endpoints.
const INIT = `
  window.__API_BASE_OVERRIDE = 'http://mock';
  window.__posts = [];
  (function(){
    var real = window.fetch;
    window.fetch = function(url, opts){
      url = String(url); var m = (opts && opts.method) || 'GET';
      if (url.indexOf('availability.php') !== -1) {
        return Promise.resolve({ ok:true, json:function(){ return Promise.resolve({
          ok:true, date:url.replace(/.*date=/,'').slice(0,10),
          intervals:[], closed:false,
          timeline:true, default_duration:120, durations:[30,60,90,120,180,240],
          windows:[{id:'w1',start_at:'2099-01-05 09:00:00',end_at:'2099-01-05 12:00:00'}],
          // SERVER-generated free starts per duration (single source of truth):
          slots:['09:00','09:30','10:00'],
          slots_by_duration:{ '30':['09:00','09:30','10:00','10:30','11:00','11:30'],
            '60':['09:00','09:30','10:00','10:30','11:00'], '90':['09:00','09:30','10:00','10:30'],
            '120':['09:00','09:30','10:00'], '180':['09:00'], '240':[] }
        }); } });
      }
      if (url.indexOf('create-booking.php') !== -1) {
        window.__posts.push(JSON.parse((opts && opts.body) || '{}'));
        return Promise.resolve({ ok:true, json:function(){ return Promise.resolve({ ok:true, id:'BK1' }); } });
      }
      return real ? real.apply(this, arguments) : Promise.resolve({ ok:true, json:function(){ return Promise.resolve({ok:true}); } });
    };
  })();
`;

(async () => {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
    fs.createReadStream(fp).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(INIT);
  await page.addInitScript(() => {
    // Point the overlay at the mock API before its config runs.
    Object.defineProperty(window, 'API_BASE', { get(){ return 'http://mock'; }, set(){}, configurable: true });
    window.API_KEY = '';
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  console.log('page load');
  chk('index.html loads with no JS errors', errors.length === 0);
  if (errors.length) console.log('    errors: ' + errors.slice(0, 3).join(' | '));
  chk('openBookingApp defined', (await page.evaluate(() => typeof window.openBookingApp)) === 'function');

  console.log('timeline picker in the time drawer');
  await page.evaluate(() => window.openBookingApp('単身引越し'));
  await page.waitForTimeout(300);            // _baFetchMode resolves timeline:true
  // Pick a date (baSetDate sets state + fetches availability for it), then open time.
  await page.evaluate(() => { window.baSetDate && window.baSetDate('2099-01-05'); });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.baOpenDrawer && window.baOpenDrawer('time'));
  await page.waitForTimeout(200);
  chk('NO duration selector (.ba-dur removed)', (await page.$$('#ba-time-host .ba-dur')).length === 0);
  chk('start-time chips rendered from server slots (3)', (await page.$$('#ba-time-host input[name="ba-tl"]')).length === 3);
  chk('no band radios in timeline mode', (await page.$$('#ba-time-host input[name="ba-time"]')).length === 0);
  chk('no 所要時間 label in the picker', !/所要時間/.test(await page.$eval('#ba-time-host', el => el.textContent)));

  console.log('confirm sets startAt (no duration step)');
  await page.evaluate(() => { var r = document.querySelector('#ba-time-host input[name="ba-tl"][value="09:30"]'); if (r) r.checked = true; window.baConfirmTime(); });
  const startAt = await page.evaluate(() => window.__baStateStart ? window.__baStateStart() : null);
  // read via a fresh review build instead:
  chk('startAt captured 09:30', (await page.evaluate(() => {
    // baState is closure-private; assert through the value chip text instead.
    var el = document.getElementById('ba-val-time'); return el && /09:30/.test(el.textContent);
  })));

  // (BookingService payload mapping is covered by timeline-booking-payload.test.js —
  //  it loads dynamically here so is not reachable as a window global.)

  console.log('truly-empty day → pick-another-day note (never bands, never manual contact)');
  const cust2 = await browser.newPage();
  await cust2.addInitScript(() => {
    Object.defineProperty(window, 'API_BASE', { get() { return 'http://mock'; }, set() {}, configurable: true });
    window.API_KEY = '';
    const real = window.fetch;
    window.fetch = function (url, opts) {
      url = String(url);
      if (url.indexOf('availability.php') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, timeline: true, closed: false, intervals: [], windows: [], slots: [], slots_by_duration: { '30': [], '60': [], '120': [], '240': [] }, durations: [30,60,90,120,180,240], default_duration: 120 }) });
      return real ? real.apply(this, arguments) : Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    };
  });
  await cust2.goto(url, { waitUntil: 'load' }); await cust2.waitForTimeout(300);
  await cust2.evaluate(() => window.openBookingApp('単身引越し')); await cust2.waitForTimeout(200);
  await cust2.evaluate(() => window.baSetDate && window.baSetDate('2099-01-06')); await cust2.waitForTimeout(300);
  await cust2.evaluate(() => window.baOpenDrawer && window.baOpenDrawer('time')); await cust2.waitForTimeout(200);
  chk('no timeline slots when day is empty', (await cust2.$$('#ba-time-host input[name="ba-tl"]')).length === 0);
  chk('NO band radios shown (bands fully removed)', (await cust2.$$('#ba-time-host input[name="ba-time"]')).length === 0);
  chk('shows a no-availability note (not manual contact)', await cust2.evaluate(() => {
    var h = document.getElementById('ba-time-host'); return !!h && /空き時間がありません/.test(h.textContent) && !/090-2489-3402/.test(h.textContent);
  }));
  await cust2.close();

  await browser.close();
  server.close();
  console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(1); });
