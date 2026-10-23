import { App } from './ui/app.js';

function boot() {
  const bootScreen = document.getElementById('boot');
  const note = bootScreen?.querySelector('.boot-note');
  try {
    const app = new App();
    window.app = app;
    // Let the first frame paint before revealing the workspace.
    requestAnimationFrame(() => {
      setTimeout(() => bootScreen?.classList.add('done'), 180);
      setTimeout(() => { if (bootScreen) bootScreen.hidden = true; }, 650);
    });
  } catch (err) {
    console.error('TRAFFIX STUDIO failed to start:', err);
    if (note) {
      note.textContent = `Startup failed: ${err?.message || err}`;
      note.style.color = '#f87171';
    }
    if (bootScreen) bootScreen.classList.add('failed');
    const bar = bootScreen?.querySelector('.boot-bar');
    if (bar) bar.style.display = 'none';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
