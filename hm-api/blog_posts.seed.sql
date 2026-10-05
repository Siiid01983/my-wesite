-- ════════════════════════════════════════════════════════════════════════════
--  HELLO MOVING — blog_posts SEED (initial 3 Japanese articles)
--  File: hm-api/blog_posts.seed.sql
--
--  PURPOSE
--    Ready-to-import seed for the public blog. INSERTs three published articles
--    into the existing `blog_posts` table (see hm-api/blog_posts.schema.sql).
--    Content is Markdown (rendered by js/blog/blogPublic.js).
--
--  IMPORT (manual / admin-approved only — NOT run automatically):
--    cPanel → phpMyAdmin → (select DB) → Import → choose this file
--      OR:  mysql -u <user> -p <db> < hm-api/blog_posts.seed.sql
--
--  SAFETY
--    • INSERT statements only. No UPDATE / DELETE / DROP / ALTER / TRUNCATE /
--      REPLACE / CREATE. Non-destructive.
--    • UUID ids, reference_ids and slugs are fixed + unique (import once).
--    • status = 'published'; published_at = NOW() so the real publish date is
--      stamped at import time (no fabricated date). Edit published_at if you
--      prefer a specific editorial date.
--    • No fake author/byline (author left NULL). No invented prices/stats/
--      reviews/awards — only verified facts (licensed carrier, Tokyo/Kanto).
-- ════════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

START TRANSACTION;

-- ── Article 1 (featured) ─────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('b1f7c0a2-3d4e-4a6b-8c1d-0e2f3a4b5c61',
   'seed-2026-hikkoshi-junbi-checklist',
   'hikkoshi-junbi-checklist',
   '東京で引越しするときの準備チェックリスト',
   '## 引越し準備は「いつ・何を」やるかで決まる
東京での引越しは、やることが多く、つい直前になって慌ててしまいがちです。スムーズに終えるいちばんのコツは、作業を時系列で分けて、少しずつ進めておくことです。

このページでは、引越しが決まってから当日までにやるべきことを、チェックリスト形式でまとめました。上から順に進めれば、手続きの抜け漏れや荷造りの遅れを防げます。

## 2週間前までにやること
引越し日が決まったら、まずは全体の段取りを整えます。この時期の準備が、後半の慌ただしさを大きく減らします。

### 引越し業者を手配する
- 引越しの日取りと時間帯の希望を決める
- 荷物の量をおおまかに把握する(大型家具・家電の有無)
- 見積もりを依頼し、作業範囲を確認する

料金が気になる場合は、[引越し料金を安くする方法](/article.html?slug=hikkoshi-ryokin-setsuyaku)もあわせてご覧ください。

### 不用品を整理する
- 使っていない家具・家電を仕分ける
- 粗大ごみは自治体の収集日を早めに確認する
- 運ぶ荷物を減らすほど、作業も費用も軽くなります

### 旧居・新居の条件を確認する
- エレベーターの有無、階数、前面道路の広さ
- 新居の間取りと、大型家具を置く場所
- 搬入経路(廊下・玄関・階段)の幅

## 1週間前までにやること
荷造りと各種手続きを本格的に進める時期です。毎日使うもの以外は、この週にほとんど箱へ詰めてしまいます。

### 荷造りのコツ
- 使う頻度の低いものから詰める
- 箱の側面に「中身」と「置く部屋」を書く
- 重いものは小さい箱、軽いものは大きい箱へ

### 住所変更・ライフラインの手続き
- 電気・ガス・水道の移転連絡(開始・停止)
- インターネット回線の移転手続き
- 転出届(引越し前)・転入届(引越し後)

一人暮らしの手続きは見落としがちです。詳しくは[単身引越しで準備しておくべきこと](/article.html?slug=tanshin-hikkoshi-junbi)も参考になります。

## 前日までにやること
- 冷蔵庫・洗濯機の水抜き
- 当日使うもの(貴重品・充電器・着替え)を一つの箱にまとめる
- 新居のレイアウトを最終確認

## 当日に忘れないもの
- 貴重品・印鑑・各種書類
- スマートフォンと充電器
- すぐ使う日用品(トイレットペーパー・タオルなど)

## 困ったときは早めの相談を
荷物が多い、大型家具がある、スケジュールがタイトといった場合は、早めに相談しておくと当日がスムーズです。Hello Moving は東京・関東エリアを中心に、国土交通省の認可を受けて営業している引越し会社です(認可番号:第431320058126号)。

まずは荷物量や日程を伝えて、[無料見積もり](/#booking)で作業内容と費用の目安を確認してみてください。',
   '引越しが決まってから当日までにやることを、2週間前・1週間前・前日・当日の時系列チェックリストで整理。手続き漏れや荷造りの遅れを防ぐ、東京の引越し準備ガイドです。',
   CAST('["準備"]' AS JSON),
   CAST('["引越し準備","東京","チェックリスト"]' AS JSON),
   'published',
   1,
   NOW());

-- ── Article 2 ────────────────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('c2e8d1b3-4e5f-4b7c-9d2e-1f3a4b5c6d72',
   'seed-2026-hikkoshi-ryokin-setsuyaku',
   'hikkoshi-ryokin-setsuyaku',
   '引越し料金を安くする方法',
   '## 引越し料金は「工夫」で変わる
引越しの費用は、同じ荷物でも、時期や頼み方によって変わります。無理な節約ではなく、ちょっとした工夫で抑えられるポイントを押さえておきましょう。

## 時期・曜日・時間帯を見直す
### 繁忙期を避ける
- 3月〜4月の引越しシーズンは需要が集中しやすい
- 可能なら、落ち着いた時期へ日程をずらす

### 曜日・時間帯を柔軟にする
- 平日は土日より予約が取りやすい傾向があります
- 開始時刻を業者に任せる「フリー便」は費用を抑えやすい

## 運ぶ荷物を減らす
運ぶ量が減れば、トラックの大きさや作業時間も変わります。

- 使っていない家具・家電を事前に処分する
- 衣類や本など、量の多いものを見直す
- 当日までに荷造りを済ませておく

## 見積もりを正確に伝える
当日の追加費用を防ぐには、最初の見積もりが大切です。

- 荷物量や大型家具・家電を正確に伝える
- 搬入経路やエレベーターの有無を共有する
- 不明点は事前に質問しておく

## 自分でできる作業は自分で
- 荷造り・荷ほどきを自分で行う
- 小物は自家用車で運ぶ
- ダンボールを早めに用意する

## まとめ
- 時期と時間帯を柔軟にする
- 運ぶ荷物を減らす
- 見積もりを正確に伝える

これらを組み合わせるだけでも、費用の目安は見えやすくなります。準備全体の流れは[東京で引越しするときの準備チェックリスト](/article.html?slug=hikkoshi-junbi-checklist)に、一人暮らしの方は[単身引越しで準備しておくべきこと](/article.html?slug=tanshin-hikkoshi-junbi)にまとめています。

正確な費用は荷物量や条件で変わります。Hello Moving は東京・関東エリア対応の認可事業者です。まずは[無料見積もり](/#booking)で、ご自身の条件に合った目安を確認してみてください。',
   '同じ荷物でも、時期・曜日・頼み方で引越し費用は変わります。繁忙期を避ける、荷物を減らす、見積もりを正確に伝えるなど、今日からできる節約のコツをまとめました。',
   CAST('["費用"]' AS JSON),
   CAST('["引越し料金","節約","見積もり"]' AS JSON),
   'published',
   0,
   NOW());

-- ── Article 3 ────────────────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('d3f9e2c4-5f6a-4c8d-ae3f-2a4b5c6d7e83',
   'seed-2026-tanshin-hikkoshi-junbi',
   'tanshin-hikkoshi-junbi',
   '単身引越しで準備しておくべきこと',
   '## 単身引越しは「身軽さ」が強み
一人暮らしの引越しは、荷物が比較的少なく、段取り次第でとてもスムーズに進みます。一方で、手続きや当日の作業を一人でこなすため、事前準備が仕上がりを左右します。

## まずは荷物の量を把握する
- ベッド・冷蔵庫・洗濯機など大型のものを確認する
- 運ぶもの・処分するものを分ける
- 荷物が少なければ、小さめのプランで足りる場合もあります

## 荷造りの進め方
### 早めに始める
- 季節外の衣類や使わない物から詰める
- 1日1箱でも、積み重ねると当日が楽になります

### 箱を管理する
- 箱に「中身」と「新居での置き場所」を書く
- 貴重品・すぐ使う物は別にまとめる

## 忘れやすい手続き
一人暮らしだと、手続きをすべて自分で行う必要があります。

- 住民票の異動(転出届・転入届)
- 電気・ガス・水道の移転
- インターネット回線の移転
- 郵便の転送届
- 運転免許証などの住所変更

## 当日をスムーズにするコツ
- 当日使う物を一つの箱にまとめておく
- 新居の掃除は搬入前に済ませておくと楽
- 大型家具の配置をあらかじめ決めておく

## 大型家具・家電は無理をしない
冷蔵庫や洗濯機、ベッドなどは、一人での運搬が難しく、思わぬケガや破損につながることがあります。不安があるときは、無理をせず業者に任せるのが安全です。

費用を抑えたい方は[引越し料金を安くする方法](/article.html?slug=hikkoshi-ryokin-setsuyaku)を、全体の段取りは[東京で引越しするときの準備チェックリスト](/article.html?slug=hikkoshi-junbi-checklist)もご覧ください。

Hello Moving は東京・関東エリア対応の認可事業者で、単身の引越しにも対応しています。荷物量や日程を伝えて、[無料見積もり](/#booking)で費用と作業内容の目安を確認してみてください。',
   '一人暮らしの引越しをスムーズに進めるための準備ガイド。荷造り・忘れやすい手続き・当日のコツを、単身の視点で整理しました。初めての引越しでも安心です。',
   CAST('["準備"]' AS JSON),
   CAST('["単身引越し","一人暮らし","手続き"]' AS JSON),
   'published',
   0,
   NOW());

COMMIT;

-- End of seed. 3 articles inserted (status = published).
