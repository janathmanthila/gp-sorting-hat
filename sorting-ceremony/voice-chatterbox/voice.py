"""Voices the ceremony's lines with Chatterbox and gives them the old-hat sound with ffmpeg.

Runs inside the ceremony-voice-chatterbox container (see docker-compose.yml), with the workspace mounted at /work:
  voice.py                  voice every line in /work/voice-input.json that changed since the last run
  voice.py --samples        voice one sample clip per hat voice into /work/audio/samples/<voice>.mp3
  voice.py --drama-samples  voice a ponder and a shout at several drama levels into /work/audio/samples/
Prints PROGRESS/FAILED/SAMPLE/DONE lines on stdout for the server to follow, like voice/voice.py.

Two hat voices: cb-turbo (Chatterbox Turbo, the default: ~3x faster, no drama setting, ~6 dB quieter so it gets
a gain boost) and cb-hat (standard Chatterbox, with EXAGGERATION/CFG_WEIGHT). The voice is cloned from ref/hat.wav (a synthetic Kokoro voice pitched down). Intro and ponder are one take
each; a shout is voiced as its lead-in, a held pause, then a separate take of "It's <House>!". Every take is
seeded, so a re-run gives the same audio. The standard model is slow on CPU, so its lines are spread over WORKERS
processes, each with its own model; Turbo runs one worker with all the threads (more workers don't help it).
This process only hands out lines and writes the manifest.
"""
import argparse
import hashlib
import json
import os
import queue
import re
import signal
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

REF = Path("/app/ref/hat.wav")
PIPELINE_VERSION = 1  # bump when the pipeline changes in a way the settings below don't capture: every clip re-voices
SEED = 7
EXAGGERATION = float(os.environ.get("EXAGGERATION") or 1.1)
CFG_WEIGHT = float(os.environ.get("CFG_WEIGHT") or 0.25)
WORKERS = max(1, int(os.environ.get("WORKERS") or 2))
TORCH_THREADS = int(os.environ.get("TORCH_THREADS") or 4)
TURBO_THREADS = int(os.environ.get("TURBO_THREADS") or WORKERS * TORCH_THREADS)
TURBO_GAIN = "volume=6dB,"  # Turbo comes out ~6 dB quieter than the standard model
SPLIT_PAUSE = 0.8  # the held breath before "It's <House>!"

TURBO_VOICE = "cb-turbo"
SAMPLE_VOICES = (TURBO_VOICE, "cb-hat")
SAMPLE_TEXT = "Difficult... very difficult. Plenty of courage, I see. Not a bad mind, either."
SAMPLE_SHOUT = ("Better be...", "It's Gryffindor!")
DRAMA_LEVELS = [(0.8, 0.3), (1.1, 0.25), (1.4, 0.2), (1.8, 0.15)]
DRAMA_PONDER = "A sharp mind, a careful eye... and a heart that guards what matters most. How very wise."
DRAMA_SHOUT = ("No doubt about it...", "It's Draco!")

PITCH = 0.92  # same old-hat filter as voice/voice.py
FX = f"asetrate={{sr}}*{PITCH},aresample={{sr}},{{gain}}highpass=f=70,aecho=0.8:0.6:45|90:0.22|0.12,acompressor=threshold=-18dB:ratio=3"
SHOUT_FX = ",volume=1.6,alimiter=limit=0.95"


def line_kind(line):
    if line.get("shout"):
        return "shout"
    key = str(line.get("key", ""))
    for kind in ("intro", "ponder", "shout"):
        if key.endswith("-" + kind):
            return kind
    return "line"


def say(message):
    print(message, flush=True)


def ref_hash():
    return hashlib.sha1(REF.read_bytes()).hexdigest() if REF.exists() else "no-ref"


def house_of(line):
    house = (line.get("house") or "").strip()
    if house:
        return house
    words = line["text"].split()
    return re.sub(r"[^\w'\-]", "", words[-1]).title() if words else ""


def shout_takes(text, house):
    """'No doubt about it... DRACO!' + 'Draco' -> [('No doubt about it...', 0.8), ("It's Draco!", 0)]."""
    at = text.lower().rfind(house.lower()) if house else -1
    if at < 0:  # the house isn't in the text as given: the last word stands in for it
        at = text.rstrip().rfind(" ") + 1
    lead = re.sub(r"[\s.…,;:\-—–]+$", "", text[:at])
    final = f"It's {house}!"
    return [(lead + "...", SPLIT_PAUSE), (final, 0.0)] if re.search(r"\w", lead) else [(final, 0.0)]


def line_takes(line):
    if line_kind(line) == "shout":
        return shout_takes(line["text"], house_of(line))
    return [(line["text"].strip(), 0.0)]


def is_turbo(voice_name):
    return voice_name == TURBO_VOICE


def line_hash(line, voice_name, ref):
    drama = [] if is_turbo(voice_name) else [EXAGGERATION, CFG_WEIGHT]  # Turbo ignores them
    settings = [PIPELINE_VERSION, *drama, SEED, SPLIT_PAUSE, FX, TURBO_GAIN if is_turbo(voice_name) else "", SHOUT_FX, ref]
    house = house_of(line) if line_kind(line) == "shout" else None
    raw = json.dumps([line["text"], bool(line.get("shout")), line_kind(line), house, voice_name, settings], ensure_ascii=False)
    return hashlib.sha1(raw.encode()).hexdigest()


def write_json(path, value):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value))
    os.replace(tmp, path)


# ---- worker: one model, voices jobs read as JSON lines on stdin ----

def worker(turbo):
    out = os.fdopen(os.dup(1), "w")  # results go to the real stdout; anything the libraries print goes to stderr
    os.dup2(2, 1)
    import numpy as np
    import soundfile as sf
    import torch
    if turbo:
        from chatterbox.tts_turbo import ChatterboxTurboTTS as Model
    else:
        from chatterbox.tts import ChatterboxTTS as Model

    torch.set_num_threads(TURBO_THREADS if turbo else TORCH_THREADS)
    model = Model.from_pretrained(device="cpu")
    drama = {} if turbo else None
    for raw in sys.stdin:
        job = json.loads(raw)
        try:
            parts = []
            for text, pause in job["takes"]:
                torch.manual_seed(SEED)
                kw = drama if drama is not None else {"exaggeration": job["exaggeration"], "cfg_weight": job["cfg_weight"]}
                wav = model.generate(text, audio_prompt_path=str(REF), **kw)
                parts.append(wav.squeeze().cpu().numpy().astype(np.float32))
                if pause:
                    parts.append(np.zeros(int(pause * model.sr), np.float32))
            samples = np.concatenate(parts)
            mp3 = Path(job["out"])
            mp3.parent.mkdir(parents=True, exist_ok=True)
            part = mp3.with_name(mp3.stem + ".tmp.mp3")  # renamed into place, so a killed run never leaves half a clip
            with tempfile.TemporaryDirectory() as tmp:
                wav_path = Path(tmp) / "raw.wav"
                sf.write(wav_path, samples, model.sr, subtype="FLOAT")
                filters = FX.format(sr=model.sr, gain=TURBO_GAIN if turbo else "") + (SHOUT_FX if job["shout"] else "")
                subprocess.run(
                    ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path), "-af", filters, "-codec:a", "libmp3lame", "-q:a", "4", str(part)],
                    check=True,
                )
            os.replace(part, mp3)
            result = {"id": job["id"], "duration": round(len(samples) / model.sr / PITCH, 2)}
        except Exception as err:  # one bad line must not stop the rest
            result = {"id": job["id"], "error": str(err).splitlines()[0] if str(err) else type(err).__name__}
        out.write(json.dumps(result) + "\n")
        out.flush()


# ---- parent: hands jobs to the workers and yields results as they finish ----

PROCS = []


def stop_workers(*_):
    for p in PROCS:
        try:
            os.killpg(p.pid, signal.SIGKILL)  # the worker and its ffmpeg
        except ProcessLookupError:
            pass
    for p in PROCS:
        p.wait()


def run_jobs(jobs, turbo):
    """Voices jobs [{id, takes, shout, out, exaggeration, cfg_weight}] on up to WORKERS processes (Turbo: one); yields results."""
    todo = queue.Queue()
    for job in jobs:
        todo.put(job)
    results = queue.Queue()
    env = dict(os.environ, TQDM_DISABLE="1")

    def feed(proc):
        while True:
            try:
                job = todo.get_nowait()
            except queue.Empty:
                break
            try:
                proc.stdin.write(json.dumps(job) + "\n")
                proc.stdin.flush()
                reply = proc.stdout.readline()
            except (BrokenPipeError, OSError):
                reply = ""
            if not reply:  # the worker died (out of memory?): this line fails, the others carry on
                results.put({"id": job["id"], "error": f"worker exited ({proc.poll()})"})
                break
            results.put(json.loads(reply))
        proc.stdin.close()

    threads = []
    for _ in range(min(1 if turbo else WORKERS, len(jobs))):
        proc = subprocess.Popen([sys.executable, "-u", __file__, "--worker", *(["--turbo"] if turbo else [])], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                text=True, env=env, start_new_session=True)
        PROCS.append(proc)
        threads.append(threading.Thread(target=feed, args=(proc,), daemon=True))
        threads[-1].start()
    for _ in range(len(jobs)):
        while True:
            try:
                yield results.get(timeout=1)
                break
            except queue.Empty:
                if any(t.is_alive() for t in threads) or not results.empty():
                    continue
                job = todo.get_nowait()  # every worker is gone: fail what's left
                yield {"id": job["id"], "error": "no worker left"}
                break
    for p in PROCS:
        p.wait()
    PROCS.clear()


def remove_partials(work):
    for f in (work / "audio").glob("**/*.tmp.mp3"):
        f.unlink(missing_ok=True)


def samples(work):
    takes = [(SAMPLE_TEXT, SPLIT_PAUSE), (SAMPLE_SHOUT[0], SPLIT_PAUSE), (SAMPLE_SHOUT[1], 0.0)]
    for name in SAMPLE_VOICES:
        out = work / "audio" / "samples" / f"{name}.mp3"
        job = {"id": name, "takes": takes, "shout": True, "out": str(out), "exaggeration": EXAGGERATION, "cfg_weight": CFG_WEIGHT}
        for r in run_jobs([job], is_turbo(name)):
            if "error" in r:
                raise SystemExit(f"sample failed: {r['error']}")
            say(f"SAMPLE {name} audio/samples/{name}.mp3")
    say("DONE")


def drama_samples(work):
    jobs = []
    for exag, cfg in DRAMA_LEVELS:
        for part, takes, shout in (("ponder", [(DRAMA_PONDER, 0.0)], False), ("shout", [(DRAMA_SHOUT[0], SPLIT_PAUSE), (DRAMA_SHOUT[1], 0.0)], True)):
            name = f"drama-{exag}-{part}"
            jobs.append({"id": name, "takes": takes, "shout": shout, "out": str(work / "audio" / "samples" / f"{name}.mp3"),
                         "exaggeration": exag, "cfg_weight": cfg})
    for r in run_jobs(jobs, False):
        say(f"FAILED {r['id']} {r['error']}" if "error" in r else f"SAMPLE {r['id']} audio/samples/{r['id']}.mp3")
    say("DONE")


def voice_all(work):
    data = json.loads((work / "voice-input.json").read_text())
    voice_name, lines = data["voice"], data["lines"]
    manifest_path = work / "voice.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    ref = ref_hash()
    remove_partials(work)
    done, total, jobs, hashes = 0, len(lines), [], {}
    for line in lines:
        key, h = line["key"], line_hash(line, voice_name, ref)
        out = work / "audio" / f"{key}.mp3"
        if manifest.get(key, {}).get("hash") == h and out.exists():
            done += 1
            say(f"PROGRESS {done} {total} {key}")
            continue
        manifest.pop(key, None)  # the old clip no longer matches this line
        hashes[key] = h
        jobs.append({"id": key, "takes": line_takes(line), "shout": line_kind(line) == "shout", "out": str(out),
                     "exaggeration": EXAGGERATION, "cfg_weight": CFG_WEIGHT})
    write_json(manifest_path, manifest)
    for r in run_jobs(jobs, is_turbo(voice_name)):
        if "error" in r:
            say(f"FAILED {r['id']} {r['error']}")
        else:
            manifest[r["id"]] = {"hash": hashes[r["id"]], "duration": r["duration"]}
            write_json(manifest_path, manifest)  # save as we go, so a cancelled run resumes
        done += 1
        say(f"PROGRESS {done} {total} {r['id']}")
    say("DONE")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--work", default="/work", help="workspace folder (default /work)")
    parser.add_argument("--samples", action="store_true", help="voice a sample clip per hat voice")
    parser.add_argument("--drama-samples", action="store_true", help="voice a ponder and a shout at several drama levels")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--turbo", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
        return worker(args.turbo)
    work = Path(args.work)

    def on_term(*_):  # exit promptly on docker stop / cancel, taking the workers and their half-written clips along
        stop_workers()
        remove_partials(work)
        os._exit(143)

    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)
    if args.drama_samples:
        drama_samples(work)
    elif args.samples:
        samples(work)
    else:
        voice_all(work)


if __name__ == "__main__":
    main()
