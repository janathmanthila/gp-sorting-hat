/* Boots the Great Hall from the server's current set and wires the picker to the ceremony. */
(async function () {
  'use strict';
  const hall = document.getElementById('hall');
  Hat.mount(document.getElementById('hat'));
  Hat.pose('asleep');
  const res = await fetch('/api/show');
  const data = await res.json();
  if (!res.ok) {
    Hall.mount(hall, []);
    document.getElementById('picker').hidden = true;
    const notice = document.getElementById('notice');
    notice.querySelector('p').textContent = data.error;
    notice.hidden = false;
    return;
  }
  Hall.mount(hall, data.houses);
  Reveal.mount(hall);
  Subtitles.mount(document.getElementById('subtitle'));
  Ceremony.init(data, { hall, name: document.getElementById('name'), hint: document.getElementById('hint') });
  Picker.mount(document.getElementById('picker'), data, Ceremony.sort);

  // Browsers only allow sound after the first click or key press.
  const unlock = () => {
    Sfx.startAmbience();
    removeEventListener('pointerdown', unlock);
    removeEventListener('keydown', unlock);
  };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
  addEventListener('keydown', Ceremony.onKey);
  document.getElementById('pick').focus();
})();
