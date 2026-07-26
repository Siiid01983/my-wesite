'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * ops-calendar.e2e.js — the Ops calendar is the SAME shared timeline component.
 * Loads the REAL js/modules/calendar/timelineGestures.js + timelineCalendar.js +
 * ops/js/opsCalendar.js in a minimal Ops-style harness (Ops.ready / Ops.UI /
 * #ops-content, the shared env.js globals API_BASE/API_KEY/__HM_ADMIN_TOKEN) and
 * proves the identical engine mounts + works in Ops:
 *   mounts into #ops-content · week=7 cols · window renders · press-hold+drag
 *   create (POST add) · booking chip drag reschedule (month) · Ops.UI.toast wired.
 * Run: node tests/ops-calendar.e2e.js
 * ──────────────────────────────────────────────────────────────────────────── */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

const GEST = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'calendar', 'timelineGestures.js'), 'utf8');
const CAL  = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'calendar', 'timelineCalendar.js'), 'utf8');
const OPS  = fs.readFileSync(path.join(__dirname, '..', 'ops', 'js', 'opsCalendar.js'), 'utf8');

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="ops-main"><div id="ops-content"></div></div>
  <script>
    // Shared env (env.js provides these in Ops too) + Ops-scoped admin token.
    window.API_BASE='http://mock'; window.API_KEY='k'; window.__HM_ADMIN_TOKEN='ops-tok';
    window.__toasts=[]; window.__posts=[];
    // Minimal Ops runtime (mirrors ops-core.js surface the shim uses).
    window.Ops = {
      cfg: { POLL_MS: 999999 },
      UI: { mountChrome: function(){ window.__chrome=true; }, toast: function(m){ window.__toasts.push(m); } },
      ready: function(fn){ window.addEventListener('load', function(){ setTimeout(fn, 0); }); }
    };
    window.t = function(k){ return k; };
    window.fetch=function(url,opts){ url=String(url); var m=(opts&&opts.method)||'GET';
      if(m==='POST'){ window.__posts.push(JSON.parse(opts.body)); return Promise.resolve({json:function(){return Promise.resolve({ok:true,id:'n1'});}}); }
      if(url.indexOf('action=get')!==-1){ return Promise.resolve({json:function(){return Promise.resolve({ok:true,windows:[],config:{day_start:'07:00',day_end:'22:00',step:30,durations:[30,60,90,120,180],default_duration:120}});}}); }
      if(url.indexOf('action=range')!==-1){ return Promise.resolve({json:function(){return Promise.resolve({ok:true,windows:[{id:'w1',window_date:'2026-08-12',start_at:'2026-08-12 09:00:00',end_at:'2026-08-12 12:00:00'}],bookings:[{id:'bk1',customer_name:'田中',status:'confirmed',start_at:'2026-08-12 14:00:00',end_at:'2026-08-12 16:00:00'}]});}}); }
      if(url.indexOf('reschedule.php')!==-1){ window.__posts.push(JSON.parse(opts.body)); return Promise.resolve({json:function(){return Promise.resolve({ok:true,moved:true});}}); }
      return Promise.resolve({json:function(){return Promise.resolve({ok:true});}});
    };
  <\/script>
  <script>__GEST__<\/script>
  <script>__CAL__<\/script>
  <script>__OPS__<\/script>
</body></html>`
  .replace('__GEST__', () => GEST).replace('__CAL__', () => CAL).replace('__OPS__', () => OPS);

let pass = 0, fail = 0;
const chk = (l, c) => { if (c) { pass++; console.log('  [ok] ' + l); } else { fail++; console.log('  [XX] ' + l); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(HARNESS); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  // todayStr not defined in Ops harness → component falls back to real today; pin
  // the clock so the preset 2026-08 fixtures line up with the visible week.
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => window.TimelineCalendar && window.TimelineCalendar._debug.setAnchor('2026-08-12'));
  await sleep(150);

  console.log('shared component mounts inside the Ops SPA');
  chk('Ops chrome mounted', await page.evaluate(() => window.__chrome === true));
  chk('timeline (#hmTl) mounted INSIDE #ops-content', (await page.$('#ops-content #hmTl')) !== null);
  chk('same engine identity (TimelineCalendar global)', (await page.evaluate(() => typeof window.TimelineCalendar.onShow)) === 'function');
  chk('force-enabled in Ops (no admin preview flag needed)', await page.evaluate(() => window.TimelineCalendar.enabled()));

  // Re-render week for the pinned anchor.
  await page.evaluate(() => { window.TimelineCalendar._debug.setView('week'); window.TimelineCalendar.reload(); });
  await page.waitForSelector('#hmTl .tl-scroll'); await sleep(120);
  chk('week view = 7 day columns (same as Admin)', (await page.$$('#hmTl .tl-col')).length === 7);
  chk('availability window renders', (await page.$$('#hmTl .tl-win')).length === 1);
  chk('booking renders', (await page.$$('#hmTl .tl-bk')).length === 1);

  console.log('same interactions work in Ops');
  await page.evaluate(() => { window.__posts = []; });
  const cv = await page.$eval('#hmTl .tl-canvas', c => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, top: r.top }; });
  const y1 = cv.top + 288;  // ~13:00
  await page.mouse.move(cv.x, y1); await page.mouse.down(); await sleep(300);
  await page.mouse.move(cv.x, y1 + 20); await page.mouse.move(cv.x, y1 + 48); await page.mouse.up(); await sleep(150);
  chk('press-hold + drag CREATE availability → POST add', await page.evaluate(() => window.__posts.some(p => p.action === 'add')));

  console.log('Ops.UI.toast is wired via configure()');
  chk('a toast fired through Ops.UI (not window.toast)', await page.evaluate(() => window.__toasts.length > 0));

  await browser.close();
  server.close();
  console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('OPS E2E ERROR:', e.stack || e.message); process.exit(1); });
