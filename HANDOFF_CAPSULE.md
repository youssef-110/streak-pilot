# Streak Pilot — Handoff Capsule

## Goal

Streak Pilot is a free, self-hosted local web dashboard for scheduling GitHub commits. A user can choose multiple daily times, a number of commits per time slot (1–20), a commit message, time zone, target `owner/repository`, and branch. The service updates `.github/streak-pulse.txt` through GitHub's Contents API, which creates real commits.

The project was deliberately built without paid services, generated media, database hosting, or bundled credentials.

## Current project state

- Project directory: `C:\Users\rryou\Documents\Codex\2026-11-05\i-want-you-to-make-me\outputs\github-streak-dashboard`
- Git repository is initialized locally.
- Active branch: `main`
- Initial commit: `fb8341400c11bb6176f157aef2341a85fcd21be3` — `Initial Streak Pilot dashboard`
- The repository does **not** have a GitHub remote yet.
- GitHub CLI was installed but was not authenticated when checked: `gh auth status` reported no signed-in host.
- The local server was stopped on request. Port 8787 was checked afterward and had no listener.

## Files

```text
github-streak-dashboard/
├── .gitignore                 # Excludes runtime state, env files, node_modules
├── config.json                # User-editable initial schedule configuration
├── package.json               # Native Node scripts; no dependencies
├── README.md                  # Setup, security, and hosting guidance
├── server.mjs                 # API, scheduler, state persistence, GitHub API client
├── public/
│   └── index.html             # Complete dashboard UI, styles, and client logic
└── test/
    └── server.test.mjs        # Basic validation tests
```

## Technology and design

- Node.js 18+ native ESM; no package install is required.
- Uses Node's built-in `http`, `fetch`, filesystem, and test runner.
- Dashboard is a single polished HTML file with responsive CSS and vanilla client JavaScript.
- Server exposes JSON endpoints:
  - `GET /` — dashboard
  - `GET /api/config` — current configuration
  - `POST /api/config` — validates and saves configuration
  - `GET /api/status` — reports whether a GitHub token is configured and mock status
  - `POST /api/test-run` — runs the first schedule immediately
- Scheduler evaluates the local configured time zone every 30 seconds and prevents duplicate execution with `.streak-state.json`.
- Completion state is retained for the most recent 90 keys/days.

## How a real commit is made

1. `server.mjs` reads `GITHUB_TOKEN` only from the host environment.
2. It fetches the current SHA of `.github/streak-pulse.txt` in the configured repo and branch.
3. It PUTs fresh timestamp content to the GitHub Contents API with that SHA.
4. GitHub creates the commit. Repeated commits in the same slot are sequential so the SHA remains current.

The token is intentionally never accepted or stored by the UI or repository.

## Safe local run / test

Open PowerShell in the project directory:

```powershell
# Safe: performs no GitHub requests and makes no real commits.
$env:MOCK_GITHUB = "1"
npm start
```

Visit `http://localhost:8787` in a normal local browser. The in-app browser used during development could not reach the local server because its network context is isolated; this is not an application failure.

The test button in mock mode reports success without modifying GitHub.

## Production run

Create a fine-grained GitHub personal access token restricted to only the intended repository. Grant **Contents: Read and write**. Then use:

```powershell
$env:GITHUB_TOKEN = "REPLACE_WITH_TOKEN"
npm start
```

In the dashboard, set:

- repository as `owner/repository`
- desired target branch (normally `main`)
- IANA time zone, e.g. `Europe/Berlin`
- one or more time slots and desired commit count

Never put the token in `config.json`, source code, a commit message, or a screenshot.

## Tests already run

`npm test` passed successfully:

- accepts a conventional `owner/repository` format
- rejects an incomplete repository value

An integration smoke test was also run with `MOCK_GITHUB=1`:

- saved `octocat/hello-world` test configuration
- invoked `/api/test-run`
- confirmed a simulated two-commit result

The test configuration was reset before handoff. The default `config.json` now has an empty repository and a single 09:15 / one-commit example slot.

## Remaining work: create and push the GitHub repository

The user asked for this, but GitHub was not authenticated. Once the user completes `gh auth login`, use this sequence from the project directory:

```powershell
gh auth status
gh repo create github-streak-dashboard --private --source=. --remote=origin --push
```

Ask the user whether they want the repository public before replacing `--private` with `--public`; do not assume. If the desired repository name is already taken, choose a user-approved alternate such as `streak-pilot`.

After adding this handoff capsule, commit it before pushing:

```powershell
git add HANDOFF_CAPSULE.md
git commit -m "Add project handoff capsule"
git push
```

## Free 24/7 hosting options

The actual Node scheduler needs a process that stays alive.

1. Preferred no-subscription route: an always-on machine the user controls (home PC, Raspberry Pi, spare Linux machine). Use a restart-on-failure service manager, such as Windows Task Scheduler at boot or Linux `systemd` with `Restart=always`.
2. GitHub Actions in a public repository can be adapted for scheduled work, but GitHub's scheduled run times can be delayed. It is not ideal when exact minute-level timing is important.

Running any 24/7 machine can still consume electricity; this project itself does not require a paid service.

## Important limitations

- GitHub, not Streak Pilot, determines whether a commit qualifies for the contribution graph.
- Use a verified email associated with the GitHub account, and an eligible repository/branch.
- Private repository contributions may require the account's private-contribution display setting.
- The code is designed for a single trusted user/admin. It has no login, multi-user access control, rate limiting, or encrypted secret vault. Do not expose it publicly without adding authentication and secure secret storage.

## Suggested next improvements

1. Add authenticated access and encrypted configuration storage before any public deployment.
2. Add a health endpoint and structured execution log.
3. Add dashboard history / next-run display.
4. Use a durable database rather than a JSON state file for multi-instance hosting.
5. Add integration tests using a mocked `fetch` response sequence for GitHub API error cases.
