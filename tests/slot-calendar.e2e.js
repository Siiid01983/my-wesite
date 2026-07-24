'use strict';
/* ────────────────────────────────────────────────────────────────────────────
 * slot-calendar.e2e.js — REAL browser E2E for the unified 空き枠管理 slot calendar.
 * Loads the actual js/modules/calendar/slotCalendar.js in headless Chromium against
 * a mocked slot-capacity backend + a stub SlotCapacity editor, then drives the UI:
 *   month grid render · ○△× roll-up · band colours · day-click→editor wiring ·
 *   容量設定 nav hidden · 複数日選択 bulk close · slotcap:changed auto-refresh ·
 *   flag-off fallback · perf (1 month-status fetch per open).
 * Run: node tests/slot-calendar.e2e.js   (requires the installed Playwright chromium)
 * ──────────────────────────────────────────────────────────────────────────── */
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (_) { console.log('SKIP: playwright not installed'); process.exit(0); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'calendar', 'slotCalendar.js'), 'utf8');

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <button class="sb-link" data-view="capacity">容量設定</button>
  <div id="view-calendar" class="view"><div class="cal-wrap">LEGACY GRID</div><div id="gcalPanel"></div></div>
  <div id="view-capacity" class="view"><div class="settings-grid">
    <div class="panel">予約容量設定 (max/limited)</div>
    <div class="panel" id="hmScPanel">時間帯別キャパシティ<input type="date" id="hmScDate"></div>
  </div></div>
  <script>
    window.API_BASE = 'http://mock'; window.API_KEY = 'k'; window.__HM_ADMIN_TOKEN = 't';
    window.todayStr = function(){ return '2026-08-15'; };
    window.toast = function(){};
    window.loadCapacity = function(){ window.__loadCapacityCalled = (window.__loadCapacityCalled||0)+1; };
    window.prompt = function(){ return 'テスト理由'; };
    window.confirm = function(){ return true; };
    window.__fetch = [];
    window.SlotCapacity = {
      mount: function(){ window.__scMount = (window.__scMount||0)+1; return true; },
      reload: function(){ window.__scReload = (window.__scReload||0)+1; window.__scDate = document.getElementById('hmScDate').value; }
    };
    // Mock backend: GET month-status → per-day bands; POST → {ok:true}.
    window.fetch = function(url, opts){
      window.__fetch.push({ url: String(url), method: (opts && opts.method) || 'GET', body: (opts && opts.body) || null });
      if (String(url).indexOf('month-status') !== -1){
        var u = new URL(String(url)); var from = u.searchParams.get('from'), to = u.searchParams.get('to');
        var days = {}, d = new Date(from+'T00:00:00'), end = new Date(to+'T00:00:00');
        var st = function(s){ return { status:s, capacity:1, used:s==='full'?1:0, remaining:s==='full'?0:1, closed:s==='closed' }; };
        while (d <= end){
          var ds = d.toISOString().slice(0,10);
          var b = { am:st('available'), pm:st('available'), ev:st('available'), nt:st('available') };
          if (ds === '2026-08-10') b.pm = st('closed');                 // partial → △
          if (ds === '2026-08-05') b.am = { status:'limited', capacity:2, used:1, remaining:1, closed:false }; // △
          if (ds === '2026-08-20'){ b.am=st('closed'); b.pm=st('closed'); b.ev=st('closed'); b.nt=st('closed'); } // all closed → ×
          days[ds] = b; d.setDate(d.getDate()+1);
        }
        return Promise.resolve({ json: function(){ return Promise.resolve({ ok:true, action:'month-status', from:from, to:to, days:days }); } });
      }
      return Promise.resolve({ json: function(){ return Promise.resolve({ ok:true }); } });
    };
  </script>
</body></html>`;

let pass = 0, fail = 0;
function chk(label, cond) { if (cond) { pass++; console.log('  [ok] ' + label); } else { fail++; console.log('  [XX] ' + label); } }

(async () => {
  // Serve the harness over a real http origin so localStorage (feature flag) works.
  const http = require('node:http');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HARNESS); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept('x'));   // safety: never block on a native dialog
  await page.goto(url, { waitUntil: 'load' });
  await page.addScriptTag({ content: SRC });

  // Boot the screen (what go('calendar') does).
  await page.evaluate(() => window.SlotCalendar.onShow());
  await page.waitForSelector('#slotcalGrid .slotcal-cell');

  console.log('month grid');
  chk('42 day cells rendered', (await page.$$('#slotcalGrid .slotcal-cell')).length === 42);
  chk('one month-status fetch (perf)', (await page.evaluate(() => window.__fetch.filter(f => f.url.indexOf('month-status') !== -1).length)) === 1);
  chk('legacy ○△× grid hidden', (await page.evaluate(() => document.querySelector('#view-calendar .cal-wrap').style.display)) === 'none');
  chk('容量設定 nav hidden', (await page.evaluate(() => document.querySelector('.sb-link[data-view="capacity"]').style.display)) === 'none');
  chk('editor (settings-grid) relocated under grid', (await page.evaluate(() => !!document.querySelector('#slotcalEditorHost .settings-grid') && !document.querySelector('#view-capacity .settings-grid'))));

  console.log('roll-up glyph ○△×');
  const roll = (ds) => page.evaluate((d) => document.querySelector('[data-ds="' + d + '"] .slotcal-roll').textContent, ds);
  chk('all-closed day → ×', (await roll('2026-08-20')) === '×');
  chk('partial-closed day → △', (await roll('2026-08-10')) === '△');
  chk('limited day → △', (await roll('2026-08-05')) === '△');
  chk('open day → ○', (await roll('2026-08-15')) === '○');
  chk('all-closed day has 4 closed band cells', (await page.evaluate(() => document.querySelectorAll('[data-ds="2026-08-20"] .bd-closed').length)) === 4);

  console.log('day-click → slot editor');
  await page.click('[data-ds="2026-08-15"]');
  chk('SlotCapacity.reload called', (await page.evaluate(() => window.__scReload)) >= 1);
  chk('editor date set to clicked day', (await page.evaluate(() => window.__scDate)) === '2026-08-15');
  chk('selected-date note updated', (await page.evaluate(() => document.getElementById('slotcalEditNote').textContent)).indexOf('2026-08-15') === 0);
  chk('clicked cell marked selected', (await page.evaluate(() => document.querySelector('[data-ds="2026-08-15"]').className.indexOf('sel') !== -1)));

  console.log('bulk (multi-day) close');
  await page.click('#slotcalBulk');
  chk('bulk bar visible', (await page.evaluate(() => document.getElementById('slotcalBulkBar').style.display)) !== 'none');
  await page.click('[data-ds="2026-08-11"]');
  await page.click('[data-ds="2026-08-12"]');
  chk('two days picked', (await page.evaluate(() => document.querySelectorAll('#slotcalGrid .picked').length)) === 2);
  const fetchBefore = await page.evaluate(() => window.__fetch.length);
  await page.click('#slotcalBulkClose');
  await page.waitForTimeout(300);
  const closeCalls = await page.evaluate(() => window.__fetch.filter(f => f.method === 'POST' && String(f.body).indexOf('close-day') !== -1));
  chk('close-day POST for both selected days', closeCalls.length === 2);
  chk('close-day payload carries dates', closeCalls.some(c => c.body.indexOf('2026-08-11') !== -1) && closeCalls.some(c => c.body.indexOf('2026-08-12') !== -1));
  chk('grid reloaded after bulk (fetch grew)', (await page.evaluate(() => window.__fetch.length)) > fetchBefore + 2);

  console.log('slotcap:changed auto-refresh');
  const before = await page.evaluate(() => window.__fetch.filter(f => f.url.indexOf('month-status') !== -1).length);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('slotcap:changed', { detail: { date: '2026-08-15' } })));
  await page.waitForTimeout(150);
  chk('month grid refetched on editor change', (await page.evaluate(() => window.__fetch.filter(f => f.url.indexOf('month-status') !== -1).length)) === before + 1);

  console.log('feature flag fallback');
  chk('flag off → enabled() false', (await page.evaluate(() => { localStorage.setItem('hm_admin_slot_ui', '0'); var v = window.SlotCalendar.enabled(); localStorage.removeItem('hm_admin_slot_ui'); return v; })) === false);

  await browser.close();
  server.close();
  console.log('\n' + (fail ? ('FAIL: ' + fail + ' failed, ' + pass + ' passed') : ('PASS: all ' + pass + ' checks')));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(1); });
