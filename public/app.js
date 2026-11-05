const $ = (id) => document.getElementById(id);
const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let state = null;
let slots = [];
let dirty = false;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { location.href = '/'; throw new Error('signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const fmtTime = (ms, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
const fmtWhen = (ms, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ms);

// ---------- slots editor ----------

function renderSlots() {
  const box = $('slots');
  box.replaceChildren();
  if (!slots.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'No times yet. Add one to start committing daily.';
    box.append(e);
    return;
  }
  slots.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.innerHTML = `
      <div class="slot-head">
        <input type="time" aria-label="Time">
        <div class="stepper"><button type="button" data-d="-1" aria-label="Fewer commits">−</button><input type="number" min="1" max="20" aria-label="Commits"><button type="button" data-d="1" aria-label="More commits">+</button></div>
        <input class="msg" aria-label="Commit message" maxlength="200" spellcheck="false">
        <button type="button" class="icon-btn" aria-label="Remove this time" title="Remove this time"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .78 5.78 0 6.75 0h2.5C10.22 0 11 .78 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM4.5 6.5a.75.75 0 0 1 .8.7l.45 6.3h4.5l.45-6.3a.75.75 0 1 1 1.5.1l-.5 7a.75.75 0 0 1-.75.7h-5.9a.75.75 0 0 1-.75-.7l-.5-7a.75.75 0 0 1 .7-.8Z"/></svg></button>
      </div>
      <div class="days" role="group" aria-label="Days"></div>`;
    const [time, , msg] = el.querySelectorAll('.slot-head > input, .slot-head > .stepper, .slot-head > .msg');
    const count = el.querySelector('.stepper input');
    msg.value = s.message;
    time.value = s.time;
    count.value = s.commits;
    time.oninput = () => { s.time = time.value; touch(); };
    msg.oninput = () => { s.message = msg.value; touch(); };
    count.oninput = () => { s.commits = clamp(count.value); touch(); };
    count.onblur = () => { count.value = s.commits; };
    el.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { s.commits = clamp(s.commits + Number(b.dataset.d)); count.value = s.commits; touch(); });
    el.querySelector('.icon-btn').onclick = () => { slots.splice(i, 1); renderSlots(); touch(); };
    const days = el.querySelector('.days');
    DAY_NAMES.forEach((n, d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = n;
      b.setAttribute('aria-label', DAY_FULL[d]);
      b.setAttribute('aria-pressed', String(Boolean(s.days & (1 << d))));
      b.onclick = () => {
        const next = s.days ^ (1 << d);
        if (!next) return toast('Keep at least one day.');
        s.days = next;
        b.setAttribute('aria-pressed', String(Boolean(s.days & (1 << d))));
        touch();
      };
      days.append(b);
    });
    box.append(el);
  });
}
const clamp = (v) => Math.min(20, Math.max(1, parseInt(v, 10) || 1));

function touch() {
  dirty = true;
  setStatus('save-status', 'Unsaved changes', '');
}

function setStatus(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind || ''}`;
}

// ---------- rendering state ----------

function renderHeatmap(byDate, tz) {
  const grid = $('mini');
  grid.replaceChildren();
  const weeks = Math.max(8, Math.min(53, Math.floor((grid.parentElement.clientWidth - 32 + 3) / 14)));
  const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(Date.now());
  const get = (t) => todayParts.find((p) => p.type === t).value;
  const today = new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7 - today.getUTCDay());
  const max = Math.max(1, ...Object.values(byDate));
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const n = byDate[key] || 0;
    const cell = document.createElement('span');
    cell.dataset.l = n ? Math.max(1, Math.ceil((n / max) * 4)) : 0;
    cell.title = `${key}: ${n} commit${n === 1 ? '' : 's'}`;
    grid.append(cell);
  }
}

const ICONS = {
  ok: '<path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>',
  error: '<path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>',
  running: '<path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.99l2.17 1.3a.75.75 0 0 1-.77 1.29l-2.53-1.52A.75.75 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z"/>',
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function renderRuns(runs, tz) {
  const ul = $('runs');
  ul.replaceChildren();
  if (!runs.length) {
    const li = document.createElement('li');
    li.className = 'empty-row';
    li.textContent = 'No runs yet. Your first scheduled commit will show up here.';
    ul.append(li);
    return;
  }
  const shown = renderRuns.all ? runs : runs.slice(0, 10);
  for (const r of shown) {
    const li = document.createElement('li');
    li.className = r.status;
    li.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${ICONS[r.status] || ICONS.ok}</svg>`;
    const what = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = r.status === 'running' ? 'Running' : r.status === 'error' ? (r.made ? `Failed after ${plural(r.made, 'commit')}` : 'Failed') : r.made === r.planned ? `Made ${plural(r.made, 'commit')}` : `Made ${r.made} of ${plural(r.planned, 'commit')}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${r.kind === 'manual' ? 'Test run' : 'Scheduled'} in ${r.repo}`;
    what.append(title, meta);
    if (r.error) { const e = document.createElement('div'); e.className = 'err'; e.textContent = r.error; what.append(e); }
    const when = document.createElement('div');
    when.className = 'when';
    const t = document.createElement('time');
    t.dateTime = new Date(r.scheduled_at).toISOString();
    t.textContent = fmtWhen(r.scheduled_at, tz);
    when.append(t);
    if (r.url) {
      const a = document.createElement('a');
      a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = r.url.split('/').pop().slice(0, 7);
      a.title = 'View the last commit on GitHub';
      when.append(document.createElement('br'), a);
    }
    li.append(what, when);
    ul.append(li);
  }
  if (runs.length > shown.length) {
    const li = document.createElement('li');
    li.className = 'empty-row';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn quiet';
    b.textContent = `Show ${runs.length - shown.length} more`;
    b.onclick = () => { renderRuns.all = true; renderRuns(runs, tz); };
    li.append(b);
    ul.append(li);
  }
}

function renderNext() {
  const { next, settings, user } = state;
  const box = $('next');
  const tz = settings.timezone;
  box.classList.toggle('off', !next.length);
  $('upcoming').replaceChildren();
  if (!next.length) {
    $('countdown').textContent = 'Off';
    $('next-label').textContent = 'Schedule';
    $('next-when').textContent = !user.tokenOk ? 'Reconnect GitHub to resume.'
      : !settings.repo ? 'Pick a repository to start.'
      : settings.paused ? 'Paused. Switch it back on to resume.'
      : 'Add a daily time to start.';
    return;
  }
  $('next-label').textContent = 'Next commit in';
  const [first, ...rest] = next;
  $('next-when').textContent = `${fmtTime(first.at, tz)}, ${plural(first.commits, 'commit')}`;
  for (const n of rest.slice(0, 4)) {
    const row = document.createElement('li');
    const a = document.createElement('span');
    const b = document.createElement('span');
    a.textContent = fmtTime(n.at, tz);
    b.textContent = plural(n.commits, 'commit');
    row.append(a, b);
    $('upcoming').append(row);
  }
  tick();
}

function tick() {
  if (!state?.next.length) return;
  const ms = state.next[0].at - Date.now();
  if (ms <= 0) { $('countdown').textContent = 'Now'; setTimeout(() => refresh().catch(() => {}), 20_000); return; }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  $('countdown').textContent = h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}
setInterval(tick, 1000);

function fillTimezones(current) {
  const sel = $('timezone');
  if (sel.options.length) { sel.value = current; return; }
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [current];
  if (!zones.includes('UTC')) zones.unshift('UTC');
  if (!zones.includes(current)) zones.unshift(current);
  for (const z of zones) sel.add(new Option(z.replaceAll('_', ' '), z));
  sel.value = current;
}

async function loadRepos(selected) {
  const sel = $('repo');
  try {
    const repos = await api('/api/repos');
    sel.replaceChildren(new Option('Choose a repository', ''));
    if (selected && !repos.some((r) => r.name === selected)) repos.unshift({ name: selected, private: true, branch: '' });
    for (const r of repos) {
      const o = new Option(`${r.name}${r.private ? ' (private)' : ''}`, r.name);
      o.dataset.branch = r.branch;
      sel.add(o);
    }
    sel.value = selected || '';
  } catch (e) {
    sel.replaceChildren(new Option(selected || 'Could not load repositories', selected || ''));
    setStatus('save-status', e.message, 'err');
  }
}

function apply(data, { keepForm } = {}) {
  state = data;
  const { user, settings, stats } = data;
  $('login').textContent = user.login;
  if (user.avatar) {
    for (const id of ['avatar', 'profile-avatar']) { $(id).src = user.avatar; $(id).classList.remove('hidden'); }
  }
  $('profile-name').textContent = user.name || user.login;
  $('profile-login').textContent = user.name ? user.login : '';
  const on = data.next.length > 0;
  $('state-pill').className = `pill ${on ? 'on' : !user.tokenOk ? 'warn' : ''}`;
  $('state-text').textContent = on ? 'Schedule running' : !user.tokenOk ? 'Needs reconnect' : settings.paused ? 'Paused' : 'Not scheduled';
  $('reconnect').classList.toggle('hidden', user.tokenOk);
  $('s-streak').textContent = stats.streak;
  $('s-total').textContent = stats.total;
  $('s-days').textContent = stats.activeDays;
  renderHeatmap(stats.byDate, settings.timezone);
  renderRuns(data.runs, settings.timezone);
  renderNext();
  if (keepForm) return;
  $('branch').value = settings.branch;
  $('jitter').value = String(settings.jitter);
  if ($('jitter').value !== String(settings.jitter)) $('jitter').add(new Option(`Up to ${settings.jitter} minutes`, settings.jitter, true, true));
  $('active').checked = !settings.paused;
  $('active-label').textContent = settings.paused ? 'Paused' : 'Running';
  const tz = settings.repo || data.slots.length ? settings.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  fillTimezones(tz);
  slots = data.slots.length ? data.slots.map((s) => ({ ...s }))
    : [{ id: newId(), time: '09:15', commits: 1, days: 127, message: 'chore: daily update {date}' }];
  renderSlots();
  dirty = !data.slots.length;
  if (dirty) setStatus('save-status', 'Pick a repository and save to start.', '');
}

async function refresh() {
  apply(await api('/api/me'), { keepForm: dirty });
}

// ---------- events ----------

$('repo').onchange = () => {
  const b = $('repo').selectedOptions[0]?.dataset.branch;
  if (b) $('branch').value = b;
  touch();
};
['branch', 'timezone', 'jitter'].forEach((id) => $(id).addEventListener('input', touch));
$('active').onchange = () => { $('active-label').textContent = $('active').checked ? 'Running' : 'Paused'; touch(); };
$('add-slot').onclick = () => {
  if (slots.length >= 12) return toast('Up to 12 times a day.');
  const last = slots.at(-1);
  slots.push({ id: newId(), time: last ? last.time : '12:00', commits: 1, days: 127, message: last?.message || 'chore: daily update {date}' });
  renderSlots();
  touch();
  $('slots').lastElementChild.querySelector('input[type=time]').focus();
};

$('settings').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('save');
  btn.disabled = true;
  setStatus('save-status', 'Saving…', '');
  try {
    const out = await api('/api/settings', {
      method: 'PUT',
      body: {
        repo: $('repo').value, branch: $('branch').value.trim() || 'main', timezone: $('timezone').value,
        jitter: Number($('jitter').value), paused: !$('active').checked, slots,
      },
    });
    dirty = false;
    setStatus('save-status', out.warning || 'Saved. Schedule is up to date.', out.warning ? 'warn' : 'ok');
    toast('Schedule saved');
    await refresh();
  } catch (err) {
    setStatus('save-status', err.message, 'err');
  } finally { btn.disabled = false; }
};

document.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
  $('run-count').value = clamp(Number($('run-count').value) + Number(b.dataset.step));
});
$('run-now').onclick = async () => {
  if (dirty) return setStatus('run-status', 'Save your schedule first.', 'err');
  const btn = $('run-now');
  btn.disabled = true;
  setStatus('run-status', 'Committing…', '');
  try {
    const r = await api('/api/run', { method: 'POST', body: { count: clamp($('run-count').value) } });
    setStatus('run-status', `Done: ${r.made} commit${r.made === 1 ? '' : 's'} made.`, 'ok');
  } catch (err) {
    setStatus('run-status', err.message, 'err');
  } finally {
    btn.disabled = false;
    refresh();
  }
};

$('new-repo').onclick = () => { setStatus('repo-error', '', 'err'); $('repo-dialog').showModal(); };
$('repo-form').onsubmit = async (e) => {
  if (e.submitter?.value !== 'create') return;
  e.preventDefault();
  const btn = $('repo-create');
  btn.disabled = true;
  try {
    const r = await api('/api/repos', { method: 'POST', body: { name: $('repo-name').value.trim(), private: $('repo-private').checked } });
    const o = new Option(`${r.name}${r.private ? ' (private)' : ''}`, r.name);
    o.dataset.branch = r.branch;
    $('repo').add(o, 1);
    $('repo').value = r.name;
    $('branch').value = r.branch;
    $('repo-dialog').close();
    touch();
    toast('Repository created. Save to use it.');
  } catch (err) {
    setStatus('repo-error', err.message, 'err');
  } finally { btn.disabled = false; }
};

$('logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/'; };
$('delete').onclick = () => $('delete-dialog').showModal();
$('delete-dialog').onclose = async () => {
  if ($('delete-dialog').returnValue !== 'delete') return;
  try { await api('/api/account', { method: 'DELETE' }); location.href = '/'; } catch (err) { toast(err.message); }
};
window.addEventListener('beforeunload', (e) => { if (dirty && state?.slots.length) e.preventDefault(); });
setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 60_000);

const first = await api('/api/me');
apply(first);
loadRepos(first.settings.repo);
