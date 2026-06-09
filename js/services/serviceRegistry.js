(function () {
  'use strict';

  /* ── Service Layer ── */
  window.Services = window.Services || {};
  window.Services.Adapter           = window.Adapter           || null;
  window.Services.DataProvider      = window.DataProvider      || null;
  window.Services.ContentService    = window.ContentService    || null;
  window.Services.StatisticsService = window.StatisticsService || null;

  /* ── Core Layer ── */
  window.Services.Auth       = window.Auth       || null;
  window.Services.EventBus   = window.EventBus   || null;
  window.Services.AdminState = window.AdminState || null;

  /* ── Utility Layer ── */
  window.Services.Validators = window.Validators || null;
  window.Services.Storage    = window.Storage    || null;

  /* Signal that the full service registry has been populated */
  window.__APP_READY__ = true;

})();
