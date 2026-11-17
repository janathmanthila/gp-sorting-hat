/* House reveal: colour flash, unfurling banner and a burst of sparks. */
(function () {
  'use strict';
  const SPARKS = 260;
  let box = null;
  let label = null;
  let canvas = null;
  let ctx = null;
  let sparks = [];
  let raf = 0;

  function mount(root) {
    box = root.querySelector('#reveal');
    label = box.querySelector('span');
    canvas = root.querySelector('#sparks');
    ctx = canvas.getContext('2d');
    const resize = () => {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
    };
    resize();
    addEventListener('resize', resize);
  }

  function show(house) {
    box.style.setProperty('--house', house.color);
    label.textContent = house.name;
    box.hidden = false;
    box.classList.remove('play');
    void box.offsetWidth; // restart the CSS animations
    box.classList.add('play');
    burst(house.color);
  }

  function hide() {
    box.hidden = true;
    box.classList.remove('play');
    sparks = [];
    cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function burst(color) {
    const s = devicePixelRatio;
    for (let i = 0; i < SPARKS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (4 + Math.random() * 14) * s;
      sparks.push({
        x: canvas.width / 2, y: canvas.height * 0.62, // centre of the reveal banner, below the risen hat
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 6 * s,
        life: 1, decay: 0.006 + Math.random() * 0.012, size: (1.5 + Math.random() * 3) * s,
        color: Math.random() < 0.6 ? color : '#ffe6a3',
      });
    }
    if (!raf) raf = requestAnimationFrame(step);
  }

  function step() {
    const s = devicePixelRatio;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of sparks) {
      p.vy += 0.25 * s;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    sparks = sparks.filter(p => p.life > 0);
    if (sparks.length) {
      raf = requestAnimationFrame(step);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      raf = 0;
    }
  }

  window.Reveal = { mount, show, hide };
})();
