<?php
// ════════════════════════════════════════════════════════════════════════════
//  import-reviews.php — one-time (idempotent) seed of real くらしのマーケット /
//  Curama reviews into the `reviews` table so they appear on the public 口コミ.
//
//  Reached at:  POST <API_BASE>/import-reviews.php?confirm=1   (X-API-KEY)
//  Idempotent:  each review's reference_id is a STABLE hash of its date+comment,
//               so re-running UPSERTs the same 20 rows (never duplicates).
//
//  Rows are inserted approved=1, published=1 (they are already public on Curama),
//  rating=5, source='curama'. They have NO booking_reference, so the public UI
//  correctly shows them WITHOUT the 認証済み badge (that is reserved for reviews
//  tied to a real booking). created_at is set to the review date for ordering.
//
//  SAFE TO LEAVE DEPLOYED: it only ever writes this fixed, embedded set — it does
//  not accept arbitrary review input. Remove after seeding if you prefer.
// ════════════════════════════════════════════════════════════════════════════
declare(strict_types=1);
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_db.php';

hm_cors();
hm_require_api_key();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST' || ($_GET['confirm'] ?? '') !== '1') {
  hm_json(['ok' => false, 'data' => null, 'error' => 'POST with ?confirm=1 required'], 400);
}

$reviews = json_decode(<<<'JSON'
[
 {"category":"格安引越し","date":"2026-06-11","comment":"荷物が増えたりテーブルや洗濯機が入らないなど色んなハプニングが起きましたが、すべて「大丈夫！」とテキパキ対応していただいて安心感があり、本当に助かりました！タワマンからの移動でしたがその点も全く問題なく、逆に予想よりかなり早く終わりました。これだけ柔軟に対応してくれてこのお値段はかなりお得感があります！ また、子供が瞬時に懐いてワイワイ楽しそうで、だんだん友達と一緒に引っ越してるみたいな感覚になり私まで楽しい気持ちになりました笑 明るい引越しができて嬉しいです！ また更新の時に引っ越すので、その時はぜひお願いしたいと思います。 この度は本当にありがとうございました！"},
 {"category":"格安引越し","date":"2026-05-26","comment":"この度は本当にありがとうございました。 最初のやり取りの時点からとても丁寧で、返信も早く、安心してお願いすることができました。 当日の作業も最初から最後まで本当に丁寧で、一つ一つ確認しながら進めてくださり、とても信頼できる方だと感じました。こちらが気になっていた部分についても親身になって対応してくださり、細かいところまで気を配っていただけて本当にありがたかったです。 作業中の説明もわかりやすく、気さくに話しかけてくれたので楽しく過ごせました。 仕上がりも大満足で、お願いして本当に良かったと思っています。 人柄もとても優しく、安心感のある方だったので、また何かあればぜひお願いしたいです。周りにも自信を持っておすすめできます。 本当にありがとうございました！"},
 {"category":"格安引越し","date":"2026-06-01","comment":"We were expecting the move to take 4 hours but we were done in 2 hours. My friend and I were not ready but for our mover, that was not a problem. You can see that he had multiple years of experience and knew exactly what to do even though we were not fully done packing/prepared. Need to break down a desk ? *No problem, grabs his tool Need to break down a sofa ? *No problem, disassembles fast like lightning. Have some items all around the house ? *No problem - brings extra boxes and packs everything away. From the beginning to the end, no problem at all ! I personally thought that the amount that were quoted was too small and I asked him to add 10,000 Yen to the total. He refuses but I insisted. Good work is expected. Superb work is commendable. For the type of excellent service that I got today, it for sure needs to be rewarded."},
 {"category":"格安引越し","date":"2026-06-05","comment":"本当にこちらの業者さんに頼んでよかったです！！！ 当日荷物が多くなってしまい、トラックに乗ら切るのか不安でしたが、上手いこと荷物同士の大きさを組み合わせて、無事引越しできました！しかも早くて、本当にプロの技でした！ 荷物が多くなってしまったにも関わらず、明るくコミュニケーションをとってくださったり、本当にこちらに依頼してよかったです。"},
 {"category":"格安引越し","date":"2026-06-02","comment":"初めての利用です！ 外人の方は初めてなので少し不安でしたが、とてもサービス精神旺盛！という感じで、めちゃくちゃ助かりました。 お値段も安く近距離の引越しの方は特にお勧めです！ また何かで利用したいです！"},
 {"category":"格安引越し","date":"2026-06-03","comment":"臨機対応に説明頂きながら対応してもらいました。 レビュー通りのご対応で本当に安心しましたし、 頼んで本当によかったです。 ありがとうございました。"},
 {"category":"格安引越し","date":"2026-06-04","comment":"今回２回目の引越し依頼です。 前回同様丁寧かつテキパキとした作業で、あっという間に積荷から荷下ろしが完了いたしました。 １点だけ、集合住宅の共用部分での作業中の会話が少し大きく気になりました。 作業に関する内容だと思いますが、廊下などは声が響くためもう少し抑えていただくと助かります。 とは言え、是非次の機会もお願いしたいと思います。 暑い中の作業、本当にありがとうございました。"},
 {"category":"格安引越し","date":"2026-06-06","comment":"ありがとうございます！ 急な変更にも快く対応していただけました！ また機会があればお願いします！"},
 {"category":"格安引越し","date":"2026-06-07","comment":"最高でした！ 安くて早くて丁寧でした！またお願いしたいです！ 引越しを検討している方は是非依頼することをお勧めします！"},
 {"category":"格安引越し","date":"2026-06-08","comment":"大きな家具もスムーズに入れていただきました！また機会があればよろしくお願いいたします。"},
 {"category":"格安引越し","date":"2026-06-09","comment":"とてもスムーズで入らないと思われたタンスも工夫して搬入してくれました。ありがとうございました。"},
 {"category":"格安引越し","date":"2026-06-10","comment":"手際よくご対応いただきました。ありがとうございました！"},
 {"category":"格安引越し","date":"2026-06-11b","comment":"事前に連絡したよりも荷物が増えてしまったのですが、全ての荷物を丁寧に運んでくださり、迅速に対応していただきました。 初めてくらしのマーケットを使ったのですがとても満足です。 ありがとうございました。"},
 {"category":"格安引越し","date":"2026-06-12","comment":"明るく元気に丁寧に搬出、搬入してくださいました。 電車で移動した私のほうが20分ほど時間かかってしまいましたが、時間調整して下さいました。 またお願いしたいです。"},
 {"category":"不用品回収 / 軽トラック","date":"2026-06-13","comment":"Hired プローmoving to help us move. We simply had a lot of stuff that we needed to get rid of. プローmoving came to the rescue. He helped us moved the day before and we were very happy. The next day, we went back to the old apartment to get rid of the old furniture , electronics etc that we did not need. We quickly noticed that it would take us an eternity to get rid of everything. We followed up with Pro Moving to see if he can take help with 不要品回収. He was more than happy literally a few hours after we made the request. To him \"the job was not done\" until we were able to move in peace to our new place. Mind you, today is a Sunday. He helped us move on a Saturday. He came and was able to take care of EVERYTHING that we needed to throw away and of course, in record speed. I said it before and I will say it again, highly recommend! The name プローmoving fits them well because they know what they are doing, they are fast and they actually care about the needs and wants of the customer instead of being 細かい about the most mundane and annoying things which is what we experienced with other movers that we tried to book on くらしのマーケット. A lot of questions, slow response speeds and to be honest an unwillingness to work with us even though we are near native Japanese speakers, went to school, lived and worked in Japan."},
 {"category":"格安引越し","date":"2026-06-14","comment":"仕事も早くて的確です。 人柄も良くて楽しい引っ越しでした。 また機会があればお願いします。"},
 {"category":"格安引越し","date":"2026-06-15","comment":"仕事が早くて、とても丁寧だった！スムーズに引越し作業が終わって本当に良かったです。不要な大型家電の破棄に困っていたので、格安で対応してもらえたのも本当に助かりました！また引っ越しがあればぜひお願いしたいです！"},
 {"category":"格安引越し","date":"2026-06-16","comment":"早くて丁寧で良かったです。設置サービスもして下さりました。"},
 {"category":"格安引越し","date":"2026-06-17","comment":"当日、荷物が増えてしまったのにも関わらず親切に対応して頂きありがとうございました。日本語も上手でコミュニケーションにも全く困ることはありませんでした。また機会があればお願いしたいなと思える方でした。"},
 {"category":"格安引越し","date":"2026-06-18","comment":"事前のメッセージのやり取りから迅速で丁寧な対応でした。当日の作業もテキパキと進めていただき、予想以上に早く終わりました。料金も事前の見積もり通りで大満足です。 廃棄する不用品も丁寧に確認して下さいました。 本当にありがとうございました。"}
]
JSON, true);

if (!is_array($reviews)) hm_json(['ok' => false, 'data' => null, 'error' => 'embedded JSON parse failed'], 500);

// YYYY-MM-DD (or a disambiguating suffix like 2026-06-11b) → "YYYY年M月".
function rv_date_label(string $d): string {
  if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $d, $m)) {
    return $m[1] . '年' . (int)$m[2] . '月';
  }
  return '';
}
function rv_created_at(string $d): string {
  if (preg_match('/^(\d{4}-\d{2}-\d{2})/', $d, $m)) return $m[1] . ' 12:00:00';
  return date('Y-m-d H:i:s');
}

$sql = 'INSERT INTO reviews
          (id, reference_id, customer_name, rating, review_text, approved, published, service, date_label, source, created_at)
        VALUES (?,?,?,?,?,1,1,?,?,\'curama\',?)
        ON DUPLICATE KEY UPDATE
          review_text = VALUES(review_text), rating = VALUES(rating),
          approved = 1, published = 1, service = VALUES(service),
          date_label = VALUES(date_label), created_at = VALUES(created_at)';

$done = 0; $errors = [];
$db = hm_db();
$st = $db->prepare($sql);
foreach ($reviews as $r) {
  $date    = (string)($r['date'] ?? '');
  $comment = trim((string)($r['comment'] ?? ''));
  if ($comment === '') continue;
  // Stable, idempotent reference id (date + short content hash).
  $refId = 'curama-' . preg_replace('/[^0-9a-z\-]/', '', $date) . '-' . substr(sha1($comment), 0, 10);
  try {
    $st->execute([
      hm_uuid4(),
      $refId,
      '',                                   // no customer name provided → anonymous
      5,
      $comment,
      (string)($r['category'] ?? ''),
      rv_date_label($date),
      rv_created_at($date),
    ]);
    $done++;
  } catch (Throwable $e) {
    $errors[] = ['ref' => $refId, 'err' => $e->getMessage()];
  }
}

// Invalidate any cached reviews reads so the public site reflects them at once.
if (function_exists('hm_cache_invalidate_table')) {
  try { hm_cache_invalidate_table('reviews'); } catch (Throwable $e) {}
}

hm_json(['ok' => true, 'data' => ['upserted' => $done, 'total' => count($reviews), 'errors' => $errors], 'error' => null]);
