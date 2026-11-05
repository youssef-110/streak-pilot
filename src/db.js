export const loadUser = (env, id) => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();

export async function loadSlots(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT id, time, commits, days, message FROM slots WHERE user_id = ? ORDER BY position',
  ).bind(userId).all();
  return results;
}
