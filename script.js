// Lightweight real-time chart and animations for Bisto AI
(function () {
  'use strict';

  // Helpers
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const supportsReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Footer year
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Counters (trust)
  $$('.stat-number').forEach(el => {
    const target = parseFloat(el.getAttribute('data-target')) || 0;
    animateCounter(el, target, 1000, target % 1 !== 0);
  });

  function animateCounter(el, to, duration = 1000, isFloat = false) {
    if (supportsReducedMotion) {
      el.textContent = isFloat ? to.toFixed(2) : Math.round(to).toLocaleString();
      return;
    }
    const start = 0;
    const startTime = performance.now();
    (function frame(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const val = start + (to - start) * (1 - Math.pow(1 - t, 3));
      el.textContent = isFloat ? val.toFixed(2) : Math.round(val).toLocaleString();
      if (t < 1) requestAnimationFrame(frame);
    })(performance.now());
  }

  // REAL-TIME CHART (canvas) -- simulated live feed (random walk). Hook point for real data feed below.
  const canvas = document.getElementById('realtime-chart');
  let ctx, width, height, DPR;
  if (canvas) {
    ctx = canvas.getContext('2d');
    DPR = window.devicePixelRatio || 1;
    function resizeCanvas() {
      width = Math.floor(canvas.clientWidth);
      height = Math.floor(canvas.clientHeight);
      canvas.width = Math.floor(width * DPR);
      canvas.height = Math.floor(height * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resizeCanvas();
    window.addEventListener('resize', () => { resizeCanvas(); });

    // Data buffer
    const MAX_POINTS = 120;
    const data = [];
    // Seed initial data (sine + noise)
    for (let i = 0; i < MAX_POINTS; i++) {
      data.push(0.5 + 0.01 * Math.sin(i / 6) + (Math.random() - 0.5) * 0.02);
    }

    // Simulated real-time feed: push new point every 700ms (adjustable)
    let running = true;
    const INTERVAL_MS = 700;
    setInterval(() => {
      if (!running) return;
      const last = data.length ? data[data.length - 1] : 0.5;
      // random walk with gentle drift up
      const change = (Math.random() - 0.45) * 0.03; // slight upward bias
      let next = Math.max(0, Math.min(1, last + change));
      data.push(next);
      if (data.length > MAX_POINTS) data.shift();
      // update small stat values (24h/7d/YTD) from data trend
      updateMiniStats(data);
    }, INTERVAL_MS);

    // Drawing loop for smooth animation
    let lastDraw = performance.now();
    function draw(now) {
      const dt = now - lastDraw;
      lastDraw = now;
      // clear
      ctx.clearRect(0, 0, width, height);

      // background gradient
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, 'rgba(0,82,255,0.12)');
      g.addColorStop(1, 'rgba(0,47,140,0.02)');
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, width, height, 8);
      ctx.fill();

      // area and line
      const padding = 8;
      const innerW = width - padding * 2;
      const innerH = height - padding * 2;
      const step = innerW / (MAX_POINTS - 1);

      // build path
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = padding + i * step;
        const y = padding + (1 - data[i]) * innerH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // stroke
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#74A6FF';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      // draw fill area under curve
      ctx.lineTo(padding + (data.length - 1) * step, padding + innerH);
      ctx.lineTo(padding, padding + innerH);
      ctx.closePath();
      const g2 = ctx.createLinearGradient(0, padding, 0, padding + innerH);
      g2.addColorStop(0, 'rgba(0,82,255,0.18)');
      g2.addColorStop(1, 'rgba(0,82,255,0.02)');
      ctx.fillStyle = g2;
      ctx.fill();

      // moving dot at the latest point
      const lastX = padding + (data.length - 1) * step;
      const lastY = padding + (1 - data[data.length - 1]) * innerH;
      ctx.beginPath();
      ctx.fillStyle = '#fff';
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0052FF';
      ctx.stroke();

      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    // helper draw functions
    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function updateMiniStats(d) {
      // compute simple stats: last vs average
      const last = d[d.length - 1];
      const avg24 = average(d.slice(-24));
      const avg7 = average(d.slice(-56));
      const avgY = average(d.slice(0)); // entire buffer
      // convert to percent change
      const p24 = ((last - avg24) / Math.max(0.0001, avg24)) * 100;
      const p7 = ((last - avg7) / Math.max(0.0001, avg7)) * 100;
      const pY = ((last - avgY) / Math.max(0.0001, avgY)) * 100;
      $('#stat-1').textContent = (p24 >= 0 ? '+' : '') + p24.toFixed(1) + '%';
      $('#stat-2').textContent = (p7 >= 0 ? '+' : '') + p7.toFixed(1) + '%';
      $('#stat-3').textContent = (pY >= 0 ? '+' : '') + pY.toFixed(1) + '%';
    }
    function average(arr) { if (!arr.length) return 0; return arr.reduce((s,v) => s+v,0)/arr.length; }

    // Expose hook for real data (replace random with actual feed)
    window.BistoAI_Chart = {
      pushValue: (v) => {
        data.push(clamp01(v));
        if (data.length > MAX_POINTS) data.shift();
      },
      stop: () => { running = false; },
      start: () => { running = true; }
    };
  }

  // Utility
  function clamp01(v){ return Math.max(0, Math.min(1, v)); }

  // Simple animated entrance for cards
  document.querySelectorAll('.animated').forEach(el => {
    el.style.opacity = 0;
    const d = parseInt(getComputedStyle(el).getPropertyValue('--delay')) || 0;
    setTimeout(() => {
      el.style.transition = 'transform .6s cubic-bezier(.2,.9,.2,1), opacity .6s ease';
      el.style.transform = 'translateY(0)';
      el.style.opacity = 1;
    }, 140 + d);
  });

  // Header elevation on scroll
  const header = document.getElementById('site-header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 8) header.classList.add('elevated'); else header.classList.remove('elevated');
  }, { passive: true });

  // Smooth anchors
  document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', (e) => {
    const href = a.getAttribute('href');
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({behavior:'smooth', block:'start'});
      target.setAttribute('tabindex','-1');
      target.focus({preventScroll:true});
      setTimeout(()=>target.removeAttribute('tabindex'),800);
    }
  }));

})();