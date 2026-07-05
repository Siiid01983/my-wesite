'use strict';

/* ════════════════════════════════════════════════════════
   SERVICE WORKER REGISTRATION  (Phase 17)
   Registers /sw.js, handles update notifications.
   Works on both public site and admin panel.
   ════════════════════════════════════════════════════════ */

(function () {
  if (!('serviceWorker' in navigator)) return;

  /* Service workers require a secure, non-opaque http(s) origin. Opening the
     page from a file:// URL or a sandboxed iframe yields location.origin ===
     'null', where register() throws "protocol of the current origin ('null')
     is not supported". Skip quietly there with a clear hint — the page must be
     served over http(s) to function at all (API_BASE also breaks on a null
     origin). This is the only context this guard changes; normal http/https
     loads are unaffected. */
  if (location.origin === 'null' || !/^https?:$/.test(location.protocol)) {
    console.info('[SW] Skipped — unsupported origin (' + location.origin +
      '). Open the site via its http(s):// URL, not a local file.');
    return;
  }

  /* Register */
  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then(reg => {
      /* Listen for a new SW found on this registration */
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            _showUpdateBanner(incoming);
          }
        });
      });

      /* Periodically check for updates (every 60 min) */
      setInterval(() => reg.update(), 60 * 60 * 1000);
    })
    .catch(err => console.warn('[SW] Registration failed:', err));

  /* Reload page after a new SW takes control — but only ONCE, and only when
     an OLDER worker is actually being replaced.
     - _refreshing guard: an activating worker that calls clients.claim() can
       fire controllerchange repeatedly and put the page into a reload loop.
     - first-claim guard: on a first-ever visit the page starts uncontrolled —
       the very first SW install claims it and fires controllerchange, but the
       page it claimed was just served fresh from the network. Reloading there
       gave every new visitor a visible reload ~1s after load, for no benefit.
       Swallow exactly that one event; any LATER controllerchange (even in the
       same session) means an older worker was replaced → reload as before. */
  let _awaitingFirstClaim = !navigator.serviceWorker.controller;
  let _refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_awaitingFirstClaim) { _awaitingFirstClaim = false; return; }
    if (_refreshing) return;
    _refreshing = true;
    window.location.reload();
  });

  function _showUpdateBanner(sw) {
    /* Remove any existing banner */
    document.getElementById('swUpdateBanner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'swUpdateBanner';
    Object.assign(banner.style, {
      position:        'fixed',
      bottom:          '24px',
      left:            '50%',
      transform:       'translateX(-50%)',
      zIndex:          '9999',
      background:      '#0a1f44',
      color:           '#fff',
      borderRadius:    '12px',
      padding:         '12px 20px',
      fontSize:        '13px',
      fontFamily:      "'Noto Sans JP','Inter',system-ui,sans-serif",
      display:         'flex',
      alignItems:      'center',
      gap:             '14px',
      boxShadow:       '0 8px 32px rgba(0,0,0,.35)',
      whiteSpace:      'nowrap',
    });

    const msg = document.createElement('span');
    msg.textContent = '新しいバージョンが利用可能です';

    const btn = document.createElement('button');
    btn.textContent = '今すぐ更新';
    Object.assign(btn.style, {
      background:   '#1D9E75',
      color:        '#fff',
      border:       'none',
      borderRadius: '8px',
      padding:      '6px 14px',
      cursor:       'pointer',
      fontSize:     '12px',
      fontWeight:   '600',
    });
    btn.onclick = () => {
      sw.postMessage({ type: 'SKIP_WAITING' });
      btn.textContent = '更新中…';
      btn.disabled = true;
    };

    const close = document.createElement('button');
    close.textContent = '✕';
    Object.assign(close.style, {
      background:   'transparent',
      color:        'rgba(255,255,255,.6)',
      border:       'none',
      cursor:       'pointer',
      fontSize:     '14px',
      padding:      '0 0 0 4px',
    });
    close.onclick = () => banner.remove();

    banner.appendChild(msg);
    banner.appendChild(btn);
    banner.appendChild(close);
    document.body.appendChild(banner);
  }
})();
