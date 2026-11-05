// Pure time-zone and schedule math. No I/O, so it is fully unit-tested.

const DAY_MS = 86_400_000;
const fmtCache = new Map();

function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { formatter(tz); return true; } catch { return false; }
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(ms, tz) {
  const p = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(ms))) p[type] = value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour, minute: +p.minute, second: +p.second,
    weekday: WEEKDAYS[p.weekday],
  };
}

function offsetAt(ms, tz) {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** UTC ms for a wall-clock time in tz. Nonexistent (DST gap) times shift forward. */
export function zonedToUtc(year, month, day, hour, minute, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ms = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(ms, tz);
  if (second !== ms) ms = Math.max(ms, second);
  return ms;
}

export function localDate(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// FNV-1a, so jitter is random-looking but stable for a given slot and day.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function jitterMinutes(seed, max) {
  return max > 0 ? hash(seed) % (max + 1) : 0;
}

/**
 * Every slot firing in the window (fromMs, toMs].
 * slot: { id, time: 'HH:MM', days: bitmask (bit 0 = Sunday), commits }
 */
export function occurrences({ slots, tz, jitter = 0, seed = '' }, fromMs, toMs) {
  const out = [];
  // Walk local calendar days covering the window, with a day of slack each side.
  for (let t = fromMs - DAY_MS; t <= toMs + DAY_MS; t += DAY_MS) {
    const p = zonedParts(t, tz);
    const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    for (const slot of slots) {
      if (!(slot.days & (1 << p.weekday))) continue;
      const [h, m] = slot.time.split(':').map(Number);
      const fireMs = zonedToUtc(p.year, p.month, p.day, h, m, tz)
        + jitterMinutes(`${seed}:${slot.id}:${date}`, jitter) * 60_000;
      if (fireMs > fromMs && fireMs <= toMs) out.push({ slot, date, fireMs });
    }
  }
  // Day stepping can visit the same local date twice around DST; dedupe.
  const seen = new Set();
  return out
    .filter((o) => { const k = `${o.slot.id}:${o.date}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.fireMs - b.fireMs);
}

export function nextOccurrences(cfg, nowMs, limit = 5) {
  return occurrences(cfg, nowMs, nowMs + 8 * DAY_MS).slice(0, limit);
}

/** Fill {n}, {total}, {date}, {time} in a commit message template. */
export function renderMessage(template, { n, total, date, time }) {
  return String(template || 'chore: keep the streak going')
    .replaceAll('{n}', String(n)).replaceAll('{total}', String(total))
    .replaceAll('{date}', date).replaceAll('{time}', time)
    .slice(0, 200);
}

export const LIMITS = { slots: 12, commits: 20, jitter: 120, message: 200 };

/** Validate a settings payload from the dashboard. Returns { error } or { value }. */
export function validateSettings(body) {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body.' };
  const repo = String(body.repo ?? '').trim();
  if (repo && !/^[\w.-]{1,39}\/[\w.-]{1,100}$/.test(repo)) return { error: 'Repository must look like owner/name.' };
  const branch = String(body.branch ?? 'main').trim();
  if (!/^[\w./-]{1,100}$/.test(branch) || branch.includes('..')) return { error: 'Branch name is not valid.' };
  const tz = String(body.timezone ?? 'UTC');
  if (!isValidTimeZone(tz)) return { error: 'Unknown time zone.' };
  const jitter = Number(body.jitter ?? 0);
  if (!Number.isInteger(jitter) || jitter < 0 || jitter > LIMITS.jitter) return { error: `Random delay must be 0 to ${LIMITS.jitter} minutes.` };
  if (!Array.isArray(body.slots)) return { error: 'Slots must be a list.' };
  if (body.slots.length > LIMITS.slots) return { error: `At most ${LIMITS.slots} time slots.` };
  const slots = [];
  const ids = new Set();
  for (const s of body.slots) {
    const id = String(s?.id ?? '');
    if (!/^[a-z0-9]{6,24}$/.test(id) || ids.has(id)) return { error: 'Slot id is not valid.' };
    ids.add(id);
    const time = String(s.time ?? '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Times must be 24-hour HH:MM.' };
    const commits = Number(s.commits);
    if (!Number.isInteger(commits) || commits < 1 || commits > LIMITS.commits) return { error: `Commits per slot must be 1 to ${LIMITS.commits}.` };
    const days = Number(s.days ?? 127);
    if (!Number.isInteger(days) || days < 1 || days > 127) return { error: 'Pick at least one day for every slot.' };
    const message = String(s.message ?? '').trim().slice(0, LIMITS.message) || 'chore: keep the streak going';
    slots.push({ id, time, commits, days, message });
  }
  return { value: { repo, branch, timezone: tz, jitter, paused: Boolean(body.paused), slots } };
}
