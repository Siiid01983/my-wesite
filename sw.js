'use strict';

/* ════════════════════════════════════════════════════════
   HELLO MOVING — SERVICE WORKER  (Phase 17)
   ════════════════════════════════════════════════════════
   Strategy:
     Static assets (JS/CSS/HTML)  → cache-first (pre-cached on install)
     Google Fonts CSS              → stale-while-revalidate
     Google Font files             → cache-first
     CDN bundles (jsdelivr)        → cache-first on first access
     Supabase API                  → network-only (DataProvider handles fallback)
     Google OAuth/API              → network-only
     Everything else same-origin  → cache-first with network fallback

   Bump CACHE_VERSION to force cache replacement on next deploy.
   ════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v6';
const STATIC_CACHE  = 'hm-static-' + CACHE_VERSION;
const FONT_CACHE    = 'hm-fonts-'  + CACHE_VERSION;
const ALL_CACHES    = [STATIC_CACHE, FONT_CACHE];

/* Static assets to pre-cache on install.
   env.js is optional (may be absent in some deployments) — handled gracefully. */
const PRECACHE = [
  /* Pages */
  '/index.html',
  '/admin.html',
  '/review.html',
  '/admin-reviews.html',

  /* Public site */
  '/styles.css',
  '/script.js',
  '/bookingService.js',
  '/calendarService.js',

  /* Admin entry points */
  '/admin-bookings.js',
  '/admin-analytics.js',

  /* Infrastructure */
  '/js/lib/supabase.js',
  '/js/config/appConfig.js',
  '/js/services/supabaseClient.js',
  '/js/services/supabaseAdapter.js',
  '/js/services/statisticsService.js',
  '/js/services/fallbackLogger.js',
  '/js/services/dataProvider.js',
  '/js/services/healthCheck.js',
  '/js/services/serviceRegistry.js',
  '/js/services/contentLoader.js',

  /* Core */
  '/js/core/auth.js',
  '/js/core/eventBus.js',
  '/js/core/stateManager.js',
  '/js/core/navigation.js',
  '/js/core/appBootstrap.js',

  /* Utils */
  '/js/utils/formatters.js',
  '/js/utils/dom.js',
  '/js/utils/storage.js',
  '/js/utils/validators.js',
  '/js/utils/pdf.js',
  '/js/utils/swRegister.js',

  /* Feature modules */
  '/js/modules/dashboard/dashboard.js',
  '/js/modules/calendar/calendar.js',
  '/js/modules/calendar/gcalSync.js',
  '/js/modules/capacity/capacity.js',
  '/js/modules/pricing/pricing.js',
  '/js/modules/disposal/disposal.js',
  '/js/modules/quotes/quotes.js',
  '/js/modules/services/servicesEditor.js',
  '/js/modules/hero/hero.js',
  '/js/modules/reviews/reviewsEditor.js',
  '/js/modules/footer/footer.js',
  '/js/modules/company/company.js',
  '/js/modules/faq/faq.js',
  '/js/modules/backup/backup.js',
  '/js/modules/backup/csvReport.js',
  '/js/modules/notifications/email.js',
  '/js/modules/notifications/line.js',
  '/js/modules/changelog/changelog.js',
  '/js/modules/customers/customers.js',
  '/js/modules/media/media.js',
  '/js/modules/security/security.js',

  /* PWA assets */
  '/manifest.json',
  '/manifest-admin.json',
  '/icons/icon.svg',

  /* Phase 27 — Mobile Experience */
  '/mobile.css',
  '/js/modules/mobile/mobileNav.js',
  '/js/modules/mobile/mobileDash.js',
  '/js/modules/notifications/pushNotifications.js',
  '/js/modules/offline/offlineDB.js',
  '/js/modules/offline/offlineQueue.js',
  '/js/modules/camera/cameraCapture.js',

  /* Phase 28 — Website Management Center */
  '/websiteManagement.html',
  '/js/utils/i18n.js',
  '/js/modules/audit/auditLog.js',
  '/js/modules/website/wmcCore.js',
  '/js/modules/website/wmcPermissions.js',
  '/js/modules/website/wmcOverview.js',
  '/js/modules/website/wmcPages.js',
  '/js/modules/website/wmcBlog.js',
  '/js/modules/website/wmcSeo.js',
  '/js/modules/website/wmcTheme.js',
  '/js/modules/website/wmcDeploy.js',
  '/js/modules/website/wmcAnalytics.js',
  '/js/modules/wmc/pageManager.js',
  '/js/modules/wmc/wmcMedia.js',
  '/js/modules/wmc/blockEditor.js',
];

/* ── Install: pre-cache static assets ──────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      /* Cache each URL individually so one missing file (e.g. env.js) doesn't abort install */
      Promise.all(
        PRECACHE.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Skipped:', url, err.message))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

/* ── Activate: delete stale caches ─────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !ALL_CACHES.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Message: skip waiting on request from page ─────────── */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ── Push: display notification (Phase 27C) ─────────────── */
self.addEventListener('push', event => {
  const data  = event.data ? event.data.json().catch(() => ({})) : Promise.resolve({});
  event.waitUntil(
    data.then(d => self.registration.showNotification(
      d.title || 'Hello Moving Admin',
      {
        body:  d.body  || '',
        icon:  d.icon  || '/icons/icon.svg',
        badge: d.badge || '/icons/icon.svg',
        tag:   d.tag   || 'hm-admin',
        data:  d.data  || {},
      }
    ))
  );
});

/* ── Notification click: focus/open admin tab (Phase 27C) ── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const view = (event.notification.data && event.notification.data.view) || 'dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      /* Find existing admin tab */
      const adminClient = clients.find(c => c.url.includes('admin.html'));
      if (adminClient) {
        adminClient.focus();
        adminClient.postMessage({ type: 'NOTIFICATION_CLICK', view });
        return;
      }
      /* Open new tab */
      return self.clients.openWindow('/admin.html#' + view);
    })
  );
});

/* ── Fetch ──────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  /* Supabase API — network-only; DataProvider handles offline fallback */
  if (url.hostname.endsWith('.supabase.co')) return;

  /* Google auth/OAuth — never cache */
  if (url.hostname === 'accounts.google.com' ||
      url.hostname === 'oauth2.googleapis.com') return;

  /* Google Fonts CSS — stale-while-revalidate */
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(_staleWhileRevalidate(event.request, FONT_CACHE));
    return;
  }

  /* Google Font files — long-lived; cache-first */
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(_cacheFirst(event.request, FONT_CACHE));
    return;
  }

  /* CDN bundles (html2canvas, jsPDF, Supabase UMD) — cache-first on first access */
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('unpkg.com')) {
    event.respondWith(_cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  /* Google APIs (gapi, GIS) — network-only */
  if (url.hostname.endsWith('.googleapis.com') ||
      url.hostname === 'apis.google.com') return;

  /* Same-origin HTML navigation — network-first so pages are never stale */
  if (url.origin === self.location.origin && event.request.mode === 'navigate') {
    event.respondWith(_networkFirst(event.request, STATIC_CACHE));
    return;
  }

  /* Same-origin static assets (JS/CSS/images) — cache-first */
  if (url.origin === self.location.origin) {
    event.respondWith(_cacheFirst(event.request, STATIC_CACHE));
  }
});

/* ── Cache strategies ───────────────────────────────────── */
async function _cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('オフライン — このリソースはキャッシュされていません', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function _networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cache  = await caches.open(cacheName);
    const cached = await cache.match(request);
    return cached || new Response('オフライン — ページが利用できません', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

async function _staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fresh  = fetch(request)
    .then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);
  return cached || fresh;
}
