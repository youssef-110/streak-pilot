import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { accessToken, storeTokens } from '../src/tokens.js';
import { encrypt, decrypt } from '../src/crypto.js';

const KEY = 'test-key';
let row;
let fetches;
let nextFetch;

// Minimal D1 stand-in covering the statements tokens.js and db.js run.
const DB = {
  prepare(sql) {
    return {
      bind(...a) {
        return {
          async first() { return sql.startsWith('SELECT') ? { ...row } : null; },
          async run() {
            if (sql.startsWith('UPDATE users SET token_enc')) {
              const [tokenEnc, refreshEnc, expiresAt, , match] = a;
              if (sql.includes('AND refresh_enc IS ?') && row.refresh_enc !== match) return { meta: { changes: 0 } };
              Object.assign(row, { token_enc: tokenEnc, refresh_enc: refreshEnc, token_expires_at: expiresAt, token_ok: 1 });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('UPDATE users SET token_ok = 0')) { row.token_ok = 0; row.refresh_enc = null; }
            return { meta: { changes: 1 } };
          },
        };
      },
    };
  },
};
const env = { DB, TOKEN_KEY: KEY, GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'sec' };

beforeEach(async () => {
  fetches = 0;
  nextFetch = null;
  globalThis.fetch = async (_url, init) => {
    fetches++;
    const body = JSON.parse(init.body);
    assert.equal(body.grant_type, 'refresh_token');
    return { json: async () => nextFetch(body) };
  };
  row = {
    id: 7, token_ok: 1,
    token_enc: await encrypt('old-access', KEY),
    refresh_enc: await encrypt('refresh-1', KEY),
    token_expires_at: Date.now() + 3_600_000,
  };
});

test('a valid token is used without calling GitHub', async () => {
  const user = { ...row };
  assert.equal(await accessToken(env, user), 'old-access');
  assert.equal(fetches, 0);
});

test('an expired token is renewed and stored', async () => {
  row.token_expires_at = Date.now() - 1000;
  nextFetch = (b) => { assert.equal(b.refresh_token, 'refresh-1'); return { access_token: 'new-access', refresh_token: 'refresh-2', expires_in: 28800 }; };
  const user = { ...row };
  assert.equal(await accessToken(env, user), 'new-access');
  assert.equal(fetches, 1);
  assert.equal(await decrypt(row.refresh_enc, KEY), 'refresh-2');
  assert.ok(row.token_expires_at > Date.now() + 7 * 3_600_000);
  assert.equal(await decrypt(user.token_enc, KEY), 'new-access', 'caller sees the fresh token');
});

test('a token that expires within 10 minutes is renewed early', async () => {
  row.token_expires_at = Date.now() + 5 * 60_000;
  nextFetch = () => ({ access_token: 'early', refresh_token: 'r2', expires_in: 28800 });
  assert.equal(await accessToken(env, { ...row }), 'early');
});

test('losing a renewal race uses the token the other request stored', async () => {
  row.token_expires_at = Date.now() - 1000;
  const stale = { ...row };
  // The other request already renewed: GitHub now rejects refresh-1.
  await storeTokens(env, 7, { token: 'winner-access', refresh: 'refresh-2', expiresIn: 28800 });
  nextFetch = () => ({ error: 'bad_refresh_token' });
  assert.equal(await accessToken(env, stale), 'winner-access');
});

test('a dead refresh token raises 401', async () => {
  row.token_expires_at = Date.now() - 1000;
  nextFetch = () => ({ error: 'bad_refresh_token', error_description: 'The refresh token passed is incorrect or expired.' });
  await assert.rejects(accessToken(env, { ...row }), (e) => e.status === 401);
});

test('force renews even when the stored expiry looks fine', async () => {
  nextFetch = () => ({ access_token: 'forced', refresh_token: 'r3', expires_in: 28800 });
  assert.equal(await accessToken(env, { ...row }, { force: true }), 'forced');
});

test('tokens without expiry (classic OAuth) are never refreshed', async () => {
  row.token_expires_at = null;
  row.refresh_enc = null;
  assert.equal(await accessToken(env, { ...row }), 'old-access');
  assert.equal(fetches, 0);
});
