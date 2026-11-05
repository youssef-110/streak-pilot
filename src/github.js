// Thin GitHub REST client. MOCK_GITHUB=1 swaps in a fake for local dev.

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const UA = 'streak-pilot';
const PULSE_PATH = '.github/streak-pulse.txt';

export function github(token) {
  async function call(path, init = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': UA,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!res.ok) {
      let msg = `GitHub returned ${res.status}`;
      try { msg = (await res.json()).message || msg; } catch {}
      throw new GitHubError(res.status, msg);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    user: () => call('/user'),
    repos: () => call('/user/repos?per_page=100&sort=pushed&affiliation=owner'),
    repo: (full) => call(`/repos/${full}`),
    createRepo: (name, isPrivate) => call('/user/repos', {
      method: 'POST',
      body: JSON.stringify({ name, private: isPrivate, auto_init: true, description: 'Daily commits scheduled by Streak Pilot.' }),
    }),
    /** Make `count` sequential commits to the pulse file. Returns the last commit URL. */
    async commit(full, branch, messages, stamp) {
      let sha;
      try {
        sha = (await call(`/repos/${full}/contents/${PULSE_PATH}?ref=${encodeURIComponent(branch)}`)).sha;
      } catch (e) { if (e.status !== 404) throw e; }
      let url = null;
      let made = 0;
      try {
        for (const message of messages) {
          const content = btoa(String.fromCharCode(...new TextEncoder().encode(`Streak Pilot pulse\n${stamp}\n${message}\n#${made + 1}\n`)));
          const out = await call(`/repos/${full}/contents/${PULSE_PATH}`, {
            method: 'PUT',
            body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) }),
          });
          sha = out.content.sha;
          url = out.commit.html_url;
          made++;
        }
      } catch (e) { e.made = made; e.url = url; throw e; }
      return { made, url };
    },
  };
}

export async function exchangeCode(env, code) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'GitHub sign-in failed.');
  return { token: data.access_token, scope: data.scope || '' };
}

export async function revokeGrant(env, token) {
  await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/grant`, {
    method: 'DELETE',
    headers: {
      authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
      accept: 'application/vnd.github+json', 'user-agent': UA, 'content-type': 'application/json',
    },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => {});
}

// Fake GitHub for local development and tests: no network, no real commits.
export function mockGithub() {
  const repos = [
    { full_name: 'demo/streak', private: true, default_branch: 'main', pushed_at: new Date().toISOString() },
    { full_name: 'demo/notes', private: false, default_branch: 'main', pushed_at: new Date().toISOString() },
  ];
  return {
    user: async () => ({ id: 1, login: 'demo', name: 'Demo User', avatar_url: '' }),
    repos: async () => repos,
    repo: async (full) => repos.find((r) => r.full_name === full) || { full_name: full, private: true, default_branch: 'main' },
    createRepo: async (name, isPrivate) => { const r = { full_name: `demo/${name}`, private: isPrivate, default_branch: 'main' }; repos.unshift(r); return r; },
    commit: async (full, _branch, messages) => ({ made: messages.length, url: `https://github.com/${full}/commits` }),
  };
}

export const client = (env, token) => (env.MOCK_GITHUB === '1' ? mockGithub() : github(token));
