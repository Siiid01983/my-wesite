-- ════════════════════════════════════════════════════════════════════════════
--  validate-admin-auth.sql — MySQL validation checks for the admin_users table.
--  Run against the staging DB after migration:
--      mysql -u <user> -p hellom41_staging < tests/validate-admin-auth.sql
--  Every check prints PASS/FAIL so the result is greppable.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Table exists
SELECT IF(COUNT(*) = 1, 'PASS: admin_users table exists', 'FAIL: admin_users missing') AS check_table
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'admin_users';

-- 2. Required columns present (spec: id,email,pass_hash,role,active,must_change_password,last_login,created_at)
SELECT IF(COUNT(*) = 8, 'PASS: all required columns present',
          CONCAT('FAIL: only ', COUNT(*), '/8 required columns')) AS check_columns
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'admin_users'
  AND column_name IN ('id','email','pass_hash','role','active','must_change_password','last_login','created_at');

-- 3. Email is uniquely indexed (no duplicate admins)
SELECT IF(COUNT(*) >= 1, 'PASS: unique index on email', 'FAIL: email not unique') AS check_unique
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'admin_users'
  AND non_unique = 0 AND column_name = 'email';

-- 4. At least one ACTIVE admin exists (seed succeeded, login is possible)
SELECT IF(COUNT(*) >= 1, CONCAT('PASS: ', COUNT(*), ' active admin(s)'),
          'FAIL: no active admin — run admin-migrate.php') AS check_seed
FROM admin_users WHERE active = 1 AND role = 'admin';

-- 5. No plaintext passwords — every hash is a bcrypt/argon hash
SELECT IF(COUNT(*) = 0, 'PASS: all passwords are hashed',
          CONCAT('FAIL: ', COUNT(*), ' row(s) with non-hashed pass_hash')) AS check_hashed
FROM admin_users
WHERE pass_hash NOT LIKE '$2y$%' AND pass_hash NOT LIKE '$2b$%' AND pass_hash NOT LIKE '$argon2%';

-- 6. Roles are constrained to the allowed set
SELECT IF(COUNT(*) = 0, 'PASS: roles within {admin,manager}',
          CONCAT('FAIL: ', COUNT(*), ' row(s) with an unexpected role')) AS check_roles
FROM admin_users WHERE role NOT IN ('admin','manager');

-- 7. Row count (informational evidence for the deployment report)
SELECT CONCAT('INFO: admin_users row count = ', COUNT(*)) AS row_count FROM admin_users;
