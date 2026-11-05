// Example graph: an irregular first ~22 weeks, then a commit every day.
const grid = document.getElementById('hero-grid');
const WEEKS = 53;
const START = 22;
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const frag = document.createDocumentFragment();
let first = true;
for (let w = 0; w < WEEKS; w++) {
  for (let d = 0; d < 7; d++) {
    const cell = document.createElement('span');
    const r = rand();
    if (w < START) {
      // Patchy: mostly empty, with occasional bursts.
      const level = r < 0.68 ? 0 : r < 0.84 ? 1 : r < 0.94 ? 2 : 3;
      if (level) cell.dataset.l = level;
    } else {
      cell.dataset.l = r < 0.25 ? 2 : r < 0.7 ? 3 : 4;
      cell.dataset.after = '';
      cell.style.setProperty('--d', `${(w - START) * 28 + d * 14}ms`);
      if (first) { cell.classList.add('start'); first = false; }
    }
    frag.append(cell);
  }
}
grid.append(frag);
// One orchestrated moment: the scheduled weeks fill in once, left to right.
new IntersectionObserver((entries, io) => {
  if (entries[0].isIntersecting) { grid.classList.add('animate'); io.disconnect(); }
}, { threshold: 0.4 }).observe(grid);

const err = new URLSearchParams(location.search).get('error');
if (err) {
  const box = document.getElementById('error');
  box.textContent = err === 'state'
    ? 'Sign-in expired before it finished. Start again.'
    : 'GitHub sign-in did not complete. Start again, and approve access when GitHub asks.';
  box.classList.remove('hidden');
}
