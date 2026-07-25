'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * timeline-calendar.e2e.js — REAL browser E2E for the admin hourly timeline.
 * Loads timelineGestures.js + timelineCalendar.js in headless Chromium against a
 * mocked availability-windows backend, then drives the UI:
 *   day/week/month render · preset window renders at the right offset · view
 *   switch · delete (✕ → POST delete) · press-&-hold + drag create (→ POST add) ·
 *   resize handle drag (→ POST update) · snap persists.
 * Run: node tests/timeline-calendar.e2e.js   (requires the installed Playwright chromium)
 * ──────────────────────────────────────────────────────────────────────────── */
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

// Source override (live-deployment verification): set TL_SRC_DIR to a directory
// holding downloaded copies of the two modules to test EXACTLY what a server
// serves, instead of the local working tree.
const SRC_DIR = process.env.TL_SRC_DIR || path.join(__dirname, '..', 'js', 'modules', 'calendar');
const GEST = fs.readFileSync(path.join(SRC_DIR, 'timelineGestures.js'), 'utf8');
const CAL  = fs.readFileSync(path.join(SRC_DIR, 'timelineCalendar.js'), 'utf8');

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="view-calendar" class="view"><div class="cal-wrap">LEGACY</div><div id="gcalPanel"></div></div>
  <script>
    window.API_BASE='http://mock'; window.API_KEY='k'; window.__HM_ADMIN_TOKEN='t';
    window.todayStr=function(){ return '2026-08-12'; };  // a Wednesday
    window.toast=function(){}; window.confirm=function(){ return true; };
    localStorage.setItem('hm_timeline_ui','1');
    window.__posts=[];
    // Mock backend: range → one preset window 09:00–12:00 on 2026-08-12; get → config; POST → ok.
    window.fetch=function(url,opts){
      url=String(url); var method=(opts&&opts.method)||'GET';
      if(method==='POST'){ window.__posts.push(JSON.parse(opts.body)); return Promise.resolve({json:function(){return Promise.resolve({ok:true,id:'new1'});}}); }
      if(url.indexOf('action=get')!==-1){ return Promise.resolve({json:function(){return Promise.resolve({ok:true,date:'2026-08-12',windows:[],config:{day_start:'07:00',day_end:'22:00',step:30,durations:[30,60,90,120,180],default_duration:120,active:false}});}}); }
      if(url.indexOf('action=range')!==-1){ return Promise.resolve({json:function(){return Promise.resolve({ok:true,windows:[{id:'w1',window_date:'2026-08-12',start_at:'2026-08-12 09:00:00',end_at:'2026-08-12 12:00:00'}],bookings:[{id:'bk1',customer_name:'田中',status:'confirmed',start_at:'2026-08-12 14:00:00',end_at:'2026-08-12 16:00:00'}]});}}); }
      if(url.indexOf('reschedule.php')!==-1){ window.__posts.push(Object.assign({__url:'reschedule'},JSON.parse(opts.body))); return Promise.resolve({json:function(){return Promise.resolve({ok:true,moved:true});}}); }
      return Promise.resolve({json:function(){return Promise.resolve({ok:true});}});
    };
  <\/script>
</body></html>`;

let pass = 0, fail = 0;
function chk(label, cond) { if (cond) { pass++; console.log('  [ok] ' + label); } else { fail++; console.log('  [XX] ' + label); } }

(async () => {
  const http = require('node:http');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HARNESS); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(url, { waitUntil: 'load' });
  await page.addScriptTag({ content: GEST });
  await page.addScriptTag({ content: CAL });

  await page.evaluate(() => window.TimelineCalendar.onShow());
  await page.waitForSelector('#hmTl .tl-scroll');

  console.log('render + default view (week)');
  chk('mounted', (await page.$('#hmTl')) !== null);
  chk('legacy hidden', (await page.evaluate(() => document.querySelector('#view-calendar .cal-wrap').style.display)) === 'none');
  chk('week = 7 day columns', (await page.$$('#hmTl .tl-col')).length === 7);
  chk('preset window rendered', (await page.$$('#hmTl .tl-win')).length === 1);
  chk('window label 09:00–12:00', (await page.evaluate(() => document.querySelector('#hmTl .tl-win .tl-t').textContent)) === '09:00–12:00');
  // 09:00 = 540min; day_start 07:00=420; (540-420)*0.8 = 96px
  chk('window positioned at 96px', Math.abs(parseFloat(await page.evaluate(() => document.querySelector('#hmTl .tl-win').style.top)) - 96) < 1);

  console.log('cross-day window drag (week view, Wed → Thu)');
  await page.evaluate(() => { window.__posts = []; });
  const wb = await page.$eval('#hmTl .tl-win', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
  // Grab the window body, drag one full column to the RIGHT (Thu 2026-08-13), same time.
  await page.mouse.move(wb.x, wb.y);
  await page.mouse.down();
  await page.mouse.move(wb.x + wb.w * 0.6, wb.y);
  await page.mouse.move(wb.x + wb.w * 1.2, wb.y);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const xd = await page.evaluate(() => window.__posts.find(p => p.action === 'update'));
  chk('cross-day update POSTed', !!xd && xd.id === 'w1');
  chk('window moved to 2026-08-13', !!xd && xd.date === '2026-08-13');
  chk('time preserved on cross-day move', !!xd && xd.start_time === '09:00' && xd.end_time === '12:00');

  console.log('view switch');
  await page.click('#hmTl .tl-seg button[data-v="day"]');
  await page.waitForTimeout(50);
  chk('day = 1 column', (await page.$$('#hmTl .tl-col')).length === 1);
  await page.click('#hmTl .tl-seg button[data-v="month"]');
  await page.waitForTimeout(50);
  chk('month = 42 cells', (await page.$$('#hmTl .tl-mcell')).length === 42);
  chk('month shows availability sum', (await page.evaluate(() => !!document.querySelector('#hmTl .tl-mcell .sum'))));
  chk('booking renders as a chip in month view', (await page.$$('#hmTl .tl-mchip')).length === 1);

  console.log('month cell click → day view (empty cell, no chip)');
  await page.click('#hmTl .tl-mcell[data-date="2026-08-20"]');   // a cell with no booking chip
  await page.waitForTimeout(50);
  chk('month cell click → day view', (await page.$$('#hmTl .tl-col')).length === 1);

  console.log('month-view booking chip drag → cross-week/month reschedule');
  await page.click('#hmTl .tl-seg button[data-v="month"]'); await page.waitForTimeout(50);
  await page.evaluate(() => { window.__posts = []; });
  const src = await page.$eval('#hmTl .tl-mchip', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const dst = await page.$eval('#hmTl .tl-mcell[data-date="2026-08-19"]', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(src.x, src.y); await page.mouse.down();
  await page.mouse.move((src.x + dst.x) / 2, (src.y + dst.y) / 2); await page.mouse.move(dst.x, dst.y); await page.mouse.up();
  await page.waitForTimeout(200);
  const mrs = await page.evaluate(() => window.__posts.find(p => p.booking_id === 'bk1'));
  chk('chip drag → reschedule to 2026-08-19 (cross-week)', !!mrs && mrs.booking_date === '2026-08-19');
  chk('time-of-day preserved on cross-day move (14:00)', !!mrs && /14:00/.test(mrs.start_at || ''));

  // day view of the booking's date (reliable; not subject to the post-drag click guard)
  await page.evaluate(() => window.TimelineCalendar._debug.setAnchor('2026-08-12'));
  await page.click('#hmTl .tl-seg button[data-v="day"]'); await page.waitForTimeout(80);

  console.log('booking render + drag-reschedule (Phase D)');
  chk('booking block rendered', (await page.$$('#hmTl .tl-bk')).length === 1);
  chk('booking shows customer name', /田中/.test(await page.evaluate(() => document.querySelector('#hmTl .tl-bk .nm').textContent)));
  // Drag the booking body up ~48px (~1h) → ~13:00, using its real bounding box.
  await page.evaluate(() => { window.__posts = []; });
  const bb = await page.$eval('#hmTl .tl-bk', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 14 }; });
  await page.mouse.move(bb.x, bb.y);
  await page.mouse.down();
  await page.mouse.move(bb.x, bb.y - 16);
  await page.mouse.move(bb.x, bb.y - 32);
  await page.mouse.move(bb.x, bb.y - 48);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const rs = await page.evaluate(() => window.__posts.find(p => p.booking_id === 'bk1'));
  chk('reschedule POSTed for bk1', !!rs && rs.booking_id === 'bk1');
  chk('reschedule new start ~13:00', !!rs && /13:00/.test(rs.start_at || ''));

  console.log('delete (✕ → POST delete)');
  await page.evaluate(() => { window.__posts = []; });
  await page.click('#hmTl .tl-win .tl-del');
  await page.waitForTimeout(150);
  chk('delete POSTed with id', (await page.evaluate(() => window.__posts.some(p => p.action === 'delete' && p.id === 'w1'))));

  console.log('press-&-hold + drag → create (POST add)');
  await page.evaluate(() => { window.__posts = []; });
  // Empty spot on today's canvas: find canvas box, press-hold at ~13:00, drag down ~1h.
  const box = await page.evaluate(() => {
    const c = document.querySelector('#hmTl .tl-canvas'); const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, top: r.top };
  });
  // 13:00 = 780min → y=(780-420)*0.8=288 from canvas top.
  const y1 = box.top + 288, y2 = box.top + 288 + 48;   // +48px ≈ +1h
  await page.mouse.move(box.x, y1);
  await page.mouse.down();
  await page.waitForTimeout(300);            // exceed the 220ms press-hold threshold
  await page.mouse.move(box.x, y1 + 20);
  await page.mouse.move(box.x, y2);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const addPost = await page.evaluate(() => window.__posts.find(p => p.action === 'add'));
  chk('create POSTed action=add', !!addPost);
  chk('create start ~13:00', !!addPost && /13:00/.test(addPost.start_time));

  console.log('resize (bottom handle drag → POST update)');
  // Re-render day (create reloaded windows via mock range → still the 09:00 preset).
  await page.waitForSelector('#hmTl .tl-win');
  await page.evaluate(() => { window.__posts = []; });
  const hb = await page.evaluate(() => { const h = document.querySelector('#hmTl .tl-win .tl-h.bot'); const r = h.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; });
  await page.mouse.move(hb.x, hb.y);
  await page.mouse.down();
  await page.mouse.move(hb.x, hb.y + 20);
  await page.mouse.move(hb.x, hb.y + 48);   // drag bottom down ~1h
  await page.mouse.up();
  await page.waitForTimeout(150);
  chk('resize POSTed action=update', (await page.evaluate(() => window.__posts.some(p => p.action === 'update' && p.id === 'w1'))));

  console.log('snap persists');
  await page.selectOption('#hmTl #tlSnap', '15');
  chk('snap saved to localStorage', (await page.evaluate(() => localStorage.getItem('hm_timeline_snap'))) === '15');

  await browser.close();
  server.close();
  console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(1); });
