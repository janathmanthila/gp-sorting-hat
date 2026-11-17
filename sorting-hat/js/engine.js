/*
 * House Draft engine: parsing, validation, drafting and cost.
 * Pure logic with no DOM or file access, so it runs in the browser and in Node tests.
 * Input "sheets" are plain objects: { sheetName: rows[][] } (as produced by SheetJS sheet_to_json header:1).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APP_ID = 'Sorting Hat House Draft';
  const FORMAT_VERSION = '1';
  const SUMMARY_SHEET = 'Summary';
  const RUN_INFO_SHEET = 'Run Info';
  const EMPLOYEES_SHEET = 'SL Employees';
  const OUTPUT_COLUMNS = ['Employee ID', 'First Name', 'Last Name', 'Work Email', 'Department', 'Gender', 'Assigned On'];
  const EMPLOYEE_COLUMNS = ['Employee ID', 'First Name', 'Last Name', 'Work Email', 'Department', 'Include',
    'Gender', 'Previous House', 'Overall Rating', 'Star Events', 'Fixed House'];
  const GENDERS = ['F', 'M'];
  const GENDER_LABEL = { F: 'Female', M: 'Male', '': 'Unspecified' };
  // Accepted spellings (compared upper-cased), normalised to F / M / blank.
  const GENDER_ALIASES = { '': '', F: 'F', FEMALE: 'F', M: 'M', MALE: 'M' };
  const MODES = { FULL: 'full', NEW: 'new' };
  // Breaking the ±1 house-size rule in Full Shuffle costs far more than any balance gain.
  const SIZE_PENALTY_FACTOR = 100;
  const EPS = 1e-9;
  const MAX_SEARCH_PASSES = 60;
  const ATTEMPTS = 16;
  const MAX_LISTED_ERRORS = 40;

  class ValidationError extends Error {
    constructor(messages, warnings) {
      super(messages.join('\n'));
      this.messages = messages;
      this.warnings = warnings || [];
    }
  }

  // ---------- small helpers ----------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const text = v => (v === null || v === undefined) ? '' : String(v).trim();
  const lower = v => text(v).toLowerCase();

  function toNumber(v) {
    if (typeof v === 'number') return v;
    const s = text(v);
    return s === '' ? NaN : Number(s);
  }

  function findSheet(sheets, name) {
    const k = Object.keys(sheets).find(n => lower(n) === lower(name));
    return k === undefined ? null : sheets[k];
  }

  /**
   * Reads a header-row table. Columns are matched by header name (case-insensitive), never by position.
   * Returns { records: [{ get(col), rowNumber }], missing: [col] } or null if the sheet has no header.
   */
  function readTable(rows, required) {
    const headerIdx = rows.findIndex(r => r && r.some(c => text(c) !== ''));
    if (headerIdx < 0) return null;
    const header = {};
    rows[headerIdx].forEach((c, i) => { const k = lower(c); if (k && !(k in header)) header[k] = i; });
    const missing = required.filter(c => !(lower(c) in header));
    const records = [];
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some(c => text(c) !== '')) continue;
      records.push({
        rowNumber: r + 1,
        has: col => lower(col) in header,
        get: col => { const i = header[lower(col)]; return i === undefined ? '' : row[i]; },
      });
    }
    return { records, missing };
  }

  function requireTable(sheets, sheetName, columns, errors, sourceLabel) {
    const rows = findSheet(sheets, sheetName);
    if (!rows) { errors.push(`${sourceLabel}: sheet "${sheetName}" is missing.`); return null; }
    const table = readTable(rows, columns);
    if (!table) { errors.push(`${sourceLabel}: sheet "${sheetName}" is empty.`); return null; }
    if (table.missing.length) {
      errors.push(`${sourceLabel}: sheet "${sheetName}" is missing column(s): ${table.missing.join(', ')}.`);
      return null;
    }
    return table;
  }

  function capErrors(errors) {
    if (errors.length <= MAX_LISTED_ERRORS) return errors;
    return errors.slice(0, MAX_LISTED_ERRORS).concat(`…and ${errors.length - MAX_LISTED_ERRORS} more problem(s).`);
  }

  // ---------- config ----------

  function parseConfig(sheets, errors) {
    const src = 'Employee data file';
    const config = { houses: [], houseByKey: {}, events: [], eventByKey: {}, levels: [], levelByValue: {}, settings: {} };

    const houses = requireTable(sheets, 'Houses', ['House'], errors, src);
    if (houses) {
      for (const rec of houses.records) {
        const name = text(rec.get('House'));
        if (!name) continue;
        if (lower(name) in config.houseByKey) { errors.push(`Houses: "${name}" is listed twice.`); continue; }
        if (/[\[\]:*?\/\\]/.test(name) || name.length > 31) {
          errors.push(`Houses: "${name}" can't be used as an Excel sheet name (max 31 characters, no [ ] : * ? / \\).`);
        }
        if ([SUMMARY_SHEET, RUN_INFO_SHEET].some(s => lower(s) === lower(name))) {
          errors.push(`Houses: "${name}" is reserved for the output file; please rename the house.`);
        }
        config.houseByKey[lower(name)] = config.houses.length;
        config.houses.push(name);
      }
      if (config.houses.length < 2) errors.push('Houses: at least two houses are needed.');
    }

    const events = requireTable(sheets, 'Events', ['Event'], errors, src);
    if (events) {
      for (const rec of events.records) {
        const name = text(rec.get('Event'));
        if (!name) continue;
        if (lower(name) in config.eventByKey) { errors.push(`Events: "${name}" is listed twice.`); continue; }
        config.eventByKey[lower(name)] = config.events.length;
        config.events.push(name);
      }
    }

    const levels = requireTable(sheets, 'Rating Levels', ['Level', 'Label', 'Points'], errors, src);
    if (levels) {
      for (const rec of levels.records) {
        const level = toNumber(rec.get('Level'));
        const points = toNumber(rec.get('Points'));
        if (!Number.isInteger(level)) { errors.push(`Rating Levels row ${rec.rowNumber}: Level must be a whole number.`); continue; }
        if (!Number.isFinite(points)) { errors.push(`Rating Levels row ${rec.rowNumber}: Points must be a number.`); continue; }
        if (level in config.levelByValue) { errors.push(`Rating Levels: level ${level} is listed twice.`); continue; }
        const entry = { level, label: text(rec.get('Label')) || `Level ${level}`, points };
        config.levelByValue[level] = entry;
        config.levels.push(entry);
      }
      config.levels.sort((a, b) => b.level - a.level);
      if (!config.levels.length) errors.push('Rating Levels: no levels defined.');
    }

    const settings = requireTable(sheets, 'Settings', ['Setting', 'Value'], errors, src);
    if (settings) {
      const raw = {};
      for (const rec of settings.records) raw[lower(rec.get('Setting'))] = rec.get('Value');
      for (const name of ['balance_weight', 'previous_house_weight']) {
        const v = toNumber(raw[name]);
        if (!Number.isFinite(v) || v < 0) errors.push(`Settings: "${name}" must be a non-negative number.`);
        else config.settings[name] = v;
      }
      // A literal space is a valid separator, so only trim when that leaves something.
      const sepRaw = raw.star_event_separator === undefined ? '' : String(raw.star_event_separator);
      const sep = sepRaw.trim() || sepRaw;
      if (!sep) errors.push('Settings: "star_event_separator" is missing.');
      else config.settings.star_event_separator = sep;
    }
    return config;
  }

  // ---------- employees ----------

  function parseEmployees(sheets, config, errors) {
    const table = requireTable(sheets, EMPLOYEES_SHEET, EMPLOYEE_COLUMNS, errors, 'Employee data file');
    if (!table) return [];
    const employees = [];
    const seen = {};
    const sep = config.settings.star_event_separator || ',';
    const houseOf = (value, col, rowNumber) => {
      const s = text(value);
      if (!s) return -1;
      const idx = config.houseByKey[lower(s)];
      if (idx === undefined) {
        errors.push(`${EMPLOYEES_SHEET} row ${rowNumber}: ${col} "${s}" is not on the Houses sheet (${config.houses.join(', ')}).`);
        return -1;
      }
      return idx;
    };

    for (const rec of table.records) {
      const r = rec.rowNumber;
      const id = text(rec.get('Employee ID'));
      if (!id) { errors.push(`${EMPLOYEES_SHEET} row ${r}: Employee ID is missing.`); continue; }
      if (lower(id) in seen) { errors.push(`${EMPLOYEES_SHEET} row ${r}: Employee ID "${id}" is duplicated (first seen on row ${seen[lower(id)]}).`); continue; }
      seen[lower(id)] = r;

      const incRaw = rec.get('Include');
      const inc = typeof incRaw === 'boolean' ? (incRaw ? 1 : 0) : toNumber(incRaw);
      if (inc !== 0 && inc !== 1) { errors.push(`${EMPLOYEES_SHEET} row ${r} (${id}): Include must be 0 or 1, found "${text(incRaw)}".`); continue; }

      const emp = {
        id,
        firstName: text(rec.get('First Name')),
        lastName: text(rec.get('Last Name')),
        email: text(rec.get('Work Email')),
        department: text(rec.get('Department')),
        include: inc === 1,
        gender: '', rating: null, points: 0, stars: [], prevHouse: -1, fixedHouse: -1,
        row: r,
      };
      employees.push(emp);
      // Rows left out of the draft are only checked for a usable ID.
      if (!emp.include) continue;

      const gRaw = text(rec.get('Gender'));
      const g = GENDER_ALIASES[gRaw.toUpperCase()];
      if (g === undefined) errors.push(`${EMPLOYEES_SHEET} row ${r} (${id}): Gender must be F, Female, M, Male or blank, found "${gRaw}".`);
      else emp.gender = g;

      const rating = toNumber(rec.get('Overall Rating'));
      const level = config.levelByValue[rating];
      if (!level) {
        errors.push(`${EMPLOYEES_SHEET} row ${r} (${id}): Overall Rating "${text(rec.get('Overall Rating'))}" is not a level on the Rating Levels sheet (${config.levels.map(l => l.level).join(', ')}).`);
      } else { emp.rating = level.level; emp.points = level.points; }

      emp.prevHouse = houseOf(rec.get('Previous House'), 'Previous House', r);
      emp.fixedHouse = houseOf(rec.get('Fixed House'), 'Fixed House', r);

      const starsRaw = text(rec.get('Star Events'));
      if (starsRaw) {
        for (const part of starsRaw.split(sep)) {
          const name = part.trim();
          if (!name) continue;
          const idx = config.eventByKey[lower(name)];
          if (idx === undefined) errors.push(`${EMPLOYEES_SHEET} row ${r} (${id}): Star Event "${name}" is not on the Events sheet.`);
          else if (!emp.stars.includes(idx)) emp.stars.push(idx);
        }
        emp.stars.sort((a, b) => a - b);
      }
    }
    return employees;
  }

  // ---------- current assignment file ----------

  function parseAssignmentFile(sheets, config, errors) {
    const src = 'Current assignment file';
    const runInfo = findSheet(sheets, RUN_INFO_SHEET);
    const runTable = runInfo && readTable(runInfo, ['Field', 'Value']);
    const appRow = runTable && !runTable.missing.length &&
      runTable.records.find(rec => lower(rec.get('Field')) === 'app');
    if (!appRow || text(appRow.get('Value')) !== APP_ID) {
      errors.push(`${src}: this is not a House Assignments file produced by this app (no valid "${RUN_INFO_SHEET}" sheet). Please pick a finalized output file.`);
      return null;
    }

    const assignments = []; // { id, house, info: {...} }
    const seen = {};
    for (const sheetName of Object.keys(sheets)) {
      if ([SUMMARY_SHEET, RUN_INFO_SHEET].some(s => lower(s) === lower(sheetName))) continue;
      const house = config.houseByKey[lower(sheetName)];
      if (house === undefined) {
        errors.push(`${src}: sheet "${sheetName}" is a house that is not on the Houses sheet (${config.houses.join(', ')}).`);
        continue;
      }
      const table = readTable(sheets[sheetName], ['Employee ID']);
      if (!table) continue; // an empty house sheet is fine
      if (table.missing.length) { errors.push(`${src}: sheet "${sheetName}" has no "Employee ID" column.`); continue; }
      for (const rec of table.records) {
        const id = text(rec.get('Employee ID'));
        if (!id) { errors.push(`${src}: sheet "${sheetName}" row ${rec.rowNumber} has no Employee ID.`); continue; }
        if (lower(id) in seen) { errors.push(`${src}: Employee ID "${id}" appears in both "${seen[lower(id)]}" and "${sheetName}".`); continue; }
        seen[lower(id)] = sheetName;
        const info = {};
        for (const col of OUTPUT_COLUMNS) info[col] = rec.has(col) ? text(rec.get(col)) : '';
        assignments.push({ id, house, info });
      }
    }
    return assignments;
  }

  // ---------- problem model ----------

  /**
   * Builds the list of balance metrics. Each gender is balanced separately on head count, points,
   * level counts and star counts; overall head count and points also cover people with blank gender.
   */
  function buildMetrics(config) {
    const metrics = [];
    const index = { all: {} };
    const add = (label, group, gender) => metrics.push({ label, group, gender }) - 1;
    for (const g of GENDERS) {
      const gl = GENDER_LABEL[g];
      index[g] = { level: {}, star: {} };
      index[g].count = add(`${gl}`, 'Head count', g);
      index[g].points = add(`${gl}`, 'Rating points', g);
      for (const l of config.levels) index[g].level[l.level] = add(`${gl} · L${l.level} ${l.label}`, 'Rating levels', g);
      config.events.forEach((e, i) => { index[g].star[i] = add(`${gl} · ${e}`, 'Star players', g); });
    }
    index.all.count = add('Total', 'Head count', '');
    index.all.points = add('Total', 'Rating points', '');
    return { metrics, index };
  }

  function contributions(emp, index) {
    const c = [[index.all.count, 1], [index.all.points, emp.points]];
    const gi = index[emp.gender];
    if (gi) {
      c.push([gi.count, 1], [gi.points, emp.points], [gi.level[emp.rating], 1]);
      for (const s of emp.stars) c.push([gi.star[s], 1]);
    }
    return c;
  }

  /**
   * entries: [{ emp, isNew, existing, leaver, fixed, assignedOn, info }]
   * Leavers stay in their house but contribute nothing to balance.
   */
  function buildProblem(config, entries, mode) {
    const { metrics, index } = buildMetrics(config);
    return {
      mode,
      config,
      entries,
      H: config.houses.length,
      M: metrics.length,
      metrics,
      index,
      contrib: entries.map(e => e.leaver ? [] : contributions(e.emp, index)),
      prev: Int32Array.from(entries.map(e => e.leaver ? -1 : e.emp.prevHouse)),
      bw: config.settings.balance_weight,
      pw: config.settings.previous_house_weight,
      enforceSize: mode === MODES.FULL,
    };
  }

  // ---------- board: an assignment plus incremental stats ----------

  class Board {
    constructor(problem, assign) {
      this.p = problem;
      this.assign = Int32Array.from(assign);
      this.stats = new Float64Array(problem.H * problem.M);
      this.repeats = 0;
      for (let i = 0; i < this.assign.length; i++) this._apply(i, this.assign[i], 1);
    }

    clone() { return new Board(this.p, this.assign); }

    _apply(i, h, sign) {
      if (h < 0) return;
      const base = h * this.p.M;
      for (const [m, v] of this.p.contrib[i]) this.stats[base + m] += sign * v;
      if (this.p.prev[i] === h) this.repeats += sign;
    }

    move(i, h) {
      this._apply(i, this.assign[i], -1);
      this.assign[i] = h;
      this._apply(i, h, 1);
    }

    swap(i, j) {
      const hi = this.assign[i];
      this.move(i, this.assign[j]);
      this.move(j, hi);
    }

    spread(m) {
      const { H, M } = this.p;
      let lo = Infinity, hi = -Infinity;
      for (let h = 0; h < H; h++) {
        const v = this.stats[h * M + m];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return hi - lo;
    }

    sizeSpread() { return this.spread(this.p.index.all.count); }

    costParts() {
      let balance = 0;
      for (let m = 0; m < this.p.M; m++) balance += this.spread(m);
      const sizeExcess = this.p.enforceSize ? Math.max(0, this.sizeSpread() - 1) : 0;
      return {
        balance,
        repeats: this.repeats,
        sizeExcess,
        total: this.p.bw * balance + this.p.pw * this.repeats + this.p.bw * SIZE_PENALTY_FACTOR * sizeExcess,
      };
    }

    cost() { return this.costParts().total; }
  }

  // ---------- algorithms ----------

  /** First-improvement hill climbing over single moves and same-gender swaps of the given movable entries. */
  function localSearch(board, movable) {
    const p = board.p;
    const gender = i => p.entries[i].emp.gender;
    let current = board.cost();
    for (let pass = 0; pass < MAX_SEARCH_PASSES; pass++) {
      let improved = false;

      for (const i of movable) {
        const from = board.assign[i];
        for (let h = 0; h < p.H; h++) {
          if (h === from) continue;
          board.move(i, h);
          const c = board.cost();
          if (c < current - EPS) { current = c; improved = true; break; }
          board.move(i, from);
        }
      }

      for (let a = 0; a < movable.length; a++) {
        const i = movable[a];
        for (let b = a + 1; b < movable.length; b++) {
          const j = movable[b];
          if (board.assign[i] === board.assign[j] || gender(i) !== gender(j)) continue;
          board.swap(i, j);
          const c = board.cost();
          if (c < current - EPS) { current = c; improved = true; }
          else board.swap(i, j);
        }
      }

      if (!improved) break;
    }
    return board;
  }

  function fullShuffle(problem, rng) {
    const { entries, H } = problem;
    const assign = new Int32Array(entries.length).fill(-1);
    entries.forEach((e, i) => { if (e.fixed) assign[i] = e.emp.fixedHouse; });

    // Snake draft per gender, highest rating first; the snake continues across levels.
    const houseOrder = shuffle([...Array(H).keys()], rng);
    const genders = [...GENDERS, ''];
    genders.forEach((g, gi) => {
      const pool = entries.map((e, i) => i).filter(i => assign[i] < 0 && entries[i].emp.gender === g);
      shuffle(pool, rng);
      pool.sort((a, b) => entries[b].emp.rating - entries[a].emp.rating);
      // Alternate the starting end per gender so odd leftovers don't pile into one house.
      const order = gi % 2 ? [...houseOrder].reverse() : houseOrder;
      let forward = true;
      while (pool.length) {
        const round = forward ? order : [...order].reverse();
        for (const h of round) {
          if (!pool.length) break;
          // People with the same level and stars are interchangeable for balance,
          // so pick one whose previous house isn't this one when possible.
          const def = entries[pool[0]].emp;
          const sameKey = e => e.rating === def.rating && e.stars.join() === def.stars.join();
          let k = pool.findIndex(i => sameKey(entries[i].emp) && entries[i].emp.prevHouse !== h);
          if (k < 0) k = 0;
          assign[pool[k]] = h;
          pool.splice(k, 1);
        }
        forward = !forward;
      }
    });

    const board = new Board(problem, assign);
    const movable = entries.map((e, i) => i).filter(i => !entries[i].fixed);
    return localSearch(board, movable);
  }

  function assignNew(problem, rng) {
    const { entries, H, index, M } = problem;
    const assign = new Int32Array(entries.length).fill(-1);
    entries.forEach((e, i) => {
      if (e.existing) assign[i] = e.house;
      else if (e.fixed) assign[i] = e.emp.fixedHouse;
    });
    const board = new Board(problem, assign);

    const pending = entries.map((e, i) => i).filter(i => board.assign[i] < 0);
    shuffle(pending, rng);
    pending.sort((a, b) => entries[b].emp.rating - entries[a].emp.rating);
    for (const i of pending) {
      let best = -1, bestCost = Infinity, bestSize = Infinity;
      for (const h of shuffle([...Array(H).keys()], rng)) {
        board.move(i, h);
        const c = board.cost();
        const size = board.stats[h * M + index.all.count];
        if (c < bestCost - EPS || (Math.abs(c - bestCost) <= EPS && size < bestSize)) {
          best = h; bestCost = c; bestSize = size;
        }
      }
      board.move(i, best);
    }

    // Existing employees are never moved; only unpinned new employees take part in the search.
    const movable = entries.map((e, i) => i).filter(i => entries[i].isNew && !entries[i].fixed);
    return localSearch(board, movable);
  }

  // ---------- public: prepare (validate) and generate ----------

  /**
   * Validates inputs and returns a prepared draft ready to generate, or throws ValidationError.
   * employeeSheets / assignmentSheets: { sheetName: rows[][] }.
   */
  function prepare({ mode, employeeSheets, assignmentSheets }) {
    const errors = [];
    const warnings = [];
    const config = parseConfig(employeeSheets, errors);
    if (errors.length) throw new ValidationError(capErrors(errors));
    const employees = parseEmployees(employeeSheets, config, errors);
    if (errors.length) throw new ValidationError(capErrors(errors));

    const included = employees.filter(e => e.include);
    let entries;

    if (mode === MODES.FULL) {
      entries = included.map(emp => ({ emp, isNew: false, existing: false, leaver: false, fixed: emp.fixedHouse >= 0 }));
      const n = entries.length;
      const H = config.houses.length;
      if (n === 0) throw new ValidationError(['No employees have Include = 1.']);
      const lo = Math.floor(n / H), hi = Math.ceil(n / H), roomForHi = lo === hi ? H : n % H;
      const fixedCount = new Array(H).fill(0);
      entries.forEach(e => { if (e.fixed) fixedCount[e.emp.fixedHouse]++; });
      const over = fixedCount.map((c, h) => [c, h]).filter(([c]) => c > hi);
      if (over.length) {
        errors.push(...over.map(([c, h]) => `Fixed House: ${c} people are pinned to ${config.houses[h]}, but with ${n} people each house can hold at most ${hi}.`));
      } else if (lo !== hi && fixedCount.filter(c => c === hi).length > roomForHi) {
        errors.push(`Fixed House: too many houses are already filled to ${hi} by pinned people; only ${roomForHi} house(s) can have ${hi} members when there are ${n} people.`);
      }
    } else {
      if (!assignmentSheets) throw new ValidationError(['Assign New mode needs the current house assignment file.']);
      const assignments = parseAssignmentFile(assignmentSheets, config, errors);
      if (errors.length) throw new ValidationError(capErrors(errors));
      const byId = {};
      employees.forEach(e => { byId[lower(e.id)] = e; });
      const assignedIds = new Set(assignments.map(a => lower(a.id)));
      entries = assignments.map(a => {
        const emp = byId[lower(a.id)];
        const leaver = !emp || !emp.include;
        if (leaver) {
          warnings.push(`${a.id} (${[a.info['First Name'], a.info['Last Name']].filter(Boolean).join(' ') || 'unknown'}) is in ${config.houses[a.house]} but ${emp ? 'now has Include = 0' : 'is no longer in the employee data file'} — possible leaver, kept unchanged.`);
        } else if (emp.fixedHouse >= 0 && emp.fixedHouse !== a.house) {
          warnings.push(`${a.id} has Fixed House ${config.houses[emp.fixedHouse]} but is already in ${config.houses[a.house]}; existing assignments are never changed.`);
        }
        const fallback = emp || {
          id: a.id, firstName: a.info['First Name'], lastName: a.info['Last Name'], email: a.info['Work Email'],
          department: a.info.Department, include: false, gender: '', rating: null, points: 0, stars: [], prevHouse: -1, fixedHouse: -1,
        };
        return {
          emp: fallback, isNew: false, existing: true, leaver, fixed: false, house: a.house,
          assignedOn: a.info['Assigned On'], info: a.info,
        };
      });
      const fresh = included.filter(e => !assignedIds.has(lower(e.id)));
      if (!fresh.length) {
        throw new ValidationError(['There are no new employees to assign: everyone with Include = 1 is already in the current assignment file.'], warnings);
      }
      entries.push(...fresh.map(emp => ({ emp, isNew: true, existing: false, leaver: false, fixed: emp.fixedHouse >= 0 })));
    }
    if (errors.length) throw new ValidationError(capErrors(errors), warnings);

    const problem = buildProblem(config, entries, mode);
    return {
      problem,
      warnings,
      stats: {
        employees: employees.length,
        included: included.length,
        excluded: employees.length - included.length,
        fixed: entries.filter(e => e.fixed).length,
        existing: entries.filter(e => e.existing && !e.leaver).length,
        newcomers: entries.filter(e => e.isNew).length,
        leavers: entries.filter(e => e.leaver).length,
      },
    };
  }

  /**
   * Local search can stop at a "good enough" layout that one move or swap can't improve,
   * so run several independent attempts from the same seed and keep the lowest cost.
   * The attempts draw from one RNG in sequence, so a seed still always gives the same result.
   */
  function generate(problem, seed, attempts = ATTEMPTS) {
    const rng = mulberry32(seed);
    const run = problem.mode === MODES.FULL ? fullShuffle : assignNew;
    let best = null, bestCost = Infinity;
    for (let a = 0; a < attempts; a++) {
      const board = run(problem, rng);
      const c = board.cost();
      if (c < bestCost - EPS) { best = board; bestCost = c; }
    }
    return best;
  }

  // ---------- summary for display and export ----------

  function summarize(board) {
    const p = board.p;
    const { H, M, metrics, config, entries } = p;
    const rows = metrics.map((m, idx) => {
      const values = [];
      for (let h = 0; h < H; h++) values.push(board.stats[h * M + idx]);
      return { ...m, values, spread: Math.max(...values) - Math.min(...values) };
    });

    // Display-only rows: unspecified-gender head count and previous-house repeats per house.
    const unspecified = new Array(H).fill(0);
    const repeats = new Array(H).fill(0);
    entries.forEach((e, i) => {
      const h = board.assign[i];
      if (h < 0 || e.leaver) return;
      if (e.emp.gender === '') unspecified[h]++;
      if (p.prev[i] === h) repeats[h]++;
    });
    const extra = [];
    if (unspecified.some(v => v)) {
      extra.push({ label: 'Unspecified', group: 'Head count', gender: '', values: unspecified, spread: Math.max(...unspecified) - Math.min(...unspecified), displayOnly: true });
    }
    const allRows = [];
    for (const r of rows) {
      allRows.push(r);
      if (r.group === 'Head count' && r.gender === 'M') allRows.push(...extra);
    }
    // Star rows nobody has are noise.
    const visible = allRows.filter(r => r.group !== 'Star players' || r.values.some(v => v));

    const parts = board.costParts();
    return {
      houses: config.houses,
      rows: visible,
      repeats,
      cost: parts,
      sizeSpread: board.sizeSpread(),
      sizeOk: board.sizeSpread() <= 1,
      // Biggest imbalances: the counted metrics with the largest spread.
      worst: rows.filter(r => r.spread > 1).sort((a, b) => b.spread - a.spread).slice(0, 4),
    };
  }

  return {
    APP_ID, FORMAT_VERSION, EMPLOYEES_SHEET, SUMMARY_SHEET, RUN_INFO_SHEET, OUTPUT_COLUMNS, GENDER_LABEL, MODES,
    ValidationError, Board, mulberry32,
    prepare, generate, summarize, readTable,
  };
});
