# The Sorting Ceremony

The party version of the Sorting Hat.
- **Prepare** writes and voices a personal speech for every employee.
- **Show** is the Great Hall. Pick a name, and the hat sorts that person into the house the House Draft app gave them.

## One-time setup

You need Node, Docker (with Compose) and the Claude Code CLI, logged in.

```bash
cd sorting-ceremony
docker compose build        # builds both voice images, models included: Chatterbox, Turbo and standard (~12 GB), and Kokoro (~1.8 GB)
```

## Every time

```bash
node sorting-ceremony/server.js
```

Then open http://localhost:4747.

### Prepare

1. **New set:**
   - Choose the employee file. The full file is fine: only Employee ID, names, Department and Star Events are read, and ratings and gender never are.
   - Choose the `House_Assignments_….xlsx` export.
   - Click **Check files**, then describe each house's traits in one line. Orion, Aquila, Cygnus and Draco aren't Hogwarts houses, so the hat needs to know what each one stands for.
   - Click **Generate speeches**. A quick Claude check runs first. Only if it works is the previous set deleted and the new one written, at about 30 seconds per 25 people.
2. **Review:** every person has an intro, a thinking line and a shout.
   - Edit freely.
   - **↻ New lines** asks Claude for fresh lines for that person.
   - Warnings flag lines that are too long, name a house before the shout, or have a shout that doesn't end with the right house. Approve stays disabled until there are none.
3. **Approve all & voice:** the hat voices 3 clips per person, and the progress bar estimates the time left. You can keep editing while it runs.
   - The default voice, **Hat**, is Chatterbox Turbo: about 20–25 seconds per clip on a CPU, so **allow about 5–6 hours for ~290 people**. Run it with the laptop plugged in and kept awake (no sleep or suspend). Cancel any time; finished clips are kept and the next run picks up where it stopped. It runs one worker on 8 threads (`TURBO_THREADS=… node sorting-ceremony/server.js` changes that).
   - **Dramatic hat** is standard Chatterbox. It has a drama setting but is about 4× slower: about 17 hours for ~290 people. It runs 2 workers of 4 threads each, about 3.6 GB of memory per worker (capped at 9 GB). Change that with `WORKERS=1 TORCH_THREADS=8`. `EXAGGERATION` (default 1.1) and `CFG_WEIGHT` (default 0.25) set how dramatic it sounds; changing them re-voices every clip.
   - The **Kokoro** voices are the fast fallback: about 45 minutes for ~290 people.
4. **Listen & fine-tune:**
   - ▶ plays a line.
   - **Say name as** fixes a mispronounced name for the voice only.
   - Lines changed since voicing show **needs re-voice**. **Re-voice changes** redoes only those, and Show stays available meanwhile.
5. **Hat voice:** click **Make samples** (a few minutes), listen, and pick one. A new voice applies the next time you click Re-voice changes, and re-voices every clip.

### Show (party day)

- Open http://localhost:4747/show full screen (F11) on the laptop mirrored to the projector. Click once so sound is allowed.
- Type a name, use the arrow keys to choose, then press Enter.
- Controls:
  - **Space** jumps to the shout.
  - **Esc** cancels.
  - **M** mutes.
  - **R**, when the search box isn't focused, sorts a random person (for rehearsal).
- Everything is local, so no internet is needed. Rehearse once on the venue projector and speakers.

## Where things live

`workspace/` holds the current set: people.json, state.json and audio/. Each new Generate replaces it.

## Tests

```bash
node --test sorting-ceremony/tests
```
