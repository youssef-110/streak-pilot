import { encrypt, decrypt } from './crypto.js';
import { refreshAccess, GitHubError } from './github.js';
import { loadUser } from './db.js';

// Renew a few minutes early so a run never starts with a token about to die.
const EARLY_MS = 10 * 60_000;

const expired = (user) => user.token_expires_at && Date.now() > user.token_expires_at - EARLY_MS;

/** Store a token set from GitHub (sign-in or refresh) and mark the account healthy. */
export async function storeTokens(env, userId, t, matchRefreshEnc) {
  const tokenEnc = await encrypt(t.token, env.TOKEN_KEY);
  const refreshEnc = t.refresh ? await encrypt(t.refresh, env.TOKEN_KEY) : null;
  const expiresAt = t.expiresIn ? Date.now() + t.expiresIn * 1000 : null;
  const sql = `UPDATE users SET token_enc = ?, refresh_enc = ?, token_expires_at = ?, token_ok = 1 WHERE id = ?`;
  const stmt = matchRefreshEnc === undefined
    ? env.DB.prepare(sql).bind(tokenEnc, refreshEnc, expiresAt, userId)
    // Compare-and-swap: only replace the refresh token we actually used.
    : env.DB.prepare(`${sql} AND refresh_enc IS ?`).bind(tokenEnc, refreshEnc, expiresAt, userId, matchRefreshEnc);
  const res = await stmt.run();
  return { changed: res.meta.changes > 0, tokenEnc, refreshEnc, expiresAt };
}

/**
 * A working GitHub access token for this user, renewed with the refresh token when it
 * has expired (GitHub expires user tokens after 8 hours). `force` renews even if the
 * stored expiry says it is still valid, used after GitHub answers 401.
 * Mutates `user` so callers keep using the fresh token.
 */
export async function accessToken(env, user, { force = false } = {}) {
  if (env.MOCK_GITHUB === '1') return 'mock-token';
  if (!user.token_enc) throw new GitHubError(401, 'No GitHub token stored.');
  if (!force && !expired(user)) return decrypt(user.token_enc, env.TOKEN_KEY);
  if (!user.refresh_enc) {
    if (force || expired(user)) throw new GitHubError(401, 'GitHub token expired and cannot be renewed.');
    return decrypt(user.token_enc, env.TOKEN_KEY);
  }

  const usedRefreshEnc = user.refresh_enc;
  let fresh;
  try {
    fresh = await refreshAccess(env, await decrypt(usedRefreshEnc, env.TOKEN_KEY));
  } catch (e) {
    // Another request may have renewed first; refresh tokens are single-use.
    const latest = await loadUser(env, user.id);
    if (latest?.refresh_enc && latest.refresh_enc !== usedRefreshEnc) {
      Object.assign(user, latest);
      return decrypt(latest.token_enc, env.TOKEN_KEY);
    }
    throw new GitHubError(401, `GitHub refused to renew access: ${e.message}`);
  }
  const saved = await storeTokens(env, user.id, fresh, usedRefreshEnc);
  if (!saved.changed) {
    // Lost the race after all: use whatever the winner stored.
    const latest = await loadUser(env, user.id);
    if (latest) { Object.assign(user, latest); return decrypt(latest.token_enc, env.TOKEN_KEY); }
  }
  Object.assign(user, { token_enc: saved.tokenEnc, refresh_enc: saved.refreshEnc, token_expires_at: saved.expiresAt, token_ok: 1 });
  return fresh.token;
}

export async function markTokenBroken(env, userId) {
  // A refresh token GitHub refused is dead too; drop it so the account shows as disconnected.
  await env.DB.prepare('UPDATE users SET token_ok = 0, refresh_enc = NULL WHERE id = ?').bind(userId).run();
}
