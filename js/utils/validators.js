'use strict';

/* ── Validators — form and data validation helpers ──
   Centralises repeated validation patterns spread across module files.
   Existing validation code in modules continues to work unchanged;
   these helpers are available for new code.
*/
window.Validators = (function () {
  return {
    /* Non-empty string after trim */
    required(value) {
      return typeof value === 'string' && value.trim().length > 0;
    },

    /* Minimum character length */
    minLength(value, min) {
      return typeof value === 'string' && value.length >= min;
    },

    /* Basic email format */
    email(value) {
      return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
    },

    /* Positive integer */
    positiveInt(value) {
      const n = parseInt(value, 10);
      return !isNaN(n) && n > 0;
    },

    /* Booking reference ID: HM-YYYYMMDD-XXXX */
    bookingId(value) {
      return typeof value === 'string' && /^HM-\d{8}-[A-Z0-9]{4}$/.test(value.trim());
    },

    /* Date string YYYY-MM-DD */
    dateString(value) {
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    },

    /* Star rating 1-5 */
    starRating(value) {
      const n = parseInt(value, 10);
      return !isNaN(n) && n >= 1 && n <= 5;
    },

    /* URL (loosely: starts with http/https or is empty) */
    url(value) {
      if (!value) return true; // optional
      return /^https?:\/\/.+/.test(value.trim());
    },
  };
})();
