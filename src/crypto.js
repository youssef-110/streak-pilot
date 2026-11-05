// AES-GCM encryption for stored GitHub tokens, plus session token helpers.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function sha256(text) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

const keyCache = new Map();
async function importKey(secret) {
  if (!secret) throw new Error('TOKEN_KEY secret is not set.');
  let key = keyCache.get(secret);
  if (!key) {
    // Accept any secret string: derive a 256-bit key from it.
    const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
    key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keyCache.set(secret, key);
  }
  return key;
}

export async function encrypt(plain, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(secret), enc.encode(plain));
  return `v1.${b64url(iv)}.${b64url(data)}`;
}

export async function decrypt(box, secret) {
  const [v, iv, data] = String(box).split('.');
  if (v !== 'v1' || !iv || !data) throw new Error('Unknown token format.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await importKey(secret), fromB64url(data));
  return dec.decode(plain);
}
