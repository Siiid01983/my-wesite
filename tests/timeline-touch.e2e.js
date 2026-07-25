'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * timeline-touch.e2e.js — mobile TOUCH gestures on the admin timeline (Phase E).
 * Mobile viewport + hasTouch; drives REAL touch via CDP (Input.dispatchTouchEvent)
 * so the Pointer-Events code path is exercised as a finger, not a mouse:
 *   • press-&-hold + drag (one finger) creates a window → POST add
 *   • zoom buttons change the vertical scale (px/min)
 *   • two-finger pinch-out zooms in (px/min increases)
 * Run: node tests/timeline-touch.e2e.js
 * ──────────────────────────────────────────────────────────────────────────── */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

const GEST = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'calendar', 'timelineGestures.js'), 'utf8');
const CAL  = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'calendar', 'timelineCalendar.js'), 'utf8');

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
  <div id="view-calendar" class="view"><div class="cal-wrap">L</div><div id="gcalPanel"></div></div>
  <script>
    window.API_BASE='http://mock'; window.API_KEY='k'; window.__HM_ADMIN_TOKEN='t';
    window.todayStr=function(){ return '2026-08-12'; };
    window.toast=function(){}; window.confirm=function(){ return true; };
    localStorage.setItem('hm_timeline_ui','1'); localStorage.removeItem('hm_timeline_zoom');
    window.__posts=[];
    window.fetch=function(url,opts){ url=String(url); var m=(opts&&opts.method)||'GET';
      if(m==='POST'){ window.__posts.push(JSON.parse(opts.body)); return Promise.resolve({json:function(){return Promise.resolve({ok:true,id:'n1'});}}); }
      if(url.indexOf('action=get')!==-1){ return Promise.resolve({json:function(){return Promise.resolve({ok:true,windows:[],config:{day_start:'07:00',day_end:'22:00',step:30,durations:[30,60,90,120,180],default_duration:120}});}}); }
      if(url.indexOf('action=range')!==-1){ return Promise.resolve({json:function(){return Promise.resolve({ok:true,windows:[],bookings:[]});}}); }
      return Promise.resolve({json:function(){return Promise.resolve({ok:true});}});
    };
  <\/script>
</body></html>`;

let pass = 0, fail = 0;
function chk(l, c) { if (c) { pass++; console.log('  [ok] ' + l); } else { fail++; console.log('  [XX] ' + l); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(HARNESS); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(url, { waitUntil: 'load' });
  await page.addScriptTag({ content: GEST });
  await page.addScriptTag({ content: CAL });
  await page.evaluate(() => window.TimelineCalendar.onShow());
  await page.waitForSelector('#hmTl .tl-scroll');
  await page.click('#hmTl .tl-seg button[data-v="day"]');
  await page.waitForTimeout(60);

  const cdp = await context.newCDPSession(page);
  const tp = (x, y) => ({ x, y, radiusX: 6, radiusY: 6, force: 1 });
  async function touch(type, points) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points }); }

  const canvas = await page.$eval('#hmTl .tl-canvas', c => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, top: r.top }; });

  console.log('one-finger press-&-hold + drag → create');
  await page.evaluate(() => { window.__posts = []; });
  const y1 = canvas.top + 200;                 // some empty spot
  await touch('touchStart', [tp(canvas.x, y1)]);
  await sleep(300);                            // exceed the 220ms hold
  await touch('touchMove', [tp(canvas.x, y1 + 20)]);
  await touch('touchMove', [tp(canvas.x, y1 + 60)]);
  await touch('touchEnd', []);
  await sleep(150);
  chk('touch create POSTed action=add', (await page.evaluate(() => window.__posts.some(p => p.action === 'add'))));

  console.log('zoom buttons change vertical scale');
  const z0 = await page.evaluate(() => window.TimelineCalendar._debug.pxPerMin());
  await page.click('#hmTl #tlZoom button[data-z="in"]');
  await page.waitForTimeout(60);
  const z1 = await page.evaluate(() => window.TimelineCalendar._debug.pxPerMin());
  chk('zoom-in increases px/min', z1 > z0);
  await page.click('#hmTl #tlZoom button[data-z="out"]');
  await page.waitForTimeout(60);
  const z2 = await page.evaluate(() => window.TimelineCalendar._debug.pxPerMin());
  chk('zoom-out decreases px/min', z2 < z1);

  console.log('two-finger pinch-out → zoom in');
  const scrollBox = await page.$eval('#hmTl .tl-scroll', s => { const r = s.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
  const zb = await page.evaluate(() => window.TimelineCalendar._debug.pxPerMin());
  // Start two fingers close, then spread them apart vertically.
  await touch('touchStart', [tp(scrollBox.cx, scrollBox.cy - 20), tp(scrollBox.cx, scrollBox.cy + 20)]);
  await sleep(30);
  await touch('touchMove', [tp(scrollBox.cx, scrollBox.cy - 60), tp(scrollBox.cx, scrollBox.cy + 60)]);
  await sleep(30);
  await touch('touchMove', [tp(scrollBox.cx, scrollBox.cy - 110), tp(scrollBox.cx, scrollBox.cy + 110)]);
  await sleep(30);
  await touch('touchEnd', []);
  await sleep(80);
  const za = await page.evaluate(() => window.TimelineCalendar._debug.pxPerMin());
  chk('pinch-out increased px/min', za > zb);

  await browser.close();
  server.close();
  console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TOUCH E2E ERROR:', e.message); process.exit(1); });
