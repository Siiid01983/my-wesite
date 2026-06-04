const ftp = require('basic-ftp');
const path = require('path');

const HOST = 'hello-moving.com'; // أو عنوان الـ FTP الخاص بك
const USER = 'hellom41';
const PASSWORD = 'Uscarugo2291@';
const REMOTE = '/public_html';
const FILES = ['index.html', 'styles.css', 'script.js', 'admin.html', 'googlec5d2ce7d783fdc89.html', 'sitemap.xml'];

if (!HOST || !USER || !PASSWORD) {
  console.error('Missing credentials. Run as:\n');
  console.error('  $env:FTP_HOST="ftp.yourdomain.com"; $env:FTP_USER="user"; $env:FTP_PASS="pass"; node deploy.js\n');
  process.exit(1);
}

(async () => {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    console.log(`Connecting to ${HOST}...`);
    await client.access({ host: HOST, user: USER, password: PASSWORD, secure: false });
    console.log('Connected.');

    await client.ensureDir(REMOTE);
    console.log(`Remote dir: ${REMOTE}`);

    for (const file of FILES) {
      const local = path.join(__dirname, file);
      const remote = REMOTE + '/' + file;
      process.stdout.write(`  Uploading ${file}... `);
      await client.uploadFrom(local, remote);
      console.log('done');
    }

    console.log(`\n✓ Deploy complete — ${FILES.length} files uploaded to ${REMOTE}`);
  } catch (err) {
    console.error('\n✗ Deploy failed:', err.message);
    process.exit(1);
  } finally {
    client.close();
  }
})();
