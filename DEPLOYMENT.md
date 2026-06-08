# Hello Moving — Deployment Guide

## Overview

Deployments are automated via GitHub Actions on every push to `main`.
Files are uploaded to cPanel shared hosting via FTPS using
[SamKirkland/FTP-Deploy-Action](https://github.com/SamKirkland/FTP-Deploy-Action).

The action maintains a `.ftp-deploy-sync-state.json` file in `public_html/` on the server.
Only **changed files** are uploaded on each run after the first deployment.

---

## 1. Required GitHub Secrets

Set these in **GitHub → Repository → Settings → Secrets and variables → Actions → New repository secret**.

| Secret name | Description | Example |
|---|---|---|
| `FTP_HOST` | cPanel hostname or IP | `ftp.hello-moving.com` or `123.45.67.89` |
| `FTP_USERNAME` | FTP username (cPanel login) | `hellomoving` |
| `FTP_PASSWORD` | FTP password | _(your cPanel password)_ |
| `FTP_PORT` | FTP port number | `21` |

> **Where to find these:** cPanel → FTP Accounts, or your hosting welcome email.

---

## 2. Workflow Triggers

| Event | Behaviour |
|---|---|
| Push to `main` | Full deploy — uploads changed files automatically |
| Manual dispatch | Go to **Actions → Deploy to cPanel → Run workflow**; optionally enable Dry Run |

### Dry Run

Enables the **Dry run** checkbox in the manual dispatch to list what *would* be uploaded
without actually transferring any files. Use this to verify exclusions before the first live deploy.

---

## 3. Deployment Target

```
FTP root:        /home/<username>/
Web root:        /home/<username>/public_html/
server-dir:      ./public_html/
```

If your site lives in a subdirectory (e.g. `public_html/hello-moving/`), update `server-dir`
in `.github/workflows/deploy.yml` accordingly.

---

## 4. Excluded Files

The following are never uploaded to production:

| Path | Reason |
|---|---|
| `.git*`, `.git*/**` | Git internals |
| `.github/**` | Workflow files — not needed on server |
| `node_modules/**` | Dev dependencies |
| `.claude/**` | Claude Code local settings |
| `tests/**` | Test suite |
| `serve.js` | Local dev server only |
| `package.json`, `package-lock.json` | Node package manifests |
| `CLAUDE.md` | Internal development docs |
| `js/config/env.js` | Supabase credentials (gitignored) |
| `**/*.test.js` | Any test files |

---

## 5. Protocol Notes

The workflow uses **FTPS (Implicit TLS, port 990)** by default (`protocol: ftps`).

| cPanel setup | Protocol to use | Port |
|---|---|---|
| Explicit TLS (most common) | `ftpes` | `21` |
| Implicit TLS | `ftps` | `990` |
| Plain FTP (not recommended) | `ftp` | `21` |

To change, edit `.github/workflows/deploy.yml` and update the `protocol` and `FTP_PORT` secret.

---

## 6. First Deployment

The first run uploads **all non-excluded files** and creates
`.ftp-deploy-sync-state.json` in `public_html/` on the server.
Subsequent runs diff against this state file and upload only changed files.

**Before the first deploy:**
1. Add all 4 GitHub Secrets (section 1 above).
2. Run a **Dry Run** via manual dispatch to verify the file list.
3. Check `server-dir` matches your actual web root path.
4. Push to `main` (or trigger manually) to deploy.

---

## 7. Rollback Instructions

### Option A — Revert to a previous commit (recommended)

```bash
# Find the commit hash to roll back to
git log --oneline -10

# Revert locally and push — triggers a new deploy
git revert HEAD --no-edit
git push origin main
```

This creates a new commit that undoes the last change and redeploys cleanly.

### Option B — Hard reset to a specific commit

```bash
# Identify the target commit hash
git log --oneline -10

# Reset to that commit
git reset --hard <commit-hash>
git push origin main --force
```

> Warning: force-push rewrites history. Only use if `git revert` is not suitable.

### Option C — Manual file restore via cPanel File Manager

1. Log into cPanel → **File Manager** → `public_html/`
2. Restore individual files from a backup (Backups → Restore)
3. Or re-upload specific files via FTP manually

### Option D — Manual workflow re-trigger

Go to **GitHub → Actions → Deploy to cPanel → select a previous successful run → Re-run jobs**.
This re-deploys the files from that run's commit.

---

## 8. Monitoring Deployments

- **GitHub:** Actions tab → Deploy to cPanel → view run logs
- **Status badge** (optional — add to README):

```markdown
![Deploy](https://github.com/Siiid01983/my-wesite/actions/workflows/deploy.yml/badge.svg)
```

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `530 Login incorrect` | Wrong credentials | Re-check `FTP_USERNAME` / `FTP_PASSWORD` secrets |
| `Connection refused` | Wrong host or port | Verify `FTP_HOST` and `FTP_PORT`; try `ftp.yourdomain.com` |
| `ECONNRESET` / TLS error | Protocol mismatch | Change `protocol: ftps` → `ftpes` or `ftp` in workflow |
| Files upload to wrong path | Wrong `server-dir` | Confirm web root path in cPanel File Manager |
| All files re-upload every run | Sync state file missing | Check `.ftp-deploy-sync-state.json` exists in `public_html/` |
| `env.js` credentials exposed | File not gitignored | Confirm `js/config/env.js` is in `.gitignore` |
