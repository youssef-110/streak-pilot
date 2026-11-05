import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const configFile = join(root, 'config.json');
const stateFile = join(root, '.streak-state.json');
const port = Number(process.env.PORT || 8787);
const token = process.env.GITHUB_TOKEN || '';
const mock = process.env.MOCK_GITHUB === '1';

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const safeReadJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };
const saveJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const validate = (config) => {
  if (!/^([\w.-]+)\/([\w.-]+)$/.test(config.repository || '')) return 'Repository must look like owner/repository.';
  if (!Array.isArray(config.schedules) || !config.schedules.length) return 'Add at least one scheduled time.';
  for (const item of config.schedules) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time || '')) return 'Each time must use 24-hour HH:MM.';
    if (!Number.isInteger(Number(item.commits)) || Number(item.commits) < 1 || Number(item.commits) > 20) return 'Commits must be a whole number from 1 to 20.';
  }
  return null;
};
const zonedParts = (timezone) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
};
async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, { ...options, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', ...options.headers } });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}
async function makeCommit(config, schedule, ordinal) {
  if (mock) return { mock: true, commit: ordinal };
  if (!token) throw new Error('GITHUB_TOKEN is not set on the scheduler.');
  const [owner, repo] = config.repository.split('/');
  const path = '.github/streak-pulse.txt';
  let existing = null;
  try { existing = await github(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`); } catch (error) { if (!String(error.message).startsWith('GitHub 404')) throw error; }
  const stamp = new Date().toISOString();
  const content = Buffer.from(`Streak pulse: ${stamp}\nSchedule: ${schedule.id}\nCommit: ${ordinal}\n`).toString('base64');
  return github(`/repos/${owner}/${repo}/contents/${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: schedule.message || 'chore: daily streak', content, branch: config.branch, ...(existing?.sha ? { sha: existing.sha } : {}) }) });
}
async function tick() {
  const config = await safeReadJson(configFile, {});
  if (validate(config)) return;
  let now;
  try { now = zonedParts(config.timezone); } catch { return; }
  const day = `${now.year}-${now.month}-${now.day}`;
  const minute = `${now.hour}:${now.minute}`;
  const state = await safeReadJson(stateFile, { completed: {} });
  for (const schedule of config.schedules) {
    if (schedule.time !== minute) continue;
    const key = `${day}/${schedule.id}`;
    if (state.completed[key]) continue;
    for (let i = 1; i <= Number(schedule.commits); i++) await makeCommit(config, schedule, i);
    state.completed[key] = new Date().toISOString();
    const keys = Object.keys(state.completed).sort();
    for (const old of keys.slice(0, -90)) delete state.completed[old];
    await saveJson(stateFile, state);
  }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(await readFile(join(root, 'public', 'index.html')));
  }
  if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, await safeReadJson(configFile, {}));
  if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { configured: Boolean(token), mock, state: await safeReadJson(stateFile, { completed: {} }) });
  if (req.method === 'POST' && url.pathname === '/api/config') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    try { const config = JSON.parse(raw); const error = validate(config); if (error) return json(res, 400, { error }); await saveJson(configFile, config); return json(res, 200, config); } catch { return json(res, 400, { error: 'Invalid JSON.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/test-run') {
    const config = await safeReadJson(configFile, {}); const error = validate(config); if (error) return json(res, 400, { error });
    try { const schedule = config.schedules[0]; const result = []; for (let i = 1; i <= Number(schedule.commits); i++) result.push(await makeCommit(config, schedule, i)); return json(res, 200, { ok: true, commits: result.length, mock }); } catch (error) { return json(res, 500, { error: error.message }); }
  }
  json(res, 404, { error: 'Not found' });
});
server.listen(port, () => console.log(`Streak dashboard: http://localhost:${port}`));
setInterval(() => tick().catch(error => console.error(error.message)), 30_000);
tick().catch(error => console.error(error.message));
