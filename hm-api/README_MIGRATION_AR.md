# الانتقال من Supabase إلى استضافة cPanel (PHP + MySQL)

هذا الدليل ينقل موقع Hello Moving من Supabase إلى خادم PHP/MySQL على استضافتك
(cPanel — dzsecurity.com) **دون أي وسيط خارجي**. المتصفح ينادي ملفات `hm-api/*.php`
فقط، وهي وحدها تتصل بقاعدة البيانات.

> **مهم:** الاتصال المباشر من المتصفح إلى MySQL غير ممكن وغير آمن (يكشف كلمة مرور
> القاعدة). طبقة PHP الرفيعة هذه هي البديل الآمن لـ Supabase.

---

## ما الذي تغيّر في الكود

| قبل (Supabase) | بعد (cPanel) |
|---|---|
| مكتبة `@supabase/supabase-js` (CDN) | `js/lib/supabase-shim.js` — عميل JS يحاكي نفس الواجهة |
| `supabase.co` REST/Realtime | `hm-api/rest.php` + polling في الـshim |
| Supabase Storage | `hm-api/storage.php` (رفع/تنزيل/روابط موقّعة) |
| Edge Function `send-email` | `hm-api/send-email.php` |
| دخول البوابة بـ Magic Link | دخول بـ **بريد + رقم حجز** (موجود أصلاً، عبر `PortalAuth`) |

**لم يتغيّر** أي من الوحدات الـ20 في `js/modules/` — لأنها كلها تمر عبر
`Adapter`/`DataProvider`/`SupabaseClient` التي تشير الآن إلى الـshim.

---

## خطوات النشر

### 1) إنشاء قاعدة البيانات في cPanel
1. cPanel → **MySQL® Databases**.
2. أنشئ قاعدة بيانات (مثل `dzsec_hellomoving`).
3. أنشئ مستخدماً وكلمة مرور قوية، ثم **Add User To Database** بصلاحيات **ALL PRIVILEGES**.
4. احفظ: اسم القاعدة، اسم المستخدم، كلمة المرور.

### 2) إنشاء الجداول
cPanel → **phpMyAdmin** → اختر القاعدة → **Import** → ارفع `hm-api/schema.mysql.sql` → Go.

### 3) (اختياري) نقل بياناتك الحالية من Supabase
ما دام مشروع Supabase حياً:
```bash
node tools/migrate-from-supabase.mjs --url https://<ref>.supabase.co --key <anon-key>
```
يُنشئ `hm-api/data-export.sql` → ارفعه في phpMyAdmin → Import (بعد المخطّط).

### 4) رفع ملفات الـ API
ارفع مجلد `hm-api/` كاملاً إلى استضافتك (داخل `public_html/hm-api` مثلاً)، ثم:
1. انسخ `_config.example.php` → `_config.php`.
2. عبّئ بيانات القاعدة (host/name/user/pass) و`allowed_origin` (مثل
   `https://www.dzsecurity.com`) و`storage_secret` (نص عشوائي طويل).
3. تأكد أن مجلد `_uploads/` قابل للكتابة (Permissions 755 أو 775).

### 5) ربط الواجهة بالـ API
في `js/config/env.public.js` (والمحلي `js/config/env.js` إن وُجد) اضبط:
```js
window.API_BASE = 'https://www.dzsecurity.com/hm-api'; // مسار مجلد hm-api
```
وفي GitHub أضف السرّ `API_BASE` بنفس القيمة (خط النشر يقرأه).

### 6) اختبار سريع
- افتح `https://www.dzsecurity.com/hm-api/` → يجب أن ترى `{"ok":true,"db":true,...}`.
- افتح الموقع العام: يجب أن تظهر الخدمات/المراجعات.
- جرّب حجزاً من نموذج الحجز → تحقق من ظهوره في لوحة الإدارة.
- لوحة الإدارة → ダッシュボード: لوحة "システム監視" يجب أن تكون online.
- البوابة `login.html`: ادخل ببريد + رقم حجز موجودين.

---

## قائمة تحقّق ما بعد النقل
- [ ] `hm-api/index.php` يرجع `db:true`.
- [ ] إنشاء حجز جديد ينعكس في الإدارة خلال ~12 ثانية (polling).
- [ ] تعديل التقويم/الأسعار/المحتوى يُحفظ ويظهر في الموقع العام.
- [ ] رفع صورة في البوابة يعمل (`storage.php`).
- [ ] إرسال بريد من صفحة المراسلات يصل (`send-email.php`؛ اضبط SPF/DKIM للنطاق).

## ملاحظات أمان
- `_config.php` و`_uploads/*.php` محميّة عبر `.htaccess`.
- لتشديد البوابة لاحقاً: انقل تحقّق "البريد+الرقم" إلى نقطة نهاية PHP مخصّصة
  بدل القراءة العامة لجدول الحجوزات (نفس نموذج anon السابق في Supabase).
- يمكن حذف `js/lib/supabase.js` ومجلد `supabase/` (لم تعد مستخدمة).
