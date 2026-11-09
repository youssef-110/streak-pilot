import { DurableObject } from 'cloudflare:workers';
import { occurrences, nextOccurrences } from './schedule.js';
import { execute } from './runner.js';
import { loadUser, loadSlots } from './db.js';

/**
 * One instance per user. It keeps a single alarm set to that user's next slot,
 * so commits land at the exact minute without a global cron scan.
 */
export class Scheduler extends DurableObject {
  /** Called after any settings change. Returns the next fire time, or null. */
  async rearm(userId) {
    await this.ctx.storage.put({ user: userId, cursor: Date.now() });
    return this.arm(userId);
  }

  async stop() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async arm(userId) {
    const cfg = await this.config(userId);
    if (!cfg) { await this.ctx.storage.deleteAlarm(); return null; }
    const [next] = nextOccurrences(cfg, Date.now(), 1);
    if (!next) { await this.ctx.storage.deleteAlarm(); return null; }
    await this.ctx.storage.setAlarm(next.fireMs);
    return next.fireMs;
  }

  async config(userId) {
    const user = await loadUser(this.env, userId);
    // Keep firing while a refresh token exists, even if the last run failed: it may renew.
    if (!user || user.paused || !user.repo || !user.token_enc || (!user.token_ok && !user.refresh_enc)) return null;
    const slots = await loadSlots(this.env, userId);
    if (!slots.length) return null;
    return { user, slots, tz: user.timezone, jitter: user.jitter, seed: String(userId) };
  }

  async alarm() {
    const userId = await this.ctx.storage.get('user');
    if (!userId) return;
    const now = Date.now();
    const cursor = (await this.ctx.storage.get('cursor')) ?? now - 60_000;
    const cfg = await this.config(userId);
    if (cfg) {
      for (const occ of occurrences(cfg, cursor, now)) {
        await execute(this.env, cfg.user, {
          runKey: `${userId}:${occ.slot.id}:${occ.date}`,
          kind: 'scheduled', date: occ.date, time: occ.slot.time,
          scheduledAt: occ.fireMs, count: occ.slot.commits, template: occ.slot.message,
        });
      }
    }
    await this.ctx.storage.put('cursor', now);
    await this.arm(userId);
  }
}
