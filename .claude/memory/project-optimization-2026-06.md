---
name: project-optimization-2026-06
description: Full CRO/UX/SEO/CSS optimization pass — June 2026
metadata: 
  node_type: memory
  type: project
  originSessionId: 1a767379-5f62-4db2-b6c7-bbbd79e93c80
---

Completed June 2026. All changes applied directly to index.html and styles.css.

**Critical bugs fixed:**
- JSON-LD had broken `foundingDa\n  te` key (newline in property name) — fixed to `foundingDate`
- Duplicate CSS rule: `.cta-form label.full { margin-bottom: 24px; }` appeared twice — second removed
- `.legend-dot` referenced in a 640px media query but never defined — removed ghost rule
- `.btn-sm` used in HTML but never defined in CSS — added definition

**SEO updates:**
- meta description rewritten for emergency/same-day keywords
- meta keywords updated (removed 法人, added 当日引越し, お急ぎ引越し, 同日引越し)
- og:description updated; og:url added
- Schema updated: foundingDate fixed, description updated, hasOfferCatalog added

**Hero section:**
- Added .hero-badges strip (当日対応可 amber badge, 無料見積り, 最短2時間でご連絡)
- Added phone button to hero CTA (was only Quote + LINE; now Quote + Phone + LINE)
- Updated hero English subtitle to "Same-day moving. Careful, always."
- Updated lead text (removed オフィス reference)

**Trust strip:**
- Item 4 changed from "日本語/English" to "当日対応可 / 最短2時間でご連絡"

**Services:**
- service-grid changed from `repeat(auto-fit, minmax(300px,1fr))` to `repeat(3, 1fr)`
- Emergency card moved first, given .service-card-featured (grid-column:1/-1, horizontal 3-col layout, embedded phone+LINE CTAs)
- Removed: オフィス・法人移転, 外国人向け引越し
- section-lead updated (removed 法人 reference)

**Reviews:**
- Mr. Miller review: service type changed from 外国人向け引越し → 単身引越し
- 山田/オフィス移転 review replaced with 中村/当日引越しプラン emergency review

**Form:**
- Service dropdown: removed office + foreign options, Emergency moved to top, added empty default option
- form-intro: changed "1〜2営業日以内" → "当日〜翌営業日" with LINE/phone nudge for urgent

**Footer:** services list updated (removed 2, Emergency moved to top)

**Company table:** 事業内容 updated (removed 法人, added 当日対応)

**CSS additions:**
- :focus-visible global rule (navy outline)
- .btn-sm definition
- .hero-badges, .hero-badge, .hero-badge-urgent
- .service-card-featured and sub-elements (.service-featured-eyebrow, .service-featured-actions, .service-featured-body)
- Responsive rules for featured card at 1024px and 720px
- Mobile hero badges shrink at 768px

**Why:** See brief — highest conversion impact first. Emergency same-day is #1 lead-gen signal.
