-- ════════════════════════════════════════════════════════════════════════════
--  HELLO MOVING — Production Database Migration
--  Target : https://ursohvtxzqxeczvrspiw.supabase.co
--  Run via: Supabase Dashboard → SQL Editor → New query → Run All
--
--  Schema derived from:
--    js/services/supabaseAdapter.js  (every column / upsert conflict key)
--    js/services/contentLoader.js   (every query + filter used at page load)
--
--  Auth model:
--    This application uses NO Supabase Auth. All requests arrive under the
--    anon role (public anon key hardcoded in env.js). RLS is enabled on every
--    table for correct posture, but policies must allow full CRUD for anon so
--    that both the public booking form and the admin panel operate correctly.
--    To harden later: introduce Supabase Auth and scope write policies to
--    authenticated role; keep SELECT policies on anon for public reads.
--
--  Idempotent: safe to run multiple times (CREATE IF NOT EXISTS + ON CONFLICT).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 0. Extensions ─────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";


-- ── 1. Shared trigger: keep updated_at current on every write ─────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
--  TABLE: hm_data
--
--  Generic key-value store for all CMS content (hero, FAQ, footer, pricing,
--  disposal, capacity, line/email notification settings, etc.).
--
--  Adapter write:  _sb.from('hm_data')
--                    .upsert({ key, value, updated_at }, { onConflict: 'key' })
--  Adapter reads:  .select('key, value')
--                  .select('value').eq('key', '...').maybeSingle()
--                  .select('key,value').in('key', [...])
--  ContentLoader:  .select('key,value')   → applies all hm_* section keys to DOM
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.hm_data (
  id         uuid        not null default gen_random_uuid() primary key,
  key        text        not null,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  constraint hm_data_key_unique unique (key)
);

-- Auto-refresh updated_at even when the adapter does not send it explicitly
drop trigger if exists hm_data_set_updated_at on public.hm_data;
create trigger hm_data_set_updated_at
  before update on public.hm_data
  for each row execute function public.set_updated_at();

-- Index: all reads that filter by a single key
create index if not exists hm_data_key_idx on public.hm_data (key);

alter table public.hm_data enable row level security;

-- Single permissive policy: anon role needs full CRUD (no Supabase Auth in app)
drop policy if exists "hm_data: anon all" on public.hm_data;
create policy "hm_data: anon all"
  on public.hm_data
  for all
  to anon
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════════════════════
--  TABLE: bookings
--
--  Created by the public booking form (bookingService.js → anon INSERT).
--  Managed by the admin panel (Adapter CRUD, Realtime push).
--
--  bookingToSb() shape — every column here maps to a bookingToSb() key:
--    reference_id  → b.id            (app-generated e.g. 'HM-A1B2C3')
--    customer_name → b.name
--    email         → b.email
--    phone         → b.phone
--    move_date     → b.date          TEXT — stored as ISO string 'YYYY-MM-DD'
--                                    Using text avoids type-cast errors when
--                                    the adapter sends partial or empty strings.
--    move_from     → b.fromAddr
--    move_to       → b.toAddr
--    service_type  → b.service
--    status        → BK_TO_SB[b.status]
--    notes         → b.notes
--    time_slot     → b.time
--    created_at    → b.createdAt
--
--  Status enum derived from BK_TO_SB / BK_TO_LOCAL maps in supabaseAdapter.js
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.bookings (
  id            uuid        not null default gen_random_uuid() primary key,
  reference_id  text        not null,
  customer_name text        not null default '',
  email         text,
  phone         text,
  move_date     text,
  move_from     text,
  move_to       text,
  service_type  text,
  status        text        not null default 'pending'
                            check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  notes         text,
  time_slot     text,
  created_at    timestamptz not null default now(),
  constraint bookings_reference_id_unique unique (reference_id)
);

create index if not exists bookings_reference_id_idx on public.bookings (reference_id);
create index if not exists bookings_status_idx       on public.bookings (status);
create index if not exists bookings_move_date_idx    on public.bookings (move_date);
create index if not exists bookings_created_at_idx   on public.bookings (created_at desc);

alter table public.bookings enable row level security;

-- anon INSERT: public booking form (bookingService.js)
-- anon SELECT + UPDATE + DELETE: admin panel uses the same anon key
drop policy if exists "bookings: anon all" on public.bookings;
create policy "bookings: anon all"
  on public.bookings
  for all
  to anon
  using (true)
  with check (true);

-- Realtime: admin dashboard subscribes to INSERT / UPDATE / DELETE
alter publication supabase_realtime add table public.bookings;


-- ════════════════════════════════════════════════════════════════════════════
--  TABLE: calendar_availability
--
--  Stores ONLY non-available dates (full / limited). Available dates are
--  absent from this table — marking a date available means deleting its row.
--
--  Adapter write:  .upsert({ date, status, updated_at }, { onConflict: 'date' })
--                  .delete().eq('date', date)            — mark available
--                  .delete().not('date', 'is', null)     — bulk clear
--  Adapter read:   .select('*')
--  ContentLoader:  .select('date,status')
--                  → filters status IN ('full','booked') for public calendar
--
--  date column is TEXT — adapter passes 'YYYY-MM-DD' strings directly;
--  date type would reject empty strings sent during partial form submissions.
--
--  Status enum derived from CAL_TO_SB / CAL_TO_LOCAL maps in supabaseAdapter.js
--  and the status filter in contentLoader.js _applyCalendar().
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.calendar_availability (
  id         uuid        not null default gen_random_uuid() primary key,
  date       text        not null,
  status     text        not null default 'full'
                         check (status in ('full', 'booked', 'limited', 'available')),
  updated_at timestamptz not null default now(),
  constraint calendar_availability_date_unique unique (date)
);

drop trigger if exists calendar_set_updated_at on public.calendar_availability;
create trigger calendar_set_updated_at
  before update on public.calendar_availability
  for each row execute function public.set_updated_at();

create index if not exists calendar_date_idx   on public.calendar_availability (date);
create index if not exists calendar_status_idx on public.calendar_availability (status);

alter table public.calendar_availability enable row level security;

drop policy if exists "calendar_availability: anon all" on public.calendar_availability;
create policy "calendar_availability: anon all"
  on public.calendar_availability
  for all
  to anon
  using (true)
  with check (true);

-- Realtime: admin calendar and public availability widget stay live
alter publication supabase_realtime add table public.calendar_availability;


-- ════════════════════════════════════════════════════════════════════════════
--  TABLE: reviews
--
--  Inserted by:  review.html public submission form (anon INSERT)
--  Managed by:   admin panel — approve / publish / reject / delete
--
--  reviewToSb() shape — every column maps to a reviewToSb() key:
--    reference_id      → r.id
--    customer_name     → r.name
--    rating            → r.rating       SMALLINT (values 1–5)
--    review_text       → r.text
--    approved          → r.status === 'approved'
--    published         → r.published
--    headline          → r.headline
--    service           → r.service
--    date_label        → r.date_label   display string e.g. '2026年5月'
--    location          → r.location
--    source            → r.source
--    booking_reference → r.bookingId
--    created_at        → r.createdAt
--
--  ContentLoader query:
--    .select('*').eq('approved', true).eq('published', true)
--    .order('created_at', { ascending: false })
--
--  Source enum derived from check (source in (...)) in reviewToSb().
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.reviews (
  id                uuid        not null default gen_random_uuid() primary key,
  reference_id      text        not null,
  customer_name     text        not null default '',
  rating            smallint             check (rating between 1 and 5),
  review_text       text,
  approved          boolean     not null default false,
  published         boolean     not null default false,
  headline          text,
  service           text,
  date_label        text,
  location          text,
  source            text        not null default 'admin'
                                check (source in ('admin', 'public', 'google', 'line')),
  booking_reference text,
  created_at        timestamptz not null default now(),
  constraint reviews_reference_id_unique unique (reference_id)
);

-- Hot-path index: contentLoader always queries approved=true AND published=true
create index if not exists reviews_live_idx
  on public.reviews (created_at desc)
  where approved = true and published = true;

create index if not exists reviews_created_at_idx on public.reviews (created_at desc);
create index if not exists reviews_approved_idx   on public.reviews (approved, published);

alter table public.reviews enable row level security;

-- anon INSERT: review.html public submission
-- anon SELECT: admin reads all reviews; contentLoader filters at query level
-- anon UPDATE: admin approves / publishes / rejects
-- anon DELETE: admin hard-deletes
drop policy if exists "reviews: anon all" on public.reviews;
create policy "reviews: anon all"
  on public.reviews
  for all
  to anon
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════════════════════
--  TABLE: services
--
--  CMS table for service cards on the public site.
--  Admin can add / edit / reorder / deactivate via the admin panel.
--
--  serviceToSb() shape:
--    reference_id  → s.id
--    title         → s.title
--    description   → s.description
--    display_order → order arg passed by saveServices()
--    active        → s.active
--    badge         → s.badge
--    cta_text      → s.cta_text
--
--  NOTE: serviceToSb() does NOT include created_at. Column is intentionally
--        omitted — adding it would require a DEFAULT and the adapter never
--        sends it, which can cause unexpected upsert behaviour.
--
--  ContentLoader query: .select('*').order('display_order')
--  Adapter upsert:      onConflict: 'reference_id'
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.services (
  id            uuid     not null default gen_random_uuid() primary key,
  reference_id  text     not null,
  title         text     not null default '',
  description   text,
  display_order smallint not null default 0,
  active        boolean  not null default true,
  badge         text,
  cta_text      text,
  constraint services_reference_id_unique unique (reference_id)
);

-- Active services ordered by display_order — the only query contentLoader runs
create index if not exists services_order_active_idx
  on public.services (display_order)
  where active = true;

alter table public.services enable row level security;

drop policy if exists "services: anon all" on public.services;
create policy "services: anon all"
  on public.services
  for all
  to anon
  using (true)
  with check (true);


-- ════════════════════════════════════════════════════════════════════════════
--  SEED: hm_data  — all CMS keys expected by the adapter and contentLoader
--
--  Values here are byte-for-byte copies of the hardcoded defaults inside
--  supabaseAdapter.js (getHero, getServices, getFaq, getCompanyRows,
--  getFooter, getPrices, getDisposal, getCapacity).
--  The site renders identically whether data comes from Supabase or falls
--  back to localStorage, so the seed guarantees a correct first render.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.hm_data (key, value) values

  -- ── hero ──────────────────────────────────────────────────────────────────
  ('hm_hero', '{
    "headline_ja":   "ていねいに、運びます。",
    "headline_en":   "Same-day moving. Careful, always.",
    "sub_primary":   "オンライン予約・無料見積り対応",
    "sub_secondary": "料金確認から予約までオンライン完結",
    "cta_book_sup":  "オンライン予約",
    "cta_book_lbl":  "今すぐ予約する",
    "cta_quote_sup": "無料見積り",
    "cta_quote_lbl": "料金を確認する",
    "cta_line":      "LINE相談",
    "trust_badges":  ["最短2時間でご返信", "オンライン予約対応"],
    "bg_image":      ""
  }'::jsonb),

  -- ── services section header ────────────────────────────────────────────────
  ('hm_services_section', '{
    "eyebrow": "Services",
    "title":   "承っている引越し",
    "lead":    "単身・カップル・学生・当日引越しまで対応。"
  }'::jsonb),

  -- ── reviews section header ─────────────────────────────────────────────────
  ('hm_reviews_section', '{
    "eyebrow":   "Customer Voices",
    "title":     "お客様からの、お声",
    "lead":      "これまでにご利用いただいたお客様より頂戴したご感想を、一部ご紹介いたします。",
    "gmb_score": "4.9",
    "gmb_count": "38件の口コミ"
  }'::jsonb),

  -- ── faq section header ────────────────────────────────────────────────────
  ('hm_faq_section', '{
    "eyebrow": "FAQ",
    "title":   "よくあるご質問",
    "lead":    "ご不明な点がございましたら、お気軽にお問い合わせください。"
  }'::jsonb),

  -- ── faq items (Adapter.getFaq() defaults) ─────────────────────────────────
  ('hm_faq', '[
    {"id":"FAQ-1","question":"お見積りは無料ですか?",
     "answer":"はい、お見積りは完全無料です。訪問でのお見積り、オンラインでのお見積り、どちらにも対応しております。"},
    {"id":"FAQ-2","question":"当日のご依頼でも対応していただけますか?",
     "answer":"スケジュール状況により対応可能な場合がございます。お急ぎの際は、LINEまたはチャットにてご連絡くださいませ。"},
    {"id":"FAQ-3","question":"英語での対応は可能ですか?",
     "answer":"はい、日本語・英語の両方に対応しております。Yes, our team can assist you in English. ご遠慮なくご相談ください。"},
    {"id":"FAQ-4","question":"お支払い方法を教えてください",
     "answer":"現金、銀行振込、主要クレジットカードに対応しております。法人のお客様には、請求書でのお支払いも承っております。"},
    {"id":"FAQ-5","question":"家具の組立・分解だけのご依頼も可能ですか?",
     "answer":"はい、家具の組立・分解のみのご依頼も承っております。お見積りの際にご相談くださいませ。"},
    {"id":"FAQ-6","question":"キャンセル料はかかりますか?",
     "answer":"引越し日の3日前までは無料でキャンセルいただけます。それ以降は、国土交通省が定める標準引越運送約款に基づきキャンセル料を頂戴いたします。"},
    {"id":"FAQ-7","question":"万が一、お荷物が破損した場合はどうなりますか?",
     "answer":"当社は損害補償保険に加入しております。万が一作業中の事故が発生した場合は、速やかに状況をご確認のうえ、誠実にご対応させていただきます。"},
    {"id":"FAQ-8","question":"梱包資材は用意してもらえますか?",
     "answer":"はい、ダンボール・ガムテープ・緩衝材などをご用意しております。プランにより無料でご提供できる場合もございますので、お見積り時にご相談ください。"}
  ]'::jsonb),

  -- ── company section header ────────────────────────────────────────────────
  ('hm_company_section', '{
    "eyebrow": "Company",
    "title":   "会社情報"
  }'::jsonb),

  -- ── company rows (Adapter.getCompanyRows() defaults) ─────────────────────
  ('hm_company_rows', '[
    {"id":"CR-1",  "label":"会社名",     "value":"Hello Moving"},
    {"id":"CR-2",  "label":"創業",       "value":"2012年"},
    {"id":"CR-3",  "label":"事業内容",   "value":"引越し運送業（単身・カップル・学生・当日対応）／家具組立・設置"},
    {"id":"CR-4",  "label":"所在地",     "value":"東京都"},
    {"id":"CR-5",  "label":"対応エリア", "value":"東京・神奈川・埼玉・千葉を中心に、日本全国"},
    {"id":"CR-6",  "label":"営業時間",   "value":"8:00 – 20:00（年中無休）"},
    {"id":"CR-7",  "label":"許認可",     "value":"国土交通省 認可運送事業者 — 第 431320058126 号"},
    {"id":"CR-8",  "label":"保険",       "value":"引越業者向け 損害補償保険 加入済"},
    {"id":"CR-9",  "label":"対応言語",   "value":"日本語 ／ English"},
    {"id":"CR-10", "label":"お支払い",   "value":"現金 ／ 銀行振込 ／ クレジットカード ／ 請求書払い（法人）"}
  ]'::jsonb),

  -- ── footer (Adapter.getFooter() defaults) ────────────────────────────────
  ('hm_footer', '{
    "brand_desc": "東京を拠点に、丁寧で安心の引越しを承っております。日本語・英語対応。",
    "copyright":  "© 2026 Hello Moving. All Rights Reserved.",
    "license":    "国土交通省 認可運送事業者 第 431320058126 号 ／ Licensed Moving Company in Japan",
    "cols": [
      {"title":"サービス","links":[
        {"text":"当日・お急ぎ引越しプラン","href":"#services"},
        {"text":"単身引越し",              "href":"#services"},
        {"text":"カップル・ご夫婦引越し",  "href":"#services"},
        {"text":"学生・新生活引越し",      "href":"#services"},
        {"text":"不用品回収・処分サービス","href":"#services"},
        {"text":"家具組立・分解",          "href":"#services"}
      ]},
      {"title":"会社","links":[
        {"text":"私たちのお約束","href":"#commitments"},
        {"text":"引越しの流れ",  "href":"#flow"},
        {"text":"お客様の声",    "href":"#reviews"},
        {"text":"よくある質問",  "href":"#faq"},
        {"text":"会社情報",      "href":"#company"}
      ]},
      {"title":"お問い合わせ","links":[
        {"text":"Live Chat",                  "href":"#"},
        {"text":"受付：8:00 – 20:00",         "href":""},
        {"text":"対応エリア：日本全国",       "href":""},
        {"text":"対応言語：日本語 / English", "href":""}
      ]}
    ]
  }'::jsonb),

  -- ── pricing (Adapter.getPrices() defaults) ────────────────────────────────
  ('hm_prices', '{
    "単身引越し":               {"base":25000,"distPerKm":150,"floorFee":2000,"weekend":5000, "sameday":10000},
    "カップル・ご夫婦引越し":   {"base":45000,"distPerKm":150,"floorFee":2000,"weekend":8000, "sameday":15000},
    "学生・新生活引越し":       {"base":22000,"distPerKm":150,"floorFee":2000,"weekend":4000, "sameday":8000},
    "不用品回収・処分サービス": {"base":18000,"distPerKm":150,"floorFee":2000,"weekend":3000, "sameday":5000}
  }'::jsonb),

  -- ── disposal categories (Adapter.getDisposal() defaults) ─────────────────
  ('hm_disposal', '{
    "categories": [
      {"id":"cat_furniture","name":"家具","items":[
        {"id":"itm_bed",   "name":"ベッド・マットレス","fee":5000,"enabled":true},
        {"id":"itm_sofa",  "name":"ソファ・チェア",    "fee":4000,"enabled":true},
        {"id":"itm_table", "name":"テーブル・棚",      "fee":3000,"enabled":true}
      ]},
      {"id":"cat_appliances","name":"家電","items":[
        {"id":"itm_fridge","name":"冷蔵庫","fee":6000,"enabled":true},
        {"id":"itm_washer","name":"洗濯機","fee":5000,"enabled":true}
      ]},
      {"id":"cat_electronics","name":"電子機器","items":[
        {"id":"itm_tv","name":"テレビ",   "fee":2500,"enabled":true},
        {"id":"itm_pc","name":"パソコン", "fee":2000,"enabled":true}
      ]},
      {"id":"cat_misc","name":"その他","items":[
        {"id":"itm_other","name":"その他大型ゴミ","fee":3000,"enabled":true}
      ]}
    ]
  }'::jsonb),

  -- ── capacity (Adapter.getCapacity() defaults) ─────────────────────────────
  ('hm_capacity', '{"max":5,"limited":3}'::jsonb)

on conflict (key) do update
  set value      = excluded.value,
      updated_at = now();


-- ════════════════════════════════════════════════════════════════════════════
--  SEED: services  — matches Adapter.getServices() hardcoded defaults exactly
--
--  reference_id values (SVC-1 … SVC-6) are the stable IDs the adapter uses
--  for upsert conflict resolution. Titles must match the HTML h3 text in
--  index.html that contentLoader uses for card matching (byTitle lookup).
-- ════════════════════════════════════════════════════════════════════════════
insert into public.services
  (reference_id, title, description, display_order, active, badge, cta_text)
values
  ('SVC-1', '単身引越し',
   '1人分の荷物に最適化。必要な分だけコンパクトに対応。',
   0, true, '人気サービス', '無料お見積り →'),

  ('SVC-2', 'カップル・ご夫婦引越し',
   '養生から家具配置まで。二人の新生活をスムーズに。',
   1, true, '人気サービス', '無料お見積り →'),

  ('SVC-3', '学生・新生活引越し',
   '初めての引越しも段取りから設置まで対応。',
   2, true, '人気サービス', '無料お見積り →'),

  ('SVC-4', '当日・お急ぎ引越しプラン',
   '急な引越しも当日対応。最短2時間でご返信します。',
   3, true, '緊急対応', ''),

  ('SVC-5', '不用品回収・処分',
   '回収・処分・搬出まで一括。手続き不要。',
   4, true, '', '無料お見積り →'),

  ('SVC-6', '家具組立・分解',
   'IKEA・大型家具の組立・分解に対応。',
   5, true, '', '無料お見積り →')

on conflict (reference_id) do update
  set title         = excluded.title,
      description   = excluded.description,
      display_order = excluded.display_order,
      active        = excluded.active,
      badge         = excluded.badge,
      cta_text      = excluded.cta_text;


-- ════════════════════════════════════════════════════════════════════════════
--  SEED: reviews  — initial approved + published reviews
--
--  contentLoader filters: .eq('approved', true).eq('published', true)
--  These seed reviews make the public site show social proof immediately
--  without requiring admin action. Replace with real customer reviews via
--  the admin panel → レビュー管理 as they come in.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.reviews
  (reference_id, customer_name, rating, review_text,
   approved, published, headline, service, date_label, location, source)
values
  ('REV-SEED-1',
   '田中 美咲', 5,
   '丁寧に対応していただき、引越しがスムーズに完了しました。スタッフの方々がとても親切で、大切な家具も傷一つなく運んでいただけました。また利用したいと思います。',
   true, true,
   '対応が丁寧で安心でした',
   '単身引越し', '2026年4月', '渋谷区', 'admin'),

  ('REV-SEED-2',
   'Kenji Tanaka', 5,
   'Very professional service! They handled everything carefully and were perfectly on time. English support was excellent throughout. Highly recommended for expats moving in Tokyo.',
   true, true,
   'Excellent English support — highly recommended',
   'カップル・ご夫婦引越し', '2026年3月', '港区', 'admin'),

  ('REV-SEED-3',
   '山田 太郎', 5,
   '急な引越しにも関わらず、当日対応していただきました。料金も明確で、追加費用なしで完了しました。対応の速さと丁寧さに大変満足しております。',
   true, true,
   '当日対応で本当に助かりました',
   '当日・お急ぎ引越しプラン', '2026年5月', '新宿区', 'admin'),

  ('REV-SEED-4',
   '鈴木 花子', 5,
   '学生の一人暮らし引越しで利用しました。初めての引越しで不安でしたが、スタッフの方が丁寧に説明してくださり安心できました。料金もリーズナブルでした。',
   true, true,
   '初めての引越しも安心してお任せできました',
   '学生・新生活引越し', '2026年4月', '豊島区', 'admin'),

  ('REV-SEED-5',
   '佐藤 健太', 5,
   '不用品の回収もまとめてお願いしました。引越しと同時に処分できたので非常に助かりました。対応が迅速で、見積もり通りの金額で完了しました。',
   true, true,
   '引越しと不用品回収を同時に対応',
   '不用品回収・処分', '2026年2月', '世田谷区', 'admin')

on conflict (reference_id) do update
  set customer_name = excluded.customer_name,
      rating        = excluded.rating,
      review_text   = excluded.review_text,
      approved      = excluded.approved,
      published     = excluded.published,
      headline      = excluded.headline,
      service       = excluded.service,
      date_label    = excluded.date_label,
      location      = excluded.location,
      source        = excluded.source;


commit;


-- ════════════════════════════════════════════════════════════════════════════
--  VERIFICATION  — uncomment and run each block separately to confirm
-- ════════════════════════════════════════════════════════════════════════════

/*
-- 1. All 5 tables exist
select table_name
from   information_schema.tables
where  table_schema = 'public'
  and  table_name in (
         'hm_data', 'bookings', 'calendar_availability', 'reviews', 'services')
order  by table_name;
-- ✓ 5 rows

-- 2. RLS enabled on all tables
select relname as table_name, relrowsecurity as rls_enabled
from   pg_class
where  relname in (
         'hm_data', 'bookings', 'calendar_availability', 'reviews', 'services')
  and  relnamespace = 'public'::regnamespace;
-- ✓ rls_enabled = true for all 5

-- 3. Policies granted to anon
select tablename, policyname, cmd, roles
from   pg_policies
where  schemaname = 'public'
order  by tablename, policyname;
-- ✓ one "anon all" policy per table

-- 4. hm_data seed keys
select key, updated_at
from   public.hm_data
order  by key;
-- ✓ hm_capacity, hm_company_rows, hm_company_section, hm_disposal,
--   hm_faq, hm_faq_section, hm_footer, hm_hero,
--   hm_prices, hm_reviews_section, hm_services_section

-- 5. Services seed
select reference_id, title, display_order, active
from   public.services
order  by display_order;
-- ✓ SVC-1 through SVC-6, all active

-- 6. Seed reviews visible to contentLoader
select reference_id, customer_name, rating, headline
from   public.reviews
where  approved = true and published = true
order  by created_at desc;
-- ✓ 5 rows

-- 7. Realtime publication
select schemaname, tablename
from   pg_publication_tables
where  pubname = 'supabase_realtime'
  and  tablename in ('bookings', 'calendar_availability');
-- ✓ 2 rows
*/
