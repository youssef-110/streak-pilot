# Streak Pilot

Schedule real GitHub commits at exact times, from a hosted dashboard. Sign in with GitHub, pick (or create) a repository, set your daily times. Streak Pilot runs in the cloud, so your computer can stay off.

## Features

- **Sign in with GitHub.** Anyone can use it; each account is separate.
- **Exact timing.** Every user has their own Durable Object alarm, set to their next slot, in their own time zone (DST handled).
- **Many slots a day.** Up to 12 times a day, 1–20 commits each, per-slot weekdays and commit message (`{n}`, `{total}`, `{date}`, `{time}` placeholders).
- **Random delay** (up to 2 h, stable per day) if you want commits to look less regular.
- **Create a repository** from the dashboard, or pick one of yours. Warns when the branch is not the default branch (GitHub only counts commits there).
- **Dashboard:** live countdown to the next commit, upcoming runs, streak, totals, heatmap, run history with links to the commits.
- **Test run** button (rate limited to one per minute).
- **Pause** with one switch. **Delete account** erases data and revokes GitHub access.
- Runs never execute twice: each run has a unique key (`user:slot:local-date`). Transient GitHub errors retry up to 3 times. A revoked token stops the schedule and asks the user to reconnect.

## How it works

```
Browser ── /auth/* (GitHub OAuth) ──▶ Worker ──▶ D1 (users, slots, runs, sessions)
        ── /api/*                 ──▶ Worker ──▶ Scheduler Durable Object (one per user)
                                                   └─ alarm at next slot ─▶ GitHub Contents API
```

Each commit rewrites `.github/streak-pulse.txt` through the GitHub Contents API, authored as the signed-in user.

## Security

- GitHub tokens are encrypted with AES-GCM (`TOKEN_KEY` secret) before they are stored.
- Sessions are random tokens in `__Host-` HttpOnly, Secure, SameSite=Lax cookies; only their SHA-256 hash is stored.
- State-changing requests must carry a same-origin `Origin` header.
- Strict Content-Security-Policy on all pages (`public/_headers`).
- OAuth scope is `repo`, which GitHub requires to write to private repositories.

## Deploy (Cloudflare, free plan)

1. Create a GitHub OAuth App at <https://github.com/settings/applications/new>:
   - Homepage URL: `https://streak-pilot.<your-subdomain>.workers.dev`
   - Callback URL: `https://streak-pilot.<your-subdomain>.workers.dev/auth/callback`
2. Put the Client ID in `wrangler.jsonc` under `vars.GITHUB_CLIENT_ID`.
3. Create the database and secrets:

```bash
npx wrangler d1 create streak-pilot          # paste the id into wrangler.jsonc
npm run db:init
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put TOKEN_KEY            # any long random string; changing it signs everyone out of GitHub
npm run deploy
```

## Local development

`.dev.vars` (git-ignored) enables a fake GitHub and a dev sign-in, so nothing touches real repositories:

```
MOCK_GITHUB=1
DEV_LOGIN=1
TOKEN_KEY=local-dev-only-key
GITHUB_CLIENT_ID=dev
```

```bash
npm install
npm run db:init:local
npm run dev        # then open http://localhost:8787/auth/dev
npm test
```

## What GitHub counts

GitHub, not Streak Pilot, decides what shows on the contribution graph: the commit must be on the repository's default branch, authored by an email on your account, and private-repository contributions only show if "Private contributions" is enabled on your profile. Use the tool within GitHub's Terms of Service.

## License

MIT
