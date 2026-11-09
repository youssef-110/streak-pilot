import { decrypt, randomToken, sha256 } from './crypto.js';
import { accessToken, storeTokens, markTokenBroken } from './tokens.js';
import { client, exchangeCode, revokeGrant, GitHubError } from './github.js';
import { validateSettings, nextOccurrences, localDate, zonedParts } from './schedule.js';
import { execute, friendlyError } from './runner.js';
import { loadUser, loadSlots } from './db.js';

export { Scheduler } from './scheduler.js';

const SESSION = '__Host-sp_session';
const STATE = '__Host-sp_state';
const SESSION_DAYS = 90;
// Browsers cap cookie lifetime around 400 days; the server-side expiry slides on every visit.
const COOKIE_DAYS = 400;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const fail = (status, error) => json({ error }, status);

function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
const setCookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const scheduler = (env, userId) => env.SCHEDULER.get(env.SCHEDULER.idFromName(String(userId)));

async function currentUser(req, env) {
  const raw = cookies(req)[SESSION];
  if (!raw) return null;
  const idHash = await sha256(raw);
  const row = await env.DB.prepare(
    'SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?',
  ).bind(idHash, Date.now()).first();
  if (!row) return null;
  // Sliding session: anyone who visits at least every 90 days stays signed in.
  if (row.session_expires - Date.now() < (SESSION_DAYS - 1) * 86_400_000) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').bind(Date.now() + SESSION_DAYS * 86_400_000, idHash).run();
  }
  return row;
}

async function startSession(env, userId) {
  const raw = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(raw), userId, Date.now() + SESSION_DAYS * 86_400_000),
  ]);
  return setCookie(SESSION, raw, COOKIE_DAYS * 86_400);
}

async function upsertUser(env, gh, tokens) {
  const profile = await gh.user();
  await env.DB.prepare(
    `INSERT INTO users (id, login, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url`,
  ).bind(profile.id, profile.login, profile.name || null, profile.avatar_url || null, Date.now()).run();
  await storeTokens(env, profile.id, tokens);
  await scheduler(env, profile.id).rearm(profile.id);
  return profile.id;
}

// ---------- auth routes ----------

async function authLogin(req, env) {
  const state = randomToken(16);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${new URL(req.url).origin}/auth/callback`);
  url.searchParams.set('scope', 'repo');
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'true');
  return new Response(null, { status: 302, headers: { location: url.toString(), 'set-cookie': setCookie(STATE, state, 600) } });
}

async function authCallback(req, env) {
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!code || !state || state !== cookies(req)[STATE]) return Response.redirect(`${url.origin}/?error=state`, 302);
  try {
    const tokens = await exchangeCode(env, code);
    const userId = await upsertUser(env, client(env, tokens.token), tokens);
    const headers = new Headers({ location: '/app' });
    headers.append('set-cookie', await startSession(env, userId));
    headers.append('set-cookie', setCookie(STATE, '', 0));
    return new Response(null, { status: 302, headers });
  } catch (e) {
    console.error('oauth', e.message);
    return Response.redirect(`${url.origin}/?error=signin`, 302);
  }
}

// Local development only: sign in as a fake user backed by the mock GitHub client.
async function authDev(req, env) {
  if (env.DEV_LOGIN !== '1' || env.MOCK_GITHUB !== '1') return fail(404, 'Not found');
  const userId = await upsertUser(env, client(env, ''), { token: 'dev-token', refresh: 'dev-refresh', expiresIn: 28_800 });
  return new Response(null, { status: 302, headers: { location: '/app', 'set-cookie': await startSession(env, userId) } });
}

async function authLogout(req, env) {
  const raw = cookies(req)[SESSION];
  if (raw) await env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256(raw)).run();
  return json({ ok: true }, 200, { 'set-cookie': setCookie(SESSION, '', 0) });
}

// ---------- api ----------

function stats(runs, tz) {
  const byDate = {};
  let total = 0;
  for (const r of runs) {
    if (!r.made) continue;
    byDate[r.local_date] = (byDate[r.local_date] || 0) + r.made;
    total += r.made;
  }
  // Streak: consecutive local days with commits, ending today (or yesterday if today has none yet).
  let streak = 0;
  const now = Date.now();
  let t = byDate[localDate(now, tz)] ? now : now - 86_400_000;
  while (byDate[localDate(t, tz)]) { streak++; t -= 86_400_000; }
  return { total, streak, activeDays: Object.keys(byDate).length, byDate };
}

async function me(user, env) {
  const slots = await loadSlots(env, user.id);
  const { results: runs } = await env.DB.prepare(
    `SELECT id, kind, local_date, scheduled_at, finished_at, status, planned, made, repo, url, error
     FROM runs WHERE user_id = ? AND scheduled_at > ? ORDER BY scheduled_at DESC LIMIT 500`,
  ).bind(user.id, Date.now() - 200 * 86_400_000).all();
  const active = !user.paused && user.repo && user.token_ok && slots.length;
  // Self-heal: make sure the alarm exists whenever the owner looks at the dashboard.
  if (active) await scheduler(env, user.id).arm(user.id);
  return {
    user: { login: user.login, name: user.name, avatar: user.avatar_url, tokenOk: Boolean(user.token_ok) },
    settings: { repo: user.repo, branch: user.branch, timezone: user.timezone, jitter: user.jitter, paused: Boolean(user.paused) },
    slots,
    next: active ? nextOccurrences({ slots, tz: user.timezone, jitter: user.jitter, seed: String(user.id) }, Date.now(), 6)
      .map((o) => ({ slot: o.slot.id, time: o.slot.time, commits: o.slot.commits, at: o.fireMs })) : [],
    runs: runs.slice(0, 40),
    stats: stats(runs, user.timezone),
    today: localDate(Date.now(), user.timezone),
  };
}

async function saveSettings(req, user, env) {
  const { error, value } = validateSettings(await req.json().catch(() => null));
  if (error) return fail(400, error);
  let warning = null;
  if (value.repo && (value.repo !== user.repo || value.branch !== user.branch)) {
    try {
      const repo = await client(env, await accessToken(env, user)).repo(value.repo);
      if (repo.permissions && !repo.permissions.push) return fail(400, 'You do not have write access to that repository.');
      if (repo.default_branch && repo.default_branch !== value.branch) {
        warning = `GitHub only counts commits on the default branch (${repo.default_branch}) toward your graph.`;
      }
    } catch (e) {
      if (e instanceof GitHubError) return fail(400, e.status === 404 ? 'Repository not found, or Streak Pilot cannot see it.' : friendlyError(e));
      throw e;
    }
  }
  const stmts = [
    env.DB.prepare('UPDATE users SET repo = ?, branch = ?, timezone = ?, jitter = ?, paused = ? WHERE id = ?')
      .bind(value.repo, value.branch, value.timezone, value.jitter, value.paused ? 1 : 0, user.id),
    env.DB.prepare('DELETE FROM slots WHERE user_id = ?').bind(user.id),
    ...value.slots.map((s, i) => env.DB.prepare(
      'INSERT INTO slots (id, user_id, time, commits, days, message, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(s.id, user.id, s.time, s.commits, s.days, s.message, i)),
  ];
  await env.DB.batch(stmts);
  const nextAt = await scheduler(env, user.id).rearm(user.id);
  return json({ ok: true, warning, nextAt });
}

async function listRepos(user, env) {
  const repos = await client(env, await accessToken(env, user)).repos();
  return json(repos.filter((r) => !r.archived).map((r) => ({ name: r.full_name, private: r.private, branch: r.default_branch })));
}

async function createRepo(req, user, env) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || 'streak-pilot').trim();
  if (!/^[\w.-]{1,100}$/.test(name)) return fail(400, 'Repository names can use letters, numbers, ., - and _.');
  try {
    const r = await client(env, await accessToken(env, user)).createRepo(name, body.private !== false);
    return json({ name: r.full_name, private: r.private, branch: r.default_branch || 'main' });
  } catch (e) {
    if (e instanceof GitHubError) return fail(400, e.status === 422 ? 'You already have a repository with that name.' : friendlyError(e));
    throw e;
  }
}

async function runNow(req, user, env) {
  if (!user.repo) return fail(400, 'Pick a repository first.');
  if (!user.token_ok) return fail(400, 'Reconnect GitHub first.');
  const now = Date.now();
  if (now - user.last_manual_at < 60_000) return fail(429, 'Give it a minute between test runs.');
  const body = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 20);
  await env.DB.prepare('UPDATE users SET last_manual_at = ? WHERE id = ?').bind(now, user.id).run();
  const p = zonedParts(now, user.timezone);
  const result = await execute(env, user, {
    runKey: `${user.id}:manual:${now}`, kind: 'manual', date: localDate(now, user.timezone),
    time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
    scheduledAt: now, count, template: String(body.message || 'chore: streak pilot test run {n}/{total}').slice(0, 200),
  });
  return json(result, result?.status === 'ok' ? 200 : 502);
}

async function deleteAccount(user, env) {
  await scheduler(env, user.id).stop();
  if (user.token_enc && env.MOCK_GITHUB !== '1') {
    try { await revokeGrant(env, await decrypt(user.token_enc, env.TOKEN_KEY)); } catch {}
  }
  await env.DB.batch(['runs', 'slots', 'sessions'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(user.id))
    .concat(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id)));
  return json({ ok: true }, 200, { 'set-cookie': setCookie(SESSION, '', 0) });
}

async function route(req, env) {
  const url = new URL(req.url);
  const { pathname: path } = url;
  const method = req.method;

  // CSRF: state-changing requests must come from our own origin.
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (!origin || new URL(origin).host !== url.host) return fail(403, 'Cross-site request blocked.');
  }

  if (path === '/auth/login' && method === 'GET') return authLogin(req, env);
  if (path === '/auth/callback' && method === 'GET') return authCallback(req, env);
  if (path === '/auth/dev' && method === 'GET') return authDev(req, env);
  if (path === '/auth/logout' && method === 'POST') return authLogout(req, env);
  if (path === '/api/health') return json({ ok: true, time: Date.now() });

  if (path.startsWith('/api/')) {
    const user = await currentUser(req, env);
    if (!user) return fail(401, 'Sign in first.');
    const retry = req.clone();
    try {
      return await api(req, env, user, path, method);
    } catch (e) {
      // GitHub refusing the token is not a sign-out: renew once, else keep the session and ask to reconnect.
      if (e instanceof GitHubError && e.status === 401) {
        try {
          await accessToken(env, user, { force: true });
          return await api(retry, env, user, path, method);
        } catch {}
        await markTokenBroken(env, user.id);
        return fail(409, 'GitHub access needs reconnecting. Use Reconnect GitHub at the top of the page.');
      }
      throw e;
    }
  }
  return env.ASSETS.fetch(req);
}

async function api(req, env, user, path, method) {
  if (path === '/api/me' && method === 'GET') return json(await me(user, env));
  if (path === '/api/settings' && method === 'PUT') return saveSettings(req, user, env);
  if (path === '/api/repos' && method === 'GET') return listRepos(user, env);
  if (path === '/api/repos' && method === 'POST') return createRepo(req, user, env);
  if (path === '/api/run' && method === 'POST') return runNow(req, user, env);
  if (path === '/api/account' && method === 'DELETE') return deleteAccount(user, env);
  return fail(404, 'Not found');
}

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      console.error('unhandled', e.stack || e.message);
      return fail(500, 'Something went wrong. Try again in a moment.');
    }
  },
};
