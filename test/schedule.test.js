import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedToUtc, zonedParts, occurrences, nextOccurrences, jitterMinutes, validateSettings, renderMessage, localDate,
} from '../src/schedule.js';
import { encrypt, decrypt } from '../src/crypto.js';

const ALL = 127;
const slot = (id, time, days = ALL) => ({ id, time, days, commits: 1, message: 'x' });

test('zonedToUtc round-trips wall-clock times across zones', () => {
  for (const tz of ['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Pacific/Chatham']) {
    const ms = zonedToUtc(2026, 7, 14, 9, 15, tz);
    const p = zonedParts(ms, tz);
    assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, 7, 14, 9, 15], tz);
  }
});

test('Berlin 09:15 is 07:15 UTC in summer and 08:15 UTC in winter', () => {
  assert.equal(new Date(zonedToUtc(2026, 7, 1, 9, 15, 'Europe/Berlin')).toISOString(), '2026-07-01T07:15:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 1, 1, 9, 15, 'Europe/Berlin')).toISOString(), '2026-01-01T08:15:00.000Z');
});

test('a time skipped by DST still fires once, shifted forward', () => {
  // 2026-03-29 02:30 does not exist in Berlin.
  const ms = zonedToUtc(2026, 3, 29, 2, 30, 'Europe/Berlin');
  assert.equal(new Date(ms).toISOString(), '2026-03-29T01:30:00.000Z');
  const occ = occurrences({ slots: [slot('a', '02:30')], tz: 'Europe/Berlin' },
    Date.UTC(2026, 2, 28, 12), Date.UTC(2026, 2, 30, 12));
  assert.equal(occ.length, 2);
});

test('a repeated DST hour fires once per day', () => {
  // 2026-10-25 02:30 happens twice in Berlin.
  const occ = occurrences({ slots: [slot('a', '02:30')], tz: 'Europe/Berlin' },
    Date.UTC(2026, 9, 25, 0), Date.UTC(2026, 9, 25, 3));
  assert.equal(occ.length, 1);
});

test('occurrences cover each day exactly once over a month', () => {
  const from = Date.UTC(2026, 9, 1);
  const occ = occurrences({ slots: [slot('a', '00:00'), slot('b', '23:59')], tz: 'America/Los_Angeles' }, from, from + 31 * 86_400_000);
  assert.equal(occ.length, 62);
  for (let i = 1; i < occ.length; i++) assert.ok(occ[i].fireMs > occ[i - 1].fireMs);
});

test('day-of-week mask is respected in the local zone', () => {
  const weekdays = 0b0111110; // Mon..Fri
  const from = Date.UTC(2026, 10, 1); // a Sunday
  const occ = occurrences({ slots: [slot('a', '09:00', weekdays)], tz: 'Asia/Tokyo' }, from, from + 14 * 86_400_000);
  assert.equal(occ.length, 10);
  for (const o of occ) assert.ok([1, 2, 3, 4, 5].includes(zonedParts(o.fireMs, 'Asia/Tokyo').weekday));
});

test('jitter is stable and within bounds', () => {
  for (let i = 0; i < 500; i++) {
    const j = jitterMinutes(`seed${i}`, 30);
    assert.ok(j >= 0 && j <= 30);
    assert.equal(j, jitterMinutes(`seed${i}`, 30));
  }
  assert.equal(jitterMinutes('x', 0), 0);
  const cfg = { slots: [slot('a', '10:00')], tz: 'UTC', jitter: 45, seed: '7' };
  const now = Date.UTC(2026, 0, 1);
  assert.deepEqual(nextOccurrences(cfg, now).map((o) => o.fireMs), nextOccurrences(cfg, now).map((o) => o.fireMs));
});

test('a slot that fired is not returned again from the same cursor', () => {
  const cfg = { slots: [slot('a', '10:00')], tz: 'UTC' };
  const fire = Date.UTC(2026, 0, 1, 10);
  assert.equal(occurrences(cfg, fire - 60_000, fire).length, 1);
  assert.equal(occurrences(cfg, fire, fire + 60_000).length, 0);
});

test('validateSettings accepts a good payload and rejects bad ones', () => {
  const good = { repo: 'octo/repo', branch: 'main', timezone: 'Europe/Berlin', jitter: 10, slots: [{ id: 'abc123', time: '09:15', commits: 3, days: 127, message: 'hi' }] };
  assert.ok(validateSettings(good).value);
  assert.match(validateSettings({ ...good, repo: 'nope' }).error, /owner\/name/);
  assert.match(validateSettings({ ...good, timezone: 'Mars/Base' }).error, /time zone/);
  assert.match(validateSettings({ ...good, slots: [{ ...good.slots[0], commits: 21 }] }).error, /1 to 20/);
  assert.match(validateSettings({ ...good, slots: [{ ...good.slots[0], time: '24:00' }] }).error, /HH:MM/);
  assert.match(validateSettings({ ...good, slots: [{ ...good.slots[0], days: 0 }] }).error, /day/);
  assert.match(validateSettings({ ...good, branch: '../x' }).error, /Branch/);
  assert.match(validateSettings({ ...good, slots: [good.slots[0], good.slots[0]] }).error, /id/);
});

test('renderMessage fills placeholders', () => {
  assert.equal(renderMessage('c {n}/{total} on {date} at {time}', { n: 2, total: 5, date: '2026-01-01', time: '09:15' }), 'c 2/5 on 2026-01-01 at 09:15');
  assert.equal(localDate(Date.UTC(2026, 0, 1, 23, 30), 'Asia/Tokyo'), '2026-01-02');
});

test('tokens encrypt and decrypt, and the wrong key fails', async () => {
  const box = await encrypt('gho_secret', 'key-one');
  assert.notEqual(box, await encrypt('gho_secret', 'key-one'));
  assert.equal(await decrypt(box, 'key-one'), 'gho_secret');
  await assert.rejects(decrypt(box, 'key-two'));
});
