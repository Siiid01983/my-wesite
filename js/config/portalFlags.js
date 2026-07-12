'use strict';
/* ════════════════════════════════════════════════════════════════════════════
   Customer Portal feature flags — committed, versioned, DEFAULT-SAFE.

   CUSTOMER_PORTAL_V2_ENABLED gates the additive Phase-2 portal (portalV2.js).
   Default = false. With it false, portal.html behaves and appears EXACTLY as
   before — the V2 layer never initializes.

   Override precedence: if something set the flag BEFORE this file loads (e.g. a
   deploy-injected env.js, or a ?cpv2=1 dev toggle), that value is respected;
   otherwise it defaults to false.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  if (typeof window.CUSTOMER_PORTAL_V2_ENABLED === 'undefined') {
    window.CUSTOMER_PORTAL_V2_ENABLED = false;   // ← default OFF
  }
})();
