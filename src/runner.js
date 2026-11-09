import { client } from './github.js';
import { accessToken, markTokenBroken } from './tokens.js';
import { renderMessage } from './schedule.js';

const transient = (e) => !e.status || e.status >= 500 || e.status === 409;

/**
 * Make `count` commits for a user, recorded as one row in `runs`.
 * run_key is unique, so a run can never execute twice (alarm retries, double clicks).
 * Returns the run row summary, or null when this run_key already exists.
 */
export async function execute(env, user, { runKey, kind, date, time, scheduledAt, count, template }) {
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO runs (user_id, run_key, kind, local_date, scheduled_at, status, planned, repo)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`,
  ).bind(user.id, runKey, kind, date, scheduledAt, count, user.repo).run();
  if (!ins.meta.changes) return null;
  const id = ins.meta.last_row_id;

  const messages = Array.from({ length: count }, (_, i) => renderMessage(template, { n: i + 1, total: count, date, time }));
  let made = 0;
  let url = null;
  let error = null;
  try {
    let gh = client(env, await accessToken(env, user));
    let renewed = false;
    for (let attempt = 0; attempt < 3 && made < count; attempt++) {
      try {
        const r = await gh.commit(user.repo, user.branch, messages.slice(made), new Date().toISOString());
        made += r.made; url = r.url || url; error = null;
      } catch (e) {
        made += e.made || 0; url = e.url || url; error = e;
        if (e.status === 401 && !renewed) {
          // Token died early: renew once and retry right away.
          renewed = true;
          try { gh = client(env, await accessToken(env, user, { force: true })); attempt--; continue; } catch (re) { error = re; break; }
        }
        if (!transient(e)) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  } catch (e) { error = e; }

  if (error?.status === 401) await markTokenBroken(env, user.id);
  const status = error ? 'error' : 'ok';
  const message = error ? friendlyError(error) : null;
  await env.DB.prepare('UPDATE runs SET status = ?, made = ?, url = ?, error = ?, finished_at = ? WHERE id = ?')
    .bind(status, made, url, message, Date.now(), id).run();
  return { id, status, made, planned: count, url, error: message };
}

export function friendlyError(e) {
  if (e.status === 401) return 'GitHub access could not be renewed. Sign in again to reconnect.';
  if (e.status === 403) return `GitHub refused the commit: ${e.message}`;
  if (e.status === 404) return 'Repository or branch not found, or access is missing.';
  if (e.status === 409) return 'Branch changed during the run. It will retry next time.';
  if (e.status === 422) return `GitHub rejected the commit: ${e.message}`;
  return String(e.message || e).slice(0, 300);
}
