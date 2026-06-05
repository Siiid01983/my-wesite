'use strict';
/**
 * DataProvider unit tests — Phase 7
 *
 * Runs against the real admin.html served on localhost:8787.
 * Supabase is mocked via window.__withFakeSb for assertion-critical paths
 * so tests are deterministic and do not depend on network connectivity.
 *
 * Run: npm test  (or: node --test tests/dataProvider.test.js)
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

let browser, page;

// ── One-time setup ────────────────────────────────────────────────────────
before(async () => {
  browser = await chromium.launch({ headless: true });
  page    = await browser.newPage();

  await page.goto('http://localhost:8787/admin.html', {
    waitUntil: 'networkidle',
    timeout: 20000,
  });

  // Inject shared helpers into the browser context once.
  await page.evaluate(() => {
    /**
     * Build a fake SupabaseClient whose .from().select/insert/update/delete
     * resolve with the supplied responses in sequence.
     * The last response is repeated for any extra calls.
     */
    window.__mkFakeSb = function (responses) {
      let idx = 0;
      const next = () => responses[Math.min(idx++, responses.length - 1)];
      const mkChain = (rp) => ({
        select:  ()        => mkChain(rp),
        insert:  ()        => rp,
        update:  ()        => mkChain(rp),
        delete:  ()        => mkChain(rp),
        eq:      function () { return this; },
        then    (res, rej) { return rp.then(res, rej); },
        catch   (rej)      { return rp.catch(rej); },
        finally (fn)       { return rp.finally(fn); },
      });
      return { from: () => mkChain(Promise.resolve(next())) };
    };

    /** Run fn() with a fake Supabase client, then restore the real one. */
    window.__withFakeSb = async function (responses, fn) {
      const real = window.SupabaseClient;
      window.SupabaseClient = window.__mkFakeSb(responses);
      try   { return await fn(); }
      finally { window.SupabaseClient = real; }
    };
  });
});

after(async () => { await browser.close(); });

// ── Per-test reset ────────────────────────────────────────────────────────
beforeEach(async () => {
  await page.evaluate(() => {
    window.DataProvider.resetMetrics();
    window.DataProvider.clearAllCache();
    window.HM_CONFIG.FORCE_FALLBACK = false;
    window.HM_CONFIG.CACHE_TTL      = {};
    window.HM_CONFIG.RETRY          = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000, factor: 2 };
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// read()
// ═══════════════════════════════════════════════════════════════════════════
describe('read()', () => {

  it('cold read (no cache) → source: supabase, result cached', async () => {
    const r = await page.evaluate(async () => {
      const res = await window.DataProvider.read('bookings');
      const cs  = window.DataProvider.cacheStatus().find(s => s.table === 'bookings');
      return {
        source:     res.source,
        isArray:    Array.isArray(res.data),
        cached:     !!cs,
        cacheValid: cs?.valid,
      };
    });
    assert.equal(r.source, 'supabase');
    assert.ok(r.isArray,    'data should be an array');
    assert.ok(r.cached,     'cache entry should exist after cold read');
    assert.ok(r.cacheValid, 'cache entry should be valid (within TTL)');
  });

  it('warm read (within TTL) → source: cache, no extra Supabase call', async () => {
    const r = await page.evaluate(async () => {
      await window.DataProvider.read('bookings');                   // seed cache
      const sbBefore = window.DataProvider.getMetrics().supabaseReads;
      const res       = await window.DataProvider.read('bookings'); // warm hit
      const sbAfter   = window.DataProvider.getMetrics().supabaseReads;
      return {
        source:      res.source,
        sbReadDelta: sbAfter - sbBefore,
        cacheHits:   window.DataProvider.getMetrics().cacheHits,
      };
    });
    assert.equal(r.source,      'cache');
    assert.equal(r.sbReadDelta, 0, 'warm read must not issue a Supabase request');
    assert.ok(r.cacheHits >= 1);
  });

  it('FORCE_FALLBACK=true → source: localStorage, skips Supabase', async () => {
    const r = await page.evaluate(async () => {
      window.HM_CONFIG.FORCE_FALLBACK = true;
      const res = await window.DataProvider.read('bookings');
      return { source: res.source };
    });
    assert.equal(r.source, 'localStorage');
  });

  it('after invalidate() → source: supabase (forced refetch)', async () => {
    const r = await page.evaluate(async () => {
      await window.DataProvider.read('bookings');          // seed
      window.DataProvider.invalidate('bookings');          // mark stale
      const res = await window.DataProvider.read('bookings');
      return { source: res.source };
    });
    assert.equal(r.source, 'supabase');
  });

  it('stale envelope (ts=0) → source: supabase (refetches)', async () => {
    const r = await page.evaluate(async () => {
      localStorage.setItem('hm_dp_bookings', JSON.stringify({
        data: [{ id: 'old' }], ts: 0, ttl: 120000,
      }));
      const res = await window.DataProvider.read('bookings');
      return { source: res.source };
    });
    assert.equal(r.source, 'supabase');
  });

  it('HM_CONFIG.CACHE_TTL override → custom TTL stored in envelope', async () => {
    const r = await page.evaluate(async () => {
      window.HM_CONFIG.CACHE_TTL = { bookings: 99000 };
      await window.DataProvider.read('bookings');
      const cs = window.DataProvider.cacheStatus().find(s => s.table === 'bookings');
      return { ttl_s: cs?.ttl_s };
    });
    assert.equal(r.ttl_s, 99);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// write()
// ═══════════════════════════════════════════════════════════════════════════
describe('write()', () => {

  it('Supabase success → cache invalidated, next read refetches', async () => {
    const r = await page.evaluate(async () => {
      await window.DataProvider.read('bookings'); // seed valid cache
      const beforeValid = window.DataProvider.cacheStatus().find(s => s.table === 'bookings')?.valid;

      await window.__withFakeSb(
        [{ data: null, error: null }],
        () => window.DataProvider.write('bookings', { id: 'new-row' })
      );

      const afterValid   = window.DataProvider.cacheStatus().find(s => s.table === 'bookings')?.valid;
      const refetch      = await window.DataProvider.read('bookings');
      return { beforeValid, afterValid, refetchSource: refetch.source };
    });
    assert.ok(r.beforeValid,           'cache should be valid before write');
    assert.equal(r.afterValid, false,  'cache should be stale after successful write');
    assert.equal(r.refetchSource, 'supabase');
  });

  it('fallback (FORCE_FALLBACK) → optimistically appends row to cache', async () => {
    const r = await page.evaluate(async () => {
      localStorage.setItem('hm_dp_bookings', JSON.stringify({
        data: [{ id: 'a' }], ts: Date.now(), ttl: 120000,
      }));
      window.HM_CONFIG.FORCE_FALLBACK = true;
      await window.DataProvider.write('bookings', { id: 'b' });
      const env = JSON.parse(localStorage.getItem('hm_dp_bookings'));
      return {
        rowCount: env?.data?.length,
        hasB:     env?.data?.some(x => x.id === 'b'),
      };
    });
    assert.equal(r.rowCount, 2);
    assert.ok(r.hasB, 'new row should be optimistically appended');
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// update()
// ═══════════════════════════════════════════════════════════════════════════
describe('update()', () => {

  it('Supabase success → cache invalidated', async () => {
    const r = await page.evaluate(async () => {
      await window.DataProvider.read('bookings'); // seed
      await window.__withFakeSb(
        [{ data: null, error: null }],
        () => window.DataProvider.update('bookings', 'x', { status: 'done' })
      );
      return { valid: window.DataProvider.cacheStatus().find(s => s.table === 'bookings')?.valid };
    });
    assert.equal(r.valid, false);
  });

  it('fallback (FORCE_FALLBACK) → optimistically merges patch into cache', async () => {
    const r = await page.evaluate(async () => {
      localStorage.setItem('hm_dp_bookings', JSON.stringify({
        data: [{ id: 'a', status: 'pending' }], ts: Date.now(), ttl: 120000,
      }));
      window.HM_CONFIG.FORCE_FALLBACK = true;
      await window.DataProvider.update('bookings', 'a', { status: 'confirmed' });
      const env = JSON.parse(localStorage.getItem('hm_dp_bookings'));
      return { status: env?.data?.find(x => x.id === 'a')?.status };
    });
    assert.equal(r.status, 'confirmed');
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// delete()
// ═══════════════════════════════════════════════════════════════════════════
describe('delete()', () => {

  it('Supabase success → cache invalidated', async () => {
    const r = await page.evaluate(async () => {
      await window.DataProvider.read('bookings'); // seed
      await window.__withFakeSb(
        [{ data: null, error: null }],
        () => window.DataProvider.delete('bookings', 'x')
      );
      return { valid: window.DataProvider.cacheStatus().find(s => s.table === 'bookings')?.valid };
    });
    assert.equal(r.valid, false);
  });

  it('fallback (FORCE_FALLBACK) → optimistically removes row from cache', async () => {
    const r = await page.evaluate(async () => {
      localStorage.setItem('hm_dp_bookings', JSON.stringify({
        data: [{ id: 'a' }, { id: 'b' }], ts: Date.now(), ttl: 120000,
      }));
      window.HM_CONFIG.FORCE_FALLBACK = true;
      await window.DataProvider.delete('bookings', 'a');
      const env = JSON.parse(localStorage.getItem('hm_dp_bookings'));
      return {
        rowCount: env?.data?.length,
        hasA:     env?.data?.some(x => x.id === 'a'),
      };
    });
    assert.equal(r.rowCount, 1);
    assert.equal(r.hasA, false, 'deleted row should be removed from cache');
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// Retry logic
// ═══════════════════════════════════════════════════════════════════════════
describe('retry logic', () => {

  it('503 × 2 then success → retries=2, source: supabase', async () => {
    const r = await page.evaluate(async () => {
      window.HM_CONFIG.RETRY = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, factor: 1 };
      return await window.__withFakeSb(
        [
          { data: null, error: { message: '503', status: 503 } },
          { data: null, error: { message: '503', status: 503 } },
          { data: [{ id: '1' }], error: null },
        ],
        async () => {
          const res = await window.DataProvider.read('bookings');
          return {
            source:  res.source,
            retries: window.DataProvider.getMetrics().retries,
          };
        }
      );
    });
    assert.equal(r.source,  'supabase');
    assert.equal(r.retries, 2);
  });

  it('400 (client error) → not retried, source: localStorage', async () => {
    const r = await page.evaluate(async () => {
      window.HM_CONFIG.RETRY = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, factor: 1 };
      return await window.__withFakeSb(
        [{ data: null, error: { message: 'bad request', status: 400 } }],
        async () => {
          const res = await window.DataProvider.read('bookings');
          return {
            source:  res.source,
            retries: window.DataProvider.getMetrics().retries,
          };
        }
      );
    });
    assert.equal(r.retries, 0, '400 is non-retryable');
    assert.equal(r.source,  'localStorage');
  });

  it('retries exhausted (503 always) → source: localStorage, fallbacks=1', async () => {
    const r = await page.evaluate(async () => {
      window.HM_CONFIG.RETRY = { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2, factor: 1 };
      return await window.__withFakeSb(
        [{ data: null, error: { message: 'always 503', status: 503 } }],
        async () => {
          const res = await window.DataProvider.read('bookings');
          const m   = window.DataProvider.getMetrics();
          return { source: res.source, retries: m.retries, fallbacks: m.fallbacks };
        }
      );
    });
    assert.equal(r.source,   'localStorage');
    assert.equal(r.retries,  2);
    assert.equal(r.fallbacks, 1);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// Metrics
// ═══════════════════════════════════════════════════════════════════════════
describe('metrics', () => {

  it('reads / cacheHits / supabaseReads / fallbacks / hitRate counted correctly', async () => {
    const m = await page.evaluate(async () => {
      await window.DataProvider.read('bookings');  // 1 — cold → supabase
      await window.DataProvider.read('bookings');  // 2 — warm → cache
      await window.DataProvider.read('bookings');  // 3 — warm → cache
      window.HM_CONFIG.FORCE_FALLBACK = true;
      await window.DataProvider.read('reviews');   // 4 — → localStorage
      window.HM_CONFIG.FORCE_FALLBACK = false;
      return window.DataProvider.getMetrics();
    });
    assert.equal(m.reads,         4);
    assert.equal(m.supabaseReads, 1);
    assert.equal(m.cacheHits,     2);
    assert.equal(m.fallbacks,     1);
    assert.equal(m.hitRate,       50);  // 2/4
  });

  it('lastLatencyMs and lastSyncTs set after Supabase read', async () => {
    const m = await page.evaluate(async () => {
      await window.DataProvider.read('bookings');
      return window.DataProvider.getMetrics();
    });
    assert.ok(typeof m.lastLatencyMs === 'number' && m.lastLatencyMs >= 0,
              'lastLatencyMs should be a non-negative number');
    assert.ok(typeof m.lastSyncTs === 'number' && m.lastSyncTs > 0,
              'lastSyncTs should be a positive timestamp');
  });

  it('resetMetrics() zeroes all counters and nulls timestamps', async () => {
    const m = await page.evaluate(async () => {
      await window.DataProvider.read('bookings');
      window.DataProvider.resetMetrics();
      return window.DataProvider.getMetrics();
    });
    assert.equal(m.reads,         0);
    assert.equal(m.cacheHits,     0);
    assert.equal(m.supabaseReads, 0);
    assert.equal(m.fallbacks,     0);
    assert.equal(m.retries,       0);
    assert.equal(m.lastLatencyMs, null);
    assert.equal(m.lastSyncTs,    null);
    assert.equal(m.lastRetryTs,   null);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// Cache management
// ═══════════════════════════════════════════════════════════════════════════
describe('cache management', () => {

  it('cacheStatus() returns correct shape for each cached table', async () => {
    const cs = await page.evaluate(async () => {
      await window.DataProvider.read('bookings');
      await window.DataProvider.read('reviews');
      return window.DataProvider.cacheStatus();
    });
    assert.ok(cs.length >= 2, 'should have at least 2 cached tables');
    for (const entry of cs) {
      assert.ok('table' in entry, 'entry should have table');
      assert.ok('age_s' in entry, 'entry should have age_s');
      assert.ok('ttl_s' in entry, 'entry should have ttl_s');
      assert.ok('valid' in entry, 'entry should have valid');
      assert.ok('rows'  in entry, 'entry should have rows');
      assert.equal(typeof entry.valid, 'boolean');
      assert.equal(typeof entry.rows,  'number');
    }
  });

  it('clearAllCache() removes every hm_dp_ key from localStorage', async () => {
    const r = await page.evaluate(async () => {
      await window.DataProvider.read('bookings');
      await window.DataProvider.read('reviews');
      window.DataProvider.clearAllCache();
      return {
        lsKeys:      Object.keys(localStorage).filter(k => k.startsWith('hm_dp_')).length,
        statusEmpty: window.DataProvider.cacheStatus().length === 0,
      };
    });
    assert.equal(r.lsKeys,  0, 'no hm_dp_ keys should remain in localStorage');
    assert.ok(r.statusEmpty, 'cacheStatus() should be empty after clearAllCache()');
  });

});
