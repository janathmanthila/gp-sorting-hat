/* The parchment-scroll picker: type to see matching names (nothing shows until then), arrows to move, Enter to sort. */
(function () {
  'use strict';
  let form = null;
  let input = null;
  let list = null;
  let people = [];
  let shown = [];
  let active = -1;
  let onPick = () => {};

  const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function mount(node, data, pick) {
    form = node;
    input = node.querySelector('input');
    list = node.querySelector('[role=listbox]');
    people = data.people;
    onPick = pick;
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('focus', () => render(input.value));
    input.addEventListener('keydown', onKey);
    list.addEventListener('mousedown', e => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      e.preventDefault();
      choose(Number(li.dataset.i));
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      choose(active);
    });
  }

  function render(query) {
    const q = fold(query.trim());
    shown = q ? people.filter(p => fold(`${p.name} ${p.department}`).includes(q)) : [];
    active = shown.length ? 0 : -1;
    if (!q) {
      list.hidden = true;
      list.innerHTML = '';
      sync();
      return;
    }
    list.innerHTML = shown.map((p, i) => `
      <li role="option" id="opt-${i}" data-i="${i}">
        <span>${esc(p.name)}</span><small>${esc(p.department)}</small>
      </li>`).join('') || '<li>No one by that name</li>';
    list.hidden = false;
    sync();
  }

  function sync() {
    input.setAttribute('aria-expanded', String(!list.hidden));
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `opt-${active}`);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, Math.min(shown.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      sync();
    } else if (e.key === 'Escape') {
      // First Esc clears the search; the next one leaves the box so R and M work as shortcuts.
      if (input.value) { input.value = ''; render(''); } else { input.blur(); list.hidden = true; }
    }
  }

  function choose(i) {
    const person = shown[i];
    if (!person) return;
    input.value = '';
    hide();
    onPick(person);
  }

  function hide() {
    input.blur();
    form.classList.add('away');
    list.hidden = true;
  }

  function show() {
    form.classList.remove('away');
    input.focus();
  }

  window.Picker = { mount, show, hide };
})();
