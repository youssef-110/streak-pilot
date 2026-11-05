const grid = document.getElementById('hero-grid');
const weeks = 53;
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const frag = document.createDocumentFragment();
for (let w = 0; w < weeks; w++) {
  for (let d = 0; d < 7; d++) {
    const cell = document.createElement('span');
    const r = rand();
    cell.dataset.l = r < 0.08 ? 1 : r < 0.4 ? 2 : r < 0.8 ? 3 : 4;
    // Sweep left to right with a little vertical stagger.
    cell.style.setProperty('--d', `${w * 22 + d * 18}ms`);
    frag.append(cell);
  }
}
grid.append(frag);
requestAnimationFrame(() => grid.classList.add('animate'));

const err = new URLSearchParams(location.search).get('error');
if (err) {
  const box = document.getElementById('error');
  box.textContent = err === 'state'
    ? 'Sign-in expired before it finished. Start again.'
    : 'GitHub sign-in did not complete. Start again, and approve access when GitHub asks.';
  box.classList.remove('hidden');
}
