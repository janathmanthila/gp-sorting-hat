/* The one current set: state.json, people.json, voice files and audio/. Wiped on each new generation. */
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_STATE = { phase: 'empty', houses: [], voice: 'cb-turbo', progress: null, error: null, voicingFrom: null, failedKeys: [] };

class Workspace {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.audioDir = path.join(this.dir, 'audio');
    fs.mkdirSync(this.audioDir, { recursive: true });
  }

  readJson(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  // Write to a temp file and rename, so a crash never leaves half a file.
  writeJson(name, value) {
    const file = path.join(this.dir, name);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 1));
    fs.renameSync(`${file}.tmp`, file);
  }

  readState() { return { ...DEFAULT_STATE, ...this.readJson('state.json', {}) }; }

  writeState(patch) {
    const state = { ...this.readState(), ...patch };
    this.writeJson('state.json', state);
    return state;
  }

  readPeople() { return this.readJson('people.json', []); }

  writePeople(people) { this.writeJson('people.json', people); }

  updatePerson(id, change) {
    const people = this.readPeople();
    const i = people.findIndex(p => p.id === id);
    if (i < 0) throw new Error(`No one with ID "${id}".`);
    people[i] = change(people[i]);
    this.writePeople(people);
    return people[i];
  }

  wipe() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.audioDir, { recursive: true });
  }
}

module.exports = Workspace;
