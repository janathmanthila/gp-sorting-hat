/* The Great Hall at Christmas: twinkling ceiling with falling snow, floating candles, house banners under a garland,
 * two decorated trees, and feast tables laid for Christmas, kept to warm white light, gold and deep red. */
(function () {
  'use strict';
  const CANDLES = 30;
  const SNUFFED_SHARE = 0.8; // a few candles stay lit for atmosphere
  let hall = null;
  let candles = [];
  let banners = [];
  let tables = [];
  let timers = [];

  function mount(root, houses) {
    hall = root;
    drawSky(root.querySelector('#sky'));
    const candleBox = root.querySelector('#candles');
    for (let i = 0; i < CANDLES; i++) {
      const c = document.createElement('div');
      c.className = 'candle';
      c.style.left = `${4 + Math.random() * 92}%`;
      c.style.top = `${6 + Math.random() * 40}%`;
      c.style.scale = String(0.6 + Math.random() * 0.6);
      c.style.setProperty('--bob', `${4 + Math.random() * 4}s`);
      c.style.animationDelay = `${-Math.random() * 8}s`;
      c.innerHTML = '<span class="flame"></span>';
      candleBox.append(c);
      candles.push(c);
    }
    const bannerBox = root.querySelector('#banners');
    houses.forEach(house => {
      const b = document.createElement('div');
      b.className = 'banner';
      b.textContent = house.name;
      b.style.setProperty('--house', house.color);
      bannerBox.append(b);
      banners.push(b);
    });
    tables = drawTables(root.querySelector('#tables'), houses);
    root.querySelectorAll('.tree').forEach(drawTree);
    drawGarland(root.querySelector('#garland'));
    addEventListener('resize', () => drawGarland(root.querySelector('#garland')));
    drawSnow(root.querySelector('#snow'));
  }

  // ---- Christmas feast tables, drawn in perspective: X across, Y up, Z away from the viewer, the eye above the aisle ----

  // The tables box is the lower 60vh (1 unit = 1px at 1600×900); the camera matches the approved mockup, so the far ends
  // of the tables recede behind the hat and it stands in the aisle between them.
  const CAM = { cx: 800, horizon: 15, focal: 537, eye: 2.15 };
  const LIGHTS = ['#fff3d6', '#ffe6b0', '#fff9ec']; // warm white only
  const project = (x, y, z) => [CAM.cx + (x * CAM.focal) / z, CAM.horizon + ((CAM.eye - y) * CAM.focal) / z];
  const at = (x, y, z) => project(x, y, z).map(n => n.toFixed(1));
  const quad = (cls, corners) => `<polygon class="${cls}" points="${corners.map(c => at(...c).join(',')).join(' ')}"/>`;
  const size = (r, z) => ((r * CAM.focal) / z).toFixed(1);
  const rand = (() => { let seed = 7; return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); })(); // same hall every time

  function drawTables(svg, houses) {
    const count = houses.length || 4;
    const left = Math.ceil(count / 2);
    const right = count - left;
    const spread = side => 1.9 / Math.max(side, 1);
    const xs = [
      ...Array.from({ length: left }, (_, k) => -(0.85 + spread(left) * (left - 1 - k + 0.5))),
      ...Array.from({ length: right }, (_, k) => 0.85 + spread(right) * (k + 0.5)),
    ];
    const width = Math.min(0.26, spread(Math.max(left, right)) * 0.27);
    // Outer tables first, so the inner ones (nearer the aisle) overlap them.
    const order = xs.map((x, i) => i).sort((a, b) => Math.abs(xs[b]) - Math.abs(xs[a]));
    const groups = [];
    svg.innerHTML = `<defs>
        <filter id="halo" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>`;
    // A gold-edged carpet down the aisle to the hat.
    const [cNear, cFar] = [1.2, 6.2];
    svg.insertAdjacentHTML('beforeend', quad('carpet', [[-0.22, 0, cNear], [0.22, 0, cNear], [0.22, 0, cFar], [-0.22, 0, cFar]])
      + [-0.19, 0.19].map(x => `<polyline class="carpet-edge" points="${at(x, 0, cNear).join(',')} ${at(x, 0, cFar).join(',')}"/>`).join(''));
    for (const i of order) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'table');
      if (houses[i]) g.style.setProperty('--house', houses[i].color);
      g.innerHTML = feastTable(xs[i], width);
      svg.append(g);
      groups[i] = g;
    }
    return houses.length ? groups : [];
  }

  function feastTable(cx, w) {
    const side = Math.sign(cx);
    const inner = cx - side * w; // the long edge facing the aisle, the one we can see
    const outer = cx + side * w;
    const [near, far, top, hem] = [2, 6.2, 0.8, 0.52]; // starting 2 away keeps the tables clear of the trees
    const parts = [];
    // House glow on the floor (shown when the house is revealed).
    parts.push(quad('halo', [[inner - side * 0.6, 0.3, near], [outer + side * 0.6, 0.3, near], [outer + side * 0.6, 0.3, far], [inner - side * 0.6, 0.3, far]]));
    // Benches: the outer one hides behind the table; the inner one, drawn after the cloth, shows its seat and side.
    const bench = (a, b) => {
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
      const aisleEdge = side > 0 ? lo : hi;
      const out = [
        quad('bench-side', [[aisleEdge, 0.46, near], [aisleEdge, 0.46, far], [aisleEdge, 0.38, far], [aisleEdge, 0.38, near]]),
        quad('bench-top', [[lo, 0.46, near], [hi, 0.46, near], [hi, 0.46, far], [lo, 0.46, far]]),
        quad('bench-side', [[lo, 0.46, near], [hi, 0.46, near], [hi, 0.38, near], [lo, 0.38, near]]),
      ];
      for (const x of [lo + 0.02, hi - 0.04]) out.push(quad('leg', [[x, 0.38, near + 0.05], [x + 0.02, 0.38, near + 0.05], [x + 0.02, 0, near + 0.05], [x, 0, near + 0.05]]));
      return out.join('');
    };
    parts.push(bench(outer + side * 0.08, outer + side * 0.22));
    // Legs under the cloth, then the cloth: top, the side drape facing the aisle, the front drape, gold trim.
    for (const x of [inner + side * 0.03, outer - side * 0.06]) {
      const [l, r] = [Math.min(x, x + side * 0.04), Math.max(x, x + side * 0.04)];
      parts.push(quad('leg', [[l, hem, near + 0.04], [r, hem, near + 0.04], [r, 0, near + 0.04], [l, 0, near + 0.04]]));
    }
    parts.push(quad('cloth-side', [[inner, top, near], [inner, top, far], [inner, hem, far], [inner, hem, near]]));
    parts.push(quad('cloth-top', [[inner, top, near], [outer, top, near], [outer, top, far], [inner, top, far]]));
    parts.push(quad('cloth-front', [[inner, top, near], [outer, top, near], [outer, hem, near], [inner, hem, near]]));
    parts.push(`<polyline class="trim" points="${[[outer, hem, near], [inner, hem, near], [inner, hem, far]].map(c => at(...c).join(',')).join(' ')}"/>`);
    parts.push(`<polyline class="trim edge" points="${[[outer, top, near], [inner, top, near], [inner, top, far]].map(c => at(...c).join(',')).join(' ')}"/>`);
    parts.push(bench(inner - side * 0.22, inner - side * 0.08));
    // Down the middle: a slim pine garland with warm fairy lights, and a few tall candles.
    const items = [];
    const lights = [];
    for (let z = far, k = 0; z > near + 0.1; z -= 0.035, k++) {
      const [x, y] = at(cx + (rand() - 0.5) * 0.06, top + 0.01 + rand() * 0.02, z);
      items.push([z, `<ellipse class="pine p${k % 3}" cx="${x}" cy="${y}" rx="${size(0.026, z)}" ry="${size(0.014, z)}" transform="rotate(${Math.round((rand() - 0.5) * 70)} ${x} ${y})"/>`]);
      if (k % 4 === 1) {
        const [lx, ly] = at(cx + (k % 8 === 1 ? 0.035 : -0.035), top + 0.03, z);
        lights.push(`<circle class="light" cx="${lx}" cy="${ly}" r="${size(0.011, z)}" style="--c:${LIGHTS[k % LIGHTS.length]};animation-delay:${(-rand() * 3).toFixed(2)}s"/>`);
      }
    }
    for (let z = far - 0.3; z > near + 0.3; z -= 0.6) {
      const [tx, ty] = at(cx, top + 0.02, z);
      const cw = size(0.011, z);
      const ch = size(0.2, z);
      items.push([z - 0.01, `<ellipse class="tglow" cx="${tx}" cy="${(ty - ch).toFixed(1)}" rx="${(cw * 9).toFixed(1)}" ry="${(cw * 9).toFixed(1)}"/>
        <rect class="taper" x="${(tx - cw).toFixed(1)}" y="${(ty - ch).toFixed(1)}" width="${(cw * 2).toFixed(1)}" height="${ch}"/>
        <ellipse class="tflame" cx="${tx}" cy="${(ty - ch - cw * 1.6).toFixed(1)}" rx="${(cw * 1.1).toFixed(1)}" ry="${(cw * 2.2).toFixed(1)}" style="animation-delay:${(-rand()).toFixed(2)}s"/>`]);
    }
    items.sort((a, b) => b[0] - a[0]);
    parts.push(...items.map(i => i[1]));
    parts.push(`<g filter="url(#glow)">${lights.join('')}</g>`);
    return parts.join('');
  }

  // ---- a decorated Christmas tree (one per .tree element) ----

  function drawTree(node) {
    const tiers = [[150, 290, 120], [150, 225, 100], [150, 165, 78], [150, 110, 55]]; // [cx, base y, half width]
    const parts = ['<rect x="140" y="285" width="20" height="30" fill="#3b2412"/>'];
    tiers.forEach(([cx, y, hw], i) => {
      const peak = y - 95 + i * 6;
      parts.push(`<path d="M${cx} ${peak} L${cx + hw} ${y} Q${cx} ${y + 14} ${cx - hw} ${y} Z" fill="url(#fir)"/>`);
    });
    // A garland of lights winding down the tree, and baubles between.
    const lights = [];
    for (let row = 0; row < 7; row++) {
      const y = 60 + row * 36;
      const hw = 18 + row * 15;
      for (let k = 0; k < 4 + row; k++) {
        const t = (k + 0.5) / (4 + row);
        const x = 150 - hw + 2 * hw * t;
        const yy = y + Math.sin(t * Math.PI) * 10;
        lights.push(`<circle class="light" cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.6" style="--c:${LIGHTS[(row + k) % LIGHTS.length]};animation-delay:${(-rand() * 3).toFixed(2)}s"/>`);
        if ((row + k) % 4 === 1) parts.push(`<circle cx="${(x + 6).toFixed(1)}" cy="${(yy + 14).toFixed(1)}" r="6" fill="url(#tree-gold)"/>`);
      }
    }
    node.innerHTML = `<svg viewBox="0 0 300 320" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <linearGradient id="fir" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#245a3c"/><stop offset=".55" stop-color="#163f29"/><stop offset="1" stop-color="#0b2416"/></linearGradient>
        <radialGradient id="tree-gold" cx="35%" cy="30%"><stop offset="0" stop-color="#fff"/><stop offset=".15" stop-color="#ffe08a"/><stop offset=".6" stop-color="#c8901f"/><stop offset="1" stop-color="#6b4a0e"/></radialGradient>
        <filter id="tree-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      ${parts.join('')}
      <g filter="url(#tree-glow)">${lights.join('')}
        <path class="star" d="M150 2 L157 20 L176 20 L161 31 L167 49 L150 38 L133 49 L139 31 L124 20 L143 20 Z"/>
      </g>
    </svg>`;
  }

  // ---- a pine garland with gold bows and warm lights, draped across the top between the banners ----

  function drawGarland(svg) {
    const w = innerWidth;
    const h = innerHeight * 0.2;
    const anchors = [0, ...banners.map(b => { const r = b.getBoundingClientRect(); return r.left + r.width / 2; }), w];
    if (anchors.length < 3) anchors.splice(1, 0, w / 3, (2 * w) / 3);
    const sag = h * 0.55;
    const top = h * 0.12;
    const pine = [];
    const lights = [];
    const bows = [];
    let k = 0;
    for (let i = 0; i < anchors.length - 1; i++) {
      const [a, b] = [anchors[i], anchors[i + 1]];
      for (let t = 0; t <= 1; t += 0.025) {
        const x = a + (b - a) * t;
        const y = top + sag * 4 * t * (1 - t);
        pine.push(`<circle class="pine p${k % 3}" cx="${x.toFixed(1)}" cy="${(y + (rand() - 0.5) * 6).toFixed(1)}" r="${(h * 0.075).toFixed(1)}"/>`);
        if (k % 3 === 0) lights.push(`<circle class="light" cx="${x.toFixed(1)}" cy="${(y + h * 0.06).toFixed(1)}" r="${(h * 0.02).toFixed(1)}" style="--c:${LIGHTS[(k / 3) % LIGHTS.length]};animation-delay:${(-rand() * 3).toFixed(2)}s"/>`);
        k++;
      }
    }
    for (const x of anchors.slice(1, -1)) {
      const s = h * 0.13;
      bows.push(`<g class="bow" transform="translate(${x.toFixed(1)} ${(top + 2).toFixed(1)})">
        <path d="M0 0 L${-s * 0.5} ${s * 1.8} L${-s * 0.1} ${s * 1.5} L0 0 L${s * 0.1} ${s * 1.5} L${s * 0.5} ${s * 1.8} Z"/>
        <path d="M0 0 C${-s * 1.6} ${-s} ${-s * 1.6} ${s} 0 0 C${s * 1.6} ${-s} ${s * 1.6} ${s} 0 0 Z"/>
        <circle r="${(s * 0.3).toFixed(1)}"/></g>`);
    }
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = `<defs><filter id="garland-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${pine.join('')}<g filter="url(#garland-glow)">${lights.join('')}</g>${bows.join('')}`;
  }

  // ---- snow falling from the enchanted ceiling ----

  function drawSnow(canvas) {
    const ctx = canvas.getContext('2d');
    let flakes = [];
    const flake = top => ({
      x: Math.random(), y: top ? -0.05 : Math.random(), r: 0.6 + Math.random() * 2.4,
      fall: 0.018 + Math.random() * 0.035, sway: 0.004 + Math.random() * 0.01, phase: Math.random() * 6.28,
    });
    const resize = () => {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
      flakes = Array.from({ length: 170 }, () => flake(false));
    };
    resize();
    addEventListener('resize', resize);
    let last = performance.now();
    const frame = now => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        f.y += f.fall * dt * (0.6 + f.r / 3);
        f.phase += dt;
        if (f.y > 1.02) flakes[i] = flake(true);
        const x = (f.x + Math.sin(f.phase) * f.sway) * canvas.width;
        ctx.globalAlpha = (0.35 + f.r / 5) * Math.min(1, (1.02 - f.y) * 4);
        ctx.beginPath();
        ctx.arc(x, f.y * canvas.height, f.r * devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function drawSky(canvas) {
    const ctx = canvas.getContext('2d');
    let stars = [];
    const resize = () => {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
      stars = Array.from({ length: 220 }, () => ({
        x: Math.random(), y: Math.random() * 0.6, r: 0.3 + Math.random() * 1.4, phase: Math.random() * 6.28, speed: 0.5 + Math.random() * 1.5,
      }));
    };
    resize();
    addEventListener('resize', resize);
    const frame = now => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff6dc';
      for (const s of stars) {
        ctx.globalAlpha = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.phase + (now / 1000) * s.speed))) * (1 - s.y);
        ctx.beginPath();
        ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r * devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // 0 = all lit, 1 = dark around the hat.
  function setDim(level) { hall.style.setProperty('--dim', String(level)); }

  // Puts candles out one by one over `ms`.
  function snuffCandles(ms) {
    const order = [...candles].sort(() => Math.random() - 0.5).slice(0, Math.round(candles.length * SNUFFED_SHARE));
    order.forEach((c, i) => timers.push(setTimeout(() => c.classList.add('out'), (ms * i) / order.length)));
  }

  function relight() {
    timers.forEach(clearTimeout);
    timers = [];
    candles.forEach(c => c.classList.remove('out'));
    setDim(0);
  }

  function glowHouse(i) {
    banners[i]?.classList.add('glow');
    tables[i]?.classList.add('glow');
  }

  function reset() {
    relight();
    [...banners, ...tables].forEach(n => n.classList.remove('glow'));
  }

  window.Hall = { mount, setDim, snuffCandles, relight, glowHouse, reset };
})();
