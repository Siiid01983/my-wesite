<?php
// Health check: GET <API_BASE>/  → { ok, db, time }
declare(strict_types=1);
require_once __DIR__ . '/_db.php';
hm_cors();
$dbOk = false;
try { hm_db()->query('SELECT 1'); $dbOk = true; } catch (Throwable $e) {}
hm_json(['ok' => true, 'db' => $dbOk, 'time' => date('c')]);
