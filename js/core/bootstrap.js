/* ═══════════════════════════════════════════════════════════
   PUBLIC SITE BOOTSTRAP  —  js/core/bootstrap.js
   Single entry point for all service-layer scripts on index.html.

   Strict load order:
     supabase UMD → appConfig → env.js → supabaseClient
     → fallbackLogger → dataProvider → serviceRegistry
     → bookingService → contentLoader → swRegister

   window.__BOOTSTRAP__ = { stage, ready, error }

   Terminal states (always reached — no silent hangs):
     stage = 'complete'  ready = true   error = null
     stage = 'FAILED'    ready = false  error = <string>
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  window.__BOOTSTRAP__ = { stage: 'init', ready: false, error: null };

  /* ── Per-script load timeout ─────────────────────────── */
  var LOAD_TIMEOUT_MS = 30000;

  /* ── XSS-safe string helper ───────────────────────────── */
  function _esc(s) {
    return String(s || '').replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  /* ── Finalize error state — never throws ─────────────── */
  function _fail(stage, msg) {
    /* Set terminal state FIRST, before any DOM work that could throw */
    window.__BOOTSTRAP__.stage = 'FAILED';
    window.__BOOTSTRAP__.ready = false;
    window.__BOOTSTRAP__.error = msg || 'Unknown bootstrap error';

    try {
      var id = 'hm-boot-error';
      var el = document.getElementById(id);
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.setAttribute('role', 'alert');
        el.style.cssText =
          'position:fixed;top:0;left:0;right:0;z-index:99999;' +
          'background:#b91c1c;color:#fff;padding:14px 20px;' +
          'font:600 13px/1.5 system-ui,sans-serif;display:flex;' +
          'align-items:flex-start;gap:12px;' +
          'box-shadow:0 2px 8px rgba(0,0,0,.45)';
        (document.body || document.documentElement).prepend(el);
      }
      el.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>' +
        '<line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
        '<span>' +
        '<strong>Hello Moving — 初期化エラー</strong><br>' +
        'Stage: <code style="background:rgba(0,0,0,.3);padding:1px 6px;border-radius:3px;font-size:12px">' +
        _esc(stage) + '</code> &nbsp;·&nbsp; ' + _esc(window.__BOOTSTRAP__.error) +
        '</span>';
    } catch (domErr) {
      /* DOM injection failed — state is already set above, just log */
      console.error('[Bootstrap] _fail: DOM banner injection error:', domErr);
    }
  }

  /* ── Dynamic script loader with timeout ──────────────── */
  function _load(src) {
    return new Promise(function (resolve, reject) {
      var settled = false;

      function _settle(fn, arg) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      }

      /* Reject if neither onload nor onerror fires within LOAD_TIMEOUT_MS */
      var timer = setTimeout(function () {
        _settle(reject, new Error(
          'Script load timed out after ' + (LOAD_TIMEOUT_MS / 1000) + 's: ' + src
        ));
      }, LOAD_TIMEOUT_MS);

      var s = document.createElement('script');
      s.src = src;
      s.onload  = function () { _settle(resolve); };
      s.onerror = function () {
        _settle(reject, new Error('Failed to load script: ' + src));
      };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  /* ── Load with one retry after a fixed gap (boot-critical scripts) ──── */
  /* First attempt → on failure wait gapMs → retry once → then fail. */
  function _loadWithRetry(src, retries, gapMs) {
    return _load(src).catch(function (err) {
      if (retries <= 0) throw err;
      console.warn('[Bootstrap] ' + src + ' failed (' + err.message +
        ') — retrying once in ' + gapMs + 'ms');
      return new Promise(function (r) { setTimeout(r, gapMs); })
        .then(function () { return _loadWithRetry(src, retries - 1, gapMs); });
    });
  }

  /* ── Bootstrap sequence ──────────────────────────────── */
  function _boot() {
    var iife = (async function () {
      try {

        /* Stage 1 — Supabase UMD library */
        window.__BOOTSTRAP__.stage = 'supabase-lib';
        await _load('js/lib/supabase.js');
        if (typeof window.supabase === 'undefined') {
          throw new Error('supabase.js loaded but window.supabase is undefined');
        }

        /* Stage 2 — App config (one retry: attempt → 1s → retry → fail) */
        window.__BOOTSTRAP__.stage = 'app-config';
        await _loadWithRetry('js/config/appConfig.js', 1, 1000);

        /* Stage 3 — Credentials: try env.js (local dev), fall back to env.public.js (deployed) */
        window.__BOOTSTRAP__.stage = 'env';
        try {
          await _load('js/config/env.js');
        } catch (_) {
          /* env.js absent (e.g. GitHub Pages) — try the committed public-credential file */
          try {
            await _load('js/config/env.public.js');
          } catch (_2) {
            window.ENV = { ready: false };
          }
        }
        if (!window.ENV || !window.ENV.ready) {
          window.ENV = { ready: false };
          console.warn('[Bootstrap] No valid credentials found — running in static-content mode.');
        }

        /* Stage 4 — Supabase client */
        window.__BOOTSTRAP__.stage = 'supabase-client';
        await _load('js/services/supabaseClient.js');
        if (!window.SupabaseClient) {
          /* Not fatal — site renders static content; log clearly */
          console.warn('[Bootstrap] SupabaseClient is null — site will display static defaults. Check env.js credentials.');
        }

        /* Stage 5 — Fallback logger */
        window.__BOOTSTRAP__.stage = 'fallback-logger';
        await _load('js/services/fallbackLogger.js');

        /* Stage 6 — Data provider */
        window.__BOOTSTRAP__.stage = 'data-provider';
        await _load('js/services/dataProvider.js');

        /* Stage 7 — Service registry (must set window.__APP_READY__ = true) */
        window.__BOOTSTRAP__.stage = 'service-registry';
        await _load('js/services/serviceRegistry.js');
        if (!window.__APP_READY__) {
          throw new Error(
            'serviceRegistry.js loaded but window.__APP_READY__ was not set — ' +
            'script may have thrown a runtime error during execution'
          );
        }

        /* Stage 8 — Booking service */
        window.__BOOTSTRAP__.stage = 'booking-service';
        await _load('bookingService.js');

        /* Stage 9 — Content loader (auto-calls ContentLoader.init() on load) */
        window.__BOOTSTRAP__.stage = 'content-loader';
        await _load('js/services/contentLoader.js');

        /* Stage 10 — Service worker registration */
        window.__BOOTSTRAP__.stage = 'sw-register';
        await _load('js/utils/swRegister.js');

        /* ✓ All stages complete */
        window.__BOOTSTRAP__.stage = 'complete';
        window.__BOOTSTRAP__.ready = true;
        console.debug('[Bootstrap] complete — __APP_READY__:', window.__APP_READY__);

      } catch (e) {
        var msg = (e && e.message) ? e.message : String(e);
        console.error('[Bootstrap] FATAL at stage "' + window.__BOOTSTRAP__.stage + '":', msg);
        _fail(window.__BOOTSTRAP__.stage, msg);
      }
    })();

    /* Outer safety net: catches any secondary error that escapes the catch block
       (e.g. an exception thrown inside _fail's DOM manipulation before state was set).
       Ensures __BOOTSTRAP__ always reaches a terminal state. */
    iife.catch(function (e) {
      var msg = (e && e.message) ? e.message : String(e);
      console.error('[Bootstrap] Unhandled secondary error:', msg);
      if (!window.__BOOTSTRAP__.error) {
        /* _fail was not reached — set terminal state directly */
        window.__BOOTSTRAP__.stage = 'FAILED';
        window.__BOOTSTRAP__.ready = false;
        window.__BOOTSTRAP__.error = msg;
      }
    });
  }

  /* Run after HTML is parsed so document.body exists for error banner */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})();
