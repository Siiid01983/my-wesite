---
name: admin-architecture
description: Phase 14 modular JS architecture — where every admin function lives after the admin-ui.js split
metadata: 
  node_type: memory
  type: project
  originSessionId: c2e2b131-943a-4529-9b93-587d19591065
---

Phase 14 (2026-06-07, commit 0b73573) split the monolithic `admin-ui.js` (5543 lines) into 30 domain-scoped files. `admin-ui.js` is still on disk but no longer loaded.

**Why:** Maintainability — max ~400 lines per file, one concern per folder.
**How to apply:** When editing or adding admin JS, put the code in the correct module file. Never re-add inline `<script>` to admin.html.

## Layer map

| Layer | Path | What lives here |
|---|---|---|
| Infrastructure | `js/services/` | Adapter, DataProvider, StatisticsService, FallbackLogger, HealthCheck, serviceRegistry |
| Core | `js/core/` | Auth, navigation (go/\_dpSync), appBootstrap (startup IIFE), EventBus, AdminState |
| Utilities | `js/utils/` | formatters, dom helpers, pdf, localStorage wrapper, validators |
| Data modules | `admin-bookings.js`, `admin-analytics.js` | CalendarService, BookingService, buildTable, emptyHTML, \_DOW\_JP, drawBarChart |
| Feature modules | `js/modules/` | One folder per admin section (20 total) |

## Module → function map

| Module file | Key functions |
|---|---|
| `js/core/auth.js` | `Auth` object — login, logout, changePassword, isLoggedIn, touch, startTimer |
| `js/core/navigation.js` | `go(view)`, `_dpSync(...)`, `VIEW_TITLES`, `calcStats()`, `toggleDark()` |
| `js/core/appBootstrap.js` | `init()`, `showLogin()`, `showApp()`, `showForceChange()`, `doForceChange()`, `logout()`, `handleForgot()`, login event listeners, startup IIFE |
| `js/core/eventBus.js` | `EventBus.on/off/emit/clear` |
| `js/core/stateManager.js` | `AdminState.get/set/subscribe/unsubscribe/snapshot` |
| `js/utils/formatters.js` | `MN`, `DN`, `pad`, `todayStr`, `isPast`, `fmtD`, `fmtDT`, `genId`, `esc`, `badge`, `toast` |
| `js/utils/pdf.js` | `_capturePrintHtml`, `_pdfDownload`, all `downloadPDF*` functions |
| `js/modules/dashboard/dashboard.js` | `renderDash`, `renderStatGrid`, `renderObservability`, `renderActivity`, `renderQA`, `_renderBI*`, `biSetTrend` |
| `js/modules/calendar/calendar.js` | `renderCalendar`, `calClick`, `calMove`, `toggleBulk`, `applyBulk`, `resetAvail`, `showFullBooked`, `printCalendar`, `_syncCalendarFromSupabase` |
| `js/modules/capacity/capacity.js` | `loadCapacity`, `saveCapacity`, `printCapacity`, `_syncCapacityFromSupabase` |
| `js/modules/pricing/pricing.js` | `renderPricing`, `savePricing`, `switchPricingTab`, `printPricing`, `PRICING_SERVICES`, `PRICING_FIELDS` |
| `js/modules/disposal/disposal.js` | `renderDisposal`, `saveDisposalCat`, `saveDisposalItem`, `toggleDisposalItem`, `printDisposal` |
| `js/modules/quotes/quotes.js` | `renderQuotes`, `deleteQuote`, `convertToBooking`, `printQuote`, `exportQuotesCSV` |
| `js/modules/services/servicesEditor.js` | `renderServices`, `saveServicesAll`, `openSvcModal`, `saveSvc`, `liveSvcPreview`, `renderSvcHistory` |
| `js/modules/hero/hero.js` | `renderHero`, `saveHero`, `liveHeroPreview`, `addHeroBadge`, `openHeroMediaPick`, `renderHeroHistory` |
| `js/modules/reviews/reviewsEditor.js` | `renderReviews`, `approveRev`, `rejectRev`, `saveReview`, `printReview`, `liveRevPreview`, `saveReviewsAll` |
| `js/modules/footer/footer.js` | `renderFooter`, `saveFooterAll`, `liveFooterPreview`, `addFooterLink`, `renderFooterHistory` |
| `js/modules/company/company.js` | `renderCompany`, `saveCompanyAll`, `saveCompanyRow`, `liveCompanyPreview`, `renderCompanyHistory` |
| `js/modules/faq/faq.js` | `renderFaq`, `saveFaqAll`, `saveFaqItem`, `liveFaqPreview`, `showPublicReviewForm`, `verifyPubBooking`, `submitPubReview` |
| `js/modules/backup/backup.js` | `exportBookingsJSON`, `exportFullBackup`, `handleImport`, `renderBackup` |
| `js/modules/backup/csvReport.js` | `exportCSV`, `importCSV`, `generateReport`, `printReport`, `printBackup`, `exportCustomersCSV`, `exportStatisticsJSON` |
| `js/modules/notifications/email.js` | `sendEmailNotif`, `renderEmail`, `saveEmailSettings`, `testEmailNotif` |
| `js/modules/notifications/line.js` | `sendLineNotif`, `renderLine`, `saveLineSettings`, `testLineNotif` |
| `js/modules/changelog/changelog.js` | `CHANGELOG`, `CHANGELOG_NEXT`, `CL_TYPE`, `CL_PRIORITY`, `renderChangelog` |
| `js/modules/customers/customers.js` | `renderCustomers`, `openCustModal`, `printCustomer`, `deleteCust`, `exportCustomersCSV` |
| `js/modules/media/media.js` | `MediaLib`, `renderMedia`, `handleMediaUpload`, `previewMediaItem`, `deleteMediaItem` |
| `js/modules/security/security.js` | `renderSecurity`, `renderHealth`, `_refreshHealth`, `_applyAppHealthBanner`, `doChangePassword` |

## Critical loading constraints

- `admin-analytics.js` must load before `js/modules/capacity/capacity.js` — `printCapacity` uses `_DOW_JP` defined in analytics.
- `admin-bookings.js` must load before `js/modules/dashboard/dashboard.js` — `renderDash` calls `buildTable` and `emptyHTML` from bookings.
- `js/core/appBootstrap.js` must be the last `<script>` tag — it contains the async startup IIFE.
- `js/services/serviceRegistry.js` loads after all services/core/utils so `window.Services` is fully populated.

## New utility globals (additive — existing code unchanged)

- `EventBus.on/emit/off` — typed wrapper over `document.dispatchEvent`
- `AdminState.get/set/subscribe` — reactive UI state (not wired to existing module vars yet)
- `Validators.required/email/bookingId/starRating/url` — input validation
- `Storage.get/set/getArray/pushToArray` — type-safe localStorage (note: `window.Storage` shadows browser's native `Storage` interface — consider renaming to `HMStorage`)
- `$id/$html/$show/$hide/$delegate` — DOM helpers in `js/utils/dom.js`
