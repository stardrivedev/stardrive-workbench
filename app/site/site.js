/* stardrive.dev — starfield, scroll reveals, request-access form. No deps. */
'use strict';
document.documentElement.classList.add('js');

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Starfield ── */
(() => {
  const canvas = document.getElementById('stars');
  const ctx = canvas.getContext('2d');
  let stars = [];

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(180, Math.floor((innerWidth * innerHeight) / 9000));
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: Math.random() * 1.15 + 0.25,
      a: Math.random() * 0.5 + 0.15,
      tw: Math.random() * 0.015 + 0.004,
      ph: Math.random() * Math.PI * 2,
      vy: Math.random() * 0.02 + 0.005,
    }));
  }

  let t = 0;
  function frame() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    t += 1;
    for (const s of stars) {
      const alpha = reduced ? s.a : s.a * (0.65 + 0.35 * Math.sin(t * s.tw + s.ph));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#cfc9ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (!reduced) {
        s.y -= s.vy;
        if (s.y < -2) { s.y = innerHeight + 2; s.x = Math.random() * innerWidth; }
      }
    }
    ctx.globalAlpha = 1;
    if (!reduced) requestAnimationFrame(frame);
  }

  size();
  frame();
  addEventListener('resize', () => { size(); if (reduced) frame(); });
})();

/* ── Scroll reveals ── */
(() => {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
})();

/* ── Request access ── */
(() => {
  const form = document.getElementById('accessForm');
  const note = document.getElementById('accessNote');
  const btn = document.getElementById('accessSubmit');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    note.className = 'form-note';
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const res = await fetch('/site/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        note.className = 'form-note ok';
        note.textContent = '✶ Request received. We reply to every one — check your inbox soon.';
        form.reset();
      } else {
        note.className = 'form-note err';
        note.textContent = body?.error?.message || 'Something went wrong — please try again.';
      }
    } catch {
      note.className = 'form-note err';
      note.textContent = 'Network error — please try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Request access';
    }
  });
})();
