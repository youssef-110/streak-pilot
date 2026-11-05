# Streak Pilot

A free, self-hosted dashboard that creates scheduled commits in a repository you control. It uses the GitHub Contents API to update `.github/streak-pulse.txt`, creating real commits under the account represented by `GITHUB_TOKEN`.

## Start locally

Requires Node.js 18 or newer.

```powershell
$env:GITHUB_TOKEN = "your_fine_grained_token"
npm start
```

Open `http://localhost:8787`, enter `owner/repository`, add one or more time slots, and save. The scheduler checks every 30 seconds and runs a slot once on its chosen day in its configured time zone.

For a safe test without GitHub access:

```powershell
$env:MOCK_GITHUB = "1"
npm start
```

Then press **Test run now**. Mock mode reports success but makes no external request.

## GitHub token

Create a fine-grained personal access token restricted to the target repository, with **Contents: Read and write** permission. Keep it only in the host's `GITHUB_TOKEN` environment variable. Do not paste it into the dashboard or commit it to this project.

## Free 24/7 option

Deploy this repository to an always-on machine you already control (a Raspberry Pi, home server, or inexpensive/free VPS), set `GITHUB_TOKEN` in that host’s secret/environment settings, and run it with a service manager. Windows Task Scheduler can start it on boot; on Linux use `systemd` with `Restart=always`.

For a zero-cost cloud alternative, adapt the scheduler to a GitHub Actions workflow in a public repository. GitHub schedules are not precise and scheduled workflows can be delayed, so it is less reliable for exact times. This Node service is the better choice when timing matters.

## Important note

GitHub decides what appears on your contribution graph. Commits must be attributed to your verified email and be in an eligible repository/branch. This tool cannot guarantee a graph square if GitHub's contribution rules do not count a commit.
