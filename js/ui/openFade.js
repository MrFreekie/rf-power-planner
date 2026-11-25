// Fades a section's body in when the user opens it. Runs only on the open gesture (the toggle event), so rebuilt or re-rendered
// sections that are already open do not replay it.
export function mountOpenFade(root = document) {
  root.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d || d.tagName !== 'DETAILS' || !d.open || !d.classList) return;
    d.classList.remove('just-opened');
    void d.offsetWidth; // restart if reopened quickly
    d.classList.add('just-opened');
    const done = () => d.classList.remove('just-opened');
    d.addEventListener('animationend', done, { once: true });
    setTimeout(done, 400);
  }, true);
}
