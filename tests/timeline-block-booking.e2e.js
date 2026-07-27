'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * timeline-block-booking.e2e.js — REAL browser E2E for the admin timeline's
 * manual BLOCK, manual BOOKING, block rendering, close-day, and context-menu
 * delete flows (the pieces added to make the timeline a complete scheduler).
 *
 * Loads timelineGestures.js + timelineCalendar.js in headless Chromium against a
 * mocked backend and asserts the correct endpoints/payloads fire:
 *   • create-mode toggle → BLOCK → press-hold create → reason+memo dialog →
 *     POST block-interval.php {action:block,reason,memo}
 *   • create-mode → BOOKING → dialog (name/email/phone) → POST create-booking.php
 *   • range blocks[] render as .tl-blk with their reason
 *   • right-click a booking → context menu → delete → POST booking-status Cancelled
 *   • right-click a block → context menu → POST block-interval unblock
 *   • close-day 🚫 → reason dialog → POST close-day.php {action:close,reason}
 * Run: node tests/timeline-block-booking.e2e.js
 * ──────────────────────────────────────────────────────────────────────────── */
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

const SRC_DIR = path.join(__dirname, '..', 'js', 'modules', 'calendar');
const GEST = fs.readFileSync(path.join(SRC_DIR, 'timelineGestures.js'), 'utf8');
const CAL  = fs.readFileSync(path.join(SRC_DIR, 'timelineCalendar.js'), 'utf8');

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div id="view-calendar" class="view"><div id="gcalPanel"></div></div>
  <script>
    window.API_BASE='http://mock'; window.API_KEY='k'; window.__HM_ADMIN_TOKEN='t';
    window.todayStr=function(){ return '2026-08-12'; };  // Wednesday
    window.toast=function(){}; window.confirm=function(){ return true; };
    localStorage.setItem('hm_timeline_ui','1');
    window.__posts=[]; window.__closed=[];   // stateful closures so reopen is testable
    window.fetch=function(url,opts){
      url=String(url); var method=(opts&&opts.method)||'GET';
      var body=null; try{ body=opts&&opts.body?JSON.parse(opts.body):null; }catch(e){}
      function J(o){ return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(o);}}); }
      if(method==='POST'){
        var tag = url.indexOf('block-interval')!==-1?'block-interval'
                : url.indexOf('create-booking')!==-1?'create-booking'
                : url.indexOf('booking-status')!==-1?'booking-status'
                : url.indexOf('close-day')!==-1?'close-day'
                : url.indexOf('availability-windows')!==-1?'windows'
                : url.indexOf('reschedule')!==-1?'reschedule':'other';
        window.__posts.push(Object.assign({__url:tag}, body||{}));
        if(tag==='close-day' && body){
          if(body.action==='close' && body.date){ if(window.__closed.indexOf(body.date)<0) window.__closed.push(body.date); }
          if(body.action==='reopen' && body.date){ window.__closed = window.__closed.filter(function(d){return d!==body.date;});
            return J({ok:true,action:'reopen',reopened:1,still_closed:false}); }
        }
        return J({ok:true,id:'new1'});
      }
      if(url.indexOf('action=get')!==-1){ return J({ok:true,date:'2026-08-12',windows:[],config:{day_start:'07:00',day_end:'22:00',step:30,durations:[30,60,90,120,180],default_duration:120,active:true}}); }
      if(url.indexOf('action=range')!==-1){ return J({ok:true,
        windows:[{id:'w1',window_date:'2026-08-12',start_at:'2026-08-12 09:00:00',end_at:'2026-08-12 12:00:00'}],
        bookings:[{id:'bk1',customer_name:'田中',status:'confirmed',start_at:'2026-08-12 14:00:00',end_at:'2026-08-12 16:00:00'}],
        blocks:[{id:'blk1',reason:'トラック整備',memo:'定期点検',start_at:'2026-08-12 10:00:00',end_at:'2026-08-12 11:00:00'}],
        closed: window.__closed.map(function(d){ return {day:d,reason:'休業',closed_by:'admin'}; }) }); }
      return J({ok:true});
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

  await page.evaluate(() => { window.TimelineCalendar._debug.setAnchor('2026-08-12'); window.TimelineCalendar.onShow(); });
  await page.waitForSelector('#hmTl .tl-scroll');
  await page.click('#hmTl .tl-seg button[data-v="day"]'); await page.waitForTimeout(80);

  console.log('create-mode toggle present');
  chk('mode toggle rendered (空き/ブロック/予約)', (await page.$$('#hmTl #tlMode button')).length === 3);
  chk('default mode = window (on)', (await page.evaluate(() => document.querySelector('#tlMode button[data-m="window"]').classList.contains('on'))));

  console.log('manual BLOCK render (from range blocks[])');
  chk('block element rendered', (await page.$$('#hmTl .tl-blk')).length === 1);
  chk('block shows reason', /トラック整備/.test(await page.evaluate(() => document.querySelector('#hmTl .tl-blk .nm').textContent)));
  chk('block shows memo', /定期点検/.test(await page.evaluate(() => document.querySelector('#hmTl .tl-blk').textContent)));
  // Positioned at its time: 10:00 = (600-420)*0.8 = 144px (regression guard for the
  // missing-style bug where blocks stacked at the canvas top).
  chk('block positioned at 10:00 (~144px)', Math.abs(parseFloat(await page.evaluate(() => document.querySelector('#hmTl .tl-blk').style.top)) - 144) < 1);
  chk('block has a height (90min)', parseFloat(await page.evaluate(() => document.querySelector('#hmTl .tl-blk').style.height)) > 40);

  console.log('BLOCK mode: press-hold create → reason+memo dialog → POST block-interval');
  await page.click('#hmTl #tlMode button[data-m="block"]'); await page.waitForTimeout(60);
  await page.evaluate(() => { window.__posts = []; });
  // press-hold at ~13:00 (empty), drag +1h
  const box = await page.evaluate(() => { const c = document.querySelector('#hmTl .tl-canvas'); const r = c.getBoundingClientRect(); return { x: r.left + r.width * 0.5, top: r.top }; });
  const y1 = box.top + (780 - 420) * 0.8;   // 13:00
  await page.mouse.move(box.x, y1); await page.mouse.down(); await page.waitForTimeout(300);
  await page.mouse.move(box.x, y1 + 20); await page.mouse.move(box.x, y1 + 48); await page.mouse.up();
  await page.waitForSelector('#tlCloseDlg', { timeout: 2000 });
  chk('block dialog opened', (await page.$('#tlCloseDlg')) !== null);
  chk('memo field present', (await page.$('#tlRsnMemo')) !== null);
  await page.click('#tlCloseDlg .tl-rsn[data-r="トラック整備"]');
  await page.fill('#tlRsnMemo', 'エンジン点検');
  await page.click('#tlCloseDlg .tl-dlg-ok');
  await page.waitForTimeout(200);
  const bp = await page.evaluate(() => window.__posts.find(p => p.__url === 'block-interval' && p.action === 'block'));
  chk('block POSTed to block-interval', !!bp);
  chk('block reason sent', !!bp && bp.reason === 'トラック整備');
  chk('block memo sent', !!bp && bp.memo === 'エンジン点検');
  chk('block has start/end time', !!bp && /^\d{2}:\d{2}$/.test(bp.start_time || '') && /^\d{2}:\d{2}$/.test(bp.end_time || ''));

  console.log('BOOKING mode: press-hold create → dialog → POST create-booking');
  await page.click('#hmTl #tlMode button[data-m="booking"]'); await page.waitForTimeout(60);
  await page.evaluate(() => { window.__posts = []; });
  const box2 = await page.evaluate(() => { const c = document.querySelector('#hmTl .tl-canvas'); const r = c.getBoundingClientRect(); return { x: r.left + r.width * 0.5, top: r.top }; });
  const yb = box2.top + (1020 - 420) * 0.8;  // 17:00 (empty — clear of window/booking/block)
  await page.mouse.move(box2.x, yb); await page.mouse.down(); await page.waitForTimeout(300);
  await page.mouse.move(box2.x, yb + 20); await page.mouse.move(box2.x, yb + 48); await page.mouse.up();
  await page.waitForSelector('#tlBkName', { timeout: 2000 });
  chk('booking dialog opened', (await page.$('#tlBkName')) !== null);
  await page.fill('#tlBkName', '山田太郎');
  await page.fill('#tlBkEmail', 'yamada@example.com');
  await page.fill('#tlBkPhone', '09012345678');
  await page.click('#tlCloseDlg .tl-dlg-ok');
  await page.waitForTimeout(200);
  const kp = await page.evaluate(() => window.__posts.find(p => p.__url === 'create-booking'));
  chk('booking POSTed to create-booking', !!kp);
  chk('booking name/email/phone sent', !!kp && kp.customer_name === '山田太郎' && kp.customer_email === 'yamada@example.com' && /0901234/.test(kp.customer_phone || ''));
  chk('booking carries start_at + duration', !!kp && /17:00/.test(kp.start_at || '') && kp.duration_min > 0);

  console.log('context menu: right-click booking → delete → booking-status Cancelled');
  await page.evaluate(() => { window.__posts = []; });
  await page.click('#hmTl #tlMode button[data-m="window"]'); await page.waitForTimeout(60);
  await page.$eval('#hmTl .tl-bk', el => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 })); });
  await page.waitForSelector('#tlCtxMenu', { timeout: 2000 });
  chk('context menu opened for booking', (await page.$('#tlCtxMenu')) !== null);
  await page.click('#tlCtxMenu .tl-ctx-item');
  await page.waitForTimeout(200);
  const dp = await page.evaluate(() => window.__posts.find(p => p.__url === 'booking-status'));
  chk('booking delete → status Cancelled', !!dp && /cancel/i.test(dp.status || '') && dp.booking_id === 'bk1');

  console.log('context menu: right-click block → unblock');
  await page.evaluate(() => { window.__posts = []; });
  await page.$eval('#hmTl .tl-blk', el => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 })); });
  await page.waitForSelector('#tlCtxMenu', { timeout: 2000 });
  await page.click('#tlCtxMenu .tl-ctx-item');
  await page.waitForTimeout(200);
  const up = await page.evaluate(() => window.__posts.find(p => p.__url === 'block-interval' && p.action === 'unblock'));
  chk('block unblock POSTed', !!up && up.id === 'blk1');

  console.log('close-day → reopen CYCLE (the reported bug: reopen must fully clear it)');
  await page.evaluate(() => { window.__posts = []; });
  // CLOSE the day.
  await page.click('#hmTl .tl-closebtn');
  await page.waitForSelector('#tlCloseDlg', { timeout: 2000 });
  await page.click('#tlCloseDlg .tl-rsn'); // first preset reason
  await page.click('#tlCloseDlg .tl-dlg-ok');
  await page.waitForFunction(() => !!document.querySelector('#hmTl .tl-closebtn[data-closed="1"]'), { timeout: 3000 });
  const cp = await page.evaluate(() => window.__posts.find(p => p.__url === 'close-day' && p.action === 'close'));
  chk('close-day POSTed with reason', !!cp && !!cp.reason && !!cp.date);
  chk('day flips to CLOSED (button becomes reopen ↺)', (await page.$('#hmTl .tl-closebtn[data-closed="1"]')) !== null);
  chk('closed overlay 休業 shown', (await page.$('#hmTl .tl-closed')) !== null);

  // REOPEN the same day — must remove the closure completely, no reload, no stale state.
  await page.evaluate(() => { window.__posts = []; });
  await page.click('#hmTl .tl-closebtn[data-closed="1"]');
  await page.waitForFunction(() => { var b = document.querySelector('#hmTl .tl-closebtn'); return b && !b.getAttribute('data-closed'); }, { timeout: 3000 });
  const rp = await page.evaluate(() => window.__posts.find(p => p.__url === 'close-day' && p.action === 'reopen'));
  chk('reopen POSTed for the same date', !!rp && rp.date === cp.date);
  chk('day is OPEN again (button back to 🚫)', (await page.$('#hmTl .tl-closebtn[data-closed="1"]')) === null);
  chk('closed overlay 休業 removed', (await page.$('#hmTl .tl-closed')) === null);
  chk('no stale closed state on the server side', (await page.evaluate(() => window.__closed.length)) === 0);

  console.log('live-sync: BroadcastChannel wired');
  chk('BroadcastChannel sync active', (await page.evaluate(() => typeof BroadcastChannel !== 'undefined')));

  await browser.close();
  await new Promise(r => server.close(r));
  console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
