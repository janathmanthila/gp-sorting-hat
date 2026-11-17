/* The Sorting Hat: an SVG drawing whose mouth opens with the voice, with CSS poses per state. */
(function () {
  'use strict';
  const SVG = `
<svg viewBox="0 0 300 300" role="img" aria-label="The Sorting Hat">
  <defs>
    <linearGradient id="hat-cloth" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a0754a"/><stop offset=".5" stop-color="#7a5434"/><stop offset="1" stop-color="#4a3019"/>
    </linearGradient>
    <linearGradient id="hat-brim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a6038"/><stop offset="1" stop-color="#3a2614"/>
    </linearGradient>
  </defs>
  <ellipse cx="150" cy="262" rx="138" ry="26" fill="url(#hat-brim)" stroke="#f0c47a" stroke-opacity=".35" stroke-width="2"/>
  <path fill="url(#hat-cloth)" stroke="#f0c47a" stroke-opacity=".45" stroke-width="2.5" d="M52 258 C74 214 92 176 104 140 C116 104 128 78 150 58 C170 40 196 34 214 22 C232 12 254 18 262 6 C258 30 236 40 220 52 C204 64 196 84 194 108 C192 140 214 196 248 258 Z"/>
  <g fill="none" stroke="#2a1a0d" stroke-width="3" stroke-linecap="round" opacity=".6">
    <path d="M86 224 C120 214 176 214 214 226"/>
    <path d="M118 96 C134 92 160 96 176 104"/>
    <path d="M160 62 C176 58 192 62 204 70"/>
  </g>
  <path d="M196 176 L232 168 L238 204 L202 210 Z" fill="#4a3320" stroke="#2a1a0d" stroke-width="2"/>
  <path d="M200 180 L230 173 M204 206 L234 200" stroke="#c9a46a" stroke-width="1.5" stroke-dasharray="4 4"/>
  <g fill="none" stroke="#1d1208" stroke-width="6" stroke-linecap="round">
    <path class="eye-open" d="M104 150 Q122 134 142 150 M160 146 Q180 130 198 146"/>
    <path class="eye-shut" d="M104 152 Q122 158 142 152 M160 148 Q180 154 198 148"/>
    <path stroke-width="4" d="M100 132 Q124 116 146 130 M158 126 Q182 112 204 128"/>
  </g>
  <path d="M98 196 Q150 180 206 194" fill="none" stroke="#1d1208" stroke-width="5" stroke-linecap="round"/>
  <path class="mouth" d="M100 196 Q150 182 204 194 Q154 244 100 196 Z" fill="#160b04"/>
</svg>`;
  let el = null;
  let mouth = null;

  function mount(node) {
    el = node;
    el.innerHTML = SVG;
    mouth = el.querySelector('.mouth');
    setMouth(0);
  }

  // 0 = closed, 1 = wide open.
  function setMouth(level) {
    const v = Math.max(0, Math.min(1, level));
    mouth.style.transform = `scaleY(${(0.06 + 0.94 * v).toFixed(3)})`;
  }

  // asleep | awake | thinking | shout
  function pose(name) { el.className = `hat ${name}`; }

  window.Hat = { mount, setMouth, pose };
})();
