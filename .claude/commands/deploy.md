# Deploy to Production

Deploy the current working state to signalbouncer.com. This is a full commit + push + deploy workflow.

## Pre-flight checks

1. Run `npm test` — ALL tests must pass. If any fail, stop and report. Do not deploy broken code.
2. Run `git status` to review uncommitted changes. If there are none, skip to the "Deploy" section.
3. Run `git diff --stat` to summarize what's changed.
4. Run `git log --oneline -5` to see recent commit message style.

## Commit

1. Stage all relevant changed files. Exclude `.claude/settings.local.json`, `.env`, and any other secrets or local-only config.
2. Write a clear commit message:
   - First line: imperative summary under 72 chars describing what changed and why
   - Blank line, then bullet points for significant changes if the diff touches more than 5 files
   - End with: `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
3. Commit the changes.

## Push to GitHub

1. Push the current branch to `origin`: `git push origin main`
2. If push fails, stop and report — do not force push.

## Deploy to production server

The production server is a DigitalOcean droplet. Git pull does not work on the server (no deploy key). Use rsync instead.

1. Rsync application files to the server:
   ```
   rsync -avz \
     --exclude='.git' \
     --exclude='node_modules' \
     --exclude='.env' \
     --exclude='.claude' \
     --exclude='tests' \
     --exclude='coverage' \
     --include='services/***' \
     --include='middleware/***' \
     --include='routes/***' \
     --include='database.js' \
     --include='server.js' \
     --include='package.json' \
     --include='public/***' \
     --include='CLAUDE.md' \
     --exclude='*' \
     /Users/brain/metal-detect-tracker/ root@167.172.28.28:/var/www/signalbouncer/
   ```
2. If `package.json` changed (new/updated dependencies), run on the server:
   ```
   ssh root@167.172.28.28 'cd /var/www/signalbouncer && npm install --production'
   ```
3. Restart the app:
   ```
   ssh root@167.172.28.28 'pm2 restart signalbouncer'
   ```

## Post-deploy verification

Run these checks and report results:

1. Wait 2 seconds for the server to start, then check PM2 status:
   ```
   ssh root@167.172.28.28 'pm2 status signalbouncer'
   ```
   - Verify status is "online" (not "errored" or "stopped")
   - If status is "errored", run `ssh root@167.172.28.28 'pm2 logs signalbouncer --lines 20'` and report the error

2. Check HTTP status codes on key endpoints:
   ```
   curl -s -o /dev/null -w "%{http_code}" https://signalbouncer.com/
   curl -s -o /dev/null -w "%{http_code}" https://signalbouncer.com/api/auth/me
   ```
   - Landing page should return 200 or 302
   - `/api/auth/me` should return 401 (no token = unauthorized, proves the API is responding)

3. Report a summary: commit hash, files changed count, PM2 status, HTTP status codes.

## If something goes wrong

- If PM2 shows "errored": check logs, do NOT redeploy blindly. Report the error.
- If HTTP checks fail: check if PM2 is running, check logs for startup errors.
- If the site is down: the previous working code is in git history. To rollback:
  1. `git revert HEAD` locally
  2. Re-run this deploy process
