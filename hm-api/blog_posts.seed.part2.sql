-- ════════════════════════════════════════════════════════════════════════════
--  HELLO MOVING — blog_posts SEED (articles 4–10)
--  File: hm-api/blog_posts.seed.part2.sql
--
--  Companion to hm-api/blog_posts.seed.sql (articles 1–3). Import BOTH files so
--  all internal links between articles resolve. INSERT-only, non-destructive.
--
--  IMPORT (manual / admin-approved only):
--    cPanel → phpMyAdmin → (select DB) → Import → choose this file
--      OR:  mysql -u <user> -p <db> < hm-api/blog_posts.seed.part2.sql
--
--  SAFETY: no UPDATE/DELETE/DROP/ALTER/TRUNCATE/REPLACE/CREATE. Fixed+unique
--  ids/reference_ids/slugs. status='published'; published_at=NOW() (real import
--  date, not fabricated). No fake author. Only verified facts (licensed carrier,
--  Tokyo/Kanto) — no invented prices/stats/reviews/awards.
-- ════════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

START TRANSACTION;

-- ── Article 4 ────────────────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('e4a0b1c2-6a7b-4d9e-8f40-3b5c6d7e8f94',
   'seed-2026-hikkoshi-fuyohin-shobun',
   'hikkoshi-fuyohin-shobun',
   '引越し前に不用品を処分する方法',
   '## 引越しは不用品を見直すチャンス
引越しは、家の中のものを一度すべて手に取る数少ない機会です。使っていないものを運ぶと、作業も費用も増えてしまいます。早めに仕分けて、身軽に新生活を始めましょう。

## まずは「使う・使わない」で仕分ける
- 1年以上使っていないものは手放す候補にする
- 新居で置き場所があるかを基準にする
- 迷ったものは一時保留の箱にまとめる

荷物を減らすと費用にも良い影響があります。詳しくは[引越し料金を安くする方法](/article.html?slug=hikkoshi-ryokin-setsuyaku)をご覧ください。

## 処分方法を選ぶ
不用品の出し方にはいくつかの方法があります。量や品目に合わせて選びましょう。

### 自治体の回収を使う
- 粗大ごみは収集日が決まっているため、早めに申し込む
- 家電リサイクル法の対象(テレビ・冷蔵庫・洗濯機・エアコン)は別の手続きが必要

### まだ使えるものは譲る・売る
- リサイクルショップやフリマアプリを活用する
- 引き取り手が決まるまでに時間がかかる場合もある

### 回収サービスにまとめて依頼する
- 量が多い、時間がない、大型家具があるときに便利
- 分別や運び出しの手間を減らせる

## 早めに動くほど選択肢が増える
処分には申し込みや収集日の都合があり、直前だと間に合わないこともあります。引越しが決まったら、準備の早い段階で取りかかるのがおすすめです。全体の流れは[東京で引越しするときの準備チェックリスト](/article.html?slug=hikkoshi-junbi-checklist)にまとめています。

Hello Moving では不用品回収・処分にも対応しています。処分したいものの量や種類を伝えて、[無料見積もり](/#booking)でまとめて相談してみてください。',
   '引越し前の不用品を無理なく処分する方法を解説。使う・使わないの仕分け、自治体回収・譲渡・回収サービスの選び方と、早めに動くメリットをまとめました。',
   CAST('["不用品"]' AS JSON),
   CAST('["不用品処分","粗大ごみ","引越し"]' AS JSON),
   'published', 0, NOW());

-- ── Article 5 ────────────────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('f5b1c2d3-7b8c-4e0f-9a51-4c6d7e8f9a05',
   'seed-2026-hikkoshi-toujitsu-checklist',
   'hikkoshi-toujitsu-checklist',
   '引越し当日にやることチェックリスト',
   '## 当日は「段取り」で決まる
引越し当日は、短い時間で搬出から搬入までを一気に進めます。事前に流れを頭に入れておくと、当日の迷いや待ち時間を減らせます。

## 搬出前にやること
- 貴重品・すぐ使う物を手元にまとめておく
- 冷蔵庫・洗濯機の水が抜けているか確認する
- スマートフォンの充電を済ませておく

冷蔵庫の下準備がまだの方は[引越しで冷蔵庫を運ぶ前にやること](/article.html?slug=reizouko-mizunuki)を先に確認してください。

## 旧居での搬出
- 大きい家具・家電から運び出す
- 搬出後、忘れ物がないか各部屋・収納を確認する
- 電気・ガス・水道の停止や鍵の返却を確認する

## 新居での搬入
- 大型家具の配置をあらかじめ決めておくとスムーズ
- 箱は「置く部屋」ごとに運び入れる
- 搬入後、破損や傷がないかその場で確認する

## 当日の持ち物チェック
- 貴重品・印鑑・各種書類
- 新居と旧居の鍵
- すぐ使う日用品(トイレットペーパー・タオルなど)

## 当日を気持ちよく終えるために
当日に慌てないいちばんのコツは、前日までの準備です。段取り全体は[東京で引越しするときの準備チェックリスト](/article.html?slug=hikkoshi-junbi-checklist)にまとめています。

荷物量や作業範囲に不安があるときは、Hello Moving の[無料見積もり](/#booking)で事前に相談しておくと安心です。',
   '引越し当日の流れを、搬出前の準備から旧居の搬出・新居の搬入・持ち物チェックまで整理。当日の迷いや待ち時間を減らす当日ガイドです。',
   CAST('["当日"]' AS JSON),
   CAST('["引越し当日","チェックリスト","搬出搬入"]' AS JSON),
   'published', 0, NOW());

-- ── Article 6 ────────────────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('a6c2d3e4-8c9d-4f10-ab62-5d7e8f9a0b16',
   'seed-2026-kaden-kagu-unpan',
   'kaden-kagu-unpan',
   '引越しでテレビ・PC・家具を安全に運ぶ方法',
   '## 大切なものほど「運ぶ前の準備」が肝心
テレビやパソコン、大型家具は、運搬中のちょっとした衝撃で傷ついたり故障したりすることがあります。品目に合わせた梱包と運び方を知っておきましょう。

## テレビの梱包
- 電源を切り、ケーブル類は外して分かるように印をつける
- 画面を保護材で覆い、立てた状態で運ぶ
- 購入時の箱があれば活用する

## パソコン・精密機器
- 事前にデータのバックアップを取っておく
- 本体は衝撃に弱いため、緩衝材でしっかり包む
- 小さな部品やケーブルは一つの袋にまとめる

## 大型家具
### 食器棚・本棚
- 中身をすべて出してから運ぶ
- 扉や引き出しは開かないように固定する

### ベッド・テーブル
- 分解できるものは分解して運ぶと安全
- ネジなどの部品はなくさないようまとめておく

組み立てや分解に不安がある場合は、無理をせず業者に任せるのも一つの方法です。

## 運ぶときの共通のコツ
- 重いものは腰ではなく膝を使って持ち上げる
- 通路や角で家具をぶつけないよう、養生材を使う
- 運ぶ順番(大きいものから)を決めておく

当日の流れは[引越し当日にやることチェックリスト](/article.html?slug=hikkoshi-toujitsu-checklist)、冷蔵庫の準備は[引越しで冷蔵庫を運ぶ前にやること](/article.html?slug=reizouko-mizunuki)も参考になります。

Hello Moving は家具の組立・分解にも対応しています。不安な品目があれば、[無料見積もり](/#booking)で運搬方法も含めて相談してみてください。',
   'テレビ・パソコン・大型家具を傷つけず運ぶための梱包と運び方のコツ。品目別の注意点と、運搬時に共通するポイントをまとめました。',
   CAST('["梱包"]' AS JSON),
   CAST('["梱包","家電","家具"]' AS JSON),
   'published', 0, NOW());

-- ── Article 7 ────────────────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('b7d3e4f5-9d0e-4a21-bc73-6e8f9a0b1c27',
   'seed-2026-mitsumori-point',
   'mitsumori-point',
   '引越しの見積もりで確認すべきポイント',
   '## 見積もりは「料金」だけで選ばない
引越しの見積もりは、金額だけでなく作業の中身まで確認することが大切です。内容をそろえて比べると、当日の思わぬ追加費用を防げます。

## 料金の内訳を確認する
- 基本料金に何が含まれているか
- 追加料金が発生する条件(階段作業・遠方・時間指定など)
- ダンボールや梱包材の費用の有無

費用を抑える工夫は[引越し料金を安くする方法](/article.html?slug=hikkoshi-ryokin-setsuyaku)にまとめています。

## 作業範囲を確認する
- 梱包・荷ほどきはどこまで対応してもらえるか
- 大型家具の分解・組み立ての有無
- 搬入経路やエレベーターの状況を共有できているか

## 条件を正確に伝える
見積もりの精度は、伝える情報の正確さで決まります。

- 荷物量や大型家具・家電の有無
- 旧居・新居の階数、エレベーターの有無
- 希望日・時間帯の柔軟さ

## 不明点はその場で質問する
- キャンセルや日程変更の扱い
- 当日の作業人数の目安
- 補償やトラブル時の対応

準備全体の流れは[東京で引越しするときの準備チェックリスト](/article.html?slug=hikkoshi-junbi-checklist)をご覧ください。

Hello Moving では、荷物量や条件を伺ったうえで作業内容と費用の目安をご案内します。まずは[無料見積もり](/#booking)で気軽にご相談ください。',
   '引越しの見積もりで必ず確認したいポイントを解説。料金の内訳・作業範囲・条件の伝え方・質問すべき点を押さえ、当日の追加費用を防ぎます。',
   CAST('["見積もり"]' AS JSON),
   CAST('["見積もり","引越し費用","比較"]' AS JSON),
   'published', 0, NOW());

-- ── Article 8 ────────────────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('c8e4f5a6-0e1f-4b32-8d84-7f9a0b1c2d38',
   'seed-2026-hikkoshi-tetsuzuki',
   'hikkoshi-tetsuzuki',
   '一人暮らしの引越しで忘れやすい手続き',
   '## 手続きは「一覧化」で抜け漏れを防ぐ
引越しでは、荷造りと並んで多くの手続きが必要になります。特に一人暮らしはすべて自分で行うため、早めに一覧にして一つずつ片づけるのが安心です。

## 役所関連の手続き
- 転出届(引越し前の市区町村)
- 転入届(引越し後の市区町村・原則14日以内)
- マイナンバーの住所変更
- 国民健康保険・年金の住所変更(該当する場合)

単身の準備全体は[単身引越しで準備しておくべきこと](/article.html?slug=tanshin-hikkoshi-junbi)にまとめています。

## ライフラインの手続き
- 電気・ガス・水道の停止と開始
- インターネット回線の移転(工事が必要な場合は早めに)
- ガスの開栓は立ち会いが必要なことが多い

## 住所変更が必要なもの
- 運転免許証
- 銀行・クレジットカード
- 携帯電話・各種サブスク
- 郵便物の転送届(旧住所宛の郵便を新住所へ)

## 手続きのコツ
- 引越し前にできるもの・後にするものを分ける
- 平日しかできない手続きは、休みの予定に合わせる
- 完了したらリストにチェックを入れる

段取り全体は[東京で引越しするときの準備チェックリスト](/article.html?slug=hikkoshi-junbi-checklist)も参考になります。

荷物の運搬は、Hello Moving の[無料見積もり](/#booking)で日程と合わせて相談しておくと、当日までの計画が立てやすくなります。',
   '一人暮らしの引越しで見落としがちな手続きを一覧化。役所・ライフライン・住所変更・郵便転送まで、抜け漏れを防ぐチェックリストです。',
   CAST('["手続き"]' AS JSON),
   CAST('["住所変更","手続き","ライフライン"]' AS JSON),
   'published', 0, NOW());

-- ── Article 9 ────────────────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('d9f5a6b7-1f2a-4c43-9e95-8a0b1c2d3e49',
   'seed-2026-reizouko-mizunuki',
   'reizouko-mizunuki',
   '引越しで冷蔵庫を運ぶ前にやること',
   '## 冷蔵庫は「前日までの準備」が必要
冷蔵庫は、電源を切ってすぐに運べる家電ではありません。水抜きや霜取りをしないと、運搬中の水漏れや故障の原因になります。前日までに準備しておきましょう。

## 1. 中身を空にする
- 食品は使い切るか、クーラーボックスに移す
- 製氷機の氷も捨てておく

## 2. 電源を抜く(前日が目安)
- 運ぶ前日までにコンセントを抜く
- 霜取りと内部の乾燥に時間がかかるため、早めに行う

## 3. 霜取りをする
- 自動霜取りでない場合は、霜が溶けるのを待つ
- 溶けた水はタオルなどで拭き取る

## 4. 水抜きをする
- 蒸発皿(排水受け)にたまった水を捨てる
- 機種によって場所が異なるため、取扱説明書を確認する

## 5. 運ぶ準備
- 扉が開かないようにテープや固定具で留める
- 立てた状態で運ぶ(横倒しは故障の原因になりやすい)

## 新居に着いてからの注意
運搬後すぐに電源を入れず、しばらく時間を置いてから通電するのが安心です。設置して安定させてから使い始めましょう。

ほかの家電・家具の運び方は[引越しでテレビ・PC・家具を安全に運ぶ方法](/article.html?slug=kaden-kagu-unpan)、当日の流れは[引越し当日にやることチェックリスト](/article.html?slug=hikkoshi-toujitsu-checklist)をご覧ください。

大型家電の運搬に不安があれば、Hello Moving の[無料見積もり](/#booking)で相談してみてください。',
   '冷蔵庫を運ぶ前に必要な水抜き・霜取り・固定の手順を解説。水漏れや故障を防ぐための前日までの準備と、新居での注意点をまとめました。',
   CAST('["家電"]' AS JSON),
   CAST('["冷蔵庫","水抜き","家電"]' AS JSON),
   'published', 0, NOW());

-- ── Article 10 ───────────────────────────────────────────────────────────────
INSERT INTO blog_posts
  (id, reference_id, slug, title, content, excerpt, categories, tags, status, featured, published_at)
VALUES
  ('eaf6b7c8-2a3b-4d54-af06-9b1c2d3e4f5a',
   'seed-2026-kanto-area-hikkoshi',
   'kanto-area-hikkoshi',
   '東京・埼玉・千葉・神奈川間の引越しで注意すること',
   '## 近距離でも「段取り」は変わる
東京・埼玉・千葉・神奈川の間での引越しは、距離が近い分スムーズに思えますが、交通や搬入経路など、エリアならではの注意点があります。

## 交通・時間帯の注意
- 都心部は時間帯によって渋滞しやすい
- 幹線道路や橋の混雑を考え、時間に余裕をもつ
- 時間指定をしたい場合は、見積もり時に相談する

## 搬入・搬出経路の確認
- マンションのエレベーターの有無とサイズ
- 建物前の道路の幅やトラックの駐車スペース
- 大型家具が階段・玄関を通るか

経路や条件は見積もりの精度に関わります。詳しくは[引越しの見積もりで確認すべきポイント](/article.html?slug=mitsumori-point)をご覧ください。

## エリアごとの荷造りのコツ
- 近距離でも荷物の養生はしっかり行う
- 短時間での搬入に備え、箱に「置く部屋」を明記する
- 当日の持ち物は手元にまとめておく

準備全体の流れは[東京で引越しするときの準備チェックリスト](/article.html?slug=hikkoshi-junbi-checklist)にまとめています。

Hello Moving は東京・関東エリアを中心に対応しています。出発地と引越し先、荷物量を伝えて、[無料見積もり](/#booking)で最適な進め方を相談してみてください。',
   '東京・埼玉・千葉・神奈川の間で引越す際の注意点を解説。交通・時間帯・搬入経路・荷造りのコツなど、近距離でも押さえたいポイントをまとめました。',
   CAST('["エリア"]' AS JSON),
   CAST('["関東","近距離引越し","東京"]' AS JSON),
   'published', 0, NOW());

COMMIT;

-- End of seed (part 2). 7 articles inserted (status = published).
