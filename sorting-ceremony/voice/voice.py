"""Voices the ceremony's lines with Kokoro and gives them the old-hat sound with ffmpeg.

Runs inside the ceremony-voice container (see docker-compose.yml), with the workspace mounted at /work:
  voice.py              voice every line in /work/voice-input.json that changed since the last run
  voice.py --samples    voice one sample line in each candidate voice into /work/audio/samples/
Prints PROGRESS/FAILED/SAMPLE/DONE lines on stdout for the server to follow.

Kokoro has no SSML, so the drama is built here: each line is cut at its pauses ("...", dashes, full
stops), every piece is voiced on its own and the pieces are joined with real silence. Hums ("Hmm",
"Mmm") are dropped from the text (their pause mark stays), and in a shout the house name is held back
after a pause, then said slower and louder.
"""
import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

MODEL = Path("/app/kokoro-v1.0.onnx")
VOICES = Path("/app/voices-v1.0.bin")
LANG = "en-gb"
SAMPLE_VOICES = ["bm_george", "bm_lewis", "bm_daniel", "bm_fable"]
SAMPLE_TEXT = "Difficult... very difficult. Plenty of courage, I see. Not a bad mind, either. Better be... GRYFFINDOR!"
PIPELINE_VERSION = 3  # bump when the pipeline changes in a way the settings below don't capture: every clip re-voices

HUM_RE = re.compile(r"^(h+m+|m{2,})$", re.IGNORECASE)  # Hm, Hmm, Hmmm, Mm, Mmm, ... (not a lone "m"): dropped from the text

SPEED = {"intro": 1.0, "ponder": 0.95, "shout": 0.95, "sample": 0.86, "line": 0.88}
HOUSE_SPEED = 0.85  # the verdict is a little drawn out
GAIN_DB = {"shout": -1.5, "house": 5.0}  # lead-in a touch quieter, the house name lands louder
PAUSE = {"ellipsis": 0.45, "dash": 0.4, "sentence": 0.25, "semicolon": 0.2, "comma": 0.25, "word": 0.0}
HOUSE_PAUSE = 0.7  # the held breath before the house name

PITCH = 0.92  # ~8% lower and slower: an old hat
FX = f"asetrate={{sr}}*{PITCH},aresample={{sr}},highpass=f=70,aecho=0.8:0.6:45|90:0.22|0.12,acompressor=threshold=-18dB:ratio=3"
SHOUT_FX = ",volume=1.6,alimiter=limit=0.95"

# Where a line is cut: an ellipsis, a dash, or sentence/semicolon punctuation followed by a space or the end
# (so "3.5" stays whole). A spaced hyphen counts as a dash. Commas stay inside a piece, so a phrase keeps
# its flow; Kokoro itself stretches the pause after them to PAUSE["comma"].
MARK_RE = re.compile(r"\.{2,}|…|\s[-—–]\s|[—–]|[.!?;:]+(?=[\s\"'”’)]|$)")


def line_kind(line):
    if line.get("shout"):
        return "shout"
    key = str(line.get("key", ""))
    for kind in ("intro", "ponder", "shout"):
        if key.endswith("-" + kind):
            return kind
    return "line"


def line_hash(line, voice_name):
    settings = [PIPELINE_VERSION, SPEED, HOUSE_SPEED, GAIN_DB, PAUSE, HOUSE_PAUSE, FX, SHOUT_FX]
    raw = json.dumps([line["text"], line["shout"], line_kind(line), voice_name, settings], ensure_ascii=False)
    return hashlib.sha1(raw.encode()).hexdigest()


def progress_line(done, total, key):
    return f"PROGRESS {done} {total} {key}"


def say(message):
    print(message, flush=True)


def load_kokoro():
    from kokoro_onnx import Kokoro

    return Kokoro(str(MODEL), str(VOICES))


def mark_pause(mark):
    m = mark.strip()
    if not m:
        return PAUSE["word"]
    if m.startswith("..") or "…" in m:
        return PAUSE["ellipsis"]
    if m in "-—–":
        return PAUSE["dash"]
    if any(c in m for c in ".!?"):
        return PAUSE["sentence"]
    if any(c in m for c in ";:"):
        return PAUSE["semicolon"]
    return PAUSE["comma"]


def is_hum(word):
    return bool(HUM_RE.match(re.sub(r"[^\w]", "", word)))


def plan_line(text, kind):
    """Cut a line into pieces: [{text, speed, gain, pause}], where pause is the silence after the piece."""
    pieces = []
    pos = 0
    for m in list(MARK_RE.finditer(text)) + [None]:
        end = m.end() if m else len(text)
        chunk, mark = (text[pos:m.start()], m.group()) if m else (text[pos:], "")
        pos = end
        if not re.search(r"\w", chunk):
            if pieces:  # stray punctuation: only lengthens the pause before it
                pieces[-1]["pause"] = max(pieces[-1]["pause"], mark_pause(mark))
            continue
        spoken_mark = "," if mark.strip() in ("-", "—", "–") else mark.strip()  # Kokoro reads a dash as a comma anyway
        words = [w for w in chunk.split() if not is_hum(w)]  # hums are dropped, their pause mark stays
        if not words:
            if pieces:
                pieces[-1]["pause"] = max(pieces[-1]["pause"], mark_pause(mark))
            continue  # a line that starts with a hum just starts with the next words
        pieces.append(_piece(" ".join(words) + spoken_mark, mark_pause(mark)))
    if not pieces:
        return []
    pieces[-1]["pause"] = 0.0
    speed = SPEED.get(kind, SPEED["line"])
    for p in pieces:
        p["speed"] = speed
    if kind in ("shout", "sample"):
        _weigh_house(pieces, kind)
    return pieces


def _piece(text, pause):
    return {"text": text, "pause": pause, "speed": SPEED["line"], "gain": 0.0}


def _weigh_house(pieces, kind):
    """The last piece is the house name: held back, slower and louder. Splits it off if no pause precedes it."""
    last = pieces[-1]
    tail = re.match(r"^(.*\S)\s+([A-Z][A-Z'\-]+(?:\s+[A-Z][A-Z'\-]+)*[!.?]*)$", last["text"])
    if tail and re.search(r"[a-z]", tail.group(1)):  # "You belong in DRACO!" -> "You belong in" + "DRACO!"
        lead = dict(last, text=tail.group(1), pause=0.0)
        pieces.insert(len(pieces) - 1, lead)
        last["text"] = tail.group(2)
    if len(pieces) > 1:
        pieces[-2]["pause"] = HOUSE_PAUSE
    last["speed"] = HOUSE_SPEED
    last["gain"] = GAIN_DB["house"]
    if kind == "shout":
        for p in pieces[:-1]:
            p["gain"] = GAIN_DB["shout"]


def render(kokoro, pieces, voice_name):
    """Voice each piece and join them with silence. Returns (samples, sample_rate)."""
    import numpy as np

    parts, sr = [], 24000
    for p in pieces:
        audio, sr = kokoro.create(p["text"], voice=voice_name, speed=p["speed"], lang=LANG, sentence_pause=0, clause_pause=PAUSE["comma"])
        audio = np.asarray(audio, dtype=np.float32)
        if p["gain"]:
            audio = audio * np.float32(10 ** (p["gain"] / 20))
        parts.append(audio)
        if p["pause"]:
            parts.append(np.zeros(int(p["pause"] * sr), dtype=np.float32))
    if not parts:
        raise ValueError("nothing to say")
    return np.concatenate(parts), sr


def synth(kokoro, text, voice_name, kind, out_mp3):
    """Kokoro (piece by piece) -> ffmpeg old-hat filter -> mp3. Returns the duration in seconds."""
    import soundfile as sf

    samples, sr = render(kokoro, plan_line(text, kind), voice_name)
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    part = out_mp3.with_name(out_mp3.stem + ".tmp.mp3")  # renamed into place, so a killed run never leaves half a clip
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.wav"
        sf.write(raw, samples, sr, subtype="FLOAT")  # float: the boosted house name must not clip before the limiter
        filters = FX.format(sr=sr) + (SHOUT_FX if kind in ("shout", "sample") else "")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", filters, "-codec:a", "libmp3lame", "-q:a", "4", str(part)],
            check=True,
        )
    os.replace(part, out_mp3)
    return round(len(samples) / sr / PITCH, 2)


def samples(work):
    kokoro = load_kokoro()
    for name in SAMPLE_VOICES:
        out = work / "audio" / "samples" / f"{name}.mp3"
        synth(kokoro, SAMPLE_TEXT, name, "sample", out)
        say(f"SAMPLE {name} audio/samples/{name}.mp3")
    say("DONE")


def write_json(path, value):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value))
    os.replace(tmp, path)


def voice_all(work):
    data = json.loads((work / "voice-input.json").read_text())
    voice_name, lines = data["voice"], data["lines"]
    manifest_path = work / "voice.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    kokoro = None
    for i, line in enumerate(lines, 1):
        key, h = line["key"], line_hash(line, voice_name)
        out = work / "audio" / f"{key}.mp3"
        if manifest.get(key, {}).get("hash") != h or not out.exists():
            if manifest.pop(key, None):  # the old clip no longer matches this line
                write_json(manifest_path, manifest)
            try:
                kokoro = kokoro or load_kokoro()
                duration = synth(kokoro, line["text"], voice_name, line_kind(line), out)
                manifest[key] = {"hash": h, "duration": duration}
            except Exception as err:  # one bad line must not stop the rest
                say(f"FAILED {key} {str(err).splitlines()[0] if str(err) else type(err).__name__}")
            write_json(manifest_path, manifest)  # save as we go, so a cancelled run resumes
        say(progress_line(i, len(lines), key))
    say("DONE")


def main():
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))  # exit promptly on docker stop / cancel
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--work", default="/work", help="workspace folder (default /work)")
    parser.add_argument("--samples", action="store_true", help="voice a sample line in each candidate voice")
    args = parser.parse_args()
    work = Path(args.work)
    samples(work) if args.samples else voice_all(work)


if __name__ == "__main__":
    main()
